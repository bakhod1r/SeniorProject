---
layout: default
title: Fan-In Fan-Out Within — Optimize
parent: Fan-In Fan-Out Within
grand_parent: Pipeline Production Patterns
ancestor: Go
nav_order: 10
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/19-pipeline-production-patterns/05-fan-in-fan-out-within/optimize/
---

# Fan-In / Fan-Out Inside a Pipeline — Optimize

Optimization exercises. Each task presents a working but suboptimal implementation. Identify the bottleneck, propose an optimization, implement, and measure. The goal is not to memorize fixes but to practice the optimization workflow: profile, hypothesize, test, validate.

---

## Optimization Workflow Reminder

1. Reproduce the slow case.
2. Benchmark to establish baseline.
3. Profile (CPU, memory, block, mutex).
4. Hypothesize the bottleneck.
5. Implement one fix.
6. Re-benchmark.
7. Decide: keep, revert, or try another fix.

Never skip step 2 or 6. "I think it's faster" is not enough.

---

## Optimization 1: Hot reflect.Select

```go
func dynMerge(ctx context.Context, cs []<-chan int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        cases := make([]reflect.SelectCase, len(cs)+1)
        for i, c := range cs {
            cases[i] = reflect.SelectCase{
                Dir:  reflect.SelectRecv,
                Chan: reflect.ValueOf(c),
            }
        }
        cases[len(cs)] = reflect.SelectCase{
            Dir:  reflect.SelectRecv,
            Chan: reflect.ValueOf(ctx.Done()),
        }
        for {
            chosen, recv, ok := reflect.Select(cases)
            if chosen == len(cs) || !ok {
                return
            }
            out <- int(recv.Int())
        }
    }()
    return out
}
```

**Profile:** 60% of CPU in `reflect.Select` and `runtime.mallocgc`.

**Optimization:** Replace `reflect.Select` with a cascaded static merge if the channel set is fixed at build time. If genuinely dynamic, build the cases once and reuse rather than rebuilding each iteration (though most code already does this).

**Implementation (cascaded static):**

```go
func hMerge(ctx context.Context, cs []<-chan int) <-chan int {
    const g = 8
    for len(cs) > g {
        var next []<-chan int
        for i := 0; i < len(cs); i += g {
            end := i + g
            if end > len(cs) {
                end = len(cs)
            }
            next = append(next, merge(ctx, cs[i:end]...))
        }
        cs = next
    }
    return merge(ctx, cs...)
}
```

**Expected:** 10x faster for 64 inputs.

---

## Optimization 2: Allocations in hot path

```go
func worker(in <-chan []byte) <-chan string {
    out := make(chan string)
    go func() {
        defer close(out)
        for buf := range in {
            decoded := string(buf) // allocation
            out <- decoded
        }
    }()
    return out
}
```

**Profile:** High `runtime.mallocgc` and frequent GC.

**Optimization:** Use `sync.Pool` for buffers, but here the issue is `string(buf)` always allocates. Strings are immutable, so the conversion always copies.

If you control the caller, pass strings directly. If you must convert, batch.

**Implementation:**

```go
// If caller can send strings directly, change signature.
// Otherwise, this is inherent.
```

Some optimizations require redesigning upstream.

---

## Optimization 3: Lock contention on shared counter

```go
type stats struct {
    mu      sync.Mutex
    counter int64
}

func (s *stats) Inc() {
    s.mu.Lock()
    s.counter++
    s.mu.Unlock()
}
```

**Profile:** High mutex contention; counter is the bottleneck.

**Optimization:** Use `atomic.AddInt64`.

**Implementation:**

```go
type stats struct {
    counter atomic.Int64
}

func (s *stats) Inc() {
    s.counter.Add(1)
}
```

**Expected:** 10-100x faster, no contention.

---

## Optimization 4: False sharing

```go
type counters struct {
    counts [16]int64
}

func (c *counters) Inc(shard int) {
    atomic.AddInt64(&c.counts[shard], 1)
}
```

**Profile:** Counter increments are slow despite using atomics. Cache invalidation between cores.

**Optimization:** Pad counters to cache lines.

**Implementation:**

```go
type paddedCounter struct {
    _   [56]byte
    val int64
}

type counters struct {
    counts [16]paddedCounter
}

func (c *counters) Inc(shard int) {
    atomic.AddInt64(&c.counts[shard].val, 1)
}
```

**Expected:** Significant speedup at high contention; potentially 5-10x.

---

## Optimization 5: Goroutine creation in hot path

