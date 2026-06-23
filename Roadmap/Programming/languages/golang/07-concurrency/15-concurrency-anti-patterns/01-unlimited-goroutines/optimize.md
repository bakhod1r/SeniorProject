---
layout: default
title: Optimize
parent: Unlimited Goroutines
grand_parent: Concurrency Anti-Patterns
ancestor: Go
nav_order: 9
permalink: /roadmap/programming-languages/golang/07-concurrency/15-concurrency-anti-patterns/01-unlimited-goroutines/optimize/
---

# Unlimited Goroutines — Optimization

> Each scenario shows naive code → bounded version → benchmark results. Includes `go test -bench` invocations, pprof flamegraph interpretation, and before/after metrics. Numbers are realistic but illustrative — measure in your own environment.

---

## Optimization 1 — Replace unbounded fan-out with errgroup.SetLimit

**Naive:**

```go
func ProcessAll(items []Item) {
    var wg sync.WaitGroup
    for _, item := range items {
        wg.Add(1)
        go func(item Item) {
            defer wg.Done()
            process(item)
        }(item)
    }
    wg.Wait()
}
```

**Bounded:**

```go
func ProcessAll(ctx context.Context, items []Item) error {
    g, gctx := errgroup.WithContext(ctx)
    g.SetLimit(32)
    for _, item := range items {
        item := item
        g.Go(func() error { return process(gctx, item) })
    }
    return g.Wait()
}
```

**Benchmark:**

```go
func BenchmarkProcessAll(b *testing.B) {
    items := makeItems(10_000)
    b.Run("unbounded", func(b *testing.B) {
        for i := 0; i < b.N; i++ {
            ProcessAllUnbounded(items)
        }
    })
    b.Run("bounded", func(b *testing.B) {
        for i := 0; i < b.N; i++ {
            ProcessAllBounded(context.Background(), items)
        }
    })
}
```

Run: `go test -bench BenchmarkProcessAll -benchtime=5s -benchmem`.

**Results (illustrative):**

```
unbounded:  500 µs/op    20000 B/op   1000 allocs/op
bounded:    700 µs/op    8000 B/op    1010 allocs/op
```

The bounded version is slightly slower per operation but uses 60% less memory. Under sustained load (millions of items), the unbounded version OOMs; bounded does not.

**Metrics improvement:**
- Peak memory: 5 GB → 200 MB.
- Goroutine peak: 10 000 → 35.
- p99 latency under load: 8s (with GC pauses) → 200ms.

**Flamegraph reading.** In the unbounded version, the flamegraph shows substantial time in `runtime.findRunnable` and `runtime.scanobject` (GC stack scan). In the bounded version, these are negligible.

---

## Optimization 2 — Worker pool reuse vs per-call goroutines

**Naive:** Spawn fresh goroutines for each call.

```go
func PerCall(items []Item) {
    g, _ := errgroup.WithContext(context.Background())
    g.SetLimit(8)
    for _, item := range items {
        item := item
        g.Go(func() error { process(item); return nil })
    }
    g.Wait()
}
```

**Pool-based:** Reuse a fixed pool across calls.

```go
type Pool struct { jobs chan Item; done chan struct{} }

func NewPool(workers int) *Pool {
    p := &Pool{jobs: make(chan Item), done: make(chan struct{})}
    for i := 0; i < workers; i++ {
        go func() {
            for j := range p.jobs {
                process(j)
            }
        }()
    }
    return p
}

func (p *Pool) Run(items []Item) {
    var wg sync.WaitGroup
    for _, it := range items {
        wg.Add(1)
        go func(it Item) {
            defer wg.Done()
            p.jobs <- it
        }(it)
    }
    wg.Wait()
}
```

Wait, that has a bug — the `go func(it Item)` is still unbounded. Better:

```go
func (p *Pool) Run(items []Item) {
    for _, it := range items {
        p.jobs <- it // blocks if workers busy
    }
}
```

The send blocks until a worker picks it up; bounded by worker count.

**Benchmark:**

```
per-call:  fresh goroutines, ~200ns spawn cost each.
pool:      reused goroutines, ~50ns dispatch via channel.
```

At low fan-out, per-call is fine. At high throughput (millions of items/s), the pool's amortised cost is much lower.

**Metrics improvement:**
- Allocation rate: 1 GB/s → 100 MB/s.
- GC frequency: every 100ms → every 1s.
- p99 latency: dominated by GC pauses in per-call; flat with pool.

---

## Optimization 3 — Buffered channel sizing

**Naive:** Unbuffered channel between producer and consumer.

```go
ch := make(chan Item)
go producer(ch)
consumer(ch)
```

