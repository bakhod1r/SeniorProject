# Registry — Specification

## 1. Origins

The Registry pattern predates Go by two decades and arrived through three independent traditions: enterprise-application data-access catalogs, dynamic-dispatch service location, and modular runtime plugin systems. Go's contribution is to elevate the pattern from "useful idiom" to "default wiring mechanism for the standard library", driven by `init()` functions, blank imports, and package-level variables.

Historical milestones:

- **Martin Fowler, *Patterns of Enterprise Application Architecture* (Addison-Wesley, 2002)** — formally catalogued **Registry** as a well-known place where objects can be found by name. Fowler distinguished session-scoped, thread-scoped, and process-scoped registries; emphasised that Registry is a controlled global access point, not a hidden one. The book treated it as a domain-layer convenience for shared objects like the system clock and the current user.
- **Mark Seemann, *Dependency Injection in .NET* (Manning, 2010)** — codified the **Service Locator antipattern** critique. Seemann's argument is that a Registry that returns arbitrary dependencies to its callers hides those dependencies from the type system; the caller's API no longer documents what it needs. The antipattern label sticks when Registry is misused as a general DI container, not when it is used for the bounded plugin-style cases Fowler described.
- **Java `ServiceLoader` (Java 6, 2006)** — standardised SPI (Service Provider Interface) discovery via `META-INF/services/*` files on the classpath. A library declares a provider interface; jars on the classpath drop a file listing their implementations; `ServiceLoader.load(Iface.class)` returns the registered implementations. This is Registry-by-filesystem-convention rather than Registry-by-code.
- **.NET `DependencyResolver` and ASP.NET MVC's `IDependencyResolver` (2009)** — built-in registry for controller factories and view engines, criticised by Seemann as a leaky abstraction that pulled Service Locator antipattern into the framework's core APIs.
- **Eclipse OSGi (1999 onward)** — bundle-and-service registry for the Eclipse plugin platform; the most ambitious production Registry system, supporting hot install/uninstall of plugins, versioned interfaces, and per-bundle classloaders. OSGi proved the pattern scales to thousands of pluggable components at the cost of significant runtime machinery.

Go-specific history:

- **`database/sql.Register` (Go 1.0, 2012)** — shipped on day one. Drivers register themselves under a string name in their `init()`; user code does `sql.Open("postgres", dsn)` without ever importing the driver package by name (it is blank-imported for side effects). This is the canonical Go Registry and the reference shape every subsequent stdlib registry imitates.
- **`image.RegisterFormat` (Go 1.0, 2012)** — same pattern: image decoders register a magic-byte prefix and a decoder function; `image.Decode(r)` dispatches by sniffing the prefix. Blank-importing `image/png` or `image/jpeg` adds the format.
- **`encoding/gob.Register` (Go 1.0, 2012)** — concrete types register themselves so the gob decoder can reconstruct interface values. The key is the type name; the value is a `reflect.Type`. Without registration, decoding into an interface fails at runtime.
- **`net/http` `DefaultServeMux` (Go 1.0, 2012)** — package-level Registry of URL pattern to `http.Handler`. `http.HandleFunc("/path", h)` mutates global state; `http.ListenAndServe(":8080", nil)` uses it. The most-criticised global Registry in the standard library precisely because it is hidden.
- **`expvar.Publish` (Go 1.0, 2012)** — registers a named variable for `/debug/vars` HTTP introspection. The smallest possible Registry: one map, one mutex, one publish function.
- **`plugin` package (Go 1.8, 2017)** — dynamic loading of `.so` files via `plugin.Open`; the loaded plugin's `init()` runs and can call into Registries to register itself. The package is widely regarded as a partial solution — version mismatches between host and plugin produce opaque failures, cross-platform support is limited, and the loaded code shares the host's runtime — but it is the only stdlib path to runtime-loaded code.
- **`reflect.Register` (informal)** — `encoding/gob` and `encoding/json` both maintain internal type Registries derived from reflection; the pattern of caching `reflect.Type` to an encoder/decoder pair appears throughout the stdlib whenever serialisation meets interfaces.

