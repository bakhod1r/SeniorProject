---
layout: default
title: Struct Method Promotion
parent: Methods & Interfaces
grand_parent: Go
nav_order: 19
has_children: false
permalink: /roadmap/programming-languages/golang/03-methods-and-interfaces/19-struct-method-promotion/
---

# Struct Method Promotion

[← Back](../)

We explore how Go promotes methods of an **embedded struct** to its outer struct. When a struct contains an anonymous (type-named) field, every exported and unexported method of the embedded type becomes callable on the outer struct as if it were declared there. This file is the entry point for **struct embedding**, not interface embedding (covered separately in `06-embedding-interfaces`).

In Go, struct embedding is the primary tool for **composition**. Combined with method promotion, it lets you reuse behavior across types without inheritance. The Go FAQ is explicit: *embedding is not inheritance* — there is no virtual dispatch, no `super`, no class hierarchy.

## Sub-pages

- [junior.md](junior.md) — Embedding basics, anonymous-field syntax, simple promotion
- [middle.md](middle.md) — Ambiguity, shadowing, qualification, value vs pointer embed
- [senior.md](senior.md) — Method-set propagation, interface satisfaction, refactoring
- [professional.md](professional.md) — Composition vs inheritance, large-codebase API design
- [specification.md](specification.md) — Spec on Struct types, Selectors, Method sets with embedding
- [interview.md](interview.md) — Interview questions and answers
- [tasks.md](tasks.md) — Exercises (easy → expert)
- [find-bug.md](find-bug.md) — Bug-finding exercises
- [optimize.md](optimize.md) — Embedding cost, layout, indirection
