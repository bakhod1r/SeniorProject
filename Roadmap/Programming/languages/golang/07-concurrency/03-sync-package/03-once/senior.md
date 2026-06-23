---
layout: default
title: sync.Once — Senior
parent: sync.Once
grand_parent: sync Package
nav_order: 3
permalink: /roadmap/programming-languages/golang/07-concurrency/03-sync-package/03-once/senior/
---

# sync.Once — Senior Level

← Back to sync.Once

At senior level we step back and look at `Once` as one tool among several, with explicit trade-offs. The questions become design questions: when does `init()` win, when does `atomic.Pointer` win, when do you need `singleflight`, when is `Once` actively the wrong primitive even though it would compile and pass tests? We also dive into the memory model proof that justifies the happens-before guarantee, and the API shape of the Go 1.21 helpers as a deliberate evolution.

---

## 1. The memory model contract

The Go memory model documents the happens-before guarantee of `sync.Once`:

> "The completion of a call to `once.Do(f)` is synchronized before the return of any later call of `once.Do(g)`."

Three precise points:

1. *Completion* of `Do` — not the start. The first caller's `Do` is fully done before any later caller's `Do` returns.
2. *Any later call*, not just calls passing `f`. Subsequent calls passing different functions (which `Once` ignores) still inherit the synchronisation.
3. *Synchronised before* is the same relation that connects mutex unlock to a later lock, or channel send to a later receive. It is the strongest ordering Go offers.

In practice, this means writes inside the first caller's `f` are visible to every later caller, with no additional `atomic`, `Mutex`, or `chan` between them. You can safely write:

```go
var (
    once sync.Once
    val  []int
)

func init() {} // unused; just for emphasis

func Get() []int {
    once.Do(func() {
        val = []int{1, 2, 3, 4, 5}
    })
    return val // safe: happens-after the assignment
}
```

This is not "the value is published by a closure variable so it must be visible." It is the formal happens-before relation between `Do` calls. If you removed the `once.Do` and just called the assignment from one goroutine while reading from another, you would have a data race even if the read appeared "later" in wall-clock time.

---

## 2. `Once` versus `init()`

Both run something exactly once. The differences:

| Aspect | `init()` | `sync.Once` |
|---|---|---|
| When | At package load, before `main` | First call to `Do` |
| Cost | Always runs | Runs only if `Do` is called |
| Concurrency | Single-threaded (package load is serial) | Safe under concurrent callers |
| Error reporting | Cannot return; `log.Fatal` is the idiom | Capture via closure variable or `OnceValues` |
| Per-instance | No — package-global only | Per-`Once`-value |
| Reset for tests | No way to re-run | Replace the `Once` (with care) |
| Visibility in pprof | Time spent shows up at startup | Time spent shows up on first call |

**Choose `init()` when:**

- The work is cheap (microseconds).
- The work must complete before `main` for the program to be valid.
- You want a deterministic, ordered, single-threaded init.
- You do not need per-instance state.

**Choose `Once` when:**

- The work may not be needed at all in some runs.
- The work is expensive and would hurt cold start.
- You want per-struct or per-instance lazy fields.
- You want tests to control init by constructing fresh instances.

A frequent mistake is putting *all* package state into `init()` "because it's easier." Cold-start latency dies the death of a thousand `init` cuts. Lazy `Once`-based init is, in 2026 cloud Go, often the better default.

---

## 3. `Once` versus `atomic.Pointer[T]`

`atomic.Pointer[T]` (Go 1.19+) is a typed atomic pointer. It supports `Load`, `Store`, `Swap`, and `CompareAndSwap`. For "build a value lazily, share it everywhere," it overlaps with `Once`.

```go
var configPtr atomic.Pointer[Config]

func Config() *Config {
    if c := configPtr.Load(); c != nil {
        return c
    }
    newC := build()
    if configPtr.CompareAndSwap(nil, newC) {
        return newC
    }
    return configPtr.Load() // someone else won
}
```

Two important differences from `Once`:

- **`build()` may run more than once.** Two goroutines that both see `nil` will both call `build`; only one's result wins the CAS. The losers' results are garbage.
- **No happens-before between `build` calls.** Each `build` runs independently. If `build` is idempotent (pure function of inputs), this is fine. If it has side effects (registers a metric, opens a socket), you may double up.

**Choose `Once` when:**

- `build` has side effects (file open, goroutine spawn, log).
- `build` is expensive enough that running it twice is unacceptable.
- You want blocking behaviour: late callers wait for the first to finish.