Go's distinctive stance is to push the Registry into the language's startup machinery: `init()` functions and blank imports give you compile-time discoverability of side-effect registrations without forcing the consumer to know which packages exist. This is the missing piece in older languages where SPI required runtime classpath scanning or reflection over annotations. The trade-off is that registrations are package-global and hard to test in isolation — the same complaint Seemann lodged against .NET's `DependencyResolver`. Modern Go codebases respond with the scoped-Registry shape: an exported `Registry` struct passed through constructors, with the package-level Registry retained only for backward compatibility or for genuinely plugin-style APIs where the consumer cannot name the implementation set.

---

## 2. Go language mechanics

### 2.1 `init()` ordering

`init()` functions run in a deterministic order defined by the Go specification:

1. Package-level `var` declarations are evaluated first, in declaration order subject to initialisation-dependency reordering.
2. All `init()` functions within a package run next, in the order their source files are presented to the compiler (alphabetical by file name in the standard toolchain), and in declaration order within a file when multiple `init`s exist.
3. A package's `init()` runs only after every package it imports — direct or transitive — has finished its own initialisation.

For the Registry pattern this means: any code reachable from `main()` observes a fully populated Registry, provided every contributing package has been imported somewhere in the dependency graph. The producer's `init()` runs before the consumer's `main()` with no scheduling required.

### 2.2 Blank imports

`import _ "github.com/lib/pq"` brings the package's `init()` into the program without exposing its identifiers. This is the side-effect-only import; it exists in Go specifically to make Registry-style registration ergonomic. Without blank imports, a consumer would either need to call an explicit `pq.Init()` (which destroys the discoverability of the pattern) or import the package and accept an "imported but not used" compile error.

The blank import is non-transitive in intent — it documents to readers that the imported package is wanted for its side effects, not its API.

### 2.3 Package-level vars + Register pattern

The default Registry shape is a package-level map guarded by a mutex, exposed only through `Register` and lookup functions:

```go
var (
    mu        sync.RWMutex
    providers = map[string]Provider{}
)

func Register(name string, p Provider) { /* ... */ }
func Get(name string) (Provider, bool) { /* ... */ }
```

The map is unexported; mutation goes through `Register`; reads go through `Get`. The package itself owns the invariants (no duplicates, no nil values), which is how `database/sql` keeps its driver list from drifting into illegal states.

### 2.4 `sync.RWMutex` / `sync.Map`

A Registry is many-readers / few-writers in steady state — writes happen at startup, reads happen per request. `sync.RWMutex` is the canonical choice: `RLock` permits concurrent reads, `Lock` is rare. `sync.Map` becomes attractive only when reads happen on disjoint keys at very high contention (the per-key cache line stays warm); for the typical Registry with hundreds of keys and millions of reads, `RWMutex` wins on simplicity and predictability.

### 2.5 Generics typed Registry (Go 1.18+)

Pre-generics Registries stored `interface{}` and required type assertions on `Get`. Go 1.18 enabled a typed Registry:

```go
type Registry[K comparable, V any] struct {
    mu    sync.RWMutex
    items map[K]V
}

func (r *Registry[K, V]) Register(k K, v V) { /* ... */ }
func (r *Registry[K, V]) Get(k K) (V, bool) { /* ... */ }
```

The pattern is now a one-line instantiation per Registry shape — `Registry[string, Codec]`, `Registry[string, Factory[Store]]`, `Registry[reflect.Type, Handler]`. Stdlib registries pre-date generics and still use `interface{}`; new application Registries should reach for the generic form.

### 2.6 Panic vs error in Register

Registries diverge on whether `Register` returns an error or panics. The stdlib convention — `sql.Register`, `gob.Register`, `image.RegisterFormat`, `expvar.Publish` — is to panic on duplicate or nil because registration is a top-level wiring concern: if it fails, the program is misconfigured and cannot proceed. Library Registries that need to recover gracefully (Prometheus's `Registerer.Register`, gRPC's reflection server) return an error and pair it with a `Must`-prefixed wrapper that panics. The choice is part of the API contract and must be consistent across the package.

---

## 3. Canonical Go shapes

### 3.1 Implementation registry (Register/Get)

