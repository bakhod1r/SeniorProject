# Singleton Pattern — Find the Bug

## 1. How to use this file

Fifteen short scenarios. Each has a buggy singleton. Read it, find the bug, then expand the answer to check. The bugs are *realistic* — every one has shipped to production somewhere, and most of them survive light review because singletons look simple.

Difficulty varies. Some are textbook concurrency mistakes; others are init-order subtleties that only bite when packages get reorganised or test suites grow large enough to interleave.

---

## Bug 1 — Double-checked locking without atomics

```go
package config

import "sync"

type Config struct {
    APIKey string
    URL    string
}

var (
    instance *Config
    mu       sync.Mutex
)

func Get() *Config {
    if instance == nil {
        mu.Lock()
        defer mu.Unlock()
        if instance == nil {
            instance = &Config{
                APIKey: loadKey(),
                URL:    loadURL(),
            }
        }
    }
    return instance
}
```

Used:

```go
for i := 0; i < 100; i++ {
    go func() {
        cfg := config.Get()
        fmt.Println(cfg.URL)
    }()
}
```

**What's wrong?**

<details><summary>Answer</summary>

**Bug:** Classic double-checked locking, ported from Java circa 2003, ported badly. The outer `if instance == nil` reads `instance` *without holding the mutex* — a data race under the Go memory model. `go test -race` flags it; even without the detector, on weakly ordered hardware (ARM) a reader can observe `instance != nil` while the fields inside are still being written. Result: a non-nil pointer to a half-constructed struct.

**Spot in review:** Any unlocked read of a shared pointer paired with a locked write. The shape `if x == nil { lock; if x == nil { x = ... } }` is the giveaway.

**Fix:** Use `sync.Once`. It exists for exactly this:

```go
var (
    instance *Config
    once     sync.Once
)

func Get() *Config {
    once.Do(func() {
        instance = &Config{APIKey: loadKey(), URL: loadURL()}
    })
    return instance
}
```

If you really need DCL, use `atomic.Pointer[Config]` with `CompareAndSwap`. But don't. Use `sync.Once`.

**Why common:** Developers coming from Java/C++ reach for DCL out of habit. In Go, `sync.Once` is faster, correct, and shorter.
</details>

---

## Bug 2 — Singleton with a mutable field accessed without sync

```go
package metrics

type Counters struct {
    Requests int64
    Errors   int64
}

var counters = &Counters{}

func Get() *Counters { return counters }

func IncRequests() { counters.Requests++ }
func IncErrors()   { counters.Errors++ }
```

Used:

```go
http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
    metrics.IncRequests()
    // ...
})

http.HandleFunc("/stats", func(w http.ResponseWriter, r *http.Request) {
    c := metrics.Get()
    fmt.Fprintf(w, "%d / %d\n", c.Requests, c.Errors)
})
```

**What's wrong?**

<details><summary>Answer</summary>

**Bug:** The singleton pointer is constructed safely (package-level var, no race during init), but its fields are mutated concurrently from handlers with no synchronisation. `counters.Requests++` is a read-modify-write that loses increments under load; the `/stats` reader races with writers. `go test -race` flags it immediately.

This is a common misreading of "singleton thread safety": making the *pointer* visible safely is not the same as making *operations* on the underlying state safe.

**Spot in review:** Singletons whose methods or external mutators touch unguarded fields. Any `x++` on a package-level struct field is suspect in an HTTP server.

**Fix:** Use `sync/atomic` (or `sync.RWMutex` for richer state):

```go
type Counters struct {
    Requests atomic.Int64
    Errors   atomic.Int64
}

func IncRequests() { counters.Requests.Add(1) }
```

**Why common:** "It's a singleton, so it's safe" is folklore. Singletons are *more* dangerous than locals — every goroutine in the binary can reach them.
</details>

---

## Bug 3 — `init()` panic drags the whole binary down

