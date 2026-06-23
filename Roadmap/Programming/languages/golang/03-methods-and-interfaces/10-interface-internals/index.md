---
layout: default
title: Interface Internals
parent: Methods & Interfaces
grand_parent: Go
nav_order: 10
has_children: false
permalink: /roadmap/programming-languages/golang/03-methods-and-interfaces/10-interface-internals/
---

# Interface Internals

[← Back](../)

This section opens the hood on Go's interface values. Every interface variable in Go is, at runtime, a **two-word header** — a pair of pointers. The first word identifies the dynamic type (and the method dispatch table); the second word holds (or points to) the data. Two flavors exist: `iface` for typed interfaces (`io.Reader`, `error`, ...) and `eface` for the empty interface (`any` / `interface{}`). Understanding this layout demystifies type assertions, the famous "typed-nil" gotcha, the cost of "boxing" small values, and how reflection navigates a value at runtime.

We focus here on **memory and runtime layout** — `runtime/iface.go`, `runtime/runtime2.go`, `itab` caching, the linker-built `itabTable`, comparison rules, and what reflection actually sees. Method-call performance and devirtualization are covered in the sibling topic [11-method-dispatch](../11-method-dispatch/); how to **declare** and use interfaces lives in [04-interfaces-basics](../04-interfaces-basics/).

## Sub-pages

- [junior.md](junior.md) — iface vs eface, two-word layout, first peek at itab
- [middle.md](middle.md) — itab fields, type assertions, boxing, typed-nil
- [senior.md](senior.md) — runtime source dive, itabTable, escape analysis, GC view
- [professional.md](professional.md) — production debugging, observability, FFI, migration
- [specification.md](specification.md) — spec citations, runtime/iface.go, runtime/runtime2.go
- [interview.md](interview.md) — 30+ Q&As on layout, dispatch table, gotchas
- [tasks.md](tasks.md) — Inspect interface internals via unsafe and reflect
- [find-bug.md](find-bug.md) — Typed-nil, comparison panics, escape regressions
- [optimize.md](optimize.md) — Avoid boxing, reduce itab pressure, prefer concrete types
