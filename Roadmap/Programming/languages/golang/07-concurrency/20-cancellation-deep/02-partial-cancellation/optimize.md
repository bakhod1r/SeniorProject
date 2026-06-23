---
layout: default
title: Partial Cancellation — Optimize
parent: Partial Cancellation
grand_parent: Cancellation Deep
ancestor: Go
nav_order: 10
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/20-cancellation-deep/02-partial-cancellation/optimize/
---

# Partial Cancellation — Optimization

> Partial cancellation is cheap. Optimization mostly means making the *system around it* efficient — pool sizing, queue management, observability overhead, GC pressure. Each entry below states the problem, shows a "before" and "after" snippet, and the realistic gain.

---

## Optimization 1 — Replace per-event goroutine with a bounded pool

**Problem.** Spawning one goroutine per detached event scales poorly under load. Each goroutine costs 2 KB stack plus its captured closure. At 10,000 events/sec with 100ms duration, you have 1000 concurrent goroutines — 2 MB plus connection overhead.

**Before:**
```go
go func() {
    ctx := context.WithoutCancel(parent)
    ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
    defer cancel()
    _ = audit.Write(ctx, event)
}()
```

**After:**
```go
pool.Submit(parent, "audit", func(ctx context.Context) error {
    return audit.Write(ctx, event)
})
```

The pool has a fixed number of workers (say 100). Excess submissions wait in the queue (or are rejected, depending on the policy).

**Gain.** Bounded resource use. Goroutine count constant regardless of submission rate. Memory savings: at high rates, can be 10x lower goroutine count.

---

## Optimization 2 — Batch detached operations

**Problem.** Each detached operation makes one network call. At high rates, the network is saturated by many small calls.

**Before:**
```go
for _, ev := range events {
    pool.Submit(parent, "audit", func(ctx context.Context) error {
        return audit.Write(ctx, ev)
    })
}
```

**After:**
```go
batchQueue.Add(events) // accumulates into batches
```

with a background flusher:

```go
func (q *BatchQueue) Run(processCtx context.Context) {
    var batch []Event
    ticker := time.NewTicker(time.Second)
    for {
        select {
        case ev := <-q.in:
            batch = append(batch, ev)
            if len(batch) >= 100 {
                q.flush(batch); batch = nil
            }
        case <-ticker.C:
            if len(batch) > 0 { q.flush(batch); batch = nil }
        case <-processCtx.Done():
            return
        }
    }
}
```

**Gain.** 100x fewer network calls for batched operations. Throughput limited by serialisation cost, not round-trips. Trade-off: slight increase in visibility latency.

---

## Optimization 3 — Cache extracted values

**Problem.** Looking up `ctx.Value(traceKey{})` repeatedly walks the context chain. For deep chains, this adds up.

**Before:**
```go
for _, item := range items {
    pool.Submit(parent, "process", func(ctx context.Context) error {
        tid := traceFromCtx(ctx) // walks chain every iteration
        return process(ctx, tid, item)
    })
}
```

**After:**
```go
tid := traceFromCtx(parent) // walk once
for _, item := range items {
    item := item
    pool.Submit(parent, "process", func(ctx context.Context) error {
        return process(ctx, tid, item)
    })
}
```

**Gain.** Negligible for short loops; meaningful for hot loops processing millions of items.

---

## Optimization 4 — Reduce context depth

**Problem.** Each `WithValue` adds one wrapper to the context chain. A handler that adds 12 values has a 12-deep chain. Lookups walk all 12 levels.

**Before:**
```go
ctx = context.WithValue(ctx, k1{}, v1)
ctx = context.WithValue(ctx, k2{}, v2)
// ... ten more ...
```

**After:** group related values into a single struct stored under one key:

```go
type RequestInfo struct {
    TraceID, UserID, TenantID, RequestID string
}
ctx = context.WithValue(ctx, requestKey{}, &RequestInfo{...})
```

**Gain.** Context depth from 12 to 1. Value lookups are O(1) instead of O(12). Useful for very hot paths.

---

## Optimization 5 — Use a single timer for a batch

**Problem.** Each `WithTimeout` allocates a `time.Timer`. For 10,000 concurrent detached operations, 10,000 timers in the runtime heap.

**Before:**
```go
for _, item := range items {
    pool.Submit(parent, "op", func(ctx context.Context) error {
        // pool internally calls WithTimeout for each
        return process(ctx, item)
    })
}
```

