---
layout: default
title: Recursive Type Constraints
parent: Generics
grand_parent: Go
nav_order: 15
has_children: false
permalink: /roadmap/programming-languages/golang/04-generics/15-recursive-type-constraints/
---

# Recursive Type Constraints

[← Back](../)

We explore **recursive type constraints** in Go — a constraint where a type parameter `T` is required to satisfy an interface that itself references `T`. This pattern is known as **F-bounded polymorphism** in academic literature, and Go inherits it implicitly through the way generic interfaces can be reused as constraints. The result is a powerful but tricky tool: it lets you write fluent builders, self-cloning containers, and type-safe comparable hierarchies — but also runs into the limits of Go's type inference faster than any other generic feature.

## Sub-pages

- [junior.md](junior.md) — What is a self-referential constraint? `Cloner[T]` and `DupAll`
- [middle.md](middle.md) — F-bounded polymorphism explained; fluent builders; comparison vs the simple approach
- [senior.md](senior.md) — Limits in Go's expressiveness; recursion in inference; when the compiler gives up
- [professional.md](professional.md) — Real codebases: mocking frameworks, fluent APIs, ORMs; does the complexity pay off?
- [specification.md](specification.md) — Spec on type sets, type parameters, and interface implementation; why "F-bounded" is implicit
- [interview.md](interview.md) — 30+ Q&A on F-bounded polymorphism, inference, and pitfalls
- [tasks.md](tasks.md) — 20+ exercises (self-typed Builder, generic Comparable[T] hierarchy)
- [find-bug.md](find-bug.md) — 15+ bugs (incorrect recursion, inference failure, infinite-looking constraints)
- [optimize.md](optimize.md) — Cost of dictionary lookups in recursive bounds; simplifying when possible
