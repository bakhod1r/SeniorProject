# Wasm Interop & Performance — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [Anatomy of a Boundary Crossing](#anatomy-of-a-boundary-crossing)
3. [The Cost Model: What Each `js.Value` Operation Pays](#the-cost-model-what-each-jsvalue-operation-pays)
4. [Caching Handles and the Reference Table](#caching-handles-and-the-reference-table)
5. [`js.Func` Lifetimes and `Release`](#jsfunc-lifetimes-and-release)
6. [Moving Bytes: `CopyBytesToGo` / `CopyBytesToJS`](#moving-bytes-copybytestogo-copybytestojs)
7. [Zero-Copy: Sharing Linear Memory with a TypedArray](#zero-copy-sharing-linear-memory-with-a-typedarray)
8. [The Memory-Growth / Detached-Buffer Gotcha](#the-memory-growth-detached-buffer-gotcha)
9. [Binary Size: Where the Megabytes Live](#binary-size-where-the-megabytes-live)
10. [Single-Threaded Reality and the UI Thread](#single-threaded-reality-and-the-ui-thread)
11. [Startup Cost: Compile vs Instantiate](#startup-cost-compile-vs-instantiate)
12. [Measuring: Counting Crossings and Timing Them](#measuring-counting-crossings-and-timing-them)
13. [Pitfalls You Will Meet](#pitfalls-you-will-meet)
14. [Self-Assessment](#self-assessment)
15. [Summary](#summary)

---

## Introduction

You already know from [junior.md](junior.md) that the Go↔JS boundary has a cost and that the binary is large because the runtime ships inside it. The middle-level question is *how much* each crossing costs, *what exactly* allocates, and *which mechanisms* let you move large data without paying per-byte. This file is the engineering layer: the cost model, the byte-moving APIs, the detached-buffer trap, and how to measure any of it.

After reading this you will:
- Know what `Get`/`Set`/`Call`/`ValueOf` cost and why they allocate
- Cache `js.Value` handles and reason about the reference table behind them
- Release `js.Func` callbacks correctly and recognise the leak when you do not
- Move large `[]byte` with `CopyBytesToGo`/`CopyBytesToJS` instead of element-by-element
- Share wasm linear memory with a JS `Uint8Array` for true zero-copy — and survive a memory grow
- Reason about binary size with numbers, not folklore
- Measure crossings and startup cost rather than guess

---

## Anatomy of a Boundary Crossing

A crossing is not a single instruction. When Go calls `el.Set("textContent", "hi")`, the following happens, conceptually:

1. **Argument boxing.** The Go string `"hi"` and the property name `"textContent"` are encoded into a form `wasm_exec.js` can read out of linear memory. Strings are written into the wasm memory buffer and described by `(ptr, len)` pairs.
2. **The syscall trap.** The wasm module calls an imported function (`syscall/js.valueSet`, ultimately). Control leaves wasm and enters the JS glue.
3. **Handle resolution.** The receiver `el` is a `js.Value` — internally an index into a JS-side table of live references. The glue looks up the real DOM element by that index.
4. **The actual JS operation.** `realEl.textContent = "hi"` runs in the JS engine.
5. **Result boxing and return.** Any result is encoded back, a new table slot may be allocated for it, and control returns into wasm.

Every one of those steps is real work. The dominant costs are the encode/decode of arguments and the indirection through the reference table. A single crossing is microseconds-scale; the trap is fixed overhead that does not shrink with smaller payloads. This is why **one call moving a megabyte is far cheaper than a million calls moving one byte each** — the per-call trap is paid a million times in the latter.

---

## The Cost Model: What Each `js.Value` Operation Pays

A practical ranking, cheapest to most expensive *per call*:

| Operation | What it pays | Allocates? |
|-----------|-------------|-----------|
| `v.IsUndefined()`, `v.Type()` | Reads cached metadata on the handle | No |
| `v.Get("prop")` | Trap + property read + result handle | Yes (result handle) |
| `v.Set("prop", x)` | Trap + box `x` + property write | Yes (boxes `x`) |
| `v.Index(i)` / `v.SetIndex(i, x)` | Trap + box + array access | Yes |
| `v.Call("m", args...)` | Trap + box every arg + result handle | Yes (every arg + result) |
| `v.Invoke(args...)` | Same as `Call` minus method lookup | Yes |
| `js.ValueOf(x)` | Box a Go value into a JS value | Yes |
| `js.ValueOf([]any{...})` or a map | Box *and recurse* into a fresh JS array/object | Yes, proportional to size |

Two facts to internalise:

- **`js.ValueOf` of a composite allocates the whole structure.** `js.ValueOf([]any{1, 2, 3})` builds a real three-element JS array and three boxed numbers. Done per frame, that is steady GC pressure on a single thread.
- **`Int()`, `Float()`, `String()`, `Bool()` read *out* of a handle** — they cross to fetch the underlying scalar. `args[0].Int()` is a crossing, not a local field access.

The lever is unchanged from junior level — fewer crossings — but now you can predict the cost of a given code path by counting boxed arguments and result handles, not just call sites.

---

## Caching Handles and the Reference Table

A `js.Value` you keep alive occupies a slot in the JS-side reference table for as long as Go holds it. Caching is the right default for *stable* references:

```go
var (
    document = js.Global().Get("document")
    console  = js.Global().Get("console")
    body     = document.Get("body")
)
```

These are fetched once at init and reused for the program's life. The table holds three extra slots — negligible.

The anti-pattern is caching *unbounded, short-lived* handles: stashing one `js.Value` per DOM node you ever touched into a Go map and never clearing it. Each cached handle pins a JS object so the JS garbage collector cannot reclaim it. You build a slow leak across the boundary: Go memory looks fine, but JS heap grows. Cache *stable* handles (the document, a canvas, a constructor); do not cache *transient* ones.

---

## `js.Func` Lifetimes and `Release`

`js.FuncOf(fn)` registers a Go function as a callable JS function and allocates a reference-table slot that the JS side holds. That slot lives until you call `Release()`. Forgetting to release is the single most common Go-wasm leak.

```go
// Long-lived callback: register once, never release (lives for the program).
js.Global().Set("onResize", js.FuncOf(handleResize))

// Short-lived callback: MUST be released, or it leaks every time this runs.
func fetchOnce(url string) {
    var cb js.Func
    cb = js.FuncOf(func(this js.Value, args []js.Value) any {
        defer cb.Release() // free the slot after it fires
        process(args[0])
        return nil
    })
    js.Global().Call("fetch", url).Call("then", cb)
}
```

The rule: a `js.Func` registered once at startup for the program's lifetime never needs release; a `js.Func` created per event/promise/interval **must** be released after it has served its purpose, or each creation leaks a table slot and the closure it captures. A promise-callback created in a render loop and never released is a textbook death-by-leak.

---

## Moving Bytes: `CopyBytesToGo` / `CopyBytesToJS`

When you need to move a `[]byte` across the boundary — a decoded image, an audio chunk, a network response — do **not** loop with `SetIndex`. That is one crossing per byte. Use the bulk helpers:

```go
// JS -> Go: copy a Uint8Array's contents into a Go []byte in one trap.
func readFromJS(src js.Value) []byte {
    n := src.Get("length").Int()
    buf := make([]byte, n)
    js.CopyBytesToGo(buf, src) // single bulk copy
    return buf
}

// Go -> JS: copy a Go []byte into a pre-sized Uint8Array in one trap.
func writeToJS(data []byte) js.Value {
    dst := js.Global().Get("Uint8Array").New(len(data))
    js.CopyBytesToJS(dst, data) // single bulk copy
    return dst
}
```

Both functions return the number of bytes copied (the min of the two lengths) and perform exactly one crossing regardless of size. A 4 MB image moves in one trap, not four million. The cost is the copy itself (memmove-speed), not boundary overhead. This is the correct tool for *one-shot* transfers.

---

## Zero-Copy: Sharing Linear Memory with a TypedArray

`CopyBytesToJS` still *copies*. For the hottest paths — a per-frame pixel buffer, a streaming audio ring — you can avoid even the copy by having JS read *directly* out of wasm linear memory.

The wasm module's entire memory is exposed to JS as `instance.exports.mem.buffer`, an `ArrayBuffer`. You can wrap a region of it in a `Uint8Array` and both sides operate on the *same* bytes:

```js
// JS side, after instantiation:
const wasmMemory = go.importObject.gojs._goReadMem // or instance.exports.mem
function viewOf(ptr, len) {
  return new Uint8Array(wasmMemory.buffer, ptr, len);
}
```

```go
// Go side: hand JS the address and length of a Go-owned buffer.
buf := make([]byte, width*height*4) // RGBA frame
ptr := uintptr(unsafe.Pointer(&buf[0]))
js.Global().Call("renderFrame", ptr, len(buf)) // JS reads buf directly
runtime.KeepAlive(buf)                          // keep buf from being collected mid-call
```

JS now reads the frame with no copy — it is looking at the same linear-memory bytes Go wrote. For a 60 fps canvas, this turns a per-frame multi-megabyte copy into zero. The `runtime.KeepAlive` is essential: without it the Go GC may move or reclaim `buf` while JS still references the address.

This is powerful and sharp-edged. The next section is the edge that cuts.

---

## The Memory-Growth / Detached-Buffer Gotcha

Wasm linear memory can **grow** at runtime (the runtime calls `memory.grow` when the Go heap needs more space). When it grows, the engine may allocate a *new, larger* backing store and **the old `ArrayBuffer` is detached** — meaning every `Uint8Array` view you created over the old buffer becomes empty and unusable. Reads through a stale view silently return zeros or throw.

```js
// BUG: cached once, becomes stale after any wasm allocation grows memory.
const view = new Uint8Array(wasmMemory.buffer, ptr, len); // cached at startup
function render() {
  draw(view);  // after a memory.grow, view.byteLength === 0 -> blank frame
}
```

The fix is to **re-create the view from the current buffer on every use** (views are cheap to construct; only the buffer is expensive):

```js
function render(ptr, len) {
  const view = new Uint8Array(wasmMemory.buffer, ptr, len); // fresh each frame
  draw(view);
}
```

Symptoms of this bug in the wild: rendering works for a while, then goes blank or garbled after the app allocates enough to trigger a grow; `TypedArray.byteLength` reads `0`; a thrown `TypeError: Cannot perform Construct on a detached ArrayBuffer`. The root cause is always a view cached across a memory grow. Treat the `buffer` reference as volatile and always reach for `wasmMemory.buffer` fresh.

---

## Binary Size: Where the Megabytes Live

Concrete numbers for `GOOS=js GOARCH=wasm` with modern Go (1.21+):

| Build | Approx. on-disk | Approx. gzip | Approx. brotli |
|-------|-----------------|-------------|----------------|
| hello-world, default | ~2.0 MB | ~1.5 MB | ~1.2 MB |
| hello-world, `-ldflags="-s -w"` | ~1.6 MB | ~1.2 MB | ~0.9 MB |
| realistic app (HTTP, JSON, some libs) | 3–8 MB | 1.5–3 MB | 1.2–2.5 MB |

What is inside that floor: the goroutine scheduler, the garbage collector, the allocator, the `reflect` package (pulled in by `fmt` and most serialization), and the runtime type metadata. Your code is rounding error.

Levers, in order of effect:
- **`-ldflags="-s -w"`** — drop symbol table (`-s`) and DWARF debug info (`-w`). A few hundred KB; same order of magnitude. Costs you readable stack traces.
- **Serve compressed** — gzip/brotli on the wire is the biggest *download* win and costs no code. See [05-wasm-in-production](../05-wasm-in-production/middle.md).
- **Avoid `reflect`-heavy paths** — `fmt`, `encoding/json` via reflection, and large dependency trees inflate the binary. Trimming them helps marginally.
- **TinyGo** — a different compiler that produces dramatically smaller wasm (often 10–100x), but with an incomplete stdlib and limited `reflect`/goroutine support. It is a real tradeoff, not a free win; see the sibling [03-tinygo-for-wasm-and-embedded](../03-tinygo-for-wasm-and-embedded/middle.md). Do not reach for it reflexively.

The wasip1 target (`GOOS=wasip1 GOARCH=wasm`) produces a binary in a similar size class to the `js` target — the runtime floor is the same; only the host interface differs.

---

## Single-Threaded Reality and the UI Thread

Go wasm runs on one JS thread. There is no `SharedArrayBuffer`-backed thread pool, no true parallelism, no use of multiple cores. Goroutines are cooperatively scheduled onto that single thread.

Two operational consequences:

- **A long Go computation blocks the page.** While a 400 ms Go loop runs, the browser cannot repaint, cannot process input, cannot run other JS. The UI is frozen. Chunk the work (yield via `time.Sleep(0)` or a channel hop, which lets the scheduler and the event loop breathe) or move it to a Web Worker on the JS side.
- **The GC runs on that same thread.** A garbage-collection cycle is not free and it competes with your compute and the browser's repaint for the one thread. Per-frame allocations (`js.ValueOf` in a render loop, fresh slices each frame) raise GC frequency and can introduce visible jank. Reuse buffers; allocate outside hot loops.

This is why the junior-level advice "keep compute in the box" has a sibling here: *keep allocations out of the hot loop*. The boundary cost and the GC cost are the two single-thread taxes.

---

## Startup Cost: Compile vs Instantiate

Before any Go runs, the browser must download the `.wasm`, **compile** it to machine code, and **instantiate** it (wire up imports, allocate memory). For a multi-megabyte module this is non-trivial — tens to hundreds of milliseconds.

Use streaming instantiation so compile overlaps with download:

```js
// GOOD: compiles while downloading.
WebAssembly.instantiateStreaming(fetch("main.wasm"), go.importObject)
  .then((result) => go.run(result.instance));

// SLOWER: download fully, then compile, then instantiate (two passes).
fetch("main.wasm")
  .then((r) => r.arrayBuffer())
  .then((bytes) => WebAssembly.instantiate(bytes, go.importObject))
  .then((result) => go.run(result.instance));
```

`instantiateStreaming` requires the server to send `Content-Type: application/wasm`; otherwise it falls back with a console warning. There is also JIT warmup: the engine may tier up hot wasm code after it has run a while, so the first iterations of a kernel are slower than the steady state. Benchmark the steady state, not the first call. Serving and caching details are in [05-wasm-in-production](../05-wasm-in-production/middle.md).

---

## Measuring: Counting Crossings and Timing Them

You cannot optimise what you do not measure, and pprof is limited under wasm. Practical tools:

**1. Count crossings manually.** Wrap your boundary layer with a counter during development:

```go
var crossings int64
func tracedSet(v js.Value, p string, x any) {
    atomic.AddInt64(&crossings, 1)
    v.Set(p, x)
}
// Log `crossings` per frame; a stable, low number is the goal.
```

**2. Time inside Go.** `time.Now()` works under wasm (it reads JS `Date.now()`/`performance.now()` via the runtime). Wrap a code path and log the delta. Beware: timer resolution is reduced in browsers for security (Spectre mitigations), so micro-timings are coarse — measure batches, not single calls.

**3. Browser DevTools Performance panel.** Record a profile while the app runs. Wasm frames appear in the flame chart (named after symbols unless you stripped them with `-w`). You can see time spent in wasm vs in `wasm_exec.js` glue vs in DOM work — the split tells you whether you are compute-bound or boundary-bound.

**4. The Network tab** for download size and `Content-Encoding` (confirm gzip/brotli is actually applied).

The diagnostic question is always: *is the time in wasm (compute — optimise the algorithm) or in the glue/DOM (boundary — reduce crossings)?* DevTools answers it directly.

---

## Pitfalls You Will Meet

### Pitfall 1 — Caching a TypedArray view across a memory grow
The headline trap. The view detaches; reads return zero or throw. Re-create the view from `memory.buffer` on every use.

### Pitfall 2 — `js.Func` created per event, never released
A promise/timer callback made in a loop leaks a table slot and its closure each time. Release short-lived `js.Func`s.

### Pitfall 3 — Per-byte copying with `SetIndex`
A loop copying a buffer one element at a time pays N crossings. Use `CopyBytesToJS`/`CopyBytesToGo`.

### Pitfall 4 — `js.ValueOf(struct/slice/map)` inside a render loop
Allocates a fresh JS object every frame, feeding the single-thread GC. Build once outside, or pass bytes.

### Pitfall 5 — Forgetting `runtime.KeepAlive` on a shared buffer
If you hand JS a pointer into a Go slice, the GC may move/reclaim it mid-call. Keep it alive for the call's duration.

### Pitfall 6 — Blocking the UI thread with a long loop
A multi-hundred-millisecond Go computation freezes the page. Chunk it or offload it.

### Pitfall 7 — Non-streaming instantiation
Downloading fully before compiling wastes the overlap. Use `instantiateStreaming` with the correct MIME type.

### Pitfall 8 — Stripping `-w` then trying to read a flame chart
Without DWARF, wasm frames in DevTools are unnamed. Strip for production, keep symbols while profiling.

---

## Self-Assessment

You can move on to [senior.md](senior.md) when you can:

- [ ] Describe the five conceptual steps of a single boundary crossing
- [ ] Predict the allocation cost of a `Call` by counting boxed args and result handles
- [ ] Distinguish handles worth caching (stable) from those that leak (transient)
- [ ] Release a short-lived `js.Func` correctly and explain the leak when you do not
- [ ] Move a 4 MB buffer in one crossing with `CopyBytesToJS`
- [ ] Set up zero-copy sharing of linear memory and explain why `runtime.KeepAlive` is required
- [ ] Explain the detached-`ArrayBuffer`-after-grow bug and its fix
- [ ] Quote rough binary-size numbers for js and wasip1 targets
- [ ] Explain why a long Go loop freezes the page and how the GC contributes
- [ ] Use `instantiateStreaming` and read a DevTools wasm flame chart to classify a bottleneck

---

## Summary

A boundary crossing is a multi-step operation — box arguments into linear memory, trap out of wasm, resolve the receiver through a JS reference table, run the JS op, box the result back — and its fixed per-call overhead is why one big transfer beats a million small ones. Each `js.Value` operation has a predictable cost: scalar reads cross, `ValueOf` of a composite allocates the whole structure, and `js.Func` slots leak unless short-lived ones are `Release`d. Move large `[]byte` with `CopyBytesToGo`/`CopyBytesToJS` (one crossing, a real copy) or, for the hottest paths, share linear memory zero-copy via a `Uint8Array` over `memory.buffer` — but re-create the view every use, because a memory grow detaches the old `ArrayBuffer` and silently breaks cached views. The binary is multiple megabytes because the scheduler, GC, allocator, and reflect ship inside it; `-s -w` and wire compression trim the download, TinyGo trades it for an incomplete stdlib. Go wasm is single-threaded, so long loops freeze the UI and the GC competes for the one thread; measure with crossing counters, coarse `time.Now()` deltas, and the DevTools Performance panel to decide whether you are compute-bound or boundary-bound.
