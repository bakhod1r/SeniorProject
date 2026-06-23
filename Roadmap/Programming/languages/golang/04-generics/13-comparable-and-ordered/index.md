---
layout: default
title: comparable and Ordered
parent: Generics
grand_parent: Go
nav_order: 13
has_children: false
permalink: /roadmap/programming-languages/golang/04-generics/13-comparable-and-ordered/
---

# `comparable` and `cmp.Ordered`

[← Back](../)

We focus on the **two most important predeclared/standard constraints** in Go's generics toolkit: `comparable` (built into the language) and `cmp.Ordered` (from the `cmp` package, Go 1.21+). Together they cover almost every algorithm that needs equality or ordering — sets, maps, sorted slices, lookups, deduplication, min/max, and binary search. This file is the entry point for this section.

## Sub-pages

- [junior.md](junior.md) — What is `comparable`? Why `==` and `!=` matter; map keys; predeclared constraint vs interface
- [middle.md](middle.md) — Pre-1.20 vs post-1.20 `comparable`; "strictly comparable"; what types qualify
- [senior.md](senior.md) — `cmp.Ordered` exact definition; float ordering and NaN; user-defined types via `~int`
- [professional.md](professional.md) — API design with `comparable` vs `cmp.Ordered`; why `Ordered` excludes complex; the 1.21 sortable shift
- [specification.md](specification.md) — Spec sections on predeclared identifiers, type sets, comparison operators; the 1.20 release-notes change
- [interview.md](interview.md) — 30+ Q&A on `any`/`comparable`/`Ordered`, NaN, struct comparability
- [tasks.md](tasks.md) — 20+ exercises: `Set[T comparable]`, `SortedSlice[T cmp.Ordered]`, NaN-safe code
- [find-bug.md](find-bug.md) — 15+ bugs around struct-with-slice comparison, NaN sort glitches, wrong constraints
- [optimize.md](optimize.md) — Equality cost for structs; comparison-dominated hot loops; choosing the right strategy
