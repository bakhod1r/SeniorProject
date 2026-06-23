# Fan-In — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [Generic Fan-In](#generic-fan-in)
3. [Cancellation with `context.Context`](#cancellation-with-contextcontext)
4. [Comparison with `select`-Based Merging](#comparison-with-select-based-merging)
5. [Backpressure Across Producers](#backpressure-across-producers)
6. [Order and Determinism](#order-and-determinism)
7. [Buffered Output](#buffered-output)
8. [Combining Fan-In with Pipelines](#combining-fan-in-with-pipelines)
9. [Errors in Fan-In](#errors-in-fan-in)
10. [Real-World Patterns](#real-world-patterns)
11. [Idiomatic Code](#idiomatic-code)
12. [Anti-Patterns](#anti-patterns)
13. [Testing Strategy](#testing-strategy)
14. [Performance Profile](#performance-profile)
15. [Tricky Cases](#tricky-cases)
16. [Cheat Sheet](#cheat-sheet)
17. [Summary](#summary)

---

## Introduction

You wrote a classic merge in junior level. Now we tighten it: generics, cancellation, backpressure, and a comparison with the `select` approach. By the end you should be able to write a production-quality fan-in helper that can be dropped into any pipeline.

Three things change at the middle level:

1. The signature becomes generic so the same helper works for any element type.
2. We pass `context.Context` so the merge can be cancelled early without leaking goroutines.
3. We discuss the `select`-based alternative, when it is preferable, and what it cannot do.

---

## Generic Fan-In

Go 1.18 introduced type parameters. The classic merge becomes:

```go
package channels

import "sync"

// Merge fans values from any number of input channels into a single output
// channel. The output is closed when all inputs are closed.
func Merge[T any](cs ...<-chan T) <-chan T {
    out := make(chan T)
    var wg sync.WaitGroup
    wg.Add(len(cs))
    for _, c := range cs {
        go func(c <-chan T) {
            defer wg.Done()
            for v := range c {
                out <- v
            }
        }(c)
    }
    go func() {
        wg.Wait()
        close(out)
    }()
    return out
}
```

`T any` is the constraint. Any element type works: `int`, `string`, `Event`, `*Request`. There is one and only one merge in your codebase from now on.

A typed helper variant for cases where you want to constrain T:

```go
type Identifiable interface{ ID() string }

func MergeIdentified[T Identifiable](cs ...<-chan T) <-chan T { /* ... */ }
```

---

## Cancellation with `context.Context`

The junior version had a quiet bug: if the consumer stops reading early, every forwarder goroutine is stuck forever in `out <- v`. The merge leaks.

The fix is `context.Context`. Pass a `ctx` and have every forwarder treat send as a `select` against `ctx.Done()`:

```go
func Merge[T any](ctx context.Context, cs ...<-chan T) <-chan T {
    out := make(chan T)
    var wg sync.WaitGroup
    wg.Add(len(cs))

    forward := func(c <-chan T) {
        defer wg.Done()
        for {
            select {
            case <-ctx.Done():
                return
            case v, ok := <-c:
                if !ok {
                    return
                }
                select {
                case <-ctx.Done():
                    return
                case out <- v:
                }
            }
        }
    }

    for _, c := range cs {
        go forward(c)
    }

    go func() {
        wg.Wait()
        close(out)
    }()

    return out
}
```

Two `select`s per iteration:
- The first chooses between "input ready" and "context cancelled".
- The second guards `out <- v` against the consumer being gone.

Without both, you can leak in either direction.

Usage:

```go
ctx, cancel := context.WithCancel(context.Background())
defer cancel()
for v := range Merge(ctx, a, b, c) {
    if shouldStop(v) {
        cancel() // forwarders unwind cleanly
        break
    }
}
```

---

## Comparison with `select`-Based Merging

For small, fixed N, you can merge with one goroutine and a single `select`:

```go
func merge2(a, b <-chan int) <-chan int {
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

The trick: setting `a = nil` after close removes that case from `select`. A nil channel never fires.

| Aspect | WaitGroup merge | `select` merge |
|--------|-----------------|----------------|
| N at compile time | Any N | Fixed N |
| Goroutines | N + 1 | 1 |
| Cancellation | Same complexity | Slightly simpler (one select adds a case) |
| Order | Non-deterministic | Non-deterministic |
| Throughput | Higher (parallel forwarders) | Lower for high N (single goroutine bottleneck) |

Rule of thumb: 1-3 inputs known at compile time → `select`. Variadic, dynamic, or > 3 inputs → WaitGroup.

For unbounded *runtime* N you need `reflect.Select` — see senior.md.

---

## Backpressure Across Producers

Merge naturally produces backpressure: if the consumer is slow, every forwarder blocks on `out <- v`. The blocking is *uniform across producers* — fast producers cannot overrun slow ones because all of them feed the same bottleneck.

That uniformity is sometimes a feature, sometimes a problem. Consider:

- **Fairness**: every producer sees the same rate. Good for fan-in of equal-priority sources.
- **Head-of-line blocking**: if one producer is slow to *receive its own input*, the others can still send through merge. But if the merge consumer is slow, every producer slows down.

If you want per-producer rate limits before merging, gate each producer with a token bucket *upstream* of the merge.

---

## Order and Determinism

Merge does not preserve order. A fast producer might dominate the early output. The Go runtime makes no fairness guarantees beyond "every send eventually progresses".

If you need deterministic order, options:

1. **Sort downstream.** Buffer all values and `sort.Slice`. Loses streaming.
2. **Tag and re-sort.** Each value carries a sequence number; downstream emits in order. Adds latency.
3. **Single producer.** Avoid the merge; concatenate channels with `select` and `nil`-trick.

A "stable merge" of channels where each input is itself ordered is sometimes called *k-way merge* and uses a heap. Go's standard library does not ship one; build it from `container/heap`.

---

## Buffered Output

Default unbuffered output is fine for most uses. A small buffer can smooth jitter when one producer briefly pauses:

```go
out := make(chan T, 8)
```

Tune by measurement. A buffer of `len(cs)` is a common starting heuristic; it lets each forwarder stage one value without blocking. Larger buffers hide backpressure problems and grow memory.

---

## Combining Fan-In with Pipelines

A pipeline frequently has a stage that is fan-out + fan-in:

```go
//      ┌──▶ worker 1 ──┐
//  in ─┼──▶ worker 2 ──┼──▶ Merge ──▶ out
//      └──▶ worker 3 ──┘
func Process[T, R any](
    ctx context.Context,
    in <-chan T,
    n int,
    work func(context.Context, T) R,
) <-chan R {
    workers := make([]<-chan R, n)
    for i := 0; i < n; i++ {
        workers[i] = startWorker(ctx, in, work)
    }
    return Merge(ctx, workers...)
}

func startWorker[T, R any](
    ctx context.Context,
    in <-chan T,
    work func(context.Context, T) R,
) <-chan R {
    out := make(chan R)
    go func() {
        defer close(out)
        for {
            select {
            case <-ctx.Done():
                return
            case v, ok := <-in:
                if !ok { return }
                select {
                case <-ctx.Done():
                    return
                case out <- work(ctx, v):
                }
            }
        }
    }()
    return out
}
```

This is the canonical "process N in parallel" pattern. The merge is what reunifies the workers' outputs back into a single channel.

---

## Errors in Fan-In

Three error designs at the middle level:

### Design A: result struct
```go
type Result[T any] struct {
    V   T
    Err error
}
out := Merge(ctx, work1, work2)
for r := range out {
    if r.Err != nil { /* handle */ }
}
```
Pros: simple, single channel. Cons: errors interleaved with data.

### Design B: parallel error channel
```go
type Stage[T any] struct {
    Out  <-chan T
    Errs <-chan error
}
```
Pros: separates concerns. Cons: two merges to manage; consumer must read both.

### Design C: errgroup
```go
g, ctx := errgroup.WithContext(ctx)
out := make(chan T)
for _, c := range cs {
    c := c
    g.Go(func() error {
        for {
            select {
            case <-ctx.Done(): return ctx.Err()
            case v, ok := <-c:
                if !ok { return nil }
                select {
                case <-ctx.Done(): return ctx.Err()
                case out <- v:
                }
            }
        }
    })
}
go func() { _ = g.Wait(); close(out) }()
err := /* later */ g.Wait()
```
Pros: first error cancels everything. Cons: callers must coordinate `Wait`.

For most production code, `errgroup` (Design C) is the cleanest.

---

## Real-World Patterns

### Multi-source feed
A chat client subscribes to N rooms, each on a WebSocket. Each room produces a `<-chan Message`. A single fan-in feeds the UI rendering goroutine.

### Sensor merge
A datacentre has many temperature sensors, each polled by its own goroutine. Their values stream onto per-sensor channels. A merge sends them to a Prometheus exporter that flattens them into a unified time series.

### Multi-region health checks
A health checker probes endpoints in eu-west, us-east, and ap-south. Each region has its own goroutine pushing results onto a per-region channel. A merge aggregates them into one alert pipeline.

### Search aggregator
A search query is sent to N backends in parallel. Each backend writes hits to its own channel. A merge produces the unified hit stream that powers the UI's "live results" display.

In every case the merge is the *seam* between many specialised producers and one general consumer.

---

## Idiomatic Code

```go
// Merge fans the inputs into a single output channel and returns it. The
// output is closed when (a) ctx is cancelled or (b) every input is drained.
//
// The merge does not preserve cross-channel order. Producers must close
// their channels when done.
func Merge[T any](ctx context.Context, cs ...<-chan T) <-chan T
```

A doc comment of this shape is what a code reviewer expects. State:
- The cancellation contract (ctx).
- The closing contract (what the producer must do).
- The order contract (or lack of it).

---

## Anti-Patterns

- **Mutating values inside the forwarder.** A fan-in is glue; transformation belongs in another stage.
- **Sharing one forwarder for two inputs.** Removes the cleanup invariant.
- **Returning `chan T` instead of `<-chan T`.** Lets callers close or send into the merged channel.
- **Buffering by `len(cs) * 1000`.** Hides design problems and pins memory.
- **Hard-coding `select` over a slice of channels.** Use `reflect.Select` (senior) or the WaitGroup pattern.

---

## Testing Strategy

Two kinds of tests:

1. **Functional tests.** Send N values, expect N values out. Use a sorted comparison because order is not preserved.
2. **Cancellation tests.** Send fewer values than will be consumed. Cancel ctx halfway. Assert no goroutine leak after a brief sleep — use `runtime.NumGoroutine()` before/after.

```go
func TestMergeCancel(t *testing.T) {
    ctx, cancel := context.WithCancel(context.Background())
    a := slowGen(1000)
    b := slowGen(1000)
    out := Merge(ctx, a, b)

    var got int
    for range out {
        got++
        if got == 5 { cancel() }
    }

    time.Sleep(10 * time.Millisecond)
    if n := runtime.NumGoroutine(); n > 5 {
        t.Errorf("goroutine leak: %d", n)
    }
}
```

The leak test is fragile across runs; use `goleak` for a robust version.

---

## Performance Profile

A simple benchmark:

```go
func BenchmarkMerge(b *testing.B) {
    chans := make([]<-chan int, 8)
    for i := range chans {
        chans[i] = gen(1000)
    }
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        for range Merge(context.Background(), chans...) {
        }
    }
}
```

On a typical laptop:
- 8 inputs of 1000 values: ~150ns/value end-to-end.
- 64 inputs: ~250ns/value (more goroutine scheduling).
- The bottleneck is the single output channel: every value crosses one synchronisation point.

To go faster, avoid merging hot paths — process per-input streams in parallel and only merge their final aggregates.

---

## Tricky Cases

- **Mixing closed and open inputs.** A closed input drops out of the merge silently. The merge does not error.
- **Long tail.** If 99 inputs are done but one is slow, the merge stays open. Add a per-input timeout if needed.
- **Duplicate channels.** Passing the same channel twice is *not* an error but is rarely intended.
- **Reuse of a closed Merge output.** Don't. The output is single-use.

---

## Cheat Sheet

```go
func Merge[T any](ctx context.Context, cs ...<-chan T) <-chan T {
    out := make(chan T)
    var wg sync.WaitGroup
    wg.Add(len(cs))
    for _, c := range cs {
        go func(c <-chan T) {
            defer wg.Done()
            for {
                select {
                case <-ctx.Done(): return
                case v, ok := <-c:
                    if !ok { return }
                    select {
                    case <-ctx.Done(): return
                    case out <- v:
                    }
                }
            }
        }(c)
    }
    go func() { wg.Wait(); close(out) }()
    return out
}
```

| Decision | Choice |
|----------|--------|
| Fixed small N | `select` merge |
| Variadic / dynamic | WaitGroup merge |
| Need first-error | `errgroup` |
| Need order | k-way merge with heap |

---

## Summary

The middle level upgrades the classic merge with generics, ctx-driven cancellation, and integration with errgroup. You now have the tool to fan multiple producers into one channel safely under cancellation, and to combine fan-in with fan-out into the canonical "fan-out, fan-in" parallelism shape. Ordering is still not guaranteed; use a heap if you need it.
