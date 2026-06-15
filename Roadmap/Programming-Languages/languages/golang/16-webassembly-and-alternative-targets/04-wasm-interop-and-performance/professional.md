# Wasm Interop & Performance — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [The `syscall/js` Reference Table: Internals](#the-syscalljs-reference-table-internals)
3. [Value Encoding on the Wire (NaN-Boxing and the ABI)](#value-encoding-on-the-wire-nan-boxing-and-the-abi)
4. [Anatomy of `wasm_exec.js`](#anatomy-of-wasm_execjs)
5. [The Event Loop, `select{}`, and How Go Yields to JS](#the-event-loop-select-and-how-go-yields-to-js)
6. [`CopyBytes*` and the Linear-Memory `DataView`](#copybytes-and-the-linear-memory-dataview)
7. [Memory Growth, `mem.buffer`, and View Invalidation](#memory-growth-membuffer-and-view-invalidation)
8. [`go:wasmimport` and the wasip1 Host ABI](#gowasmimport-and-the-wasip1-host-abi)
9. [Binary Composition: Reading the `.wasm` Section by Section](#binary-composition-reading-the-wasm-section-by-section)
10. [The GC Under Wasm](#the-gc-under-wasm)
11. [Profiling Internals and Their Limits](#profiling-internals-and-their-limits)
12. [Operational Playbook](#operational-playbook)
13. [Edge Cases the Runtime Reveals](#edge-cases-the-runtime-reveals)
14. [Professional-Level Checklist](#professional-level-checklist)
15. [Summary](#summary)

---

## Introduction

The professional level treats the boundary as a concrete mechanism: a reference table, an encoding scheme, a glue script implementing a small syscall surface, and a runtime that maps Go's scheduler onto a single JS event loop. Understanding these internals turns "the boundary is slow" into "this specific marshalling step allocates a table slot per call." It also explains the detached-buffer bug, the `select{}` idiom, and the wasip1 host ABI from first principles.

This file is for engineers who own Go-wasm infrastructure, write interop libraries, or debug failures that the docs do not name. After reading you will:
- Know what a `js.Value` is internally and how the reference table is managed
- Understand the value-encoding ABI between wasm and `wasm_exec.js`
- Read `wasm_exec.js` and know which syscalls it implements
- Explain how Go's scheduler cooperates with the JS event loop and why `select{}` works
- Reason about `go:wasmimport` on wasip1 at the ABI level
- Operate, profile, and debug Go wasm from the runtime's behaviour, not folklore

---

## The `syscall/js` Reference Table: Internals

A `js.Value` is not a pointer to a JS object — wasm cannot hold a JS reference. It is a tagged encoding that, for non-primitive values, carries an **index into a JS-side array of live references** maintained by `wasm_exec.js`.

The glue holds three structures:
- A `values` array — the live JS objects, indexed by `id`.
- A `goRefCounts` array — how many Go-side handles reference each `id`.
- An `ids` map and an `idPool` — to deduplicate and recycle slots.

When Go obtains a JS object (e.g. `Get("document")` returns an object), the glue calls `storeValue`: it finds or allocates an `id`, increments its ref count, and returns the encoded handle. When a Go `js.Value` referencing an object is garbage-collected, the runtime calls back into the glue to decrement the ref count via a finalizer; at zero, the slot is released back to the pool.

Consequences that matter:
- **Each distinct object handle occupies a slot.** Holding many handles (e.g. one per DOM node in a long-lived map) keeps that many JS objects alive — a leak measured on the JS heap, invisible in Go memory stats.
- **`js.Func` is a stored value too**, and its finalizer does *not* fire while JS still holds the function reference — which is why you must `Release()` explicitly. The ref count from the JS side never drops on its own.
- **Primitive values (numbers, booleans, the small set of singletons) are encoded inline**, not stored in the table — so passing an `int` does not allocate a slot, but passing an object does.

---

## Value Encoding on the Wire (NaN-Boxing and the ABI)

A `js.Value` is a 64-bit value encoded with a **NaN-boxing** scheme. IEEE-754 doubles have a large space of NaN bit patterns; the glue uses that space to tag non-float values.

- A finite `float64` is itself — passed through directly.
- A NaN-tagged 64-bit word encodes `(typeFlag, id)` for everything else: `undefined`, `null`, `true`, `false`, and object/string/symbol/function references (the latter carrying a table `id`).

The encoding is symmetric across the boundary: Go writes these 64-bit words into linear memory (or into the call's argument area), and `wasm_exec.js` reads them back with `loadValue`/`storeValue`. Strings and byte slices are *not* encoded inline — they are written into linear memory and described by a `(ptr, len)` pair, then materialised on the JS side by reading those bytes out of the memory buffer.

This is why a `Call` with object arguments allocates: each object argument must be `storeValue`'d into the table to get an `id` to encode. It is also why scalar-only calls are cheaper: no table traffic, just NaN-boxed words.

---

## Anatomy of `wasm_exec.js`

`wasm_exec.js` is the runtime's host half. It is version-locked to the toolchain (always copy it from `$(go env GOROOT)/lib/wasm/wasm_exec.js`; pre-1.21 it lived under `misc/wasm/`). Its responsibilities:

1. **The `Go` class.** Builds `importObject` — the set of host functions wasm imports under the `gojs` namespace — and exposes `run(instance)` to start the program.
2. **The syscall surface.** Implements the functions Go's `syscall/js` and runtime call out to: `valueGet`, `valueSet`, `valueIndex`, `valueCall`, `valueInvoke`, `valueNew`, `valuePrepareString`, `valueLoadString`, `copyBytesToGo`, `copyBytesToJS`, and the table managers `storeValue`/`loadValue`.
3. **Time and scheduling glue.** Implements `runtime.wasmExit`, `runtime.nanotime1` (via `performance.now()`), `runtime.walltime`, and `scheduleTimeoutEvent`/`clearTimeoutEvent` — how Go timers map onto `setTimeout`.
4. **The `mem` accessor.** Holds the `DataView` over the instance's memory and **re-creates it whenever memory grows** — the glue's own `mem` getter checks whether the buffer changed and rebuilds the view. (Your application-level views over the same buffer are *not* automatically rebuilt; that is the detached-buffer trap.)
5. **Entry/exit.** `run` calls the wasm `run` export, processes the pending callback queue, and resolves when Go's `main` returns or the program exits.

Reading this file once is the fastest way to demystify the boundary. Every cost in this topic maps to a function in it.

---

## The Event Loop, `select{}`, and How Go Yields to JS

Go's runtime under wasm does not own the thread — the JS event loop does. The runtime runs goroutines until they all block, then **returns control to the event loop** and waits to be resumed by an event (a timer firing, a callback invoked from JS).

The mechanism:
- When all goroutines are blocked (e.g. on a channel, a timer, or a `js.Func` waiting to be called), the runtime calls back into the glue and effectively suspends, yielding the thread to JS.
- A JS event — a DOM event handler that invokes a `js.Func`, or a `setTimeout` Go scheduled — re-enters wasm, resumes the runtime, runs the now-runnable goroutines, and the cycle repeats.

`select{}` blocks `main`'s goroutine forever with no case ready. This does *not* spin — it parks, the runtime sees all goroutines blocked, and yields to the event loop. The program stays alive precisely so registered `js.Func` callbacks can re-enter it later. If `main` returned instead, the runtime would exit, the glue would tear down the instance, and callbacks would fail. `select{}` is the idiomatic "I have registered callbacks; keep the runtime resumable."

A corollary: a goroutine that runs a long compute loop *never blocks*, so the runtime never yields, so the event loop never runs, so the browser never repaints. That is the UI-freeze mechanism, exactly. Yielding (a channel hop, `time.Sleep`) creates a block point where the runtime can return to the event loop.

---

## `CopyBytes*` and the Linear-Memory `DataView`

`js.CopyBytesToGo(dst []byte, src js.Value)` and `js.CopyBytesToJS(dst js.Value, src []byte)` are implemented as single glue calls (`copyBytesToGo`/`copyBytesToJS`) that perform a `TypedArray.set`/`subarray` against the wasm memory buffer — a native memmove, not a loop. The Go side passes `(ptr, len)` of its slice; the glue constructs a `Uint8Array` over `this.mem.buffer` at that offset and copies in one operation. Return value is the byte count actually copied (`min(len(dst), src.length)`).

The cost is therefore: one trap + one native memory copy. For a 16 MB buffer that is ~one memmove, dwarfing the trap. This is why bulk copy beats per-element `SetIndex` by orders of magnitude — and why, for *repeated* transfers of the same buffer, even this copy is worth eliminating with a shared view (next section).

---

## Memory Growth, `mem.buffer`, and View Invalidation

Wasm linear memory grows in 64 KiB pages via the `memory.grow` instruction. Go's allocator triggers it when the heap needs more space. The WebAssembly spec permits the engine to **reallocate the backing `ArrayBuffer`** on grow, which **detaches** the old one. Detachment sets the old buffer's `byteLength` to 0 and invalidates every `TypedArray`/`DataView` constructed over it.

`wasm_exec.js` protects *itself* — its `mem` getter rebuilds the `DataView` when it detects the buffer changed:

```js
get mem() {
  // rebuild if the cached buffer has been detached/replaced
  if (this._inst.exports.mem.buffer !== this._memBuffer) {
    this._memBuffer = this._inst.exports.mem.buffer;
    this._memView = new DataView(this._memBuffer);
  }
  return this._memView;
}
```

Your application code gets no such protection. Any `Uint8Array` you cached over the buffer is now dead. The fix is invariant: **never cache a view; derive it from `exports.mem.buffer` (or the glue's current buffer) at the point of use.** A view is cheap to construct (a few fields); the buffer is the expensive shared resource. The bug is insidious because it is *load-dependent*: it appears only once the heap grows past its initial size, so small-input tests pass and large-input production fails.

---

## `go:wasmimport` and the wasip1 Host ABI

On `GOOS=wasip1 GOARCH=wasm`, there is no JavaScript and no `syscall/js`. Go calls host functions through the `//go:wasmimport` directive, which binds a Go function declaration to an imported wasm function from a named module:

```go
//go:wasmimport wasi_snapshot_preview1 clock_time_get
//go:noescape
func clockTimeGet(id uint32, precision uint64, resultPtr unsafe.Pointer) uint32
```

ABI rules that matter:
- **Only scalar wasm types cross directly:** `int32`/`uint32`, `int64`/`uint64`, `float32`, `float64`. These map to wasm `i32`/`i64`/`f32`/`f64`.
- **Pointers and larger data go through linear memory.** You pass a `unsafe.Pointer` (which becomes an `i32` offset into linear memory) and the host reads/writes the bytes at that offset. Strings and structs are passed as `(ptr, len)` into the shared linear memory, exactly as on the `js` target but without the NaN-boxing/table machinery.
- **`//go:noescape`** tells the compiler the pointer arguments do not escape, avoiding heap allocation for them — important for hot host calls.
- **The host owns the contract.** The function signature must match the host's import exactly; mismatches surface as link-time or instantiation failures, not Go type errors.

The cost profile differs from `js`: no reference table, no value boxing — a wasip1 host call is closer to a C FFI call (a direct wasm call with scalar args and a memory pointer). It is generally cheaper per call than a `syscall/js` crossing. The details, including the full preview-1 surface and the move toward the component model, are in the sibling [02-wasi-and-wasip1](../02-wasi-and-wasip1/professional.md). Here the point is only the contrast: two targets, two boundary mechanisms.

---

## Binary Composition: Reading the `.wasm` Section by Section

A Go `.wasm` is a standard WebAssembly module. Inspect it with `wasm-objdump` (from wabt) or `go tool`:

```bash
wasm-objdump -h main.wasm   # section headers and sizes
```

Where the bytes go, in order of typical size:
- **Code section** — the compiled functions. This is the bulk: runtime, GC, scheduler, allocator, `reflect`, and the stdlib your imports drag in. Your application code is a small fraction.
- **Data section** — static data, including the `runtime` type information (`rtype`) tables that `reflect` and interface dispatch need. `fmt` and reflection-based `encoding/json` pull a lot in here.
- **Custom "name" section** — function/local names for debugging. `-ldflags="-w"` drops the DWARF; `-s` drops the symbol table. Removing these makes DevTools flame charts unnamed but shrinks the file.
- **Import/export/table/memory sections** — small; declare the `gojs` host functions and the memory.

The lesson made concrete: stripping touches the name/debug sections only — a few hundred KB. The code and data sections (the runtime) are the megabytes, and no link flag removes them. Only a different compiler (TinyGo) or dead-code elimination of large dependencies moves the needle. Compression on the wire then attacks the redundancy in the code/data sections, which is why brotli on a `.wasm` is so effective.

---

## The GC Under Wasm

Go's garbage collector runs inside the module, on the one thread, with these characteristics:
- **It is the standard concurrent mark-sweep collector**, but "concurrent" loses its meaning with one thread — mark and sweep work is interleaved with mutator work on the same thread, so GC time is directly subtracted from your frame budget.
- **No background sweeping on another core**, because there is no other core. Every GC cost is foreground from the UI's perspective.
- **Allocation rate drives GC frequency.** Per-frame `js.ValueOf`, fresh slices, and boxed interface values raise the rate and the collection frequency, producing jank.
- **`GOGC` still applies.** You can tune it (`debug.SetGCPercent`) to trade memory for fewer collections; raising it reduces GC frequency at the cost of a larger heap (which also means more frequent `memory.grow` — and more chances to detach views).
- **`runtime.GC()` for determinism.** In a Worker doing batch compute, forcing GC at safe points (between work units, not mid-frame) can avoid an ill-timed pause.

The professional reflex: reduce allocation in hot paths first; only then tune `GOGC`. Reuse buffers (`sync.Pool` works under wasm), preallocate, and keep `js.ValueOf` of composites out of loops.

---

## Profiling Internals and Their Limits

What works and what does not under `GOOS=js`:
- **No signal-driven CPU profiling.** `runtime/pprof` CPU profiles rely on SIGPROF, which the wasm/js environment does not deliver. CPU profiling is effectively unavailable on the `js` target.
- **Heap and allocation profiles are partial** and awkward to extract (no filesystem; you must marshal the profile out through JS).
- **`runtime.ReadMemStats`** works and is the most reliable in-band signal — watch `HeapAlloc`, `NumGC`, `PauseTotalNs` over time.
- **DevTools Performance panel** is the real CPU profiler: it samples the JS thread, attributes time to wasm frames (named if not stripped), and shows the GC and glue cost. This is the authoritative tool for the `js` target.
- **Benchmark natively.** The decisive technique: keep the compute in a pure-Go package and run `go test -bench` on a normal build where pprof, traces, and flame graphs all work. Optimise there; the wasm build inherits the win.

For wasip1, the host runtime (Wasmtime et al.) may offer better profiling hooks, and CPU profiling is more feasible — another reason the two targets differ operationally.

---

## Operational Playbook

- **Ship `wasm_exec.js` from the same toolchain that built the `.wasm`.** Pin both in the build; cache-bust them together. Mismatch → obscure instantiation failure.
- **Serve `.wasm` with `Content-Type: application/wasm`** so `instantiateStreaming` works; with `Content-Encoding: br`/`gzip` for transfer size; content-hashed with long max-age. See [05-wasm-in-production](../05-wasm-in-production/professional.md).
- **Force a memory grow in tests.** Run with large enough inputs to exceed the initial heap so detached-view bugs surface in CI, not production.
- **Audit `FuncOf`/`Release` pairs.** A grep-able convention or a wrapper that pairs creation with a deferred release prevents the slow JS-heap leak.
- **Monitor `MemStats` in long-lived sessions.** Rising `HeapAlloc` with stable workload signals a Go-side leak; rising JS heap with stable Go heap signals a table-slot/handle leak.
- **Establish a size budget gate in CI.** Fail the build if compressed `.wasm` exceeds the product NFR.

---

## Edge Cases the Runtime Reveals

- **`js.ValueOf(nil)` is `null`, not `undefined`.** Distinct JS values; APIs that check `=== undefined` will not match a `nil`-derived value.
- **`js.Value` finalizers are best-effort.** A handle's slot is freed when Go GC collects the handle *and* runs the finalizer — non-deterministic timing. Do not rely on prompt slot release for objects; for functions you must `Release` explicitly anyway.
- **Re-entrancy.** A `js.Func` invoked synchronously from JS runs on the same thread mid-event; it must not block on something only a *later* event can satisfy, or it deadlocks the loop. Keep callbacks non-blocking or spawn a goroutine that yields.
- **`select{}` after `main` work but before callbacks register** can park before the callback is wired — order registration before the block.
- **64-bit values across the boundary** require care: JS numbers are float64 and lose precision above 2^53. Pass large integers as strings or split into two 32-bit words; do not rely on `Int()` for full int64 range.
- **`unsafe.Pointer` into a slice handed to JS** is invalid the instant Go might move/free the slice — `runtime.KeepAlive` for the call's span, never beyond it.

---

## Professional-Level Checklist

You have mastered this level when you can:

- [ ] Explain what a `js.Value` is internally and how the reference table allocates/frees slots
- [ ] Describe the NaN-boxing value encoding and why object args allocate but scalars do not
- [ ] Name the syscall functions `wasm_exec.js` implements and what each costs
- [ ] Explain how the Go scheduler yields to the JS event loop and why `select{}` parks rather than spins
- [ ] Trace why a non-yielding loop freezes the UI in terms of the runtime/event-loop handshake
- [ ] Show why `CopyBytes*` is one trap + one memmove, and when a shared view beats it
- [ ] Quote the spec reason memory grow detaches views and write the always-rederive fix
- [ ] State the `go:wasmimport` ABI rules (scalars direct, pointers via linear memory) and contrast wasip1 cost with `js`
- [ ] Read a `.wasm`'s sections and explain why stripping only touches name/debug, not the runtime bulk
- [ ] Lay out a profiling approach given no SIGPROF on the `js` target

---

## Summary

At the professional level the boundary stops being a metaphor and becomes a mechanism. A `js.Value` is a NaN-boxed 64-bit word that, for non-primitives, indexes a reference table managed by `wasm_exec.js`; object arguments allocate table slots, scalars do not, and `js.Func` slots leak unless explicitly `Release`d because the JS-side ref count never drops on its own. The glue implements the syscall surface (`valueGet/Set/Call`, `copyBytes*`, time and scheduling), rebuilds its own memory view on grow, and drives the program by resuming Go's scheduler from JS events — which is why `select{}` parks the runtime (yielding the thread to the event loop) and why a non-yielding compute loop freezes the page. `CopyBytes*` is one trap plus a native memmove; for repeated transfers a shared `Uint8Array` over `exports.mem.buffer` avoids even that, at the cost of the detached-buffer trap that the spec permits on every `memory.grow` — fixed only by re-deriving the view at each use. On wasip1 the boundary is a C-FFI-like `go:wasmimport` call (scalars direct, pointers through linear memory, no table, no boxing), generally cheaper than `syscall/js`. The binary's megabytes live in the code and data sections (runtime, GC, scheduler, reflect), untouched by `-s -w` (which only drops name/debug) and reducible only by a different compiler or wire compression. The GC runs foreground on the one thread, so allocation rate is jank; reduce it before tuning `GOGC`. And profile by classifying in DevTools and benchmarking the pure-Go kernel natively, because the `js` target gives you no SIGPROF.
