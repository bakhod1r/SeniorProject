---
layout: default
title: Bridge-Channel Pattern
parent: Advanced Channel Patterns
grand_parent: Concurrency
ancestor: Go
nav_order: 3
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/11-advanced-channel-patterns/03-bridge-channel/
---

# Bridge-Channel

The **bridge-channel** pattern flattens a stream of channels (`<-chan <-chan T`) into a single, simple stream (`<-chan T`). The producer emits one inner channel after another — each representing a short-lived sub-stream such as a page, a batch, or a result-set for one query — and the bridge stitches them end-to-end so the consumer only sees a flat sequence of values.

The pattern was named and popularised by Katherine Cox-Buday in *Concurrency in Go* (O'Reilly, 2017), where it appears alongside `or-done`, `tee`, and `or` as a vocabulary for composable channel pipelines.

## Why this matters

Channel-of-channels is the natural shape whenever a producer creates a dynamic, unbounded sequence of finite sub-streams: paginated APIs, file-by-file scans, batches dispatched from an upstream scheduler, or per-query result fans. Consuming that shape directly forces every consumer to write a nested `for range` over channels — easy to get wrong, easy to leak, easy to break under cancellation. Bridge is the one-line adapter that lets a consumer stay simple while the producer stays expressive.

## What you will learn

- The exact shape problem: `<-chan <-chan T` vs `<-chan T`, and why the second is much easier to consume.
- A generic `bridge` function that reads each inner channel to completion, then moves to the next.
- How to compose `bridge` with `or-done` so cancellation propagates to inner streams.
- How bridge differs from fan-in (dynamic-over-time vs static N-to-1) and from a simple pipeline stage.
- Real use cases: paginated APIs, batch processors, multiplexed query result sets.
- The classic bugs: not draining inner channels, cancellation that never reaches the inside, nil inner channels that block forever.
