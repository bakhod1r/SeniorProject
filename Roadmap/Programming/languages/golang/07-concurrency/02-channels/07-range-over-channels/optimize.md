# Range Over Channels — Optimization Exercises

> Each exercise gives you a working but suboptimal program, a target metric, and asks you to improve. Solutions are at the end. The goal is to internalise the cost model of channel `range` and apply it when tuning.

---

## Easy

### Exercise 1 — Eliminate per-iteration receive overhead with batching

**Starting code:**

```go
func sum(ch <-chan int) int {
    s := 0
    for v := range ch {
        s += v
    }
    return s
}
```

The producer sends 10 million `int` values one at a time. Throughput is ~5 M/sec.

**Target.** 50+ M/sec by batching: send `[]int` of length 1000 instead of single ints. Loop body iterates the batch.

**Constraint.** The producer interface may change.

---

### Exercise 2 — Size the buffer to absorb a burst

**Starting code:**

```go
ch := make(chan Event) // unbuffered
go produce(ch)
for e := range ch {
    process(e) // ~10 ms
}
```

Producer emits in bursts of 100 events arriving in 1 ms, then idles for 100 ms. With an unbuffered channel, each burst takes ~1 second to process (each `process` blocks the next produce).

**Target.** Reduce burst-to-completion latency to ~1 second total (consumer keeps up between bursts) but allow the producer to enqueue the entire burst quickly.

---

### Exercise 3 — Replace a `range` with a `select` + `default` for non-blocking drain

**Starting code:**

```go
for v := range ch {
    process(v)
    if shouldStop() { return }
}
```

Each iteration blocks on receive even when the consumer wants to check `shouldStop`. The check happens only after a value arrives.

**Target.** Check `shouldStop` between values without waiting for a value. Use `select` with a `default` to poll, or restructure with `context`.

---

### Exercise 4 — Bound goroutines spawned inside `range`

**Starting code:**

```go
for v := range ch {
    go process(v) // unbounded goroutines
}
```

At 100 K values/sec, this spawns 100 K goroutines/sec, many of which are running simultaneously.

**Target.** Use a worker pool of size `N = GOMAXPROCS` so concurrent processors are bounded.

---

### Exercise 5 — Drop slow-path receives by avoiding cross-core wakes

**Starting code:**

```go
ch := make(chan int)
go producer(ch)
for v := range ch { use(v) }
```

Producer and consumer run on different goroutines that happen to land on different P's. Every value crosses cores; cache misses dominate.

**Target.** Improve throughput by either (a) sharing a P via `runtime.LockOSThread` patterns, or (b) using a larger buffer so values are received in batches when the consumer is woken. Measure both.

---

## Medium

### Exercise 6 — Convert a fine-grained pipeline to a coarse-grained one

**Starting code:**

```go
// 5-stage pipeline, each stage transforms one int at a time
stage1 → stage2 → stage3 → stage4 → stage5
```

Each stage is one goroutine with a channel between them. Each value crosses 5 channels. At 10 M values/sec target, the channel cost (5 × 50 ns = 250 ns per value × 10M) eats 2.5 seconds of CPU per second of real time.

**Target.** Restructure as 1–2 stages, each doing more work per value, or batch values into slices to amortise the channel cost. Aim for 10× throughput improvement.

---

### Exercise 7 — Replace a `select` heartbeat with periodic flush in `range`

**Starting code:**

```go
ticker := time.NewTicker(time.Second)
defer ticker.Stop()
for {
    select {
    case v, ok := <-in:
        if !ok { flush(); return }
        buffer = append(buffer, v)
    case <-ticker.C:
        flush()
    }
}
```

Works correctly, but `select` per iteration is slightly more expensive than `range`. For high-throughput streams, this can matter.

**Target.** When the input is high-volume and consistent, the timer rarely fires. Skip the `select` and use plain `range` + count-based flush; reserve the timer for low-volume edge cases.

```go
for v := range in {
    buffer = append(buffer, v)
    if len(buffer) >= batchSize { flush() }
}
flush() // final
```

Lose the periodic flush; gain throughput. The trade-off must be acceptable for the workload.

---

### Exercise 8 — Reduce allocations in the `range` body

**Starting code:**

```go
for v := range ch {
    line := fmt.Sprintf("event %d", v)
    log.Println(line)
}
```

Each iteration allocates a new string (via `Sprintf`). At 1 M iters/sec, GC pressure dominates.

**Target.** Pre-allocate a `bytes.Buffer`, use `strconv.AppendInt`, or use `log`'s structured logging API to skip the intermediate string. Measure allocations with `go test -benchmem`.

---

### Exercise 9 — Tune buffer size for throughput