```go
func process(items []Item) []Result {
    var wg sync.WaitGroup
    results := make([]Result, len(items))
    for i, item := range items {
        i, item := i, item
        wg.Add(1)
        go func() {
            defer wg.Done()
            results[i] = doWork(item)
        }()
    }
    wg.Wait()
    return results
}
```

**Profile:** Spending significant time in `runtime.newproc1` (goroutine creation).

**Optimization:** Use a worker pool instead of one goroutine per item.

**Implementation:**

```go
func process(items []Item) []Result {
    workers := runtime.NumCPU()
    jobs := make(chan int, len(items))
    results := make([]Result, len(items))
    var wg sync.WaitGroup
    wg.Add(workers)
    for w := 0; w < workers; w++ {
        go func() {
            defer wg.Done()
            for i := range jobs {
                results[i] = doWork(items[i])
            }
        }()
    }
    for i := range items {
        jobs <- i
    }
    close(jobs)
    wg.Wait()
    return results
}
```

**Expected:** 2-5x faster for many small items.

---

## Optimization 6: Channel ops dominate small-work pipeline

```go
func pipeline(in <-chan int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for v := range in {
            out <- v * 2 // trivial work
        }
    }()
    return out
}
```

**Profile:** 90% of CPU in `runtime.chansend` and `runtime.chanrecv`.

**Optimization:** Batch the items.

**Implementation:**

```go
func pipelineBatched(in <-chan []int) <-chan []int {
    out := make(chan []int)
    go func() {
        defer close(out)
        for batch := range in {
            doubled := make([]int, len(batch))
            for i, v := range batch {
                doubled[i] = v * 2
            }
            out <- doubled
        }
    }()
    return out
}
```

Channel ops drop by `batchSize`x. Per-item channel cost becomes negligible.

**Expected:** 10-100x throughput improvement, depending on batch size.

---

## Optimization 7: Buffered channel of inappropriate size

```go
out := make(chan int, 10000)
```

The producer fills the buffer; the consumer is slow; the buffer holds 10K items most of the time. Memory grows.

**Optimization:** Reduce buffer to the size that smooths producer bursts (typically 1-N where N is the worker count). Let backpressure throttle the producer.

**Implementation:**

```go
out := make(chan int, 8) // matched to worker count
```

**Expected:** Memory drops; producer slows to match consumer; total throughput may slightly improve due to better cache locality.

---

## Optimization 8: Pre-allocate slices

```go
func collect(in <-chan int) []int {
    var out []int
    for v := range in {
        out = append(out, v)
    }
    return out
}
```

**Profile:** Frequent slice growth; allocations every doubling.

**Optimization:** If you know the expected size, pre-allocate:

```go
func collect(in <-chan int, expected int) []int {
    out := make([]int, 0, expected)
    for v := range in {
        out = append(out, v)
    }
    return out
}
```

**Expected:** 2-5x faster collection.

---

## Optimization 9: Map growth

```go
func aggregate(in <-chan event) map[string]int {
    m := map[string]int{}
    for e := range in {
        m[e.Key]++
    }
    return m
}
```

**Profile:** Map grows; rehashing causes pauses.

**Optimization:** Pre-size:

```go
func aggregate(in <-chan event, expected int) map[string]int {
    m := make(map[string]int, expected)
    for e := range in {
        m[e.Key]++
    }
    return m
}
```

**Expected:** Reduced pauses; smoother latency.

---

## Optimization 10: Per-stage GC pressure

```go
func transform(in <-chan input) <-chan output {
    out := make(chan output)
    go func() {
        defer close(out)
        for v := range in {
            buf := make([]byte, 4096) // alloc per item
            // use buf
            out <- output{Data: buf}
        }
    }()
    return out
}
```

**Profile:** High allocation rate; GC dominates.

**Optimization:** `sync.Pool` for buffer reuse.

**Implementation:**

```go
var bufPool = sync.Pool{New: func() any { return make([]byte, 4096) }}

func transform(in <-chan input) <-chan output {
    out := make(chan output)
    go func() {
        defer close(out)
        for v := range in {
            buf := bufPool.Get().([]byte)
            // use buf
            // copy data to a smaller slice for output, return buf to pool
            result := make([]byte, n)
            copy(result, buf[:n])
            bufPool.Put(buf)
            out <- output{Data: result}
        }
    }()
    return out
}
```

**Expected:** GC pressure drops dramatically; throughput rises.

---

## Optimization 11: Interface dispatch in hot loop

