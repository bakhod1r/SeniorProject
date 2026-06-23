# Singleton Pattern — Interview Preparation

## 1. What interviewers test for

Singleton is the pattern that lets interviewers probe your understanding of:

- `sync.Once` and lazy initialization.
- Memory ordering and concurrency.
- The cost-benefit of global state vs DI.
- Testability tradeoffs.

Signals by level:

| Level | Looking for |
|-------|-------------|
| Junior | Write `sync.Once`-based singleton; know `init()` exists; understand "one per process" |
| Middle | Hot-reload; reset for tests; error-returning singleton; package var vs function-gated |
| Senior | When NOT to use; migration to DI; cross-language understanding |

Red flag: candidate immediately reaches for `sync.Mutex`-based double-checked locking. The correct answer is `sync.Once`.

---

## 2. Junior questions

### Q1. What's the Singleton pattern?

**Answer:** Ensures a class has only one instance, providing a global access point.

In Go: a package-level variable, possibly with lazy initialization via `sync.Once`. There's no class hierarchy; the singleton is a struct with a getter.

### Q2. Write a thread-safe singleton in Go.

**Answer:**

```go
type Service struct{ /* ... */ }

var (
    instance *Service
    once     sync.Once
)

func Default() *Service {
    once.Do(func() {
        instance = newService()
    })
    return instance
}
```

`sync.Once.Do` guarantees `newService()` runs exactly once across all goroutines. Subsequent calls return the cached `instance`.

### Q3. Why not just use `init()`?

**Answer:** `init()` runs at package load. Pros:
- Singleton is ready before any code uses it.
- No per-call overhead.

Cons:
- Always runs, even if the singleton isn't used.
- If init fails (network call, file read), the binary won't start.
- Can't pass dynamic configuration.

`sync.Once` is preferred when the singleton might not be used, or when init can fail.

### Q4. Why is the double-checked locking pattern often wrong in Go?

**Answer:** Without atomic primitives, the unsynchronized read in the outer check races. Memory ordering doesn't guarantee that the reader sees a fully-constructed instance even when `initialized=true`.

`sync.Once` uses `atomic.Uint32.Load/Store` which provide acquire/release semantics. The pattern is correct because of those barriers.

### Q5. How would you reset a singleton for tests?

**Answer:** Several options:

```go
// In export_test.go:
func ResetSingleton() {
    once = sync.Once{}
    instance = nil
}

// Or use atomic.Pointer:
var instance atomic.Pointer[Service]

// Tests:
func TestX(t *testing.T) {
    t.Cleanup(func() { instance.Store(originalInstance) })
    instance.Store(testInstance)
    /* ... */
}
```

The export_test.go approach exposes internals only to the test package. The atomic.Pointer approach makes reset native.

### Q6. What's wrong here?

```go
var defaultClient = http.DefaultClient

func makeRequest() {
    defaultClient.Timeout = 5 * time.Second  // !
    defaultClient.Do(req)
}
```

**Answer:** `http.DefaultClient` is shared across the entire process. Setting `Timeout` here affects every caller of `DefaultClient` everywhere. A race for any concurrent setter.

Fix: construct a fresh `http.Client{Timeout: 5 * time.Second}` per use case. Don't share `DefaultClient`.

### Q7. What's the memory model issue with naive singleton init?

**Answer:** Without proper synchronization, the writer's assignment of fields to the instance may become visible *after* the assignment of the instance pointer. A reader could see `instance != nil` but uninitialized fields.

`sync.Once` and `atomic.Pointer` insert memory barriers that prevent this reordering.

### Q8. Should the singleton be returned as a pointer or by value?

**Answer:** Pointer. The singleton has identity — there's one of them. Returning by value would copy the struct, defeating the purpose.

Exception: if the singleton is read-only and small, returning by value is safe and avoids accidental mutation.

### Q9. What's `runtime.GOMAXPROCS`?

**Answer:** A package-level function that sets the maximum number of OS threads. It's effectively a singleton — one value per process, settable but typically once at startup. The underlying state (CPU thread pool) is genuinely process-wide.

### Q10. Is `os.Stdin` a singleton?

**Answer:** Yes — it's a package-level `*os.File` initialized once. There's no constructor; the OS provides one stdin per process.

This is the canonical "good singleton": represents a process-wide OS resource that can't meaningfully be replaced.

