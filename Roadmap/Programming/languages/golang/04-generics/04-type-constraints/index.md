---
layout: default
title: Type Constraints
parent: Generics
grand_parent: Go
nav_order: 4
has_children: false
permalink: /roadmap/programming-languages/golang/04-generics/04-type-constraints/
---

# Type Constraints

[← Back](../)

Type constraints are the rules that tell the Go compiler **which concrete types are acceptable** as a type argument for a generic function or generic type. A constraint is just an interface — but interfaces in the constraint position can do more than describe methods: they can describe **type sets** using union (`|`), method elements, and the underlying-type approximation operator `~`.

This section covers `any`, `comparable`, custom constraints, type unions (`int | string`), the tilde (`~int`), the `golang.org/x/exp/constraints` package, and constraint composition strategies.

## Sub-pages

- [junior.md](junior.md) — Introduction, glossary, `any`, `comparable`, first custom constraints
- [middle.md](middle.md) — Type sets, union, intersection, the `~` operator, the `constraints` package
- [senior.md](senior.md) — Constraint hierarchies, `comparable` semantics, composition, library design
- [professional.md](professional.md) — Production constraints, numeric pipelines, code review checklist
- [specification.md](specification.md) — Formal spec: TypeConstraint grammar, type sets, method elements
- [interview.md](interview.md) — 30+ Q&A on constraints, type sets, and `~`
- [tasks.md](tasks.md) — 20+ exercises, from designing simple constraints to type-safe DSLs
- [find-bug.md](find-bug.md) — 15+ buggy constraint definitions with hints and fixes
- [optimize.md](optimize.md) — Choosing the most permissive constraint, monomorphization vs dictionary
