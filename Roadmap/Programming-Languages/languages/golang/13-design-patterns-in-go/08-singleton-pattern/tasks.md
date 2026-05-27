# Singleton Pattern — Hands-on Tasks

## 1. How to use this file

Fifteen progressive tasks. Each has:

- **Problem statement** — the scenario.
- **Acceptance criteria** — checkboxes you should satisfy.
- **Hints** (collapsible) — reach for them if stuck.
- **Solution** (collapsible) — full compilable Go.
- **Discussion** — trade-offs you missed.

All code is written for Go 1.22+. Use `go run` to verify; the solutions assume a `package main` unless otherwise noted. A few tasks split into multiple files — those are marked.

---

## Task 1 — Basic `sync.Once` singleton

Build a `Config` singleton that lazily loads from a fake "file" exactly once, no matter how many goroutines call the accessor concurrently.

```go
type Config struct {
    DBHost string
    Port   int
}
```

**Acceptance criteria:**
- [ ] One exported function `GetConfig() *Config`.
- [ ] Underlying loader runs exactly once even under heavy concurrent access.
- [ ] No exported package variables.

<details><summary>Hints</summary>

- `sync.Once.Do(f)` guarantees `f` runs exactly once across all goroutines.
- Keep the instance and the `Once` as unexported package-level vars.
- The loader should print a message so you can confirm it ran once.
</details>

<details><summary>Solution</summary>

```go
package main

import (
    "fmt"
    "sync"
)

type Config struct {
    DBHost string
    Port   int
}

var (
    cfgOnce sync.Once
    cfg     *Config
)

func GetConfig() *Config {
    cfgOnce.Do(func() {
        fmt.Println("loading config...")
        cfg = &Config{DBHost: "localhost", Port: 5432}
    })
    return cfg
}

func main() {
    var wg sync.WaitGroup
    for i := 0; i < 10; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            c := GetConfig()
            _ = c
        }()
    }
    wg.Wait()
    fmt.Println(GetConfig())
}
```
</details>

**Discussion:** `sync.Once` is the canonical Go singleton. It's a 5-line idiom — `var once sync.Once`, `var instance *T`, `once.Do(...)` inside an accessor. Don't reinvent it with double-checked locking; `Once` is already optimal (atomic fast path, mutex only on first call).

---

## Task 2 — Singleton returning error

Many real singletons can fail to initialise — a config file might be missing, a DB might be unreachable. `sync.Once.Do` takes a func with no return, so you need to capture the error somewhere.

Build a `DB` singleton whose constructor returns `(*DB, error)`. If init fails on the first call, **all subsequent calls return the same error** — don't retry.

```go
type DB struct{ URL string }
func openDB(url string) (*DB, error) { /* ... */ }
```

**Acceptance criteria:**
- [ ] `GetDB() (*DB, error)` accessor.
- [ ] Init runs once; the cached error sticks.
- [ ] Demonstrate with a loader that fails the first time and would succeed on retry — show the cached failure persists.

<details><summary>Hints</summary>

- Store both the instance and the error in package-level vars; `sync.Once.Do` writes both.
- Resist the urge to retry-on-error: that requires a different primitive (see Task 3).
</details>

<details><summary>Solution</summary>

```go
package main

import (
    "errors"
    "fmt"
    "sync"
)

type DB struct{ URL string }

var (
    dbOnce sync.Once
    dbInst *DB
    dbErr  error
)

var attempt int

func openDB(url string) (*DB, error) {
    attempt++
    if attempt == 1 {
        return nil, errors.New("network down")
    }
    return &DB{URL: url}, nil
}

func GetDB() (*DB, error) {
    dbOnce.Do(func() {
        dbInst, dbErr = openDB("postgres://localhost/app")
    })
    return dbInst, dbErr
}

func main() {
    for i := 0; i < 3; i++ {
        db, err := GetDB()
        fmt.Printf("call %d: db=%v err=%v\n", i+1, db, err)
    }
}
```

Output:
```
call 1: db=<nil> err=network down
call 2: db=<nil> err=network down
call 3: db=<nil> err=network down
```
</details>

**Discussion:** A singleton that caches failure is honest about what it is — initialisation is not idempotent in time. If the first attempt failed because the network was momentarily down, the *process* must restart to retry. Some teams find this brittle and add a retry policy *inside* the loader (with backoff) before declaring failure. The pattern then becomes: "retry inside `Once.Do`; cache the final outcome."

---

## Task 3 — Resettable singleton for tests

Production code wants exactly-once. Tests want to start fresh each time. Build a `Counter` singleton with a `Reset()` helper that lives in a `_test.go` file so production code can never accidentally call it.

```go
type Counter struct{ n int }
func (c *Counter) Inc() { c.n++ }
func (c *Counter) Value() int { return c.n }
```

**Acceptance criteria:**
- [ ] `GetCounter() *Counter` accessor backed by `sync.Once`.
- [ ] A `resetCounter()` helper *not* exported, only callable from tests.
- [ ] Two unit tests that both pass — each starts with a fresh counter.

<details><summary>Hints</summary>

