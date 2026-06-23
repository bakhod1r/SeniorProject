---
layout: default
title: sync.Once — Middle
parent: sync.Once
grand_parent: sync Package
nav_order: 2
permalink: /roadmap/programming-languages/golang/07-concurrency/03-sync-package/03-once/middle/
---

# sync.Once — Middle Level

← Back to sync.Once

You know `once.Do(f)` and the lazy-singleton pattern. At this level we go beyond the basics: the Go 1.21 helpers (`OnceFunc`, `OnceValue`, `OnceValues`), how to express errors and context cancellation around a one-shot initialiser, how to compose `Once` with other sync primitives, and the patterns for replacing `Once` when you discover you actually need retry or refresh.

---

## 1. The Go 1.21 helpers in detail

### 1.1 `sync.OnceFunc`

`OnceFunc` wraps a `func()` so that the underlying function runs at most once, no matter how many times the returned wrapper is called. From the standard library:

```go
func OnceFunc(f func()) func()
```

Use it when you want to hand around a "do this exactly once" closure as a value:

```go
shutdown := sync.OnceFunc(func() {
    server.Close()
    db.Close()
})

http.HandleFunc("/admin/shutdown", func(w http.ResponseWriter, r *http.Request) {
    shutdown() // safe to call from any handler, any number of times
})

signal.Notify(sigCh, os.Interrupt)
go func() {
    <-sigCh
    shutdown() // also safe; only one will actually run
}()
```

Behaviour notes:

- The returned function is safe for concurrent use.
- If the first call panics, **the wrapper re-panics on every subsequent call** with the same panic value. This is different from raw `sync.Once`, where subsequent calls are silent. Be deliberate about which behaviour you want.
- The underlying function is released for garbage collection after the first successful call (a small but real memory win for closures that capture large state).

### 1.2 `sync.OnceValue`

`OnceValue` is the generic version for a function returning one value:

```go
func OnceValue[T any](f func() T) func() T
```

The first call to the returned function runs `f` and caches the result. Every subsequent call returns the cached value without re-running `f`.

```go
loadConfig := sync.OnceValue(func() *Config {
    cfg, err := parseFile("/etc/app.yaml")
    if err != nil {
        log.Fatal(err) // or panic; up to you
    }
    return cfg
})

func handler(w http.ResponseWriter, r *http.Request) {
    cfg := loadConfig() // O(1) after first call
    serve(w, r, cfg)
}
```

This is the new idiomatic shape for "compute once, read many." No package-level variables, no manual `sync.Once`, no nil checks.

### 1.3 `sync.OnceValues`

`OnceValues` is for the very common `(T, error)` return pattern:

```go
func OnceValues[T1, T2 any](f func() (T1, T2)) func() (T1, T2)
```

```go
openDB := sync.OnceValues(func() (*sql.DB, error) {
    return sql.Open("postgres", dsn)
})

func getDB() (*sql.DB, error) {
    return openDB() // first call opens; rest return same pair
}
```

The two-value form is what most real initialisers want, because the typical Go pattern is `value, error`. Use it.

### 1.4 Panic semantics summary

| API | First call panics, then second call... |
|---|---|
| `sync.Once.Do(f)` | No-op (silent) |
| `sync.OnceFunc(f)()` | Re-panics with the same value |
| `sync.OnceValue(f)()` | Re-panics with the same value |
| `sync.OnceValues(f)()` | Re-panics with the same value |

The 1.21 helpers re-panic on purpose: they treat "the initialiser failed catastrophically" as a fact every caller should learn about, not just the unlucky first one. Choose the wrapper that matches the semantics you want.

---

## 2. Errors and `Once`

Raw `Once` cannot return errors. The standard workarounds:

### 2.1 Capture in a closure variable

```go
var (
    once sync.Once
    db   *sql.DB
    err  error
)

func DB() (*sql.DB, error) {
    once.Do(func() {
        db, err = sql.Open("postgres", dsn)
    })
    return db, err
}
```

Simple, idiomatic before 1.21. Every caller gets the same `(db, err)` pair. If `err` is non-nil, every caller sees it forever — there is no retry.

