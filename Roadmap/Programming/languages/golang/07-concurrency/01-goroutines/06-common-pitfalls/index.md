---
layout: default
title: Goroutine Common Pitfalls
parent: Goroutines
grand_parent: Concurrency
ancestor: Go
nav_order: 6
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/01-goroutines/06-common-pitfalls/
---

# Goroutine Common Pitfalls

[← Back](../)

A catalogue of the bugs that everyone writing Go concurrency ships at least once. Each pitfall is short to describe, painful to debug, and often invisible until production load arrives. The goal of this subsection is not to scare you off `go func()` — it is to install reflexes: the trained eye that sees `wg.Add(1)` inside a goroutine and immediately flinches, the muscle memory that copies a loop variable into a parameter without thinking, the instinct to ask "how does this goroutine exit?" before writing the body.

This subsection complements — it does not replace — the deep-dive sections that follow. Goroutine leaks are covered in detail in [07-goroutine-lifecycle-leaks](../07-goroutine-lifecycle-leaks/); channel-specific mistakes have a full home in [02-channels/06-closing-channels](../../02-channels/06-closing-channels/) and [02-channels/07-channel-pitfalls](../../02-channels/07-channel-pitfalls/). What you get here is the consolidated *pattern library* of failure modes, with each entry pointing to deeper coverage where it exists.

## Sub-pages

- [junior.md](junior.md) — Every classic pitfall with a broken example, root cause, and fix; full TOC walk-through
- [middle.md](middle.md) — Pitfalls in real systems: request handlers, worker pools, context propagation, errgroup misuse
- [senior.md](senior.md) — Architectural pitfalls: ownership confusion, supervisor anti-patterns, leak budgets, shutdown contracts
- [professional.md](professional.md) — Runtime-level pitfalls: scheduler starvation, M leaks via cgo, GC pressure from goroutine churn
- [specification.md](specification.md) — Where each pitfall is rooted in (or excluded by) the Go specification and memory model
- [interview.md](interview.md) — Pitfall-flavoured interview questions: spot the bug, explain the symptom, propose the fix
- [tasks.md](tasks.md) — Exercises that reproduce, diagnose, and repair each pitfall
- [find-bug.md](find-bug.md) — The heaviest bug-finding section in the goroutines track: 25+ broken programs with full diagnosis
- [optimize.md](optimize.md) — Optimization exercises focused on eliminating leaks, reducing goroutine churn, and fixing degenerate cases