**Starting code:**

```go
ch := make(chan int, 1) // capacity 1
```

Producer is fast, consumer's body takes ~1 µs. Throughput is limited by synchronisation.

**Target.** Empirically determine the buffer size that maximises throughput. Try 1, 10, 100, 1000, 10000. Often the sweet spot is around 16-128 (one cache line worth of values × small multiple). Larger buffers stop helping; sometimes hurt due to cache pressure.

---

### Exercise 10 — Avoid the `range` over a "lazy generator" anti-pattern

**Starting code:**

```go
// Producer goroutine just iterates a slice and sends.
func gen(nums []int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for _, n := range nums { out <- n }
    }()
    return out
}

for v := range gen(largeSlice) {
    use(v)
}
```

This spawns a goroutine and pays channel cost just to iterate a slice. For pure iteration with no concurrency benefit, this is pure overhead.

**Target.** Skip the channel. If the consumer is in the same goroutine as `gen` would be, iterate the slice directly. In Go 1.23+, use a func iterator for the same shape without the goroutine.

---

### Exercise 11 — Replace channel with `sync.Pool` for object reuse

**Starting code:**

```go
// Per-iteration allocation:
type Buffer struct{ data [4096]byte }
for v := range ch {
    buf := &Buffer{}
    fill(buf, v)
    write(buf)
}
```

Each iteration allocates 4 KB. GC pressure becomes a hotspot.

**Target.** Use `sync.Pool` to reuse `*Buffer` across iterations. Measure: `alloc_objects` should drop dramatically; GC time should shrink.

---

### Exercise 12 — Fan-out to scale consumer throughput

**Starting code:**

```go
for v := range jobs {
    process(v) // takes 1 ms; receive blocks the next 1ms
}
```

Single consumer processes 1 K jobs/sec. With many cores idle.

**Target.** Spawn N consumers, all `range`ing the same channel. Throughput scales linearly with N up to the core count. Measure for N = 1, 2, 4, 8, 16.

---

## Hard

### Exercise 13 — Replace channel pipeline with a worker-stealing queue

**Starting code:** A 6-stage pipeline at 100 K values/sec. Profile shows 60% of CPU time inside `runtime.chanrecv`.

**Target.** Replace the channel-based architecture with a single shared work queue plus N workers that each pop work and execute the full pipeline in-thread. Throughput should improve significantly (channels are eliminated from the hot path).

Hint: this is fundamentally a different architecture. The pipeline shape (read transform → write) becomes a function call instead of a channel send. Channels return only at the I/O boundaries.

---

### Exercise 14 — Use generics to avoid interface boxing in `range`

**Starting code:**

```go
ch := make(chan interface{})
for v := range ch {
    n := v.(int)
    sum += n
}
```

Each value goes through an interface conversion (boxing on send, unboxing on receive). For primitive types, this is significant overhead.

**Target.** Convert to a generic version:

```go
func Sum[T Numeric](ch <-chan T) T {
    var s T
    for v := range ch { s += v }
    return s
}
```

Measure: throughput should improve significantly because the channel element is now the concrete type, no interface header, no heap allocations.

---

### Exercise 15 — Replace busy-wait `range` with `select` + context

**Starting code:**

```go
for v := range ch {
    if v.IsHeartbeat() { continue }
    process(v)
}
```

Heartbeats arrive every 100 ms; real events at 10 K/sec. The consumer iterates many heartbeats just to `continue`. Plus, there is no cancellation path.

**Target.** Filter heartbeats at the producer (let the consumer assume every value is real); add `select` with `ctx.Done()` for cancellation. Producer respects the context.

---

### Exercise 16 — Tune GOMAXPROCS and producer count together

**Starting code:** A pipeline with `M` producer goroutines and `N` consumer goroutines, all on `GOMAXPROCS = number-of-CPUs`. Throughput plateaus far below expected.

**Target.** Sweep `M` from 1 to NumCPU × 2 and `N` from 1 to NumCPU × 2. Find the throughput maximum. Often the answer is `M = N = NumCPU / 2`, but it depends on per-value work. Document your findings.

---

### Exercise 17 — Reduce sudog allocation in steady state

