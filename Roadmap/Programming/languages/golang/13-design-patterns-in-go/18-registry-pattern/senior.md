# Registry — Senior

## 1. Mental model — Registry as decoupling primitive

At senior level a Registry is not "a map with `Register` and `Lookup`". It is **the smallest inversion-of-control primitive in Go** — a one-way arrow from extension code to library code, mediated by a name. The library does not import the extension. The extension imports the library and announces itself. That direction is the point: the library stays a *core* that does not grow when you add drivers, codecs, collectors, or commands.

The alternative is **static dispatch** — a switch that hardcodes the set of impls at compile time:

```go
switch driver {
case "postgres": return pq.Open(dsn)
case "mysql":    return mysql.Open(dsn)
}
```

The switch lives in the library. To add a driver you patch the library. `database/sql` would import every driver — impossible at scale.

Registry dispatch inverts the arrow:

```go
drv, ok := drivers.Lookup(name) // library knows nothing about drivers
return drv.Open(dsn)
```

The library knows the *shape* (`driver.Driver` interface) and the *name*. The set of impls is open. New drivers are added by importing them — typically `import _ "github.com/lib/pq"`, which fires the package's `init()`, which calls `sql.Register("postgres", &Driver{})`.

| Property | Static dispatch | Registry dispatch |
|----------|-----------------|-------------------|
| Library knows impls? | Yes (closed set) | No (open set) |
| Add impl requires | Library edit + rebuild | Import + rebuild |
| Compile-time safety | Full | Interface satisfaction only |
| Discovery | grep the switch | `Names()` introspection |
| Test isolation | Swap concrete | Swap registry instance |
| Cycle risk | None | Real — A registers, B looks up |
| Binary size | Used impls only | All imported impls |

The senior heuristic: **use a Registry when the set of implementations is open across a module boundary**. Inside one module a switch is fine. Across modules — drivers, plugins, third-party collectors — a Registry pays its cost.

Two cousins often confused with Registries: **Service Locator** (runtime lookup by type — antipattern, Registry survives because names are stable contracts) and **DI Container** (wires by construction, not name — a Registry is a degenerate DI container with one wiring strategy). A Registry is the smallest such primitive that survives without a framework, which is why it is everywhere in stdlib.

---

## 2. Go `init()` ordering — full rules, dependency DAG, edge cases

Registries ride on `init()`. Understanding ordering is the difference between a working blank-import idiom and a heisenbug.

**The full rules** (Go spec, *Package initialization*):

1. A package is initialized only after every package it imports (transitively) is initialized.
2. Within a package, `var` declarations are initialized in declaration order, respecting dependencies between them. The compiler builds a DAG over package-level vars.
3. All `init()` functions run after var initialization, in the order they appear across source files; within one file, top to bottom.
4. File order is by filename, sorted.
5. A package's `init()` runs exactly once even if imported through ten transitive paths.
6. `main`'s `init()` (if any) runs last, then `main()`.

**The dependency DAG.** For `main → A → B → C; A → D; D → C`, init order is `C, D, B, A, main`. `C` runs once. The order between `B` and `D` is unspecified except both run before `A`. If your registry depends on `B`'s init finishing before `D`'s, you have a latent bug — the compiler may reorder across versions.

**Cross-sibling ordering trap.** Two blank imports of `pq` and `sqlite3` both register drivers. Order is *the order they appear in the import block*, but only when neither has a transitive dependency on the other. Rule: **registries must not depend on sibling registration order**. If two drivers conflict (same name), one panics — which one is undefined.

**Variable-vs-init split.** `var defaultRegistry = newRegistry()` runs in var-init phase; `func init() { defaultRegistry.register(...) }` runs after. By the time *any* init in *this* package runs, the var is non-nil. Imported packages' inits already ran — they observed the var because their import resolution waited for this package's var-init.

**Edge cases:**