**Optimised:** Buffered channel sized to absorb bursts.

```go
ch := make(chan Item, 256)
go producer(ch)
consumer(ch)
```

**Benchmark:**

```
unbuffered:  every send waits for receive; throughput = min(producer, consumer)
buffered:    producer can fill the buffer before blocking; smoother flow
```

**Results.** For producer-consumer with similar rates, both work. For variable-rate producer or consumer (jitter), the buffer absorbs the variance.

**Metrics improvement:**
- p99 producer latency: 10ms → 100µs (no waiting for consumer).
- Throughput variance: high → low.

**Caveat.** Too-large buffers hide backpressure. If consumer slows, a large buffer fills, eventually overflowing. Size to absorb realistic bursts but not pathological ones.

---

## Optimization 4 — Reducing allocation in worker goroutines

**Naive:** Each goroutine allocates fresh buffers.

```go
func worker(jobs <-chan Job) {
    for j := range jobs {
        buf := make([]byte, 64*1024) // fresh allocation
        // ... use buf ...
    }
}
```

**Optimised:** Pool of buffers.

```go
var bufPool = sync.Pool{New: func() any { b := make([]byte, 64*1024); return &b }}

func worker(jobs <-chan Job) {
    for j := range jobs {
        bp := bufPool.Get().(*[]byte)
        // ... use *bp ...
        bufPool.Put(bp)
    }
}
```

**Benchmark:**

```
per-job alloc:  20 KB/op, 1 alloc/op
pooled:         8 B/op, 0 allocs/op (after warm-up)
```

GC pressure dramatically reduced.

**Metrics improvement:**
- Allocation rate: 1 GB/s → 1 MB/s.
- GC frequency: every 100ms → every 5s.
- p99 latency: 50ms → 5ms.

**Flamegraph.** Before: substantial time in `runtime.mallocgc`. After: negligible.

---

## Optimization 5 — Right-sizing the bound

**Naive:** Bound set arbitrarily.

```go
g.SetLimit(100)
```

**Optimised:** Bound derived from measurement.

```go
// Discovered via load test on 2026-04-01:
// Bottleneck is downstream API at 50 RPS.
// Each call avg 200ms. In-flight = 50 × 0.2 = 10.
g.SetLimit(10)
```

**Benchmark:** Run the bounded function at each candidate limit (1, 4, 8, 16, 32, 64, 128).

```
limit=1   throughput=5 RPS   p99=200ms
limit=4   throughput=20 RPS  p99=200ms
limit=8   throughput=40 RPS  p99=210ms
limit=10  throughput=50 RPS  p99=220ms
limit=16  throughput=50 RPS  p99=350ms  (queued at downstream)
limit=32  throughput=50 RPS  p99=600ms
limit=64  throughput=50 RPS  p99=1200ms
```

Optimum at limit=10. Beyond, throughput is capped by downstream while latency climbs linearly with queue depth.

**Metrics improvement:**
- p99 latency: 600ms → 220ms (just by lowering limit from 32 to 10).
- Throughput: unchanged (downstream-bound).
- 503 rate from downstream: 5% → 0%.

The lesson: more concurrency past the bottleneck just queues, doesn't help.

---

## Optimization 6 — Replacing log.Printf with batched logger

**Naive:** Every goroutine logs synchronously.

```go
for _, item := range items {
    go func(item Item) {
        log.Printf("processing %s", item.ID)
        process(item)
    }(item)
}
```

**Optimised:** Asynchronous logger.

```go
import "go.uber.org/zap"

logger, _ := zap.NewProduction() // batches writes

for _, item := range items {
    go func(item Item) {
        logger.Info("processing", zap.String("id", item.ID))
        process(item)
    }(item)
}
```

`log.Printf` serialises through a mutex; under high concurrency, this is a bottleneck. `zap` (with a WriteSyncer that batches) is non-blocking.

**Benchmark:**

```
log.Printf:  150k logs/s peak; goroutines block on mutex
zap:         2M logs/s; goroutines proceed immediately
```

For a goroutine that does 1ms of work plus 1 log call:
- log.Printf bound: throughput = mutex acquisition rate ≈ 150k/s.
- zap bound: throughput = work rate.

**Metrics improvement:**
- Time spent in log calls: 30% → 1%.
- Throughput: 5x improvement on logging-heavy paths.
- p99 latency: dominated by log mutex; flat after switch.

---

## Optimization 7 — Reducing context allocations

**Naive:** Create a new context per goroutine.

```go
for _, item := range items {
    ctx, cancel := context.WithTimeout(parent, 5*time.Second)
    g.Go(func() error {
        defer cancel()
        return process(ctx, item)
    })
}
```

