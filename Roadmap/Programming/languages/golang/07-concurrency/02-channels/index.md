---
layout: default
title: Channels
parent: Concurrency
grand_parent: Go
nav_order: 2
has_children: true
permalink: /roadmap/programming-languages/golang/07-concurrency/02-channels/
---

# Channels

[← Back](../)

Channels are Go's typed, first-class communication primitive: a synchronised, optionally buffered queue that lets goroutines exchange values safely without explicit locks. They embody the language's slogan "Don't communicate by sharing memory; share memory by communicating." Used well, they coordinate goroutines, signal completion, fan work in or out, propagate cancellation, and impose backpressure. Used poorly, they leak goroutines, panic on closed sends, and silently deadlock.

## Sub-pages

- [01-buffered-vs-unbuffered](01-buffered-vs-unbuffered/) — Synchronous and asynchronous channels, blocking semantics, capacity, and choosing the right one
- [02-select-statement](02-select-statement/) — Multiplexing channels, timeouts, cancellation, default cases, and the for-select loop
- [03-worker-pools](03-worker-pools/) — Bounded concurrency with jobs and results channels, sizing, shutdown, and error propagation
