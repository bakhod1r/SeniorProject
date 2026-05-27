# Singleton Pattern — Senior

## 1. What this level covers

Junior taught the shape; middle covered `sync.Once` internals and testability. Senior is about *architectural decisions*:

- When Singleton is appropriate vs harmful.
- The case for replacing singletons with dependency injection.
- Hot-reload singletons via `atomic.Pointer`.
- Process-wide observability (tracing, metrics) — singletons that pay their cost.
- Real Go ecosystem examples: `http.DefaultClient`, `slog.Default()`, Prometheus default registry.
- Anti-patterns at scale: mutable globals, init-order surprises, singleton with goroutines.
- Cross-language comparison.
- 4 postmortems from real production incidents.

The decisions here are *architectural*. Once a singleton is established in a codebase, it's painful to remove. Pick the right path at v1.

---

## 2. Table of Contents

1. [What this level covers](#1-what-this-level-covers)
2. [Table of Contents](#2-table-of-contents)
3. [The case against Singleton](#3-the-case-against-singleton)
4. [When Singleton is appropriate](#4-when-singleton-is-appropriate)
5. [Replacing Singleton with DI: a migration plan](#5-replacing-singleton-with-di-a-migration-plan)
6. [Hot-reload via atomic.Pointer](#6-hot-reload-via-atomicpointer)
7. [Process-wide observability](#7-process-wide-observability)
8. [Real Go ecosystem singletons](#8-real-go-ecosystem-singletons)
9. [Anti-patterns at scale](#9-anti-patterns-at-scale)
10. [Singleton vs functional options](#10-singleton-vs-functional-options)
11. [Cross-language comparison](#11-cross-language-comparison)
12. [Postmortems](#12-postmortems)
13. [Common senior mistakes](#13-common-senior-mistakes)
14. [Tricky questions](#14-tricky-questions)
15. [Cheat sheet](#15-cheat-sheet)
16. [Further reading](#16-further-reading)

---

## 3. The case against Singleton

Singletons are global state. Most of what's bad about global state applies to Singletons:

### 3.1 Hidden dependencies

```go
// Looks like a pure function
func ProcessOrder(o Order) error {
    return db.Save(o)  // depends on package-level db singleton
}
```

The function's signature lies. It depends on `db`, but nothing in the type system says so. Readers must grep the codebase to find the dependency. Tests must initialize `db` even when they don't care about persistence.

### 3.2 Testability collapses

```go
func TestProcessOrder(t *testing.T) {
    // How do I substitute a test database?
}
```

If `db` is set in `init()` or reads from environment, the test must either:
- Mutate the global (race-prone, leaks state across tests).
- Spin up a real DB (slow, flaky, requires CI infrastructure).

Both are worse than passing `db` as a parameter.

### 3.3 Concurrency hazards

A mutable singleton with state is a recipe for races:

```go
var cache = map[string]any{}

func Get(k string) any { return cache[k] }  // race
func Set(k string, v any) { cache[k] = v }  // race
```

Mutex helps — but now every read pays lock overhead. Compare with passing a `*sync.Map` (or local cache) per request.

### 3.4 Lifecycle confusion

When is the singleton initialized? When is it torn down? In Go, the answer is usually "at first use" and "never". Components with proper Init/Shutdown can't easily fit the singleton pattern.

### 3.5 The right reaction

The right default is *not* "use Singleton". The right default is *pass dependencies explicitly* (DI or via constructor parameters). Singleton earns its place only when:

- The instance represents a *process-wide* resource (logs, metrics, tracing).
- The cost of passing it everywhere exceeds the cost of accepting global state.
- The instance is *truly* one-per-process (replacing it is meaningless).

---

## 4. When Singleton is appropriate

Three categories:

### 4.1 Process-wide stdlib resources

```go
os.Stdin, os.Stdout, os.Stderr  // OS-provided
time.Local, time.UTC            // OS-provided
crypto/rand.Reader              // OS-provided RNG
```

These *are* the resources; not "one of many". No DI helps.

### 4.2 Application observability

```go
slog.Default()      // logger
prometheus.DefaultRegisterer  // metrics
otel.Tracer("...")  // tracing
```

Observability instrumentation must reach every code path. Threading a logger through every function call is impractical. Singletons (or facades around them) are accepted.

### 4.3 Truly-single resources

```go
db *sql.DB  // connection pool — one per process
```

A `*sql.DB` *is* a pool; multiple instances mean multiple pools, which usually isn't what you want. Either accept it as a singleton or hide it behind a factory that returns the singleton.

### 4.4 The non-case

A singleton "client" for an external service is usually a *bad* singleton because:
- Tests need a fake.
- Multiple regions / tenants need different clients.
- Configuration changes require restart unless hot-reload is built in.

Use DI for these.

---

## 5. Replacing Singleton with DI: a migration plan

You inherit a codebase with global singletons. How to migrate without disrupting features:

### Step 1 — Extract the singleton into a struct field

```go
// Before
var db *sql.DB

func ProcessOrder(o Order) error {
    return db.Exec(...)
}

// After
type OrderService struct {
    db *sql.DB
}

func (s *OrderService) ProcessOrder(o Order) error {
    return s.db.Exec(...)
}
```

Now `OrderService` has the dependency *visibly*. The old global still exists for backward compatibility.

### Step 2 — Wire at startup

```go
func main() {
    db := setupDB()
    svc := &OrderService{db: db}
    svc.Run()
}
```

The composition root (`main()`) becomes the owner of dependencies.

### Step 3 — Remove the global

Once all callers go through `OrderService`, delete the package-level `db` variable. Compile errors flush out any remaining references.

### Step 4 — Test isolation

Tests can now substitute `OrderService.db` with a test database or mock.

```go
func TestProcessOrder(t *testing.T) {
    svc := &OrderService{db: testDB}
    err := svc.ProcessOrder(Order{...})
    // assert
}
```

The migration is incremental. Each step preserves working code; you can pause at any point without breaking anything.

---

## 6. Hot-reload via atomic.Pointer

Some singletons must be replaceable at runtime (config reload, certificate rotation). The pattern:

```go
type Config struct {
    /* ... immutable after construction ... */
}

var config atomic.Pointer[Config]

func init() {
    initial := loadConfig()
    config.Store(initial)
}

func Get() *Config { return config.Load() }

func Reload() error {
    next, err := loadConfig()
    if err != nil { return err }
    config.Store(next)  // atomic swap
    return nil
}
```

Three guarantees:

1. **Readers always see a complete Config.** No torn reads.
2. **No locking on the read path.** Single atomic load.
3. **Reload is non-blocking.** The old config is replaced; in-flight code using the old pointer continues unaffected.

### 6.1 Drain semantics

What happens to the old config? Go's garbage collector reclaims it when no goroutine holds a reference. In-flight requests using the old pointer complete naturally; new requests pick up the new pointer.

If you need *immediate* drain (force in-flight users to switch), maintain a reference counter — but this is rarely worth the complexity.

### 6.2 When to use

- Configuration changes (database connection strings, feature flags).
- Certificate rotation (TLS, JWT signing keys).
- A/B routing (swap entire backend implementations).

### 6.3 When NOT to use

- When the new value depends on in-flight state. Hot-swap can't preserve mid-flight transactions.
- When eventual consistency isn't acceptable. There's always a window where some goroutines use the old value.

---

## 7. Process-wide observability

Observability singletons are *the* accepted use case.

### 7.1 slog.Default() and SetDefault

```go
slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, nil)))

// Anywhere in the codebase:
slog.Info("event", "key", value)
```

The default logger is settable but typically configured once at startup. Tests can override.

### 7.2 prometheus.DefaultRegisterer

```go
counter := prometheus.NewCounter(prometheus.CounterOpts{...})
prometheus.MustRegister(counter)
// counter is now exposed at /metrics via the default registerer
```

Convenient but not test-isolatable. For tests, create a custom `prometheus.NewRegistry()`.

### 7.3 otel.Tracer("name")

```go
tracer := otel.Tracer("my-service")
ctx, span := tracer.Start(ctx, "ProcessOrder")
defer span.End()
```

The tracer provider is a global singleton (configured at startup). Per-component tracers are created lazily but share the singleton provider.

### 7.4 The pattern

All three follow: *global default + per-component customization*. The default is the singleton; specific code paths can override.

This is the *least-bad* singleton pattern: it offers convenience for typical use, allows customization where needed, and doesn't lock the architecture.

---

## 8. Real Go ecosystem singletons

### 8.1 http.DefaultClient (was a mistake)

```go
resp, err := http.Get(url)  // uses http.DefaultClient
```

Convenient — until you discover `DefaultClient` has no timeout, callers mutate its `Transport`, and every test using `http.Get` shares state.

Modern best practice: never use `http.DefaultClient`. Always construct a fresh `*http.Client` with explicit timeout. The `http.Get`/`http.Post` package-level functions exist for backward compatibility but should be avoided in new code.

Lesson: convenience singletons accumulate cost. The Go stdlib regrets this one (see [proposal #25988](https://github.com/golang/go/issues/25988)).

### 8.2 sql.Drivers() (good)

```go
sql.Register("postgres", &pq.Driver{})
sql.Open("postgres", dsn)
```

The driver registry is a singleton — but it's *populated* via `Register`, not mutated. Once initialized, it's effectively immutable. This is the *good* singleton: it's a registry, not state.

### 8.3 testing.T (per-test, but global within the test)

The `t *testing.T` is per-test, but acts as a singleton *within* the test's scope. Methods like `t.Helper()`, `t.Cleanup()` rely on the implicit `t` being available.

### 8.4 runtime.GOMAXPROCS (process-wide)

```go
runtime.GOMAXPROCS(8)
```

A process-wide setting. Mutating it after startup is *legal* but discouraged — affects every goroutine. Acceptable singleton because the underlying resource (CPU threads) genuinely is one-per-process.

---

## 9. Anti-patterns at scale

### 9.1 The mutable global

```go
var Config = map[string]string{}

func init() {
    Config["env"] = "dev"
}

// Anywhere:
Config["env"] = "prod"  // race + spooky action at distance
```

Tests, plugins, debug code — anything can mutate. Symptoms:
- "Why is my config wrong on this server?" — turns out package X mutated it during init.
- Tests pollute each other.

Fix: make config immutable; mutations go through `Reload()` with `atomic.Pointer`.

### 9.2 Init() side effects

```go
func init() {
    db = openDB(os.Getenv("DSN"))
    metrics = startMetricsServer()
    cache = warmCache()
}
```

`init()` runs at package load. Problems:
- Failure crashes the binary; no chance to recover.
- Network calls block startup.
- Tests can't avoid the I/O.

Fix: defer initialization to explicit `Init(ctx)` calls from `main()`.

### 9.3 Singleton with goroutines

```go
var bg = startBackgroundWorker()  // package-level var
```

The goroutine runs forever. Tests can't stop it. Process shutdown can't drain it.

Fix: accept `context.Context` for cancellation; expose `Close()`.

### 9.4 Multiple singletons sharing one sync.Once

```go
var once sync.Once

func InitDB() { once.Do(setupDB) }
func InitCache() { once.Do(setupCache) }  // ?
```

If `InitDB` is called first, `setupCache` never runs. The single `Once` is the problem. Use one `sync.Once` per initialization.

### 9.5 Stale singletons

```go
var apiClient = newClient(cfg.APIKey)

// Six months later:
cfg.APIKey = "new-key"  // apiClient still uses old key
```

The singleton captured the value at init time. Updates don't propagate. Fix: hot-reload via `atomic.Pointer`, or accept the singleton's immutability.

---

## 10. Singleton vs functional options

A common evolution: a function takes a singleton, then gets refactored to accept options.

```go
// Singleton-using
func Process(o Order) error {
    return db.Save(o)
}

// Options-based
func Process(o Order, opts ...Option) error {
    cfg := defaultConfig()
    for _, opt := range opts { opt(cfg) }
    return cfg.db.Save(o)
}
```

The options-based version is more testable but more verbose. Decision:

- For *infrastructure* singletons (logger, metrics): keep using the singleton. The convenience justifies the coupling.
- For *business* dependencies (database, message queue): refactor to DI. The testability matters more.

The line is fuzzy. Reasonable teams disagree. The discipline is: be intentional about which side of the line each dependency is on.

---

## 11. Cross-language comparison

| Language | Singleton pattern |
|----------|-------------------|
| Java | `enum` singletons (Joshua Bloch's recommendation); `private constructor + static field` |
| C# | Static class; `Lazy<T>` for thread-safe lazy init |
| Kotlin | `object SingletonName { ... }` — language built-in |
| Rust | `lazy_static!` macro; `OnceCell` standard library |
| Python | `__new__` override; module-level variables are de-facto singletons |
| Scala | `object SingletonName` (like Kotlin) |

Go's `sync.Once` is closest to Rust's `OnceCell`. Both lazy-initialize on first access; both are thread-safe. Java's enum approach is unique — leverages the language's enum semantics to guarantee singleton-ness.

The pattern is universal; the syntax varies.

---

## 12. Postmortems

### 12.1 The shared map race

A service had `var cache = map[string]any{}`. Two requests calling `cache[key] = value` simultaneously occasionally crashed with "concurrent map writes". Race detector was off in production builds; the bug surfaced only under load.

**Diagnosis:** unsynchronized access to a shared map.
**Fix:** `sync.Map` for the cache. The performance was acceptable; the safety was critical.
**Lesson:** package-level mutable state needs explicit synchronization or immutability.

### 12.2 The init-order surprise

A logging library's `init()` opened a file for writing. The application's `init()` set `os.Stdout` to a custom writer. Depending on which `init()` ran first, the logger wrote to one place or another.

**Diagnosis:** init order depends on import order, which is fragile.
**Fix:** moved logger initialization to an explicit `InitLogger(ctx)` called from `main()` after all flags are parsed.
**Lesson:** `init()` is for side-effect-free constants and registry registration. Anything more belongs in `main()`.

### 12.3 The leaked singleton goroutine

A test suite created many test instances, each calling `metrics.Init()`. The first call started a goroutine that flushed metrics every second. After 1000 tests, 1000 goroutines were running. CI memory exploded.

**Diagnosis:** singleton's goroutine wasn't cleaned up between tests.
**Fix:** changed singleton to use `context.Context`; tests cancel after teardown.
**Lesson:** singletons with goroutines need explicit lifecycle.

### 12.4 The stale config

A production service cached an API key at startup. Three months later, the key rotated. The service kept using the old key — failures only became visible when the old key expired.

**Diagnosis:** singleton captured the value at init time.
**Fix:** `atomic.Pointer[Config]` with a reload trigger. Configuration changes propagated immediately.
**Lesson:** configuration that changes over time isn't a fit for a one-shot singleton.

---

## 13. Common senior mistakes

### 13.1 Reaching for Singleton out of habit

When in doubt, prefer DI. Singleton is a *specific* tool for *specific* situations (process-wide observability, OS resources). Default to passing dependencies.

### 13.2 Letting singletons grow

A "small" singleton accumulates features over time. The metrics singleton grows a cache, a goroutine, a reload mechanism, and 15 methods. Eventually it's untestable.

Refactor early: split into smaller types; expose them via constructor parameters.

### 13.3 Eager init in init()

`init()` is for cheap, side-effect-free initialization. Network calls, file reads, expensive setup belong in `main()`.

### 13.4 No way to reset for tests

Singletons that can't be reset trap tests in shared state. Provide an internal `reset()` (via `export_test.go`) or use `atomic.Pointer` with a `Reload()`.

### 13.5 Hidden globals via `Default()`

`func Default() *Thing { return defaultThing }` looks safe. But callers who modify `Default().field` mutate the shared instance. Either return a copy or unexported fields with setter methods.

### 13.6 Hot-reload without coordination

Replacing the singleton mid-flight is fine for stateless reads. For stateful operations (transactions, locks), in-flight requests using the old singleton may see inconsistent state. Plan the drain semantics.

---

## 14. Tricky questions

**Q1.** Why is `sync.Once` better than `init()` for lazy initialization?

<details><summary>Answer</summary>

`init()` runs unconditionally at package load. If the singleton isn't needed, the cost is wasted. If `init()` fails (network call, file read), the binary won't start.

`sync.Once` defers the work to first use. If the singleton isn't used, no work happens. If init fails, the caller sees the error and can fall back.

For startup-critical singletons (no fallback possible), `init()` is fine. For everything else, `sync.Once`.
</details>

**Q2.** A test sets a global singleton and forgets to restore it. How do you detect this in CI?

<details><summary>Answer</summary>

Run tests with `-count=2`. The second run starts from the polluted state. If results differ, the test is dependent on initial state — a leak.

Also: `-shuffle=on` randomizes test order. Hidden state dependencies surface as flaky tests.

Combined: `go test -shuffle=on -count=2 -race ./...` catches most singleton-pollution bugs.
</details>

**Q3.** When is `atomic.Pointer[T]` better than `sync.RWMutex` for a singleton?

<details><summary>Answer</summary>

When reads vastly outnumber writes (100:1 or more), `atomic.Pointer` removes lock overhead from the read path.

- `RWMutex.RLock`: ~10ns (uncontended).
- `atomic.Pointer.Load`: ~2ns.

For singletons read on every request, the 5× speedup is measurable. For singletons read once per app lifetime, it's invisible.
</details>

**Q4.** Should `Default()` return a copy or the original?

<details><summary>Answer</summary>

Depends on what you want:

- **Original:** callers can mutate it, affecting all other callers. Useful for shared state (e.g., a global logger where adding a hook should apply globally). Risky.
- **Copy:** callers can mutate without affecting others. Loses the "shared singleton" property — each caller has their own.

If you want shared mutability, document it. If not, return a fresh instance and rename to `New()`.
</details>

**Q5.** Why is the Java enum singleton considered the best?

<details><summary>Answer</summary>

Three reasons:
1. Thread-safe by JVM guarantee (class loading is synchronized).
2. Serialization-safe (no extra copies via deserialization).
3. Reflection-resistant (JVM prevents creating new enum instances).

Go has none of these. The closest equivalent is package-level var with `sync.Once`, which handles thread-safety but not the others (serialization isn't a Go concern, reflection still works).

The Java pattern is *language-specific*. Go's approach is sufficient for Go's needs.
</details>

---

## 15. Cheat sheet

| Goal | Approach |
|------|----------|
| Lazy init of a process-wide resource | `sync.Once` |
| Eager init at startup | Package var + `init()` (simple cases) |
| Hot-reload | `atomic.Pointer[T]` |
| Reset for tests | `export_test.go` + reset function |
| Returning to fresh instance | Use `New()`, not `Default()` |
| Default with override | `Default()` for shared singleton; constructor for custom |
| Avoiding global state | Use DI; pass dependencies explicitly |
| Goroutine in singleton | Accept `context.Context`; provide `Close()` |
| Shared map | `sync.Map` or `RWMutex` around `map[K]V` |
| Init with potential failure | `sync.Once` capturing error |

---

## 16. Further reading

- **Joshua Bloch, "Effective Java" Item 3** — enum singleton
- **Mark Seemann, "Dependency Injection Principles, Practices, and Patterns"** — the case for DI over singletons
- **Go proposal #25988** — `http.DefaultClient` retrospective
- **`src/sync/once.go`** — sync.Once implementation
- **`src/log/slog/`** — Default + SetDefault pattern
- **prometheus/client_golang** — DefaultRegisterer pattern
- **otel.Tracer documentation** — global provider pattern
- **GoF, "Design Patterns" (1994)** — the original Singleton

Singletons are over-applied. The senior-level skill is *limiting* their use to cases where the trade-offs make sense — observability, OS resources, truly process-wide things — and using DI for everything else.
