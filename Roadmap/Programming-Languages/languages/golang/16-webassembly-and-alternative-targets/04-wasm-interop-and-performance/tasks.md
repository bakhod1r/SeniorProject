# Wasm Interop & Performance — Hands-on Tasks

> Practical exercises from easy to hard. Each task says what to build, what success looks like, and a hint or expected outcome. Solutions are sketched at the end. All tasks assume Go 1.21+ and the `GOOS=js GOARCH=wasm` target unless stated. Serve over HTTP (wasm will not load from `file://`); a one-liner like `python3 -m http.server` plus a copy of `$(go env GOROOT)/lib/wasm/wasm_exec.js` is enough.

---

## Easy

### Task 1 — Measure the binary-size floor

Build a hello-world that logs to the console via `syscall/js`. Record the size three ways: default, with `-ldflags="-s -w"`, and the brotli-compressed size of the stripped build.

**Goal.** Internalise the real numbers: ~2 MB default, ~1.6 MB stripped, ~0.9 MB brotli. Conclude that stripping shaves hundreds of KB but the runtime floor remains.

---

### Task 2 — Count crossings in a code path

Write a function that sets the text of three elements by id. Wrap every `js.Value` operation in a counter (an `int` you increment) and log the total. Then rewrite to cache the `document` handle at package level and re-count.

**Goal.** Quantify a crossing reduction from a real change. Expect the cached version to remove the repeated `Get("document")` crossings.

---

### Task 3 — Trigger and fix the frozen UI

Expose a Go function that runs a tight loop summing to ~10^9. Call it from a button. Observe the page freeze (a spinner stops, input ignored). Then chunk the loop so it yields periodically and observe responsiveness return.

**Goal.** Feel the single-thread block firsthand and fix it with yielding.

---

### Task 4 — Bulk-copy a byte buffer

In JS, create a `Uint8Array` of 1 MB of random bytes and pass it to a Go function. Inside Go, copy it into a `[]byte` two ways: (a) a loop of `src.Index(i).Int()`, (b) `js.CopyBytesToGo`. Time both with `time.Now()` deltas.

**Goal.** See the order-of-magnitude difference. The loop is the boundary-cost disaster; the bulk copy is one crossing.

---

## Medium

### Task 5 — Zero-copy a frame buffer to JS

Allocate a Go `[]byte` of `256*256*4` (an RGBA frame). Hand JS the pointer and length; on the JS side construct a `Uint8Array` over `exports.mem.buffer` and write the pixel data into an `<canvas>` via `putImageData`. Verify the image appears with no per-pixel crossing.

**Goal.** Build a working zero-copy share. Hint: use `unsafe.Pointer(&buf[0])` and `runtime.KeepAlive(buf)` around the call.

---

### Task 6 — Reproduce the detached-buffer bug

Extend Task 5: cache the `Uint8Array` view once in JS. Then, inside Go, allocate enough memory (e.g. append to a growing slice in a loop) to force a `memory.grow`. Re-render and watch the canvas go blank or throw. Fix by re-deriving the view each render.

**Goal.** Make the load-dependent bug appear deliberately, then fix it. Confirm `view.byteLength === 0` after the grow.

---

### Task 7 — Find and fix a `js.Func` leak

Write a function that, on each button click, registers a `setTimeout` callback via `js.FuncOf` and never releases it. Click many times. Track the leak with `runtime.ReadMemStats` and (if possible) the browser's memory tooling. Then fix by releasing the `Func` after it fires.

**Goal.** Observe a slow leak and fix it with a `defer cb.Release()` inside the callback.

---

### Task 8 — Convert a chatty boundary to a batchy one

Given a Go-side slice of 10,000 structs, implement a "render list" two ways: (a) loop calling `list.Call("appendChild", node)` per item, (b) build the whole HTML/markup once on the Go side, cross once with a single `Set("innerHTML", ...)` or a single `CopyBytesToJS`. Time both.

**Goal.** Demonstrate aggregate-across-the-boundary beating iterate-across-the-boundary. Expect a dramatic difference.

