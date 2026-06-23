---
layout: default
title: Junior
parent: Batching
grand_parent: Production Patterns
ancestor: Go
nav_order: 2
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/18-production-patterns/03-batching/junior/
---

# Batching — Junior Level

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

> Focus: "What is a batcher? Why is it faster than calling the sink for every item? How do I write one in 60 lines of Go without losing data?"

A **batcher** is a small piece of code that collects items as they arrive and hands them off to a downstream sink in groups instead of one at a time. The "downstream sink" might be a database, a message broker, an HTTP endpoint, a log file — anything where the cost of one call is mostly fixed regardless of how many items the call carries.

Think of it like a delivery driver. Driving the truck across town costs time and fuel whether you carry one parcel or fifty. So you fill the truck before you set out. Batching is exactly that trick, applied to function calls.

The two questions every batcher must answer:

1. **When is the batch full enough to send?** This is the **size trigger** — flush when N items have accumulated.
2. **When have we waited too long?** This is the **time trigger** — flush whatever we have if the oldest item is older than D.

A batcher with only a size trigger can hold an item forever if traffic suddenly dies. A batcher with only a time trigger never amortises the per-call cost across many items under high load. Real production batchers always have both.

In Go, a batcher is one of the most natural things you can build with channels and `select`. The entire pattern fits on the back of an envelope:

```go
for {
    select {
    case item := <-input:
        buf = append(buf, item)
        if len(buf) >= maxSize {
            flush(buf); buf = buf[:0]
        }
    case <-ticker.C:
        if len(buf) > 0 {
            flush(buf); buf = buf[:0]
        }
    }
}
```

That nine-line loop is the heart of every batcher you will ever see in production. Everything else — graceful shutdown, retry policy, observability, adaptive sizing, NUMA-aware accumulators — is added on top of it. You will recognise this shape in `golang/x/time/rate`, in the Kafka producer client, in Prometheus' remote-write batch, in OpenTelemetry's batch processor, in Vector's sink. Internalise it once and you will see it everywhere.

After reading this file you will be able to:

- Explain to a colleague what a batcher does and why it is faster.
- Write a working batcher with both triggers from scratch, without referring to notes.
- Read `time.Ticker` and `select` code well enough to predict batcher behaviour on a whiteboard.
- Recognise and fix the most common first-time bugs: dropped flushes on shutdown, shared-buffer aliasing, blocked producers, time-trigger races, only-one-trigger bugs.
- Decide whether batching is appropriate for a given downstream sink based on the per-call versus per-item cost model.

You do not yet need to know about graceful shutdown contracts, partial flush guarantees, observability metrics, retry strategies, adaptive sizing, or the internals of Kafka and Postgres. Those come at the middle, senior, and professional levels.

> A note on naming. In conversation Go engineers use "batcher", "buffer", "aggregator", "collector", and "accumulator" interchangeably. They all mean the same thing for our purposes. Where the distinction matters — for instance, "aggregator" is sometimes reserved for batchers that *combine* items, like summing counters, rather than just grouping them — we will say so explicitly. This file uses "batcher" throughout.

---

## Prerequisites

- **Required:** a working Go toolchain, version 1.18 or newer. Run `go version` to check. All examples in this file compile on 1.20 and above.
- **Required:** comfort writing and running a `main` function, importing packages, and starting a goroutine with the `go` keyword.
- **Required:** comfort with channels: `make(chan T, n)`, send `ch <- x`, receive `x := <-ch`, and `close(ch)`.
- **Required:** comfort with `select` statements, including the `default` clause.
- **Required:** knowledge that `time.NewTicker(d)` returns a `*time.Ticker` whose `C` field is a channel that delivers a tick value every `d`.
- **Recommended:** awareness that `sync.WaitGroup` exists and is used to wait for goroutines to finish.
- **Recommended:** some prior exposure to `database/sql` or any HTTP client library. We do not use them in this file — we use a tiny fake `Sink` — but knowing they exist will help the motivation land.

If you can read this snippet and predict its output:

```go
ticker := time.NewTicker(100 * time.Millisecond)
for i := 0; i < 3; i++ {
    <-ticker.C
    fmt.Println(i)
}
ticker.Stop()
```

you have every prerequisite this file assumes.

> The output is "0", "1", "2" spaced 100 ms apart, with the program taking about 300 ms total. If that is news to you, read the `time.Ticker` junior file first and come back.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Batcher** | A component that buffers individual items in memory and flushes them as a group to a downstream sink. |
| **Item** | A single unit of work — a row to insert, an event to publish, a log line to ship, a span to record. |
| **Batch** | The group of items that gets flushed together in one call to the sink. |
| **Flush** | The act of handing the current buffer to the sink and clearing it. |
| **Size trigger** | A flush caused by the buffer reaching its configured maximum size. The parameter is usually called `MaxBatchSize`, `BatchSize`, or just `N`. |
| **Time trigger** | A flush caused by elapsed time since the first item was buffered. The parameter is usually called `MaxBatchDelay`, `FlushInterval`, `Linger`, or `Latency`. |
| **Sink** | The destination — a database connection, a Kafka producer, an HTTP client, a log file. The thing whose per-call cost we are trying to amortise. |
| **Buffer** | The in-memory slice (or ring buffer, but we use a slice in this file) where pending items wait until a flush. |
| **`time.Ticker`** | Standard library type that sends a value to a channel at a fixed interval. The usual mechanism for the time trigger. |
| **`time.Timer`** | Like a `Ticker` but fires once. Useful when the time trigger should be measured from "first item arrived" rather than "every D unconditionally". |
| **Backpressure** | What happens when producers are faster than the batcher can flush. The batcher must either block producers, drop items, or grow the buffer unboundedly. In this file we choose to block. |
| **Producer** | Any code that calls `batcher.Add(item)`. There may be many producer goroutines. |
| **Consumer** | The single goroutine inside the batcher that runs the flush loop. There is exactly one in our junior-level design. |
| **`Add`** | The public method that producers call to enqueue an item. Almost always implemented as a channel send. |
| **`Close`** / **`Shutdown`** | The public method that tells the batcher to flush remaining items and stop. |
| **`done`** | An internal channel that the consumer closes on exit, so `Close()` knows when the loop has actually finished. |
| **Tick** | A single value emitted by a `time.Ticker.C` channel. The value is a `time.Time` representing when the tick was queued. |
| **Reslice** | The Go idiom `buf = buf[:0]` that empties a slice without freeing its backing array. The key memory trick for allocation-free batchers. |
| **Linger** | The Kafka-specific name for the time trigger (`linger.ms`). The behaviour is the same: the producer waits up to `linger.ms` for more records before sending. |
| **Micro-batch** | A batch with a very short time trigger (typically 1–50 ms). The opposite extreme of "macro-batch" workloads like nightly ETL. Most online services use micro-batches. |
| **Per-call cost** | The fixed cost the sink incurs per flush, regardless of payload size: a round-trip, query parsing, transaction setup, TLS overhead. The thing batching amortises. |
| **Per-item cost** | The cost the sink incurs per item in the payload. Batching does not amortise this. |
| **Knee** | The point on the batch-size-versus-latency curve where increasing the batch size stops improving throughput and starts hurting tail latency. The job of a tuner is to find it. |

---

## Core Concepts

### A batcher is a one-goroutine loop

The heart of every batcher is a single goroutine running a `select` over two channels and a ticker:

```go
for {
    select {
    case item := <-input:
        buf = append(buf, item)
        if len(buf) >= maxSize {
            flush(buf); buf = buf[:0]
        }
    case <-ticker.C:
        if len(buf) > 0 {
            flush(buf); buf = buf[:0]
        }
    }
}
```

That is essentially the whole pattern. Everything else — shutdown, retries, metrics, adaptive sizing — is added on top of this loop. Internalise this shape; you will see it again and again.

Note three properties of this loop:

1. **Single ownership of the buffer.** Only one goroutine ever touches `buf`. No mutex is needed; the channel does the synchronisation.
2. **Two flush paths.** Inside the `case item` branch we flush on size; inside the `case ticker.C` branch we flush on time. The two branches share the flush helper.
3. **`buf = buf[:0]` after each flush.** This empties the slice but keeps the underlying array. The next batch will reuse that memory.

### Producers send, the consumer batches

The batcher exposes one method, `Add(item)`, which is just a channel send. Many goroutines can call `Add` simultaneously; the channel serialises them. Only the one batcher goroutine touches the buffer, so the buffer itself needs no lock.

This is a classic example of using Go's "share by communicating, do not communicate by sharing" model. Synchronisation is implicit in the channel.

```
producer1  --\
producer2  ---*--[input channel]--> [consumer goroutine + buffer] --> sink
producer3  --/
```

The producers never see the buffer. The consumer never sees the producers as anything other than items appearing on the channel. The decoupling is what makes the design easy to reason about.

### Size and time are independent triggers

The size trigger fires when the buffer is *full*. The time trigger fires when too much *time* has passed. They are independent — either can fire first. If you only implement one, you have a bug waiting:

- **Size only**: a burst of 10 items at 09:00, then silence. Those 10 items wait until 17:00 when the next item arrives. Audit logs that are supposed to be flushed every minute sit in RAM for the entire workday. On crash they are gone. This is not theoretical — every shop has had this incident at least once.
- **Time only**: 100 000 items per second arriving. The size never fills, so the batcher flushes every 100 ms by ticker — meaning a batch of 10 000 items every tick. Now you are amortising, but only by accident; if traffic doubles, your downstream sees 20 000-item batches and falls over. Worse, your batches are now too big and your downstream latency spikes.

The right answer is "flush at size N or after D, whichever comes first." Every production batcher uses both.

### The buffer is just a slice

For a junior-level batcher, `buffer []Item` is enough. Reset it with `buffer = buffer[:0]` after flush. This reuses the underlying array and is allocation-free for steady-state operation. You do not need ring buffers, lock-free accumulators, or any of the structures `professional.md` will discuss.

```go
buf := make([]Item, 0, maxSize)
// ... use buf, append, flush ...
buf = buf[:0]  // empty, but cap(buf) is still maxSize
```

If you accidentally write `buf = buf[:0]` *before* flushing instead of after, you lose the whole batch. We will see that bug in `find-bug.md`.

### "Flush" is a synchronous call

In the simplest batcher, `flush(buf)` is a blocking call. If the database write takes 200 ms, the batcher goroutine is busy for 200 ms and cannot accept new items during that window. That is fine for a starter implementation — the producers will block in their channel send until the batcher returns. We will see how to overlap flush with accumulation in `middle.md`.

The synchronous flush gives you a property worth noting: **at most one batch is in flight at a time**. That simplifies error handling enormously. If the flush fails, you know exactly which items are affected — the ones in the buffer at the moment you started the flush. With a concurrent flush you have to manage that mapping yourself.

### The sink is an interface

Always pass the sink as an interface, not as a concrete type:

```go
type Sink interface {
    Write(batch []Item) error
}
```

This lets you swap a fake sink in tests, a logging sink in development, and a Postgres sink in production without recompiling the batcher. It also forces you to think about the contract: what does it mean for `Write` to return an error? Does it mean "none of the items landed", "some of them landed", "all of them landed but the ack was lost"? The sink interface is where those questions get pinned down. We will revisit this when we cover error handling.

### Defensive copy before handing the buffer to the sink

If your sink stores the slice it receives, you have a problem: the batcher reuses the buffer for the next batch, and now the sink sees overwritten data. In the junior implementation we make a defensive copy before passing the buffer to the sink, so the sink can hold the slice as long as it likes.

```go
batch := make([]Item, len(buf))
copy(batch, buf)
sink.Write(batch)
buf = buf[:0]
```

The copy costs `O(N)` memory writes per flush, which is usually negligible compared to the network round-trip the flush triggers. If profiling shows the copy as a hotspot you can move to a double-buffer scheme covered in `senior.md`.

---

## Real-World Analogies

### The delivery truck

A parcel costs more or less the same to deliver whether the truck is full or empty: the driver's hourly wage, the fuel for the route, the toll. So the dispatcher waits until the truck is full *or* until the oldest parcel is in danger of missing its promised delivery date, then sends the truck out. Size trigger and time trigger together. Without the time trigger, a parcel addressed to a small village in the mountains might wait six months for the truck to fill up; without the size trigger, the truck makes the trip half empty every day. Real logistics companies use both.

### The bus

A city bus leaves the terminal when full or when its scheduled departure time arrives, whichever comes first. The departure time is the time trigger, the seat count is the size trigger. Once again, both are necessary: rush hour fills the bus before the time trigger; midnight Tuesday hits the time trigger long before the bus is full.

### The dishwasher

Nobody runs the dishwasher with two dishes in it. You wait until it is full. But if you have guests coming, you run it at the time threshold even if it is half full. "Guests coming" is the time trigger; "tray full" is the size trigger.

### The bakery oven

Bakers do not bake one croissant. They fill a tray. The tray is the size trigger; "we open at 7 AM" is the time trigger. At 6:30 AM, even if the tray is only 60% full, it has to go in the oven. By 6:55 the croissants are ready.

### The shipping manifest

Customs paperwork is the same whether a container holds one item or a thousand. So freight forwarders accumulate items until they have a container's worth and ship them as one entry. The "per-call cost" is the customs paperwork; the "per-item cost" is the warehouse handling. Batching reduces the first; nothing reduces the second.

The shape of the problem repeats everywhere: per-unit fixed cost amortised across many units, with a cap on how long any single unit may wait.

---

## Mental Models

### "Cost per call, cost per item"

Every downstream sink has two cost components:

- **Per-call cost** (`C_call`): connection lookup, query planning, network round-trip, transaction overhead. Roughly constant regardless of payload size up to some limit. Examples: 5 ms for a Postgres INSERT round-trip, 2 ms for a Kafka produce request, 50 ms for an HTTP `_bulk` call to Elastic.
- **Per-item cost** (`C_item`): proportional to how many items are in the payload. Examples: the time Postgres spends parsing each row, the bytes Kafka must serialise, the JSON overhead of each Elastic document.

Without batching, sending N items costs `N * (C_call + C_item)`. With batching, it costs `C_call + N * C_item`. The savings — `(N-1) * C_call` — is exactly what batching buys you. If `C_call` is small compared to `C_item`, batching is not worth it. If `C_call` is huge (network round-trip to a database 5 ms away), batching can be a 100x throughput win.

Example numbers:

- Postgres INSERT, local network: `C_call ≈ 1 ms`, `C_item ≈ 50 µs`. Batch of 100 takes `1 ms + 5 ms = 6 ms`, versus 100 unbatched calls at `100 * 1.05 ms = 105 ms`. **17x speedup.**
- Kafka produce, same datacentre: `C_call ≈ 2 ms`, `C_item ≈ 1 µs`. Batch of 1000 takes `2 ms + 1 ms = 3 ms`, versus 1000 unbatched calls at `1000 * 2.001 ms = 2001 ms`. **667x speedup.**
- In-process function call: `C_call ≈ 50 ns`, `C_item ≈ 50 ns`. Batch of 100 saves `99 * 50 ns = 5 µs`. **Not worth it.**