```go
type Processor interface {
    Process(v int) int
}

func pool(in <-chan int, p Processor) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for v := range in {
            out <- p.Process(v) // interface call
        }
    }()
    return out
}
```

**Profile:** Interface dispatch is ~5-10 ns overhead per call. For tight loops, noticeable.

**Optimization:** Use generics if you have a concrete type at compile time.

**Implementation:**

```go
func pool[T any](in <-chan T, fn func(T) T) <-chan T {
    out := make(chan T)
    go func() {
        defer close(out)
        for v := range in {
            out <- fn(v) // direct call, inlinable
        }
    }()
    return out
}
```

**Expected:** Small but real improvement; inlining gives more.

---

## Optimization 12: Pipeline with reordering buffer that grows

```go
func reorder(in <-chan tagged) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        next := 0
        pending := map[int]int{}
        for t := range in {
            pending[t.seq] = t.val
            for {
                v, ok := pending[next]
                if !ok {
                    break
                }
                out <- v
                delete(pending, next)
                next++
            }
        }
    }()
    return out
}
```

**Profile:** Map grows to hundreds of thousands of entries. Memory pressure.

**Optimization:** If straggler distance is bounded, cap the map. If unbounded, use heap (more memory-efficient for sparse keys) or apply backpressure when the map exceeds a threshold.

**Implementation:**

```go
const maxPending = 10000

for t := range in {
    if len(pending) >= maxPending {
        // backpressure: do not read more until drained
        // OR: log warning, accept overflow
    }
    pending[t.seq] = t.val
    // ...
}
```

---

## Optimization 13: Stage with too much work

```go
func bigStage(in <-chan input) <-chan output {
    out := make(chan output)
    go func() {
        defer close(out)
        for v := range in {
            // step 1: decode (CPU-bound, 1 ms)
            x := decode(v)
            // step 2: enrich (I/O-bound, 100 ms)
            y := enrich(x)
            // step 3: transform (CPU-bound, 1 ms)
            z := transform(y)
            out <- z
        }
    }()
    return out
}
```

**Profile:** Single goroutine; CPU is idle during the 100 ms enrich.

**Optimization:** Split into stages with separate fan-out factors. CPU-bound stages use fewer workers; I/O-bound stages use more.

**Implementation:**

```go
decoded := pool(in, runtime.NumCPU(), decode)
enriched := pool(decoded, 100, enrich) // I/O-bound
transformed := pool(enriched, runtime.NumCPU(), transform)
```

**Expected:** Significant throughput improvement by matching parallelism to each stage's needs.

---

## Optimization 14: Channel close ping-pong

```go
for {
    select {
    case v, ok := <-in:
        if !ok {
            return
        }
        process(v)
    case <-ctx.Done():
        return
    }
}
```

(This is fine.) But:

```go
for v := range in {
    select {
    case <-ctx.Done():
        return
    default:
    }
    process(v)
}
```

**Bug masquerading as optimization:** The `default` in select makes the cancellation check non-blocking. But if `in` blocks the goroutine in `range`, cancellation is not seen until a value arrives. Performance is same; correctness is worse.

The first form is correct: select on both `<-in` and `<-ctx.Done()`.

---

## Optimization 15: HTTP fan-out without connection reuse

```go
for _, url := range urls {
    go func(u string) {
        resp, _ := http.Get(u) // creates new transport per call
        // ...
    }(url)
}
```

**Profile:** Slow due to TLS handshakes and connection setup.

**Optimization:** Share a `http.Client` with a tuned `Transport`.

**Implementation:**

```go
client := &http.Client{
    Transport: &http.Transport{
        MaxIdleConnsPerHost: 100,
        MaxConnsPerHost:     200,
    },
    Timeout: 5 * time.Second,
}

for _, url := range urls {
    go func(u string) {
        req, _ := http.NewRequestWithContext(ctx, "GET", u, nil)
        resp, _ := client.Do(req)
        // ...
    }(url)
}
```

**Expected:** 10x faster for repeated requests to same host.

---

## Optimization 16: Unbounded goroutine spawn

```go
for req := range incomingRequests {
    go handle(req) // unbounded
}
```

**Failure:** Under load spike, spawns thousands of goroutines.

**Optimization:** Bounded worker pool.

**Implementation:**

```go
const workers = 100
g, ctx := errgroup.WithContext(ctx)
g.SetLimit(workers)
for req := range incomingRequests {
    req := req
    g.Go(func() error {
        return handle(ctx, req)
    })
}
return g.Wait()
```

