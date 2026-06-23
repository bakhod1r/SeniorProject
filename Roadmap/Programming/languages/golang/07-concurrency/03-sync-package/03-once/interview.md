---
layout: default
title: sync.Once — Interview
parent: sync.Once
grand_parent: sync Package
nav_order: 6
permalink: /roadmap/programming-languages/golang/07-concurrency/03-sync-package/03-once/interview/
---

# sync.Once — Interview Questions

← Back to sync.Once

Questions from junior screening to staff-level system design, with model answers. Use these to gauge a candidate's depth — or your own.

---

## Junior level

### Q1. What is `sync.Once` and what problem does it solve?

`sync.Once` is a primitive in the `sync` package that ensures a function passed to its `Do` method runs exactly once, even when called from multiple goroutines concurrently. It solves the lazy-initialisation problem: you want to build an expensive resource (database connection, parsed config, compiled regex) on first use, share it across all goroutines, and never re-initialise.

The API is one method: `Do(f func())`. The first call runs `f`; all subsequent calls (from any goroutine) are no-ops. Concurrent callers block until the first call's `f` completes.

### Q2. Write a thread-safe lazy singleton with `sync.Once`.

```go
package main

import "sync"

type DB struct{ /* ... */ }

var (
    once sync.Once
    inst *DB
)

func Instance() *DB {
    once.Do(func() {
        inst = &DB{}
    })
    return inst
}
```

Every call to `Instance` returns the same `*DB`. The struct is built on the first call, on the calling goroutine. All later callers (and concurrent first callers that lose the race) skip the construction.

### Q3. What is wrong with this code?

```go
func Setup() {
    var once sync.Once
    once.Do(load)
}
```

The `once` is declared inside `Setup`. Each call to `Setup` creates a new `Once`, so "exactly once" really means "exactly once per call to `Setup`" — which is the same as just calling `load()`. The `Once` must be declared at package level (or in a long-lived struct field) to share the "exactly once" state across calls.

### Q4. What happens if `f` passed to `once.Do` panics?

The panic propagates to the caller of `Do`. The `Once` is marked done (because the deferred store of the done flag runs even on panic). Subsequent calls to `Do` are no-ops — `f` is not re-run. This is by design: `Once` treats "the function ran" and "the function panicked" as the same event.

### Q5. Can `Do` return an error?

No. `Do` returns nothing, and `f` is `func()` (no return value). To propagate an error, capture it in a closure variable:

```go
var (
    once sync.Once
    err  error
)
once.Do(func() {
    _, err = openFile()
})
```

In Go 1.21+, prefer `sync.OnceValues` for cleaner code:

```go
var open = sync.OnceValues(func() (*File, error) { return openFile() })
f, err := open()
```

### Q6. Why must you not copy a `sync.Once`?

A `sync.Once` carries its state (a done flag and a mutex) inside the struct. Copying produces two independent `Once` values, each tracking its own "has run" state. The "exactly once" guarantee is broken — `f` may run once for each copy. `go vet` warns about copies via the `noCopy` marker.

### Q7. What does this print?

```go
var once sync.Once
once.Do(func() { fmt.Print("A") })
once.Do(func() { fmt.Print("B") })
```

`A`. The second `Do` is a no-op because the `Once` already ran. The function `B` is ignored — `Once` does not key on function identity.

### Q8. What is `init()` and when would you use it instead of `Once`?

`init()` is a special function that runs at package load time, before `main`. Use `init()` for cheap initialisation that always needs to happen (registering encoders, setting defaults). Use `Once` for expensive initialisation that may not always be needed, or that depends on first-use state. The key trade-off: `init` is eager, `Once` is lazy.

---

## Middle level

### Q9. Explain the happens-before guarantee of `sync.Once`.

The Go memory model states that the completion of `f` in `once.Do(f)` is synchronised before the return of any subsequent `once.Do(...)` call. Concretely: any writes performed inside `f` are visible to any goroutine that later calls `Do` (or whose own `Do` call returned), without additional synchronisation. This is what makes lazy singletons safe — a reader does not need a mutex around the read; the `Once.Do` they call (even as a no-op) gives them the happens-before relation.

### Q10. What is the difference between `sync.Once` and `sync.OnceFunc`?

