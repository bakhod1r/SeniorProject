---
layout: default
title: Push-Pull
parent: Concurrency Patterns
grand_parent: Concurrency
ancestor: Go
nav_order: 8
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/05-concurrency-patterns/08-push-pull/
---

# Push-Pull

Two goroutines, one channel. The producer **pushes** work onto the channel; the consumer **pulls** it off at its own pace. When the channel's buffer fills, the producer *blocks* — and that blocking is not a bug, it is the whole point. A full channel applies **backpressure**: the slow consumer automatically throttles the fast producer, so memory stays bounded and the system finds its natural rate. This is the most fundamental coordination shape in Go, and it is hiding inside almost every pipeline you will ever write.

This subsection covers the full toolkit: push (producer-driven) vs pull (consumer-driven) vs hybrids, bounded vs unbounded queues and why unbounded queues are an OOM trap, fan-out across N consumers pulling from one channel, backpressure as flow control, graceful shutdown and draining with `context`, and — at a conceptual level — the distributed analogue (ZeroMQ PUSH/PULL sockets and NATS queue groups) so you recognise the same pattern when it crosses a network.

## When to reach for it

Reach for push-pull whenever a producer and a consumer run at *different, varying rates* and you want the slower side to govern the pace without dropping or buffering unboundedly:

- **Ingest pipelines.** A reader pushes lines/records; a parser pulls and processes. The parser's speed limits the reader — exactly what you want, so you do not read a 100 GB file into RAM.
- **Worker pools.** One dispatcher pushes jobs onto a channel; N workers pull. The channel fairly distributes work to whichever worker is free.
- **Rate-decoupled stages.** A burst-y network source feeds a steady CPU stage; a bounded buffer absorbs bursts and backpressures the source when full.
- **Streaming transforms.** Each stage of a Go pipeline is a push-pull pair connected by a channel.

If producer and consumer run at the *same* rate and never burst, an unbuffered channel (a pure rendezvous) is the degenerate, simplest case. If you need *every* consumer to see *every* item, that is broadcast, not push-pull.

## Sections

- [Junior](junior.md) — push, pull, backpressure, the unbuffered and small-buffered channel.
- [Middle](middle.md) — fan-out to N pullers, bounded vs unbounded, context cancellation and draining.
- [Senior](senior.md) — idiomatic shutdown, performance, where push-pull fails, hybrids and pull-based credit.
- [Professional](professional.md) — team guidance, review, distributed PUSH/PULL (ZeroMQ, NATS) and queues.
- [Specification](specification.md) — precise semantics, invariants, edge cases, reference implementation.
- [Interview](interview.md) — questions from junior to staff level.
- [Tasks](tasks.md) — exercises building push-pull pipelines from scratch.
- [Find the Bug](find-bug.md) — broken pipelines and their fixes.
- [Optimize](optimize.md) — performance work on push-pull pipelines.

## Cross-references

- Channels (`07-concurrency/01-goroutines-channels/`) — the buffered/unbuffered channel *is* the in-process push-pull mechanism.
- Fan-out / fan-in (`05-concurrency-patterns/02-fan-out/`) — N consumers pulling from one channel is fan-out; merging their results is fan-in.
- Pipeline (`05-concurrency-patterns/03-pipeline/`) — a pipeline is a chain of push-pull stages.
- Worker pool (`05-concurrency-patterns/04-worker-pool/`) — a worker pool is push-pull with N pullers sharing one job channel.
- `context` (`07-concurrency/03-context/`) — cancellation and draining of a push-pull pipeline.
- Distributed analogues: ZeroMQ PUSH/PULL sockets, NATS queue groups, and broker-backed work queues (covered conceptually in professional.md).
