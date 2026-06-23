---
layout: default
title: Stdlib Generic Packages
parent: Generics
grand_parent: Go
nav_order: 12
has_children: false
permalink: /roadmap/programming-languages/golang/04-generics/12-stdlib-generic-packages/
---

# Stdlib Generic Packages

[← Back](../)

We tour the **three anchor packages** that brought generics into Go's standard library in 1.21 and grew through 1.22, 1.23, and 1.24: `slices`, `maps`, and `cmp`. This file is the entry point for this section.

## Sub-pages

- [junior.md](junior.md) — Tour of `slices`, `maps`, and `cmp` for newcomers
- [middle.md](middle.md) — `*Func` variants, `cmp.Compare` integration, multi-key sorting
- [senior.md](senior.md) — Algorithmic guarantees, aliasing, in-place vs copying APIs
- [professional.md](professional.md) — Migration story from `sort.Slice` and manual loops; release-by-release additions
- [specification.md](specification.md) — Accurate signatures and pkg-doc excerpts for the most important functions
- [interview.md](interview.md) — 30+ Q&A on `slices`, `maps`, `cmp`
- [tasks.md](tasks.md) — 20+ exercises that exercise the stdlib generic API
- [find-bug.md](find-bug.md) — 15+ misuse bugs caught in real code reviews
- [optimize.md](optimize.md) — Pre-allocation, `Compact` vs `CompactFunc`, `BinarySearch` vs `Index`
