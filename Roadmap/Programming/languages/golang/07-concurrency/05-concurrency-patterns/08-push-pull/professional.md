# Push-Pull — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [When to Introduce Push-Pull](#when-to-introduce-push-pull)
3. [Review Checklist](#review-checklist)
4. [In-Process vs Networked Push-Pull](#in-process-vs-networked-push-pull)
5. [ZeroMQ PUSH/PULL](#zeromq-pushpull)
6. [NATS Queue Groups](#nats-queue-groups)
7. [Broker-Backed Work Queues](#broker-backed-work-queues)
8. [Designing a Pipeline into a Service](#designing-a-pipeline-into-a-service)
9. [Observability and Operations](#observability-and-operations)
10. [Interaction with the Wider System](#interaction-with-the-wider-system)
11. [War Stories](#war-stories)
12. [Cheat Sheet](#cheat-sheet)
13. [Summary](#summary)

---

## Introduction

Professionally, push-pull is rarely a single design choice; it is a thread that runs through the whole system, from the in-process channel between two goroutines up to the broker between two services. The job at this level is judgement: where to put bounded queues, how to keep backpressure from turning into a retry storm, when to move from in-process channels to a broker, and how to operate the result. This file is about team-level decisions and the distributed analogues you will meet.

---

## When to Introduce Push-Pull

Introduce an explicit push-pull stage when:

- A producer and consumer have **different, variable rates** and you want the slow side to govern the pace.
- You want **parallelism** with automatic load distribution (fan-out to N pullers).
- You need to **decouple** a burst-y stage from a steady one with a bounded buffer.
- You are building a **streaming** transform that must not load all input into memory.

Do *not* introduce it when:

- The work is a single synchronous request/response (just call the function).
- Producer and consumer always run at the same rate with no bursts (a direct call or unbuffered channel is enough).
- You need *every* consumer to see *every* item (that is broadcast, not push-pull).

The most common over-engineering is adding a channel + goroutine where a plain function call would do. Channels cost goroutines, scheduling, and shutdown complexity; introduce them for *rate decoupling or parallelism*, not for decoration.

---

## Review Checklist

```text
[ ] Bounded buffers everywhere; no unbounded queues for uncontrolled input
[ ] Buffer sizes justified (Little's Law / burst headroom), not magic numbers
[ ] Explicit overflow policy (block/drop/sample/spill/reject) + metric when it fires
[ ] Every blocking push/pull in a cancellable path selects on ctx.Done()
[ ] Sender closes the channel; fan-in result closed once after wg.Wait()
[ ] Shutdown is clearly drain OR abort; no accidental data loss
[ ] Must-not-lose work has acking/redelivery (channel alone is insufficient)
[ ] No item mutated after being pushed
[ ] No pipeline cycles that deadlock when buffers fill
[ ] Backpressure terminates at a blockable/droppable boundary, not an accept loop
[ ] Tests: -race, slow consumer, cancelled ctx, goroutine-leak check
```

Treat an unbounded queue or a missing overflow policy as a blocking review comment. Treat "backpressure reaching the accept loop" as an architecture smell, not a nit.

---

## In-Process vs Networked Push-Pull

The same pattern spans two regimes:

| Aspect | In-process (channels) | Networked (broker / sockets) |
|--------|------------------------|------------------------------|
| Backpressure | blocking send (free, exact) | credit windows / TCP / broker flow control (coarse) |
| Loss on crash | everything in flight lost | durable queue can survive |
| Distribution | one process | across machines |
| Latency | nanoseconds | microseconds–milliseconds |
| Failure modes | goroutine leak, deadlock | partition, redelivery, poison messages |
| When | within one binary | across services / for durability |

A frequent professional decision: a feature starts as in-process channels and outgrows them when it needs durability (survive a crash), horizontal scale (consumers on other machines), or decoupled deployment. That is the trigger to move to a broker — *not* before. In-process channels are faster and simpler; reach for the network only when you need what it buys.

---

## ZeroMQ PUSH/PULL

ZeroMQ's PUSH/PULL socket pair is the distributed mirror of the Go fan-out channel:

- A **PUSH** socket distributes outbound messages **round-robin** to all connected PULL peers (fair queuing). It blocks (or its high-water mark applies) when no peer can accept — networked backpressure.
- A **PULL** socket fair-queues inbound messages from all connected PUSH peers.

So "one producer pushing to N workers pulling from a shared channel" maps directly: PUSH = the producer side, PULL = each worker. The **high-water mark (HWM)** is ZeroMQ's bounded-buffer knob — the analogue of your channel capacity; past it, ZeroMQ blocks or drops depending on socket type. Key differences from in-process channels: no built-in durability (messages in a queue are lost if a peer dies), and PUSH silently *stalls* on a slow/absent peer rather than redistributing, so a stuck worker can starve the round-robin. The lesson for reviewers: PUSH/PULL gives load distribution and backpressure but **not** reliability — pair it with heartbeats and timeouts.

---

## NATS Queue Groups

NATS provides the same fan-out via **queue groups**: multiple subscribers join a named queue group on a subject, and NATS delivers each message to *exactly one* subscriber in the group (load-balanced) — the networked version of N goroutines ranging one channel. Core NATS is at-most-once (fire-and-forget, no durability); **JetStream** adds persistence, acks, and redelivery, which is what you use when work must not be lost.

Mapping to the Go model:

- Subject + queue group ≈ a shared `jobs` channel with N workers.
- JetStream ack ≈ "process then mark done"; un-acked messages are redelivered (the at-least-once semantics the senior file flagged the bare channel cannot provide).
- `MaxAckPending` ≈ the consumer's credit window / buffer bound — how many un-acked messages a consumer may hold (networked backpressure).

When a team says "we need the worker pool to survive restarts and run on multiple nodes," NATS queue groups (with JetStream) or a similar broker is the natural evolution of the in-process fan-out.

---

## Broker-Backed Work Queues

General brokers (RabbitMQ, Kafka, SQS, Redis streams) all implement push-pull with durability:

- **Prefetch / `MaxAckPending` / consumer lag** is the bounded buffer — limit un-acked in-flight messages so one consumer cannot hoard the queue (backpressure).
- **Acks** convert the channel's "received" into "durably processed," enabling at-least-once delivery and redelivery on consumer death.
- **Dead-letter queues** handle poison messages (items that always fail) — a failure mode the in-process channel has no concept of; locally you would route repeatedly-failing items to a side channel.
- **Partitions / shards** (Kafka) bound head-of-line blocking and give ordered parallelism — the broker analogue of per-key channel sharding.

The conceptual continuity is the whole point: bounded buffer, backpressure, fan-out to consumers, explicit overflow/loss policy. Whether it is a Go channel or a Kafka topic, you are reasoning about the same five things: bound, distribute, backpressure, ack/loss, shutdown.

---

## Designing a Pipeline into a Service

Encapsulate the pipeline behind a domain interface; callers should see "submit work / get results," not channels.

```go
type Ingestor struct {
    in       chan Record   // bounded
    workers  int
    overflow OverflowPolicy
    metrics  Metrics
}

// Submit applies the overflow policy; it never blocks unboundedly.
func (g *Ingestor) Submit(ctx context.Context, r Record) error {
    select {
    case g.in <- r:
        g.metrics.Accepted.Inc()
        return nil
    case <-ctx.Done():
        return ctx.Err()
    default:
        // Buffer full: apply policy instead of blocking forever.
        switch g.overflow {
        case Reject:
            g.metrics.Rejected.Inc()
            return ErrOverloaded // caller maps to HTTP 503
        case Block:
            select {
            case g.in <- r:
                return nil
            case <-ctx.Done():
                return ctx.Err()
            }
        }
    }
    return nil
}

func (g *Ingestor) Run(ctx context.Context) error {
    g2, gctx := errgroup.WithContext(ctx)
    for i := 0; i < g.workers; i++ {
        g2.Go(func() error {
            for {
                select {
                case r, ok := <-g.in:
                    if !ok {
                        return nil
                    }
                    if err := process(r); err != nil {
                        return err // first error cancels the group
                    }
                case <-gctx.Done():
                    return gctx.Err()
                }
            }
        })
    }
    return g2.Wait()
}
```

Note the layering: `errgroup` owns worker lifecycle and error propagation; the bounded `in` channel owns fan-out and backpressure; `Submit` owns the overflow policy and converts overload into a *caller-visible* error (a 503), terminating backpressure at the request boundary instead of letting it stall the accept loop.

---

## Observability and Operations

A push-pull stage is opaque without metrics. Track:

| Metric | Why |
|--------|-----|
| `queue_depth` (gauge) | Current buffered items. Persistently near capacity = consumer too slow. |
| `queue_capacity` | For the depth/capacity ratio (saturation). |
| `enqueue_blocked_seconds` | Time producers spend blocked = backpressure intensity. |
| `dropped_total` / `rejected_total` | Overflow policy firing = overload is happening. Alert on this. |
| `process_latency_seconds` (histogram) | Per-item service time; feeds Little's Law sizing. |
| `consumer_utilisation` | Are workers saturated? If not, the bottleneck is elsewhere. |

Operational signals:

- **Queue depth pinned at capacity + producers blocked:** the consumer is the bottleneck — scale workers or speed up processing.
- **`dropped_total` climbing:** you are shedding load; either capacity is short or there is an upstream surge. The drop metric is the early warning the senior file insisted on.
- **Queue depth always near zero, producers never blocked:** the buffer (or the stage) may be unnecessary — consider removing it.
- **Latency rising with flat throughput:** classic oversized-buffer symptom — items wait in a deep queue. Shrink the buffer to feel backpressure sooner.

Expose the channel depth via `len(ch)` / `cap(ch)` to a gauge on a ticker. A pipeline you cannot see the depth of is a pipeline you cannot operate.

---

## Interaction with the Wider System

- **Terminate backpressure at the request boundary.** A web service whose pipeline backpressures into the HTTP handler should return 503 (with `Retry-After`) rather than holding the connection — otherwise slow downstream → held connections → client timeouts → retries → more load (a retry storm / metastable failure).
- **Bound total in-flight, not just per-stage.** Several bounded stages still sum to a large total; cap the *aggregate* admitted work (a semaphore at admission) so the whole pipeline's memory is bounded.
- **Coordinate shutdown with the rest of the binary.** On `SIGTERM`: stop admitting (close the front door), drain the pipeline (close internal channels, `wg.Wait()`) within the shutdown deadline, then exit. Wire this into your server's graceful-shutdown path.
- **Backpressure and autoscaling.** Queue depth is an excellent autoscaling signal — scale consumers when depth/capacity stays high. Connect the metric to your HPA/scaler.
- **Pair with the worker-pool and pipeline patterns.** Push-pull is the substrate; those patterns are named compositions of it.

---

## War Stories

- **The unbounded channel that "fixed" a deadlock.** A team replaced a blocking `make(chan T, 100)` with a home-grown unbounded queue to stop producers blocking during a traffic spike. It worked in the demo. In production a downstream slowdown let the queue grow to tens of GB and the pod was OOM-killed mid-spike, dropping *all* in-flight work instead of the controlled slowdown the bounded channel would have given. Fix: restore the bound; add a `Reject` overflow policy returning 503.
- **Backpressure reached the accept loop.** A slow database stage backpressured all the way to the HTTP accept loop. Clients timed out at 30s and retried, tripling load — a metastable failure that did not recover until traffic was shed manually. Fix: a bounded admission semaphore that returns 503 immediately when the pipeline is saturated.
- **Lost work on shutdown.** Workers had `case <-ctx.Done(): return` in their loops; on deploy, `cancel()` fired and workers exited with thousands of buffered jobs undone. Customers noticed missing results. Fix: drain semantics (close the input, `wg.Wait()` within the shutdown budget); only abort if the budget is exceeded.
- **PUSH stalled on a dead worker.** A ZeroMQ PUSH socket kept round-robining to a worker whose process had hung but whose TCP connection was still open; a third of messages queued behind it. Fix: heartbeats + drop dead peers; do not assume PUSH/PULL detects a stuck consumer.

---

## Cheat Sheet

```text
INTRODUCE for: rate decoupling, parallelism (fan-out), burst absorption, streaming
SKIP for:      synchronous req/resp, same-rate stages, broadcast (every consumer sees all)
BOUND:         every buffer; cap aggregate in-flight; explicit overflow policy + metric
TERMINATE:     backpressure at a request reject (503), never the accept loop
DISTRIBUTED:   ZeroMQ PUSH/PULL (fair queue, HWM, no durability),
               NATS queue groups (+ JetStream for acks/redelivery),
               brokers (prefetch=buffer, ack=durably-done, DLQ=poison)
OPERATE:       queue_depth, blocked_seconds, dropped_total (alert), process_latency
SHUTDOWN:      stop admitting -> drain (close + wg.Wait within budget) -> exit
```

---

## Summary

At the professional level, push-pull is a continuum from the in-process channel to the cross-service broker, unified by the same five concerns: bound the buffer, distribute via fan-out, exert backpressure, decide the ack/loss policy, and choreograph shutdown. Introduce a channel for rate decoupling or parallelism, not decoration; bound every queue and convert overload into a visible, caller-facing reject (503) so backpressure never reaches the accept loop and triggers a retry storm. The distributed analogues — ZeroMQ PUSH/PULL (fair queuing, high-water-mark backpressure, no durability), NATS queue groups (load-balanced delivery, JetStream for acks and redelivery), and broker work queues (prefetch as the buffer, acks as durably-done, dead-letter queues for poison messages) — are the same pattern with durability and scale added. Operate it on queue depth, blocked time, and drop counts; shut it down by closing the front door, draining within budget, then exiting.