- Put the reset helper in `counter_test_helpers.go` guarded by `//go:build test` — or simpler, put it in `counter_export_test.go` which only compiles during `go test`.
- A new `sync.Once` value is enough to reset; assign `once = sync.Once{}` and zero out the instance.
</details>

<details><summary>Solution</summary>

`counter.go`:

```go
package counter

import "sync"

type Counter struct{ n int }

func (c *Counter) Inc()       { c.n++ }
func (c *Counter) Value() int { return c.n }

var (
    once sync.Once
    inst *Counter
)

func Get() *Counter {
    once.Do(func() { inst = &Counter{} })
    return inst
}
```

`counter_export_test.go` (only compiled for `go test`):

```go
package counter

import "sync"

// reset is only visible to tests in this package.
func reset() {
    once = sync.Once{}
    inst = nil
}
```

`counter_test.go`:

```go
package counter

import "testing"

func TestIncStartsAtZero(t *testing.T) {
    reset()
    c := Get()
    c.Inc()
    if got := c.Value(); got != 1 {
        t.Fatalf("want 1, got %d", got)
    }
}

func TestIncTwice(t *testing.T) {
    reset()
    c := Get()
    c.Inc()
    c.Inc()
    if got := c.Value(); got != 2 {
        t.Fatalf("want 2, got %d", got)
    }
}
```
</details>

**Discussion:** Files named `*_test.go` only compile during `go test`. So a function defined there is invisible to production binaries — you get the testability of a setter without exposing it. The `_export_test.go` convention (re-export-for-test) is used heavily by the standard library; see `net/http/export_test.go`.

This trick is the cheap way to make singletons testable. If you find yourself reaching for reset *often*, that's a smell — you're testing across the singleton boundary. Consider injecting the dependency instead (Task 9).

---

## Task 4 — `atomic.Pointer`-based hot-reload

`sync.Once` is one-shot. Some singletons need to *change* — e.g. a config that reloads on SIGHUP. Build a config holder where:

- `GetConfig()` always returns the current value, lock-free.
- `Reload(newCfg)` atomically swaps the pointer.

**Acceptance criteria:**
- [ ] Backed by `atomic.Pointer[Config]` (Go 1.19+).
- [ ] No mutex on the read path.
- [ ] `Reload` is safe under concurrent readers — no torn reads, no data races.

<details><summary>Hints</summary>

- `var holder atomic.Pointer[Config]`. Use `holder.Load()` and `holder.Store(p)`.
- Initialise once at startup or lazily with a `sync.Once`-guarded first Store.
</details>

<details><summary>Solution</summary>

```go
package main

import (
    "fmt"
    "sync"
    "sync/atomic"
)

type Config struct {
    DBHost string
    Port   int
}

var (
    cfgPtr  atomic.Pointer[Config]
    initCfg sync.Once
)

func GetConfig() *Config {
    initCfg.Do(func() {
        cfgPtr.Store(&Config{DBHost: "localhost", Port: 5432})
    })
    return cfgPtr.Load()
}

func Reload(c *Config) {
    cfgPtr.Store(c)
}

func main() {
    var wg sync.WaitGroup
    // Reader goroutines.
    for i := 0; i < 4; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for j := 0; j < 1000; j++ {
                _ = GetConfig()
            }
        }()
    }
    // Reloader.
    wg.Add(1)
    go func() {
        defer wg.Done()
        Reload(&Config{DBHost: "10.0.0.1", Port: 6432})
    }()
    wg.Wait()
    fmt.Println(GetConfig())
}
```

Run with `-race` to verify no data race:

```
go run -race main.go
```
</details>

**Discussion:** Three properties to notice:

1. The *pointer* is atomic, the *struct it points to* is not. Treat the pointed-at `Config` as **immutable**. To change a field, build a new struct and `Store` it. Mutating fields on a loaded pointer would race with another reader.
2. `Load()` is essentially free on modern CPUs (single mov on x86 with the right ordering). No mutex contention even at millions of QPS.
3. This pattern composes: any singleton that needs hot-reload — config, feature flags, cached rate-limiter rules — uses exactly this shape.

The pre-1.19 form used `atomic.Value` with an `interface{}` payload; `atomic.Pointer[T]` is the typed replacement. Prefer the typed one.

---

## Task 5 — Generic singleton helper

You have noticed by Task 4 that every singleton is the same five lines: a `sync.Once`, a pointer, a constructor. Write it once as a generic helper:

```go
type Lazy[T any] struct { /* ... */ }
func (l *Lazy[T]) Get() *T { /* ... */ }
```

The constructor takes a factory function and runs it lazily on first `Get()`.

**Acceptance criteria:**
- [ ] Generic — works for any `T`.
- [ ] One `Get()` call per `Lazy[T]` instance triggers the factory; subsequent calls reuse the result.
- [ ] Demonstrate with two different types in a single `main`.

<details><summary>Hints</summary>

- `Lazy[T]` holds a `sync.Once`, a `*T`, and a `func() *T` factory.
- `New[T any](f func() *T) *Lazy[T]` constructor.
</details>

<details><summary>Solution</summary>

