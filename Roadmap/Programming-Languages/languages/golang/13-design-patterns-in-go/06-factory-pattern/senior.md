# Factory Pattern — Senior

## 1. What this level covers

Junior taught the shape; middle covered registries, options, and lifecycle. Senior is about *architectural decisions*:

- Factory design in DI containers and code generators (`wire`, `dig`).
- Factory in plugin architectures.
- Cross-package factory contracts and how they evolve.
- Hot-reload factories (`atomic.Pointer`-driven swap).
- Real ecosystems: `database/sql.Open` + driver registration, `image.Decode` + format registration, `http.Client`, `slog.NewLogger`.
- Anti-patterns at scale: god factories, hidden globals, registry races.
- Concurrency around factory state.
- Performance characteristics.
- Postmortems with real failure modes.

---

## 2. Table of Contents

1. [What this level covers](#1-what-this-level-covers)
2. [Table of Contents](#2-table-of-contents)
3. [Factory in dependency injection](#3-factory-in-dependency-injection)
4. [Code generation: google/wire](#4-code-generation-googlewire)
5. [Runtime DI: uber-go/dig](#5-runtime-di-uber-godig)
6. [Factory in plugin architectures](#6-factory-in-plugin-architectures)
7. [Cross-package factory contracts](#7-cross-package-factory-contracts)
8. [Hot-reload factories](#8-hot-reload-factories)
9. [Factory in distributed systems](#9-factory-in-distributed-systems)
10. [API evolution: adding parameters non-breakingly](#10-api-evolution-adding-parameters-non-breakingly)
11. [Real ecosystems](#11-real-ecosystems)
12. [Anti-patterns at scale](#12-anti-patterns-at-scale)
13. [Concurrency in registration and lookup](#13-concurrency-in-registration-and-lookup)
14. [Performance considerations](#14-performance-considerations)
15. [Postmortems](#15-postmortems)
16. [Cross-language comparison](#16-cross-language-comparison)
17. [Common senior mistakes](#17-common-senior-mistakes)
18. [Tricky questions](#18-tricky-questions)
19. [Cheat sheet](#19-cheat-sheet)
20. [Further reading](#20-further-reading)

---

## 3. Factory in dependency injection

In a sufficiently large application, *manual* factory wiring becomes a chore:

```go
func main() {
    logger := log.New(os.Stdout, "", 0)
    metrics := metrics.New(logger)
    db, _ := sql.Open("postgres", dsn)
    repo := repo.New(db, logger, metrics)
    auth := auth.New(repo, logger)
    server := server.New(repo, auth, logger, metrics)
    server.Run()
}
```

Five layers of factory calls. Adding a new dependency means threading it through every constructor that uses it. The wiring code grows quadratically with the number of components.

Dependency injection containers automate the wiring. The two dominant Go libraries:

- **`google/wire`** — compile-time DI. Generates Go code that performs the wiring.
- **`uber-go/dig`** — runtime DI. Uses reflection to wire dependencies at startup.

Both work by treating constructors as factories. The container's job is to call them in the right order with the right arguments.

---

## 4. Code generation: google/wire

`wire` reads a *wire file* and generates the wiring code at build time:

```go
//go:build wireinject

package main

import "github.com/google/wire"

func InitializeServer() (*Server, error) {
    wire.Build(
        log.New,
        metrics.New,
        sql.Open,
        repo.New,
        auth.New,
        server.New,
    )
    return nil, nil
}
```

Running `wire` generates `wire_gen.go` containing the explicit factory chain. No reflection at runtime — the cost is paid once at compile time.

### 4.1 Why compile-time DI matters

- **Zero runtime overhead.** The generated code is identical to what you'd write by hand.
- **Compile errors for missing dependencies.** If you forget to provide a `*sql.DB`, the generator complains, not a runtime initialization.
- **Generated code is reviewable.** You can read what wire produced and verify the wiring.

### 4.2 When `wire` shines

Large applications with many components, where manual wiring would be 200+ lines of `main()`. The generator pays for itself.

### 4.3 When it doesn't

Small applications. The setup (wire.go, generated files, build step) isn't worth it for 5-10 dependencies.

---

## 5. Runtime DI: uber-go/dig

`dig` resolves dependencies at runtime using reflection:

```go
c := dig.New()
c.Provide(log.New)
c.Provide(metrics.New)
c.Provide(func() (*sql.DB, error) { return sql.Open("postgres", dsn) })
c.Provide(repo.New)
c.Provide(auth.New)
c.Provide(server.New)

c.Invoke(func(s *Server) { s.Run() })
```

`dig` sees each factory's signature, figures out the dependency graph, and calls the factories in the right order.

### 5.1 Pros and cons

**Pros:** No code generation step. More flexible — you can register factories conditionally.

**Cons:**
- Reflection cost at startup (usually fine).
- Errors surface at runtime, not compile time.
- The dependency graph is implicit — hard to understand without tooling.

### 5.2 dig vs wire

| Aspect | `wire` | `dig` |
|--------|--------|-------|
| Runtime cost | Zero | Reflection at startup |
| Build step | Required | None |
| Errors caught at | Compile time | Runtime |
| Conditional providers | Awkward | Natural |
| Used by | gRPC for Go internals | Uber services |

Both are mature; pick by team preference and runtime tolerance.

---

## 6. Factory in plugin architectures

Plugin systems require factories because the host doesn't know which plugins exist:

```go
// host
type Plugin interface {
    Name() string
    Run(ctx context.Context) error
}

type PluginFactory func(config map[string]any) (Plugin, error)

var registry = map[string]PluginFactory{}

func Register(name string, f PluginFactory) {
    registry[name] = f
}

// plugin package
func init() {
    host.Register("metrics-exporter", func(cfg map[string]any) (host.Plugin, error) {
        return &metricsPlugin{cfg: cfg}, nil
    })
}
```

The host loads plugins by name. Each plugin's `init()` registers itself. The host doesn't import plugin packages directly; build-time linking does the work.

### 6.1 Hashicorp go-plugin

For *out-of-process* plugins, `hashicorp/go-plugin` runs each plugin as a separate process communicating over gRPC. The host's factory is "spawn a subprocess and connect":

```go
func NewPlugin(cmd string) (Plugin, error) {
    client := plugin.NewClient(&plugin.ClientConfig{
        Cmd:             exec.Command(cmd),
        HandshakeConfig: handshakeConfig,
        Plugins:         pluginMap,
    })
    rpcClient, err := client.Client()
    if err != nil { return nil, err }
    raw, err := rpcClient.Dispense("plugin")
    if err != nil { return nil, err }
    return raw.(Plugin), nil
}
```

The factory hides the IPC complexity. Callers see a `Plugin` interface; the implementation could be in-process or out-of-process.

---

## 7. Cross-package factory contracts

When package A defines an interface and package B provides factories, who owns the contract?

**Rule:** the *consumer* owns the interface. `database/sql` defines `Driver`, `Conn`, `Stmt`; drivers (`pq`, `pgx`, `mysql`) implement them. The drivers don't define their own interfaces.

```go
// consumer (database/sql)
type Driver interface {
    Open(name string) (Conn, error)
}

// implementer (pq)
type Driver struct{}
func (Driver) Open(name string) (driver.Conn, error) { /* ... */ }

func init() {
    sql.Register("postgres", &Driver{})
}
```

This is *the* rule for cross-package factory ecosystems. Consumer interfaces drive evolution; implementations follow.

### 7.1 What this enables

- Adding new drivers without modifying `database/sql`.
- Stdlib never imports third-party code.
- Tests can register a fake driver alongside the real ones.

### 7.2 Common mistake

Defining the factory contract in the *implementation* package:

```go
// in package pq
type Factory interface {
    NewConnection(dsn string) (Conn, error)
}
```

Now every consumer must import `pq` to satisfy this interface. The ecosystem can't grow without coupling to one implementation.

---

## 8. Hot-reload factories

Some applications swap the constructed instance at runtime — config reload, certificate rotation, A/B routing. The pattern: a factory that produces and an `atomic.Pointer` that holds the current instance.

```go
type Service struct{ /* ... */ }

type ServiceContainer struct {
    current atomic.Pointer[Service]
    factory func() (*Service, error)
}

func NewContainer(factory func() (*Service, error)) (*ServiceContainer, error) {
    c := &ServiceContainer{factory: factory}
    initial, err := factory()
    if err != nil { return nil, err }
    c.current.Store(initial)
    return c, nil
}

func (c *ServiceContainer) Get() *Service {
    return c.current.Load()
}

func (c *ServiceContainer) Reload() error {
    next, err := c.factory()
    if err != nil { return err }
    old := c.current.Swap(next)
    // optionally drain `old`
    return nil
}
```

The `atomic.Pointer.Swap` is non-blocking. Readers always see *either* the old or the new instance — never a torn read.

### 8.1 Drain semantics

What happens to the old instance after a swap? Three options:

- **Discard.** The garbage collector reclaims when no goroutine holds a reference. Simple, but in-flight operations finish on the old instance.
- **Drain.** Track in-flight uses (via `sync.WaitGroup` per instance) and wait before closing.
- **Two-phase.** Swap, then close the old one after a grace period.

Most applications go with discard. The complexity of drain rarely pays off.

---

## 9. Factory in distributed systems

In a multi-region or multi-tenant system, factories produce *instance-per-region* or *instance-per-tenant* objects.

```go
type RegionClient struct{ /* ... */ }

type ClientFactory struct {
    mu      sync.RWMutex
    clients map[string]*RegionClient // keyed by region
}

func (f *ClientFactory) Get(region string) (*RegionClient, error) {
    f.mu.RLock()
    c, ok := f.clients[region]
    f.mu.RUnlock()
    if ok { return c, nil }

    f.mu.Lock()
    defer f.mu.Unlock()
    if c, ok := f.clients[region]; ok { return c, nil }  // double-check
    c, err := newRegionClient(region)
    if err != nil { return nil, err }
    if f.clients == nil { f.clients = make(map[string]*RegionClient) }
    f.clients[region] = c
    return c, nil
}
```

The factory caches the constructed clients. First request per region pays the construction cost; subsequent requests get the cached client.

The double-checked locking (with proper `sync.RWMutex`) is correct here because the map write happens under the full lock.

---

## 10. API evolution: adding parameters non-breakingly

Factories with growing parameter lists are a common pain. Three strategies for non-breaking addition.

### 10.1 Functional options

```go
// v1
func New(addr string) *Server

// v2 — add WithTimeout via options
func New(addr string, opts ...Option) *Server
```

Existing callers still work. New behaviour is opt-in.

### 10.2 Variadic config struct

```go
// v1
func New(addr string) *Server

// v2 — accept Config struct
func New(addr string, cfg ...Config) *Server

type Config struct {
    Timeout time.Duration
    Logger  *log.Logger
}
```

Callers can pass zero or one Config. Adding fields to Config is non-breaking.

### 10.3 Build a new constructor

```go
// v1 stays unchanged
func New(addr string) *Server { /* ... */ }

// v2 introduces a new constructor
func NewWithLogger(addr string, log *log.Logger) *Server { /* ... */ }
```

Two factories for two use cases. Cleaner but multiplies surface area.

Use §10.1 by default. §10.3 for major API shifts. Avoid §10.2 — variadic *single-element* slices look fine until someone passes two by accident.

---

## 11. Real ecosystems

### 11.1 database/sql + drivers

```go
// stdlib
type Driver interface {
    Open(name string) (Conn, error)
}
func Register(name string, d Driver) { /* ... */ }
func Open(driverName, dataSourceName string) (*DB, error) { /* ... */ }

// driver
func init() { sql.Register("postgres", &pgxDriver{}) }
```

The canonical Go factory ecosystem. Stdlib provides the *contract*; drivers register implementations. Adding a new driver doesn't modify stdlib.

### 11.2 image.Decode + RegisterFormat

```go
func RegisterFormat(name, magic string, decode func(io.Reader) (Image, error), decodeConfig func(io.Reader) (Config, error))
```

The `image` package uses magic-byte sniffing to pick the decoder. Each format (`gif`, `jpeg`, `png`, `webp`) registers itself with magic bytes and a decoder function. `image.Decode` reads the magic bytes, dispatches.

The "factory" here is a registry of `decode func`s, plus magic-byte detection.

### 11.3 http.Client

```go
type Client struct {
    Transport     RoundTripper
    CheckRedirect func(req *Request, via []*Request) error
    Jar           CookieJar
    Timeout       time.Duration
}
```

`http.Client` isn't constructed by a single factory — it's a struct with public fields. Why? Because the configuration *is* the client. There's no defaulting or hidden setup.

This is the *anti-factory* pattern: when construction is trivial, don't add a factory. Junior §11 covered this; senior is recognising it in the wild.

### 11.4 slog.Handler

```go
type Handler interface {
    Enabled(context.Context, Level) bool
    Handle(context.Context, Record) error
    WithAttrs(attrs []Attr) Handler
    WithGroup(name string) Handler
}

func NewTextHandler(w io.Writer, opts *HandlerOptions) *TextHandler { /* ... */ }
func NewJSONHandler(w io.Writer, opts *HandlerOptions) *JSONHandler { /* ... */ }
```

The stdlib provides two concrete factories. Third-party handlers (zap-slog adapter, opentelemetry-slog) register their own. The Handler interface is the contract; factories produce implementations.

---

## 12. Anti-patterns at scale

### 12.1 The god factory

A `NewService()` that takes 20+ parameters and constructs five sub-components. By year two, no one remembers what each parameter does.

**Fix:** split into smaller factories. Each constructor takes 1-3 parameters; the orchestration moves to `main()` or a DI container.

### 12.2 Hidden globals

A factory that reads environment variables, opens files, or calls package-level state:

```go
func NewClient() *Client {
    return &Client{apiKey: os.Getenv("API_KEY")}
}
```

Tests can't isolate. Subtle production bugs depend on environment.

**Fix:** pass dependencies explicitly. `func NewClient(apiKey string) *Client`.

### 12.3 Registry without mutex

```go
var registry = map[string]Factory{}

func Register(name string, f Factory) {
    registry[name] = f  // race
}
```

Two goroutines registering simultaneously → data race. Always protect registry mutations.

### 12.4 Init-order surprises

```go
// pkg a:
var def = registry.Get("default")  // package-level var init

// pkg b:
func init() {
    registry.Register("default", &myImpl{})
}
```

If `a` imports `b`, Go runs `b`'s init *before* `a`'s package-level vars. But within a single package, init runs *after* var initialization. Mixing the two creates ordering puzzles.

**Fix:** put dependent initialization in `init()` functions, not var declarations.

### 12.5 Eager construction

```go
func NewStorage(kind string, cfg Config) (Storage, error) {
    s3 := newS3(cfg.S3)         // always constructed
    disk := newDisk(cfg.Disk)   // always constructed
    mem := newMem()             // always constructed
    switch kind {
    case "s3": return s3, nil
    case "disk": return disk, nil
    case "memory": return mem, nil
    }
    return nil, errors.New("unknown")
}
```

If S3 setup fails, the factory fails — even when the user wanted disk storage. Construct only what you return.

---

## 13. Concurrency in registration and lookup

The classic registry pattern:

```go
var (
    mu        sync.RWMutex
    factories = map[string]Factory{}
)

func Register(name string, f Factory) {
    mu.Lock()
    defer mu.Unlock()
    if _, dup := factories[name]; dup {
        panic("duplicate registration: " + name)
    }
    factories[name] = f
}

func Lookup(name string) (Factory, bool) {
    mu.RLock()
    defer mu.RUnlock()
    f, ok := factories[name]
    return f, ok
}
```

Three rules:

1. **Read-heavy.** After startup, lookups dominate registrations. `RWMutex` is correct.
2. **Panic on duplicate.** A duplicate registration is a programmer error; surface immediately.
3. **No update path.** Once registered, factories don't change. If you need hot-swap, that's `atomic.Pointer`, not registry mutation.

### 13.1 Lock-free alternative

For very read-heavy registries, `atomic.Pointer[map[string]Factory]` enables lock-free lookup at the cost of copy-on-write registration:

```go
var registry atomic.Pointer[map[string]Factory]

func Register(name string, f Factory) {
    for {
        old := registry.Load()
        var newMap map[string]Factory
        if old != nil {
            newMap = make(map[string]Factory, len(*old)+1)
            for k, v := range *old { newMap[k] = v }
        } else {
            newMap = make(map[string]Factory)
        }
        newMap[name] = f
        if registry.CompareAndSwap(old, &newMap) { return }
    }
}

func Lookup(name string) (Factory, bool) {
    m := registry.Load()
    if m == nil { return nil, false }
    f, ok := (*m)[name]
    return f, ok
}
```

Lookup is now a single atomic load. For 1M+ QPS scenarios where mutex contention shows in profiles, this is worth it.

---

## 14. Performance considerations

Factory dispatch is cheap. Where it shows up in profiles:

### 14.1 Registry lookup in hot paths

```go
for _, req := range millionsOfReqs {
    s, _ := storage.Get(req.Backend)  // map lookup per req
    s.Process(req)
}
```

The string map lookup is ~30 ns. At 1M iterations, ~30 ms total. Usually fine; sometimes worth caching:

```go
storageFn := storage.Get(backend)
for _, req := range millionsOfReqs {
    s := storageFn  // local variable
    s.Process(req)
}
```

### 14.2 Allocation per factory call

A factory that always allocates a fresh struct:

```go
func NewBuffer() *Buffer { return &Buffer{} }
```

If called once per request, that's an allocation per request. Sometimes worth `sync.Pool`:

```go
var pool = sync.Pool{ New: func() any { return &Buffer{} } }

func NewBuffer() *Buffer { return pool.Get().(*Buffer) }
func FreeBuffer(b *Buffer) { b.Reset(); pool.Put(b) }
```

Trade-off: callers must `Free` explicitly. Easy to forget.

### 14.3 Interface boxing

```go
func New() Iface { return &concrete{} }  // boxes into interface
```

For hot-path factories, returning the concrete type lets the caller decide whether to incur the interface boxing. Junior §12.1 covered the basic version; at senior level, profile-driven decisions.

---

## 15. Postmortems

### 15.1 The init-order bug

A service had a package-level var `var defaultEndpoint = config.Get("endpoint")`. The `config` package's `init()` loaded values from environment. The `defaultEndpoint` var was initialized *before* `init()` ran in some Go versions and *after* in others, depending on file ordering.

In production, `defaultEndpoint` was empty 5% of the time. Requests went to the wrong host. Hard to reproduce because development environment had `endpoint` set differently.

**Fix:** moved the lookup into a function called at use, not at var initialization.

### 15.2 The race-condition registry

A library registered codecs in `init()`. Tests imported multiple codecs and called `Register` concurrently — the map wasn't mutex-protected. CI passed because the race went undetected (registers happened sequentially in single-threaded init). Production crashed under high startup parallelism.

**Fix:** added a mutex; ran `-race` in CI.

### 15.3 The factory returning singleton

A team wrote `func NewClient() *Client` returning a package-level `defaultClient`. Two callers each modified `client.Timeout`. The second mutation overwrote the first. Bug surfaced two months later as random timeouts.

**Fix:** renamed to `Default()`, made the field unexported, and provided `WithTimeout(d)` option for fresh instances.

### 15.4 The eager-init failure

A startup factory eagerly constructed all backends:

```go
func NewStorage() Storage {
    return &compositeStorage{
        s3:   newS3(),
        gcs:  newGCS(),
        disk: newDisk(),
    }
}
```

When AWS S3 had an outage, the *whole service* failed to start — even though the running code only ever used disk storage. The outage took down deployments globally.

**Fix:** lazy construction; only initialize the backend on first use.

### 15.5 The DI graph cycle

A `wire` build introduced a cycle: `Server` depends on `Auth`, which depends on `Server` for user introspection. The generated code compiled but the cycle made initialization order undefined. Crashes appeared after a refactor.

**Fix:** introduced an intermediate interface so `Auth` depended on `*UserStore`, not `*Server`. The cycle resolved.

---

## 16. Cross-language comparison

| Language | Factory style |
|----------|---------------|
| Java | `XxxFactory` class hierarchy; modern code uses Spring DI |
| C# | `IServiceCollection` + DI container is the norm |
| Rust | `new()` associated function on the type; `Default` trait |
| Kotlin | Companion object `invoke()` or factory functions |
| Python | Factory functions; `__new__` for customization; `dependency-injector` library |
| Scala | Companion object `apply()`; `Macwire` for compile-time DI |

Go sits closer to Rust's "plain function" approach than to Java's class hierarchies. The GoF Factory Method (subclassing) doesn't apply — Go has no subclassing. Abstract Factory survives as "interface with N constructor methods".

---

## 17. Common senior mistakes

### 17.1 Returning interface from constructor

```go
func NewServer(addr string) Server { /* ... */ }  // Server is an interface
```

Callers lose access to methods beyond `Server`. Return `*serverImpl` (concrete); consumers convert to interface at *their* assignment site.

### 17.2 Factories with implicit ordering requirements

```go
NewA()
NewB()  // depends on A being constructed first
```

If construction must happen in a specific order, encode it in the type system: `NewB` accepts `*A` as a parameter, not relying on package-level globals.

### 17.3 Factories that take too many parameters

```go
func NewServer(addr, host, port string, timeout time.Duration, logger *log.Logger, metrics *Metrics, tls *tls.Config, /* 8 more */) *Server
```

10+ parameter factories are unreadable. Switch to functional options or a config struct.

### 17.4 Factories that don't return errors

```go
func NewServer(addr string) *Server { /* swallows all errors */ }
```

If construction can fail, *say so*. `(*Server, error)`. Callers can choose to ignore (`s, _ := NewServer(...)`), but you've at least informed them.

### 17.5 Singleton-named-as-factory

```go
func NewClient() *Client { return defaultClient }
```

`NewClient` implies a fresh instance. Returning a singleton from `NewX` is a trap. Rename to `Default()` or `Instance()`.

### 17.6 Forgetting compile-time check

```go
type myDriver struct{}
// missing method causes a runtime panic in sql.Register

sql.Register("foo", &myDriver{})  // ?
```

Add `var _ driver.Driver = (*myDriver)(nil)` to catch missing methods at compile time.

---

## 18. Tricky questions

**Q1.** When should a factory be a struct method vs a free function?

<details><summary>Answer</summary>

**Free function** is the default: `NewServer(addr)`. No state needed; works anywhere.

**Method** when the factory has *state*: a `ClientPool.Get()` factory that maintains a pool of connections. The pool is the state; the factory method consults it.

**Method on a registry struct** when you need test isolation: instead of package-level globals, each test creates a fresh registry instance.

Free functions are simpler; reach for methods when state demands it.
</details>

**Q2.** Should a factory accept `context.Context`?

<details><summary>Answer</summary>

If the factory does I/O (network, disk), yes — for cancellation. If construction is pure (struct allocation + field setting), no.

Examples:
- `sql.Open` doesn't take context (doesn't actually open the connection).
- `sql.DB.Conn(ctx)` does take context (it acquires a connection from the pool, possibly waiting).

Distinguish "construction" (pure) from "initialization" (I/O). Take context for the latter.
</details>

**Q3.** How do you make a factory testable?

<details><summary>Answer</summary>

Three options, in order of preference:

1. **Inject the dependencies the factory uses.** Instead of reading env vars or constructing collaborators, accept them as parameters.

2. **Inject the factory itself.** Code that uses `NewClient()` becomes code that uses `f.NewClient()` where `f` is a struct field. Tests pass a fake factory.

3. **Test seams** — variables that tests can override:
   ```go
   var newClient = func(addr string) (*Client, error) { /* real */ }
   ```
   Tests assign `newClient = fakeNewClient`. Quick but brittle; prefer 1 or 2.
</details>

**Q4.** A registry-based factory has duplicate name registration in two different packages. What happens?

<details><summary>Answer</summary>

Depends on the registry. The canonical pattern panics:

```go
if _, dup := factories[name]; dup { panic("duplicate") }
factories[name] = f
```

The panic happens at init time (because both packages register in `init()`), so the process fails to start. This is *correct* — silent overwriting hides bugs.

If the registry silently overwrites, the order of imports determines which factory wins. Subtle, fragile.

**Lesson:** registries should always panic on duplicate. The single line of defense saves days of debugging.
</details>

**Q5.** How do you evolve a factory from `NewX(addr string)` to `NewX(addr string, logger *log.Logger)`?

<details><summary>Answer</summary>

Don't change `NewX`. Add a new constructor:

```go
func NewX(addr string) *X            // v1, stays as-is
func NewXWithLogger(addr string, log *log.Logger) *X  // v2
```

Or, better, switch v1 to options:

```go
func NewX(addr string, opts ...Option) *X
func WithLogger(log *log.Logger) Option { /* ... */ }
```

The v1 signature stays compatible; new functionality is opt-in. Avoid breaking changes; let the API grow.
</details>

---

## 19. Cheat sheet

| Situation | Approach |
|-----------|----------|
| Many components, complex wiring | DI container (wire or dig) |
| Plugin system | Registry + init() self-registration |
| Hot-reload | atomic.Pointer + factory closure |
| Per-region/tenant cached instances | Registry with double-checked locking |
| Adding parameter | Functional options, not new positional arg |
| Construction may fail | Return `(*T, error)`, propagate from caller |
| Construction may do I/O | Accept context.Context |
| Test isolation | Inject the factory, not call it directly |
| Compile-time satisfaction check | `var _ Iface = (*Impl)(nil)` |
| Registry safety | Mutex; panic on duplicate; no update path |

---

## 20. Further reading

- **google/wire docs** — compile-time DI in Go
- **uber-go/dig docs** — runtime DI in Go
- **hashicorp/go-plugin** — out-of-process plugins
- **Go source: `src/database/sql/`** — canonical factory ecosystem
- **Go source: `src/image/format.go`** — `RegisterFormat` pattern
- **Go source: `src/sync/once.go`** — `sync.Once` for lazy factories
- **Go blog: "Inside the Map Implementation"** — registry performance
- **"100 Go Mistakes" by Teiva Harsanyi** — factory anti-patterns
- **Mark Seemann, "Dependency Injection Principles, Practices, and Patterns"** — DI strategy
- **GoF, "Design Patterns" (1994)** — Factory Method, Abstract Factory

Factories are the *first* design pattern most Go programmers write — and the most-over-used. Senior-level skill is knowing when a plain `NewX` suffices, when a registry pays off, and when a DI container is justified.