`sync.Once` is a struct with a `Do(f)` method. `sync.OnceFunc(f)` is a function added in Go 1.21 that returns a wrapped function: calling the wrapper invokes `f` at most once.

```go
shutdown := sync.OnceFunc(func() { server.Close() })
shutdown() // runs
shutdown() // no-op
```

The wrapper is convenient because you can hand it around as a value without exposing a struct field. It also has different panic semantics: if the first call panics, *every subsequent call* re-panics with the same value, instead of silently no-op'ing as raw `Once` does.

### Q11. When would you use `sync.OnceValue` over manual `sync.Once`?

`OnceValue(f)` is the cleaner option when `f` returns a single value:

```go
// Pre-1.21:
var (
    once sync.Once
    cfg  *Config
)
func Config() *Config {
    once.Do(func() { cfg = parse() })
    return cfg
}

// 1.21+:
var Config = sync.OnceValue(parse)
```

One variable instead of two, the type pairing is explicit, and the captured closure is released for GC after the first successful call.

### Q12. What is wrong with using `Once` to retry a failing init?

`Once` does not reset. If the first `Do` call's `f` fails (returns an error you stored, panics, leaves the state nil), the `Once` is permanently marked done. Subsequent calls do nothing. There is no way to retry with the same `Once`. The fix is to use a different abstraction: a mutex-guarded nil check, an `atomic.Pointer` swap, or `singleflight.Group` (which forgets the key after each call so retries can happen on later requests).

### Q13. Why does this deadlock?

```go
var once sync.Once
once.Do(func() {
    once.Do(setup)
})
```

The outer `Do` enters the slow path and acquires the internal mutex. Inside `f`, the inner `Do` also goes to the slow path (because `done` is still 0; the deferred `done = 1` has not run yet). It tries to acquire the same mutex — held by the same goroutine, never to be released. Deadlock.

### Q14. How do you safely close a channel from multiple goroutines?

Wrap the `close` in a `Once.Do`:

```go
type Server struct {
    once sync.Once
    done chan struct{}
}

func (s *Server) Stop() {
    s.once.Do(func() { close(s.done) })
}
```

Now `Stop` can be called any number of times from any number of goroutines, and the channel is closed exactly once. Without the `Once`, the second close panics with "close of closed channel."

### Q15. What is `singleflight` and how does it relate to `Once`?

`golang.org/x/sync/singleflight.Group` is a generalisation of `Once` to many keys. `g.Do(key, f)` coalesces concurrent calls with the same key into one execution of `f`. Once `f` returns, the result is delivered to all waiters and the key is *forgotten* — unlike `Once`, which remembers forever. Use `singleflight` when you want per-key deduplication of concurrent work but want retry-on-failure on later calls. Use `Once` when you want one value, committed for the program lifetime.

### Q16. What's the difference in panic behaviour between `Once.Do` and `OnceFunc`?

`Once.Do`: if the first call panics, the panic propagates to the caller. The `Once` is marked done. Subsequent calls silently no-op — they do not re-panic, do not see the error.

`OnceFunc` (and `OnceValue`, `OnceValues`): if the first call panics, the panic propagates. Subsequent calls *re-panic with the same value*. Every caller learns about the failure.

The 1.21 helpers chose loud panic replay deliberately, because silent failures in init are usually bugs.

---

## Senior level

### Q17. Compare `sync.Once`, `atomic.Pointer[T]`, and a mutex-guarded nil check for lazy initialisation.

All three can build a value lazily. Differences:

- **`sync.Once`**: blocks late callers until `f` completes. `f` runs at most once. Strong happens-before. Cannot reset. Best for "value with side effects, committed forever."
- **`atomic.Pointer[T]` with CAS**: `f` may run multiple times (one wins, others' results are discarded). No blocking. Lock-free reads. Easy to swap atomically for hot reload. Best for "pure builder, possibly replaceable."
- **Mutex + nil check**: blocks late callers. `f` runs once (or more, if you let retries). Allows explicit reset. More verbose. Best for "may need retry on error."

The choice depends on (a) whether `f` has side effects, (b) whether you need reload, (c) whether you need retry.

### Q18. How is `sync.Once` implemented?

```go
type Once struct {
    done atomic.Uint32
    m    Mutex
}

func (o *Once) Do(f func()) {
    if o.done.Load() == 0 {
        o.doSlow(f)
    }
}

func (o *Once) doSlow(f func()) {
    o.m.Lock()
    defer o.m.Unlock()
    if o.done.Load() == 0 {
        defer o.done.Store(1)
        f()
    }
}
```

Fast path: atomic load of `done`. If 1, return. Slow path: take the mutex, double-check `done`, run `f` if still 0, set `done = 1` (deferred so it runs even on panic), release mutex. The atomic store-with-lock-held plus atomic load-on-fast-path establishes the happens-before relation, making lazy singletons race-free.

### Q19. Why is the `defer o.done.Store(1)` placed *inside* the `if`, not outside?

If the deferred store were outside the `if`, every call that took the slow path would set `done = 1`, including the late callers who arrived after the first call already completed. That would be a no-op (it is already 1), so technically harmless. But putting it inside the `if` makes the intent precise: "store the done flag exactly when we run `f`." It also keeps the defer scoped to the path that actually does the work.

More importantly, placing it as `defer` *inside* the if ensures it runs *even if `f` panics*, which is the entire reason `Once` treats panic as completion. A direct `o.done.Store(1)` *after* `f()` would skip the store on panic and leave the `Once` falsely "not done."

### Q20. Why does Go provide both `Once.Do` and the 1.21 helpers?

`Once.Do` is the original primitive: one method, accepts a `func()`, runs it once. Limitations: cannot return values, cannot signal errors, leaves a verbose three-variable pattern when used with values.

The 1.21 helpers (`OnceFunc`, `OnceValue`, `OnceValues`) wrap `Once` to:

- Return a function value (no struct field needed).
- Capture and return one or two values from `f`.
- Release the captured closure for GC after first success.
- Re-panic on every subsequent call if the first panicked (different policy from raw `Once`).

They are not a replacement; `Once.Do` remains the right tool for "run an action once" without a return value. The helpers are for "compute a value once."

### Q21. How would you implement a "Once with timeout"?

You cannot, cleanly, with `sync.Once` itself — it has no cancellation hook. The closest you can get is to make `f` cancellable internally:

```go
var (
    once sync.Once
    val  *Thing
    err  error
)

func Get(ctx context.Context) (*Thing, error) {
    ch := make(chan struct{})
    go func() {
        once.Do(func() { val, err = buildCtx(ctx) })
        close(ch)
    }()
    select {
    case <-ch:
        return val, err
    case <-ctx.Done():
        return nil, ctx.Err()
    }
}
```

The caller may give up waiting, but the `Once` continues to run `f` in the background until completion. This works but is awkward; if you need real timeout, use `singleflight` or `atomic.Pointer`.

### Q22. Describe the race detector's view of `Once`.

The race detector treats the atomic load/store of `done` and the mutex Lock/Unlock as synchronisation events. The store inside the slow path is happens-before any later load that returns 1. This means writes inside `f` are happens-before any subsequent `Do` return — confirmed by the detector.

If you read a value written inside `f` *without going through `Do`* on the read side, the race detector flags it: there is no synchronisation edge from the write to that read. The fix is to always read through a function that calls `Do` (it is a fast no-op after the first call but provides the synchronisation).

### Q23. What's the cost of `Once.Do` on the fast path?

On amd64, a single atomic load of `done` plus a branch. Roughly 0.7 nanoseconds. Calling `Do` on the request path of an HTTP handler is essentially free. The slow path runs at most once per `Once`, so its cost is amortised over the entire program lifetime.

### Q24. How does `Once` interact with package `init`?

They are alternatives, not partners. `init` runs at package load time, single-threaded, before `main`. It is eager. `Once` runs at first call, on whatever goroutine arrives first, lazily.

A common pattern: use `init` to register types (cheap, must happen) and `Once` to load configuration (expensive, only needed if the package is used). Mixing them within a single initialisation is unusual; pick one based on whether you want eager or lazy.

### Q25. Why can't you have `sync.Once[T]` as a generic Once that holds its own value?

In principle, you could: `type OnceVal[T any] struct { once Once; val T }`. The stdlib chose not to add this as a generic struct because Go 1.21's `OnceValue` covers the use case as a function wrapper, which composes better. A generic `Once[T]` struct would also force callers to remember the type parameter at every reference. The function form `var x = sync.OnceValue(f)` infers the type from `f` and looks like a regular function value to callers.

---

## Staff level

### Q26. Design a generic lazy cache that builds entries on first access and supports concurrent reads with a single in-flight build per key.

```go
import "golang.org/x/sync/singleflight"

type LazyCache[K comparable, V any] struct {
    mu    sync.RWMutex
    data  map[K]V
    group singleflight.Group
    build func(K) (V, error)
}

func New[K comparable, V any](f func(K) (V, error)) *LazyCache[K, V] {
    return &LazyCache[K, V]{
        data:  make(map[K]V),
        build: f,
    }
}

func (c *LazyCache[K, V]) Get(k K) (V, error) {
    c.mu.RLock()
    if v, ok := c.data[k]; ok {
        c.mu.RUnlock()
        return v, nil
    }
    c.mu.RUnlock()

    keyStr := fmt.Sprintf("%v", k)
    v, err, _ := c.group.Do(keyStr, func() (any, error) {
        v, err := c.build(k)
        if err != nil {
            return v, err
        }
        c.mu.Lock()
        c.data[k] = v
        c.mu.Unlock()
        return v, nil
    })
    if err != nil {
        var zero V
        return zero, err
    }
    return v.(V), nil
}
```

Why not `sync.Once` per key? Because `Once` cannot be keyed dynamically. A map of `Once`s requires its own mutex for safe access, defeating the win. `singleflight` provides exactly the "Once per key" semantics with proper concurrency.

### Q27. Discuss the failure modes of `sync.Once` in long-running services.

1. **Permanent failure on bad input**. If `f` is `func() { conn = mustDial(badURL) }`, the first call panics, `Once` is done forever, every subsequent call sees `conn == nil` and the service is dead. Mitigate by validating inputs before `Do` or by capturing errors and exposing them.

2. **Pinning memory**. Raw `Once` does not release the closure. A `Once` that captures a 100 MB struct holds that struct until program exit. Migrate to `OnceValue` (Go 1.21+) which releases.

3. **No reload**. Cannot pick up new config without process restart. If hot reload matters, use `atomic.Pointer`.

4. **Test contamination**. Package-level `Once` persists across tests in the same binary. Subtests after the one that triggered init see a fully-initialised state. Use struct-scoped `Once` and fresh instances per test.

5. **First-touch stampede**. On cold start, 1000 worker goroutines hit a cold `Once` and 999 block on the mutex. Pre-warm in `main` before fanning out.

### Q28. When would you reach for raw `Once.Do` instead of `OnceValue` even in Go 1.21+?

When the initialiser has only side effects and no return value, raw `Once.Do` is more direct:

```go
var registerOnce sync.Once

func register() {
    registerOnce.Do(func() {
        prometheus.MustRegister(myCollector)
    })
}
```

Wrapping this in `OnceFunc` works but adds indirection (`var register = sync.OnceFunc(func() { ... })`). Stylistic preference. Both are correct. Most teams pick one and stick with it for consistency.

### Q29. A team wants `Once` semantics across multiple processes (a "global" run-exactly-once). How would you design that?

`sync.Once` is in-process. For cross-process exactly-once you need a distributed primitive:

- **A database row with a unique constraint.** `INSERT INTO once_flags(id, completed) VALUES (?, true)` — the first process succeeds, others get a constraint violation and skip the work.
- **A distributed lock with checkpointing.** Acquire a lock in Redis/etcd, check a flag, do the work, set the flag, release. The flag must be persistent (the lock alone is not enough — losing the lock holder mid-work would let another process re-do the work).
- **A leader-elected service.** One designated process does the init; others wait for it to publish completion.

The trade-offs are around failure modes: what if the worker dies mid-init? You either retry (so it is not really "exactly once") or accept manual recovery. True distributed exactly-once is harder than `sync.Once`; the local primitive does not generalise.

### Q30. How do you handle the case where `Once`-protected init must update over time as inputs change?

`Once` is the wrong tool. Pick from:

- **`atomic.Pointer[T]`**: stores the current value; replace with `Store(new)` whenever inputs change. Readers `Load()` lock-free.
- **A versioned cache**: store `(value, version)` pairs; invalidate by bumping version.
- **`golang.org/x/sync/singleflight`**: deduplicates concurrent rebuilds; cache the result separately with a TTL.
- **A goroutine that reads input events and updates an `atomic.Pointer`**: the "actor" pattern for hot-reloadable state.

If you find yourself asking "how do I reset a `Once`?", you are asking the wrong question. Step back and choose a different abstraction.

### Q31. Walk through what happens when 100 goroutines call `once.Do(f)` simultaneously, where `f` takes 100ms.

1. All 100 hit the fast path: `done.Load() == 0`. All branch to `doSlow`.
2. All 100 attempt `m.Lock()`. One wins via CAS; 99 enter the mutex slow path.
3. The 99 go to `runtime_SemacquireMutex` and park on a wait queue (no CPU spin after brief retry).
4. The winner runs `f` for 100ms. During this time, the parked goroutines wait at zero CPU cost.
5. The winner completes. The deferred `done.Store(1)` runs. The deferred `m.Unlock()` runs.
6. Unlock wakes one waiter via the runtime semaphore. That waiter acquires the mutex, sees `done == 1`, releases, returns.
7. Step 6 repeats for the remaining 98 waiters in mutex queue order. Each takes microseconds.

Total wall-clock: 100ms + ~100µs of handoff overhead. The CPU is utilised only by the winner during the 100ms; the other 99 goroutines are parked. This is exactly the behaviour you want: bounded, brief, fully synchronised.

### Q32. A senior engineer claims they "always" use `init()` instead of `Once` because "lazy init causes latency spikes on first request." How would you respond?

Both views have merit. `init()` moves the cost to startup, which is good for latency-sensitive request paths but bad for cold-start time. `Once` defers the cost to first use, which is good for cold start but spikes the first request that touches the code path.

In practice:

- For binaries that handle many requests over a long lifetime, `Once` is fine: the first-request latency is amortised.
- For serverless functions where every invocation is "cold," `init()` plus warm-up is better.
- For mixed code paths (some always run, some rarely), use `init` for the always-run and `Once` for the rarely-run.

The dogmatic "always one or the other" answer misses the trade-off. Probe the candidate: do they understand cold-start vs first-request latency? Have they measured?

### Q33. What design would you propose if `sync.Once` had a built-in `Reset` method?

I would propose not adding it. `Reset` invites a class of bugs: "what does it mean to reset while another goroutine is in `Do`?" The semantics are unclear: do in-flight calls get cancelled? Does the `done` flag flip back to 0 mid-execution? Either choice creates subtle correctness issues.

The clean alternative is `atomic.Pointer[T]`: the "value" lives outside the `Once`-like machinery. To "reset," store nil; to publish, store the new pointer. Readers `Load()` lock-free. No `Once` needed.

If the team really wants `Reset`, the right design is a separate type — `sync.ResettableOnce` — with explicit documentation about concurrency rules. Bolting `Reset` onto the existing `Once` would break the simplicity that makes it useful.

### Q34. How do you debug a "my Once is firing twice" complaint?

Most likely causes, in order:

1. **Copied struct.** Look for `func F(s S)` where `S` contains a `sync.Once`. Should be `func F(s *S)`. Run `go vet` — it warns.
2. **Local `Once`.** `var once sync.Once` inside a function instead of package level. Fresh every call.
3. **Multiple `Once` instances unintentionally.** A struct allocated per request that contains a `Once` — each instance has its own.
4. **Race condition on the *value*, not the `Once`.** `Once.Do` ran once; another goroutine separately wrote the variable.
5. **`Once.Do` called recursively, hitting deadlock detector that "recovered" partially.**

Strategy: add `log.Println("running f")` inside `f` and count occurrences. Add `fmt.Printf("%p\n", &once)` to confirm the same `Once` address is being used. Run with `-race`. The bug is almost always one of #1 or #2.

---

## Summary

`sync.Once` is small enough that interview questions can cover the full surface in one session. The fast distinction between a junior and a senior answer is whether the candidate volunteers the happens-before guarantee, the panic semantics, and the comparison to `atomic.Pointer` and `singleflight`. Staff-level answers connect these primitives to real production constraints — cold start, hot reload, distributed exactly-once, test isolation.

The single most diagnostic question is Q12 — "why can't `Once` retry?" — because the answer reveals whether the candidate has *used* `Once` in anger or only read about it.
