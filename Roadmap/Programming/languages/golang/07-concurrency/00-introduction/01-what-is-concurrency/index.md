---
layout: default
title: What is Concurrency
parent: Concurrency
grand_parent: Go
nav_order: 1
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/00-introduction/01-what-is-concurrency/
---

# What is Concurrency

[← Back](../)

Concurrency is the discipline of structuring a program as multiple independent tasks that may make progress over the same time interval. It is a way of *thinking* about composition, not a guarantee of simultaneous execution. Parallelism — the actual *simultaneous* running of those tasks on more than one CPU at the same instant — is one possible outcome of concurrency, but not its definition. Rob Pike's slogan still applies: "concurrency is about dealing with lots of things at once, parallelism is about doing lots of things at once."

This first stop on the concurrency roadmap establishes the conceptual ground: the difference between concurrency and parallelism, the historical motivations (I/O wait, multi-core hardware, Amdahl's law), the kinds of speedups you can and cannot expect, and the way Go expresses concurrency through goroutines and channels. The vocabulary you build here is reused for the rest of the chapter.

## Sub-pages

- [junior.md](junior.md) — Definitions, the concurrency-vs-parallelism distinction, why concurrency exists, and first examples in Go
- [middle.md](middle.md) — Amdahl's and Gustafson's laws, classes of concurrent workloads, scheduling models, common patterns
- [senior.md](senior.md) — Architectural decisions, when concurrency hurts, structured concurrency, ownership and lifetime models
- [professional.md](professional.md) — Hardware reality: pipelines, caches, false sharing, NUMA, and what concurrency costs at the instruction level
- [specification.md](specification.md) — Formal definitions from Go's spec and memory model, references to seminal papers
- [interview.md](interview.md) — Interview questions from junior to staff
- [tasks.md](tasks.md) — Hands-on exercises to build intuition for concurrency-vs-parallelism
- [find-bug.md](find-bug.md) — Bug-finding exercises rooted in confusing concurrency with parallelism
- [optimize.md](optimize.md) — Optimization exercises: turning sequential code concurrent, measuring real speedup