Always start with this back-of-envelope. If `(N-1) * C_call` is not at least an order of magnitude more than your batcher's overhead, you do not need a batcher.

### "Latency budget"

Every operation in your service has a latency budget. If a user-facing API must respond in 100 ms, and your batcher adds 50 ms of waiting (the time trigger), you have spent half your budget. So the time trigger is not free — it is *exactly* the worst-case extra latency you are paying for amortisation. Pick it deliberately, document it, and make sure everyone downstream knows.

A common mistake is to copy `linger.ms = 100` from a tutorial without realising that you are committing to a 100 ms latency floor. If your SLA is 50 ms p99, you have already failed the SLA before any other code runs.

### "Worst case is the only case that matters"

The size trigger fires on the lucky day when traffic is high. The time trigger fires on the slow day. The slow day is the one that determines correctness — if your time trigger is 1 hour and your service handles audit logs, an item that arrives at 14:59:59 might not reach the database until 16:00. Whether that is acceptable is a business decision, but it must be a *decision*, not an accident.

This generalises: when you design a batcher, draw the worst-case timeline. "What does the timeline look like when the size trigger never fires?" If the answer is "it is fine", proceed. If the answer is "we lose data on crash", redesign.

### "Two clocks"

A batcher has two notions of time:

1. **Wall clock**: what `time.Now()` says.
2. **Batch clock**: how long the *oldest item* in the current buffer has been waiting.

The time trigger is about the batch clock, not the wall clock. A `time.Ticker` is wall-clock-based and is an approximation: if the buffer was just flushed and a new item arrives 1 ms before the next tick, the next flush happens 1 ms later instead of `D` later. That is usually fine. If you need a strict batch clock, use `time.Timer` reset on the first arrival of each batch. We will see both in this file.

### "Block, drop, or grow"

When a producer's `Add` arrives and the input channel is full, exactly three things can happen:

1. **Block**: the producer waits until there is space. Default behaviour of an unbuffered or full bounded channel.
2. **Drop**: the item is discarded. The producer never blocks, but data is lost.
3. **Grow**: the buffer expands. The producer never blocks and no data is lost, but memory can grow unboundedly.

The junior batcher uses **block**, because it is the safest default and exposes the problem to upstream code. The other two are policy choices documented in `01-backpressure`. There is no "right" answer; there are only consequences.

---

## Pros and Cons

### Pros

- **Throughput**: orders of magnitude higher than per-item calls in many setups (see the cost-per-call model above).
- **Fewer round-trips**: lower network load, fewer connection slots used, fewer TCP packets, less TLS handshake amortisation work.
- **Lower downstream load**: one big INSERT is much cheaper for Postgres than 1000 small ones (one WAL flush, one transaction, one parser pass, one query-plan lookup).
- **Better resource utilisation**: connection pools, prepared statements, and HTTP keep-alive all benefit. Fewer connections means less memory at every layer.
- **Smoother CPU usage**: bursty per-item calls produce CPU spikes; batched calls smooth them.
- **Cheaper retries**: one retry for a batch of 100 items is one retry; 100 individual retries with backoff can mean 100x the wall time.

### Cons

- **Added latency**: every item waits up to `MaxBatchDelay`. This is the fundamental cost.
- **All-or-nothing failure**: if a batch fails, all items in it fail. You need policy for retry, split, or dead-letter.
- **Memory**: pending items sit in RAM. Under backpressure this can grow unless bounded.
- **Shutdown complexity**: items in the buffer must be flushed before the process exits, or they are lost.
- **Ordering subtleties**: items are not necessarily processed in the order they arrived if the batcher uses multiple flush goroutines or if retries reorder things.
- **Hard to reason about correlation**: a batch of mixed-tenant items may fail because of one bad row, taking the rest down with it.
- **Observability blind spots**: per-item latency includes the wait-in-buffer time, which is invisible if the batcher is not instrumented.

---

## Use Cases

### Excellent fits

- **Database INSERTs**: 500 rows per multi-row INSERT instead of 500 individual ones. Postgres `INSERT INTO t (...) VALUES (...), (...), ...` or `COPY FROM`. MySQL multi-row INSERT. SQLite WAL mode.
- **Kafka producer**: this is what Kafka's `linger.ms` and `batch.size` configure internally. You can layer your own batcher on top for application-level grouping.
- **HTTP bulk APIs**: Elastic `_bulk`, BigQuery `insertAll`, Splunk HTTP Event Collector, Datadog `/api/v1/series`, Prometheus remote write, OpenTelemetry OTLP.
- **Log shipping**: collect log lines, ship every N or every D. The pattern behind Fluentd, Vector, Filebeat.
- **Metrics aggregation**: collect counter increments, aggregate, push as one statsd packet. The pattern behind statsd clients, the OpenTelemetry SDK, and Prometheus' own scrape buffer.
- **Email or notification fan-out**: batch up "you have N new messages" digests instead of one email per event.
- **CDC sinks**: change-data-capture pipelines almost always batch downstream writes.
- **Audit logs**: batch flush to an append-only store like S3 or a journaling DB.

### Poor fits

- **Strictly per-request semantics**: when each item needs an individual synchronous response to the caller before the caller can move on. A login endpoint should not batch.
- **Very low traffic**: if you average 1 item per minute, the time trigger fires before the size trigger ever does, and you have only paid the latency cost without buying any throughput.
- **Idempotency cost is high**: if retrying a batch means having to deduplicate downstream, and the dedup is expensive, the math may not favour batching.
- **Heterogeneous items**: if items cannot easily be combined (different shards, different tenants, different schemas), batching forces routing logic that may cost more than it saves.

---

## Code Examples

### A minimal in-memory sink

We start with a fake sink so we can focus on the batcher itself.

```go
package main

import (
    "sync"
)

type Sink struct {
    mu      sync.Mutex
    flushed [][]int
}

func (s *Sink) Write(batch []int) error {
    s.mu.Lock()
    defer s.mu.Unlock()
    cp := make([]int, len(batch))
    copy(cp, batch)
    s.flushed = append(s.flushed, cp)
    return nil
}

func (s *Sink) Count() int {
    s.mu.Lock()
    defer s.mu.Unlock()
    return len(s.flushed)
}

func (s *Sink) Total() int {
    s.mu.Lock()
    defer s.mu.Unlock()
    n := 0
    for _, b := range s.flushed {
        n += len(b)
    }
    return n
}
```

We make a defensive copy inside `Write` because, even though the batcher *also* makes a copy, real sinks may hold the slice across goroutines and we want to be explicit. In production code, document who copies; do not rely on a copy at both ends.

### A minimal batcher with both triggers

```go
package main

import "time"

type Batcher struct {
    in       chan int
    sink     *Sink
    maxSize  int
    maxDelay time.Duration
    done     chan struct{}
}

func NewBatcher(sink *Sink, maxSize int, maxDelay time.Duration) *Batcher {
    b := &Batcher{
        in:       make(chan int, 1024),
        sink:     sink,
        maxSize:  maxSize,
        maxDelay: maxDelay,
        done:     make(chan struct{}),
    }
    go b.run()
    return b
}

func (b *Batcher) Add(item int) { b.in <- item }

func (b *Batcher) flush(buf []int) {
    batch := make([]int, len(buf))
    copy(batch, buf)
    _ = b.sink.Write(batch)
}

func (b *Batcher) run() {
    defer close(b.done)
    buf := make([]int, 0, b.maxSize)
    ticker := time.NewTicker(b.maxDelay)
    defer ticker.Stop()
    for {
        select {
        case item, ok := <-b.in:
            if !ok {
                if len(buf) > 0 {
                    b.flush(buf)
                }
                return
            }
            buf = append(buf, item)
            if len(buf) >= b.maxSize {
                b.flush(buf)
                buf = buf[:0]
            }
        case <-ticker.C:
            if len(buf) > 0 {
                b.flush(buf)
                buf = buf[:0]
            }
        }
    }
}

func (b *Batcher) Close() {
    close(b.in)
    <-b.done
}
```

That is roughly 45 lines and handles both triggers, a basic shutdown, and an in-flight flush on close.

### Driving it

```go
package main

import (
    "fmt"
    "time"
)

func main() {
    sink := &Sink{}
    b := NewBatcher(sink, 5, 100*time.Millisecond)

    // Send 12 items, then wait for the time trigger, then close.
    for i := 0; i < 12; i++ {
        b.Add(i)
    }
    time.Sleep(250 * time.Millisecond)
    b.Close()

    fmt.Println("batches flushed:", sink.Count())
    fmt.Println("items written:", sink.Total())
}
```

You should see two size-triggered flushes (of 5 each) and one time- or close-triggered flush of the remaining 2. `batches = 3`, `items = 12`. Run it a few times — the exact split between time-trigger and close-trigger depends on the race between the 250 ms sleep and the 100 ms ticker, but the total is always 12.

### A simple HTTP example

To make the value tangible, here is the same shape against a fake HTTP endpoint that simulates network latency:

```go
package main

import (
    "fmt"
    "time"
)

type HTTPSink struct {
    latency time.Duration
    calls   int
}

func (h *HTTPSink) Write(batch []int) error {
    time.Sleep(h.latency)
    h.calls++
    return nil
}

func unbatched(n int, sink *HTTPSink) time.Duration {
    start := time.Now()
    for i := 0; i < n; i++ {
        _ = sink.Write([]int{i})
    }
    return time.Since(start)
}

func batched(n int, sink *HTTPSink, size int) time.Duration {
    start := time.Now()
    buf := make([]int, 0, size)
    for i := 0; i < n; i++ {
        buf = append(buf, i)
        if len(buf) == size {
            _ = sink.Write(buf)
            buf = buf[:0]
        }
    }
    if len(buf) > 0 {
        _ = sink.Write(buf)
    }
    return time.Since(start)
}

func main() {
    sink := &HTTPSink{latency: 5 * time.Millisecond}
    nVal := 1000

    fmt.Println("unbatched:", unbatched(nVal, sink))
    sink = &HTTPSink{latency: 5 * time.Millisecond}
    fmt.Println("batched 100:", batched(nVal, sink, 100))
    sink = &HTTPSink{latency: 5 * time.Millisecond}
    fmt.Println("batched 1000:", batched(nVal, sink, 1000))
}
```

Run this. You will see something like:

```
unbatched: 5.0s
batched 100: 50ms
batched 1000: 5ms
```

A thousand-fold speedup is not unusual for round-trip-dominated workloads. The numbers do not always look this dramatic — local databases with sub-millisecond round trips and CPU-bound items see modest gains — but the *shape* of the win is universal.

### Wiring up a goroutine-safe `Add` with `WaitGroup`

In a real service, many goroutines call `Add` concurrently. The channel handles that automatically, but you also need to wait for them all to finish enqueueing before you call `Close`. A `WaitGroup` works:

```go
func main() {
    sink := &Sink{}
    b := NewBatcher(sink, 100, 50*time.Millisecond)

    var wg sync.WaitGroup
    for w := 0; w < 8; w++ {
        wg.Add(1)
        go func(id int) {
            defer wg.Done()
            for i := 0; i < 1000; i++ {
                b.Add(id*1000 + i)
            }
        }(w)
    }
    wg.Wait()
    b.Close()
    fmt.Println("items written:", sink.Total()) // 8000
}
```

Note the order: producers finish (`wg.Wait`), then we `Close` the batcher. If you `Close` first, the producers will panic on send to a closed channel.

### Using `time.Timer` instead of `time.Ticker`

The ticker fires on a fixed schedule, regardless of when the last flush happened. If you want the time trigger to be measured from "first item arrived after the last flush", use a `time.Timer` that you reset on each flush:

```go
func (b *Batcher) runTimer() {
    defer close(b.done)
    buf := make([]int, 0, b.maxSize)
    var timer *time.Timer
    var timerC <-chan time.Time
    armTimer := func() {
        if timer == nil {
            timer = time.NewTimer(b.maxDelay)
            timerC = timer.C
        }
    }
    disarmTimer := func() {
        if timer != nil {
            if !timer.Stop() {
                select { case <-timer.C: default: }
            }
            timer = nil
            timerC = nil
        }
    }
    for {
        select {
        case item, ok := <-b.in:
            if !ok {
                if len(buf) > 0 {
                    b.flush(buf)
                }
                disarmTimer()
                return
            }
            buf = append(buf, item)
            if len(buf) == 1 {
                armTimer() // first item: start the clock
            }
            if len(buf) >= b.maxSize {
                b.flush(buf)
                buf = buf[:0]
                disarmTimer()
            }
        case <-timerC:
            if len(buf) > 0 {
                b.flush(buf)
                buf = buf[:0]
            }
            disarmTimer()
        }
    }
}
```

This version waits exactly `maxDelay` from the first item, no more, no less. It is slightly more complex than the ticker version but has stronger latency guarantees per batch — which is what you usually want in production.

Most production batchers use the timer style. The ticker style is easier to write and good enough for many cases.

---

## Coding Patterns

### "Reset by reslice, not by realloc"

```go
buf = buf[:0]
```

This keeps the underlying array, so the next batch reuses the same memory. `buf = make([]int, 0, cap)` would allocate a fresh array every time and pressure the GC.

If your items are pointers (or contain pointers), you may also want to nil out the entries before reslicing, so the GC can reclaim what the items point to:

```go
for i := range buf {
    buf[i] = nil
}
buf = buf[:0]
```

For value items (ints, small structs without pointers), this is unnecessary. For pointer items in a long-running batcher, forgetting the nil-out can pin large object graphs and look like a memory leak.

### "One goroutine owns the buffer"

The buffer is touched only inside `run()`. No mutex is needed. This is the idiom; if you find yourself locking the buffer, you have probably structured the batcher wrong.

The corollary: do not store the buffer on the struct. Make it a local variable inside `run()`. That way the type system enforces single ownership.

### "Send on a channel is your only public API"

`Add` is a channel send. That gives you backpressure for free: when the channel is full, callers block. You do not have to write any extra code for that.

```go
func (b *Batcher) Add(item Item) { b.in <- item }
```

If you want a non-blocking send, write a separate method and *name* it explicitly:

```go
func (b *Batcher) TryAdd(item Item) bool {
    select {
    case b.in <- item:
        return true
    default:
        return false
    }
}
```

Never silently change `Add` from blocking to dropping. That is a guaranteed production incident.

### "Centralised close"

Only the orchestrator — the code that constructed the batcher — calls `Close`. Producers never close the channel. The batcher's `Close` method is the only call site that touches `close(b.in)`. This single rule prevents a whole class of "send on closed channel" panics.

### "Flush in one place"

Resist the urge to write `flush` inline in both the size and time branches. Factor it into a method. That way:

- A future addition (metrics, tracing, retry) goes in one place.
- The reset of `buf = buf[:0]` lives next to the flush call, so they cannot drift apart.
- Code review sees one flush path, not two slightly different ones.

```go
func (b *Batcher) flushAndReset(buf *[]int, reason string) {
    if len(*buf) == 0 {
        return
    }
    batch := make([]int, len(*buf))
    copy(batch, *buf)
    _ = b.sink.Write(batch)
    *buf = (*buf)[:0]
    // future: emit metric tagged with reason
}
```

