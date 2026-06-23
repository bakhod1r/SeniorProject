# Pipeline — Optimization

> Honest framing first: most pipeline performance is dictated by the slowest stage. Before any micro-optimization, profile (`go test -bench`, `pprof`) and find the bottleneck. The optimizations below are real, measurable, and each has caveats that matter — apply them only when you can show the gain on your workload.
>
> Each entry states the problem, shows a "before" and "after," and reports the realistic gain.

---

## Optimization 1 — Replace a slow stage with fan-out workers

**Problem:** One stage's per-item cost dominates throughput. The pipeline runs at the slow stage's rate, the rest of the pipeline is mostly idle.

**Before:**
```go
func enrich(ctx context.Context, in <-chan Event) <-chan Event {
    out := make(chan Event)
    go func() {
        defer close(out)
        for ev := range in {
            ev.Tag = lookup(ctx, ev.UserID) // 5 ms remote call
            out <- ev
        }
    }()
    return out
}
// Throughput: 1 / 5ms = 200 events/sec
```

**After:**
```go
func parallelEnrich(ctx context.Context, in <-chan Event, n int) <-chan Event {
    workers := make([]<-chan Event, n)
    for i := 0; i < n; i++ {
        workers[i] = enrich(ctx, in) // each worker reads from same in
    }
    return Merge(ctx, workers...)
}
// Use:
out := parallelEnrich(ctx, src, 16)
// Throughput: ~16 * 200 = 3200 events/sec (if RPC server keeps up)
```

**Gain:** Linear with worker count up to the saturation point of the underlying resource. A 16x or 32x speedup is typical for IO-bound stages.

**Caveat:** Fan-out destroys order. If downstream needs ordered output, tag each item with a sequence number and reorder at the sink. Also, the upstream and downstream must keep up — adding fan-out to the middle of an already-bottlenecked pipeline just moves the bottleneck.

---

## Optimization 2 — Tune buffer sizes to absorb jitter

**Problem:** Strict unbuffered backpressure causes "stop-and-go" jitter when stages have variable per-item latency. Average throughput drops because the slowest item per stage stalls the chain.

**Before:**
```go
parsed := parse(ctx, src)         // unbuffered: P50=200µs, P99=4ms
enriched := enrich(ctx, parsed)   // unbuffered
written := write(ctx, enriched)   // unbuffered
```

**After:**
```go
parsed := parse(ctx, src)
enriched := enrichBuf(ctx, parsed, 16) // buffer 16 to absorb 4ms tails
written := write(ctx, enriched)

func enrichBuf(ctx context.Context, in <-chan Event, buf int) <-chan Event {
    out := make(chan Event, buf) // absorbs P99/median ≈ 20x ratio
    // ... two-select sandwich body ...
}
```

**Gain:** 10-30% throughput improvement on jittery workloads. Variance in end-to-end latency drops sharply; tail latency (P99) improves by amortising the slow items across the buffer.

**Caveat:** Don't oversize. A buffer of 16 with 1 KB events holds 16 KB; a buffer of 100,000 holds 100 MB and hides backpressure problems. Size by `2 * (P99 / median)` of the upstream stage and document it in code.

---

## Optimization 3 — Fuse trivial stages

**Problem:** Long pipelines of tiny stages spend most of their time in channel operations, not real work. Channel send/recv is ~50-150 ns; for transforms costing <100 ns the channel overhead exceeds the work.

**Before:**
```go
out := addOne(ctx, multiplyByTwo(ctx, square(ctx, src)))
// 3 stages, 3 channels, ~450 ns of channel overhead per item.
// Per-item work: ~5 ns. Channel overhead: 90x the work.
```

**After:**
```go
func transform(v int) int {
    return (v*v)*2 + 1
}
out := Map(transform)(ctx, src)
// 1 stage, 1 channel, ~150 ns overhead per item.
// 3x speedup on tiny transforms.
```

**Gain:** 2-5x for trivial transforms. The exact gain scales with how many stages you fuse.

**Caveat:** Don't fuse stages whose responsibilities differ. If `square` and `addOne` belong to different concerns (validation vs scoring), keep them separate for clarity. Fuse only when the per-item work is truly trivial *and* the boundary is artificial.

---

## Optimization 4 — Reduce GC pressure with object reuse

**Problem:** Each pipeline pass allocates new structs; under high throughput, GC pauses become a measurable fraction of CPU time.

