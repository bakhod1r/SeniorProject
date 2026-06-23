---
layout: default
title: Sealed Interfaces
parent: Methods & Interfaces
grand_parent: Go
nav_order: 17
has_children: false
permalink: /roadmap/programming-languages/golang/03-methods-and-interfaces/17-sealed-interfaces/
---

# Sealed Interfaces

[← Back](../)

A **sealed interface** is a Go pattern where the interface contains an **unexported method**, so only types declared in the **same package** can satisfy it. Outside code cannot implement a sealed interface from scratch. This is Go's idiomatic way to emulate **closed sum types** (Algebraic Data Types) — the canonical examples are `go/ast.Node`, `reflect.Type`, and `go/types.Type`. Sealing trades extensibility for API stability and safer `type switch` dispatch.

## Sub-pages

- [junior.md](junior.md) — The pattern, simple Expr ADT, why unexported methods matter
- [middle.md](middle.md) — `ast.Node` walkthrough, naming conventions, embedding loophole
- [senior.md](senior.md) — ADT emulation, visitor alternative, type-switch perf
- [professional.md](professional.md) — Library API design, sealing strategies, migration
- [specification.md](specification.md) — Spec rules on identifier visibility, std-lib references
- [interview.md](interview.md) — Interview questions and answers
- [tasks.md](tasks.md) — Exercises (build sealed Expr, exhaustive switch, HTTP route ADT)
- [find-bug.md](find-bug.md) — Bug-finding exercises around sealed interfaces
- [optimize.md](optimize.md) — Type-switch perf, code generation, exhaustiveness checks
