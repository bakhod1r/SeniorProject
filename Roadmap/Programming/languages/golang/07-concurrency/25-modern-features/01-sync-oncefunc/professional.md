---
layout: default
title: sync.OnceFunc — Professional
parent: sync.OnceFunc/OnceValue/OnceValues
grand_parent: Modern Concurrency Features
ancestor: Go
nav_order: 3
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/25-modern-features/01-sync-oncefunc/professional/
---

# sync.OnceFunc — Professional

[← Back](../)

## Where these helpers belong in a production codebase

The three helpers map to three production patterns:

1. **`OnceFunc`** — side-effecting one-shot work: registering a shutdown hook, closing a connection, releasing a file descriptor, flushing a buffer at process exit. The wrapper has the shape of a `Close()` method and is the cleanest way to make `Close` idempotent.
2. **`OnceValue`** — lazy single-value caches: package-level loggers, parsed templates, compiled regexes, opened files, precomputed lookup tables. Anything you want to spend the construction cost on only if and when the program actually needs it.
3. **`OnceValues`** — the `(T, error)` flavor of (2): "load this config and return it, or the error that prevented loading". Almost every real loader in a real service has this signature.

Across the three, the dominant production benefit is *removing state*. The pre-1.21 idiom required two variables (a `sync.Once` and the cached result) and two functions (the init and the accessor). With `OnceValue` you have one variable (the wrapper) which is also the accessor. That single point of state is much easier to reason about, mock, replace, or move between packages.

## Pattern 1 — Idempotent close

Most resources in Go expose a `Close() error`. The convention is that `Close` is safe to call multiple times — the second call should be a no-op (or return the same error). The pre-1.21 idiom:

```go
type Conn struct {
    closeOnce sync.Once
    closeErr  error
    raw       *net.TCPConn
}

func (c *Conn) Close() error {
    c.closeOnce.Do(func() {
        c.closeErr = c.raw.Close()
    })
    return c.closeErr
}
```

Two fields of bookkeeping (`closeOnce`, `closeErr`) for one idea (idempotent close). Post-1.21:

```go
type Conn struct {
    close func() error
    raw   *net.TCPConn
}

func NewConn(raw *net.TCPConn) *Conn {
    c := &Conn{raw: raw}
    c.close = sync.OnceValue(func() error {
        return c.raw.Close()
    })
    return c
}

func (c *Conn) Close() error { return c.close() }
```

The `Conn` now has a single `close` field that *is* the idempotent operation. There is no separate `closeErr` because the captured return value of `OnceValue` plays that role.

## Pattern 2 — Lazy package-level init

A common case: a metrics package that registers counters with Prometheus, but only if the app actually emits metrics. Pre-1.21:

```go
var (
    registerOnce sync.Once
    counter      *prometheus.CounterVec
)

func ensureRegistered() {
    registerOnce.Do(func() {
        counter = prometheus.NewCounterVec( /* ... */ )
        prometheus.MustRegister(counter)
    })
}

func Increment(label string) {
    ensureRegistered()
    counter.WithLabelValues(label).Inc()
}
```

Post-1.21:

```go
var counter = sync.OnceValue(func() *prometheus.CounterVec {
    c := prometheus.NewCounterVec( /* ... */ )
    prometheus.MustRegister(c)
    return c
})

func Increment(label string) {
    counter().WithLabelValues(label).Inc()
}
```

Six lines become four. More importantly, there is no ambient state — `counter` is a function, and `counter()` is the only way to reach the underlying metric.

## Pattern 3 — Replacing sync.Once in shutdown handlers

Process-level cleanup ("flush logs, close DB pool, deregister from service discovery") is almost always `sync.Once`-protected because both `SIGTERM` and a panic recovery path can trigger it. With `OnceFunc`:

```go
var shutdown = sync.OnceFunc(func() {
    logFlush()
    dbPool.Close()
    serviceRegistry.Deregister()
})

func main() {
    defer shutdown()

    sigCh := make(chan os.Signal, 1)
    signal.Notify(sigCh, syscall.SIGTERM, syscall.SIGINT)
    go func() {
        <-sigCh
        shutdown()
        os.Exit(0)
    }()

    serve()
}
```

