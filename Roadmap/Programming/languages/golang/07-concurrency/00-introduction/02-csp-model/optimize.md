# CSP Model — Optimization Exercises

> Each exercise presents CSP-style code that is correct but slow or inefficient. Identify the bottleneck and optimise. Measure before and after.

---

## Exercise 1 — Per-item channel sends

**Baseline.**

```go
out := make(chan int)
go func() {
    for i := 0; i < 1_000_000; i++ {
        out <- i
    }
    close(out)
}()
for v := range out {
    _ = v
}
```

Each item is one channel send and one channel receive — about 200 ns per pair. For one million items: ~200 ms just on channel overhead.

**Goal.** Reduce per-item channel overhead.

**Solution: batch sends.**

```go
out := make(chan []int, 4)
go func() {
    defer close(out)
    const batch = 1024
    buf := make([]int, 0, batch)
    for i := 0; i < 1_000_000; i++ {
        buf = append(buf, i)
        if len(buf) == batch {
            out <- buf
            buf = make([]int, 0, batch)
        }
    }
    if len(buf) > 0 {
        out <- buf
    }
}()
for batch := range out {
    for _, v := range batch {
        _ = v
    }
}
```

Channel operations drop ~1024x. Total time goes from ~200 ms to a few ms.

**Trade-off.** Higher latency per item (each waits up to 1024 items for its batch). Acceptable for throughput-oriented streaming; not for low-latency events.

---

## Exercise 2 — Unbuffered channel with rate-mismatched stages

**Baseline.**

```go
fast := make(chan int)
slow := make(chan int)

go func() {
    for v := range fast {
        // takes 1 ms per item
        time.Sleep(time.Millisecond)
        slow <- v
    }
    close(slow)
}()
```

The fast stage produces faster than the slow stage consumes. Each send on `slow` blocks for ~1 ms. The fast stage stalls.

**Goal.** Decouple the stages so the fast one is not always blocked.

**Solution: bounded buffer.**

```go
slow := make(chan int, 32)
```

The fast stage can deposit up to 32 items before blocking. The slow stage drains at its own pace. Total throughput unchanged (still limited by slow), but the fast stage runs continuously instead of stop-and-go.

**How to size the buffer.** Roughly the burst absorbing requirement. If the fast stage produces 1000 items/sec and the slow stage processes 100 items/sec, a buffer of 50–100 covers a short-term mismatch. Anything bigger is queueing, not buffering, and eventually OOMs.

---

## Exercise 3 — Fan-in goroutine spawn per merge

**Baseline.**

```go
func merge(channels ...<-chan int) <-chan int {
    out := make(chan int)
    var wg sync.WaitGroup
    for _, c := range channels {
        wg.Add(1)
        c := c
        go func() {
            defer wg.Done()
            for v := range c {
                out <- v
            }
        }()
    }
    go func() { wg.Wait(); close(out) }()
    return out
}
```

For each merge call, this spawns `n + 1` goroutines. Many calls = many goroutines.

**Goal.** Reduce goroutine churn.

**Solution: `select` over all channels in one goroutine.**

For a fixed, small number of channels, a single goroutine using `select` may be faster:

```go
func mergeTwo(a, b <-chan int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for a != nil || b != nil {
            select {
            case v, ok := <-a:
                if !ok { a = nil; continue }
                out <- v
            case v, ok := <-b:
                if !ok { b = nil; continue }
                out <- v
            }
        }
    }()
    return out
}
```

One goroutine, one channel; nil-out closed channels.

For dynamic / large N, the per-channel goroutine approach scales better (the `select` arity overhead grows).

---

## Exercise 4 — Closed channels acting as broadcast inefficiently

**Baseline.**

```go
done := make(chan struct{})

for i := 0; i < 1000; i++ {
    go func() {
        for {
            select {
            case v := <-work:
                process(v)
            case <-done:
                return
            }
        }
    }()
}
```

Closing `done` wakes all 1000 goroutines simultaneously. They all then try to clean up. CPU spike.

**Goal.** Stagger or limit the wake-up cost.

**Solution: explicit shutdown channel with bounded parallelism.**

```go
quit := make(chan struct{}, 1)
ack := make(chan struct{})

go func() {
    <-quit
    // tell workers to stop, one at a time
    for i := 0; i < 1000; i++ {
        workerDone <- struct{}{}
    }
    close(ack)
}()
```

For most cases, the broadcast-via-close pattern is fine — 1000 wakes is fast. This optimisation matters only when workers do heavy cleanup that you want to serialise.

---

## Exercise 5 — Channel-mediated counter

**Baseline.**

```go
type Counter struct {
    inc chan int
}

func NewCounter() *Counter {
    c := &Counter{inc: make(chan int)}
    go func() {
        var n int
        for d := range c.inc {
            n += d
            _ = n
        }
    }()
    return c
}

func (c *Counter) Add(d int) { c.inc <- d }
```

