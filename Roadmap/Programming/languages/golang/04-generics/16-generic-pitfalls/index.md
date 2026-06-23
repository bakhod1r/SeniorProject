---
layout: default
title: Generic Pitfalls
parent: Generics
grand_parent: Go
nav_order: 16
has_children: false
permalink: /roadmap/programming-languages/golang/04-generics/16-generic-pitfalls/
---

# Generic Pitfalls

[← Back](../)

We collect the **traps** that the Go compiler happily lets through. Code that compiles, type-checks, and ships — but bites you later. Unlike `10-generic-limitations`, which lists hard compile-time walls, and `07-generic-performance`, which measures raw nanoseconds, this topic is about **UX traps**: surprises in semantics, ergonomics, and review.

## Sub-pages

- [junior.md](junior.md) — The five classic pitfalls every beginner hits within their first week
- [middle.md](middle.md) — Type-switch limits, pointer/value generics, and zero-value comparisons
- [senior.md](senior.md) — Implicit boxing, lost inlining, and broken method-set assumptions
- [professional.md](professional.md) — Anti-patterns from real codebases and code-review heuristics
- [specification.md](specification.md) — Spec excerpts that explain WHY each pitfall happens
- [interview.md](interview.md) — 30+ Q&A on pitfalls and their fixes
- [tasks.md](tasks.md) — 20+ exercises that ask you to spot and fix pitfalls
- [find-bug.md](find-bug.md) — 15+ minimal buggy snippets to debug
- [optimize.md](optimize.md) — Pitfalls that quietly hurt performance and how to remove them
