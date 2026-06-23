---
layout: default
title: Method Sets Deep
parent: Methods & Interfaces
grand_parent: Go
nav_order: 9
has_children: false
permalink: /roadmap/programming-languages/golang/03-methods-and-interfaces/09-method-sets-deep/
---

# Method Sets Deep

[← Back](../)

This section explores **method sets** at full depth — beyond the syntax-level "T has value methods, *T has both" rule that you saw in earlier sections. Here we focus on the deeper consequences: **addressability**, why a `T` value held inside an interface loses its `*T` methods, why `m["k"].M()` fails for pointer methods, how **embedding** propagates method sets when the embedded field is `T` versus `*T`, and how Go 1.22's per-iteration loop variable changes the behaviour of method values created in `for` loops.

Method sets are the silent contract between your concrete types and the interfaces they satisfy. Most "X does not implement Y (method has pointer receiver)" errors come from a misunderstood addressability rule — and most subtle bugs in dispatch tables, callback registries, and decorator chains live in the same area. This section is the reference page when those errors appear.

## Sub-pages

- [junior.md](junior.md) — What method sets are and the basic addressability story
- [middle.md](middle.md) — Map elements, interface boxing, embedding propagation
- [senior.md](senior.md) — Architecture: interface contracts, dispatch tables, Go 1.22 loops
- [professional.md](professional.md) — Production-grade addressability patterns and migration
- [specification.md](specification.md) — Go spec — Method_sets, Address_operators, Selectors
- [interview.md](interview.md) — Method set interview questions and answers
- [tasks.md](tasks.md) — Exercises (easy → expert)
- [find-bug.md](find-bug.md) — Bug-finding exercises around addressability
- [optimize.md](optimize.md) — Performance and cleaner-code guidance
