---
layout: default
title: Optimize
parent: tunny
grand_parent: Goroutine Pools (3rd-party)
ancestor: Go
nav_order: 10
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/17-goroutine-pools-3rd-party/02-tunny/optimize/
---

# tunny — Optimization Scenarios

This file contains 10 performance scenarios. For each:

1. **The Setup:** an existing tunny-based service or component.
2. **The Symptom:** a measured performance problem.
3. **The Analysis:** what you measure and discover.
4. **The Fix:** the optimization applied.
5. **The Result:** what improves and by how much.

Use these as case studies for performance tuning under tunny.

---

## Scenario 1 — Pool size too large

### Setup

```go
pool := tunny.NewFunc(64, work)
```

Service runs on a 4-core machine.

### Symptom

- CPU utilization 100% under modest load.
- p99 latency much higher than expected.
- Throughput plateaus far below theoretical.

### Analysis

`pprof` shows substantial time in scheduler overhead. Context switches per second is much higher than expected. The pool has 64 goroutines fighting for 4 cores.

### Fix

```go
pool := tunny.NewFunc(runtime.NumCPU(), work)
```

### Result

- CPU utilization 80% (workers actually doing work, not switching).
- p99 latency drops by 60%.
- Throughput up ~30%.

**Lesson:** For CPU-bound work, pool size should match `NumCPU()`. More workers do not help; they hurt.

---

## Scenario 2 — Per-call allocation

### Setup

Worker function allocates a buffer per call:

```go
pool := tunny.NewFunc(8, func(p any) any {
    buf := make([]byte, 64*1024)
    return process(p, buf)
})
```

### Symptom

- GC pause spikes during heavy load.
- Throughput drops under sustained traffic.

### Analysis

`pprof/heap` shows `make([]byte, 64*1024)` is the top allocator. Each call creates a 64 KB buffer, throws it away. At 10k calls/sec, that is 640 MB/s of allocation.

### Fix

Move to the `Worker` interface, hold the buffer on the worker:

```go
type worker struct {
    buf []byte
}

func newWorker() tunny.Worker {
    return &worker{buf: make([]byte, 64*1024)}
}

func (w *worker) Process(p any) any {
    return process(p, w.buf)
}
```

### Result

- GC pause times drop dramatically (heap pressure gone).
- Throughput up 2x.

**Lesson:** Per-call allocations are death. Hoist anything that can be hoisted to the worker.

---

## Scenario 3 — Many small jobs, channel overhead dominates

### Setup

```go
pool := tunny.NewFunc(8, func(p any) any {
    return p.(int) * 2 // takes ~1 ns
})

for _, n := range hugeList {
    pool.Process(n)
}
```

### Symptom

- Throughput is 1M calls/sec; expected 100M.
- CPU is busy but mostly in tunny's internals.

### Analysis

Each `Process` call involves three channel operations. The work itself takes 1 ns, but channel ops take ~150 ns each. The overhead is 450x the work.

### Fix

Batch many items per `Process` call:

```go
pool := tunny.NewFunc(8, func(p any) any {
    batch := p.([]int)
    result := make([]int, len(batch))
    for i, n := range batch {
        result[i] = n * 2
    }
    return result
})

for i := 0; i < len(hugeList); i += 1000 {
    end := min(i+1000, len(hugeList))
    pool.Process(hugeList[i:end])
}
```

### Result

- Throughput climbs to 50M items/sec.
- Channel overhead amortized over 1000 items.

**Lesson:** Tunny is not free. For nanosecond work, batch. For millisecond work, do not bother.

---

## Scenario 4 — Slow factory at startup

### Setup

```go
pool := tunny.New(16, func() tunny.Worker {
    return loadHugeModel() // takes 5 seconds
})
```

### Symptom

- Service startup takes 80 seconds (16 * 5).
- Kubernetes readiness probe times out.

### Analysis

The factory is called sequentially. 16 invocations at 5 seconds each.

### Fix

Pre-construct workers in parallel, then pass them in via the factory:

```go
preloaded := make([]tunny.Worker, 16)
var wg sync.WaitGroup
for i := range preloaded {
    i := i
    wg.Add(1)
    go func() {
        defer wg.Done()
        preloaded[i] = loadHugeModel()
    }()
}
wg.Wait()

next := atomic.Int32{}
pool := tunny.New(16, func() tunny.Worker {
    return preloaded[next.Add(1)-1]
})
```

### Result

- Startup time drops to ~5 seconds (parallel).
- Readiness probe passes.

**Lesson:** Tunny's factory is sequential. If construction is slow, parallelise yourself.

