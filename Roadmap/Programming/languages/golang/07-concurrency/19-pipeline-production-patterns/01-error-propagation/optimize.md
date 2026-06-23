---
layout: default
title: Optimize
parent: Error Propagation
grand_parent: Pipeline Production Patterns
ancestor: Go
nav_order: 10
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/19-pipeline-production-patterns/01-error-propagation/optimize/
---

# Error Propagation in Pipelines — Optimization

> Pipeline error propagation is correctness-first. Most "optimizations" are about avoiding silly costs, not about squeezing nanoseconds. Each entry below shows a real before/after with a realistic gain.

---

## Optimization 1 — Replace mutex aggregation with result slots

**Problem.** Aggregating results via a mutex serialises the hot path.

**Before:**

```go
var mu sync.Mutex
var results []Result
for _, item := range items {
    item := item
    g.Go(func() error {
        r := process(item)
        mu.Lock()
        results = append(results, r)
        mu.Unlock()
        return nil
    })
}
```

**After:**

```go
results := make([]Result, len(items))
for i, item := range items {
    i, item := i, item
    g.Go(func() error {
        results[i] = process(item)
        return nil
    })
}
```

**Gain.** No mutex contention. Each goroutine writes to a unique slot. Throughput often 2-3x for short tasks; negligible for long tasks. The memory model guarantees writes are visible after `g.Wait`.

---

## Optimization 2 — Fast-fail via SetLimit

**Problem.** Spawning N goroutines for N items when N is large (millions) wastes memory.

**Before:**

```go
g, ctx := errgroup.WithContext(ctx)
for _, item := range items {  // 1M items
    item := item
    g.Go(func() error { return process(item) })
}
return g.Wait()
```

Memory: ~2 GB stacks + closure heap. Scheduler thrashes.

**After:**

```go
g, ctx := errgroup.WithContext(ctx)
g.SetLimit(runtime.NumCPU() * 4)
for _, item := range items {
    item := item
    g.Go(func() error { return process(item) })
}
return g.Wait()
```

**Gain.** Constant memory (workers × 2 KB). Predictable latency. Throughput typically 2-10x higher.

---

## Optimization 3 — Pre-allocate error wrap fmt strings

**Problem.** `fmt.Errorf("...: %w", err)` in a hot path allocates per error.

**Before:**

```go
for _, item := range items {
    if err := process(item); err != nil {
        log.Error(fmt.Sprintf("item %s: %v", item.ID, err))
    }
}
```

**After:**

For logging only, use structured logging that defers formatting:

```go
for _, item := range items {
    if err := process(item); err != nil {
        log.Error("item failed", "id", item.ID, "err", err)
    }
}
```

**Gain.** Structured logger only formats if the log level is enabled. For high-volume info logs, this saves significant allocation.

For errors that must wrap (and are rare), the cost is acceptable. Don't pre-optimise.

---

## Optimization 4 — Cache error type checks

**Problem.** Repeated `errors.Is(err, ErrFoo)` walks the chain each time.

**Before:**

```go
if errors.Is(err, ErrA) { ... }
if errors.Is(err, ErrB) { ... }
if errors.Is(err, ErrC) { ... }
```

**After:**

```go
switch {
case errors.Is(err, ErrA): ...
case errors.Is(err, ErrB): ...
case errors.Is(err, ErrC): ...
}
```

Or, for very deep chains, cache the unwrapped result:

```go
// Cache once
root := err
for next := errors.Unwrap(root); next != nil; next = errors.Unwrap(next) {
    root = next
}
// Now compare against root
```

**Gain.** Modest — error matching is typically not hot. But if you have a tight loop processing errors, switch instead of cascading ifs saves a few cycles.

---

## Optimization 5 — Avoid context.WithCancel per item

**Problem.** Creating a context per item is wasteful.

**Before:**

```go
for _, item := range items {
    item := item
    g.Go(func() error {
        cctx, cancel := context.WithCancel(ctx)
        defer cancel()
        return process(cctx, item)
    })
}
```

**After:**

If you don't actually need per-item cancellation (just the group's context):

