# Push-Pull — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Idiomatic Pipeline Lifecycle](#idiomatic-pipeline-lifecycle)
3. [Backpressure as a Design Property](#backpressure-as-a-design-property)
4. [Buffer Sizing: Little's Law](#buffer-sizing-littles-law)
5. [Overflow Policies in Depth](#overflow-policies-in-depth)
6. [Pull-Based and Credit-Based Flow Control](#pull-based-and-credit-based-flow-control)
7. [Batching to Amortise Channel Cost](#batching-to-amortise-channel-cost)
8. [Shutdown and the Lost-Work Problem](#shutdown-and-the-lost-work-problem)
9. [Memory Model and Visibility](#memory-model-and-visibility)
10. [Where Push-Pull Fails](#where-push-pull-fails)
11. [Production Checklist](#production-checklist)
12. [Cheat Sheet](#cheat-sheet)
13. [Summary](#summary)

---

## Introduction

At senior level push-pull stops being "a channel between two goroutines" and becomes a *flow-control architecture*. The questions are:

- Where does backpressure terminate? (It must end at a *droppable* or *blockable* boundary, or it propagates into something you cannot block — like an inbound network connection or a real-time sensor.)
- How big should buffers be, and how do you reason about it rather than guess?
- When does in-process channel backpressure stop working, and what replaces it (credit-based pull, load shedding, spill-to-disk)?
- How do you shut down without losing acknowledged work?

This file assumes the fan-out, cancellation, and drain material from middle.md.

---

## Idiomatic Pipeline Lifecycle

The canonical Go pipeline (from the Go blog's "Pipelines and cancellation") establishes the ownership rules every stage must follow:

1. **Each stage owns one output channel** and closes it when its input is exhausted or the context is cancelled.
2. **Stages receive on inbound, send on outbound**, both inside a `select` with `ctx.Done()` so a cancelled stage cannot block forever.
3. **Downstream cancellation propagates upstream via backpressure + context:** a cancelled consumer stops pulling; upstream stages block on send, observe `ctx.Done()`, and unwind.

```go
func stage[T, U any](ctx context.Context, in <-chan T, f func(T) U) <-chan U {
    out := make(chan U)
    go func() {
        defer close(out)
        for v := range in { // drains inbound; ends when upstream closes
            select {
            case out <- f(v):
            case <-ctx.Done():
                return // cancelled mid-send; stop and close out
            }
        }
    }()
    return out
}
```

This generic stage is the building block. Compose it; each composition is push-pull, and the whole chain runs at the rate of its slowest stage with memory bounded by the sum of buffer sizes.

---

## Backpressure as a Design Property

Backpressure is not a feature of one channel; it is a *property of the whole path* from the ultimate source to the ultimate sink. It only works if every link can exert it backward. The chain breaks at any link that *cannot* block:

- **An inbound network connection.** You cannot truly "block" a remote sender; you can only stop reading its socket, which fills the OS receive buffer, which eventually applies TCP backpressure — slow and coarse. Past that, the kernel drops or the peer's send blocks.
- **A real-time source** (sensor, market data feed) that will overrun you regardless. Backpressure here means *drop* or *sample*, not *block*.
- **A fire-and-forget event emitter** in unrelated code that does `select { case ch <- e: default: }` — it drops on full, deliberately breaking backpressure to protect itself.

So the senior design question is: **where does the backpressure path terminate, and is that terminus a place where blocking is acceptable?** If yes, channels suffice. If no (you cannot block the source), you must convert backpressure into a *bounded* policy at that boundary: drop, sample, load-shed, or spill. Letting backpressure propagate into an unblockable source is how you get either an unbounded queue (OOM) or a stalled accept loop (timeouts upstream).

---

## Buffer Sizing: Little's Law

"How big should the channel buffer be?" has a principled answer, not a guess. Little's Law:

```
L = λ × W
```

where `L` is the average number of items in the system, `λ` is the arrival rate (items/sec), and `W` is the average time an item spends being processed. The buffer needs to hold roughly the items that arrive during one processing latency *plus* enough to smooth burst variance.

Worked example: a producer emits 10,000 items/sec; each item takes the consumer 0.5 ms, and you run 4 consumers (effective service rate 8,000/sec — already a problem, but suppose bursts). To absorb a 100 ms burst at peak 20,000/sec: `L ≈ 20000 × 0.1 = 2000` items. So a buffer of ~2,000 absorbs that burst without blocking the producer; a buffer of 8 would backpressure almost immediately.

Guidance:

- **Buffer = 0 (unbuffered):** lockstep, no slack. Use when you want the producer and consumer strictly synchronised.
- **Small buffer (8–256):** smooths scheduling jitter and tiny bursts. The common default.
- **Large buffer (Little's-Law-sized):** absorbs known bursts. Costs memory; *delays* the moment backpressure is felt — make sure that delay is acceptable.
- **Buffer ≫ Little's Law:** you are hiding overload; you will discover it as latency, not as a clear "full" signal. Avoid.

A bigger buffer trades memory and *latency-under-load* for fewer producer stalls. It does not increase steady-state throughput — that is set by the consumer's service rate, full stop.

---

## Overflow Policies in Depth

When the bounded buffer is full and you cannot (or will not) block the producer, you choose a policy. Each is a different correctness/operational trade-off.

| Policy | Producer blocks? | Loss | Use when |
|--------|------------------|------|----------|
| **Block** (default) | yes | none | backpressure can propagate to a blockable source |
| **Drop newest** | no | newest item | freshness of *old* items matters; or load shedding |
| **Drop oldest** | no | oldest item | latest item is most valuable (telemetry, prices) |
| **Sample / coalesce** | no | intermediate items | only the latest state matters (UI, gauges) |
| **Spill to disk** | no (bounded by disk) | none until disk full | must not lose work, can tolerate latency |
| **Reject (error)** | no | caller decides | caller can retry or shed (HTTP 503) |

```go
// Drop-oldest ring on a full channel.
func pushDropOldest(ch chan Item, it Item) {
    for {
        select {
        case ch <- it:
            return
        default:
            select {
            case <-ch: // discard the oldest to make room
            default:
            }
        }
    }
}
```

The point: do not let "the channel is full" be an *accident*. Decide, in advance and explicitly, what happens, and emit a metric whenever the non-blocking branch fires so overload is *visible*.

---

## Pull-Based and Credit-Based Flow Control

In-process, a blocking channel *is* backpressure, so explicit pull is rarely needed. Across a boundary you cannot block (a network), you need the consumer to advertise capacity. This is **credit-based flow control**, and it is what HTTP/2, gRPC, AMQP `prefetch`, and reactive-streams `request(n)` all do.

The shape: the consumer grants the producer a *credit window* of N items; the producer may send up to N un-acknowledged items, then must wait; each consumer ack returns one credit. This bounds in-flight items without a shared blocking buffer.

```go
// Credit-based producer: send only while credit remains.
type credited struct {
    out    chan Item
    credit chan int // consumer returns credits here
}

func (c *credited) run(ctx context.Context, items []Item) {
    window := 0
    for _, it := range items {
        for window <= 0 { // out of credit: wait for the consumer
            select {
            case n := <-c.credit:
                window += n
            case <-ctx.Done():
                return
            }
        }
        select {
        case c.out <- it:
            window--
        case n := <-c.credit:
            window += n
        case <-ctx.Done():
            return
        }
    }
}
```

Recognising that "Go channel backpressure" and "gRPC flow-control window" are the *same idea* at different scales is a senior-level insight. The professional file maps this onto ZeroMQ PUSH/PULL and NATS.

---

## Batching to Amortise Channel Cost

Each channel send/receive has overhead (a lock or atomic, a possible goroutine wakeup). At very high item rates, sending one item at a time makes the channel the bottleneck. Batch:

```go
// Producer batches before pushing.
func batchPush(ctx context.Context, in <-chan Item, out chan<- []Item, size int) {
    defer close(out)
    batch := make([]Item, 0, size)
    flush := func() bool {
        if len(batch) == 0 {
            return true
        }
        select {
        case out <- batch:
            batch = make([]Item, 0, size) // fresh slice; do not reuse a sent slice
            return true
        case <-ctx.Done():
            return false
        }
    }
    for it := range in {
        batch = append(batch, it)
        if len(batch) >= size && !flush() {
            return
        }
    }
    flush()
}
```

Batching divides per-item channel overhead by the batch size. The trade-off is **latency**: an item waits for the batch to fill (add a time-based flush — `time.Ticker` in the `select` — to bound that). Critical subtlety: never reuse a slice you have already sent; the consumer may still be reading it (data race). Allocate a fresh batch each flush.

---

## Shutdown and the Lost-Work Problem

The hardest senior question: at shutdown, what counts as "done"? Three correctness levels:

1. **Drain everything in flight.** Stop the source, close the channel, `wg.Wait()`. Loses nothing buffered. Requires the consumer not to abort on `ctx`.
2. **At-least-once with acks.** If items represent work that must not be lost (a payment, a message off a broker), the consumer must *ack* only after the work is durable. On shutdown, un-acked items are re-delivered (by the broker) or re-queued (locally). The in-process channel alone cannot give this — you need the source to support redelivery.
3. **Abort and re-fetch.** Drop in-flight work; rely on the upstream (broker / database cursor) to redeliver on restart. Simplest, but only correct if the source is replayable.

The lost-work bug is putting `case <-ctx.Done(): return` in a worker loop while expecting drain semantics: cancellation makes workers exit with items still buffered. **Decide per pipeline**: drain (no `ctx` in the worker loop; close-and-wait) or abort (ctx in the loop; accept loss / rely on redelivery). Mixing them silently loses data.

```go
// Drain-on-shutdown (no item loss for buffered work):
stopSource() // source stops pushing
close(jobs)  // signal no-more
wg.Wait()    // workers range to completion
// Abort-on-shutdown (drop in-flight; source must redeliver):
cancel()     // workers select ctx.Done() and exit
```

---

## Memory Model and Visibility

A channel send happens-before the corresponding receive completes. So whatever the producer wrote into an item (or the memory it points to) *before* pushing is visible to the consumer *after* pulling — no extra synchronisation needed. This is what makes "push a `*Job` pointer" safe: the producer's writes to `*Job` happen-before the consumer's reads.

The trap: **do not mutate an item after pushing it.** Once sent, the item is conceptually owned by the consumer; a concurrent write by the producer is a data race with no happens-before edge. This is the same rule as the batching slice trap — ownership transfers on send. For pointers/slices/maps, "freeze" the pointed-to data before pushing.

---

## Where Push-Pull Fails

- **Unblockable source.** If you cannot block or drop at the source (hard real-time, lossy-intolerant inbound stream you do not control), pure channel backpressure cannot save you — you need spill, sharding, or capacity that exceeds peak.
- **Backpressure propagating into an accept loop.** A slow downstream stage backpressures all the way to the HTTP accept loop, causing client timeouts and retry storms that *increase* load. Terminate backpressure at a request-level reject (503) instead.
- **Head-of-line blocking.** One slow item on a shared channel stalls everything behind it. Fan-out helps; per-key sharding helps more.
- **Unbounded fan-in.** Many producers into one consumer with a big buffer just relocates the unbounded-queue problem. Bound the aggregate.
- **Deadlock cycles.** A pipeline whose stages form a cycle (A pushes to B, B pushes back to A) can deadlock when both buffers fill. Avoid cycles or break them with a dedicated buffer/drop.
- **Goroutine leaks on partial shutdown.** A producer blocked on a full channel whose only consumer has exited leaks. Always pair sends with `ctx.Done()` in cancellable pipelines.

---

## Production Checklist

- [ ] Does the backpressure path terminate at a blockable or droppable boundary (not an unblockable source)?
- [ ] Is every buffer bounded, with a deliberate size (Little's Law, not a guess)?
- [ ] Is there an explicit overflow policy (block/drop/sample/spill/reject) with a metric when it triggers?
- [ ] Is every blocking push/pull in a cancellable pipeline wrapped in `select { ... case <-ctx.Done() }`?
- [ ] Is shutdown clearly drain *or* abort, not an accidental mix that loses data?
- [ ] For must-not-lose work, is there acking / redelivery (the channel alone is not enough)?
- [ ] No item mutated after being pushed (ownership transfers on send)?
- [ ] No pipeline cycles that can deadlock when buffers fill?
- [ ] Tested with `-race`, a slow consumer, and a cancelled context (no leaks)?

---

## Cheat Sheet

```text
Backpressure works only if the path ends somewhere blockable/droppable.
Buffer size: Little's Law (L = λ·W) + burst headroom; not a guess.
Full buffer policy: block | drop-newest | drop-oldest | sample | spill | reject — pick one, emit a metric.
Cross-network backpressure: credit window (gRPC/HTTP2/reactive-streams), not a blocking channel.
Shutdown: drain (close + wg.Wait, no ctx in worker loop) OR abort (cancel ctx) — never both by accident.
Ownership transfers on send: never mutate a pushed item.
```

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| OOM under load | unbounded queue / oversized buffer | bound + overflow policy |
| client timeouts under load | backpressure reaching accept loop | reject (503) at request level |
| lost work on shutdown | ctx in worker loop with drain intent | drain: close + wg.Wait |
| channel is the bottleneck | per-item overhead at high rate | batch sends |
| leaked producer | blocked send, consumer gone | select on ctx.Done() |

---

## Summary

The senior view treats push-pull as end-to-end flow control, not a single channel. Backpressure only protects you if the whole path terminates somewhere you can block or drop; where it cannot (an unblockable inbound source), you must convert backpressure into an explicit policy — drop, sample, spill, or reject — and make overload visible with metrics rather than hiding it in an oversized buffer. Size buffers with Little's Law plus burst headroom; bigger buffers buy burst tolerance and latency, never steady-state throughput. Across networks, the same idea appears as credit-based flow control (gRPC/HTTP2 windows). Get shutdown semantics explicit — drain (close, then `wg.Wait()`) versus abort (cancel `ctx`) — because mixing them silently loses data, and for must-not-lose work the channel alone is insufficient: you need acking and redelivery from the source.