**Optimised:** Reuse the parent context where possible.

```go
for _, item := range items {
    g.Go(func() error {
        // Inherit timeout from parent (set once at top)
        return process(parent, item)
    })
}
```

Or: set the timeout at the parent level once:

```go
parent, cancel := context.WithTimeout(context.Background(), totalTimeout)
defer cancel()
// ... use parent for all goroutines
```

**Benchmark:**

```
per-goroutine context:  +200ns/op, +200 B/op alloc
shared context:         baseline
```

For 100 000 goroutines, the per-goroutine context cost = 20ms allocation time, 20 MB heap allocation.

**Metrics improvement:**
- Allocation rate: 50 MB/s → 30 MB/s on context-heavy paths.
- p99 latency: marginal but measurable.

**Caveat.** Per-goroutine context with individual timeout is sometimes correct (per-RPC deadline). Don't optimise prematurely.

---

## Optimization 8 — Specialising errgroup vs sync.WaitGroup

**Naive:** Always use errgroup.

```go
g, _ := errgroup.WithContext(ctx)
g.SetLimit(32)
for _, item := range items {
    g.Go(func() error {
        someInfallibleFunction(item)
        return nil
    })
}
g.Wait()
```

**Optimised:** When errors are impossible, use a WaitGroup + semaphore.

```go
sem := make(chan struct{}, 32)
var wg sync.WaitGroup
for _, item := range items {
    sem <- struct{}{}
    wg.Add(1)
    go func(item Item) {
        defer wg.Done()
        defer func() { <-sem }()
        someInfallibleFunction(item)
    }(item)
}
wg.Wait()
```

**Benchmark:**

```
errgroup:  ~5% overhead from sync.Once, error tracking, ctx.
plain:     baseline.
```

For 1 million calls, the saving is small (~50ms wall time). For most code, the errgroup ergonomics outweigh the cost.

**When to specialise.** Tight inner loops where every microsecond counts. Otherwise, prefer errgroup.

**Metrics improvement:** marginal in most cases; meaningful only in extreme-throughput paths.

---

## Optimization 9 — Replacing per-request goroutines with batching

**Naive:** Fan out per-request.

```go
func Handler(w http.ResponseWriter, r *http.Request) {
    keys := parseKeys(r)
    g, gctx := errgroup.WithContext(r.Context())
    g.SetLimit(8)
    results := make(map[string]Value)
    var mu sync.Mutex
    for _, k := range keys {
        k := k
        g.Go(func() error {
            v, err := backend.Get(gctx, k)
            if err != nil { return err }
            mu.Lock(); results[k] = v; mu.Unlock()
            return nil
        })
    }
    _ = g.Wait()
    json.NewEncoder(w).Encode(results)
}
```

**Optimised:** Batch keys, single backend call.

```go
func Handler(w http.ResponseWriter, r *http.Request) {
    keys := parseKeys(r)
    results, _ := backend.GetBatch(r.Context(), keys) // one call, server-side parallelism
    json.NewEncoder(w).Encode(results)
}
```

**Benchmark:**

```
per-key fan-out:  100 keys × 5ms = 500ms total (8 in parallel, ~63ms)
single batch:     1 call × 50ms = 50ms (server batches internally)
```

The batch version is 1.3x faster wall time and has no client-side concurrency overhead.

**Metrics improvement:**
- Per-request goroutines: 8 → 0.
- Per-request allocations: 100 → 10.
- p99 latency: 80ms → 60ms.

**Caveat.** Requires backend support for batching. If not available, this optimisation is unavailable.

---

## Optimization 10 — Using `singleflight` for duplicate requests

**Naive:** Cache miss triggers N concurrent fetches.

```go
func (c *Cache) Get(key string) (V, error) {
    if v, ok := c.data.Load(key); ok { return v.(V), nil }
    v, err := fetchExpensive(key)
    if err != nil { return v, err }
    c.data.Store(key, v)
    return v, nil
}
```

If 1000 concurrent calls all miss on the same key, `fetchExpensive` runs 1000 times.

**Optimised:** Dedup with `singleflight`.

```go
import "golang.org/x/sync/singleflight"

type Cache struct {
    data sync.Map
    sf   singleflight.Group
}

func (c *Cache) Get(key string) (V, error) {
    if v, ok := c.data.Load(key); ok { return v.(V), nil }
    v, err, _ := c.sf.Do(key, func() (any, error) {
        if v, ok := c.data.Load(key); ok { return v, nil }
        v, err := fetchExpensive(key)
        if err != nil { return nil, err }
        c.data.Store(key, v)
        return v, nil
    })
    if err != nil { var zero V; return zero, err }
    return v.(V), nil
}
```