- Cyclic imports are forbidden. Cannot resolve A↔B registration by direct import — introduce a third package.
- `init()` in `_test.go` runs after the package's normal inits. Useful for test-only registrations.
- Plugin packages (`buildmode=plugin`): `init()` runs at `plugin.Open`, not program start. Registrations live forever; cannot unload.
- `go test -run` does not skip `init()`. All registrations happen even for skipped tests.
- Linker dead-code elimination keeps `init`-only packages — `init()` is a side effect, so `import _` works.
- `go vet` does not check init order. Code review and tests.

**Diagnosing init issues.** `GODEBUG=inittrace=1` (Go 1.16+) prints each package's init time:

```
init database/sql @0.512 ms, 0.31 ms clock, 1280 bytes, 23 allocs
init github.com/lib/pq @0.823 ms, 0.07 ms clock, 416 bytes, 5 allocs
```

A slow init (Prometheus collectors, gRPC reflection) shows up here. Targets above 50 ms slow every test and every restart.

---

## 3. Stdlib ecosystem deep dive

### 3.1 `database/sql.Register` — the canonical implementation

```go
var (
    driversMu sync.RWMutex
    drivers   = make(map[string]driver.Driver)
)

func Register(name string, driver driver.Driver) {
    driversMu.Lock()
    defer driversMu.Unlock()
    if driver == nil { panic("sql: Register driver is nil") }
    if _, dup := drivers[name]; dup {
        panic("sql: Register called twice for driver " + name)
    }
    drivers[name] = driver
}
```

`sync.RWMutex` (not `sync.Map`) because reads happen rarely — per `sql.Open`. Panic on duplicate: stdlib chooses fail-fast since two drivers under the same name is almost always a vendoring mistake, and the panic happens during `init()` so the program never starts in a half-configured state. `Drivers()` returns sorted output. No `Unregister` — removing one mid-flight would race every active `sql.Open`.

### 3.2 `image` format detection — copy-on-write

```go
var (
    formatsMu     sync.Mutex
    atomicFormats atomic.Value // []format
)

func RegisterFormat(name, magic string, decode, decodeConfig ...) {
    formatsMu.Lock()
    formats, _ := atomicFormats.Load().([]format)
    atomicFormats.Store(append(formats, format{name, magic, decode, decodeConfig}))
    formatsMu.Unlock()
}
```

Writers take a mutex, copy the slice, store the new one. Readers use `atomicFormats.Load()` with zero locking. Right shape when writes are init-only and reads happen per-image. Magic-byte key as second lookup path: registered by name but looked up by content. **No duplicate check** — historical, because `image/png` was registered by stdlib and by `golang.org/x/image/png` and they had to coexist.

### 3.3 `encoding/gob.Register` — bidirectional Registry

```go
var (
    nameToConcreteType sync.Map // map[string]reflect.Type
    concreteTypeToName sync.Map // map[reflect.Type]string
)
```

`gob` needs both `name → type` (decoding) and `type → name` (encoding). Two maps, kept in sync via `sync.Map.LoadOrStore` — atomic check-and-insert without a separate mutex. `reflect.Type` works as a key because it is comparable and globally interned by the runtime. Panic on conflicting registration.

### 3.4 `http.DefaultServeMux` — handler Registry

`ServeMux` is a scoped Registry, `DefaultServeMux` is the global. The senior pattern: always pass an explicit `*ServeMux`, never rely on the default outside `main`. Lookups use a trie over path segments (post-1.22 pattern matching). Conflict detection at register time: `mux.Handle("/users/{id}", ...)` followed by `mux.Handle("/users/me", ...)` panics if patterns are ambiguous. The data structure is whatever the lookup pattern demands.

### 3.5 Others

| Package | Function | Key | Notes |
|---------|----------|-----|-------|
| `expvar` | `Publish` | string | Panic on duplicate; exposed at `/debug/vars` |
| `flag` | `flag.Var` | flag name | Panic on duplicate in `flag.CommandLine` |
| `runtime/pprof` | `NewProfile` | string | Custom profile names |
| `mime` | `AddExtensionType` | extension | Stdlib defaults plus user additions |

