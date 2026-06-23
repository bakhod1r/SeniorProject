---
layout: default
title: CSP Model
parent: Concurrency
grand_parent: Go
nav_order: 2
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/00-introduction/02-csp-model/
---

# CSP Model

[← Back](../)

Communicating Sequential Processes (CSP) is a formal model of concurrency proposed by Tony Hoare in 1978. It treats a concurrent system as a collection of independent sequential processes that synchronise only by passing messages over named channels. There is no shared mutable state in pure CSP; everything is communicated. Go's `go` keyword and channels are a direct, pragmatic descendant of this model.

This subsection ties Go's syntax to the theory behind it. You will see why Rob Pike's slogan "Do not communicate by sharing memory; share memory by communicating" is not marketing — it is a 50-year-old research recommendation. You will also see what Go deliberately did not borrow from CSP (unbuffered-only channels, named processes, deadlock-checking type system) and where the actor model diverges.

## Sub-pages

- [junior.md](junior.md) — What CSP is, the "share memory by communicating" idea, basic channel-passing examples
- [middle.md](middle.md) — CSP operators (parallel composition, choice, synchronisation), how Go translates each, when to think in CSP terms
- [senior.md](senior.md) — Designing concurrent systems with CSP discipline, ownership transfer, refinement and equivalence
- [professional.md](professional.md) — Process algebras, FDR refinement checking, Go runtime's CSP implementation details
- [specification.md](specification.md) — Hoare's original paper, CSP syntax, references to formal works
- [interview.md](interview.md) — Interview questions on CSP, channels, and idiomatic Go concurrency
- [tasks.md](tasks.md) — Hands-on exercises in CSP-style Go
- [find-bug.md](find-bug.md) — Bug-finding exercises in CSP-violating code
- [optimize.md](optimize.md) — Optimization exercises in channel-heavy code