**Before:**
```go
type Record struct {
    Buf []byte
    // ...other fields
}

func decode(ctx context.Context, in <-chan []byte) <-chan Record {
    out := make(chan Record)
    go func() {
        defer close(out)
        for raw := range in {
            r := Record{Buf: make([]byte, len(raw))}
            copy(r.Buf, raw)
            out <- r // each item allocates a new []byte
        }
    }()
    return out
}
// pprof: 30% time in GC under load
```

**After:**
```go
var bufPool = sync.Pool{
    New: func() any { return make([]byte, 0, 4096) },
}

type Record struct {
    Buf []byte
}

func decode(ctx context.Context, in <-chan []byte) <-chan Record {
    out := make(chan Record)
    go func() {
        defer close(out)
        for raw := range in {
            buf := bufPool.Get().([]byte)
            buf = append(buf[:0], raw...)
            out <- Record{Buf: buf}
        }
    }()
    return out
}

// At the sink, return buffers:
for r := range out {
    process(r)
    bufPool.Put(r.Buf[:0])
}
// pprof: GC drops to 5%
```

**Gain:** 20-40% throughput improvement in allocation-heavy pipelines. Latency tail also improves because GC pauses shorten.

**Caveat:** Object reuse requires explicit ownership transfer. The sink must put back; the stages must not retain references. Mistakes cause use-after-return bugs. Use `sync.Pool` only when allocation profile shows it's worth the complexity.

---

## Optimization 5 — Speed up pipeline shutdown

**Problem:** A pipeline with deep buffers takes a long time to shut down because each stage has to drain its buffer before noticing ctx cancellation.

**Before:**
```go
out := make(chan T, 1000) // big buffer
// On cancel, stage drains 1000 items before returning.
```

**After: drop-on-cancel**
```go
func stage(ctx context.Context, in <-chan In) <-chan Out {
    out := make(chan Out, 32)
    go func() {
        defer close(out)
        for {
            select {
            case <-ctx.Done():
                return // drop in-flight items immediately
            case v, ok := <-in:
                if !ok {
                    return
                }
                select {
                case <-ctx.Done():
                    return
                case out <- transform(v):
                }
            }
        }
    }()
    return out
}
```

The two-select sandwich already does this — but only if the buffer is small. With buffer=1000 the stage may still be blocked sending into a full downstream when cancel fires; the select on ctx unblocks it immediately.

**Gain:** Shutdown drops from O(buffer) to O(in-flight item) latency. For a 1000-buffer pipeline doing 5 ms per item, that's 5 seconds → 5 milliseconds.

**Caveat:** Dropped items are lost. For at-least-once semantics you need either a bounded grace period (drain with a deadline) or explicit acknowledgement at the sink. Don't drop without thinking about the contract.

---

## Optimization 6 — Replace generics with concrete types in the hot path

**Problem:** Generic stages compile to gcshape stencils and may not inline as well as concrete code. For trivial transforms in a hot inner loop, this can cost 20-40% per item.

**Before:**
```go
func Map[In, Out any](f func(In) Out) Stage[In, Out] {
    return func(ctx context.Context, in <-chan In) <-chan Out {
        // ... two-select sandwich body that calls f ...
    }
}

out := Map(square)(ctx, src) // generic
// Benchmark: 220 ns/item
```

**After:**
```go
func squareStage(ctx context.Context, in <-chan int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for {
            select {
            case <-ctx.Done():
                return
            case v, ok := <-in:
                if !ok {
                    return
                }
                select {
                case <-ctx.Done():
                    return
                case out <- v * v: // inlined; no function indirection
                }
            }
        }
    }()
    return out
}

out := squareStage(ctx, src)
// Benchmark: 130 ns/item — 40% faster
```

**Gain:** 20-40% on trivial transforms in tight loops. Negligible on transforms that do real work (>1 µs).

**Caveat:** You lose composability. Keep generics for cold-path or boilerplate stages; specialize only the measured hot stage. Run a benchmark before and after to confirm the gain — sometimes the inliner already does it for you.

---

## Optimization 7 — Batch within stages

**Problem:** Per-item channel overhead is fixed; per-batch overhead is the same. So if items are tiny, batching N together cuts overhead by N×.

**Before:**
```go
func encode(ctx context.Context, in <-chan Record) <-chan []byte {
    out := make(chan []byte)
    go func() {
        defer close(out)
        for r := range in {
            out <- proto.Marshal(r) // 1 send per record
        }
    }()
    return out
}
// 1M records/sec * 150ns chan overhead = 150ms/sec wasted
```