**Choose `atomic.Pointer` when:**

- `build` is pure and cheap.
- You may need to replace the value later (hot reload).
- Readers are extremely hot and must be lock-free even on the slow path.

`Once` and `atomic.Pointer` are sometimes combined:

```go
var (
    once sync.Once
    ptr  atomic.Pointer[Config]
)

func Get() *Config {
    once.Do(func() { ptr.Store(build()) })
    return ptr.Load()
}

func Reload() {
    ptr.Store(build())
}
```

`Once` gives you the "exactly once for initial build." `atomic.Pointer` gives you reload without violating the read path. The combination is more verbose than either alone but matches real-world need.

---

## 4. `Once` versus `sync.Map`

`sync.Map` provides per-key concurrent access. It is *not* a lazy-init primitive, but it is often *misused* as one.

```go
var m sync.Map

func GetUser(id string) *User {
    if v, ok := m.Load(id); ok {
        return v.(*User)
    }
    u := fetchUser(id) // may run many times for the same id under contention
    actual, _ := m.LoadOrStore(id, u)
    return actual.(*User)
}
```

This is the cousin of `atomic.Pointer`: `fetchUser` may run multiple times for the same `id`, and you only learn that one of them won the race after the fact. If `fetchUser` is pure, fine. If it has side effects, this is wrong.

For per-key "exactly once with blocking," use `singleflight.Group`:

```go
import "golang.org/x/sync/singleflight"

var (
    cache sync.Map
    g     singleflight.Group
)

func GetUser(id string) (*User, error) {
    if v, ok := cache.Load(id); ok {
        return v.(*User), nil
    }
    v, err, _ := g.Do(id, func() (any, error) {
        u, err := fetchUser(id)
        if err == nil {
            cache.Store(id, u)
        }
        return u, err
    })
    if err != nil {
        return nil, err
    }
    return v.(*User), nil
}
```

`singleflight` is `Once` per key, with the key forgotten after the call completes. This is the standard answer for "stop the thundering herd on a cache miss."

---

## 5. The full design space

For "compute a value lazily, share it":

```
                           Concurrent callers?
                                   |
                  +----------------+----------------+
                  |                                 |
                  No                               Yes
                  |                                 |
              nil check                  Need retry on error?
              + plain build                         |
                                  +---------+-------+--------+
                                  |                          |
                                  No                        Yes
                                  |                          |
                          Single value?            Per-key or single?
                          |                                  |
                  +-------+--------+                +--------+-------+
                  |                |                |                |
                Yes               No (per key)    Single key       Many keys
                  |                                  |                |
            Build has              singleflight    Mutex +       singleflight
            side effects?          (one shot)      nil check    (cache outside)
            |
       +----+----+
       |         |
      Yes        No
       |         |
   sync.Once  atomic.Pointer
   /OnceValue
```

This decision tree captures most production cases. Memorise the leaves: `init()`, plain `Once`, `OnceValue`, `atomic.Pointer`, `Mutex`-guarded nil check, `singleflight`.

---

## 6. Why `Once` blocks late callers

A subtle design choice: when a late goroutine arrives mid-init, `Once` makes it *wait* until the in-flight init finishes. Compare with `atomic.Pointer` + CAS, which lets the late caller observe `nil`, run `build`, and lose the CAS.

The blocking is essential for `Once`'s correctness guarantee. If late callers did not wait, they could observe `done == 0` and re-run `f` — defeating "exactly once." With blocking, the slow path holds a mutex while `f` runs, and the late callers acquire the same mutex (then immediately see `done == 1` and return).

The trade-off: under heavy concurrent first-touch (say, a process startup where all 1000 goroutines hit `Once` simultaneously), 999 of them block on the mutex. This is bounded by `f`'s runtime — usually milliseconds for a connection or config load — and is a one-time cost. If you cannot tolerate this brief stampede, *pre-warm* `Once` by calling it synchronously at startup before spawning workers.

```go
func main() {
    Get() // pre-warm; runs `f` synchronously
    for i := 0; i < 1000; i++ {
        go worker()
    }
}
```

Now every worker enters `Once` on the fast path. No mutex.

---

## 7. The 1.21 helpers, viewed as API design

`OnceFunc`, `OnceValue`, `OnceValues` were added in Go 1.21. Why?

The pre-1.21 idiom for a value-returning lazy load was the three-variable dance:

```go
var (
    once sync.Once
    val  *Thing
    err  error
)
```

This has three problems:

1. **Three package-level variables** for one logical concept. Pollution.
2. **No type pairing.** Nothing connects `val` and `err` to `once`. A typo can shadow one of them.
3. **Forcing `(val, err) = ...` style.** Awkward for functions with one return.

The helpers fix all three:

```go
var get = sync.OnceValues(func() (*Thing, error) { return build() })
```

One variable, type-paired, smooth call site (`get()`). Even better, the *captured closure* is released after the first successful call — a small memory win for closures over large state.

The 1.21 helpers also have a deliberate panic policy: re-panic on every subsequent call, with the same value. This is the opposite of raw `Once`, which silently no-ops on every subsequent call after a panicking first call. The rationale: a panicking `f` is almost always a bug, and silent no-op masks it. The helpers surface it loudly.

In greenfield code, prefer the helpers. In existing code, do not migrate just for the sake of migrating — both styles are correct.

---

## 8. The "set the value, then publish" idiom

A pattern that comes up in lock-free contexts: build a value, then publish the pointer atomically. `Once` does this automatically, but you can do it manually for finer control:

```go
var ptr atomic.Pointer[Config]
var initOnce sync.Once

func Get() *Config {
    initOnce.Do(func() {
        c := &Config{}
        c.load()      // fill the struct
        c.validate()  // verify
        ptr.Store(c)  // publish
    })
    return ptr.Load()
}
```

The point: `c` is *not* visible to anyone outside this goroutine until `ptr.Store(c)`. Until then, anyone calling `Get` sees a `nil`. This avoids the classic "partially constructed object" race that haunts other languages: a reader cannot observe the struct mid-fill, only either nil or fully-built.

`Once` already provides this via happens-before, but explicit `atomic.Pointer` publication is sometimes useful when you need *replacement* later. Both idioms can coexist.

---

## 9. Locking interaction

A `Once` taken from inside a mutex-held region is fine, but be aware of nesting:

```go
var (
    mu   sync.Mutex
    once sync.Once
    val  int
)

func F() int {
    mu.Lock()
    defer mu.Unlock()
    once.Do(func() { val = expensive() })
    return val
}
```

If `expensive()` takes 5 seconds and 100 goroutines call `F`, the first one holds `mu` for 5 seconds. All others queue. The slow path of `Once` is now serialised by `mu`, which defeats the brief blocking that `Once`'s own mutex would otherwise have.

Better: do `Once.Do` *outside* the mutex.

```go
once.Do(func() { val = expensive() })
mu.Lock()
defer mu.Unlock()
// read or modify val under mu
```

`Once`'s own mutex handles the concurrent first-touch. `mu` handles the protection of `val` once it exists. This is correct because `Once`'s happens-before guarantees `val` is initialised before any caller proceeds; later mutations to `val` are guarded by `mu`.

---

## 10. Visibility for `chan struct{}` waiters

A `closed` channel is itself an "exactly once" signal. The combination shows up in shutdown patterns:

```go
type Server struct {
    closeOnce sync.Once
    done      chan struct{}
}

func (s *Server) Stop() {
    s.closeOnce.Do(func() {
        close(s.done)
    })
}

func (s *Server) Wait() {
    <-s.done
}
```

`closeOnce` guarantees `close(s.done)` runs once. `<-s.done` returns the zero value immediately for every reader after the close (this is a property of closed channels, not of `Once`). Together: idempotent `Stop`, any number of `Wait` callers.

You can do this without `Once`, using "select on a sentinel" tricks, but `Once.Do(func() { close(ch) })` is the cleanest expression of "this channel is closed exactly once, no matter who tries."

---

## 11. `Once` and the GC

A subtle point: the function `f` passed to `Do` is held in the `Once` struct (via the closure) until the `Do` call completes. For raw `sync.Once`, *the closure is not released after the first call* — the function value lives as long as you have a reference to `Once`. In long-lived programs, a closure that captures a large struct can hold that struct alive indefinitely.

`sync.OnceFunc`, `OnceValue`, `OnceValues` (1.21+) explicitly release the function pointer after the first successful call. From the source:

```go
// runtime simplified:
return func() T {
    d.once.Do(...)
    f = nil // release reference for GC
    return d.val
}
```

If you have a `Once` that captures a lot of state in the closure, prefer the 1.21 helpers to let the GC reclaim that state. For trivial closures (a few pointers to existing globals), the difference is invisible.

---

