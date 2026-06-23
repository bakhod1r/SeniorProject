---
layout: default
title: Methods on Defined Types
parent: Methods & Interfaces
grand_parent: Go
nav_order: 16
has_children: false
permalink: /roadmap/programming-languages/golang/03-methods-and-interfaces/16-methods-on-defined-types/
---

# Methods on Defined Types

[← Back](../)

Topics 01-03 covered methods on **structs**. This section is about what most newcomers miss: a method's receiver does **not** have to be a struct. Any **defined type** — a primitive wrapper (`type Counter int`), a slice (`type IntSlice []int`), a map, a channel, or even a function (`type HandlerFunc func(...)`) — can carry methods. This page is the entry point that explores that wider design space.

We will look at the canonical Go-standard examples (`sort.IntSlice`, `http.HandlerFunc`, `time.Duration`), the rules that constrain you (no methods on aliases, no methods on types from other packages, no methods on `[]int` literally), and the design patterns that flow naturally from method-carrying primitives — domain primitives, type-safe IDs, and adapter types.

## Sub-pages

- [junior.md](junior.md) — Defined types vs aliases; methods on `int`, `string`, slice
- [middle.md](middle.md) — Methods on function types (HandlerFunc), slice types, sort interface
- [senior.md](senior.md) — Domain primitives, type-safe IDs, ADT-like usage
- [professional.md](professional.md) — DDD value objects, strong typing across boundaries, migration
- [specification.md](specification.md) — Spec on type definitions vs aliases, method declaration rules
- [interview.md](interview.md) — Interview Q&A on non-struct receivers
- [tasks.md](tasks.md) — Exercises (build sortable type, function-type methods, domain primitives)
- [find-bug.md](find-bug.md) — Bug exercises (alias vs defined, missing methods, byte/rune)
- [optimize.md](optimize.md) — Performance: zero-cost wrappers, inlining, escape
