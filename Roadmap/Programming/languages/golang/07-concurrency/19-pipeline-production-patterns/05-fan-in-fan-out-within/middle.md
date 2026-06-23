---
layout: default
title: Fan-In Fan-Out Within — Middle
parent: Fan-In Fan-Out Within
grand_parent: Pipeline Production Patterns
ancestor: Go
nav_order: 3
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/19-pipeline-production-patterns/05-fan-in-fan-out-within/middle/
---

# Fan-In / Fan-Out Inside a Pipeline — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Production-Grade Merges](#production-grade-merges)
6. [Ordered Merge](#ordered-merge)
7. [Backpressure in Practice](#backpressure-in-practice)
8. [Error Handling at Scale](#error-handling-at-scale)
9. [Real-World Analogies](#real-world-analogies)
10. [Mental Models](#mental-models)
11. [Pros & Cons](#pros-cons)
12. [Use Cases](#use-cases)
13. [Code Examples](#code-examples)
14. [Coding Patterns](#coding-patterns)
15. [Clean Code](#clean-code)
16. [Product Use / Feature](#product-use-feature)
17. [Performance Tips](#performance-tips)
18. [Best Practices](#best-practices)
19. [Edge Cases & Pitfalls](#edge-cases-pitfalls)
20. [Common Mistakes](#common-mistakes)
21. [Common Misconceptions](#common-misconceptions)
22. [Tricky Points](#tricky-points)
23. [Test](#test)
24. [Tricky Questions](#tricky-questions)
25. [Cheat Sheet](#cheat-sheet)
26. [Self-Assessment Checklist](#self-assessment-checklist)
27. [Summary](#summary)
28. [What You Can Build](#what-you-can-build)
29. [Further Reading](#further-reading)
30. [Related Topics](#related-topics)
31. [Diagrams & Visual Aids](#diagrams-visual-aids)

---

## Introduction
> Focus: "How do real production fan-out / fan-in pipelines look? How do I preserve order? How do I propagate errors? When does fan-out actually help?"

At the junior level you learned the mechanics: workers, merges, closers, and the rules about who closes what. At the middle level you build pipelines that ship — that survive partial failure, slow downstreams, ordering requirements, and the inevitable moment when someone wants to add metrics.

The middle level is about three things:

1. **Production-grade structure.** Real merges are wrapped in stages that own their own goroutines, expose `<-chan T` ports, and accept `context.Context`. The shape gets formal: every stage is a function `func(ctx, in) (out, err)` or `func(ctx, in) out` for infallible stages.
2. **Ordering.** Many real applications need the output in the same order as the input. The plain merge does not give you that. You need a sequence-number tag, a small reorder buffer, or a per-worker output that the consumer round-robins through.
3. **Behaviour under failure.** What happens when one worker errors? When the consumer dies? When the context is cancelled mid-flight? The patterns are well-known, and middle-level Go is where they become reflexes.

We will also tighten the discussion of backpressure — when to buffer, how much, and what buffering costs. And we will introduce a few new merge variants: ordered merge by sequence number, weighted merge by source priority, and a merge with a per-input timeout that drops slow sources.

After this file you should be able to:

- Build a multi-stage pipeline with fan-out at every stage that requires parallelism.
- Implement an ordered merge with a small reorder buffer.
- Use `errgroup.Group` for fan-out with first-error cancellation.
- Tune buffer sizes based on the consumer's rate.
- Detect goroutine leaks in CI using `goleak` or a manual `runtime.NumGoroutine` check.
- Pick the right fan-out factor based on whether work is CPU- or I/O-bound.

We will not yet cover `reflect.Select` for dynamic merges or the runtime internals of select. Those are senior and professional concerns.

---

## Prerequisites

- **Required:** The junior file's content — canonical `merge`, worker pools, ownership rules, the closer pattern.
- **Required:** Solid `context.Context` use. You can `WithCancel`, `WithTimeout`, `WithDeadline`, and you select on `ctx.Done()` in every blocking operation.
- **Required:** You have written tests that use `go test -race` and you know how to interpret the output.
- **Required:** Comfort with `errgroup.Group` from `golang.org/x/sync/errgroup`. If not, read the docs first; it is a 50-line file you can read in five minutes.
- **Helpful:** Some exposure to `container/heap`. Ordered merge can be built on a min-heap.
- **Helpful:** You have profiled at least one Go program with `pprof` and seen the goroutine profile.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Ordered merge** | A merge that emits values in a specified order — typically by sequence number assigned at input. |
| **Reorder buffer** | A small in-memory structure (heap or ring buffer) that holds out-of-order results until the in-order successor arrives. |
| **Sequence tag** | An integer (or hash, timestamp) attached to each input so the consumer can later reorder. |
| **`errgroup.Group`** | A small wrapper over `sync.WaitGroup` plus error capture and `context.Context` cancellation. |
| **Bounded fan-out** | A fan-out with a fixed worker count, independent of input size. |
| **Unbounded fan-out** | One goroutine per input. Almost always wrong at production scale. |
| **Buffer size** | The capacity argument to `make(chan T, n)`. Affects backpressure and latency. |
| **Tail latency** | The slowest p99 or p999 of a sequence of operations. Often more important than mean. |
| **Stage** | A pipeline component: takes input channel(s), returns output channel(s). |
| **Hot loop** | A `for range ch` plus `select` that runs on every channel value. |
| **Drop policy** | What to do when a channel is full and you cannot block: drop oldest, drop newest, or block. |
| **`goleak`** | A small library that fails a test when goroutines leak: `goleak.VerifyNone(t)`. |
| **Reactive backpressure** | The general system property: the upstream's rate is throttled by the downstream's. |

---

## Core Concepts

### A stage is a typed function

A production pipeline is composed of named stages, each shaped like:

```go
func stage(ctx context.Context, in <-chan In) <-chan Out
```

or for stages that can fail:

```go
func stage(ctx context.Context, in <-chan In) (<-chan Out, <-chan error)
```

or, more commonly, the stage wraps each value with an error:

```go
type Result[T any] struct {
    Value T
    Err   error
}
func stage(ctx context.Context, in <-chan In) <-chan Result[Out]
```

Each stage's contract is: it spawns its own goroutines, closes its own output channel(s), and respects `ctx.Done()` for cancellation.

A pipeline is just a sequence of stage calls:

```go
in := source(ctx)
parsed := parse(ctx, in)
hashed := hash(ctx, parsed)
out := mergeResults(ctx, fanOut(ctx, hashed, 8)...)
for r := range out {
    consume(r)
}
```

Fan-out is one of those stages; fan-in is another. They compose like any other transformer.

### Order is a separate concern from parallelism

A frequent design mistake: "I want this pipeline to be parallel and in-order, so I will use a single-worker pipeline." But that is sequential, not in-order parallel. The right structure is:

1. Tag every input with a sequence number.
2. Fan out the work in parallel (order lost).
3. Reorder by sequence number at the end.

The reorder buffer is a small heap keyed on sequence number. Out-of-order arrivals are held; in-order arrivals (those matching the expected next sequence) are emitted immediately. The buffer typically stays small if the workers' completion times do not vary wildly.

This is the canonical pattern for "parallel and ordered" pipelines.

### Bounded fan-out is the default

Junior-level fan-out is often "spawn one worker per input." That is unbounded fan-out. It works for small inputs and breaks for large ones — memory bloats, scheduler thrashes, downstream services get rate-limited.

Production fan-out is **bounded**: a fixed number of workers (8, 64, or `NumCPU` depending on the work) sharing a single input channel. The workers compete for items; whoever is free takes the next one.

For CPU-bound work, bound to `NumCPU` or slightly less.

For I/O-bound work, bound to whatever the downstream can sustain: connection pool size, rate limit budget, etc.

Almost never spawn `len(input)` goroutines.

### `errgroup.Group` is the production primitive

For fan-out with error handling, `errgroup.Group` from `golang.org/x/sync/errgroup` is the workhorse. The pattern:

```go
g, ctx := errgroup.WithContext(ctx)
for i := 0; i < N; i++ {
    g.Go(func() error {
        return doWork(ctx)
    })
}
if err := g.Wait(); err != nil {
    return fmt.Errorf("pipeline: %w", err)
}
```

Properties:

- First worker error cancels the group's context.
- Other workers see `ctx.Done()` and exit (if they are well-written).
- `g.Wait()` returns the *first* error or `nil`.
- Built-in bounded variant: `g.SetLimit(N)` caps concurrent `Go` calls.

For fan-out / fan-in with errors, `errgroup` is almost always the right starting point.

### Backpressure works on a *rate*, not on a count

People think of buffers as "how many items can sit in the channel." The more useful view: a buffer is a *time window* — the producer can run for buffer-size / rate seconds before backpressure kicks in.

If your producer runs at 1000 items/sec and you buffer 100, the producer can run for 0.1 seconds without consumer feedback. If your producer's bursty maximum is 5000 items/sec for 50 ms, a buffer of 250 absorbs the burst.

Sizing buffers is an exercise in matching producer burstiness to consumer mean throughput. Default to unbuffered (no smoothing) and add buffer only when you see consumer-side variability that you want to absorb.

### Cancellation paths must converge

In a multi-stage pipeline, cancellation can come from:

- The caller (`cancel()` on the parent context).
- An error from one worker (via `errgroup`).
- A timeout (`WithTimeout`).
- A panic recovered locally.

Whichever happens first, the cancellation needs to reach every stage. The way: pass the same context (or a derived one) to every stage; have every stage select on `<-ctx.Done()`. If any stage forgets, that stage leaks.

A test that runs the pipeline, cancels, and then checks `runtime.NumGoroutine` is the easiest leak-detection tool. Even better: `goleak.VerifyNone(t)` at the end of every test.

---

## Production-Grade Merges

### A merge that respects `context.Context`

The starting point for everything in this file:

```go
func merge[T any](ctx context.Context, cs ...<-chan T) <-chan T {
    out := make(chan T)
    var wg sync.WaitGroup
    wg.Add(len(cs))
    for _, c := range cs {
        c := c
        go func() {
            defer wg.Done()
            for v := range c {
                select {
                case out <- v:
                case <-ctx.Done():
                    return
                }
            }
        }()
    }
    go func() {
        wg.Wait()
        close(out)
    }()
    return out
}
```

This is the standard. Memorise it. The senior variant uses `reflect.Select` for dynamic input lists; the professional variant studies its scheduling cost. The middle-level version is this 18 lines.

### A merge that respects buffer pressure on the input side

Sometimes the inputs themselves are slow. A forwarder that selects on both `<-c` and `<-ctx.Done()` simultaneously:

```go
for {
    select {
    case v, ok := <-c:
        if !ok {
            return
        }
        select {
        case out <- v:
        case <-ctx.Done():
            return
        }
    case <-ctx.Done():
        return
    }
}
```

Outer select waits for either a value from the input or cancellation. Inner select forwards the value or notices cancellation mid-send. This is slightly more code than `for v := range c { ... }`, but it cancels faster when both the input and the output are slow.

### A merge with per-input timeouts

If one source is very slow, you may want to drop it after a timeout:

```go
func mergeTimeout[T any](ctx context.Context, perInputTimeout time.Duration, cs ...<-chan T) <-chan T {
    out := make(chan T)
    var wg sync.WaitGroup
    wg.Add(len(cs))
    for _, c := range cs {
        c := c
        go func() {
            defer wg.Done()
            t := time.NewTimer(perInputTimeout)
            defer t.Stop()
            for {
                if !t.Stop() {
                    select { case <-t.C: default: }
                }
                t.Reset(perInputTimeout)
                select {
                case v, ok := <-c:
                    if !ok {
                        return
                    }
                    select {
                    case out <- v:
                    case <-ctx.Done():
                        return
                    }
                case <-t.C:
                    return // slow input dropped
                case <-ctx.Done():
                    return
                }
            }
        }()
    }
    go func() {
        wg.Wait()
        close(out)
    }()
    return out
}
```

The forwarder resets a timer between values. If a value does not arrive within `perInputTimeout`, the forwarder returns, effectively dropping that input. Useful for hedged requests where one of N replicas is allowed to be slow.

### A merge that preserves a count of remaining inputs

Sometimes you want to know how many inputs are still live (for metrics). Maintain a counter using `atomic`:

```go
func mergeWithLive[T any](ctx context.Context, live *atomic.Int64, cs ...<-chan T) <-chan T {
    out := make(chan T)
    var wg sync.WaitGroup
    wg.Add(len(cs))
    live.Store(int64(len(cs)))
    for _, c := range cs {
        c := c
        go func() {
            defer wg.Done()
            defer live.Add(-1)
            for v := range c {
                select {
                case out <- v:
                case <-ctx.Done():
                    return
                }
            }
        }()
    }
    go func() {
        wg.Wait()
        close(out)
    }()
    return out
}
```

The metric `live.Load()` tells you how many inputs are still producing. Useful for dashboards.

---

## Ordered Merge

This is the section that often surprises middle-level engineers: ordered merge is not provided by the standard library, and the patterns are subtle.

### The problem

You have a fan-out of workers. The input is ordered (rows 1, 2, 3, ...). The output should be in the same order, but the workers process at different speeds and finish out of order.

Naive merge produces `1, 3, 2, 5, 4, ...`. You need `1, 2, 3, 4, 5, ...`.

### Solution 1: Tag-and-reorder

Tag each input with its sequence number. The workers preserve the tag. A reorder stage holds out-of-order results until the next expected sequence arrives.

```go
type Tagged[T any] struct {
    Seq int
    Val T
}

func tag[T any](ctx context.Context, in <-chan T) <-chan Tagged[T] {
    out := make(chan Tagged[T])
    go func() {
        defer close(out)
        n := 0
        for v := range in {
            select {
            case out <- Tagged[T]{Seq: n, Val: v}:
                n++
            case <-ctx.Done():
                return
            }
        }
    }()
    return out
}

func reorder[T any](ctx context.Context, in <-chan Tagged[T]) <-chan T {
    out := make(chan T)
    go func() {
        defer close(out)
        next := 0
        pending := make(map[int]T)
        for r := range in {
            pending[r.Seq] = r.Val
            for {
                v, ok := pending[next]
                if !ok {
                    break
                }
                select {
                case out <- v:
                case <-ctx.Done():
                    return
                }
                delete(pending, next)
                next++
            }
        }
    }()
    return out
}
```

Pipeline:

```go
tagged := tag(ctx, source)
results := pool(ctx, tagged, N, work)
ordered := reorder(ctx, results)
```

The `reorder` stage uses a map indexed by sequence number. When result with `seq = next` arrives, it is emitted; if subsequent sequences are already in the map, they are emitted too. Out-of-order arrivals sit in the map.

### Solution 2: Heap-based reorder

If sequence numbers may be sparse or unbounded, use a min-heap instead of a map:

```go
import "container/heap"

type item[T any] struct {
    Seq int
    Val T
}

type minHeap[T any] []item[T]

func (h minHeap[T]) Len() int            { return len(h) }
func (h minHeap[T]) Less(i, j int) bool  { return h[i].Seq < h[j].Seq }
func (h minHeap[T]) Swap(i, j int)       { h[i], h[j] = h[j], h[i] }
func (h *minHeap[T]) Push(x any)         { *h = append(*h, x.(item[T])) }
func (h *minHeap[T]) Pop() any           { old := *h; n := len(old); x := old[n-1]; *h = old[:n-1]; return x }

func reorderHeap[T any](ctx context.Context, in <-chan Tagged[T]) <-chan T {
    out := make(chan T)
    go func() {
        defer close(out)
        next := 0
        h := &minHeap[T]{}
        for r := range in {
            heap.Push(h, item[T]{Seq: r.Seq, Val: r.Val})
            for h.Len() > 0 && (*h)[0].Seq == next {
                top := heap.Pop(h).(item[T])
                select {
                case out <- top.Val:
                case <-ctx.Done():
                    return
                }
                next++
            }
        }
    }()
    return out
}
```

Same idea, different data structure. Heap is more efficient when the queue grows large or the sequence numbers are sparse.

### Solution 3: Per-worker output, round-robin merge

Pre-assign each input to a specific worker by index. Each worker writes to its own output channel. The consumer round-robins through the worker outputs in input order.

```go
func roundRobinMerge[T any](ctx context.Context, cs []<-chan T) <-chan T {
    out := make(chan T)
    go func() {
        defer close(out)
        n := len(cs)
        for i := 0; ; i = (i + 1) % n {
            v, ok := <-cs[i]
            if !ok {
                return // one stream done; in practice you handle more carefully
            }
            select {
            case out <- v:
            case <-ctx.Done():
                return
            }
        }
    }()
    return out
}
```

The catch: round-robin requires each worker to receive items in input order. If worker 0 gets inputs 0, 3, 6, 9, ..., and worker 1 gets 1, 4, 7, 10, ..., and worker 2 gets 2, 5, 8, 11, ..., then round-robin reads in order. The dispatcher must do the assignment, not the runtime.

This works well when work per input is uniform. When it is skewed (some inputs take much longer), round-robin starves: a slow worker holds up the merge.

### Solution 4: Strict in-order pipeline (no parallelism)

Sometimes the cleanest answer is: do not parallelise. A single-goroutine transformer preserves order automatically. If the per-item work is small or the parallelism gain is marginal, sequential is simpler and provably correct.

A useful question: how much speedup do you need? If 2x is enough, two workers + a tiny reorder buffer is the right answer. If 10x, full fan-out with sequence tagging. If 1.1x, do not bother.

### Choosing among the solutions

| Solution | When to use |
|----------|------------|
| Tag-and-reorder (map) | Dense sequence numbers, small reorder window |
| Tag-and-reorder (heap) | Sparse or unbounded sequences, larger window |
| Round-robin | Uniform work per item, no straggler workers |
| Sequential | Per-item work is fast; parallelism overhead outweighs gain |

Most production pipelines use tag-and-reorder with a heap. It is the most flexible.

---

## Backpressure in Practice

### Buffers are time windows

Repeating the core idea: a buffered channel of size `n` lets the producer run for `n / consumerRate` seconds without consumer feedback.

For a producer at 1000/sec and consumer at 100/sec, buffer = 1000 means the producer can run for 10 seconds before stalling. After that, you accumulate at the consumer's pace.

Choosing buffer:

- Buffer = 0 (unbuffered): producer is exactly matched to consumer. Maximum backpressure. Minimum latency from send to receive.
- Buffer = small (1-10): absorbs scheduler jitter. Tiny latency improvement.
- Buffer = medium (100-1000): absorbs producer bursts. Adds latency.
- Buffer = huge (10 000+): masks the consumer slowness, possibly catastrophically. Avoid.

In benchmarks, a buffer of 1 often gives the best throughput per latency. A buffer of 0 gives the best latency. Larger buffers help only when producer is genuinely bursty.

### Backpressure under fan-out

In a fan-out, "producer" is the source channel and "consumer" is the worker pool. If the workers can drain the source at rate `N * w` (where `N` is worker count and `w` is per-worker rate), the source can be unbuffered.

If workers vary in speed, a small buffer (size 1 or 2) absorbs the variance. Workers compete for items; a fast worker takes more than a slow one.

A common shape:

```go
source := producer(ctx)             // unbuffered
buffered := buffer(ctx, source, 4)  // small smoothing
workers := pool(ctx, buffered, 8, fn)
```

The `buffer` stage is just a one-goroutine forwarder with a buffered output channel. It smooths the source so the workers do not idle waiting for the producer's next batch.

### Backpressure under fan-in

In a fan-in, "producer" is each worker and "consumer" is the merged channel's reader. If the reader is fast, workers do not block; their items flow through the merge with minimal delay.

If the reader is slow, all workers block on `out <- v` inside the forwarder. They stop reading their input channels. The fan-out source backs up. Everything cascades.

Buffering the merged channel slightly (size = N workers, perhaps) lets each worker push one in-flight value into the buffer without blocking. This is a common micro-optimisation; larger buffers do not help and can hide problems.

### When to use a *select-with-default* drop

If you have an attempt-once-then-drop semantics (e.g., metrics, sampling), use `select` with `default`:

```go
select {
case metrics <- v:
default:
    // dropped (metrics buffer full)
}
```

This is *not* backpressure. It is loss. It is fine for non-critical telemetry; it is bad for primary data flow.

### When to use a bounded queue with a size limit

If you must drop *new* items when overloaded (so old items get processed), drop-on-full is right. If you must drop *old* items so new ones flow (real-time data), use a ring buffer that overwrites. Channels do neither natively; you build them.

Most production pipelines do not drop. They block. Backpressure to the source is preferable to lossy buffers in 90% of cases. The exceptions: real-time analytics, real-time gaming, and high-rate telemetry.

---

## Error Handling at Scale

### The fan-out / errgroup pattern

The standard recipe:

```go
func process(ctx context.Context, items []Item) error {
    g, ctx := errgroup.WithContext(ctx)
    g.SetLimit(8) // bounded fan-out
    for _, it := range items {
        it := it
        g.Go(func() error {
            return processOne(ctx, it)
        })
    }
    return g.Wait()
}
```

Properties:

- 8 workers max in flight.
- First error cancels the group context.
- Other workers see `ctx.Done()` and exit (each `processOne` must respect ctx).
- `g.Wait()` returns the first error.

The trade-off: you do not see other errors after the first. If you want all errors, accumulate them yourself with a mutex.

### Continue-on-error pattern

If you want to keep processing despite individual failures:

```go
type Result struct {
    Item Item
    Err  error
}

func processAll(ctx context.Context, items []Item) []Result {
    in := make(chan Item)
    out := make(chan Result)
    var wg sync.WaitGroup
    for i := 0; i < 8; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for it := range in {
                err := processOne(ctx, it)
                select {
                case out <- Result{Item: it, Err: err}:
                case <-ctx.Done():
                    return
                }
            }
        }()
    }
    go func() {
        defer close(in)
        for _, it := range items {
            select {
            case in <- it:
            case <-ctx.Done():
                return
            }
        }
    }()
    go func() {
        wg.Wait()
        close(out)
    }()
    var results []Result
    for r := range out {
        results = append(results, r)
    }
    return results
}
```

Every item gets a `Result` with either success or failure. Caller examines.

### Error from the merge itself

The merge function does not usually fail — it just forwards. If a forwarder gets a value that *contains* an error (e.g., the `Result[T]` type), it forwards it like any other value. The consumer is responsible for inspecting.

Some teams pre-check: at the merge, drop errored values into a separate channel, forward only successes. This complicates the API and is usually not worth it.

### Panic isolation

A panicking worker kills the program unless caught. Wrap each worker's body in `recover`:

```go
go func() {
    defer wg.Done()
    defer func() {
        if r := recover(); r != nil {
            log.Printf("worker panic: %v\n%s", r, debug.Stack())
            // optionally send a sentinel error
        }
    }()
    for v := range in {
        out <- process(v)
    }
}()
```

For production fan-out, panic recovery is non-negotiable. One malformed input should not bring down the service.

---

## Real-World Analogies

### Ordered merge is an ER triage system

Patients arrive and are tagged with arrival time. Doctors process them in parallel but at different speeds — some cases are quick, others take an hour. Discharges happen in *arrival order* (insurance reasons), so the receptionist holds completed paperwork until the next-arrived patient's paperwork is ready. The "next" pointer advances as patients are discharged. That is tag-and-reorder.

### Backpressure is a thermostat

A thermostat regulates the heating system based on temperature. If the room is cold, it turns the heat up; if hot, down. The room temperature feeds back to the controller, which adjusts the source rate. A Go channel is exactly that: the consumer's reading rate feeds back to the producer's sending rate via the channel's fill state. No central controller — the negotiation is implicit.

### `errgroup` is a fire drill

Each worker is a person. When one person spots a fire and shouts (returns an error), everyone evacuates (context cancels). The fire team (the `g.Wait` caller) is told what happened.

### Bounded fan-out is a security checkpoint

The airport has a fixed number of metal detectors. Travellers (input items) line up; whichever detector is free serves them. Throughput is bounded by the number of detectors. Adding detectors helps until you saturate the conveyor belt of bags (the bottleneck).

---

## Mental Models

### Model 1: "Pipelines are functions composed over channels"

Each stage is a function from `<-chan A` to `<-chan B`. Composition is left-to-right:

```
source >>= stage1 >>= stage2 >>= sink
```

You can refactor by inserting stages without changing the rest. A metrics stage, a logging stage, a filter — they all fit the same shape.

### Model 2: "Order is a property added by ceremony"

By default, fan-out destroys order. To get it back, you must *do* something — usually tag-and-reorder. Order is not free; it costs a reorder buffer and a small amount of latency.

### Model 3: "Errors flow like data — but cancellation flows in reverse"

Data flows downstream: producer to consumer. Errors flow with the data (as part of the value or via a parallel channel). Cancellation flows upstream: the consumer or supervisor cancels `ctx`, and every stage observes.

Picture a river: water flows down; the alarm to stop the source goes up.

### Model 4: "Throughput is the slowest stage, latency is the sum of stages"

A pipeline's throughput equals the throughput of its slowest stage. A pipeline's per-item latency equals the time to traverse every stage. Fan-out at the slowest stage increases throughput. Fan-out at a fast stage adds latency for no gain.

### Model 5: "Cancellation is a deadline, not a kill switch"

`ctx.Done()` is a *request* to stop. It is the stages' responsibility to honour it. If a stage holds a lock or is mid-syscall, cancellation has to wait until the next select. Production pipelines minimise the maximum delay between `cancel()` and full shutdown.

---

## Pros & Cons

### Pros

- **Compositional.** Stages are functions; pipelines are sequences of function calls. Adding logging, metrics, or buffering is a one-line insert.
- **Type-safe.** With generics, each stage's input and output types are checked at compile time.
- **Backpressure for free.** Channels self-regulate.
- **Cancellation is uniform.** One `context.Context` for the whole pipeline.
- **Test-friendly.** Each stage is a function; you can test it with a fake input channel and inspect the output channel.

### Cons

- **Reorder buffers add latency.** Tag-and-reorder costs a small but real delay; the slowest worker pins the next-emit pointer.
- **Buffering hides problems.** Large buffers turn fast feedback into slow feedback. Backpressure becomes invisible.
- **`errgroup` returns only the first error.** If you need all errors, you must collect them separately.
- **Stages must agree on context.** A stage that ignores `ctx.Done()` leaks. Easy to forget on a quick refactor.
- **Multi-stage pipelines have many goroutines.** A six-stage pipeline with fan-out 8 has roughly 60 goroutines. Debugging requires tooling.

---

## Use Cases

| Scenario | Why fan-out / fan-in (middle-level) fits |
|---|---|
| Real-time log enrichment | Parse, enrich, write. Each stage fans out. Errors from the enricher do not stop the writer. |
| ML feature extraction | Read rows, compute features in parallel, reorder for batch training. |
| Video frame processing | Decode, transform, encode. Frame order matters; tag-and-reorder. |
| Batch geocoding | Geocode 100 000 addresses; fan-out to a rate-limited API; errors per-row, no global failure. |
| Search index build | Crawl, parse, score, write. Each stage has its own fan-out factor. |
| Data validation pipeline | Read records, validate, route valid to one sink and invalid to another. Fan-in for each sink. |
| Cron-triggered batch jobs | Read job description, fan out to workers, fan in for status report. |

---

## Code Examples

### Example 1: A complete pipeline with metrics

```go
package main

import (
    "context"
    "fmt"
    "sync"
    "sync/atomic"
    "time"
)

type stats struct {
    produced, processed, emitted atomic.Int64
}

func produce(ctx context.Context, n int, s *stats) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for i := 0; i < n; i++ {
            select {
            case out <- i:
                s.produced.Add(1)
            case <-ctx.Done():
                return
            }
        }
    }()
    return out
}

func worker(ctx context.Context, in <-chan int, s *stats) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for v := range in {
            time.Sleep(time.Millisecond) // simulate work
            s.processed.Add(1)
            select {
            case out <- v * v:
            case <-ctx.Done():
                return
            }
        }
    }()
    return out
}

func merge(ctx context.Context, s *stats, cs ...<-chan int) <-chan int {
    out := make(chan int)
    var wg sync.WaitGroup
    wg.Add(len(cs))
    for _, c := range cs {
        c := c
        go func() {
            defer wg.Done()
            for v := range c {
                select {
                case out <- v:
                    s.emitted.Add(1)
                case <-ctx.Done():
                    return
                }
            }
        }()
    }
    go func() { wg.Wait(); close(out) }()
    return out
}

func main() {
    ctx, cancel := context.WithCancel(context.Background())
    defer cancel()
    s := &stats{}
    in := produce(ctx, 100, s)
    const N = 4
    outs := make([]<-chan int, N)
    for i := 0; i < N; i++ {
        outs[i] = worker(ctx, in, s)
    }
    merged := merge(ctx, s, outs...)
    sum := 0
    for v := range merged {
        sum += v
    }
    fmt.Printf("produced=%d processed=%d emitted=%d sum=%d\n",
        s.produced.Load(), s.processed.Load(), s.emitted.Load(), sum)
}
```

The `stats` struct is shared via `atomic` counters. Every stage increments its relevant counter. End of run, the totals should match: `produced == processed == emitted == 100`. If any differ, you have a leak or a drop.

### Example 2: Ordered merge with tag-and-reorder

```go
package main

import (
    "context"
    "fmt"
    "sync"
    "time"
)

type tagged struct {
    seq int
    val int
}

func source(ctx context.Context, n int) <-chan tagged {
    out := make(chan tagged)
    go func() {
        defer close(out)
        for i := 0; i < n; i++ {
            select {
            case out <- tagged{seq: i, val: i}:
            case <-ctx.Done():
                return
            }
        }
    }()
    return out
}

func work(ctx context.Context, in <-chan tagged) <-chan tagged {
    out := make(chan tagged)
    go func() {
        defer close(out)
        for t := range in {
            // simulate variable work
            time.Sleep(time.Duration((t.seq*13)%7) * time.Millisecond)
            select {
            case out <- tagged{seq: t.seq, val: t.val * 10}:
            case <-ctx.Done():
                return
            }
        }
    }()
    return out
}

func merge(ctx context.Context, cs ...<-chan tagged) <-chan tagged {
    out := make(chan tagged)
    var wg sync.WaitGroup
    wg.Add(len(cs))
    for _, c := range cs {
        c := c
        go func() {
            defer wg.Done()
            for v := range c {
                select {
                case out <- v:
                case <-ctx.Done():
                    return
                }
            }
        }()
    }
    go func() { wg.Wait(); close(out) }()
    return out
}

func reorder(ctx context.Context, in <-chan tagged) <-chan int {
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
                select {
                case out <- v:
                case <-ctx.Done():
                    return
                }
                delete(pending, next)
                next++
            }
        }
    }()
    return out
}

func main() {
    ctx, cancel := context.WithCancel(context.Background())
    defer cancel()
    in := source(ctx, 20)
    const N = 4
    outs := make([]<-chan tagged, N)
    for i := 0; i < N; i++ {
        outs[i] = work(ctx, in)
    }
    ordered := reorder(ctx, merge(ctx, outs...))
    for v := range ordered {
        fmt.Println(v)
    }
}
```

Output is `0 10 20 30 ... 190`, strictly in order, even though the work stage finishes items out of order.

### Example 3: `errgroup` fan-out

```go
package main

import (
    "context"
    "errors"
    "fmt"
    "time"

    "golang.org/x/sync/errgroup"
)

func processItem(ctx context.Context, i int) error {
    select {
    case <-time.After(time.Duration(i*10) * time.Millisecond):
    case <-ctx.Done():
        return ctx.Err()
    }
    if i == 7 {
        return fmt.Errorf("item %d: simulated failure", i)
    }
    return nil
}

func main() {
    ctx, cancel := context.WithCancel(context.Background())
    defer cancel()
    g, gctx := errgroup.WithContext(ctx)
    g.SetLimit(4)
    for i := 0; i < 20; i++ {
        i := i
        g.Go(func() error {
            return processItem(gctx, i)
        })
    }
    err := g.Wait()
    if errors.Is(err, context.Canceled) {
        fmt.Println("cancelled")
        return
    }
    if err != nil {
        fmt.Println("failed:", err)
        return
    }
    fmt.Println("all done")
}
```

When item 7 returns its error, `g`'s context is cancelled; in-flight items see `gctx.Done()` and exit; `g.Wait()` returns item 7's error.

### Example 4: A pipeline with goleak

```go
package mypipe_test

import (
    "context"
    "testing"

    "go.uber.org/goleak"
)

func TestPipelineNoLeak(t *testing.T) {
    defer goleak.VerifyNone(t)
    ctx, cancel := context.WithCancel(context.Background())
    defer cancel()
    runPipeline(ctx)
    cancel()
}
```

`goleak` snapshots goroutines at the start and end of the test. If any user goroutine survives, the test fails. The single most useful CI check for pipeline code.

### Example 5: Bounded fan-out using `errgroup.SetLimit`

```go
g, ctx := errgroup.WithContext(ctx)
g.SetLimit(8)
for _, url := range urls {
    url := url
    g.Go(func() error {
        return fetch(ctx, url)
    })
}
return g.Wait()
```

`SetLimit(8)` ensures at most 8 `Go` calls are in flight. The 9th call blocks until one finishes. Built-in bounded fan-out.

### Example 6: A merge with a small buffer for smoothing

```go
func smoothMerge[T any](ctx context.Context, buf int, cs ...<-chan T) <-chan T {
    out := make(chan T, buf)
    var wg sync.WaitGroup
    wg.Add(len(cs))
    for _, c := range cs {
        c := c
        go func() {
            defer wg.Done()
            for v := range c {
                select {
                case out <- v:
                case <-ctx.Done():
                    return
                }
            }
        }()
    }
    go func() { wg.Wait(); close(out) }()
    return out
}
```

Buffer of 1 or 2 absorbs scheduler jitter. Buffer of 100 hides backpressure. Always justify the value in code comments.

### Example 7: Round-robin pre-assignment

```go
func roundRobinFanOut[T any](ctx context.Context, in <-chan T, n int) []<-chan T {
    outs := make([]chan T, n)
    for i := range outs {
        outs[i] = make(chan T)
    }
    go func() {
        defer func() {
            for _, o := range outs {
                close(o)
            }
        }()
        i := 0
        for v := range in {
            select {
            case outs[i] <- v:
            case <-ctx.Done():
                return
            }
            i = (i + 1) % n
        }
    }()
    result := make([]<-chan T, n)
    for i, o := range outs {
        result[i] = o
    }
    return result
}
```

Combined with round-robin merge, this preserves order. Risk: skewed work distributions cause one worker to become a straggler.

### Example 8: A pipeline that drops on full instead of blocking

```go
func bestEffort[T any](in <-chan T, out chan<- T) {
    for v := range in {
        select {
        case out <- v:
        default:
            // dropped
        }
    }
}
```

For non-critical paths only. Telemetry, sampling, optional features.

### Example 9: A merge that returns the first non-error

```go
func firstNonError[T any](ctx context.Context, cs ...<-chan Result[T]) (T, error) {
    var zero T
    for {
        for _, c := range cs {
            select {
            case r, ok := <-c:
                if !ok {
                    continue
                }
                if r.Err == nil {
                    return r.Value, nil
                }
            case <-ctx.Done():
                return zero, ctx.Err()
            }
        }
        if allClosed(cs) {
            return zero, errors.New("all failed")
        }
    }
}
```

Useful for hedged requests: race N backends, take the first that succeeds.

### Example 10: A bounded fan-out worker pool with `errgroup` and panic recovery

```go
func panicSafeWorker(ctx context.Context, item Item) (err error) {
    defer func() {
        if r := recover(); r != nil {
            err = fmt.Errorf("panic: %v", r)
        }
    }()
    return doWork(ctx, item)
}

func processAll(ctx context.Context, items []Item) error {
    g, gctx := errgroup.WithContext(ctx)
    g.SetLimit(8)
    for _, it := range items {
        it := it
        g.Go(func() error {
            return panicSafeWorker(gctx, it)
        })
    }
    return g.Wait()
}
```

The named return `err` is set by the deferred recover. A panic becomes an error, which propagates through `errgroup`.

---

## Coding Patterns

### Pattern 1: The "stage wrapper" idiom

Every stage in your pipeline conforms to:

```go
type Stage[I, O any] func(ctx context.Context, in <-chan I) <-chan O
```

Combinator:

```go
func pipe[A, B, C any](s1 Stage[A, B], s2 Stage[B, C]) Stage[A, C] {
    return func(ctx context.Context, in <-chan A) <-chan C {
        return s2(ctx, s1(ctx, in))
    }
}
```

Now you can write `pipeline := pipe(parse, hash)` and call it. With generics, this is type-safe.

### Pattern 2: The "fan-out factor" parameter

Always expose the fan-out factor as a parameter:

```go
func processor(ctx context.Context, in <-chan Item, workers int) <-chan Result {
    ...
}
```

Default in tests is 1 (serial). Default in production is configurable via env or config. Hardcoding `8` or `NumCPU` is a code smell.

### Pattern 3: Per-stage instrumentation

Wrap stages with a measuring wrapper:

```go
func measured[I, O any](name string, s Stage[I, O]) Stage[I, O] {
    return func(ctx context.Context, in <-chan I) <-chan O {
        out := s(ctx, in)
        // optional: wrap out with a count-and-time stage
        return out
    }
}
```

Pluggable, removable, never affects core logic.

### Pattern 4: The "drain on cancel" idiom

After cancellation, the pipeline may have in-flight values. To complete shutdown:

```go
cancel()
for range out {
    // drain
}
```

With every blocking send guarded by `<-ctx.Done()`, this drain runs quickly. The pattern guarantees no leaked goroutines.

### Pattern 5: The "shutdown hook" idiom

Wrap the whole pipeline in a function that owns the context:

```go
func runPipeline(ctx context.Context, in []Item) (results []Result, err error) {
    ctx, cancel := context.WithCancel(ctx)
    defer cancel()
    ...
}
```

Caller passes a parent context; the function creates a child it controls. If the caller cancels, the child cancels. If the function returns, the child is cancelled.

---

## Clean Code

- **Each stage is a function.** Not a struct, not a method on a service, not embedded in a larger orchestrator. A free function. Stages compose.
- **Stages take `context.Context` first.** Always. Even if the stage does not use it today, take it.
- **Stages return `<-chan T`.** Receive-only. Hide the bidirectional channel.
- **No nested closures longer than 20 lines.** Extract a function.
- **Channel names describe the data, not the shape.** `out`, `in`, `jobs`, `results`, `errors` — not `ch1`, `ch2`.
- **Buffer sizes are documented.** `make(chan T, 32 /* one batch of records */)`.
- **Each goroutine has a comment on entry: who owns it, who exits it.** Especially important for pipelines.

---

## Product Use / Feature

| Feature | Implementation |
|---|---|
| Bulk import API | Read rows, fan out parsers (8 workers), fan in for validation, fan out for DB writes (4 workers, bounded by pool). |
| Live transcoding | Decode frames, fan out across N workers for codec, reorder by frame number, encode. |
| Recommendations service | Fan-out user query to N retrievers, merge candidate lists, score, top-K. |
| Audit log ingestion | Fan-out log lines to parsers, fan-in to a writer with batching and ordering by timestamp. |
| Webhook fan-out | Single inbound event fans out to N subscribers; failures retried via separate channel. |

---

## Performance Tips

### Match fan-out to the bottleneck

Profile with `pprof`. If CPU is saturated, more workers do nothing (CPU is the bottleneck). If CPU is idle and latency is from I/O, more workers help.

A rule of thumb:

- CPU-bound: `workers = NumCPU` (or `NumCPU - 1` to leave space for the merge).
- I/O-bound (HTTP, DB): `workers = NumCPU * (1 + waitTime / cpuTime)`. For HTTP with 100 ms wait and 1 ms CPU per request, `workers = NumCPU * 101`. Practically: 32-256.
- Mixed: profile and tune.

### Avoid one-channel-op per tiny item

If your per-item work takes < 1 microsecond, the channel ops (~100-200 ns each) become significant. Batch into slices.

### Use `sync.Pool` for per-worker buffers

If each worker needs a temporary buffer (e.g., decoding into a byte slice), use `sync.Pool` to reuse:

```go
var bufPool = sync.Pool{New: func() any { return make([]byte, 0, 4096) }}

func worker(in <-chan task) <-chan result {
    out := make(chan result)
    go func() {
        defer close(out)
        for t := range in {
            buf := bufPool.Get().([]byte)
            // use buf
            bufPool.Put(buf[:0])
            out <- result{...}
        }
    }()
    return out
}
```

Cuts allocations dramatically.

### Watch for false sharing

Per-worker atomic counters in adjacent memory cache lines cause false sharing. Pad them or use `sync.Map` for sparse counters.

### Profile the merge

The merge is often invisible until it becomes the bottleneck. If the merged channel is full most of the time, the consumer is slow. If the worker outputs are full most of the time, the merge is slow (rare but possible at very high item rates).

---

## Best Practices

1. Stages take `context.Context`; every blocking op selects on `<-ctx.Done()`.
2. Bound fan-out with a fixed worker count or `errgroup.SetLimit`.
3. Tag-and-reorder when order matters. Do not single-thread for ordering.
4. Use `goleak.VerifyNone(t)` in tests for pipelines.
5. Recover panics inside each worker.
6. Document buffer sizes with a comment explaining the chosen value.
7. Expose fan-out factor as a parameter, not a constant.
8. Use `errgroup` for fan-out with first-error semantics.
9. Use a `Result[T]` channel for continue-on-error semantics.
10. Test with `-race` and `goleak`.

---

## Edge Cases & Pitfalls

### A worker panics and the others continue without it

Without per-worker `recover`, the panic kills the program. With `recover`, the worker dies and the merge sees its output channel close. The pipeline continues with fewer workers — but no one notices. Solution: log the panic loudly, increment a metric.

### `errgroup.Wait` deadlocks because a worker is stuck

A worker that does not select on `ctx.Done()` is stuck even after the group cancels. `Wait()` waits forever. Solution: every worker must respect `ctx`.

### Reorder buffer grows unboundedly

If the slow worker keeps getting low sequence numbers and the fast workers keep producing high sequence numbers, the reorder buffer can grow. Bound it with a max size; over the bound, log a warning and stall.

### Order matters but fan-out is round-robin and inputs vary in size

Round-robin sends item `i` to worker `i mod N`. If items vary wildly in size, one worker becomes a straggler. The merge waits for that straggler. Solution: switch to tag-and-reorder, where any worker can handle any item.

### Merge gets zero inputs

`merge()` with no arguments. The closer goroutine's `wg.Wait()` returns immediately (counter is 0). `close(out)` runs. The caller sees a closed empty stream. Correct.

### Cancellation does not propagate to a goroutine spawned inside a worker

If a worker spawns its own goroutines, those need the context too. Pass `ctx` recursively.

### A buffered channel hides a stuck consumer

Producer pushes 1000 items into a buffered channel; buffer holds them; consumer is dead. The producer never blocks. The buffer's items are leaked. Solution: small buffers + monitoring of consumer health.

### Worker reads from a closed input channel

`for v := range in { ... }` handles this — the loop exits when `in` is closed. But if the worker uses `<-in` directly, check `ok`:

```go
v, ok := <-in
if !ok { return }
```

---

## Common Mistakes

| Mistake | Fix |
|---|---|
| Fan-out factor hardcoded to `NumCPU` | Expose as a parameter; default in main. |
| Using `errgroup` and forgetting `SetLimit` | Add `g.SetLimit(N)` for bounded concurrency. |
| Ignoring `ctx.Done()` in a worker that does blocking I/O | Use a context-aware client (e.g., `http.NewRequestWithContext`). |
| Tag-and-reorder with unbounded buffer | Cap the buffer; stall or drop when full. |
| Buffered channels chosen by guess | Default to 0 or 1; justify any larger value in a comment. |
| Forgetting to drain after cancellation | Add `for range out {}` after `cancel()` in tests. |
| Recovering panics but not logging them | Always log the recovered value and stack. |
| Using `Result[T]` but never inspecting `Err` | Add a test that injects an error and verifies the consumer handles it. |

---

## Common Misconceptions

> *"`errgroup` is just `sync.WaitGroup` with errors."* — Partly. It also has a `context.Context` that cancels on first error, which is the main feature.

> *"Tag-and-reorder is too expensive."* — Usually negligible. A small map or heap per pipeline. The bottleneck is almost always the workers, not the reorder buffer.

> *"More buffer means more throughput."* — No. Throughput is bounded by the slowest stage. Buffer absorbs jitter, not slowness.

> *"`context.WithTimeout` will stop everything when the timer fires."* — It closes `Done()`. Stages must select on it. If a stage holds a long-running syscall, the cancellation waits.

> *"Fan-out always speeds things up."* — Only when the bottleneck is at that stage. Fan-out at a fast stage adds overhead.

> *"Round-robin merge preserves order."* — Only if the dispatcher pre-assigned items in input order. The runtime's automatic load balancing breaks ordering.

---

## Tricky Points

### `errgroup.Wait` returns the first error, not all errors

If three workers fail, `Wait` returns one of their errors (the first to return). The other two are dropped. To collect all, build your own:

```go
type multiErr struct{ errs []error }
var mu sync.Mutex
var errs []error
...
g.Go(func() error {
    if err := work(); err != nil {
        mu.Lock()
        errs = append(errs, err)
        mu.Unlock()
        return err // still triggers cancellation
    }
    return nil
})
```

### `g.SetLimit(0)` is invalid

It panics. Use a positive number. To disable the limit, do not call `SetLimit` at all.

### `g.SetLimit(-1)` disables the limit

A negative argument removes any previous limit. Documented in the source but easy to miss.

### `errgroup.WithContext` returns the *derived* context

```go
g, ctx := errgroup.WithContext(parent)
```

The returned `ctx` is a child of `parent`. Workers should use the returned `ctx`, not `parent`. First error cancels the returned one.

### Buffer interacts with backpressure latency

A buffer of `k` means the producer is `k` items "ahead" of the consumer. If the consumer needs to react to producer state, latency is `k / consumerRate`. Tune accordingly.

### A panic recovered in a worker still loses the in-flight item

If a worker is processing item X when it panics, X is lost. The consumer never sees a result for X. To handle: emit a sentinel error for X before the panic recovers.

```go
defer func() {
    if r := recover(); r != nil {
        out <- Result{Item: currentItem, Err: fmt.Errorf("panic: %v", r)}
    }
}()
```

But this requires tracking `currentItem`, which adds complexity.

---

## Test

```go
package pipeline_test

import (
    "context"
    "testing"

    "go.uber.org/goleak"
)

func TestPipelineNoLeak(t *testing.T) {
    defer goleak.VerifyNone(t)
    ctx, cancel := context.WithCancel(context.Background())
    defer cancel()
    out := runPipeline(ctx)
    for range out {
    }
}

func TestPipelineCancellation(t *testing.T) {
    defer goleak.VerifyNone(t)
    ctx, cancel := context.WithCancel(context.Background())
    out := runPipeline(ctx)
    seen := 0
    for range out {
        seen++
        if seen == 2 {
            cancel()
        }
    }
    if seen < 2 {
        t.Fatalf("expected at least 2 items, got %d", seen)
    }
}

func TestOrderedMerge(t *testing.T) {
    ctx, cancel := context.WithCancel(context.Background())
    defer cancel()
    out := runOrderedPipeline(ctx, 100)
    n := 0
    for v := range out {
        if v != n {
            t.Fatalf("at %d got %d", n, v)
        }
        n++
    }
}
```

`goleak` confirms shutdown leaves no goroutines. Cancellation tests confirm that breaking early does not leak. Ordering tests confirm the reorder logic.

---

## Tricky Questions

**Q.** I have a pipeline that uses `errgroup.WithContext`. A worker returns an error. Some workers are mid-syscall. What happens?

**A.** The errgroup cancels its derived context. Mid-syscall workers do not notice immediately — the cancellation reaches them at their next context check. If the syscall is uncancellable (e.g., a plain `os.Open` without `context`), the worker finishes the syscall and then notices. To make syscalls cancellable, use context-aware variants (e.g., the `net/http` client with `req.WithContext(ctx)`).

---

**Q.** I want fan-out with order preservation and fault tolerance. How?

**A.** Tag-and-reorder is the order half. Fault tolerance is the worker half: wrap each worker with panic recovery and an error path. The reorder buffer must handle "no value for sequence X" — usually by emitting a sentinel error for X and advancing `next`.

---

**Q.** I have a slow consumer and many fast producers. Memory is growing. Why?

**A.** Some stage in the middle is buffered. Find it. Default-unbuffered channels propagate backpressure all the way back. Any buffered channel along the way absorbs the lag, allowing producers to outrun the consumer.

---

**Q.** Should I always use `errgroup`?

**A.** For fan-out with errors, yes. For pipelines where each item produces a value plus an optional error and you want to continue, no — use a `Result[T]` channel.

---

**Q.** `g.SetLimit(8)` plus `for _, x := range hugeList { g.Go(...) }` — does this allocate hugeList's worth of goroutines?

**A.** No. `g.Go` blocks when the limit is reached. So at most 8 goroutines exist at any time, plus the loop's main goroutine waiting on the next `g.Go`.

---

**Q.** I want to fan out with priority — important items first. How?

**A.** Not directly with `errgroup`. Use a priority channel or a worker that reads from two channels via `select` with a priority order (try high-prio first, fall back to low-prio). The standard library does not provide a priority channel; you build one.

---

**Q.** What is the relationship between fan-out factor and `GOMAXPROCS`?

**A.** Not direct. `GOMAXPROCS` is the maximum number of OS threads executing goroutines. Fan-out is the number of goroutines. For CPU-bound work, `workers = GOMAXPROCS` is reasonable. For I/O-bound, `workers >> GOMAXPROCS` is normal.

---

## Cheat Sheet

```go
// Production merge with context
func merge[T any](ctx context.Context, cs ...<-chan T) <-chan T {
    out := make(chan T)
    var wg sync.WaitGroup
    wg.Add(len(cs))
    for _, c := range cs {
        c := c
        go func() {
            defer wg.Done()
            for v := range c {
                select {
                case out <- v:
                case <-ctx.Done():
                    return
                }
            }
        }()
    }
    go func() { wg.Wait(); close(out) }()
    return out
}

// Bounded fan-out with errgroup
g, ctx := errgroup.WithContext(ctx)
g.SetLimit(N)
for _, item := range items {
    item := item
    g.Go(func() error { return process(ctx, item) })
}
err := g.Wait()

// Tag-and-reorder
type Tagged[T any] struct{ Seq int; Val T }
func reorder[T any](ctx, in) <-chan T {
    next := 0
    pending := map[int]T{}
    for t := range in {
        pending[t.Seq] = t.Val
        for { v, ok := pending[next]; if !ok { break }; emit(v); delete(pending, next); next++ }
    }
}

// Goleak
import "go.uber.org/goleak"
defer goleak.VerifyNone(t)

// Panic-safe worker
defer func() { if r := recover(); r != nil { /* log */ } }()
```

---

## Self-Assessment Checklist

- [ ] I can build a 3-stage pipeline with fan-out at each stage.
- [ ] I can implement tag-and-reorder for ordered output.
- [ ] I use `errgroup` for fan-out with errors and know what `SetLimit` does.
- [ ] I tune fan-out factor based on CPU vs I/O bound work.
- [ ] I use `goleak.VerifyNone(t)` in pipeline tests.
- [ ] I document buffer sizes with reasons.
- [ ] I respect `ctx.Done()` in every blocking operation.
- [ ] I know when round-robin merge works and when it fails.
- [ ] I recover panics in workers and log them.
- [ ] I have profiled at least one pipeline and identified its bottleneck.

---

## Summary

Middle-level fan-out / fan-in is about production discipline. The mechanics from junior do not change; what changes is the surrounding ceremony: context-aware stages, bounded concurrency, ordered merges where needed, error propagation that does not lose information, and the testing tools (`-race`, `goleak`) that catch the bugs that hand inspection misses.

Order is preserved by tag-and-reorder when needed. Errors are propagated by `errgroup` (first-error-cancels) or by `Result[T]` channels (continue-on-error). Cancellation flows through `context.Context`. Backpressure is preserved by default-unbuffered channels; buffers are added only with documented reason.

You can now build production pipelines that fan out, merge, recover from worker failures, preserve order when required, and shut down cleanly under cancellation. Senior level introduces dynamic merges (`reflect.Select`), weighted fan-out, and architecture-level discussion of partial failure.

---

## What You Can Build

- A bulk import service that reads a CSV, validates rows in parallel, writes failures and successes to separate sinks, all with bounded concurrency and ordered output.
- A search aggregator that fans out one query to N backends, hedges the slow ones, and returns the first complete response.
- A video processor that decodes, transforms, and re-encodes frames with order preservation.
- A real-time event enricher that pulls from Kafka, enriches in parallel across 32 workers, and writes back in order.
- A distributed-trace exporter that batches spans, fans out to multiple sinks, and recovers from sink failures.

---

## Further Reading

- The Go Blog — *Pipelines and Cancellation* — <https://go.dev/blog/pipelines>
- `golang.org/x/sync/errgroup` — <https://pkg.go.dev/golang.org/x/sync/errgroup>
- `go.uber.org/goleak` — <https://pkg.go.dev/go.uber.org/goleak>
- *Concurrency in Go* (Katherine Cox-Buday), chapters 4 and 5
- `container/heap` — <https://pkg.go.dev/container/heap>
- *Go Concurrency Patterns: Context* — <https://go.dev/blog/context>

---

## Related Topics

- `context.Context` propagation
- `errgroup.Group` and its limits
- Priority queues with `container/heap`
- Backpressure in distributed systems
- Tail-latency vs mean-latency tuning
- `goleak` for goroutine leak tests

---

## Diagrams & Visual Aids

### Pipeline shape with metrics

```
source --(stats.produced)--> in
                              |
                  +-----------+-----------+
                  |     fan-out (N)       |
                  +--+--+--+--+--+--+--+--+
                     |  |  |  |  |  |  |
                  (stats.processed each worker)
                     |  |  |  |  |  |  |
                  +--+--+--+--+--+--+--+
                  |       merge          |
                  +-----------+----------+
                              |
                              v
                  (stats.emitted) --> consumer
```

### Tag-and-reorder

```
input order:    1  2  3  4  5  6  7  8

tag stage:      (1,1) (2,2) (3,3) (4,4) ...

fan-out:        workers process out of order:
                emitted: (3,300) (1,100) (4,400) (2,200) ...

reorder:
   pending = {1: 100, 3: 300}; next = 1; emit 100; next = 2
   pending = {3: 300, 2: 200}; next = 2; emit 200; emit 300; next = 4
   pending = {4: 400}; next = 4; emit 400; next = 5
```

### Backpressure cascade with buffers

```
producer ---(unbuffered)--> [worker pool] ---(buf=2)--> [merge] ---(unbuffered)--> consumer
                                                                              ^
                                                                              |
                                                                          slow here
                                                                              |
                                                                              v
   <----------- backpressure propagates upstream within microseconds -----------+
```

### Cancellation propagation

```mermaid
sequenceDiagram
    participant C as caller
    participant Ctx as context
    participant P as producer
    participant W as worker
    participant M as merge
    C->>Ctx: cancel()
    Ctx-->>P: Done()
    Ctx-->>W: Done()
    Ctx-->>M: Done()
    P->>P: select sees Done, return, close in
    W->>W: select sees Done, return, close outN
    M->>M: forwarders see Done, exit; closer closes out
    C->>C: for range out exits
```

### errgroup with SetLimit

```
g.SetLimit(4)
g.Go(A)    // launched
g.Go(B)    // launched
g.Go(C)    // launched
g.Go(D)    // launched
g.Go(E)    // blocks until one of A/B/C/D finishes
```

### Round-robin vs tag-and-reorder

```
Round-robin (with uniform work):
   item 0 -> worker 0
   item 1 -> worker 1
   item 2 -> worker 2
   item 3 -> worker 0
   ...
   merge reads from worker 0, then 1, then 2, then 0, ... -> in order

Tag-and-reorder (with variable work):
   each item gets a sequence number
   workers process freely
   reorder stage emits in sequence order
```

---

## Deep Dive: Choosing Buffer Sizes

This section gives concrete advice on buffer sizes for the three most common positions in a fan-out / fan-in pipeline. The advice is informed by performance benchmarks and production experience, but every workload is different — measure on your data.

### Position 1: The producer's input channel to the fan-out

```go
in := make(chan T, ?)
```

This channel sees one producer and N consumers. The consumers compete for items. The runtime arbitrates fairly across long timescales.

- **Unbuffered (0):** Producer blocks every send until a worker is ready. Maximum backpressure. Best when the producer is "free" (slice traversal, file scan) and the workers are the slow ones.
- **Small (1-2):** Absorbs scheduler jitter between producer and workers. Tiny throughput improvement, no semantic change.
- **Medium (N to 2N where N is worker count):** Provides one in-flight item per worker. Useful when the producer is bursty.
- **Large (>> N):** Hides backpressure. Producer can outrun workers for a long time. Use only with active monitoring of the channel's fill state.

In practice: start unbuffered, profile, increase if you see workers idle between batches.

### Position 2: Per-worker output channels

```go
out := make(chan T, ?)
```

This channel sees one producer (the worker) and one consumer (its forwarder in the merge).

- **Unbuffered (0):** Default. Worker blocks until the forwarder picks up the value.
- **1:** Common. Worker can finish item N and start item N+1 while forwarder is still moving N.
- **Larger:** Almost never useful. The forwarder is just a memcpy — it has no slowness.

Pick 1 if you want every worker to be able to overlap its compute with the merge's forwarding. Pick 0 if you want strict synchronization.

### Position 3: The merged output channel

```go
out := make(chan T, ?)
```

One write side (the N forwarders, sharing the channel), one read side (the consumer).

- **Unbuffered:** Forwarders block until consumer reads.
- **N (worker count):** One slot per worker. Forwarders can each push one without blocking.
- **Larger:** Buffers consumer slowness. Use only with monitoring.

A buffer of N is a common sweet spot for high-throughput pipelines. It lets all workers always have somewhere to put their next result while the consumer is busy.

### A worked example

Suppose you have 8 workers, each producing 10 000 items/sec. The consumer can sustain 50 000 items/sec on average but occasionally pauses for 50 ms (GC, paging, etc.). What buffer for the merged channel?

- Producer rate: 8 * 10 000 = 80 000 items/sec.
- Burst the consumer can absorb in 50 ms at its mean rate: 50 000 * 0.05 = 2500 items.
- But the consumer is paused during those 50 ms, not running at mean rate. So during a pause, 80 000 * 0.05 = 4000 items are produced.
- Buffer size: 4000 items, plus headroom. Round to 8192.

Or: tolerate backpressure. Set buffer to 0 and let producers stall briefly during consumer pauses. In most cases, this is the right answer — the brief stalls do not hurt overall throughput.

The decision: do you care more about smoothing latency spikes (buffer up) or about feedback (buffer down)? Both are valid.

---

## Deep Dive: Selecting Fan-Out Factor

For pure CPU-bound work, `NumCPU` is a good first guess but rarely optimal. The exact value depends on:

- Memory bandwidth: at high core counts, memory bandwidth becomes the bottleneck.
- Cache effects: many parallel workers compete for L3 cache.
- Hyperthreading: physical cores ≠ logical cores. `NumCPU` returns logical. Hyperthreaded cores are ~30% faster than a single thread, not 100%.
- The merge: if the merge is a single goroutine, it competes with workers for CPU.

Empirical procedure:

1. Start with `workers = NumCPU`.
2. Measure throughput.
3. Double the worker count. Re-measure. If throughput improved, double again.
4. Halve. Re-measure. If throughput improved, halve again.
5. Continue until you find the local maximum.

The optimum for CPU-bound work is often `NumCPU - 1` (leaving room for the merge and other infrastructure goroutines). For memory-bandwidth-bound work, often `NumCPU / 2` (because memory bandwidth saturates before all cores can compute).

For I/O-bound work, the trade-off is different. Each worker spends most of its time blocked on I/O. The goroutine cost is negligible compared to the I/O wait. So:

- 100-1000 workers is normal for HTTP fan-out.
- 10 000+ is possible for long-poll connections, but watch memory and the downstream's tolerance.

The downstream is usually the limit: an HTTP service that rate-limits to 200 RPS does not care if you have 8 or 8000 workers — your effective rate is 200.

---

## Deep Dive: Reorder Buffer Sizing

How big can the reorder buffer get?

If `K` is the spread between the slowest and fastest worker (in items), the buffer grows to at most `K` entries. After the slowest worker emits its next-in-order item, the buffer drains its accumulated downstream items.

For uniform work: `K` is small, typically `O(workers)`. The buffer stays tiny.

For skewed work (some items much slower than others): `K` can grow unboundedly if a slow item gets stuck. The buffer accumulates all downstream items waiting for the slow one.

Bounds:

- `K = O(workers)` for uniform work — buffer of size `2 * workers` is plenty.
- `K = unbounded` for skewed work — need a cap.

If you cap the reorder buffer at size `M` and it fills, you have choices:

1. Block the merge (stop reading from workers) until buffer drains. This applies backpressure all the way back.
2. Time out the missing sequence and emit a sentinel error.
3. Skip the missing sequence and emit downstream items immediately, accepting that the slow item was lost.

For most workloads, option 1 is the right answer.

---

## Deep Dive: Hedged Requests

A hedged request fan-out: send the same request to N replicas, take the first that succeeds, cancel the rest.

```go
func hedge[T any](ctx context.Context, replicas []func(ctx context.Context) (T, error)) (T, error) {
    type result struct {
        val T
        err error
    }
    out := make(chan result, len(replicas))
    ctx, cancel := context.WithCancel(ctx)
    defer cancel()
    for _, r := range replicas {
        r := r
        go func() {
            v, err := r(ctx)
            select {
            case out <- result{val: v, err: err}:
            case <-ctx.Done():
            }
        }()
    }
    var lastErr error
    for i := 0; i < len(replicas); i++ {
        select {
        case r := <-out:
            if r.err == nil {
                cancel() // signal others to stop
                var zero T
                _ = zero
                return r.val, nil
            }
            lastErr = r.err
        case <-ctx.Done():
            var zero T
            return zero, ctx.Err()
        }
    }
    var zero T
    return zero, lastErr
}
```

The output channel is buffered to `len(replicas)` so straggling replicas can drop their results without blocking. The `cancel()` after success tells the others to stop.

Hedge with timing: send the first replica immediately, then if it has not replied in `d` ms, send the second, then third, ...

```go
func tieredHedge[T any](ctx context.Context, replicas []func(ctx context.Context) (T, error), d time.Duration) (T, error) {
    type result struct {
        val T
        err error
    }
    out := make(chan result, len(replicas))
    ctx, cancel := context.WithCancel(ctx)
    defer cancel()
    for i, r := range replicas {
        r := r
        delay := time.Duration(i) * d
        go func() {
            select {
            case <-time.After(delay):
            case <-ctx.Done():
                return
            }
            v, err := r(ctx)
            select {
            case out <- result{val: v, err: err}:
            case <-ctx.Done():
            }
        }()
    }
    for {
        select {
        case r := <-out:
            if r.err == nil {
                return r.val, nil
            }
        case <-ctx.Done():
            var zero T
            return zero, ctx.Err()
        }
    }
}
```

Trade: the first replica handles the fast cases alone; only slow cases trigger additional replicas. Reduces upstream load.

This is fan-out with an interesting cancellation pattern; the merge here is just `select` over a single buffered channel.

---

## Deep Dive: Pull-Based vs Push-Based Pipelines

The patterns we have shown are *push-based*: each stage actively pushes values to its output. There is also a *pull-based* style: the consumer asks for the next value via a request channel.

Push-based:

```go
type Stage struct {
    Out <-chan T
}
```

Pull-based:

```go
type Stage struct {
    Next func(ctx context.Context) (T, error)
}
```

Pull-based is rarer in Go because channels are so natural. But it appears in some library code — iterators, generators with `yield`, etc.

For fan-out / fan-in, push is the dominant style. Pull would require each consumer to request from each producer, which complicates the merge.

---

## Practical Pitfalls in Real Pipelines

### Pitfall 1: A stage that "transforms" by spawning a goroutine per item

```go
func badTransform(in <-chan int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for v := range in {
            go func(v int) {
                out <- expensive(v)
            }(v)
        }
    }()
    return out
}
```

Spawns one goroutine per input. No bounding. Out-of-order. Leak risk (`out` is closed by the outer goroutine before the spawned ones finish). Use a worker pool instead.

### Pitfall 2: A merge that reads ahead

```go
func eagerMerge(cs ...<-chan int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for {
            for _, c := range cs {
                v, ok := <-c
                if !ok {
                    return
                }
                out <- v
            }
        }
    }()
    return out
}
```

This polls each channel in turn. If channel 0 is empty but channel 1 has values, the merge waits on 0 anyway. Slow channels block fast ones. Use the canonical merge with per-input goroutines.

### Pitfall 3: A pool that does not exit

```go
func pool(jobs <-chan int) <-chan int {
    out := make(chan int)
    for i := 0; i < 8; i++ {
        go func() {
            for j := range jobs {
                out <- process(j)
            }
        }()
    }
    return out
}
```

Missing: the closer goroutine. When all 8 workers finish, `out` is never closed. The caller's `for range out` hangs forever.

### Pitfall 4: A merge that loses the last value

```go
func almostMerge(cs ...<-chan int) <-chan int {
    out := make(chan int)
    var wg sync.WaitGroup
    wg.Add(len(cs))
    for _, c := range cs {
        c := c
        go func() {
            defer wg.Done()
            for v := range c {
                select {
                case out <- v:
                case <-time.After(time.Millisecond):
                    // dropped if consumer is slow
                }
            }
        }()
    }
    go func() { wg.Wait(); close(out) }()
    return out
}
```

The `time.After` drop is silent loss. If the consumer pauses briefly, items vanish. This is rarely what you want; replace the timeout with `<-ctx.Done()`.

### Pitfall 5: A "fan-in" that is actually a "broadcast"

```go
func wrongFanIn(in <-chan int, outs ...chan<- int) {
    for v := range in {
        for _, o := range outs {
            o <- v
        }
    }
}
```

This sends every value to every output — that is broadcast (tee), not fan-in. Fan-in goes from many channels to one; this code goes from one to many.

### Pitfall 6: A worker that holds state across items

```go
func statefulWorker(in <-chan int) <-chan int {
    out := make(chan int)
    total := 0
    go func() {
        defer close(out)
        for v := range in {
            total += v
            out <- total
        }
    }()
    return out
}
```

If you fan-out with N copies of this worker, each has its own `total`. The outputs are not what the caller expected — they are partial sums per worker, not a running total of all inputs. Stateful workers do not fan-out cleanly. Refactor to stateless, or keep state in a single goroutine.

---

## Comparing Patterns: When to Use What

| Goal | Use |
|------|-----|
| Parallelize a CPU-bound transform | Worker pool with fan-out = NumCPU |
| Parallelize an I/O-bound transform | Worker pool with fan-out = 100-1000 (tune to downstream) |
| Order-preserving parallel transform | Tag-and-reorder |
| First success out of N replicas | Hedged fan-out, cancel on success |
| All replicas must succeed | `errgroup`, fail on first error |
| All replicas tried, results collected | `Result[T]` channel, no global error |
| Stream merging from multiple sources | Canonical N-way merge |
| Throttle outbound rate | Throttle stage before fan-out |
| Dynamic input list | `reflect.Select` (senior level) |

---

## Real Project Sketch

To make this concrete, let us sketch a real pipeline. We will build a tool that:

1. Reads a list of URLs from a file.
2. Fetches each URL (with timeout and retry).
3. Extracts text from each response.
4. Computes the word count for each.
5. Writes results to a CSV in input order.

### Stage 1: read URLs

```go
func readURLs(ctx context.Context, path string) <-chan tagged[string] {
    out := make(chan tagged[string])
    go func() {
        defer close(out)
        f, err := os.Open(path)
        if err != nil {
            return
        }
        defer f.Close()
        scanner := bufio.NewScanner(f)
        i := 0
        for scanner.Scan() {
            select {
            case out <- tagged[string]{Seq: i, Val: scanner.Text()}:
                i++
            case <-ctx.Done():
                return
            }
        }
    }()
    return out
}
```

### Stage 2: fetch

```go
func fetcher(ctx context.Context, in <-chan tagged[string]) <-chan tagged[fetchResult] {
    out := make(chan tagged[fetchResult])
    go func() {
        defer close(out)
        client := &http.Client{Timeout: 5 * time.Second}
        for t := range in {
            res := fetch(ctx, client, t.Val)
            select {
            case out <- tagged[fetchResult]{Seq: t.Seq, Val: res}:
            case <-ctx.Done():
                return
            }
        }
    }()
    return out
}

type fetchResult struct {
    Body []byte
    Err  error
}

func fetch(ctx context.Context, c *http.Client, url string) fetchResult {
    req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
    if err != nil {
        return fetchResult{Err: err}
    }
    resp, err := c.Do(req)
    if err != nil {
        return fetchResult{Err: err}
    }
    defer resp.Body.Close()
    body, err := io.ReadAll(resp.Body)
    return fetchResult{Body: body, Err: err}
}
```

### Stage 3: extract text

```go
func extractor(ctx context.Context, in <-chan tagged[fetchResult]) <-chan tagged[extractResult] {
    out := make(chan tagged[extractResult])
    go func() {
        defer close(out)
        for t := range in {
            var res extractResult
            if t.Val.Err != nil {
                res.Err = t.Val.Err
            } else {
                res.Text = stripHTML(t.Val.Body)
            }
            select {
            case out <- tagged[extractResult]{Seq: t.Seq, Val: res}:
            case <-ctx.Done():
                return
            }
        }
    }()
    return out
}

type extractResult struct {
    Text string
    Err  error
}

func stripHTML(b []byte) string {
    return string(b) // placeholder
}
```

### Stage 4: word count

```go
func counter(ctx context.Context, in <-chan tagged[extractResult]) <-chan tagged[countResult] {
    out := make(chan tagged[countResult])
    go func() {
        defer close(out)
        for t := range in {
            var res countResult
            if t.Val.Err != nil {
                res.Err = t.Val.Err
            } else {
                res.Count = len(strings.Fields(t.Val.Text))
            }
            select {
            case out <- tagged[countResult]{Seq: t.Seq, Val: res}:
            case <-ctx.Done():
                return
            }
        }
    }()
    return out
}

type countResult struct {
    Count int
    Err   error
}
```

### Stage 5: write CSV in order

```go
func writeCSV(ctx context.Context, in <-chan tagged[countResult], w io.Writer) error {
    csvW := csv.NewWriter(w)
    defer csvW.Flush()
    next := 0
    pending := map[int]countResult{}
    for t := range in {
        pending[t.Seq] = t.Val
        for {
            v, ok := pending[next]
            if !ok {
                break
            }
            if err := csvW.Write([]string{fmt.Sprint(next), fmt.Sprint(v.Count), fmtErr(v.Err)}); err != nil {
                return err
            }
            delete(pending, next)
            next++
        }
    }
    return nil
}

func fmtErr(e error) string {
    if e == nil {
        return ""
    }
    return e.Error()
}
```

### Wiring

```go
func run(ctx context.Context, urlsPath string, out io.Writer, fetchWorkers int) error {
    urls := readURLs(ctx, urlsPath)
    var fetchOuts []<-chan tagged[fetchResult]
    for i := 0; i < fetchWorkers; i++ {
        fetchOuts = append(fetchOuts, fetcher(ctx, urls))
    }
    merged := merge(ctx, fetchOuts...)
    extracted := extractor(ctx, merged)
    counted := counter(ctx, extracted)
    return writeCSV(ctx, counted, out)
}
```

Fan-out happens at the fetcher (multiple HTTP workers). The merge combines them. Extractor and counter are single-goroutine — they are fast and ordering is naturally preserved across them. The writer reorders by sequence number for the final CSV output.

This is a real-shaped pipeline. About 150 lines, no surprises, ships under five workdays.

---

## Observability in Pipelines

Production pipelines benefit from a few key metrics:

- **Items in flight per stage.** Helps detect bottlenecks.
- **Channel fill ratio.** A buffered channel that is always near full means the consumer is the bottleneck.
- **Worker idle time.** A worker that idles means the producer is slow.
- **Time per item per stage.** Per-stage latency histogram.
- **Errors per stage.** Distribution of failures by stage.
- **Goroutine count.** Should be stable in steady state.

Most of these are easy to wire with a `tee` stage that increments a counter or with `expvar` exposing stats.

For deeper observability, OpenTelemetry tracing wraps each stage. Each item carries a trace context; spans for each stage join to form a single trace per item. This is overkill for batch pipelines but excellent for long-running streaming pipelines.

---

## Testing Pipelines

A few patterns make pipelines testable:

### Use small, deterministic inputs

```go
in := []int{1, 2, 3, 4, 5}
out := process(ctx, in)
```

Avoid real I/O in tests. Use slices, channels, or in-memory implementations.

### Use `goleak.VerifyNone` in every pipeline test

```go
defer goleak.VerifyNone(t)
```

Catches leaks that hand inspection misses.

### Test cancellation paths

```go
ctx, cancel := context.WithCancel(context.Background())
out := pipeline(ctx, in)
// read a few
cancel()
// confirm pipeline shuts down without panic, leak, or hang
```

### Test partial failure

Inject errors into the input or a fake worker. Verify the consumer sees the errors and the pipeline continues (or shuts down, depending on policy).

### Test order

For ordered pipelines, verify the output is strictly in order:

```go
prev := -1
for v := range out {
    if v <= prev {
        t.Fatalf("out of order: %d after %d", v, prev)
    }
    prev = v
}
```

### Test throughput

For performance-critical pipelines, measure throughput with `testing.B`:

```go
func BenchmarkPipeline(b *testing.B) {
    in := generateInput(b.N)
    ctx := context.Background()
    b.ResetTimer()
    out := pipeline(ctx, in)
    for range out {
    }
}
```

---

## Migration: Plain Goroutines to errgroup

If you have an existing fan-out using `sync.WaitGroup` and manual error capture:

```go
var wg sync.WaitGroup
var mu sync.Mutex
var firstErr error
for _, item := range items {
    item := item
    wg.Add(1)
    go func() {
        defer wg.Done()
        if err := process(item); err != nil {
            mu.Lock()
            if firstErr == nil {
                firstErr = err
            }
            mu.Unlock()
        }
    }()
}
wg.Wait()
if firstErr != nil { return firstErr }
```

Migrate to:

```go
g, ctx := errgroup.WithContext(ctx)
for _, item := range items {
    item := item
    g.Go(func() error {
        return process(ctx, item)
    })
}
return g.Wait()
```

Equivalent semantics, much less code. Plus you get cancellation on first error if `process` respects `ctx`.

---

## Migration: errgroup to streaming

Sometimes you want to process items as they arrive, not collect-then-process. Convert from `errgroup` (collect-then-return) to a streaming pipeline:

Before (errgroup):

```go
g, ctx := errgroup.WithContext(ctx)
results := make([]Result, len(items))
for i, item := range items {
    i, item := i, item
    g.Go(func() error {
        r, err := process(ctx, item)
        if err != nil {
            return err
        }
        results[i] = r
        return nil
    })
}
if err := g.Wait(); err != nil { return err }
for _, r := range results {
    consume(r)
}
```

After (streaming):

```go
in := make(chan Item)
out := make(chan Result)
g, ctx := errgroup.WithContext(ctx)
g.SetLimit(8)
go func() {
    defer close(in)
    for _, item := range items {
        select {
        case in <- item:
        case <-ctx.Done():
            return
        }
    }
}()
for i := 0; i < 8; i++ {
    g.Go(func() error {
        for item := range in {
            r, err := process(ctx, item)
            if err != nil {
                return err
            }
            select {
            case out <- r:
            case <-ctx.Done():
                return ctx.Err()
            }
        }
        return nil
    })
}
go func() {
    g.Wait()
    close(out)
}()
for r := range out {
    consume(r)
}
return g.Wait()
```

Streaming consumes items as they finish; collect-then-process waits for all. Use streaming when:

- The total number of items is unbounded or very large.
- You want consume-side parallelism with the produce side.
- Early items can be acted on before late items finish.

---

## A Word on `sync.Map` and Fan-Out

`sync.Map` is sometimes pitched as the "concurrent map." It is good for read-mostly maps where keys come and go. For fan-out scenarios where workers write to a shared map, `sync.Map` is often slower than `map[K]V` protected by a `sync.Mutex` for typical workloads.

Avoid the temptation to share a `sync.Map` across workers as a "concurrent counter." Use per-worker maps merged at the end, or use sharded atomic counters.

---

## Wrap-Up

Middle-level fan-out / fan-in is the bread-and-butter of production Go pipelines. The skills:

- Compose stages into pipelines.
- Bound concurrency consistently.
- Use `errgroup` for fault propagation.
- Tag-and-reorder for ordering.
- Profile and tune buffer sizes.
- Test for leaks, cancellation, and partial failure.

You can now ship pipelines. The senior level zooms out to architecture: when to fan-out, when to refactor, how to design for resilience.

---

## Cookbook: Common Recipes

### Recipe: Bounded parallel map

Apply a function to every element of a slice using bounded parallelism. Return results in input order.

```go
func parallelMap[I, O any](ctx context.Context, in []I, workers int, fn func(context.Context, I) (O, error)) ([]O, error) {
    type tagged struct {
        seq int
        val O
        err error
    }
    out := make([]O, len(in))
    jobs := make(chan int)
    results := make(chan tagged)
    g, gctx := errgroup.WithContext(ctx)
    for i := 0; i < workers; i++ {
        g.Go(func() error {
            for idx := range jobs {
                v, err := fn(gctx, in[idx])
                select {
                case results <- tagged{seq: idx, val: v, err: err}:
                case <-gctx.Done():
                    return gctx.Err()
                }
            }
            return nil
        })
    }
    g.Go(func() error {
        defer close(jobs)
        for i := range in {
            select {
            case jobs <- i:
            case <-gctx.Done():
                return gctx.Err()
            }
        }
        return nil
    })
    done := make(chan struct{})
    go func() {
        defer close(done)
        for i := 0; i < len(in); i++ {
            select {
            case r := <-results:
                if r.err != nil {
                    return
                }
                out[r.seq] = r.val
            case <-gctx.Done():
                return
            }
        }
    }()
    err := g.Wait()
    <-done
    return out, err
}
```

A workhorse function. Bounds parallelism, preserves order, propagates errors. Most of your fan-out / fan-in needs are some specialisation of this.

### Recipe: Streaming fan-out filter

Filter items in parallel; emit the kept ones in arrival order.

```go
func parallelFilter[T any](ctx context.Context, in <-chan T, workers int, keep func(T) bool) <-chan T {
    out := make(chan T)
    var wg sync.WaitGroup
    wg.Add(workers)
    for i := 0; i < workers; i++ {
        go func() {
            defer wg.Done()
            for v := range in {
                if keep(v) {
                    select {
                    case out <- v:
                    case <-ctx.Done():
                        return
                    }
                }
            }
        }()
    }
    go func() {
        wg.Wait()
        close(out)
    }()
    return out
}
```

Order is lost in the parallel filter. For ordered filter, tag-and-reorder.

### Recipe: Fan-in with priority

Two input streams, one high-priority, one low. Always prefer high.

```go
func priorityMerge[T any](ctx context.Context, high, low <-chan T) <-chan T {
    out := make(chan T)
    go func() {
        defer close(out)
        for {
            // Try high first
            select {
            case v, ok := <-high:
                if !ok {
                    // High closed; drain low
                    for v := range low {
                        select {
                        case out <- v:
                        case <-ctx.Done():
                            return
                        }
                    }
                    return
                }
                select {
                case out <- v:
                case <-ctx.Done():
                    return
                }
                continue
            default:
            }
            // Fall back to low if high has nothing
            select {
            case v, ok := <-high:
                if !ok {
                    for v := range low {
                        select {
                        case out <- v:
                        case <-ctx.Done():
                            return
                        }
                    }
                    return
                }
                select {
                case out <- v:
                case <-ctx.Done():
                    return
                }
            case v, ok := <-low:
                if !ok {
                    return
                }
                select {
                case out <- v:
                case <-ctx.Done():
                    return
                }
            case <-ctx.Done():
                return
            }
        }
    }()
    return out
}
```

The trick: a non-blocking `select` with `default` checks high first. Only if high has nothing do we fall to a blocking `select` on both. This gives strict priority while not busy-waiting.

### Recipe: Take until predicate

Stop reading once a predicate fires; cancel upstream.

```go
func takeUntil[T any](ctx context.Context, in <-chan T, stop func(T) bool) <-chan T {
    out := make(chan T)
    ctx, cancel := context.WithCancel(ctx)
    go func() {
        defer cancel()
        defer close(out)
        for v := range in {
            select {
            case out <- v:
            case <-ctx.Done():
                return
            }
            if stop(v) {
                return
            }
        }
    }()
    return out
}
```

`defer cancel()` propagates the stop upstream once the predicate fires. Upstream stages select on `ctx.Done()` and exit.

### Recipe: Window aggregation with fan-in

Aggregate values into fixed-size windows; emit one aggregate per window.

```go
func window[T, A any](ctx context.Context, in <-chan T, size int, agg func(A, T) A, zero A) <-chan A {
    out := make(chan A)
    go func() {
        defer close(out)
        acc := zero
        count := 0
        for v := range in {
            acc = agg(acc, v)
            count++
            if count == size {
                select {
                case out <- acc:
                case <-ctx.Done():
                    return
                }
                acc = zero
                count = 0
            }
        }
        if count > 0 {
            select {
            case out <- acc:
            case <-ctx.Done():
                return
            }
        }
    }()
    return out
}
```

Useful before or after a fan-in for batched processing.

### Recipe: Rate-limited fan-out

Cap requests per second across all workers.

```go
func rateLimitedFanOut[I, O any](ctx context.Context, in <-chan I, workers, rate int, fn func(context.Context, I) O) <-chan O {
    out := make(chan O)
    limiter := time.NewTicker(time.Second / time.Duration(rate))
    var wg sync.WaitGroup
    wg.Add(workers)
    for i := 0; i < workers; i++ {
        go func() {
            defer wg.Done()
            for v := range in {
                select {
                case <-limiter.C:
                case <-ctx.Done():
                    return
                }
                r := fn(ctx, v)
                select {
                case out <- r:
                case <-ctx.Done():
                    return
                }
            }
        }()
    }
    go func() {
        wg.Wait()
        limiter.Stop()
        close(out)
    }()
    return out
}
```

The single ticker is shared across workers. All workers compete for ticks; total rate is bounded. For per-worker rate, use one ticker each.

### Recipe: Splitting one channel into hot and cold

```go
func split[T any](ctx context.Context, in <-chan T, isHot func(T) bool) (hot, cold <-chan T) {
    h := make(chan T)
    c := make(chan T)
    go func() {
        defer close(h)
        defer close(c)
        for v := range in {
            var target chan T
            if isHot(v) {
                target = h
            } else {
                target = c
            }
            select {
            case target <- v:
            case <-ctx.Done():
                return
            }
        }
    }()
    return h, c
}
```

Each downstream subscribes to one channel. Composes with fan-out / fan-in naturally.

---

## When Fan-Out Hurts

Fan-out is not always a win. A few cases where adding workers makes things worse:

### Case 1: The downstream is the bottleneck

```
producer -> 8 workers -> 1 consumer (slow)
```

Throughput is limited by the consumer. Adding more workers does not help and adds scheduling overhead. Measure first.

### Case 2: Work is too small

If each item takes 100 ns of work and channel ops take 200 ns each, fan-out doubles the overhead per item. Sequential is faster.

Diagnostic: time the sequential version. If it is already as fast as needed, do not fan-out.

### Case 3: Memory bandwidth saturation

For workloads that stream large buffers through memory (e.g., compression, hashing), memory bandwidth is the bottleneck above 2-4 cores. Adding workers past that point yields no speedup, and may even slow down due to cache eviction.

### Case 4: Lock contention dominates

If workers all contend on a shared lock (e.g., a global map without sharding), more workers cause more contention. Lock-free or per-worker structures help.

### Case 5: The merge is the bottleneck

Rare but real. If the merge stage is doing significant work (e.g., expensive sorting), it can become the bottleneck. Move work out of the merge into stages before or after.

---

## A Story: Why We Added a Buffer

Real-world flavour: a story from a production pipeline.

A team had a fan-out / fan-in pipeline that fetched data from a remote API. Eight workers, each making HTTP calls, results merged into a single channel for downstream processing.

The pipeline ran at ~80% of expected throughput. Profile showed the workers were occasionally idle, even when the input had items.

Investigation: the merge's forwarders were blocked on `out <- v`, waiting for the downstream consumer. Each worker was waiting for its forwarder. When the consumer paused (every ~100 ms for GC), all 8 workers stalled. After the pause, they all rushed to send, but the merge could only forward one at a time.

Fix: add a buffer of 8 to the merged channel. Now each worker can drop its result into the buffer without blocking; the consumer drains the buffer when it resumes. Throughput went up to ~99% of expected.

Lesson: a small buffer matched to the worker count smooths consumer hiccups without hiding backpressure. The buffer was justified by measurement, not by guess.

---

## Pipeline Composition Patterns

A pipeline is built by composing stages. The composition itself has patterns.

### Linear pipeline

```
A -> B -> C -> D
```

Each stage has one input and one output. Simplest. No fan-out, no fan-in.

### Fan-out at a stage

```
A -> B -> [B1, B2, B3] -> C -> D
```

Stage B has three parallel workers. Merge implicit (workers share one output channel) or explicit.

### Multi-level fan-out

```
A -> [B1, B2] -> M1 -> [C1, C2, C3, C4] -> M2 -> D
```

Two fan-out stages with merges in between. Each stage's fan-out is independent.

### Branch and merge

```
A -> split -> [B, C] -> join -> D
```

`split` routes items to B or C based on a predicate. `join` is a fan-in. Result is one stream.

### Tee and zip

```
A -> tee -> [B, C] -> zip -> D
```

`tee` duplicates the stream. B and C see every item. `zip` pairs them: emits (B's i-th, C's i-th).

### Cycle

Rare but real. A pipeline that feeds part of its output back to its input.

```
A -> B -> C -> filter -> back to A (for unprocessed) | D (for done)
```

Cycles are dangerous: ensure termination. Use a counter or a budget to bound iterations.

---

## Pipeline Design Checklist

When you sit down to design a pipeline:

1. List the stages. Name them.
2. For each stage, list input and output types.
3. For each stage, decide: serial or fan-out?
4. For fan-out stages, decide: order-preserving or not?
5. For each stage, decide: how does it handle errors?
6. Decide: what causes the pipeline to stop?
7. Decide: how is cancellation propagated?
8. Sketch the channels: who writes, who reads, who closes.
9. Estimate buffer sizes.
10. Plan tests: leak test, cancellation test, throughput test.

Spend an hour on this design before writing code. The first design is rarely the final one; iterate.

---

## More Tricky Questions

**Q.** Why does `errgroup.WithContext` return a context, not modify the parent?

**A.** Because the parent might be used elsewhere. The returned context is a child that the group can cancel independently. If `errgroup` cancelled the parent, every other consumer of the parent would also stop, possibly unintended.

---

**Q.** I have a stage that takes 10 ms per item on average but occasionally 1 second. Should I fan out?

**A.** Yes — fan-out hides the tail. With 1 worker, the consumer sees occasional 1-second pauses. With 8 workers, those 1-second items overlap with others; the consumer rarely waits. Tail-latency reduction is one of the strongest reasons for fan-out.

---

**Q.** My pipeline has a stage that calls a remote service with retries. Where should I put the retry?

**A.** Inside the worker. Each worker independently retries its current item. If you retry at a higher level (the merge or the consumer), you lose context and cannot retry the failing operation precisely.

---

**Q.** Should I use `chan []T` (batches) or `chan T` (individuals) for high-throughput pipelines?

**A.** Batches reduce per-item overhead but add latency. If the consumer benefits from batching (e.g., batched DB writes), use batches. If items are independent, individuals are simpler.

---

**Q.** Can I dynamically change the fan-out factor at runtime?

**A.** Hard with `sync.WaitGroup` based pools. Easier with a supervisor pattern where the dispatcher decides per-item which worker to send to. For runtime auto-scaling, you usually rebuild the pipeline.

---

**Q.** I have 100 channels and I want to merge them. Will the merge function with 100 goroutines be slow?

**A.** Probably fine. 100 goroutines is negligible. The runtime handles them easily. If you have 100 000 channels, you would want `reflect.Select` (senior level) instead — but that is a different scale.

---

**Q.** What's the cost of `context.Context` in a hot path?

**A.** Checking `<-ctx.Done()` in a select is fast (no allocation, no syscall). Adding a context to every call is negligible compared to any real work. Do not micro-optimise this away.

---

**Q.** How do I tell if my pipeline is leaking?

**A.** Run with `goleak.VerifyNone` in tests. In production, monitor `runtime.NumGoroutine()`. A stable steady-state count is healthy. A monotonically increasing count is a leak.

---

## Operations Considerations

### Logging and tracing

Production pipelines log at three levels:

1. Per-item: only on errors. Per-item info logging at high rate floods logs.
2. Per-batch: progress updates ("processed 10 000 items").
3. Per-pipeline-run: start, end, totals.

Tracing (OpenTelemetry, Datadog APM, etc.) wraps each stage. Each item carries a trace context. The trace shows time spent in each stage.

### Metrics

Common Prometheus metrics:

- `pipeline_items_total{stage="fetch"}` — counter, items entering each stage.
- `pipeline_errors_total{stage="fetch"}` — counter, errors per stage.
- `pipeline_duration_seconds{stage="fetch"}` — histogram, time per item per stage.
- `pipeline_inflight{stage="fetch"}` — gauge, items currently in flight.
- `pipeline_goroutines` — gauge, total goroutines.

Alert on: `errors_total` rate, `inflight` exceeding a threshold, `goroutines` growing unbounded.

### Resource limits

Pipelines that run continuously need resource caps:

- Maximum number of goroutines (often via fan-out factor).
- Maximum buffer sizes (channel capacity).
- Maximum batch sizes.
- Maximum memory (Go's `GOMEMLIMIT` can help).

Without caps, a single bad input can spawn unbounded work.

### Deployment shapes

- **Batch job:** runs once, processes N items, exits.
- **Long-running daemon:** processes items as they arrive, runs forever.
- **Service component:** part of a larger service, started and stopped on demand.

Each shape has different concerns. Batch jobs care about throughput. Daemons care about steady-state behavior. Service components care about graceful start/stop.

---

## Beyond This Level

By the end of middle level, you can build production fan-out / fan-in pipelines. Things you have *not* yet learned:

- Dynamic channel sets (`reflect.Select`). Coming at senior level.
- Architecture-level patterns (supervisors, restart strategies). Senior level.
- Runtime internals (selectgo, GMP behavior under fan-out load). Professional level.
- Formal verification of pipeline properties. Specialised.

Move to senior when:

- You have built and shipped at least one production fan-out / fan-in pipeline.
- You have profiled and tuned a pipeline based on measurements.
- You can explain backpressure, ordering, and cancellation in interview-quality terms.
- You have hit a real bug — leak, ordering issue, deadlock — and fixed it.

When those four are true, senior-level material will feel natural.