```go
type Codec interface {
    Encode(any) ([]byte, error)
    Decode([]byte) (any, error)
}

var (
    mu     sync.RWMutex
    codecs = map[string]Codec{}
)

func Register(name string, c Codec) {
    if c == nil { panic("codec: Register nil codec for " + name) }
    mu.Lock(); defer mu.Unlock()
    if _, dup := codecs[name]; dup {
        panic("codec: Register called twice for " + name)
    }
    codecs[name] = c
}

func Get(name string) (Codec, bool) {
    mu.RLock(); defer mu.RUnlock()
    c, ok := codecs[name]
    return c, ok
}
```

The simplest and most common Registry shape. Use when the registered value is a stateless, shareable, fully-constructed implementation.

### 3.2 Factory registry (Register/New)

```go
type Factory func(cfg Config) (Store, error)

var factories = map[string]Factory{}

func Register(name string, f Factory) { /* same as above */ }

func New(name string, cfg Config) (Store, error) {
    mu.RLock(); f, ok := factories[name]; mu.RUnlock()
    if !ok { return nil, fmt.Errorf("unknown store: %s", name) }
    return f(cfg)
}
```

Use when constructing the implementation needs configuration. The Registry stores constructors; the consumer calls `New` with a name plus the config payload and receives a fresh instance.

### 3.3 Handler registry (router)

```go
mux := http.NewServeMux()
mux.HandleFunc("/users", usersHandler)
mux.HandleFunc("/orders", ordersHandler)
```

`mux` is a Registry of pattern to handler. `HandleFunc` is the `Register` call; per-request routing is the `Get`. The dispatch happens per request rather than at startup, and the key is a pattern (longest-prefix or trie match) rather than an exact name.

### 3.4 Scoped Registry struct

```go
type CodecRegistry struct {
    mu     sync.RWMutex
    codecs map[string]Codec
}

func NewCodecRegistry() *CodecRegistry { /* ... */ }
func (r *CodecRegistry) Register(name string, c Codec) { /* ... */ }
func (r *CodecRegistry) Get(name string) (Codec, bool) { /* ... */ }
```

No package globals. The Registry is an instance passed through dependency injection or constructor wiring. Tests construct their own; production constructs one in `main`. Senior codebases prefer this shape when testability dominates over `import _` convenience.

### 3.5 Hot-reload Registry

```go
type Registry struct {
    mu      sync.RWMutex
    version uint64
    items   map[string]Plugin
}

func (r *Registry) ReplaceAll(next map[string]Plugin) {
    r.mu.Lock(); defer r.mu.Unlock()
    r.items = next
    r.version++
}
```

A whole-map swap rather than per-key mutation. Reads see a consistent snapshot; writes replace the snapshot atomically under the write lock. Variants use `atomic.Pointer[map[string]Plugin]` for lock-free reads. Used when plugins reload at runtime (Envoy filter chains, HashiCorp plugins, hot-deployable application servers).

### 3.6 Versioned Registry

```go
type Entry struct { Version int; Impl Codec }
var entries = map[string][]Entry{}

func Register(name string, version int, c Codec) { /* ... */ }
func Get(name string, version int) (Codec, bool) { /* ... */ }
func Latest(name string) (Codec, bool) { /* ... */ }
```

When the registered implementation has a version axis — wire-protocol revisions, schema migrations, codec generations — the Registry becomes a two-level map of `name → version → impl`. The lookup API exposes both pinned (`Get(name, version)`) and latest (`Latest(name)`) reads. The pattern appears in long-lived RPC frameworks and database driver compatibility layers where multiple implementations must coexist during a rollout.

---

## 4. Standard library use

### 4.1 `database/sql.Register`

The reference Registry. `sql.Register(name string, driver driver.Driver)` panics on duplicate name or nil driver. Drivers (`lib/pq`, `mattn/go-sqlite3`) call it from `init()`. Consumer code uses `sql.Open(name, dsn)` which performs the lookup. The pattern is so canonical that "Go SQL driver" and "thing that calls sql.Register" are synonymous.

### 4.2 `image.RegisterFormat`

`image.RegisterFormat(name, magic string, decode func(io.Reader) (Image, error), decodeConfig func(io.Reader) (Config, error))`. The magic string is matched against the prefix of the input stream; `image.Decode(r)` peeks the first bytes, dispatches to the matching decoder. Blank-importing `image/png`, `image/jpeg`, `image/gif` adds support for those formats without the consumer's code naming them.

### 4.3 `encoding/gob.Register`