The `defer shutdown()` and the signal handler both call `shutdown`. Whichever fires first wins; the other is a no-op. Without `OnceFunc` you would need a `sync.Once` and a `func shutdown()`, doubled.

## Pattern 4 — Lazy compiled regex

A common micro-optimization for regex-heavy hot paths is "compile once, use forever". Pre-1.21:

```go
var (
    rxOnce sync.Once
    rx     *regexp.Regexp
)

func match(s string) bool {
    rxOnce.Do(func() {
        rx = regexp.MustCompile(`^foo_\d+$`)
    })
    return rx.MatchString(s)
}
```

Post-1.21:

```go
var rx = sync.OnceValue(func() *regexp.Regexp {
    return regexp.MustCompile(`^foo_\d+$`)
})

func match(s string) bool { return rx().MatchString(s) }
```

(Note that for plain package-level regex you can also just use `var rx = regexp.MustCompile(...)`, which compiles at package init. `OnceValue` is the right choice when compilation is *expensive* and the regex *may never be used* — e.g., a feature flag-gated code path.)

## Pattern 5 — Lazy expensive cache

Imagine a startup-time GeoIP database lookup table that takes 200 ms to build. You don't want to pay that cost during startup if the feature is off:

```go
var geoTable = sync.OnceValue(func() *GeoTable {
    data, err := os.ReadFile("/etc/geo/cities.bin")
    if err != nil {
        panic(err)
    }
    return parseGeoTable(data)
})

func LookupCity(ip net.IP) string {
    return geoTable().Lookup(ip)
}
```

First request to `LookupCity` triggers parsing and pays the 200 ms; every subsequent request is a pure lookup. If the feature is never used, the file is never read.

## Panic semantics in production

The single biggest behavioral difference from `sync.Once.Do` is panic propagation. Imagine `parseGeoTable` corrupts and panics on the first call. With raw `sync.Once`:

- Goroutine A calls `geoTable()`, panics, the `Once` is marked done.
- Goroutine B calls `geoTable()`, sees the `Once` as done, gets a `nil` `*GeoTable`, dereferences it, crashes with a `nil pointer` panic that has nothing to do with the real problem.

With `OnceValue`:

- Goroutine A panics with the parse error, full stack trace into `parseGeoTable`.
- Goroutine B re-panics with the same value. Different stack, same payload.

If your service has a top-level `recover()` in the HTTP handler chain, the second case gives you a structured error to log; the first gives you a `nil pointer dereference` and an unhappy on-call. This is why the proposal made the new helpers re-panic and is the main reason to prefer them over `sync.Once` in any code that can panic.

## Production trap — failed init poisons the wrapper forever