---

### Task 9 — Streaming vs non-streaming instantiation

Load the same `.wasm` two ways: `WebAssembly.instantiateStreaming(fetch(...))` and the fetch→arrayBuffer→instantiate path. Measure time-to-first-Go-execution with `performance.now()`. Ensure the server sends `Content-Type: application/wasm`.

**Goal.** Quantify the streaming win and confirm the MIME-type requirement (watch the console for the fallback warning if it is wrong).

---

### Task 10 — Isolate `syscall/js` for testability

Refactor a small app so all `syscall/js` calls live in one `dom` package and the business logic is pure Go over `[]byte`/structs. Write a normal `go test` (native build, no wasm) for the business logic.

**Goal.** Prove that the bulk of the code is testable off-wasm once the boundary is isolated.

---

## Hard

### Task 11 — Build a benchmarkable compute kernel

Implement a CPU-bound kernel (e.g. a 2D box blur on an image buffer) as a pure-Go function. Benchmark it natively with `go test -bench`. Then expose it via wasm and time it in the browser DevTools Performance panel. Compare steady-state wasm time to native and to a JS reimplementation.

**Goal.** Establish the real wasm-vs-native-vs-JS ratio for compute and confirm wasm beats JS for the kernel while being benchmarkable natively.

---

### Task 12 — Worker-offloaded parallelism

Run the Task 11 kernel inside a Web Worker (a second `.wasm` instance) so the main thread stays responsive. Drive it via `postMessage`. Then run N Workers over N image tiles and measure speedup vs one instance.

**Goal.** Achieve real parallelism through multiple instances (not goroutines) and measure near-linear speedup up to the core count.

---

### Task 13 — Crossing-budget a 60 fps loop

Build an animation that updates a value every frame. Instrument the crossing counter per frame. Reduce it to a target (e.g. ≤ 3 crossings/frame) by caching handles, batching, and moving compute into the box. Confirm the frame stays under ~16 ms in DevTools.

**Goal.** Hit an explicit crossing budget and verify the frame-time consequence.

---

### Task 14 — GC-jank reduction

Build a loop that allocates per frame (`js.ValueOf` of a fresh slice each frame). Observe GC frames and jank in DevTools. Refactor to reuse buffers and keep `ValueOf` of composites out of the loop; re-measure `NumGC` and pause time via `ReadMemStats`.

**Goal.** Show that allocation rate drives GC frequency and jank on the single thread, and that buffer reuse fixes it.

---

### Task 15 — wasip1 host-function call (stretch)

Build a tiny `GOOS=wasip1 GOARCH=wasm` module that calls a host function via `//go:wasmimport` (or simply uses a wasip1-backed stdlib call) and run it under a runtime like Wasmtime. Compare its binary size to the equivalent `js` build.

**Goal.** Experience the second target and confirm the binary is in the same size class while the boundary mechanism differs. Cross-link 02-wasi-and-wasip1.

---

### Task 16 — Production size budget gate

Write a CI check (a shell script) that builds the wasm, brotli-compresses it, and fails if the compressed size exceeds a budget (e.g. 1.5 MB). Wire it so a dependency that pulls in `reflect`-heavy code and inflates the binary fails the gate.

**Goal.** Treat size as an enforced NFR. Cross-link 05-wasm-in-production.

---

### Task 17 — End-to-end image editor slice

Build a minimal in-browser image editor: load a PNG into JS, share its bytes zero-copy with Go, apply a Go filter, share the result back, render to canvas. Apply everything: handle caching, bulk/zero-copy transfer, view re-derivation, `Func` release, streaming load.

**Goal.** Integrate every technique in one realistic feature and verify it stays responsive on a large image.

---

### Task 18 — Diagnose a black-box slow app

Given (or simulating) an app that "feels slow," follow the diagnostic flow: record a DevTools profile, classify time as compute vs glue/DOM, instrument crossings, and propose the fix that matches the classification. Write up the finding as a one-paragraph diagnosis.