Each increment is a channel operation. Channel send is ~100 ns; atomic add is ~5 ns.

**Goal.** Speed up the counter.

**Solution: atomic.**

```go
type Counter struct {
    n atomic.Int64
}

func (c *Counter) Add(d int64) { c.n.Add(d) }
func (c *Counter) Load() int64 { return c.n.Load() }
```

20x faster. The CSP version was wasteful — it serialised increments without need.

**Lesson.** Not everything benefits from CSP. Simple shared state belongs to atomics or mutexes.

---

## Exercise 6 — `select` arity

**Baseline.**

```go
func waitAny16(channels [16]<-chan int) (int, int) {
    select {
    case v := <-channels[0]:  return 0, v
    case v := <-channels[1]:  return 1, v
    ...
    case v := <-channels[15]: return 15, v
    }
}
```

A 16-arm `select` has measurable overhead — each entry into the select locks all 16 channels, evaluates them, possibly registers wait queues.

**Goal.** Reduce select overhead.

**Solution: tree of merges.**

Merge pairs of channels into single channels, recursively:

```go
func waitAny(channels []<-chan int) (int, int) {
    if len(channels) == 1 {
        return 0, <-channels[0]
    }
    half := len(channels) / 2
    left := merge(channels[:half]...)
    right := merge(channels[half:]...)
    select {
    case v := <-left:
        return 0, v
    case v := <-right:
        return 1, v
    }
}
```

Logarithmic instead of linear. Useful only when N is very large; for N ≤ 16 the original is fine.

**Or:** use `reflect.Select` for genuinely dynamic arity, accepting its overhead.

---

## Exercise 7 — Channel allocation in the hot path

**Baseline.**

```go
func processRequest(req Request) Response {
    out := make(chan Response, 1)
    go func() {
        out <- compute(req)
    }()
    return <-out
}
```

Every request allocates a channel. Channel allocation is ~50 ns plus GC pressure.

**Goal.** Reduce allocation.

**Solution: synchronous call.**

If you wait on the channel synchronously anyway, just call the function:

```go
func processRequest(req Request) Response {
    return compute(req)
}
```

Same semantics, no channel, no goroutine. The "concurrent" version was concurrency theatre.

If `compute` truly needs to run in a separate goroutine (e.g., to enforce a timeout), keep the channel but pool channels via `sync.Pool` only if profiling shows allocation matters.

---

## Exercise 8 — Producer-consumer with one slow path

**Baseline.**

```go
out := make(chan int)
go func() {
    defer close(out)
    for v := range in {
        out <- expensiveTransform(v)
    }
}()
```

A single goroutine does the expensive transform. If `expensiveTransform` is CPU-bound and the consumer is slow, the pipeline is serialised at `expensiveTransform`.

**Goal.** Parallelise the expensive stage.

**Solution: worker pool.**

```go
out := make(chan int, runtime.NumCPU())
var wg sync.WaitGroup
for w := 0; w < runtime.NumCPU(); w++ {
    wg.Add(1)
    go func() {
        defer wg.Done()
        for v := range in {
            out <- expensiveTransform(v)
        }
    }()
}
go func() {
    wg.Wait()
    close(out)
}()
```

Now N CPUs work in parallel. Note: results may arrive out of order. If ordering matters, add a sort step or use per-worker output channels keyed by sequence number.

---

## Exercise 9 — Reusable channels via `sync.Pool`

**Baseline.**

In a high-frequency request handler that allocates a `chan Result` per request:

```go
func handle(req Request) Result {
    ch := make(chan Result, 1)
    go func() { ch <- compute(req) }()
    return <-ch
}
```

At millions of requests/sec, channel allocation contributes to GC pressure.

**Goal.** Reuse channels.

**Solution: `sync.Pool` of channels.**

```go
var chanPool = sync.Pool{
    New: func() interface{} { return make(chan Result, 1) },
}

func handle(req Request) Result {
    ch := chanPool.Get().(chan Result)
    defer chanPool.Put(ch)
    go func() { ch <- compute(req) }()
    return <-ch
}
```

**Caveat.** The pool reuses channels across requests. After the goroutine sends, the receiver reads. The channel is empty when returned to the pool. If for any reason the goroutine sends and the receiver does not read (early return, panic), the pool gets a non-empty channel, which the next caller will receive a stale value from.

This optimisation is fragile. Use only if profiling proves channel allocation is a real bottleneck.

---

## Exercise 10 — Eliminating unnecessary intermediate channels

**Baseline.**

```go
func process(in <-chan int) <-chan int {
    mid := make(chan int)
    out := make(chan int)

    go func() {
        defer close(mid)
        for v := range in {
            mid <- v + 1
        }
    }()

    go func() {
        defer close(out)
        for v := range mid {
            out <- v * 2
        }
    }()

    return out
}
```

Two transformations, two goroutines, two channels. If neither transformation is expensive, the channel overhead dominates.

**Goal.** Fuse adjacent stages.

**Solution.**

