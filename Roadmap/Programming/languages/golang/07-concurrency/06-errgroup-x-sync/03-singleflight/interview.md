# singleflight — Interview Questions

## Table of Contents
1. [Junior Questions](#junior-questions)
2. [Middle Questions](#middle-questions)
3. [Senior Questions](#senior-questions)
4. [Staff / Architect Questions](#staff--architect-questions)
5. [Code-Reading Questions](#code-reading-questions)
6. [Design Questions](#design-questions)
7. [Trick Questions](#trick-questions)

---

## Junior Questions

### Q1. What is a cache stampede and how does singleflight help?

A cache stampede is the burst of identical concurrent requests that occurs when a hot cache entry expires under load. Each request misses the cache and triggers the slow underlying operation in parallel. The underlying system (usually a database) sees a spike of identical queries.

Singleflight collapses the burst: of N concurrent callers for the same key, only one executes the slow operation. The others wait and receive the same result.

### Q2. What are the three return values of `g.Do`?

`(value interface{}, err error, shared bool)`:
- `value` is the result of the loader.
- `err` is the loader's error.
- `shared` is `true` if the value was returned to more than one caller in this round.

### Q3. Is singleflight a cache?

No. Singleflight only deduplicates *in-flight* calls. As soon as the loader returns and all current waiters are served, the entry is removed. The next caller starts fresh. Pair singleflight with a real cache (TTL, LRU, `sync.Map`) for caching.

### Q4. If the loader returns an error, what do the waiters see?

Every waiter receives the same error. Errors are coalesced like values. This is intentional but it means transient errors are amplified — N concurrent callers all see the same network timeout.

### Q5. What is `Forget(key)` for?

It removes the in-flight entry for `key` from the internal map. Future callers will not coalesce with the still-running loader; they start a fresh call. Existing waiters still receive the original loader's result.

Rare in practice; the default cleanup is usually correct.

### Q6. Can two goroutines pass different loader functions for the same key?

They can, but only the first caller's loader runs. The second `fn` argument is ignored. Conventionally you pass the same loader for the same key.

### Q7. Does the package take a `context.Context`?

No. `Do` and `DoChan` do not accept context. The loader cannot be cancelled by a caller. Walking away from `DoChan` does not stop the loader.

### Q8. Where does singleflight live?

`golang.org/x/sync/singleflight`. Outside the standard library, but in the official `x/sync` repository.

---

## Middle Questions

### Q9. When should I use `DoChan` instead of `Do`?

When you need to select on the result alongside another channel — usually `ctx.Done()`. `Do` is blocking; `DoChan` lets you abandon the wait while the loader continues to run.

### Q10. What is the canonical singleflight pattern?

The "stable-key cache loader":

```go
if v, ok := cache.Get(key); ok {
    return v, nil
}
v, err, _ := g.Do(key, func() (interface{}, error) {
    v, err := load(key)
    if err == nil {
        cache.Set(key, v)
    }
    return v, err
})
```

A TTL cache for long-term storage, singleflight for in-flight dedup, an inner re-check is optional but cleaner.

### Q11. How do you handle a panic inside the loader?

Recover inside the loader and convert to an error. Otherwise the panic propagates to every waiter.

```go
g.Do(key, func() (v interface{}, err error) {
    defer func() {
        if r := recover(); r != nil {
            err = fmt.Errorf("panic: %v", r)
        }
    }()
    return doWork()
})
```

### Q12. How do you pass a context to the loader?

Capture it in the closure. Be aware: only the *first* caller's context is captured. If you want the loader to be independent of any single caller's cancellation, use `context.WithoutCancel` (Go 1.21+) and add an internal timeout.

### Q13. Why might you NOT cache an error result?

Transient errors (timeouts, 503s) should not be cached — caching them prevents recovery. Permanent errors (404, 400) can be cached with a short TTL to prevent abuse. The decision is the cache's, not singleflight's.

### Q14. Is `shared=true` the same as "I was a follower"?

No. `shared` is `true` for *every* caller in a coalesced round, including the executor. It means "the same result was given to multiple callers." It does not identify who ran the loader.

### Q15. What happens if you call `Forget(key)` after `Do(key, fn)` returns?

Nothing useful. `Do` already removed the entry as part of its cleanup. `Forget` is a no-op.

### Q16. How do you write a generic, type-safe wrapper?

Wrap `singleflight.Group` in a struct with a type parameter and translate the `interface{}` return to the typed result internally.

```go
type Group[T any] struct{ g singleflight.Group }

func (g *Group[T]) Do(key string, fn func() (T, error)) (T, error, bool) {
    v, err, shared := g.g.Do(key, func() (interface{}, error) { return fn() })
    if err != nil { var zero T; return zero, err, shared }
    return v.(T), nil, shared
}
```

---

## Senior Questions

### Q17. Compare `singleflight.Do` with `sync.Map.LoadOrStore`.

`LoadOrStore` prevents *double storage*. Two callers can still both compute; only one wins the store, and the loser's computation is wasted.

`Do` prevents *double computation*. The second caller does not compute at all; it waits and receives the first caller's result.

Use `LoadOrStore` when compute is cheap. Use `Do` when compute is expensive. Use both together for "cheap cache hits, deduplicated misses."

### Q18. Compare singleflight with a mutex-per-key approach.

Mutex-per-key serialises *the load* but each caller runs its own cache check and load. Singleflight returns the first caller's result to all waiters. Mutex-per-key requires manual cleanup; singleflight cleans up automatically. Singleflight is shorter, but does not allow fine-grained control over locks per key.

### Q19. What real-world systems use singleflight?

- `groupcache` (where the package originated) — extensive use in tiered cache loads.
- Kubernetes' Go client — discovery and dynamic client coalesce concurrent API server calls.
- Docker Engine — image pull dedup.

The common pattern: an expensive idempotent operation behind a cache, where concurrent misses are realistic.

### Q20. What is the right cancellation strategy in production?

Three sensible strategies:

1. **Bounded loader**: internal `context.WithTimeout`. Loader gives up after a budget.
2. **First-caller context**: loader uses the first caller's ctx. Surprising for late arrivals.
3. **Detached context**: `context.WithoutCancel` + internal timeout. Trace propagation works, late arrivals are not blocked by the first caller's cancellation. **Best default for senior code.**

### Q21. When is singleflight the wrong tool?

- Loader has caller-specific side effects (audit log).
- Loader is cheap (sub-100µs).
- Concurrent misses are extremely rare.
- Authorization must be per-caller.
- You want lifetime memoization (use `sync.Once`).
- You need cancellation.

### Q22. Describe the design of a tiered cache around singleflight.

L1 (per-request map) → L2 (in-process LRU) → L3 (Redis) → slow source. A singleflight `Group` between each L and the next slower one. Coalescing is multiplicative across tiers: 1,000 concurrent L2 misses produce 1 L3 query; 1,000 concurrent L3 misses produce 1 slow-source query.

### Q23. Why does the loader's first-caller context cause subtle bugs?

Late arrivals join the in-flight call. The loader uses the first caller's context. If the first caller cancels, the loader fails — and the late arrivals see "request cancelled" even though *their* contexts are still alive. Use `context.WithoutCancel` to detach.

### Q24. How do you observe singleflight in production?

- Counter: total calls.
- Counter: coalesced calls (shared==true).
- Histogram: loader duration.
- Gauge: in-flight loaders.
- Histogram of `dups` per call (custom; not exposed by the package).
- Trace span annotations on each coalesced call.

---

## Staff / Architect Questions

### Q25. Walk me through the singleflight source.

Two public types: `Group` (mutex + map) and `Result` (val/err/shared). One private type: `call` (waitgroup + result fields + dups counter + chans slice + forgotten flag). Three public methods plus a private `doCall`. `Do` inserts a call record under the mutex, releases the mutex, invokes the loader, and on completion signals the WaitGroup, fans out to registered channels, and deletes the map entry (unless `Forget` already did). `DoChan` is the channel-mode variant. `Forget` marks the call as forgotten and deletes the map entry.

The cleanup runs in a deferred function with nested defers to handle panic and `runtime.Goexit`.

### Q26. Why a mutex and not `sync.Map`?

`sync.Map` provides `LoadOrStore` but does not allow atomically mutating fields of an existing entry (the `dups` counter, the `chans` slice). A single mutex is simpler, and benchmarks favour it for the typical workload. The mutex is held only for the bookkeeping, not the loader, so the critical section is microseconds.

### Q27. How would you implement a sharded `Group` if the internal mutex were contended?

Hash the key into one of N internal `Group` values:

```go
type ShardedGroup struct{ shards [256]singleflight.Group }
func (s *ShardedGroup) Do(k string, fn loader) result {
    return s.shards[xxhash.Sum64String(k)%256].Do(k, fn)
}
```

In practice, the internal mutex is rarely the bottleneck. Profile before sharding.

### Q28. How does panic propagation work inside the package?

The loader runs inside a function with a `recover` defer. If the loader panics, the `recover` captures the value and wraps it as a `panicError`. The outer cleanup defer fans out the result (which carries the panic error) to all waiters; in the reference implementation, the panic is then re-raised so the caller's stack sees a panic.

The implication: never call a loader from production code without recovering, or you risk N-way panics.

### Q29. How would you build a hedged-load version of singleflight?

A wrapper that, after some delay (say, the median loader latency), starts a second loader concurrently and returns whichever finishes first. The trick: singleflight does not allow two concurrent calls for the same key. You would need to layer the hedge *above* singleflight: each hedge attempt has its own (key, attempt-id) pair, and the wrapper picks the first successful result. Complicated; usually not worth it.

### Q30. How would you build a singleflight that supports cancellation?

The clean answer: you can't, because the underlying contract (one loader serves N callers) is incompatible with per-caller cancellation. You can build a *bounded* loader (internal timeout) and let waiters walk away (`DoChan`+`select`), but the loader keeps running. If you need real cancellation, you need a different primitive — for example, a per-call reference counter that the loader checks and aborts if zero.

---

## Code-Reading Questions

### Q31. What does this code do?

```go
v, err, _ := g.Do(fmt.Sprintf("user:%d:%d", userID, time.Now().Unix()), loader)
```

It calls singleflight with a key that includes the current second. Coalescing only happens within the same second. Probably a mistake — the temporal component defeats the purpose unless you specifically want one-call-per-second.

### Q32. What is wrong with this?

```go
mu.Lock()
v, _, _ := g.Do(key, loader)
mu.Unlock()
```

Holding a mutex across the loader serialises the whole system on a single lock. Drop the mutex before calling `Do`. The mutex (if needed at all) should protect only the cache, not the loader.

### Q33. What is wrong here?

```go
g.Do(id, func() (interface{}, error) {
    return load(r) // r is the first caller's *http.Request
})
```

Late arrivals receive a result computed using the first caller's HTTP request. Authorization, cookies, headers — all from someone else. Source of cross-request data leakage.

### Q34. Is this safe?

```go
v, _, _ := g.Do(key, loader)
u := v.(*User)
u.LastSeen = time.Now()
```

No. Every waiter receives the same `*User` pointer. Mutating it affects every waiter's view. Clone before mutating, or have the loader return immutable values.

### Q35. What is this code doing?

```go
ch := g.DoChan(key, loader)
go func() { <-ch }()
```

Spawning a goroutine just to drain the channel. The buffered channel makes this unnecessary — the loader can send without a reader. The goroutine is a leak waiting to happen if `loader` deadlocks; remove it.

---

## Design Questions

### Q36. Design a loader for user profiles in a service that handles 10k QPS.

- TTL cache (LRU, 10k entries, 60s TTL with jitter).
- Singleflight in front of the cache miss path.
- Loader with internal 2s timeout, `WithoutCancel` from caller ctx.
- Recover panics inside loader; surface to a metric.
- Counters: total, coalesced (shared==true), errors.
- Histogram: loader duration p50/p95/p99.
- Trace span annotations on loader entry/exit.

### Q37. The cache is sometimes returning stale data after invalidation. How do you fix it?

Cache invalidation needs to call both `cache.Delete(key)` *and* `g.Forget(key)`. Without the `Forget`, a long-running in-flight loader will finish and re-populate the cache with stale data. The invalidate operation must invalidate both the cache and the in-flight call.

### Q38. Your service's loader sometimes takes 30 seconds; meanwhile, callers pile up. How do you handle it?

Two problems: a slow loader and pileup. Fixes:

- Internal loader timeout (e.g. 5s). On timeout, return an error.
- A circuit breaker: if loader p99 exceeds some threshold, short-circuit and fail fast for a while.
- Optionally: a max-waiters cap. After N waiters, new arrivals get an immediate error instead of joining. Not provided by the package; you wrap.

### Q39. How would you build a per-tenant rate limit on the loader?

Wrap the loader. Before calling `g.Do`, check a per-tenant rate limit. If exceeded, fail fast. Singleflight ensures one loader per tenant per key, but cannot limit total tenants. A separate semaphore per tenant works.

### Q40. You have a distributed cache cluster. Where should singleflight live?

Inside each process, in front of the local cache miss path. Singleflight is per-process; it cannot coordinate across processes. For cross-process coalescing, you need a distributed locking primitive (Redis SETNX, ZooKeeper, etcd) — at much higher cost. Most systems accept some duplicate work across processes and only deduplicate within a process.

---

## Trick Questions

### Q41. What happens if `fn` returns `(nil, nil)`?

Every waiter receives `(nil, nil)`. That is valid: "no value, no error." Treat it consistently across callers.

### Q42. If two callers pass loaders that return different types, what happens?

The second loader is ignored. All waiters receive the first loader's result. If the type assertion in the caller is wrong (because the caller expected its own loader's type), the assertion panics.

### Q43. Can `g.Do` be called from within a loader?

In the reference implementation, calling `g.Do(K, _)` from within the loader for `K` deadlocks — the waiter is waiting for itself. Calling `g.Do(K', _)` with a different key is safe. Treat the loader as a leaf operation.

### Q44. What does `g.Do("", fn)` do?

The empty string is a valid key. All callers that pass `""` coalesce. Watch out for accidental empty-key bugs that suddenly serialise unrelated callers.

### Q45. Is `singleflight.Group` copyable?

No. It contains a `sync.Mutex` and a map. Copying produces a `Group` with the same map header (so two `Group`s share state) and an independent mutex (so synchronisation is broken). Pass by pointer. `go vet` will catch the mutex copy.

### Q46. If the loader sleeps forever, what happens?

Every waiter blocks forever. The goroutine running the loader blocks forever. The map entry never gets cleaned up. Watch for this in tests: a deadlocked test will report the leak.

Always have a loader-internal timeout in production code.

### Q47. Is `shared` always `true` when the loader is slow?

No. `shared` is `true` only if at least one other caller joined the call. A slow loader with only one caller still has `shared=false`.

---