**After:** one timer for the batch, checked per item:

```go
deadline := time.Now().Add(5 * time.Second)
for _, item := range items {
    if time.Now().After(deadline) { break }
    item := item
    pool.Submit(parent, "op", func(ctx context.Context) error {
        return process(ctx, item)
    })
}
```

**Gain.** Fewer timers, simpler heap operations. Trade-off: per-item deadline is shared, less granular.

---

## Optimization 6 — Avoid per-op span allocation

**Problem.** Each detached operation starts a tracing span. Spans are allocated; their export costs CPU.

**Before:** every op creates a span.

**After:** sample spans probabilistically:

```go
if rand.Float64() < 0.01 {
    ctx, span := tracer.Start(detached, "op")
    defer span.End()
    return work(ctx)
}
return work(detached)
```

**Gain.** 100x reduction in span volume. Trade-off: lower trace coverage; some operations not traced.

---

## Optimization 7 — Pool worker count vs database connections

**Problem.** A pool with 1000 workers all needing database connections, but the DB pool has only 50 connections. Workers wait. Effective concurrency is 50, not 1000.

**Before:** worker count chosen arbitrarily.

**After:** match worker count to the bottleneck:

```go
pool := NewPool(processCtx, dbPool.MaxConns) // 50 workers
```

**Gain.** Reduced contention. Workers are CPU-resident; no wasted scheduling.

---

## Optimization 8 — Reject early at submission

**Problem.** Allowing submissions to queue when the system is already overloaded leads to deep queues and slow drain.

**Before:**
```go
func (p *Pool) Submit(...) { p.work <- f } // may block
```

**After:**
```go
func (p *Pool) Submit(...) error {
    select {
    case p.work <- f:
        return nil
    default:
        return ErrQueueFull
    }
}
```

The caller decides: log and drop, write to DLQ, or backpressure upstream.

**Gain.** No unbounded queue growth. Submission is bounded-time.

---

## Optimization 9 — Use `Err()` polling instead of `Done()` channels

**Problem.** Each `<-ctx.Done()` involves a channel receive (~100 ns). In a hot loop checking cancellation, this matters.

**Before:**
```go
for i := 0; i < 1000000; i++ {
    select {
    case <-ctx.Done():
        return
    default:
    }
    // ... work ...
}
```

**After:**
```go
for i := 0; i < 1000000; i++ {
    if i%100 == 0 {
        if ctx.Err() != nil { return }
    }
    // ... work ...
}
```

Check periodically, not every iteration. `Err()` is a mutex-protected read, similar cost to a channel receive.

**Gain.** Marginal but noticeable in tight CPU loops. Reduces context overhead from ~5% to ~0.05%.

---

## Optimization 10 — Reuse closures across submissions

**Problem.** Each `Submit` allocates a fresh closure. The closure captures variables and is heap-allocated.

**Before:**
```go
for _, item := range items {
    item := item
    pool.Submit(parent, "process", func(ctx context.Context) error {
        return process(ctx, item)
    })
}
```

**After:** use an adapter type that holds parameters:

```go
type ProcessTask struct{ Item Item }
func (t ProcessTask) Run(ctx context.Context) error { return process(ctx, t.Item) }

for _, item := range items {
    pool.SubmitTask(parent, "process", ProcessTask{Item: item})
}
```

The pool's API accepts a `Task` interface. The closure allocation is replaced by a struct allocation (cheaper).

**Gain.** Marginal. Useful in extreme hot paths.

---

## Optimization 11 — Avoid `defer cancel()` in tight loops

**Problem.** `defer cancel()` allocates a defer record (~32 bytes). In a tight loop creating many WithTimeouts, this adds up.

**Before:**
```go
for _, item := range items {
    ctx, cancel := context.WithTimeout(parent, time.Second)
    defer cancel() // <-- BUG: defers accumulate
    _ = process(ctx, item)
}
```

The defer is wrong here anyway — all cancels run only at function exit, after all loop iterations.

**After:**
```go
for _, item := range items {
    ctx, cancel := context.WithTimeout(parent, time.Second)
    _ = process(ctx, item)
    cancel() // immediate, no defer
}
```

**Gain.** No defer accumulation. Immediate timer release. Significant in large loops.

---

