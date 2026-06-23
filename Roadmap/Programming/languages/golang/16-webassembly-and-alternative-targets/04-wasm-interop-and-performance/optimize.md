# Wasm Interop & Performance — Optimization

> Honest framing first: most Go-wasm performance problems are not "the wasm is slow" — they are *boundary chatter*, *per-frame allocation on a single thread*, or *binary size delaying startup*. Compute inside the box runs near native; the cost is at the edges. Each optimization below states the problem, a "before" and "after", and the realistic gain. The two closing sections cover measurement and the cases where the right optimization is to use a different tool. Numbers assume modern Go (1.21+), `GOOS=js GOARCH=wasm`.

---

## Optimization 1 — Cache stable handles out of the hot path

**Problem.** `js.Global().Get("document")` (and other stable lookups) repeated inside a loop pays one crossing per iteration.

**Before:** `js.Global().Get("document").Call("getElementById", id)` inside a per-item loop.
**After:** hoist `var document = js.Global().Get("document")` to package level; the loop reuses it.

**Expected gain.** Removes N crossings for an N-iteration loop. Small per call, real in aggregate; the first thing to fix in any chatty path.

---

## Optimization 2 — Batch, do not iterate, across the boundary

**Problem.** A loop that calls into JS once per element multiplies the fixed per-call trap by N.

**Before:** `for _, n := range nodes { parent.Call("appendChild", n) }` — N crossings.
**After:** build the markup or data once in Go, cross once: `parent.Set("innerHTML", html)` or one `CopyBytesToJS` of a packed buffer.

**Expected gain.** N crossings → 1. For a 10,000-item list this is the difference between a janky second and an imperceptible update. The single highest-leverage interop optimization.

---

## Optimization 3 — Bulk-copy bytes instead of element-by-element

**Problem.** Moving a `[]byte` with a `SetIndex`/`Index` loop is one crossing per byte.

**Before:** `for i, b := range data { dst.SetIndex(i, b) }` — len(data) crossings.
**After:** `js.CopyBytesToJS(dst, data)` — one crossing plus a native memmove.

**Expected gain.** For a 1 MB buffer, ~1,000,000 crossings → 1. Orders of magnitude. Use `CopyBytesToGo` for the reverse direction.

---

## Optimization 4 — Zero-copy share for repeated transfers

**Problem.** Even `CopyBytesToJS` copies; for a per-frame buffer (canvas pixels, audio) that copy repeats 60×/sec.

**Before:** `CopyBytesToJS(arr, frame)` every frame.
**After:** hand JS a `(ptr, len)` into the Go buffer; JS constructs a `Uint8Array` over `exports.mem.buffer` and reads in place. No copy. (Re-derive the view each frame — see Optimization 11.)

**Expected gain.** Eliminates a multi-megabyte copy per frame. For a 4K canvas this is the difference between dropping frames and a smooth 60 fps. Pair with `runtime.KeepAlive` on the buffer.

---

## Optimization 5 — Move compute into the box

**Problem.** A computation interleaved with boundary calls is dominated by crossings, not arithmetic.

**Before:** a transform loop that reads each input and writes each output via `Get`/`Set`.
**After:** copy inputs in once (`CopyBytesToGo`), run a pure-Go loop with zero crossings, copy results out once.

**Expected gain.** Turns a boundary-bound path into a compute-bound one, where Go wasm runs ~1.5–3x native time — far faster than the chatty version and often faster than equivalent JS.

---

## Optimization 6 — Reuse buffers to cut GC pressure

**Problem.** Per-frame allocation raises GC frequency; the GC runs foreground on the single thread, causing jank.

**Before:** `buf := make([]byte, n)` every frame.
**After:** a package-level `buf` grown once (`if cap(buf) < n { buf = make([]byte, n) }; buf = buf[:n]`), or a `sync.Pool`.

**Expected gain.** Fewer GC cycles (`NumGC` drops), fewer foreground pauses, smoother frames. Often the fix for "periodic hitches."

---

## Optimization 7 — Keep `js.ValueOf` of composites out of loops

**Problem.** `js.ValueOf(map/slice/struct)` allocates a JS object and boxes every field, per call.

**Before:** `postMessage(js.ValueOf(map[string]any{...}))` per item.
**After:** serialize the batch to a packed `[]byte` once, transfer once with `CopyBytesToJS`.

**Expected gain.** Removes per-item JS-object allocation and per-item crossings simultaneously — both throughput and GC win.

---

## Optimization 8 — Strip the binary for production

**Problem.** Default builds ship the symbol table and DWARF, inflating the file users download.

**Before:** `go build -o main.wasm` (~2 MB hello-world).
**After:** `go build -ldflags="-s -w" -o main.wasm` (~1.6 MB).

**Expected gain.** A few hundred KB — same order of magnitude, since the runtime floor stays. Keep an unstripped build for profiling (named frames). Real but modest; combine with compression.

---

## Optimization 9 — Serve compressed (the biggest download win)

**Problem.** Shipping the `.wasm` uncompressed wastes bandwidth and time-to-interactive.

**Before:** server sends `main.wasm` raw (~1.6 MB on the wire).
**After:** precompress and serve with `Content-Encoding: br` (or `gzip`); ~0.9 MB brotli.

**Expected gain.** Roughly 40–55% smaller download for zero code change. The cheapest size win available. Details and caching in [05-wasm-in-production](../05-wasm-in-production/optimize.md).