The stdlib is consistent: name → impl, panic on duplicate, no removal, `Names()`-shaped introspection.

---

## 4. Real libraries — production Registries at scale

**Prometheus.** Indexed by collector ID (hash of all `Desc`s) and by metric-name hash — detects "different collector, same metric name", a common bug when a library and an application both register `http_requests_total`. `Register` returns an error; `MustRegister` panics. Senior code uses `Register` in libraries (recoverable) and `MustRegister` in `main` (fatal). `prometheus.DefaultRegisterer` is the global; `NewRegistry()` for tests.

**OpenTelemetry.** `otel.SetMeterProvider` is a *singleton Registry* with one slot. Calls before `Set...` return a no-op meter; calls after see the configured one. Delegating Registry: meters created early hold a delegate that switches behavior once the provider is set. A library can call `otel.Meter("name")` at `init()` time and still observe a future provider.

**Cobra.** Each `*cobra.Command` is a Registry of subcommands. The hierarchy is a tree of Registries; lookup is path-based (`myapp migrate up`). Cobra deliberately requires explicit `AddCommand` from `main` — no `init()`-time registration — to keep ordering deterministic. Trade: cannot extend by plugin import.

**Gorilla mux / chi.** Method+pattern is the composite key. Internally a *slice* of `Route` walked in order, not a hash map. First match wins. Lookup is O(n) but n is small and order semantics are explicit. **When lookup needs order or pattern semantics, a list is the right container, not a map.**

**gRPC.** `pb.RegisterUserServiceServer(s, impl)` calls `s.RegisterService(...)`. The Registry is **closed after `Serve`** — calling `RegisterService` post-Serve panics. *Lifecycle-bounded* Registry: open during setup, frozen during operation. Simplifies internal locking and eliminates a class of race conditions.

| Library | Shape | Key | Lifecycle |
|---------|-------|-----|-----------|
| `database/sql` | Map | Driver name | Open forever |
| `prometheus` | Map of collectors | Collector ID hash | Open forever |
| `otel` | Singleton slot | (one value) | Lazy delegation |
| `cobra` | Tree of maps | Command path | Built in `main` |
| `gorilla/mux` | Ordered list | Method+pattern | Built before `Serve` |
| `grpc` | Map | Service name | Frozen at `Serve` |

Senior reach: **match Registry data structure and lifecycle to lookup pattern and safety requirement**.

---

## 5. Scoped vs global registries — DI, testability, fx/wire