---

## Scenario 5 — Saturated downstream

### Setup

Workers call a third-party API:

```go
func (w *worker) Process(p any) any {
    return w.client.Call(p)
}
```

Pool size 32.

### Symptom

- Third-party API returns 429 errors.
- Our success rate drops.

### Analysis

The pool sends too many requests. The API allows only 10 concurrent.

### Fix

Add `BlockUntilReady` with a shared rate limiter:

```go
lim := rate.NewLimiter(10, 10)

func (w *worker) BlockUntilReady() {
    _ = lim.Wait(context.Background())
}
```

Or downsize the pool to 10:

```go
pool := tunny.New(10, factory)
```

### Result

- 429 errors stop.
- Success rate restored.

**Lesson:** Pool size should not exceed downstream concurrency limits.

---

## Scenario 6 — Latency spikes from GC

### Setup

A correctly-sized pool of 8 workers, doing memory-heavy work.

### Symptom

- p99 latency is 10x p50.
- Spikes are intermittent.

### Analysis

`go tool trace` shows GC pauses correlating with latency spikes. Memory pressure from heavy per-call allocation.

### Fix

Three knobs:

1. Hoist allocations to worker fields (see Scenario 2).
2. Tune `GOGC` to run GC less frequently (higher value, e.g. 200).
3. Set `GOMEMLIMIT` to prevent runaway memory.

```go
debug.SetGCPercent(200)
debug.SetMemoryLimit(8 * 1024 * 1024 * 1024) // 8 GB
```

### Result

- GC frequency drops, pauses are less common.
- p99 latency drops by 70%.

**Lesson:** GC affects tail latency. Tune accordingly.

---

## Scenario 7 — Pool size driven by RPS

### Setup

A service receives 1000 RPS. The team sizes the pool to 1000.

### Symptom

- 1000 idle goroutines most of the time.
- Memory waste.
- Cold-start slow.

### Analysis

Each call takes 5 ms. RPS * call_time = 1000 * 0.005 = 5 work-seconds. The actual concurrency needed is 5 workers, not 1000.

### Fix

```go
pool := tunny.New(runtime.NumCPU(), factory) // 8 on an 8-core box
```

### Result

- Memory drops from 2 GB to 256 MB.
- Cold-start time drops.
- No throughput change (the bottleneck was always the cores).

**Lesson:** Pool size = capacity, not throughput. Size to the binding constraint.

---

## Scenario 8 — Hedged requests for tail latency

### Setup

Pool of 16. Some calls are occasional outliers (10x average).

### Symptom

- p50 fine, p99 way too high.
- Outliers are unavoidable due to upstream variability.

### Analysis

A small fraction of calls hit slow paths. Cannot eliminate; can hedge.

### Fix

If the median latency is 100 ms, schedule a backup at 200 ms:

```go
type Hedged struct {
    pool *tunny.Pool
}

func (h *Hedged) Process(payload any) any {
    result := make(chan any, 2)
    go func() { result <- h.pool.Process(payload) }()
    timer := time.NewTimer(200 * time.Millisecond)
    defer timer.Stop()
    select {
    case r := <-result:
        return r
    case <-timer.C:
    }
    go func() { result <- h.pool.Process(payload) }()
    return <-result
}
```

The first response wins. The second may run wastefully.

### Result

- p99 latency drops by 50%.
- Total work increases by ~10% (hedges).

**Lesson:** Hedging trades work for latency. Useful for read-heavy, idempotent workloads.

---

## Scenario 9 — Cache in front of the pool

### Setup

Pool does expensive work; same inputs often recur.

### Symptom

- Pool consistently saturated.
- CPU at 100%.

### Analysis

10% of inputs account for 60% of traffic. Cache the results.

### Fix

```go
type Cached struct {
    pool  *tunny.Pool
    cache *lru.Cache
}

func (c *Cached) Process(payload any) any {
    key := hash(payload)
    if v, ok := c.cache.Get(key); ok {
        return v
    }
    out := c.pool.Process(payload)
    c.cache.Add(key, out)
    return out
}
```

### Result

- Pool load drops by 60%.
- CPU at 40%.
- p99 latency drops (cache hits are near-instant).

**Lesson:** When work is idempotent and inputs repeat, cache. Often more effective than pool tuning.

---

## Scenario 10 — Reducing payload boxing

### Setup

Workers take large structs as payloads:

```go
type BigJob struct {
    /* 8 KB of data */
}

pool.Process(BigJob{...})
```

### Symptom

- Heap profile shows BigJob escape-to-heap allocations dominating.

