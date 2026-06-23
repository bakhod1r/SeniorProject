---
layout: default
title: Buffer Mechanics
parent: Channel Internals
grand_parent: Concurrency
ancestor: Go
nav_order: 3
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/09-channel-internals/03-buffer-mechanics/
---

# Buffer Mechanics

[← Back](../)

A buffered channel is, at the runtime level, a ring buffer with two cursor indices guarded by the same spin-mutex that guards every other field of `hchan`. `make(chan T, N)` allocates one contiguous block of `dataqsiz * elemsize` bytes immediately after the `hchan` header, points `hchan.buf` at it, and from then on every send writes at `sendx`, every receive reads at `recvx`, and both indices wrap modulo `dataqsiz`. The ring buffer is what makes a buffered channel decouple sender and receiver — but only when neither side is already parked, because direct hand-off always wins. This subsection takes apart the ring: how it is allocated, how the indices move, why a ring beats a linked list here, what happens for zero-sized element types like `chan struct{}`, and why "is the buffer full?" reduces to a single comparison `qcount == dataqsiz`.

## Sub-pages

- [junior.md](junior.md) — Friendly tour of the ring buffer, with diagrams and a tiny mental model
- [middle.md](middle.md) — `sendx`, `recvx`, `qcount`, `dataqsiz`, the modular arithmetic and the fast paths
- [senior.md](senior.md) — Allocation layout, `typedmemmove`, cache effects, GC scanning, race detector edges
- [professional.md](professional.md) — Walk through `makechan`, `chanbuf`, send/recv buffer paths in `runtime/chan.go`
- [specification.md](specification.md) — The invariants the ring buffer must maintain at every API boundary
- [interview.md](interview.md) — Interview questions about ring mechanics from junior to staff
- [tasks.md](tasks.md) — Build, instrument, and stress the ring buffer to internalise it
- [find-bug.md](find-bug.md) — Bugs that look like channel bugs but are really buffer-mechanic bugs
- [optimize.md](optimize.md) — Tuning buffer size and element layout for throughput and cache behaviour