**After:**
```go
func encodeBatched(ctx context.Context, in <-chan Record, batchSize int) <-chan [][]byte {
    out := make(chan [][]byte)
    go func() {
        defer close(out)
        batch := make([][]byte, 0, batchSize)
        for {
            select {
            case <-ctx.Done():
                return
            case r, ok := <-in:
                if !ok {
                    if len(batch) > 0 {
                        out <- batch
                    }
                    return
                }
                batch = append(batch, proto.Marshal(r))
                if len(batch) >= batchSize {
                    select {
                    case <-ctx.Done():
                        return
                    case out <- batch:
                    }
                    batch = make([][]byte, 0, batchSize)
                }
            }
        }
    }()
    return out
}
// 1M records/sec / 100 batch = 10k sends/sec * 150ns = 1.5ms/sec wasted
```

**Gain:** 10-100x reduction in channel overhead for small items. Latency increases by up to one batch interval — usually worth it.

**Caveat:** Batches add latency. If your latency budget is tight, add a time-based flush (`select { case <-time.After(timeout): flush() }`) so the batch doesn't sit half-full forever. Choose batch size by measuring the per-item vs per-batch cost ratio.

---

## Optimization 8 — Drop redundant stages

**Problem:** Some stages were added "just in case" but are no-ops or near-no-ops on the actual workload. They cost channel overhead and goroutine memory for nothing.

**Before:**
```go
src := gen(ctx, items)
v := validate(ctx, src)      // 99.99% pass-through
n := normalize(ctx, v)       // 99% no-op (already normalized upstream)
e := enrich(ctx, n)          // real work
out := write(ctx, e)
```

**After:**
```go
src := gen(ctx, items)
e := enrich(ctx, src)        // skip the no-op stages
out := write(ctx, e)
```

If `validate` is needed only for malformed input that almost never appears, move it to a sampling check or a one-time test rather than per-item.

**Gain:** Per-stage overhead × 2 stages × event rate. For 1M events/sec at 200 ns/stage, that's 400 ms/sec of CPU saved (40% of one core).

**Caveat:** Don't remove stages that are *defensive* against rare bad input — those are worth the overhead. Drop only stages that the data's actual distribution makes redundant.

---

## Optimization 9 — Use sync.Pool for per-item allocations

**Problem:** Each item passing through a pipeline allocates fresh buffers, scratch maps, or temporary slices. Under high throughput, GC pauses dominate latency.

**Before:**
```go
func tokenize(ctx context.Context, in <-chan string) <-chan []string {
    out := make(chan []string)
    go func() {
        defer close(out)
        for s := range in {
            tokens := strings.Split(s, " ") // allocates slice + each substring
            out <- tokens
        }
    }()
    return out
}
// pprof: 600MB/s allocation rate, 25% time in GC
```

**After:**
```go
var tokenPool = sync.Pool{
    New: func() any { return make([]string, 0, 16) },
}

func tokenize(ctx context.Context, in <-chan string) <-chan []string {
    out := make(chan []string)
    go func() {
        defer close(out)
        for s := range in {
            tokens := tokenPool.Get().([]string)[:0]
            for _, t := range strings.Split(s, " ") {
                tokens = append(tokens, t)
            }
            out <- tokens
        }
    }()
    return out
}

// At sink:
for tokens := range out {
    process(tokens)
    tokenPool.Put(tokens[:0])
}
// pprof: 80MB/s allocation rate, 5% time in GC
```

**Gain:** 30-50% reduction in GC time. Latency tail flattens because GC pauses shorten.

**Caveat:** `sync.Pool` is a *cache*, not a guaranteed reuse. The runtime may evict pool entries; expect cache misses. Also, the sink *must* put items back or the pool is useless. And every consumer that receives the item is responsible — if the pipeline branches (fan-out at the sink), pool ownership becomes confusing.

---

## Optimization 10 — Prefetch downstream work

**Problem:** A stage waits on a slow downstream (e.g. a DB write). The CPU sits idle while the network call completes.

**Before:**
```go
func writer(ctx context.Context, in <-chan Record) {
    for r := range in {
        db.Insert(ctx, r) // blocks 5 ms each
    }
}
// 200 records/sec
```

