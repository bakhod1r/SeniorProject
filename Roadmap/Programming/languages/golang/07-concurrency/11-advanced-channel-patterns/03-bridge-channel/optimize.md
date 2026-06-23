# Bridge-Channel — Optimisation

A guided tour from "the canonical bridge" to "a bridge that holds up at 10 million values per second." Each section presents a baseline, a profiler observation, and a transformation. Apply only the optimisations that pay off in your specific profile.

---

## Baseline

```go
func Bridge[T any](ctx context.Context, cs <-chan <-chan T) <-chan T {
    out := make(chan T)
    go func() {
        defer close(out)
        for {
            var stream <-chan T
            select {
            case <-ctx.Done():
                return
            case s, ok := <-cs:
                if !ok {
                    return
                }
                stream = s
            }
            for v := range OrDone(ctx, stream) {
                select {
                case <-ctx.Done():
                    return
                case out <- v:
                }
            }
        }
    }()
    return out
}
```

Cost per value: ~3 channel operations + 1 goroutine context switch + the consumer-side select. On modern x86-64, this is on the order of 100–300 ns.

For most workloads, optimising bridge is premature. Make sure your profile shows bridge as a hot spot before changing anything.

---

## Optimisation 1 — Inline OrDone

`OrDone` adds one extra goroutine per inner channel and one extra channel hop per value. Inlining removes both.

```go
func BridgeInlined[T any](ctx context.Context, cs <-chan <-chan T) <-chan T {
    out := make(chan T)
    go func() {
        defer close(out)
        for {
            var stream <-chan T
            select {
            case <-ctx.Done():
                return
            case s, ok := <-cs:
                if !ok {
                    return
                }
                stream = s
            }
        inner:
            for {
                select {
                case <-ctx.Done():
                    return
                case v, ok := <-stream:
                    if !ok {
                        break inner
                    }
                    select {
                    case <-ctx.Done():
                        return
                    case out <- v:
                    }
                }
            }
        }
    }()
    return out
}
```

Benchmark: typically 20–30% faster than the OrDone-wrapped version, because each value goes through one fewer channel.

Trade-off: less reuse, more code, harder to spot bugs. Use only on measured hot paths.

---

## Optimisation 2 — Batch values

The single largest throughput win for any channel pipeline: send batches, not individuals.

Instead of `<-chan T`, use `<-chan []T`:

```go
type Batch[T any] = []T

func Bridge[T any](ctx context.Context, cs <-chan <-chan Batch[T]) <-chan Batch[T] { /* same body */ }
```

Now each channel op carries a whole batch. If batches contain 1000 values each, channel overhead drops by 1000×.

Trade-off: latency for the first value in a batch is higher (must wait for the batch to fill); memory pressure is bursty.

When batching applies: high-throughput ETL, log shipping, bulk writes. When it doesn't: low-latency interactive pipelines.

---

## Optimisation 3 — Buffered inner channels

Inner channel buffering absorbs producer-side bursts:

```go
inner := make(chan T, 64)
```

The inner channel can hold 64 values before the producer blocks. If bridge picks up the inner channel and drains it at the consumer's pace, the producer has already had time to produce more — overlapping production with consumption.

When buffering helps: producers do bursty work (e.g. parse a page, then idle waiting for network).

When buffering hurts: memory-constrained systems; latency-sensitive pipelines (older values sit in the buffer).

Rule of thumb: small buffers (4–64) absorb burstiness; large buffers (>1000) hide problems.

---

## Optimisation 4 — Unbuffered outer, buffered output

The output channel is canonically unbuffered. Sometimes a small buffer (1–4) hides momentary consumer hiccups without breaking backpressure:

```go
out := make(chan T, 4)
```

Profile before adopting. If the consumer is steady, a buffered output adds latency without throughput.

---

## Optimisation 5 — Use `iter.Seq` for synchronous consumers

If your consumer is single-goroutine and synchronous, `iter.Seq[T]` (Go 1.23+) skips both the helper goroutine and the channel:

```go
func BridgeSeq[T any](cs <-chan <-chan T) iter.Seq[T] {
    return func(yield func(T) bool) {
        for stream := range cs {
            for v := range stream {
                if !yield(v) {
                    return
                }
            }
        }
    }
}
```

Cost per value: one function call. No goroutine, no channel.

Trade-off: no concurrency between producer and consumer. If your producer goroutine is independent of the consumer's pace, this isn't a fit.

Benchmark in practice: 5–10× faster than the channel-based bridge for synchronous workloads.

---

## Optimisation 6 — Reduce GC pressure

Bridge itself allocates one channel per call and one OrDone channel per inner. For 10K inner channels per second, this is ~20K allocations per second — not terrible, but visible.

Pooling channels with `sync.Pool` is rarely worth it; channels carry runtime state. Instead:

- Reuse the bridge instance across multiple `chanStream`s by exposing a higher-level API.
- Move to `iter.Seq` where possible — no per-instance channel allocation.