**Starting code:** A consumer that parks on every value (producer is slower than consumer). Profile shows allocation of `sudog` structs (the runtime's "parked goroutine" record) in the GC heap.

**Target.** Most `sudog` allocations are pooled per-P. If you see escape to the heap, it usually means heavy contention. Use a buffered channel to avoid parking in steady state. Confirm via `runtime.MemProfileRate = 1` and a `pprof heap` after a load test.

---

### Exercise 18 — Implement a lossy `range` (drop on slow consumer)

**Starting code:**

```go
for v := range events {
    process(v)
}
```

If processing is slower than production, the producer eventually blocks (good for backpressure, bad for real-time systems that prefer to drop).

**Target.** Build a producer that uses non-blocking send:

```go
select {
case ch <- v:
default:
    drops.Inc()
}
```

Consumer is unchanged (plain `range`). Measure: latency stays bounded; throughput is consumer-limited; older events are dropped under overload.

---

### Exercise 19 — Migrate channel range to Go 1.23 iterator for hot iteration

**Starting code:** A library exposes a stream as `<-chan T`. Callers iterate with `for v := range ch`. Profiling shows the receive cost is significant per call.

**Target.** Provide an `iter.Seq[T]` alternative. Callers that iterate in the same goroutine pay ~5 ns per value (function call) instead of ~50 ns (channel receive). Channel API stays for callers that need concurrency.

```go
// Old:
func (s *Stream) Channel() <-chan Item { ... }
// New:
func (s *Stream) Iter() iter.Seq[Item] { ... }
```

---

### Exercise 20 — Profile-guided pipeline tuning

**Starting code:** A 12-stage pipeline at 50 K values/sec. Goal: 200 K values/sec.

**Target.** Use the full toolbox:

1. `go test -bench` to baseline.
2. `go tool pprof` CPU profile to find hot stages.
3. `go tool trace` to see scheduler behaviour.
4. Apply: batching, buffer sizing, stage consolidation, worker pools, allocation reduction.
5. Iterate.

Document each change's impact. Stop when target is reached or the marginal improvement is below 5%.

---

## Solutions

### Solution 1 — Batching

```go
func sum(ch <-chan []int) int {
    s := 0
    for batch := range ch {
        for _, v := range batch { s += v }
    }
    return s
}
```

Producer accumulates 1000 ints into a slice, then sends. Throughput improves from ~5 M/sec to ~100 M/sec because the per-value channel cost is amortised by 1000.

---

### Solution 2 — Burst-sized buffer

```go
ch := make(chan Event, 200) // 2× burst size
```

The producer can dump the burst into the buffer without blocking. The consumer processes at its pace; total burst latency ~ 100 × 10 ms = 1 second (consumer-bound, not channel-bound).

---

### Solution 3 — `select` with default

```go
for {
    select {
    case v, ok := <-ch:
        if !ok { return }
        process(v)
    case <-ctx.Done(): return
    }
}
```

Use context to signal stop; producer respects context too. Avoid `select` with `default` busy-loop unless you really need non-blocking checks (rare).

---

### Solution 4 — Worker pool

```go
const N = 8
jobs := make(chan T, 64)
var wg sync.WaitGroup
for i := 0; i < N; i++ {
    wg.Add(1)
    go func() {
        defer wg.Done()
        for v := range jobs { process(v) }
    }()
}
for v := range ch { jobs <- v }
close(jobs); wg.Wait()
```

Concurrency is N. No goroutine explosion. The `range` body just forwards.

---

### Solution 5 — Buffered to reduce wake frequency

A buffer of 16-64 means the consumer is woken every 16-64 values, not every 1. Cache locality improves; wake-up cost amortises. For pinned configurations, `runtime.LockOSThread` rarely helps in pure Go workloads; reserve it for cgo.

---

### Solution 6 — Coarse-grained stages

If each per-value transform is cheap (a multiplication, a hash), do all of them in one stage:

```go
func combinedStage(in <-chan int) <-chan int {
    out := make(chan int, 64)
    go func() {
        defer close(out)
        for v := range in {
            v = transform1(v)
            v = transform2(v)
            v = transform3(v)
            v = transform4(v)
            v = transform5(v)
            out <- v
        }
    }()
    return out
}
```

Channels are now only at the I/O edges. Internal stages are just function calls.

---

### Solution 7 — Plain range when high-volume

When the input rate guarantees frequent values, the timer is redundant. Drop `select`:

```go
for v := range in {
    buffer = append(buffer, v)
    if len(buffer) >= batchSize {
        flush(buffer); buffer = buffer[:0]
    }
}
flush(buffer) // final
```

A defer on `flush` plus a finalizer covers the close path.

---

### Solution 8 — Allocation reduction

```go
var buf [64]byte
for v := range ch {
    n := strconv.AppendInt(buf[:0], int64(v), 10)
    log.Output(2, string(n))
}
```

Better: use a structured logger with int fields directly.

---

### Solution 9 — Buffer size sweep

```
Buffer 1:    1.0 M ops/sec
Buffer 16:   8.5 M ops/sec
Buffer 64:   12  M ops/sec
Buffer 256:  13  M ops/sec
Buffer 1024: 13  M ops/sec
Buffer 4096: 12  M ops/sec (cache pressure)
```

Sweet spot ~ 64-256. Match to workload.

---

### Solution 10 — Just iterate

```go
for _, v := range nums {
    use(v)
}
```

In Go 1.23, you might wrap a custom generator as `iter.Seq[T]`, but for a slice, just iterate it.

---

### Solution 11 — `sync.Pool`

```go
var bufPool = sync.Pool{
    New: func() any { return &Buffer{} },
}

for v := range ch {
    buf := bufPool.Get().(*Buffer)
    fill(buf, v)
    write(buf)
    *buf = Buffer{} // zero out
    bufPool.Put(buf)
}
```

`alloc_objects` drops; GC pause shrinks.

---

### Solution 12 — Fan-out

Already shown in Exercise 4 solution. Throughput scales with N until cores saturate.

---

### Solution 13 — Worker-stealing architecture

Replace channels-between-stages with a single work queue and N workers, each running the full pipeline inline. Each worker:

```go
for job := range jobs {
    a := stage1(job)
    b := stage2(a)
    c := stage3(b)
    d := stage4(c)
    e := stage5(d)
    output <- stage6(e)
}
```

Channels only at input and output. Internal stage transitions are zero-cost.

---

### Solution 14 — Generics

```go
type Numeric interface { ~int | ~int64 | ~float64 }

func Sum[T Numeric](ch <-chan T) T {
    var s T
    for v := range ch { s += v }
    return s
}
```

No boxing. Channel element is the concrete type.

---

### Solution 15 — Filter at the producer

```go
func produceFiltered(ctx context.Context, out chan<- Event) {
    defer close(out)
    for e := range source {
        if e.IsHeartbeat() { continue }
        select {
        case <-ctx.Done(): return
        case out <- e:
        }
    }
}
```

The consumer's `range` body never sees heartbeats. Hot path is tight.

---

### Solution 16 — Sweep results

A typical answer: with `process` taking ~10 µs CPU per value and `NumCPU = 8`:

- `M=1, N=1`: 100 K/sec (serial).
- `M=1, N=4`: 400 K/sec (parallel consumers).
- `M=2, N=6`: 600 K/sec (max).
- `M=8, N=8`: 500 K/sec (contention).

Sweet spot is M small, N close to NumCPU.

---

### Solution 17 — Buffered channel

Use a buffer (capacity ~ 256) so the consumer rarely parks. `sudog` allocations stay on the per-P free list.

---

### Solution 18 — Lossy producer

```go
func produce(events <-chan Event, out chan Event, drops *atomic.Int64) {
    for e := range events {
        select {
        case out <- e:
        default:
            drops.Add(1)
        }
    }
}
```

The consumer is the same `for e := range out`. Producer drops if the consumer cannot keep up.

---

### Solution 19 — Iterator API

```go
func (s *Stream) Iter() iter.Seq[Item] {
    return func(yield func(Item) bool) {
        for v := range s.ch { // internally still uses channel
            if !yield(v) { return }
        }
    }
}
```

Or, if the data source is synchronous, skip the channel entirely:

```go
func (s *Stream) Iter() iter.Seq[Item] {
    return func(yield func(Item) bool) {
        for s.scanner.Scan() {
            if !yield(s.scanner.Item()) { return }
        }
    }
}
```

The second form is the real win — no goroutine, no channel, just iteration.

---

### Solution 20 — Profile-guided

Typical wins, in order of impact:

1. **Eliminate allocations in the hot path** (sync.Pool, []byte buffers): 2-3× throughput.
2. **Batch values into slices**: 5-10× per-channel improvement.
3. **Consolidate stages**: removes channel cost from non-I/O stages.
4. **Worker pool**: scales with cores.
5. **Buffer sizing**: marginal but free.

Document each change; commit often. Stop optimising when target is reached.

---

## Wrap-up

The recurring patterns across these optimisations:

1. **Channel cost is per-value, ~50 ns.** Amortise via batching or stage consolidation.
2. **The `range` body is rarely the bottleneck.** The send/receive and the consumer's work usually dominate.
3. **Allocation in the body kills throughput.** `sync.Pool`, pre-allocation, and generics help.
4. **Fan-out scales consumers** until cores or contention saturate.
5. **Buffer to absorb bursts**; do not over-buffer (cache pressure).
6. **Producer-side filtering** keeps the consumer body tight.
7. **Go 1.23 iterators** replace channels when concurrency is not needed.
8. **Always profile.** `pprof` and `go tool trace` show where the time goes.

The general rule: **`range` over channels is fast for what it is — concurrent producer/consumer — but it is not free. Use it where you need the concurrency; use iterators or direct loops where you do not.**