`gob.Register(value any)` records a concrete type under its name so the gob decoder can resurrect interface values. The Registry is keyed by name string; the value is a `reflect.Type` derived from the registered example. Required whenever a gob stream carries an `interface{}` that decodes back to a concrete type.

### 4.4 `expvar.Publish`

`expvar.Publish(name string, v Var)` adds a named exposed variable to the `/debug/vars` endpoint. Duplicates panic. The total implementation is roughly fifty lines of code; it is the smallest illustrative Registry in the standard library and a good reading exercise.

### 4.5 `http.DefaultServeMux`

Package-level Registry of URL patterns to handlers. `http.HandleFunc`, `http.Handle`, and `http.ListenAndServe(addr, nil)` all touch this global. The pattern is criticised in production because the global is hidden — tests that import packages with side-effect `http.HandleFunc` registrations leak handlers between tests. The convention in modern code is to construct an explicit `http.NewServeMux()` and avoid the default.

---

## 5. Real library use

### 5.1 `prometheus.MustRegister`

`prometheus.MustRegister(collectors ...prometheus.Collector)` adds collectors to the default Registry; panics on duplicate descriptors. The `client_golang` library exposes both a global `DefaultRegisterer` and a scoped `NewRegistry()` constructor — the hybrid shape — and the convention in modern Prometheus instrumentation is to use the scoped form for libraries and the global for application top-level wiring.

### 5.2 `cobra` commands

Each `*cobra.Command` is registered with a parent via `parent.AddCommand(child)`. The CLI tree is a hierarchical Registry of command names to handlers. Dispatch is by argv prefix matching: `myapp users list` walks the registry tree `users → list` and invokes the leaf's `Run` function.

### 5.3 `gorilla/mux`

A richer handler Registry than `http.ServeMux`: routes are registered with method, host, header, and path constraints, and matching is via ordered trial of registered routes. The Registry is per-`*mux.Router` instance (scoped, not global), which is part of why gorilla/mux is preferred in larger applications over the default mux.

### 5.4 `hashicorp/go-plugin`

Out-of-process plugins communicating over gRPC; each plugin process registers itself with the host via a handshake. The Registry is split across processes: the host knows the plugin's gRPC service name; the plugin's `init()` registers its concrete implementation with the gRPC server. The library handles plugin lifecycle (start, restart, kill) so the Registry has a notion of liveness that in-process Registries do not.

### 5.5 gRPC service registrar

```go
server := grpc.NewServer()
pb.RegisterUserServiceServer(server, &userServer{})
```

The generated `RegisterUserServiceServer` is a thin wrapper around the gRPC server's internal Registry of service-name to handler-table. Per-RPC dispatch consults this Registry. Each `*grpc.Server` is a scoped Registry; there is no global gRPC Registry, which is one of the reasons gRPC code is easy to test in isolation.

### 5.6 `encoding/json` and `mapstructure` decoder hooks

`mapstructure.DecodeHookFunc` and similar JSON decoder hook lists are Registries of `(source-type, target-type) → conversion function`. The library iterates the registered hooks on each field; the first matching hook wins. The Registry is per-decoder-instance rather than global, which makes it composable across services with different schema needs.

### 5.7 `viper` configuration providers

The `spf13/viper` library maintains a Registry of remote-config providers keyed by name (`etcd`, `consul`, `firestore`). Each provider registers via `viper.RemoteConfig` interface; user code calls `viper.AddRemoteProvider(provider, endpoint, path)` to wire one. The pattern is the same as `database/sql`: a name string, a side-effect blank import, and a global lookup.

---

## 6. Formal specification

A Go Registry consists of:

| Element | Description |
|---------|-------------|
| **Registry** | A keyed container that maps an identifier to a registered value; usually a `map` plus a mutex, exposed only through `Register` and lookup functions. |
| **Key** | A `comparable` identifier — most commonly a `string` name; occasionally a `reflect.Type`, an integer enum, or a struct of selectors. |
| **Value / Impl** | The registered thing: an interface satisfier, a factory function, a handler, a description record. |
| **Register fn** | The mutation entry point; takes `(key, value)`; enforces invariants (nil-check, duplicate-check) by panic or returned error. |
| **Get fn** | The lookup entry point; returns `(value, ok)` or `(value, error)`; never panics on miss. |
| **Names fn** | Optional but recommended; returns a sorted slice of registered keys for diagnostics and debugging. |
| **Mutex** | Guards the underlying map; `sync.RWMutex` is the default; `sync.Map` for very high read contention on disjoint keys. |