```go
for _, item := range items {
    item := item
    g.Go(func() error {
        return process(ctx, item)
    })
}
```

**Gain.** `context.WithCancel` allocates a struct and runs goroutine setup. Saving 100 ns per item × millions = noticeable.

Use per-item context only when per-item timeout or cancellation is needed.

---

## Optimization 6 — Reduce channel buffer when correct

**Problem.** Over-buffered channels hide backpressure issues.

**Before:**

```go
out := make(chan Item, 10000)
```

**After:**

```go
out := make(chan Item, 16)  // matches downstream parallelism
```

**Gain.** Faster backpressure detection. If consumer is slow, producer notices quickly and slows down. With a huge buffer, problems are masked.

Tune to match parallelism, not to maximise buffer.

---

## Optimization 7 — Use atomic for counters

**Problem.** Mutex around a single counter is overkill.

**Before:**

```go
var mu sync.Mutex
var count int
// ... in goroutine:
mu.Lock(); count++; mu.Unlock()
```

**After:**

```go
var count atomic.Int64
// ... in goroutine:
count.Add(1)
```

**Gain.** `atomic.Add` is ~5 ns; mutex Lock/Unlock is ~30 ns. For tight loops, 6x faster.

---

## Optimization 8 — Avoid `defer` in hot path

**Problem.** `defer` has small but measurable overhead.

**Before:**

```go
for _, item := range items {
    item := item
    g.Go(func() error {
        defer log.Debug("done", "id", item.ID)
        return process(item)
    })
}
```

**After:** If the defer is just logging, drop it. For ms-level work, defer overhead is invisible. For ns-level work, it matters.

**Gain.** Negligible at most scales. Don't optimise defer prematurely.

---

## Optimization 9 — Hedged requests for tail latency

**Problem.** P99 latency dominated by slow outliers.

**Before:**

```go
return slowAPI(ctx, req)
```

**After:**

```go
return hedged(ctx, req, 50*time.Millisecond)

func hedged(ctx context.Context, req Request, after time.Duration) (Response, error) {
    g, ctx := errgroup.WithContext(ctx)
    ctx, cancel := context.WithCancel(ctx)
    defer cancel()

    resCh := make(chan Response, 2)
    g.Go(func() error {
        r, err := slowAPI(ctx, req)
        if err == nil { resCh <- r }
        return err
    })

    select {
    case r := <-resCh:
        return r, nil
    case <-time.After(after):
    }
    g.Go(func() error {
        r, err := slowAPI(ctx, req)
        if err == nil { resCh <- r }
        return err
    })

    select {
    case r := <-resCh:
        return r, nil
    case <-ctx.Done():
        return Response{}, ctx.Err()
    }
}
```

**Gain.** P99 latency reduced 2-10x at the cost of 1.5-2x request volume. Net win when extra requests are cheap.

---

## Optimization 10 — Batched DB operations

**Problem.** One query per item is slow.

**Before:**

```go
for _, item := range items {
    item := item
    g.Go(func() error {
        return db.ExecContext(ctx, "INSERT INTO t VALUES ($1)", item.ID)
    })
}
```

**After:**

```go
const batchSize = 100
for i := 0; i < len(items); i += batchSize {
    end := i + batchSize
    if end > len(items) { end = len(items) }
    batch := items[i:end]
    g.Go(func() error {
        // INSERT with multiple rows
        return insertBatch(ctx, db, batch)
    })
}
```

**Gain.** 10-100x throughput for DB-bound work. Each query has fixed overhead; batching amortises it.

---

## Optimization 11 — Avoid unnecessary recovery

**Problem.** Recovering panics everywhere has cost (defer + check).

**Before:**

```go
g.Go(func() error {
    defer recover()  // habitual
    return work()
})
```

**After:** Only recover at goroutine boundaries where panics are expected (untrusted input, third-party libs). For pure-Go internal stages, let panics propagate (they indicate bugs).

**Gain.** Negligible per call. Habit-driven recovery hides bugs more than it costs.

---

## Optimization 12 — Drain channels with `for range _ = range ch`

**Problem.** Verbose drain code.

**Before:**