**After:**
```go
func writer(ctx context.Context, in <-chan Record, parallelism int) {
    sem := make(chan struct{}, parallelism)
    var wg sync.WaitGroup
    for r := range in {
        select {
        case <-ctx.Done():
            wg.Wait()
            return
        case sem <- struct{}{}:
        }
        wg.Add(1)
        r := r
        go func() {
            defer wg.Done()
            defer func() { <-sem }()
            db.Insert(ctx, r)
        }()
    }
    wg.Wait()
}
// With parallelism=8: ~1600 records/sec
```

**Gain:** Up to N× parallelism × baseline throughput, capped by the downstream service's capacity.

**Caveat:** Now ordering is lost (the DB sees inserts in non-deterministic order). If ordering matters (e.g. log replay), parallelism breaks correctness. Also, more inflight requests means more memory and more pressure on the downstream service — pick parallelism by measurement, not "just N=100".

---

## Optimization 11 — Avoid struct copies through channels

**Problem:** Sending large structs by value through channels copies them on every hop. A 5-stage pipeline with 1 KB structs copies 5 KB per item.

**Before:**
```go
type Record struct {
    Header [256]byte
    Body   [1024]byte
}

func stage(ctx context.Context, in <-chan Record) <-chan Record {
    // copies Record on receive AND on send
}
```

**After:**
```go
type Record struct {
    Header [256]byte
    Body   [1024]byte
}

func stage(ctx context.Context, in <-chan *Record) <-chan *Record {
    // copies pointer (8 bytes) instead of full struct (1280 bytes)
}
```

**Gain:** For large structs (>128 bytes), 2-5x throughput improvement. Most of the gain comes from cache locality, not just the copy itself.

**Caveat:** Pointers introduce shared-mutable-state risk. If two stages both retain the pointer, they may race. Document ownership: "after sending, the sender must not touch the value." For complex shared types, prefer immutable copies; for hot-path performance, accept the risk and discipline.

---

## Optimization 12 — Pin goroutines with GOMAXPROCS-aware fan-out

**Problem:** Fan-out with N=100 workers on a 4-core machine schedules them all on the same 4 OS threads, with massive context-switch overhead.

**Before:**
```go
parallelEnrich(ctx, in, 100) // 100 workers on 4 cores
// pprof: 30% time in sched/futex
```

**After:**
```go
n := runtime.GOMAXPROCS(0) * 2 // 8 workers on 4 cores
parallelEnrich(ctx, in, n)
// pprof: 5% time in sched/futex
```

**Gain:** 10-30% throughput improvement when the stage is CPU-bound. Less for IO-bound stages (where idle workers don't compete for CPU).

**Caveat:** For IO-bound stages, more workers can be useful — they spend most time blocked on the network. The right number depends on the stage's CPU/IO ratio. Measure per stage.

---

## When NOT to optimize

A pipeline that does what it needs at the throughput required is *done*. Optimization has costs:

- **Code complexity.** Object pools and batching add invariants that future maintainers must respect.
- **Correctness risk.** Buffer tuning and parallelism can introduce ordering bugs and races.
- **Maintenance.** Tuned buffers tied to specific P99 measurements break when load patterns change.

Profile first. Establish a target. Optimize the *measured* bottleneck. Stop when you've hit the target. Most of the optimizations above are tools you should reach for in an emergency, not by default.

---

## Cheat Sheet

| Optimization | Typical gain | When to use |
|--------------|--------------|-------------|
| Fan-out a slow stage | Linear in worker count | Bottleneck is one stage |
| Tune buffer sizes | 10-30% throughput | High-jitter stages |
| Fuse trivial stages | 2-5x | Per-item work < 100 ns |
| sync.Pool reuse | 20-50% GC | Allocation-heavy hot path |
| Faster shutdown | O(buf) → O(item) | Big buffers + slow drain |
| Concrete vs generic | 20-40% | Hot trivial transforms |
| Batching | 10-100x channel cost | Small per-item work |
| Drop redundant stages | Per-stage overhead | No-op stages |
| sync.Pool buffers | 30-50% GC | Per-item buffer alloc |
| Prefetch downstream | N× parallelism | IO-bound sink |
| Pointers vs values | 2-5x for big structs | Items > 128 bytes |
| GOMAXPROCS-aware fan-out | 10-30% | CPU-bound stage |

Each of these requires measurement to confirm the gain on your workload. The numbers above are typical, not guaranteed.
