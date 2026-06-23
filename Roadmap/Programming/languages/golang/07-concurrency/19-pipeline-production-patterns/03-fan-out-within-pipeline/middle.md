---
layout: default
title: Middle
parent: Fan-Out Within Pipeline
grand_parent: Pipeline Production Patterns
ancestor: Go
nav_order: 3
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/19-pipeline-production-patterns/03-fan-out-within-pipeline/middle/
---

# Fan-Out Within a Pipeline Stage — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Ordered vs Unordered Fan-Out](#ordered-vs-unordered-fan-out)
6. [Sequence Numbers and Reorder Buffers](#sequence-numbers-and-reorder-buffers)
7. [Controlling Concurrency Per Stage](#controlling-concurrency-per-stage)
8. [Error Propagation Across Workers](#error-propagation-across-workers)
9. [Cancellation Semantics](#cancellation-semantics)
10. [errgroup with Fan-Out](#errgroup-with-fan-out)
11. [Code Examples](#code-examples)
12. [Coding Patterns](#coding-patterns)
13. [Clean Code](#clean-code)
14. [Performance Tips](#performance-tips)
15. [Best Practices](#best-practices)
16. [Edge Cases & Pitfalls](#edge-cases-pitfalls)
17. [Common Mistakes](#common-mistakes)
18. [Tricky Points](#tricky-points)
19. [Test](#test)
20. [Tricky Questions](#tricky-questions)
21. [Cheat Sheet](#cheat-sheet)
22. [Self-Assessment Checklist](#self-assessment-checklist)
23. [Summary](#summary)
24. [What You Can Build](#what-you-can-build)
25. [Further Reading](#further-reading)
26. [Related Topics](#related-topics)
27. [Diagrams & Visual Aids](#diagrams-visual-aids)

---

## Introduction
> Focus: "When does fan-out belong in my design? How do I preserve order when I have to? How do I make it cancel cleanly?"

At the junior level you learned the canonical unordered fan-out template: spawn N workers, share an input channel, write to one output channel, close it from a single closer goroutine. That pattern handles most situations where item order does not matter.

Middle level is about the harder design choices that come up the moment the canonical template is not enough:

- The consumer downstream *does* need items in their original order.
- The job can fail, and we want to stop the pipeline on the first failure.
- The caller cancels the operation (the user closed the browser, the request context timed out) and we want all workers to abort within milliseconds.
- The number of workers should not be hard-coded; it should be chosen to match the actual bottleneck.
- Different workloads need different fan-out widths in the same pipeline.

This file covers ordered vs unordered fan-out, sequence numbers, per-stage concurrency tuning, error propagation, context-based cancellation, and the standard library's `errgroup` package. The patterns build directly on the junior template; nothing here changes the basic shape (one input, many workers, one output) — only what flows through the channels and when goroutines exit.

After reading this file you will:

- Decide between ordered and unordered fan-out based on consumer requirements
- Implement order-preserving fan-out with sequence numbers and reorder buffers
- Implement order-preserving fan-out with one queue per worker (deterministic dispatch)
- Tune the width N of each stage independently using configuration
- Propagate cancellation from a `context.Context` to all workers within milliseconds
- Use `errgroup.WithContext` and `errgroup.SetLimit` for bounded-concurrency error-aware fan-out
- Design the failure mode: continue-on-error, fail-fast, or first-success
- Reason about backpressure across multi-stage fanned-out pipelines

You do not need yet to know about adaptive concurrency, tail-latency engineering, work-stealing topologies, or scheduler internals — those belong to senior and professional level.

---

## Prerequisites

- **Required:** You can write the unordered fan-out template from memory.
- **Required:** You know `context.Context`: how to create one, how to cancel it, how to check `<-ctx.Done()`.
- **Required:** You have read about `select` and know that a `select` blocks until any case is ready.
- **Required:** You are comfortable with errors as values, error wrapping, and `errors.Is`/`errors.As`.
- **Helpful:** You have used `golang.org/x/sync/errgroup` in another setting.
- **Helpful:** You understand goroutine leaks well enough to write a test that detects them.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Sequence number** | A monotonically increasing integer attached to each input item. Used to reorder outputs after unordered processing. |
| **Reorder buffer** | A map or heap that holds processed items until earlier items are ready to be emitted, restoring input order. |
| **Per-worker queue** | An alternative ordering strategy where each worker has its own input channel and a dispatcher round-robins inputs across them. |
| **Concurrency budget** | The maximum number of workers a stage is allowed to use. Often derived from connection-pool sizes or rate limits. |
| **errgroup** | `golang.org/x/sync/errgroup` — a small helper combining WaitGroup, error collection, and (with `WithContext`) cancellation on first error. |
| **`errgroup.SetLimit`** | An errgroup method that bounds the number of goroutines actively running, used as a built-in worker pool. |
| **Cancellation** | Asking running work to stop. In Go, signalled by `ctx.Done()` becoming closed. Workers must observe this signal. |
| **Fail-fast** | A failure policy: on the first worker error, cancel the context and stop all other workers. |
| **Continue-on-error** | A failure policy: each worker's error is reported but does not stop the pipeline. |
| **First-success** | A failure policy where any single worker's success terminates the others. Common for "ask several replicas, take the fastest". |
| **`select` in worker** | A `select` block that races `<-in`, `<-ctx.Done()`, and `out <- v` cases to allow cancellation between every operation. |

---

## Core Concepts

### Three questions every fan-out design must answer

1. **What is the width N?** Pick a number. Justify it from the bottleneck.
2. **Does order matter?** If yes, choose between sequence-number reorder and per-worker queues.
3. **What is the failure mode?** Continue, fail-fast, or first-success. Each requires different code.

Most production bugs in fan-out come from skipping one of these questions and finding out about it via a customer complaint.

### Width N is a tuning parameter, never a constant

Hard-coding `n = 4` is the junior-level placeholder. The middle-level habit is:

- Take N from configuration (env var, config file, command-line flag).
- Default to something derived from the runtime (`runtime.NumCPU()` for CPU-bound, a multiple for I/O-bound).
- Cap it at a known limit (DB pool size, API rate limit).
- Expose it in metrics so you can verify utilisation in production.

```go
type StageConfig struct {
    Workers      int    // hard cap on concurrent workers
    OutputBuffer int    // capacity of the output channel
}
```

A pipeline with three configurable stage widths is far easier to operate than one with three hardcoded numbers.

### Ordered fan-out has two real implementations

There are exactly two practical ways to preserve order across N workers:

1. **Sequence numbers plus reorder buffer.** Each input is tagged with a sequence number on the way in. Workers do unordered work. A reorder buffer at the output side emits items in sequence-number order, holding back items whose predecessors are not yet ready.

2. **Per-worker queues with round-robin dispatch.** A dispatcher assigns input item `i` to worker `i % N`. Each worker has its own input channel. A merger reads outputs from worker 0, then 1, then 2, then N-1, then 0 again, preserving order at the cost of head-of-line blocking.

The trade-offs:

| Property | Sequence-number reorder | Per-worker queue |
|----------|-------------------------|------------------|
| Order preserved | Yes | Yes |
| Worker utilisation | High; whoever is free picks up the next item | Lower; a slow item blocks its assigned worker's queue |
| Memory | Reorder buffer grows up to N items deep | Bounded by per-worker buffer size |
| Implementation complexity | Higher; needs a heap or map | Lower; just channels |
| Latency on a slow item | The slow item delays *only* its sequence position | The slow item delays *its whole queue* |

Use sequence-number reorder when item times vary. Use per-worker queues when item times are uniform and code simplicity matters.

### Cancellation requires a `select` in every blocking operation

The unordered junior template has two blocking points inside a worker: the receive from `in` (via `range`) and the send to `out`. Either can block forever. To support cancellation, both must be wrapped in a `select` that also listens on `<-ctx.Done()`:

```go
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
        case out <- work(v):
        }
    }
}
```

The shape becomes noisier, but the pattern is mechanical. Every blocking operation in the worker becomes a select with a `ctx.Done()` companion.

### Errors are first-class, not exceptional

In a fan-out, an error from one worker is a fact about one item, not about the pipeline. The questions are:

- Should processing of *other* items continue?
- Should the pipeline as a whole stop?
- Should the error be propagated to the consumer or swallowed and logged?

Different stages of the same pipeline often answer differently. A "best-effort" enrichment stage may swallow errors; a "write to authoritative DB" stage may fail-fast.

`golang.org/x/sync/errgroup` is the standard library's answer to "fail-fast across N workers". It combines a WaitGroup, an error slot, and (with `WithContext`) automatic cancellation on first error. We will use it heavily.

---

## Ordered vs Unordered Fan-Out

Choosing between the two is the most important middle-level decision. The matrix:

| Consumer needs | Use |
|----------------|-----|
| Original input order | Ordered fan-out |
| Independent items, order indifferent | Unordered fan-out |
| Order within groups but groups independent | Per-key fan-out (covered in a separate section) |
| Time-ordering of completions | Unordered fan-out |

Reasons to prefer unordered:

- Higher worker utilisation, especially with variable item times.
- Simpler implementation.
- Lower memory overhead (no reorder buffer).
- Lower head-of-line blocking risk.

Reasons to require ordered:

- The consumer is a stateful aggregator that depends on order (running sum, deduplication-by-previous, sequence reconstruction).
- The output is written to a sequenced log or stream where order is semantic.
- The downstream system has idempotency tied to order.

When in doubt: ask the consumer "if items arrive out of order, are you correct?" If yes, default to unordered.

---

## Sequence Numbers and Reorder Buffers

### The shape of ordered fan-out with sequence numbers

```
Producer    Workers (N)             Reorder buffer    Consumer
   |             |                         |              |
   v             v                         v              v
seq 0    +--> w0 -- writes (seq, val) -->  +--> emits in
seq 1    |    w1                           |     seq order
seq 2 ---+    w2                           |
seq 3         w3                           |
```

A `Tagged[T]` wrapper carries the sequence number:

```go
type Tagged[T any] struct {
    Seq int64
    Val T
}
```

The producer attaches the sequence number. Workers handle `Tagged[T]` in, `Tagged[U]` out. The reorder buffer holds completed `Tagged[U]` until the next-expected sequence number is available, then emits.

### Reorder buffer implementation

The simplest reorder buffer is a map plus a "next expected" counter:

```go
func reorder[U any](in <-chan Tagged[U]) <-chan U {
    out := make(chan U)
    go func() {
        defer close(out)
        next := int64(0)
        pending := make(map[int64]U)
        for t := range in {
            pending[t.Seq] = t.Val
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
        // After in is closed, drain whatever's pending in order. Anything missing means a hole; if the producer guaranteed contiguous seq numbers, this is empty.
    }()
    return out
}
```

This works when sequence numbers are contiguous starting from zero. If the producer assigns them sparsely or skips, the reorder loop stalls forever waiting for `next`. The fix at this level: rely on contiguous sequence numbers; that is a producer-side invariant.

### Memory bounds of the reorder buffer

The reorder buffer grows when fast workers complete items out of order and slow workers fall behind. In the worst case it can hold up to `N-1` items waiting for one slow item. If `N=100` and each item is 1 MB, that is 100 MB of buffer. This is one reason ordered fan-out has higher memory cost than unordered.

To bound the buffer, you can cap the number of items in-flight by buffering the input to the workers. A `make(chan Tagged[T], N)` input plus N workers means at most 2N items in flight, so the reorder buffer holds at most N items.

### Variant: per-worker queues

The alternative ordering strategy avoids the reorder buffer:

```go
func orderedPerWorker[T, U any](in <-chan T, n int, work func(T) U) <-chan U {
    queues := make([]chan T, n)
    outs := make([]chan U, n)
    for i := range queues {
        queues[i] = make(chan T)
        outs[i] = make(chan U)
        go func(i int) {
            defer close(outs[i])
            for v := range queues[i] {
                outs[i] <- work(v)
            }
        }(i)
    }
    // dispatcher: round-robin in across queues.
    go func() {
        i := 0
        for v := range in {
            queues[i] <- v
            i = (i + 1) % n
        }
        for _, q := range queues {
            close(q)
        }
    }()
    // merger: read out[0], out[1], ... out[n-1], out[0], ... in lockstep.
    out := make(chan U)
    go func() {
        defer close(out)
        for {
            allClosed := true
            for i := 0; i < n; i++ {
                v, ok := <-outs[i]
                if !ok {
                    continue
                }
                allClosed = false
                out <- v
            }
            if allClosed {
                return
            }
        }
    }()
    return out
}
```

This preserves order but suffers head-of-line blocking: if worker 0 has a slow item, workers 1..N-1 may be idle while the merger waits on worker 0. For uniform item times this is fine and elegant; for variable times the sequence-number version utilises workers better.

---

## Controlling Concurrency Per Stage

### Each stage's width is independent

In a multi-stage pipeline, each fanned-out stage has its own width. The widths should match the bottleneck of each stage, not the slowest stage's bottleneck.

```go
type Config struct {
    HashWorkers    int  // CPU-bound: NumCPU
    FetchWorkers   int  // network: 32
    DBWriteWorkers int  // capped at DB pool size: 10
}
```

A common mistake: setting all widths to the same number. The fast stages are over-provisioned (wasting goroutines, paying scheduling overhead) and the slow stages are under-provisioned (still the bottleneck).

### Width N derivation rules

- **CPU-bound:** start with `runtime.NumCPU()`. Measure. If hyperthreading helps, go up to 2x; if it hurts, go down to 0.75x.
- **Network-bound:** start with the lesser of (remote rate limit, local fd limit, sane default like 32). Measure latency under load; if p99 increases sharply at higher N, back off.
- **DB-bound:** never exceed your connection pool size. Reserve a few connections for the rest of the application.
- **Disk-bound:** typically 1–4 workers. Disks are linear in random throughput; more workers add seek overhead.
- **Mixed:** profile under realistic load. There is no general formula.

### Bounded fan-out with `errgroup.SetLimit`

The Go ecosystem standard for "fan-out with concurrency cap and fail-fast" is `errgroup`:

```go
import "golang.org/x/sync/errgroup"

func process(ctx context.Context, items []Job, n int) error {
    g, gctx := errgroup.WithContext(ctx)
    g.SetLimit(n)
    for _, j := range items {
        j := j
        g.Go(func() error {
            select {
            case <-gctx.Done():
                return gctx.Err()
            default:
            }
            return handle(gctx, j)
        })
    }
    return g.Wait()
}
```

`g.Go` blocks if the active goroutine count has reached `n`. On the first non-nil error returned by any worker, `gctx` is cancelled, and remaining workers see it. `g.Wait()` returns the first error.

`errgroup.SetLimit` is the "bounded concurrency" knob — equivalent to writing your own semaphore. Use it when you have a static list of items.

For streaming inputs (a channel), use the channel-fan-out template with cancellation, not `errgroup.SetLimit`. The two patterns serve different shapes.

---

## Error Propagation Across Workers

### Failure mode 1: continue-on-error

Each worker reports its error in the result struct. The pipeline keeps running. The consumer logs errors and continues. This is the default at junior level and is still correct for most enrichment-style pipelines.

```go
type Result struct {
    Job Job
    Out Value
    Err error
}
```

### Failure mode 2: fail-fast with errgroup

On the first error, cancel everything. Use `errgroup.WithContext`:

```go
g, gctx := errgroup.WithContext(ctx)
g.SetLimit(n)
in := stream(gctx)
for j := range in {
    j := j
    g.Go(func() error {
        return process(gctx, j)
    })
}
if err := g.Wait(); err != nil {
    return err
}
```

Note: `process` must observe `gctx` and return promptly when it is cancelled.

### Failure mode 3: first-success

Several replicas, take the first to answer. The shape is similar to fail-fast but reversed: the first *success* cancels the others.

```go
type result struct {
    val string
    err error
}
results := make(chan result, n)
ctx, cancel := context.WithCancel(parent)
defer cancel()
for i := 0; i < n; i++ {
    go func() {
        v, err := tryReplica(ctx)
        results <- result{val: v, err: err}
    }()
}
var firstErr error
for i := 0; i < n; i++ {
    r := <-results
    if r.err == nil {
        cancel() // tell other replicas to stop
        return r.val, nil
    }
    if firstErr == nil {
        firstErr = r.err
    }
}
return "", firstErr
```

The cancelled replicas may finish anyway (the cancellation is cooperative); we throw their results away.

---

## Cancellation Semantics

### Three levels of "the worker stops"

1. **End of input.** Producer closes `in`. Workers' `range` ends. They exit cleanly. This is the normal-shutdown path.
2. **Context cancellation.** Consumer signals `ctx.Cancel()`. Workers observe `<-ctx.Done()` and return immediately, possibly mid-item. This is the "abort" path.
3. **Panic.** Something blows up. The deferred `wg.Done()` still fires (if installed), but the program is about to crash anyway.

The middle-level pattern handles all three. The worker body:

```go
for {
    select {
    case <-ctx.Done():
        return
    case v, ok := <-in:
        if !ok {
            return
        }
        // Optionally check ctx again before doing expensive work.
        select {
        case <-ctx.Done():
            return
        default:
        }
        u, err := work(ctx, v)
        select {
        case <-ctx.Done():
            return
        case out <- Result{Job: v, Out: u, Err: err}:
        }
    }
}
```

This shape is canonical for context-aware fan-out workers. Memorise the structure: `select` at every blocking point, always with a `ctx.Done()` branch.

### The closer must also respect ctx

If the consumer is no longer reading because the context was cancelled, the closer's `wg.Wait()` is still correct — workers exit on `ctx.Done()` and call `Done()`. The closer then closes the output. The consumer, even if abandoned, will see the close on `out` if it ever ranges again.

The key invariant: the closer only does two things — wait and close. It does not need to know about ctx itself; it relies on the workers to exit on cancellation.

### Cleanup of in-flight items on cancellation

When a worker exits via `<-ctx.Done()` mid-item, the partially-processed item is lost. If your pipeline must finish in-flight items before exiting (graceful shutdown), use a longer timeout on the context and drain rather than cancel. Most pipelines do not need this — they restart from the input source.

---

## errgroup with Fan-Out

`errgroup` is the standard library wrapper that combines WaitGroup, error collection, optional concurrency limiting, and (with `WithContext`) automatic cancellation on first error. Use it for fan-out over a static set of items.

### The canonical errgroup fan-out

```go
import (
    "context"
    "golang.org/x/sync/errgroup"
)

func processAll(ctx context.Context, items []Job, n int) ([]Result, error) {
    g, gctx := errgroup.WithContext(ctx)
    g.SetLimit(n)
    results := make([]Result, len(items))
    for i, j := range items {
        i, j := i, j
        g.Go(func() error {
            r, err := process(gctx, j)
            if err != nil {
                return err
            }
            results[i] = r
            return nil
        })
    }
    if err := g.Wait(); err != nil {
        return nil, err
    }
    return results, nil
}
```

Notes:

- `results[i] = r` is safe because each `i` is unique to one goroutine; no two goroutines touch the same slice element.
- `g.Go` blocks if `SetLimit` is set and the limit is reached. This means the for loop naturally paces itself.
- On first error, `gctx` is cancelled; any worker observing `gctx.Done()` should return promptly.
- `g.Wait()` returns the first error, or nil if all workers succeeded.

### When errgroup is the wrong tool

errgroup works for finite, known-in-advance lists of items. For streaming inputs from a channel, it does not fit naturally — `g.Go` would be called in a loop ranging over the channel, but the loop itself blocks the calling goroutine while reading. The patterns this file describes (channel-fan-out with ctx) are the answer for streaming.

### Mixing errgroup with channel fan-out

A reasonable hybrid: use the channel-fan-out template, but funnel errors through a result struct AND track in a `*errgroup.Group` so the first non-nil error cancels the rest. This is verbose; most teams pick one style and stick with it.

---

## Code Examples

### 1. Ordered fan-out with sequence numbers

```go
package main

import (
    "fmt"
    "math/rand"
    "sync"
    "time"
)

type Tagged[T any] struct {
    Seq int64
    Val T
}

func tag[T any](in <-chan T) <-chan Tagged[T] {
    out := make(chan Tagged[T])
    go func() {
        defer close(out)
        var seq int64
        for v := range in {
            out <- Tagged[T]{Seq: seq, Val: v}
            seq++
        }
    }()
    return out
}

func work[T, U any](in <-chan Tagged[T], n int, f func(T) U) <-chan Tagged[U] {
    out := make(chan Tagged[U])
    var wg sync.WaitGroup
    for i := 0; i < n; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for t := range in {
                out <- Tagged[U]{Seq: t.Seq, Val: f(t.Val)}
            }
        }()
    }
    go func() {
        wg.Wait()
        close(out)
    }()
    return out
}

func reorder[U any](in <-chan Tagged[U]) <-chan U {
    out := make(chan U)
    go func() {
        defer close(out)
        next := int64(0)
        pending := make(map[int64]U)
        for t := range in {
            pending[t.Seq] = t.Val
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

func main() {
    in := make(chan int)
    go func() {
        defer close(in)
        for i := 0; i < 12; i++ {
            in <- i
        }
    }()
    tagged := tag(in)
    processed := work(tagged, 4, func(v int) int {
        // simulate variable work time
        time.Sleep(time.Duration(rand.Intn(50)) * time.Millisecond)
        return v * v
    })
    ordered := reorder(processed)
    for v := range ordered {
        fmt.Println(v)
    }
}
```

Output: 0, 1, 4, 9, 16, 25, ... — strictly in input order despite unordered processing.

### 2. Cancellation-aware unordered fan-out

```go
package main

import (
    "context"
    "fmt"
    "sync"
    "time"
)

type Result struct {
    In  int
    Out int
    Err error
}

func fanOut(ctx context.Context, in <-chan int, n int, work func(context.Context, int) (int, error)) <-chan Result {
    out := make(chan Result)
    var wg sync.WaitGroup
    for i := 0; i < n; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for {
                select {
                case <-ctx.Done():
                    return
                case v, ok := <-in:
                    if !ok {
                        return
                    }
                    u, err := work(ctx, v)
                    select {
                    case <-ctx.Done():
                        return
                    case out <- Result{In: v, Out: u, Err: err}:
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

func slowSquare(ctx context.Context, v int) (int, error) {
    select {
    case <-ctx.Done():
        return 0, ctx.Err()
    case <-time.After(100 * time.Millisecond):
        return v * v, nil
    }
}

func main() {
    ctx, cancel := context.WithTimeout(context.Background(), 250*time.Millisecond)
    defer cancel()

    in := make(chan int)
    go func() {
        defer close(in)
        for i := 1; i <= 20; i++ {
            select {
            case <-ctx.Done():
                return
            case in <- i:
            }
        }
    }()

    for r := range fanOut(ctx, in, 4, slowSquare) {
        if r.Err != nil {
            fmt.Printf("err %d: %v\n", r.In, r.Err)
            continue
        }
        fmt.Printf("ok %d -> %d\n", r.In, r.Out)
    }
    fmt.Println("done")
}
```

After 250 ms, the context times out. Within milliseconds every worker returns, the closer closes the output, the consumer's range loop ends. The pipeline shuts down cleanly even with twenty items still in flight.

### 3. Fan-out with errgroup over a slice

```go
package main

import (
    "context"
    "fmt"
    "time"

    "golang.org/x/sync/errgroup"
)

func process(ctx context.Context, id int) (string, error) {
    select {
    case <-ctx.Done():
        return "", ctx.Err()
    case <-time.After(50 * time.Millisecond):
        if id == 3 {
            return "", fmt.Errorf("simulated failure on %d", id)
        }
        return fmt.Sprintf("ok-%d", id), nil
    }
}

func main() {
    ctx, cancel := context.WithTimeout(context.Background(), time.Second)
    defer cancel()

    ids := []int{1, 2, 3, 4, 5, 6, 7, 8}
    results := make([]string, len(ids))

    g, gctx := errgroup.WithContext(ctx)
    g.SetLimit(3)
    for i, id := range ids {
        i, id := i, id
        g.Go(func() error {
            v, err := process(gctx, id)
            if err != nil {
                return err
            }
            results[i] = v
            return nil
        })
    }
    if err := g.Wait(); err != nil {
        fmt.Println("first error:", err)
    }
    for i, r := range results {
        fmt.Printf("[%d] %q\n", i, r)
    }
}
```

Output: id=3 fails. The errgroup cancels the context. Some later items may still complete (they checked ctx before the cancel hit), others return early with ctx.Err. The slice positions are independent so writes are race-free.

### 4. Per-worker queue ordered fan-out (uniform times)

```go
package main

import (
    "fmt"
    "sync"
    "time"
)

func orderedPerWorker(in <-chan int, n int, work func(int) int) <-chan int {
    queues := make([]chan int, n)
    outs := make([]chan int, n)
    var wg sync.WaitGroup
    for i := range queues {
        queues[i] = make(chan int)
        outs[i] = make(chan int)
        wg.Add(1)
        go func(i int) {
            defer wg.Done()
            defer close(outs[i])
            for v := range queues[i] {
                outs[i] <- work(v)
            }
        }(i)
    }

    // dispatcher
    go func() {
        i := 0
        for v := range in {
            queues[i] <- v
            i = (i + 1) % n
        }
        for _, q := range queues {
            close(q)
        }
    }()

    out := make(chan int)
    // merger: read from outs in round-robin order.
    go func() {
        defer close(out)
        i := 0
        for {
            v, ok := <-outs[i]
            if !ok {
                // check if all queues are done
                done := true
                for _, o := range outs {
                    select {
                    case _, ok := <-o:
                        if ok {
                            done = false
                        }
                    default:
                        done = false
                    }
                }
                _ = done
                return
            }
            out <- v
            i = (i + 1) % n
        }
    }()
    return out
}

func main() {
    in := make(chan int)
    go func() {
        defer close(in)
        for i := 0; i < 12; i++ {
            in <- i
        }
    }()
    for v := range orderedPerWorker(in, 4, func(x int) int {
        time.Sleep(20 * time.Millisecond)
        return x * 10
    }) {
        fmt.Println(v)
    }
}
```

Outputs are in strict input order. Note: this implementation simplifies the merger; a production-grade version uses a proper iteration discipline. The sequence-number reorder of Example 1 is more flexible.

### 5. Configurable widths per stage

```go
type Config struct {
    FetchWorkers int
    ParseWorkers int
    WriteWorkers int
}

func runPipeline(ctx context.Context, cfg Config, in <-chan URL) error {
    fetched := fetch(ctx, in, cfg.FetchWorkers)
    parsed := parse(ctx, fetched, cfg.ParseWorkers)
    return write(ctx, parsed, cfg.WriteWorkers)
}
```

Each stage's width is set independently in `Config`. In tests, set all to 1 for determinism. In production, tune from metrics.

### 6. Aggregating per-worker metrics

```go
type Stats struct {
    Processed int64
    Errors    int64
    TotalNs   int64
}

func work(ctx context.Context, in <-chan Job, n int, stats *[]Stats) <-chan Result {
    out := make(chan Result)
    var wg sync.WaitGroup
    for i := 0; i < n; i++ {
        i := i
        wg.Add(1)
        go func() {
            defer wg.Done()
            for {
                select {
                case <-ctx.Done():
                    return
                case j, ok := <-in:
                    if !ok {
                        return
                    }
                    start := time.Now()
                    r := process(j)
                    elapsed := time.Since(start).Nanoseconds()
                    s := &(*stats)[i]
                    atomic.AddInt64(&s.Processed, 1)
                    if r.Err != nil {
                        atomic.AddInt64(&s.Errors, 1)
                    }
                    atomic.AddInt64(&s.TotalNs, elapsed)
                    select {
                    case <-ctx.Done():
                        return
                    case out <- r:
                    }
                }
            }
        }()
    }
    go func() { wg.Wait(); close(out) }()
    return out
}
```

Each worker writes to its own `Stats` element. Aggregation across workers happens outside the hot path.

---

## Coding Patterns

### Pattern: the cancellable worker template

```go
for {
    select {
    case <-ctx.Done():
        return
    case v, ok := <-in:
        if !ok {
            return
        }
        u, err := work(ctx, v)
        select {
        case <-ctx.Done():
            return
        case out <- Result{In: v, Out: u, Err: err}:
        }
    }
}
```

Three selects, two `ctx.Done()` cases. The outer select races input arrival against cancellation; the inner select races output send against cancellation.

### Pattern: tag-work-reorder pipeline for ordered fan-out

Three small stages chained:

```go
ordered := reorder(work(tag(producer()), n, fn))
```

Each stage is a function returning `<-chan T`. The composition reads left to right and the intent is clear.

### Pattern: errgroup over a slice with `SetLimit`

```go
g, gctx := errgroup.WithContext(ctx)
g.SetLimit(n)
for i, item := range items {
    i, item := i, item
    g.Go(func() error {
        return process(gctx, i, item)
    })
}
return g.Wait()
```

For static lists, this is shorter than the channel-fan-out template and gives you fail-fast and cancellation for free.

### Pattern: workers share a *pool*, not a single instance

If your worker needs a stateful resource (HTTP client, DB connection), do not share one instance across workers if that instance serialises calls. Instead, use a pool:

```go
clients := make([]*http.Client, n)
for i := range clients {
    clients[i] = &http.Client{Transport: newTransport()}
}
for i := 0; i < n; i++ {
    i := i
    wg.Add(1)
    go func() {
        defer wg.Done()
        client := clients[i] // worker owns one client
        for j := range in {
            ...
        }
    }()
}
```

Or a single client with high `MaxConnsPerHost` — both work, the trade-off is connection pool concentration vs spread.

---

## Clean Code

- Each fanned-out stage is a function that takes `(ctx, in, cfg)` and returns `<-chan Result`.
- The function name describes the stage's job, not the fan-out.
- The function comment states ordering guarantee, error policy, and cancellation behaviour explicitly.
- `Config` for each stage carries its width and any worker-local options.
- Resource setup (HTTP clients, DB statements) happens before the worker loop, not inside it.
- Errors travel in the result struct; if you also want fail-fast, layer errgroup over it.
- Tests cover three cancellation scenarios: producer closes input cleanly, context is cancelled, context times out.

---

## Performance Tips

- Sequence-number reordering costs memory in proportion to N. If N is large and items are large, profile memory before adopting it.
- Per-worker queues have head-of-line blocking. For variable item times, prefer sequence-number reorder despite the memory cost.
- `errgroup.SetLimit` allocates roughly nothing extra; it is a thin wrapper.
- `select` with `ctx.Done()` adds a few nanoseconds per blocking operation. Below 1 us per item this is measurable; above, it is noise.
- Reuse worker-local buffers and clients to amortise allocation costs.
- Aggregate metrics in worker-local counters and flush separately; per-item metric emissions are surprisingly expensive.
- Avoid allocating a new context per item. The fan-out context is shared; child contexts are needed only when each item has its own deadline.
- Use `slog` with attribute pools for log lines per worker rather than allocating per call.

---

## Best Practices

- Default to unordered fan-out unless the consumer requires order.
- For ordered fan-out, prefer sequence-number reorder over per-worker queues unless item times are uniform.
- Always thread a `context.Context` through the fan-out from the caller.
- Always wrap each blocking operation in the worker with a `select` that includes `<-ctx.Done()`.
- Use `errgroup.WithContext` for fail-fast over finite lists.
- Use channel fan-out with explicit `ctx` for streaming workloads.
- Make widths configurable, never constants.
- Document ordering, error, and cancellation policies in the helper's doc comment.
- Test that cancellation produces a goroutine count return to baseline within a deadline.
- Run with `-race` on every CI build.

---

## Edge Cases & Pitfalls

- **Sequence-number hole.** If your producer skips a sequence number, the reorder buffer stalls. Either guarantee contiguous numbers or have a timeout to emit "gap".
- **Late-arriving items after cancellation.** A worker that completed an item before observing cancellation may still try to send to `out`. If the consumer is gone, this blocks. Always wrap the send in `select`.
- **`ctx.Done()` polled too late.** If `work(ctx, v)` is a long synchronous call that does not honour ctx, cancellation does not stop it. Make the work function ctx-aware.
- **`g.Go` after `g.Wait`.** Once `Wait` is called, no more `Go` calls. Programming error; will panic.
- **Errgroup limit deadlock.** If `g.Go` is called from a goroutine that holds the only resource a previous `g.Go` is waiting on, you deadlock. Keep `g.Go` calls in the dispatcher, not in workers.
- **`reorder` consumer is slow.** If the reorder buffer's output channel is unbuffered and the consumer is slow, the reorder buffer effectively backpressures the workers. That is fine.
- **Different stages share the same `errgroup`.** Don't. Each stage has its own group; otherwise an error in stage A may cancel stage B prematurely (which may or may not be what you want).

---

## Common Mistakes

- Forgetting `<-ctx.Done()` on the output send. Worker leaks forever if the consumer abandons.
- Calling `errgroup.SetLimit` after `g.Go` was already called. Will panic.
- Sharing a non-thread-safe resource (e.g., a `bytes.Buffer`) across workers.
- Using sequence-number reorder with a non-contiguous producer. Buffer never emits.
- Implementing first-success without cancelling the losers. They keep running and waste resources.
- Closing `gctx` inside a worker. Workers should never call `cancel` on the group's context.
- Mixing channel fan-out and errgroup carelessly. Pick one shape per stage.

---

## Tricky Points

- `errgroup.Group` is one-shot. After `Wait` returns, you cannot reuse it.
- `ctx.Done()` in a `select` is *not* a polled check; it is a synchronisation primitive. Mixing with `default` cases changes the semantics.
- Reorder buffers in long-running pipelines need bounded growth or they leak memory on a single stuck item.
- When you `range` over `errgroup.WithContext`'s result, you cannot. `errgroup` returns one error, not a stream.
- `select` chooses randomly among ready cases. If both `ctx.Done()` and `<-in` are ready, the worker may process one more item before noticing cancellation. That is acceptable as long as `work(ctx, v)` itself observes cancellation.
- `g.SetLimit(n)` with `n == 0` means "no limit"; with `n < 0` means "no goroutines at all". Both are valid but rarely wanted.
- A `Tagged[T]` carrying a sequence number can be passed through many stages; each stage's workers preserve `Seq` and only the final reorder stage uses it.

---

## Test

```go
func TestOrderedFanOut(t *testing.T) {
    in := make(chan int)
    go func() {
        defer close(in)
        for i := 0; i < 100; i++ {
            in <- i
        }
    }()
    out := reorder(work(tag(in), 8, func(v int) int { return v * 2 }))
    expect := 0
    for v := range out {
        if v != expect*2 {
            t.Fatalf("expected %d, got %d at position %d", expect*2, v, expect)
        }
        expect++
    }
    if expect != 100 {
        t.Fatalf("expected 100 items, got %d", expect)
    }
}

func TestCancellationStopsWorkers(t *testing.T) {
    ctx, cancel := context.WithCancel(context.Background())
    in := make(chan int)
    go func() {
        defer close(in)
        for i := 0; i < 10000; i++ {
            select {
            case <-ctx.Done():
                return
            case in <- i:
            }
        }
    }()
    out := fanOut(ctx, in, 8, slowSquare)
    cancel()
    for range out {
        // drain
    }
    // verify no goroutines leaked — use runtime.NumGoroutine before/after.
}

func TestErrgroupFailFast(t *testing.T) {
    ctx := context.Background()
    g, gctx := errgroup.WithContext(ctx)
    g.SetLimit(4)
    for i := 0; i < 100; i++ {
        i := i
        g.Go(func() error {
            if i == 50 {
                return fmt.Errorf("fail at %d", i)
            }
            select {
            case <-gctx.Done():
                return gctx.Err()
            case <-time.After(10 * time.Millisecond):
                return nil
            }
        })
    }
    err := g.Wait()
    if err == nil {
        t.Fatal("expected error, got nil")
    }
}
```

---

## Tricky Questions

1. *Why doesn't `errgroup.SetLimit` work for streaming inputs?*
   Because the dispatcher (the for-loop that calls `g.Go`) would itself block on `g.Go` when the limit is reached, and that goroutine usually also reads the input. Channel-based fan-out separates the two concerns.

2. *In sequence-number reorder, what if N is huge and items are huge?*
   The reorder buffer can grow up to N-1 items. Memory cost = N * item_size. If that is too much, bound the in-flight items by buffering the input.

3. *What if the producer cannot guarantee contiguous sequence numbers?*
   You either (a) re-sequence in a pre-stage that drops gaps, or (b) use a heap-based reorder with a timeout to emit gaps as nils. Don't pretend gaps cannot happen — they do, in real systems with retries or partitioned inputs.

4. *If two stages share a context, do errors in stage A cancel stage B?*
   Yes, if they share the same context (e.g., via `errgroup.WithContext`). If you want stages to fail independently, give each its own derived context.

5. *Should the closer goroutine observe ctx?*
   No. The closer's job is `wg.Wait()` then `close(out)`. Workers exit on ctx; their `wg.Done()` calls let the closer proceed.

6. *Per-worker queues vs sequence-number reorder — which is simpler?*
   Per-worker queues for uniform item times. Sequence-number reorder otherwise. The reorder code is twenty lines; the per-worker merger is similar; pick the one whose properties match your workload.

7. *Can I have multiple closers (one per worker)?*
   No. Each worker calling `close(out)` is the canonical bug. The closer is exactly one goroutine.

8. *What happens to in-flight items when ctx is cancelled?*
   They are discarded. The worker observes `<-ctx.Done()` between operations and returns. If you need at-least-once processing, externalise: keep an outbox of unfinished items and resume on next run.

9. *Does `errgroup` preserve the error from the *first* failing worker, or any worker?*
   The first non-nil error returned. Subsequent errors are dropped.

10. *Why not just use `sync.WaitGroup` + an `error` channel instead of errgroup?*
    Because doing it correctly (close the error channel exactly once, race between success and error, propagate cancellation, bound concurrency) is exactly what errgroup encapsulates. It is not magic; it is convenience.

---

## Cheat Sheet

```go
// Cancellable unordered fan-out worker.
for {
    select {
    case <-ctx.Done():
        return
    case v, ok := <-in:
        if !ok {
            return
        }
        u, err := work(ctx, v)
        select {
        case <-ctx.Done():
            return
        case out <- Result{In: v, Out: u, Err: err}:
        }
    }
}
```

```go
// errgroup over a static list.
g, gctx := errgroup.WithContext(ctx)
g.SetLimit(n)
for i, item := range items {
    i, item := i, item
    g.Go(func() error { return process(gctx, i, item) })
}
return g.Wait()
```

Order decision:
- Unordered: default. Use unless the consumer breaks without order.
- Ordered: sequence-number reorder for variable times, per-worker queues for uniform times.

Failure mode decision:
- Continue-on-error: errors in result struct, consumer logs.
- Fail-fast: errgroup with WithContext + SetLimit.
- First-success: cancel siblings on first non-error return.

Width decision:
- CPU-bound: ~NumCPU.
- Network: 16–256, bounded by remote limit.
- DB: connection pool size.

---

## Self-Assessment Checklist

- [ ] I can choose between ordered and unordered fan-out based on requirements.
- [ ] I can implement sequence-number reorder and predict its memory cost.
- [ ] I can implement per-worker queue ordered fan-out and predict its head-of-line blocking behaviour.
- [ ] I can write a cancellation-aware worker by heart.
- [ ] I can use `errgroup.WithContext` and `SetLimit` correctly.
- [ ] I can decide on continue-on-error vs fail-fast vs first-success.
- [ ] I can configure stage widths independently.
- [ ] I can debug a fan-out that hangs by tracing closer goroutines and channel states.
- [ ] I can write a test that asserts cancellation completes within a deadline.
- [ ] I can describe what happens to in-flight items on cancellation.

---

## Summary

Middle-level fan-out introduces the design choices that the junior template glossed over. Ordered vs unordered determines whether sequence numbers and reorder buffers are needed. Cancellation introduces `select` blocks around every blocking operation in the worker. Error policy determines whether you use the result-struct pattern, `errgroup`, or both. Width N becomes a configuration parameter tuned per stage, not a constant.

The shape of the worker grows from "for v := range in { out <- work(v) }" to a select-based loop with three branches: cancellation, input read, output write. The pattern is mechanical once you have written it twice. The same shape handles unordered, ordered (via `Tagged`), continue-on-error, and fail-fast (via `errgroup`).

What makes this level distinct: you are no longer just expressing "do this in parallel". You are designing how a fan-out behaves when things go right (order, throughput), wrong (errors, partial failure), or are abandoned (cancellation). The patterns are well-known and the standard library covers most of them. The skill is choosing among them with confidence.

---

## What You Can Build

- A bulk URL fetcher with per-domain concurrency limits and fail-fast on auth failure
- A bulk file converter that preserves input order in the output manifest using sequence numbers
- A graceful-shutdown pipeline that completes in-flight items before exiting when SIGTERM arrives
- A multi-replica query frontend that returns the first successful response and cancels the others
- A configuration-driven ETL with per-stage widths tuned via env vars
- A streaming search index builder that orders tokens by document arrival
- A "redrive" tool that retries failed items from a previous run without re-running successes

---

## Further Reading

- `golang.org/x/sync/errgroup` source — it is small, read it
- "Go Concurrency Patterns: Context", go.dev/blog/context
- "Rate Limiting in Go", with semaphores and errgroup
- Bryan Mills' GopherCon talks on context and concurrency patterns
- Cox-Buday, *Concurrency in Go*, chapter on cancellation and timeouts

---

## Related Topics

- Context cancellation patterns (chapter 5 of this concurrency track)
- Error groups in detail (chapter 10)
- Backpressure and bounded channels (chapter 8)
- Adaptive concurrency (senior level of this file)
- Per-key fan-out (a different shape, when items group naturally)
- Rate limiting (often paired with fan-out)

---

## Diagrams & Visual Aids

Ordered fan-out flow:

```
producer
   |
   v
tag(seq)
   |
   v (Tagged[T])
+--+--+--+--+
| w0  w1  w2 | (unordered work)
+--+--+--+--+
   | (Tagged[U] out of order)
   v
reorder(map+next)
   |
   v (U in input order)
consumer
```

Cancellable worker state machine:

```
ENTRY
  |
  v
  +----------------- ctx.Done? --> EXIT
  |
  v
read in
  |
  v
work(ctx, v)
  |
  +----------------- ctx.Done? --> EXIT
  |
  v
send out
  |
  v
LOOP
```

Failure mode decision:

```
                + continue on each-item error?
                v                            v
              YES                            NO
                |                            |
                v                            v
       result-struct pattern          errgroup.WithContext
       (consumer aggregates)          (first error wins)
```