```go
package db

import "database/sql"

var Conn *sql.DB

func init() {
    var err error
    Conn, err = sql.Open("postgres", os.Getenv("DB_URL"))
    if err != nil {
        panic(err)
    }
    if err := Conn.Ping(); err != nil {
        panic(err)
    }
}
```

Imported by:

```go
import _ "myapp/db"

// some other package that doesn't actually need the DB right now
// (e.g. a CLI tool that only prints help)
```

**What's wrong?**

<details><summary>Answer</summary>

**Bug:** `init()` runs at import time for *every* binary that imports the package, directly or transitively. `Ping` does a real network round-trip. Consequences:

1. The CLI's `--help` refuses to work when Postgres is down.
2. `go test ./...` fails on any package that transitively imports `db` when run offline.
3. The panic in `init()` aborts the binary before `main` runs — unrecoverable.

**Spot in review:** `init()` functions that do anything other than register or initialise pure-Go state. Network calls, file reads, `log.Fatal`, `panic` in `init` are all red flags.

**Fix:** Move the work into an explicit `Open(ctx)` function that `main` (or each test) calls when it actually needs the singleton:

```go
var Conn *sql.DB

func Open(ctx context.Context, dsn string) error {
    c, err := sql.Open("postgres", dsn)
    if err != nil { return fmt.Errorf("open: %w", err) }
    if err := c.PingContext(ctx); err != nil {
        return fmt.Errorf("ping: %w", err)
    }
    Conn = c
    return nil
}
```

If you must lazy-init on first use, do it with `sync.Once` and surface the error via a getter.

**Why common:** "Singletons should be ready when used" gets interpreted as "initialise eagerly in init." It's the wrong layer; `main` is responsible for wiring, not import.
</details>

---

## Bug 4 — `sync.Once` re-entrant call deadlocks

```go
package cache

import "sync"

var (
    instance *Cache
    once     sync.Once
)

type Cache struct {
    data map[string]string
}

func Get() *Cache {
    once.Do(func() {
        instance = &Cache{data: map[string]string{}}
        instance.warm()
    })
    return instance
}

func (c *Cache) warm() {
    // Preload from another singleton that, somewhere in its setup,
    // calls cache.Get() back.
    for _, k := range registry.Get().Keys() {
        c.data[k] = ""
    }
}
```

Where `registry.Get()` itself is implemented with `sync.Once`, and during its init it touches `cache.Get()` to seed an inverse index.

**What's wrong?**

<details><summary>Answer</summary>

**Bug:** Re-entrant call to the same `sync.Once`. If `registry.Get()`'s init calls back into `cache.Get()` while `cache`'s `once.Do` is still running on the same goroutine, the second `Do` call blocks forever on `sync.Once`'s internal mutex. `sync.Once.Do` is *not* re-entrant. Deadlock.

