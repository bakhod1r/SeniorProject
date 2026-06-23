# Wasm Interop & Performance — Interview Questions

> Practice questions ranging from junior to staff-level. Each has a model answer, common wrong answers, and follow-up probes. The subject is the Go↔host boundary cost and the performance of Go-compiled WebAssembly (`GOOS=js` primarily, with `wasip1` contrasts).

---

## Junior

### Q1. What is a "boundary crossing" and why does it matter?

**Model answer.** A boundary crossing is any operation that passes control between Go (running inside the wasm sandbox) and the JavaScript host — `Get`, `Set`, `Call`, `Invoke`, `New`, `ValueOf`, and the scalar extractors. Each has a fixed per-call overhead (argument boxing, a trap out of wasm, reference-table lookup, the JS op, result boxing back). It matters because the cost is per call, not per byte, so a million tiny crossings is far more expensive than one large transfer. Minimising crossings is the primary performance lever.

**Common wrong answers.**
- "It's the cost of running wasm." (No — pure wasm compute has no crossing; the cost is specifically the Go↔JS transition.)
- "Bigger payloads are slower." (Largely no — the per-call trap dominates; payload size matters far less than call count.)

**Follow-up.** *Name the operations that cross.* — `Get`, `Set`, `Index`/`SetIndex`, `Call`, `Invoke`, `New`, `ValueOf`, and `Int()`/`Float()`/`String()`/`Bool()`.

---

### Q2. Why is a hello-world Go wasm binary about 2 MB?

**Model answer.** Because the browser has no Go runtime. The goroutine scheduler, garbage collector, allocator, `reflect`, and runtime type metadata all ship *inside* the `.wasm`. Your three lines of code are negligible; the file is the runtime.

**Common wrong answers.**
- "Because Go is verbose / my code is big." (No — code is a rounding error.)
- "Because it's uncompressed." (Compression shrinks the download, not the runtime that must ship.)

**Follow-up.** *What does `-ldflags="-s -w"` save?* — A few hundred KB by dropping the symbol table and DWARF debug info; same order of magnitude, because it only touches name/debug sections, not the runtime.

---

### Q3. Is a `js.Value` a copy of the JavaScript object?

**Model answer.** No. It is a handle — a reference across the boundary to a live JS value. Every operation on it (`Get`, `Set`, `Call`) crosses to act on the real object. Caching a stable handle is cheap; refetching it in a loop wastes crossings.

**Common wrong answers.**
- "Yes, it's the JS object in Go memory." (Wasm cannot hold a JS reference directly; it holds an index into a JS-side table.)

**Follow-up.** *So what is cheap to cache and what leaks?* — Caching stable handles (document, a canvas) is cheap; hoarding transient handles (one per DOM node forever) leaks JS-heap memory.

---

### Q4. Why does my page freeze when a Go loop runs?

**Model answer.** Go wasm is single-threaded and shares the JS main thread. A long Go loop never blocks, so the runtime never yields control back to the event loop, so the browser cannot repaint or process input until the loop finishes. Goroutines are concurrency, not parallelism — they time-share that one thread.

**Common wrong answers.**
- "Spawn more goroutines to fix it." (They share the same thread; no help.)

**Follow-up.** *How do you fix it?* — Make the kernel fit the frame budget, chunk-and-yield (a channel hop or `time.Sleep`), or offload to a Web Worker.

---

## Middle

### Q5. How do you move a 4 MB image buffer from JS to Go efficiently?

**Model answer.** `js.CopyBytesToGo(dst, src)` where `src` is a `Uint8Array`. It performs one crossing and one native memory copy regardless of size, returning the bytes copied. The wrong way is a loop of `src.Index(i).Int()` — that is four million crossings.

**Follow-up.** *And if you transfer it every frame?* — Even the copy is wasteful; share linear memory zero-copy by handing JS a `(ptr, len)` and letting it construct a `Uint8Array` over `exports.mem.buffer`.

---

### Q6. You share a `Uint8Array` view over wasm memory and it works, then renders garbage after a while. Why?

**Model answer.** Wasm memory grew (the Go heap needed more space → `memory.grow`), and the engine reallocated the backing `ArrayBuffer`, detaching the old one. The cached `Uint8Array` over the old buffer is now invalid — `byteLength` is 0, reads return nothing or throw. The fix is to re-derive the view from the current `exports.mem.buffer` on every use, never cache it.

