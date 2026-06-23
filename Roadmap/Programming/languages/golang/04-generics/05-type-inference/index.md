---
layout: default
title: Type Inference
parent: Generics
grand_parent: Go
nav_order: 5
has_children: false
permalink: /roadmap/programming-languages/golang/04-generics/05-type-inference/
---

# Type Inference

[← Back](../)

We explore how Go's compiler **infers** type arguments at the call site of generic functions and types. Inference covers function argument type inference (FTAI), constraint type inference, untyped constants, and the practical limits of what the compiler can deduce on its own. This file is the entry point for this section.

## Sub-pages

- [junior.md](junior.md) — Core concepts, when inference works, common mistakes
- [middle.md](middle.md) — FTAI rules, constraint inference, version evolution (1.18 → 1.21+)
- [senior.md](senior.md) — API design for inference, readability tradeoffs, return-type strategies
- [professional.md](professional.md) — Production patterns, library guidance, case studies, migration
- [specification.md](specification.md) — Formal spec: type unification, FTAI, constraint inference
- [interview.md](interview.md) — 30+ interview questions and answers
- [tasks.md](tasks.md) — 25+ exercises (easy → hard)
- [find-bug.md](find-bug.md) — 20 buggy snippets where inference fails or surprises
- [optimize.md](optimize.md) — Reducing call-site noise, tooling, migration tactics
