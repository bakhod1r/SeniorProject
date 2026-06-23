---
layout: default
title: Tee-Channel Pattern
parent: Advanced Channel Patterns
grand_parent: Concurrency
ancestor: Go
nav_order: 2
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/11-advanced-channel-patterns/02-tee-channel/
---

# Tee-Channel

The **tee-channel** pattern takes a single input stream and duplicates every value to two independent downstream consumers. Each output receives the *same* sequence — not a partitioned subset — so the pattern is a broadcast of fixed fan-out two, not a load-balancing fan-out. The name comes from the Unix `tee` command, which forks `stdin` into both a file and `stdout`.

The pattern was popularised by Katherine Cox-Buday in *Concurrency in Go* (O'Reilly, 2017) as a companion to `or-done-channel`, `bridge-channel`, and `or`. Together they form a small vocabulary of channel combinators that compose into clean, leak-free pipelines.

## Why this matters

In real pipelines you frequently want one stage to feed both a primary consumer (business logic) and a secondary consumer (logger, metrics sink, audit trail, mirror). Reading the channel twice is impossible — a value taken by one reader is gone for the other. Sending to two channels naively works until one downstream slows down; then both stall. `tee` is the smallest correct solution to this universal problem.

## What you will learn

- Why "read once and re-emit" only works inside the producer, never outside it.
- The nil-channel-after-send trick that lets one goroutine drive two outputs fairly.
- A generic `tee[T any](done, in) (<-chan T, <-chan T)` implementation.
- Backpressure: the slowest consumer paces the producer, on purpose.
- Asymmetric variants — one buffered side, one unbuffered.
- When `tee` is not enough and you must reach for the broadcast hub.