For `T` types that are large structs, consider passing pointers `*T` instead of values, but then you pay GC cost on the values themselves. Profile both.

---

## Optimisation 7 — Replace channels with ring buffer where applicable

For single-producer-single-consumer cases at extreme throughput (>10M values/sec), channels are too slow. A lock-free ring buffer is faster.

```go
type SPSCRing[T any] struct {
    buf  []T
    head atomic.Uint64
    tail atomic.Uint64
}
```

Bridge then becomes a goroutine that reads from one ring buffer per inner "channel" and writes to one output ring buffer.

Cost: complexity, lost compatibility with the rest of Go's channel ecosystem. Reserved for truly hot paths.

---

## Optimisation 8 — Avoid `interface{}` boxing

Pre-generics bridges used `interface{}` element types. Every value through the bridge was boxed (allocated on the heap if larger than a word, or with a tag). Generics eliminate this.

If you find code still using `chan interface{}`, migrating to generics is free throughput.

---

## Optimisation 9 — Profile-guided inlining

Go 1.20+ supports profile-guided optimisation (`-pgo`). For bridge, this can:

- Inline the inner `select` if the goroutine is hot.
- Devirtualise interface calls if `T` is an interface and the call site sees few concrete types.

Run a representative workload, capture a profile, and rebuild with `-pgo`. Easy wins of 5–15% on hot pipelines.

---

## Optimisation 10 — Eliminate bridge when not needed

The biggest optimisation: don't use bridge if you don't need streaming.

If your "stream of streams" is actually a fixed-size slice of slices computed at start-up, just iterate it:

```go
for _, page := range pages {
    for _, row := range page {
        process(row)
    }
}
```

Zero goroutines, zero channels, sequential. Bridge's value is in lazy streaming, cancellation, and concurrent producers. If none of those apply, skip it.

---

## Optimisation 11 — Pre-fetch inner channels

If inner channels arrive slowly from the producer (e.g. one per HTTP round-trip), bridge sits idle waiting. Pre-fetching has the producer emit the next inner channel before bridge needs it:

```go
out := make(chan (<-chan T), 1) // buffer 1
```

Now the producer can prepare the next page while bridge drains the current. Latency hidden.

This is the only place buffering the outer channel is justified, and even then keep the buffer small (1–4).

---

## Optimisation 12 — Use `runtime.LockOSThread` for bridge's goroutine

For ultra-low-latency, locking bridge's goroutine to an OS thread prevents the scheduler from moving it around. Useful for sub-microsecond per-value pipelines.

```go
go func() {
    runtime.LockOSThread()
    defer runtime.UnlockOSThread()
    // bridge loop
}()
```

Specialist optimisation. Rarely justified.

---

## Optimisation 13 — Eliminate `defer close` overhead

`defer close(out)` adds a small overhead (~5 ns per goroutine exit). For bridges with very short lifetimes, this matters in microbenchmarks.

Replace with an explicit `close(out)` at the end of the function body:

```go
go func() {
    for {
        // ...
        if shouldExit {
            close(out)
            return
        }
    }
}()
```

Trade-off: every return path must remember to close. Error-prone. Use only after measurement.

---

## Optimisation 14 — Specialise bridge for fixed types

Generic bridge is monomorphised by the compiler per-type. The compiled code is type-specific and reasonably fast. But generics in Go (as of 1.22) use a "dict-passing" approach for some shapes, which can be slower than fully monomorphised C++ templates.

For an extreme hot path, write a non-generic bridge for your specific `T`:

```go
func BridgeRows(ctx context.Context, cs <-chan <-chan Row) <-chan Row { /* ... */ }
```

Measure. The improvement is typically 0–10%.

---

## Optimisation 15 — Pipeline-wide profiling

The most common waste in bridge optimisation: optimising bridge when the bottleneck is elsewhere.

Steps:

1. Run a representative workload.
2. Capture `pprof -cpu` and `pprof -mem` profiles.
3. Identify the top 5 functions.
4. Optimise the top function, not bridge, unless bridge appears in the top 5.

Bridges in well-designed pipelines almost never dominate CPU. The consumer's work is usually the bottleneck.

---

## Summary

Bridge is small enough that micro-optimising it rarely produces big wins. The order of optimisations by impact:

1. Use generics (free).
2. Don't buffer the output (correctness, not speed — but unbuffered is faster in steady state).
3. Batch values into slices (10–1000× throughput).
4. Use `iter.Seq` for synchronous consumers (5–10×).
5. Inline OrDone (1.2–1.3×).
6. PGO (1.05–1.15×).
7. Buffered inner channels for bursty producers (workload-dependent).
8. Specialise for fixed types (0–1.1×).
9. Drop channels entirely for SPSC ring buffers (only if you really need it).

Apply only what your profile demands. Most code wants the readable canonical bridge.