```go
for {
    if _, ok := <-ch; !ok { break }
}
```

**After:**

```go
for range ch {}
```

**Gain.** No performance difference; cleaner code. Optimisation of readability, not speed.

---

## Optimization 13 — Cancellation check before expensive work

**Problem.** Long operations don't check cancellation first.

**Before:**

```go
g.Go(func() error {
    result := expensiveComputation()  // takes 5 seconds
    return store(ctx, result)
})
```

**After:**

```go
g.Go(func() error {
    if err := ctx.Err(); err != nil { return err }
    result := expensiveComputation()
    if err := ctx.Err(); err != nil { return err }
    return store(ctx, result)
})
```

**Gain.** Cancelled work exits in microseconds instead of seconds. Important when cancellation is common (timeouts, sibling failures).

For long computations, periodically check inside:

```go
for i := 0; i < bigN; i++ {
    if i%1000 == 0 {
        if err := ctx.Err(); err != nil { return err }
    }
    // work
}
```

---

## Optimization 14 — Sync.Pool for temporary buffers

**Problem.** Allocating per-item buffers in hot path.

**Before:**

```go
g.Go(func() error {
    buf := make([]byte, 4096)
    // use buf
})
```

**After:**

```go
var bufPool = sync.Pool{New: func() any { return make([]byte, 4096) }}

g.Go(func() error {
    buf := bufPool.Get().([]byte)
    defer bufPool.Put(buf)
    // use buf
})
```

**Gain.** Reduces GC pressure. For 100k items, can save MB of garbage. Most useful when work is short and allocation is significant.

---

## Optimization 15 — Per-CPU sharding for aggregation

**Problem.** Single shared counter has cache-line bouncing under high contention.

**Before:**

```go
var total atomic.Int64
g.Go(func() error {
    for v := range in {
        total.Add(v.Amount)
    }
    return nil
})
```

**After:**

```go
const shards = 16
type Shard struct {
    _    [64]byte
    total int64
}
counters := make([]Shard, shards)

for i := 0; i < shards; i++ {
    i := i
    g.Go(func() error {
        for v := range in[i] {
            counters[i].total += v.Amount
        }
        return nil
    })
}
g.Wait()

var total int64
for _, c := range counters { total += c.total }
```

**Gain.** Eliminates cache-line bouncing. Throughput on multi-core can be 2-10x. Requires partitioning the input.

---

## Optimization 16 — Lazy retry context

**Problem.** Creating a retry context even when retry isn't needed.

**Before:**

```go
for attempt := 0; attempt < maxAttempts; attempt++ {
    cctx, cancel := context.WithTimeout(ctx, perCallTimeout)
    err := op(cctx)
    cancel()
    if err == nil { return nil }
}
```

**After:** Only create the timeout context when needed. For most calls (which succeed first try), the timeout context is wasted:

```go
err := op(ctx)
if err == nil { return nil }
for attempt := 1; attempt < maxAttempts; attempt++ {
    cctx, cancel := context.WithTimeout(ctx, perCallTimeout)
    err = op(cctx)
    cancel()
    if err == nil { return nil }
}
return err
```

**Gain.** Saves one context allocation per successful first-attempt call. Marginal but adds up at scale.

---

## Optimization 17 — Reduce allocation in error wrapping

**Problem.** `fmt.Errorf("X: %w", err)` allocates a wrapper struct per error.

**Before:**

```go
return fmt.Errorf("step1: %w", err)
```

**After:** For ultra-hot paths (rare), use a custom error type that reuses a pre-allocated wrapper:

```go
type wrapped struct { msg string; inner error }
func (w *wrapped) Error() string { return w.msg + ": " + w.inner.Error() }
func (w *wrapped) Unwrap() error { return w.inner }

// pool of wrapped:
var wrappedPool = sync.Pool{New: func() any { return &wrapped{} }}
```

**Gain.** Realistically: don't. Wrapping is per-error, not per-item. Errors should be rare. Optimising error allocation is rarely worth the complexity.

---

## Optimization 18 — Avoid time.Now in hot paths

**Problem.** `time.Now()` is faster than most things but not free.

