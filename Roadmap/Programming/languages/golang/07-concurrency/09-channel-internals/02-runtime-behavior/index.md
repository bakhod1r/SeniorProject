---
layout: default
title: Runtime Behaviour
parent: Channel Internals
grand_parent: Concurrency
ancestor: Go
nav_order: 2
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/09-channel-internals/02-runtime-behavior/
---

# Channel Runtime Behaviour

[← Back](../)

What actually happens when a Go program runs `ch <- v`, `<-ch`, `close(ch)`, or `select`? This section traces every operation down into `runtime/chan.go`: the lock acquisition, the closed check, the direct hand-off optimisation that bypasses the buffer, the ring-buffer copy, the `gopark`/`goready` parking primitives, and the `selectgo` machinery that handles multi-channel coordination without deadlocking on its own internal locks.

## Sub-pages

- [junior.md](junior.md) — What a channel operation does step by step, blocking vs non-blocking, why send/receive sometimes panic
- [middle.md](middle.md) — Direct hand-off, sender/receiver queues, parking, the closed flag, fairness in `select`
- [senior.md](senior.md) — `chansend`/`chanrecv` walkthrough, `sudog` linked list, memory-model guarantees, scheduler interaction
- [professional.md](professional.md) — `selectgo` lock ordering, deadlock avoidance, performance numbers, spin-mutex behaviour, runtime source references
- [specification.md](specification.md) — Formal language spec excerpts plus runtime invariants documented in the Go source
- [interview.md](interview.md) — Questions about runtime mechanics from middle to staff level
- [tasks.md](tasks.md) — Exercises that exercise every runtime path: blocking, direct hand-off, close drain, select fairness
- [find-bug.md](find-bug.md) — Real bugs caused by misunderstanding the runtime: send-on-closed, leaked sudogs, select bias
- [optimize.md](optimize.md) — Tuning that depends on runtime behaviour: when to use channels, when to swap them out