**Invariants:**

1. **At most one entry per key.** A second `Register(name, v)` for the same name either panics, returns an error, or replaces the prior entry — never silently appends. The stdlib convention is to panic; library Registries diverge based on whether reload semantics are wanted.
2. **No nil values.** `Register(name, nil)` is rejected at the entry point; nil in the Registry is a defect that surfaces only at lookup time, which is too late to be useful for diagnosis.
3. **Consumer never mutates the underlying map.** `Names()` returns a copy; `Get` returns the stored interface value; the map is never exposed. Consumers must not be able to insert, delete, or rename entries.
4. **Initialisation completes before first read.** Every contributing package's `init()` runs before `main()`; the Registry is therefore fully populated before any handler, request, or query can hit it. Lazy registration is permitted but requires the same lock discipline as reads.
5. **The mutex protects every read and every write.** Even a read that never races in practice must take the lock; otherwise the race detector reports a data race against a concurrent `Register`, and the program is formally undefined.

Together these invariants reduce the Registry to a single-writer-many-readers map with a published-set contract. All correctness reasoning about Registry code reduces to checking these five conditions.

**Lifecycle states:**

| State | Description | Transition |
|-------|-------------|------------|
| **Empty** | Registry constructed; no entries; reads return `(_, false)`. | A successful `Register` moves it to Populated. |
| **Populated** | Steady state; one or more entries; reads return `(value, true)` for known keys. | Further `Register` calls add entries; replacements move it to Replaced (hot-reload) or panic (strict). |
| **Frozen** | Optional terminal state; further `Register` returns an error or panics. | None; once frozen, mutations are rejected. Used in test harnesses to detect late registrations. |

Most stdlib Registries occupy only Empty and Populated; the Frozen state is an application-level discipline, often realised by a `Freeze()` method or by hiding `Register` after `main()`'s top-of-function `Register` block.

---

## 7. Anti-patterns

### 7.1 Silent duplicate registration

A `Register` that silently overwrites a prior entry hides bugs where two packages claim the same name. The second registration wins non-deterministically based on import order, and the first package's implementation vanishes without a log line. The failure mode is the worst kind: production behaves correctly under one build order and incorrectly under another, with no diagnostic at registration time. **Fix:** panic on duplicate or return an error; choose one and apply it consistently across the codebase.

### 7.2 No nil check on Register

`Register("foo", nil)` succeeds; `Get("foo")` returns a non-nil `(value, true)` whose underlying interface value is nil. The first method call panics with a nil pointer dereference far from the point of registration. The interface-nil-vs-typed-nil confusion compounds the problem: a `var d *Driver` passed into `Register("pq", d)` registers a non-nil interface wrapping a nil pointer, which passes a naive `if c == nil` check but still fails on method dispatch. **Fix:** panic at `Register` time on nil values, and document the typed-nil pitfall in the package docs.

### 7.3 Mutating the returned map

```go
func Map() map[string]Codec { return codecs } // bug: shares the live map
```

The consumer can now insert, delete, or rename entries, bypassing the lock and breaking every other reader. **Fix:** return a copy from `Map()`, or expose only `Get`, `Names`, and iteration helpers.

### 7.4 Runtime registration in hot path

```go
func Handle(req Request) {
    if _, ok := Get(req.Type); !ok {
        Register(req.Type, defaultHandler) // mutates under read load
    }
}
```

Per-request mutation forces the write lock onto the hot path; throughput collapses. The pattern almost always indicates a missing startup registration. **Fix:** register at startup; treat the Registry as effectively read-only after `main()` begins.

### 7.5 `reflect.Type` key for serialised data

A Registry keyed by `reflect.Type` is fine in-memory but breaks the moment data crosses a process boundary: renaming the type, moving its package, or running an older build with a different type identity all break the key. **Fix:** use a stable string identifier (`"v1.UserCreated"`) for any key that persists or crosses the wire.

### 7.5b Registry exposed as a global mutable map

```go
var Codecs = map[string]Codec{} // exported map: any consumer can mutate
```

