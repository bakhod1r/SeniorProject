# Registry — Middle

## 1. Where Registry actually shows up

At a junior level, "Registry" is `sql.Register`. At a middle level, you notice it's the *most-used* pattern in Go's standard library. Almost everything that admits "you can add new implementations later" is a Registry:

- `database/sql` — DB drivers.
- `image` — image format decoders.
- `encoding/json`, `encoding/gob` — custom Marshalers (less obvious — `Register` for `gob`, type-switch for `json`).
- `flag.Var`, `expvar.Publish` — command-line flags and exposed variables.
- `prometheus.MustRegister` — metric collectors.
- `runtime.SetFinalizer` — type → cleanup function.
- HTTP middleware chains (more on this in §6 — they're registries of handlers).

Middle-level skill is recognising the variants and knowing when each is correct.

---

## 2. Three forms of registry

The shape of a Registry depends on what you store:

| Form | Key type | Stored value | Example |
|------|----------|--------------|---------|
| **Implementation registry** | string | Interface satisfier | `sql.Register("postgres", driver)` |
| **Factory registry** | string | Constructor function | `gauge.NewFromConfig(name, cfg)` |
| **Handler registry** | route/pattern | Handler function | `mux.HandleFunc("/users", h)` |

Each form has the same map-of-name-to-thing shape; what differs is what consumers do with the result. An implementation registry returns a thing to call methods on. A factory registry returns a function you call to *create* the thing. A handler registry is consulted to route an incoming event.

You'll mix these in the same program — e.g., the database layer uses an implementation registry while the HTTP layer uses a handler registry. They're all the same pattern.

---

## 3. A production-shaped implementation registry

```go
package codec

type Codec interface {
    Encode(any) ([]byte, error)
    Decode([]byte) (any, error)
}

type registry struct {
    mu     sync.RWMutex
    codecs map[string]Codec
}

var defaultRegistry = &registry{codecs: map[string]Codec{}}

func Register(name string, c Codec) {
    if c == nil {
        panic("codec: Register nil codec for " + name)
    }
    defaultRegistry.mu.Lock()
    defer defaultRegistry.mu.Unlock()
    if _, dup := defaultRegistry.codecs[name]; dup {
        panic("codec: Register called twice for " + name)
    }
    defaultRegistry.codecs[name] = c
}

func Get(name string) (Codec, bool) {
    defaultRegistry.mu.RLock()
    defer defaultRegistry.mu.RUnlock()
    c, ok := defaultRegistry.codecs[name]
    return c, ok
}

func Names() []string {
    defaultRegistry.mu.RLock()
    defer defaultRegistry.mu.RUnlock()
    out := make([]string, 0, len(defaultRegistry.codecs))
    for n := range defaultRegistry.codecs {
        out = append(out, n)
    }
    sort.Strings(out)
    return out
}
```

Middle-level differences from junior code:

- **`sync.RWMutex`**: many readers, rare writers. Reads use `RLock` for cheap concurrent access.
- **Nil-check**: a `Register("foo", nil)` is almost certainly a bug — fail loud.
- **`Names()` enumeration**: makes registries debuggable. You can dump the list at startup.

---

## 4. Factory registry shape

When *creating* the implementation needs config (host, port, credentials, options), a factory registry is cleaner than an implementation one:

```go
type Store interface { /* ... */ }
type Factory func(cfg Config) (Store, error)

var factories = map[string]Factory{}
var muFactories sync.RWMutex

func Register(name string, f Factory) {
    muFactories.Lock()
    defer muFactories.Unlock()
    factories[name] = f
}

func New(name string, cfg Config) (Store, error) {
    muFactories.RLock()
    f, ok := factories[name]
    muFactories.RUnlock()
    if !ok {
        return nil, fmt.Errorf("no factory for store: %s", name)
    }
    return f(cfg)
}
```

Use:

```go
store, err := stores.New("redis", Config{Addr: "localhost:6379"})
```

This is how cloud SDK clients, message bus clients, and most modular libraries work. The implementation registry returns a *pre-built* thing; the factory registry returns a constructor.

---

## 5. The `init()` ordering rules

`init()` functions run in a deterministic order:

1. All `var` declarations in the package are evaluated first.
2. Then all `init()` functions in the package, in the order they appear in the source files (alphabetical by filename).
3. Packages are initialised in dependency order: a package's `init()` runs only after every package it imports has been initialised.

Practical consequences:

- **You can't depend on a sibling package's `init()` having run** unless you explicitly import it. Order across sibling imports is the order they appear.
- **A package can be initialised exactly once**, even if imported by many packages.
- **Multiple `init()`s in one package are allowed** — useful for splitting registration across files.

For the registry pattern this means: the consumer side that does `Lookup` *must* run after all `init()`s — which is guaranteed since `init()` runs before `main()`.

---

## 6. HTTP routers are Registries

```go
mux := http.NewServeMux()
mux.HandleFunc("/users", usersHandler)
mux.HandleFunc("/orders", ordersHandler)
http.ListenAndServe(":8080", mux)
```

`mux` is a Registry of `pattern → http.Handler`. The "Register" call is `HandleFunc`. The "Lookup" happens per-request, based on the URL path. Treating routers as registries makes their pluggability obvious — adding an endpoint is *adding to the registry*, not modifying the router.

Same story for gRPC: `pb.RegisterFooServiceServer(s, impl)` is registering an implementation under the service name.

---

## 7. Scoped vs global registries

The textbook Registry is a global. Globals have known problems: hard to test, hard to scope per-tenant, hard to swap in test mocks.

Two ways out:

**Scoped registry** — the registry is an instance, not a package-level variable:

```go
type CodecRegistry struct {
    mu     sync.RWMutex
    codecs map[string]Codec
}

func (r *CodecRegistry) Register(name string, c Codec) { /* ... */ }
func (r *CodecRegistry) Get(name string) (Codec, bool) { /* ... */ }

func NewCodecRegistry() *CodecRegistry { /* ... */ }
```

Tests get their own. Production has one passed through dependency injection. No globals.

**Hybrid** — a global plus a way to override it:

```go
var Default = NewCodecRegistry()

// Tests:
codec.Default = NewCodecRegistry()
```

The hybrid still allows blank-import-driven registration but lets tests replace it.

Senior codebases lean toward scoped registries. Junior codebases lean toward globals. The middle-level decision is whether the convenience of `import _ "..."` is worth the test pain.

---

## 8. Type-switching `any` vs interface-keyed registries

A common antipattern: a registry keyed by `reflect.Type` instead of a name string.

```go
var handlers = map[reflect.Type]Handler{}

func Register(payload any, h Handler) {
    handlers[reflect.TypeOf(payload)] = h
}
```

You lose:

- Stable identifiers across versions (renaming a struct breaks the key).
- Easy serialization-friendly names.
- The ability to register multiple impls for the same type.

You gain:

- Compile-time safety on the consumer's side.

The trade is usually in favor of strings when registrations cross process or persistence boundaries; types when they're purely in-memory.

---

## 9. Lifecycle: when can a registry change?

Three policies:

- **Startup-only.** Registry is mutated only in `init()` or early in `main()`. After that it's read-only. Lock is just defense against the rare write.
- **Lazy registration.** Code that calls `Get(name)` may also call `Register(name, c)` if missing. Now the lock is hot — both directions.
- **Hot-swap.** A long-running server reloads plugins at runtime. The registry needs careful read/write synchronization, and consumers may need to handle "the implementation just changed under me".

Most Go registries are startup-only. Hot-swap is the hardest and rarest variant — needs versioning, draining, and copy-on-write.

---

## 10. Common middle-level mistakes

- **Calling `Register` from a non-`init` goroutine** (`go someInit()`). Now the order is undefined, and `Get` may run before `Register`.
- **Returning the interface but also exposing the concrete type via a separate accessor.** Defeats the abstraction; consumers couple to the concrete type.
- **Using a global mutex for a hot read path.** RWMutex for reads, sync.Map for higher contention.
- **No introspection method.** When a Lookup fails, the user doesn't know what's registered. Add `Names() []string`.
- **Registering by an interface{} key** — you lose stable name semantics.
- **Forgetting that `init()` runs once.** If you import `pq` from two packages, the registration runs once, not twice. (Go ensures this.)

---

## 11. Summary

Middle-level Registry means knowing the three forms (implementation, factory, handler), preferring scoped registries over globals when testability matters, using `RWMutex` (or `sync.Map`) for many-readers/few-writers, and adding `Names()` for debuggability. The `init()` plus blank-import idiom is one valid wire-up; the explicit `New(...)` plus DI is another. Pick deliberately, based on whether you need plugin-style discovery or just a Map.

---

## Further reading
- `database/sql` source — model implementation
- `image` package and `RegisterFormat`
- `prometheus.MustRegister` — metric collector registry
- `golang.org/x/text/encoding` — codec registry of charset encoders
- Mat Ryer, *Go programming patterns* — chapter on registries and plugins
- Go spec: package initialization order