The same deadlock arises in a two-singleton cycle (A's Once calls B's Once which calls A's Once) — on the first singleton's mutex.

**Spot in review:** Any singleton initialiser that calls *another* singleton's getter. Cycles in the singleton dependency graph are invisible until something deadlocks at startup.

**Fix:** Break the cycle. Construct without dependencies, then wire externally:

```go
func Get() *Cache {
    once.Do(func() {
        instance = &Cache{data: map[string]string{}}
    })
    return instance
}

func Warm(ctx context.Context, r *Registry) {
    c := Get()
    for _, k := range r.Keys() {
        c.data[k] = ""
    }
}
```

`main` is responsible for `Warm(ctx, registry.Get())` *after* both singletons exist.

**Why common:** Two devs write two singletons independently; each pulls the other in. Tests pass when run alone. The deadlock only appears in the binary that imports both.
</details>

---

## Bug 5 — `Reset` method not safe (test pollution)

```go
package featureflags

import "sync"

var (
    instance *Flags
    once     sync.Once
)

type Flags struct {
    enabled map[string]bool
}

func Get() *Flags {
    once.Do(func() {
        instance = &Flags{enabled: loadFromEnv()}
    })
    return instance
}

func Reset() {
    instance = nil
    once = sync.Once{}
}
```

Used in tests:

```go
func TestFeatureA(t *testing.T) {
    t.Setenv("FLAG_A", "true")
    defer featureflags.Reset()
    if !featureflags.Get().enabled["A"] { t.Fatal("expected A enabled") }
}

func TestFeatureB(t *testing.T) {
    t.Setenv("FLAG_B", "true")
    defer featureflags.Reset()
    if !featureflags.Get().enabled["B"] { t.Fatal("expected B enabled") }
}
```

**What's wrong?**

<details><summary>Answer</summary>

**Bug 1 — Data race:** `Reset` writes `instance` and `once` without synchronisation. Any concurrent reader (logging goroutine, background worker, parallel sub-test) races.

**Bug 2 — `sync.Once` not safely reassignable:** `once = sync.Once{}` is a struct copy that races with any concurrent `once.Do` caller.

**Bug 3 — Test ordering:** With `t.Parallel()`, `TestFeatureA` and `TestFeatureB` interleave. One test's `Reset` clobbers the other's state mid-flight. Tests pass alone, fail together — the worst kind of flake.

**Spot in review:** Any `Reset` / `ResetForTest` function on a singleton. The mere existence is a smell.

**Fix:** Don't use a singleton in code under test. Inject dependencies. If you must, keep test isolation with a per-test instance:

```go
type Flags struct {
    enabled map[string]bool
}

func New(env map[string]string) *Flags {
    return &Flags{enabled: parseFlags(env)}
}

// In production code, main wires a single instance.
// In tests, each test constructs its own.
```

**Why common:** Singletons make code "convenient" at write time and miserable at test time. The `Reset` band-aid creates new failure modes (races, parallel-test flakiness) without solving the underlying coupling problem.
</details>

---

## Bug 6 — Singleton returning interface that wraps nil concrete

```go
package notify

type Notifier interface {
    Notify(msg string) error
}

type SlackNotifier struct{ hook string }

func (s *SlackNotifier) Notify(msg string) error {
    return postToSlack(s.hook, msg)
}

var (
    instance Notifier
    once     sync.Once
)

func Get() Notifier {
    once.Do(func() {
        var s *SlackNotifier
        if hook := os.Getenv("SLACK_HOOK"); hook != "" {
            s = &SlackNotifier{hook: hook}
        }
        instance = s
    })
    return instance
}
```

Used:

```go
n := notify.Get()
if n == nil {
    log.Println("notifications disabled")
    return
}
n.Notify("deploy complete")
```

**What's wrong?**

<details><summary>Answer</summary>

**Bug:** Typed nil. When `SLACK_HOOK` is empty, `s` is a nil `*SlackNotifier`. Assigning a typed-nil pointer to an interface variable produces a *non-nil* interface (it has a type and a nil data pointer). The `n == nil` check returns false; `n.Notify(...)` dispatches through the itab, dereferences the nil receiver, and panics.

**Spot in review:** Any pattern that declares `var x *Concrete`, conditionally populates it, then assigns to an interface variable.

**Fix:** Assign the untyped nil explicitly, or branch:

```go
once.Do(func() {
    hook := os.Getenv("SLACK_HOOK")
    if hook == "" {
        instance = nil // untyped nil — interface value is truly nil
        return
    }
    instance = &SlackNotifier{hook: hook}
})
```

Even better — for a singleton that may be disabled — return a no-op implementation rather than nil at all, so callers never have to nil-check.

**Why common:** Idiomatic "declare zero value, populate conditionally" works for concrete types and breaks for interfaces. The bug only manifests when the env var is missing — usually in dev/staging, never in CI where env is fully populated.
</details>

---

## Bug 7 — Package-level var initialisation order surprise

```go
package config

var (
    Defaults = map[string]string{
        "region":  Region,
        "timeout": Timeout,
    }
    Region  = os.Getenv("REGION")
    Timeout = os.Getenv("TIMEOUT")
)
```

Used:

```go
fmt.Println(config.Defaults["region"]) // expected: us-east-1
fmt.Println(config.Defaults["timeout"]) // expected: 30s
```

…with `REGION=us-east-1` and `TIMEOUT=30s` in the environment.

**What's wrong?**

<details><summary>Answer</summary>

**Bug:** Go orders package-level variable initialisations by *dependency*, not by declaration order. The spec handles direct references — `Defaults` initialises after `Region`/`Timeout` here. But hide the reference behind a function:

```go
var Defaults = buildDefaults()
func buildDefaults() map[string]string {
    return map[string]string{"region": Region, "timeout": Timeout}
}
var Region = os.Getenv("REGION")
var Timeout = os.Getenv("TIMEOUT")
```

…and Go *can't* see that `buildDefaults` reads `Region`/`Timeout`. The order falls back to file order. `Defaults` initialises *before* `Region`/`Timeout` — and you get `""` in the map. Across files, filename order decides; rename a file and the bug toggles.

**Spot in review:** Package-level vars that depend on other package-level vars via *indirect* paths (function calls, type assertions, reflection). "Config singletons" built from other "config singletons" at package init are fragile.

**Fix:** Make the dependency explicit with lazy initialisation:

```go
var (
    defaults     map[string]string
    defaultsOnce sync.Once
)

func Defaults() map[string]string {
    defaultsOnce.Do(func() {
        defaults = map[string]string{
            "region":  os.Getenv("REGION"),
            "timeout": os.Getenv("TIMEOUT"),
        }
    })
    return defaults
}
```

Or, better, read env in `main` once and pass it down. Package-level state is for constants and registry, not for derived values.

**Why common:** Devs assume "init order = declaration order." Spec says otherwise (and it's tricky). Bugs surface only after reorganising files or upgrading the toolchain.
</details>

---

## Bug 8 — Singleton holding `*http.Client` that's never closed

```go
package httpx

import (
    "net/http"
    "sync"
    "time"
)

var (
    client *http.Client
    once   sync.Once
)

func Client() *http.Client {
    once.Do(func() {
        client = &http.Client{
            Timeout: 30 * time.Second,
            Transport: &http.Transport{
                MaxIdleConns:        1000,
                MaxIdleConnsPerHost: 100,
                IdleConnTimeout:     90 * time.Second,
            },
        }
    })
    return client
}
```

Used inside many short-lived CLI invocations and short-running cron jobs:

```go
func main() {
    resp, err := httpx.Client().Get("https://api.example.com/health")
    if err != nil { os.Exit(1) }
    defer resp.Body.Close()
    io.Copy(io.Discard, resp.Body)
}
```

**What's wrong?**

<details><summary>Answer</summary>

**Bug:** The `*http.Client`'s transport keeps idle TCP connections in a pool. Nothing closes the transport. In a long-lived server this is fine. In a short-lived CLI invoked thousands of times (cron, init containers), the server side accumulates TCP_FIN_WAIT2 sockets and you exhaust ephemeral ports on the calling host.

The deeper bug: there's no way to *cleanly* tear down the singleton. No `Close()`. The keep-alive maintenance goroutine inside `http.Transport` leaks in test binaries — `go test -count=100` accumulates them.

**Spot in review:** Singletons that wrap resources with internal goroutines or pools but expose no lifecycle method. `*http.Client`, `*sql.DB`, `*redis.Client`, `*kafka.Producer` — all need a `Close`.

**Fix:** Expose `Close`:

```go
func Close() {
    if client != nil { client.CloseIdleConnections() }
}
```

For complex resources, prefer a wired dependency that `main` constructs and `defer Close()`s.

**Why common:** `*http.Client` "feels" stateless. It isn't. Anything with internal goroutines or sockets needs a shutdown story even when used as a singleton.
</details>

---

## Bug 9 — Singleton goroutine leak

```go
package refresher

import (
    "sync"
    "time"
)

type Cache struct {
    data map[string]string
}

var (
    instance *Cache
    once     sync.Once
)

func Get() *Cache {
    once.Do(func() {
        instance = &Cache{data: map[string]string{}}
        go instance.refreshLoop()
    })
    return instance
}

func (c *Cache) refreshLoop() {
    ticker := time.NewTicker(10 * time.Second)
    for range ticker.C {
        c.data = loadFromBackend()
    }
}
```

Used in test:

```go
func TestRefresher(t *testing.T) {
    c := refresher.Get()
    if c == nil { t.Fatal("nil cache") }
}
```

Run with `go test -count=50 -run TestRefresher` and the process keeps growing.

**What's wrong?**

<details><summary>Answer</summary>

**Bug 1 — Goroutine has no exit:** `refreshLoop` ranges over `ticker.C` forever. Nothing signals exit. With `-count=50` you accumulate ~50 extra goroutines per run; a real test suite turns this into thousands.

**Bug 2 — Data race:** `c.data = loadFromBackend()` from the goroutine races with readers calling `Get().data[k]`. `-race` flags it immediately.

**Bug 3 — Ticker never stopped:** `time.NewTicker` without `Stop()` leaks its internal goroutine.

**Spot in review:** Singletons that spawn goroutines in their initialiser, especially from `sync.Once.Do`, with no cancellation channel.

**Fix:** Add lifecycle with `stop`/`done` channels, defer `ticker.Stop()`, and guard `data` with an RWMutex. Then don't use a singleton — wire it from `main` and `defer Close()`.

**Why common:** "Just spawn a goroutine, it'll loop forever, that's the point." Goroutine leaks are silent in production until OOM, and aggressive in test suites that import the package many times.
</details>

---

## Bug 10 — Test sets singleton, doesn't restore

```go
package clock

import "time"

type Clock interface {
    Now() time.Time
}

type realClock struct{}
func (realClock) Now() time.Time { return time.Now() }

var instance Clock = realClock{}

func Set(c Clock) { instance = c }
func Now() time.Time { return instance.Now() }
```

Used:

```go
type fakeClock struct{ t time.Time }
func (f *fakeClock) Now() time.Time { return f.t }

func TestExpiry(t *testing.T) {
    clock.Set(&fakeClock{t: time.Unix(1700000000, 0)})
    // ... test that exercises expiry logic ...
    if clock.Now().Unix() != 1700000000 { t.Fatal("clock not set") }
}

func TestRetry(t *testing.T) {
    // ... assumes clock.Now() is real time ...
    if clock.Now().Before(time.Now().Add(-time.Second)) {
        t.Fatal("clock looks fake")
    }
}
```

**What's wrong?**

<details><summary>Answer</summary>

**Bug:** `TestExpiry` sets the singleton clock to a fixed time and never restores it. If `TestRetry` runs after `TestExpiry` (which it will, alphabetically and in `go test` source order), it sees the fake clock and fails. Worse, if you `go test -shuffle=on`, the failure order changes between runs — classic test flake.

If either test uses `t.Parallel()`, every parallel test that reads `clock.Now()` races with `Set` and reads inconsistent state. There's no synchronisation around `instance`.

**Spot in review:** Any package-level mutable singleton with a `Set`/`Replace` function. Any test that calls such a setter without a deferred restore. Pair this with `-shuffle=on` in CI to find the bugs sooner.

**Fix:** Restore in `t.Cleanup`:

```go
func TestExpiry(t *testing.T) {
    prev := clock.Swap(&fakeClock{t: time.Unix(1700000000, 0)})
    t.Cleanup(func() { clock.Set(prev) })
    // ...
}

// in package clock:
func Swap(c Clock) Clock { prev := instance; instance = c; return prev }
```

Better: don't use a singleton clock. Inject the `Clock` interface. Tests pass their own; production wires the real one in `main`.

**Why common:** Singletons + `Set` for tests look harmless. Reviewers don't catch missing cleanup because the test passes in isolation. A test that fails 1-in-50 runs because of ordering is the worst kind of debt.
</details>

---

## Bug 11 — `sync.Once.Do` panic leaves state half-initialised

```go
package broker

import (
    "sync"
)

type Broker struct {
    conn   *Conn
    topics map[string]*Topic
}

var (
    instance *Broker
    once     sync.Once
)

func Get() *Broker {
    once.Do(func() {
        instance = &Broker{topics: map[string]*Topic{}}
        instance.conn = dial() // may panic on network failure
        instance.topics["events"] = newTopic(instance.conn)
    })
    return instance
}
```

Used:

```go
defer func() {
    if r := recover(); r != nil {
        log.Printf("broker init failed, will retry on next request: %v", r)
    }
}()
b := broker.Get()
b.Publish("events", "hello")
```

Then on the next request:

```go
b := broker.Get() // expecting a retry
b.Publish("events", "hello") // panic: nil map / nil conn
```

**What's wrong?**

<details><summary>Answer</summary>

**Bug:** `sync.Once.Do` marks the once as *done* even if the function panics. The next call to `Do` is a no-op. `instance` is set to a partially constructed `*Broker` (the assignment ran before `dial()`), but `instance.conn` is nil and `topics["events"]` was never created. Subsequent `Publish` calls panic on nil access.

The semantic the developer wanted ("init once, retry on failure") is not what `sync.Once` provides. `sync.Once` is "exactly one attempt, success or failure."

**Spot in review:** `sync.Once.Do` containing fallible operations (network dials, file opens) with no error path. Recovery loops wrapping `Get()` — the dev expected retry semantics they didn't implement.

**Fix:** Roll your own with a mutex and an error if you need retry semantics, *or* (better) don't dial inside the singleton — have `main` dial and inject.

**Why common:** Developers assume `sync.Once` retries on panic. It doesn't. The bug is invisible until a transient init failure leaves a binary permanently broken until restart.
</details>

---

## Bug 12 — Captured error from `sync.Once` shadowed

```go
package db

import (
    "database/sql"
    "sync"
)

var (
    instance *sql.DB
    initErr  error
    once     sync.Once
)

func Open(dsn string) (*sql.DB, error) {
    once.Do(func() {
        db, err := sql.Open("postgres", dsn)
        if err != nil {
            initErr = err
            return
        }
        if err := db.Ping(); err != nil {
            initErr = err
            return
        }
        instance = db
    })
    return instance, initErr
}
```

Used:

```go
db, err := db.Open(os.Getenv("DB_URL"))
if err != nil {
    log.Fatal(err)
}
```

Two days later someone refactors the inner function:

```go
once.Do(func() {
    db, err := sql.Open("postgres", dsn)
    if err != nil {
        initErr = err
        return
    }
    if err := db.Ping(); err != nil {
        initErr = err
        return
    }
    if err := warmCache(db); err != nil {
        return // forgot initErr = err
    }
    instance = db
})
```

**What's wrong?**

<details><summary>Answer</summary>

**Bug 1 — Shadowed error:** The third error branch returns *without* writing to `initErr`. `Open` returns `(nil, nil)` when `warmCache` fails. Callers think the DB opened successfully and panic on the first query against the nil `*sql.DB`.

**Bug 2 — Inner `if err := …` shadow:** `if err := db.Ping(); err != nil { initErr = err }` declares a fresh `err` that shadows the outer one. That's fine here (each branch assigns to `initErr`), but it sets up the trap — dropping `initErr = err` in a refactor is invisible because the surrounding code looks symmetric.

**Bug 3 — No clearing on retry:** `sync.Once` doesn't retry. Once `initErr` is set, every subsequent `Open` returns `(nil, initErr)` — even after the underlying issue is fixed.

**Spot in review:** Closures inside `sync.Once.Do` with multiple error paths sharing one `initErr` variable. Any `return` without explicit `initErr = err` is a candidate bug.

**Fix:** Make the closure return the error, then assign once:

```go
once.Do(func() {
    db, err := openAndPing(dsn)
    if err != nil { initErr = err; return }
    if err := warmCache(db); err != nil { initErr = err; return }
    instance = db
})
```

Better: extract a single `openOnce()` function that returns `(*sql.DB, error)` and use a mutex pattern that supports retry on failure.

**Why common:** `sync.Once` + shared error variable is the standard idiom, but it's syntactically fragile. Refactors add new failure paths and silently break the error reporting. Linters don't catch it.
</details>

---

## Bug 13 — Singleton triggered from `init()` of an imported package

```go
// package metrics
package metrics

import "myapp/config"

var Counter int64

func init() {
    cfg := config.Get() // config singleton; reads env, dials Vault
    Counter = cfg.InitialCounter
}
```

```go
// package main
package main

import (
    _ "myapp/metrics"
    "myapp/config"
)

func main() {
    config.Init(loadCustomConfig()) // wants to override defaults before use
    // ...
}
```

**What's wrong?**

<details><summary>Answer</summary>

**Bug:** `metrics.init()` runs *before* `main`. It calls `config.Get()`, which triggers config's `sync.Once` and builds the singleton from *default* environment values. By the time `main` calls `config.Init(loadCustomConfig())`, the singleton already exists — the override is ignored.

Imported packages' `init()`s all run (in dependency order) before `main`. Any `init()` that touches a singleton "freezes" its state before `main` can wire anything.

**Spot in review:** `init()` functions in imported packages that call singleton getters. Singletons with both an `Init(opts)` method *and* lazy `sync.Once` initialisation — the two are in conflict. Side-effect-only imports (`import _ "x"`) that secretly trigger construction.

**Fix:** Move the singleton-touching work out of `init()` and into an exported function `main` calls when ready. If a package legitimately needs config at import time, pass it explicitly — don't pull a global.

```go
// in metrics:
func Initialise(cfg *config.Config) { Counter = cfg.InitialCounter }
// in main:
cfg := config.New(loadCustomConfig())
metrics.Initialise(cfg)
```

**Why common:** "Just init it in init" is the textbook anti-pattern. Singletons amplify it — the order of construction is implicit and reorderable by anyone adding a new import.
</details>

---

## Bug 14 — Singleton hot-reload race

```go
package config

import "sync"

type Config struct {
    LogLevel string
    Timeout  time.Duration
}

var (
    current *Config
    mu      sync.Mutex
)

func Get() *Config {
    return current
}

func Reload(c *Config) {
    mu.Lock()
    current = c
    mu.Unlock()
}

func init() {
    current = &Config{LogLevel: "info", Timeout: 30 * time.Second}
}
```

Used:

```go
// Hot-reload SIGHUP handler:
go func() {
    for range sigHup {
        newCfg := loadFromDisk()
        config.Reload(newCfg)
    }
}()

// Workers:
for i := 0; i < 100; i++ {
    go func() {
        for {
            c := config.Get()
            doWork(c.LogLevel, c.Timeout)
        }
    }()
}
```

**What's wrong?**

<details><summary>Answer</summary>

**Bug:** `Get()` reads `current` without synchronisation while `Reload` writes it under a mutex. A read paired with a write without *shared* synchronisation is a data race — the writer's happens-before edge never reaches the reader. `go test -race` flags it. On weakly ordered hardware, readers can see a pointer to a partially constructed `*Config` if writes are reordered. ("It's just a pointer load, it's atomic" is a fallacy in the Go memory model — even when the load is atomic in practice, the *field reads* off the pointer have no happens-before guarantee with respect to the writer's construction.)

**Spot in review:** A mutex used to *write* a shared variable but not to *read* it.

**Fix:** Use `atomic.Pointer[Config]`:

```go
var current atomic.Pointer[Config]

func Get() *Config       { return current.Load() }
func Reload(c *Config)   { current.Store(c) }

func init() {
    current.Store(&Config{LogLevel: "info", Timeout: 30 * time.Second})
}
```

`atomic.Pointer` gives you a release-acquire pair so readers see the fully constructed `*Config`. Treat the loaded `*Config` as immutable (don't mutate fields after publishing).

**Why common:** Singletons + hot reload + "the writer takes a lock, so we're safe" is a standard misconception. The classic correction in the Go ecosystem is `atomic.Value` (pre-generics) or `atomic.Pointer[T]` (1.19+).
</details>

---

## Bug 15 — Singleton with stale config requires process restart

```go
package featureflags

import (
    "sync"
    "time"
)

type Flags struct {
    enabled map[string]bool
    loaded  time.Time
}

var (
    instance *Flags
    once     sync.Once
)

func Get() *Flags {
    once.Do(func() {
        instance = &Flags{
            enabled: loadFromRemote(),
            loaded:  time.Now(),
        }
    })
    return instance
}

func IsEnabled(name string) bool {
    return Get().enabled[name]
}
```

Used everywhere across the codebase:

```go
if featureflags.IsEnabled("new_checkout") {
    return runNewCheckout(ctx, order)
}
return runLegacyCheckout(ctx, order)
```

Operations turn on `new_checkout` in the remote flag store. Nothing happens until the binary is restarted — sometimes hours later, because the deploy pipeline is slow.

**What's wrong?**

<details><summary>Answer</summary>

**Bug:** Flags are loaded once at first use and cached for the lifetime of the process. No refresh, no TTL, no invalidation hook. Operators expect "turn on flag → flag is on within seconds." They get "turn on flag → wait for next deploy."

This is a *requirements* bug masquerading as a design bug. The singleton was designed correctly for *static* configuration, but feature flags are *dynamic* by definition. Tests pass; the failure mode is operational, not functional.

**Spot in review:** Any singleton that loads from a remote source and never refreshes. Ask: "If the upstream value changes, how does this process find out?" If the answer is "restart the process," the singleton is wrong for the use case.

**Fix:** Add a refresh mechanism with a lifecycle:

```go
type Flags struct {
    mu      sync.RWMutex
    enabled map[string]bool
    stop    chan struct{}
}

func New(refresh time.Duration) *Flags {
    f := &Flags{enabled: loadFromRemote(), stop: make(chan struct{})}
    go f.refreshLoop(refresh)
    return f
}

func (f *Flags) refreshLoop(d time.Duration) {
    t := time.NewTicker(d); defer t.Stop()
    for {
        select {
        case <-f.stop: return
        case <-t.C:
            v := loadFromRemote()
            f.mu.Lock(); f.enabled = v; f.mu.Unlock()
        }
    }
}

func (f *Flags) IsEnabled(name string) bool {
    f.mu.RLock(); defer f.mu.RUnlock()
    return f.enabled[name]
}

func (f *Flags) Close() { close(f.stop) }
```

Wire it from `main` with `defer f.Close()`. Use `atomic.Pointer[map[string]bool]` if you want lock-free reads.

**Why common:** "Singleton" implies "load once." Feature flags, dynamic config, secret rotation, certificate refresh — all of them violate that assumption. Reach for a *managed* singleton (one with refresh and lifecycle), or skip the singleton entirely and inject a service that owns its own refresh loop.
</details>

---

## 2. What these have in common

- **Convenience vs lifecycle.** Singletons make code easy to call, hard to shut down. Anything with goroutines, sockets, or pooled state needs a `Close`.
- **Init order is implicit.** Package-level vars and `init()` functions run in an order you don't control once multiple packages are involved.
- **`sync.Once` is not retryable.** First-call failures are permanent until process restart.
- **Mutating a singleton is global mutation.** Tests that touch global state must restore it; concurrent readers and writers must share a synchronisation primitive.
- **Interface returns hide nil bugs.** Typed nils are the signature failure mode.

Rule of thumb: if you must use a singleton, make it *managed* (explicit `Init`/`Close`, no work in `init()`) and use `atomic.Pointer[T]` for hot-swapped state. Better yet — wire the dependency in `main` and pass it down. Then most of these bugs become structurally impossible.
