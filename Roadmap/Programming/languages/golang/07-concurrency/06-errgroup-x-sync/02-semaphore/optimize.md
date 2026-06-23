# x/sync semaphore — Optimize

## Table of Contents
1. [Introduction](#introduction)
2. [Measure Before You Optimize](#measure-before-you-optimize)
3. [The Capacity Question](#the-capacity-question)
4. [Reducing Allocation in the Slow Path](#reducing-allocation-in-the-slow-path)
5. [Hot-Path Mutex Contention](#hot-path-mutex-contention)
6. [Choosing Between Channel and Semaphore](#choosing-between-channel-and-semaphore)
7. [Sharding the Semaphore](#sharding-the-semaphore)
8. [Adaptive Concurrency Limiting](#adaptive-concurrency-limiting)
9. [Holding-Time Reduction](#holding-time-reduction)
10. [Benchmarks to Run](#benchmarks-to-run)
11. [Summary](#summary)

---

## Introduction

`semaphore.Weighted` is fast on the uncontended fast path (mutex + integer arithmetic, no allocation) and acceptable on the contended slow path (allocation per parked acquire, one mutex acquire on wakeup). For most production workloads it does not appear in CPU profiles. When it does, the optimisations available are:

- Right-size capacity (most common win).
- Reduce time held under the semaphore (move work outside).
- Replace with a buffered channel when weight = 1 and `select` is desired.
- Shard the semaphore across multiple instances for high-throughput scenarios.
- Move to an adaptive limiter when capacity is fundamentally wrong.

This file walks through each lever with measurement guidance.

---

## Measure Before You Optimize

Always start with a profile. The fastest "optimisation" is removing code that does not need to run.

### Trace acquire wait time

The package exposes no metrics. Wrap `Acquire` to record wait time:

```go
type measuredSem struct {
    s     *semaphore.Weighted
    hist  metrics.Histogram // pseudo
}

func (m *measuredSem) Acquire(ctx context.Context, n int64) error {
    start := time.Now()
    err := m.s.Acquire(ctx, n)
    m.hist.Observe(time.Since(start).Seconds())
    return err
}
```

Plot `p50`, `p95`, `p99` over time. Steady-state wait should be near zero. Rising p99 is the first sign of saturation.

### Trace held time

Add a second histogram:

```go
func (m *measuredSem) AcquireAndRelease(...) {
    sem.Acquire(...)
    held := time.Now()
    work()
    holdHist.Observe(time.Since(held).Seconds())
    sem.Release(...)
}
```

`mean_arrival_rate * mean_held_time = mean_in_flight`. If `mean_in_flight` approaches capacity, you are at the edge. Either:

- Increase capacity (if the underlying resource allows).
- Reduce held time (move work out).
- Reduce arrival rate (backpressure upstream).

### Profile the contended path

If the semaphore appears in CPU profiles, the contention is in the mutex inside `Acquire`/`Release`. Look at `pprof -seconds 30 http://localhost:6060/debug/pprof/profile` and check the `runtime.semrelease`/`runtime.semacquire` paths.

If you see them prominently, the mutex is hot — see "Sharding" below.

---

## The Capacity Question

The biggest performance lever is also the simplest. Most "the semaphore is slow" complaints are actually "capacity is set wrong."

### Little's Law

```
mean_concurrent_requests = arrival_rate * mean_service_time
```

If arrival rate = 1000 RPS and mean service time = 0.05 s, mean in-flight = 50. Capacity = 50 is the minimum that does not queue.

A safe rule of thumb: set capacity to **2x** the steady-state mean, so that bursts up to 2x do not cause queue buildup.

### When to increase capacity

- p99 acquire wait > 10% of p99 service time. The semaphore is the bottleneck, not the work.
- Throughput is below target while the downstream service is not saturated.
- All workers are busy but downstream latency is still acceptable.

### When NOT to increase capacity

- Downstream service is saturated. Increasing capacity moves the bottleneck downstream, often making things worse (more queueing at the downstream).
- Memory headroom is tight. More concurrent in-flight = more memory.
- File descriptors are scarce. Each concurrent request may hold an fd.

### When to decrease capacity

- Holding time is dominated by waiting (downstream P99 latency is high). Decreasing capacity reduces in-flight, reduces downstream queue, reduces overall latency. Counter-intuitive but real.

---

## Reducing Allocation in the Slow Path

Per parked acquire, `semaphore.Weighted` allocates:

- 1 `chan struct{}` (~88 bytes on 64-bit Go).
- 1 `*list.Element` (~56 bytes).

Total: ~144 bytes + GC overhead.

For workloads with high parking rates (saturated semaphore, high arrival rate), this becomes noticeable. The allocator and GC have to keep up with thousands of short-lived allocations per second.

### Option 1: Reduce parking rate

If parking is the issue, the real fix is "do not park" — i.e., size capacity correctly so the queue stays empty. This is by far the better optimisation.

### Option 2: Switch to channel-based semaphore (weight = 1 only)

```go
type Sem struct{ c chan struct{} }
func (s *Sem) Acquire(ctx context.Context) error {
    select {
    case s.c <- struct{}{}: return nil
    case <-ctx.Done(): return ctx.Err()
    }
}
func (s *Sem) Release() { <-s.c }
```

No allocation per acquire. The channel buffer is preallocated. This wins for weight = 1 / no-FIFO-guarantee workloads.

### Option 3: Custom pool of waiter channels

Pool `chan struct{}` via `sync.Pool`:

```go
var waiterPool = sync.Pool{New: func() any { return make(chan struct{}) }}

// in Acquire:
ready := waiterPool.Get().(chan struct{})
// ... use ...
// on success or cleanup:
// drain and put back -- careful: closed channels cannot be reused
```

But: once `close(ready)` is called by `Release`, the channel cannot be reused. So pooling does not work for the wake path as-is. Would need an entirely different signalling primitive (e.g., a `sync.Cond` per waiter), which complicates the code.

For most workloads, the allocation cost is not worth optimising. Reach for sharding before this.

---

## Hot-Path Mutex Contention

Every `Acquire` and `Release` takes `s.mu`. Under very high call rate (millions per second), the mutex itself can become a bottleneck — not because it is slow, but because contention forces threads to sleep.

Signs:
- CPU profile shows significant time in `sync.(*Mutex).Lock`.
- `runtime.semacquire` appears with high cumulative time.
- Throughput plateaus while CPU is not saturated.

Three mitigations.

### Mitigation 1: Batched acquire

If your workload often acquires N at once, do it in one `Acquire(ctx, N)` instead of N calls of `Acquire(ctx, 1)`. One mutex acquire instead of N. This is the cleanest, free win when applicable.

### Mitigation 2: Sharded semaphores

Instead of one semaphore of capacity 100, use 8 semaphores of capacity 13 each (or 16 of capacity 7). Hash the caller's key to a shard:

```go
type Sharded struct {
    shards []*semaphore.Weighted
}

func (s *Sharded) Pick(key uint64) *semaphore.Weighted {
    return s.shards[key%uint64(len(s.shards))]
}
```

Pros: mutex contention divided by shard count.
Cons: no global cap enforcement, capacity wasted under skewed key distribution.

For workloads where global cap is mandatory, sharding loses appeal. For workloads where per-shard cap is fine (per-tenant, per-host), it is a strong fit.

### Mitigation 3: Replace with atomic-based limiter

For weight = 1 with no FIFO guarantee:

```go
type AtomicSem struct {
    cap, cur int64
}

func (s *AtomicSem) TryAcquire() bool {
    for {
        cur := atomic.LoadInt64(&s.cur)
        if cur >= s.cap { return false }
        if atomic.CompareAndSwapInt64(&s.cur, cur, cur+1) { return true }
    }
}

func (s *AtomicSem) Release() {
    atomic.AddInt64(&s.cur, -1)
}
```

No mutex; no waiter list (this is non-blocking only). Pair with retry loop or external queue if you need to block.

For `Acquire`-with-block, you would need to combine this with `sync.Cond` or a channel-based wake mechanism. At that point you have re-implemented `semaphore.Weighted`. The atomic-only version is for the `TryAcquire`-style usage where you fall through to another path on saturation.

---

## Choosing Between Channel and Semaphore

For weight = 1, the buffered-channel-as-semaphore is usually as fast or faster than `semaphore.Weighted`:

```
                       semaphore.Weighted  channel(cap N)
Uncontended Acquire    ~35 ns              ~20 ns (channel send)
Slow path allocation   2 allocs            0 allocs
FIFO guarantee         yes                 no (best-effort)
Context-aware          yes (built-in)      yes (with select)
select composable      no                  yes
```

For weight = 1 hot paths, the buffered channel wins on raw throughput and allocation. The semaphore wins on weighted, FIFO, and clean cancellation semantics.

The choice should be made deliberately:

- **Need weight, FIFO, or zero `select` complexity:** `semaphore.Weighted`.
- **Need raw throughput, weight = 1, willing to write a `select`:** buffered channel.

---

## Sharding the Semaphore

For high-throughput services where the semaphore is genuinely the bottleneck:

```go
type Shards struct {
    s []*semaphore.Weighted
}

func NewShards(total int64, shardCount int) *Shards {
    perShard := total / int64(shardCount)
    s := make([]*semaphore.Weighted, shardCount)
    for i := range s {
        s[i] = semaphore.NewWeighted(perShard)
    }
    return &Shards{s: s}
}

func (s *Shards) Acquire(ctx context.Context, key uint64) (release func(), err error) {
    shard := s.s[key%uint64(len(s.s))]
    if err := shard.Acquire(ctx, 1); err != nil {
        return nil, err
    }
    return func() { shard.Release(1) }, nil
}
```

### Trade-offs

- **Pro:** mutex contention divided by `len(s.s)`. With 8 shards, contention drops ~8x.
- **Con:** key distribution must be even. A skewed key (one hot user) overloads one shard while others sit idle.
- **Con:** total capacity is an *upper bound under even distribution*. Under skew, you cannot use the full total.
- **Con:** no global ordering across shards — FIFO holds within a shard only.

When the workload has a natural shard key (tenant, host, IP), sharding is excellent. When acquisitions are uniform and one global cap is mandatory, sharding loses meaning.

---

## Adaptive Concurrency Limiting

`semaphore.Weighted` has a fixed capacity. Real systems often want capacity that adapts to observed latency or error rate.

Common policies:

- **AIMD (Additive Increase, Multiplicative Decrease).** Increase capacity by 1 on each success; halve on each failure (latency spike or error). Used in TCP congestion control.
- **Vegas.** Track the difference between expected RTT and actual RTT; adjust capacity to keep queue length around a target.
- **Gradient2 (Netflix).** Compare short-window p50 to long-window p50; adjust based on the ratio.

Libraries:

- `github.com/platinummonkey/go-concurrency-limits` — a Go port of Netflix's concurrency-limits.
- `github.com/uber-go/ratelimit` — for rate limits (not concurrency), but conceptually similar.

When to switch from `semaphore.Weighted` to an adaptive limiter:

- Underlying resource P99 varies by 5x or more across the day.
- A fixed capacity is too high during slow periods (causing queueing) AND too low during fast periods (causing underutilisation).
- The team is willing to accept the operational complexity (more metrics, more tuning).

For most services, fixed capacity tuned conservatively is good enough.

---

## Holding-Time Reduction

The most overlooked optimisation: **release the slot earlier**.

A common pattern:

```go
sem.Acquire(ctx, 1)
defer sem.Release(1)
result := compute()
storeResult(result) // takes 200 ms
respondToCaller(result)
```

Question: does `storeResult` need the slot? Often not — the slot was about CPU/memory for `compute`, not for the network write. Restructure:

```go
sem.Acquire(ctx, 1)
result := compute()
sem.Release(1) // release before slow IO
storeResult(result)
respondToCaller(result)
```

Held time drops from 250 ms to 50 ms. With the same arrival rate, the semaphore sustains 5x more throughput. **This is almost always the biggest win.**

### Pattern: Acquire-Compute-Release-Persist

Use this pattern wherever a slot protects bounded CPU/memory work but the rest of the function is IO or independent.

### Anti-pattern: Acquire around the whole function

`defer sem.Release(1)` at the top of a 5-step function is convenient but wastes the slot during steps that do not need it. Audit each function for the actual scope of resource use.

---

## Benchmarks to Run

When optimising, run these consistently. Capture before/after numbers.

```go
func BenchmarkAcquireRelease(b *testing.B) {
    sem := semaphore.NewWeighted(1000) // generously sized, no contention
    ctx := context.Background()
    b.RunParallel(func(pb *testing.PB) {
        for pb.Next() {
            sem.Acquire(ctx, 1)
            sem.Release(1)
        }
    })
}

func BenchmarkContended(b *testing.B) {
    sem := semaphore.NewWeighted(8) // fewer slots than goroutines
    ctx := context.Background()
    b.RunParallel(func(pb *testing.PB) {
        for pb.Next() {
            sem.Acquire(ctx, 1)
            time.Sleep(time.Microsecond)
            sem.Release(1)
        }
    })
}

func BenchmarkChannelSem(b *testing.B) {
    sem := make(chan struct{}, 1000)
    b.RunParallel(func(pb *testing.PB) {
        for pb.Next() {
            sem <- struct{}{}
            <-sem
        }
    })
}
```

Run:
```bash
go test -bench=. -benchmem -count=10 -cpu=1,2,4,8
```

The `-cpu` flag exercises different parallelism levels. Watch how throughput and allocation change with concurrency.

### Expected pattern

- **Uncontended `Weighted`**: ~30–50 ns/op, 0 allocs.
- **Uncontended channel**: ~15–25 ns/op, 0 allocs.
- **Contended `Weighted`**: hundreds of ns/op, possibly 2 allocs (slow path), depends on contention level.
- **Contended channel**: similar order of magnitude, no allocs.

If numbers are off, profile to find why. The most common cause is the test setup itself (e.g., `time.Sleep` dominates).

---

## Summary

Optimising `semaphore.Weighted` use is a layered exercise:

1. **Measure first.** Wait time, hold time, allocation count. Many "optimisations" target the wrong layer.
2. **Right-size capacity** using Little's Law and downstream latency. This is the biggest lever.
3. **Reduce hold time** by releasing the slot as soon as the gated resource is no longer in use.
4. **Switch to a buffered channel** for weight = 1 paths where `select` integration is desired or allocation matters.
5. **Shard** when one global mutex is the bottleneck and a natural shard key exists.
6. **Adopt adaptive limiting** when the underlying service's latency varies enough to make fixed capacity always wrong.

Most production wins come from (2) and (3). Reach for (4)–(6) only when measurements justify the added complexity.

The semaphore itself is rarely the bottleneck. The contention it surfaces — saturated downstreams, oversized workloads, badly-scoped slots — is usually the real problem.
