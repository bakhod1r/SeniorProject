# Wasm Interop & Performance — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [The Architecture Decision: Where Does the Boundary Belong](#the-architecture-decision-where-does-the-boundary-belong)
3. [Designing the Interop Layer as a Contract](#designing-the-interop-layer-as-a-contract)
4. [Coarse-Grained vs Fine-Grained Boundaries](#coarse-grained-vs-fine-grained-boundaries)
5. [Memory Ownership Across the Boundary](#memory-ownership-across-the-boundary)
6. [The Single-Thread Budget and Offloading Strategy](#the-single-thread-budget-and-offloading-strategy)
7. [Binary Size as a Product Constraint](#binary-size-as-a-product-constraint)
8. [The TinyGo Decision (Honestly)](#the-tinygo-decision-honestly)
9. [`js` vs `wasip1`: Choosing the Target](#js-vs-wasip1-choosing-the-target)
10. [Performance Envelope: What Go Wasm Can and Cannot Promise](#performance-envelope-what-go-wasm-can-and-cannot-promise)
11. [Profiling Strategy in a Constrained Environment](#profiling-strategy-in-a-constrained-environment)
12. [Failure Modes at Scale](#failure-modes-at-scale)
13. [Anti-Patterns](#anti-patterns)
14. [Senior-Level Checklist](#senior-level-checklist)
15. [Summary](#summary)

---

## Introduction

The senior question is not "how do I cross the boundary cheaply" — [middle.md](middle.md) covers the mechanics. It is "where should the boundary be, what is the interop layer's contract, what does the single-thread/binary-size budget allow, and is Go wasm the right tool for this feature at all." This file is about architecture and trade-offs.

After reading this you will:
- Place the Go↔host boundary deliberately, by data-flow shape, not by accident
- Design an interop layer that is a stable contract, testable off-wasm, and minimal in crossings
- Reason about memory ownership across the boundary and who frees what
- Spend the single-thread budget consciously and decide what to offload
- Treat binary size and startup as product constraints with explicit budgets
- Make the TinyGo and `js`-vs-`wasip1` decisions from first principles
- State Go wasm's honest performance envelope to stakeholders without overselling it

---

## The Architecture Decision: Where Does the Boundary Belong

The boundary's cost is fixed per crossing, so the architecture that minimises crossings is the one where the boundary sits at the **coarsest natural seam** of the data flow. The design heuristic: *find the smallest interface across which the most work happens*.

Three archetypes:

- **Compute kernel (boundary-light).** JS hands Go a buffer and parameters; Go runs a long, self-contained computation; Go hands back one result. Boundary crossings: O(1) per operation. This is the shape Go wasm rewards — image filters, codecs, parsers, solvers, simulation. The boundary is a thin RPC at the edges.
- **Stateful engine (boundary-moderate).** Go holds long-lived state (a document model, a game world, a spreadsheet) and JS drives it with discrete commands and queries. Crossings scale with *user actions*, not with data size or frame rate. Workable, if you keep the command set coarse.
- **UI glue (boundary-heavy).** Go updates the DOM node by node, reads events continuously, drives rendering imperatively. Crossings scale with DOM size and frame rate. This is the anti-shape: plain JS or a JS framework will be faster and an order of magnitude smaller. If the design pushes you here, reconsider whether wasm belongs.

The senior move is to recognise which archetype a feature is *before* committing, and to refuse the third unless there is a compelling reason (heavy compute that happens to also touch the DOM — in which case split it: compute in Go, render in JS).

---

## Designing the Interop Layer as a Contract

Treat the set of functions that cross the boundary as a published API between two systems, because that is what it is.

- **Isolate `syscall/js` in one package.** The rest of your Go is plain Go: pure functions over `[]byte`, structs, and primitives, unit-testable on a normal `go test` with no wasm at all. Only a thin adapter layer touches `js.Value`. This is the single highest-leverage structural decision — it keeps 95% of the code portable, testable, and reviewable without a browser.
- **Define the contract in terms of bytes and scalars, not handles.** A boundary function that takes `(ptr, len)` and returns a status code has a stable, language-agnostic contract. One that passes around `js.Value` graphs couples the two sides tightly and resists testing.
- **Make crossings batchy by design.** The contract should expose `applyBatch(ops []Op)` rather than `applyOne(op)`. Bake the batching into the interface so callers cannot accidentally drip.
- **Version the contract.** When Go and JS are deployed separately (different cache lifetimes, CDN), the boundary is a wire protocol that can skew. Treat it like any other API version.

A well-designed interop layer means a reviewer can read the Go business logic without knowing wasm exists, and the boundary surface is small enough to audit on one screen.

---

## Coarse-Grained vs Fine-Grained Boundaries

This is the central performance trade-off, and it is the same lesson as RPC design: chatty interfaces are slow.

```go
// FINE-GRAINED (chatty): JS calls Go once per cell. Crossings = N cells.
js.Global().Set("getCell", js.FuncOf(func(_ js.Value, a []js.Value) any {
    return sheet.Value(a[0].Int(), a[1].Int())
}))

// COARSE-GRAINED (batchy): JS asks for a whole region once. Crossings = 1.
js.Global().Set("getRegion", js.FuncOf(func(_ js.Value, a []js.Value) any {
    bytes := sheet.SerializeRegion(a[0].Int(), a[1].Int(), a[2].Int(), a[3].Int())
    out := js.Global().Get("Uint8Array").New(len(bytes))
    js.CopyBytesToJS(out, bytes)
    return out
}))
```

The coarse version moves more *bytes* per call but pays the per-call trap once instead of per cell. For a 100×100 region that is 1 crossing vs 10,000. The serialization cost (compute, inside the box) is cheap relative to 10,000 traps.

The design rule: **push aggregation across the boundary, not iteration**. JS should never loop calling Go; Go should never loop calling JS. Whichever side owns the iteration should do it on its own side and exchange the aggregate.

---

## Memory Ownership Across the Boundary

When you share linear memory zero-copy (middle.md), you create a lifetime contract that the type systems on neither side enforce. Get it wrong and you get use-after-free or silent corruption.

The ownership questions to answer explicitly per buffer:

- **Who allocates?** Usually Go (`make([]byte, n)`), because Go owns its linear memory.
- **Who reads, who writes?** A frame buffer written by Go and read by JS is fine if they do not overlap in time. Concurrent read/write is undefined — but recall there is only one thread, so "concurrent" here means *within a single synchronous call*, which is safe.
- **How long is the pointer valid?** Only for the duration of the synchronous JS call you handed it to, *and* only if the buffer cannot move or be collected. `runtime.KeepAlive` covers collection; you must never assume a pointer survives an `await` or a later event — by then the GC may have moved or freed it, or memory may have grown and detached the view.
- **Who frees?** Go's GC frees the slice once no Go reference remains. JS must not retain the pointer past the call. If JS needs the data later, it must copy it out (`CopyBytesToGo`-style) into its own heap.

The safe pattern: **share for the duration of one synchronous call; copy if it must outlive that call**. Treat the zero-copy view as a borrow, not a transfer of ownership.

---

## The Single-Thread Budget and Offloading Strategy

Go wasm has one thread. Everything — your compute, the GC, and (in the `js` target) the browser's main thread it shares — competes for it. Treat the frame budget as a hard resource.

At 60 fps you have ~16 ms per frame for *everything*. A Go computation that runs 30 ms blocks two frames of repaint. The strategies, in order of preference:

1. **Make the kernel fast enough to fit the budget.** Algorithmic work, not boundary work. This is where Go wasm's near-native compute pays off.
2. **Chunk and yield.** Break a long computation into slices that each fit the budget, yielding between them so the event loop can repaint and process input. A channel hop or `time.Sleep(0)` returns control to the scheduler.
3. **Offload to a Web Worker.** Run the Go wasm module in a Worker so its compute (and GC) happen off the main thread entirely; the main thread stays responsive and communicates via `postMessage`. This is the only way to get true parallelism with Go wasm today — multiple Workers, each its own instance, coordinated by JS. It is a JS-architecture decision, not a Go one.

The senior insight: Go wasm cannot use `SharedArrayBuffer`-backed Go threads, so "parallelism" means *multiple instances in multiple Workers*, not goroutines on cores. If a feature genuinely needs data parallelism, design for N Worker instances, not for goroutines.

---

## Binary Size as a Product Constraint

Size is not a developer-convenience metric; it is a user-facing latency and bandwidth cost that belongs in the product budget.

- **Set an explicit budget.** "First interactive wasm under X MB compressed" is a real NFR. A 1.5 MB brotli download on a 3G connection is seconds of delay before anything runs.
- **Measure compressed, not on-disk.** Users download the brotli/gzip size. The on-disk number is a red herring for product conversations.
- **Lazy-load.** If the wasm powers a feature that is not on the critical path (an editor opened on click, an export run on demand), do not load it at page load. Fetch and instantiate it when the feature is first invoked. This removes the entire wasm cost from initial page load.
- **Cache aggressively.** The `.wasm` changes rarely; serve it content-hashed with a long max-age so repeat visits pay zero. See [05-wasm-in-production](../05-wasm-in-production/senior.md).
- **Budget the runtime floor, do not fight it.** With standard Go you cannot get below ~1 MB compressed for anything real. Accept the floor or change compilers.

---

## The TinyGo Decision (Honestly)

TinyGo produces wasm an order of magnitude (sometimes two) smaller than the standard toolchain. That is real and sometimes decisive. But it is a different language runtime with real gaps, and choosing it is a significant commitment, not a build flag.

What TinyGo costs you:
- **Incomplete standard library.** Many packages are missing or partial; `net/http`, large parts of `reflect`, and others may not work.
- **Limited `reflect`.** Reflection-based serialization (`encoding/json` the usual way) is constrained or unavailable. Code-generated marshalling may be required.
- **Goroutine/scheduler differences.** Concurrency support is more limited and has historically had sharp edges.
- **A second toolchain to maintain**, with its own version skew, bug surface, and CI.

The honest decision rule: choose TinyGo when binary size is a *hard product constraint* (a public-facing widget where 1.5 MB is a non-starter) *and* the code is small/self-contained enough to live within TinyGo's subset — typically a focused compute kernel, not a port of a large Go application. For internal tools, dashboards, or anything reusing a large Go codebase, standard Go's size is usually an acceptable cost and TinyGo's gaps are not worth it. This topic is about standard Go interop; TinyGo's specifics live in the sibling [03-tinygo-for-wasm-and-embedded](../03-tinygo-for-wasm-and-embedded/senior.md). Do not let it become the default answer to "the binary is big."

---

## `js` vs `wasip1`: Choosing the Target

Two targets, two interop models:

- **`GOOS=js GOARCH=wasm`** — the browser. Host is JavaScript. Interop is `syscall/js` and `wasm_exec.js`. Boundary cost is the JS-value marshalling described throughout this topic. Use for browser features.
- **`GOOS=wasip1 GOARCH=wasm`** — WASI preview 1, a non-browser sandbox (Wasmtime, Wasmer, WasmEdge, edge runtimes). Host is the WASI ABI. Interop is host functions via `go:wasmimport`, not `syscall/js`. The boundary cost profile is different: calls are flat C-ABI-style functions over scalars and memory, not boxed JS values. See [02-wasi-and-wasip1](../02-wasi-and-wasip1/senior.md).

Binary size is in the same class for both — the runtime floor dominates either way. The decision is purely *where it runs*: browser → `js`; server/edge/plugin sandbox → `wasip1`. They are not interchangeable; code that uses `syscall/js` will not compile for `wasip1`, and vice versa for `go:wasmimport` host functions. Architect the interop layer behind a build-tagged interface if you must target both.

---

## Performance Envelope: What Go Wasm Can and Cannot Promise

State this honestly to stakeholders:

**Can promise:**
- CPU-bound kernels at roughly 1.5–3x native-Go time (engine-dependent), i.e. far faster than equivalent hand-written JS for heavy numeric/parsing work.
- Reuse of existing Go libraries with little change, in a sandboxed environment.
- Memory safety and the Go type system for complex client-side logic.

**Cannot promise:**
- Smaller bundles than JS. The floor is ~1 MB+ compressed with standard Go.
- True multicore parallelism. One thread; offload to Workers for parallel *instances*.
- Faster DOM/UI than JS. Boundary cost makes chatty UI slower, not faster.
- Pause-free execution. The GC runs on the one thread and can introduce jank under allocation pressure.
- Instant startup. Download + compile + instantiate is a measurable cost.

The summary you give a PM: *Go wasm is a compute accelerator and a code-reuse vehicle, not a UI framework and not a size optimization.* Match it to compute-heavy, boundary-light features.

---

## Profiling Strategy in a Constrained Environment

pprof is limited under wasm (no signal-based CPU profiling on the `js` target; goroutine/heap profiles are partial). Build a layered strategy:

1. **Classify first, in DevTools.** Record a Performance profile and answer one question: is the time in wasm execution (compute) or in `wasm_exec.js`/DOM (boundary)? This decides whether you optimise the algorithm or the crossing count.
2. **Instrument crossings.** A development-mode counter on the boundary layer turns "feels slow" into "12,000 crossings per frame" — a number you can drive down.
3. **Benchmark the kernel off-wasm.** Because the compute lives in a pure-Go package (per your interop design), you can `go test -bench` it natively, where pprof works fully. Optimise the algorithm there, then ship.
4. **Measure steady-state, not first-call.** JIT warmup makes the first iterations slow. Benchmark after warmup.
5. **Watch the GC.** Allocation rate (visible as GC frames in DevTools) correlates with jank. Reduce per-frame allocation before chasing micro-optimizations.

The architecture (pure kernel + thin adapter) is what makes profiling tractable: the slow part is benchmarkable natively, and the boundary is countable.

---

## Failure Modes at Scale

- **Detached-buffer regressions.** A view cached across a memory grow works in dev (small heap, no grow) and breaks in production (large input triggers a grow). Always re-derive views; test with inputs large enough to force a grow.
- **`js.Func` leaks under load.** A per-request/per-event callback never released grows the JS heap until the tab OOMs. Surfaces only in long-lived sessions. Audit every `FuncOf` for a matching `Release`.
- **Boundary cost discovered late.** A design that looked fine at 10 DOM nodes melts at 10,000. Estimate crossings × frequency during design, not after the demo.
- **Startup cliff on slow networks.** A 2 MB module that is fine on office wifi is a multi-second blank screen on mobile. Budget for the p90 network, not the developer's.
- **Toolchain/glue skew.** A cached old `wasm_exec.js` against a new `.wasm` fails obscurely. Version and cache-bust them together. See [05-wasm-in-production](../05-wasm-in-production/senior.md).

---

## Anti-Patterns

- **Using Go wasm as a UI framework.** Per-node DOM manipulation across the boundary; slower and larger than JS. Use Go for compute, JS for the DOM.
- **`syscall/js` smeared across the codebase.** Untestable, unportable, and the boundary surface becomes unauditable. Isolate it.
- **Iterating across the boundary.** JS looping calls into Go, or Go looping calls into JS. Aggregate on one side, exchange the whole.
- **Reaching for TinyGo to "fix size" reflexively.** Trading a working stdlib for kilobytes you may not need. Decide by hard constraint, not habit.
- **Caching transient `js.Value`/views.** Slow JS-heap leaks and detached-buffer bugs. Cache stable handles only; borrow transient ones.
- **Ignoring the single thread until the UI freezes.** Budget the frame; chunk or offload heavy work from the start.

---

## Senior-Level Checklist

You can move on to [professional.md](professional.md) when you can:

- [ ] Classify a feature into compute-kernel / stateful-engine / UI-glue and place the boundary accordingly
- [ ] Design an interop layer that isolates `syscall/js` and is testable off-wasm
- [ ] Convert a chatty boundary into a batchy one and justify the crossing-count reduction
- [ ] Specify the memory-ownership contract for a shared zero-copy buffer (allocate/read/write/free/lifetime)
- [ ] Decide between fitting the frame budget, chunking, and Worker offload for heavy compute
- [ ] Set a compressed binary-size budget and apply lazy-load + caching to meet it
- [ ] Make the TinyGo decision from a hard constraint, naming what it costs
- [ ] Choose `js` vs `wasip1` by deployment target and explain why they are not interchangeable
- [ ] State Go wasm's honest can/cannot-promise envelope to a non-engineer
- [ ] Lay out a profiling strategy given pprof's limits under wasm

---

## Summary

Senior-level Go wasm is an architecture problem: place the boundary at the coarsest seam of the data flow, because the per-crossing trap is fixed and chatty interfaces lose. Classify the feature — compute kernel (boundary-light, the sweet spot), stateful engine (boundary-moderate, workable), or UI glue (boundary-heavy, the anti-shape) — and design the interop layer as a versioned contract over bytes and scalars that isolates `syscall/js` so the bulk of the code stays pure, testable, and benchmarkable off-wasm. Aggregate across the boundary instead of iterating across it; treat shared linear memory as a borrow valid only for one synchronous call (re-derive views after any grow, copy if data must outlive the call). Spend the single-thread budget deliberately — fit the frame, chunk-and-yield, or offload to Web Workers for parallel *instances*, since Go gives you no true threads. Treat compressed binary size and startup as product NFRs met by lazy-loading and caching; reach for TinyGo only when size is a hard constraint and the code fits its incomplete subset, and choose `js` vs `wasip1` purely by where it runs. State the honest envelope: Go wasm is a compute accelerator and code-reuse vehicle, not a UI framework and not a size win.
