# Tee-Channel — Optimization

When tee is in the hot path of a high-throughput pipeline, the canonical implementation can be tuned. This file walks through the optimization sequence, in order from cheapest to most invasive. **Measure first; optimize only what your profile says is slow.**

## Table of Contents
1. [Baseline Measurement](#baseline-measurement)
2. [Optimization 1: Buffer Both Sides](#optimization-1-buffer-both-sides)
3. [Optimization 2: Send Pointers, Not Values](#optimization-2-send-pointers-not-values)
4. [Optimization 3: Batch Inputs](#optimization-3-batch-inputs)
5. [Optimization 4: Shard the Tee](#optimization-4-shard-the-tee)
6. [Optimization 5: Replace with SPMC Ring](#optimization-5-replace-with-spmc-ring)
7. [Allocation-Free Tee for Small Types](#allocation-free-tee-for-small-types)
8. [Choosing Between Optimizations](#choosing-between-optimizations)
9. [Anti-Optimizations to Avoid](#anti-optimizations-to-avoid)
10. [Summary](#summary)

---

## Baseline Measurement

Before any change, benchmark the canonical tee:

```go
func BenchmarkTee(b *testing.B) {
    done := make(chan struct{})
    defer close(done)

    in := make(chan int)
    a, c := Tee(done, in)

    go func() {
        for v := range a { _ = v }
    }()
    go func() {
        for v := range c { _ = v }
    }()

    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        in <- i
    }
    close(in)
}
```

On commodity x86_64 hardware (2024-era), expect:

```
BenchmarkTee-8    5000000    300 ns/op    0 B/op    0 allocs/op
```

That is roughly 3.3 million ops/sec. Per-op time breaks down as:
- Channel send to `in`: ~50 ns
- Tee receives from `in` and enters `selectgo`: ~100 ns
- Two channel sends to outputs (via selectgo): ~150 ns
- Consumer-side receive: incorporated into next op

Use this as a baseline. Each optimization below should be benchmarked against it.

---

## Optimization 1: Buffer Both Sides

A small buffer turns each send into an amortised lock acquisition instead of a per-value scheduler transition.

```go
func TeeBuf[T any](done <-chan struct{}, in <-chan T, buf int) (<-chan T, <-chan T) {
    out1 := make(chan T, buf)
    out2 := make(chan T, buf)
    go func() {
        defer close(out1)
        defer close(out2)
        for v := range in {
            a, b := out1, out2
            for i := 0; i < 2; i++ {
                select {
                case <-done:
                    return
                case a <- v:
                    a = nil
                case b <- v:
                    b = nil
                }
            }
        }
    }()
    return out1, out2
}
```

Effect:
- Buffer 0:    300 ns/op
- Buffer 16:   180 ns/op
- Buffer 256:  140 ns/op
- Buffer 4096: 130 ns/op (diminishing returns)

Trade-off: a larger buffer hides backpressure. If the consumer is permanently slower than the producer, the buffer fills, latency rises, and memory grows by `buf * sizeof(T)`. Pick the smallest buffer that smooths your burst.

Rule of thumb: buffer = peak burst size in events. Beyond that, you are buying false comfort.

---

## Optimization 2: Send Pointers, Not Values

If `T` is a struct larger than ~64 bytes (one cache line), the value is copied three times: once on receive from `in`, once on send to `out1`, once on send to `out2`. Sending a pointer reduces this to header-only copies.

```go
type Event struct {
    /* large fields */
}

// Before: chan Event - each value is copied N times.
// After:  chan *Event - only the pointer is copied.

func produce() <-chan *Event {
    out := make(chan *Event)
    go func() {
        defer close(out)
        for /* ... */ {
            ev := &Event{ /* ... */ }
            out <- ev
        }
    }()
    return out
}
```

Effect on a 256-byte struct:
- Value tee:   500 ns/op (extra bandwidth)
- Pointer tee: 280 ns/op

Caveat: both consumers receive the same pointer. They alias the same memory. Either treat the payload as immutable or refactor to give each consumer its own deep copy.

For payloads under 64 bytes, the pointer optimization may *cost* time due to escape-to-heap and extra indirection. Benchmark to confirm.

---

## Optimization 3: Batch Inputs

If your producer naturally emits in batches (e.g., reading from a network buffer), tee batches instead of individual values:

```go
func TeeBatch[T any](done <-chan struct{}, in <-chan []T) (<-chan []T, <-chan []T) {
    out1 := make(chan []T)
    out2 := make(chan []T)
    go func() {
        defer close(out1)
        defer close(out2)
        for batch := range in {
            a, b := out1, out2
            for i := 0; i < 2; i++ {
                select {
                case <-done:
                    return
                case a <- batch:
                    a = nil
                case b <- batch:
                    b = nil
                }
            }
        }
    }()
    return out1, out2
}
```

If the average batch size is `K`, the per-value overhead drops by a factor of `K`. For K=100, ~3 ns per element vs 300 ns.

Caveats:
- Both consumers share the slice header — aliasing applies in spades.
- Cancellation latency is now bounded by the batch processing time, not the per-value time.
- A consumer that needs per-value granularity must re-loop internally.

This optimization is appropriate for log shipping, metrics, packet capture — anywhere "batch" is the natural unit.

---

## Optimization 4: Shard the Tee

If the producer is single-threaded but downstream is parallel, shard the stream by hash to multiple tees:

```go
func ShardedTee[T any](done <-chan struct{}, in <-chan T, n int, keyFn func(T) uint64) (
    aShards, bShards []<-chan T,
) {
    aShards = make([]<-chan T, n)
    bShards = make([]<-chan T, n)
    inShards := make([]chan T, n)

    for i := range inShards {
        inShards[i] = make(chan T)
        aShards[i], bShards[i] = Tee(done, inShards[i])
    }

    go func() {
        defer func() {
            for _, c := range inShards { close(c) }
        }()
        for v := range in {
            select {
            case <-done:
                return
            case inShards[keyFn(v)%uint64(n)] <- v:
            }
        }
    }()
    return
}
```

This parallelises tee across N goroutines. Each shard has its own pair of outputs; downstream consumers either consume per-shard or merge.

Effect: roughly linear speedup up to the number of cores, until the partitioning goroutine becomes the bottleneck. With N=8 and 8 cores, you might see 20-25 M values/sec aggregate where a single tee was capped at 5 M.

Caveats:
- Order is preserved *within* a shard but not across shards.
- Consumer must accept the shard partitioning (one consumer per shard, or merge-then-process).
- Hashing cost may dominate at very high rates.

This is the right next step when a single tee saturates a core and you have ordering tolerance.

---

## Optimization 5: Replace with SPMC Ring

Past ~20 M values/sec, channels themselves are the bottleneck. A single-producer, multi-consumer ring buffer with atomic cursors achieves 100+ M/sec.

Sketch (full implementation in [`senior.md`](senior.md)):

```go
type Ring[T any] struct {
    buf    []T
    mask   uint64
    w      atomic.Uint64
    ra, rb atomic.Uint64
}
```

Operations:
- `Publish` writes to `buf[w & mask]` then increments `w` atomically. Blocks (spins) when the slowest consumer is `len(buf)` behind.
- `ConsumeA`/`ConsumeB` read from `buf[r & mask]`, increment cursor.

Properties:
- Per-op cost: ~5-15 ns (atomic ops dominate).
- No goroutine hop on the hot path.
- Backpressure preserved via cursor distance.

Drawbacks:
- Spin-wait wastes CPU at low rates.
- Cancellation is not free — needs sentinel value or separate flag.
- Implementation is delicate; bugs are subtle.
- Memory bound: `len(buf) * sizeof(T)`, fixed at startup.

Only reach for this when you have proven channel-based tee is the bottleneck. Most pipelines never need it.

---

## Allocation-Free Tee for Small Types

Tee does not allocate per value in the canonical form (the integer benchmark above shows `0 B/op, 0 allocs/op`). However, two corner cases can introduce allocations:

1. **Interface payloads.** `chan interface{}` or `chan io.Writer` boxes the value, allocating per send for value-typed payloads.
2. **Closures captured inside the goroutine.** If your tee body captures variables that escape to heap, you may see allocations.

For allocation-free tee, ensure:

- `T` is a concrete type, not an interface.
- The tee body uses only stack-allocated locals.
- Generic code is monomorphised per type at compile time (this is automatic in Go 1.18+).

Confirm with `go build -gcflags="-m=2"` and look for "escapes to heap" reports.

---

## Choosing Between Optimizations

| Symptom | First optimization |
|---------|--------------------|
| Tee is in the top 5 of CPU profile | Buffer both sides (cheap to try) |
| Payload struct > 64 bytes | Send pointer (with immutability contract) |
| Producer emits in bursts | Buffer; or batch if upstream supports it |
| Single tee saturates a core, ordering across stream tolerated | Shard |
| Throughput > 20 M/sec | SPMC ring (only after measurement) |
| Allocation per op > 0 | Audit interface boxing, escape analysis |

Layer these. Many high-throughput pipelines use *buffered + pointer + batch* tee and never need to go further. Each layer is a few lines of change and reversible.

---

## Anti-Optimizations to Avoid

### Premature SPMC ring

Tee at 100 K/sec does not need a ring buffer. The operational burden of debugging SPMC code in production is high. Stay with channels until you have a profile that says otherwise.

### Buffer = max-int

Some teams set `buf = 1 << 20` "just in case." This silently swallows backpressure. The first time a consumer wedges, you OOM.

### Custom select implementation

Replacing `select` with a hand-rolled lock-free protocol is dragon territory. The runtime's `selectgo` is heavily optimized and well-tested. Beating it is rare and almost never worth the maintenance cost.

### Spinning instead of selecting

```go
for {
    select {
    case out1 <- v:
        // ok
    default:
        runtime.Gosched()
    }
}
```

This converts a clean blocking send into a busy loop that consumes a core. Use buffered channels for slack; use blocking sends to express intent.

### Mutex-protected list of receivers

```go
type Tee struct {
    mu sync.Mutex
    receivers []chan int
}
```

You are reimplementing pub/sub poorly. Use a real hub.

### Per-value goroutines

```go
for v := range in {
    go func(v int) { out1 <- v }(v)
    go func(v int) { out2 <- v }(v)
}
```

Two goroutines spawned per value, ordering shattered, memory pressure from goroutine stacks. The simple sequential-with-select tee is faster and correct.

---

## Profiling Tee in a Real Pipeline

Tee is rarely the bottleneck on its own. The investigation pattern when you suspect it is:

1. **CPU profile.** `go test -bench -cpuprofile=cpu.out`, then `go tool pprof -http=:8080 cpu.out`. Look for `selectgo` and `chansend`. If they are top-3 in the cumulative time, tee is in the hot path.
2. **Goroutine profile.** `pprof goroutine` shows parked tee goroutines. If you have many "tee" goroutines all parked in `selectgo`, the consumers are the bottleneck, not tee.
3. **Trace.** `go test -bench -trace=trace.out`, then `go tool trace trace.out`. The runtime traces show the actual scheduler activity. A tee goroutine should appear as alternating short on-CPU bursts and sleeps; long off-CPU intervals indicate consumer stalls.

Common findings:

- Tee is hot but consumers are also hot → buffer the outputs.
- Tee is hot but consumers are parked → no problem; producer is the limit.
- Tee is parked, consumers are hot → producer is the limit; tee is just relaying.
- Tee is hot, one consumer is parked → the parked consumer is slow; switch to lossy if acceptable.

Run before optimising. Optimising blindly often makes things worse.

---

## Memory Allocation Audit

A clean tee has zero allocations per value. To audit:

```bash
go test -bench=BenchmarkTee -benchmem -count=5
```

If `B/op` or `allocs/op` are non-zero, find the cause:

1. **Interface boxing.** `chan interface{}` allocates a `runtime.eface` per send for value-typed payloads. Use a concrete type.
2. **Closure escapes.** A closure captured by the tee goroutine that escapes to heap costs one allocation at goroutine spawn (not per value). Check with `go build -gcflags="-m=2"`.
3. **Embedded values.** A struct field that is itself a slice causes the slice header to escape on assignment. Often unavoidable; just be aware.

The first is the only one you can usually fix without rewriting. The others are minor compared to channel overhead.

---

## When Optimization is the Wrong Question

A surprising number of "tee is too slow" reports are really "the consumer is too slow." Tee's overhead is 200-300 ns per value; if the consumer takes 10 ms per value, tee is 0.003% of the work. Optimising tee in that case is rounding-error work.

The question to ask first: **what is the consumer's per-value cost?** If it dominates tee by 10x or more, optimising tee is a waste. Optimise the consumer.

A related anti-pattern: optimising the tee in test environments where consumers are mocked and instantaneous. The benchmark says "tee is the bottleneck!" because everything else is fake. In production with real consumers, tee falls off the profile entirely.

Always benchmark with realistic consumer cost.

---

## Summary

The canonical tee is fast — 300 ns/op, no allocations. Most pipelines never need to optimize it. When you do:

1. **Buffer.** First lever, cheapest, reversible.
2. **Pointers.** Free if you can accept aliasing.
3. **Batch.** Free if upstream emits in batches.
4. **Shard.** Restructures the pipeline; trades order for throughput.
5. **SPMC ring.** Last resort, only after measurement.

Optimization is an investment of complexity for performance. Tee is small enough that small investments pay back well; large investments rarely do. Measure, change one thing, re-measure, repeat. If the change does not pay off, revert. The canonical six-line tee is a fine destination to return to.
