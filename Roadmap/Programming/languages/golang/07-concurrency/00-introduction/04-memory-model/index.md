---
layout: default
title: Memory Model
parent: Concurrency
grand_parent: Go
nav_order: 4
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/00-introduction/04-memory-model/
---

# Memory Model

[← Back](../)

The Go memory model defines the conditions under which one goroutine's reads can be guaranteed to observe another goroutine's writes. Without synchronisation, the compiler, the CPU, and the cache hierarchy are all free to reorder operations in ways that make naive shared-memory code observably wrong. The memory model says exactly which synchronisation primitives establish ordering — channels, mutexes, atomics, `sync.Once`, `sync.WaitGroup`, and goroutine creation all do — and how to reason about programs that use them.

Go's memory model was rewritten in 2022 to formalise atomic operations and to align with the C/C++/Java family of memory models. The new document is the authoritative reference and is much clearer than the 2014 original. This subsection covers the model from intuition (data races, happens-before) through pragmatic tooling (the race detector) to formal correctness (the spec).

## Sub-pages

- [junior.md](junior.md) — Data races, happens-before, channels and mutexes as synchronisation, the race detector
- [middle.md](middle.md) — Atomics, `sync.Once`, `sync.WaitGroup`, channel ordering rules, common race patterns
- [senior.md](senior.md) — Designing for race-freedom, lock-free patterns, ordering across libraries, race-free APIs
- [professional.md](professional.md) — CPU memory models (TSO, weak), how Go's model maps to hardware, race detector internals
- [specification.md](specification.md) — The 2022 Go memory model document, sequentially-consistent atomics, references
- [interview.md](interview.md) — Interview questions from junior to staff
- [tasks.md](tasks.md) — Hands-on exercises with the race detector and synchronisation
- [find-bug.md](find-bug.md) — Bug-finding exercises in subtly-racy code
- [optimize.md](optimize.md) — Optimization exercises balancing safety and speed
