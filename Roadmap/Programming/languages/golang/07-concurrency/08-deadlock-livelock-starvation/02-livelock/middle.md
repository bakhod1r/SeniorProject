# Livelock — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [Anatomy of a Livelock](#anatomy-of-a-livelock)
3. [CAS-Loop Livelock in Detail](#cas-loop-livelock-in-detail)
4. [Back-Off Strategies](#back-off-strategies)
5. [The Standard Cure: Jitter](#the-standard-cure-jitter)
6. [The cenkalti/backoff Library](#the-cenkaltibackoff-library)
7. [Diagnosing Livelock in a Running Service](#diagnosing-livelock-in-a-running-service)
8. [Livelock vs Contention](#livelock-vs-contention)
9. [Sharding to Reduce Contention](#sharding-to-reduce-contention)
10. [Singleflight and Coalescing](#singleflight-and-coalescing)
11. [Patterns That Reliably Avoid Livelock](#patterns-that-reliably-avoid-livelock)
12. [Summary](#summary)

---

## Introduction

At the junior level you learned the shape and the basic cure. At the middle level you learn to:

- See livelock as a *contention pattern*, not a single bug.
- Reason about CAS-loop performance under varying numbers of goroutines.
- Use exponential back-off with jitter correctly, including the difference between full jitter, equal jitter, and decorrelated jitter.
- Use `github.com/cenkalti/backoff` end-to-end with context cancellation.
- Diagnose livelock from `pprof` CPU profiles and runtime metrics.
- Build sharded data structures that resist contention by design.
- Combine `singleflight` and back-off in a single cache-fill pipeline.

The middle-level skill is *reaching for the right cure on the first try*, not flailing through symptoms.

---

## Anatomy of a Livelock

Every livelock has four ingredients:

1. **Two or more actors.** Goroutines, processes, services.
2. **A shared resource.** A mutex, an atomic, a row, a leadership lease.
3. **A reaction loop.** Each actor reacts to the others' state and retries.
4. **Symmetry.** The actors' reactions are similar enough to keep colliding.

Remove any one of these and the livelock disappears:

- Reduce to one actor — no livelock, but no concurrency either.
- Eliminate the shared resource (sharding) — different actors hit different resources.
- Remove the loop (give up after N attempts) — bounded failure, not livelock.
- Break the symmetry (jitter, priority) — collisions become rare.

The third and fourth are the common production cures. Sharding helps when contention is over data; jitter helps when contention is over coordination.

```go
// All four ingredients are visible here:
// 1. multiple goroutines
// 2. one shared atomic
// 3. an unbounded retry loop
// 4. all goroutines use the same retry rhythm
for {
    old := counter.Load()                    // shared resource
    if counter.CompareAndSwap(old, old+1) {  // reaction
        return
    }                                        // symmetric: every goroutine identical
}
```

---

## CAS-Loop Livelock in Detail

The CAS loop is Go's most common livelock-prone shape. The semantics are simple: read, compute, swap, retry on failure.

```go
for {
    old := state.Load()
    new := compute(old)
    if state.CompareAndSwap(old, new) {
        return
    }
}
```

Under low contention this is fast — the loop almost always exits on the first try. Under high contention the loop's success probability collapses.

### The contention model

With `N` goroutines all CAS-ing on the same location, the probability that any one given attempt succeeds during a given round is approximately `1/N`. Over a round of N attempts, exactly one succeeds and `N-1` fail. The wasted work is proportional to `N-1`.

Throughput per goroutine, roughly:
```
useful_ops_per_second_per_goroutine = (1 / N) * (1 / time_per_CAS)
```

Doubling `N` halves the per-goroutine throughput. Aggregate throughput is roughly constant: the same number of successful CAS operations per second regardless of `N`, since they serialise through the cache line.

This is not always livelock in the strict "no progress" sense — *some* CAS succeeds per round. But it is the *spirit* of livelock: most work is wasted, and adding more goroutines makes the problem worse.

### When CAS-loop livelock crosses into true zero-progress

If `compute(old)` is expensive or has its own side effects that interfere with other goroutines (for example, allocates from a contended pool), the round time grows. If the round time grows faster than the throughput, success per second falls toward zero. Now you have observed livelock.

### Demonstration

```go
package main

import (
    "fmt"
    "sync"
    "sync/atomic"
    "time"
)

func main() {
    var counter atomic.Int64
    var success atomic.Int64

    const goroutines = 1000
    var wg sync.WaitGroup
    stop := make(chan struct{})

    for i := 0; i < goroutines; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for {
                select {
                case <-stop:
                    return
                default:
                }
                old := counter.Load()
                if counter.CompareAndSwap(old, old+1) {
                    success.Add(1)
                }
            }
        }()
    }

    time.Sleep(time.Second)
    s := success.Load()
    close(stop)
    wg.Wait()
    fmt.Printf("successes in 1s with %d goroutines: %d\n", goroutines, s)
}
```

Run with `goroutines = 1`, then `10`, `100`, `1000`, `10000`. Plot the result. The line is roughly flat — adding goroutines does not increase throughput, only CPU usage.

### Cure 1: Use the dedicated atomic operation

```go
counter.Add(1) // one atomic instruction on most hardware
```

`atomic.Int64.Add` is implemented as a single `LOCK XADD` on x86 — one round trip to the cache line, no CAS retries. It is the cure for the *specific* case where the new value is a function only of the old value.

### Cure 2: Sharding the counter

If you have many goroutines incrementing one counter, give each shard its own counter and sum them on read.

```go
type ShardedCounter struct {
    shards [64]struct {
        v atomic.Int64
        _ [56]byte // pad to a cache line (64 bytes) to avoid false sharing
    }
}

func (c *ShardedCounter) Inc() {
    shard := goroutineHash() % 64
    c.shards[shard].v.Add(1)
}

func (c *ShardedCounter) Sum() int64 {
    var s int64
    for i := range c.shards {
        s += c.shards[i].v.Load()
    }
    return s
}
```

`Inc` becomes O(1) per goroutine with no contention; `Sum` becomes O(shards) but is cheap relative to the work being counted. This pattern lives in `expvar.Int`, `runtime.MemStats`, and many production counters.

### Cure 3: Mutex with parking

Counter-intuitively, switching from a CAS loop to a `sync.Mutex` can *increase* throughput under heavy contention. The mutex parks the loser; the loser's CPU is freed. Only the winner runs. With 1000 goroutines and `sync.Mutex`, you may see throughput double or triple compared to a CAS loop.

---

## Back-Off Strategies

When a retry will not succeed immediately, you wait before retrying. *How* you wait determines whether you escape livelock or amplify it.

### Constant back-off

```go
time.Sleep(10 * time.Millisecond)
```

Pros: simple. Cons: if many goroutines wait the same time, they collide on the same future tick.

### Linear back-off

```go
time.Sleep(time.Duration(attempt) * 10 * time.Millisecond)
```

Pros: spreads attempts over time. Cons: still symmetric — N goroutines on attempt 2 all wait 20 ms and collide together.

### Exponential back-off

```go
time.Sleep(time.Duration(1<<attempt) * time.Millisecond)
```

Pros: spreads attempts further over time. Cons: *still* symmetric. The classic mistake is "I have exponential back-off, I am safe from livelock." You are not. Without jitter, N goroutines still re-collide.

### Exponential with full jitter

```go
base := time.Duration(1<<attempt) * time.Millisecond
sleep := time.Duration(rand.Int63n(int64(base)))
time.Sleep(sleep)
```

The sleep is uniformly random in `[0, base)`. The expected sleep is `base/2`, but the actual sleep for each goroutine is independent. The probability of two goroutines waiting the same time is zero (with sub-nanosecond resolution).

### Exponential with equal jitter

```go
base := time.Duration(1<<attempt) * time.Millisecond
sleep := base/2 + time.Duration(rand.Int63n(int64(base/2)))
time.Sleep(sleep)
```

Half the back-off is deterministic (the minimum wait), half is random. Used when you want a *minimum* wait but still randomise above it.

### Decorrelated jitter

The AWS-recommended pattern:

```go
// Decorrelated jitter — each new delay depends on the previous one.
var prev time.Duration = baseDelay
for attempt := 0; attempt < maxAttempts; attempt++ {
    if try() { return }
    // sleep uniformly in [base, prev * 3]
    upper := prev * 3
    if upper > maxDelay {
        upper = maxDelay
    }
    next := baseDelay + time.Duration(rand.Int63n(int64(upper - baseDelay)))
    time.Sleep(next)
    prev = next
}
```

Decorrelated jitter has the smoothest convergence behaviour under retry-storm workloads. It is the gold standard for distributed retry.

### Which to choose

| Strategy | Where to use |
|---|---|
| Constant | Almost never. Demo code only. |
| Linear | Light contention, predictable workload. |
| Exponential, no jitter | Almost never. |
| Exponential + full jitter | Standard retry. The 80% answer. |
| Exponential + equal jitter | When you want a minimum wait. |
| Decorrelated jitter | Distributed systems with retry storms. |

---

## The Standard Cure: Jitter

Why does jitter cure livelock? Because livelock is *synchronisation on a wait*. Two goroutines that fail at time `t` and wait identical times retry at the same time `t + d`. Adding random noise to `d` desynchronises them. After a few rounds of jittered retries, the probability of collision drops geometrically.

The math: if two goroutines pick uniformly random sleeps in `[0, base)`, the probability they retry within ε of each other is approximately `2ε / base`. For `base = 100 ms` and `ε = 100 µs`, the probability is 0.2%. After two rounds of independent jitter, the probability is 0.0004%.

### How much jitter

A rule of thumb: jitter should be *at least 50% of the base back-off* to be effective. Smaller jitter slows the desynchronisation; larger jitter wastes time.

The most defensible default: **full jitter** — sleep uniformly random in `[0, base)`. The expected sleep is `base/2`, but the worst case is `base`. The average rate of retry is comparable to plain exponential at half the base, and the desynchronisation is excellent.

### Seeding `math/rand`

In Go 1.20+, the global `math/rand` is seeded at startup automatically. In Go 1.19 and earlier, you must seed it yourself:

```go
import "math/rand"

func init() {
    rand.Seed(time.Now().UnixNano())
}
```

Even better: use `math/rand/v2` (Go 1.22+), which is goroutine-safe by default and properly seeded.

### Per-goroutine `rand.Source`

The global `math/rand` is goroutine-safe but uses a mutex internally. Under extreme contention, *that mutex itself* can become a hot spot. The cure: each goroutine uses its own `rand.Source`:

```go
src := rand.New(rand.NewSource(time.Now().UnixNano()))
// then:
sleep := time.Duration(src.Int63n(int64(base)))
```

This is overkill for normal retry loops but matters when you are retrying millions of times per second.

---

## The cenkalti/backoff Library

`github.com/cenkalti/backoff/v4` is the de-facto standard back-off library in Go. It provides exponential back-off with jitter, context-aware cancellation, and a clean interface.

### Basic use

```go
import "github.com/cenkalti/backoff/v4"

operation := func() error {
    return doRiskyThing()
}

b := backoff.NewExponentialBackOff()
b.InitialInterval = 100 * time.Millisecond
b.MaxInterval = 5 * time.Second
b.MaxElapsedTime = 30 * time.Second
b.RandomizationFactor = 0.5 // 50% jitter

err := backoff.Retry(operation, b)
```

`backoff.Retry` calls `operation` until it returns nil or until `MaxElapsedTime` is exceeded.

### With context cancellation

```go
ctx, cancel := context.WithTimeout(parent, 10*time.Second)
defer cancel()

err := backoff.Retry(operation, backoff.WithContext(b, ctx))
```

When `ctx` is cancelled, `backoff.Retry` stops retrying immediately and returns `ctx.Err()`.

### Permanent vs transient errors

Not every error should be retried. A 401 Unauthorized will never succeed by retrying. The library lets you mark some errors as permanent:

```go
operation := func() error {
    err := doRiskyThing()
    if isPermanent(err) {
        return backoff.Permanent(err)
    }
    return err
}
```

`backoff.Permanent` short-circuits the retry — the library stops immediately and returns the wrapped error.

### Custom back-off strategies

The library has a `BackOff` interface:

```go
type BackOff interface {
    NextBackOff() time.Duration
    Reset()
}
```

You can implement decorrelated jitter or any custom strategy.

### Pitfalls of the library

- `MaxElapsedTime` defaults to 15 minutes. In a server context that is forever. Always set it explicitly.
- `RandomizationFactor` defaults to 0.5 — full jitter is achieved by setting it to 1.0 *and* manually adjusting. Read the source to confirm semantics.
- The library is not lock-free; each `Retry` call has a small fixed overhead. For ultra-high-frequency retries (microsecond scale) you may want a hand-rolled loop.

---

## Diagnosing Livelock in a Running Service

You suspect livelock. Your CPU is hot. Throughput is bad. What do you do?

### Step 1: `runtime.NumGoroutine` over time

If the count is stable (no rising leak) but CPU is hot, livelock is on the table. A rising count points to a goroutine leak; a falling-to-zero count points to deadlock.

### Step 2: `pprof` CPU profile

```go
import _ "net/http/pprof"

go func() {
    log.Println(http.ListenAndServe("localhost:6060", nil))
}()
```

```
go tool pprof http://localhost:6060/debug/pprof/profile?seconds=30
(pprof) top
(pprof) web
```

Look for:
- A function that dominates the CPU time.
- A call site that looks like a tight loop (one short function called millions of times).
- Calls into `sync/atomic.CompareAndSwap*` or `sync.(*Mutex).TryLock`.

The flame graph will show a wide bar at the bottom for the busy loop and short bars above for the body. Classic livelock signature.

### Step 3: goroutine dump

```
go tool pprof http://localhost:6060/debug/pprof/goroutine
(pprof) traces
```

Or simpler:

```
curl 'http://localhost:6060/debug/pprof/goroutine?debug=2'
```

A livelocked goroutine will show in a `runnable` or `running` state with a stack pointing at the retry loop. Many goroutines with similar stacks pointing at the same retry path is highly suggestive.

### Step 4: Trace

```
curl 'http://localhost:6060/debug/pprof/trace?seconds=5' > trace.out
go tool trace trace.out
```

The trace shows scheduler activity. In a livelock, you will see goroutines repeatedly running short bursts and immediately yielding or rescheduling. Lots of tiny stripes is the visual cue.

### Step 5: Application-level metric

The single most useful tool: a `successes_per_second` gauge. If it is near zero while CPU is hot, you are livelocked.

### Step 6: Reproduce in a benchmark

Once you suspect a pattern, reproduce it in a `Benchmark` test that scales `b.N` or runs at fixed concurrency. A 20-line benchmark can confirm or refute the hypothesis in seconds.

---

## Livelock vs Contention

These two are easily confused but distinct.

**Contention** is the cost of multiple goroutines competing for a resource. A heavily contended mutex slows everyone down, but throughput still scales with the rate at which the critical section can complete. Contention is a *performance* issue.

**Livelock** is when contention becomes pathological — the throughput is bounded *below* what the critical section's intrinsic speed would allow, because most of the cost is in retry/wait overhead.

Rule of thumb:
- If you halve the goroutines and throughput doubles, you have contention.
- If you halve the goroutines and throughput stays the same or goes up by more than 2x, you have livelock.

In practice the line blurs. Many systems sit on the contention/livelock boundary.

---

## Sharding to Reduce Contention

The most effective way to eliminate livelock from data-contention scenarios is to *not have contention*. Sharding splits the resource so most accesses go to different shards.

### Sharded counter

Shown above. Each shard has its own atomic; goroutines distribute by hash.

### Sharded map

`sync.Map` is *not* sharded internally — it has a different optimisation. For genuine sharding, use a custom structure:

```go
type ShardedMap struct {
    shards [64]struct {
        mu sync.Mutex
        m  map[string]any
    }
}

func (s *ShardedMap) shardFor(key string) *struct {
    mu sync.Mutex
    m  map[string]any
} {
    h := fnv.New32a()
    h.Write([]byte(key))
    return &s.shards[h.Sum32()%64]
}
```

64 shards means contention per shard is `1/64` of the unsharded case. The number of shards is usually chosen as a power of 2 ≥ `GOMAXPROCS * 4`.

### When sharding does not help

- **Cross-shard transactions.** If you need atomicity across two keys, sharding makes it harder.
- **Skewed access.** If 90% of accesses hit the same key, 64 shards do not help — one shard still gets all the contention.
- **Read-heavy workloads.** Reads do not contend much; sharding writes is the point.

### Cache-line considerations

Each shard's atomic counter should be on its own cache line (64 bytes on x86, 128 on ARM). Otherwise *false sharing* — two shards on the same cache line — causes cache-line ping-pong and re-creates the contention you tried to eliminate.

```go
type paddedCounter struct {
    v atomic.Int64
    _ [56]byte // pad to 64
}
```

---

## Singleflight and Coalescing

`golang.org/x/sync/singleflight` solves the specific livelock case where many goroutines all try to do the same expensive thing.

```go
import "golang.org/x/sync/singleflight"

var group singleflight.Group

func GetUser(id string) (*User, error) {
    v, err, _ := group.Do(id, func() (any, error) {
        return fetchUser(id) // only one goroutine runs this at a time per id
    })
    return v.(*User), err
}
```

If 100 goroutines all call `GetUser("alice")` at the same time, only one runs `fetchUser`. The other 99 wait for the result.

This is not just an optimisation — it is a *livelock cure* for the thundering-herd pattern where many goroutines, each retrying on cache miss, all hit the database simultaneously.

### When singleflight helps

- Cache fill on miss.
- Database connection establishment.
- Expensive computation keyed by input.
- DNS lookup.

### When it does not

- Per-request unique work.
- Operations that should not be coalesced (e.g., increment a counter — coalescing means losing increments).
- Operations with side effects that must run exactly N times.

### The `Forget` method

Singleflight caches the in-flight result. If the underlying value can change, call `group.Forget(id)` after the work so future calls do not get the stale result.

---

## Patterns That Reliably Avoid Livelock

### Pattern 1: Use the right primitive

| Need | Primitive | Why it avoids livelock |
|---|---|---|
| Counter increment | `atomic.AddInt64` | Single instruction, no retry. |
| Set if zero | `atomic.CompareAndSwapInt64(&v, 0, x)` | Bounded retry by problem definition. |
| Read-then-write | `sync.Mutex` | Parks losers, no spin. |
| Cache fill | `singleflight` | Coalesces. |
| Bulk increments | Sharded counter | No contention. |

### Pattern 2: Acquire locks in a global order

If you must hold multiple locks, define a global order (by address, by ID) and acquire them in that order. Both deadlock and back-off-and-retry livelock disappear.

### Pattern 3: Bound retries

Never write `for { try() }`. Always:

```go
for attempt := 0; attempt < maxAttempts; attempt++ {
    if try() { return nil }
    backoff(attempt)
}
return errBudgetExhausted
```

A livelock with a retry budget is at worst a slow failure, not a permanent stall.

### Pattern 4: Use context cancellation

Pair every retry loop with a context:

```go
for {
    if try() { return nil }
    select {
    case <-time.After(backoff()):
    case <-ctx.Done():
        return ctx.Err()
    }
}
```

A caller can cancel the retry from outside.

### Pattern 5: Server-side back-pressure

Servers should reject load they cannot serve. A `429 Too Many Requests` is friendlier than letting clients retry forever. Pair with `Retry-After` so clients know how long to wait.

### Pattern 6: Use sync.Map or sharded structures for hot reads

`sync.Map` performs well when keys are mostly read after initial write. For write-heavy workloads, a sharded `map[string]any` behind sharded mutexes is the standard.

---

## Summary

Livelock at the middle level is a recognisable pattern with a small set of standard cures. The most common Go shape is the CAS loop under heavy contention; the standard cure is to either eliminate the contention (sharding, dedicated atomic ops) or to break the symmetry (jitter, priority).

`github.com/cenkalti/backoff` is the standard library for retry; learn its options and pitfalls. `singleflight` is the standard library for coalescing duplicate work. Sharding is the standard tool for eliminating contention by design.

Diagnose livelock with `pprof` CPU profiles, a goroutine dump, and most importantly an application-level success-rate counter. Fix it by understanding which of the four ingredients — actors, resource, loop, symmetry — you can remove or modify.

Move on to `senior.md` for advanced livelock analysis at the algorithmic and distributed-systems scale.