The flip side of panic-reuse is that a *transiently* failing initializer (e.g., one that tries to open a network connection that's temporarily unavailable) cannot be retried. `OnceValue` is for "do this once and remember the result". If the result can be "wait, that failed, try again later", do not use these helpers. Use a `sync.Mutex` + retry logic, or `singleflight.Group`, or an explicit reconnect loop. Treat `OnceValue` as for *deterministic* initialization — config parsing, regex compilation, table building — not for I/O that might fail.

## Pattern 6 — Replacing `sync.Once` in an interface

If your code exposes a `Closer` interface:

```go
type Closer interface{ Close() error }
```

…the implementor pattern is `closer := makeIdempotent(realClose)`:

```go
func makeIdempotent(close func() error) func() error {
    return sync.OnceValue(close)
}
```

This factory is a one-liner that wraps any close-style function in an idempotent version. Without these helpers you would write a struct with a `sync.Once`, a stored function, and a `Close` method — five times the code.

## Testing helpers that use OnceValue at package scope

A common testing pain point is that `var load = sync.OnceValue(...)` is computed during the first call across the entire test binary. If `TestA` triggers it, `TestB` cannot get a fresh load. Two patterns:

1. **Inject the loader.** Don't make the wrapper a package var — make it a constructor parameter:

   ```go
   type Service struct{ load func() *Config }

   func NewService(load func() *Config) *Service { return &Service{load: load} }
   ```

   In production, callers pass `sync.OnceValue(parseConfig)`. In tests, pass a plain function or a fresh `sync.OnceValue` per test.

2. **Don't test the global cache.** Test the underlying function (`parseConfig`) directly, separately from the caching layer. The caching layer is two lines and doesn't need integration tests.

## Pattern 7 — Combining with `errgroup` for parallel lazy init

Two independent expensive resources that should both be lazily initialized but can be initialized in parallel:

```go
var (
    loadGeo  = sync.OnceValue(loadGeoTable)
    loadTags = sync.OnceValue(loadTagTable)
)

func warm(ctx context.Context) error {
    var g errgroup.Group
    g.Go(func() error { loadGeo(); return nil })
    g.Go(func() error { loadTags(); return nil })
    return g.Wait()
}
```

`warm` is optional — anything that calls `loadGeo()` later still triggers init on demand. But during a controlled startup or pre-warm, you can run both in parallel.

## Pattern 8 — Composing OnceValue with dependency injection

Larger services often wire dependencies through constructors. `sync.OnceValue` plays well with this style — instead of building dependencies eagerly in `NewService`, capture lazy accessors:

```go
type Service struct {
    db      func() *sql.DB
    cache   func() *redis.Client
    logger  func() *slog.Logger
}

func NewService(dsn, redisAddr, logPath string) *Service {
    s := &Service{}

    s.db = sync.OnceValue(func() *sql.DB {
        db, err := sql.Open("postgres", dsn)
        if err != nil {
            panic(fmt.Errorf("open db: %w", err))
        }
        return db
    })

    s.cache = sync.OnceValue(func() *redis.Client {
        return redis.NewClient(&redis.Options{Addr: redisAddr})
    })

    s.logger = sync.OnceValue(func() *slog.Logger {
        f, err := os.OpenFile(logPath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0644)
        if err != nil {
            panic(err)
        }
        return slog.New(slog.NewJSONHandler(f, nil))
    })

    return s
}

func (s *Service) Handle(req Request) error {
    s.logger().Info("handling", "id", req.ID)
    if cached, ok := s.cache().Get(req.ID).Result(); ok == nil {
        return s.respond(cached)
    }
    var data string
    err := s.db().QueryRow("SELECT data FROM x WHERE id = $1", req.ID).Scan(&data)
    if err != nil {
        return err
    }
    s.cache().Set(req.ID, data, 0)
    return s.respond(data)
}
```

Three dependencies, each lazily initialized on first use. If `Handle` is never called, none of them are constructed — `NewService` is essentially free. If the DB connection fails the first time, every subsequent `s.db()` call panics with the same error — the failure is fail-fast and visible at every call site, not silently nil.

The same code with raw `sync.Once` would have three `Once` fields, three result fields, three accessor methods, and three sets of error handling. Counting fields and methods, the `OnceValue` version is around half the size.

## Pattern 9 — Wrapping third-party clients

A common production need: a third-party SDK (AWS, GCP, etc.) where you want a single client per process, lazily initialized:

```go
package awsclient

import (
    "context"
    "sync"

    "github.com/aws/aws-sdk-go-v2/config"
    "github.com/aws/aws-sdk-go-v2/service/s3"
)

var S3 = sync.OnceValues(func() (*s3.Client, error) {
    cfg, err := config.LoadDefaultConfig(context.Background())
    if err != nil {
        return nil, err
    }
    return s3.NewFromConfig(cfg), nil
})
```

Callers in any package say `awsclient.S3()`. The SDK's connection pool is built once per process. If credentials fail to load, every caller sees the same error.

This is a much cleaner pattern than the "global mutex + global pointer" approach that's common in older Go codebases.

## Pattern 10 — Long-lived background goroutines kicked off by OnceFunc

A pattern that appears in production gateways and brokers:

```go
type Broker struct {
    startWorkers func()
    queue        chan Message
}

func New() *Broker {
    b := &Broker{queue: make(chan Message, 1024)}
    b.startWorkers = sync.OnceFunc(func() {
        for i := 0; i < runtime.NumCPU(); i++ {
            go b.worker()
        }
    })
    return b
}

func (b *Broker) Publish(m Message) {
    b.startWorkers()
    b.queue <- m
}
```

The worker pool is created on the first `Publish` call, not in `New`. This means an idle broker uses zero goroutines, and the first publish pays the (small) cost of starting goroutines. Subsequent publishes go straight to the channel send.

Note: this pattern conflates "init" with "start" — the workers run forever once started. If your `Broker` should support `Stop()`, you'll need additional state (a context, a `sync.WaitGroup`) to coordinate shutdown. The OnceFunc only handles the start side.

## Pattern 11 — Cleaner singleton in libraries

If your library exposes a singleton (`pkg.Default`, `pkg.Global`, etc.), the historical pattern was:

```go
var (
    defaultOnce sync.Once
    defaultObj  *Foo
)

func Default() *Foo {
    defaultOnce.Do(func() {
        defaultObj = newFoo()
    })
    return defaultObj
}
```

Modern equivalent:

```go
var Default = sync.OnceValue(newFoo)
```

`Default` is now a function (`func() *Foo`) rather than a function declaration that hides state. Callers say `pkg.Default()` — identical syntax — and the library is one variable lighter.

Some libraries take this further and expose the lazy initializer directly as a package variable:

```go
var DefaultLogger = sync.OnceValue(func() *slog.Logger {
    return slog.New(slog.NewJSONHandler(os.Stderr, nil))
})
```

…and document that callers must use `DefaultLogger()` (with parens) to get the actual logger. This is a minor break with the older "package-level value" idiom but a worthwhile one — it makes the laziness explicit.

## Pattern 12 — Mocking out a OnceValue in tests

A test challenge: your code under test uses a package-level `var Load = sync.OnceValue(...)`. The first test triggers it; later tests want a fresh load. There is no `Reset`, so what now?

Three common solutions, in increasing order of cleanliness:

**Solution A — Inject the loader.** Don't expose `Load` directly; let callers receive it:

```go
type Worker struct {
    load func() (*Config, error)
}

func NewWorker(load func() (*Config, error)) *Worker {
    return &Worker{load: load}
}

// Production:
w := NewWorker(sync.OnceValues(realLoad))

// Tests:
w := NewWorker(func() (*Config, error) { return testCfg, nil })
```

Each test instantiates `Worker` with a fresh loader. No package-level state to reset.

**Solution B — Variable reassignment in a helper.** If you can't refactor, expose a test-only helper:

```go
// load.go
var Load = sync.OnceValues(realLoad)

// load_test_helpers.go
//go:build test

func ResetForTest() {
    Load = sync.OnceValues(realLoad) // rebuild
}
```

This is racy in production (no synchronization on the variable assignment) but acceptable for sequential test setup.

**Solution C — Use `t.Cleanup` and a fresh test binary per test file.** If your test framework runs each file in a fresh `go test` invocation, the package-level state is naturally reset between runs. This is rare in Go (the default is one binary per package) but possible with custom build tags.

In practice, Solution A is the right answer for new code. Solution B is the right answer for retrofitting old code that you can't reorganize.

## Pattern 13 — Conditional cleanup

Sometimes you want a cleanup to run *only if* setup succeeded. Naively:

```go
setup := sync.OnceFunc(func() {
    openFile()
    startBackground()
})

cleanup := sync.OnceFunc(func() {
    stopBackground()
    closeFile()
})

defer cleanup()
setup()
```

Problem: if `setup` panics in the middle (say, `openFile` succeeded but `startBackground` failed), `cleanup` still runs and tries to stop a background that was never started. Solutions:

**A. Build cleanup incrementally:**

```go
var cleanups []func()
cleanupAll := sync.OnceFunc(func() {
    for i := len(cleanups) - 1; i >= 0; i-- {
        cleanups[i]()
    }
})
defer cleanupAll()

openFile()
cleanups = append(cleanups, closeFile)

startBackground()
cleanups = append(cleanups, stopBackground)
```

If `startBackground` panics, only `closeFile` is in the cleanup slice; the cleanup runs the file close but does not try to stop a nonexistent background.

**B. Use `OnceValue[error]` for setup and check inside cleanup:**

```go
setupErr := sync.OnceValue(func() error {
    if err := openFile(); err != nil {
        return err
    }
    if err := startBackground(); err != nil {
        return err
    }
    return nil
})

cleanup := sync.OnceFunc(func() {
    if setupErr() == nil {
        stopBackground()
        closeFile()
    }
})
```

Slightly clumsier but the conditional is explicit.

## Production observability: tracking which OnceValues have fired

For long-lived services it's sometimes useful to know which lazy initializers have fired. Since `sync.OnceValue` doesn't expose that, you have to wrap it:

```go
type Tracked[T any] struct {
    fired atomic.Bool
    get   func() T
}

func NewTracked[T any](f func() T) *Tracked[T] {
    t := &Tracked[T]{}
    t.get = sync.OnceValue(func() T {
        defer t.fired.Store(true)
        return f()
    })
    return t
}

func (t *Tracked[T]) Get() T          { return t.get() }
func (t *Tracked[T]) HasFired() bool { return t.fired.Load() }
```

You can then expose `/debug/once-status` style introspection or simply log which initializers have completed. The atomic store inside the closure makes the "has fired" check race-free.

This is a minor pattern but useful in services where slow lazy init has been a cause of timeouts and you want to see, in real time, which initializers are running on which goroutines.

## Pattern 14 — Don't OnceValue something that should be per-request

A common mistake when first adopting `OnceValue`: wrapping things that have a clear per-request lifetime.

```go
// BAD:
var GetUserID = sync.OnceValue(func() string {
    return generateUUID()
})
```

This generates one UUID, ever, for the entire process lifetime. Every caller receives the same UUID. That is not what "generate a user ID" means.

The rule: `OnceValue` is for things that should be the *same* across all callers. If the answer is "no, each call should produce its own value", you want a plain function, not a OnceValue.

## When to migrate existing code

If you have an existing Go 1.21+ codebase with widespread `sync.Once`, should you migrate? The cost-benefit is straightforward:

- **Pure stylistic migration:** Low value. The old code works. Don't churn a production codebase just for aesthetics.
- **Migration as part of touching a file:** Worth it. If you're already editing a file with a `sync.Once`, replacing it with `OnceValue` typically removes 5–10 lines and one field — net negative diff.
- **Migration to fix panic-on-second-call bugs:** Definitely worth it. If you've ever had a "nil pointer in handler" outage that turned out to be a panicking initializer + silent re-call, switching to `OnceValue` mechanically prevents the next occurrence.
- **Migration for performance:** Almost never. The performance difference is sub-nanosecond per call.

A reasonable team policy: "new code uses the helpers; old code is migrated opportunistically; no rewrite-everything sprints."

## Production trap — interaction with init order

Package-level `var Foo = sync.OnceValue(...)` is evaluated during package init. The wrapper itself is constructed eagerly, but its wrapped function runs lazily. This usually does not matter, but if your wrapped function transitively depends on another package's init, you might find that the lazy first call happens *before* the dependent package is fully initialized.

The fix is the usual Go init-order discipline: don't call cross-package lazy loaders inside `init()` functions, and document any implicit ordering assumptions. In practice this is rarely a problem because the helpers' lazy nature defers the actual work to user code, which runs after all `init()` chains have finished.

## Pattern 16 — Atomic readiness probe

Sometimes you want a readiness endpoint that returns true once initialization has succeeded:

```go
var (
    ready    atomic.Bool
    setupRun = sync.OnceFunc(func() {
        performSetup()
        ready.Store(true)
    })
)

func Setup()    { setupRun() }
func IsReady() bool { return ready.Load() }
```

The `OnceFunc` ensures `performSetup` runs exactly once; the atomic flag exposes whether it has *finished*. Note that `IsReady` is a snapshot: a caller observing `false` cannot tell whether setup is in progress or has not started.

A cleaner alternative if you want "block until ready" rather than "ask if ready" is:

```go
var setupRun = sync.OnceFunc(performSetup)

func WaitReady() { setupRun() } // blocks if not yet run; returns immediately if done
```

This unifies "kick off setup" and "wait for setup" into a single call.

## Pattern 17 — Distributed initialization across multiple packages

In a large codebase, init logic often spans packages: `db.Init()`, `cache.Init()`, `metrics.Init()`. Historically each package had its own `sync.Once` and `Init()` function, and the application's `main` called them in the right order. With the helpers, each package can expose a lazy initializer:

```go
// package db
var Conn = sync.OnceValue(func() *sql.DB { return openDB() })

// package cache
var Client = sync.OnceValue(func() *redis.Client { return openRedis() })

// package metrics
var Registry = sync.OnceValue(func() *prometheus.Registry { return newRegistry() })
```

Now `main` doesn't need to call init in any order; the first caller of each package's lazy accessor triggers its init. If `main` wants explicit ordering it calls `db.Conn()`, `cache.Client()`, `metrics.Registry()` in turn. If not, the system self-orders by usage.

This is a substantial simplification of the "init function chain" pattern that dominates older Go codebases.

## Pattern 18 — Wrapper as the public API

A package's entire public API can sometimes collapse into a single lazy accessor:

```go
package geoip

import (
    "sync"
)

var Lookup = sync.OnceValue(func() Lookuper {
    return loadGeoIPDatabase()
})
```

Callers say `geoip.Lookup().City(ip)`. There is no `Init`, no `MustInit`, no `Open` — just a single function whose first call does everything. For internal-tools-style packages this can be a dramatic simplification.

## Anti-pattern — Using OnceValue as a write-once container

Sometimes engineers reach for `sync.OnceValue` because they want "set once, read many". For example:

```go
var setCfg = sync.OnceValue(func() *Config {
    return externalProvidedConfig
})
```

…where `externalProvidedConfig` is supposed to be set by `main` before any code reads it. This is the wrong primitive. `OnceValue` is for *computing* a value lazily, not for receiving one. If you have a value that's set once externally, use `atomic.Pointer[T]` and explicit `Store`/`Load`, or pass the config through constructors. `OnceValue` makes the timing implicit and error-prone.

## Pattern 15 — Combining with context-aware shutdown

If your application uses `context.Context` for shutdown coordination, mesh it with `OnceFunc`:

```go
type Server struct {
    ctx      context.Context
    cancel   context.CancelFunc
    shutdown func()
}

func NewServer() *Server {
    ctx, cancel := context.WithCancel(context.Background())
    s := &Server{ctx: ctx, cancel: cancel}
    s.shutdown = sync.OnceFunc(func() {
        cancel()
        // additional cleanup
    })
    return s
}

func (s *Server) Stop() { s.shutdown() }
```

Calling `Stop` multiple times is safe — `cancel` is itself idempotent, but wrapping it in `OnceFunc` lets you bundle additional cleanup that must run exactly once.

## Summary checklist

- Default to `OnceFunc`/`OnceValue`/`OnceValues` for any new code that would have used `sync.Once`.
- Reach for the `*T` form (`OnceValue[*Config]`) for any non-trivial struct.
- Make idempotent `Close` methods with `OnceValue[error]`.
- Make shutdown hooks with `OnceFunc`.
- Never use these for retryable init — the panic-reuse contract is the wrong semantics.
- In tests, inject the wrapper, do not rely on resetting a package-level cache.
