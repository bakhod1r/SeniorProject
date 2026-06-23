---
layout: default
title: Premature Optimization
parent: Concurrency Anti-Patterns
grand_parent: Concurrency
ancestor: Go
nav_order: 4
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/15-concurrency-anti-patterns/04-premature-optimization/
---

# Premature Optimization

[← Back](../)

Donald Knuth's line is forty years old and still misquoted weekly: "premature optimization is the root of all evil." The full sentence ends "in (or at least most of) programming." It is not a license to write bad code; it is a warning that *unmeasured* optimization is a tax with no return. In concurrency this tax compounds: every goroutine, every channel, every `sync.RWMutex` that "felt faster" than `sync.Mutex` is a maintenance burden, an opportunity for a deadlock, an extra fence in the CPU pipeline. This subsection assembles the cases where Go programmers reach for sophisticated concurrency before benchmarking — sharding, `sync.Pool`, lock-free, atomics, RWMutex, channel-actors — and shows how often the "naive" mutex-or-loop wins.

## Sub-pages

- [junior.md](junior.md) — The Knuth quote, the benchmark-first mantra, five before/after demonstrations
- [middle.md](middle.md) — Production examples: sharding too soon, sync.Pool for cold objects, RWMutex regret
- [senior.md](senior.md) — Reviewing performance PRs, "is it actually faster?" gates, organisational norms
- [professional.md](professional.md) — Architectural premature optimization: actor frameworks, CRDTs, lock-free queues
- [specification.md](specification.md) — What the Go memory model and runtime promise about primitive cost
- [interview.md](interview.md) — Questions on when concurrency hurts, mutex-vs-atomic, RWMutex traps
- [tasks.md](tasks.md) — Hands-on: write the benchmark before the optimization, prove it or revert it
- [find-bug.md](find-bug.md) — Programs where "optimized" code is slower or wrong; spot why
- [optimize.md](optimize.md) — Optimization-of-optimization exercises: removing premature complexity