**Common wrong answers.**
- "Race condition." (Single thread; not a race.)
- "GC moved the data." (`runtime.KeepAlive` covers that; the detach is the buffer reallocation.)

**Follow-up.** *Why does it pass in tests but fail in production?* — Small test inputs never trigger a grow; large production inputs do. Test with inputs big enough to force a grow.

---

### Q7. When must you call `Func.Release()`?

**Model answer.** Whenever you create a `js.Func` that does not live for the program's lifetime — a callback per event, per promise, per interval. The JS side holds the reference and its table slot never drops on its own, so each unreleased transient `Func` leaks the slot and its captured closure. A `Func` registered once at startup for the program's life need not be released.

**Follow-up.** *Where do you put the `Release` for a one-shot promise callback?* — `defer cb.Release()` inside the callback body, so it frees after firing.

---

### Q8. How do you profile a Go wasm app when pprof barely works?

**Model answer.** Layered: classify in the browser DevTools Performance panel (is time in wasm compute or in glue/DOM?), instrument a crossing counter in dev, watch `runtime.ReadMemStats` for GC/heap signals, and — decisively — keep the compute in a pure-Go package and `go test -bench` it on a native build where pprof works fully.

**Common wrong answers.**
- "Use `go tool pprof` CPU profiles." (No SIGPROF on the `js` target; CPU profiling is effectively unavailable there.)

**Follow-up.** *Why benchmark the steady state?* — JIT warmup makes the first iterations slow; the steady state is the real number.

---

### Q9. Why is one call moving 1 MB cheaper than a million calls moving 1 byte?

**Model answer.** The per-call cost (argument boxing, the wasm trap, reference-table indirection, result boxing) is fixed and paid once per call. Moving 1 MB in one `CopyBytesToJS` pays that once plus a memmove. A million one-byte crossings pay the fixed trap a million times. Crossing count, not byte count, dominates.

**Follow-up.** *What design principle follows?* — Batch/aggregate across the boundary; never iterate across it.

---

## Senior

### Q10. How do you decide where the boundary belongs in a feature?

**Model answer.** By the data-flow archetype. Compute kernel (JS hands a buffer, Go computes, returns one result — O(1) crossings, the sweet spot). Stateful engine (Go holds state, JS drives with coarse commands — crossings scale with user actions). UI glue (per-node DOM updates — crossings scale with DOM size and frame rate, the anti-shape). Place the boundary at the coarsest seam where the most work happens, and refuse the UI-glue shape unless you split compute (Go) from rendering (JS).

**Follow-up.** *Concrete refactor of a chatty boundary?* — Replace `getCell(r,c)` called per cell with `getRegion(...)` returning a serialized block in one crossing.

---

### Q11. Should you use TinyGo to fix binary size?

**Model answer.** Only when size is a *hard product constraint* and the code is small and self-contained enough to live within TinyGo's subset. TinyGo produces 10–100x smaller wasm but ships an incomplete stdlib, limited `reflect` (so reflection-based JSON breaks), and constrained goroutine support — plus it is a second toolchain to maintain. For internal tools or a port of a large Go codebase, standard Go's size is usually the acceptable cost. It is a real trade-off, not a free win.

**Common wrong answers.**
- "Always use TinyGo for wasm." (Trades a working stdlib for kilobytes you may not need.)

**Follow-up.** *Cross-link?* — The TinyGo specifics live in the sibling 03-tinygo-for-wasm-and-embedded.

---

### Q12. How do you get parallelism out of Go wasm?

**Model answer.** You do not get it from goroutines — they share one thread. The only path to true parallelism is multiple wasm *instances* in multiple Web Workers, each its own module, coordinated by JS via `postMessage`. Go has no `SharedArrayBuffer`-backed threads on this target, so "parallel" means N instances, not goroutines on cores.

**Follow-up.** *What is the GC implication?* — Each instance has its own runtime and GC on its own Worker thread, so GC no longer steals the main thread.

---

### Q13. How do you architect the interop layer so the code stays testable?

**Model answer.** Isolate all `syscall/js` calls in one thin adapter package. The rest of the code is pure Go — functions over `[]byte`, structs, scalars — unit-testable and benchmarkable on a normal `go test` with no browser. The boundary contract is defined in bytes and scalars, not `js.Value` graphs, so it is small enough to audit and language-agnostic. This is the single highest-leverage structural decision.

