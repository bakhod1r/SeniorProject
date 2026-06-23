---
layout: default
title: Generic Functions
parent: Generics
grand_parent: Go
nav_order: 2
has_children: false
permalink: /roadmap/programming-languages/golang/04-generics/02-generic-functions/
---

# Generic Functions

[← Back](../)

We explore **generic functions** in Go — functions parameterized by type. With Go 1.18+ you can write a single function that works on many types: `func Foo[T any](x T) T`. This file is the entry point for this section.

## Sub-pages

- [junior.md](junior.md) — Syntax, type parameters, instantiation, first examples
- [middle.md](middle.md) — Type inference, multiple type params, closures, recursion
- [senior.md](senior.md) — Library design, flexibility vs simplicity, runtime cost
- [professional.md](professional.md) — Production patterns: Result/Option, pipelines, code review
- [specification.md](specification.md) — Formal spec, EBNF, instantiation rules
- [interview.md](interview.md) — Interview questions and answers
- [tasks.md](tasks.md) — Exercises (easy → hard)
- [find-bug.md](find-bug.md) — Bug-finding exercises
- [optimize.md](optimize.md) — Performance, specialization, benchmarks
