---
layout: default
title: Generic Type Aliases
parent: Modern Language Features
grand_parent: Go
nav_order: 4
has_children: false
permalink: /roadmap/programming-languages/golang/18-modern-language-features/04-generic-type-aliases/
---

# Generic Type Aliases

[← Back](../)

We explore *generic type aliases* — alias declarations that carry their own type parameters, fully supported in Go 1.24. An alias such as `type Set[T comparable] = map[T]struct{}` is not a new named type; after instantiation it is *identical* to its right-hand side, so `Set[int]` and `map[int]struct{}` are the same type everywhere the compiler reasons about identity.

## Sub-pages

- [junior.md](junior.md) — Aliases vs defined types, what `type Set[T] = ...` produces, instantiation
- [middle.md](middle.md) — Identity rules, constraint checking, no methods on aliases, inference
- [senior.md](senior.md) — API migration, re-exporting generic types without breaking identity, design trade-offs
- [professional.md](professional.md) — Spec semantics, the proposal-46477 / `aliastypeparams` timeline, edge cases the spec reveals
- [specification.md](specification.md) — Formal reference: "Alias declarations", parameterized form, version history
- [interview.md](interview.md) — Interview questions and answers from junior to staff
- [tasks.md](tasks.md) — Hands-on exercises (easy → hard)
- [find-bug.md](find-bug.md) — Bug-finding exercises with broken generic-alias scenarios
- [optimize.md](optimize.md) — Using generic aliases to simplify and de-noise generic APIs
