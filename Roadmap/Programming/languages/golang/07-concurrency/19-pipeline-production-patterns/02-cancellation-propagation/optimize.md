---
layout: default
title: Cancellation Propagation — Optimize
parent: Cancellation Propagation
grand_parent: Pipeline Production Patterns
ancestor: Go
nav_order: 10
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/19-pipeline-production-patterns/02-cancellation-propagation/optimize/
---

# Cancellation Propagation — Optimization Exercises

Optimization exercises focused on cancellation latency, resource release time, and overhead. Each exercise has a slow starting point and asks you to improve it.

---

## Exercise 1: cancellable inner loop

**Starting code:**

```go
func compute(ctx context.Context, n int) int {
    sum := 0
    for i := 0; i < n; i++ {
        sum += slowOp(i)
    }
    return sum
}
```

The inner loop does not check ctx. Cancellation latency = full loop time.

**Goal**: make `compute` cancellable mid-loop with negligible overhead.

**Hint**: poll `ctx.Err()` every K iterations. Choose K to balance overhead and latency.

---

## Exercise 2: bounded fan-out latency

**Starting code:**

```go
func processAll(ctx context.Context, items []Item) error {
    var wg sync.WaitGroup
    for _, item := range items {
        item := item
        wg.Add(1)
        go func() {
            defer wg.Done()
            process(ctx, item)
        }()
    }
    wg.Wait()
    return nil
}
```

Unbounded fan-out: 10 000 items spawn 10 000 goroutines.

**Goal**: bound concurrency to N, while keeping cancellation latency low.

**Hint**: `errgroup.SetLimit(N)`.

---

## Exercise 3: drain optimization

**Starting code:**

```go
cancel()
for range out {
}
wg.Wait()
```

The drain runs serially. For a large channel, this takes time.

**Goal**: drain in parallel with the cancel cascade, so the total shutdown time is bounded by the slowest stage, not the sum.

**Hint**: start the drain goroutine before calling cancel.

---

## Exercise 4: select on hot channel

**Starting code:**

```go
for {
    select {
    case <-ctx.Done():
        return
    case v := <-in:
        process(v)
    }
}
```

The select overhead is 30 ns per iteration. For 1M items/sec, this is 3% CPU.

**Goal**: reduce select overhead in the hot path. Acceptable to make cancellation slightly slower.

**Hint**: check `ctx.Err()` periodically instead of on every iteration; cache `done := ctx.Done()` outside the loop.

---

## Exercise 5: avoid per-iteration context allocation

**Starting code:**

```go
for _, item := range items {
    ctx, cancel := context.WithTimeout(parent, time.Second)
    defer cancel()
    process(ctx, item)
}
```

Allocates a new context per iteration. Also a defer-in-loop bug.

**Goal**: provide per-item timeouts without per-iteration allocation, or provide them with proper cancel cleanup.

**Hint**: use an IIFE, or hoist the context creation if the same deadline applies, or use `context.WithDeadline` with a fixed end time.

---

## Exercise 6: reduce cancellation broadcast latency

**Starting code:**

```go
ctx, cancel := context.WithCancel(parent)
for i := 0; i < 10000; i++ {
    go func() {
        <-ctx.Done()
        cleanup()
    }()
}
cancel() // wakes 10000 goroutines
```

Broadcast latency is linear in goroutine count.

**Goal**: reduce the apparent latency by hierarchical cancellation.

**Hint**: split goroutines into groups of 100, each with their own sub-context.

---

## Exercise 7: optimize timer allocation in retry loop

**Starting code:**

```go
for i := 0; i < attempts; i++ {
    if err := fn(); err == nil {
        return nil
    }
    select {
    case <-ctx.Done():
        return ctx.Err()
    case <-time.After(backoff):
    }
    backoff *= 2
}
```

`time.After` allocates a timer per iteration that may leak.

**Goal**: use a single timer reused across iterations.

**Hint**: `timer := time.NewTimer(backoff); defer timer.Stop()` plus `timer.Reset` per iteration.

---

## Exercise 8: reduce context tree depth

**Starting code:**

```go
ctx1, c1 := context.WithCancel(parent)
ctx2, c2 := context.WithCancel(ctx1)
ctx3, c3 := context.WithCancel(ctx2)
ctx4, c4 := context.WithTimeout(ctx3, time.Second)
defer c1()
defer c2()
defer c3()
defer c4()
work(ctx4)
```

Four-deep context tree. Each derivation has cost.

**Goal**: reduce to two levels without losing the semantics.

**Hint**: most of the derivations are equivalent to a single one. Identify which add real value.

---

## Exercise 9: reduce mutex hold time in cancel cascade

**Starting code:**

```go
type Pool struct {
    mu      sync.Mutex
    workers []*Worker
}

func (p *Pool) Stop() {
    p.mu.Lock()
    defer p.mu.Unlock()
    for _, w := range p.workers {
        w.Stop() // each Stop blocks for ms
    }
}
```

