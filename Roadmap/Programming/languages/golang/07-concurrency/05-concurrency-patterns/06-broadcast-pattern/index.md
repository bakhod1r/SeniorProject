---
layout: default
title: Broadcast Pattern
parent: Concurrency Patterns
grand_parent: Concurrency
ancestor: Go
nav_order: 6
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/05-concurrency-patterns/06-broadcast-pattern/
---

# Broadcast Pattern

Channels in Go are point-to-point: one value, one receiver. The **broadcast** pattern is what you reach for when *every* receiver must observe *every* value (or at least the same event). It shows up everywhere — shutdown signals, cache invalidation, real-time fan-out to WebSocket clients, leader-elected configuration push.

This subsection covers the full toolkit: the cheap "close a channel to wake all" idiom, hub-and-spoke pub/sub, `sync.Cond.Broadcast()`, and the inevitable slow-subscriber problem.

## Sections

- [Junior](junior.md) — what broadcast means, close-to-broadcast, first hub.
- [Middle](middle.md) — building a small pub/sub library, unsubscribe, buffered subscribers.
- [Senior](senior.md) — slow-subscriber strategies, lifecycle, sharded hubs, `sync.Cond.Broadcast`.
- [Professional](professional.md) — production pub/sub, sharding, observability, comparison with Redis / NATS / ZeroMQ.
- [Specification](specification.md) — precise semantics, invariants, edge cases.
- [Interview](interview.md) — questions from junior to staff level.
- [Tasks](tasks.md) — exercises building a broadcast hub from scratch.
- [Find the Bug](find-bug.md) — broken implementations and their fixes.
- [Optimize](optimize.md) — performance work on broadcast hubs.

## Cross-references

- `sync.Cond` is the synchronisation primitive for broadcast on condition variables.
- Fan-out (`05-concurrency-patterns/02-fan-out/`) splits *different* values across workers; broadcast sends the *same* value to all subscribers.
- Pipeline (`05-concurrency-patterns/03-pipeline/`) composes serial stages; broadcast is a single fan-shaped stage.