```go
package main

import (
    "fmt"
    "sync"
)

type Lazy[T any] struct {
    once    sync.Once
    value   *T
    factory func() *T
}

func NewLazy[T any](f func() *T) *Lazy[T] {
    return &Lazy[T]{factory: f}
}

func (l *Lazy[T]) Get() *T {
    l.once.Do(func() { l.value = l.factory() })
    return l.value
}

type Config struct{ Host string }
type Cache struct{ Size int }

var (
    cfg   = NewLazy(func() *Config { fmt.Println("load cfg"); return &Config{Host: "x"} })
    cache = NewLazy(func() *Cache { fmt.Println("load cache"); return &Cache{Size: 1024} })
)

func main() {
    fmt.Println(cfg.Get())
    fmt.Println(cfg.Get()) // no second "load cfg" print
    fmt.Println(cache.Get())
}
```
</details>

**Discussion:** `Lazy[T]` is a value, not a global. Each call site can have its own — you've gained the on-demand init benefit of `sync.Once` without the implicit-global cost. You can also pass `*Lazy[T]` around (e.g. inject it for testing) which restores some control. The pattern shifts from "singleton" toward "lazy initialiser" and is a healthier default.

The standard library's `sync.OnceValue` and `sync.OnceValues` (Go 1.21+) cover the common cases without rolling your own:

```go
getCfg := sync.OnceValue(func() *Config { return &Config{Host: "x"} })
c := getCfg()
```

Use the stdlib if your factory takes no arguments; use a custom `Lazy[T]` if you need to inject construction parameters.

---

## Task 6 — `init()` vs `sync.Once` — write both, compare

Build the same `Logger` singleton two ways:

1. **Variant A:** Initialised in `init()` — eager, at package load.
2. **Variant B:** Initialised in a `sync.Once` accessor — lazy, on first use.

Then write a `main` that benchmarks the cost of *not* using the logger (i.e., the cost of package init versus first-call init).

**Acceptance criteria:**
- [ ] Two packages: `eager` and `lazy`.
- [ ] Both expose `Get() *Logger`.
- [ ] A `main` that imports both, calls each `Get()` once, and prints the order of `init` messages so you can see which paid the cost upfront.

<details><summary>Solution</summary>

`eager/logger.go`:

```go
package eager

import "fmt"

type Logger struct{ tag string }

var inst *Logger

func init() {
    fmt.Println("eager.init: building logger")
    inst = &Logger{tag: "eager"}
}

func Get() *Logger { return inst }
```

`lazy/logger.go`:

```go
package lazy

import (
    "fmt"
    "sync"
)

type Logger struct{ tag string }

var (
    once sync.Once
    inst *Logger
)

func Get() *Logger {
    once.Do(func() {
        fmt.Println("lazy.init: building logger")
        inst = &Logger{tag: "lazy"}
    })
    return inst
}
```

`main.go`:

```go
package main

import (
    "fmt"
    "example/eager"
    "example/lazy"
)

func main() {
    fmt.Println("main starts")
    _ = lazy.Get()
    _ = eager.Get()
    fmt.Println("main ends")
}
```

Output:

```
eager.init: building logger
main starts
lazy.init: building logger
main ends
```
</details>

**Discussion:** Three differences worth remembering:

| Aspect | `init()` | `sync.Once` |
|---|---|---|
| When does init run? | Before `main`, in import-order | First call to `Get()` |
| Errors? | `init()` cannot return one — `log.Fatal`s and crashes | Returnable, caller decides |
| Test isolation? | Hard — runs every test binary | Easy — reset the `Once` |
| Binary startup cost? | Paid always | Paid only if used |

Choose `init()` for things that *must* be ready before main (e.g., registering an HTTP handler, decoder, driver). Choose `sync.Once` for everything else. A common smell is `init()` opening a database connection — that fails the test binary, breaks `go vet`-style tooling, and makes startup slow. Move it to a lazy accessor.

---

## Task 7 — Lazy config loader as singleton

Build a `Config` singleton that:

1. Reads JSON from a file path provided by the env var `APP_CONFIG`.
2. Falls back to an embedded default if the env var is unset.
3. Returns the same value on every call.
4. Returns a sensible error (file exists but invalid JSON, etc.) without panicking.

**Acceptance criteria:**
- [ ] `GetConfig() (*Config, error)`.
- [ ] Init runs once; errors cache.
- [ ] A `main` that demonstrates the env-var path and the default path.

<details><summary>Solution</summary>

```go
package main

import (
    "encoding/json"
    "fmt"
    "os"
    "sync"
)

type Config struct {
    DBHost string `json:"db_host"`
    Port   int    `json:"port"`
}

var defaultCfg = Config{DBHost: "localhost", Port: 5432}

var (
    cfgOnce sync.Once
    cfgInst *Config
    cfgErr  error
)

func GetConfig() (*Config, error) {
    cfgOnce.Do(func() {
        path := os.Getenv("APP_CONFIG")
        if path == "" {
            c := defaultCfg
            cfgInst = &c
            return
        }
        data, err := os.ReadFile(path)
        if err != nil {
            cfgErr = fmt.Errorf("config read: %w", err)
            return
        }
        var c Config
        if err := json.Unmarshal(data, &c); err != nil {
            cfgErr = fmt.Errorf("config parse: %w", err)
            return
        }
        cfgInst = &c
    })
    return cfgInst, cfgErr
}

func main() {
    c, err := GetConfig()
    if err != nil {
        fmt.Println("error:", err)
        return
    }
    fmt.Printf("%+v\n", *c)
}
```
</details>

