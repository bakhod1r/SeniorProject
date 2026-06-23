---
layout: default
title: Generic Performance
parent: Generics
grand_parent: Go
nav_order: 7
has_children: false
permalink: /roadmap/programming-languages/golang/04-generics/07-generic-performance/
---

# Generic Performance

[← Back](../)

We measure the **runtime cost** of Go generics — what GC shape stenciling actually does, when generic code is as fast as hand-written, and when it pays a measurable penalty. This file is the entry point for the section.

## Sub-pages

- [junior.md](junior.md) — Mental model: generics are not free; first benchmarks (generic vs interface vs concrete)
- [middle.md](middle.md) — GC-shape stenciling, dictionary-passing, escape analysis impact
- [senior.md](senior.md) — When generics are slower than interfaces; comparison with C++/Rust/Java
- [professional.md](professional.md) — Real perf migrations, profiling generic code with pprof, decision frameworks
- [specification.md](specification.md) — Pointers to the implementation design doc and runtime semantics
- [interview.md](interview.md) — 30+ Q&A on monomorphization, GC shape, dictionary cost
- [tasks.md](tasks.md) — 20+ exercises: benchmark generic vs interface; measure escape; inspect codegen
- [find-bug.md](find-bug.md) — 15+ perf traps: heap escapes, lost inlining, dictionary surprises
- [optimize.md](optimize.md) — Concrete techniques: hot-path specialization, when to drop generics
