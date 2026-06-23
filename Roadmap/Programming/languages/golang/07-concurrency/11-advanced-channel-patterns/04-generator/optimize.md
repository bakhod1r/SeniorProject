# Generator Pattern — Optimisation

A working generator is easy. A *fast* generator is a different problem. This file walks through realistic optimisation paths: measure first, then change one thing at a time.

---

## 1. Measure before you optimise

The first optimisation is to know what you are optimising. A generator's wall-clock cost has three components:

1. **Per-item production work.** Computing the next value, reading from disk, hitting the network.
2. **Channel send/receive overhead.** ~50ns per item with unbuffered, less with buffered.
3. **Scheduling latency.** Time between a goroutine becoming runnable and getting a CPU.

Profile with:

```bash
go test -bench=. -benchmem -cpuprofile=cpu.out
go tool pprof -http :8080 cpu.out
```

Look for `runtime.chansend`, `runtime.chanrecv`, and the producer's own functions. The percentage tells you where to spend effort.

A common mistake: optimising channel ops when the actual bottleneck is `fetch()` taking 20ms per page. The channel is irrelevant in that regime; focus on reducing fetch latency or parallelising fetches.

---

## 2. Pick the right iteration mechanism

For pure in-process iteration with no concurrency benefit, `iter.Seq` (Go 1.23+) is **~10× faster** than a channel generator. Benchmark:

```go
func BenchmarkChannelCounter(b *testing.B) {
    ctx, cancel := context.WithCancel(context.Background())
    defer cancel()
    ch := Counter(ctx)
    for i := 0; i < b.N; i++ {
        <-ch
    }
}

func BenchmarkSeqCounter(b *testing.B) {
    next, stop := iter.Pull(CounterSeq())
    defer stop()
    for i := 0; i < b.N; i++ {
        next()
    }
}
```

Typical results on Apple Silicon: channel ~55ns/op, iterator ~5ns/op.

The decision: if your generator's only job is to feed a synchronous loop, switch to `iter.Seq`. If it must run concurrently with the consumer, stay with channels.

---

## 3. Buffer the channel

Default unbuffered is correct in many cases. Add a buffer when:
- The producer is bursty (yields many items quickly, then waits).
- The consumer is occasionally slow but on average fast enough.

Buffer size heuristic: `peak_burst_size` items, capped at a few hundred. Larger buffers add memory and hide problems.

Benchmark:

```go
func BenchmarkBuffer(b *testing.B) {
    for _, buf := range []int{0, 1, 16, 64, 256} {
        b.Run(fmt.Sprintf("buf=%d", buf), func(b *testing.B) {
            out := make(chan int, buf)
            done := make(chan struct{})
            go func() {
                defer close(out)
                for i := 0; i < b.N; i++ {
                    out <- i
                }
            }()
            for range out { }
            <-done
        })
    }
}
```

Typical pattern: throughput rises sharply from 0 to 8, plateaus by 64, and gains nothing beyond 256.

---

## 4. Batch values

For high-throughput streams, sending one value per channel op is wasteful. Send slices:

```go
func GenBatched(ctx context.Context, batchSize int) <-chan []int {
    out := make(chan []int)
    go func() {
        defer close(out)
        for i := 0; ; {
            batch := make([]int, 0, batchSize)
            for j := 0; j < batchSize; j++ {
                batch = append(batch, i)
                i++
            }
            select {
            case <-ctx.Done():
                return
            case out <- batch:
            }
        }
    }()
    return out
}
```

If `batchSize=100`, the channel op cost is amortised over 100 items — effectively 0.5ns/item instead of 50ns/item.

The consumer pays a small cost iterating each batch, but the trade is almost always favourable for throughput-sensitive paths.

---

## 5. Pool batch slices

If the consumer can release a batch back to the producer, use `sync.Pool` to avoid allocating on every iteration:

```go
var batchPool = sync.Pool{
    New: func() any { return make([]int, 0, 100) },
}

func GenPooled(ctx context.Context) <-chan []int {
    out := make(chan []int)
    go func() {
        defer close(out)
        for i := 0; ; {
            batch := batchPool.Get().([]int)[:0]
            for j := 0; j < 100; j++ {
                batch = append(batch, i)
                i++
            }
            select {
            case <-ctx.Done():
                batchPool.Put(batch)
                return
            case out <- batch:
            }
        }
    }()
    return out
}

// Consumer:
for batch := range gen {
    process(batch)
    batchPool.Put(batch[:0])
}
```

This requires consumer cooperation. Skip it if the consumer is third-party.

---

## 6. Avoid `select` when only one channel is involved

A `select` with one `case` is slower than a direct send. If a generator does not need cancellation (rare!), drop the `select`:

```go
// Slower:
for _, v := range values {
    select {
    case out <- v:
    }
}

// Faster:
for _, v := range values {
    out <- v
}
```

The compiler can lower a plain send more efficiently than a one-case select. The savings are tiny per op but add up at millions of items.

This is only safe when there is no cancellation case. If you need cancellation, the `select` is mandatory.

---

## 7. Reduce goroutine count

A pipeline of `gen → map → filter → map → sum` runs 4 goroutines. Each goroutine pair has channel-op overhead.

If `map` and `filter` are trivial functions, fuse them into one stage:

```go
func mapFilter(in <-chan int, m func(int) int, f func(int) bool) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for v := range in {
            v = m(v)
            if !f(v) {
                continue
            }
            out <- v
        }
    }()
    return out
}
```

One goroutine, one channel. The internal `m(v)` and `f(v)` are direct calls.

Alternatively, push trivial transforms into the generator itself if you control it. Or convert the whole chain to `iter.Seq` with chained adapters and bypass channels entirely.

---

## 8. Fan-out from the generator

If the producer is fast and the consumer is the bottleneck, parallelise the consumer:

```go
src := Gen(...)
results := make([]<-chan Result, 8)
for i := range results {
    results[i] = process(src)
}
merged := fanIn(results...)
```

8 consumer goroutines all read from `src`; whichever is free grabs the next value. The generator is unchanged.

This optimisation does *not* apply when the work is order-dependent — fan-out loses order.

---

## 9. Avoid double-copying values

If `T` is a large struct (say, 1KB), sending by value copies on every send and every receive. Send pointers:

```go
out := make(chan *BigStruct)
```

Trade-off: pointer aliasing requires care. If the producer reuses a single struct and the consumer holds onto pointers, you have a data race.

A safer pattern: producer allocates a fresh struct per yield, consumer owns it after receive. The GC handles cleanup.

---

## 10. Coalesce slow upstream calls

If the generator's bottleneck is an upstream API:

- **Concurrent fetches.** Spawn N fetch goroutines that all funnel into the output channel via fan-in.
- **Prefetch the next page.** While the consumer is processing page N, the goroutine fetches page N+1.
- **Cache common queries.** A short-TTL cache in front of the fetch avoids redundant work.

Each of these is more complex than the canonical generator; only adopt when measurements demand.

---

## 11. Inline cancellation check

A `select` with `<-ctx.Done()` and `out <- v` is ~80ns. If the producer is hot and you accept a slight cancellation delay, you can amortise:

```go
const checkEvery = 64
for i := 0; ; i++ {
    if i%checkEvery == 0 {
        if ctx.Err() != nil {
            return
        }
    }
    out <- i // still risks blocking if consumer stops
}
```

This is **dangerous** — `out <- i` without a select can still block forever. The amortisation only helps for the `ctx.Err()` polling, not for the send.

A safer hybrid: check `ctx.Err()` every 64 iterations *and* keep the `select` on send.

In practice: do not optimise this. The 80ns select overhead is dwarfed by any real production work.

---

## 12. Use `runtime.LockOSThread` for low-jitter producers

For a generator that must yield with bounded jitter (e.g., real-time data feed), pin its goroutine to an OS thread:

```go
go func() {
    runtime.LockOSThread()
    defer runtime.UnlockOSThread()
    defer close(out)
    // ...
}()
```

This avoids the goroutine being preempted to another P, at the cost of one whole OS thread for the duration. Use only when measurements show preemption is the bottleneck.

---

## 13. Benchmark with realistic data

A benchmark that yields `int` is not representative of a generator yielding `[]byte` JSON payloads. Use realistic types:

```go
type Event struct {
    ID    string
    Bytes []byte // 1-4 KB
    Time  time.Time
}
```

Now measure. The channel op cost is still ~50ns, but allocation cost of the payload may dominate. Pool the allocations.

---

## 14. Profile under contention

A generator that performs perfectly in isolation may degrade under real load. Profile the production binary, not the microbenchmark:

```bash
go tool pprof http://prod-host:6060/debug/pprof/profile
```

Look for the generator's send line; if it dominates, your consumer is the actual bottleneck. Optimise the consumer, not the generator.

---

## 15. Know when to stop

The optimisation ladder:

1. Right algorithm.
2. Right iteration mechanism (channel vs iterator).
3. Right buffer size.
4. Batching.
5. Pooling.
6. Fan-out.
7. Pointer vs value.
8. Inline / fuse stages.

Stop when:
- The generator is no longer in the top 10% of the CPU profile.
- The latency / throughput SLO is met with headroom.
- Further changes add complexity without proportional gain.

A clean, idiomatic generator that meets its SLO is better than a 5% faster one that nobody can maintain. Optimise with the SLO in mind, and stop the moment the SLO is comfortably met.
