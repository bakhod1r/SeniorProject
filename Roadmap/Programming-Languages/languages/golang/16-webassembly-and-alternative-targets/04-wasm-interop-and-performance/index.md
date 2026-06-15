---
layout: default
title: Wasm Interop & Performance
parent: WebAssembly & Alternative Targets
grand_parent: Go
nav_order: 4
has_children: false
permalink: /roadmap/programming-languages/golang/16-webassembly-and-alternative-targets/04-wasm-interop-and-performance/
---

# Wasm Interop & Performance

[← Back](../)

We explore the two things that make or break a Go-compiled WebAssembly module in the real world: the **interop boundary** (every call between Go and JavaScript through `syscall/js` and `wasm_exec.js`) and **performance** (binary size, the GC running inside a single-threaded sandbox, instantiation cost, and the death-by-a-thousand-boundary-calls problem). The headline levers are *minimise boundary crossings* and *share linear memory instead of copying it*.

## Sub-pages

- [junior.md](junior.md) — What the boundary is, why each `js.Value` call costs, binary size, and how to measure
- [middle.md](middle.md) — Caching handles, batching, `CopyBytesTo*`, shared TypedArrays, the grow gotcha
- [senior.md](senior.md) — Architecting the boundary, GC under wasm, startup cost, single-thread reality
- [professional.md](professional.md) — ABI internals, `go:wasmimport` on wasip1, profiling, size budgets
- [specification.md](specification.md) — Reference for `syscall/js`, the calling convention, and size flags
- [interview.md](interview.md) — Interview questions and answers from junior to staff
- [tasks.md](tasks.md) — Hands-on exercises (easy → hard)
- [find-bug.md](find-bug.md) — Bug-finding exercises with boundary and memory pitfalls
- [optimize.md](optimize.md) — Workflow and runtime optimizations for Go wasm