Exporting the underlying map gives every consumer write access without going through `Register`. Concurrent mutations race, invariants drift, and the lock — if any — is bypassed entirely. **Fix:** keep the map unexported; expose only `Register`, `Get`, and `Names`. If a consumer wants to iterate, provide a `Range(func(key, value) bool)` method that takes the read lock internally.

### 7.6 Registry as a DI container

```go
container.Register("logger", log.Default())
container.Register("db", openDB())
container.Register("svc", &Service{Log: container.Get("logger"), DB: container.Get("db")})
```

The Service Locator antipattern Seemann named. Dependencies are no longer documented in `Service`'s signature; reviewers cannot tell what `Service` needs without reading its body. **Fix:** inject dependencies through constructors and function parameters; reserve Registry for true plugin-style discovery (drivers, codecs, formats) where the consumer genuinely does not know the implementation set at compile time.

### 7.7 `init()` side effects beyond Register

```go
func init() {
    Register("pq", &Driver{})
    go startBackgroundReconnector()  // bug: spawns work at import time
    log.Printf("pq driver loaded")    // bug: log line nobody asked for
}
```

`init()` must do exactly one thing: register. Spawning goroutines, opening files, dialling networks, or logging from `init()` couples the consumer's startup to invisible side effects of every blank-imported dependency. The cumulative effect across a binary with dozens of blank-imported providers is unbounded startup latency, goroutine leaks, and log noise that nobody can attribute. **Fix:** keep `init()` to `Register` calls only; defer everything else to lazy first-use or explicit `Init()` functions the consumer chooses to call.

---

## 8. Variants and dialects

| Variant | Description |
|---------|-------------|
| **Implementation registry** | Stores pre-built, shareable implementations under a name; consumer calls `Get(name)` and uses the returned interface directly. Canonical: `database/sql`. |
| **Factory registry** | Stores constructor functions; consumer calls `New(name, cfg)` to receive a fresh instance built with the supplied config. Canonical: cloud SDK client factories. |
| **Handler registry** | Stores callbacks dispatched per event; the Registry is consulted on every incoming event rather than at startup. Canonical: HTTP routers, gRPC servers. |
| **Scoped registry** | Registry is an instance type (`*Registry`), not a package-global; passed through DI. Preferred when testability outweighs blank-import convenience. |
| **Hot-reload registry** | The set of registrations may change at runtime; readers see consistent snapshots via lock-free atomic pointer swap or RWMutex with whole-map replacement. |
| **Distributed registry** | Registrations live in an external store (etcd, Consul, ZooKeeper); local code observes via watch streams. The Registry is now a coordination problem, not a data-structure problem; service discovery is its most familiar instance. |
| **Hierarchical registry** | Keys form a tree (`commands.users.list`); lookups walk the tree by path segments. Cobra's command tree and OpenTelemetry's instrumentation namespace are the canonical examples. |
| **Tagged registry** | Each entry carries metadata tags; lookups can filter on tags as well as match on key. Useful for collector Registries (`metrics with tag="auth"`) and middleware chains where ordering depends on a registered priority. |

---

## 9. Naming conventions

- **`Register(name, value)`** — the standard mutation entry point. Panics on duplicate or nil are conventional in stdlib-style packages; returning an error is conventional in library-style packages where the caller can recover.
- **`MustRegister(...)`** — Prometheus convention: a variant that panics on error so it can be called as a top-level package declaration `var _ = MustRegister(...)`. Pair with a non-panicking `Register` that returns an error for callers who need to handle it.
- **`Get(name) (V, bool)`** — the standard lookup. The `bool` second return is preferred over a sentinel zero value because it disambiguates "registered with the zero value" from "not registered".
- **`New(name, cfg) (V, error)`** — factory-registry construction entry; the `error` covers both "unknown name" and "factory failed".
- **`Names() []string`** — diagnostic enumeration. Returns a sorted copy; never the live map. Worth adding to every Registry — the cost is twenty lines, the debugging payoff is large.
- **`Drivers()`, `Codecs()`, `Formats()`** — stdlib precedent for domain-specific enumeration verbs. `sql.Drivers()`, `image.RegisterFormat`'s peer `image.Decode`'s implicit list, and similar APIs use the registered-thing's plural noun rather than a generic `Names`.
- **Package layout** — registration entry points live next to the package's main type; the underlying map and mutex are unexported; the package's `init()` (if any) calls `Register` for the package's own provided implementations, not anyone else's. The driver-style package (`lib/pq`, `mattn/go-sqlite3`) reverses this: its `init()` calls into a parent package's Registry rather than its own.
- **`Default` instance** — the hybrid pattern's name for the package-level singleton Registry, exported so tests can replace it: `codec.Default = NewCodecRegistry()`. The convention pairs `Default` with a constructor `NewCodecRegistry()` and top-level package functions that delegate to `Default`.

