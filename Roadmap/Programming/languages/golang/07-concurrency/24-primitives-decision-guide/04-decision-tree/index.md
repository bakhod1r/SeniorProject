---
layout: default
title: Decision Tree
parent: Primitives Decision Guide
grand_parent: Concurrency
ancestor: Go
nav_order: 4
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/24-primitives-decision-guide/04-decision-tree/
---

# Decision Tree for Picking the Right Primitive

[← Back](../)

The previous three subsections of this guide compared specific primitive pairs: channels vs mutexes, mutexes vs atomics, and when to reach for `sync.Cond`. This subsection unifies those local comparisons into a single, global decision tree. Given a concrete task — "increment a counter", "fan out work to N workers", "publish a snapshot to many readers", "wait for N tasks to finish" — the tree tells you which primitive to reach for first, which to reach for only when the obvious choice has a measurable problem, and which to never reach for at all. The point is not to memorize the tree but to internalize the questions it asks: *What am I synchronizing — state, signal, or both? How many writers? How many readers? Is the work one-shot or repeated? Bounded or unbounded?* Once those questions are reflexive, the primitive falls out by itself.

This is the file you re-read before a code review of any concurrent change, and the file you keep open in a second tab while writing one.

## Sub-pages

- [junior.md](junior.md) — Walk through the decision tree case by case with code examples for each branch
- [professional.md](professional.md) — Production case studies where the wrong primitive caused a problem; pre-merge review checklist
- [specification.md](specification.md) — Normative godoc passages for `sync.Map`, `sync.Pool`, `x/sync/errgroup`, `x/sync/semaphore`
- [interview.md](interview.md) — 30+ "given scenario X, which primitive?" questions
- [tasks.md](tasks.md) — 10 mini-scenarios; pick a primitive and implement
- [find-bug.md](find-bug.md) — Cases where the wrong primitive was picked
- [optimize.md](optimize.md) — Benchmark tables, cache-line awareness, when batching beats per-op synchronization
