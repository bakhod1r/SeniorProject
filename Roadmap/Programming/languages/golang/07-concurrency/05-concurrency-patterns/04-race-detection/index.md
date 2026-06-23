---
layout: default
title: Race Detection
parent: Concurrency Patterns
grand_parent: Concurrency
nav_order: 4
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/05-concurrency-patterns/04-race-detection/
---

# Race Detection

[← Back](../)

We explore Go's race detector: what a data race is (concurrent access, at least one write, no happens-before edge), how `-race` instruments code via ThreadSanitizer, the runtime overhead, how to read race reports, the Go memory model and its happens-before edges, common race patterns (shared map, captured loop variable, double-checked locking), and the limitations of the detector.

## Sub-pages

- [junior.md](junior.md) — What a data race is, running `go run -race`, reading the report
- [middle.md](middle.md) — Memory model, happens-before, common race patterns, sync/atomic
- [senior.md](senior.md) — Detector internals, false negatives, CI integration, deeper memory model
- [professional.md](professional.md) — Production race-free design: sharded counters, sync.Map, lock-free queues
- [specification.md](specification.md) — Formal definition of a race, Go memory model edges, atomic semantics
- [interview.md](interview.md) — Interview questions and answers from junior to staff
- [tasks.md](tasks.md) — Hands-on exercises for finding and fixing races
- [find-bug.md](find-bug.md) — Ten broken-code race exercises
- [optimize.md](optimize.md) — Replacing mutex with atomic, sharded counters, batch updates