**Goal.** Practice the senior workflow of classify-then-fix rather than guessing.

---

## Solutions (Sketched)

**Task 1.** `GOOS=js GOARCH=wasm go build -o a.wasm`; `... -ldflags="-s -w" -o b.wasm`; `brotli -q 11 -c b.wasm | wc -c`. Numbers land near 2.0 MB / 1.6 MB / 0.9 MB. The runtime floor is unmoved by stripping.

**Task 2.** Each `js.Global().Get("document")` inside the function is one crossing; hoisting it to a package var removes one crossing per call. The counter makes the saving concrete.

**Task 3.** A non-yielding loop never blocks, so the runtime never returns to the event loop and the page freezes. Chunking with `if i%1e6==0 { time.Sleep(0) }` (or a channel hop) creates yield points where the event loop runs and the UI repaints.

**Task 4.** The `Index(i).Int()` loop pays ~1M crossings; `CopyBytesToGo` pays one crossing plus a memmove. Expect a 100x+ difference.

**Task 5.** `ptr := unsafe.Pointer(&buf[0]); js.Global().Call("draw", uintptr(ptr), len(buf)); runtime.KeepAlive(buf)`. JS: `new Uint8Array(inst.exports.mem.buffer, ptr, len)` then `ctx.putImageData(...)`. No per-pixel crossing.

**Task 6.** After a `memory.grow`, the cached view's buffer is detached; `byteLength` is 0 and `putImageData` draws nothing. Re-deriving `new Uint8Array(exports.mem.buffer, ptr, len)` each render fixes it. The bug is load-dependent — small inputs never grow.

**Task 7.** Each unreleased `FuncOf` keeps a table slot and its closure alive. `var cb js.Func; cb = js.FuncOf(func(...) any { defer cb.Release(); ...; return nil })` frees it after firing.

**Task 8.** Per-item `appendChild` is 10,000 crossings; building markup once and crossing once (`Set("innerHTML", ...)` or `CopyBytesToJS`) is one. Aggregate on the Go side, exchange the whole.

**Task 9.** `instantiateStreaming` compiles during download and is faster; it needs `Content-Type: application/wasm` or it warns and falls back. Measure with `performance.now()` around load.

**Task 10.** Move `js.Global()`, `Get`, `Set`, `Call`, `FuncOf` into a `dom` package; keep filters/parsers/logic as pure functions. `go test ./...` runs the logic natively.

**Task 11.** Native `go test -bench` gives the baseline; DevTools gives the wasm steady-state (after JIT warmup). Wasm typically lands ~1.5–3x native time and beats a JS reimplementation for the kernel.

**Task 12.** Each Worker is a separate instance with its own runtime/GC; N Workers over N tiles give near-linear speedup. This is the only true parallelism path for Go wasm.

**Task 13.** Cache handles, batch updates, move arithmetic into Go; drive crossings to a small constant per frame and confirm frame time under 16 ms in the flame chart.

**Task 14.** Per-frame `js.ValueOf(slice)` allocates a fresh JS array each frame, raising `NumGC` and pause time. Reuse a pre-built handle / preallocated buffers; `ReadMemStats` shows fewer GCs.

**Task 15.** `GOOS=wasip1 GOARCH=wasm go build`; run under `wasmtime`. Binary is in the same MB class; the boundary is `go:wasmimport` host calls, not `syscall/js`.

**Task 16.** A script doing build → `brotli` → size check → `exit 1` if over budget. A `reflect`-heavy import inflates the binary and trips the gate, making size a visible cost.

**Task 17.** Compose: cache the canvas/context handles, transfer pixels zero-copy with re-derived views, release any transient `Func`, load with streaming instantiation. Stays responsive because the filter is compute-in-the-box with O(1) crossings.

**Task 18.** Record profile → if time is in wasm frames, optimise the algorithm (benchmark natively); if in `wasm_exec.js`/DOM, reduce crossings. The diagnosis names which and why before any code changes.
