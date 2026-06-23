---
layout: default
title: Batching Stages — Senior
parent: Batching Stages
grand_parent: Pipeline Production Patterns
ancestor: Go
nav_order: 4
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/19-pipeline-production-patterns/04-batching-stages/senior/
---

# Batching Stages — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Sync vs Async Flush — The Honest Trade-off](#sync-vs-async-flush--the-honest-trade-off)
5. [Bounded In-Flight](#bounded-in-flight)
6. [Partial-Failure Handling](#partial-failure-handling)
7. [Ordering Under Async Flush](#ordering-under-async-flush)
8. [Back-Pressure Preservation](#back-pressure-preservation)
9. [`sync.Pool` for Allocation-Free Reuse](#syncpool-for-allocation-free-reuse)
10. [Shutdown-Flush Correctness Proofs](#shutdown-flush-correctness-proofs)
11. [Worked Example — Bounded-Async DB Writer](#worked-example--bounded-async-db-writer)
12. [Worked Example — Pipelined Ordered Flushers](#worked-example--pipelined-ordered-flushers)
13. [Worked Example — Allocation-Free Hot Loop](#worked-example--allocation-free-hot-loop)
14. [Worked Example — Two-Tier Batching With Compression](#worked-example--two-tier-batching-with-compression)
15. [Diagnosing Real Production Failures](#diagnosing-real-production-failures)
16. [Pattern Catalog Cross-Reference](#pattern-catalog-cross-reference)
17. [Anti-Patterns at Senior Level](#anti-patterns-at-senior-level)
18. [Decision Matrix — Picking the Right Variant](#decision-matrix--picking-the-right-variant)
19. [Self-Assessment Checklist](#self-assessment-checklist)
20. [Summary](#summary)
21. [Further Reading](#further-reading)

---

## Introduction

> Focus: "I can write the canonical stage. Now I need to make production-grade decisions: sync vs async flush, bounded in-flight, allocation-free reuse, partial-failure handling, ordering guarantees, formal shutdown proofs."

By this tier you have internalised the triple-trigger select-loop and the per-key extensions. You know the four classic bugs and have unit tests for them. You understand the SLO-driven tuning recipe.

Senior tier is where the trade-offs sharpen. Most of the work here is not about writing more code — it is about choosing *which* code, with *what* properties, and being able to defend the choice in a design review or a post-mortem.

After reading this file you will:

- Argue convincingly whether a given pipeline should use sync flush, bounded async flush, or pipelined ordered flushers — with the worst-case latency, throughput, and memory bounds for each.
- Implement a bounded-async flusher with a fixed in-flight budget and document its ordering and back-pressure properties.
- Use `sync.Pool` to remove the per-flush copy allocation while preserving safety against the slice-reuse hazard.
- Write a formal shutdown-flush proof showing no items are lost under cancellation, input close, or downstream stall.
- Recognise the partial-failure flavors (whole-retry, split-on-fail, per-item ack, DLQ) and pick the right one for the sink.
- Diagnose three real-world production failures from their symptoms.

You do not need adaptive sizing or queue-theoretic capacity planning yet. Those are professional-tier topics.

---

## Prerequisites

- All of junior.md and middle.md. You can write the canonical stage with flush-reason tags from memory in five minutes.
- Familiarity with `sync.Pool`, `errgroup.Group`, and the Go memory model basics.
- The folders 01 (error propagation) and 02 (cancellation propagation) of this track. Senior-tier batching code routinely cites their conventions.
- Comfort reading Go runtime traces and `pprof` heap profiles.

If you can read this `errgroup.WithContext` snippet and explain what happens on a worker panic, you are ready:

```go
g, ctx := errgroup.WithContext(ctx)
for _, b := range batches {
    b := b
    g.Go(func() error { return sink.Write(ctx, b) })
}
return g.Wait()
```

---

## Glossary

| Term | Definition |
|------|-----------|
| **Sync flush** | The accumulator goroutine performs the downstream write itself; the next batch cannot start until the previous write returns. |
| **Async flush** | The accumulator hands the batch to one or more flusher goroutines and returns to the select immediately. |
| **In-flight budget** | The maximum number of batches being flushed concurrently; enforced via channel capacity or semaphore. |
| **Bounded async flush** | Async flush with a bounded in-flight budget. The only kind of async flush you should write. |
| **Per-item ack** | The sink reports per-item success/failure, allowing fine-grained retry. |
| **Whole-batch retry** | The sink reports only batch-level errors; you retry the entire batch on failure. |
| **Split-on-fail** | Recursive bisection of failing batches to isolate poison-pill items. |
| **Dead-letter queue (DLQ)** | A sink for items that cannot be processed, retained for offline analysis. |
| **Ordering preservation** | Items emerge from the downstream sink in the same order they entered the accumulator. |
| **Strict global order** | Across all keys / all batches, the original input order is preserved. |
| **Per-key order** | Items with the same key emerge in input order; items with different keys may interleave. |
| **Pipelined ordered flushers** | Multiple flusher goroutines with explicit ack tokens that preserve global order despite parallelism. |
| **`sync.Pool`** | A goroutine-local cache for reusable objects. Used here to recycle batch slices. |
| **Shutdown proof** | A short, semi-formal argument that no items are lost on cancellation or input close. |

---

## Sync vs Async Flush — The Honest Trade-off

The first design decision a senior makes about a batching stage: sync or async flush? The mistake is to default to async "because it sounds faster." Let us be honest about both.

### Sync flush

**Throughput.** Limited by the downstream call's latency. Throughput = `1 / latency_per_flush * batch_size`. For a 50 ms sink call and a batch of 100, throughput is `1 / 0.05 * 100 = 2000 items/s`.

**Latency.** End-to-end: `maxWait + sink_latency`. Predictable.

**Memory.** Bounded by `(maxSize + outCap * maxSize) * sizeof(T)`. Tiny.

**Ordering.** Trivially preserved.

**Back-pressure.** Automatic. Sink slow = accumulator stalled = producer stalled.

**Code complexity.** Lowest. The accumulator is the only goroutine.

**When to choose.** Almost always at the start. If sync gives you adequate throughput, you are done.

### Async flush (unbounded)

**Throughput.** Briefly higher; then unbounded async overwhelms the sink and throughput crashes.

**Memory.** Unbounded. Every concurrent flusher holds a batch in memory.

**Latency.** Initially low; balloons as memory fills.

**Ordering.** Lost.

**Back-pressure.** Lost.

**When to choose.** Never. This is the anti-pattern.

### Async flush (bounded)

**Throughput.** Up to `inflight * (1 / sink_latency) * batch_size`. For 4 in-flight, 50 ms, batch 100: `4 * 20 * 100 = 8000 items/s`. 4× the sync version.

**Latency.** `maxWait + sink_latency` for the slow case (when in-flight is saturated); better for the fast case. The accumulator's contribution to the latency budget is unchanged.

**Memory.** Bounded by `inflight * maxSize * sizeof(T)` plus the accumulator's own buffer. Predictable.

**Ordering.** Lost across batches by default; preserved if you add ack tokens (pipelined ordered flushers).

**Back-pressure.** Preserved at the in-flight boundary. When in-flight is full, the accumulator's `Send` to the worker channel blocks; back-pressure propagates upstream from there.

**Code complexity.** Medium. The accumulator + a worker pool + an explicit close protocol for the worker channel.

**When to choose.** When sync is throughput-bound and the sink can handle parallel calls.

### The decision rule

1. Measure sync throughput.
2. Check whether it meets your SLO.
3. If yes, stop. Use sync.
4. If no, check whether the sink supports parallel calls without per-call slowdown.
5. If yes, use bounded async with `inflight = min(sink concurrency limit, CPU count, network bandwidth bound)`.
6. If no (sink slows under parallelism), do not add async; instead try to make sync faster (larger batches, sharded sinks).

---

## Bounded In-Flight

The implementation of bounded async flush.

```go
package batching

import (
    "context"
    "sync"
    "time"
)

type AsyncStage[T any] struct {
    In         <-chan T
    Write      func(ctx context.Context, batch []T) error
    MaxSize    int
    MaxWait    time.Duration
    Inflight   int       // max concurrent flushes
    OnError    func(error)
}

func (s *AsyncStage[T]) Run(ctx context.Context) error {
    jobs := make(chan []T, s.Inflight)
    var wg sync.WaitGroup
    for i := 0; i < s.Inflight; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for b := range jobs {
                if err := s.Write(ctx, b); err != nil && s.OnError != nil {
                    s.OnError(err)
                }
            }
        }()
    }

    buf := make([]T, 0, s.MaxSize)
    timer := time.NewTimer(s.MaxWait)
    if !timer.Stop() { <-timer.C }

    dispatch := func() {
        if len(buf) == 0 { return }
        batch := make([]T, len(buf))
        copy(batch, buf)
        buf = buf[:0]
        if !timer.Stop() { select { case <-timer.C: default: } }
        select {
        case jobs <- batch: // blocks if in-flight is full -> back-pressure
        case <-ctx.Done():
        }
    }

loop:
    for {
        select {
        case x, ok := <-s.In:
            if !ok { dispatch(); break loop }
            if len(buf) == 0 { timer.Reset(s.MaxWait) }
            buf = append(buf, x)
            if len(buf) >= s.MaxSize { dispatch() }
        case <-timer.C:
            dispatch()
        case <-ctx.Done():
            dispatch()
            break loop
        }
    }

    close(jobs)
    wg.Wait()
    return nil
}
```

Key properties:

- `jobs` channel has capacity `Inflight`. Sends block when the pool is busy → back-pressure.
- On exit, `close(jobs)` lets the workers drain. `wg.Wait()` ensures all writes complete before `Run` returns.
- On cancellation, the accumulator dispatches its partial batch (best effort), exits the loop, closes `jobs`, and waits for workers. Workers respect `ctx` inside `Write` so the in-flight writes can also bail out fast.

### Variations

**Per-worker buffer.** If `Write` itself is allocation-heavy, give each worker a pre-allocated buffer for response decoding. Reduces GC pressure.

**Bounded retries.** If `Write` fails, the worker can retry within its own goroutine. The accumulator does not need to know.

**Selectable dispatch.** The `dispatch` function blocks on a full `jobs` channel. If you want a *non-blocking* dispatch with drop-on-full, change the `select` to include a `default` case (and emit a `dropped` metric).

---

## Partial-Failure Handling

A batch flush is not atomic with the items inside it. The sink may report:

- **Whole-batch error.** Everything failed.
- **Per-item error.** Some items succeeded, some failed; sink returned a list of unprocessed.
- **Silent partial success.** The protocol returns OK but only some items took effect (rare; usually a sink bug).

Handle each.

### Whole-batch retry with exponential backoff

```go
func writeRetry[T any](ctx context.Context, write func(context.Context, []T) error, batch []T, attempts int) error {
    var err error
    backoff := 100 * time.Millisecond
    for i := 0; i < attempts; i++ {
        err = write(ctx, batch)
        if err == nil { return nil }
        if !isRetryable(err) { return err }
        select {
        case <-time.After(backoff + jitter()):
        case <-ctx.Done():
            return ctx.Err()
        }
        backoff *= 2
        if backoff > 30*time.Second { backoff = 30 * time.Second }
    }
    return err
}
```

Use when: errors are transient (network blip, sink overload).

### Split-on-fail bisection

```go
func writeOrSplit[T any](ctx context.Context, write func(context.Context, []T) error, batch []T) error {
    if err := write(ctx, batch); err == nil { return nil }
    if len(batch) == 1 {
        // Single-item failure: send to DLQ or log.
        return dlq.Send(ctx, batch[0])
    }
    mid := len(batch) / 2
    err1 := writeOrSplit(ctx, write, batch[:mid])
    err2 := writeOrSplit(ctx, write, batch[mid:])
    return errors.Join(err1, err2)
}
```

Use when: failures concentrate on specific items (poison pills) and retrying the whole batch wastes calls.

### Per-item ack

```go
type Response struct {
    Unprocessed []T
    Errors      map[int]error
}

func writeAck[T any](ctx context.Context, write func(context.Context, []T) (Response, error), batch []T, attempts int) error {
    unprocessed := batch
    for attempt := 0; attempt < attempts && len(unprocessed) > 0; attempt++ {
        resp, err := write(ctx, unprocessed)
        if err != nil { return err }
        unprocessed = resp.Unprocessed
        if len(unprocessed) > 0 {
            select {
            case <-time.After(backoff(attempt)):
            case <-ctx.Done(): return ctx.Err()
            }
        }
    }
    if len(unprocessed) > 0 {
        for _, item := range unprocessed { _ = dlq.Send(ctx, item) }
    }
    return nil
}
```

Use when: sink supports per-item ack (DynamoDB BatchWriteItem, Kinesis PutRecords).

### Dead-letter queue

Use when: an item has failed all retries; record it for offline processing.

```go
type DLQ[T any] interface {
    Send(ctx context.Context, item T, lastErr error) error
}
```

DLQ implementations: another Kafka topic, an S3 bucket, a separate DB table. Whatever survives if the main sink is down.

### Picking the strategy

| Sink behavior | Strategy |
|---------------|----------|
| Sometimes whole-batch failures (transient) | Whole-batch retry |
| Sometimes per-item failures (mixed) | Per-item ack if supported, else split-on-fail |
| Often poison-pill items | Split-on-fail + DLQ |
| Sometimes silent partial success | Idempotent re-write + reconciliation job (out of scope here) |

---

## Ordering Under Async Flush

Default async flush: workers pick batches from `jobs` channel in arrival order, but they finish their writes in arbitrary order. Downstream sink sees batches in arbitrary order.

When does this matter?

### Order-insensitive sinks

- Idempotent upserts keyed by item ID.
- Analytics events for aggregation.
- Audit logs sorted by timestamp at query time.

For these, default unordered async is fine.

### Order-sensitive sinks

- Append-only logs.
- Operation logs that must be applied in order (e.g. CRDT change log).
- Strictly ordered message queues (per-partition Kafka, FIFO SQS).

For these, you need ordering.

### Strategies

**Strategy 1.** Single flusher. Throughput = `1 / sink_latency * batch_size`. The simplest answer.

**Strategy 2.** Per-key single flusher. Items with key `K` go to flusher `hash(K) % N`. Order within `K` preserved; order across `K`s lost.

**Strategy 3.** Pipelined ordered flushers. Multiple flushers but with ack tokens that arrive in input order. Throughput high; global order preserved.

```go
type orderedBatch struct {
    seq   uint64
    items []T
    done  chan error
}

func pipelined[T any](ctx context.Context, batches <-chan []T,
    write func(context.Context, []T) error, workers int,
) {
    // Stage 1: dispatch with sequence numbers and "done" channels in order.
    dispatched := make(chan orderedBatch, workers)
    workQueue := make(chan orderedBatch, workers)

    go func() {
        defer close(workQueue)
        defer close(dispatched)
        var seq uint64
        for b := range batches {
            ob := orderedBatch{
                seq:   seq,
                items: b,
                done:  make(chan error, 1),
            }
            seq++
            workQueue <- ob
            dispatched <- ob
        }
    }()

    // Stage 2: workers process from workQueue in arbitrary order.
    var wg sync.WaitGroup
    for i := 0; i < workers; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for ob := range workQueue {
                ob.done <- write(ctx, ob.items)
            }
        }()
    }

    // Stage 3: serialise commits in seq order.
    for ob := range dispatched {
        if err := <-ob.done; err != nil {
            // handle error in seq order
        }
        // Now safe to commit checkpoint, advance offset, etc.
    }
    wg.Wait()
}
```

The trick: `dispatched` and `workQueue` get the same `orderedBatch` instances. Workers consume from `workQueue` in any order; the commit loop drains `dispatched` in arrival order and waits on each `done`. The next commit cannot proceed until the previous batch's `done` fires. So commits happen in input order, even though the writes themselves were parallel.

Throughput at the writes is bounded by `workers / sink_latency * batch_size`. Throughput at the commits is bounded by the slowest batch's serial position. Most production sinks make this acceptable.

---

## Back-Pressure Preservation

Sync flush gives back-pressure for free. Async flush requires care.

### Why bounded async preserves back-pressure

The accumulator dispatches via `jobs <- batch`. If `jobs` is full (Inflight in-flight), the send blocks. The accumulator's `select` is parked. New items on `in` cannot be received. The producer blocks on `in`. Chain propagated.

So as long as `Inflight` is bounded, back-pressure works.

### Why unbounded async loses back-pressure

`go write(batch)` never blocks. The accumulator returns immediately. No matter how slow the sink, the producer never feels it. Memory fills. Eventually OOM.

### A subtle case — flusher with infinite retries

```go
for {
    if err := write(ctx, batch); err == nil { break }
    time.Sleep(backoff())  // back-pressure invisible at jobs channel
}
```

The worker is stuck retrying. The `jobs` channel fills. Producer back-pressures. So far so good. But if the retry is very fast (no backoff or tiny backoff) the worker may oscillate between "retrying" and "ready," producing CPU load that does not reflect actual throughput. Make backoff exponential.

### Drop-on-full as an opt-in

If you do not want back-pressure (preferring to shed load), make the dispatch non-blocking:

```go
select {
case jobs <- batch:
default:
    metricDropped.Add(float64(len(batch)))
}
```

Document loudly that this drops on overflow. Use only when staleness is unacceptable.

---

## `sync.Pool` for Allocation-Free Reuse

The per-flush copy `make([]T, len(buf)); copy(batch, buf)` allocates `maxSize * sizeof(T)` bytes per flush. At 1000 flushes/s and `maxSize = 1000` items of 32 B, that is 32 MB/s of allocation. GC will notice.

### The pool design

```go
var batchPool = sync.Pool{
    New: func() any {
        s := make([]T, 0, maxSize)
        return &s
    },
}

flush := func(r Reason) {
    if len(buf) == 0 { return }
    pp := batchPool.Get().(*[]T)
    *pp = append((*pp)[:0], buf...)
    buf = buf[:0]
    if !timer.Stop() { select { case <-timer.C: default: } }
    select {
    case out <- *pp: // downstream consumer must return *pp to pool
    case <-ctx.Done():
        batchPool.Put(pp)
    }
}
```

The downstream consumer:

```go
for b := range out {
    sink.Write(ctx, b)
    // return to pool
    pp := &b
    *pp = (*pp)[:0]
    batchPool.Put(pp)
}
```

### Pitfalls

- **Pointer to slice, not slice.** `sync.Pool.Get` returns `any`; you must pool a pointer for the assignment `*pp = append(...)` to be visible to the consumer.
- **The "downstream returns to pool" contract.** Without it, the pool grows unboundedly. Document this loudly.
- **Cross-stage pooling.** If the consumer passes the batch to another stage, that stage must also know about the pool. Either pool per-stage or document the chain.
- **GC behavior.** `sync.Pool` releases objects on GC. Under low load you may see allocation churn even with pooling because the pool emptied.

### When to add pooling

After measurement. If `alloc_space` shows the copy as a top allocator and you are GC-bound, add pooling. Otherwise the cost of the pool (cognitive complexity, contract enforcement) is not worth it.

### Alternative — buffer reuse without pooling

If you have exactly two batches in flight (sync flush + one waiting), you can ping-pong between two pre-allocated batches:

```go
batches := [2][]T{
    make([]T, 0, maxSize),
    make([]T, 0, maxSize),
}
var which int

flush := func() {
    if len(buf) == 0 { return }
    next := batches[1-which]
    next = append(next[:0], buf...)
    batches[1-which] = next
    which = 1 - which
    buf = buf[:0]
    select {
    case out <- next:
    case <-ctx.Done():
    }
}
```

Two pre-allocated slices, no `sync.Pool`. Works for `outCap = 1`. Simpler than `sync.Pool` for that case.

---

## Shutdown-Flush Correctness Proofs

A senior should be able to write a short semi-formal proof that no items are lost on shutdown. Here is one for the canonical sync stage.

### Setup

The accumulator has three input edges: items from `in`, fires from `timer.C`, signals from `ctx.Done()`. The goroutine exits in two ways:

- Via the receive case with `ok == false` (input close).
- Via the cancellation case (context cancel).

### Invariant

At every point during execution, every item received from `in` is either:

1. In `buf`, or
2. Already sent on `out` (as part of a previous batch), or
3. Permanently lost.

### Claim

Under cancellation: items in (3) is exactly the items in `buf` at the moment `ctx.Done()` fires for which the cancellable `out <- batch` inside `flush` selected `<-ctx.Done()` instead. These are best-effort.

Under input close: items in (3) is empty.

### Proof sketch — input close

1. `in` is closed. The next `<-in` returns `ok = false`.
2. The accumulator runs `flush()` then `return`.
3. `flush()` sends `buf` on `out`. The send is cancellable but `ctx.Done()` has not fired (assumption: graceful shutdown, no cancellation). So the send succeeds.
4. `buf` is reset; `return` triggers `defer close(out)`.
5. Items in (1) is empty; items in (2) includes all received items; items in (3) is empty.

QED.

### Proof sketch — cancellation

1. `ctx.Done()` fires. The accumulator's `select` picks it (eventually).
2. `flush()` runs. The send is cancellable; `ctx.Done()` is ready, so `select` may pick either case.
3. If `out <- batch` wins: items in `buf` are sent. (1) empty, (2) full, (3) empty.
4. If `<-ctx.Done()` wins: items in `buf` are abandoned. (1) empty (reset), (2) full minus current, (3) = current buf.

So under cancellation, lost items are bounded by `maxSize`.

### Proof sketch — bounded async

For the bounded-async stage:

1. On input close, `dispatch()` sends the partial batch on `jobs`. The send may block if `jobs` is full, but eventually proceeds.
2. After dispatch, `close(jobs)` is called.
3. Workers drain `jobs`, each calling `Write`. If `Write` succeeds, the items are flushed.
4. `wg.Wait()` ensures all workers exit before `Run` returns.

Items lost = items whose `Write` failed and were not handled by retry / DLQ. Under a "no failures" assumption, items lost = 0.

### Why proofs matter

In a code review, you should be able to verbalise this proof. If a reviewer asks "can items be lost on shutdown?", your answer is the proof above. If they find a case it does not cover (e.g. accumulator panics during `dispatch`), you have found a real bug.

---

## Worked Example — Bounded-Async DB Writer

Putting it together. A DB writer that handles partial failures, preserves back-pressure, and bounds in-flight.

```go
package dbwriter

import (
    "context"
    "errors"
    "sync"
    "time"
)

type DB interface {
    BatchInsert(ctx context.Context, rows []Row) error
}

type Writer struct {
    In       <-chan Row
    DB       DB
    MaxSize  int
    MaxWait  time.Duration
    Inflight int
    Retries  int
    DLQ      func(ctx context.Context, batch []Row, err error)
}

func (w *Writer) Run(ctx context.Context) error {
    if w.Inflight <= 0 { w.Inflight = 1 }
    jobs := make(chan []Row, w.Inflight)
    var wg sync.WaitGroup

    for i := 0; i < w.Inflight; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for b := range jobs {
                w.writeWithRetry(ctx, b)
            }
        }()
    }

    buf := make([]Row, 0, w.MaxSize)
    timer := time.NewTimer(w.MaxWait)
    if !timer.Stop() { <-timer.C }

    dispatch := func() {
        if len(buf) == 0 { return }
        batch := make([]Row, len(buf))
        copy(batch, buf)
        buf = buf[:0]
        if !timer.Stop() { select { case <-timer.C: default: } }
        select {
        case jobs <- batch:
        case <-ctx.Done():
        }
    }

    var loopErr error
loop:
    for {
        select {
        case x, ok := <-w.In:
            if !ok { dispatch(); break loop }
            if len(buf) == 0 { timer.Reset(w.MaxWait) }
            buf = append(buf, x)
            if len(buf) >= w.MaxSize { dispatch() }
        case <-timer.C:
            dispatch()
        case <-ctx.Done():
            dispatch()
            loopErr = ctx.Err()
            break loop
        }
    }

    close(jobs)
    wg.Wait()
    return loopErr
}

func (w *Writer) writeWithRetry(ctx context.Context, batch []Row) {
    backoff := 100 * time.Millisecond
    var err error
    for attempt := 0; attempt <= w.Retries; attempt++ {
        err = w.DB.BatchInsert(ctx, batch)
        if err == nil { return }
        if !isRetryable(err) { break }
        select {
        case <-time.After(backoff):
        case <-ctx.Done(): return
        }
        backoff *= 2
        if backoff > 30*time.Second { backoff = 30 * time.Second }
    }
    if w.DLQ != nil {
        w.DLQ(ctx, batch, err)
    }
}

type Row struct{ ID int }

func isRetryable(err error) bool {
    // Domain-specific: timeouts, transient connection errors, etc.
    return errors.Is(err, context.DeadlineExceeded)
}
```

Properties:

- Bounded in-flight = `Inflight` workers.
- Per-batch retries with capped exponential backoff.
- DLQ for batches that exhausted retries.
- Back-pressure preserved at the `jobs` channel boundary.
- Cancellation propagates to retries (via `ctx`).
- Shutdown waits for workers to drain.

This is what a real production batched DB writer looks like.

---

## Worked Example — Pipelined Ordered Flushers

For ordered sinks at higher throughput than single-flusher.

```go
package ordered

import (
    "context"
    "sync"
)

type seqBatch[T any] struct {
    seq  uint64
    data []T
    err  chan error
}

type OrderedWriter[T any] struct {
    In       <-chan []T
    Write    func(ctx context.Context, batch []T) error
    Workers  int
    Commit   func(seq uint64) // called in seq order
}

func (w *OrderedWriter[T]) Run(ctx context.Context) error {
    work := make(chan seqBatch[T], w.Workers)
    ordered := make(chan seqBatch[T], w.Workers)

    // Dispatcher
    var dispWG sync.WaitGroup
    dispWG.Add(1)
    go func() {
        defer dispWG.Done()
        defer close(work)
        defer close(ordered)
        var seq uint64
        for b := range w.In {
            sb := seqBatch[T]{seq: seq, data: b, err: make(chan error, 1)}
            seq++
            select {
            case work <- sb:
            case <-ctx.Done(): return
            }
            select {
            case ordered <- sb:
            case <-ctx.Done(): return
            }
        }
    }()

    // Workers
    var workWG sync.WaitGroup
    for i := 0; i < w.Workers; i++ {
        workWG.Add(1)
        go func() {
            defer workWG.Done()
            for sb := range work {
                sb.err <- w.Write(ctx, sb.data)
            }
        }()
    }

    // Committer (in seq order)
    var commitErr error
    for sb := range ordered {
        if err := <-sb.err; err != nil {
            commitErr = err
            // Drain remaining ordered batches' errs to unblock workers.
            // Could also cancel ctx here for fail-fast.
        }
        if commitErr == nil && w.Commit != nil {
            w.Commit(sb.seq)
        }
    }

    workWG.Wait()
    dispWG.Wait()
    return commitErr
}
```

Key invariants:

- Dispatcher sends to `work` (workers) and `ordered` (committer) in the same order.
- Workers process `work` in arbitrary order but signal completion on `sb.err`.
- Committer drains `ordered` strictly in seq order, waiting on each `sb.err`.
- Throughput: bounded by `Workers / sink_latency * batch_size`.
- Order: globally preserved.

Use when:

- The sink is ordered (Kafka per partition, append-only log).
- Single flusher is too slow.
- Per-key flusher is not granular enough (you have only one key).

---

## Worked Example — Allocation-Free Hot Loop

For very high-throughput stages where per-flush allocation matters.

```go
package hotloop

import (
    "context"
    "sync"
    "time"
)

const maxSize = 1024

var pool = sync.Pool{
    New: func() any {
        s := make([]Event, 0, maxSize)
        return &s
    },
}

type Event struct{ ID uint64; Body [32]byte }

func Batch(ctx context.Context, in <-chan Event, out chan<- []Event, maxWait time.Duration) {
    defer close(out)

    bp := pool.Get().(*[]Event)
    *bp = (*bp)[:0]
    timer := time.NewTimer(maxWait)
    if !timer.Stop() { <-timer.C }

    flush := func() {
        if len(*bp) == 0 { return }
        if !timer.Stop() { select { case <-timer.C: default: } }
        select {
        case out <- *bp:
            bp = pool.Get().(*[]Event)
            *bp = (*bp)[:0]
        case <-ctx.Done():
            pool.Put(bp)
            bp = pool.Get().(*[]Event)
            *bp = (*bp)[:0]
        }
    }

    for {
        select {
        case x, ok := <-in:
            if !ok { flush(); pool.Put(bp); return }
            if len(*bp) == 0 { timer.Reset(maxWait) }
            *bp = append(*bp, x)
            if len(*bp) >= maxSize { flush() }
        case <-timer.C:
            flush()
        case <-ctx.Done():
            flush(); pool.Put(bp); return
        }
    }
}

// Consumer must Put the slice back to pool when done.
func ConsumeAndReturn(out <-chan []Event, sink func([]Event)) {
    for b := range out {
        sink(b)
        s := (b)[:0]
        pool.Put(&s)
    }
}
```

Properties:

- Zero allocations per flush in steady state.
- The accumulator and the consumer share `pool`.
- Document the contract: consumer must return the slice.

Measurement: at 1 M items/s and `maxSize = 1024`, the non-pooled version allocates ~32 MB/s (32-byte payload × 1024 × 1000 batches/s). The pooled version allocates near zero. GC pause goes from several ms per cycle to negligible.

---

## Worked Example — Two-Tier Batching With Compression

A common shape for cost-optimised pipelines.

```
records --> Batch1(1000, 50ms) --> compress --> Batch2(10, 500ms) --> S3
```

- Batch1 collects 1000 records or 50 ms. Output is a single compressed blob.
- Compress stage gzips each blob.
- Batch2 collects 10 blobs or 500 ms. Output is a multi-part upload.

```go
type Record struct{ Body []byte }

func Pipeline(ctx context.Context, records <-chan Record, s3 S3Client) error {
    batches := make(chan []Record, 2)
    blobs := make(chan []byte, 2)
    uploads := make(chan [][]byte, 1)

    go Batch(ctx, records, batches, 1000, 50*time.Millisecond)

    go func() {
        defer close(blobs)
        for b := range batches {
            blob := gzipBatch(b)
            select {
            case blobs <- blob:
            case <-ctx.Done(): return
            }
        }
    }()

    go Batch(ctx, blobs, uploads, 10, 500*time.Millisecond)

    for upload := range uploads {
        if err := s3.PutMultipart(ctx, upload); err != nil { return err }
    }
    return nil
}
```

End-to-end worst-case latency: 50 ms (Batch1) + compress time + 500 ms (Batch2) + S3 PUT time. For records that arrive at the end of a slow stretch, that is the entire 550+ ms plus PUT. Acceptable for log shipping; not for user-visible writes.

Memory: Batch1 holds 1000 records (~100 KB). Batch2 holds 10 blobs (each ~50 KB after gzip) = ~500 KB. Total accumulator memory ~600 KB. Tiny.

Throughput: Bounded by S3 PUT rate. For typical S3, 100 PUTs/s = 100 × 10 blobs = 1000 blobs/s = 1 M records/s. Plenty.

This is the classic "log shipping to object storage" topology.

---

## Diagnosing Real Production Failures

Three scenarios. Pretend you are on call.

### Scenario 1 — Memory growth alarm

**Symptom.** Heap memory grows linearly over 24 hours, then OOM-kill.

**Investigation.**

1. `go tool pprof -alloc_space` shows top allocator is the `flush` copy. Suspicious but not necessarily the leak.
2. `go tool pprof -inuse_space` shows the leak: thousands of `[]Event` slices alive.
3. `go tool pprof -list flush` reveals the flush function. Reads `make([]Event, len(buf))`. Allocation per flush.
4. Check: is downstream consuming `out`? `runtime.NumGoroutine()` is 2× expected.
5. Aha: the downstream consumer panicked and was not restarted. The accumulator keeps flushing into `out` (capacity 4), which fills, then blocks. New allocations queue.

**Fix.** Add `defer recover()` + restart in the consumer. Add a metric `consumer_alive` that alarms when consumer goroutine count drops.

### Scenario 2 — Throughput suddenly halved

**Symptom.** Pipeline throughput dropped from 100K items/s to 50K at 3 AM.

**Investigation.**

1. `flushes_total{reason}` shows reason distribution changed: was 90% `size`, now 90% `time`.
2. Suspect: traffic dropped, but each item is now slow.
3. Sink latency p99 jumped from 50 ms to 150 ms (alert).
4. `Inflight = 4` and `MaxSize = 100`. Old throughput: `4 / 0.05 * 100 = 8000 items/s per inflight = 32K/s total`. Wait, that does not match 100K.
5. Actually `Inflight` is at workers level, not per stage. 4 workers × 100K/s ÷ 4 = right.
6. After sink slowdown: `4 / 0.15 * 100 = 2666/s per worker × 4 = 10K/s`. Far less than observed 50K.
7. Realise: sink is per-customer; some customers' p99 jumped, others did not. Mixed.

**Fix.** Increase `Inflight` to 8 to compensate. Investigate sink-side; revert when it recovers.

### Scenario 3 — Lost data on rolling deploys

**Symptom.** 0.5% of events missing from analytics warehouse after each deploy.

**Investigation.**

1. On deploy, pods receive SIGTERM, run graceful shutdown, then exit.
2. Graceful shutdown cancels context. Accumulator runs cancel-case flush.
3. Cancel-case flush is best-effort (selectable on `ctx.Done()`). If downstream is also cancelled, it skips. Items lost.
4. Compute: `pods × maxSize / events_per_deploy = 50 × 100 / 1M = 0.5%`. Matches.

**Fix.** Replace cancel-case flush with a drain-then-flush:

```go
case <-ctx.Done():
    drainDeadline := time.NewTimer(5 * time.Second)
    for {
        select {
        case x, ok := <-in:
            if !ok { goto exit }
            buf = append(buf, x)
            if len(buf) >= maxSize { dispatch() }
        case <-drainDeadline.C:
            goto exit
        }
    }
exit:
    dispatch()  // best-effort, but with longer per-batch deadline
    return
```

And use a separate `drainCtx` with a 5-second deadline for the dispatch, so the dispatch can actually complete even though the parent `ctx` is cancelled.

This is a real production fix that has appeared in dozens of pipelines.

---

## Pattern Catalog Cross-Reference

Senior tier sits on top of patterns from other folders. Quick reference:

- **Cancellation propagation** (folder 02). Senior batching uses it for: shutdown-flush, cancellable sends, drain-deadline for graceful shutdown.
- **Error propagation** (folder 01). Senior batching uses it for: error channel from flusher to orchestrator, first-error-wins, retry budget management.
- **Fan-out / fan-in within pipeline** (folder 05). Senior batching uses it for: bounded async flushers (fan-out of writes), per-key sharded accumulators (fan-out of accumulation).
- **Worker pool patterns** (folder 03 fan-out within pipeline). The bounded async flusher is a worker pool.
- **Circuit breaker** (cross-cutting). When the sink fails repeatedly, the flusher should circuit-break and propagate the error rather than retry indefinitely.

A senior writes batching code that *cites* these patterns explicitly in code comments and docs.

---

## Anti-Patterns at Senior Level

### AP1 — Unbounded async flush

`go write(batch)` for every batch. We have covered this. At senior level you should be calling it out in code review, not introducing it.

### AP2 — Ignoring back-pressure

The accumulator's job channel is unbounded. Producer never sees the sink slowdown. Memory fills.

### AP3 — Sync flush behind a slow sink

If sync flush throughput is 100/s and you need 10000/s, you are throughput-bound. Add bounded async. Not addressing this is also an anti-pattern; you cannot keep saying "we are working on it" forever.

### AP4 — Pool object reuse without contract enforcement

Add pooling without documenting "consumer must Put back." Pool grows unboundedly because no one returns objects. Worse than no pooling.

### AP5 — Per-batch goroutine spawn for retry

```go
case <-time.After(maxWait):
    go retryWithBackoff(ctx, batch)
```

Goroutines accumulate during sink slowdown. Move retry logic into a worker, not a per-batch goroutine.

### AP6 — Time triggers with no jitter on a fleet

Per Deep-Dive 25 in middle.md. Add jitter at fleet sizes > 10.

### AP7 — Adaptive sizing without bounds

Self-tuning `maxSize` that can grow without limit. A traffic anomaly triples `maxSize` and now you have a 30-second pause when the size trigger finally fires. Cap the adaptive range.

### AP8 — DLQ that grows unboundedly

DLQ accumulates failed batches forever. Disk fills. No alerting on DLQ size. Add a metric and an alert.

### AP9 — Mixing flush context and item context

Each item carries its own deadline. The flush call should respect the earliest deadline, not the orchestrator's. Easy to get wrong; results in items dropped for "context exceeded" when the orchestrator was fine.

### AP10 — Treating "drop on full" as the default

Some teams configure non-blocking dispatch by default. Drops happen silently. Use blocking dispatch unless you have an explicit design rationale.

---

## Decision Matrix — Picking the Right Variant

| Need | Variant |
|------|---------|
| Throughput < sink latency × batch | Sync flush |
| Throughput between sync and (sync × N) | Bounded async flush, Inflight = N |
| Strict global order, throughput > sync | Pipelined ordered flushers |
| Per-key order, multiple keys | Per-key flushers (sharded or full) |
| Hot path GC sensitivity | sync.Pool for batch slices |
| Order-insensitive, latency-tolerant | Bounded async, simplest |
| Throughput needed > 10× sync | Investigate sink-side scaling; batching alone is not enough |

Map your requirements; pick the cell; defend the choice.

---

## Self-Assessment Checklist

- [ ] I can write a bounded-async flusher from memory in ten minutes.
- [ ] I can articulate when sync flush is preferable to async even when sync is "slower."
- [ ] I can describe pipelined ordered flushers and when to use them.
- [ ] I can add `sync.Pool` to a batching stage without breaking the slice-reuse safety.
- [ ] I can write a shutdown-flush correctness proof for any variant.
- [ ] I can pick a partial-failure strategy for a given sink in 30 seconds.
- [ ] I recognise all ten senior-tier anti-patterns on first read.
- [ ] I can diagnose memory growth, throughput drop, and deploy-related data loss from symptoms.

---

## Summary

Senior-tier batching is about *trade-offs articulated*, not just *patterns implemented*. You know when to use sync, when bounded async, when pipelined ordered. You know the partial-failure flavors and the sinks they fit. You can prove your stage is correct on shutdown. You can read a memory profile and diagnose a leaked goroutine in the consumer. You can defend "we use sync flush" against a junior who wants async "for speed."

The patterns themselves are not that many. The discipline is in articulating which one fits and why, and being able to back it up with measurement and reasoning.

---

## Further Reading

- Professional.md (next page) for adaptive sizing, jittered timers, multi-tier accumulators, queue-theoretic capacity planning.
- The Go memory model document (`go.dev/ref/mem`) for the formal happens-before rules.
- "Designing Data-Intensive Applications" by Kleppmann, ch. 11 (Stream Processing) for the broader context.
- The folder 01 (error propagation) and folder 02 (cancellation propagation) pages of this track.
- Open-source: Sarama's `AsyncProducer`, `franz-go`'s `RecordBatch`, Telegraf's batched outputs.

---

## Deep-Dive — Twenty More Practical Notes

Below are twenty short notes, each capturing a senior-tier insight that does not fit elsewhere.

### Note 1 — `errgroup.WithContext` for the worker pool

Instead of `sync.WaitGroup`, `errgroup.WithContext` cancels the context on first error. Useful when the accumulator should also bail out on a worker failure.

### Note 2 — Channel `cap()` for visibility

If `cap(jobs) == len(jobs)`, the dispatch is back-pressuring. Export this as a metric to detect saturation.

### Note 3 — `runtime.Gosched()` in tight inner loops

If the accumulator's `for { select { ... } }` is the only goroutine on a P (rare but possible on embedded), occasional `runtime.Gosched()` after a flush keeps the scheduler responsive. Almost never needed.

### Note 4 — `time.AfterFunc` vs explicit timer per key

For < 100 keys, prefer `time.NewTimer` per key with explicit goroutine multiplex. For > 100, prefer `time.AfterFunc` callbacks with a shared dispatch channel.

### Note 5 — `select` ordering bias

Go's `select` is pseudo-random, not biased. Do not assume any case has priority. If you need priority, pre-check the higher-priority case before the `select`.

### Note 6 — Batch slice escape analysis

The batch slice escapes to the heap because it crosses a channel. There is no way around this; the heap allocation is required. The copy itself does not escape, only the resulting slice. Pool helps recycle.

### Note 7 — `context.Cause` for shutdown diagnostics

In Go 1.20+, `context.WithCancelCause` lets you attach a reason. Use it on the orchestrator so logs show "shutdown due to X" rather than the generic `context.Canceled`.

### Note 8 — `runtime.NumGoroutine` snapshot

A periodic snapshot helps detect goroutine leaks. If the stage's expected goroutine count drifts, investigate.

### Note 9 — Heap profile differential

`go tool pprof -base` compares two heap profiles. Useful for "what changed since startup."

### Note 10 — Race detector in production-like benchmarks

`go test -race -bench` catches races that integration tests miss. Slow but worth running before release.

### Note 11 — `testing/synctest` for deterministic time

Go 1.24+ has `testing/synctest` for deterministic time in tests. If you target 1.24+, use it instead of fake clocks.

### Note 12 — Per-stage panic recovery

```go
defer func() {
    if r := recover(); r != nil {
        log.Errorf("batching panic: %v\n%s", r, debug.Stack())
    }
}()
```

Recover at the top of the accumulator. If the stage panics, the application can restart it without taking down the process.

### Note 13 — Soft vs hard `maxSize`

Some sinks have a strict cap (e.g. DynamoDB BatchWriteItem max 25 items). Your `maxSize` is a hard upper bound; if you violate, the sink rejects. Other sinks have a soft cap (best throughput at 1000 items, accepts up to 10000). Your `maxSize` is a soft target.

### Note 14 — `time.Now()` cost

Each call is ~30 ns. Not a concern in batching code unless you call it per item in the hot path; then consider batching the time reads too.

### Note 15 — `sync.Once` for one-time init

Use `sync.Once` for one-time setup inside the accumulator (e.g. registering metrics with a registry). Avoids double-registration on stage restart.

### Note 16 — `select` with `nil` channels

Setting a channel variable to `nil` removes its case from `select` consideration. Useful for state machines: "do not consider input until pool drains."

```go
var input <-chan T = s.In
for {
    select {
    case x, ok := <-input:
        if !ok { input = nil; continue } // disable case
        ...
    case <-ctx.Done():
        ...
    }
}
```

### Note 17 — Cross-process batching

Cross-process aggregation requires a coordinator (Kafka, Redis, NATS). The intra-process batching here is the simpler case. Do not confuse them.

### Note 18 — Stream processing frameworks

Apache Beam, Flink, Storm — all have batching primitives. If your problem is large enough, consider them over hand-rolled Go.

### Note 19 — `slog` structured logging

`log/slog` (Go 1.21+) supports structured fields. Tag every batching log with `stage=`, `reason=`, `size=` for easier filtering in production log search.

### Note 20 — Property-based testing

`gopter` or `quick.Check` can fuzz the accumulator with random sequences. Useful for finding bugs in the per-key or coalescing variants where the state space is large.

---

## Closing

You have arrived at the end of senior.md. The patterns and trade-offs here will carry you through nearly every batching design conversation in a Go-shop production setting. Professional.md adds capacity-planning rigor, adaptive sizing, and jittered timers for fleet-scale deployments.

A few habits to cultivate:

- Write the shutdown proof in the godoc.
- Always pick a partial-failure strategy explicitly, even if the answer is "drop on first error."
- Always cite the surrounding-folder patterns (cancellation, error propagation) when reviewing batching code.
- Always measure before adding `sync.Pool`.

---

## Extended Walkthrough — Full Sync vs Async Bench

Here is a self-contained benchmark you can run to compare sync vs bounded-async flush. The numbers below are illustrative; run on your hardware.

```go
package main

import (
    "context"
    "fmt"
    "runtime"
    "sync"
    "time"
)

type Item struct{ ID int }

func sink(ctx context.Context, batch []Item) error {
    time.Sleep(50 * time.Millisecond) // simulate slow sink
    return nil
}

func runSync(n int) time.Duration {
    in := make(chan Item)
    out := make(chan []Item, 1)
    ctx, cancel := context.WithCancel(context.Background())
    defer cancel()

    start := time.Now()

    var wg sync.WaitGroup
    wg.Add(1)
    go func() {
        defer wg.Done()
        defer close(out)
        buf := make([]Item, 0, 100)
        timer := time.NewTimer(time.Hour)
        if !timer.Stop() { <-timer.C }
        flush := func() {
            if len(buf) == 0 { return }
            b := make([]Item, len(buf))
            copy(b, buf)
            buf = buf[:0]
            out <- b
        }
        for {
            select {
            case x, ok := <-in:
                if !ok { flush(); return }
                buf = append(buf, x)
                if len(buf) >= 100 { flush() }
            case <-ctx.Done():
                return
            }
        }
    }()

    wg.Add(1)
    go func() {
        defer wg.Done()
        for b := range out {
            _ = sink(ctx, b)
        }
    }()

    for i := 0; i < n; i++ { in <- Item{ID: i} }
    close(in)
    wg.Wait()
    return time.Since(start)
}

func runAsync(n, inflight int) time.Duration {
    in := make(chan Item)
    jobs := make(chan []Item, inflight)
    ctx, cancel := context.WithCancel(context.Background())
    defer cancel()

    var workers sync.WaitGroup
    for i := 0; i < inflight; i++ {
        workers.Add(1)
        go func() {
            defer workers.Done()
            for b := range jobs {
                _ = sink(ctx, b)
            }
        }()
    }

    start := time.Now()

    go func() {
        defer close(jobs)
        buf := make([]Item, 0, 100)
        for x := range in {
            buf = append(buf, x)
            if len(buf) >= 100 {
                b := make([]Item, len(buf))
                copy(b, buf)
                buf = buf[:0]
                jobs <- b
            }
        }
        if len(buf) > 0 {
            b := make([]Item, len(buf))
            copy(b, buf)
            jobs <- b
        }
    }()

    for i := 0; i < n; i++ { in <- Item{ID: i} }
    close(in)
    workers.Wait()
    return time.Since(start)
}

func main() {
    runtime.GOMAXPROCS(runtime.NumCPU())
    n := 100000

    t1 := runSync(n)
    fmt.Printf("sync: %v (%.0f items/s)\n", t1, float64(n)/t1.Seconds())

    for _, inflight := range []int{2, 4, 8, 16} {
        t := runAsync(n, inflight)
        fmt.Printf("async inflight=%d: %v (%.0f items/s)\n",
            inflight, t, float64(n)/t.Seconds())
    }
}
```

Sample output:

```
sync: 50.123s (1996 items/s)
async inflight=2: 25.06s (3990 items/s)
async inflight=4: 12.55s (7968 items/s)
async inflight=8: 6.30s (15873 items/s)
async inflight=16: 3.18s (31447 items/s)
```

Each doubling of `inflight` doubles throughput (until the simulated sink's effective concurrency limit kicks in or the OS context-switch cost dominates).

The interpretation: a single sync flusher caps at `batch_size / sink_latency = 100/0.05 = 2000 items/s`. Bounded async with N workers caps at `N × 2000`. The numbers match.

In real life:

- The sink usually has a concurrency limit (DB connection pool, API rate limit). Increasing `inflight` beyond that does nothing.
- Memory grows linearly with `inflight`. Each worker holds up to `maxSize` items.
- Latency *per batch* stays at `sink_latency`. End-to-end latency does not improve; only throughput does.

---

## Extended Walkthrough — `sync.Pool` Microbenchmark

Measuring the value of `sync.Pool`.

```go
package main

import (
    "fmt"
    "runtime"
    "sync"
    "testing"
    "time"
)

const maxSize = 1024

type Event struct{ Body [256]byte }

var pool = sync.Pool{
    New: func() any {
        s := make([]Event, 0, maxSize)
        return &s
    },
}

func BenchmarkAlloc(b *testing.B) {
    for i := 0; i < b.N; i++ {
        s := make([]Event, maxSize)
        _ = s
    }
}

func BenchmarkPool(b *testing.B) {
    for i := 0; i < b.N; i++ {
        s := pool.Get().(*[]Event)
        *s = (*s)[:maxSize]
        pool.Put(s)
    }
}

func main() {
    var ms runtime.MemStats

    n := 1000000

    runtime.GC()
    runtime.ReadMemStats(&ms)
    alloc0 := ms.TotalAlloc

    start := time.Now()
    for i := 0; i < n; i++ {
        _ = make([]Event, maxSize)
    }
    runtime.ReadMemStats(&ms)
    fmt.Printf("alloc:     %v, %d MB\n", time.Since(start), (ms.TotalAlloc-alloc0)/1024/1024)

    runtime.GC()
    runtime.ReadMemStats(&ms)
    alloc0 = ms.TotalAlloc

    start = time.Now()
    for i := 0; i < n; i++ {
        s := pool.Get().(*[]Event)
        *s = (*s)[:maxSize]
        pool.Put(s)
    }
    runtime.ReadMemStats(&ms)
    fmt.Printf("pool:      %v, %d MB\n", time.Since(start), (ms.TotalAlloc-alloc0)/1024/1024)
}
```

Sample output on a typical laptop:

```
alloc:     800ms, 250 MB
pool:      40ms,  0 MB
```

20× faster, no allocation. For a hot batching loop emitting a batch every millisecond (1000/s), the saved allocation is 250 MB/s. GC has correspondingly less to scan.

When the batch payload is small (few bytes per batch), the saved CPU is less impressive but still measurable. When the payload is large (1 KB+) the pool is essential.

---

## Extended Walkthrough — A Real-Life Capacity Calculation

Suppose your batching stage handles cart-checkout events. The product team gives you these constraints:

- Steady traffic: 50,000 events/s.
- Black Friday peak: 500,000 events/s for 4 hours.
- p99 latency SLO: 200 ms.
- Sink (analytics DB): handles 5,000 inserts/s per connection, 1 ms per single insert, 50 ms per 100-row batch.
- DB has 20 connections.

Calculate.

### Step 1 — Sink throughput at chosen batch size

50 ms per 100-row batch, 20 connections: `20 / 0.05 * 100 = 40,000 items/s`. Not enough for steady traffic.

Try `maxSize = 200`. The sink doc says 200-row batches take 80 ms: `20 / 0.08 * 200 = 50,000 items/s`. Matches steady.

Try `maxSize = 500`. Batches take 150 ms: `20 / 0.15 * 500 = 66,667 items/s`. Better, but more latency.

### Step 2 — Tune `maxWait`

p99 SLO = 200 ms. Batch latency = `maxWait + sink_latency`. With `maxSize = 200` and `sink_latency = 80 ms`: `maxWait < 120 ms`. Use `maxWait = 100 ms` (small safety margin).

### Step 3 — Check black-Friday peak

Peak 500K/s. At `maxSize = 200`, throughput cap is 50K/s. We are 10× short.

Options:

a. Increase `maxSize` to 1000 (sink latency 400 ms; throughput `20/0.4*1000 = 50K/s`). Latency now exceeds SLO. No.

b. Add bounded async flush with 4× inflight (4 batches per worker). Effective throughput: `80/0.08*200 = 200K/s`. Still short.

c. Add inflight = 10 per worker (200 in-flight batches). Effective: `200 * 200 / 0.08 = 500K/s`. Matches peak. Memory: 200 × 200 × sizeof(event) ≈ 200 × 200 × 100B = 4 MB. Trivial.

d. Add more DB connections during peak. 100 connections × 200-row batches = 250K/s. Need to double batch size or add inflight. Combine with c.

### Step 4 — Pick and document

Pick: `maxSize = 200`, `maxWait = 100ms`, `inflight = 10` workers per DB connection, autoscale connections to 100 during peak. Document the math.

### Step 5 — Build a load test

Generate 500K/s for 5 minutes. Measure: actual p99, batches/s, memory, DB connection utilisation. Compare to model.

If the model holds, ship. If not, find the divergence and re-model.

This calculation is what senior engineers are paid for. The patterns from earlier sections are tools; the calculation is the judgment.

---

## Extended Walkthrough — Real Failure Modes Catalogue

Beyond the three diagnosed scenarios, here are eight more failure modes you may encounter.

### Failure 1 — Slow downstream cascades into producer OOM

Sink slows; bounded async fills; `jobs` channel full; accumulator blocks on dispatch; `in` fills; *producer's* internal buffer fills; producer's source (e.g. HTTP request body) buffers; HTTP server runs out of buffer memory; OOM.

**Fix.** Add a fast-fail at the HTTP boundary: if `in` is full, return 503. Do not let unbounded buffering creep into the producer.

### Failure 2 — Single bad item crashes the flusher repeatedly

Item `X` causes a panic in `Write`. Flusher panics, worker dies, supervisor restarts worker, worker picks the same batch (still in jobs), panics again. Loop.

**Fix.** `defer recover()` in the worker. On panic, log + DLQ the batch + continue.

### Failure 3 — Timer drift on heavily loaded machines

Under heavy CPU contention, timers fire late. `maxWait = 50ms` becomes `maxWait = 200ms` p99. SLO violated.

**Fix.** Tune for the worst-case scheduling delay (add 50-100 ms safety margin). Investigate why the machine is overloaded.

### Failure 4 — `sync.Pool` GC'd between use

Under low load, `sync.Pool` releases its cached objects on GC. The next allocation pays the cost. Pool gives the *steady-state* benefit, not the *low-load* one.

**Fix.** None really — this is by design. Acceptable because low-load periods are not throughput-critical.

### Failure 5 — Reordering across batches in event-time stream

Events arrive out of order. Bounded async flushers reorder them further. Downstream watermarks misbehave.

**Fix.** Add event-time aware buffering: hold events for X seconds, sort, then batch in event-time order. Significantly more complex.

### Failure 6 — Channel-close panic on race

Multiple goroutines try to close `out`. Panic.

**Fix.** Single owner. Use `sync.Once` if multiple paths converge:

```go
var closeOnce sync.Once
closeOut := func() { closeOnce.Do(func() { close(out) }) }
```

### Failure 7 — Memory leak from forgotten `Stop()`

Some libraries leak goroutines if their `Stop()` is not called. The accumulator's `defer t.Stop()` covers `time.Ticker`. The DB driver may have its own.

**Fix.** Read every `Close`/`Stop` doc in your dependency tree. `defer` them.

### Failure 8 — Goroutine count spikes during cancellation

The cancellation propagation is async. There is a window where new flushers are still spawning (because `dispatch()` did not yet see `ctx.Done()`) and old ones are exiting. Briefly, goroutine count spikes.

**Fix.** None in code; this is expected. Tune alerting to ignore brief spikes during shutdown.

---

## Extended Walkthrough — Performance Tuning Walkthrough

Suppose you have a working batching stage and want to tune for performance. Here is the procedure.

### Step 1 — Establish baseline

Run a load test at the expected steady-state rate. Record:

- p50, p99, p999 end-to-end latency.
- Throughput (items/s).
- CPU utilisation (top, htop).
- Memory (RSS).
- GC pause times (`GODEBUG=gctrace=1`).
- Goroutine count (`runtime.NumGoroutine()`).

### Step 2 — Identify bottleneck

CPU-bound? Memory-bound? I/O-bound?

```bash
go tool pprof -cpu http://localhost:6060/debug/pprof/profile
```

Look at the flame graph. If 80% of time is in the sink, it is I/O-bound. If 80% is in `runtime.mallocgc`, it is GC-bound. If 80% is in your business logic, it is CPU-bound.

### Step 3 — Apply fixes appropriate to the bottleneck

**I/O bound.** Increase `inflight`. Increase `maxSize` if sink supports.

**GC bound.** Add `sync.Pool`. Reduce per-item allocations.

**CPU bound.** Optimise the business logic. Sometimes the batching layer is irrelevant.

### Step 4 — Re-measure

Run the same load test. Compare. Document the win.

### Step 5 — Re-investigate

The bottleneck moves. After eliminating I/O, you might be GC-bound. After eliminating GC, you might be CPU-bound. Iterate.

### Step 6 — Check the model

Predict throughput from `inflight × batch_size / sink_latency`. If reality is worse, find why.

### A specific example

Baseline: 10K items/s, p99 80 ms, CPU 60%, GC pause p99 5 ms.

Step 2: pprof shows 40% time in `runtime.mallocgc`. GC-bound.

Step 3: add `sync.Pool` for batch slices.

Re-measure: 15K items/s, p99 60 ms, CPU 65%, GC pause p99 0.5 ms.

Step 5: now I/O-bound (most time in sink). Increase `inflight` from 4 to 8.

Re-measure: 28K items/s, p99 55 ms, CPU 75%, GC pause stable.

Throughput goal: 25K. Achieved. Stop.

This is the senior's tuning loop. Measure → identify → fix → re-measure → next bottleneck.

---

## Extended Walkthrough — Reviewing Someone Else's Batching Code

When a colleague submits a batching stage PR, here is your checklist. Read it like a senior.

### Layer 1 — Surface check (one minute)

1. Does the file have a docstring stating the contract?
2. Does the function take `context.Context`?
3. Is the input channel read-only (`<-chan T`)? Output write-only?
4. Is there a `defer close(out)`?
5. Is there a triple-trigger select?

If any miss: stop, request changes.

### Layer 2 — Detail check (five minutes)

1. Is the timer correctly stop-and-drained?
2. Is the empty-buffer guard in `flush`?
3. Is the buffer copied on send?
4. Is the send cancellable on `ctx.Done()`?
5. Are `maxSize` and `maxWait` validated?
6. Are anti-patterns absent (`time.After` in loop, `time.Tick`, unbounded async)?

If any miss: request changes.

### Layer 3 — Design check (ten minutes)

1. Sync or async? Is the choice justified?
2. If async, is `inflight` bounded and documented?
3. If multiple flushers, is ordering correctly handled?
4. Is partial-failure handling specified?
5. Are metrics emitted (flush reason, batch size)?
6. Is there a `TestBatch_FinalFlush` test?
7. Is the shutdown-flush proof either present in the docstring or obvious from the code?

If any miss: discuss with the author. May not block, but should be addressed.

### Layer 4 — Production readiness (additional time)

1. Is the stage in a feature flag for gradual rollout?
2. Are metrics + alerts configured?
3. Is a DLQ in place if needed?
4. Is the rollback plan documented?

These are not code-review items per se; they are launch-readiness items.

---

## Extended Walkthrough — A Pair-Programming Session

Imagine yourself pair-programming with a mid-tier engineer on a batching stage. Here is how the conversation might go.

**Mid.** "OK, here's my first draft."

```go
for x := range in {
    buf = append(buf, x)
    if len(buf) >= 100 {
        sink.Write(ctx, buf)
        buf = nil
    }
}
```

**Senior.** "Three issues. One, no time trigger — items wait for 100 to accumulate, which means at low load they wait forever. Two, no final flush — at the end of the range, if `len(buf) > 0`, items are lost. Three, you're sending `buf` directly; you should copy."

**Mid.** "OK, let me redo."

```go
buf := make([]int, 0, 100)
timer := time.NewTimer(50 * time.Millisecond)

flush := func() {
    if len(buf) == 0 { return }
    b := make([]int, len(buf))
    copy(b, buf)
    buf = buf[:0]
    sink.Write(ctx, b)
}

for {
    select {
    case x, ok := <-in:
        if !ok { flush(); return }
        buf = append(buf, x)
        if len(buf) >= 100 { flush() }
    case <-timer.C:
        flush()
    case <-ctx.Done():
        flush(); return
    }
}
```

**Senior.** "Better. But: the timer is armed at function start, so it fires after 50 ms even with an empty buffer; that calls `flush` which is now a no-op thanks to the empty guard. Fine, harmless. But after the first flush, you do not reset the timer, so it never fires again. So the time trigger only works once. You need to reset on entry-to-empty and stop-and-drain on flush."

**Mid.** "How exactly?"

**Senior.** "Like this:"

```go
if !timer.Stop() { <-timer.C }  // at start, disarm

// Inside receive case after append:
if len(buf) == 1 { timer.Reset(50 * time.Millisecond) }  // arm on empty->non

// Inside flush, after batch:
if !timer.Stop() { select { case <-timer.C: default: } }  // disarm
```

**Mid.** "Got it. Anything else?"

**Senior.** "The `sink.Write(ctx, b)` blocks. If the sink is slow, your select is parked. That's actually fine for sync flush. But if you ever need to cancel mid-flush, wrap it: `select { case res := <-doWrite(b): ... case <-ctx.Done(): ... }`. For now, sync is fine."

**Mid.** "Should I make it async?"

**Senior.** "Measure first. If sync gives you adequate throughput, don't add complexity."

**Mid.** "OK. Test?"

**Senior.** "Six tests minimum: size, time, final-flush-on-close, cancel, no-empty, concurrent-producers. Final-flush is the one you cannot skip."

**Mid.** "Got it."

This is the rhythm of senior-level coaching. Identify the bug, name it, fix it, then ask "what else?"

---

## Extended Walkthrough — A Mental Model Refresher

By now you should have the mental model loaded. A few refreshers:

### The three-trigger-three-exit model

Three triggers cause a flush:
- Size: inline check after `append`.
- Time: `select` case on `timer.C`.
- Cancel/EOS: `select` case on `ctx.Done()` or `ok == false`.

Three exits:
- Normal: input closed, final flush, return.
- Cancel: `ctx.Done()`, best-effort flush, return.
- Panic: `defer recover()` logs and possibly restarts.

### The producer-accumulator-flusher triangle

```
       producer
          |
          v
   +-------------+
   | accumulator |
   +-------------+
          |
          v
       flusher
          |
          v
        sink
```

Each arrow is back-pressure capable. Each box is one or more goroutines.

### The trigger-pair-as-control-knob model

`maxSize` is the size knob. Bigger = more amortisation, more memory, more latency.

`maxWait` is the latency knob. Smaller = lower latency, smaller batches, less amortisation.

Together they parameterise the throughput-latency curve.

---

## Extended Walkthrough — Final Comprehensive Checklist

A condensed list of everything a senior should hold in their head about batching.

- [ ] Triple-trigger select-loop in fingers.
- [ ] Final flush in every exit path.
- [ ] Stop-and-drain timer ritual.
- [ ] Copy on send (or pool with explicit contract).
- [ ] Cancellable send.
- [ ] Defer-close-once invariant.
- [ ] Flush reason tagged.
- [ ] Metrics: counters by reason, histogram of batch size, histogram of flush wait.
- [ ] Six tests: size, time, final flush, cancel, no empty, concurrent.
- [ ] Synchronous flush by default.
- [ ] Bounded async when throughput-bound.
- [ ] Pipelined ordered flushers when order-required + throughput-bound.
- [ ] `sync.Pool` when GC-bound.
- [ ] Jitter on the time trigger if fleet size > 10.
- [ ] Partial-failure strategy explicitly chosen.
- [ ] DLQ for poison pills.
- [ ] Back-pressure to producer preserved.
- [ ] Shutdown-flush correctness proof in docstring.
- [ ] Anti-patterns absent.
- [ ] Load test results documenting tuning.

Carry this in your head. When you write or review batching code, run through it.

---

## Extended Walkthrough — Production Story: The Black-Friday Pipeline

A long-form case study of a real production batching pipeline.

### Setting

A retail company's order pipeline. Steady traffic: 1000 orders/s. Black Friday: 50,000 orders/s expected. Each order produces ~20 analytics events. Total: 1 M events/s peak.

### Initial design

```
HTTP --> orderHandler --> orderChan --> Batch(50, 100ms) --> analyticsDB
```

Single batching stage, sync flush, `Inflight = 1`. Throughput cap: `1 / 0.05 * 50 = 1000 batches/s = 50,000 events/s`. Steady traffic OK; peak fails.

### Iteration 1 — Bounded async

Add `Inflight = 20` workers per stage. Throughput: `20 * 1000 = 1 M events/s`. Memory: `20 * 50 * 256B = 256 KB`. Trivial.

But: the analytics DB has only 50 connections. With 20 workers per pod × 10 pods = 200 connection requests. DB OOMs.

### Iteration 2 — Per-pod connection pool sizing

Set per-pod DB connection pool to 5. Each worker holds a connection briefly. 5 × 10 pods = 50 — matches DB capacity.

But: workers now contend on the pool. Throughput drops because workers wait for connections.

### Iteration 3 — Match worker count to connection pool size

Set `Inflight = 5` per pod. 5 workers, 5 connections, no contention. Throughput: `5 * 1000 = 5,000 events/s per pod * 10 pods = 50,000 events/s`. Wait — that's the steady traffic, not peak.

### Iteration 4 — Scale out

Scale pods to 200 during peak. 200 × 5 × 1000 = 1 M events/s. Matches.

But: DB connection pool is fixed at 50. 200 pods × 5 conns = 1000 conn requests. Far over.

### Iteration 5 — Read replica fan-out

Add 10 read replicas. Distribute writes across them by event hash. Each replica handles 1/10 of the load. Per-replica conn pool: 50. Total: 500 conns supportable. We need 1000. Add 10 more replicas.

But: 20 replicas is expensive.

### Iteration 6 — Bigger batches

Increase `maxSize` from 50 to 500. Sink latency rises to 200 ms (linear scaling). Throughput per worker: `1 / 0.2 * 500 = 2500 events/s`. Per pod: 5 × 2500 = 12,500 events/s. 80 pods × 12,500 = 1 M events/s. 

Latency at peak: `100 ms (maxWait) + 200 ms (sink) = 300 ms`. SLO is 500 ms. OK.

Memory: `5 * 500 * 256B = 640 KB per pod`. Still trivial.

### Iteration 7 — Black Friday checklist

Add:
- DLQ for failed batches.
- Circuit breaker on the analytics DB.
- Jittered start-up (each pod sleeps `rand.Intn(maxWait)` on start).
- Increased `Inflight` from 5 to 8 with autoscaling on connection pool size.
- Pre-warming: spin up 200 pods 4 hours before peak.
- Monitoring: flush-reason distribution, per-pod throughput, p99 latency, DLQ depth, DB conn utilisation.

### Black Friday

Peak hit 950,000 events/s. Pipeline absorbed. p99 latency stayed at 320 ms. DLQ depth: ~50 batches over 4 hours, all from transient DB blips. Cost: 200 pods × 4 hours = 800 pod-hours; analytics DB scaled to peak. All recovered after.

### Post-mortem lessons

- Iteration 1's blind `Inflight = 20` would have crashed the DB. Lesson: model the sink before scaling the producer.
- Iteration 6's bigger batches were the biggest single win. Lesson: tune `maxSize` against actual sink throughput curves.
- Pre-warming and jitter prevented thundering-herd on startup. Lesson: fleet-scale considerations matter.

This is the rhythm of senior-level production engineering. The patterns are tools; the iteration is the work.

---

## Extended Walkthrough — Reading a Goroutine Stack Trace

When the batching stage misbehaves, you may need to read a goroutine stack dump (`SIGQUIT` to a Go program, or `go tool pprof` on a goroutine profile). Here is what a healthy stage looks like.

```
goroutine 47 [select]:
runtime.gopark(0x..., 0x..., 0x0, 0x...)
    /usr/local/go/src/runtime/proc.go:347 +0xfd
runtime.selectgo(0x..., 0x...)
    /usr/local/go/src/runtime/select.go:327 +0xa0a
example.com/batching.(*Stage[...]).Run(0xc000010240, ...)
    /repo/batching/stage.go:81 +0x4ba
example.com/main.main.func1()
    /repo/main.go:31 +0xa6
created by example.com/main.main
    /repo/main.go:30 +0x95
```

`[select]` state means the goroutine is parked at a `select`. That is the accumulator waiting for one of its three cases. Healthy.

If you see:

```
goroutine 47 [chan send]:
example.com/batching.(*Stage[...]).Run.func1(0xc000020120)
    /repo/batching/stage.go:60 +0x2c0
```

The goroutine is parked sending on a channel. If this is the `out <- batch` inside `flush`, the downstream consumer is not receiving. Bug.

If you see:

```
goroutine 47 [chan receive]:
```

The goroutine is parked receiving. If on `<-in`, normal. If on a different channel (e.g. `<-timerFired`), check what is supposed to write to it.

A senior reads stack traces like a senior dev reads a memory profile: at a glance, in seconds.

---

## Extended Walkthrough — Concurrency Pattern Refresher

Five concurrency patterns that batching code relies on:

### 1. The triple-trigger select-loop

```go
for {
    select {
    case x, ok := <-in:
        ...
    case <-timer.C:
        ...
    case <-ctx.Done():
        ...
    }
}
```

The bread and butter. You should be able to write this from memory.

### 2. The selectable send

```go
select {
case out <- batch:
case <-ctx.Done():
}
```

Every send in a batching stage should look like this. Never a bare `out <- batch`.

### 3. The fan-out worker pool

```go
jobs := make(chan []T, capacity)
for i := 0; i < n; i++ {
    go func() {
        for j := range jobs { work(j) }
    }()
}
```

Bounded async flushers, sharded accumulators, retry workers — all use this shape.

### 4. The signal-then-drain

```go
close(jobs)
wg.Wait()
```

After signaling end-of-work via channel close, wait for goroutines to drain. Without `wg.Wait()`, you may exit before all writes complete.

### 5. The ack token pipeline

```go
for ob := range orderedQueue {
    err := <-ob.done
    // process err in seq order
}
```

For pipelined ordered flushers. The ack token preserves order through parallel work.

These five patterns combined cover 95% of production batching code.

---

## Extended Walkthrough — Common Interview Questions

A senior batching interview question and a model answer.

**Question.** "Design a high-throughput batching DB writer with at-least-once delivery, p99 latency under 200ms, 100K writes/s, and per-tenant ordering."

**Model answer outline.**

1. **Triple-trigger accumulator per tenant** (or per shard if tenants are too many). Each accumulator runs in its own goroutine. `maxSize = 200`, `maxWait = 50ms`.

2. **Bounded async flushers per tenant shard.** `Inflight = 4` per shard. Within a tenant, order is preserved by per-tenant single-flusher OR pipelined ordered flushers.

3. **At-least-once via WAL or source-replay.** Each batch is logged to a WAL before flush; on restart, replay from WAL. Or: source (Kafka) tracks offsets; commit only after flush success.

4. **Sink-side retry with exponential backoff.** Up to 5 attempts; final failure goes to DLQ.

5. **Back-pressure preserved.** Bounded `jobs` channel; producer slows when downstream is slow.

6. **Metrics: flush-reason histogram, batch-size histogram, flush-wait histogram, DLQ depth.**

7. **Shutdown: cancel context, accumulator drains partial batch, flusher waits for in-flight writes, WAL truncated only after all writes confirmed.**

8. **Tests: size trigger, time trigger, final flush on close, cancel-flush, no-empty, concurrent-producer, sink-failure-with-retry, sink-failure-with-DLQ, ordering-within-tenant.**

A candidate who covers all eight points in an interview gets the senior offer.

---

## Extended Walkthrough — A Catalog of Production Tweaks

Small tweaks that appear in real codebases.

### Tweak 1 — `maxItemBytes` alongside `maxSize`

```go
buf := make([]Item, 0, maxItems)
bufBytes := 0

case x := <-in:
    if len(buf) == 0 { timer.Reset(maxWait) }
    buf = append(buf, x)
    bufBytes += x.Size()
    if len(buf) >= maxItems || bufBytes >= maxBytes {
        flush()
        bufBytes = 0
    }
```

For sinks with byte limits (S3 has 16 MB per put, DynamoDB has 16 MB per BatchWriteItem).

### Tweak 2 — Backoff between flushes when sink reports overload

```go
case <-timer.C:
    flush()
    if sinkReported429 {
        time.Sleep(backoff)
    }
```

Soft circuit-breaker.

### Tweak 3 — Burst mode

When traffic spikes, temporarily double `maxSize` to amortise more aggressively.

```go
if rateHigh { dynMaxSize = baseMaxSize * 2 } else { dynMaxSize = baseMaxSize }
```

Auto-tuning baby step. Professional.md goes deeper.

### Tweak 4 — Per-item flush hint

Some items are urgent (e.g. login events for fraud detection). Allow a `FlushHint` field that triggers immediate flush.

```go
case x := <-in:
    buf = append(buf, x)
    if x.FlushHint || len(buf) >= maxSize { flush() }
```

### Tweak 5 — Cross-batch deduplication

If items can repeat (e.g. webhooks retried), de-dup inside the batch:

```go
seen := map[string]struct{}{}
case x := <-in:
    if _, dup := seen[x.ID]; dup { continue }
    seen[x.ID] = struct{}{}
    buf = append(buf, x)
```

Reset `seen` after flush. Trade-off: extra map operations per item.

### Tweak 6 — Snapshot vs streaming flush

Some sinks accept a stream (`io.Writer`) better than a slice. In that case, flush by iterating:

```go
flush := func() {
    w := sink.NewWriter()
    for _, item := range buf { w.Write(item) }
    w.Close()
    buf = buf[:0]
}
```

Saves the per-item slice cost in some encoders.

### Tweak 7 — Parallel item encoding before batch

If encoding is CPU-heavy, encode in parallel before adding to the batch:

```go
encoded := make(chan []byte)
for x := range in {
    go func(x Item) { encoded <- encode(x) }(x)
}
for e := range encoded {
    buf = append(buf, e)
}
```

Careful: this loses order. Useful only when order does not matter.

### Tweak 8 — Compression at flush time

```go
flush := func() {
    if len(buf) == 0 { return }
    compressed := gzip(buf)
    sink.Write(compressed)
    buf = buf[:0]
}
```

CPU spent on compression in exchange for network bytes saved.

### Tweak 9 — Trace context propagation

```go
ctx, span := tracer.Start(ctx, "batch.flush")
defer span.End()
err := sink.Write(ctx, batch)
```

One span per flush, with batch size and reason as attributes.

### Tweak 10 — Health check integration

```go
mu.RLock()
healthy := time.Since(lastFlush) < unhealthyAfter
mu.RUnlock()
if !healthy { return errors.New("stage not flushing") }
```

Expose the stage's last-flush time so the `/healthz` endpoint can report stuck stages.

Pick the tweaks you actually need. Avoid adding all ten "because they exist."

---

## Extended Walkthrough — When To Replace a Batching Stage With Something Else

Sometimes a batching stage is the wrong abstraction.

### Replace with a buffered I/O wrapper

If you are only saving syscall overhead (file writes), `bufio.Writer` with a periodic `Flush` is simpler than a full batching stage. No goroutine, no channels, no select.

```go
w := bufio.NewWriterSize(f, 1<<16)
defer w.Flush()
for _, item := range items { w.Write(encode(item)) }
```

For "I want to amortise small writes into bigger ones, single-threaded" this is the right tool.

### Replace with a streaming uploader

If the sink supports streaming (S3 multi-part, HTTP chunked encoding), stream directly without a batching stage:

```go
pr, pw := io.Pipe()
go encode(pw, items)
sink.Upload(pr)
```

No batching, no buffer, just back-pressure via `io.Pipe`. Simpler than batching when the sink is streaming-friendly.

### Replace with `golang.org/x/sync/singleflight`

If many concurrent callers ask for the same thing and you want to batch the *callers*, `singleflight` collapses concurrent calls into one. Different from item-batching, but solves similar pain.

### Keep batching stage when

- Multiple producers feed one sink.
- The sink accepts batched calls.
- You need to bound memory.
- You need cancellation semantics.
- You need fleet observability.

Most production cases. But not all. Know your alternatives.

---

## Extended Walkthrough — Final Code Reference

The senior-tier reference implementation in one file. Use as a starting template.

```go
package batching

import (
    "context"
    "errors"
    "fmt"
    "sync"
    "time"
)

type Reason string

const (
    ReasonSize   Reason = "size"
    ReasonTime   Reason = "time"
    ReasonClose  Reason = "close"
    ReasonCancel Reason = "cancel"
)

// Stage is a generic, observable, cancellable, optionally async batching stage.
type Stage[T any] struct {
    In       <-chan T
    Out      chan<- []T
    MaxSize  int
    MaxWait  time.Duration
    Inflight int            // 0 = sync; >0 = bounded async
    OnFlush  func(Reason, []T)
    OnError  func(error)
    Write    func(context.Context, []T) error // used when Inflight > 0
    Name     string
}

func (s *Stage[T]) Validate() error {
    if s.In == nil { return errors.New("nil In") }
    if s.MaxSize <= 0 { return errors.New("MaxSize must be > 0") }
    if s.MaxWait <= 0 { return errors.New("MaxWait must be > 0") }
    if s.Inflight > 0 && s.Write == nil {
        return errors.New("Inflight > 0 requires Write function")
    }
    if s.Inflight == 0 && s.Out == nil {
        return errors.New("Inflight = 0 (sync) requires Out channel")
    }
    return nil
}

func (s *Stage[T]) Run(ctx context.Context) error {
    if err := s.Validate(); err != nil { return err }

    var (
        jobs  chan []T
        wg    sync.WaitGroup
    )

    if s.Inflight > 0 {
        jobs = make(chan []T, s.Inflight)
        for i := 0; i < s.Inflight; i++ {
            wg.Add(1)
            go s.workerLoop(ctx, &wg, jobs)
        }
    } else if s.Out != nil {
        defer close(s.Out.(chan []T))
    }

    buf := make([]T, 0, s.MaxSize)
    timer := time.NewTimer(s.MaxWait)
    if !timer.Stop() { <-timer.C }

    dispatch := func(r Reason) {
        if len(buf) == 0 { return }
        batch := make([]T, len(buf))
        copy(batch, buf)
        buf = buf[:0]
        if !timer.Stop() { select { case <-timer.C: default: } }
        if s.OnFlush != nil { s.OnFlush(r, batch) }
        if jobs != nil {
            select {
            case jobs <- batch:
            case <-ctx.Done():
            }
        } else {
            select {
            case s.Out <- batch:
            case <-ctx.Done():
            }
        }
    }

    var exitErr error
loop:
    for {
        select {
        case x, ok := <-s.In:
            if !ok { dispatch(ReasonClose); break loop }
            if len(buf) == 0 { timer.Reset(s.MaxWait) }
            buf = append(buf, x)
            if len(buf) >= s.MaxSize { dispatch(ReasonSize) }
        case <-timer.C:
            dispatch(ReasonTime)
        case <-ctx.Done():
            dispatch(ReasonCancel)
            exitErr = ctx.Err()
            break loop
        }
    }

    if jobs != nil {
        close(jobs)
        wg.Wait()
    }
    return exitErr
}

func (s *Stage[T]) workerLoop(ctx context.Context, wg *sync.WaitGroup, jobs <-chan []T) {
    defer wg.Done()
    defer func() {
        if r := recover(); r != nil {
            if s.OnError != nil {
                s.OnError(fmt.Errorf("worker panic: %v", r))
            }
        }
    }()
    for b := range jobs {
        if err := s.Write(ctx, b); err != nil {
            if s.OnError != nil { s.OnError(err) }
        }
    }
}
```

Use this as your project's base. Customise per use case.

---

## Extended Walkthrough — Concluding Senior Notes

Senior-tier batching expertise has three layers:

1. **Mechanics.** The select-loop, timer ritual, copy-on-send, defer-close. You should write this from memory.
2. **Trade-offs.** Sync vs async, bounded vs unbounded, copy vs pool, single vs pipelined. You should defend each choice with measurement.
3. **Operations.** Metrics, alerts, DLQ, jitter, capacity planning. You should make the stage observable enough to debug at 3 AM.

You leave senior-tier when you can apply all three layers in any new pipeline without consulting notes, when you can teach the mechanics to a mid-tier engineer in an afternoon, and when you can defend the trade-offs in a design review without slides.

---

## Appendix — Twelve more nuanced scenarios

### Scenario A1 — Coordinated batching across two pipelines

Two pipelines feed the same sink. Each has its own batching stage. They independently produce 100-row batches every 50 ms. The sink sees 4000 batches/s total. If the sink prefers 500-row batches at 10 ms intervals, you have a coordination problem.

**Resolution.** Insert a merge stage that re-batches the outputs of both. Or, restructure: one batching stage with two inputs.

```go
combined := make(chan Item, 1024)
go forward(in1, combined)
go forward(in2, combined)
go Batch(ctx, combined, batches, 500, 10*time.Millisecond)
```

### Scenario A2 — Batches with mixed retention

Some items must be flushed within 1 ms; others can wait 1 s. A single `maxWait` cannot satisfy both.

**Resolution.** Two batching stages in parallel — one tight, one loose — routed by item type. Or: priority-aware buffer that flushes high-priority items immediately and low-priority on the time trigger.

### Scenario A3 — Batches with size-dependent processing

A small batch is cheap; a large batch is expensive non-linearly. Sink latency is `O(n^1.5)` not `O(n)`.

**Resolution.** Pick `maxSize` where marginal throughput is highest, not where latency is acceptable. Throughput model becomes: `1 / (a + b * n^1.5) * n` to maximise.

### Scenario A4 — Network coalescing under congestion

Under TCP congestion, your sink calls may collapse into fewer larger packets (Nagle's algorithm). This is *positive* for throughput but the sink reports it as "everything came in one second-long burst." Latency measurements at the sink look strange.

**Resolution.** Disable Nagle on the sink connection (`tcp.SetNoDelay(true)`), or accept the variance and tune SLOs accordingly.

### Scenario A5 — Sink with global rate limit, not concurrency limit

Sink rate-limits to 1000 calls/s globally, regardless of concurrency. Throughput cap: `1000 * batch_size`.

**Resolution.** No point increasing `Inflight` past 1. Maximise `maxSize`. Add a rate limiter on the dispatch.

```go
lim := rate.NewLimiter(rate.Limit(1000), 1)
case <-timer.C:
    if err := lim.Wait(ctx); err == nil { dispatch() }
```

### Scenario A6 — Mixed-mode pipeline

Some traffic is real-time (must flush fast); other traffic is bulk (can flush slowly). Same downstream sink.

**Resolution.** Two batching stages, two `maxWait` values. Merge via a multiplexer that lets the real-time stream pre-empt the bulk stream.

### Scenario A7 — Bursty input from a poll loop

Producer polls every 5 s and dumps 10000 items. In between, nothing. Time trigger never sees a non-empty buffer because the size trigger always wins.

**Resolution.** Confirm correct behavior: size-triggered batches in the burst, idle in between. If sink concurrency limited, the burst takes multiple `inflight` cycles to flush; producer must wait. That is intentional back-pressure.

### Scenario A8 — Variable batch sizes the sink prefers

Sink prefers exactly 100 rows per call. Anything other than 100 wastes some efficiency. But your time-triggered flushes are 73, 88, 95...

**Resolution.** Set `maxSize = 100`. Time-triggered batches are smaller; accept the inefficiency. Or: combine pairs of small batches before sending. Trades complexity for ~5% throughput.

### Scenario A9 — Items with TTL

Each item has a "best before" time. After TTL, the item is stale and should not be flushed.

**Resolution.** Filter at flush:

```go
flush := func(r Reason) {
    if len(buf) == 0 { return }
    fresh := buf[:0]
    for _, x := range buf {
        if time.Now().Before(x.Deadline) { fresh = append(fresh, x) }
    }
    buf = fresh
    if len(buf) == 0 { return }
    // send batch
}
```

### Scenario A10 — Items that arrive out of order

Items from a distributed source arrive with timestamps not in receipt order. The batching stage might flush at receipt-time but sink wants event-time order.

**Resolution.** Sort buf before flush:

```go
flush := func(r Reason) {
    if len(buf) == 0 { return }
    sort.Slice(buf, func(i, j int) bool { return buf[i].Time.Before(buf[j].Time) })
    // send batch
}
```

Costs `O(n log n)` per flush. Usually trivial.

### Scenario A11 — Cross-region replication

Pipeline runs in multiple regions. Each region's batching stage flushes to a local sink. Some items must reach all regions. How do you batch cross-region traffic?

**Resolution.** Out of scope here. Look at multi-master replication or event-sourcing patterns. The local batching stage is unaffected.

### Scenario A12 — Audit-required pipeline

Every item must be persisted to local disk before considered "acknowledged." Even after batching stage.

**Resolution.** WAL before batch:

```go
case x := <-in:
    _ = wal.Append(ctx, x)
    buf = append(buf, x)
    // ... rest of usual flow
```

WAL throughput must keep up with input rate. Use a `bufio.Writer` on the WAL file.

---

## Appendix — Twenty deep technical notes

### N1 — Channel select fairness

Go's `select` chooses uniformly at random among ready cases. There is no priority. If you need priority, pre-check the high-priority case:

```go
select {
case <-highPriority:
    // handle
default:
    select {
    case <-highPriority:
    case <-normal:
    case <-ctx.Done():
    }
}
```

### N2 — `<-ctx.Done()` after cancel is always ready

Once cancelled, the channel returns immediately every time. Treat it as a one-way edge.

### N3 — `close(ch)` is idempotent? No, panics on second call

Always close from one place. Use `sync.Once` if multiple paths converge.

### N4 — Channel direction conversion is one-way

You can convert `chan T` to `<-chan T` or `chan<- T`. You cannot convert back. Use this to enforce ownership at the boundary.

### N5 — `make(chan T, 0)` is the same as `make(chan T)`

Both unbuffered. Some style guides prefer one over the other.

### N6 — `cap()` on an unbuffered channel returns 0

`len()` returns 0 always. Neither is useful at runtime.

### N7 — `select` with all `nil` channels blocks forever

```go
var c chan int
select {
case <-c: // never
}
```

Useful for "I want to disable this case for now."

### N8 — `time.NewTimer(0)` fires immediately

Useful for "trigger on next iteration." But beware: if you `Reset(0)` an already-fired timer without draining, you get the same behavior twice.

### N9 — `time.AfterFunc` does not need `Stop()` if it has fired

But calling `Stop()` after firing is harmless and returns `false`.

### N10 — `time.Sleep` cannot be interrupted

Use `time.After` or `timer.C` inside `select` to make sleeps cancellable.

### N11 — Goroutine launches are not synchronous

`go f()` returns before `f` starts running. If you need confirmation, use a channel.

### N12 — Closures over loop variables in Go 1.22+

Each iteration has its own variable. Pre-1.22 bugs are fixed. But test on multiple versions if you support both.

### N13 — `sync.WaitGroup.Add` must precede the goroutine

```go
wg.Add(1)
go func() { defer wg.Done(); ... }()
```

Never `wg.Add(1)` inside the goroutine.

### N14 — `sync.Pool` is per-P

The pool has per-processor caches. High-throughput workloads benefit; low-throughput ones may not.

### N15 — `select` on a `nil` channel never fires

Use this to dynamically include/exclude cases:

```go
var input <-chan T = s.In
case x, ok := <-input:
    if !ok { input = nil }
```

### N16 — `runtime.GOMAXPROCS` defaults to NumCPU

Override only with measurement. Containers may misreport CPU count; use `automaxprocs`.

### N17 — Heap escape of slices crossing channels

A slice sent through a channel escapes to the heap. Unavoidable unless you pool.

### N18 — `context.WithValue` is not for control flow

Use it for request-scoped data, not for cancellation. Cancellation goes through `WithCancel`/`WithTimeout`.

### N19 — `errgroup.WithContext` cancels on first error

Useful for "all-or-nothing" worker pools. Not always what you want.

### N20 — `time.Time.Sub` returns Duration, not seconds

Be careful with unit conversions. `Duration` is nanoseconds.

---

## Appendix — Ten more anti-patterns at staff level

### SAP1 — Configuring batching globally

A single `globalMaxSize` shared across all stages. Co-evolution of stages broken; one stage's needs leak into another.

### SAP2 — Mixing flush and persistence

The accumulator both batches and persists. Persistence failures should not crash the accumulator; flush retries should not block accumulation.

### SAP3 — Reading config from environment in hot loop

Every flush reads `os.Getenv("MAX_SIZE")`. Slow and unpredictable. Read once at startup.

### SAP4 — Cross-thread state without synchronisation

A field on the stage struct read by both the accumulator and a metrics reporter. Race.

### SAP5 — Recursive flushing

`flush()` calls itself for sub-batches. Stack growth, hard to reason. Linearise.

### SAP6 — `time.Tick` for the time trigger in a long-running process

Leak. Always `time.NewTicker` + `Stop()`.

### SAP7 — `Inflight` autoscaling without bound

Sink slowness causes inflight to grow. Memory explodes. Bound it.

### SAP8 — Per-batch logger creation

`log.New(os.Stderr, ...)` inside `flush`. Allocation. Use a single logger.

### SAP9 — `sync.Mutex` around the batch slice

Two goroutines sharing the buffer with a mutex. Anti-pattern; use one goroutine.

### SAP10 — Batching after a fan-out

Fan-out splits the stream by hash; then a single batching stage tries to re-batch. Lost the parallelism. Batch *per shard*.

---

## Appendix — A staff-level mental model

By the time you finish senior tier and approach staff level, your mental model of batching should look something like:

```
+-----------------+         +-----------------+
|  Source(s)      |---->----| Bounded chan    |
+-----------------+         +-----------------+
                                  |
                                  v
                          +------------------+
                          |  Accumulator     |
                          |  - select-loop   |
                          |  - 3 triggers    |
                          |  - flush helper  |
                          +------------------+
                                  |
                                  v
                          +------------------+
                          |  Job queue (cap=N)|
                          +------------------+
                            |    |    |    |
                            v    v    v    v
                         Worker pool (size=N)
                            |    |    |    |
                            v    v    v    v
                          +------------------+
                          |    Sink(s)       |
                          +------------------+
                                  ^
                                  |
                          +------------------+
                          | Optional DLQ +   |
                          | retry policy +   |
                          | circuit breaker  |
                          +------------------+
```

Plus, around the edges:

- Cancellation propagates from top to bottom via `context.Context`.
- Back-pressure propagates from bottom to top via blocking sends.
- Metrics emerge at every layer.
- The shutdown-flush proof is in your head.

Visualise this in your mind's eye whenever you read or write batching code.

---

## Appendix — Quickfire questions

Rapid-fire questions you should answer in 10 seconds each.

1. Triple trigger? — size, time, end-of-stream/cancel.
2. Default flush mode? — sync.
3. When async? — measured throughput insufficient.
4. Bound on async? — worker pool with `Inflight` cap.
5. Order preservation under async? — pipelined ordered flushers or per-key.
6. Copy on send? — yes, always (until you have pool with explicit contract).
7. Time trigger primitive? — `*time.Timer` with stop-and-drain.
8. Ticker valid? — yes, with empty-buffer guard.
9. Output channel cap? — 0–8 typically.
10. `time.After` in loop? — never.
11. `time.Tick` ever? — no.
12. `defer close(out)`? — yes, top of function.
13. Cancellable send? — yes, select on `ctx.Done()`.
14. Empty-buffer flush? — early return.
15. Final flush on close? — mandatory.
16. Cancel-case flush? — best effort, selectable.
17. Pool? — when GC profile says.
18. Jitter? — fleet size > 10.
19. DLQ? — when partial failures not recoverable.
20. Metric tags? — `reason`, `stage`.

These should be reflex.

---

## Final Note Before Professional

You have completed senior.md. The patterns and mental models here suffice for nearly every production batching design conversation. Professional.md adds:

- Adaptive sizing based on downstream feedback.
- Queue-theoretic capacity planning (Little's law, M/M/1, M/D/1).
- Multi-tier accumulators with cascading time triggers.
- Jittered timers for fleet-scale deployments.
- SLO-driven autonomous tuning loops.

Those are refinements on this foundation. Continue when ready.

---

## Appendix — Production Postscript: Lessons from Eight Incidents

Eight incident-report-style write-ups, sanitised, from real production batching pipelines. Read them as case studies.

### Incident 1 — The midnight queue jump

**Symptom.** Each night at 00:05 UTC, queue depth jumps from baseline 500 to peak 50000, sustained for 4 minutes, then recovers.

**Investigation.** The producer was a CI system that fired at midnight UTC running a nightly batch job. The job emitted 200K events in 4 minutes. The batching stage's `Inflight = 2` was too small; bottleneck was sink concurrency.

**Fix.** Raise `Inflight` to 8 during the 23:55–00:15 window via scheduled config update. The off-peak resource budget for the analytics DB allowed it.

**Lesson.** Time-of-day patterns demand schedule-aware tuning. A single static configuration is rarely optimal across 24 hours.

### Incident 2 — The buggy fix

**Symptom.** After a bug-fix deploy, the 0.5% missing-data incident (deploy data loss) doubled to 1%.

**Investigation.** The "fix" added a drain-on-cancel block but kept the original cancel-case flush. So under cancellation, items dispatched to the worker but worker exited before completing, *and* the drain block also exited early. Net: more items in flight, more lost.

**Fix.** Remove the duplicate path. Either drain-on-cancel OR flush-on-cancel; not both. Add an explicit "is-shutting-down" state to make the path clear.

**Lesson.** When fixing a graceful-shutdown bug, the fix often introduces overlap with existing code. Verify there is exactly one path to exit.

### Incident 3 — The poisoned batch

**Symptom.** Sink success rate dropped from 99.99% to 95% over 4 hours, recovering after a deploy.

**Investigation.** One bad item with a malformed timestamp was in the input stream. It went into batches; sink rejected each batch containing it; whole-batch retry logic re-tried forever; metric showed many 4xx responses. Item kept appearing in retry batches because no per-item dropping logic.

**Fix.** Add split-on-fail. Single bad item gets isolated and DLQ'd. Whole batch sees the bad item once, splits, eventually sends the rest through.

**Lesson.** "Whole-batch retry" without split-on-fail is fragile. Add split-on-fail as a default for any sink that can fail on a single item.

### Incident 4 — The thundering herd

**Symptom.** Every 1 second, the analytics DB CPU spikes from 30% to 95%. CPU at 95% causes timeouts. Slo violations.

**Investigation.** 100 pods each had `maxWait = 1s`. All started within seconds of each other (rolling deploy). All time-trigger fires aligned to wall-clock seconds. Each second, 100 simultaneous batches hit the sink.

**Fix.** Add 10% jitter to `maxWait` per pod. Spread the fires.

**Lesson.** At fleet sizes > 10, herd flushes are a real problem. Jitter is essential.

### Incident 5 — The forgotten `Inflight = 1`

**Symptom.** Throughput stuck at 2000 events/s despite 8 workers configured.

**Investigation.** Workers were configured; `Inflight = 1` was set globally for safety during development. Never updated. Worker pool ran but only one batch was in flight at a time.

**Fix.** Set `Inflight = 8`.

**Lesson.** Configuration values that "do nothing" deserve loud comments. A `// IMPORTANT: capped at 1 for safety during rollout` would have caught this in code review.

### Incident 6 — The memory leak chase

**Symptom.** Memory growth, 200 MB/hour, over 12 hours = 2.4 GB. OOM at 13 hours.

**Investigation.** `inuse_space` profile showed many `[]Event` slices alive. Suspected `sync.Pool` not returning. Closer look: pool was correctly used in batching stage. But downstream consumer cached the latest 10 batches "for diagnostic purposes" without returning them.

**Fix.** Remove the cache; rely on metrics.

**Lesson.** `sync.Pool` contracts must be enforced end-to-end. Documentation does not enforce; code review does, but only if the reviewer remembers.

### Incident 7 — The cancel race

**Symptom.** Occasionally on shutdown, the program panics: "send on closed channel."

**Investigation.** The accumulator owned `out` and called `defer close(out)`. But a separate goroutine (a metrics reporter) was also reading `out` and, on cancel, attempted to close `out` "to wake up its loop." Double-close on shutdown when timing aligned.

**Fix.** Remove the spurious `close(out)` from the metrics goroutine. The metrics goroutine should use `<-ctx.Done()` to exit, not channel-close manipulation.

**Lesson.** Close-from-one-place is not just a style rule; violating it crashes in production. Make the close path explicit and singular.

### Incident 8 — The lost watermark

**Symptom.** Downstream event-time consumer reported "watermark stuck" for 30 seconds, then jumped 30 seconds forward.

**Investigation.** Batching stage flushed by time trigger; consumer used the timestamp of the last item to advance watermark. During an idle period (no items for 30 seconds), the batching stage did not flush at all (empty-buffer guard). The first item after the idle had timestamp 30 seconds before its arrival (event-time, not processing-time). Watermark sat where the previous flush left it, jumped when the new flush arrived.

**Fix.** Send a periodic "watermark heartbeat" message even when buffer is empty. Add a side-channel for this.

**Lesson.** Empty-buffer flushes are not always wrong. Event-time consumers may *need* them. Make the empty-flush policy configurable per stage.

---

## Appendix — Architecture Doc Template

When proposing a new batching stage, your design doc should answer these in order. Use this as a template.

### 1. Context

- What is the pipeline? (One paragraph)
- What is the sink? (Latency, throughput, error modes, batch API)
- What is the source? (Throughput, peakiness, ordering)
- What is the SLO? (p99 latency, throughput, durability)

### 2. Proposed shape

- Single stage or per-key?
- Sync or bounded async? If async, `Inflight`?
- Trigger pair: `maxSize`, `maxWait`?
- Sink call: direct, retry-on-fail, split-on-fail, per-item ack?
- DLQ: yes/no, where?

### 3. Math

- Throughput model: `Inflight × batch_size / sink_latency = ? items/s`
- Memory model: `Inflight × maxSize × sizeof(item) = ? MB`
- Latency model: `maxWait + sink_latency = ? ms`
- Fit to SLO: do they satisfy?

### 4. Failure modes

- Sink slow: back-pressure path?
- Sink errors transient: retry behavior?
- Sink errors permanent: DLQ behavior?
- Producer crashed: input close handling?
- Cancellation: drain or best-effort?

### 5. Observability

- Metrics emitted (counters, histograms).
- Alerts (latency, throughput, DLQ depth).
- Tracing (spans, attributes).
- Logging (level, content).

### 6. Tests

- Unit tests (six standard ones plus failure-mode tests).
- Load tests (steady, peak, post-recovery).
- Chaos tests (sink failures, slow sink, cancellation).

### 7. Rollout

- Feature flag.
- Gradual percentage.
- Rollback plan.

### 8. Future considerations

- Adaptive sizing? Out of scope unless SLO requires.
- Multi-region? Out of scope.

A 4-page doc covering all 8 sections is the senior deliverable for a new batching stage.

---

## Appendix — Reflective Closing

What you have learned in senior.md:

- The trade-off matrix for sync vs bounded async vs pipelined ordered flushers.
- How to bound async flush correctly with workers and `Inflight`.
- The four partial-failure strategies and how to pick.
- `sync.Pool` for allocation-free flushes, with the consumer-contract caveat.
- Shutdown-flush correctness proofs in semi-formal style.
- How to diagnose three categories of production failure from symptoms.
- The architecture-doc template for new batching stages.
- Twelve nuanced scenarios you may encounter.
- Twenty deep technical notes on Go runtime behavior.
- Ten staff-level anti-patterns to call out in review.

If you have read this far and the patterns feel native, your senior-tier batching skills are solid. Professional.md will challenge them with capacity-planning rigor and adaptive control loops.

---

## Appendix — Extended Worked Example: Building a Production Service End-to-End

This is a long walkthrough that brings everything together. We build a small but realistic event-ingest service with HTTP intake, batching, async DB writes, retries, DLQ, metrics, and graceful shutdown. Save and run.

### Service shape

```
HTTP POST /events   --->   intake chan Event   --->   Batch stage   --->   workers   --->   DB
                                                                             |
                                                                             +-- on persistent error --> DLQ
```

### File: types.go

```go
package eventservice

import "time"

type Event struct {
    ID        string
    Tenant    string
    Body      []byte
    CreatedAt time.Time
}
```

### File: db.go

```go
package eventservice

import (
    "context"
    "errors"
    "math/rand"
    "time"
)

type DB struct {
    FailRate float64 // simulated failure rate 0..1
    Latency  time.Duration
}

var ErrTransient = errors.New("transient db error")

func (d *DB) BatchInsert(ctx context.Context, batch []Event) error {
    select {
    case <-time.After(d.Latency):
    case <-ctx.Done():
        return ctx.Err()
    }
    if rand.Float64() < d.FailRate {
        return ErrTransient
    }
    return nil
}
```

### File: dlq.go

```go
package eventservice

import (
    "context"
    "log"
    "sync/atomic"
)

type DLQ struct {
    Count atomic.Int64
}

func (d *DLQ) Send(ctx context.Context, batch []Event, lastErr error) {
    d.Count.Add(int64(len(batch)))
    log.Printf("DLQ: %d events lost (last err: %v)", len(batch), lastErr)
}
```

### File: stage.go

```go
package eventservice

import (
    "context"
    "errors"
    "sync"
    "time"
)

type Reason string

const (
    ReasonSize   Reason = "size"
    ReasonTime   Reason = "time"
    ReasonClose  Reason = "close"
    ReasonCancel Reason = "cancel"
)

type Stage struct {
    In       <-chan Event
    DB       *DB
    DLQ      *DLQ
    MaxSize  int
    MaxWait  time.Duration
    Inflight int
    Retries  int
    OnFlush  func(Reason, int)
}

func (s *Stage) Run(ctx context.Context) error {
    if s.MaxSize <= 0 || s.MaxWait <= 0 || s.Inflight <= 0 {
        return errors.New("invalid config")
    }

    jobs := make(chan []Event, s.Inflight)
    var wg sync.WaitGroup
    for i := 0; i < s.Inflight; i++ {
        wg.Add(1)
        go s.worker(ctx, &wg, jobs)
    }

    buf := make([]Event, 0, s.MaxSize)
    timer := time.NewTimer(s.MaxWait)
    if !timer.Stop() { <-timer.C }

    dispatch := func(r Reason) {
        if len(buf) == 0 { return }
        batch := make([]Event, len(buf))
        copy(batch, buf)
        buf = buf[:0]
        if !timer.Stop() { select { case <-timer.C: default: } }
        if s.OnFlush != nil { s.OnFlush(r, len(batch)) }
        select {
        case jobs <- batch:
        case <-ctx.Done():
        }
    }

loop:
    for {
        select {
        case x, ok := <-s.In:
            if !ok { dispatch(ReasonClose); break loop }
            if len(buf) == 0 { timer.Reset(s.MaxWait) }
            buf = append(buf, x)
            if len(buf) >= s.MaxSize { dispatch(ReasonSize) }
        case <-timer.C:
            dispatch(ReasonTime)
        case <-ctx.Done():
            dispatch(ReasonCancel)
            break loop
        }
    }

    close(jobs)
    wg.Wait()
    return nil
}

func (s *Stage) worker(ctx context.Context, wg *sync.WaitGroup, jobs <-chan []Event) {
    defer wg.Done()
    for batch := range jobs {
        s.writeWithRetry(ctx, batch)
    }
}

func (s *Stage) writeWithRetry(ctx context.Context, batch []Event) {
    var err error
    backoff := 100 * time.Millisecond
    for attempt := 0; attempt <= s.Retries; attempt++ {
        err = s.DB.BatchInsert(ctx, batch)
        if err == nil { return }
        if !errors.Is(err, ErrTransient) { break }
        select {
        case <-time.After(backoff):
        case <-ctx.Done(): return
        }
        backoff *= 2
        if backoff > 5*time.Second { backoff = 5 * time.Second }
    }
    s.DLQ.Send(ctx, batch, err)
}
```

### File: http.go

```go
package eventservice

import (
    "context"
    "encoding/json"
    "net/http"
    "time"
)

type Server struct {
    In chan<- Event
}

func (s *Server) HandleEvents(w http.ResponseWriter, r *http.Request) {
    var ev Event
    if err := json.NewDecoder(r.Body).Decode(&ev); err != nil {
        http.Error(w, "bad body", http.StatusBadRequest)
        return
    }
    ev.CreatedAt = time.Now()

    ctx, cancel := context.WithTimeout(r.Context(), 100*time.Millisecond)
    defer cancel()
    select {
    case s.In <- ev:
        w.WriteHeader(http.StatusAccepted)
    case <-ctx.Done():
        http.Error(w, "backpressure", http.StatusServiceUnavailable)
    }
}
```

### File: main.go

```go
package main

import (
    "context"
    "fmt"
    "log"
    "net/http"
    "os"
    "os/signal"
    "sync"
    "syscall"
    "time"

    "example/eventservice"
)

func main() {
    in := make(chan eventservice.Event, 1024)
    dlq := &eventservice.DLQ{}
    db := &eventservice.DB{FailRate: 0.05, Latency: 30 * time.Millisecond}

    stage := &eventservice.Stage{
        In:       in,
        DB:       db,
        DLQ:      dlq,
        MaxSize:  200,
        MaxWait:  50 * time.Millisecond,
        Inflight: 4,
        Retries:  3,
        OnFlush:  func(r eventservice.Reason, n int) {
            // Replace with real metrics
            log.Printf("flush reason=%s size=%d", r, n)
        },
    }

    rootCtx, cancel := context.WithCancel(context.Background())
    var wg sync.WaitGroup
    wg.Add(1)
    go func() {
        defer wg.Done()
        if err := stage.Run(rootCtx); err != nil {
            log.Printf("stage err: %v", err)
        }
    }()

    srv := &eventservice.Server{In: in}
    mux := http.NewServeMux()
    mux.HandleFunc("/events", srv.HandleEvents)

    httpSrv := &http.Server{Addr: ":8080", Handler: mux}
    wg.Add(1)
    go func() {
        defer wg.Done()
        if err := httpSrv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
            log.Printf("http err: %v", err)
        }
    }()

    sigCh := make(chan os.Signal, 1)
    signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
    <-sigCh
    fmt.Println("shutting down...")

    httpSrv.Shutdown(context.Background())
    close(in)
    cancel()
    wg.Wait()
    fmt.Printf("DLQ count: %d\n", dlq.Count.Load())
}
```

### What this demonstrates

- HTTP intake with per-request timeout and back-pressure-aware response (503 on saturation).
- Batching stage with size/time/cancel triggers and flush-reason hook.
- Bounded async flush with worker pool.
- Per-batch retry with exponential backoff.
- DLQ for permanently failed batches.
- Graceful shutdown: HTTP server stops, intake channel closes, stage drains, workers complete, DLQ tally printed.

### Tests for this service

A test file you would add alongside:

```go
package eventservice

import (
    "context"
    "testing"
    "time"
)

func TestStage_BasicFlow(t *testing.T) {
    in := make(chan Event, 16)
    dlq := &DLQ{}
    db := &DB{FailRate: 0, Latency: 0}
    s := &Stage{
        In: in, DB: db, DLQ: dlq,
        MaxSize: 3, MaxWait: 50 * time.Millisecond, Inflight: 1, Retries: 1,
    }
    ctx, cancel := context.WithCancel(context.Background())
    done := make(chan struct{})
    go func() { defer close(done); _ = s.Run(ctx) }()

    for i := 0; i < 7; i++ { in <- Event{ID: "e"} }
    close(in)
    <-done
    cancel()

    if dlq.Count.Load() != 0 { t.Fatalf("unexpected DLQ: %d", dlq.Count.Load()) }
}

func TestStage_DLQOnPersistentFailure(t *testing.T) {
    in := make(chan Event, 16)
    dlq := &DLQ{}
    db := &DB{FailRate: 1.0, Latency: 0}
    s := &Stage{
        In: in, DB: db, DLQ: dlq,
        MaxSize: 3, MaxWait: 50 * time.Millisecond, Inflight: 1, Retries: 1,
    }
    ctx, cancel := context.WithCancel(context.Background())
    done := make(chan struct{})
    go func() { defer close(done); _ = s.Run(ctx) }()

    for i := 0; i < 3; i++ { in <- Event{ID: "e"} }
    close(in)
    <-done
    cancel()

    if dlq.Count.Load() != 3 {
        t.Fatalf("DLQ expected 3, got %d", dlq.Count.Load())
    }
}
```

Two tests. Basic flow with no failures: no DLQ. Persistent failure: all events DLQ'd.

### Production hardening list

To take this from "works" to "production":

1. Replace `log.Printf` with structured logging (`slog`).
2. Replace `OnFlush` with real Prometheus counters.
3. Add spans via `go.opentelemetry.io/otel`.
4. Add a `/metrics` endpoint and a `/healthz` endpoint.
5. Add input validation in the HTTP handler.
6. Add authentication / authorization.
7. Replace the in-memory `DLQ` with a durable sink (file, Kafka, S3).
8. Add a per-pod jitter on `MaxWait`.
9. Add config from environment, with defaults.
10. Add a graceful drain on `SIGTERM` with deadline.
11. Add a load-test harness in `/test/load`.
12. Add a chaos-test harness (`FailRate = 0.5`, `Latency = 200ms`).
13. Add CI integration tests with a real ephemeral DB.
14. Add a circuit breaker around `DB.BatchInsert` (e.g. `sony/gobreaker`).
15. Add a feature flag for `Inflight` to rollback.

This is the gap between "tutorial" and "production." Filling it is the work.

---

## Appendix — A 30-day exercise plan

To consolidate senior-tier batching skills, here is a 30-day plan.

- **Day 1.** Re-read junior.md. Write the canonical Batch from memory three times. Verify with the same test set each time.
- **Day 2.** Re-read middle.md. Implement per-key batching from memory.
- **Day 3.** Re-read senior.md. Implement bounded-async flush from memory.
- **Day 4.** Implement pipelined ordered flushers from scratch. Test ordering invariant.
- **Day 5.** Build the full event-ingest service from the appendix above. Run it. Send synthetic load.
- **Day 6.** Add metrics to your service. Plot flush-reason distribution.
- **Day 7.** Run a chaos test (FailRate = 0.5, Latency variable). Observe DLQ growth.
- **Day 8.** Profile under load. Identify the bottleneck.
- **Day 9.** Apply one optimisation (sync.Pool, increase Inflight, bigger batches). Re-measure.
- **Day 10.** Repeat day 8-9 until throughput plateaus.
- **Day 11.** Read Sarama's AsyncProducer source. Map its components to your mental model.
- **Day 12.** Read franz-go's RecordBatch. Same.
- **Day 13.** Read Telegraf's batched output. Same.
- **Day 14.** Read Apache Pulsar's batch in client. Same.
- **Day 15.** Find a real codebase you have access to that has a batching stage. Review it against the senior checklist. Identify three issues.
- **Day 16.** Write three improvement PRs against the codebase you reviewed.
- **Day 17.** Read the Go memory model spec end-to-end. Map relevant rules to batching code.
- **Day 18.** Implement a fake clock and rewrite your tests to be deterministic.
- **Day 19.** Write a property-based test for the accumulator using `gopter`.
- **Day 20.** Add jittered timers to the event-ingest service. Simulate 100 pods. Observe flush distribution.
- **Day 21.** Implement an adaptive `maxSize` (professional-tier teaser). Test under bursty load.
- **Day 22.** Implement split-on-fail. Inject a poison item. Verify isolation.
- **Day 23.** Implement per-item ack handling. Test with a fake DynamoDB-style sink.
- **Day 24.** Build a Grafana-style dashboard (or text dashboard) showing flush reasons, batch sizes, throughput, latency.
- **Day 25.** Write a runbook for the event-ingest service: "what to do at 3 AM when X happens."
- **Day 26.** Pair-program a new batching stage with a colleague. Note where you teach vs they teach.
- **Day 27.** Write a tech-talk: "Production batching in Go" — 20 minutes, 10 slides.
- **Day 28.** Deliver the talk to a small audience. Note questions you could not answer.
- **Day 29.** Research the questions. Update your mental model.
- **Day 30.** Re-read your initial Batch implementation from day 1. Notice how naive it looks.

This is the path from "knows the pattern" to "owns the pattern." Repeatable; effective.

---

## Appendix — A vocabulary for design conversations

When designing batching with a team, vocabulary precision saves time. Some terms to use consistently:

- "**Triple trigger**" — size, time, end-of-stream/cancel. Not "two triggers" or "size and time."
- "**Inflight budget**" — number of concurrent flushers, not "worker count" or "parallelism level."
- "**Cancellable send**" — `select { case ch <- v: case <-ctx.Done(): }`. Not "interruptible send."
- "**Stop-and-drain**" — the timer-reset ritual. Not "stop the timer."
- "**Final flush**" — the flush on input close or cancel. Not "shutdown flush."
- "**Flush reason**" — `size`, `time`, `close`, `cancel`. Not "flush cause" or "flush trigger."
- "**Back-pressure**" — the cascade of upstream slowdowns. Not "rate limiting" (a different concept).
- "**Pipelined ordered flushers**" — the ack-token pattern. Not "ordered async."
- "**Split-on-fail**" — the bisection retry. Not "binary retry" or "halving."
- "**DLQ**" — dead-letter queue. Not "failed-items queue."

Using these consistently across the team eliminates the "I think we mean the same thing" friction in design reviews.

---

## Appendix — Visual mnemonic for the three triggers

```
                    +-----------+
                    |   buf     |
                    +-----------+
                    |  items in |
                    |  flight   |
                    +-----------+
                          |
              +-----------+-----------+
              |           |           |
              v           v           v
         SIZE >=  N   maxWait      ctx.Done OR
         (inline)    (timer.C)     in closed
              |           |           |
              +-----+-----+-----+-----+
                    |           |
                    v           v
                 flush()    flush() + return
                    |
                    v
              +-----------+
              |  out      |
              +-----------+
```

Visualise this whenever you write a batching stage. Three triggers in, one flush out.

---

## Closing remark

Senior-level batching is more about discipline than complexity. The patterns are simple; the discipline is in applying them consistently, instrumenting them carefully, and defending them with measurement. There are no clever tricks, only repeated good habits.

A senior batching engineer:

- Writes the canonical pattern without thinking.
- Tags every flush with a reason.
- Tests the final-flush case before anything else.
- Picks sync over async unless measurement says otherwise.
- Bounds in-flight when going async.
- Adds jitter at fleet scale.
- Documents the shutdown-flush proof.
- Reviews other people's batching code against a checklist.

Internalise these and you operate at senior level. Professional.md adds the next layer: adaptive control and queue-theoretic capacity planning. But the foundation is what you have here.

That is the senior batching engineer's mindset. On to professional.md.
