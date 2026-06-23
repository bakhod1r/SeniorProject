# Factory Pattern — Middle

## 1. What this level adds

Junior taught the shape: a `New<T>` function with defaults, validation, and dependency setup. Middle is about *production patterns*:

- Factory registries and self-registration via `init()`.
- Factory functions as first-class values — passed around, stored, composed.
- Lazy / deferred construction with `sync.Once`.
- Generic factories (Go 1.18+) and when they pay off.
- Factory interfaces (Abstract Factory in Go).
- Factories that own goroutines and the lifecycle they imply.
- Factory ↔ functional options interop.
- Testing factories — fakes, contract tests.

By the end you should be able to design a factory subsystem that's safe to add to a production codebase.

---

## 2. Table of Contents

1. [What this level adds](#1-what-this-level-adds)
2. [Table of Contents](#2-table-of-contents)
3. [Factory registries](#3-factory-registries)
4. [Self-registration via init()](#4-self-registration-via-init)
5. [Factory functions as values](#5-factory-functions-as-values)
6. [Lazy / deferred construction](#6-lazy--deferred-construction)
7. [Generic factories](#7-generic-factories)
8. [Factory interfaces (Abstract Factory)](#8-factory-interfaces-abstract-factory)
9. [Factories with lifecycles](#9-factories-with-lifecycles)
10. [Factory ↔ functional options](#10-factory--functional-options)
11. [Coding patterns](#11-coding-patterns)
12. [Testing factories](#12-testing-factories)
13. [Performance notes](#13-performance-notes)
14. [Common middle-level mistakes](#14-common-middle-level-mistakes)
15. [Debugging factory bugs](#15-debugging-factory-bugs)
16. [Tricky points](#16-tricky-points)
17. [Test](#17-test)
18. [Cheat sheet](#18-cheat-sheet)
19. [Summary](#19-summary)

---

## 3. Factory registries

When the set of concrete types isn't known at compile time — plugins, config-driven selection — a registry replaces the switch-by-name from junior §7.

```go
package storage

type Factory func(config Config) (Storage, error)

var (
    mu        sync.RWMutex
    factories = map[string]Factory{}
)

func Register(name string, f Factory) {
    mu.Lock()
    defer mu.Unlock()
    if _, ok := factories[name]; ok {
        panic("storage: duplicate registration of " + name)
    }
    factories[name] = f
}

func New(name string, cfg Config) (Storage, error) {
    mu.RLock()
    f, ok := factories[name]
    mu.RUnlock()
    if !ok {
        return nil, fmt.Errorf("storage: unknown kind %q", name)
    }
    return f(cfg)
}
```

Three things:

1. **The registry is a map of name → factory function.** Each entry is `func(Config) (Storage, error)`.
2. **Registration is mutex-protected.** Multiple goroutines may register at startup; lookup is read-heavy after init.
3. **Lookup returns an error for unknown names.** Programmer errors (typo, missing import) surface immediately.

Used by `database/sql`, `image`, `compress`, `crypto/rsa` (block ciphers), `encoding/...`, and many others.

---

## 4. Self-registration via init()

The pattern that makes registries practical: each implementation registers itself in `init()`.

```go
package memstorage

func init() {
    storage.Register("memory", func(cfg storage.Config) (storage.Storage, error) {
        return &MemStorage{}, nil
    })
}
```

To enable the implementation, import it for side effects:

```go
package main

import (
    _ "myapp/memstorage"   // registers "memory"
    _ "myapp/s3storage"    // registers "s3"
    "myapp/storage"
)

func main() {
    s, _ := storage.New("memory", storage.Config{})
    // ...
}
```

The `_` import runs `init()` but doesn't pollute the namespace. This is how `database/sql` drivers work:

```go
import (
    _ "github.com/lib/pq"          // registers "postgres"
    _ "github.com/go-sql-driver/mysql" // registers "mysql"
    "database/sql"
)

db, _ := sql.Open("postgres", dsn)
```

### 4.1 Pros and cons

**Pros:**
- Adding a new implementation is a new file in a new package; nothing in the core changes.
- Config-driven selection works naturally.
- Discoverable: grep for `init()` in implementation packages tells you what's registered.

**Cons:**
- **Global mutable state.** The registry is package-level; tests can't easily isolate.
- **Init-time ordering matters.** If two packages register the same name, behaviour depends on init order (Go runs imports recursively, but the order within a package's imports is by source-file alpha — fragile).
- **Hidden dependencies.** A blank import (`_ "..."`) is invisible at the call site. Readers see `sql.Open("postgres", dsn)` and wonder why "postgres" works — until they grep for the blank import.

### 4.2 When to use vs explicit construction

For **internal codebases**: prefer explicit construction. `s := newMemStorage()` is clearer than `s, _ := storage.New("memory", cfg)`.

For **libraries with extensions**: registries earn their keep. `database/sql` would be unusable if you had to import every possible driver.

For **plugin systems**: registries are essentially unavoidable. Plugins register themselves; the host doesn't know what to expect.

---

## 5. Factory functions as values

Factories are values. You can pass them around, store them, compose them.

### 5.1 Factory in a struct

```go
type ServerPool struct {
    create func() (*Server, error)
}

func NewServerPool(factory func() (*Server, error)) *ServerPool {
    return &ServerPool{create: factory}
}

func (p *ServerPool) Get() (*Server, error) {
    return p.create()
}
```

`ServerPool` doesn't know how to construct a server — it holds a factory and delegates. The caller decides what kind of server gets pooled by passing in the right factory.

### 5.2 Factory wrapping

```go
func WithLogging(inner func() (*Server, error)) func() (*Server, error) {
    return func() (*Server, error) {
        log.Println("creating server")
        s, err := inner()
        if err != nil { log.Printf("create failed: %v", err); return nil, err }
        log.Println("server created")
        return s, nil
    }
}

base := func() (*Server, error) { return &Server{}, nil }
wrapped := WithLogging(base)
s, _ := wrapped()
```

A factory-of-factories. Each wrapper adds behaviour (logging, retry, metrics) around construction. Same pattern as `http.Handler` middleware, applied to constructors.

### 5.3 Factory composition

```go
type Constructor func() (Service, error)

func Sequence(steps ...Constructor) Constructor {
    return func() (Service, error) {
        var last Service
        for _, step := range steps {
            s, err := step()
            if err != nil { return nil, err }
            last = s
        }
        return last, nil
    }
}
```

Useful when several factories must run in sequence (initialise DB, then auth service, then HTTP server). The final return is the result of the last step.

---

## 6. Lazy / deferred construction

Sometimes you want the *factory* now but defer *construction* until first use. `sync.Once` is the tool.

```go
type lazyClient struct {
    once   sync.Once
    err    error
    client *Client

    construct func() (*Client, error)
}

func newLazyClient(construct func() (*Client, error)) *lazyClient {
    return &lazyClient{construct: construct}
}

func (l *lazyClient) get() (*Client, error) {
    l.once.Do(func() {
        l.client, l.err = l.construct()
    })
    return l.client, l.err
}
```

The client is constructed *once*, on the first call to `get()`. Subsequent calls return the cached result (or cached error). Other goroutines calling `get()` concurrently wait for the first one to finish.

### 6.1 When to use

- The dependency might never be used (e.g., a metrics client when metrics are disabled).
- Construction is expensive (TLS handshake, certificate loading, large memory allocation).
- Construction order matters and you want to defer past `main()` setup.

### 6.2 When NOT to use

- The dependency is *always* used. Lazy adds a `sync.Once` overhead for no benefit.
- The dependency's failure should crash the program at startup, not later when someone happens to call.

---

## 7. Generic factories

Go 1.18+ allows parameterised factories:

```go
type Factory[T any] func() (T, error)

func Pool[T any](f Factory[T]) *PoolImpl[T] { /* ... */ }
```

Most useful for library code (test helpers, generic pools). For application code, the gain is small — you usually know the type.

### 7.1 Factory map keyed by type

```go
type AnyFactory func() any

var factories = map[reflect.Type]AnyFactory{}

func Register[T any](f func() T) {
    factories[reflect.TypeFor[T]()] = func() any { return f() }
}

func New[T any]() T {
    f, ok := factories[reflect.TypeFor[T]()]
    if !ok { panic("no factory registered") }
    return f().(T)
}
```

Useful for type-keyed dependency injection. The cost: reflection for the type key, and an `any` allocation per call. Use sparingly; explicit construction is usually clearer.

---

## 8. Factory interfaces (Abstract Factory)

When the factory itself must be swappable, define it as an interface.

```go
type Storage interface {
    Get(id string) ([]byte, error)
    Put(id string, data []byte) error
}

type StorageFactory interface {
    New(config Config) (Storage, error)
}
```

Implementations:

```go
type memFactory struct{}
func (memFactory) New(_ Config) (Storage, error) { return &memStorage{}, nil }

type s3Factory struct{}
func (s3Factory) New(cfg Config) (Storage, error) { return newS3Storage(cfg) }
```

Why use an interface here vs just `func(Config) (Storage, error)`?

- The interface can have multiple methods (`New`, `Inspect`, `Capabilities`).
- The interface can be embedded in other structs and gain optional behaviours.
- Type switches and assertions can recover the concrete factory type.

For simple cases, function-typed factories suffice. The interface earns its keep when the factory itself is a meaningful object with multiple concerns.

### 8.1 Abstract Factory: family of products

```go
type Tracer interface {
    NewSpan(name string) *Span
    NewCounter(name string) *Counter
    NewHistogram(name string) *Histogram
}

type prometheusT struct{ /* ... */ }
func (p *prometheusT) NewSpan(name string) *Span { /* ... */ }
func (p *prometheusT) NewCounter(name string) *Counter { /* ... */ }
func (p *prometheusT) NewHistogram(name string) *Histogram { /* ... */ }

type datadogT struct{ /* ... */ }
// ... same methods
```

`Tracer` is an Abstract Factory: its methods construct related types (`Span`, `Counter`, `Histogram`) from the same backend. Swapping `prometheusT` for `datadogT` swaps the entire family of products together.

In Go this is often *just an interface*. The GoF book's elaborate hierarchy collapses.

---

## 9. Factories with lifecycles

Some factories produce objects that need cleanup. The factory must surface this somehow.

### 9.1 Return a `Close()`-able product

```go
type Storage interface {
    Get(id string) ([]byte, error)
    Close() error
}

func NewStorage(cfg Config) (Storage, error) { /* ... */ }
```

Callers must `defer s.Close()`. The product owns its resources.

### 9.2 Return a cleanup function

```go
func NewStorage(cfg Config) (Storage, func(), error) {
    s, err := newS3Storage(cfg)
    if err != nil { return nil, nil, err }
    cleanup := func() { s.flush(); s.disconnect() }
    return s, cleanup, nil
}

s, cleanup, _ := NewStorage(cfg)
defer cleanup()
```

This is the `dig`/`wire`-style DI pattern. Cleanup is explicit and separate from the product's API.

### 9.3 Pass a context for lifetime

```go
func NewStorage(ctx context.Context, cfg Config) (Storage, error) {
    s := /* ... */
    go func() {
        <-ctx.Done()
        s.close()
    }()
    return s, nil
}
```

The factory ties the product's lifetime to the context. When `ctx` cancels, the product cleans up. Useful for test scenarios and request-scoped resources.

### 9.4 Lifetime danger

Factories that spawn background goroutines without exposing cancellation are a leak source:

```go
// Anti-pattern
func NewClient(apiKey string) *Client {
    c := &Client{apiKey: apiKey}
    go c.heartbeat() // never stops
    return c
}
```

If the caller can't stop the heartbeat, it runs until process exit. Tests that create many clients leak goroutines. Always provide a `Close()` method, accept a `context.Context`, or return a cleanup func.

---

## 10. Factory ↔ functional options

Factories with many configurable fields combine well with functional options.

```go
type Server struct {
    addr         string
    readTimeout  time.Duration
    writeTimeout time.Duration
    logger       *log.Logger
}

type Option func(*Server)

func WithReadTimeout(d time.Duration) Option {
    return func(s *Server) { s.readTimeout = d }
}

func WithLogger(l *log.Logger) Option {
    return func(s *Server) { s.logger = l }
}

func NewServer(addr string, opts ...Option) *Server {
    s := &Server{
        addr:         addr,
        readTimeout:  30 * time.Second,
        writeTimeout: 30 * time.Second,
        logger:       log.Default(),
    }
    for _, opt := range opts {
        opt(s)
    }
    return s
}
```

The factory (`NewServer`) and the options together provide:

- Required parameter (`addr`).
- Default-with-override pattern (timeouts, logger).
- Extensible API (new options don't break existing callers).

Cross-reference: `../01-functional-options/` for the full pattern. The factory is the *entry point*; options are the *modifiers*.

---

## 11. Coding patterns

### 11.1 The "must" variant

```go
func MustNewServer(addr string, opts ...Option) *Server {
    s, err := NewServer(addr, opts...)
    if err != nil {
        panic(fmt.Errorf("MustNewServer: %w", err))
    }
    return s
}
```

Mirroring `regexp.MustCompile` and `template.Must`. Use when you're certain construction can't fail (constant inputs, startup code). The panic is *intentional* — a programmer bug, not a runtime condition.

### 11.2 The "default" accessor

```go
var defaultClient = MustNewClient("default")

func Default() *Client { return defaultClient }
```

Separates "give me a singleton" from "give me a new instance". Avoids `NewX()` accidentally returning shared state.

### 11.3 The conditional factory

```go
func NewStorage(cfg Config) (Storage, error) {
    if cfg.Backend == "" { cfg.Backend = "memory" }
    factory, ok := registry[cfg.Backend]
    if !ok { return nil, fmt.Errorf("unknown backend %q", cfg.Backend) }
    return factory(cfg)
}
```

Combines defaults, validation, and registry lookup. The factory pattern earns its keep.

### 11.4 The factory tree

```go
type App struct {
    storage Storage
    auth    *Auth
    server  *Server
}

func NewApp(cfg AppConfig) (*App, error) {
    storage, err := NewStorage(cfg.Storage)
    if err != nil { return nil, fmt.Errorf("NewApp: storage: %w", err) }

    auth, err := NewAuth(cfg.Auth, storage)
    if err != nil { return nil, fmt.Errorf("NewApp: auth: %w", err) }

    server, err := NewServer(cfg.Server, storage, auth)
    if err != nil { return nil, fmt.Errorf("NewApp: server: %w", err) }

    return &App{storage: storage, auth: auth, server: server}, nil
}
```

`NewApp` orchestrates several sub-factories. Each step's error is wrapped with context. This is the `main()` of a typical Go service — composing the object graph.

---

## 12. Testing factories

### 12.1 Test what the factory builds

```go
func TestNewServer_Defaults(t *testing.T) {
    s := NewServer(":8080")
    if s.readTimeout != 30*time.Second {
        t.Errorf("readTimeout = %v", s.readTimeout)
    }
    if s.logger == nil {
        t.Error("logger should default to log.Default()")
    }
}
```

Direct field inspection. Works when the factory is in the same package as the test.

For *external* test packages (e.g., `server_test`), the fields are unexported — test via observable behaviour:

```go
func TestNewServer_Defaults(t *testing.T) {
    s := server.NewServer(":8080")
    // Exercise s, verify behaviour that depends on defaults.
}
```

### 12.2 Test registry behaviour

```go
func TestRegister_Duplicate(t *testing.T) {
    storage.Register("test1", func(_ Config) (Storage, error) { return nil, nil })
    defer func() { /* clean up registry */ }()

    defer func() {
        if r := recover(); r == nil {
            t.Error("expected panic on duplicate registration")
        }
    }()
    storage.Register("test1", func(_ Config) (Storage, error) { return nil, nil })
}
```

Registries with global state are *hard* to test in isolation. Two mitigations:

1. **Test cleanup** — restore the registry after each test (requires the registry to expose unregistration, which it usually shouldn't).
2. **Inject the registry** — `NewStorage(reg *Registry, name string, cfg Config)`. Each test gets its own.

Option 2 is far cleaner. Avoid package-level mutable registries when possible.

### 12.3 Factory as injected dependency

```go
type App struct {
    NewStorage func(cfg Config) (Storage, error)
}

func TestApp_StorageError(t *testing.T) {
    a := &App{NewStorage: func(_ Config) (Storage, error) {
        return nil, errors.New("storage down")
    }}
    err := a.Run()
    if err == nil { t.Error("expected error") }
}
```

Pass the factory as a field. Tests substitute a fake; production uses the real one. Tighter than mocking interfaces.

---

## 13. Performance notes

Factories have negligible runtime cost in isolation. Where it matters:

### 13.1 Factory in hot path

```go
for _, req := range requests {
    h := NewHandler(req)   // factory per request
    h.Handle(req)
}
```

Each `NewHandler` allocates a `*Handler`. If you can construct once and reuse:

```go
h := NewHandler()  // once
for _, req := range requests {
    h.Handle(req)  // method takes the per-request data
}
```

Saves N allocations.

### 13.2 Registry lookup cost

Map lookup by string key is ~30 ns. For sub-millisecond hot paths, this can show up. Cache the looked-up factory:

```go
factory, _ := registry.Get("memory")  // once
for ... {
    s, _ := factory(cfg)  // direct call
}
```

### 13.3 Lazy init via sync.Once

`sync.Once.Do` is ~3 ns on the fast path (atomic load + barrier). Acceptable for almost any use.

### 13.4 The interface allocation tax

```go
func NewStorage() Storage { return &memStorage{} }
```

If the caller stores the result in a local variable and only uses it within the function, escape analysis can sometimes stack-allocate. If they store it in a struct or pass to another function, the `&memStorage{}` heap-allocates plus the iface wrapping.

For hot-path factories, returning the concrete type and letting the caller decide whether to convert to interface avoids unnecessary boxing.

---

## 14. Common middle-level mistakes

### 14.1 Registry with no nil check

```go
func New(name string) Storage {
    return registry[name]()  // nil func panic if name unknown
}
```

Map lookup on a missing key returns the zero value of the value type — for a function type, that's nil. Calling it panics. Always check:

```go
if f, ok := registry[name]; ok {
    return f(), nil
}
return nil, fmt.Errorf("unknown %q", name)
```

### 14.2 Sharing factory state across calls

```go
type factoryState struct{ count int }

func New() *Service {
    state.count++
    return &Service{id: state.count}
}
```

Innocent-looking. But if `New()` is called concurrently, `state.count++` is a race. Either atomic or remove the shared state.

### 14.3 Factory that holds the caller's pointer

```go
type Cache struct{ items map[string]any }

func NewCache(items map[string]any) *Cache {
    return &Cache{items: items}  // shares caller's map!
}

m := map[string]any{}
c := NewCache(m)
m["foo"] = "bar"  // mutates c.items too
```

If the caller is supposed to retain ownership, document it. If not, copy:

```go
func NewCache(items map[string]any) *Cache {
    copied := make(map[string]any, len(items))
    for k, v := range items { copied[k] = v }
    return &Cache{items: copied}
}
```

### 14.4 Factory that prints / logs side effects

```go
func NewServer(addr string) *Server {
    fmt.Println("creating server with addr:", addr)
    return &Server{addr: addr}
}
```

The factory has a side effect that surprises tests. If tests want to capture stdout, they have to wrap. Push logging to either the constructor's caller or an explicit `Start(ctx)` method.

---

## 15. Debugging factory bugs

### 15.1 Wrong concrete type returned

```go
log.Printf("storage type: %T", s)  // %T prints the concrete type
```

If the type isn't what you expect, the registry has the wrong factory registered. Check the init order.

### 15.2 Factory called with the wrong args

Add a `Printf` at the factory's entry. Confirms the inputs are what you expect.

### 15.3 Init order surprises

Imports are loaded depth-first; within a package, init runs in source-file alphabetical order. If two factories register the same name and one wins unexpectedly, the order is the culprit.

### 15.4 Hidden global state

Factory with package-level state that one test modifies affects all later tests. Symptom: tests pass individually, fail when run together (`go test ./... -count=1`). Fix: inject state instead of relying on globals.

---

## 16. Tricky points

### 16.1 Factory closures and captured variables

```go
func factoryWithLogger(l *log.Logger) func(string) *Server {
    return func(addr string) *Server {
        return &Server{addr: addr, logger: l}
    }
}

f1 := factoryWithLogger(loggerA)
f2 := factoryWithLogger(loggerB)
// f1 and f2 are different factories, each with its own captured logger.
```

This is *partial application*. The outer function takes "fixed" arguments (the logger); the returned function takes "variable" ones (the address). Useful for currying-style APIs.

### 16.2 Init order across packages

```go
// In package A:
var x = someFactory("...")  // runs at init

// In package B:
func init() {
    SomeFactoryRegistry.Register(...)
}
```

If `A` imports `B`, Go guarantees `B`'s init runs first. But if `A`'s package-level `var x = ...` runs *before* `B`'s `init`, the registry isn't populated yet. Move `x`'s assignment into an `init()` function in `A`, which is guaranteed to run after dependency inits.

### 16.3 Factory that recursively calls itself

```go
func NewService() *Service {
    s := &Service{}
    s.helper = NewHelper(s)   // calls another factory
    return s
}

func NewHelper(s *Service) *Helper {
    return &Helper{owner: NewService()}   // !
}
```

Infinite recursion. Each factory tries to construct its dependency, which tries to construct *it*. Common when wiring is circular. Refactor: pass `s` (already-constructed) to `Helper` instead of having `Helper` construct another `Service`.

### 16.4 Factory in tests vs production

```go
// Production:
db, _ := sql.Open("postgres", dsn)

// Test:
db, _ := sql.Open("sqlite3", ":memory:")
```

Same factory signature, different drivers. The implementation chooses by name; tests can swap. This is registry pattern's main test win.

---

## 17. Test

**Q1.** What's the issue?

```go
func New(name string) Storage {
    return registry[name]()
}

var registry = map[string]func() Storage{
    "memory": func() Storage { return &memStorage{} },
}

s := New("not-registered")  // ?
```

<details><summary>Answer</summary>

`registry["not-registered"]` returns the zero value — a `nil` function. Calling it panics with "invalid memory address or nil pointer dereference".

Fix:

```go
func New(name string) (Storage, error) {
    f, ok := registry[name]
    if !ok { return nil, fmt.Errorf("unknown storage %q", name) }
    return f(), nil
}
```

Always check `ok` from map lookup before calling.
</details>

**Q2.** What's wrong here?

```go
func NewServer() *Server {
    s := &Server{}
    go s.healthCheck()
    return s
}
```

<details><summary>Answer</summary>

Goroutine leak. The `healthCheck` runs forever; no way to stop it. Callers can't `Close()` the server cleanly. Tests that create many servers leak many goroutines.

Fix:

```go
func NewServer(ctx context.Context) *Server {
    s := &Server{}
    go func() {
        <-ctx.Done()
        s.shutdown()
    }()
    go s.healthCheck(ctx)
    return s
}
```

Or accept a `Close()` method:

```go
func NewServer() *Server {
    s := &Server{done: make(chan struct{})}
    go s.healthCheck()
    return s
}
func (s *Server) Close() { close(s.done) }
```

Either way, the goroutine has an exit path.
</details>

**Q3.** Function-typed or interface-typed factory — which fits?

> You have 5 storage backends. Each requires different config types (`S3Config`, `DiskConfig`, etc.). The factory should accept the right config for the chosen backend.

<details><summary>Answer</summary>

Interface-typed:

```go
type StorageFactory interface {
    New(cfg any) (Storage, error)
}

type S3Factory struct{}
func (f *S3Factory) New(cfg any) (Storage, error) {
    c, ok := cfg.(S3Config)
    if !ok { return nil, errors.New("S3Factory: expected S3Config") }
    return newS3(c)
}
```

The function-typed alternative `func(cfg any) (Storage, error)` works too. But the interface allows the factory to *describe itself* (`Name()`, `ConfigType()`, etc.) — useful for plugin systems or self-documenting APIs.

For 5 backends that *only* construct: function-typed is fine. For richer factories: interface.
</details>

---

## 18. Cheat sheet

| Scenario | Pattern |
|----------|---------|
| Compile-time-known type | `NewX(args) (*X, error)` |
| Runtime-selected type | `NewX(kind string, ...) (Iface, error)` with switch |
| Plugins / config-driven | Registry + `init()` self-registration |
| Lazy init | `sync.Once` wrapping the construction |
| Family of products | Abstract factory interface |
| Need lifecycle | Return `Close()` method, cleanup func, or accept `ctx` |
| Many config knobs | Combine with functional options |
| Reusable | Return concrete; let caller convert to interface |
| Test substitution | Inject the factory as a field |

---

## 19. Summary

Factories in Go are *plain functions* most of the time. The pattern earns its keep when:

- The factory has runtime branching (type-selecting).
- The factory holds significant state (registry, cache, dependency graph).
- The factory must be swappable (interface-typed for plugin systems).

The next step is **[senior.md](senior.md)** — factory design at scale: dependency injection containers, the `wire` and `dig` libraries, factory contracts across packages, hot-reload factories, and case studies in real Go ecosystems.