## 12. Cross-version concerns

`Once` itself has been stable since Go 1.0. The fast-path implementation has been polished (especially around the `done` field becoming `atomic.Uint32` in newer versions), but the contract is unchanged. Code from 2012 using `sync.Once` still works identically today.

The Go 1.21 helpers are new. Code that needs to compile against earlier Go versions cannot use them. If you support pre-1.21:

```go
//go:build go1.21
package mypkg

var loader = sync.OnceValue(build)

//go:build !go1.21
package mypkg

var (
    once sync.Once
    val  *Thing
)
func loader() *Thing {
    once.Do(func() { val = build() })
    return val
}
```

In practice, most modern Go projects can require 1.21+ today (2026) and avoid the build-tag dance.

---

## 13. Once and observability

How do you tell, in production, whether a `Once` has actually fired?

There is no public API to inspect the `done` flag. You can:

- **Log inside `f`.** A line "config loaded" on first use tells you exactly when init happened.
- **Expose a `bool` via your own accessor.** `IsInitialized() bool` that flips inside `f`.
- **Use metrics.** A counter incremented inside `f` will go from 0 to 1 exactly once.

Do not reach for `unsafe` or runtime reflection to peek inside `sync.Once`. The flag is private for a reason: the struct layout is allowed to change. Build your own observability.

For pprof: time inside `f` shows up under the *first* caller's stack. If `f` is expensive, this can be misleading — the rest of the system was waiting too. The aggregate cost is "time spent in `f`" plus "time spent waiting for `f`," but pprof only attributes the former.

---

## 14. Patterns from the standard library

`sync.Once` is used internally throughout the Go standard library. Worth studying:

- **`net/http.Server.RegisterOnShutdown`**: each registered hook can be wrapped in a `Once` so it runs once across multiple Shutdown invocations.
- **`encoding/gob`**: type registration is gated by `sync.Once` so the registry only initialises on first encode.
- **`runtime/pprof`**: the profile listing initialises lazily via `Once`.
- **`crypto/x509`**: root pool loading is `Once`-guarded.
- **`time` package**: the monotonic clock detection is `Once`-style internally.

Reading these is instructive: they all follow the pattern "package-level `Once` + package-level value + accessor." No reset, no retry, no fancy composition. Sometimes the boring pattern is the right one.

---

## 15. Testing strategies

`Once` makes unit testing harder because state survives the test. Strategies:

### Restructure so `Once` lives in an injectable type

```go
type Loader struct {
    once sync.Once
    val  *Thing
    src  Source
}

func (l *Loader) Get() *Thing {
    l.once.Do(func() { l.val = l.src.Load() })
    return l.val
}

func TestLoader(t *testing.T) {
    l := &Loader{src: fakeSource{}}
    if l.Get() != expected {
        t.Fail()
    }
}
```

Fresh `Loader` per test. No shared `Once`.

### Use `t.Cleanup` to reset (if you control the variable)

If the `Once` is package-level and you cannot avoid it, expose a test-only reset:

```go
//go:build testonly
package mypkg

func ResetForTest() {
    once = sync.Once{}
    val = nil
}
```

Guard with a build tag so production cannot call it. This is a confession that the design is hard to test; prefer the first strategy.

### `singleflight` for tests that need retry

If your tests want "first call returns error, second call succeeds," `Once` cannot do this. Switch to `singleflight` for these tests, or design the production code with retry built in.

---

## 16. Summary

At senior level, `Once` is one primitive in a constellation:

- **`init()`** for eager, always-needed, single-threaded init.
- **`sync.Once` / `OnceValue` / `OnceValues`** for lazy, exactly-once, blocking-on-late-callers init.
- **`atomic.Pointer[T]`** for lock-free reads and possible reload.
- **`singleflight.Group`** for "exactly once per key, forget after."
- **Mutex + nil check** for retry-on-error.

The decision tree depends on whether you have one value or many, side effects or pure builds, retry-on-failure or commit-forever, eager or lazy. `Once` excels in one quadrant of the space — single value, side effects, commit-forever, lazy — and is wrong in others.

The memory model gives `Once` its real power: not just "runs once" but "publishes safely." Without happens-before, lazy singletons would be a race nightmare. With it, you can read the value from any goroutine and trust the runtime.

Next, professional level opens `src/sync/once.go` and walks line by line through the fast path, the slow path, and the runtime semaphore that backs the mutex. After that, specification gives the formal contract from the Go spec and stdlib documentation.