---

## 3. Middle questions

### Q1. How would you make a singleton that returns an error?

**Answer:**

```go
var (
    once     sync.Once
    instance *Service
    initErr  error
)

func Get() (*Service, error) {
    once.Do(func() {
        instance, initErr = newService()
    })
    return instance, initErr
}
```

Or use `sync.OnceValues` (Go 1.21+):

```go
var Get = sync.OnceValues(func() (*Service, error) {
    return newService()
})
```

The error is captured along with the value. All callers see the same outcome.

### Q2. How do you hot-reload a singleton?

**Answer:** `atomic.Pointer`:

```go
var current atomic.Pointer[Config]

func Init(cfg *Config) { current.Store(cfg) }
func Get() *Config { return current.Load() }
func Reload(cfg *Config) { current.Store(cfg) }
```

Readers see either the old or the new — never torn. The old value is GC'd when no one holds a reference.

### Q3. Generic singleton?

**Answer:**

```go
type Lazy[T any] struct {
    once  sync.Once
    value T
    init  func() T
}

func NewLazy[T any](init func() T) *Lazy[T] {
    return &Lazy[T]{init: init}
}

func (l *Lazy[T]) Get() T {
    l.once.Do(func() { l.value = l.init() })
    return l.value
}
```

Useful as infrastructure but rarely worth it for application code. Plain singletons are clearer when the type is known.

### Q4. Why is `prometheus.DefaultRegisterer` controversial?

**Answer:** It's a global registry. Pros: easy to add metrics from anywhere. Cons:
- Tests can't isolate metrics.
- Two packages registering metrics with the same name panic.
- Plugins inadvertently pollute the global namespace.

Modern recommendation: create a `prometheus.NewRegistry()` per service and inject it where needed. Use `DefaultRegisterer` only for top-level glue code.

### Q5. How does package-level init order affect singletons?

**Answer:** Within a package, vars init in declaration order (file-by-file, lexical). Cross-package, imports init first.

So:

```go
// pkg a:
var x = pkgb.GetSingleton()  // requires pkgb's singleton to be ready

// pkg b:
func init() { initSingleton() }
```

