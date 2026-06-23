---
layout: default
title: Why Generics?
parent: Generics
grand_parent: Go
nav_order: 1
has_children: false
permalink: /roadmap/programming-languages/golang/04-generics/01-why-generics/
---

# Why Generics?

[← Back](../)

We explore the **motivation** behind generics in Go — the problems they solve, the historical context, and why Go 1.18 introduced type parameters after more than a decade without them. This file is the entry point for this section.

## Sub-pages

- [junior.md](junior.md) — What problem do generics solve? First mental models
- [middle.md](middle.md) — Why Go waited until 1.18; comparison with `interface{}`, codegen, and other languages
- [senior.md](senior.md) — Architectural tradeoffs: when to use generics vs interfaces vs duplication
- [professional.md](professional.md) — Real-world adoption: stdlib (`slices`, `maps`, `cmp`), migration strategies, case studies
- [specification.md](specification.md) — Formal Go spec excerpts on type parameters and parameterized declarations
- [interview.md](interview.md) — 30+ Q&A on the motivation and design of generics
- [tasks.md](tasks.md) — 20+ exercises that highlight WHY generics help
- [find-bug.md](find-bug.md) — 15+ bugs avoided (or caused) by generics
- [optimize.md](optimize.md) — Performance comparisons and when NOT to reach for generics