**Discussion:** Config loaders are the textbook singleton — globally accessed, expensive to build, conceptually unique. The Go-flavoured version reads env first, returns errors instead of panicking, and never silently overwrites valid config with a parse failure (note that `cfgInst` stays `nil` if parsing fails).

The default-fallback branch is worth thinking about: it removes the "config not set" failure mode but hides misconfiguration in production. Prefer to *require* the env var in non-dev environments and treat missing as an error there.

---

## Task 8 — Singleton metrics registry

You want one process-wide metrics registry — a place where any package can register a counter, and a single endpoint can scrape all of them.

```go
type Counter struct {
    Name  string
    value int64
}
func (c *Counter) Inc() { /* atomic */ }
```

**Acceptance criteria:**
- [ ] Package `metrics` exposes `Register(name string) *Counter` and `Snapshot() map[string]int64`.
- [ ] Registry is a singleton, lazily built.
- [ ] Concurrent `Inc` is safe and lock-free on the hot path.
- [ ] Concurrent `Register` is safe (it's rare; can take the mutex).

<details><summary>Hints</summary>

- `Counter.value` is `int64`; use `atomic.AddInt64` for `Inc`.
- The registry is a `map[string]*Counter` guarded by `sync.RWMutex`.
- `Register` is write-side (rare); `Inc` is read-side (returns a pointer the caller keeps).
</details>

<details><summary>Solution</summary>

```go
package main

import (
    "fmt"
    "sync"
    "sync/atomic"
)

type Counter struct {
    Name  string
    value int64
}

func (c *Counter) Inc()       { atomic.AddInt64(&c.value, 1) }
func (c *Counter) Value() int64 { return atomic.LoadInt64(&c.value) }

type Registry struct {
    mu       sync.RWMutex
    counters map[string]*Counter
}

func (r *Registry) Register(name string) *Counter {
    r.mu.Lock()
    defer r.mu.Unlock()
    if c, ok := r.counters[name]; ok {
        return c
    }
    c := &Counter{Name: name}
    r.counters[name] = c
    return c
}

func (r *Registry) Snapshot() map[string]int64 {
    r.mu.RLock()
    defer r.mu.RUnlock()
    out := make(map[string]int64, len(r.counters))
    for k, v := range r.counters {
        out[k] = v.Value()
    }
    return out
}

var (
    regOnce sync.Once
    reg     *Registry
)

func Default() *Registry {
    regOnce.Do(func() {
        reg = &Registry{counters: map[string]*Counter{}}
    })
    return reg
}

func main() {
    requests := Default().Register("http_requests_total")
    errors := Default().Register("http_errors_total")

    var wg sync.WaitGroup
    for i := 0; i < 100; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            requests.Inc()
            if i := requests.Value(); i%10 == 0 {
                errors.Inc()
            }
        }()
    }
    wg.Wait()

    for k, v := range Default().Snapshot() {
        fmt.Printf("%s=%d\n", k, v)
    }
}
```
</details>

**Discussion:** Two-tier locking is the trick. `Register` writes a tiny map under a write lock — taken only at startup or on rare new metric additions. `Inc` doesn't touch the map at all; the caller holds a `*Counter` pointer and uses lock-free `atomic.AddInt64`. The hot path is wait-free.

This is exactly how `prometheus.DefaultRegisterer` works in spirit (though their implementation is much fuller). It's also why metric registration is typically done once at package init — registering thousands of times per second would serialise everything on the registry lock.

---

## Task 9 — Refactor: replace a global singleton with DI

You inherit this code:

```go
package billing

func Charge(amount int) error {
    log := logger.Default()                 // singleton
    db, err := database.Default()           // singleton
    if err != nil { log.Errorf("db: %v", err); return err }
    return db.Exec("INSERT ...", amount)
}
```

Tests are painful because every test reaches the same DB. Refactor `Charge` to receive its dependencies — keep the singletons available as defaults in `main`, but expose a constructor form for tests.

**Acceptance criteria:**
- [ ] `Charge` becomes a method on a `Service` struct holding `Logger` and `DB`.
- [ ] `main` constructs the `Service` from singletons.
- [ ] A unit test constructs a `Service` from in-memory fakes — no singleton involved.

<details><summary>Solution</summary>

```go
package billing

type Logger interface {
    Errorf(format string, args ...any)
}

type DB interface {
    Exec(query string, args ...any) error
}

type Service struct {
    Log Logger
    DB  DB
}

func (s *Service) Charge(amount int) error {
    if err := s.DB.Exec("INSERT INTO charges (amount) VALUES (?)", amount); err != nil {
        s.Log.Errorf("charge: %v", err)
        return err
    }
    return nil
}
```

`main.go`:

```go
package main

import (
    "example/billing"
    "example/database"
    "example/logger"
)

func main() {
    db, _ := database.Default()
    svc := &billing.Service{
        Log: logger.Default(),
        DB:  db,
    }
    _ = svc.Charge(1000)
}
```

`billing/service_test.go`:

```go
package billing

import "testing"

type fakeLog struct{}
func (fakeLog) Errorf(string, ...any) {}

type fakeDB struct{ calls int }
func (d *fakeDB) Exec(string, ...any) error { d.calls++; return nil }

func TestCharge(t *testing.T) {
    db := &fakeDB{}
    svc := &Service{Log: fakeLog{}, DB: db}
    if err := svc.Charge(100); err != nil { t.Fatal(err) }
    if db.calls != 1 { t.Fatalf("want 1 call, got %d", db.calls) }
}
```
</details>

**Discussion:** The singletons didn't disappear — they're still there, still reachable from `main`. What changed is that `billing.Charge` no longer *reaches up* to grab them. It receives them. The two cures applied:

- **Interface at the seam**: `Logger` and `DB` are tiny interfaces local to `billing`, with methods limited to what `Charge` actually uses.
- **Injection at construction**: `main` is the only place that knows about the global instances.

This is "depend on abstractions, instantiate concretions at the edges" — the Go form of dependency injection without a framework. The original code violated the Dependency Inversion Principle; the refactor doesn't.

When to keep a singleton anyway: when it's truly global and stateless (e.g., a UUID generator that wraps `crypto/rand`). When to refactor: anything that holds state, talks to the network, or you want to mock in tests.

---

## Task 10 — Singleton with a background goroutine that needs cleanup

Some singletons spawn a goroutine — e.g., a metrics flusher that pushes to a remote endpoint every 10 seconds. That goroutine outlives all callers. How do you stop it cleanly at shutdown?

Build a `Flusher` singleton that:

- Runs a goroutine flushing every `interval`.
- Provides a `Stop()` method that closes a done-channel and waits for the goroutine to exit.

**Acceptance criteria:**
- [ ] `GetFlusher() *Flusher` accessor backed by `sync.Once`.
- [ ] `Stop()` is idempotent — calling twice doesn't deadlock.
- [ ] Demonstrate clean shutdown in `main` (no leaked goroutine).

<details><summary>Hints</summary>

- Use `sync.WaitGroup` to wait for the loop goroutine to finish.
- Use `sync.Once` to guard against double-close of the `done` channel.
- `select { case <-time.After(interval): ...; case <-done: return }`.
</details>

<details><summary>Solution</summary>

```go
package main

import (
    "fmt"
    "sync"
    "time"
)

type Flusher struct {
    interval time.Duration
    done     chan struct{}
    stopOnce sync.Once
    wg       sync.WaitGroup
}

func newFlusher(interval time.Duration) *Flusher {
    f := &Flusher{
        interval: interval,
        done:     make(chan struct{}),
    }
    f.wg.Add(1)
    go f.loop()
    return f
}

func (f *Flusher) loop() {
    defer f.wg.Done()
    t := time.NewTicker(f.interval)
    defer t.Stop()
    for {
        select {
        case <-t.C:
            fmt.Println("flush")
        case <-f.done:
            return
        }
    }
}

func (f *Flusher) Stop() {
    f.stopOnce.Do(func() { close(f.done) })
    f.wg.Wait()
}

var (
    flusherOnce sync.Once
    flusher     *Flusher
)

func GetFlusher() *Flusher {
    flusherOnce.Do(func() {
        flusher = newFlusher(100 * time.Millisecond)
    })
    return flusher
}

func main() {
    f := GetFlusher()
    time.Sleep(350 * time.Millisecond)
    f.Stop()
    f.Stop() // safe: idempotent
    fmt.Println("done")
}
```
</details>

**Discussion:** Three pieces interlock:

- `sync.Once` for **construction** (start the goroutine exactly once).
- `sync.Once` for **destruction** (close the channel exactly once — closing twice panics).
- `sync.WaitGroup` to **wait** for the goroutine to actually exit.

If you skip the WaitGroup, `main` might return before the goroutine finishes its in-flight work. If you skip the second `Once`, paranoid callers calling `Stop()` twice will crash the program. If you skip both, the leak is silent and you find it via `goleak` in tests.

In real services, hook `Stop()` into your signal handler:

```go
sigCh := make(chan os.Signal, 1)
signal.Notify(sigCh, os.Interrupt, syscall.SIGTERM)
<-sigCh
flusher.Stop()
```

Singletons that don't expose `Stop()` make graceful shutdown impossible. Always provide one.

---

## Task 11 — Test isolation: testing code that uses a singleton

You can't change the singleton itself (third-party library). It returns a process-global instance. Your function is:

```go
func Greet(name string) string {
    cfg := lib.GetConfig() // singleton
    return cfg.Prefix + name
}
```

How do you write a unit test that doesn't depend on what `lib.GetConfig()` happens to return?

**Acceptance criteria:**
- [ ] A refactor of `Greet` that makes it testable *without* modifying `lib`.
- [ ] Two tests, each with a different "prefix", neither depending on the singleton.

<details><summary>Hints</summary>

- Inject the *value* you need at the call site, not the singleton.
- Or inject a *getter function* that returns the value.
</details>

<details><summary>Solution</summary>

Refactor to take a small interface:

```go
type Config interface {
    PrefixOf() string
}

type libCfg struct{ c *lib.Config }
func (l libCfg) PrefixOf() string { return l.c.Prefix }

func Greet(cfg Config, name string) string {
    return cfg.PrefixOf() + name
}

// In production:
func GreetUsingLib(name string) string {
    return Greet(libCfg{c: lib.GetConfig()}, name)
}
```

Tests:

```go
type stubCfg struct{ p string }
func (s stubCfg) PrefixOf() string { return s.p }

func TestGreet_HelloPrefix(t *testing.T) {
    got := Greet(stubCfg{"Hello "}, "world")
    if got != "Hello world" { t.Fatal(got) }
}

func TestGreet_EmptyPrefix(t *testing.T) {
    got := Greet(stubCfg{""}, "alice")
    if got != "alice" { t.Fatal(got) }
}
```
</details>

**Discussion:** The singleton is still there. You haven't changed `lib`. What you've done is *push the dependency on the singleton to the edge* — one production function (`GreetUsingLib`) reads it, and the testable function (`Greet`) accepts the value as a parameter.

This is a general technique called **dependency injection at the seam**. Whenever you can't refactor a global, wrap it with a one-line function that reads the global, and put the rest of your logic underneath that function. The unit-tested surface is the part *underneath*; the part that touches the global is a five-line glue layer with no logic worth testing.

Avoid the temptation of `t.Setenv` or monkey-patching unexported globals via `//go:linkname` tricks — they couple your tests to the singleton's internals and break when the library updates.

---

## Task 12 — Race-detecting test for singleton init

Show that `sync.Once`-based singleton initialisation is race-free under concurrent `Get()` calls.

**Acceptance criteria:**
- [ ] A test that spawns N goroutines all calling `Get()`.
- [ ] An atomic counter records how many times the loader actually ran.
- [ ] The test asserts the counter is exactly 1.
- [ ] Run with `go test -race` — no race report.

<details><summary>Solution</summary>

`registry.go`:

```go
package registry

import "sync"

type Thing struct{ N int }

var (
    once sync.Once
    inst *Thing
    Inits int64 // exported for test inspection
)
```

`registry_test.go`:

```go
package registry

import (
    "sync"
    "sync/atomic"
    "testing"
)

func TestInitIsOnce(t *testing.T) {
    var inits int64
    var once sync.Once
    var inst *Thing

    get := func() *Thing {
        once.Do(func() {
            atomic.AddInt64(&inits, 1)
            inst = &Thing{N: 42}
        })
        return inst
    }

    const N = 1000
    var wg sync.WaitGroup
    for i := 0; i < N; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            if got := get(); got.N != 42 {
                t.Errorf("bad value: %d", got.N)
            }
        }()
    }
    wg.Wait()

    if got := atomic.LoadInt64(&inits); got != 1 {
        t.Fatalf("loader ran %d times, want 1", got)
    }
}
```

Run:

```
go test -race -run TestInitIsOnce
```
</details>

**Discussion:** Two things you've verified at once:

1. **Liveness**: every concurrent caller observes a fully-constructed `*Thing`. If `Once.Do` returned before the inner function finished, some goroutines would see `inst == nil`.
2. **Mutual exclusion**: the loader function ran exactly once. If `Once` allowed re-entry, the counter would exceed 1.

`-race` catches data races (concurrent unsynchronised reads/writes to the same variable). It will scream if you write the singleton in a naive way:

```go
// BAD: data race
var inst *Thing
func Get() *Thing {
    if inst == nil { inst = &Thing{} }
    return inst
}
```

Two goroutines hitting `Get()` concurrently can both see `inst == nil`, both construct, and the second's pointer overwrites the first. `-race` flags it; `sync.Once` prevents it.

---

## Task 13 — Singleton that wraps an expensive resource (DB connection pool)

`sql.DB` is *itself* designed to be shared as a process-wide singleton — it's a connection pool. Wrap it:

```go
type Store interface {
    QueryRow(ctx context.Context, q string, args ...any) *sql.Row
    Close() error
}
```

The `Store` singleton:

- Opens the underlying `*sql.DB` lazily (first use).
- Configures `SetMaxOpenConns`, `SetMaxIdleConns`, `SetConnMaxLifetime` on first open.
- Exposes a `Close()` that's idempotent.

**Acceptance criteria:**
- [ ] `GetStore() (Store, error)`.
- [ ] First call opens and configures the pool.
- [ ] Concurrent `GetStore` calls never open more than one pool.
- [ ] `Close()` callable from any number of places without panicking.

<details><summary>Solution</summary>

```go
package main

import (
    "context"
    "database/sql"
    "fmt"
    "sync"
    "time"

    _ "github.com/mattn/go-sqlite3"
)

type Store interface {
    QueryRow(ctx context.Context, q string, args ...any) *sql.Row
    Close() error
}

type sqlStore struct {
    db        *sql.DB
    closeOnce sync.Once
    closeErr  error
}

func (s *sqlStore) QueryRow(ctx context.Context, q string, args ...any) *sql.Row {
    return s.db.QueryRowContext(ctx, q, args...)
}

func (s *sqlStore) Close() error {
    s.closeOnce.Do(func() {
        s.closeErr = s.db.Close()
    })
    return s.closeErr
}

var (
    storeOnce sync.Once
    storeInst *sqlStore
    storeErr  error
)

func GetStore() (Store, error) {
    storeOnce.Do(func() {
        db, err := sql.Open("sqlite3", ":memory:")
        if err != nil {
            storeErr = err
            return
        }
        db.SetMaxOpenConns(25)
        db.SetMaxIdleConns(5)
        db.SetConnMaxLifetime(30 * time.Minute)
        storeInst = &sqlStore{db: db}
    })
    if storeErr != nil {
        return nil, storeErr
    }
    return storeInst, nil
}

func main() {
    s, err := GetStore()
    if err != nil { panic(err) }
    defer s.Close()

    var v int
    _ = s.QueryRow(context.Background(), "SELECT 1").Scan(&v)
    fmt.Println("got:", v)
}
```
</details>

**Discussion:** `*sql.DB` is a *pool*; opening two of them defeats the point — each keeps its own connections, doubling your fanout to the server. Hence the singleton. Two layered `Once`s: `storeOnce` for the accessor, `closeOnce` for safe shutdown.

A subtle point: `sql.Open` doesn't actually connect — it returns immediately and lazily opens connections on first query. So errors here are *configuration* errors (bad driver name), not network errors. For network reachability, call `db.PingContext(ctx)` and decide whether you want connection failure to be a startup error or a per-call error.

---

## Task 14 — Singleton ↔ functional options interop

You like functional options (Task 1 of `01-functional-options`). You also have a singleton. How do options work in a singleton world?

Build a `MetricsClient` singleton whose first call can take options; later calls must not be able to change configuration silently.

```go
type Option func(*MetricsClient)
func WithEndpoint(url string) Option
func WithTimeout(d time.Duration) Option
```

**Acceptance criteria:**
- [ ] First `GetClient(opts...)` builds with the given options.
- [ ] Subsequent `GetClient(opts...)` calls **ignore** the passed options and return the existing instance. Document this clearly.
- [ ] Provide an alternative `InitClient(opts...) error` that *fails* if called twice — strict variant for code that must not silently misconfigure.

<details><summary>Hints</summary>

- `sync.Once` only runs the func once. The discarded options on later calls are a hazard; the strict `InitClient` makes it explicit.
- Use `atomic.Bool` for the strict variant's "already initialised" flag.
</details>

<details><summary>Solution</summary>

```go
package main

import (
    "errors"
    "fmt"
    "sync"
    "sync/atomic"
    "time"
)

type MetricsClient struct {
    Endpoint string
    Timeout  time.Duration
}

type Option func(*MetricsClient)

func WithEndpoint(url string) Option      { return func(c *MetricsClient) { c.Endpoint = url } }
func WithTimeout(d time.Duration) Option  { return func(c *MetricsClient) { c.Timeout = d } }

// Lenient: options after the first call are ignored.
var (
    lenientOnce sync.Once
    lenientInst *MetricsClient
)

func GetClient(opts ...Option) *MetricsClient {
    lenientOnce.Do(func() {
        c := &MetricsClient{Endpoint: "http://localhost", Timeout: 5 * time.Second}
        for _, o := range opts {
            o(c)
        }
        lenientInst = c
    })
    return lenientInst
}

// Strict: second call returns an error.
var (
    strictInst    atomic.Pointer[MetricsClient]
    strictInited  atomic.Bool
    errAlreadyInit = errors.New("client already initialised")
)

func InitClient(opts ...Option) error {
    if !strictInited.CompareAndSwap(false, true) {
        return errAlreadyInit
    }
    c := &MetricsClient{Endpoint: "http://localhost", Timeout: 5 * time.Second}
    for _, o := range opts {
        o(c)
    }
    strictInst.Store(c)
    return nil
}

func StrictClient() *MetricsClient { return strictInst.Load() }

func main() {
    c1 := GetClient(WithEndpoint("http://m1:9090"), WithTimeout(2*time.Second))
    fmt.Printf("first:  %+v\n", *c1)
    c2 := GetClient(WithEndpoint("http://m2:9090")) // silently ignored
    fmt.Printf("second: %+v\n", *c2)

    fmt.Println()
    fmt.Println("err1:", InitClient(WithEndpoint("http://strict")))
    fmt.Println("err2:", InitClient(WithEndpoint("http://strict-2"))) // already initialised
    fmt.Printf("strict: %+v\n", *StrictClient())
}
```

Output:

```
first:  {Endpoint:http://m1:9090 Timeout:2s}
second: {Endpoint:http://m1:9090 Timeout:2s}

err1: <nil>
err2: client already initialised
strict: {Endpoint:http://strict Timeout:5s}
```
</details>

**Discussion:** Two valid designs, two different cultures:

- **Lenient**: matches `log.Default()` and most "framework" globals — easy to use, can be silently misconfigured. Choose for low-stakes singletons (loggers, default decoders).
- **Strict**: matches `expvar.Publish` and similar — a second registration is a programming error. Choose for singletons whose misconfiguration is dangerous (auth providers, tracing exporters, billing endpoints).

A third design exists: make `GetClient` take no options at all, and require an explicit `Configure(opts...)` call before first use. That removes the "options on a later call do nothing" trap entirely but at the cost of ordering: tests and callers must know to call `Configure` first.

---

## Task 15 — Mini-project: pluggable global logger with hot-reload

Build a `log` package (your own, not the stdlib) with these properties:

1. **One** process-global logger.
2. Access via `log.Info("...")`, `log.Error("...")` — package-level functions, not method calls.
3. The underlying handler can be **hot-reloaded** at runtime — swap from text to JSON, or rotate the output file, without restarting.
4. Reads are **lock-free** so log calls are cheap on the hot path.
5. The default handler logs to `os.Stderr` in text format; you can override before first use *or* after.

**Suggested layout:**

```
log/log.go         # public API + atomic.Pointer holder
log/handler.go     # Handler interface + Text/JSON impls
main.go            # swap handlers at runtime
```

**Acceptance criteria:**
- [ ] `log.Info`, `log.Error` — package functions.
- [ ] `log.SetHandler(h Handler)` swaps atomically.
- [ ] `log.WithDefault()` returns a sensible default — no nil-handler crash if the user forgets to set one.
- [ ] `main` swaps from text to JSON mid-run; both outputs appear.
- [ ] Run with `-race` — clean.

<details><summary>Solution sketch</summary>

`log/handler.go`:

```go
package log

import (
    "encoding/json"
    "fmt"
    "io"
    "time"
)

type Level int

const (
    LevelInfo Level = iota
    LevelError
)

func (l Level) String() string {
    switch l {
    case LevelError:
        return "ERROR"
    default:
        return "INFO"
    }
}

type Record struct {
    Time    time.Time
    Level   Level
    Message string
}

type Handler interface {
    Handle(r Record)
}

type TextHandler struct{ W io.Writer }

func (h *TextHandler) Handle(r Record) {
    fmt.Fprintf(h.W, "%s %s %s\n",
        r.Time.Format(time.RFC3339), r.Level, r.Message)
}

type JSONHandler struct{ W io.Writer }

func (h *JSONHandler) Handle(r Record) {
    _ = json.NewEncoder(h.W).Encode(map[string]any{
        "ts":    r.Time.Format(time.RFC3339),
        "level": r.Level.String(),
        "msg":   r.Message,
    })
}
```

`log/log.go`:

```go
package log

import (
    "os"
    "sync"
    "sync/atomic"
    "time"
)

var (
    handlerPtr atomic.Pointer[Handler]
    initOnce   sync.Once
)

func ensureDefault() {
    initOnce.Do(func() {
        var h Handler = &TextHandler{W: os.Stderr}
        handlerPtr.Store(&h)
    })
}

func SetHandler(h Handler) {
    ensureDefault()
    handlerPtr.Store(&h)
}

func current() Handler {
    ensureDefault()
    return *handlerPtr.Load()
}

func Info(msg string) {
    current().Handle(Record{Time: time.Now(), Level: LevelInfo, Message: msg})
}

func Error(msg string) {
    current().Handle(Record{Time: time.Now(), Level: LevelError, Message: msg})
}
```

`main.go`:

```go
package main

import (
    "os"

    "example/log"
)

func main() {
    log.Info("starting up")          // default text handler
    log.SetHandler(&log.JSONHandler{W: os.Stdout})
    log.Info("hot-reloaded handler") // now JSON
    log.Error("something happened")
}
```

Output:

```
2026-05-28T12:00:00Z INFO starting up
{"level":"INFO","msg":"hot-reloaded handler","ts":"2026-05-28T12:00:00Z"}
{"level":"ERROR","msg":"something happened","ts":"2026-05-28T12:00:00Z"}
```
</details>

**Discussion:** This is the synthesis project. It uses ideas from earlier tasks:

- **`sync.Once`** for the lazy default (Task 1).
- **`atomic.Pointer`** for the hot-swap path (Task 4).
- **Interface seam** (`Handler`) so callers don't know which concrete handler runs (Task 11).
- **Package-level API** for ergonomics (`log.Info(...)` not `log.Default().Info(...)`).
- **Strict/lenient distinction** — this design is lenient: `SetHandler` is always allowed; a strict variant would refuse swaps after first emission (Task 14).

Two design choices to defend:

1. **Why `atomic.Pointer[Handler]` and not `atomic.Pointer[*Handler]`?** Because `Handler` is an interface — already a fat pointer (type word + data word). Storing the bare interface value would need `atomic.Value`; storing `*Handler` is awkwardly indirect. A nested pointer to the interface gives single-word atomic semantics with typed swaps.
2. **Why a global, not a struct passed around?** Logging is ambient. Every function in every package may need it; threading a `*Logger` parameter through every call signature is a tax most teams won't pay. The standard library agrees — `log.Default()`, `slog.Default()`, both globals.

Reach for `log/slog` from the standard library when you need per-request handlers or dynamic level filters — it's the same shape with the production sharp edges already filed off.

---

## Where to go next

- `01-functional-options/tasks.md` — combines naturally with singletons (Task 14).
- `15-object-pool-pattern` — siblings: both share expensive resources, but the pool is bounded and the singleton is one.
- `18-registry-pattern` — singleton-of-registries is a common shape; Task 8 was the warm-up.