If `a` imports `b`, this works (b's init runs first). If they don't import each other, ordering is undefined.

**Lesson:** if singletons cross packages, init them in `main()`, not in package-level vars.

### Q6. Singleton with a goroutine — how to clean up?

**Answer:** Accept a `context.Context`; the goroutine watches `ctx.Done()`:

```go
type Service struct { /* ... */ }

func New(ctx context.Context) *Service {
    s := &Service{}
    go s.background(ctx)
    return s
}

func (s *Service) background(ctx context.Context) {
    for {
        select {
        case <-ctx.Done():
            return
        case <-time.After(time.Second):
            s.tick()
        }
    }
}
```

Or expose `Close()` that signals shutdown. Without one of these, the singleton's goroutine leaks.

### Q7. Why does this test fail?

```go
func TestA(t *testing.T) {
    cfg.Set("key", "valueA")
    process()
    assert.Equal(t, "outputA", result)
}

func TestB(t *testing.T) {
    cfg.Set("key", "valueB")
    process()
    assert.Equal(t, "outputB", result)
}
```

**Answer:** If `cfg` is a singleton, `TestA` and `TestB` race when run in parallel. Even sequentially, the order matters — if `TestA` runs after `TestB`, it sees "valueB" until it resets.

Fix: pass `cfg` as a parameter to `process()`, eliminating the shared state.

### Q8. Can you panic-recover from a `sync.Once.Do(f)` where `f` panics?

**Answer:** Yes — wrap `f` in panic recovery:

```go
once.Do(func() {
    defer func() {
        if r := recover(); r != nil {
            initErr = fmt.Errorf("init panic: %v", r)
        }
    }()
    /* init code */
})
```

But the `Once` is marked "done" regardless. Subsequent calls skip `f`, returning whatever state was achieved before the panic.

For panic-aware re-tries, use `sync.OnceValue` (Go 1.21+) — it captures and re-raises panics on subsequent calls.

### Q9. What's `OnceFunc`, `OnceValue`, `OnceValues`?

**Answer:** Go 1.21+ helpers wrapping `sync.Once`:

```go
runOnce := sync.OnceFunc(setup)
runOnce(); runOnce()  // setup runs only once

getOnce := sync.OnceValue(loadConfig)
cfg := getOnce()  // loadConfig runs once, cached

getOnceWithErr := sync.OnceValues(loadConfigWithErr)
cfg, err := getOnceWithErr()
```

Convenience wrappers. Same underlying `sync.Once` mechanism.

### Q10. How would you migrate a singleton to DI?

**Answer:** Step-by-step:

1. Create a struct (`type OrderService struct{ db *sql.DB }`) and move singleton-using functions to methods.
2. Pass `db` via constructor: `New(db *sql.DB) *OrderService`.
3. Update callers to use the service.
4. Once all callers are updated, delete the package-level `db` var.

Incremental. Each step keeps the codebase working.

---

## 4. Senior questions

### Q1. When is Singleton genuinely necessary?

**Answer:** Three cases:

1. **OS resources:** `os.Stdin`, `time.Local`, `crypto/rand.Reader`. There's *one* by definition.
2. **Process-wide observability:** logger, metrics, tracing. Threading them through every call is impractical.
3. **Truly-single resources:** `*sql.DB` (connection pool). Multiple instances = multiple pools, usually not what you want.

Everything else: prefer DI.

### Q2. Why is `http.DefaultClient` considered a mistake?

**Answer:** It's a *mutable* singleton with no timeout. Common bugs:
- Tests share state via mutation of `DefaultClient.Transport`.
- Slow requests block other requests (the client has no timeout by default).
- Resource leaks when callers don't close response bodies.

Modern Go advice: never use `http.Get`, `http.Post`, `http.DefaultClient`. Always construct a fresh `http.Client{Timeout: ...}`.

### Q3. Walk through replacing a singleton with DI.

**Answer:**

```go
// Before
package svc
var db *sql.DB
func Process(o Order) error { return db.Save(o) }
func init() { db = openDB() }

// After
package svc
type Service struct { db *sql.DB }
func New(db *sql.DB) *Service { return &Service{db: db} }
func (s *Service) Process(o Order) error { return s.db.Save(o) }
```

```go
// main.go
db, _ := sql.Open(...)
svc := svc.New(db)
svc.Process(o)
```

Benefits:
- Tests inject a test DB.
- Multiple services can use different DBs.
- The dependency is visible in the function signature.

### Q4. Hot-reload via atomic.Pointer — explain.

**Answer:** `atomic.Pointer[T]` wraps an `unsafe.Pointer` with type-safe atomic Load/Store. Writers replace the pointer; readers see either the old or new value, never torn.

```go
var config atomic.Pointer[Config]

func init() { config.Store(loadConfig()) }
func Get() *Config { return config.Load() }
func Reload() error {
    c, err := loadConfig()
    if err != nil { return err }
    config.Store(c)
    return nil
}
```

The trade-off: no coordination of in-flight requests. Some goroutines may use the old config briefly after a reload. For most config changes, this is acceptable.

### Q5. What goes wrong when a singleton has a goroutine?

**Answer:** Without lifecycle management:
- The goroutine outlives the singleton's intended scope.
- Tests can't stop it; CI accumulates leaks.
- Process shutdown can't drain it.

Symptoms: tests "pass" individually but cause memory growth in `go test -count=N`. CI memory exhaustion.

Fix: accept `context.Context` for shutdown signaling.

### Q6. Singleton vs Service Locator vs DI Container.

**Answer:**

- **Singleton:** one instance, globally accessible.
- **Service Locator:** a registry of singletons, looked up by name or type.
- **DI Container:** factory + wiring — produces fresh instances or singletons on demand.

In Go, Service Locators (e.g., `sql.Register("driver", ...)`) are common but limited to specific use cases. DI Containers (`wire`, `dig`) are full solutions. Singletons are the simplest but offer the least flexibility.

### Q7. What's the relationship between Singleton and Factory?

**Answer:** Singleton is a *cached factory output*. The factory constructs once; subsequent "calls" return the cache.

```go
// Factory pattern:
func NewService() *Service { return &Service{...} }

// Singleton (factory + cache):
var s *Service
var once sync.Once
func Default() *Service {
    once.Do(func() { s = NewService() })
    return s
}
```

The singleton is the factory plus the cache plus the global accessor.

### Q8. Postmortem: singleton goroutine leaked in CI.

**Answer:** Likely cause:

```go
func init() {
    go heartbeat()  // runs forever
}
```

Each test process inherited the running goroutine. After many test files imported the package, many goroutines accumulated. The CI machine eventually exhausted memory.

Fix: don't start goroutines in `init()`. Use lazy startup with explicit `Start(ctx)`/`Stop()`.

### Q9. How do you handle stale config in a long-running singleton?

**Answer:** Three approaches:

1. **Hot-reload via atomic.Pointer.** Best for most cases.
2. **Restart on config change.** Simple but disruptive.
3. **Re-fetch on each use.** Avoids staleness but expensive.

Pick by frequency of change and tolerance for staleness.

### Q10. Singleton with a `Close()` method — what's the lifecycle?

**Answer:** The trickiest singleton. `Close()` implies the singleton can be torn down — but if it's reachable globally, who calls `Close()`?

Patterns:
- Composition root (`main()`) holds a reference and calls `Close()` on shutdown.
- The singleton register itself with `runtime.SetFinalizer` (rarely used; unreliable).
- Process termination implicitly cleans up (good enough for short-lived processes).

For long-running services, explicit shutdown in `main()` is the correct pattern. The singleton package exposes a `Close()` function that wraps the instance's cleanup.

---

## 5. Live coding challenges

### Challenge 1: Thread-safe singleton with error

Implement:

```go
type DB struct { /* ... */ }

// Default returns a singleton *DB, initializing on first call.
// Returns the same error on every call if init failed.
func Default() (*DB, error) { /* ... */ }
```

**Solution:** Use `sync.Once` with captured error (or `sync.OnceValues`).

### Challenge 2: Hot-reload singleton

Implement:

```go
type Config struct{ Endpoint string }

func Get() *Config { /* ... */ }
func Reload(c *Config) { /* ... */ }
```

Allow concurrent `Get` while `Reload` runs.

**Solution:** `atomic.Pointer[Config]`.

### Challenge 3: Test isolation

Given:

```go
var cache = map[string]any{}
func GetCache(k string) any { return cache[k] }
func SetCache(k string, v any) { cache[k] = v }
```

Refactor for testability without breaking the existing API.

**Solution:** Move `cache` into a struct, expose `Default()` accessor, add a way (via `export_test.go`) for tests to swap.

### Challenge 4: Singleton with lifecycle

Implement a singleton that periodically flushes metrics in a goroutine, with proper shutdown.

**Solution:** Accept `ctx context.Context` in constructor; goroutine watches `ctx.Done()`.

### Challenge 5: Multiple keys, singleton-per-key

Implement a connection pool per database. First call to `Get(name)` creates the pool; subsequent calls return the same pool.

**Solution:** `sync.Map` keyed by name, value is `*sync.Once`-protected pool.

---

## 6. System design starters

- **Replacing `http.DefaultClient`** — design a centralized HTTP client factory with timeouts, retries, and tracing.
- **Prometheus registry alternatives** — when should you use the default vs a custom registry?
- **Observability singleton** — global logger/tracer/metrics — how do they coexist?
- **Config singleton** — hot-reload strategy for production services.
- **DB connection pool** — singleton pool vs pool-per-tenant.

---

## 7. Traps

- **Init order surprises** — cross-package var init dependencies.
- **Mutation of `Default()`** — shared singleton mutated by one caller affects all.
- **Double-checked locking without atomics** — race + memory ordering bug.
- **`sync.Once` panic** — `Once` is marked done even on panic.
- **Test pollution** — test sets singleton, doesn't restore.

---

## 8. Questions to ASK

- "What's your team's policy on singletons vs DI?"
- "How do you test singleton-using code?"
- "Have you migrated away from any singletons? What was the trigger?"
- "How do you handle config reload?"

---

## 9. Cross-references

- **`../06-factory-pattern/`** — Singleton is a cached factory.
- **`../03-strategy-pattern/`** — Singletons often *hold* strategies.
- **`../04-decorator-pattern/`** — Singletons are often decorated (logging, metrics).
- **`../18-registry-pattern/`** — Multiton (registry of singletons).

Singleton in Go is more controversial than in Java. Idiomatic Go pushes toward DI; singletons are reserved for OS resources and observability. Knowing when *not* to use Singleton is the senior-level signal.