### Analysis

Each `Process` call boxes `BigJob` (a value type) into `interface{}`, allocating it on the heap.

### Fix

Pass pointers:

```go
pool.Process(&BigJob{...})
```

The interface holds the pointer directly; only one tiny allocation (the pointer).

### Result

- Heap allocations drop.
- GC pressure drops.

**Lesson:** Pass large payloads by pointer. Small (e.g. int, *struct) are fine by value.

---

## Summary

Ten scenarios covering the most common optimization opportunities:

1. Right-size the pool to CPU count.
2. Hoist per-call allocations to worker fields.
3. Batch many small items per call.
4. Parallelise slow factory construction.
5. Throttle downstream-bound pools.
6. Tune GC to reduce pause-induced latency.
7. Size pool to capacity, not throughput.
8. Use hedging for tail latency.
9. Cache in front of the pool.
10. Pass large payloads by pointer.

Each is small. Combined, they often produce 5-10x improvements in throughput and latency.

---

## Bonus Scenarios

### Bonus 1 — Per-worker `sync.Pool`

For occasional large allocations within a worker:

```go
type worker struct {
    bufs sync.Pool
}

func (w *worker) Process(p any) any {
    buf := w.bufs.Get().([]byte)[:0]
    defer w.bufs.Put(buf)
    return process(p, buf)
}
```

This handles workers that mostly allocate small buffers but occasionally need large ones.

### Bonus 2 — Avoid `log.Printf` in workers

`log.Printf` takes a mutex shared by all goroutines. Workers logging at high rates serialise on this mutex.

Use a structured logger with a buffered backend, or remove the log entirely from the hot path.

### Bonus 3 — Avoid `time.After`

```go
select {
case <-time.After(50 * time.Millisecond):
case <-other:
}
```

`time.After` allocates a timer per call. If `Process` does this on every call:

```go
type worker struct {
    timer *time.Timer
}
func newWorker() *worker {
    t := time.NewTimer(0)
    if !t.Stop() { <-t.C }
    return &worker{timer: t}
}

func (w *worker) Process(p any) any {
    w.timer.Reset(50 * time.Millisecond)
    defer w.timer.Stop()
    select {
    case <-w.timer.C:
    case <-other:
    }
    return nil
}
```

Reuses the timer. Eliminates per-call allocation.

### Bonus 4 — `sync.Map` for occasional lookups

If your worker reads from a shared map most of the time and writes occasionally, `sync.Map` may outperform `sync.RWMutex` + `map[K]V`.

Profile before deciding.

### Bonus 5 — Avoid reflection in worker hot paths

`reflect` is slow. Pre-compute reflection-based decisions outside the worker.

---

## How to Approach Optimization

For any tunny-based service:

1. **Profile first.** CPU profile, heap profile, block profile. Do not guess.
2. **Measure twice.** Get baseline numbers before optimizing.
3. **Optimize one thing.** Then measure again. Then optimize the next.
4. **Beware micro-optimization.** A 5% speedup on hot code matters; a 5% speedup on cold code does not.
5. **Validate at scale.** Some optimizations help at high load, others at low load.

Optimization is empirical. Trust measurements over intuition.

---

## What Not to Optimize

- The library itself. Tunny's source is small and well-tested. Wrapping it is fine; rewriting it for "performance" is rarely worth it.
- Code paths that run less than 1% of the time.
- Allocations smaller than 100 bytes that happen less than 1k times per second.
- Anything you have not measured.

The best optimization is removing unnecessary work, not making necessary work faster.

---

## Closing

Optimization with tunny is mostly application-level: hoist allocations, size pools right, batch where possible, cache where appropriate. Tunny itself is fast enough.

If you do all the things in this file and still need more throughput, you may need:

- Horizontal scaling (more pods).
- A different algorithm.
- A different library (e.g. ants for fan-out, or a custom hand-rolled pool).

But: 99% of the time, the bottleneck is in your code, not in tunny.

End of optimization scenarios.

---

## Final Cheatsheet for Optimization

```
Pool size:       NumCPU for CPU-bound; downstream limit for IO-bound
Allocations:     Per-worker buffers > per-call allocs
Batching:        For nanosecond work, batch hundreds to thousands per call
Caching:         For repeating inputs with idempotent work
Hedging:         For tail latency on idempotent reads
GC:              Tune GOGC and GOMEMLIMIT
Payload size:    Pass big structs by pointer
Logging:         Avoid in hot paths
Timers:          Reuse via Reset, not create-per-call
```

Print this. Refer to it.

End.