Global Registries are singleton mutable state. The pain: tests interfere (one registers `"foo"`, the next panics on duplicate, run order matters), multi-tenant is impossible, no clean teardown (the test's impl stays registered), and dependencies become invisible to code review.

**Scoped Registries** are instances, not package-level vars:

```go
type CodecRegistry struct {
    mu     sync.RWMutex
    codecs map[string]Codec
}
func NewCodecRegistry() *CodecRegistry { /* ... */ }

type Service struct { codecs *CodecRegistry }
func NewService(codecs *CodecRegistry) *Service { return &Service{codecs} }
```

Tests get their own. Production wires one in `main`. DI assembles. No globals.

**fx integration** makes scoped Registries idiomatic:

```go
fx.New(
    fx.Provide(NewCodecRegistry),
    fx.Invoke(func(r *CodecRegistry) error { return r.Register("json", jsonCodec{}) }),
    fx.Invoke(func(r *CodecRegistry) error { return r.Register("proto", protoCodec{}) }),
).Run()
```

`fx.Invoke` runs after construction, in declaration order, with the Registry injected. No globals, no `init()` side effects.

**wire integration** is compile-time DI:

```go
func ProvideCodecRegistry() *CodecRegistry { return NewCodecRegistry() }
func ProvideRegisteredCodecs(r *CodecRegistry) (*CodecRegistry, error) {
    if err := r.Register("json", jsonCodec{}); err != nil { return nil, err }
    return r, nil
}
var Set = wire.NewSet(ProvideCodecRegistry, ProvideRegisteredCodecs)
```

Wiring is in code, statically analyzable, no reflection.

**The hybrid**: keep the global but ban it from production wiring. The global is the *plugin discovery* Registry; production reads it once at startup and copies into a scoped Registry the rest of the system uses. Blank-imports still work; tests run against scoped Registries and never collide.

```go
func LoadCodecsFromGlobal(target *CodecRegistry) error {
    for _, name := range codec.Default.Names() {
        c, _ := codec.Default.Get(name)
        if err := target.Register(name, c); err != nil { return err }
    }
    return nil
}
```

Senior codebases lean toward scoped; junior lean toward globals.

---

## 6. Generic typed Registry (Go 1.18+)

Pre-1.18 Registries used `interface{}` and lost type info. Generics give a typed Registry without the cost.

```go
package registry

type Registry[T any] struct {
    mu       sync.RWMutex
    items    map[string]T
    onChange []func(name string, t T)
}

func New[T any]() *Registry[T] {
    return &Registry[T]{items: make(map[string]T)}
}

func (r *Registry[T]) Register(name string, t T) error {
    if name == "" { return fmt.Errorf("registry: empty name") }
    r.mu.Lock()
    defer r.mu.Unlock()
    if _, dup := r.items[name]; dup {
        return fmt.Errorf("registry: %q already registered", name)
    }
    r.items[name] = t
    for _, fn := range r.onChange { fn(name, t) }
    return nil
}

func (r *Registry[T]) MustRegister(name string, t T) {
    if err := r.Register(name, t); err != nil { panic(err) }
}

func (r *Registry[T]) Get(name string) (T, bool) {
    r.mu.RLock(); defer r.mu.RUnlock()
    t, ok := r.items[name]; return t, ok
}

func (r *Registry[T]) Names() []string {
    r.mu.RLock(); defer r.mu.RUnlock()
    out := make([]string, 0, len(r.items))
    for n := range r.items { out = append(out, n) }
    sort.Strings(out); return out
}

func (r *Registry[T]) OnChange(fn func(name string, t T)) {
    r.mu.Lock(); defer r.mu.Unlock()
    r.onChange = append(r.onChange, fn)
}

type Factory[T, C any] func(cfg C) (T, error)

type FactoryRegistry[T, C any] struct{ inner *Registry[Factory[T, C]] }

func NewFactory[T, C any]() *FactoryRegistry[T, C] {
    return &FactoryRegistry[T, C]{inner: New[Factory[T, C]]()}
}

func (r *FactoryRegistry[T, C]) Register(name string, f Factory[T, C]) error {
    return r.inner.Register(name, f)
}

func (r *FactoryRegistry[T, C]) Build(name string, cfg C) (T, error) {
    var zero T
    f, ok := r.inner.Get(name)
    if !ok {
        return zero, fmt.Errorf("registry: no factory %q (have: %v)", name, r.inner.Names())
    }
    return f(cfg)
}
```

Use sites:

```go
var codecs = registry.New[Codec]()
func init() { codecs.MustRegister("json", jsonCodec{}) }

var stores = registry.NewFactory[Store, StoreConfig]()
func init() {
    stores.Register("redis", func(cfg StoreConfig) (Store, error) {
        return newRedisStore(cfg.Addr)
    })
}
s, err := stores.Build("redis", StoreConfig{Addr: ":6379"})
```

Senior touches: `Register` returns error and `MustRegister` panics (library-friendly); error in `Build` lists known names (debuggable for typos); `OnChange` for live introspection feeding Prometheus or audit logs; no `Unregister` in the base type (safe removal is a separate problem, §7).

---

## 7. Hot-reload Registries — copy-on-write, `atomic.Pointer[map]`, plugin lifecycle

Most Registries are append-only and startup-bounded. Long-running servers sometimes need to *swap implementations live*. The naive solution (`Lock` on every read) breaks the read path for everyone every time the writer touches the map.

**Copy-on-write with `atomic.Pointer[T]`** (Go 1.19+):

```go
type HotRegistry[T any] struct {
    items atomic.Pointer[map[string]T]
    mu    sync.Mutex // serializes writers only
}

func NewHot[T any]() *HotRegistry[T] {
    r := &HotRegistry[T]{}
    empty := make(map[string]T)
    r.items.Store(&empty)
    return r
}

func (r *HotRegistry[T]) Get(name string) (T, bool) {
    m := *r.items.Load() // one atomic pointer read
    t, ok := m[name]; return t, ok
}

func (r *HotRegistry[T]) Register(name string, t T) error {
    r.mu.Lock(); defer r.mu.Unlock()
    old := *r.items.Load()
    if _, dup := old[name]; dup { return fmt.Errorf("duplicate: %q", name) }
    next := make(map[string]T, len(old)+1)
    for k, v := range old { next[k] = v }
    next[name] = t
    r.items.Store(&next)
    return nil
}

func (r *HotRegistry[T]) Unregister(name string) {
    r.mu.Lock(); defer r.mu.Unlock()
    old := *r.items.Load()
    if _, ok := old[name]; !ok { return }
    next := make(map[string]T, len(old)-1)
    for k, v := range old { if k != name { next[k] = v } }
    r.items.Store(&next)
}
```

Readers pay one atomic load — faster than `RWMutex.RLock`/`RUnlock` (no atomic CAS pair, no fairness queue). Writers pay map-copy: O(n) per write, fine when writes are rare. **The map is never mutated after Store**, so holders of an old map pointer see a consistent snapshot. Old maps stay alive until the last reader releases; GC cleans them up.

**Plugin lifecycle.** A Go plugin registers at `plugin.Open`. Tearing down is the problem: **Go plugins cannot be unloaded** — `dlclose` is not called; the plugin's code stays mapped forever. Senior shape for live updates:

1. Build versioned plugin filenames (`codec_xml_v2.so`).
2. `plugin.Open` the new file. Its `init()` registers under a versioned name (`xml-v2`).
3. Atomically swap the routing layer to point at `xml-v2`.
4. Drain in-flight uses of `xml` (reference counting or "wait N seconds").
5. Leave `xml` registered but unreferenced — old version stays in memory until process restart.

Not "hot reload" in the JVM sense; "side-by-side versions with controlled traffic shifting". Accepting that limitation is the senior skill.

**Quiescence and draining.** Pure copy-on-write gives snapshot consistency but does not tell you when the last user of an old value is done. Options: reference counting (`atomic.Int32` per value, `Unregister` waits for zero), generation epoch (consumers record the epoch at lookup; unregisterer waits via `WaitGroup`), or RCU (rare in Go — no quiescent-state callback). Most codebases stop at "wait 30 seconds, hope for the best".

| Pattern | Read cost | Write cost | Use |
|---------|-----------|------------|-----|
| `RWMutex` | RLock/RUnlock pair | Lock | Default |
| `sync.Map` | Atomic ops + hashing | Atomic ops + hashing | High write rate, equal keys |
| `atomic.Pointer[map]` | One atomic load | Map copy + atomic store | Hot-reload, read-heavy |
| Sharded `RWMutex` | RLock per shard | Lock per shard | Many writers, many keys |

---

## 8. Observability — introspection, `Names()`, audit log

Registries are configuration that ships with the binary. Observability is how you prove it matches expectations.

**Introspection endpoint.** Expose `/debug/registries/{name}` for every Registry:

```go
func (r *Registry[T]) ServeHTTP(w http.ResponseWriter, req *http.Request) {
    type entry struct{ Name, Type string }
    out := make([]entry, 0, len(r.Names()))
    for _, n := range r.Names() {
        t, _ := r.Get(n)
        out = append(out, entry{Name: n, Type: fmt.Sprintf("%T", t)})
    }
    json.NewEncoder(w).Encode(out)
}
```

Three minutes after a deploy you can curl the endpoint and verify the right drivers loaded. No restart, no log-grepping.

**Audit log.** Capture the registering stack:

```go
r.log.Info("registry: registered",
    "name", name,
    "type", fmt.Sprintf("%T", t),
    "stack", string(debug.Stack()))
```

The stack tells you *which* `init()` did the registration. When you ship a binary and `Drivers()` shows the wrong driver, the stack identifies the offending package. Saves hours of vendor archeology.

**Metrics:**

| Metric | Type | Labels | Use |
|--------|------|--------|-----|
| `registry_size` | gauge | registry | Verify expected impls loaded |
| `registry_lookups_total` | counter | registry, name, hit | Detect unused registrations |
| `registry_lookup_misses_total` | counter | registry, name | Typo or missing-import signal |
| `registry_register_total` | counter | registry | Compare across deploys |
| `registry_register_duration_seconds` | histogram | registry | Slow `init()` detection |

The misses metric is gold: a typo in config (`"redus"`) shows up as a labeled miss, not a crash. Alert on `rate(registry_lookup_misses_total[5m]) > 0` for production.

**`GODEBUG=inittrace=1`** output (`init github.com/lib/pq @0.823 ms, 0.07 ms clock, 416 bytes, 5 allocs`) can be scraped at startup and exported as Prometheus metrics — useful when a plugin's init time creeps from 20 ms to 500 ms.

---

## 9. Failure modes

**Duplicate registration panic.** Two packages register under the same name; the second `Register` panics. With `init()`-time registration the program never starts. Causes: vendoring two versions of the same library, aliased forks (`fork-of-pq` registers as `"postgres"`), test re-imports. Mitigation: stdlib chose panic — live with it (alternative "last write wins" hides bugs); for your own Registries return errors in `Register`, panic only in `MustRegister`; audit log captures the offending stack.

**Init dependency cycles.** Two packages each want to look up what the other registers. Compiler rejects the import cycle. The workaround — looking up via a global blob — defers failure to runtime: one package's `init()` runs first, finds nothing, fails or silently picks a default. Senior shape: **`init()`s must not look up from other Registries**. Look up at first use, not at init. The Registry is just a map at init time; consumers run later.

**Partial-init races.** A goroutine started in `init()` that registers later:

```go
func init() {
    go func() {
        cfg := loadConfig() // slow
        codecs.Register("yaml", &yamlCodec{cfg})
    }()
}
```

`main()` runs, calls `codecs.Get("yaml")`, gets nothing. Rule: **registrations must complete synchronously within `init()`**. If you cannot, do not pretend the Registry has the value — fail at first use, or use factories that fetch config on demand.

**Plugin segfault isolation.** A Go plugin shares the host's memory. A bug in the plugin — nil deref, out-of-bounds — crashes the *host*. There is no in-process isolation. Options: subprocess plugins with `hashicorp/go-plugin` (RPC over Unix socket — plugin crash kills only the subprocess); `recover()` around every plugin call (catches panics, not segfaults from cgo or memory corruption); or refuse the plugin model and compile in. Senior heuristic: **if a plugin can crash you, you do not have a plugin — you have a tightly coupled monolith with extra steps**.

**Memory leak via never-released values.** A Registry's map holds strong references. Registering a giant struct keeps it alive forever. Symptom: heap grows after every test because each re-registers fixtures. Diagnose with `pprof heap`; fix with scoped Registries that go out of scope with the test.

**Lookup-by-typo as silent fallback.** `c, ok := codecs.Get(cfg.Codec); if !ok { c = defaultCodec }` hides config errors. User types `"yml"` instead of `"yaml"`, gets the default, no log, no metric. Make the miss loud — return an error, increment the miss counter, alert.

| Failure | Symptom | Fix |
|---------|---------|-----|
| Duplicate registration | Crash at startup | Vendor audit; rename forks |
| Init cycle | Compile error or order-dependent bug | Lazy lookup, not init-time |
| Partial-init race | Random `Lookup` misses | Synchronous registration only |
| Plugin segfault | Whole process dies | Subprocess plugins |
| Memory leak | Heap grows per test | Scoped Registries |
| Silent typo fallback | Wrong codec in production | Loud misses + alerts |

---

## 10. When NOT a Registry + closing principles

### 10.1 When not

- **Closed set of implementations.** Three database drivers you control? A switch is simpler, type-safer, no init magic.
- **Sole consumer in same package.** Don't register and immediately look up. Just use the value.
- **Compile-time known set.** A `[N]T` array indexed by enum is faster, type-safe, and exhaustive (the compiler catches missing cases via switch).
- **Need ordering or composition.** Middleware chains are sequential; Registries lose order. Use a slice.
- **Hot dispatch path.** Map lookup + interface call beats a static call by 5-20 ns. For a hot inner loop, that matters. Inline.
- **Configuration would be simpler.** If "registration" is "ship a config file with a list", a config file is more discoverable, version-controlled, and inspectable.
- **The thing has identity.** Registries map names to *values*. If two different "postgres" connections are not the same value — a connection pool, a tenant-scoped driver — you want a factory, not a Registry of singletons.

### 10.2 Closing principles

**A Registry is an inversion of control, not a map.** The map is incidental. The point is that the library does not know about the implementations. If your "registry" is just a map you control, refactor it to a struct.

**Match the data structure to the lookup pattern.** Map for exact-name lookup. Trie for path patterns. Ordered list for first-match. Two maps for bidirectional lookup. Sharded map for many writers. Read the lookup pattern first; choose the container second.

**Panic at register, error at lookup.** Registration is a startup-time configuration mistake — fail fast with a clear message. Lookup is a runtime situation — return an error and let the caller decide.

**Always provide `Names()` and an introspection endpoint.** Registries are invisible until they fail. Names plus endpoint makes them visible in three seconds — worth the 20 lines of code.

**Globals for plugin discovery, scoped for production wiring.** The hybrid: a global captures `init()`-time registrations; production reads it once into a scoped Registry that the rest of the system uses. Tests never touch the global.

**`init()` does the bare minimum.** Register the value. Don't load config, don't open connections, don't start goroutines. Heavy work goes in `Open` / `New` / `Build` called from `main`. Init failures are unrecoverable.

**Hot-reload is harder than it looks.** Atomic pointer to map gives snapshot consistency. Draining and quiescence are separate problems. If you do not need them, document "Registry is startup-bounded" and enforce it with no `Unregister`.

**The set of impls is a deploy-time concern.** Two systems with different impl sets are two binaries, not one binary with a runtime switch. Avoid making every Registry remotely mutable.

**Observe the misses.** Lookup hits are routine; misses are bugs in disguise. Counter, label by name, alert when nonzero in prod. This single signal catches more config bugs than tests do.

The Registry is the smallest abstraction Go gives you for "the library does not know about its extensions". Used well, it lets your core stay small while the ecosystem grows. Used badly, it gives you panics at startup, ghost registrations, and a config surface no one can audit. The senior shift is treating the Registry as a *contract*: names are stable, registrations are synchronous, introspection is built in, and the lifecycle is documented.

---

## Further reading

- `src/database/sql/sql.go` — canonical stdlib Registry
- `src/image/format.go` — copy-on-write `atomic.Value` Registry
- `src/encoding/gob/type.go` — bidirectional Registry with `sync.Map`
- `prometheus/client_golang` — `Registry` and `MustRegister`
- `hashicorp/go-plugin` — subprocess plugin isolation
- `go.uber.org/fx` and `google/wire` — scoped Registry wiring
- Go spec: *Package initialization*
- `GODEBUG=inittrace=1` — `runtime/extern.go`