---

## Optimization 10 — Stream instantiation to overlap download and compile

**Problem.** Fetching the whole module before compiling serialises two slow phases.

**Before:** `fetch → arrayBuffer → instantiate`.
**After:** `WebAssembly.instantiateStreaming(fetch("main.wasm"), importObject)` (requires `Content-Type: application/wasm`).

**Expected gain.** Compile overlaps download; time-to-first-Go-execution drops by the compile time for large modules — tens to hundreds of ms.

---

## Optimization 11 — Re-derive views instead of caching them

**Problem.** A cached `Uint8Array` over wasm memory detaches on a `memory.grow`, breaking reads (a correctness bug *and* a hidden re-allocation cost when worked around badly).

**Before:** cache the view once at startup.
**After:** construct `new Uint8Array(exports.mem.buffer, ptr, len)` at each use. Views are cheap (a few fields); only the buffer is expensive.

**Expected gain.** Correctness (no blank frames after growth) at negligible cost — view construction is far cheaper than the data copy it replaces in the zero-copy design.

---

## Optimization 12 — Offload heavy compute to a Web Worker

**Problem.** A long Go computation on the main thread freezes the UI and competes with the browser's repaint.

**Before:** the kernel runs in the main-thread wasm instance; the page freezes during it.
**After:** run the wasm instance inside a Web Worker; the main thread stays responsive and communicates via `postMessage`. For data parallelism, run N Worker instances over N chunks.

**Expected gain.** UI stays smooth regardless of compute length; with N Workers, near-linear speedup up to core count — the only true parallelism path for Go wasm.

---

## Optimization 13 — Chunk-and-yield when a Worker is overkill

**Problem.** A medium-length loop (a few hundred ms) freezes the page but does not justify Worker plumbing.

**Before:** a single uninterrupted loop in a click handler.
**After:** yield periodically (`if i%chunk == 0 { time.Sleep(0) }` or a channel hop) so the event loop can repaint and process input between chunks.

**Expected gain.** The page stays responsive; total compute time is slightly higher (yield overhead) but perceived performance improves dramatically.

---

## Optimization 14 — Lazy-load the wasm off the critical path

**Problem.** Loading a multi-megabyte module at page load delays first interactive even when the feature is not immediately needed.

**Before:** `instantiateStreaming` at page load for an editor opened only on click.
**After:** fetch and instantiate the module the first time the feature is invoked; show a brief loading state.

**Expected gain.** Removes the entire wasm download + compile cost from initial page load — often the single largest perceived-performance improvement for a feature that is not on the landing path. Cache the module so subsequent invocations are instant.

---

## Measurement

Optimize against numbers, not intuition.

- **Classify first.** Record a DevTools Performance profile and decide: time in wasm frames (compute — fix the algorithm) or in `wasm_exec.js`/DOM (boundary — fix crossings/batching)? This single split chooses which optimizations above apply.
- **Count crossings.** A dev-mode counter on the boundary layer turns "feels slow" into a number to drive down; target a small constant per frame.
- **Benchmark the kernel natively.** Because compute lives in a pure-Go package (the isolated-interop design from [senior.md](senior.md)), run `go test -bench` on a normal build where pprof and flame graphs work fully. Optimize there; the wasm build inherits it.
- **Watch `runtime.ReadMemStats`.** `NumGC`, `PauseTotalNs`, and `HeapAlloc` over time reveal allocation-driven jank and leaks.
- **Measure steady-state.** JIT warmup makes the first iterations slow; benchmark after warmup.
- **Measure compressed size in CI.** Gate on the brotli size, not the on-disk size — that is what users pay.

The order of attack: classify → if boundary-bound, batch and cache handles (Opt 1–3); if it is a repeated large transfer, go zero-copy (Opt 4); if compute-bound, move work into the box and benchmark natively (Opt 5); if jank, cut allocation (Opt 6–7); for startup, strip + compress + stream + lazy-load (Opt 8–10, 14); for freezes, Worker or chunk (Opt 12–13).

---

## When the Right Optimization Is a Different Tool

- **The feature is mostly DOM glue.** No amount of batching beats plain JS for per-node UI churn. Use Go for compute, JS for the DOM — or drop wasm for that feature.
- **Binary size is a hard public-facing constraint.** Standard Go floors at ~1 MB compressed. If that is unacceptable and the code is a small self-contained kernel, TinyGo (10–100x smaller) is the optimization — at the cost of an incomplete stdlib and limited `reflect`/goroutines. It is a trade-off, not a default; see [03-tinygo-for-wasm-and-embedded](../03-tinygo-for-wasm-and-embedded/optimize.md).
- **You need true multicore on the server.** On `wasip1`, the host runtime model differs and host calls (`go:wasmimport`) are cheaper than `syscall/js`; the boundary optimizations here still apply but the threading story is the host's, not Go's. See [02-wasi-and-wasip1](../02-wasi-and-wasip1/optimize.md).
- **The bottleneck is the algorithm.** If the native benchmark is already slow, no interop trick helps — fix the algorithm first, in plain Go, where the full tooling works.

The meta-point: Go wasm's performance ceiling for compute is near native, and its floor for boundary chatter is below plain JS. Optimization is mostly the discipline of keeping work inside the box and crossings at the edges — and recognising the cases where another tool fits the job better.