**Before:**

```go
for _, item := range items {
    item := item
    g.Go(func() error {
        start := time.Now()
        err := process(item)
        metrics.Histogram("latency").Observe(time.Since(start).Seconds())
        return err
    })
}
```

**After:** If metrics granularity is fine, sample:

```go
if sample := rand.Intn(100) == 0; sample {
    start := time.Now()
    err := process(item)
    metrics.Histogram("latency").Observe(time.Since(start).Seconds())
    return err
}
return process(item)
```

**Gain.** For 100k items/sec, sampling at 1% saves 99% of `time.Now` calls and metric updates. Negligible loss of metric accuracy.

---

## Optimization 19 — Use the result-slot pattern with generics

**Problem.** Repeated boilerplate for parallel map.

**Before:** Custom boilerplate per use.

**After:** Generic helper:

```go
func ParallelMap[I, O any](ctx context.Context, items []I, fn func(context.Context, I) (O, error)) ([]O, error) {
    g, ctx := errgroup.WithContext(ctx)
    g.SetLimit(runtime.NumCPU())
    results := make([]O, len(items))
    for i, item := range items {
        i, item := i, item
        g.Go(func() error {
            r, err := fn(ctx, item)
            if err != nil { return fmt.Errorf("item %d: %w", i, err) }
            results[i] = r
            return nil
        })
    }
    return results, g.Wait()
}
```

**Gain.** Code reuse. Not a perf optimisation, but a productivity one. Tests once; reuse many.

---

## Optimization 20 — Avoid log inside tight loops

**Problem.** Logging per item is expensive at scale.

**Before:**

```go
for _, item := range items {
    log.Info("processing", "id", item.ID)
    process(item)
}
```

**After:**

```go
// Log start and end of batch, not per item:
log.Info("batch start", "count", len(items))
for _, item := range items {
    process(item)
}
log.Info("batch end")
```

Or log only on error:

```go
for _, item := range items {
    if err := process(item); err != nil {
        log.Error("failed", "id", item.ID, "err", err)
    }
}
```

**Gain.** At 100k items/sec, per-item logs are 100k logs/sec. That's millions per minute. Storage + write costs significant. Reduce to per-batch or per-error.

---

## When to Stop Optimising

After the easy wins:

1. Profile your specific workload.
2. Optimise the hot path identified.
3. Re-measure.
4. Stop when the cost of further optimisation exceeds the value.

A pipeline correct at 100k items/sec is more valuable than one at 200k items/sec with subtle bugs.

---

## What NOT to Optimise

- Error wrapping allocation (rare path).
- Recovery overhead (microseconds).
- Context value lookups (nanoseconds).
- `defer` overhead (nanoseconds).
- Channel send/receive (nanoseconds; fundamental to design).

These are noise in pipelines. Time better spent on:

- Bounded parallelism (`SetLimit`).
- Batching DB and external calls.
- Eliminating mutex contention.
- Reducing allocation in hot loops.
- Tail latency (hedging, timeouts).

---

## Realistic Numbers

For a Go pipeline on modern hardware:

- Spawn 10k goroutines: ~15 ms.
- Spawn 100k goroutines: ~150 ms.
- Channel send/receive: 50-100 ns.
- Mutex Lock/Unlock uncontended: 30 ns.
- Mutex Lock/Unlock contended: 1-50 µs.
- Atomic add: 5 ns.
- `fmt.Errorf("...: %w", err)`: 200-500 ns.
- `errors.Is` walking 3-deep chain: 30-50 ns.
- `errgroup.Go` overhead: 100-200 ns.
- `errgroup.Wait` (no goroutines): ~50 ns.

If your hot path is dominated by anything other than these, optimise those first.

---

## Closing

Pipeline performance is mostly about good defaults (bounded parallelism, batching, structured errors) and not about clever tricks. Get the structure right; performance follows.

The single biggest win in most pipelines: replace mutex aggregation with result slots. Second biggest: bound fan-out with `SetLimit`. Third: batch operations.

After those, profile and optimise the specific bottleneck.

Premature optimisation is the root of subtle bugs. Get correctness first. Always.