### 2.2 `OnceValues` (preferred in 1.21+)

```go
var DB = sync.OnceValues(func() (*sql.DB, error) {
    return sql.Open("postgres", dsn)
})
```

Cleaner. Same semantics. Two fewer variables.

### 2.3 Decoupling the once from the error

If you need retry on error, do not put the error-prone operation under `Once`. Put only the *one-time bookkeeping* under `Once`:

```go
type Connector struct {
    setupOnce sync.Once
    mu        sync.Mutex
    db        *sql.DB
}

func (c *Connector) Get() (*sql.DB, error) {
    c.setupOnce.Do(func() {
        // register metrics, set up tracing, etc. — one-shot stuff
    })
    c.mu.Lock()
    defer c.mu.Unlock()
    if c.db != nil {
        return c.db, nil
    }
    db, err := sql.Open("postgres", dsn)
    if err != nil {
        return nil, err
    }
    c.db = db
    return db, nil
}
```

Now the *bookkeeping* runs once. The *connection* can be tried again if it fails. This pattern is sometimes called "Once for setup, Mutex for value."

---

## 3. Cancellation and `Once`

`Once` has no cancellation hook. A long-running `f` is uncancellable from outside. If you need cancellation, you must build it into `f`:

```go
var (
    once sync.Once
    val  *Thing
    err  error
)

func GetWithCtx(ctx context.Context) (*Thing, error) {
    once.Do(func() {
        val, err = buildWithCtx(ctx)
    })
    return val, err
}
```

But beware: the `ctx` of the *first* caller is the one `buildWithCtx` sees. If the first caller cancels mid-init, every subsequent caller sees that cancellation in `err`. This is rarely what you want.

A safer pattern detaches the init from the request context:

```go
var (
    once sync.Once
    val  *Thing
    err  error
)

func Get(ctx context.Context) (*Thing, error) {
    // run the init with a fresh, long-lived context
    once.Do(func() {
        bg, cancel := context.WithTimeout(context.Background(), 30*time.Second)
        defer cancel()
        val, err = buildWithCtx(bg)
    })
    // honour the caller's ctx for the wait
    select {
    case <-ctx.Done():
        return nil, ctx.Err()
    default:
    }
    return val, err
}
```

The `select` is best-effort: if `Once` has already finished, we return its result; if it has not, the caller does not actually get to cancel the init (it is running in another goroutine that owns the `Once`). For true cancellable init, do not use `Once`. Use an `atomic.Pointer` swap or a `golang.org/x/sync/singleflight` group.

---

## 4. `singleflight` — `Once` per key

The `golang.org/x/sync/singleflight` package generalises `Once` to many keys:

```go
import "golang.org/x/sync/singleflight"

var g singleflight.Group

func GetUser(id string) (*User, error) {
    v, err, _ := g.Do(id, func() (any, error) {
        return fetchUser(id)
    })
    if err != nil {
        return nil, err
    }
    return v.(*User), nil
}
```

`Group.Do(key, f)` coalesces concurrent calls with the same key into a single invocation of `f`. Once `f` returns, the result is delivered to all callers, and the key is *forgotten* (unlike `Once`, which remembers forever). This is exactly what you want for a request-level cache that prevents thundering herd.

Use `singleflight` when:

- You have many keys, not a single value.
- You want retry on later requests (key is forgotten after the call completes).
- You want a shared result for *concurrent* callers but independent results for later ones.

Use `Once` when:

- You have a single value.
- You want it built exactly once, forever.

---

## 5. `Once` inside a generic type

A common pattern: a generic lazy holder.

```go
type Lazy[T any] struct {
    once sync.Once
    val  T
    err  error
    f    func() (T, error)
}

func NewLazy[T any](f func() (T, error)) *Lazy[T] {
    return &Lazy[T]{f: f}
}

func (l *Lazy[T]) Get() (T, error) {
    l.once.Do(func() {
        l.val, l.err = l.f()
    })
    return l.val, l.err
}
```

Use:

```go
db := NewLazy(func() (*sql.DB, error) {
    return sql.Open("postgres", dsn)
})

handle, err := db.Get()
```

This is essentially a hand-rolled `OnceValues` with a struct around it, allowing you to embed it in larger types and pass it around by pointer. After Go 1.21, prefer `sync.OnceValues` directly — it is smaller and just as expressive.

---

## 6. Resettable initialisers

`Once` does not reset. If you need to re-run init (for example, after a config reload), you must replace the `Once`:

```go
type Service struct {
    mu   sync.Mutex
    once sync.Once
    cfg  *Config
}

func (s *Service) Config() *Config {
    s.once.Do(s.load)
    return s.cfg
}

func (s *Service) Reload() {
    s.mu.Lock()
    s.once = sync.Once{} // fresh
    s.cfg = nil
    s.mu.Unlock()
}

func (s *Service) load() {
    s.cfg, _ = parseFile(s.path)
}
```

The replacement is itself a write to `s.once`, which races against reads. Hence the mutex. There is no atomic way to swap a `sync.Once`; if you find yourself doing this, consider whether `atomic.Pointer[Config]` is a better fit. The general pattern:

```go
var cfg atomic.Pointer[Config]

func init() {
    cfg.Store(parseFile(path))
}

func Reload() {
    new := parseFile(path)
    cfg.Store(new) // atomic publish
}

func Get() *Config {
    return cfg.Load() // atomic load, lock-free
}
```

Reading is lock-free. Reloading is atomic. There is no `Once` semantics — but there is no need, because the value is loaded eagerly and replaced atomically. This is the right design for hot-reloadable values.

---

## 7. Composing `Once` with `WaitGroup`

You might want to ensure that a *background* goroutine started inside `f` has finished before declaring the `Once` complete. The standard idiom:

```go
type Server struct {
    once sync.Once
    wg   sync.WaitGroup
}

func (s *Server) Start() {
    s.once.Do(func() {
        s.wg.Add(1)
        go func() {
            defer s.wg.Done()
            s.loop()
        }()
    })
}

func (s *Server) Stop() {
    s.signalStop()
    s.wg.Wait()
}
```

`Once` ensures `Start` only kicks off the loop once. `WaitGroup` ensures `Stop` waits for the loop to drain. Each primitive does its own job; together they describe a clean lifecycle.

---

## 8. `Once` in lifecycle objects

A pattern from production codebases: every long-lived service has a paired `startOnce` and `stopOnce`.

```go
type Worker struct {
    startOnce sync.Once
    stopOnce  sync.Once
    quit      chan struct{}
}

func (w *Worker) Start() error {
    var err error
    w.startOnce.Do(func() {
        w.quit = make(chan struct{})
        go w.loop()
    })
    return err
}

func (w *Worker) Stop() {
    w.stopOnce.Do(func() {
        close(w.quit)
    })
}
```

Both `Start` and `Stop` are now idempotent. Multiple `Start` calls only start one loop; multiple `Stop` calls only close the quit channel once. The pattern is so common that some teams ship a small `oncegroup` helper that bundles them.

---

## 9. Mocking `Once` in tests

`sync.Once` is a concrete struct, not an interface. You cannot mock it directly. Two strategies:

### 9.1 Inject the initialiser

```go
type Service struct {
    once   sync.Once
    init   func() error // injectable
    state  *State
}

func (s *Service) Get() *State {
    s.once.Do(func() { _ = s.init() })
    return s.state
}
```

In tests, inject a fast or controlled `init`.

### 9.2 Use a fresh value per test

```go
func TestSomething(t *testing.T) {
    s := &Service{} // fresh Once
    // ...
}
```

The simplest approach. If your `Once` lives at package level, refactor so it lives inside a struct that the test can instantiate. Package-level state is the enemy of testability.

---

## 10. Reading values written under `Once` from other goroutines

A subtle correctness point. This is **safe**:

```go
var (
    once sync.Once
    val  *Thing
)

func Get() *Thing {
    once.Do(func() { val = build() })
    return val
}
```

Every goroutine that calls `Get` is guaranteed to see `val` written, because `once.Do` returns happens-after the assignment.