## Optimization 12 — Pool queue size based on burst tolerance

**Problem.** Too small a queue rejects bursts; too large a queue allows unbounded growth.

**Before:** queue size guessed.

**After:** calculate from burst tolerance:

```go
// Steady-state: 200/sec. Peak burst: 1000/sec for 2 seconds. Workers complete at 200/sec.
// Burst absorbs 1000-200 = 800/sec extra, for 2 seconds = 1600 items.
queueSize := 1600
```

**Gain.** Queue sized for realistic load. No rejections during normal bursts. No unbounded growth.

---

## Optimization 13 — Async metric emission

**Problem.** Each operation emits metrics synchronously. Metric emission has its own overhead.

**Before:**
```go
metrics.IncSubmission(name)
metrics.IncCompletion(name)
metrics.ObserveDuration(name, duration)
```

**After:** batch metrics in a worker:

```go
metricChan <- Metric{Name: name, Type: "completion"}
```

with a background flusher that batches and emits.

**Gain.** Metric emission is amortized. Reduces per-op overhead by 50%.

---

## Optimization 14 — Drop unused contexts

**Problem.** A detached goroutine holds the context for its entire lifetime, keeping the parent value chain alive.

**Before:**
```go
go func() {
    longRunning(detached)
}()
```

**After:**
```go
go func() {
    // Extract what is needed.
    tid := traceFromCtx(detached)
    // Drop the context.
    detached = nil
    longRunningWithTID(tid)
}()
```

**Gain.** Garbage collection can reclaim the context's parent chain earlier. Useful for very long-running detached work.

---

## Optimization 15 — Match drain budget to operation duration

**Problem.** A drain budget far exceeding the longest operation wastes shutdown time.

**Before:**
```go
drainCtx, _ := context.WithTimeout(context.Background(), 5*time.Minute)
```

**After:** set to match the longest legitimate operation:

```go
drainCtx, _ := context.WithTimeout(context.Background(), 30*time.Second)
```

If the budget is wrong, in-flight ops are killed (or shutdown is unnecessarily slow). Calibrate to the longest p99 operation.

**Gain.** Shorter shutdowns; faster deploys. Trade-off: more sensitive to outlier operations.

---

## Summary

Fifteen optimizations. Each gains something modest. Together they can reduce detached-work overhead from 5% of CPU to 0.5%.

For a service handling 10,000 requests per second with 3 detached operations each, this is 30,000 detached ops per second. At 5% CPU, that is 1.5 cores. At 0.5%, that is 0.15 cores. The difference at scale is real.

Profile your service before optimizing. Find the dominant cost. Optimize that first. Most services do not need any of these — the dominant cost is the actual work, not the detached infrastructure.

---

## Closing

Partial cancellation itself is fast. The infrastructure around it can be slow if neglected. These optimizations target the infrastructure.

Build the simple pool first. Measure. Optimize only what shows up in profiles. Most code does not need any of this.

But when you do need it, these recipes are battle-tested.

---

## Appendix: A Profile-Driven Optimization Checklist

When profiling a service with heavy detached work, check these in order:

1. **Goroutine count.** Is it growing? Bound it.
2. **Memory growth.** Is it growing? Find what is held.
3. **CPU profile.** What dominates? Optimize that.
4. **Mutex contention.** Where are workers waiting?
5. **Channel blocking.** Where is the queue saturating?
6. **GC pressure.** Are short-lived allocations dominating?
7. **Network calls.** Are they batched? Are they bounded?
8. **Database connections.** Are they pooled? Are they bounded?

For each, find the dominant cost and apply the appropriate optimization above.

---

## Appendix: When to Stop Optimizing

A service should optimize until:

- p99 latency is within SLO.
- CPU utilisation is below the alert threshold.
- Memory growth is bounded.
- Goroutine count is stable.
- Drain time is within budget.

Once these are met, stop. Further optimization is yak-shaving.

The cost of premature optimization is real: complex code, harder debugging, more bugs. Optimize when there is a measurable problem; not before.

---

## Final Note

Partial cancellation is a small API with subtle implications. The optimizations in this file are mostly about the *system* around it, not the API itself.

The single most important optimization is the bounded pool. Everything else is incremental.

Build the pool. Bound it. Drain it. Observe it. That gives you 95% of the value. The remaining 5% is the contents of this file.