The pointer-to-slice argument is a small wart but lets the helper reset the caller's slice. Alternatively, return the new slice — `*buf = b.flushAndReset(*buf, "size")` — same idea.

### "The flush function takes a `context.Context`"

A production-grade flush takes a context so the caller can cancel a slow downstream call. We omit it from the junior examples to keep the focus on the pattern, but in middle.md you will see:

```go
type Sink interface {
    Write(ctx context.Context, batch []Item) error
}
```

Start adding the ctx parameter now even if you do not use it. Adding it later forces an API break.

---

## Clean Code

- Name the trigger reason. When you log or emit metrics, say `reason="size"` or `reason="time"` or `reason="shutdown"`. Future-you will thank present-you when debugging a "why is the batch size always exactly 47?" incident.
- Make `maxSize` and `maxDelay` explicit configuration with units, not magic numbers. `MaxBatchSize int` and `MaxBatchDelay time.Duration` not `N int` and `D time.Duration`.
- Use a struct, not free functions. A batcher is naturally stateful; pretending otherwise leads to global variables.
- Keep the flush function pluggable — pass a `Sink` interface, not a concrete `*sql.DB`. This makes the batcher unit-testable.
- Document the policy: in the package doc-comment, write down the blocking semantics of `Add`, the latency floor introduced by `MaxBatchDelay`, and the shutdown contract.
- Use named return values sparingly inside the batcher — the consumer goroutine is hot code and named returns can confuse the reader about what is assigned where.
- Lift error handling out of the run loop. The run loop should call `b.handleFlushError(err)` and stay focused on the orchestration. Putting retry logic inline turns the loop into spaghetti.

---

## Product Use

A real product team uses batchers in places like:

- **The audit log subsystem**: 1000 user actions per second arrive as gRPC calls. The handler enqueues, the batcher flushes 500 rows per INSERT to Postgres. Saves both the DB CPU (one parse instead of 500) and the WAL fsyncs (one instead of 500).
- **The notification fan-out**: a "user followed you" event arrives; the batcher accumulates events per recipient for 5 seconds and sends one push notification with "5 new followers". This is also a *combining* batcher; we will discuss that in middle.md.
- **The metrics SDK**: every counter increment is enqueued; the batcher emits one statsd packet per 100 ms with all increments aggregated.
- **The analytics pipeline**: every page view emits an event; the batcher flushes 5 MB of events to S3 every 30 seconds or 100 000 events, whichever first.
- **The webhook delivery**: each customer gets at most one webhook per minute regardless of how many events they generate, by batching downstream notifications.

Without batching, each of these subsystems would either fall over under load or require 10x the infrastructure.

> A product question that often comes up: "Can we batch user-facing writes too?" Usually no — the user is waiting for the response. But some teams have made it work by writing the user-facing record synchronously to a fast store (Redis, an in-memory queue) and batching the slow store write (Postgres) asynchronously. The user sees their action persisted; the durable store catches up within seconds. This is the "write-behind" pattern, covered in the caching subsection.

---

## Error Handling

The junior batcher above does `_ = b.sink.Write(batch)`. That is terrible — it silently drops errors. At the junior level we are mostly concerned with mechanics, but you should at least know the policy options for when `flush` fails:

- **Log and continue** — fine for best-effort metrics and logs. The batch is dropped but operation continues.
- **Retry** with backoff — for everything that matters. We cover the retry algorithm in middle.md.
- **Dead-letter** — push to a separate queue for human or automated review.
- **Crash** — if the whole batch failing means the system is in an unrecoverable state. Crash early and let the orchestrator restart.

For a junior implementation, at least log:

```go
func (b *Batcher) flush(buf []int) {
    batch := make([]int, len(buf))
    copy(batch, buf)
    if err := b.sink.Write(batch); err != nil {
        log.Printf("batcher: flush failed (%d items): %v", len(batch), err)
    }
}
```

This is still wrong for production (the items are gone), but at least an operator sees the failure.

### Partial vs total failure