```go
func process(in <-chan int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for v := range in {
            out <- (v + 1) * 2
        }
    }()
    return out
}
```

One goroutine, one channel. The two transformations are combined.

Use intermediate channels only when each stage has its own goroutine for parallelism, isolation, or rate-decoupling.

---

## Exercise 11 — Channel of pointers to avoid copy cost

**Baseline.**

```go
type LargeStruct struct {
    Buf [10000]byte
}

ch := make(chan LargeStruct, 16)
ch <- LargeStruct{}
```

Each send copies 10 000 bytes. For a hot channel this is expensive.

**Goal.** Reduce copy cost.

**Solution.**

```go
ch := make(chan *LargeStruct, 16)
ch <- &LargeStruct{}
```

Now only an 8-byte pointer is sent. The struct lives on the heap.

**Caveat.** Sending a pointer transfers ownership in the CSP sense. The sender must not mutate the struct after sending; otherwise race.

**Caveat 2.** Heap allocation has its own cost. For very small structs, the copy may be cheaper than the allocation. Benchmark.

---

## Exercise 12 — Pipeline with high latency tail

**Baseline.**

```go
type Result struct {
    val int
    err error
}

func process(in <-chan int) <-chan Result {
    out := make(chan Result)
    go func() {
        defer close(out)
        for v := range in {
            r := expensive(v) // 1 ms avg, 100 ms p99
            out <- Result{r, nil}
        }
    }()
    return out
}
```

If `expensive(v)` has high tail latency, the entire pipeline stalls during the tails.

**Goal.** Reduce tail-induced stalls.

**Solution: parallelise within the stage.**

```go
out := make(chan Result, 64)
var wg sync.WaitGroup
for w := 0; w < runtime.NumCPU(); w++ {
    wg.Add(1)
    go func() {
        defer wg.Done()
        for v := range in {
            r := expensive(v)
            out <- Result{r, nil}
        }
    }()
}
```

Multiple workers; a tail in one does not block the others.

If ordering matters, add a re-sequencer goroutine that buffers out-of-order results and emits them in input order. Adds complexity; only worth it if both ordering and tail mitigation are needed.

---

## Exercise 13 — `time.After` leaking in a loop

**Baseline.**

```go
for {
    select {
    case v := <-ch:
        process(v)
    case <-time.After(time.Second):
        timeout()
    }
}
```

Each iteration allocates a new `time.After` channel. The previous one persists until its timer fires (1 second). In a tight loop you build up many timers in memory.

**Goal.** Reuse a single timer.

**Solution.**

```go
t := time.NewTimer(time.Second)
defer t.Stop()
for {
    if !t.Stop() {
        select { case <-t.C: default: }
    }
    t.Reset(time.Second)
    select {
    case v := <-ch:
        process(v)
    case <-t.C:
        timeout()
    }
}
```

One timer; reset on each iteration. Less GC pressure, less memory.

---

## Exercise 14 — Channel for one-shot signal

**Baseline.**

```go
ready := make(chan bool)
go func() {
    setup()
    ready <- true
}()
<-ready
```

Allocates a channel for a single signal.

**Goal.** Use the cheapest possible signal.

**Solution: `chan struct{}` and close.**

```go
ready := make(chan struct{})
go func() {
    setup()
    close(ready)
}()
<-ready
```

`chan struct{}` is zero-bytes per element. Closing broadcasts to all receivers. Slightly faster, far more idiomatic.

For one-shot signals to many goroutines, this is the standard pattern.

---

## Exercise 15 — Avoiding channels entirely for sync.Once-like semantics

**Baseline.**

```go
initOnce := make(chan struct{})
go func() {
    initialize()
    close(initOnce)
}()

func get() X {
    <-initOnce
    return cachedX
}
```

Every call to `get` does a channel receive (~50 ns).

**Goal.** Reduce per-call overhead after initialization is complete.

**Solution: `sync.Once`.**

```go
var (
    once     sync.Once
    cachedX  X
)

func get() X {
    once.Do(initialize)
    return cachedX
}
```

After the first call, `once.Do` is an atomic load (~5 ns). Much faster on the hot path.

---

## Closing

Optimising CSP-style code is largely about:

1. **Reducing per-operation channel overhead.** Batch, fuse stages, eliminate unnecessary channels.
2. **Bounding buffers.** Sized to expected burst, not "infinity."
3. **Choosing the right primitive.** Sometimes a channel is wrong — use atomics, mutexes, or `sync.Once` instead.
4. **Parallelising hot stages.** Worker pools where one goroutine becomes the bottleneck.
5. **Reusing allocations.** `sync.Pool` for channels, buffers, structs.

The fastest channel is the one you do not use. The next fastest is the one with a tiny buffer that lets sender and receiver run independently. Channels with megabyte buffers are usually masking a design problem.

Profile first. Hypothesise. Benchmark. Iterate. The goal is to make the code fast *and* clear; CSP discipline tends to keep the second property even as you optimise the first.
