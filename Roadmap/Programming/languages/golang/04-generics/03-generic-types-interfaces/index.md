---
layout: default
title: Generic Types & Interfaces
parent: Generics
grand_parent: Go
nav_order: 3
has_children: false
permalink: /roadmap/programming-languages/golang/04-generics/03-generic-types-interfaces/
---

# Generic Types & Interfaces

[← Back](../)

We explore **generic types** and **generic interfaces** in Go: declaring `type Stack[T any] struct{}`, attaching methods that use the receiver's type parameters, type sets inside interfaces, and how instantiated generic types fit into Go's type system. This is the entry point for the section.

## Sub-pages

- [junior.md](junior.md) — Generic struct types, generic interfaces, methods on them, first examples
- [middle.md](middle.md) — Methods cannot add type parameters, type sets, embedded generic interfaces
- [senior.md](senior.md) — Encapsulation, type identity, package boundaries, concurrency-safe designs
- [professional.md](professional.md) — Production patterns: generic concurrent map, event bus, repository, builders
- [specification.md](specification.md) — Formal specification — TypeParameters grammar, instantiation rules
- [interview.md](interview.md) — 30+ interview questions and answers
- [tasks.md](tasks.md) — Exercises (easy → hard): `Set[T]`, `OrderedMap[K, V]`, `RingBuffer[T]`, generic graph
- [find-bug.md](find-bug.md) — 15+ buggy generic type definitions with hints, fixes, and explanations
- [optimize.md](optimize.md) — Cost analysis: monomorphization, dictionary passing, layout, allocations