Some sinks return "failed for items X, Y, Z" (Elastic `_bulk` does, Kafka's per-record-callback API does). Others give you a single error per call (`database/sql.Exec` does). The shape of the sink's failure model determines the shape of your error handling. We will return to this in middle.md.

### Panic in the flush

If the sink's `Write` panics, your batcher goroutine dies and the channel keeps filling until producers block forever. Recover at the goroutine boundary:

```go
func (b *Batcher) run() {
    defer func() {
        if r := recover(); r != nil {
            log.Printf("batcher: panic in run loop: %v", r)
        }
        close(b.done)
    }()
    // ... rest of run
}
```

This is the bare minimum. A real implementation would also restart the goroutine or signal the supervisor. Covered in senior.md.

---

## Security Considerations

Batching is not directly a security topic, but a few things are worth flagging:

- **Mixed-tenant batches**: if your batch combines items from many tenants, a failure attributable to one tenant's data can take down processing for the rest. Some teams batch *per tenant* to localise blast radius.
- **Sensitive data in memory**: items sit in RAM longer with a batcher than without. Zero them out on flush if the items contain secrets.
- **Resource exhaustion**: an unbounded input channel is a DoS vector — an attacker who can flood your endpoint can drive the batcher's memory unbounded. Bounded channels with explicit backpressure prevent this.
- **Log injection**: if you log "flushed batch of 500 items: [...]" with item contents, an attacker controlling item content can inject log lines. Standard logging hygiene applies.
- **Replay during partial flush on crash**: if a process crashes mid-flush and is restarted from a checkpoint, items can be replayed. The downstream sink must be idempotent or de-duplicating.

We treat these in more depth in the security review file under `senior.md` and the `api-security-checklist` skill.

---

## Performance Tips

- Pre-allocate the buffer with `make([]T, 0, maxSize)` so the first batch does not grow the slice.
- Make `Add` non-allocating — pass values, not pointers, when items are small. A `chan int64` does not allocate per send; a `chan *Event` may or may not, depending on escape analysis.
- Buffer the input channel (`make(chan T, 1024)`) so producers do not block on every send.
- Pick `maxSize` based on the downstream's sweet spot. Postgres likes 100–1000 rows per INSERT; Kafka likes ~16 KB batches; Elastic `_bulk` likes 5–15 MB; statsd likes one UDP packet.
- Avoid `interface{}` items if you can. They allocate (boxing) on every `Add`.
- If your items are large, consider passing pointers but documenting the ownership: "after calling `Add`, the batcher owns the pointer; do not modify the pointee."
- Use a `sync.Pool` to reuse batch slices across flushes if profiling shows allocation pressure. This is overkill for most cases.
- Measure before tuning. Add a metric for batch size before changing `maxSize`. A common mistake is to triple `maxSize` and discover the size trigger was almost never firing — the time trigger was driving everything.

---

## Best Practices

- Always have **both** triggers. Never just size, never just time.
- Always make `maxDelay` configurable per environment. Test, staging, and production often want different values.
- Always pass a `context.Context` into the flush function so it can be cancelled. Even if you do not use it today, start with it.
- Never block the producer indefinitely. If your input channel can fill, decide *now* whether to drop, block, or grow — and document the decision.
- Document the latency budget your time trigger consumes. "This batcher adds up to 50 ms of latency to every item" should be in the package doc.
- Always flush on shutdown. A batcher that loses the last batch is a batcher that loses data every deploy.
- Emit metrics: batch size, flush latency, flush reason, queue depth, dropped items (if you drop). These four numbers are the difference between a fragile batcher and a maintainable one.
- Write a test for the size trigger, a test for the time trigger, and a test for empty close. These three tests catch 80% of regressions.
- Pin the order of trigger checks. Always check size after appending, time after waking on tick. If you reverse them you can introduce subtle bugs.
- Always copy the buffer before handing it to the sink. The cost is `O(N)` writes; the bug is silent and catastrophic.

---

## Edge Cases and Pitfalls

### The "stuck-at-N-minus-1" bug

If your `maxSize` is 100 and you receive 99 items, then no more, those 99 sit there forever — unless you have the time trigger. This is the canonical reason to always have both triggers.

### The "flush during flush" question

What happens if `flush` is slow and items keep arriving? In our junior implementation, items pile up in the input channel until it fills, then producers block. That is correct behaviour — backpressure — but it does mean a slow flush stalls producers. The `middle.md` file discusses how to overlap flush with accumulation.

### The "ticker drifts" trap

`time.Ticker` fires on a fixed schedule, not "D after the last flush". If a flush took 200 ms and the ticker is 100 ms, the next tick may already be queued when the flush finishes. For a junior batcher this is fine. For a precise time trigger, use `time.Timer` reset on each flush. We saw both above.

### The "missed tick" trap

`time.Ticker`'s channel has buffer 1. If your consumer is busy in a flush, multiple ticks can queue up. When `select` finally reaches the `<-ticker.C` branch, only one of those ticks is consumed; the rest are dropped. This is documented behaviour, not a bug, but it can confuse newcomers.

### Closing the channel from a producer

If a producer closes the input channel, the batcher exits — but other producers panic on their next send. **Only the owner closes the channel**, and the owner is the orchestrator, not any producer. The batcher's `Close` method enforces this.

### `maxDelay == 0`

`time.NewTicker(0)` panics. Always validate the configuration:

```go
if maxDelay <= 0 {
    panic("batcher: maxDelay must be positive")
}
if maxSize <= 0 {
    panic("batcher: maxSize must be positive")
}
```

Or, better, return an error from `NewBatcher`.

### `maxSize == 1`

The batcher flushes on every `Add`. It is a degenerate "batcher" that is just a goroutine indirection. It costs more than calling `sink.Write` directly because of the channel hop. Almost never what you want.

### A panic in the sink

If `sink.Write` panics, our `defer close(b.done)` still runs but the channel stays open. Subsequent `Add` calls block forever. Recover inside `flush` (or run the whole loop under recover, depending on policy).

### Shutdown ordering

If you call `b.Close()` from the same goroutine that is still calling `b.Add(...)`, you will hang. The producer is sending on the channel, the batcher is waiting for the channel to close, but the channel only closes when the producer stops sending and the orchestrator calls `Close`. This is a special case of "do not deadlock by ordering". The fix is to ensure all producers have finished — via `WaitGroup` — before `Close`.

### Loss on crash

A batcher's items are durable only when they reach the sink. If the process crashes between `Add` and `flush`, those items are gone. If your sink is itself unreliable (Kafka with no acks), they can be gone even after `flush`. Treat "in-buffer" items as not-yet-durable and design the upstream accordingly (idempotent retries, at-least-once delivery, dead-letter queue for re-processing).

---

## Common Mistakes

1. **Only one trigger.** "I have a size trigger, that is enough." It is not; low traffic exposes the bug.
2. **Forgetting to flush on close.** The buffer has pending items; the program exits; they are gone. Always flush on shutdown.
3. **Sharing the buffer with the sink.** The sink keeps a reference and reads from it later; the batcher reuses the slice; the sink sees garbage. Always copy.
4. **Unbounded input channel.** `make(chan T)` (or `make(chan T, 1_000_000)`) hides backpressure until OOM.
5. **Producer calls `close(b.in)`.** Now another producer's `Add` panics. Always centralise closes.
6. **No metric on batch size.** When throughput regresses, you have no way to know whether the size trigger is firing or the time trigger.
7. **No metric on flush latency.** The downstream gets slower; your producers slow down; you have no insight into where the time is going.
8. **`select` over only one channel** — losing the trigger structure. If you find yourself writing `for x := range b.in` you have given up on the time trigger.
9. **Flushing inside a mutex.** A common refactor: someone adds a mutex around the buffer "to be safe", then `flush` is called with the mutex held, and the entire system blocks on the downstream call. Single-ownership avoids this entirely.
10. **Forgetting `ticker.Stop()`.** A goroutine leak that masquerades as a memory leak.
11. **Re-using `buf` after handing to the sink.** Same as #3 stated differently: if the sink stores the slice and you `buf = buf[:0]` and `append`, the sink sees garbage.
12. **`Add` returning before the item is enqueued.** A `select` with default that drops silently looks like `Add` succeeded. Rename it to `TryAdd` if you want that semantics.

---

## Common Misconceptions

- **"Batching adds latency, so it is bad for user-facing APIs."** Only true if the API waits for the batch to flush. Audit logs, metrics, and notifications can be async; the API returns immediately.
- **"Bigger batches are always better."** False. There is a knee in the curve. Above some size, downstream latency increases faster than throughput, and the per-batch failure cost grows.
- **"A batcher needs a mutex around the buffer."** Not if exactly one goroutine touches it.
- **"A batcher with `linger.ms = 0` is not a batcher."** False. Even with no waiting, items arriving in the same scheduling window are still batched. The size trigger still fires; the time trigger just fires immediately on the next tick.
- **"Channels are slow, so the batcher overhead is high."** Channels cost on the order of 50–100 ns per send-receive pair on modern hardware. Compared to a 1 ms Postgres round-trip, the channel overhead is in the noise.
- **"Two batchers in series are equivalent to one."** No. The intermediate stage adds latency without adding amortisation if the second batcher's size trigger never fires. Resist this design.
- **"If the sink supports streaming, batching is pointless."** Streaming reduces per-call cost, not per-item cost. Batching can still help by amortising context switches and giving the kernel larger send-msg chunks.

---

## Tricky Points

- The size trigger should fire when `len(buf) >= maxSize`, *after* the append, not before. If you check before, you either flush a batch of `maxSize - 1` and lose the new item, or grow past max.
- The time trigger should *not* flush an empty buffer. Wasted call, wasted log line, wasted metric event.
- `select` is randomised among ready cases. If both `input` and `ticker.C` are ready, the choice is unpredictable. This usually does not matter, but if you ever debug a "missing tick", that is why.
- `close(b.in)` is what tells the loop "no more items". A `done` channel is what the *outside* uses to wait for the loop to exit. Two channels, two directions, two different responsibilities.
- The compiler does not warn you about `_ = sink.Write(...)`. Silent error discards are valid Go. Be deliberate.
- `time.Ticker.C` has a buffer of 1. Two ticks queued look like one to the consumer.
- `time.Timer` requires drain-before-reset. The pattern is `if !t.Stop() { <-t.C }; t.Reset(d)`. Forgetting the drain gives you a spurious tick. Go 1.23 relaxed this for some cases.
- Buffers that grow above `maxSize` are valid Go but indicate a bug. `cap(buf)` may be larger than `maxSize` after a single oversized batch; the next `buf = buf[:0]` keeps the larger capacity, so memory stays high. Consider rebuilding the buffer if it grew beyond expected size.
- On Go 1.22+ the per-iteration loop-variable scoping eliminates the classic capture bug, but old habits and old code still apply.

---

## Test

A test for the size trigger:

```go
func TestSizeTrigger(t *testing.T) {
    sink := &Sink{}
    b := NewBatcher(sink, 3, time.Hour) // huge delay so only size can fire
    for i := 0; i < 6; i++ {
        b.Add(i)
    }
    b.Close()
    if got := sink.Count(); got != 2 {
        t.Fatalf("expected 2 size-triggered batches, got %d", got)
    }
}
```

A test for the time trigger:

```go
func TestTimeTrigger(t *testing.T) {
    sink := &Sink{}
    b := NewBatcher(sink, 1000, 50*time.Millisecond)
    b.Add(1)
    b.Add(2)
    time.Sleep(150 * time.Millisecond)
    b.Close()
    if got := sink.Count(); got < 1 {
        t.Fatalf("expected at least one time-triggered flush, got %d", got)
    }
}
```

A test for empty close:

```go
func TestEmptyClose(t *testing.T) {
    sink := &Sink{}
    b := NewBatcher(sink, 10, time.Hour)
    b.Close()
    if got := sink.Count(); got != 0 {
        t.Fatalf("expected 0 flushes on empty close, got %d", got)
    }
}
```

A test for partial close:

```go
func TestPartialClose(t *testing.T) {
    sink := &Sink{}
    b := NewBatcher(sink, 100, time.Hour)
    for i := 0; i < 7; i++ {
        b.Add(i)
    }
    b.Close()
    if got := sink.Count(); got != 1 {
        t.Fatalf("expected 1 close-triggered flush, got %d", got)
    }
    if got := sink.Total(); got != 7 {
        t.Fatalf("expected 7 items, got %d", got)
    }
}
```

A test for concurrent producers:

```go
func TestConcurrentProducers(t *testing.T) {
    sink := &Sink{}
    b := NewBatcher(sink, 50, 10*time.Millisecond)
    var wg sync.WaitGroup
    for w := 0; w < 10; w++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for i := 0; i < 100; i++ {
                b.Add(i)
            }
        }()
    }
    wg.Wait()
    b.Close()
    if got := sink.Total(); got != 1000 {
        t.Fatalf("expected 1000 items, got %d", got)
    }
}
```

Run all four with `go test -race`. Race-free, deterministic, fast — exactly what a unit test should be.

---

## Tricky Questions

**Q: What does the batcher do if `maxSize` is 1?**
A: It flushes on every `Add` — a degenerate "batcher" that is just a goroutine indirection. It costs more than calling `sink.Write` directly because of the channel hop. Real batchers have `maxSize >= 10` to make the cost worthwhile.

**Q: Can two flushes overlap?**
A: In the junior implementation, no — the run loop is single-threaded. In production batchers we often overlap flush with accumulation; that is `middle.md`.

**Q: What if the producer is faster than the batcher?**
A: The input channel fills, the next `Add` blocks. That is backpressure. Whether to convert it to drop-on-floor or queue-grow is a policy decision documented in `01-backpressure`.

**Q: Why a `done` channel?**
A: Because `close(b.in)` returns immediately; we need a way for `Close()` to wait until the loop has actually flushed and exited. The `done` channel closes from inside the loop on exit.

**Q: What happens if I call `Close` twice?**
A: `close(b.in)` panics on the second call. Add a `sync.Once` if your callers might do that:

```go
type Batcher struct {
    closeOnce sync.Once
    // ...
}
func (b *Batcher) Close() {
    b.closeOnce.Do(func() {
        close(b.in)
    })
    <-b.done
}
```

**Q: What happens if the ticker fires while a flush is in progress?**
A: In our implementation, the run loop is busy in the `case item` branch executing `flush`, so the `case <-ticker.C` cannot be selected. The tick queues (buffer 1) and is consumed on the next iteration. The buffer is empty at that point, so the time-triggered branch sees `len(buf) == 0` and skips. No bug.

**Q: Can `flush` and `Add` race on `buf`?**
A: No. `flush` is called only from inside `run`, and `run` is single-threaded. The only way to race on `buf` is to expose it; do not.

**Q: How do I make sure `Close` is always called?**
A: Either:
- Use `defer b.Close()` in `main`.
- Wire it to a `signal.Notify` for `SIGTERM`/`SIGINT`.
- Let the orchestrator (lifecycle library, fx, wire, etc.) call it.

Forgetting to call `Close` means the last partial batch is lost. Critical.

**Q: If I have 10 batchers, do I need 10 ticker goroutines?**
A: Each `time.NewTicker` registers with the runtime timer heap; it does *not* spawn a goroutine. So you can have thousands of tickers cheaply. The runtime fires them all from a small set of internal helpers.

**Q: Can the batcher flush less than `maxSize` if `maxSize` is reached during shutdown?**
A: Yes. On `Close`, whatever is in the buffer flushes regardless of size. That is the point of the close-triggered flush.

**Q: What happens if I `Add` after `Close`?**
A: Send on a closed channel panics. Document this; callers must coordinate.

---

## Cheat Sheet

```
// Triggers
size:  flush when len(buf) >= MaxBatchSize  (after append)
time:  flush when ticker fires AND len(buf) > 0
close: flush remaining items on Close

// Buffer
make([]T, 0, MaxBatchSize); reset by buf = buf[:0]

// Concurrency
one goroutine owns the buffer; producers send on channel

// Shutdown
close(input) -> loop drains remaining -> close(done)
caller calls Close() -> blocks on <-done

// Tests
TestSizeTrigger:     huge delay, exact size, expect N/maxSize batches
TestTimeTrigger:     huge size, small delay, sleep > delay, expect >=1 batch
TestEmptyClose:      close immediately, expect 0 batches
TestPartialClose:    items < maxSize, close, expect 1 batch with remainder
TestConcurrent:      many producers, sum of items = expected total

// Metrics to emit
batch_size_items      (histogram)
flush_duration_ms     (histogram)
flush_reason          (counter, labeled: size|time|shutdown)
queue_depth           (gauge)
dropped_items         (counter, only if dropping)

// Pitfalls
- one trigger only: bug
- unbounded channel: bug
- producer-side close: bug
- shared buffer with sink: bug
- forget Close: bug (last batch lost)
- ticker.Stop missing: leak
```

---

## Self-Assessment Checklist

- [ ] I can write a batcher with size and time triggers from memory.
- [ ] I know why both triggers are necessary, with a worked example for each failure mode.
- [ ] I can explain why the buffer needs no mutex.
- [ ] I know what `buf = buf[:0]` does and why.
- [ ] I can write a test that proves the size trigger fires.
- [ ] I can write a test that proves the time trigger fires.
- [ ] I can write a test that proves the close trigger fires for a partial buffer.
- [ ] I can explain what happens on `Close` if the buffer is non-empty.
- [ ] I know the per-call versus per-item cost model and can decide whether batching helps for a given sink.
- [ ] I can identify a "stuck-at-N-minus-1" bug in someone else's code.
- [ ] I know how to avoid the "shared buffer with sink" bug.
- [ ] I can convert a `time.Ticker`-based time trigger into a `time.Timer`-based one and explain when each is preferable.
- [ ] I can explain "block, drop, or grow" and articulate which the junior batcher chooses and why.
- [ ] I know the four metrics every batcher should emit.
- [ ] I can list at least five common mistakes and explain how to fix each.

---

## Summary

A batcher is one goroutine, one buffer, one channel, one ticker. It collects items until size or time says "ship it", then hands the batch to a sink. The reason every Go service in production has one hidden somewhere is that it turns 50 000 small calls per second into 500 medium-sized ones — an order of magnitude less load on every downstream system, at the cost of a few tens of milliseconds of latency per item.

The hard parts at the junior level are:

- Picking both triggers (size and time), not just one.
- Flushing on shutdown so the last batch is not lost.
- Copying the buffer before handing it to the sink.
- Centralising channel close in the orchestrator, not in producers.
- Using `buf = buf[:0]` to avoid per-flush allocation.

You now know enough to write a working batcher and reason about its behaviour under both burst and idle traffic. The middle level adds production-grade shutdown, error handling, retries, observability, and integration with real sinks. The senior level adds adaptive sizing, latency budgeting, and architectural composition with backpressure and worker pools. The professional level dives into the implementation of Kafka's producer client and Postgres' COPY protocol so you can tune them with full understanding.

---

## What You Can Build

- A standalone batcher library that wraps any sink (database, HTTP, Kafka stub) and exposes `Add`, `Close`, and a metric stream.
- A buffered audit-log writer for a small web service that flushes 100 rows per INSERT or every second.
- A metrics aggregator that emits one statsd packet per second instead of one per increment.
- A "save-game" buffer in a game server that flushes player state every 100 writes or every 10 seconds.
- A simple log shipper that buffers stdout lines and posts them to a remote endpoint every 5 seconds.
- A notification debouncer that combines "5 new followers" into one push instead of five.

---

## Further Reading

- The Go blog: *Go Concurrency Patterns* (Pike, 2012) — channel patterns including pipelines that prefigure batchers.
- The Go blog: *Advanced Go Concurrency Patterns* (Cox, 2013) — `select` and timer patterns you will use here.
- Kafka documentation: `linger.ms` and `batch.size` — the canonical real-world batcher, and the configuration knobs that everyone has touched at least once.
- The `database/sql` documentation on multi-row INSERT and prepared statements.
- The `pgx` documentation on `CopyFrom` — Postgres' fastest bulk insert path.
- Elasticsearch documentation on the `_bulk` endpoint — the canonical HTTP batch API.
- The OpenTelemetry Go SDK source: `sdktrace/batch_span_processor.go` — a production-grade batcher in ~300 lines.
- The next file: `middle.md` — production-ready shutdown, partial flush, retries, and real-world integration.

---

## Related Topics

- `01-backpressure` — what to do when producers outrun the batcher.
- `02-dynamic-worker-scaling` — how many goroutines should consume in parallel.
- `04-graceful-shutdown` — the broader contract that close-on-`SIGTERM` participates in.
- `05-drain-pattern` — what to do with the in-flight queue when shutting down.
- `16-time-based-concurrency/01-ticker` — the prerequisite ticker mechanics.
- `16-time-based-concurrency/02-afterfunc` — `time.AfterFunc` as an alternative time trigger.
- `06-errgroup-x-sync/01-errgroup` — the standard tool for waiting on producer goroutines.
- `04-context-package` — for cancelling slow flushes.
- `02-channels/06-closing-channels` — the rules around `close` that govern who can close `b.in`.
- `17-goroutine-pools-3rd-party/01-ants` — a pool that often sits in front of a batcher.

---

## Step-by-Step: Build a Batcher From Nothing

This section walks through writing a batcher one step at a time so you can build the intuition by motion, not by reading. Open an editor, create a new file `batcher.go`, and follow along.

### Step 1: The Sink Interface

Start with the smallest possible interface:

```go
package main

type Sink interface {
    Write(batch []int) error
}
```

That is it. The batcher's only contract with the world is "I will call `Write` with a slice of items, and I will respect the error it returns." Anything more elaborate — context, partial results, metrics — comes later.

### Step 2: The No-Op Batcher

Now write the simplest "batcher" possible. It is not really a batcher; it just forwards every item.

```go
type NoBatcher struct{ sink Sink }

func (n *NoBatcher) Add(item int) error {
    return n.sink.Write([]int{item})
}
```

Run it against the `Sink` from the Postgres-like example with `callLatency = 5 ms`. 1000 items take 5 seconds. The slowest possible "batcher" — useful as a baseline.

### Step 3: Size-Only Batcher

Add a slice buffer and a size trigger.

```go
type SizeBatcher struct {
    sink    Sink
    maxSize int
    buf     []int
}

func (s *SizeBatcher) Add(item int) error {
    s.buf = append(s.buf, item)
    if len(s.buf) >= s.maxSize {
        return s.flush()
    }
    return nil
}

func (s *SizeBatcher) flush() error {
    if len(s.buf) == 0 {
        return nil
    }
    err := s.sink.Write(s.buf)
    s.buf = s.buf[:0]
    return err
}

func (s *SizeBatcher) Close() error { return s.flush() }
```

This works but is **single-threaded** — concurrent callers will race on `buf`. Run it under `-race` to see the report. We will fix that in step 5.

It also has the "stuck-at-N-minus-1" bug: if the producer sends 99 items and stops, the batcher never flushes. The fix is the time trigger, coming in step 4.

### Step 4: Adding the Time Trigger

The time trigger requires a goroutine, because no producer call is going to wake us up at the deadline. We need a separate consumer.

```go
type TimedBatcher struct {
    sink     Sink
    maxSize  int
    maxDelay time.Duration
    in       chan int
    done     chan struct{}
}

func New(sink Sink, maxSize int, maxDelay time.Duration) *TimedBatcher {
    t := &TimedBatcher{
        sink: sink, maxSize: maxSize, maxDelay: maxDelay,
        in:   make(chan int, 1024),
        done: make(chan struct{}),
    }
    go t.run()
    return t
}

func (t *TimedBatcher) Add(item int) { t.in <- item }

func (t *TimedBatcher) run() {
    defer close(t.done)
    buf := make([]int, 0, t.maxSize)
    ticker := time.NewTicker(t.maxDelay)
    defer ticker.Stop()
    for {
        select {
        case item, ok := <-t.in:
            if !ok {
                if len(buf) > 0 {
                    _ = t.sink.Write(buf)
                }
                return
            }
            buf = append(buf, item)
            if len(buf) >= t.maxSize {
                _ = t.sink.Write(buf)
                buf = buf[:0]
            }
        case <-ticker.C:
            if len(buf) > 0 {
                _ = t.sink.Write(buf)
                buf = buf[:0]
            }
        }
    }
}

func (t *TimedBatcher) Close() {
    close(t.in)
    <-t.done
}
```

This is the canonical junior batcher. It has both triggers, supports many concurrent producers, flushes on close. Run it under `-race` — clean.

### Step 5: Defensive Copy

Replace `t.sink.Write(buf)` with the copy idiom:

```go
batch := make([]int, len(buf))
copy(batch, buf)
_ = t.sink.Write(batch)
```

Now the sink can hold the slice as long as it likes; the next `buf = buf[:0]; append(buf, ...)` will not corrupt it.

### Step 6: Error Logging

Replace `_ = t.sink.Write(batch)` with:

```go
if err := t.sink.Write(batch); err != nil {
    log.Printf("batcher: flush of %d items failed: %v", len(batch), err)
}
```

Silent error drops are a junior anti-pattern that becomes a senior incident.

### Step 7: Validation

Add input validation to `New`:

```go
func New(sink Sink, maxSize int, maxDelay time.Duration) (*TimedBatcher, error) {
    if sink == nil {
        return nil, errors.New("batcher: sink is nil")
    }
    if maxSize <= 0 {
        return nil, errors.New("batcher: maxSize must be positive")
    }
    if maxDelay <= 0 {
        return nil, errors.New("batcher: maxDelay must be positive")
    }
    // ... rest
}
```

`time.NewTicker(0)` panics, so the maxDelay check is not just hygiene.

### Step 8: Idempotent Close

```go
type TimedBatcher struct {
    // ...
    closeOnce sync.Once
}

func (t *TimedBatcher) Close() {
    t.closeOnce.Do(func() {
        close(t.in)
    })
    <-t.done
}
```

Now `Close` is safe to call any number of times. Repeated calls are no-ops; the second caller just waits for `done`.

### Step 9: Reason-Tagged Flushes

```go
flush := func(reason string) {
    if len(buf) == 0 {
        return
    }
    log.Printf("batcher: flush reason=%s size=%d", reason, len(buf))
    batch := make([]int, len(buf))
    copy(batch, buf)
    if err := t.sink.Write(batch); err != nil {
        log.Printf("batcher: flush failed: %v", err)
    }
    buf = buf[:0]
}
```

When we add metrics in middle.md, this single change is what makes "what fraction of flushes are time-triggered?" trivially queryable.

### Step 10: Stop the Ticker

The `defer ticker.Stop()` is already there. Verify it. If you forget it, the goroutine leaks every time you create a batcher and discard it without `Close`.

### Step 11: Write the Three Canonical Tests

We have them above. Run them. They should all pass.

### Step 12: Profile and Tune

Run a benchmark:

```go
func BenchmarkBatcher(b *testing.B) {
    sink := &Sink{}
    bat := New(sink, 100, 10*time.Millisecond)
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        bat.Add(i)
    }
    bat.Close()
}
```

Compare against the `NoBatcher` baseline. Compare with `maxSize` of 10, 100, 1000. Plot the curve. You should see the throughput-vs-size knee that the diagram earlier sketched.

That is the whole junior journey: 12 steps, ~50 lines of code, and a working production-quality batcher.

## Worked Example: A Postgres-Like Sink

Let us extend the in-memory sink to simulate a realistic database. We will add per-call latency, per-item cost, and an occasional failure, so we can see how the batcher behaves under realistic conditions.

```go
package main

import (
    "errors"
    "math/rand"
    "sync"
    "time"
)

type DBSink struct {
    callLatency time.Duration
    perItemCost time.Duration
    failureRate float64 // 0..1
    mu          sync.Mutex
    written     int
    calls       int
    failures    int
}

func (d *DBSink) Write(batch []int) error {
    time.Sleep(d.callLatency + time.Duration(len(batch))*d.perItemCost)
    d.mu.Lock()
    defer d.mu.Unlock()
    d.calls++
    if rand.Float64() < d.failureRate {
        d.failures++
        return errors.New("simulated db error")
    }
    d.written += len(batch)
    return nil
}
```

Drive it under three configurations:

```go
func bench(name string, sink interface{ Write([]int) error }, n int) {
    t := time.Now()
    for i := 0; i < n; i++ {
        _ = sink.Write([]int{i})
    }
    elapsed := time.Since(t)
    fmt.Printf("%s: %v for %d items\n", name, elapsed, n)
}
```

Run it. With `callLatency = 5 ms`, `perItemCost = 10 µs`, you see:

- Per-item (unbatched): about 5 s for 1000 items.
- Batched 100 per call: about 60 ms for 1000 items.
- Batched 1000 per call: about 15 ms for 1000 items.

The batched-1000 case shows the per-item cost dominating; the per-call cost has been almost completely amortised. Going from 100 to 1000 only saves another 45 ms; going from 1 to 100 saved 4.94 seconds. That is the curve in the diagram earlier.

## Worked Example: A Notifications Combiner

Some batchers combine items rather than just grouping them. A "you have N new messages" digest is the canonical example: instead of flushing N separate notifications, you flush one notification per recipient with a count.

```go
type Combiner struct {
    in       chan string // recipient
    maxDelay time.Duration
    done     chan struct{}
    sink     func(recipient string, count int)
}

func (c *Combiner) run() {
    defer close(c.done)
    counts := map[string]int{}
    ticker := time.NewTicker(c.maxDelay)
    defer ticker.Stop()
    flush := func() {
        for r, n := range counts {
            c.sink(r, n)
        }
        counts = map[string]int{}
    }
    for {
        select {
        case r, ok := <-c.in:
            if !ok {
                flush()
                return
            }
            counts[r]++
        case <-ticker.C:
            if len(counts) > 0 {
                flush()
            }
        }
    }
}
```

Now sending 100 "user followed" events for the same recipient within the window produces one push: "you have 100 new followers". The size trigger is gone here because the value of batching is in *combining*, not just grouping — there is no hard cap on the map size, only the time window.

This kind of batcher is everywhere: rate-limited alerts, debounced UI updates, "compact" log lines that fold repeated entries. It shares the structure of the basic batcher but exchanges the slice buffer for a map and the size trigger for nothing or for a cap on map size.

## Worked Example: Per-Tenant Sub-Batches

A real system often has multiple downstreams or multiple shards. A batcher that mixes items from many tenants into one INSERT loses tenant isolation — a single bad row from tenant A can fail the whole batch including tenant B's rows.

The fix is to keep one sub-buffer per tenant and flush them independently:

```go
type ShardedBatcher struct {
    in       chan Item
    maxSize  int
    maxDelay time.Duration
    sinks    map[string]Sink // one per tenant
    done     chan struct{}
}

type Item struct {
    Tenant string
    Body   []byte
}

func (s *ShardedBatcher) run() {
    defer close(s.done)
    bufs := map[string][]Item{}
    ticker := time.NewTicker(s.maxDelay)
    defer ticker.Stop()
    flush := func(tenant string) {
        if len(bufs[tenant]) == 0 {
            return
        }
        _ = s.sinks[tenant].Write(bufs[tenant])
        bufs[tenant] = bufs[tenant][:0]
    }
    flushAll := func() {
        for t := range bufs {
            flush(t)
        }
    }
    for {
        select {
        case item, ok := <-s.in:
            if !ok {
                flushAll()
                return
            }
            bufs[item.Tenant] = append(bufs[item.Tenant], item)
            if len(bufs[item.Tenant]) >= s.maxSize {
                flush(item.Tenant)
            }
        case <-ticker.C:
            flushAll()
        }
    }
}
```

This is the same shape as the basic batcher but with one buffer per shard key. Production data pipelines extend this pattern with bounded per-tenant memory, fairness quotas, and per-tenant time triggers (so a quiet tenant does not have its tiny batch starve next to a noisy one). We cover the fairness aspect in `senior.md`.

## Worked Example: An HTTP Bulk Endpoint Client

The classic non-database batcher is an HTTP bulk endpoint. Here is a stub of an Elastic `_bulk`-style client:

```go
type BulkClient struct {
    url      string
    client   *http.Client
    in       chan json.RawMessage
    maxSize  int
    maxBytes int
    maxDelay time.Duration
    done     chan struct{}
}

func (b *BulkClient) run() {
    defer close(b.done)
    var buf bytes.Buffer
    var count int
    ticker := time.NewTicker(b.maxDelay)
    defer ticker.Stop()
    flush := func() {
        if count == 0 {
            return
        }
        req, _ := http.NewRequest("POST", b.url, bytes.NewReader(buf.Bytes()))
        req.Header.Set("Content-Type", "application/x-ndjson")
        resp, err := b.client.Do(req)
        if err == nil {
            resp.Body.Close()
        }
        buf.Reset()
        count = 0
    }
    for {
        select {
        case doc, ok := <-b.in:
            if !ok {
                flush()
                return
            }
            buf.Write(doc)
            buf.WriteByte('\n')
            count++
            if count >= b.maxSize || buf.Len() >= b.maxBytes {
                flush()
            }
        case <-ticker.C:
            flush()
        }
    }
}
```

Notice the *two* size triggers: count of items, and total byte size. HTTP endpoints often have body-size limits (10 MB is typical), so you need to flush when either limit is reached. This is the natural generalisation of the size trigger and a hint of the design space we will explore in middle.md.

## A Walkthrough: Tracing the Run Loop

Let us trace what happens during 1 second of operation with `maxSize = 5`, `maxDelay = 100 ms`, and 30 items per second arriving at a uniform rate:

- `t = 0`: batcher started, buf = [], ticker ticks at 100, 200, 300, ...
- `t = 33`: Add(0). buf = [0]. No size trigger.
- `t = 66`: Add(1). buf = [0, 1]. No size trigger.
- `t = 100`: tick. buf = [0, 1] -> flush. buf = []. *time trigger fires*.
- `t = 100`: Add(2). buf = [2].
- `t = 133`: Add(3). buf = [2, 3].
- ...
- `t = 200`: tick. buf = [2, 3, 4, 5] (4 items since last flush). Flush.
- ...

Every flush is a time trigger because at 30 items/second we never accumulate 5 items in 100 ms. Throughput: 30 items/s, 10 flushes/s, average batch size 3.

Now bump traffic to 1000 items per second:

- `t = 0`: Add(0). buf = [0].
- `t = 1`: Add(1). buf = [0, 1].
- ...
- `t = 4`: Add(4). buf = [0..4]. Size trigger! Flush. buf = [].
- `t = 5`: Add(5). buf = [5].
- ...

Every flush is now a size trigger. Average batch size 5, flushes/s = 200. The time trigger almost never fires.

This is exactly the behaviour you want: low traffic uses the time trigger to bound latency; high traffic uses the size trigger to maximise throughput. The flush-reason metric makes the transition visible — and the moment it switches is the moment your service is "warming up".

## When Two Triggers Are Not Enough

Some workloads need a third trigger:

- **Byte size**: HTTP bulk endpoints. We saw it above.
- **Memory pressure**: if your buffer holds large payloads, you may want to flush early when memory is tight.
- **Deduplication**: if many items combine into one downstream call (the combiner pattern), you may want to flush when the dedup count is high.
- **Per-tenant fairness**: a third trigger to prevent one tenant from monopolising flushes.

These are mostly senior-level concerns. For junior code, two triggers is always enough.

## Cleaning Up: The Full Final Junior Code

Putting it all together, here is the full code for a junior-grade batcher with everything we have discussed:

```go
package batcher

import (
    "context"
    "errors"
    "log"
    "sync"
    "time"
)

var ErrClosed = errors.New("batcher: closed")

type Sink interface {
    Write(ctx context.Context, batch []int) error
}

type Batcher struct {
    in       chan int
    sink     Sink
    maxSize  int
    maxDelay time.Duration
    done     chan struct{}
    closeOnce sync.Once
    closeCh  chan struct{}
}

func New(sink Sink, maxSize int, maxDelay time.Duration) (*Batcher, error) {
    if sink == nil {
        return nil, errors.New("batcher: sink is nil")
    }
    if maxSize <= 0 {
        return nil, errors.New("batcher: maxSize must be positive")
    }
    if maxDelay <= 0 {
        return nil, errors.New("batcher: maxDelay must be positive")
    }
    b := &Batcher{
        in:       make(chan int, 1024),
        sink:     sink,
        maxSize:  maxSize,
        maxDelay: maxDelay,
        done:     make(chan struct{}),
        closeCh:  make(chan struct{}),
    }
    go b.run()
    return b, nil
}

func (b *Batcher) Add(ctx context.Context, item int) error {
    select {
    case <-b.closeCh:
        return ErrClosed
    default:
    }
    select {
    case b.in <- item:
        return nil
    case <-ctx.Done():
        return ctx.Err()
    case <-b.closeCh:
        return ErrClosed
    }
}

func (b *Batcher) run() {
    defer close(b.done)
    defer func() {
        if r := recover(); r != nil {
            log.Printf("batcher: panic: %v", r)
        }
    }()
    buf := make([]int, 0, b.maxSize)
    ticker := time.NewTicker(b.maxDelay)
    defer ticker.Stop()
    flush := func(reason string) {
        if len(buf) == 0 {
            return
        }
        batch := make([]int, len(buf))
        copy(batch, buf)
        ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
        err := b.sink.Write(ctx, batch)
        cancel()
        if err != nil {
            log.Printf("batcher: flush(%s) of %d items failed: %v", reason, len(batch), err)
        }
        buf = buf[:0]
    }
    for {
        select {
        case item, ok := <-b.in:
            if !ok {
                flush("shutdown")
                return
            }
            buf = append(buf, item)
            if len(buf) >= b.maxSize {
                flush("size")
            }
        case <-ticker.C:
            flush("time")
        }
    }
}

func (b *Batcher) Close() {
    b.closeOnce.Do(func() {
        close(b.closeCh)
        close(b.in)
    })
    <-b.done
}
```

This is a real, production-acceptable junior batcher. It is missing retries, observability, partial-flush semantics, and adaptive sizing — but it correctly handles every junior-level pitfall: input validation, double-close, idempotent Add-after-Close, context cancellation, panic recovery, and the basic shutdown drain.

Sit with this code. Read it three times. Trace each branch. The middle and senior files build on this exact shape.

---

## Mini-Project: Build, Measure, Tune

Spend an hour on this and you will graduate from "I read about batchers" to "I have built and tuned one".

### The Build (15 minutes)

Type the junior batcher from scratch (no copy-paste from this file). Implement:

- `Sink` interface with `Write(batch []int) error`.
- `Batcher` struct with `Add`, `Close`, internal `run`.
- Size trigger, time trigger, close trigger.

Compile, run a smoke test that sends 10 items and verifies they all arrive at the sink.

### The Measure (20 minutes)

Add an `HTTPSink` that simulates a real downstream:

```go
type HTTPSink struct {
    latency time.Duration
    mu      sync.Mutex
    calls   int
    items   int
}

func (h *HTTPSink) Write(batch []int) error {
    time.Sleep(h.latency)
    h.mu.Lock()
    h.calls++
    h.items += len(batch)
    h.mu.Unlock()
    return nil
}
```

Drive 10 000 items into the batcher under five configurations:

1. `(1, 1 ms)`: degenerate, no batching.
2. `(10, 100 ms)`: minimal batching.
3. `(100, 100 ms)`: typical.
4. `(1000, 100 ms)`: heavy batching.
5. `(10000, 100 ms)`: enormous batching.

For each, measure:

- Total wall-clock time to flush all 10 000 items.
- Number of calls to the sink.
- Average batch size.
- p99 per-item latency (time from `Add` return to flush start).

Plot the four values vs the configuration. You should see throughput plateau at config 3 or 4, and latency rise at config 5.

### The Tune (25 minutes)

For your service's real downstream (or a realistic stand-in), find the knee:

1. Start with `(1, 5 ms)` and double `maxSize` each run.
2. At each step, measure throughput and p99 latency.
3. Stop when throughput stops improving or p99 latency exceeds your budget.
4. The last "good" configuration is your starting point for production.

This is the workflow every senior engineer follows when introducing a new batcher. The artifact is a small JSON file or notebook with the measurements; the conclusion is one number: "we chose maxSize = X because the throughput at X+1 is within 5% of X and latency is 2 ms higher".

The discipline of measuring before deploying is the difference between a batcher that works on day one and a batcher that takes three incidents to tune.

## Latency Anatomy of a Single Item

Trace one item from `Add` to durability:

1. **Enqueue** (`b.in <- item`): under low load, ~50 ns. Under saturation, can block for milliseconds while the channel is full.
2. **In the queue** (waiting in the channel): up to `cap(b.in)` items ahead of it. At 1 ms drain time per batch and `cap = 1024`, worst case ~1 ms before being received.
3. **Receive** (`<-b.in`): another 50 ns.
4. **In the buffer** (waiting for trigger): up to `maxDelay`. This is the dominant latency contributor for low traffic.
5. **Flush call** (`sink.Write`): `C_call + N * C_item`. Dominant for high traffic.
6. **Sink-side processing**: not counted in batcher latency but real for end-to-end.

For an "average" item under a 100 ms `maxDelay` and 5 ms `C_call`, latency is dominated by step 4 (up to 100 ms) at low traffic and step 5 (~5 ms) at high traffic. The crossover happens at the arrival rate where the buffer fills before the timer fires.

The total per-item latency p99 is approximately `max(maxDelay, batch_flush_time)`. Tune accordingly.

## Variation: A Batcher Without a Channel

For completeness, here is a mutex-based batcher. Same triggers, same shutdown, but no goroutine.

```go
type MutexBatcher struct {
    mu       sync.Mutex
    buf      []int
    sink     Sink
    maxSize  int
    maxDelay time.Duration
    timer    *time.Timer
    closed   bool
}

func (m *MutexBatcher) Add(item int) error {
    m.mu.Lock()
    defer m.mu.Unlock()
    if m.closed {
        return ErrClosed
    }
    m.buf = append(m.buf, item)
    if len(m.buf) == 1 {
        m.timer = time.AfterFunc(m.maxDelay, m.timeFlush)
    }
    if len(m.buf) >= m.maxSize {
        m.flushLocked("size")
    }
    return nil
}

func (m *MutexBatcher) timeFlush() {
    m.mu.Lock()
    defer m.mu.Unlock()
    if !m.closed {
        m.flushLocked("time")
    }
}

func (m *MutexBatcher) flushLocked(reason string) {
    if len(m.buf) == 0 {
        return
    }
    batch := make([]int, len(m.buf))
    copy(batch, m.buf)
    m.buf = m.buf[:0]
    if m.timer != nil {
        m.timer.Stop()
        m.timer = nil
    }
    // Release the lock during the slow sink call.
    m.mu.Unlock()
    _ = m.sink.Write(batch)
    m.mu.Lock()
}

func (m *MutexBatcher) Close() {
    m.mu.Lock()
    m.closed = true
    m.flushLocked("close")
    m.mu.Unlock()
}
```

This version is shorter (no run loop, no channel), but the lock dance in `flushLocked` is subtle: we release the lock during `sink.Write` so other producers can keep adding, then reacquire. If anything in that window changes (`closed` becomes true, the timer fires again), we have to handle it.

The channel-based version is preferred for almost every case. The mutex-based version is shown for completeness, and is the standard idiom for callback-driven contexts (CGo) where you cannot easily spawn a goroutine.

## Reading Code: Identify the Batcher in the Wild

When you read a Go codebase, you will encounter batchers under many names. Here are some you might recognise:

- **`BufferedWriter`**: usually a synchronous size-only batcher, no time trigger.
- **`Buffer`**: ambiguous; could be a batcher, could be just a slice.
- **`Aggregator`**: usually a combiner that sums or dedups.
- **`Accumulator`**: alias for "buffer that collects until flushed".
- **`BatchProcessor`**: a batcher integrated into a processing pipeline.
- **`AsyncWriter`**: a batcher that returns immediately on `Write`, like our `Add`.
- **`Collector`**: in Prometheus, this is something else — a metric source. In other libraries, a synonym for batcher.
- **`Backlog`** or **`Queue`**: usually the *channel* part of a batcher, without the size/time trigger logic.

Skill: when reading a function called `Flush` (or `Send` or `Submit` or `Drain`), ask "is this a batcher?". The tell is: does the function operate on a buffer of accumulated items, and does it have a size or time trigger? If yes, it is a batcher; the name is just convention.

## A Note on Logging vs Metrics

This file has mostly used `log.Printf` to surface events. In production, you would replace those with structured logging (`slog`, `zap`, `logrus`) and metrics (Prometheus counters/histograms).

The reason logging-first is appropriate at the junior level: log lines are zero-setup. You can read them with `grep`. Metrics require a metric server and a dashboard. The progression is:

1. Junior: log every flush with reason and size.
2. Middle: emit Prometheus metrics for batch size, latency, reason, queue depth.
3. Senior: dashboard, alerting, SLO tracking.
4. Professional: histograms with exemplars linked to traces.

But the data captured is the same — the medium is what evolves.

## Building Blocks: How Go's Concurrency Primitives Compose Here

A batcher is a textbook composition of Go's concurrency primitives. Knowing exactly which primitive does what lifts a junior to a middle. Let us name them.

### `chan T` (the input channel)

The channel does three things at once:

1. **Synchronisation**: the producer's send and the consumer's receive happen with a happens-before guarantee. Anything the producer wrote before the send is visible to the consumer after the receive.
2. **Queueing**: the buffer between producer and consumer. We chose `make(chan T, 1024)` to absorb small bursts without blocking.
3. **Signalling**: closing the channel tells the consumer "no more items".

If you tried to replace the channel with a slice plus a mutex plus a condition variable, you would replicate all three behaviours by hand. The channel is a packaged version.

### `select`

Choose one of several blocking operations. The batcher's `select` is over:

- `<-b.in`: an incoming item.
- `<-ticker.C`: a tick.

If both are ready, Go picks one at random. If neither, the goroutine blocks. There is no other primitive in Go (apart from spinning) that gives you "wait for any of N things".

The `default` clause would convert the select into non-blocking, which we do not want here. We want the consumer to *block* when there is nothing to do. That is why there is no `default`.

### `time.Ticker`

The runtime maintains a timer heap. `time.NewTicker(d)` adds an entry that fires every `d`. The fire is a send on the ticker's `C` channel. The channel is buffered with capacity 1, so if the consumer is slow, only one tick is queued at a time; the rest are silently coalesced.

Cost: about 200 ns per registered timer per fire, on modern hardware. You can have thousands of tickers in a process without trouble.

### `defer`

Two `defer`s in the run loop: `defer close(b.done)` and `defer ticker.Stop()`. Both run on goroutine exit, regardless of how the goroutine exits (return, panic, runtime termination). They are the safety net that makes the cleanup composable with anything else in the function.

### `sync.Once`

Used in `Close()` to make the channel close idempotent. Without `Once`, two callers of `Close()` would race; one wins the channel-close and the other panics with "close of closed channel".

### `sync.WaitGroup`

Used by the *orchestrator*, not by the batcher itself. The pattern is "Wait for producers, then Close the batcher". The batcher does not know about the WaitGroup; it just sees its input channel close.

### `context.Context`

Used to scope a flush call with a timeout. We add `ctx, cancel := context.WithTimeout(...)` around each flush. The flush is bounded in time; a slow downstream cannot wedge the batcher forever.

### `recover`

Used to handle panics inside `flush`. A panic in `sink.Write` would normally kill the goroutine; recovery turns it into a logged error. This is a safety belt, not a substitute for fixing the underlying sink bug.

### What This Composition Looks Like on a Whiteboard

If a senior engineer asks "draw a batcher on the whiteboard", the answer is:

```
   producers --send(channel)--+
                              |
                              v
                   +----------+-----------+
                   | consumer goroutine    |
                   |                       |
                   | select                |
                   |   case <-in:          |
                   |     append, size?     |
                   |   case <-ticker.C:    |
                   |     time?             |
                   |                       |
                   | flush(buf)            |
                   +----------+-----------+
                              |
                              v
                          [sink]
```

And the orchestrator on the side:

```
   shutdown --SIGTERM--> Close()
                            |
                            v
                       close(channel)
                            |
                            v
                       wait for done
```

Six boxes, eight arrows. That is everything.

## What Comes Next

The `middle.md` file picks up immediately. It introduces:

- **Graceful shutdown contracts** with deadlines.
- **Per-flush retry with exponential backoff** and how to compose it with the batcher.
- **Concrete sinks**: `database/sql` multi-row INSERT, `pgx.CopyFrom`, `franz-go`/`confluent-kafka-go` producer integration.
- **Observability**: Prometheus counters and histograms, the four metrics every batcher emits.
- **Double-buffer pattern**: overlap flush with accumulation for higher throughput.
- **Partial-flush semantics**: what to do with the half-built batch when the deadline strikes.
- **Choice of triggers**: third (byte size), fourth (per-tenant), fifth (manual).

You should be able to read middle.md without rereading junior.md as long as the cheat sheet here is in your head.

## A Tour Through Common Batcher Configurations

Some real-world examples of `(maxSize, maxDelay)` and why the values were chosen:

- **Postgres audit log**: (500, 1 s). 500 fits comfortably in a multi-row INSERT below the 8000-token query plan cache pressure. 1 s of audit-log latency is acceptable for non-realtime audit; the user does not need to see their action confirmed in the audit table.
- **Kafka producer for clickstream**: (10000 records or 16 KB, 5 ms). 16 KB matches the Kafka default `batch.size`. 5 ms is the `linger.ms`. Clickstream is high-volume, low-value-per-event; we want maximum throughput and we tolerate 5 ms latency.
- **Prometheus remote write**: (500 samples, 5 s). Prometheus' default. 500 is a balance between per-call overhead and the 1 MB body limit at typical sample sizes. 5 s is the longest acceptable lag for monitoring data — the next scrape will compensate.
- **Elastic `_bulk` shipper**: (5000 docs or 10 MB, 30 s). Elastic recommends 5–15 MB per bulk. 30 s is "ship every half-minute" for a batch ingestion pipeline.
- **statsd UDP sender**: (one packet, 100 ms). UDP packet size limits the count; 100 ms keeps the dashboard "live" enough for engineers staring at it.
- **In-memory event bus to subscribers**: (100 events, 10 ms). Micro-batching for animation; the UI is OK with 10 ms refresh.

There is no universal pair. The values come from the *downstream sink's* behaviour and the *upstream user's* tolerance for latency. Tune them with measurements, not with copy-paste.

## What the Specification.md File Will Add

If you read on to `specification.md`, you will see formalisation of:

- The batcher's invariants (e.g., "every item is either in the input channel, in the buffer, or has been handed to the sink — never in two places, never lost").
- The shutdown protocol (e.g., "after `Close()` returns, no items are in flight; the sink has received every item passed to `Add()` that returned nil").
- Ordering guarantees (e.g., "items arriving on a single channel are flushed in arrival order, within a batch and across batches").
- The contract between `Add` and `Close` (e.g., "Add after Close panics or returns ErrClosed; the implementation must document which").

These contracts are what you write down before you write code, in a design document. Then your code is graded against them.

## Anatomy of a Junior-Level Bug Report

Here is what a junior engineer's first batcher-related bug report often looks like, and how to read it.

> "The audit log is missing entries. The frontend logs show 50 requests but only 47 made it to the DB."

What you should ask:

1. **Is this every deploy, or specific deploys?** If every deploy, suspect shutdown semantics. If specific, suspect transient errors.
2. **What is the value of `maxDelay`?** If 100 ms and the user deployed within 100 ms of the latest event, missing items is expected unless `Close()` is wired up.
3. **What is the `flush_reason` metric showing in the seconds before the deploy?** If the last reason was `shutdown` and the count was 3, those 3 events were saved. If the last reason was `time` 99 ms before SIGTERM and there were 3 new events queued after that, those 3 are the missing ones.
4. **Is `Close()` actually called?** Check the shutdown path. `signal.Notify` should wire SIGTERM to a function that calls `batcher.Close()`.
5. **Is the sink synchronous?** If the sink is itself async (writes to its own buffer), `Close()` returns before items are durable. Make the sink synchronous on flush, or chain `Close` calls.

The investigation is mechanical once you know the shape of the bug. The shape is almost always: items arrived after the last flush, the batcher's buffer held them, the process exited without draining. The fix is wiring; the lesson is "always test shutdown".

## A Note on Memory Behaviour Under Burst

When traffic spikes, the input channel fills up. Producers block. The buffer fills to `maxSize` repeatedly and flushes. As long as the *flush rate* keeps up with the *arrival rate*, the system is stable.

Memory used by an idle batcher: roughly `cap(b.in) * sizeof(Item) + maxSize * sizeof(Item) + ticker overhead`. For a `chan int64` with cap 1024 and maxSize 100, that is `1024 * 8 + 100 * 8 + ~200 = 9176 bytes`. Tiny.

Memory used by a saturated batcher: same as idle, because the input channel is the bound. Items move through the channel into the buffer, get flushed, the memory is recycled.

Memory used by a batcher whose sink is *slower than arrival rate*: unstable. The input channel fills, but producers may also queue work elsewhere (in HTTP handlers, in worker pools), so memory accumulates *outside* the batcher. The batcher itself is bounded, but the system around it is not. This is why you must monitor end-to-end queue depth, not just batcher queue depth.

## Recap of the Decision Points

When designing a batcher, decide:

1. **`maxSize`**: how many items per flush. Sink-dependent, measured.
2. **`maxDelay`**: how long an item may wait. Latency-budget-dependent.
3. **Input channel capacity**: how much queue between producers and consumer. Memory-budget-dependent.
4. **Backpressure policy**: block, drop, or grow. Decided up front.
5. **Sink interface**: what does Write return? Single error or per-item results?
6. **Retry policy**: log, retry, dead-letter, crash.
7. **Shutdown policy**: drain or abort?
8. **Metrics**: which four (or more) to emit.
9. **Item value vs pointer**: by-value if small, by-pointer if large.
10. **Combiner vs grouper**: do you sum/dedupe, or just batch?

A junior batcher makes implicit decisions for 1–3 (defaults), conservative ones for 4–7 (block, return error, log, drain), basic for 8 (logged reason), and skips 9–10. The middle and senior files revisit all ten.

## Detailed Walk-Through of the `run` Loop

Let us go statement by statement through the canonical run loop, explaining what each line is for, what would happen without it, and what variations exist in the real world.

```go
func (b *Batcher) run() {
    defer close(b.done)
```

The `defer close(b.done)` is the signal to the outside world that the loop has exited. Without it, `Close()` would block forever on `<-b.done`. The `defer` ensures it fires even if the loop panics. We add a recovery in production code, but the defer comes first.

```go
    buf := make([]int, 0, b.maxSize)
```

Allocate the buffer with capacity equal to `maxSize`. The `len` is 0; the `cap` is `maxSize`. The first batch will fit without growing. If you forget the capacity, the slice grows incrementally (the runtime doubles the cap as needed), which means transient allocations during the first batch.

If you allocate `make([]int, b.maxSize, b.maxSize)` (note the `len = maxSize`), you have created a slice already full of zeros, which is wrong — appending now puts items at index `maxSize` and beyond, and the size check `len(buf) >= maxSize` is already true on the first iteration.

```go
    ticker := time.NewTicker(b.maxDelay)
    defer ticker.Stop()
```

Create the ticker, and ensure it is stopped on exit. The `defer` is critical: forgetting it leaks the timer goroutine inside the runtime. The runtime keeps a handle on the timer until you stop it.

```go
    for {
        select {
```

The infinite loop with `select` is the heart. Each iteration picks one ready case. If neither case is ready, `select` blocks until one becomes ready. There is no `default` because we want to block.

```go
        case item, ok := <-b.in:
            if !ok {
                if len(buf) > 0 {
                    _ = b.sink.Write(buf)
                }
                return
            }
```

Receive from the input channel. The two-value form `item, ok` lets us detect channel close. When closed, `ok == false`. At that point, drain the remaining buffer and return — exits the goroutine, fires the deferred `close(b.done)`, lets the outside world know.

```go
            buf = append(buf, item)
            if len(buf) >= b.maxSize {
                _ = b.sink.Write(buf)
                buf = buf[:0]
            }
```

Standard append + size-trigger check. The order matters: check after append, so the new item is included in the flushed batch. The reset `buf = buf[:0]` keeps the underlying array — next append reuses it.

```go
        case <-ticker.C:
            if len(buf) > 0 {
                _ = b.sink.Write(buf)
                buf = buf[:0]
            }
        }
    }
}
```

Tick: if anything is buffered, flush. The `if len(buf) > 0` guard is important — without it, every tick produces an empty flush, which spams logs and metrics.

That is the entire loop. Eight effective lines of logic, three branches (close, size trigger, time trigger).

### Variations You Will See in Real Code

- **Reason tag**: `flush(reason string)` instead of inline. Already discussed.
- **Buffer parameter**: pass `buf` to a helper so the caller can decide whether to reuse or replace. Sometimes seen in libraries that pool buffers.
- **`done` instead of `close(in)`**: some designs use a separate `done` channel to signal shutdown, and never close `in`. This avoids the "send on closed channel" panic at the cost of an extra select case in the producer.
- **Multiple flushes per tick**: some batchers flush multiple sub-buffers (per tenant) on a single tick. The shape of the inner code is the same; the outer loop is identical.
- **Context-aware flush**: `b.sink.Write(ctx, buf)`. The ctx comes from `context.WithTimeout` per flush or from a long-lived ctx on the batcher.
- **Worker pool around the flush**: the flush is sent to a pool of flush workers, so size triggers can fire without waiting for the previous flush to complete. We cover this in middle.md.
- **Buffer pool**: instead of `buf = buf[:0]`, return the buffer to a `sync.Pool` and `Get` a fresh one. Avoids holding a large array if `maxSize` is variable.

### What If We Move Code Around?

The discipline "size check after append" is enforced by the run loop's structure. Let us see what happens if we move it before:

```go
case item, ok := <-b.in:
    if !ok { ... }
    if len(buf) >= b.maxSize {
        _ = b.sink.Write(buf)
        buf = buf[:0]
    }
    buf = append(buf, item)
```

Now the size trigger fires when the buffer is *full*, and the new item is appended *after*. The next iteration checks size again before appending the next item. Two consequences:

1. On the iteration that flushes, the new item is *not* in the flushed batch. It is the first item of the *next* batch. Correctness-wise, this is fine.
2. The buffer can hold up to `maxSize` items between flushes, with the new item never causing the buffer to exceed `maxSize`.

Both pre-append and post-append checks are valid. Post-append is more common because it matches the intuition "I just added an item; should I flush now?". Pre-append matches "before I add this item, is the buffer already full?". Pick one and stick with it.

### What If We Remove The Close-Triggered Flush?

```go
case item, ok := <-b.in:
    if !ok {
        return  // no flush
    }
```

Now on close, whatever is in the buffer is lost. This is sometimes the right behaviour — for best-effort metrics that get re-sent on the next process start. But for anything durable, it is wrong.

Make this a deliberate decision, not an oversight. Many bugs are "I copy-pasted from a tutorial that did not bother with shutdown".

## Step-by-Step: Build a Batcher From Nothing

Actually, the step-by-step section is already above. We covered it. Moving on.

## A Note on Per-Item Wait Time vs Batch Latency

Two different latency metrics:

- **Per-item wait time**: time from `Add` to flush start.
- **Batch latency**: time from flush start to flush ack.

Per-item wait time is bounded by `maxDelay` (or, more precisely, by the time-trigger interval, which can be slightly higher with a ticker — up to `2 * maxDelay` in the worst case of "tick just before first item, tick after `maxDelay`").

Batch latency is determined by the sink. It is the `C_call + N * C_item` cost.

Total end-to-end latency per item: `wait time + batch latency`. When you say "the batcher adds 50 ms of latency", you usually mean the wait time. But under heavy load when the batcher is bottlenecked on the sink, the batch latency can dominate. Always emit both metrics.

## A Note on Item Ordering

In the basic batcher, item order is preserved within a batch (we `append`, so the slice is in arrival order). Across batches, order is also preserved (one batch finishes before the next starts).

But: if you ever introduce parallel flushes (multiple flush goroutines), batches can finish out of order. The downstream sees:

- Batch 1 (items 0–99)
- Batch 2 (items 100–199)  *— sent at the same time —*
- Batch 1 succeeds at t = 105 ms
- Batch 2 succeeds at t = 100 ms

If the sink is "append to a log" and the order matters, this is a bug. Either keep flushes serial, or have the sink itself accept out-of-order batches with sequence numbers.

Most application-level batchers preserve order because their loop is single-flushing. The moment you parallelise flushes, you have to think about it.

## A Note on Idempotent Retries

When the flush fails, you need to retry. But retrying a batch is not free: if the sink already received the data and only the ack was lost, the retry creates duplicates.

Strategies:

- **Idempotency keys**: each batch carries a unique ID; the sink deduplicates.
- **Sequence numbers**: items carry monotonically increasing sequence; the sink skips already-seen ones.
- **At-most-once with replay**: do not retry; rely on the upstream to detect missing items and replay.
- **Exactly-once**: a hard problem, generally unsolvable in distributed systems without coordination. Achieve it with transactions across batcher and sink (rare; expensive).

The pragmatic answer: design downstream to be idempotent (use ON CONFLICT DO NOTHING for INSERTs, use idempotency keys for HTTP). Then retries are safe.

## A Note on Persistence

What if your service crashes between `Add` and `flush`? The items in the buffer are gone. Three ways to handle:

1. **Accept the loss**: for metrics, audit logs that the upstream can replay, anything best-effort.
2. **Persistent queue upstream**: Kafka, Redis Streams, S3-backed queue. The producer writes there; the batcher reads from there. On crash, the queue still has the items, and the new batcher process picks them up.
3. **Persistent buffer**: the batcher itself stores buffered items on disk before flush. Few in-process batchers do this — it adds complexity. Frameworks like Vector and Fluent Bit do, with on-disk buffer support.

Most production designs go with option 2 — the queue is the durable boundary, and the batcher is allowed to be ephemeral. This separates persistence from amortisation.

## Exercises Aligned to the Concepts

These short exercises reinforce specific learning objectives from this file. Each is small enough to complete in 10–20 minutes.

### Exercise 1: Predict the flush count

Given `maxSize = 10`, `maxDelay = 50 ms`, and 25 items sent at 1 ms apart, then a 200 ms pause, then 7 more items, then `Close()`, how many flushes occur, by reason?

*Hint*: 25 items at 1 ms apart finish in 24 ms. The first 10 trigger size at ~9 ms; the next 10 trigger size at ~19 ms. The remaining 5 sit in the buffer until 50 ms after the most recent tick. After the pause, 7 items accumulate, time-trigger fires, then `Close` flushes nothing because the buffer is empty.

Total: 2 size, 1 time (the 5 leftovers), 1 time (the 7 new items), 0 close. Try it and verify.

### Exercise 2: Predict the latency distribution

Same parameters. What is the worst-case latency per item, in the steady-state and at the burst boundaries?

*Hint*: in a size-triggered batch of 10, the first item waits ~10 ms (9 newer items arrive before it flushes). In a time-triggered batch, the worst case is exactly `maxDelay = 50 ms`.

### Exercise 3: Stuck-at-N-minus-1

Modify the batcher to remove the time trigger (delete the ticker and its case). Now send 9 items where `maxSize = 10`, then close. What does the sink see?

*Expected*: with the close-triggered flush still in place, 9 items in one batch. Without it (also delete the `if len(buf) > 0` on the `!ok` branch), the items are lost.

### Exercise 4: Shared buffer aliasing

Remove the `make + copy` defensive copy. Use the sink that *stores* the slice (the in-memory sink earlier). Then drive 30 items, `maxSize = 10`. Read the sink's stored batches and print them.

*Expected*: all three stored slices print the *last* batch's contents, because they all alias the same underlying array. The bug is silent — no panic — until you actually look at the data.

### Exercise 5: Producer-side close

Modify the batcher to expose its input channel and let a producer call `close(b.in)`. Then add a second producer that calls `b.in <- item` after the first producer closed. Observe the panic.

*Expected*: "send on closed channel". The fix is to centralise close in the orchestrator.

### Exercise 6: Maximally hostile shutdown

Construct a service where:

- 8 producer goroutines each send 1000 items via `Add`.
- The main goroutine calls `Close()` after exactly 5 ms (before all producers are done).

Observe the panic. Fix it with a `sync.WaitGroup` to wait for producers before `Close()`.

### Exercise 7: Bound the input channel

Set the input channel buffer to 4 and have one producer send 10 items in a tight loop while the sink artificially sleeps for 100 ms per call. Time how long the producer is blocked, and check whether `Add` ever blocks for more than `maxDelay`.

*Expected*: under sustained pressure, `Add` blocks because the input channel is full and the consumer is busy in the sink call. This is backpressure working as designed.

### Exercise 8: Replace ticker with timer

Convert the run loop to use `time.Timer` reset on the first item of each batch, as shown earlier in this file. Compare the per-batch latency distribution: ticker version versus timer version.

*Expected*: the ticker version has more variability (sometimes a batch was opened just before a tick, sometimes just after). The timer version has tight latency bounded by `maxDelay` for every batch.

### Exercise 9: Reason-tagged metric

Add a `flush_reason` counter (just a `map[string]int` guarded by a mutex, for this exercise). Drive the batcher under three loads — low traffic, medium traffic, high traffic — and observe the distribution of reasons.

*Expected*: low traffic = almost all `time`. High traffic = almost all `size`. Medium = some of each. The crossover point is at `arrival_rate * maxDelay ≈ maxSize`.

### Exercise 10: Combiner

Implement the combiner pattern from earlier in this file. Drive 1000 "notifyUser" events for 5 unique recipients (200 each). Verify the sink receives 5 calls, each with a count of 200.

## Glossary of Mistakes Catalogued

A back-reference to every mistake mentioned in this file, with the section that explains it. Use this as a self-check before committing batcher code.

| Mistake | Section | Severity |
|---------|---------|----------|
| Only one trigger | Core Concepts | Critical |
| Forget to flush on close | Code Examples | Critical |
| Share buffer with sink | Coding Patterns | Critical |
| Unbounded input channel | Performance Tips | Critical |
| Producer-side close | Edge Cases | Critical |
| No batch-size metric | Best Practices | High |
| `select` over one channel | Common Mistakes | High |
| Flush inside mutex | Common Mistakes | High |
| Forget `ticker.Stop()` | Common Mistakes | Medium |
| Re-use `buf` after handing to sink | Common Mistakes | Critical |
| `Add` silently dropping | Common Mistakes | Critical |
| No flush-reason tag | Clean Code | Low |
| `maxDelay <= 0` | Edge Cases | Medium |
| `maxSize == 1` | Edge Cases | Low |
| Panic in sink | Edge Cases | High |
| Shutdown ordering | Edge Cases | High |
| Loss on crash | Edge Cases | Inherent |

The "Inherent" rating means: it is not a code bug — it is a property of any in-memory batcher. You handle it via upstream design (durable queue, replayable source) not via the batcher itself.

## Vocabulary You Should Be Comfortable Using

You should be able to use these words in a sentence and know what they mean:

- "linger time", "linger ms"
- "flush", "drain"
- "trigger" (size, time, close)
- "buffer", "accumulator"
- "sink"
- "backpressure"
- "block, drop, or grow"
- "per-call cost", "per-item cost"
- "amortise"
- "size trigger", "time trigger"
- "knee" (of the throughput curve)
- "graceful shutdown"
- "partial flush"
- "double buffer" (mentioned, deferred to middle.md)
- "micro-batch"
- "fan-out", "fan-in" (mentioned in passing)
- "reason-tagged metric"
- "downstream", "upstream"

If any of these are still fuzzy, re-read the section that introduces them before moving on to middle.md.

## Frequently Asked Questions

**Q: My batcher loses items on `SIGTERM`. Why?**

Because nobody called `Close()`. The OS sends SIGTERM, your process starts running deferred functions, but the batcher's input channel is still open and its goroutine is still in the `select`. The main goroutine exits, the process dies, and the buffer's contents go with it.

Fix: wire `Close()` to the signal:

```go
func main() {
    b := New(sink, 100, 100*time.Millisecond)

    sigs := make(chan os.Signal, 1)
    signal.Notify(sigs, syscall.SIGINT, syscall.SIGTERM)

    // ... your service runs ...

    <-sigs
    b.Close() // drains the buffer
}
```

The middle.md file covers richer shutdown contracts.

**Q: Why is my batcher only ever flushing on the time trigger?**

Either the size is too high or the throughput is too low. Emit the `flush_reason` metric to confirm. If the size is too high relative to the steady-state arrival rate, the time trigger drives everything and you have effectively a time-only batcher.

**Q: Why are my batches always exactly `maxSize`?**

The opposite case: throughput is high enough that the size trigger always fires before the time trigger. This is usually what you want — full batches mean maximum amortisation. If you do *not* want this (because, for example, you want item-level latency to be low), reduce `maxSize` or `maxDelay`.

**Q: Can I have multiple batchers in series?**

Technically yes, but think hard before you do. Each stage adds latency and adds a place where data can be lost on crash. Two batchers in series add latency equal to the sum of their `maxDelay` values. If you find yourself wanting series batchers, it usually means the first batcher's sink is itself slow and should be batched directly, not wrapped.

**Q: Can the same batcher feed multiple sinks?**

Yes — write a fan-out sink that, on `Write(batch)`, calls each downstream sink with the same batch. But be careful about partial failures: if sink A succeeds and sink B fails, what do you tell the upstream? The simplest answer is "retry both", but that requires sink A to be idempotent. We cover this in middle.md.

**Q: How big should `maxSize` be?**

Sink-dependent. Heuristics:

- Postgres multi-row INSERT: 100–1000 rows.
- Postgres COPY FROM: 1000–10 000 rows.
- Kafka producer: depends on `batch.size` setting, usually 16 KB worth of records.
- HTTP `_bulk`: 5–15 MB worth of payload.
- statsd UDP packet: 1432 bytes (one MTU).
- gRPC unary call: 1 MB worth of payload by default.

Always *measure* on your real workload. The heuristics are starting points.

**Q: How long should `maxDelay` be?**

The smaller of:

- Your latency SLO contribution budget (often 5–50 ms for online systems).
- The time at which producers would notice data loss on crash (often 1–10 s for tolerant systems, but if you cannot tolerate 1 s of loss, use a smaller value).

5 ms to 100 ms is typical for online services. 1 s to 60 s is typical for ingestion pipelines.

**Q: Does `linger.ms = 0` mean "do not batch"?**

No. It means "do not wait *additionally*". The batcher still groups items that are *already* available. Kafka clients with `linger.ms = 0` still pack multiple records into one produce request whenever the producer goroutine wakes up and finds several records queued. This is sometimes confusing — the documentation suggests "0 = unbatched" but the reality is "0 = no extra wait, but still grouped".

**Q: How do I test the size trigger without waiting?**

Set `maxDelay` to something effectively infinite (`time.Hour`) so only the size trigger can fire. The test takes microseconds.

**Q: How do I test the time trigger without waiting too long?**

Set `maxSize` to something effectively infinite (`1_000_000`) and `maxDelay` to a small value (10–50 ms). The test takes 50–150 ms.

**Q: How do I test shutdown drain?**

Set `maxDelay` to infinity, send a few items (fewer than `maxSize`), then `Close()`. Verify the items reached the sink.

**Q: What if my items are not directly comparable values?**

Use `chan T` for any T. The batcher does not care about the structure of items. It only cares about counting them and handing the slice to the sink.

**Q: What if I want different batching policies for different items?**

Run multiple batchers. Each has its own goroutine, buffer, and triggers. They are cheap; a batcher is one goroutine and one slice. Running 100 of them is fine.

**Q: How do I drain a batcher mid-life, without closing it?**

Add a `Flush()` method that sends a sentinel on a control channel and waits for an ack:

```go
type Batcher struct {
    // ...
    flushReq chan chan struct{}
}

func (b *Batcher) Flush() {
    ack := make(chan struct{})
    b.flushReq <- ack
    <-ack
}

// in run:
case ack := <-b.flushReq:
    flushBuf("manual")
    close(ack)
```

This is occasionally useful for tests and for explicit batching boundaries (e.g., "flush at the end of each request").

**Q: Should I gzip the batch before sending?**

If the sink is HTTP and the payload is at all repetitive (JSON typically is), yes — gzip after batching, before send. Many sinks (Elastic, BigQuery, Datadog) accept gzipped bodies. The gzip cost is usually negligible compared to network time.

**Q: My `chan T` has buffer 1024 but I see drops. Why?**

You are not seeing drops; you are seeing producer *blocking*. Drops only happen if you explicitly `select { case b.in <- item: ; default: drop }`. The default behaviour of `b.in <- item` is to block until there is space.

If you really want to drop, do it deliberately and emit a counter.

## Debugging Walkthrough: "My Batcher Lost Data"

A real bug investigation a junior engineer might run.

**Symptom**: an audit log pipeline shows 1 million events received but only 999 412 events in the database. 588 events lost.

**First check**: was the loss on a clean shutdown or on a crash? Look at the deployment history. Crash 90 seconds ago. Hmm.

**Second check**: does the batcher flush on crash? Read the source. We see `go b.run()` and `defer close(b.done)` but no `signal.Notify` wiring. On SIGTERM the process exits without calling `Close`. So the buffer's content is lost.

**Math**: at 100 items per second average and a 100 ms time trigger, average buffer occupancy is 10 items. Average pending count across 1 active batcher is 10. Why did we lose 588? Probably a brief burst before the crash filled the buffer beyond average. Or maybe there are multiple batchers.

**Fix**: wire SIGTERM to `Close()`. Re-deploy. Replay the lost events from the upstream queue (which is why upstreams should retain for an hour, but that is another lesson).

**Lesson**: the loss was not a bug in the batcher itself — the code did what it said it would do. The bug was in the *integration* with the process lifecycle. Almost every batcher-loss incident is like this. The batcher does what you wrote; you forgot to write the shutdown.

## Debugging Walkthrough: "My Batcher is Slow"

**Symptom**: throughput is half of what the design predicted.

**First check**: emit `flush_reason`. Is it always `size`? Then you are at the throughput ceiling — the sink is the bottleneck, not the batcher. Profile the sink.

**Second check**: is `flush_reason` mostly `time`? Then the size trigger almost never fires. Increase `maxSize` to widen the gap, or accept the smaller batches.

**Third check**: is the input channel full? If `len(b.in) == cap(b.in)` most of the time, your producers are blocked. That means the consumer can not keep up — again, the sink is slow.

**Fourth check**: is the consumer in `flush` most of the time? Compute `time_in_flush / total_time`. If it is 80%, you have no concurrency between accumulation and flushing. Move to the double-buffer pattern in middle.md.

**Fifth check**: is the buffer being copied a lot? `pprof` will show if the copy is the hotspot. Usually the network call dominates; if not, you have a fast sink and the batcher overhead matters. Use `sync.Pool` for buffers.

## Debugging Walkthrough: "My Batcher Crashes on Shutdown"

**Symptom**: `Close()` panics with "send on closed channel".

**Cause**: a producer is still calling `Add` after `Close()` ran. The channel is closed, the next send panics.

**Fix**: order the shutdown:

1. Stop accepting new work from upstream (close the HTTP listener, stop the consumer).
2. `Wait()` for all producer goroutines.
3. `Close()` the batcher.

```go
srv.Shutdown(ctx)  // step 1
wg.Wait()           // step 2
b.Close()           // step 3
```

In services using a lifecycle library (Uber's fx, Google's wire, sub-package init), this ordering is encoded as dependency order. Without one, you write it by hand.

## Comparison: Batcher vs Worker Pool

A worker pool consumes items one at a time from a channel and processes each individually. A batcher consumes items, groups them, and processes the group. They are complementary:

| Aspect | Worker Pool | Batcher |
|--------|-------------|---------|
| Items per call | 1 | N |
| Concurrency | N workers | 1 batcher goroutine (or N with sharding) |
| Throughput | Linear in workers | Linear in batch size up to the knee |
| Latency | Sum of queue wait + processing | Queue wait + batch wait + flush |
| Use when | Each item is expensive independently | Calling the sink is expensive |
| Often combined | Yes — pool of batchers, or batcher fronting pool | Yes |

In practice you often run a worker pool *of* batchers: each pool worker is a batcher with its own buffer, and items are sharded to workers by hash. That gives you both concurrency and amortisation.

## Comparison: Batcher vs Buffered Channel

A buffered channel "batches" in the trivial sense that it stores items between producer and consumer. It does *not* batch in the API sense — the consumer still reads one item at a time. So:

| Aspect | Buffered Channel | Batcher |
|--------|-----------------|---------|
| Stores items | Yes | Yes |
| Combines into groups | No | Yes |
| Sink call shape | 1 per receive | 1 per N items |
| Use when | Smooth out small bursts | Amortise per-call sink cost |

A batcher is almost always built *on top of* a buffered channel. The channel is the queue; the batcher is the grouping logic.

## Comparison: Batcher vs Coalescer / Debouncer

A coalescer or debouncer combines multiple events into one downstream event — like a "save" button that fires once 500 ms after the last keystroke. Subtle differences:

| Aspect | Coalescer | Batcher |
|--------|-----------|---------|
| Downstream count | 1 per window | 1 per batch (window-of-N events) |
| Per-item delivery | Lost (combined) | Preserved (in the batch) |
| Trigger style | Time only, usually | Size and time |
| Use when | Multiple events mean the same thing | Multiple events all need to land |

The combiner example earlier in this file is a coalescer that also has a time window. The plain batcher delivers every item; the coalescer might drop or combine.

## Code Tour: An Existing Open-Source Batcher

Read the OpenTelemetry Go SDK's `BatchSpanProcessor` (file `sdk/trace/batch_span_processor.go` in the otel-go repo). It is about 300 lines and contains:

- A goroutine with a `select` over the input channel, a ticker, a flush request channel, and a stop channel — the same shape as our junior batcher.
- A bounded queue with explicit drop counter on overflow — the senior version of "block, drop, or grow".
- Reason-tagged flushes (size, time, force) — exactly the metric we recommended.
- A configurable export timeout — what we passed via `context.WithTimeout`.
- A drop-policy when the export takes too long — covered in senior.md.

Reading this code is the best way to internalise what a production-grade batcher looks like. It is small enough to read in one sitting and concrete enough to compare line-by-line with what you have written.

## A Note on `time.AfterFunc`

The standard library has another way to schedule a deadline: `time.AfterFunc(d, f)`. It runs `f` in its own goroutine after `d`. You can use it as a time trigger:

```go
func (b *Batcher) Add(item Item) {
    b.mu.Lock()
    b.buf = append(b.buf, item)
    if len(b.buf) >= b.maxSize {
        b.flushLocked("size")
    } else if len(b.buf) == 1 {
        b.timer = time.AfterFunc(b.maxDelay, func() {
            b.mu.Lock()
            b.flushLocked("time")
            b.mu.Unlock()
        })
    }
    b.mu.Unlock()
}
```

This is mutex-based, not channel-based. It is a valid design. The channel-based design is usually clearer in Go because it avoids the mutex acquire-release dance, but mutex-based batchers are not wrong — they are just a different idiom.

We recommend channel-based for almost all cases. Mutex-based shines when integration with non-Go-idiomatic call sites (callbacks from C, very tight micro-batching) is required.

## A Note on `golang.org/x/time/rate`

The `rate.Limiter` type is not a batcher, but the *token bucket* it implements is the spiritual cousin: it groups operations together by allowing a burst up to `Burst` size and then enforcing a refill rate. If you have a downstream that wants "no more than X requests per second, up to a burst of Y", `rate.Limiter` is the right tool. Combined with a batcher you get: a batcher to amortise per-call cost, then a rate limiter to keep the sink from being overrun.

```go
func (b *Batcher) flush() {
    limiter.Wait(ctx)
    b.sink.Write(batch)
}
```

The batcher's job is "group". The limiter's job is "pace". Combine them when both concerns apply.

## A Final Worked Walkthrough: HTTP Audit Logger

Let us assemble everything into a tiny HTTP service that batches audit events.

```go
package main

import (
    "context"
    "encoding/json"
    "log"
    "net/http"
    "os"
    "os/signal"
    "sync"
    "syscall"
    "time"
)

type AuditEvent struct {
    UserID    string    `json:"user_id"`
    Action    string    `json:"action"`
    Timestamp time.Time `json:"ts"`
}

type FileSink struct {
    mu sync.Mutex
    f  *os.File
}

func (f *FileSink) Write(batch []AuditEvent) error {
    f.mu.Lock()
    defer f.mu.Unlock()
    for _, e := range batch {
        b, _ := json.Marshal(e)
        f.f.Write(b)
        f.f.Write([]byte("\n"))
    }
    return f.f.Sync()
}

type AuditBatcher struct {
    in        chan AuditEvent
    sink      *FileSink
    maxSize   int
    maxDelay  time.Duration
    done      chan struct{}
    closeOnce sync.Once
}

func NewAuditBatcher(sink *FileSink, size int, delay time.Duration) *AuditBatcher {
    a := &AuditBatcher{
        in:       make(chan AuditEvent, 1024),
        sink:     sink,
        maxSize:  size,
        maxDelay: delay,
        done:     make(chan struct{}),
    }
    go a.run()
    return a
}

func (a *AuditBatcher) Add(e AuditEvent) { a.in <- e }

func (a *AuditBatcher) run() {
    defer close(a.done)
    buf := make([]AuditEvent, 0, a.maxSize)
    ticker := time.NewTicker(a.maxDelay)
    defer ticker.Stop()
    flush := func(reason string) {
        if len(buf) == 0 {
            return
        }
        log.Printf("audit: flush reason=%s size=%d", reason, len(buf))
        batch := make([]AuditEvent, len(buf))
        copy(batch, buf)
        if err := a.sink.Write(batch); err != nil {
            log.Printf("audit: flush failed: %v", err)
        }
        buf = buf[:0]
    }
    for {
        select {
        case e, ok := <-a.in:
            if !ok {
                flush("shutdown")
                return
            }
            buf = append(buf, e)
            if len(buf) >= a.maxSize {
                flush("size")
            }
        case <-ticker.C:
            flush("time")
        }
    }
}

func (a *AuditBatcher) Close() {
    a.closeOnce.Do(func() { close(a.in) })
    <-a.done
}

func main() {
    f, err := os.OpenFile("audit.log", os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
    if err != nil {
        log.Fatal(err)
    }
    defer f.Close()

    sink := &FileSink{f: f}
    batcher := NewAuditBatcher(sink, 100, 200*time.Millisecond)

    mux := http.NewServeMux()
    mux.HandleFunc("/event", func(w http.ResponseWriter, r *http.Request) {
        var e AuditEvent
        if err := json.NewDecoder(r.Body).Decode(&e); err != nil {
            http.Error(w, err.Error(), http.StatusBadRequest)
            return
        }
        e.Timestamp = time.Now()
        batcher.Add(e)
        w.WriteHeader(http.StatusAccepted)
    })

    srv := &http.Server{Addr: ":8080", Handler: mux}
    go func() {
        if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
            log.Fatal(err)
        }
    }()

    sigs := make(chan os.Signal, 1)
    signal.Notify(sigs, syscall.SIGINT, syscall.SIGTERM)
    <-sigs
    log.Print("shutting down")

    ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
    defer cancel()
    srv.Shutdown(ctx)
    batcher.Close()
    log.Print("done")
}
```

This is about 100 lines of Go. It includes:

- An HTTP handler that enqueues events.
- A batcher with both triggers and reason-tagged flushes.
- A file sink with `fsync` on each batch (so a power loss does not lose batched-but-not-fsynced events).
- Graceful shutdown: stop accepting new requests, wait for in-flight to finish, flush the buffer, exit.

You can run it, `curl` events at it, send `SIGTERM`, and verify the audit log file has every event that returned 202.

This is a real, deployable junior batcher service. Read it once, type it from scratch once, and you have the muscle memory for the next 99 batchers you will build.

---

## Diagrams and Visual Aids

A batcher's data flow:

```
                  +-------------+
producers -->  Add(item)        |
                  |  (chan)     |
                  +------+------+
                         |
                         v
                  +------+--------------------+
                  |  consumer goroutine        |
                  |                            |
                  |  buf []Item                |
                  |                            |
                  |  size trigger ----> flush  |
                  |  time trigger ----> flush  |
                  |  close trigger ---> flush  |
                  +------+--------------------+
                         |
                         v
                  +------+------+
                  |    Sink     |
                  +-------------+
```

The decision tree on every iteration of `run`:

```
+--------------------------------------+
| select:                              |
|   case item, ok := <-in:             |
|     if !ok: drain & exit             |
|     else:                            |
|       buf = append(buf, item)        |
|       if len(buf) >= maxSize: flush  |
|   case <-ticker.C:                   |
|     if len(buf) > 0: flush           |
+--------------------------------------+
```

Latency vs throughput intuition:

```
  throughput
  ^
  |                      ----------- (saturation)
  |                  ___/
  |              ___/
  |          ___/
  |      ___/
  |   __/
  |  /
  +------------------------------> batch size
        ^             ^
      knee 1        knee 2
   (per-call cost   (downstream
    amortised)       starts dragging)
```

The picture is qualitative; the exact shape depends on the sink. For most production systems the sweet spot is between knee 1 and knee 2, with maxDelay chosen to bound the time you spend below knee 1.

## A Final Note on Mental Discipline

Building a batcher is not hard. The code is small. But the failure modes are subtle. Every time you build one:

- Test the close path.
- Test the time trigger.
- Test the size trigger.
- Check for the aliasing bug.
- Wire up shutdown.
- Add the four metrics.

These steps are mechanical. Skipping any of them is the bug you will be debugging at 3 AM next month.

Junior engineering on batchers is about discipline more than cleverness. The cleverness comes in middle, senior, and professional. The discipline must be there from the start.

Welcome to the world of production async writers. Read middle.md when you are ready.