**Benchmark.** 1000 concurrent gets on a cold key:

```
naive:       1000 fetches × 200ms each = saturates downstream
singleflight: 1 fetch × 200ms; 999 callers wait for the result
```

The "thundering herd" problem is eliminated.

**Metrics improvement:**
- Downstream RPS during cold cache: 1000 → 1.
- p99 latency for callers: 200ms (all wait for the same call).
- Cache miss amplification: 1000x → 1x.

This is one of the highest-impact optimisations available. Every cache should use singleflight.

---

## Reading pprof flamegraphs

For each optimisation above, a flamegraph review pattern:

### Before (naive)

```
[ runtime.findRunnable ]   30% — scheduler busy
[ runtime.scanobject     ]   25% — GC stack scan
[ runtime.mallocgc       ]   15% — allocations
[ sync.(*Mutex).Lock     ]   10% — contention
[ user code              ]   20% — actual work
```

The runtime dominates; user code is a minority.

### After (bounded + pooled + ...)

```
[ user code              ]   80% — actual work
[ runtime.mallocgc       ]    5%
[ runtime.scanobject     ]    5%
[ runtime.findRunnable   ]    5%
[ other                  ]    5%
```

The runtime is a small overhead; user code dominates. This is what efficiency looks like.

### How to capture

```
go test -bench=. -cpuprofile=cpu.out
go tool pprof -http=:8080 cpu.out
```

Or in production:

```
curl http://localhost:6060/debug/pprof/profile?seconds=30 > cpu.out
go tool pprof -http=:8080 cpu.out
```

The `pprof` web UI lets you drill into the flamegraph. Look for:

- "Hot" blocks (wide bars) — the most time-consuming functions.
- Runtime functions — high runtime % suggests inefficient concurrency.
- Allocation source — high mallocgc indicates a per-call allocation that could be pooled.

---

## Continuous benchmarking

Set up `benchstat` to compare benchmark results between runs:

```bash
go test -bench=. -count=10 > before.txt
# ... make changes ...
go test -bench=. -count=10 > after.txt
benchstat before.txt after.txt
```

Output:

```
name              old time/op  new time/op  delta
ProcessAll-8       500µs ± 5%   200µs ± 3%   -60%
```

The `delta` column tells you the improvement is real (small std deviations, large effect size). Without this, micro-optimisations can be illusory.

---

## Production verification

After deploying an optimisation, verify in production:

1. **Metric: throughput.** RPS handled per pod. Should increase or stay flat.
2. **Metric: latency.** p50, p99. Should decrease.
3. **Metric: memory.** Resident memory. Should decrease.
4. **Metric: CPU.** Pod CPU. Should decrease (or stay flat with higher throughput).
5. **Metric: goroutine count.** Should decrease or stay flat.
6. **Alerts.** No new error spikes.

If all six confirm the expected change, the optimisation is real. If not, investigate (maybe the production environment differs from the benchmark).

---

## When NOT to optimise

Some optimisations are not worth it:

- **Profile says it's < 1% of time.** Don't waste effort on negligible gains.
- **The code is rarely executed.** A 100x improvement on cold path is 0% on average.
- **The optimisation adds complexity.** Pooling, sync.Pool usage, or unsafe tricks have ongoing maintenance cost.

A senior engineer's instinct: measure first, optimise the hot path, leave the rest alone.

---

## Summary table

| Optimisation | Bound primitive | Typical improvement |
|--------------|-----------------|---------------------|
| 1. errgroup.SetLimit | errgroup | Memory: 20x; goroutine: 100x |
| 2. Pool reuse | worker pool | GC: 10x reduction |
| 3. Channel buffering | buffered chan | Throughput variance: smoother |
| 4. Buffer pooling | sync.Pool | Allocations: 1000x reduction |
| 5. Right-sized bound | (measurement) | Latency: 2-5x |
| 6. Async logger | zap | Throughput: 5x on log-heavy paths |
| 7. Shared context | (no allocation) | Allocations: 30% |
| 8. WaitGroup+sem | sync.WaitGroup | Cycles: 5% |
| 9. Batching | server-side | Latency: 1.3x |
| 10. singleflight | singleflight | Downstream load: 1000x reduction |

Apply in this priority order: 1, 5, 10 first (high impact, simple). Then 2, 4, 6 (medium). 3, 7, 8 last (situational).

After applying:
- Profile.
- Benchstat.
- Production validate.
- Document.

Each optimisation is a number you can show to a stakeholder: "we reduced memory peak from 5 GB to 200 MB."

End of Optimize file.
