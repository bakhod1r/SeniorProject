---
layout: default
title: Generic Limitations
parent: Generics
grand_parent: Go
nav_order: 10
has_children: false
permalink: /roadmap/programming-languages/golang/04-generics/10-generic-limitations/
---

# Generic Limitations

[← Back](../)

We catalogue the **hard limits** of Go generics — what the compiler refuses to accept, no matter how cleverly you phrase it. This file is the entry point for the section. Pitfalls that bite at runtime live in `16-generic-pitfalls`; the limits here are compile-time walls.

## Sub-pages

- [junior.md](junior.md) — Generics are not a silver bullet; the three top limits new readers meet
- [middle.md](middle.md) — Method type parameters, type-switch workarounds, generic type aliases history
- [senior.md](senior.md) — No HKT, no specialization, no SFINAE; structural-typing limits with method sets
- [professional.md](professional.md) — Real-world workarounds: codegen, interface fallbacks, runtime reflection
- [specification.md](specification.md) — Spec excerpts and proposal references (43651, 47781, 49085)
- [interview.md](interview.md) — 30+ Q&A on what generics cannot do and why
- [tasks.md](tasks.md) — 20+ exercises on identifying and working around each limit
- [find-bug.md](find-bug.md) — 15+ compile-error puzzles caused by misunderstanding limits
- [optimize.md](optimize.md) — Choosing the workaround with the lowest performance cost