Stop holds the mutex while sequentially stopping each worker. Other operations block.

**Goal**: stop workers in parallel and release the mutex quickly.

**Hint**: snapshot the workers slice under the lock, release the lock, then stop in parallel.

---

## Exercise 10: avoid `select` with `time.After` in idle loops

**Starting code:**

```go
for {
    select {
    case <-ctx.Done():
        return
    case <-time.After(time.Minute):
        doWork()
    }
}
```

Each `time.After` allocates a new timer. Over millions of iterations, this churns memory.

**Goal**: reuse the timer.

**Hint**: `timer := time.NewTimer(time.Minute)`; reset after each work or cancel.

---

## Exercise 11: minimize cancel allocation overhead

**Starting code:**

```go
func handler(parent context.Context) error {
    ctx, cancel := context.WithCancel(parent)
    defer cancel()
    return process(ctx)
}
```

Every call allocates a `cancelCtx`. For high-throughput services, the allocations add up.

**Goal**: avoid the allocation when no derived context is needed.

**Hint**: pass the parent directly if the function does not need to cancel. Only derive when you specifically need a new cancellation scope.

---

## Exercise 12: reduce cancellation latency under high concurrency

**Starting code:**

A service with 100 000 connections, each with a goroutine, each watching the same context. On shutdown, all wake at once and contend for CPU.

**Goal**: smooth the wake-up so the latency is predictable.

**Hint**: stagger the wake-up by having sub-contexts cancelled with a small delay between groups.

---

## Exercise 13: cancellation in tight numeric inner loops

**Starting code:**

```go
func sumSquares(ctx context.Context, n int) (int, error) {
    sum := 0
    for i := 0; i < n; i++ {
        sum += i * i
    }
    return sum, nil
}
```

No cancellation; uninterruptible for large n.

**Goal**: make cancellable with minimal overhead in the hot path.

**Hint**: split the loop into chunks; check ctx between chunks. The chunk size balances overhead and latency.

---

## Exercise 14: avoid unnecessary `Done()` calls

**Starting code:**

```go
for {
    select {
    case <-ctx.Done():
        return
    case v := <-in:
        process(v)
    }
}
```

Each iteration calls `ctx.Done()` (an interface method dispatch + atomic load).

**Goal**: avoid the repeated call.

**Hint**: hoist the channel: `done := ctx.Done()` before the loop.

---

## Exercise 15: optimize errgroup with `SetLimit`

**Starting code:**

```go
sem := make(chan struct{}, 10)
g, ctx := errgroup.WithContext(parent)
for _, item := range items {
    item := item
    g.Go(func() error {
        select {
        case sem <- struct{}{}:
        case <-ctx.Done():
            return ctx.Err()
        }
        defer func() { <-sem }()
        return process(ctx, item)
    })
}
```

Manual semaphore inside each task.

**Goal**: simpler equivalent with `SetLimit`.

**Hint**: `g.SetLimit(10)` does the same thing without per-task code.

---

## Exercise 16: reduce shutdown latency by parallelizing cleanup

**Starting code:**

```go
func Shutdown(ctx context.Context) {
    srv.Shutdown(ctx)
    pool.Drain()
    cache.Flush()
    db.Close()
}
```

Each step blocks until the next can run.

**Goal**: parallelize independent steps.

**Hint**: `srv.Shutdown` and `cache.Flush` are independent of each other (but both must complete before `db.Close`).

---

## Exercise 17: cache `ctx.Done()` for inner loop performance

Measure: how much faster is the hot loop if you cache `done := ctx.Done()` outside?

For 1M iterations:

- Without cache: select runs ~30 ns per iteration.
- With cache: select runs ~25 ns per iteration.

About 15% faster for the cancellation check. Negligible for most code; measurable for very hot paths.

---

## Exercise 18: amortize context cost in batch processing

**Starting code:**

```go
for _, batch := range batches {
    ctx, cancel := context.WithTimeout(parent, time.Second)
    defer cancel()
    for _, item := range batch {
        process(ctx, item)
    }
}
```

Per-batch context overhead.

**Goal**: amortize the context cost.

**Hint**: if the same deadline applies to all batches, derive once outside the loop.

---

## Exercise 19: trade off cancellation latency for memory

**Starting code:**

A pipeline with buffer 1000. Cancellation latency is bounded by drain time, which is O(1000 * per-item).

**Goal**: reduce cancellation latency by reducing buffer size; measure the throughput impact.

**Hint**: experiment with buffer sizes 0, 1, 10, 100, 1000. Plot cancellation latency vs throughput.

---

## Exercise 20: optimize goleak overhead in tests

**Starting code:**

```go
func TestMain(m *testing.M) {
    goleak.VerifyTestMain(m)
}
```

`goleak.VerifyTestMain` runs after every test. For a suite with 10 000 tests, overhead matters.

