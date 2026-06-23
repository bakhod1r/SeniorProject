# Pipeline — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Buffer Sizing per Stage](#buffer-sizing-per-stage)
3. [Backpressure Topology](#backpressure-topology)
4. [Splitting and Joining Stages](#splitting-and-joining-stages)
5. [Pipeline Shutdown Semantics](#pipeline-shutdown-semantics)
6. [Memory Implications of Long Pipelines](#memory-implications-of-long-pipelines)
7. [Comparison with Reactive Streams and Akka Streams](#comparison-with-reactive-streams-and-akka-streams)
8. [Error Surfaces](#error-surfaces)
9. [Telemetry](#telemetry)
10. [Production Failure Modes](#production-failure-modes)
11. [Library Design](#library-design)
12. [Cheat Sheet](#cheat-sheet)
13. [Summary](#summary)

---

## Introduction

Senior-level pipeline work is design, instrumentation, and operational discipline. You decide buffer sizes per stage, where to fan out for parallelism, how the pipeline shuts down under load, and how it surfaces errors. The middle-level skeleton stays the same; the engineering changes.

This file assumes fluency with middle-level pipeline material — generic stage signatures, ctx, errgroup.

---

## Buffer Sizing per Stage

The default unbuffered channel imposes strict backpressure: each stage waits for the next to receive. That is correct but causes "stop-and-go" jitter when stages have varying per-item latency.

A buffer of N decouples adjacent stages by N items. The upstream stage can run ahead by N before blocking.

| Buffer | Effect | Use when |
|--------|--------|----------|
| 0 | Strict backpressure, low latency | Default; production-grade if items are uniform |
| 1-8 | Smooths jitter | Stages with bursty per-item cost |
| 16-64 | Hides moderate slowdowns | IO-bound stages with batched downstream |
| 100+ | Hides bottleneck; risk of memory bloat | Almost never appropriate without measurement |
| Unbounded | OOM under load | Never |

The right buffer is rarely a constant; it is a function of stage latency variance. A useful starting point: buffer = `2 * (P99 / median)`. If the slowest stage is 10x its median, give it a buffer of 20.

Document buffer sizes in code:

```go
out := make(chan T, 16) // tuned for parse stage P99=4ms, median=200µs
```

---

## Backpressure Topology

A pipeline is a series of channels. Each channel imposes backpressure based on its buffer. The slowest stage caps throughput.

To find the bottleneck:

1. Add a buffer of 1 to every channel.
2. Instrument each channel with a `len(ch)` gauge.
3. Run under load.
4. The channel whose `len` is consistently full is the *output* of the bottleneck stage.

Once found, options:
- Fan out the bottleneck stage (parallel workers).
- Reduce per-item work in the bottleneck (caching, batching).
- Accept the throughput.

What you should *not* do: ballooning the buffer to "absorb" the bottleneck. That just delays OOM.

---

## Splitting and Joining Stages

Senior pipelines combine fan-out and fan-in around bottleneck stages:

```
              ┌─ enrich (worker 1) ─┐
in ──▶ parse ─┼─ enrich (worker 2) ─┼──▶ Merge ──▶ store
              └─ enrich (worker N) ─┘
```

The pattern looks linear from outside (parse → enrich → store), but inside `enrich` it is parallel. Implementation:

```go
func parallel[T, R any](
    ctx context.Context,
    in <-chan T,
    n int,
    work func(context.Context, T) R,
) <-chan R {
    workers := make([]<-chan R, n)
    for i := 0; i < n; i++ {
        workers[i] = oneWorker(ctx, in, work)
    }
    return Merge(ctx, workers...)
}

// usage
out := store(ctx, parallel(ctx, parse(ctx, in), 8, enrich))
```

Multiple parallel stages can be chained; use independent worker counts per stage.

For pipelines where order matters within a key (e.g. events for the same user must stay ordered), partition by key into separate pipelines:

```
                     ┌── pipeline A (user 1, 4, 7) ──┐
in ─▶ partitioner ───┼── pipeline B (user 2, 5, 8) ──┼── Merge ─▶ store
                     └── pipeline C (user 3, 6, 9) ──┘
```

Each sub-pipeline processes its keys serially; cross-key ordering is sacrificed.

---

## Pipeline Shutdown Semantics

Three shutdown modes, each with different code:

### Graceful: drain to completion
The producer closes the input. Each stage drains, closes its output. Consumer's `range` exits. Ctx is *not* cancelled. Used at end-of-batch.

### Abrupt: cancel ctx
Ctx cancel propagates. Every stage exits ASAP, possibly mid-item. In-flight items are lost. Used for "stop everything now."

### Hybrid: cancel-after-deadline
Cancel ctx after a timeout, but allow stages to finish their current item. The two-select sandwich does exactly this: ctx is checked at receive and send, but mid-item work runs to completion.

Document which mode your pipeline supports. Mixing them silently leads to in-flight loss.

A typical production pipeline:

```go
func Run(parent context.Context, sources []<-chan Event) error {
    ctx, cancel := context.WithTimeout(parent, 5*time.Second)
    defer cancel()

    g, ctx := errgroup.WithContext(ctx)
    in := merge(sources)
    parsed := parse(ctx, in)
    enriched := parallel(ctx, parsed, 8, enrich)
    g.Go(func() error { return store(ctx, enriched) })

    return g.Wait() // returns first error or ctx deadline
}
```

---

## Memory Implications of Long Pipelines

A pipeline with K stages, each with buffer B, holds up to `K * B` items in flight. If items are large (e.g. 1 MB image data), this is *real memory*.

Consider an image pipeline: read → decode → resize → encode → upload. With buffer 16 per channel and 5 stages, that is 80 images in flight. At 4 MB per decoded image, 320 MB of memory.

Mitigations:

- Use small buffers (1-8) on stages handling large items.
- Reuse buffers via `sync.Pool`.
- Stream via `io.Reader` rather than materialising in memory.
- Cap parallelism on memory-heavy stages.

The senior judgement: trade throughput for memory deliberately, with measurement.

---

## Comparison with Reactive Streams and Akka Streams

Other ecosystems have similar concepts:

| Concept | Go pipeline | Reactive Streams (Java) | Akka Streams (Scala) |
|---------|-------------|------------------------|----------------------|
| Stage | function returning `<-chan T` | `Publisher`/`Processor`/`Subscriber` | `Source`/`Flow`/`Sink` |
| Backpressure | Channel buffer + blocking send | Demand-pull (request(n)) | Demand-pull |
| Cancellation | Ctx cancel | `Subscription.cancel` | Stream cancellation |
| Composition | Function composition | DSL with `.map`, `.filter` | Graph DSL |
| Errors | Result struct or errgroup | `onError` callback | `Failure` materialised |

Go's pipelines are simpler and lower-level. Reactive Streams' demand-pull model is more efficient for fan-in/out at large scale because backpressure is explicit (a downstream consumer "requests N items"). Go's blocking-send model achieves the same effect implicitly via channels.

If you need composition like `.map(f).filter(p).take(n)`, you can build it in Go with stage helpers but the readability is lower than a fluent DSL. For most production code, explicit pipelines are clear enough.

---

## Error Surfaces

A pipeline has several places to expose errors:

1. **Per-item errors** in a `Result` struct. Best for "continue on error" workflows.
2. **A single error returned at end** via `errgroup.Wait`. Best for "stop on first error."
3. **A separate error channel** per stage. Best when stages have different error semantics.
4. **A logger callback** invoked from each stage. Best for telemetry-only errors.

Choose deliberately. Mixed strategies (some errors in struct, some via group) are confusing.

---

## Telemetry

Each stage should emit:

- Items processed total (counter).
- Errors total (counter, by class).
- Item duration (histogram).
- Input queue depth (gauge, sampled periodically).

A wrapper:

```go
func observed[In, Out any](
    name string,
    inner func(context.Context, <-chan In) <-chan Out,
    metrics *Metrics,
) func(context.Context, <-chan In) <-chan Out {
    return func(ctx context.Context, in <-chan In) <-chan Out {
        instrumentedIn := tap(ctx, in, name, metrics)
        return inner(ctx, instrumentedIn)
    }
}
```

Wrap each stage at the call site:

```go
parsed := observed("parse", parseStage, metrics)(ctx, raw)
```

Names line up with metric labels and dashboards.

---

## Production Failure Modes

### Slow stage hides a memory leak
A bottleneck stage with a large buffer absorbs jitter — until upstream rate exceeds it. Memory grows. OOM. Symptom: rising RSS over hours/days. Fix: cap the buffer; alert on `len(ch) / cap(ch) > 0.9`.

### A panic kills a stage
The stage's output never closes; downstream hangs. Add `defer recover()` and a clear restart policy, or accept process-level crash.

### Ctx cancelled but in-flight items dropped silently
"Cancel ctx mid-stream" loses items. If your domain cannot lose items, switch to graceful shutdown (close input, wait for drain). Document which is which.

### A stage forgets to forward errors
The Result type is per-stage, and a stage that doesn't propagate `Err` swallows them. Code review must check every stage for error forwarding.

### Cycles
Connecting stage 3's output to stage 1's input creates a cycle. The pipeline can deadlock when both directions are full. Pipelines are DAGs.

### Backpressure to an unkillable producer
If the producer is an event stream that cannot block (e.g. an HTTP handler), backpressure causes drops or rejected requests. Either rate-limit upstream or use a bounded queue with explicit "drop" policy.

---

## Library Design

A senior-level pipeline library exposes:

```go
// Stage transforms each value from `in` into one or more values on the
// returned channel. The output is closed when (a) `in` is drained or (b)
// `ctx` is cancelled. Implementations must use the two-select sandwich.
type Stage[In, Out any] func(context.Context, <-chan In) <-chan Out

// Map returns a one-to-one stage that applies f.
func Map[In, Out any](f func(In) Out) Stage[In, Out]

// FlatMap returns a one-to-many stage.
func FlatMap[In, Out any](f func(In) []Out) Stage[In, Out]

// Filter returns a stage that drops values where pred is false.
func Filter[T any](pred func(T) bool) Stage[T, T]

// Take stops after n values.
func Take[T any](n int) Stage[T, T]

// Parallel runs `n` copies of `inner` and merges them.
func Parallel[In, Out any](inner Stage[In, Out], n int) Stage[In, Out]

// Buffer wraps a stage with a buffered output channel.
func Buffer[In, Out any](inner Stage[In, Out], n int) Stage[In, Out]

// Observe wraps a stage with telemetry.
func Observe[In, Out any](inner Stage[In, Out], name string, m *Metrics) Stage[In, Out]
```

Composable, named, generic. Each stage is independently testable. The library is small (a few hundred lines) but enables complex production pipelines.

---

## Cheat Sheet

| Need | Lever |
|------|-------|
| Smooth jitter | small buffer (1-8) |
| Bottleneck stage | `Parallel(stage, n)` |
| Per-key order | partition + sub-pipelines |
| Graceful drain | close input, no ctx cancel |
| Abrupt stop | ctx cancel |
| Errors | `errgroup` or Result struct |
| Telemetry | wrap each stage with `Observe` |

---

## Summary

Senior-level pipeline work is buffer sizing, backpressure analysis, parallelism placement, shutdown semantics, error strategy, and telemetry. The middle-level skeleton (ctx + two-select sandwich + uniform stage signature) remains; what changes is the deliberate engineering around it. With these tools you can build pipelines that survive production load, deploy predictably, and shut down cleanly.