This is **unsafe**:

```go
go func() {
    once.Do(func() { val = build() })
}()

// in another goroutine, without calling once.Do:
fmt.Println(val) // RACE — no happens-before
```

Reading `val` without participating in `once.Do` does not benefit from the happens-before relationship. You either call `once.Do` (no-op after first call, but cheap and provides ordering) or use `atomic.Pointer` for the storage and a barrier-free read.

The takeaway: **read the value only through a function that itself calls `once.Do`**. Do not "shortcut" past it.

---

## 11. `Once` and goroutine leaks

If `f` spawns a goroutine, `Once` does not own it. If that goroutine never exits, you have a leak that `Once` will not warn you about.

```go
var once sync.Once
once.Do(func() {
    go func() {
        for { tick() } // leak
    }()
})
```

`Once` ran. `Once` is done. The leaked goroutine has nothing to do with `Once` anymore. Always design exit conditions for goroutines spawned inside `f`.

---

## 12. Multiple `Once` values, one resource

Sometimes you want a chain: "if step A has run, do step B; if step B has run, do step C." Naive approach with multiple `Once`s:

```go
var (
    onceA, onceB, onceC sync.Once
)

func doA() { onceA.Do(setupA) }
func doB() { onceA.Do(setupA); onceB.Do(setupB) }
func doC() { onceA.Do(setupA); onceB.Do(setupB); onceC.Do(setupC) }
```

Works but verbose. Cleaner:

```go
var setupAll = sync.OnceFunc(func() {
    setupA()
    setupB()
    setupC()
})

func anyEntryPoint() {
    setupAll()
    // ...
}
```

If you really need separate stages because some users only need step A, keep them separate. If everyone needs everything, collapse.

---

## 13. Memory cost

A `sync.Once` is 12 bytes on 64-bit (a `uint32 done` plus a `sync.Mutex` which is 8 bytes). After alignment it occupies 16 bytes in a struct. That is comparable to a `sync.Mutex` and cheap to embed.

The closure passed to `Do` lives on the heap until the `Once` is freed (or the function returns and the closure is no longer reachable). For `sync.OnceFunc`/`OnceValue`, the wrapper releases the function reference after the first successful call, allowing GC.

---

## 14. When `Once` is the wrong tool

A short decision guide for cases that *look* like `Once` but are not:

| Need | Better tool |
|---|---|
| Run on every program start, always | `init()` function |
| Run when explicitly asked, possibly more than once | Plain function |
| Run once per key | `singleflight.Group` |
| Run once but reset on demand | `atomic.Pointer[T]` + reload |
| Run periodically | `time.Ticker` + goroutine |
| Run once with retry on failure | `Mutex` + nil-check, or custom retry loop |
| Build a value lazily without concurrency | Plain `if x == nil { x = ... }` |

The trap is using `Once` because it is small and "feels right," then discovering you need behaviour `Once` does not offer. Choose deliberately.

---

## 15. Summary

At middle level, `Once` stops being a single trick and becomes a primitive you compose:

- **1.21 helpers** (`OnceFunc`, `OnceValue`, `OnceValues`) are the new idiomatic shape for value-returning initialisers. Use them.
- **Errors** must be captured via closure variables or via `OnceValues`. `Do` itself returns nothing.
- **Cancellation** is not built in; design `f` to be uncancellable or move to a different abstraction.
- **Retry** is a sign you should use `singleflight`, `atomic.Pointer`, or a mutex-guarded "try again" pattern instead.
- **Composition** with `WaitGroup` gives you safe start/stop lifecycles. The "startOnce + stopOnce" pair is the idiomatic skeleton for long-lived services.
- **Reading values** written inside `Do` from other goroutines is safe only when the reader also calls `Do` (which is a fast no-op after the first time).

At senior level we will look at the memory model proof of correctness, the trade-offs versus `atomic.Pointer`, and the deeper interaction with `init()` and package loading. After that, professional level opens the implementation and walks through the actual fast path and slow path of `sync.Once` in `src/sync/once.go`.
