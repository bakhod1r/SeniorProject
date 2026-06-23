# singleflight — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [Source Walkthrough: `Group.m` and the `call` Struct](#source-walkthrough-groupm-and-the-call-struct)
3. [Method Implementations: Do, DoChan, Forget](#method-implementations-do-dochan-forget)
4. [Panic and Goexit Handling Inside the Package](#panic-and-goexit-handling-inside-the-package)
5. [Why a Mutex and Not a Concurrent Map](#why-a-mutex-and-not-a-concurrent-map)
6. [Cost Model: Allocations and Atomic Operations](#cost-model-allocations-and-atomic-operations)
7. [Production-Grade Wrapper Design](#production-grade-wrapper-design)
8. [Observability Beyond Counters](#observability-beyond-counters)
9. [Operational Playbook](#operational-playbook)
10. [Summary](#summary)

---

## Introduction

At the professional level you have read the source. You can describe the lifecycle of a `call` struct, you can predict the allocation profile of `Do`, and you can write your own coalescer when the standard one is insufficient. This file walks through the implementation, explains the design decisions, and gives a production-grade wrapper that you can drop into a service.

Source reference: `golang.org/x/sync/singleflight/singleflight.go`. The file has stayed under 200 lines for years; everything in this section can be traced to a specific line in that file.

---

## Source Walkthrough: `Group.m` and the `call` Struct

The package exposes two types:

```go
type Group struct {
    mu sync.Mutex       // protects m
    m  map[string]*call // in-flight calls, keyed by string
}

type Result struct {
    Val    interface{}
    Err    error
    Shared bool
}
```

The internal `call` struct is private:

```go
type call struct {
    wg sync.WaitGroup

    // these fields are written once before the WaitGroup is done
    // and are only read after the WaitGroup is done.
    val interface{}
    err error

    // forgotten indicates whether Forget was called with this call's key
    // while the call was still in flight.
    forgotten bool

    // these fields are read and written with the singleflight
    // mutex held before the WaitGroup is done, and are read but
    // not written after the WaitGroup is done.
    dups  int
    chans []chan<- Result
}
```

Field-by-field:

- **`wg sync.WaitGroup`.** The synchronisation point. The first caller does `wg.Add(1)`; waiters do `wg.Wait()`; the loader goroutine does `wg.Done()`.
- **`val interface{}` and `err error`.** Written once by the loader. After `wg.Done()` they are read by every waiter. The "before-Done write, after-Done read" pattern relies on the happens-before edge `wg.Done` → `wg.Wait`.
- **`forgotten bool`.** Set true if `Forget(key)` is called while this call is in flight. The loader checks this on completion: if forgotten, the entry was already removed; do not double-remove.
- **`dups int`.** A counter of how many waiters joined this call after the first. Used to compute `shared`. Late arrivals do `c.dups++` under the group mutex.
- **`chans []chan<- Result`.** Channels registered by `DoChan` callers. The loader fans out the `Result` to each of these channels after the call completes.

The lazy-init pattern is everywhere: `Group.m` is nil until the first call, and `chans` is nil until the first `DoChan` for that key.

---

## Method Implementations: Do, DoChan, Forget

### `Do`

Simplified pseudocode:

```go
func (g *Group) Do(key string, fn func() (interface{}, error)) (interface{}, error, bool) {
    g.mu.Lock()
    if g.m == nil {
        g.m = make(map[string]*call)
    }
    if c, ok := g.m[key]; ok {
        c.dups++
        g.mu.Unlock()
        c.wg.Wait()
        return c.val, c.err, true
    }
    c := new(call)
    c.wg.Add(1)
    g.m[key] = c
    g.mu.Unlock()

    g.doCall(c, key, fn)
    return c.val, c.err, c.dups > 0
}
```

Three phases:

1. **Fast path: there is an in-flight call.** Bump `dups`, drop the mutex, block on `wg.Wait`, return the shared result with `shared=true`.
2. **Slow path: be the executor.** Insert the `call` record, drop the mutex, invoke `doCall` (which runs the loader, then handles cleanup).
3. **Compute `shared`.** Equal to `c.dups > 0` — i.e., true if any late arrival joined this round.

The key observation: the group mutex is held only during the lookup and the insert. It is *released* before `fn` runs. The mutex is therefore not contended for the duration of the loader.

### `DoChan`

```go
func (g *Group) DoChan(key string, fn func() (interface{}, error)) <-chan Result {
    ch := make(chan Result, 1)
    g.mu.Lock()
    if g.m == nil {
        g.m = make(map[string]*call)
    }
    if c, ok := g.m[key]; ok {
        c.dups++
        c.chans = append(c.chans, ch)
        g.mu.Unlock()
        return ch
    }
    c := &call{chans: []chan<- Result{ch}}
    c.wg.Add(1)
    g.m[key] = c
    g.mu.Unlock()

    go g.doCall(c, key, fn)
    return ch
}
```

Differences from `Do`:

- The caller does not block. It receives a channel and reads from it later.
- The loader runs in *its own* goroutine (`go g.doCall(...)`). With `Do`, the loader runs on the first caller's goroutine.
- Late arrivals register their channel in `c.chans`. The loader fan-outs the result.

The buffered slot of size 1 ensures the loader can send without blocking, even if the caller never reads.

### `Forget`

```go
func (g *Group) Forget(key string) {
    g.mu.Lock()
    if c, ok := g.m[key]; ok {
        c.forgotten = true
    }
    delete(g.m, key)
    g.mu.Unlock()
}
```

Mark the call as forgotten and remove it from the map. The loader's cleanup code consults `forgotten` so it does not try to delete the entry again.

### `doCall`

The cleanup logic. Roughly:

```go
func (g *Group) doCall(c *call, key string, fn func() (interface{}, error)) {
    normalReturn := false
    recovered := false
    defer func() {
        // ... panic/Goexit handling ...
        g.mu.Lock()
        defer g.mu.Unlock()
        c.wg.Done()
        if !c.forgotten {
            delete(g.m, key)
        }
        for _, ch := range c.chans {
            ch <- Result{c.val, c.err, c.dups > 0}
        }
    }()

    func() {
        defer func() {
            if !normalReturn {
                if r := recover(); r != nil {
                    c.err = newPanicError(r)
                }
            }
        }()
        c.val, c.err = fn()
        normalReturn = true
    }()

    if !normalReturn {
        recovered = true
    }
}
```

A nested-defer structure. The inner defer captures panics from `fn`. The outer defer does the synchronisation work: signal the WaitGroup, delete from the map (unless forgotten), and fan out to all registered channels.

---

## Panic and Goexit Handling Inside the Package

There are three abnormal exits from a loader:

1. **Normal panic.** The inner defer's `recover` catches it. `c.err` is set to a `*panicError` (an internal type that wraps the panic value and stack). The package re-panics from the outer defer so the caller sees the original panic — but every waiter also sees it.

2. **`runtime.Goexit`.** A goroutine that calls `runtime.Goexit` exits all its `defer`s and dies. The package detects this by checking whether `normalReturn` was set; if not, and there is no panic to recover, the loader ran `Goexit`. The package responds with a special error so waiters do not block forever.

3. **The loader returns an error normally.** Standard path. `c.err` is set; waiters receive it.

The handling is deliberate: a `Goexit` in one goroutine would otherwise hang all the others on `wg.Wait()` forever. The package converts that scenario into a visible error.

A `panicError` from singleflight is typically wrapped or re-panicked at the call site. If you `recover` in your code, check whether the recovered value is a `*singleflight.panicError`-like type and extract the original.

---

## Why a Mutex and Not a Concurrent Map

The internal map could be a `sync.Map`. Why isn't it?

The operations are read-then-write (check for an entry, insert if absent). `sync.Map` provides `LoadOrStore`, which does this atomically — but you would also need to mutate `dups` and `chans` on the existing entry, which `sync.Map` cannot do atomically with the load.

A single mutex is simpler and, in benchmarks, faster for the typical workload. The mutex is held only for the map operation, not for the loader, so the critical section is microseconds at most.

If you genuinely have a workload where the internal mutex is the bottleneck — visible in profiles, not theorised — the answer is sharding the `Group` itself, not changing the internal data structure.

---

## Cost Model: Allocations and Atomic Operations

Per `Do` call in the no-coalesce case:

- 1 mutex acquire/release pair.
- 1 map lookup that misses.
- 1 map insert.
- 1 `*call` allocation (~64 bytes).
- The loader runs.
- 1 mutex acquire/release pair for cleanup.
- 1 map delete.

In the coalesce case:

- 1 mutex acquire/release.
- 1 map lookup that hits.
- 1 `wg.Wait`.
- After `wg.Done`, immediate return.

Channel-mode (`DoChan`) adds:

- 1 channel allocation per caller (about 96 bytes).
- 1 send per channel from the loader.

A reasonable rule: in profiles, expect singleflight to contribute well under 1µs per call in the no-coalesce case. If you see more, the loader is probably allocating in surprising places (the closure captures, string formatting for the key).

The dominant cost is *always* the loader. Worrying about singleflight overhead is almost always premature.

---

## Production-Grade Wrapper Design

A wrapper good enough to drop into a service:

```go
package loader

import (
    "context"
    "errors"
    "sync"
    "time"

    "golang.org/x/sync/singleflight"
)

type Stats struct {
    Total      uint64
    Coalesced  uint64
    Errors     uint64
    DurationNs uint64
}

type Loader[K comparable, V any] struct {
    g     singleflight.Group
    cache cache[K, V]
    load  func(context.Context, K) (V, error)
    stats Stats
    mu    sync.Mutex // protects stats
    now   func() time.Time
}

type cache[K comparable, V any] interface {
    Get(K) (V, bool)
    Set(K, V, time.Duration)
}

func New[K comparable, V any](
    cache cache[K, V],
    load func(context.Context, K) (V, error),
) *Loader[K, V] {
    return &Loader[K, V]{
        cache: cache,
        load:  load,
        now:   time.Now,
    }
}

func (l *Loader[K, V]) Get(ctx context.Context, key K, ttl time.Duration) (V, error) {
    if v, ok := l.cache.Get(key); ok {
        return v, nil
    }
    keyStr := stringify(key)
    start := l.now()
    ch := l.g.DoChan(keyStr, func() (interface{}, error) {
        // Re-check inside the loader.
        if v, ok := l.cache.Get(key); ok {
            return v, nil
        }
        loadCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
        defer cancel()
        defer func() {
            if r := recover(); r != nil {
                // Convert to error so waiters do not panic.
                panic(r) // re-raise after recording; or wrap as error
            }
        }()
        v, err := l.load(loadCtx, key)
        if err == nil {
            l.cache.Set(key, v, ttl)
        }
        return v, err
    })

    select {
    case res := <-ch:
        elapsed := l.now().Sub(start)
        l.recordStats(res, elapsed)
        if res.Err != nil {
            var zero V
            return zero, res.Err
        }
        return res.Val.(V), nil
    case <-ctx.Done():
        var zero V
        return zero, ctx.Err()
    }
}

func (l *Loader[K, V]) recordStats(res singleflight.Result, elapsed time.Duration) {
    l.mu.Lock()
    defer l.mu.Unlock()
    l.stats.Total++
    if res.Shared {
        l.stats.Coalesced++
    }
    if res.Err != nil {
        l.stats.Errors++
    }
    l.stats.DurationNs += uint64(elapsed.Nanoseconds())
}

func (l *Loader[K, V]) Stats() Stats {
    l.mu.Lock()
    defer l.mu.Unlock()
    return l.stats
}

func (l *Loader[K, V]) Invalidate(key K) {
    keyStr := stringify(key)
    l.g.Forget(keyStr)
    // Plus cache deletion if your cache interface supports it.
}

func stringify[K comparable](k K) string {
    return fmt.Sprintf("%v", k)
}
```

Properties:

- **Type-safe.** Callers see `V`, never `interface{}`.
- **Context-aware.** Caller's context controls the wait; loader has its own timeout.
- **Detached loader.** `WithoutCancel` keeps trace values but drops cancellation.
- **Cache-integrated.** Re-checks inside the loader to handle races.
- **Observable.** Stats counter for total / coalesced / errors / aggregate duration.
- **Invalidation hook.** Forces the next caller to start fresh.

For very hot paths, replace the `fmt.Sprintf` key conversion with a typed key encoder that avoids reflection.

---

## Observability Beyond Counters

Counters get you 80% of the story. The other 20%:

- **Histograms of loader duration.** P50, P95, P99. Singleflight collapses N calls into 1, so the *waiter* latency is bounded above by the loader. If P99 loader duration is 200ms, P99 waiter latency is ≥ 200ms during a coalesced round.

- **Distribution of `dups` per call.** A histogram with bucket boundaries at 0, 1, 4, 16, 64, 256. Lets you see how much actual coalescing is happening. A loader that always has `dups=0` is doing nothing for you.

- **Loader inflight count.** A gauge. Incremented when the loader starts; decremented when it returns. Spikes during stampedes; in steady state should be very low.

- **Loader error rate by key class.** Bucketed by a coarse key class to avoid cardinality explosion. The whole point of bucketing is keys are user-controlled in some cases; never use raw keys as label values.

- **Forget rate.** If `Forget` is called frequently, ask why. Usually a code smell.

- **Traces.** Annotate the loader span with `singleflight.shared=true|false` and `singleflight.dups=N`. Lets a single trace explain why this request was fast (joined an in-flight load) or slow (was the executor for a long load).

---

## Operational Playbook

Three production scenarios and how to respond.

### Scenario 1: Coalescing ratio is unexpectedly low

Symptom: `coalesced/total` is below 1% even during known traffic bursts.

Diagnosis:

- Are keys including caller-specific bits? (request IDs, timestamps, hashes of random data)
- Is the loader returning so fast that no concurrent caller joins?
- Is the cache TTL so short that callers are not actually concurrent?

Action: inspect a sample of keys, measure loader duration, audit TTLs.

### Scenario 2: Loader duration P99 spiked

Symptom: P99 loader latency tripled overnight.

Diagnosis:

- Underlying source (DB / external API) is degraded.
- Bug in the loader (new code path, accidental loop).
- Increased load on the slow source from outside this service.

Action: alert the source's owner. Disable singleflight if waiters are queuing dangerously deep — better to fail fast than to pile up. The flag should be a runtime switch.

### Scenario 3: Goroutine count spikes

Symptom: process goroutines climb steadily; profile shows many in `wg.Wait` for singleflight.

Diagnosis: a loader hangs forever. Likely no timeout inside the loader; a stuck upstream is holding everyone.

Action: add a loader-internal timeout immediately. Roll forward. Audit other loaders.

---

## Summary

The professional view of singleflight is small: 200 lines of source, three public methods, one internal `call` struct, one mutex. The complexity is in the design choices — why a mutex over a concurrent map, why panic-then-rethrow, why the loader runs without a context. Each choice is defensible and trades safety for predictability.

A production-grade wrapper layers caching, context detachment, type safety, and observability on top. The wrapper is two hundred lines too — and you write it once, then reuse it.

The lesson is the meta-lesson of small packages: read the source. The 200 lines of `singleflight.go` are worth more than 2,000 lines of documentation. They are short enough to memorise the shape and recall when, in five years, a bug brings you back.

---