**Goal**: configure goleak to be fast for the common case but still catch leaks.

**Hint**: use `goleak.VerifyNone` selectively rather than on every test; ignore known-safe goroutines via options.

---

## Optimization checklist

Before declaring a pipeline "fast enough":

- Cancellation latency measured and within SLA.
- No per-item context allocation (hoist outside loops).
- No `time.Sleep` in cancellable code (use `select` with `time.After`).
- Channel buffer sizes match the throughput requirement (not larger).
- Timers are reused (`time.NewTimer` + `Reset`).
- `select` overhead is acceptable for the hot path.
- Resource release is parallelized when possible.
- Mutex hold times are minimal.
- `errgroup.SetLimit` used instead of manual semaphores.
- Tests verify cancellation latency.

---

## A note on premature optimization

Most pipelines do not need these optimizations. The default patterns (`errgroup`, `select` with `ctx.Done()`, `defer close(out)`) are fast enough for almost any service.

Apply these optimizations only when:

- Profiling shows cancellation paths are the bottleneck.
- Shutdown SLAs are not being met.
- Memory or CPU profiling implicates context allocations.

Otherwise, focus on correctness. A correct slow pipeline is better than an optimized incorrect one.

---

## Worked example: optimizing a producer

Starting point:

```go
func produce(ctx context.Context, n int) <-chan int {
    out := make(chan int, 1000)
    go func() {
        defer close(out)
        for i := 0; i < n; i++ {
            select {
            case out <- i:
            case <-ctx.Done():
                return
            }
        }
    }()
    return out
}
```

Measured: 50 ns per item, 30 ns of which is the `select`.

Optimization 1: hoist `done`:

```go
done := ctx.Done()
for i := 0; i < n; i++ {
    select {
    case out <- i:
    case <-done:
        return
    }
}
```

Saves ~5 ns per iteration (interface method dispatch).

Optimization 2: check less often:

```go
done := ctx.Done()
for i := 0; i < n; i++ {
    if i%256 == 0 {
        select {
        case <-done:
            return
        default:
        }
    }
    select {
    case out <- i:
    case <-done:
        return
    }
}
```

Wait — the second select is still required because the buffer can fill. This optimization does not help here.

Optimization 3: batch sends:

```go
const batchSize = 64
batch := make([]int, 0, batchSize)
for i := 0; i < n; i++ {
    batch = append(batch, i)
    if len(batch) == batchSize {
        for _, v := range batch {
            select {
            case out <- v:
            case <-done:
                return
            }
        }
        batch = batch[:0]
    }
}
```

This adds overhead, not removes it. Not actually an improvement.

Lesson: the `select` is already very fast. The main lever is buffer size and the per-item work, not the cancellation check.

---

## Worked example: optimizing shutdown

A service that takes 5 seconds to shut down. Profile shows:

- 4 seconds: workers finishing in-flight jobs.
- 0.5 seconds: cache flush to disk.
- 0.5 seconds: DB pool close.

Total 5 seconds, mostly serial.

Optimization 1: parallelize cache flush and pool drain:

```go
g, gctx := errgroup.WithContext(context.Background())
g.Go(func() error { pool.Drain(); return nil })
g.Go(func() error { cache.Flush(); return nil })
_ = g.Wait()
db.Close()
```

Now cache flush and pool drain run in parallel. Total: 4.5 seconds (worker drain dominates).

Optimization 2: reduce per-worker job time. If each worker has a 1-second job and there are 16 workers, drain time is bounded by the longest in-flight job. Add cancellation polling inside the job:

```go
func processJob(ctx context.Context, j Job) {
    for chunk := range j.Chunks() {
        if ctx.Err() != nil {
            return
        }
        processChunk(chunk)
    }
}
```

Now even slow jobs cancel within a chunk. Drain time drops to ~100 ms.

Total shutdown: 0.6 seconds. 8x improvement.

---

## Worked example: profile a cancellation hot path

Starting code (from profiling):

```
context.(*cancelCtx).cancel  ----- 23% CPU
runtime.selectgo              ----- 18% CPU
runtime.chanrecv              ----- 15% CPU
```

23% in `cancel` is huge — it means cancellations are happening very frequently. Investigate:

- Are pipelines short-lived? Reduce per-pipeline overhead.
- Are deadlines firing repeatedly? Increase deadlines or fix slow upstream.
- Are there many small `WithCancel` calls? Consolidate.

After investigation: the service was creating a new errgroup per request with 50 short tasks each having their own `WithTimeout`. Each task allocated and cancelled within milliseconds.

Fix: share a single context across the 50 tasks; remove individual `WithTimeout`s where not needed.

Result: CPU usage dropped from 60% to 20% at the same request rate.

---

## References

- `go test -bench` for measuring overhead.
- `go tool pprof` for finding hot paths.
- `go tool trace` for cancellation cascade timing.
- `runtime.ReadMemStats` for allocation tracking.
