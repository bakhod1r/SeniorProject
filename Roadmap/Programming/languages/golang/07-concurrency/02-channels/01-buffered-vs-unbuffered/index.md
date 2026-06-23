---
layout: default
title: Buffered vs Unbuffered Channels
parent: Channels
grand_parent: Concurrency
nav_order: 1
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/02-channels/01-buffered-vs-unbuffered/
---

# Buffered vs Unbuffered Channels

[← Back](../)

We compare Go's two channel flavours: unbuffered (`make(chan T)`), which forces the sender and receiver to rendezvous on every value, and buffered (`make(chan T, N)`), which lets up to `N` values queue without a partner. The choice changes synchronisation guarantees, deadlock surface area, performance characteristics, and the kind of bugs you can write.

## Sub-pages

- [junior.md](junior.md) — Channel basics, `make`, send/receive, blocking rules, closing, range-over-channel
- [middle.md](middle.md) — When to choose which, real-world signalling vs queuing, channel direction, common patterns
- [senior.md](senior.md) — Memory model, happens-before, hidden async, capacity-tuning antipatterns, leak prevention
- [professional.md](professional.md) — `hchan` internals, `chansend`/`chanrecv`, sudog queues, parking, hardware atomics
- [specification.md](specification.md) — Formal Go spec excerpts: channel types, send statements, receive operator, close
- [interview.md](interview.md) — Interview questions and answers from junior to staff
- [tasks.md](tasks.md) — Hands-on exercises for sending, receiving, closing, and ranging over channels
- [find-bug.md](find-bug.md) — Bug-finding exercises: deadlocks, send-on-closed panic, leaked receivers, range pitfalls
- [optimize.md](optimize.md) — Optimisations: oversized buffers, channel-per-message overhead, channels vs mutex/atomic