**Follow-up.** *Benefit for profiling?* — The slow compute is benchmarkable natively where pprof works fully.

---

## Staff

### Q14. Contrast the boundary cost of `syscall/js` (js target) with `go:wasmimport` (wasip1).

**Model answer.** On `js`, a crossing boxes values with NaN-boxing, allocates reference-table slots for objects, and traps through `wasm_exec.js` — relatively heavy per call. On `wasip1`, `go:wasmimport` is a direct wasm call to a host function with scalar arguments (`i32/i64/f32/f64`) and pointers passed as offsets into linear memory — closer to a C FFI call, no table, no boxing, generally cheaper per call. The targets are not interchangeable: `syscall/js` code will not compile for `wasip1` and vice versa.

**Follow-up.** *When do you pick which?* — Browser → `js`; server/edge/plugin sandbox → `wasip1`. Cross-link 02-wasi-and-wasip1.

---

### Q15. A production Go wasm session slowly consumes memory until the tab crashes. Diagnose.

**Model answer.** Two prime suspects. (1) `js.Func` leak — a per-event/per-promise callback created without `Release`; the JS-heap grows while Go's `HeapAlloc` looks fine. (2) Transient-handle hoarding — caching one `js.Value` per object forever, pinning JS objects. Diagnose by comparing `runtime.ReadMemStats` (Go heap) against the browser's JS heap: rising JS heap with flat Go heap points to a handle/Func leak; rising Go heap points to a Go-side leak. Fix by auditing `FuncOf`/`Release` pairing and removing unbounded handle caches.

**Follow-up.** *How to prevent it structurally?* — Wrap `FuncOf` so creation pairs with a deferred/explicit release; never cache transient handles.

---

### Q16. Justify (or reject) Go wasm for a real-time canvas game to a PM.

**Model answer.** Viable if the heavy work is compute (physics, pathfinding, simulation) kept inside the box, with rendering and input handled on the JS side and data shared zero-copy via a re-derived view. Risks to name honestly: ~1.5 MB+ compressed download and startup compile cost (mitigate with lazy-load + streaming instantiation + caching), single-thread GC jank under per-frame allocation (mitigate by reusing buffers, keeping `js.ValueOf` out of the loop, possibly a Worker), and no multicore unless you split across Worker instances. Reject if the game is mostly DOM/UI manipulation — plain JS wins.

**Follow-up.** *The one-sentence framing?* — Go wasm is a compute accelerator and code-reuse vehicle, not a UI framework and not a size optimization.

---

## Quick-Fire Round

Rapid one-liners — the kind a staff interviewer fires to check depth.

- **Does gzip make the program run faster?** No — only the download is smaller; runtime speed is post-decompression.
- **Do goroutines run in parallel under wasm?** No — concurrency on one thread.
- **What does `select {}` do?** Parks `main` forever so the runtime yields to the event loop and callbacks can re-enter; keeps the program alive.
- **Is `Get` on a missing property an error?** No — returns `Undefined`.
- **What happens when a JS `Call` throws?** A Go panic carrying a `js.Error`.
- **Does `js.ValueOf(slice)` allocate?** Yes — builds a fresh JS array each call; keep it out of hot loops.
- **Cheapest fix for a 2 MB binary's download?** Serve it brotli/gzip-compressed.
- **What detaches a TypedArray view over wasm memory?** A `memory.grow` reallocating the `ArrayBuffer`.
- **Why `runtime.KeepAlive` when sharing a buffer pointer?** So the GC does not move/free the slice during the JS call.
- **`js` vs `wasip1` binary size?** Same class — the runtime floor dominates both.
- **Can you read int64 across the boundary safely?** Not via JS `number` (float64, precise to 2^53); pass as string or split.
- **Where does `wasm_exec.js` come from?** `$(go env GOROOT)/lib/wasm/` (Go 1.21+); must match the toolchain.
- **What pprof works on the `js` target?** Not CPU (no SIGPROF); use DevTools + native benchmarks.
- **Best single metric for boundary perf?** Crossings per hot-path iteration.
- **What is `go:wasmexport`?** Go 1.24+ directive exporting a Go function to the wasm host.
