---
layout: default
title: Batching Stages — Junior
parent: Batching Stages
grand_parent: Pipeline Production Patterns
ancestor: Go
nav_order: 2
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/19-pipeline-production-patterns/04-batching-stages/junior/
---

# Batching Stages — Junior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Pros and Cons](#pros-and-cons)
8. [Use Cases](#use-cases)
9. [Code Examples](#code-examples)
10. [Coding Patterns](#coding-patterns)
11. [Clean Code](#clean-code)
12. [Product Use](#product-use)
13. [Error Handling](#error-handling)
14. [Security Considerations](#security-considerations)
15. [Performance Tips](#performance-tips)
16. [Best Practices](#best-practices)
17. [Edge Cases and Pitfalls](#edge-cases-and-pitfalls)
18. [Common Mistakes](#common-mistakes)
19. [Common Misconceptions](#common-misconceptions)
20. [Tricky Points](#tricky-points)
21. [Test](#test)
22. [Tricky Questions](#tricky-questions)
23. [Cheat Sheet](#cheat-sheet)
24. [Self-Assessment Checklist](#self-assessment-checklist)
25. [Summary](#summary)
26. [What You Can Build](#what-you-can-build)
27. [Further Reading](#further-reading)
28. [Related Topics](#related-topics)
29. [Diagrams and Visual Aids](#diagrams-and-visual-aids)

---

## Introduction

> Focus: "What is a batching stage? How do I write the simplest one that does not lose items, does not hang, and does flush its last partial batch when the input ends?"

A **batching stage** is a small piece of a Go pipeline whose only job is to take items one at a time from an input channel and emit them in *groups* to an output channel or a sink (a database, a log shipper, a remote API call). Instead of doing one operation per item, the downstream code does one operation per group. The group is called a **micro-batch**.

Why bother? Because almost every real-world sink — a SQL `INSERT`, an HTTP request, a Kafka produce, a disk write, a JSON marshal — has a per-call cost that does not depend on how many items you put in the call. If you can put 100 items in one call instead of 100 calls of one item each, you often see a 10x to 100x throughput improvement. That is what batching buys you, and it is the single most common production optimisation in any pipeline.

At the junior level we will write exactly one shape of batching stage: a single goroutine that reads items from an input channel, appends them to an in-memory slice, and flushes the slice when one of three conditions becomes true:

1. The slice has reached a target **maximum size** (the *size trigger*).
2. A configured **maximum wait** has elapsed since the first item entered the current batch (the *time trigger*).
3. The pipeline is being **shut down** (the input channel was closed, or a `context.Context` was cancelled).

These three conditions form a triad: size, time, end-of-stream. A correct batching stage handles all three. A buggy one — and you will see many — handles only the first one and silently loses the last partial batch every time the program shuts down. We will spend a good fraction of this file making sure you write the correct version on the first try.

After reading this file you will:

- Know what a micro-batch is and why batching exists.
- Be able to write a working batching stage with size, time, and end-of-stream triggers.
- Recognise the four classic first-time bugs: forgotten final flush, leaked timer, captured slice header, deadlock on output send.
- Understand the difference between synchronous flush (send to next channel and wait) and asynchronous flush (hand off to a separate goroutine), and know which to use first.
- Use `*time.Timer` correctly (the naive reset pattern is wrong, and we will see why).
- Test your batching stage with a `testing.T` harness that injects controllable input and time.

You do not need to know about adaptive batch sizing, multi-tier accumulators, queue-theoretic capacity planning, or jittered timers yet. Those come at middle, senior, and professional levels.

---

## Prerequisites

- **Required.** Comfort reading and writing Go. You should be able to write a `main` function, define a struct, and start a goroutine.
- **Required.** Basic familiarity with channels: `make(chan T, n)`, `ch <- x`, `x, ok := <-ch`, `close(ch)`, `for x := range ch { ... }`.
- **Required.** Awareness of `context.Context` and `ctx.Done()` as a cancellation channel.
- **Helpful.** A first read of folder 02 (cancellation propagation) and folder 01 (error propagation) in this Pipeline Production Patterns track. Batching builds on both.
- **Helpful.** Familiarity with `time.NewTimer`, `time.After`, `time.Tick`. We will explain the differences but it speeds up reading if you have used one of them before.

You should be able to write, compile, and run this program on your machine before continuing:

```go
package main

import "fmt"

func main() {
    ch := make(chan int, 3)
    go func() {
        defer close(ch)
        for i := 0; i < 5; i++ {
            ch <- i
        }
    }()
    for v := range ch {
        fmt.Println(v)
    }
}
```

If this prints `0 1 2 3 4` and exits cleanly, you are ready.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Micro-batch** | An in-memory group of items (commonly 8 to a few thousand) accumulated for a short window before being processed as a unit. |
| **Batching stage** | A pipeline stage that converts a stream of single items into a stream of micro-batches. |
| **Accumulator** | The goroutine inside a batching stage that owns the in-flight batch slice and decides when to flush. |
| **Flush** | The act of emitting the current batch downstream and resetting the buffer. May be synchronous (block on send) or asynchronous (hand off to a worker). |
| **Size trigger** | The flush rule "flush as soon as `len(batch) >= maxSize`." |
| **Time trigger** | The flush rule "flush as soon as the oldest item has been in the buffer for `maxWait`." |
| **End-of-stream marker** | The signal that no more items will ever arrive on the input channel. In Go pipelines this is almost always the input channel being closed. |
| **Cancellation** | A `context.Context` being cancelled (`ctx.Done()` returns). A correct batching stage flushes its partial batch and exits cleanly when this happens. |
| **Sync flush** | The accumulator blocks on the downstream operation. Preserves back-pressure and ordering. |
| **Async flush** | The accumulator hands the completed batch to a separate goroutine (or pool) and continues accepting items. Faster but harder to bound and order. |
| **Back-pressure** | Upstream slowdown caused by downstream not being able to accept work. Bounded channels and sync flushes propagate it naturally. |
| **`*time.Timer`** | A one-shot timer. Its `.C` channel fires once. To re-arm you call `Reset(d)` after a careful drain. |
| **`*time.Ticker`** | A repeating timer. Its `.C` channel fires every `d`. Must be stopped with `.Stop()` to release runtime resources. |

---

## Core Concepts

### A batching stage is just a goroutine that owns a slice

Strip away the words "stage" and "accumulator" and what you have is a goroutine that owns a `[]Item` and a `select` statement. Every iteration of the `select` does one of four things:

1. Receive an item from the input channel and append it to the slice.
2. Notice the timer fired and flush.
3. Notice the input channel was closed and flush (one last time) and exit.
4. Notice the context was cancelled and flush and exit.

That is the whole pattern. The rest of this file is about getting every one of those four cases exactly right.

### The size and time triggers do different jobs

The **size trigger** exists to bound *memory*. If items arrive faster than you can flush, you do not want the in-flight slice to grow without limit. Set `maxSize` to whatever the downstream sink accepts in one call — 100 rows for a DB `INSERT`, 1 MB for an S3 multipart part, 1000 events for a Kafka batch.

The **time trigger** exists to bound *latency*. If items arrive slowly — for example one item every five seconds during the night — the size trigger never fires and the first item of the day sits in the buffer until the next item arrives. The time trigger says "after `maxWait`, flush even if the batch is not full." Set it to whatever your latency SLO allows: 10 ms, 100 ms, a second.

A correct batching stage uses *both*. Neither one alone is sufficient.

### The end-of-stream marker is the third trigger

When the pipeline is shutting down, the upstream stage closes its output channel. Your batching stage detects this with `for x, ok := <-in; !ok` (or the `for ... range` form, which exits cleanly on close). At that moment, your in-flight slice may still contain items that have not reached `maxSize` and may not have waited long enough for the time trigger. **Flush them anyway, then exit.** Forgetting this single line — the final flush before `return` — is the most common batching-stage bug in production code. It silently corrupts shutdowns: ninety-nine percent of the data goes through, and one percent (whatever was in the last partial batch) disappears.

### Cancellation is a *separate* end-of-stream condition

A `context.Context` cancellation is not the same as the input channel being closed. The input channel might still have items in it; the producer might not even know yet that anyone wants to stop. When `ctx.Done()` fires, you have a choice:

- **Drain then exit.** Keep reading from `in` until it is closed, flushing as you go. Slower shutdown but no data loss.
- **Flush then exit.** Flush whatever you already have and return immediately. Faster shutdown but items still sitting on `in` are abandoned.

For a junior implementation, the simpler "flush then exit" is fine. We will see both shapes in this file.

### Sync flush vs async flush — start with sync

When the trigger fires, you have to actually do something with the batch. The two options:

- **Sync flush.** Send the batch on the output channel (or call the sink) and wait. Then reset the buffer and continue. Easy to reason about; preserves back-pressure.
- **Async flush.** Spawn a goroutine (or hand off to a worker pool) that does the send, and the accumulator continues immediately. Higher throughput; harder to bound the in-flight count and harder to keep ordering.

**At the junior level always start with sync flush.** It is correct by construction. Only move to async after you have measured a real bottleneck.

---

## Real-World Analogies

- **A delivery driver waiting at a loading dock.** The driver does not leave with one parcel; that would waste a trip. The dock manager has two rules: "leave when the truck is full" (size trigger) and "leave by 5 PM no matter how empty the truck is" (time trigger). At end of day (end-of-stream) whatever is in the truck goes out, full or not.
- **A coffee barista batching pour-overs.** Brewing one cup at a time is slow because the kettle has to come up to temperature each time. The barista waits for a few orders, brews them in one session, and serves them together. If there is one order at 6 AM, the barista does not wait an hour for a second; the time trigger fires and the lone cup goes out.
- **An elevator.** The elevator waits until either it is full (size trigger), or a configured maximum number of seconds has passed (time trigger), or the building is closing (end-of-stream). Same three triggers, same logic.
- **A postal sorting bin.** Letters drop into a bin during the day. Twice a day a mail truck arrives and empties whatever is in the bin (time trigger), unless the bin overflows and a truck is summoned early (size trigger). At end of day all bins are emptied no matter how full (end-of-stream).

---

## Mental Models

### The "in-flight slice plus three triggers" model

Picture the accumulator goroutine as a tiny machine with one state variable — the `[]Item` slice — and one `select` statement. Three events can fire:

```
+----------------------+
|   in-flight slice    |
|   (the "buffer")     |
+----------------------+
        |
        v
    select {
      <-in:        append, maybe size-flush
      <-timer.C:   time-flush
      <-ctx.Done(): final-flush, exit
    }
```

End-of-stream (input channel closed) is not a `select` case in itself; it shows up as `ok==false` on the input-channel receive, which you then handle like a final flush plus exit.

### The "first item starts the clock" model

The time trigger does not fire continuously. It is armed the moment the first item lands in an empty buffer and disarmed when the buffer is flushed. The reason: a continuously firing timer would flush an empty buffer every `maxWait`, doing nothing useful and wasting wakeups.

Concretely: when you receive an item and the buffer was empty, call `timer.Reset(maxWait)`. When you flush, do not reset the timer; let it stay disarmed (or, if it is a `*time.Ticker`, accept that you may get a stale tick and ignore empty-buffer fires).

### The "size trigger is a fast-path of the select" model

Most batching-stage code looks like this inside the receive case:

```go
case x, ok := <-in:
    if !ok {
        flush()  // final flush
        return
    }
    buf = append(buf, x)
    if len(buf) >= maxSize {
        flush()
    }
```

Notice there is no separate `select` case for the size trigger. It is checked inline, right after the append. This is intentional: the size trigger is a *consequence* of receiving an item, so it lives in the receive case.

---

## Pros and Cons

### Pros

- **Massive throughput gains** on any I/O-bound sink: 10x to 100x is common.
- **Lower CPU cost per item** because per-call overhead is amortised.
- **Better cache behaviour** when items in a batch share locality.
- **Smoother downstream behaviour** because spikes get coalesced.
- **Simple to reason about** in the canonical select-loop shape.

### Cons

- **Adds latency** equal to at most `maxWait` to the slowest item.
- **Adds complexity** vs a one-at-a-time stage.
- **Failure modes change** — a single failure can now lose a whole batch.
- **Ordering can be subtle** under async flush.
- **Tuning is required** — bad `maxSize` or `maxWait` gives the worst of both worlds.

---

## Use Cases

- **Database writes.** `INSERT INTO t VALUES (?,?), (?,?), ...` with 100 rows per statement is typically 50x faster than 100 separate `INSERT`s.
- **Log shipping.** Sending log lines to Loki, Elasticsearch, or CloudWatch in batches of a few hundred.
- **Metrics flushing.** StatsD-style flushing of counters every second.
- **Kafka producers.** The standard Sarama and `franz-go` producers batch internally; if you build your own, you do too.
- **HTTP bulk APIs.** Stripe, Segment, Mixpanel, and most analytics APIs accept arrays of events per call.
- **Disk writes.** Appending many records to a file with a single `os.File.Write([]byte)` is faster than many small `Write`s.
- **Vectorised CPU work.** Calling a SIMD-friendly function once on a slice is faster than calling it many times on single items.

---

## Code Examples

### Example 1 — The minimal correct batching stage

This is the shape you should be able to write from memory.

```go
package batching

import (
    "context"
    "time"
)

// Batch returns a goroutine that reads items from in, accumulates them into
// micro-batches of at most maxSize items or maxWait elapsed, and sends each
// batch on out. It flushes the final partial batch on input close or context
// cancellation, then closes out.
func Batch[T any](
    ctx context.Context,
    in <-chan T,
    out chan<- []T,
    maxSize int,
    maxWait time.Duration,
) {
    defer close(out)

    buf := make([]T, 0, maxSize)
    timer := time.NewTimer(maxWait)
    if !timer.Stop() {
        <-timer.C
    }
    // timer is now stopped and drained; it is armed only when the buffer
    // becomes non-empty.

    flush := func() {
        if len(buf) == 0 {
            return
        }
        // Make a copy so the accumulator can reuse buf.
        batch := make([]T, len(buf))
        copy(batch, buf)
        buf = buf[:0]
        // Stop and drain the timer because we have just flushed.
        if !timer.Stop() {
            select {
            case <-timer.C:
            default:
            }
        }
        select {
        case out <- batch:
        case <-ctx.Done():
        }
    }

    for {
        select {
        case x, ok := <-in:
            if !ok {
                flush() // final flush
                return
            }
            if len(buf) == 0 {
                timer.Reset(maxWait)
            }
            buf = append(buf, x)
            if len(buf) >= maxSize {
                flush()
            }
        case <-timer.C:
            flush()
        case <-ctx.Done():
            flush()
            return
        }
    }
}
```

Read this carefully. It has every piece:

- Size trigger inside the receive case.
- Time trigger as a `select` case on `timer.C`.
- End-of-stream handled via `ok==false`.
- Cancellation handled via `ctx.Done()`.
- Timer correctly stopped-and-drained both at start and after flushes.
- `flush()` copies the buffer so the slice we send out is independent of `buf`.
- Output channel closed via `defer` so downstream stages exit cleanly.

### Example 2 — A driver that uses the stage

```go
package main

import (
    "context"
    "fmt"
    "time"

    "example/batching"
)

func main() {
    ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
    defer cancel()

    in := make(chan int)
    out := make(chan []int)

    go batching.Batch(ctx, in, out, 4, 200*time.Millisecond)

    // Producer
    go func() {
        defer close(in)
        for i := 0; i < 10; i++ {
            in <- i
            time.Sleep(70 * time.Millisecond)
        }
    }()

    for batch := range out {
        fmt.Printf("batch: %v\n", batch)
    }
}
```

Run it; you will see batches mostly of three items (because the producer paces at 70 ms and `maxWait` is 200 ms, the size trigger rarely fires; the time trigger does most of the work).

### Example 3 — Forgetting the final flush (broken)

```go
// BUGGY: drops the last partial batch on close.
func BatchBuggy[T any](in <-chan T, out chan<- []T, maxSize int) {
    defer close(out)
    buf := make([]T, 0, maxSize)
    for x := range in {
        buf = append(buf, x)
        if len(buf) >= maxSize {
            out <- buf
            buf = make([]T, 0, maxSize)
        }
    }
    // Bug: when the loop exits because `in` was closed, anything still in
    // buf is silently dropped.
}
```

If 9 items arrive and `maxSize == 4`, the last item is lost. The fix is one line:

```go
if len(buf) > 0 {
    out <- buf
}
```

added after the `for` loop. Forgetting it is the single most common batching bug.

### Example 4 — Why the naive timer reset is wrong

A tempting shortcut for the timer:

```go
// BUGGY in the general case.
case <-timer.C:
    flush()
    timer.Reset(maxWait) // races with a leftover send
```

If you previously called `timer.Stop()` *and* the timer had already fired but its value had not been received, `Stop()` returns `false` and there is a pending value on `timer.C`. If you then `Reset` without draining, the next read of `timer.C` may pop the stale value, firing the trigger immediately. The correct pattern is the stop-and-drain we used in Example 1.

(In Go 1.23+ the rules for `Timer.Reset` were simplified — see specification.md — but the safe pattern still works on all versions and is what we teach.)

### Example 5 — A batching DB writer (sketch)

```go
type DB interface {
    InsertMany(ctx context.Context, rows []Row) error
}

func RunBatchingWriter(ctx context.Context, db DB, in <-chan Row) error {
    batches := make(chan []Row)
    go Batch(ctx, in, batches, 200, 50*time.Millisecond)
    for batch := range batches {
        if err := db.InsertMany(ctx, batch); err != nil {
            return err
        }
    }
    return nil
}
```

This is the production shape. The `Batch` goroutine does pure accumulation; the consumer loop does the actual sink call. The two are decoupled, easy to test, and easy to reason about.

---

## Coding Patterns

### Pattern A — The triple-trigger select-loop

You have already seen it in Example 1. It is the canonical batching-stage pattern in Go. Memorise the shape:

```go
for {
    select {
    case x, ok := <-in:
        if !ok { flush(); return }
        if len(buf) == 0 { timer.Reset(maxWait) }
        buf = append(buf, x)
        if len(buf) >= maxSize { flush() }
    case <-timer.C:
        flush()
    case <-ctx.Done():
        flush()
        return
    }
}
```

Three cases, three triggers, one `flush()` helper.

### Pattern B — Buffer reuse via `s = s[:0]`

After flushing, do not allocate a fresh slice. Reuse the underlying array by slicing back to length zero:

```go
buf = buf[:0]
```

This avoids per-flush allocations, which can dominate CPU in high-throughput batching. The downside is that the batch you send out *aliases* the same underlying array — that is why Example 1 copies into a fresh slice before sending. If your downstream consumer reads and discards the batch synchronously you can sometimes skip the copy, but the copy is cheap and the correctness gain is large; at the junior level always copy.

### Pattern C — The `flush()` closure

Hoist the flush logic into a closure inside the function. It captures `buf`, `out`, `ctx`, and `timer`, and you can call it from three places: the size-trigger fast-path, the time-trigger case, and the cancellation/end-of-stream cases. One copy of the logic, one place to fix bugs.

### Pattern D — Bounded output channel

Make the output channel bounded:

```go
out := make(chan []T, 4)
```

A small buffer (1–8) lets the accumulator make progress on the next batch while the downstream consumer is still processing the previous one, without unbounded memory growth. Capacity 0 (unbuffered) forces strict lock-step; capacity huge can hide consumer problems. Start with 4 and tune.

### Pattern E — Generic over the item type

Go 1.18+ generics make `Batch[T any]` natural. If your codebase supports it, prefer the generic version to avoid duplicating the same loop for every concrete type.

---

## Clean Code

- **One responsibility per goroutine.** The accumulator goroutine accumulates and decides when to flush. It does not write to the database, does not call HTTP, does not log to a remote sink. Those happen in the next stage. This keeps testing tractable: you can test the batching logic with a fake `out chan []T` and no I/O.
- **Name the function `BatchByCount`, `BatchBySize`, `BatchByTime`, or `Batch`** depending on what it does. "Batch" alone is fine for the canonical size/time/cancellation triple.
- **Inputs go in the constructor; nothing is global.** Resist the temptation to read `maxSize` from a package-level variable. Pass it.
- **Document the contract.** A one-paragraph godoc on `Batch` should answer: how big can a batch be? How long can the oldest item wait? What happens on cancellation? What happens on input close? Does it close the output channel?
- **Close-once invariant.** The accumulator owns `out` and is the only goroutine that closes it. Document this and never close `out` from anywhere else.

---

## Product Use

A batching stage rarely appears in isolation; it sits in the middle of a real pipeline that does something users see. Some sketches:

- **API ingest service.** HTTP handler decodes events, writes them to a channel `events`, a `Batch` stage groups them into micro-batches of 500 events or 100 ms, and a writer stage sends each batch to ClickHouse. Users do not see batching directly, but the system scales to 10x more events per dollar than the one-at-a-time version.
- **Background email sender.** Application code enqueues emails on a channel; a `Batch` stage groups them by 50 emails or 5 seconds; the next stage calls the SES `SendBulkEmail` API. Latency goes from 50 ms per email to 50 ms per 50 emails — a 50x improvement.
- **Audit log writer.** Hot-path code writes audit events to a channel; a batching stage flushes them to S3 in JSON-lines blocks of 1 MB or 10 seconds; the next stage uploads each block. Hot-path is decoupled from S3 latency.
- **Metrics aggregator.** Counters increment in goroutines; a batching stage flushes them to InfluxDB every second. Without batching, each increment would be a network round trip — unworkable at scale.

In all four cases the user-visible feature is something else (event ingest, email send, audit log, metrics dashboard). Batching is the invisible engine that makes the feature affordable.

---

## Error Handling

At the junior level, the batching stage itself rarely produces errors. It is just a goroutine that moves items between channels. Errors typically arise in two places:

1. **Downstream sink errors.** The consumer of `out` calls the database or the HTTP API. If that fails, the consumer must decide: retry the whole batch? Split and retry per-item? Drop and log? At the junior level, start with "retry the whole batch on transient error; log and drop on permanent error." Middle.md and senior.md teach more nuance.
2. **Cancellation as a "not an error."** When `ctx.Done()` fires, the batching stage exits. This is not an error; it is the normal shutdown path. Do not return `ctx.Err()` from `Batch` itself — the function's job is to flush and exit, not to report cancellation.

Keep the batching stage error-free; let errors live where the I/O lives.

---

## Security Considerations

- **Buffer growth as a DoS vector.** If `maxSize` is not enforced, a flood of items can grow your in-flight slice into the gigabytes. Always set a hard `maxSize`. Channels are also bounded by their capacity; do not use unbounded ones in production.
- **Sensitive-data lifetime.** A batched item sits in memory longer than a non-batched one (up to `maxWait`). If items carry tokens, PII, or secrets, your "data in memory" window grows. Audit `maxWait` against your retention policy. For high-sensitivity items, shorten `maxWait` or do not batch.
- **Log accidents.** A common bug: log the whole batch on error. If the batch contains 100 events with PII you have just leaked 100 records to your log pipeline. Log a count, not the contents.
- **Time-of-check vs time-of-use.** Auth checks performed on enqueue (e.g. "this user can write this row") are now stale by up to `maxWait` when the batch flushes. If permissions can revoke mid-batch, re-check at flush or shorten `maxWait`.

---

## Performance Tips

- **Pre-allocate the buffer with `make([]T, 0, maxSize)`** so `append` does not grow.
- **Reuse the buffer** with `buf = buf[:0]` after flush.
- **Use a bounded output channel** of capacity 1–8 to overlap accumulate and consume.
- **Avoid per-flush goroutines** at the junior level — `go flush(batch)` is a tempting one-liner but creates spawn-cost and ordering hazards. Stick to sync flush.
- **Avoid `time.Sleep` for waiting** — always use `select` with `timer.C`. Sleep cannot be interrupted by cancellation.
- **Stop tickers / timers** in `defer` so they release their runtime entries.

---

## Best Practices

1. **Always implement all three triggers** — size, time, end-of-stream — in every batching stage. No exceptions.
2. **Make the final flush impossible to forget** by putting it inside the `flush()` closure and calling it explicitly in every exit path.
3. **Close the output channel from exactly one place** — the `defer close(out)` at the top of the function.
4. **Copy the buffer before sending** if you intend to reuse it, or document that the consumer must consume it synchronously.
5. **Pass `context.Context` as the first parameter** and respect cancellation in every send.
6. **Use generics** (`Batch[T any]`) if your codebase supports it.
7. **Write a `TestBatch_FinalFlush` unit test** — this is the test that catches the most common bug.
8. **Tune `maxSize` and `maxWait` against a real workload**, not guesses.

---

## Edge Cases and Pitfalls

### Pitfall 1 — Forgotten final flush

The all-time most common bug. Symptom: a small percentage of items disappears on shutdown. Cause: code returns from the loop on input close without flushing. Fix: a final `flush()` call before `return` in every exit path. We will see this again in find-bug.md.

### Pitfall 2 — Leaked timer

Symptom: `runtime.NumGoroutine()` grows over time, or `pprof` shows many `time.Timer` finalisers. Cause: a `*time.Timer` or `*time.Ticker` created but never stopped. Fix: `defer timer.Stop()` or, for tickers, an explicit `Stop` in every exit path.

### Pitfall 3 — Captured slice header

Symptom: downstream sees corrupted batches whose contents change after dispatch. Cause: sending `buf` directly out the channel and then continuing to `append` to it. The `append` may or may not reallocate; if it does not, the downstream sees the next batch's items. Fix: copy into a fresh slice before send, or hand off ownership and reallocate `buf`.

### Pitfall 4 — Deadlock on output send

Symptom: pipeline hangs at shutdown. Cause: the accumulator tries `out <- batch` after the consumer has stopped reading (perhaps because of cancellation propagating downstream first). Fix: select on both `out <- batch` and `ctx.Done()` so the send is cancellable.

### Pitfall 5 — Timer reset race

Symptom: occasional immediate flushes of nearly empty buffers. Cause: `timer.Reset` called without draining a pending value on `timer.C`. Fix: stop-then-drain pattern (shown in Example 1).

### Pitfall 6 — Size trigger checked before append

Symptom: batches are off-by-one in size. Cause: `if len(buf) >= maxSize { flush() }` called *before* the `append`, so a batch always flushes at `maxSize-1`. Fix: append first, then check size.

### Pitfall 7 — Empty-batch send

Symptom: downstream consumer receives `[]T{}` and crashes (or does work for no items). Cause: time trigger fires while the buffer is empty. Fix: in `flush()`, return early if `len(buf) == 0`. Example 1 already does this.

### Pitfall 8 — Output channel double-close

Symptom: panic "send on closed channel" or "close of closed channel." Cause: more than one goroutine attempts to close `out`. Fix: own `out` from exactly one goroutine and use `defer close(out)` there.

---

## Common Mistakes

- Spawning `go flush(batch)` for every batch "to make it faster" without bounding the number of in-flight flushers.
- Using `time.Tick(maxWait)` (the package-level helper) which cannot be stopped and leaks a goroutine forever.
- Writing the trigger check `if time.Since(start) >= maxWait` inside the loop body instead of using a `select` case — busy-loops the CPU.
- Forgetting that `for x := range ch` exits naturally on close — re-implementing the close detection by hand and getting it wrong.
- Sending the buffer slice directly and reusing it after — see pitfall 3.
- Using a global `var batch []T` across multiple accumulators — concurrent append, data race.

---

## Common Misconceptions

- **"Batching always reduces latency."** No. Batching adds up to `maxWait` of latency to the slowest item. It increases *throughput*. Use it because you care about throughput.
- **"Bigger batches are always better."** No. Past the downstream sink's optimal batch size, throughput plateaus or drops (because per-batch failure cost rises, and downstream buffers fill up).
- **"You can flush asynchronously without thinking about it."** No. Async flush requires explicit bounding (how many flushes in flight?) and explicit ordering policy.
- **"A `time.Ticker` is fine for the time trigger."** Usually no. A ticker fires every `maxWait` even when the buffer is empty, wasting wakeups. A `*time.Timer` armed on the first-item-into-empty-buffer transition is more efficient.
- **"Closing the input channel from the producer is enough."** It is necessary but not sufficient. The batching stage still has to detect the close and flush the partial batch.

---

## Tricky Points

- **`time.NewTimer(d)` is armed immediately.** If you create one at the top of your function before any items arrive, it will fire at `d` even though the buffer is empty. The Example-1 pattern stops and drains it on creation, then resets only when the first item lands.
- **A `select` with multiple ready cases chooses pseudo-randomly.** If both `<-in` and `<-timer.C` are ready, Go picks one at random. This is fine for our pattern but means you cannot rely on "the timer always wins on tie."
- **`for x := range ch` does *not* receive the close.** It exits the loop on close; if you need a final flush, write it *after* the `for ... range`, or use the longer `for { select { ... } }` form.
- **The closed `ctx.Done()` channel is always ready.** Once cancelled it returns immediately every time. Treat it as a one-way edge.
- **You cannot "uncancel" a context.** Once `ctx.Done()` fires, the batching stage's job is to flush and exit.

---

## Test

A minimal unit test that catches the final-flush bug:

```go
package batching

import (
    "context"
    "testing"
    "time"
)

func TestBatch_FlushesPartialOnInputClose(t *testing.T) {
    in := make(chan int)
    out := make(chan []int, 4)
    ctx := context.Background()
    go Batch(ctx, in, out, 10, time.Second)

    in <- 1
    in <- 2
    in <- 3
    close(in)

    select {
    case batch := <-out:
        if len(batch) != 3 {
            t.Fatalf("want batch of 3, got %d", len(batch))
        }
    case <-time.After(2 * time.Second):
        t.Fatal("batching stage did not flush partial batch on input close")
    }

    if _, ok := <-out; ok {
        t.Fatal("expected out to be closed after input close")
    }
}
```

If your `Batch` implementation forgets the final flush, this test fails immediately.

---

## Tricky Questions

1. *Why do we copy the buffer before sending it on `out`?* Because `buf` is reused across flushes. Without the copy the consumer sees a buffer whose contents change as the next batch is appended.
2. *Why is the time trigger armed only when the first item lands?* To avoid empty-batch flushes when the input is idle.
3. *What is the right `maxWait` value?* Whatever your latency SLO allows minus a small safety margin. If the SLO is "p99 latency < 100 ms," `maxWait = 50ms` is a reasonable start.
4. *What is the right `maxSize` value?* Whatever the downstream sink processes in one call most efficiently. Measure: try 10, 100, 1000, 10000 and plot throughput.
5. *What happens if `maxSize` is 1?* You have re-invented a one-at-a-time pipeline with a timer-fire overhead. Do not do this.
6. *What happens if `maxWait` is zero?* The time trigger fires immediately, so the size trigger never has a chance to accumulate. You get an even-worse one-at-a-time pipeline.
7. *Why not use `time.After` instead of `time.NewTimer`?* `time.After` allocates a new timer each call and cannot be stopped, leaking goroutines under load. Use `NewTimer` and `Reset`.
8. *Can two batching stages share a buffer pool?* Yes, with `sync.Pool`. Senior.md covers this.

---

## Cheat Sheet

```text
Triple trigger:    size, time, end-of-stream (and cancellation as a separate exit)
Default shape:     for { select { <-in, <-timer.C, <-ctx.Done() } }
Final flush:       always, in every exit path
Buffer:            make([]T, 0, maxSize); reuse with buf = buf[:0]
Copy on send:      always at junior level
Timer:             *time.Timer with stop-and-drain reset; arm on first item, disarm on flush
Output:            bounded chan []T, capacity 1-8; close from accumulator only
Cancellation:      respect on every send; flush partial; return
maxSize:           tune to downstream optimal call size (often 100-1000)
maxWait:           tune to SLO minus margin (often 10-200 ms)
```

---

## Self-Assessment Checklist

- [ ] I can write the triple-trigger accumulator from memory in five minutes.
- [ ] I know why the final flush is mandatory and I have a unit test that asserts it.
- [ ] I can explain the timer stop-and-drain pattern and why naive `Reset` is wrong.
- [ ] I copy the buffer before sending it (or I can articulate why I do not).
- [ ] I close the output channel from exactly one place via `defer`.
- [ ] I select on `ctx.Done()` for every output send, not just the input receive.
- [ ] I understand that batching trades latency for throughput.
- [ ] I have a `maxSize` and `maxWait` chosen against a measured workload.

---

## Summary

A batching stage is a goroutine that owns an in-flight slice, accumulates items from an input channel, and flushes the slice when one of three triggers fires: size reached, time elapsed, or end-of-stream / cancellation. The canonical shape is a `for { select { ... } }` with three cases, a small `flush()` closure, a `*time.Timer` armed only when the buffer transitions from empty, and a `defer close(out)` to terminate downstream cleanly. The single most common bug is forgetting the final flush on input close; the second most common is leaking timers. Write the version in Example 1 from memory until it is automatic.

---

## What You Can Build

- A batching DB writer that scales 50x by amortising round trips.
- A log shipper that batches lines to a remote service.
- A metrics flusher.
- An audit-log compactor.
- The middle of any real-world pipeline whose sink is a network call.

---

## Further Reading

- Go pipeline patterns blog post: `https://go.dev/blog/pipelines` (still the canonical introduction).
- `pkg.go.dev/context` — cancellation contract.
- `pkg.go.dev/time` — `Timer`, `Ticker`, `Reset` semantics.
- The folder 02 (cancellation propagation) page in this track.
- The folder 01 (error propagation) page for how errors travel across batching stages.

---

## Related Topics

- **Cancellation propagation** (folder 02) — the contract your accumulator must honour on `ctx.Done()`.
- **Error propagation** (folder 01) — how a downstream sink error travels back upstream when a batch fails.
- **Fan-in / fan-out within pipeline** (folder 05) — batching often sits between a fan-out producer and a fan-in consumer.
- **Anti-patterns** (folder 15 in the wider concurrency track) — the unbounded-async-flush anti-pattern lives there.

---

## Diagrams and Visual Aids

### Triple-trigger state machine

```text
              +-------------------+
              |  buffer = empty   |
              +---------+---------+
                        |
                  item arrives
                        |
                        v
              +-------------------+
              | buffer = partial  |<------+
              |   timer armed     |       |
              +---------+---------+       |
                        |                 |
        +---------------+---------------+ |
        |               |               | |
   item arrives    timer fires    ctx.Done() or
   (size hit)      (time hit)     in closed
        |               |               | |
        v               v               v |
              +-------------------+       |
              |     flush()       |-------+ (back to empty)
              +---------+---------+
                        |
                        v
                 (continue or return)
```

### Trigger overlap diagram

```text
items arriving --->|---|---|---|---|---|---|---|--->
                    \                 /
                     `---  buffer  ---`
                            |
                  +---------+---------+
                  | flush if size hit |
                  | flush if time hit |
                  | flush if EOS hit  |
                  +---------+---------+
                            |
                            v
                        batch out
```

### Sync vs async flush

```text
SYNC FLUSH                          ASYNC FLUSH
+-----+   +--------+               +-----+   +--------+      +--------+
| acc | ->| sink   |               | acc | ->| flusher| ---> | sink   |
+-----+   +--------+               +-----+   +--------+      +--------+
   block on send                     non-blocking dispatch
   back-pressure free                requires explicit bound
   trivial ordering                  ordering needs work
```

That is the complete junior-level picture so far. Below are six extended walkthroughs that solidify the concepts and prepare you for the middle level. Move on to middle.md when you can write Example 1 from memory and explain every line.

---

## Extended Walkthrough A — Building the stage from scratch, line by line

Let us pretend we are starting with nothing and need to write `Batch[T]` from a blank file. We will narrate every decision so the reasoning sticks.

### Step 1 — Signature

```go
func Batch[T any](
    ctx context.Context,
    in <-chan T,
    out chan<- []T,
    maxSize int,
    maxWait time.Duration,
)
```

Choices made:

- `ctx context.Context` first, by Go convention.
- `in <-chan T` is read-only; `out chan<- []T` is write-only. These directions tell the caller (and the compiler) who reads and who writes, and they document the data flow.
- `maxSize int` and `maxWait time.Duration` are tunables.
- No return value — the function is a long-running goroutine body; it terminates by returning, not by reporting status.

We do not pass an error channel here. Errors live in the consumer of `out`, not in `Batch`. If you want errors flowing back, see folder 01.

### Step 2 — Close the output on exit

The first line of the function body is:

```go
defer close(out)
```

Why first? Because the moment we add any other code, there are multiple `return` paths (input close, cancellation). We want every one of them to close `out`. A `defer` at the top guarantees that.

Note the invariant this establishes: *the accumulator goroutine is the sole owner of `out` and the sole closer.* Document this in the godoc.

### Step 3 — Allocate the buffer with capacity

```go
buf := make([]T, 0, maxSize)
```

Length zero (we have nothing yet), capacity `maxSize` (so the first `maxSize` `append` calls do not allocate). This is a free optimisation — capacity costs nothing if we end up using it, and saves an allocation per item if we do.

### Step 4 — Create the timer and disarm it

```go
timer := time.NewTimer(maxWait)
if !timer.Stop() {
    <-timer.C
}
```

This is the moment beginners trip. `time.NewTimer(maxWait)` returns a timer that is *already running*. If we just left it running and started the `select`, it would fire after `maxWait` even though our buffer is empty. So we stop it immediately. `Stop` returns `false` if the timer had already fired (extremely unlikely here, but possible on a heavily loaded machine) — in that case we drain the value out of `.C` so the channel is empty.

After these two lines, `timer` is stopped, `timer.C` is empty, and we can `Reset` it later when the first item arrives.

### Step 5 — Define the `flush` closure

```go
flush := func() {
    if len(buf) == 0 {
        return
    }
    batch := make([]T, len(buf))
    copy(batch, buf)
    buf = buf[:0]
    if !timer.Stop() {
        select {
        case <-timer.C:
        default:
        }
    }
    select {
    case out <- batch:
    case <-ctx.Done():
    }
}
```

Step by step:

1. **Empty check.** Time triggers can fire on an empty buffer (race: timer fired but we already flushed in the receive case). Refuse to send empty batches.
2. **Copy.** Allocate a fresh `batch` slice and copy `buf` into it. Why? Because we are about to `buf = buf[:0]` and then `append` again, which may modify the underlying array. The downstream consumer must see a stable snapshot.
3. **Reset `buf`.** `buf[:0]` keeps the underlying array but resets length. The next `append` reuses the same memory.
4. **Stop and drain the timer.** We just flushed, so the timer is irrelevant. Stop it. If `Stop` returns `false`, the timer had already fired; drain the value (with a non-blocking `select` because there is a tiny window where another goroutine could already have drained it — though in our single-accumulator design, that does not happen, but the non-blocking pattern is defensive).
5. **Send with cancellation.** Use a `select` so the send is interruptible. Without this, a stuck downstream consumer plus a cancelled context would deadlock the accumulator forever.

### Step 6 — The main loop

```go
for {
    select {
    case x, ok := <-in:
        if !ok {
            flush()
            return
        }
        if len(buf) == 0 {
            timer.Reset(maxWait)
        }
        buf = append(buf, x)
        if len(buf) >= maxSize {
            flush()
        }
    case <-timer.C:
        flush()
    case <-ctx.Done():
        flush()
        return
    }
}
```

The structure is:

- Three `select` cases, one per trigger source.
- The receive case handles four sub-things: end-of-stream detection, time-trigger arming (only when buffer transitions from empty), append, size-trigger check.
- The timer case is a one-liner: flush.
- The cancellation case flushes and returns.

We choose to put the size-trigger check *inside* the receive case rather than as a separate `select` case because the size only changes when an item is received. There is no "spontaneous size change" the way there is a spontaneous timer fire. Keeping it inline avoids a redundant `select` case and an extra channel.

### Step 7 — Walk through a scenario

Let `maxSize = 4`, `maxWait = 100ms`. Producer sends 1 item every 30 ms.

- t=0: function starts. buf is empty, timer is stopped.
- t=30: item 1 arrives. buf was empty, so we `timer.Reset(100ms)`. Append. buf is now `[1]`, len 1.
- t=60: item 2 arrives. buf was non-empty, no timer touch. buf is `[1, 2]`.
- t=90: item 3 arrives. buf is `[1, 2, 3]`.
- t=120: item 4 arrives. buf is `[1, 2, 3, 4]`. Size trigger fires: `flush()` is called.
- Inside flush: copy `[1,2,3,4]` into `batch`. buf becomes `[]`. Timer was set to fire at t=130; stop and drain. Send batch on out.
- t=130: timer would have fired, but it was stopped. Channel `timer.C` is empty. No fire.
- t=150: item 5 arrives. buf was empty, `timer.Reset(100ms)` (fires at t=250). buf is `[5]`.
- t=180: item 6 arrives. buf is `[5, 6]`.
- t=210: item 7 arrives. buf is `[5, 6, 7]`.
- t=240: item 8 arrives. buf is `[5, 6, 7, 8]`. Size trigger fires again. Flush. Stop timer. Send.
- t=270: item 9 arrives. buf was empty, `timer.Reset(100ms)`. buf is `[9]`.
- t=300: producer closes `in`. We are blocked in the `select`. The next iteration picks `case x, ok := <-in` with `ok == false`. We call `flush()`. buf was `[9]`, so the final batch `[9]` is sent. We `return`.
- `defer close(out)` fires. Downstream sees `out` closed and exits its consumer loop.

Notice that:

- Items 1–4 flushed via size trigger.
- Items 5–8 flushed via size trigger.
- Item 9 flushed via end-of-stream.

If item 9 had arrived alone with no follow-up and no close, the time trigger would have fired at t=370 and sent the partial batch `[9]`.

### Step 8 — Add a godoc

```go
// Batch reads items from in, accumulates them into micro-batches of at most
// maxSize items or maxWait wall-clock, and sends each batch on out. The
// goroutine flushes its current partial batch and exits on either input-channel
// close or context cancellation. It closes out exactly once, on exit.
//
// The output channel out should be unbuffered or have a small buffer (1-8) to
// preserve back-pressure. Each batch sent on out is a freshly allocated slice
// independent of Batch's internal buffer; the consumer may retain it.
//
// Batch returns no error. Sink-side errors live in the consumer of out.
```

That is the complete junior-level walkthrough. Internalise this and you can write a correct batching stage anywhere.

---

## Extended Walkthrough B — Why the four classic bugs happen

Let us look at each of the four most common junior-level bugs and trace how they appear in code reviews.

### Bug B1 — Forgotten final flush

```go
for x := range in {
    buf = append(buf, x)
    if len(buf) >= maxSize {
        out <- buf
        buf = buf[:0]
    }
}
// Bug: nothing here.
```

The `for ... range` loop exits cleanly when `in` is closed. At that moment `buf` may contain 1 to `maxSize-1` items. Without a flush after the loop, those items are lost.

Why is this so common? Three reasons:

1. The bug is silent. The program does not panic, does not log, does not error. It just drops a small number of items.
2. The bug only manifests on shutdown. Most tests do not exercise shutdown — they test "send 1000 items, see 1000 items," not "send 1003 items, see 1003 items." (Hint: write the 1003 test.)
3. The code looks complete. The `for ... range` form is so idiomatic that a reviewer reads it as obviously correct.

Fix in the inline pattern:

```go
for x := range in {
    buf = append(buf, x)
    if len(buf) >= maxSize {
        out <- buf
        buf = buf[:0]
    }
}
if len(buf) > 0 {
    out <- buf
}
```

Fix in the `select` pattern is to handle `ok == false` explicitly:

```go
case x, ok := <-in:
    if !ok { flush(); return }
    ...
```

### Bug B2 — Leaked timer

```go
for {
    select {
    case x := <-in:
        buf = append(buf, x)
    case <-time.After(maxWait):  // BUG: allocates a new timer each iteration
        flush()
    }
}
```

Every iteration of the loop, the `select` evaluates `time.After(maxWait)` afresh. That creates a brand-new `*time.Timer`. The previous timer becomes garbage but cannot be stopped — `time.After` does not return the timer, just its channel. Under load this leaks thousands of timers per second. The runtime collects them eventually via finalisers, but until then they consume scheduler attention.

Fix: use `time.NewTimer` once and `Reset` it. Or use a `*time.Ticker` and accept the empty-batch flushes (with a guard inside `flush`).

### Bug B3 — Captured slice header

```go
// BUG: sends the live buffer.
flush := func() {
    out <- buf  // sends the slice header pointing at the same array
    buf = buf[:0]
}
```

`out <- buf` sends the slice header. The consumer's slice points at the same underlying array that `buf` does. When the next `append` runs, *if* it does not reallocate (which happens whenever the new length fits in the existing capacity), the consumer's slice now contains the new items.

This is one of the most insidious Go bugs because:

- It works in tests with small workloads (append reallocates and the bug hides).
- It fails in production with large workloads (the cap is preallocated, append never reallocates, bug surfaces).
- The symptom is "data corruption," which can take a long time to diagnose.

Fix: copy the buffer into a fresh slice before sending. The version in Example 1 does this.

### Bug B4 — Output send deadlock on cancellation

```go
flush := func() {
    out <- batch  // BUG: blocks forever if downstream is gone
}
```

If the downstream consumer of `out` exited (perhaps because cancellation already propagated to it), the send blocks forever. The accumulator is now leaked.

Fix: make the send selectable on `ctx.Done()`:

```go
select {
case out <- batch:
case <-ctx.Done():
}
```

After this, when the context is cancelled the send returns immediately, `flush` returns, and the next iteration of the main loop picks the `ctx.Done()` case and returns. The accumulator exits cleanly.

---

## Extended Walkthrough C — Comparing five wrong-but-tempting designs

For learning purposes, here are five designs that look fine on first reading and turn out to be wrong. We compare them against the canonical Example 1.

### Wrong design 1 — Polling

```go
for {
    item, ok := <-in
    if !ok { break }
    buf = append(buf, item)
    if len(buf) >= maxSize || time.Since(start) >= maxWait {
        flush()
    }
}
```

What is wrong? The time check `time.Since(start) >= maxWait` only runs when an item arrives. If items stop arriving, the time trigger never fires. The buffer can sit half-full indefinitely. Latency goes unbounded.

Fix: use `select` with `timer.C`.

### Wrong design 2 — Sleep loop

```go
for {
    time.Sleep(maxWait)
    flush()
}
```

What is wrong? Nothing about input. There is no `select`; items are received elsewhere or — more commonly in the bug — added to a shared `buf` from another goroutine, requiring a mutex. The whole shape is wrong: you cannot interrupt `time.Sleep` for cancellation, and the buffer mutation needs locking.

Fix: stay inside a single goroutine and use `select`.

### Wrong design 3 — One goroutine per batch

```go
for {
    batch := collectN(in, maxSize)
    go flushOne(batch)
}
```

What is wrong? Several things at once:

- Unbounded goroutine spawn — each batch starts a new flusher.
- Ordering is not preserved — flushers race.
- Errors from `flushOne` cannot be reported back.
- `collectN` either blocks forever waiting for `maxSize` items (no time trigger) or polls (CPU burn).

This is the unbounded async-flush anti-pattern. Senior.md covers bounded async flush done correctly.

### Wrong design 4 — Mutex-protected shared slice

```go
var mu sync.Mutex
var buf []T

go func() {
    for x := range in {
        mu.Lock(); buf = append(buf, x); mu.Unlock()
    }
}()

go func() {
    for {
        time.Sleep(maxWait)
        mu.Lock(); batch := buf; buf = nil; mu.Unlock()
        out <- batch
    }
}()
```

What is wrong? Two goroutines, shared mutable state, mutex, all to do what one goroutine plus a `select` does. The shape is harder to reason about, harder to test, and the second goroutine never exits — it loops forever. The accumulator goroutine also has no end-of-stream handling: when `in` closes, the receiver exits but the flusher keeps going on a stale empty buffer.

Fix: one goroutine, one `select`, no mutex.

### Wrong design 5 — Ticker without empty-buffer guard

```go
t := time.NewTicker(maxWait)
defer t.Stop()
for {
    select {
    case x, ok := <-in:
        if !ok { flush(); return }
        buf = append(buf, x)
        if len(buf) >= maxSize { flush() }
    case <-t.C:
        flush()  // BUG: sends empty batches when buffer is idle
    case <-ctx.Done():
        flush(); return
    }
}
```

What is wrong? The ticker fires every `maxWait` whether or not items have arrived. If the buffer is empty when the tick fires, `flush()` sends an empty batch downstream. Consumers may or may not handle empty batches gracefully.

Fix: in `flush()`, return early when the buffer is empty. Example 1 does exactly this.

---

## Extended Walkthrough D — A complete runnable program

Let us put it all together in a runnable file that you can save and execute. This file demonstrates a batching stage between a synthetic producer and a printing consumer, with cancellation after 3 seconds.

```go
package main

import (
    "context"
    "fmt"
    "math/rand"
    "time"
)

func Batch[T any](
    ctx context.Context,
    in <-chan T,
    out chan<- []T,
    maxSize int,
    maxWait time.Duration,
) {
    defer close(out)

    buf := make([]T, 0, maxSize)
    timer := time.NewTimer(maxWait)
    if !timer.Stop() {
        <-timer.C
    }

    flush := func() {
        if len(buf) == 0 {
            return
        }
        batch := make([]T, len(buf))
        copy(batch, buf)
        buf = buf[:0]
        if !timer.Stop() {
            select {
            case <-timer.C:
            default:
            }
        }
        select {
        case out <- batch:
        case <-ctx.Done():
        }
    }

    for {
        select {
        case x, ok := <-in:
            if !ok {
                flush()
                return
            }
            if len(buf) == 0 {
                timer.Reset(maxWait)
            }
            buf = append(buf, x)
            if len(buf) >= maxSize {
                flush()
            }
        case <-timer.C:
            flush()
        case <-ctx.Done():
            flush()
            return
        }
    }
}

func producer(ctx context.Context, out chan<- int) {
    defer close(out)
    i := 0
    for {
        select {
        case <-ctx.Done():
            return
        case <-time.After(time.Duration(rand.Intn(50)+10) * time.Millisecond):
            select {
            case out <- i:
                i++
            case <-ctx.Done():
                return
            }
        }
    }
}

func main() {
    ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
    defer cancel()

    in := make(chan int)
    out := make(chan []int, 2)

    go producer(ctx, in)
    go Batch(ctx, in, out, 5, 100*time.Millisecond)

    total := 0
    for batch := range out {
        total += len(batch)
        fmt.Printf("batch of %d: %v\n", len(batch), batch)
    }
    fmt.Printf("done, %d items processed\n", total)
}
```

Save as `main.go`, run with `go run main.go`. You will see something like:

```
batch of 5: [0 1 2 3 4]
batch of 5: [5 6 7 8 9]
batch of 3: [10 11 12]
batch of 5: [13 14 15 16 17]
batch of 5: [18 19 20 21 22]
batch of 5: [23 24 25 26 27]
...
batch of 4: [88 89 90 91]
done, 92 items processed
```

The mix of size-5 batches and shorter batches depends on the random inter-arrival times. Look for the last short batch — that is the final-flush working correctly. Without the final flush, the program would print "done, 88 items processed" instead.

### Variations to try

- Change `maxSize` to 1 and observe that batching disappears.
- Change `maxWait` to 1 second and see fewer but larger batches.
- Change the producer to produce in bursts (10 items at once, then sleep 200 ms) — see how the size trigger catches the bursts.
- Reduce the timeout to 200 ms and see fewer batches before exit, but the last batch is still complete.
- Comment out `flush()` in the `ok==false` branch and observe items disappearing.

---

## Extended Walkthrough E — Testing the stage thoroughly

A batching stage should have at least these unit tests. Below are sketches; fill in the standard `testing.T` boilerplate.

### Test E1 — Size trigger fires

Send `maxSize` items, expect exactly one batch of exactly that size.

```go
func TestBatch_SizeTrigger(t *testing.T) {
    in := make(chan int)
    out := make(chan []int, 4)
    go Batch(context.Background(), in, out, 3, time.Second)

    in <- 1; in <- 2; in <- 3

    select {
    case b := <-out:
        if len(b) != 3 { t.Fatalf("want 3, got %d", len(b)) }
    case <-time.After(time.Second):
        t.Fatal("no batch")
    }
}
```

### Test E2 — Time trigger fires

Send fewer than `maxSize` items, wait for the time trigger.

```go
func TestBatch_TimeTrigger(t *testing.T) {
    in := make(chan int)
    out := make(chan []int, 4)
    go Batch(context.Background(), in, out, 100, 50*time.Millisecond)

    in <- 1; in <- 2

    select {
    case b := <-out:
        if len(b) != 2 { t.Fatalf("want 2, got %d", len(b)) }
    case <-time.After(time.Second):
        t.Fatal("no batch from time trigger")
    }
}
```

### Test E3 — Final flush on input close

The most important test. If this fails, the stage drops data on shutdown.

```go
func TestBatch_FinalFlushOnClose(t *testing.T) {
    in := make(chan int)
    out := make(chan []int, 4)
    go Batch(context.Background(), in, out, 100, time.Second)

    in <- 1; in <- 2; in <- 3
    close(in)

    var got []int
    for b := range out { got = append(got, b...) }
    if len(got) != 3 { t.Fatalf("want 3 items, got %d", len(got)) }
}
```

### Test E4 — Flush on cancellation

```go
func TestBatch_FlushOnCancel(t *testing.T) {
    ctx, cancel := context.WithCancel(context.Background())
    in := make(chan int)
    out := make(chan []int, 4)
    go Batch(ctx, in, out, 100, time.Second)

    in <- 1; in <- 2
    cancel()

    select {
    case b := <-out:
        if len(b) != 2 { t.Fatalf("want 2, got %d", len(b)) }
    case <-time.After(time.Second):
        t.Fatal("no flush on cancel")
    }

    // out should close shortly
    select {
    case _, ok := <-out:
        if ok { t.Fatal("expected out closed") }
    case <-time.After(time.Second):
        t.Fatal("out not closed after cancel")
    }
}
```

### Test E5 — No empty batches

```go
func TestBatch_NoEmptyBatches(t *testing.T) {
    in := make(chan int)
    out := make(chan []int, 4)
    go Batch(context.Background(), in, out, 100, 10*time.Millisecond)

    time.Sleep(50 * time.Millisecond) // let several time triggers fire
    close(in)

    for b := range out {
        if len(b) == 0 { t.Fatal("got empty batch") }
    }
}
```

### Test E6 — No double-close panic

If the stage closes `out` more than once it panics. The race detector + multiple cancellation paths catches this.

```go
func TestBatch_NoDoubleClose(t *testing.T) {
    ctx, cancel := context.WithCancel(context.Background())
    in := make(chan int, 10)
    out := make(chan []int, 4)
    done := make(chan struct{})
    go func() { defer close(done); Batch(ctx, in, out, 5, 10*time.Millisecond) }()

    for i := 0; i < 7; i++ { in <- i }
    cancel()
    close(in)

    <-done
    // If we got here without a panic, the test passes.
}
```

With these six tests in place, a developer modifying `Batch` will discover almost every regression at unit-test time.

---

## Extended Walkthrough F — When *not* to batch

Batching is so tempting that engineers reach for it before measuring. Here are the situations where you should *not* batch.

### F1 — Latency budget smaller than `maxWait`

If your latency SLO is "p99 < 5 ms," you cannot set `maxWait` to anything that makes batching worthwhile. The size trigger alone never fires for low-volume traffic, so the batch falls through after a few items. The latency tax is greater than the throughput gain. Skip batching; use a worker pool instead.

### F2 — Sink is already batched internally

Many client libraries (Kafka producers, several DB drivers, the AWS SDK's `Send` family) already batch internally. Adding another batching layer on top is duplicate work that wastes CPU and adds latency for no gain. Use the library's own batching knobs first.

### F3 — Items must be acknowledged individually

If the protocol acknowledges each item separately (some message-queue consumers, certain webhook endpoints), batching can save the write but you still need per-item bookkeeping for the acks. The bookkeeping often eats the gains. Profile before batching.

### F4 — Failure mode is unacceptable for batched delivery

If a single failure must affect only one item, not 100, you may not be able to batch. Some payment, billing, or audit workflows have this property. There are designs that recover (per-item idempotency keys, split-on-fail logic), but they are more complex than no batching.

### F5 — Throughput is already low enough

If you process 10 items per second and the sink handles 10000 per second per call, batching is irrelevant. Build the simpler version. Add batching when you see real backpressure.

---

## Extended Walkthrough G — Six more idioms to keep in your back pocket

These are small, sharp idioms that you will use over and over in batching code. Memorise them.

### G1 — The "fan-in then batch" pattern

When several producers feed one batching stage, you do not need a goroutine per producer. Use a single shared input channel:

```go
in := make(chan Event, 1024)

for i := 0; i < numProducers; i++ {
    go produce(in)  // each goroutine sends into the shared channel
}

go Batch(ctx, in, out, 200, 50*time.Millisecond)
```

The accumulator does not care how many producers wrote into `in`. It just reads. This is the simplest fan-in: shared bounded channel.

### G2 — The "batch then fan-out" pattern

When you want multiple consumers of batches (perhaps to parallelise the slow sink), keep one accumulator and spawn several consumers reading from the same `out`:

```go
out := make(chan []Event)
go Batch(ctx, in, out, 200, 50*time.Millisecond)

for i := 0; i < numWorkers; i++ {
    go func() {
        for batch := range out {
            sink.Write(batch)
        }
    }()
}
```

All workers read from the same channel. Ordering across batches is lost (each batch goes to whichever worker is free), but per-batch order is preserved.

### G3 — The "size or count, whichever first" pattern

Some sinks have both a row limit and a byte limit (DynamoDB's `BatchWriteItem` is 25 items *or* 16 MB). Implement both triggers:

```go
buf := make([]Item, 0, maxCount)
bufBytes := 0

flush := func() { ... }

for {
    select {
    case x, ok := <-in:
        if !ok { flush(); return }
        if len(buf) == 0 { timer.Reset(maxWait) }
        buf = append(buf, x)
        bufBytes += x.Size()
        if len(buf) >= maxCount || bufBytes >= maxBytes {
            flush()
        }
    ...
    }
}
```

Two size triggers, one time trigger. Same skeleton.

### G4 — The "key-aware" pattern

Sometimes you want batches *per key* (e.g. per tenant, per shard). Use a map of buffers and per-buffer timers — but at the junior level, prefer the simpler "one stage per key" approach with a top-level router:

```go
// Router: send to the right per-key batch stage.
routes := map[Key]chan<- Item{}
for k, ch := range routes {
    go Batch(ctx, ch, perKeyOut[k], 100, 50*time.Millisecond)
}

for item := range in {
    routes[item.Key] <- item
}
```

This trades more goroutines (one per key) for simpler code.

### G5 — The "synchronous test driver" pattern

In tests, prefer driving the stage synchronously rather than with `time.Sleep`. The pattern:

```go
in := make(chan int)
out := make(chan []int)
go Batch(ctx, in, out, 3, time.Hour) // huge maxWait so only size and EOS fire

in <- 1; in <- 2; in <- 3
b := <-out
// assert b
```

With `maxWait` set to an hour, the time trigger never fires, so the only triggers are size and end-of-stream. Tests become deterministic.

### G6 — The "fake clock" pattern

For tests of the time trigger that must remain deterministic, inject a fake clock:

```go
type Clock interface {
    NewTimer(d time.Duration) *Timer
}

type Timer struct {
    C <-chan time.Time
    Stop func() bool
    Reset func(time.Duration)
}
```

Most production codebases use `github.com/benbjohnson/clock` or a similar abstraction. Pass the clock as a parameter and let the test advance it manually. Junior level can skip this — but be aware it exists for middle and senior tier work.

---

## Extended Walkthrough H — Reading the runtime behaviour with `pprof` and `trace`

Once you have a batching stage running, it is useful to look at what the runtime is actually doing. Two tools, applied at junior level:

### H1 — Goroutine count

Run your program with a periodic print of `runtime.NumGoroutine()`. The accumulator goroutine, the producer goroutine, the consumer goroutine — that should be 3-ish, plus a handful of runtime housekeeping. If you see hundreds, something is leaking.

```go
go func() {
    for {
        time.Sleep(time.Second)
        fmt.Printf("goroutines: %d\n", runtime.NumGoroutine())
    }
}()
```

Typical batching-stage bugs that leak goroutines:

- Per-batch async flush without bound.
- `time.After` instead of `time.NewTimer`.
- Forgetting `defer close(out)` (consumers never exit).

### H2 — The execution trace

Add `runtime/trace` to your program, run for a few seconds, and open the trace in `go tool trace`:

```go
import "runtime/trace"

f, _ := os.Create("trace.out")
trace.Start(f)
defer trace.Stop()
// ... run your pipeline ...
```

In the trace UI you can see the batching goroutine alternate between "running" and "waiting on chan." You should see periodic flushes corresponding to your `maxWait`. If you see thousands of brief active periods per second, the time trigger may be misconfigured.

### H3 — Memory profile

```bash
go tool pprof -alloc_space your.binary heap.pprof
```

Look at the top allocators. Common batching bottlenecks:

- Per-flush `make([]T, len(buf))` — the copy in our `flush()`. Replace with `sync.Pool` at senior level.
- Per-item closure boxing if your items are larger than 16 bytes and captured in goroutines.

At junior level you do not need to chase these. Just know how to look.

---

## Extended Walkthrough I — Anatomy of a production batching stage in a real codebase

Below is a slightly redacted real-world batching writer for a metrics service. Read it and identify each piece against what you have learned.

```go
package metricsink

import (
    "context"
    "time"
)

const (
    defaultMaxBatch = 500
    defaultMaxWait  = 100 * time.Millisecond
    defaultBufCap   = 4
)

type Sink interface {
    Send(ctx context.Context, points []Point) error
}

type Stage struct {
    in       <-chan Point
    out      chan<- []Point
    maxSize  int
    maxWait  time.Duration
}

func New(in <-chan Point, out chan<- []Point) *Stage {
    return &Stage{
        in:      in,
        out:     out,
        maxSize: defaultMaxBatch,
        maxWait: defaultMaxWait,
    }
}

func (s *Stage) WithSize(n int) *Stage     { s.maxSize = n; return s }
func (s *Stage) WithWait(d time.Duration) *Stage { s.maxWait = d; return s }

func (s *Stage) Run(ctx context.Context) {
    defer close(s.out.(chan []Point))

    buf := make([]Point, 0, s.maxSize)
    timer := time.NewTimer(s.maxWait)
    if !timer.Stop() {
        <-timer.C
    }

    flush := func() {
        if len(buf) == 0 {
            return
        }
        out := make([]Point, len(buf))
        copy(out, buf)
        buf = buf[:0]
        if !timer.Stop() {
            select {
            case <-timer.C:
            default:
            }
        }
        select {
        case s.out <- out:
        case <-ctx.Done():
        }
    }

    for {
        select {
        case p, ok := <-s.in:
            if !ok {
                flush()
                return
            }
            if len(buf) == 0 {
                timer.Reset(s.maxWait)
            }
            buf = append(buf, p)
            if len(buf) >= s.maxSize {
                flush()
            }
        case <-timer.C:
            flush()
        case <-ctx.Done():
            flush()
            return
        }
    }
}
```

What is the same as Example 1?

- Triple trigger select-loop.
- Empty-buffer guard inside `flush`.
- Copy on send.
- Stop-and-drain after every flush.
- Defer-close of `out` on exit.

What is different?

- The constructor / fluent-builder shape for ergonomics.
- The `Sink` interface (used in tests with a fake).
- Constants for defaults so the system can be tuned via configuration.

This is essentially the canonical junior pattern, dressed for production. There is no fundamental new mechanic.

---

## Extended Walkthrough J — Visualising flush rates over time

A handy mental exercise: imagine the pipeline running for 10 seconds with a producer that emits 100 items per second, `maxSize = 50`, `maxWait = 200 ms`.

- Items per `maxWait` window: `100 items/s × 0.2 s = 20 items`.
- 20 items per 200 ms is less than `maxSize = 50`, so the size trigger never fires.
- The time trigger fires every 200 ms, sending batches of ~20 items.
- Total batches in 10 s: `10 / 0.2 = 50 batches`. Total items: `50 × 20 = 1000 items`.

Now imagine the producer doubles to 200 items per second:

- Items per `maxWait` window: `200 × 0.2 = 40`. Still under 50; time trigger fires; batches of ~40.

Now 300 items per second:

- Items per `maxWait` window: `300 × 0.2 = 60`. Now > 50; size trigger fires at 50 items, which takes `50 / 300 = 0.167 s`. Batches of 50 every 167 ms. Time trigger never gets the chance.

Now bursts of 1000 items every second:

- A burst of 1000 fires the size trigger 20 times in immediate succession (each batch is 50). Then 800 ms of nothing. Then another burst.

Notice how the trigger pair adapts:

- Low rate: time trigger dominates; latency is bounded by `maxWait`.
- Medium rate: size trigger fills early; latency is bounded by `maxSize / rate`.
- Bursty rate: size trigger handles the burst; idle periods have nothing to flush.

This is why both triggers are essential. Neither alone covers the spectrum.

---

## Extended Walkthrough K — How the channel send back-pressures the producer

Sync flush plus a small (or zero) output buffer creates back-pressure all the way to the producer. Here is the chain:

1. Sink is slow. Each `sink.Send(batch)` takes 500 ms.
2. Consumer goroutine reads from `out`, calls sink. Cannot accept the next batch until the previous send returns.
3. `out` is `chan []T, 1`. Once one batch is queued and consumer is busy, the next `out <- batch` from the accumulator blocks.
4. Accumulator is blocked in `flush`. Cannot return to the `select`.
5. `in` is `chan T, 32`. Producer fills it to 32 and then `in <- item` blocks.
6. Producer is now waiting. It in turn does not pull from its source (e.g. HTTP requests, file reads), which slows its source.

The back-pressure has travelled from the sink all the way to the source. The pipeline is *self-regulating* — it processes at the rate the sink can sustain, not faster. No drops, no unbounded memory growth.

Async flush breaks this chain. The accumulator hands batches to a worker pool and returns immediately, so `out <- batch` never blocks. If the worker pool grows unboundedly, you lose back-pressure and run out of memory. If the pool is bounded, back-pressure returns — but only at the boundary of the pool, not at the accumulator's `select`.

Senior.md covers bounded async flush in detail. At junior level, prefer sync flush.

---

## Extended Walkthrough L — Five small refactors that make your stage clearer

Once you have a working stage, you can usually make it nicer with these refactors.

### L1 — Extract `armTimer` and `disarmTimer` helpers

```go
armTimer := func() { timer.Reset(maxWait) }
disarmTimer := func() {
    if !timer.Stop() {
        select {
        case <-timer.C:
        default:
        }
    }
}
```

Now `flush()` reads more declaratively:

```go
flush := func() {
    if len(buf) == 0 { return }
    batch := snapshot(buf)
    buf = buf[:0]
    disarmTimer()
    send(batch)
}
```

### L2 — Extract `snapshot` and `send`

```go
snapshot := func(s []T) []T { c := make([]T, len(s)); copy(c, s); return c }
send := func(b []T) {
    select {
    case out <- b:
    case <-ctx.Done():
    }
}
```

Each helper does exactly one thing.

### L3 — Inline the size check into a `tryFlush`

```go
tryFlush := func() {
    if len(buf) >= maxSize { flush() }
}
```

Then the receive case becomes:

```go
case x, ok := <-in:
    if !ok { flush(); return }
    if len(buf) == 0 { armTimer() }
    buf = append(buf, x)
    tryFlush()
```

Reads almost like English.

### L4 — Use a `for-select` with no naked loop variable

If you find yourself reaching for an outer variable in the `for { select { ... } }`, ask whether that variable belongs as a field on a struct method. Often the answer is yes.

### L5 — Avoid premature generalisation

Resist the urge to add knobs your code does not need yet. A stage with `maxSize`, `maxWait`, and `ctx` is plenty. Adding "jittered ticker," "adaptive size," "circuit breaker" all at once makes the code unteachable. Add them when measurement says you need them.

---

## Final extended notes

Below are a few miscellaneous notes that often come up in beginner code reviews.

- **Naming.** "Batch" is fine for the canonical stage. "Buffer" is misleading because it suggests a `bufio` analogy with no size limit. "Aggregator" works too.
- **Doc comments.** Always include "closes out on exit" in the godoc. Consumers must know.
- **Return type.** A `Batch` function that returns `<-chan []T` instead of taking `out` as a parameter is also fine; it is a matter of style. The `out`-parameter style composes more naturally with other pipeline stages.
- **Generics.** Use them. The pre-generics era required code duplication; we are past that.
- **Logging.** Do not log every batch — that is more lines than items. Log on error and on shutdown. Use a counter metric for batch counts and sizes.
- **Metrics.** Two histograms make the system observable: batch-size distribution and batch-flush-reason distribution (`size`, `time`, `close`, `cancel`).

---

## Extended Walkthrough M — Twelve common questions a code reviewer will ask you

When you submit your first batching stage for review, expect questions in this order. Prepare answers.

### M1 — "What happens if `in` is nil?"

`<-nil chan` blocks forever. The accumulator would never make progress. Decide: panic at the start, or document that `in` must be non-nil. Most production code logs and returns:

```go
if in == nil { return fmt.Errorf("nil input channel") }
```

Some prefer a hard panic to surface the bug fast. Either is defensible.

### M2 — "What happens if `maxSize <= 0`?"

Same answer: validate at the constructor. `maxSize <= 0` makes the size trigger fire on the first item, which defeats the purpose. Pick a sane minimum (1) or reject.

### M3 — "What happens if `maxWait <= 0`?"

The timer fires immediately. The time trigger fires before the size trigger has a chance. Effectively you have a non-batching one-at-a-time stage. Reject in the constructor or document that the caller must provide a positive duration.

### M4 — "Why not `time.Tick`?"

`time.Tick` returns only the channel, not the ticker. You cannot stop it. The runtime keeps it alive forever. For a long-lived program, this is a leak even when it is per-process — and across a fleet of pods restarting on deploys, the cost compounds.

### M5 — "Why not `time.After` in the select?"

Same reasoning. Plus, each iteration of the select allocates a new timer. Heavy load = thousands of timer allocations per second. Use a single `*time.Timer` and `Reset`.

### M6 — "Why does the consumer matter for back-pressure?"

Because the accumulator blocks on `out <- batch`. If the consumer is slow, the accumulator's `select` is parked in the flush. The producer fills `in` to capacity and then itself blocks on `in <- item`. The chain extends.

### M7 — "Why copy the buffer?"

Because the underlying array is reused. Without the copy, downstream sees a slice whose elements change.

### M8 — "Why does the flush respect cancellation on the send?"

Because the downstream consumer may already be gone (cancelled itself). A blind `out <- batch` would deadlock.

### M9 — "What if the consumer panics?"

The accumulator does not catch panics in other goroutines. The consumer goroutine dies. `out` is still open. Subsequent sends block. The pipeline deadlocks. Fix: in the consumer's goroutine, `defer recover()` and either re-raise or stop the pipeline.

### M10 — "Why are batches sent on `out` as `[]T` instead of as individual items?"

Because the downstream stage is by contract a *batch consumer*. If you sent them as individual items, you would have un-batched right after batching — the consumer would have lost the savings.

### M11 — "Why generic?"

So one implementation serves all item types. Pre-generics required code generation or `interface{}` and type assertions; both are worse.

### M12 — "How do I know my `maxSize` is right?"

Measure. Start with a guess based on the sink's documentation, plot throughput vs `maxSize` with a script, pick the knee of the curve. Add a 20% safety margin under the knee so you do not operate at the edge.

---

## Extended Walkthrough N — A glossary deep-dive on each batching-specific term

Let us revisit the glossary and explain each entry at greater depth, with the bug each term prevents.

### Micro-batch

A *micro-batch* is small enough to live entirely in memory (often a few KB to a few MB) and process within one downstream call. It is not the same as a Spark micro-batch (which is much larger and serves a different purpose). In Go pipeline terms, a micro-batch is the unit of work a single sink call takes.

If you call your batches "macro-batches" or "blocks" or "groups," nobody will complain, but "micro-batch" is the standard term for in-memory pipeline batches.

The most common confusion: people think a micro-batch is always a fixed-size group. It is not — it is whatever the trigger produced, which may be any length from 1 to `maxSize`.

### Accumulator

The single goroutine that owns the in-flight slice. The word "accumulator" is meaningful because it carries state (the slice) and accumulates over time. There is exactly one per batching stage. If you find yourself with two accumulator goroutines sharing a buffer, you have introduced a data race; the fix is one accumulator.

### Flush

The verb that combines "emit the batch downstream" and "reset the buffer." Both halves are essential. You cannot flush without resetting (you would re-send the same items next time). You cannot reset without flushing (you would lose them).

### Size trigger

The phrase highlights that *the size* is the cause and *the flush* is the effect. The reverse phrase "flush trigger" is too vague — there are three triggers, all of which cause a flush.

### Time trigger

A common confusion is between two flavors of time trigger:

- "Maximum wait of the *oldest* item." The clock starts when the buffer becomes non-empty.
- "Maximum wait between *successive* flushes." The clock starts immediately and never stops.

The first is more useful (it bounds per-item latency). The second is simpler but wastes wakeups. We use the first.

### End-of-stream marker

The signal that "no more items will ever arrive." In Go, this is *always* the input channel being closed. There is no other convention. If you find yourself inventing a sentinel value (`item.IsLast = true`) to signal end-of-stream, you have re-invented closing the channel — badly. Close the channel.

### Cancellation

A `context.Context` being cancelled. Note this is *different* from end-of-stream. End-of-stream means "I have nothing more to send"; cancellation means "stop now, regardless of what is in the queue."

### Sync flush

Synchronous: the accumulator does the downstream send *itself* and blocks until it succeeds. Easy to reason about. The default.

### Async flush

Asynchronous: the accumulator hands off the batch to another goroutine (or worker pool) for the send, then returns immediately to its select. Faster throughput but you must bound the in-flight pool and decide an ordering policy.

### Back-pressure

The cascade of upstream slowdowns caused by downstream not accepting work. Sync flush + bounded channels = automatic back-pressure all the way to the source. Async flush + unbounded workers = lost back-pressure.

### `*time.Timer`

A one-shot timer. Created with `time.NewTimer(d)`. Fires once at `d`. To re-arm, call `Reset(d)` — but only after correctly stopping and draining the previous value.

### `*time.Ticker`

A repeating timer. Created with `time.NewTicker(d)`. Fires every `d` until you call `Stop()`. Always `defer t.Stop()`. We avoid it for the time trigger because it fires whether or not the buffer is non-empty, but it has its place for periodic *unconditional* tasks (heartbeats, periodic flushes-regardless).

---

## Extended Walkthrough O — A worked example with an HTTP bulk endpoint

This is a slightly more realistic example: a batching stage that fronts an HTTP bulk endpoint accepting JSON arrays.

```go
package httpbatch

import (
    "bytes"
    "context"
    "encoding/json"
    "fmt"
    "io"
    "net/http"
    "time"
)

type Event struct {
    ID   string `json:"id"`
    Body []byte `json:"body"`
}

type Client struct {
    URL  string
    HTTP *http.Client
}

func (c *Client) Send(ctx context.Context, batch []Event) error {
    body, err := json.Marshal(batch)
    if err != nil {
        return fmt.Errorf("marshal: %w", err)
    }
    req, err := http.NewRequestWithContext(ctx, "POST", c.URL, bytes.NewReader(body))
    if err != nil {
        return err
    }
    req.Header.Set("Content-Type", "application/json")
    resp, err := c.HTTP.Do(req)
    if err != nil {
        return err
    }
    defer io.Copy(io.Discard, resp.Body)
    defer resp.Body.Close()
    if resp.StatusCode/100 != 2 {
        return fmt.Errorf("http %d", resp.StatusCode)
    }
    return nil
}

func Run(ctx context.Context, in <-chan Event, c *Client) error {
    batches := make(chan []Event, 4)
    go Batch(ctx, in, batches, 200, 100*time.Millisecond)
    for b := range batches {
        if err := c.Send(ctx, b); err != nil {
            return fmt.Errorf("send: %w", err)
        }
    }
    return nil
}
```

What is interesting:

- `Run` is the orchestrator. `Batch` (from before) is reused.
- The sink-side error handling lives in `Run`, not in `Batch`.
- `Client.Send` takes `ctx` so cancellation propagates through.
- A `defer io.Copy(io.Discard, resp.Body)` ensures the HTTP keep-alive pool can reuse the connection.
- The output channel buffer of 4 lets the accumulator stay one step ahead of the HTTP call.

Try this in a test with `httptest.NewServer` and a slow handler — you will see the accumulator make steady progress while the HTTP calls take their time, until the bound of 4 in-flight is reached and back-pressure kicks in.

---

## Extended Walkthrough P — A worked example with file appending

Files are I/O-bound and benefit enormously from batching writes.

```go
package fileappend

import (
    "bufio"
    "context"
    "encoding/json"
    "fmt"
    "os"
    "time"
)

func RunFileWriter(ctx context.Context, in <-chan []byte, path string) error {
    f, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
    if err != nil {
        return err
    }
    defer f.Close()
    w := bufio.NewWriterSize(f, 64*1024)

    batches := make(chan [][]byte, 2)
    go Batch(ctx, in, batches, 1000, 500*time.Millisecond)

    for b := range batches {
        for _, line := range b {
            if _, err := w.Write(line); err != nil { return err }
            if err := w.WriteByte('\n'); err != nil { return err }
        }
        if err := w.Flush(); err != nil { return err }
        if err := f.Sync(); err != nil { return err }
    }
    return nil
}

func WriteEvents(ctx context.Context, in <-chan map[string]any, path string) error {
    lines := make(chan []byte, 1024)

    go func() {
        defer close(lines)
        for ev := range in {
            b, err := json.Marshal(ev)
            if err != nil { continue }
            select {
            case lines <- b:
            case <-ctx.Done():
                return
            }
        }
    }()

    return RunFileWriter(ctx, lines, path)
}

func main() {
    ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
    defer cancel()
    events := make(chan map[string]any)
    go func() {
        defer close(events)
        for i := 0; i < 100000; i++ {
            events <- map[string]any{"i": i, "ts": time.Now().UnixMilli()}
        }
    }()
    if err := WriteEvents(ctx, events, "out.jsonl"); err != nil {
        fmt.Fprintln(os.Stderr, err)
    }
}
```

Two interesting points:

- The `bufio.NewWriterSize(f, 64*1024)` already gives you write-side batching at the syscall level. But our `Batch` stage is still useful because it groups the `os.File.Write` *calls themselves* into bigger chunks, amortising the `bufio` flush plus `f.Sync` cost.
- `f.Sync()` after each batch flush makes the writes durable. Without it, the kernel may delay the disk write for many seconds. With it, each batch costs one fsync — much cheaper than per-line fsync.

If you remove the batching and call `f.Write + f.Sync` per line, you will see throughput drop by orders of magnitude on a typical HDD or SSD.

---

## Extended Walkthrough Q — A worked example with a `database/sql` writer

For SQL, parameter packing is the win.

```go
package sqlbatch

import (
    "context"
    "database/sql"
    "strings"
    "time"
)

type Row struct {
    Name string
    Age  int
}

func batchInsert(ctx context.Context, db *sql.DB, rows []Row) error {
    if len(rows) == 0 { return nil }
    var b strings.Builder
    b.WriteString("INSERT INTO users (name, age) VALUES ")
    args := make([]any, 0, len(rows)*2)
    for i, r := range rows {
        if i > 0 { b.WriteByte(',') }
        b.WriteString("(?,?)")
        args = append(args, r.Name, r.Age)
    }
    _, err := db.ExecContext(ctx, b.String(), args...)
    return err
}

func RunDBWriter(ctx context.Context, db *sql.DB, in <-chan Row) error {
    batches := make(chan []Row, 2)
    go Batch(ctx, in, batches, 100, 50*time.Millisecond)
    for b := range batches {
        if err := batchInsert(ctx, db, b); err != nil { return err }
    }
    return nil
}
```

Throughput comparison on a typical PostgreSQL setup:

- Per-row INSERT: 500–2000 inserts/second.
- 100-row batched INSERT: 50,000–200,000 inserts/second.

A 100x improvement is common. Some database drivers (PostgreSQL's `pgx` with `Copy`) get even more, but the pattern remains: build the multi-value statement, send once.

The batching stage shape itself is identical to all the other examples. That is the point: write it once, reuse everywhere.

---

## Extended Walkthrough R — Reading list of small habits to build

Below is a checklist of small habits that, once internalised, make your batching code consistently correct. Practise them.

1. **Write the godoc first.** Before any code, write three lines: what it does, when it flushes, what it closes. This forces you to design the contract first.
2. **Write a TestBatch_FinalFlush test on day one.** It catches the most common bug. Run it on every commit.
3. **Always make `out` parameter `chan<- []T`.** The direction annotation prevents accidental misuse.
4. **Always `defer close(out)`.** First line of the function body.
5. **Always copy on send.** Until you have measured the allocation as a real bottleneck and have a `sync.Pool` to replace it.
6. **Always select on `ctx.Done()` for sends.** Never an unprotected `out <- batch`.
7. **Always validate constructor args.** `maxSize > 0`, `maxWait > 0`, `in != nil`. Fail fast.
8. **Always test the time trigger with a tight `maxWait`** (10–50 ms) so the test does not depend on long sleeps.
9. **Never use `time.Tick` in production code.** Period.
10. **Never use `time.After` inside a `select` in a loop.** Period.

If you do all ten reliably, you will not introduce the classic batching bugs again.

---

## Extended Walkthrough S — Detailed mental walkthrough of cancellation timing

This is the trickiest piece of the design. Let us trace what happens when `ctx.Done()` fires.

Setting: `maxSize = 10`, `maxWait = 100ms`, buffer currently holds 3 items, accumulator is parked in `select`.

Step 1. The application calls `cancel()` on the context. Internally, `context` package marks itself "done" and closes the internal `done` channel.

Step 2. The accumulator's `select` wakes up. Multiple cases are now ready, in principle: `<-in` if a producer just sent an item, `<-timer.C` if 100 ms have passed, and `<-ctx.Done()` which just became ready. The `select` picks one at random.

Step 3a. *If the random pick is `ctx.Done()`*: we enter the cancellation case. `flush()` runs. `flush` sends the 3-item batch to `out` — but the consumer of `out` may have already noticed cancellation and exited. So `flush`'s inner `select` picks `<-ctx.Done()` (which is still ready) and the send is skipped. `flush` returns. The outer case returns. `defer close(out)` runs. The accumulator goroutine exits.

Step 3b. *If the random pick is `<-in`* (because an item happened to be on the channel): we receive it, append to the buffer (now 4 items), maybe size-trigger (no, 4 < 10), and loop. The next iteration of `select` again has `ctx.Done()` ready (it stays ready forever) and probably nothing else, so we now pick the cancellation case and flush + exit.

Step 3c. *If the random pick is `<-timer.C`*: we flush. Inside flush, the send is selectable on `ctx.Done()`, so it skips. We loop back. Next iteration picks `ctx.Done()`. We flush again (now empty, early-return). Exit.

So no matter the random ordering, the function exits in at most a few iterations after cancellation. No leak. No deadlock. No data loss for items already in the buffer (they may be skipped if the send finds the consumer gone, but they were on best-effort terms from the moment cancel was called).

Note that "skipped if consumer is gone" is the correct behavior under cancellation. The contract of `cancel()` is "stop, do not block on side effects." If your application requires that *every* item gets through even under cancellation, your design must drain the input instead of cancelling — and that is a different contract.

---

## Extended Walkthrough T — Looking ahead to the middle level

What we have not done at junior level:

- **Per-key batching.** The middle.md teaches map-of-buffers patterns for tenant-aware or shard-aware accumulators.
- **Async flush.** We have insisted on sync. Middle introduces bounded async with a worker pool.
- **Partial failure.** Senior covers per-item vs whole-batch retry on a sink error.
- **Adaptive sizing.** Professional covers the algorithm that grows or shrinks `maxSize` based on downstream latency.
- **Allocation-free reuse.** Senior introduces `sync.Pool` for the batch slices.
- **Jittered timers.** Professional covers per-instance jitter to avoid herd flushes across a fleet.

If you reached this far and the canonical pattern feels comfortable, you are ready for middle.md.

---

## A final practice exercise

Without looking back at any code in this file, sit down with a blank editor and write:

1. A `func Batch[T any](ctx context.Context, in <-chan T, out chan<- []T, maxSize int, maxWait time.Duration)` that implements all three triggers.
2. A `TestBatch_FlushesPartialOnInputClose` unit test.
3. A `main` that wires a synthetic producer to the batching stage to a printing consumer and exits after 2 seconds.

If you can do all three from memory in 20 minutes without consulting this file, you are done with junior.md and should move on. If not, repeat the walkthroughs until you can.

---

## Extended Walkthrough U — Twenty mini-quizzes to verify understanding

Each of these has a correct one-line answer. Try to answer before peeking at the next paragraph.

### U1
*What is the first line inside `func Batch`?*

`defer close(out)`. Owning the close from the accumulator is the invariant; the defer makes every exit path safe.

### U2
*What is the second line inside `func Batch`?*

`buf := make([]T, 0, maxSize)`. Pre-allocate capacity.

### U3
*What is the third pair of lines?*

```
timer := time.NewTimer(maxWait)
if !timer.Stop() { <-timer.C }
```

Create and disarm the timer.

### U4
*Inside the receive case, what is the very first check?*

`if !ok { flush(); return }`. End-of-stream handling.

### U5
*Inside the receive case after the not-ok check, what is the next check?*

`if len(buf) == 0 { timer.Reset(maxWait) }`. Arm the timer only on the empty-to-non-empty transition.

### U6
*Why not arm the timer on every receive?*

Because that would extend the deadline of the oldest item every time a new item arrives, allowing latency to grow unboundedly under steady traffic.

### U7
*Why does `flush()` early-return when the buffer is empty?*

To avoid sending empty batches when the time trigger fires during an idle period.

### U8
*Why does `flush()` copy the buffer?*

Because the underlying array is reused by subsequent appends; without the copy, downstream sees corrupted data.

### U9
*Why does the send inside `flush()` use a `select` on `ctx.Done()`?*

Because the downstream consumer may have exited already; the send could otherwise deadlock.

### U10
*Why not use `time.Tick`?*

It allocates a non-stoppable timer that leaks forever in long-running programs.

### U11
*Why not use `time.After` inside the `select`?*

Because every iteration of the `select` would allocate a fresh `*time.Timer`, leaking timers under load.

### U12
*Why is the size trigger checked inside the receive case rather than as a separate `select` case?*

Because the size can only change when an item is received; a separate case would be redundant.

### U13
*Why must the input channel be closed by the producer?*

Because the close is the end-of-stream marker. The batching stage detects it via `ok == false`.

### U14
*What is the difference between input close and context cancel?*

Input close: "no more items are coming, but process what is in the buffer." Context cancel: "stop now."

### U15
*If `maxSize` is 1, what is the throughput vs a non-batching stage?*

Worse: you pay the select/timer overhead per item with no amortisation.

### U16
*If `maxWait` is zero, what happens?*

The time trigger fires immediately; each item flushes by itself; you have a non-batching stage.

### U17
*If the output channel has capacity 0 (unbuffered), what is the effect?*

Strictest possible back-pressure: the accumulator cannot start a new batch until the consumer accepts the previous one.

### U18
*Why might you want output capacity > 0?*

To let the accumulator make progress on the next batch while the consumer processes the previous one. A small buffer (1–8) gives overlap without unbounded growth.

### U19
*What error does `Batch` return?*

None. It returns nothing. Errors live in the consumer.

### U20
*How do you test the final-flush bug?*

Send fewer items than `maxSize`, close `in`, and assert that you receive exactly the items you sent before `out` closes.

If you can answer all twenty without hesitation, your junior-level understanding is solid.

---

## Extended Walkthrough V — A second runnable program with controlled chaos

Let us write a program that exercises every trigger by alternating burst, lull, and shutdown. Save and run.

```go
package main

import (
    "context"
    "fmt"
    "sync/atomic"
    "time"
)

func Batch[T any](
    ctx context.Context,
    in <-chan T,
    out chan<- []T,
    maxSize int,
    maxWait time.Duration,
) {
    defer close(out)
    buf := make([]T, 0, maxSize)
    timer := time.NewTimer(maxWait)
    if !timer.Stop() { <-timer.C }

    flush := func(reason string) {
        if len(buf) == 0 { return }
        batch := make([]T, len(buf))
        copy(batch, buf)
        buf = buf[:0]
        if !timer.Stop() { select { case <-timer.C: default: } }
        fmt.Printf("flush[%s] size=%d\n", reason, len(batch))
        select {
        case out <- batch:
        case <-ctx.Done():
        }
    }

    for {
        select {
        case x, ok := <-in:
            if !ok { flush("eos"); return }
            if len(buf) == 0 { timer.Reset(maxWait) }
            buf = append(buf, x)
            if len(buf) >= maxSize { flush("size") }
        case <-timer.C:
            flush("time")
        case <-ctx.Done():
            flush("cancel")
            return
        }
    }
}

func main() {
    ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
    defer cancel()

    in := make(chan int)
    out := make(chan []int)

    go Batch(ctx, in, out, 5, 100*time.Millisecond)

    var produced atomic.Int64
    go func() {
        defer close(in)
        // Phase 1: burst of 12 (should trigger size twice + leave 2)
        for i := 0; i < 12; i++ {
            in <- i
            produced.Add(1)
        }
        // Phase 2: pause 250ms (time trigger fires on the leftover 2)
        time.Sleep(250 * time.Millisecond)
        // Phase 3: dribble 1 every 30ms for ~600ms (time triggers)
        end := time.Now().Add(600 * time.Millisecond)
        i := 100
        for time.Now().Before(end) {
            select {
            case in <- i: i++; produced.Add(1)
            case <-ctx.Done(): return
            }
            time.Sleep(30 * time.Millisecond)
        }
        // Phase 4: burst of 8 right before close
        for j := 0; j < 8; j++ { in <- j + 1000; produced.Add(1) }
    }()

    var consumed int64
    for b := range out {
        consumed += int64(len(b))
    }
    fmt.Printf("produced=%d consumed=%d\n", produced.Load(), consumed)
}
```

Expected output (roughly):

```
flush[size] size=5
flush[size] size=5
flush[time] size=2
flush[time] size=4   (or 5)
flush[time] size=4   (or 5)
flush[size] size=5
flush[eos]  size=3
produced=24 consumed=24
```

The exact distribution depends on timing, but **`produced` must equal `consumed`**. If not, your batching stage is losing items somewhere — probably the end-of-stream case.

This program is a good "regression test" to keep in your pocket: any change to `Batch` should preserve `produced == consumed`.

---

## Extended Walkthrough W — The two-line bug that costs a percent of revenue

A real story, sanitised. A team had a metrics pipeline batching events for analytics. They saw, in production, ~0.7% fewer events in the analytics warehouse than in their direct application logs. They could not figure out why.

The batching code looked like this:

```go
for x := range in {
    buf = append(buf, x)
    if len(buf) >= maxSize {
        sink.Write(buf)  // sync flush
        buf = buf[:0]
    }
}
```

The bug: no final flush. On each deploy (rolling), each pod gracefully drains by closing `in`. The `for range` exits cleanly. The 1–`maxSize-1` items still in `buf` are lost. Across 50 pods deploying daily, that is 50 × ~99 = ~5000 events per day, in a stream of ~700,000 events. 0.7%.

The fix:

```go
for x := range in { ... }
if len(buf) > 0 {
    sink.Write(buf)
}
```

Two lines (or one, depending on formatting). A 0.7% revenue impact.

This is why we emphasise the final flush so much. It is a tiny detail with outsized consequences.

---

## Extended Walkthrough X — How to talk about batching with a non-technical product manager

Sometimes you need to explain why a feature has, say, 100 ms of added latency. Here is how to phrase batching for a product audience:

> "We accumulate events in memory for up to 100 milliseconds — or 500 events, whichever comes first — and then send them as a group. This is how we get to a 50x lower compute cost per event, which is what makes the analytics pricing tier viable. The user-visible impact is at most 100 ms of additional latency, well under the 500 ms threshold we set for this feature."

Two technical facts (the trigger pair), one business justification (50x cost reduction), one user-impact statement (100 ms < 500 ms SLA). That is the structure.

Avoid: "We use channel batching with a select-loop and a time.Timer." That is the *how*, not the *why*. Save it for engineers.

---

## Extended Walkthrough Y — Memory math you should be able to do in your head

Quick estimates you should be able to produce in an interview or design review.

- **`maxSize = 1000` items of ~256 B each.** In-flight buffer ≈ 256 KB. Output channel cap 4 batches ≈ 1 MB. Total per stage: a few MB. Negligible on any server.
- **`maxSize = 10` and item is a 64 KB blob.** In-flight buffer ≈ 640 KB. Output cap 4 ≈ 2.5 MB. Still tiny.
- **`maxSize = 10000` items of 1 KB.** In-flight buffer = 10 MB. Output cap 4 = 40 MB. Per stage. Across many stages this matters; cap each stage's footprint.
- **`maxWait = 100 ms` at 1 M items/s steady-state.** At most 100K items in the buffer. At 256 B each, 25.6 MB. If you also bounded `maxSize` at 1000, the size trigger fires far before that, and the buffer never exceeds 256 KB.

Memorise the multiplications. They come up.

---

## Extended Walkthrough Z — Wrapping it all up

You should now have:

- The canonical triple-trigger select-loop in your fingers.
- Mental clarity on the four classic bugs and the unit tests that catch them.
- A feel for when batching pays (I/O-bound sinks) and when it does not (low throughput, sub-`maxWait` latency budgets).
- The vocabulary to discuss the design with seniors and product folks.
- The discipline to write the godoc and the `TestBatch_FinalFlush` test on day one.

Three concrete next steps:

1. Open the runnable program in walkthrough D and modify it: change `maxSize`, `maxWait`, the producer rate. Run each variant. Observe.
2. Open the chaos program in walkthrough V and verify `produced == consumed` under each modification.
3. Write a `BenchmarkBatch` that measures items per second through the stage at a few `maxSize` values. Plot the curve.

Then move on to middle.md, which builds on this foundation with per-key batching, bounded async flush, smarter ticker management, and SLO-aware tuning.

---

## Extended Walkthrough AA — Detailed source-walking commentary

Below we re-read Example 1 once more, this time annotating every token with a short note. Skim or read in detail; the point is to leave no part of the canonical solution mysterious.

```go
func Batch[T any](                                  // generic over item type
    ctx context.Context,                            // cancellation contract
    in <-chan T,                                    // read-only input
    out chan<- []T,                                 // write-only output of batches
    maxSize int,                                    // size trigger threshold
    maxWait time.Duration,                          // time trigger duration
) {
    defer close(out)                                // accumulator owns close

    buf := make([]T, 0, maxSize)                    // zero-length, max-cap buffer
    timer := time.NewTimer(maxWait)                 // armed immediately on creation
    if !timer.Stop() {                              // stop returns false if already fired
        <-timer.C                                   // drain stale fire
    }                                               // timer is now stopped and drained

    flush := func() {                               // captures buf, out, timer, ctx
        if len(buf) == 0 {                          // empty-buffer guard
            return                                  // no empty batches downstream
        }
        batch := make([]T, len(buf))                // fresh slice for downstream
        copy(batch, buf)                            // detach from buf's underlying array
        buf = buf[:0]                               // reset length, keep capacity
        if !timer.Stop() {                          // disarm; timer is irrelevant after flush
            select {
            case <-timer.C:                         // drain if it had fired
            default:                                // or skip if not yet drained
            }
        }
        select {
        case out <- batch:                          // attempt the send
        case <-ctx.Done():                          // bail out on cancellation
        }
    }

    for {
        select {
        case x, ok := <-in:                         // receive from input
            if !ok {                                // input was closed
                flush()                             // final flush of partial batch
                return                              // defer close(out) fires
            }
            if len(buf) == 0 {                      // empty-to-non-empty transition
                timer.Reset(maxWait)                // arm the time trigger
            }
            buf = append(buf, x)                    // accumulate
            if len(buf) >= maxSize {                // size trigger check
                flush()                             // size-trigger flush
            }
        case <-timer.C:                             // time-trigger fired
            flush()                                 // time-trigger flush
        case <-ctx.Done():                          // cancellation
            flush()                                 // best-effort flush
            return                                  // defer close(out) fires
        }
    }
}
```

Every token serves a purpose. Memorise the structure and you have memorised the contract.

---

## Extended Walkthrough BB — A pop quiz on time semantics

Suppose `maxWait = 100ms`. Trace what happens in each scenario.

**Scenario BB1.** Items arrive every 50 ms. Buffer fills 0,1,2,3,4,... none of them trigger size (assuming `maxSize = 10`). The time trigger started when the first item arrived. At t=100 ms (from first item) the timer fires; buffer has 2 items; flush them. Next item arrives at t=150; arm timer for 100 ms; fires at t=250; buffer has 2 items; flush. And so on.

**Scenario BB2.** A burst of 10 items in 1 ms. The first arrives at t=0, arms timer for 100 ms. Items 2–10 arrive over the next 1 ms. The size trigger fires at item 10 (buffer reaches `maxSize = 10`). Flush. Timer is stopped and drained. Now buffer is empty. No timer ticks expected.

**Scenario BB3.** A single item arrives at t=0, then nothing for a year. Timer fires at t=100 ms. Flush the single item. Buffer empty. Timer disarmed. No further flushes for a year. Eventually `ctx.Done()` fires (because *something* finally cancelled), the flush runs on an empty buffer (no-op), and the function returns. Clean exit.

**Scenario BB4.** Producer crashes mid-stream. The channel `in` was never closed. Buffer has 3 items. No timer (because it was disarmed after the last flush). Wait — actually, the timer was armed when the first of those 3 items arrived. So the timer is running. It fires after `maxWait`. Flush the 3 items. Buffer empty. No more items will ever arrive (producer is gone). The accumulator parks on `<-in` forever, waiting for either an item or a close. **This is a leak.** Production lesson: always tie the producer's lifetime to a `context.Context` and use `WithCancel` on the application root. When the application shuts down, `ctx.Done()` fires, the accumulator exits, and the leak is avoided.

**Scenario BB5.** A timer fires but the accumulator is busy with the receive case. The timer value sits on `timer.C`. By the time the receive case finishes and returns to `select`, both `<-in` (if another item arrived) and `<-timer.C` are ready. Random pick. If `<-timer.C` wins, flush. If `<-in` wins, append, perhaps size-flush, and the timer value sits there. Next iteration: still ready. Eventually picked.

This is *fine*: a late time-trigger flush is still semantically a time-trigger flush. The buffer may now contain more items than it had when the timer fired, but they all flush together. Latency is at most `maxWait + scheduling delay`.

---

## Extended Walkthrough CC — When the input channel is buffered

So far we have assumed `in` is unbuffered (capacity 0). What if it has a buffer, say `chan T, 100`?

The semantics change slightly:

- The producer can send 100 items into the channel without blocking. If the accumulator is slow, items accumulate in `in`'s internal buffer before reaching the accumulator's `buf` slice.
- When the producer closes `in`, the `range` (or `<-in`) sees buffered items first; the close is reported only after the buffer is drained. So the final flush after `ok == false` only fires once the channel buffer is empty.
- Cancellation is unchanged: `<-ctx.Done()` competes with `<-in` (which is still drainable from the channel buffer) in the `select`. If cancellation wins, the items in `in`'s buffer are abandoned.

For most batching stages, a small input buffer (say capacity equal to `maxSize`) lets the producer make some progress while the accumulator is mid-flush, smoothing throughput.

For a *strict* "no items lost on cancel" requirement, you may need to drain `in` after cancellation:

```go
case <-ctx.Done():
    // Drain remaining buffered input.
    for {
        select {
        case x, ok := <-in:
            if !ok { flush(); return }
            buf = append(buf, x)
        default:
            flush(); return
        }
    }
```

This is a senior-level design choice; we mention it here only to note it exists.

---

## Extended Walkthrough DD — Why the inner-flush `select` cannot omit `ctx.Done()`

A common simplification:

```go
flush := func() {
    if len(buf) == 0 { return }
    batch := snapshot(buf)
    buf = buf[:0]
    out <- batch  // BUG: not cancellable
}
```

Why is this a bug? Consider this sequence:

1. `ctx.Done()` fires in the outer `select`.
2. We enter the cancellation case and call `flush()`.
3. Inside `flush()`, the unconditional `out <- batch` blocks.
4. The consumer of `out` had already seen `ctx.Done()` (perhaps it shares the same context) and exited.
5. `out` has no reader. The send blocks forever.
6. The accumulator goroutine is leaked.

The fix is the selectable send:

```go
select {
case out <- batch:
case <-ctx.Done():
}
```

If the consumer is gone, the `ctx.Done()` branch wins immediately and `flush()` returns. The accumulator can then exit cleanly.

This is a small detail with a large blast radius. Every "I have a goroutine leak under cancellation" investigation in batching code ends here.

---

## Extended Walkthrough EE — A vocabulary check before moving on

Below are the words you must now own. Test yourself: explain each in one sentence aloud, then check.

- *Micro-batch:* an in-memory group of items processed as a single unit.
- *Accumulator:* the goroutine that owns the in-flight slice.
- *Size trigger:* flush when `len(buf) >= maxSize`.
- *Time trigger:* flush when `maxWait` has elapsed since the buffer became non-empty.
- *End-of-stream marker:* the input channel being closed.
- *Cancellation:* `ctx.Done()` firing.
- *Sync flush:* the accumulator does the downstream operation itself.
- *Async flush:* the accumulator hands off to another goroutine.
- *Back-pressure:* upstream slowdown induced by downstream non-acceptance.
- *Buffer reuse:* `buf = buf[:0]` to retain capacity.
- *Stop-and-drain:* the safe `Timer.Reset` prelude.

If you can give crisp one-sentence definitions for all eleven, your vocabulary is ready.

---

## Extended Walkthrough FF — One more pass at the final-flush bug, with a twist

Suppose someone "fixes" the missing final flush like this:

```go
for x := range in {
    buf = append(buf, x)
    if len(buf) >= maxSize {
        out <- buf       // BUG: still sending the live buf
        buf = buf[:0]
    }
}
if len(buf) > 0 {
    out <- buf           // and again here
}
close(out)
```

The final flush is present. The data loss bug is fixed. But the data *corruption* bug (sending the live `buf`) is still there. Worse: under tests with small workloads, the test passes (because `append` reallocates and downstream sees a stable slice). Under production with `maxSize = 1000` and items pre-allocated to fit, the next `append` does *not* reallocate, and the downstream consumer of `out` sees the *next* batch's items in the slice it received.

The "fix" did not fully fix. The lesson: any code path that sends `buf` directly is suspect. Always send a copy.

---

## Extended Walkthrough GG — A real interview question, decomposed

> *"Design a goroutine that reads items from a channel and writes them to a database in batches of 100 or every 100 ms, whichever comes first. The database is slow; the input channel might be closed; the operation might be cancelled."*

Break it down. The interviewer wants to see:

1. **The triple-trigger select-loop.** Three cases, three triggers.
2. **The final flush on close.** A `flush()` helper called from the `ok == false` branch and from `ctx.Done()`.
3. **The timer arming logic.** Reset on empty-to-non-empty transition; stop-and-drain after flush.
4. **The cancellable send.** Selectable on `ctx.Done()`.
5. **The copy on send.** Or an explicit acknowledgement that the consumer must process the batch synchronously.
6. **The `defer close(out)`** if there is an output channel, or **the explicit `db.InsertMany(ctx, batch)`** if the function does the I/O itself.

The candidate who covers all six in 10 minutes is hired (for the junior role).

The candidate who writes:

```go
for x := range in {
    buf = append(buf, x)
    if len(buf) >= 100 {
        db.InsertMany(buf)
        buf = buf[:0]
    }
}
```

and stops there is sent home. Missing: time trigger, cancellation, final flush, error handling, copy semantics.

The middle-tier candidate adds bounded async flush, partial-failure handling, and metrics. The senior adds adaptive sizing and back-pressure analysis.

---

## Extended Walkthrough HH — Last words before middle.md

You have arrived at the end of junior.md. To wrap up, here is a one-paragraph summary you can recite from memory:

> "A batching stage in Go is a single goroutine that owns an in-flight slice and decides when to flush based on three triggers: size, time, and end-of-stream. The canonical implementation is a `for { select { ... } }` loop with three cases — receive from input, time fired, context cancelled — and a `flush()` helper that copies the buffer into a fresh slice, sends it on a cancellable output channel, and resets the buffer. The single most common bug is forgetting the final flush on input close, which silently drops the last partial batch. The single most common performance optimisation beyond the basics is reusing the buffer via `s = s[:0]` and using a single `*time.Timer` rather than `time.After`."

Be able to deliver that paragraph in 30 seconds.

Now: middle.md.

Move on to middle.md when you can write Example 1 from memory, explain every line, and recognise the bugs in walkthroughs B and C without looking.





