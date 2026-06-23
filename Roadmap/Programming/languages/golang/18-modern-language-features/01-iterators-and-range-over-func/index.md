---
layout: default
title: Iterators & Range-over-Func
parent: Modern Language Features
grand_parent: Go
nav_order: 1
has_children: false
permalink: /roadmap/programming-languages/golang/18-modern-language-features/01-iterators-and-range-over-func/
---

# Iterators & Range-over-Func

[← Back](../)

We explore Go 1.23's range-over-function feature: the `iter` package, the `iter.Seq[V]` and `iter.Seq2[K,V]` push-iterator types, the `for x := range seq` desugaring, `iter.Pull`/`iter.Pull2`, and the standard-library helpers in `slices` and `maps`. This is the foundation for writing composable, allocation-free iteration in modern Go.

## Sub-pages

- [junior.md](junior.md) — What a range-over-func iterator is, `yield`, and writing your first one
- [middle.md](middle.md) — Desugaring, `break`/`continue`/`return`, `iter.Pull`, stdlib helpers
- [senior.md](senior.md) — Composition, pull-iterator lifecycle, leaks, API design trade-offs
- [professional.md](professional.md) — Compiler transform internals, inlining, the GOEXPERIMENT history
- [specification.md](specification.md) — Formal reference: spec wording, `iter` package, version gating
- [interview.md](interview.md) — Interview questions and answers from junior to staff
- [tasks.md](tasks.md) — Hands-on exercises (easy → hard)
- [find-bug.md](find-bug.md) — Bug-finding exercises with broken iterators
- [optimize.md](optimize.md) — Performance: allocations, inlining, pull vs push vs channels
