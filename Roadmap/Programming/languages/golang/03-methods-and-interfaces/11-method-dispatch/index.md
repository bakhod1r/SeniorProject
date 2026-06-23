---
layout: default
title: Method Dispatch
parent: Methods & Interfaces
grand_parent: Go
nav_order: 11
has_children: false
permalink: /roadmap/programming-languages/golang/03-methods-and-interfaces/11-method-dispatch/
---

# Method Dispatch

[← Back](../)

This section is dedicated to the **runtime cost** of dispatching method calls in Go. We separate **static dispatch** (the compiler emits a direct call to a known function symbol) from **dynamic dispatch** (the call target is resolved at run time through `itab.fun[]`). The focus is on what the compiler can prove about the concrete type, what it cannot, and how to push hot paths into the cheaper category.

Topics covered include devirtualization in `cmd/compile`, the inliner's budget (~80 nodes since Go 1.22), the indirect-call penalty (~1-3 ns plus branch-predictor and icache effects), profile-guided optimization (PGO, GA in Go 1.21) for devirtualizing hot interface calls, generics dispatch via GCShape stenciling, benchmarking dispatch with `go test -bench`, and reading `-gcflags='-m'` output.

For method-set rules see [09-method-sets-deep](../09-method-sets-deep/). For the memory layout of `iface` and `eface` see [10-interface-internals](../10-interface-internals/). This section is strictly about *dispatch performance*.

## Sub-pages

- [junior.md](junior.md) — Static vs dynamic dispatch explained for newcomers
- [middle.md](middle.md) — Benchmarking dispatch, observing `itab.fun[]` in practice
- [senior.md](senior.md) — Compiler internals, devirtualization, PGO, generics dispatch
- [professional.md](professional.md) — Hot-path tuning, profile-driven decisions, observability
- [specification.md](specification.md) — Spec method-call semantics and `cmd/compile` references
- [interview.md](interview.md) — Interview questions on dispatch costs and devirtualization
- [tasks.md](tasks.md) — Exercises (easy → hard) with benchmarks and solutions
- [find-bug.md](find-bug.md) — Bug hunts around accidental dynamic dispatch
- [optimize.md](optimize.md) — Concrete-type pinning, inline-friendly receivers, PGO recipes
