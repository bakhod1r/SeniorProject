---
layout: default
title: Generic Type Aliases
parent: Generics
grand_parent: Go
nav_order: 14
has_children: false
permalink: /roadmap/programming-languages/golang/04-generics/14-generic-type-aliases/
---

# Generic Type Aliases

[← Back](../)

We explore **generic type aliases** — the Go 1.24 feature that lets a `type X = Y` alias declaration carry its own type parameters. This was the last loose end of the original generics design: until 1.24, the rule "aliases must name an existing type **without** parameters" forced library authors into ugly workarounds when they wanted to re-export a generic type.

Topic 10 (`10-generic-limitations`) lists this restriction as one of the historical limitations of generics. This page is the dedicated counterpart that explains how the restriction was lifted.

## Sub-pages

- [junior.md](junior.md) — `type X = Y` vs `type X Y`; the new `type Vec[T any] = []T` form
- [middle.md](middle.md) — Pre-1.24 workarounds, migration, the `GOEXPERIMENT=aliastypeparams` window
- [senior.md](senior.md) — Identity rules, no new method set, interface satisfaction implications
- [professional.md](professional.md) — Real use case: moving generic types between packages without breaking callers
- [specification.md](specification.md) — Spec section on type alias declarations updated for type parameters; 1.24 release notes
- [interview.md](interview.md) — 30+ Q&A on alias vs defined type, methods on aliases, re-exports
- [tasks.md](tasks.md) — 20+ exercises refactoring packages to use generic aliases
- [find-bug.md](find-bug.md) — 15+ bugs around method declarations, identity, and migration mistakes
- [optimize.md](optimize.md) — Aliases are zero-cost (compile-time only); compile and binary-size impact
