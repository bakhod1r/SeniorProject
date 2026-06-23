---
layout: default
title: Methods on Generic Types
parent: Generics
grand_parent: Go
nav_order: 11
has_children: false
permalink: /roadmap/programming-languages/golang/04-generics/11-methods-on-generic-types/
---

# Methods on Generic Types

[← Back](../)

We focus on the **mechanics of attaching methods to parameterised types** — receiver syntax, the rule that the receiver must list all type parameters, pointer vs value receivers, method sets after instantiation, and the deliberate prohibition of method-level type parameters. This page is the entry point for this section.

## Sub-pages

- [junior.md](junior.md) — Method receiver syntax for generic types; pointer vs value receiver basics
- [middle.md](middle.md) — Method sets after instantiation; type-level vs method-level constraints; why methods cannot introduce new type parameters
- [senior.md](senior.md) — Embedding generic types, method promotion, method values and method expressions
- [professional.md](professional.md) — Interface satisfaction with generic types; API design for generic methods
- [specification.md](specification.md) — Go spec excerpts on method declarations and parameterised receivers
- [interview.md](interview.md) — 30+ Q&A on receiver syntax, method-level type parameters, and pointer vs value receivers
- [tasks.md](tasks.md) — 20+ exercises with `Pair[K,V]`, `Optional[T]`, fluent builders, chained methods
- [find-bug.md](find-bug.md) — 15+ bugs around missing type parameters, mismatched constraints, ambiguous embedding
- [optimize.md](optimize.md) — Receiver kind impact, method dispatch cost, escape analysis through method values
