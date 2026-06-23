# singleflight — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Workload Analysis Before Reaching for Singleflight](#workload-analysis-before-reaching-for-singleflight)
3. [`singleflight` vs `sync.Map.LoadOrStore`](#singleflight-vs-syncmaploadorstore)
4. [`singleflight` vs Memoized Future](#singleflight-vs-memoized-future)
5. [`singleflight` vs Mutex-Per-Key](#singleflight-vs-mutex-per-key)
6. [Cancellation Strategy in Production](#cancellation-strategy-in-production)
7. [Real-World Usage: groupcache](#real-world-usage-groupcache)
8. [Real-World Usage: Kubernetes Informers and Clients](#real-world-usage-kubernetes-informers-and-clients)
9. [Real-World Usage: Docker Engine](#real-world-usage-docker-engine)
10. [Designing a Cache Tier Around Singleflight](#designing-a-cache-tier-around-singleflight)
11. [Anti-Patterns Senior Engineers Catch in Review](#anti-patterns-senior-engineers-catch-in-review)
12. [When NOT to Use Singleflight](#when-not-to-use-singleflight)
13. [Self-Assessment](#self-assessment)
14. [Summary](#summary)

---

## Introduction

At the senior level the questions stop being "how do I call this?" and start being "is this the right primitive?" Singleflight has a narrow sweet spot: in-flight deduplication of expensive, idempotent loads, in front of a real cache, under a workload where bursts of concurrent misses are realistic. Outside that sweet spot, every other primitive is better — `LoadOrStore`, memoized futures, mutex-per-key, plain caching with jittered TTLs.

This file covers:

- How to read a workload and decide whether singleflight is the answer.
- The difference between in-flight deduplication and result caching, mapped onto every related primitive.
- Real systems that rely on singleflight at scale: groupcache, Kubernetes, Docker.
- Anti-patterns that look fine in isolation but break in production.
- The cases where singleflight is the wrong choice.

By the end you should be able to defend the use of singleflight in a design review and, more importantly, push back when a colleague reaches for it for the wrong reason.

---

## Workload Analysis Before Reaching for Singleflight

Before you write `var g singleflight.Group`, answer these questions:

1. **Is the loader idempotent?** Two callers must be able to share one execution without observable difference. If the loader has side effects keyed to the caller (audit log, per-user rate-counter increment), singleflight is unsafe.
2. **Is the loader expensive enough?** If the loader runs in 10µs, the synchronisation overhead is comparable to the loader cost. Skip singleflight.
3. **Are concurrent misses realistic?** If your traffic is one request per second and your cache TTL is one hour, the chance of two requests hitting the gap is negligible. Skip singleflight.
4. **Can callers tolerate the *slowest* concurrent loader?** Singleflight collapses N parallel loads into 1 serial load. Every late arrival waits for the first one. If your SLO is "p99 ≤ 50ms" and your loader sometimes takes 200ms, the late arrivals are now over budget by 4x.
5. **Are loader results stable across callers?** Two callers must always want the same answer. If callers have different views of the same key (per-tenant filters, A/B variants), the key must encode the variant — otherwise callers leak data across boundaries.
6. **Is cancellation acceptable to ignore?** The loader runs to completion. Callers can walk away from the wait but cannot cancel the work. For a workload where 90% of requests cancel within 100ms, that loader keeps running for nobody's benefit.

If you cannot answer "yes" to all of these, look at alternatives before reaching for singleflight.

### Worked example 1: User profile fetch

- Idempotent? Yes — pure database read.
- Expensive? 5–20ms typical, occasionally 200ms.
- Concurrent misses? Yes — celebrities, trending pages.
- Tolerate slow loader? Mostly. Late arrivals are no slower than the first.
- Stable across callers? Yes — same row from the same table.
- Cancellation ok to ignore? Yes — the DB query is cheap to complete.

Result: **singleflight is correct.**

### Worked example 2: Audit-logging access check

- Idempotent? No — every access must be logged.
- Expensive? Moderate.
- Concurrent misses? Yes.

Result: **singleflight is wrong.** Coalescing would lose audit log entries.

### Worked example 3: Per-tenant config

- Idempotent? Yes.
- Stable across callers? Only if the key includes tenant ID.

Result: **singleflight is correct, with `key = "tenant:X:config"`.**

---

## `singleflight` vs `sync.Map.LoadOrStore`

Both prevent "duplicate work" but they prevent different parts of it.

`sync.Map.LoadOrStore(key, val)` atomically inserts `val` if and only if the key is absent. It returns the existing value if there was one. The pattern is:

```go
// Compute val first, then attempt insert.
val := compute(key) // expensive
actual, loaded := m.LoadOrStore(key, val)
if loaded {
    // Someone else inserted first; we wasted compute(key).
}
return actual
```

Note the wasted compute. `LoadOrStore` prevents *double storage*, not *double computation*. If two goroutines miss, both compute, and only one's value wins. The other's compute was discarded.

`singleflight.Do` prevents *double computation*. The second caller does not compute; it waits for the first.

Decision table:

| Cost of compute | Cost of duplicate store | Use |
|-----------------|------------------------|-----|
| Cheap (microseconds) | None | `LoadOrStore` |
| Expensive (milliseconds+) | None | `singleflight` |
| Expensive | Non-trivial (network call, write) | `singleflight` |

In practice, almost any time you have a real reason to prevent duplicate work, the work is expensive. `singleflight` is the right answer.

### Hybrid: singleflight to compute, `sync.Map` to cache

The combination is what you almost always want:

```go
var (
    cache sync.Map
    g     singleflight.Group
)

func Get(key string) (V, error) {
    if v, ok := cache.Load(key); ok {
        return v.(V), nil
    }
    v, err, _ := g.Do(key, func() (interface{}, error) {
        v, err := slowCompute(key)
        if err == nil {
            cache.Store(key, v)
        }
        return v, err
    })
    if err != nil {
        return *new(V), err
    }
    return v.(V), nil
}
```

`sync.Map` is the durable store. Singleflight prevents stampede on first load and on any cache miss.

---

## `singleflight` vs Memoized Future

A memoized future computes once and serves results indefinitely. Singleflight computes once *per in-flight window* and forgets the result as soon as no caller is waiting.

Two ways to look at the difference:

- **Memoized future:** "Compute once for the lifetime of the future."
- **Singleflight:** "Compute once per concurrent batch."

If you want lifetime-of-process memoization, use a memoized future (or `sync.Once`, or a cache with no TTL). If you want batch coalescing with a real cache layer for memory, use singleflight.

A common confusion: developers reach for singleflight when they actually want `sync.Once`. The test: do you want the result remembered forever, or only as long as someone is currently asking for it? If forever, `sync.Once` is simpler.

```go
var (
    once   sync.Once
    config *Config
    err    error
)

func GetConfig() (*Config, error) {
    once.Do(func() {
        config, err = loadConfig()
    })
    return config, err
}
```

This loads once for the process lifetime. No coalescing, no map, no concurrent loader management. If `loadConfig` panics, `sync.Once` does not retry. If you need retries, you want neither `sync.Once` nor singleflight — you want a memoized future with explicit reset.

---

## `singleflight` vs Mutex-Per-Key

A homegrown alternative: a `map[string]*sync.Mutex`. For each key, take the per-key mutex before loading. Other callers block on the same mutex.

```go
type Loader struct {
    mu    sync.Mutex
    locks map[string]*sync.Mutex
    cache map[string]*User
}

func (l *Loader) Get(id string) (*User, error) {
    l.mu.Lock()
    keyLock, ok := l.locks[id]
    if !ok {
        keyLock = &sync.Mutex{}
        l.locks[id] = keyLock
    }
    l.mu.Unlock()

    keyLock.Lock()
    defer keyLock.Unlock()

    if u, ok := l.cache[id]; ok {
        return u, nil
    }
    u, err := db.QueryUser(id)
    if err == nil {
        l.cache[id] = u
    }
    return u, err
}
```

Differences from singleflight:

- **Each caller runs the cache check and the load.** Only the *load* is serialised. Singleflight returns the result of the first call to every waiter.
- **Mutexes accumulate.** Without explicit cleanup, `locks` grows unbounded. Singleflight cleans up its internal map entries automatically.
- **No shared/dups counter.** You cannot detect "this load served N callers."

Mutex-per-key is appropriate when:

- The cache check is what matters and the load is a side effect (the loader writes back, late arrivals just need the cache to be populated).
- You want fine-grained control over mutex lifetime.

For everything else, singleflight is shorter and clearer.

---

## Cancellation Strategy in Production

The lack of cancellation in singleflight is a deliberate design choice. The semantics — "one call serves N callers" — is incompatible with "cancel the call when one caller cancels." If you cancel the loader, what happens to the other waiters?

The package's answer: nothing. The loader runs to completion regardless of any caller's state.

In production, you choose one of three strategies:

### Strategy 1: Bound the loader internally

Inside the loader, attach a timeout that is independent of the caller's context:

```go
v, err, _ := g.Do(key, func() (interface{}, error) {
    ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
    defer cancel()
    return db.QueryUser(ctx, key)
})
```

This is the most defensive choice. The loader has a budget; if it overruns, every waiter sees a timeout error. Pair with retry at the caller.

### Strategy 2: Capture and use the first caller's context

Default behaviour. The first caller's context flows in. If that caller cancels, the loader fails.

```go
v, err, _ := g.Do(key, func() (interface{}, error) {
    return db.QueryUser(ctx, key) // ctx from the enclosing function
})
```

Late arrivals are at the mercy of the first caller's lifecycle. Often surprising.

### Strategy 3: Detach the loader's context

Go 1.21 introduced `context.WithoutCancel`. The loader keeps the *values* of the caller's context (request ID, trace ID) but drops cancellation:

```go
v, err, _ := g.Do(key, func() (interface{}, error) {
    loadCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 2*time.Second)
    defer cancel()
    return db.QueryUser(loadCtx, key)
})
```

Combines the best of strategies 1 and 2: loader has its own timeout, late arrivals are not blocked by the first caller's cancellation, but trace propagation still works.

This is the right default for senior code.

---

## Real-World Usage: groupcache

`groupcache`, written by Brad Fitzpatrick, is the canonical use case for singleflight. Indeed, singleflight was extracted *from* groupcache into `x/sync` so other projects could use it.

In groupcache:

- Each peer holds a local cache (an LRU).
- On miss, the peer determines which peer owns the key (consistent hash) and asks that peer.
- If the owner has it, return it. If not, the owner loads from the slow source and caches.

Where singleflight enters: when multiple concurrent requests on the same peer miss the local cache, only *one* of them goes to the owner peer. The others wait. Same on the owner side: only one load against the slow source.

This is a two-tier coalescing — once at the requester, once at the owner — and it is what allows groupcache to serve millions of requests per second with a tiny back-end load.

The lesson: in any tiered cache, every tier benefits from singleflight at the miss boundary.

---

## Real-World Usage: Kubernetes Informers and Clients

Kubernetes' Go client library uses singleflight in several places, most visibly inside the discovery client and the dynamic client. When many controllers in the same process all start up and ask for the API server's resource list, singleflight ensures the call is made once and the result is shared.

Inside the informer machinery, when a list-watch reconnects and many event-handlers all want a re-list, singleflight collapses the burst. Without it, controller-manager restarts would hammer the API server with N-fold load.

The pattern is the same everywhere: a process-wide singleflight `Group` in front of expensive API calls, with the result populated into a real cache (the shared informer cache) for everyone else.

---

## Real-World Usage: Docker Engine

Docker's daemon uses singleflight in image pull and inspect paths. When two `docker pull image:tag` commands run simultaneously on the same daemon, singleflight ensures the registry is contacted once. The second `pull` waits and is served from the resulting image layers.

The pattern again: expensive, idempotent, concurrent miss likely. Singleflight is exactly the right primitive.

---

## Designing a Cache Tier Around Singleflight

A production cache tier typically has these layers, in order of speed:

1. **Per-request memoization.** A short-lived map for the duration of a single request handler.
2. **In-memory LRU/TTL cache.** Shared across the process.
3. **Distributed cache (Redis/Memcached).** Shared across processes.
4. **Slow source (database / external API).**

Singleflight sits between each layer and the next slower one:

```
caller
  │
  ├─ check L1 (per-request map)         hit → return
  │
  ├─ check L2 (in-process LRU)          hit → fill L1, return
  │
  ├─ g_L2.Do(key, fn)
  │     │
  │     ├─ check L3 (Redis)             hit → fill L2, fill L1, return
  │     │
  │     └─ g_L3.Do(key, fn)
  │           │
  │           └─ slow source → fill L3, fill L2, fill L1, return
  │
  └─ return value
```

Two `Group` instances, one per "miss boundary." A burst of misses at L2 produces one L3 lookup. A burst of misses at L3 produces one slow-source query. The arithmetic of coalescing across two tiers is multiplicative: a thousand concurrent L2 misses, if they all miss L3 too, produce one slow-source query.

In practice you probably only need singleflight at the slow-source boundary, but the principle scales.

---

## Anti-Patterns Senior Engineers Catch in Review

A short list of things to flag in code review:

### Anti-pattern 1: Singleflight without a cache

```go
v, _, _ := g.Do(key, loader) // each round runs the loader from scratch
```

If there is no cache, singleflight only helps under concurrent bursts. If concurrent bursts are not your problem, this code does nothing.

### Anti-pattern 2: Coalescing audit-relevant operations

```go
g.Do("audit:check:"+userID, func() (interface{}, error) {
    return policy.Check(userID, action)
})
```

If `policy.Check` records an audit event, coalescing destroys the event-per-request contract. Each user's request must produce its own audit log.

### Anti-pattern 3: Key includes irrelevant data

```go
g.Do(fmt.Sprintf("%s:%s", key, requestID), loader)
```

Including the request ID in the key defeats coalescing — every request has a unique ID. The key should depend only on what identifies the resource.

### Anti-pattern 4: Loader captures a stale handle

```go
func handler(w http.ResponseWriter, r *http.Request) {
    v, _, _ := g.Do(key, func() (interface{}, error) {
        return loadFor(r) // r is from the first caller
    })
}
```

Late arrivals' results were computed using the first caller's `*http.Request`. Authorization, tenancy, request scope — all from someone else's request. Source of cross-request data leaks.

### Anti-pattern 5: Loader writes to caller-scoped storage

```go
v, _, _ := g.Do(key, func() (interface{}, error) {
    v, err := load(key)
    requestStorage.Set(key, v) // wrong: stores in first caller's storage
    return v, err
})
```

Same as above. Loader is global; caller storage is per-request.

### Anti-pattern 6: Hot path uses `fmt.Sprintf` to build the key

```go
key := fmt.Sprintf("%s:%d:%v", a, b, c)
g.Do(key, ...)
```

In a tight loop, the formatting overhead can dominate the synchronisation overhead. Use `strconv` or a small key builder.

### Anti-pattern 7: Caching the singleflight `shared` flag

```go
cache.Set(key, struct{val interface{}; shared bool}{v, shared})
```

`shared` is a per-round metric. Storing it makes no sense beyond the round.

---

## When NOT to Use Singleflight

A non-exhaustive list:

- **The loader has side effects unique to the caller.** Audit logging, rate counting, per-user metrics.
- **The loader is cheap.** Below ~100µs, the synchronisation overhead is comparable to the loader cost.
- **Concurrent misses are extremely rare.** Singleflight does nothing for sequential traffic.
- **The loader needs caller-specific authorization.** The first caller's identity bleeds to all waiters.
- **You want lifetime memoization.** Use `sync.Once` or a cache.
- **You need cancellation.** The package does not support it.
- **You can put jittered TTLs in your cache and the stampede problem disappears.** Sometimes the simpler fix is the better one.

A useful rule: try the simpler fix first. Most stampedes are mitigated by jittered TTLs alone. Add singleflight when you can demonstrate it provides additional benefit.

---

## Self-Assessment

You should be able to:

- Argue for or against singleflight in a design review with concrete workload data.
- Spot the seven anti-patterns above in unfamiliar code.
- Explain to a junior engineer the difference between in-flight deduplication and result caching.
- Decide between `singleflight`, `sync.Once`, `LoadOrStore`, mutex-per-key, and memoized future based on workload.
- Design a tiered cache where singleflight sits at each miss boundary.
- Specify a cancellation strategy: bounded loader, captured context, detached context.

---

## Summary

Singleflight is a precision tool. Its sweet spot — expensive, idempotent, concurrent-miss-prone loads in front of a real cache — is narrow but extremely common in service code. Outside that sweet spot, every alternative is better. The senior skill is reading the workload, understanding the trade-offs, and choosing the right primitive, not reflexively reaching for the most fashionable one.

The real systems that depend on singleflight — groupcache, Kubernetes, Docker — share a common pattern: tiered storage with singleflight at every miss boundary, modest result sizes, idempotent loaders, and stringent observability around the coalescing ratio. Follow that recipe and singleflight will quietly save you a lot of money on database licences.

---
