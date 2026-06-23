---
layout: default
title: Select Statement
parent: Channels
grand_parent: Concurrency
nav_order: 2
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/02-channels/02-select-statement/
---

# Select Statement

[← Back](../)

`select` is Go's multi-way concurrent switch: it waits on several channel operations at once and proceeds with whichever one is ready. It powers timeouts, cancellation, fan-in, and the for-select loop, and it has subtle rules about randomness, defaults, nil channels, and panics that distinguish day-one Go from production-grade Go.

## Sub-pages

- [junior.md](junior.md) — Beginner walk-through of `select`, default, timeouts, and the for-select loop
- [middle.md](middle.md) — Patterns: cancellation, fan-in, nil-channel trick, time.NewTimer vs time.After
- [senior.md](senior.md) — Internals of `selectgo`, fairness, priority-select, performance trade-offs
- [professional.md](professional.md) — Production select architectures, scheduler interaction, leak audits, and observability
- [specification.md](specification.md) — Formal grammar and evaluation rules from the Go specification
- [interview.md](interview.md) — Interview questions and answers from junior to staff
- [tasks.md](tasks.md) — Hands-on exercises building real select-driven systems
- [find-bug.md](find-bug.md) — Bug-finding exercises with broken select code
- [optimize.md](optimize.md) — Optimization exercises for high-throughput select loops