---

## 10. Related patterns

| Pattern | Distinction |
|---------|-------------|
| **Service Locator** | A Registry of all dependencies a program needs; criticised because it hides dependencies from caller signatures. Registry is bounded (plugin-style); Service Locator is open-ended (every dependency). The line between them is one of scope, not mechanism. |
| **Factory** | Produces instances; pairs naturally with a factory Registry where the factory itself is the registered value. A Registry without factories stores pre-built singletons; a Registry of factories stores constructors. |
| **Plugin** | A unit of code loaded dynamically; a Plugin system is a Registry plus a discovery mechanism (filesystem scan, classpath, `dlopen`). Go's `plugin` package is the in-process variant; `hashicorp/go-plugin` is the out-of-process variant. |
| **Dependency Injection** | Caller's dependencies are passed into its constructor; opposes Service Locator. DI and Registry coexist: DI wires the application graph; Registry is one of the leaf nodes where pluggable implementations live. |
| **Strategy** | Encapsulates an interchangeable algorithm; a Registry of strategies is the natural way to make them runtime-selectable by name (`strategies.Get("aes-gcm")`). |
| **Singleton** | A Registry is often a singleton — a single package-level instance. The Singleton enforces uniqueness; the Registry uses that uniqueness to be the canonical lookup table. Tests that need to escape the singleton reach for the scoped variant. |
| **Observer** | An Observer maintains a list of subscribers to notify on events; a handler Registry is an Observer-like Registry where the "event" is a dispatch key and only the matching handler is invoked. The shapes share the map-of-callbacks structure but differ in dispatch policy. |
| **Chain of Responsibility** | A list of handlers tried in order until one accepts; if the Registry stores a slice rather than a map and iterates on lookup, it becomes Chain of Responsibility. Middleware chains and `gorilla/mux` route tables sit on this boundary. |

---

## 11. Further reading

- **Martin Fowler, *Patterns of Enterprise Application Architecture* (Addison-Wesley, 2002)** — the source of the Registry pattern name; chapter on Registry plus the surrounding discussion of session vs process scope.
- **Mark Seemann, *Dependency Injection in .NET* (Manning, 2010)** — the definitive critique of Service Locator as antipattern and the framework for deciding when Registry is and is not appropriate.
- **Go standard library source: `database/sql/sql.go`** — the reference Go Registry implementation; under 100 lines for the driver-registration portion; reading it is the fastest way to internalise the canonical shape.
- **`prometheus/client_golang` source** — production-grade Registry with both global and scoped variants, descriptor uniqueness enforcement, and an interface-based collector model.
- **`hashicorp/go-plugin` documentation and source** — Registry semantics across process boundaries; protocol versioning; plugin lifecycle; the most complete Registry-plus-plugin system in the Go ecosystem.
- **`golang.org/ref/spec#Package_initialization`** — the language specification on `init()` ordering; required reading before designing any `init()`-driven registration scheme.
- **Eclipse OSGi Service Platform Specification** — the most ambitious Registry-and-plugin system in industry use; instructive for the cost of going all the way to runtime install/uninstall.
- **Sameer Ajmani, *Go Concurrency Patterns* (Google I/O 2012)** — although focused on channels, the talk's treatment of package-level state and `init()` discipline is the cleanest articulation of why Go pushes Registries into startup-time wiring rather than runtime configuration.
- **`grpc/grpc-go` source: `server.go`** — production-grade scoped Registry with per-server service maps, descriptor validation, and reflection support; an excellent counter-example to the global-default-Registry pattern stdlib uses elsewhere.

**Observability and Registries.**

A Registry is invisible to production debugging unless instrumented. The minimum useful telemetry:

- A log line per `Register` call at startup, naming the key and the registering package (recovered via `runtime.Caller`).
- A counter `registry_lookups_total{registry, key, outcome}` with `outcome` in `{hit, miss}` incremented per `Get` call.
- A startup-only diagnostic endpoint (`/debug/registry`) that returns `Names()` for every Registry the binary owns.
- A panic recovery that names the offending Registry when `Register` rejects a duplicate or nil — the default panic message is often too sparse to identify which Registry failed in a binary that has dozens.

Without these, a misregistered driver surfaces only as a runtime `unknown driver: pq` error far from the failed `Register` call, and the user is left guessing whether the blank import was missing, the registration panicked silently, or the build excluded the file.

**On choosing the right shape.** Reach for an implementation Registry when the stored value is stateless and shareable; reach for a factory Registry when construction needs config; reach for a handler Registry when dispatch is per-event. Reach for a scoped Registry struct when tests need isolation; reach for a package-level Registry only when the blank-import-driven plugin discovery is genuinely the API you want. Reach for a hot-reload variant only when uptime requirements rule out a restart-to-reconfigure model — the additional invariants around snapshot consistency and consumer cache invalidation triple the implementation cost.

The senior calculus for any Registry-shaped problem in Go:

1. Can this be a `switch` or `map` literal? If yes, skip the Registry entirely.
2. Can this be a small package-level map with `Register` / `Get`? If yes, use it; mirror `database/sql`.
3. Do tests need isolation? Promote to a scoped `*Registry` struct passed via constructor.
4. Does the implementation set change at runtime? Add the atomic-snapshot variant and accept the additional discipline.
5. Are registrations crossing process boundaries? You are now in service-discovery territory; reach for etcd, Consul, or your platform's equivalent rather than rolling your own.

Registry in Go is the most underestimated pattern: it's how the standard library lets you wire pluggable implementations without your consumers ever importing them. Senior skill is choosing scoped over global when test pressure outweighs init-import convenience.

---

## 12. Glossary

| Term | Meaning |
|------|---------|
| **Registry** | A keyed container that maps identifiers to registered values; exposed through controlled `Register` and lookup functions, never as a raw map. |
| **Register** | The mutation entry point that adds a `(key, value)` pair to the Registry; enforces invariants like no-duplicates and no-nil at the boundary. |
| **Lookup** | The read entry point — usually `Get(name) (V, bool)` — that returns the registered value for a given key without exposing the underlying map. |
| **Blank import** | `import _ "path/to/pkg"`; imports a package solely to run its `init()` side effects, including any `Register` calls it contains. |
| **`init()`** | A parameterless, return-less function run automatically once per package after var initialisation and before `main()`; the standard hook for self-registration. |
| **Factory** | A constructor function registered under a name; the consumer calls the factory at `New(name, cfg)` time to receive a fresh instance with configuration applied. |
| **Plugin** | A unit of code — in-process via `plugin.Open`, or out-of-process via `hashicorp/go-plugin` — that registers its implementations with the host's Registry during its startup handshake. |
| **Service Locator** | An open-ended Registry of arbitrary dependencies; criticised because it hides what callers need behind a generic lookup API. The line between Service Locator and legitimate Registry is bounded scope. |
| **Hot reload** | A Registry that can change its registrations at runtime; readers must see consistent snapshots, typically via lock-free atomic pointer swap or RWMutex with whole-map replacement. |
| **Default registry** | The package-level singleton Registry exposed by `Register` and `Get` top-level functions; convenient for blank-import wiring, awkward for tests; the hybrid pattern pairs a default with a scoped constructor for test isolation. |
| **Magic prefix / Sniffing** | A Registry lookup keyed by a content-derived value (image magic bytes, HTTP `Content-Type`); the lookup peeks the input and dispatches to the matching registered handler. `image.RegisterFormat` is the stdlib example. |
| **Provider / SPI** | Older-language vocabulary for the registered thing (Java SPI: Service Provider Interface). In Go, providers are concrete types satisfying an interface; the Registry stores instances rather than class objects. |
| **Side-effect import** | The blank-import idiom; an import whose only purpose is to run the imported package's `init()` and thereby trigger its `Register` calls. The compiler still tracks the dependency for build ordering. |