**Expected:** Bounded memory; better latency under spikes.

---

## Optimization 17: Excessive logging

```go
for v := range in {
    log.Printf("processing item %v", v) // every item
    process(v)
}
```

**Profile:** `log.Printf` is significant; lock on log output causes contention across workers.

**Optimization:** Sample. Buffer. Use structured logging with async writes.

**Implementation:**

```go
import "go.uber.org/zap"

logger := zap.NewProduction()
defer logger.Sync()

for v := range in {
    if rand.Float64() < 0.01 {
        logger.Info("processing", zap.Any("item", v))
    }
    process(v)
}
```

**Expected:** Drastic CPU reduction; log volume drops 100x.

---

## Optimization 18: GC pauses from large heap

```go
// pipeline accumulates state in a 10 GB map
```

**Profile:** GC pauses 50-200 ms; latency spikes.

**Optimization:** Shrink heap; tune `GOGC` and `GOMEMLIMIT`.

**Implementation:**

- Periodic eviction of old entries.
- Set `GOMEMLIMIT=4GB`.
- Tune `GOGC=50` for more aggressive GC at smaller heap.

**Expected:** Pauses drop to 5-20 ms; latency stabilises.

---

## Optimization 19: Hot path with defer

```go
for v := range in {
    func() {
        defer cleanup()
        process(v)
    }()
}
```

**Profile:** `defer` overhead in hot loop.

**Optimization:** Explicit cleanup.

**Implementation:**

```go
for v := range in {
    process(v)
    cleanup()
}
```

Trade: panic safety. If `process` can panic and you need cleanup to run, keep defer.

---

## Optimization 20: Auto-scaling oscillation

A pool that scales up when latency exceeds threshold, scales down when below. Observed: oscillates every 30 seconds between min and max.

**Optimization:** Add hysteresis. Scale up at 80% load; scale down at 30% load. Wait longer between adjustments.

**Implementation:**

```go
type scaler struct {
    target atomic.Int64
    last time.Time
}

func (s *scaler) maybeAdjust(load float64) {
    if time.Since(s.last) < time.Minute {
        return
    }
    if load > 0.8 {
        s.target.Add(1)
    } else if load < 0.3 {
        s.target.Add(-1)
    }
    s.last = time.Now()
}
```

**Expected:** Stable worker count; no oscillation.

---

## Performance Tuning Methodology

For every optimization:

1. **Measure.** Benchmark or profile in production.
2. **Hypothesize.** "I think the bottleneck is X."
3. **Test.** Apply the fix.
4. **Re-measure.** Was the hypothesis correct?
5. **Keep or revert.** Based on data.
6. **Document.** Why this fix was needed; what trade-offs.

Avoid:

- Optimizing without measurement.
- Multiple changes at once.
- Trusting intuition over data.
- Ignoring trade-offs.

---

## Optimization Checklist

When you see a slow pipeline:

- [ ] CPU profile collected and analyzed.
- [ ] Heap profile collected and analyzed.
- [ ] Block profile collected and analyzed.
- [ ] Mutex profile collected and analyzed.
- [ ] Goroutine profile collected (looking for leaks).
- [ ] Trace collected and analyzed.
- [ ] Hypothesis formed from profiles.
- [ ] Single change applied.
- [ ] Re-measured and compared.

---

## Common Optimization Patterns

| Pattern | When to apply |
|---------|---------------|
| Cascaded static merge | High-fan-in pipeline with reflect.Select |
| sync.Pool | Hot path with per-item allocations |
| Batching | Channel ops dominate small-work pipeline |
| Pre-allocation | Slice or map growth in hot loop |
| Atomic over mutex | Hot counters |
| Padding for cache lines | False sharing |
| Bounded worker pool | Unbounded goroutine spawn |
| Increased fan-out | I/O-bound bottleneck |
| Decreased fan-out | Lock contention |
| `errgroup.SetLimit` | Bounded concurrency |
| HTTP transport tuning | Repeated requests |
| Connection pooling | Database access |

Memorise these. They cover ~80% of pipeline optimizations.

---

## Wrap-Up

Optimization is empirical. The patterns are guides, not rules. Measure, hypothesize, test, validate. Repeat.

A pipeline that is correct, observable, and fast is a craft, not a recipe. Optimization is the iterative part of the craft.

Good engineering looks like this: simple code, careful measurement, principled changes, documented decisions.

Practice these patterns on real code. Profile your own pipelines. The intuition that comes from a hundred profiles is what separates the engineers who can fix anything from those who can only build.
