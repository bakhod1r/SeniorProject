# GOOS=js/wasm in the Browser — Optimization

> Honest framing first: a Go wasm front end has two distinct cost centres, and they need different optimizations. The first is **load cost** — the multi-megabyte binary the browser must download, decompress, and compile before any Go runs. The second is **runtime cost** — the per-crossing Go↔JS boundary, the single-threaded jank budget, and memory that only ever grows. Optimizing one does nothing for the other. Below, each entry states the problem, a "before" and "after", and a realistic gain. The closing sections cover measurement and when *not* to reach for Go wasm at all. Binary-size and boundary internals are explored further in [04-wasm-interop-and-performance](../04-wasm-interop-and-performance/).

---

## Optimization 1 — Strip debug info from the binary

**Problem:** A default `GOOS=js GOARCH=wasm go build` includes the symbol table and DWARF debug information — significant dead weight in a binary the user must download.

**Before:**
```bash
GOOS=js GOARCH=wasm go build -o main.wasm
# e.g. ~8 MB
```

**After:**
```bash
GOOS=js GOARCH=wasm go build -ldflags="-s -w" -o main.wasm
# -s strips the symbol table, -w strips DWARF; e.g. ~6 MB
```

**Expected gain:** Typically 20–25% off the uncompressed size, no functional cost. The trade is that panic stack traces lose symbol names — keep an unstripped build for development.

---

## Optimization 2 — Compress on the wire (brotli/gzip)

**Problem:** Even a stripped Go wasm binary is several megabytes. Serving it raw makes download the dominant phase of time-to-interactive, especially on mobile networks.

**Before:**
```
GET /main.wasm  →  6 MB transferred
```

**After:**
```
# pre-compress at build time, serve with the right header
brotli -q 11 main.wasm -o main.wasm.br
# server sends: Content-Encoding: br  (browser decompresses transparently)
GET /main.wasm  →  ~1.8 MB transferred
```

**Expected gain:** Brotli typically cuts the wire size 65–75%; gzip 60–70%. This is the single largest lever on download time. The decompressed bytes the browser compiles are unchanged — compression is purely transport. Compress at build time (`-q 11`) rather than on the fly so you pay the expensive compression once.

---

## Optimization 3 — Stream-compile instead of buffering

**Problem:** Fetching the whole `.wasm` into an `ArrayBuffer` before compiling serializes download and compile, padding time-to-interactive.

**Before:**
```js
fetch("main.wasm").then(r => r.arrayBuffer())
  .then(b => WebAssembly.instantiate(b, go.importObject))
  .then(r => go.run(r.instance));
```

**After:**
```js
WebAssembly.instantiateStreaming(fetch("main.wasm"), go.importObject)
  .then(r => go.run(r.instance));
```

`instantiateStreaming` compiles bytes as they arrive, overlapping download and compile. It requires the server to send `Content-Type: application/wasm`.

**Expected gain:** Compilation overlaps download, shaving the compile phase off the critical path — meaningful on a multi-megabyte module. Keep the buffered version as a fallback only where you cannot control the MIME type.

---

## Optimization 4 — Reduce boundary crossings with coarse calls

**Problem:** The Go↔JS boundary is expensive *per crossing*. Fine-grained DOM manipulation in a loop dominates runtime cost regardless of how fast the Go logic is.

**Before:**
```go
for i, row := range rows {
    for j, cell := range row {
        table.Call("rows").Index(i).Call("cells").Index(j).Set("innerText", cell)
    }
}
// tens of thousands of crossings for a large table
```

**After:**
```go
var b strings.Builder
renderTableHTML(&b, rows) // all formatting in Go memory
table.Set("innerHTML", b.String()) // one crossing
```

**Expected gain:** A render that was tens of thousands of crossings becomes one. For large DOM updates this is the difference between seconds of jank and an imperceptible frame. The mental model is a network call: batch, do not chatter.

---

## Optimization 5 — Cache `js.Value` handles in hot paths

**Problem:** Re-resolving the same DOM element or global on every event re-crosses the boundary for a value that never changes.

**Before:**
```go
input.Call("addEventListener", "input", js.FuncOf(func(this js.Value, _ []js.Value) any {
    out := js.Global().Get("document").Call("getElementById", "out") // every keystroke
    out.Set("innerText", this.Get("value").String())
    return nil
}))
```

**After:**
```go
out := js.Global().Get("document").Call("getElementById", "out") // resolve once
input.Call("addEventListener", "input", js.FuncOf(func(this js.Value, _ []js.Value) any {
    out.Set("innerText", this.Get("value").String())
    return nil
}))
```

**Expected gain:** Several boundary crossings removed from every event. On a high-frequency event (`input`, `mousemove`, `scroll`) this is the difference between smooth and sluggish.

---

## Optimization 6 — Move bytes in bulk, never per element

**Problem:** Transferring binary data (image, file, WebSocket frame) one byte at a time is one boundary crossing per byte.

**Before:**
```go
u8 := js.Global().Get("Uint8Array").New(len(data))
for i, b := range data {
    u8.SetIndex(i, b) // one crossing per byte
}
```

**After:**
```go
u8 := js.Global().Get("Uint8Array").New(len(data))
js.CopyBytesToJS(u8, data) // single bulk copy through linear memory
```

**Expected gain:** A 1 MB buffer goes from ~1,000,000 crossings to one. This is not an optimization so much as the only viable approach — the per-element form is unusable for real payloads.

---

## Optimization 7 — Chunk long work to stay under the frame budget

**Problem:** A synchronous Go computation that exceeds ~16ms blocks paint and input on the single thread; the page janks or freezes.

**Before:**
```go
func process(items []Item) {
    for _, it := range items { heavy(it) } // blocks the thread for seconds
}
```

**After:**
```go
func processChunked(items []Item) {
    const perFrame = 200
    var i int
    var step js.Func
    step = js.FuncOf(func(js.Value, []js.Value) any {
        end := min(i+perFrame, len(items))
        for ; i < end; i++ { heavy(items[i]) }
        if i < len(items) {
            js.Global().Call("requestAnimationFrame", step)
        } else {
            step.Release()
        }
        return nil
    })
    js.Global().Call("requestAnimationFrame", step)
}
```

**Expected gain:** The page stays interactive throughout; you can render progress. The total compute is unchanged, but it no longer freezes the tab. Note a goroutine does *not* substitute — it still runs on the one thread.

---

## Optimization 8 — Offload sustained compute to a Web Worker

**Problem:** Chunking keeps the page responsive but does not speed up the computation — it still competes with paint on one thread. For sustained CPU-bound work you want true parallelism.

**Before:** A heavy transform runs on the main-thread wasm instance, chunked, taking N seconds of wall time while the UI degrades.

**After:** Run a second `main.wasm` instance inside a Web Worker. The main thread `postMessage`s the input; the worker computes on its own thread and `postMessage`s the result back; the main thread renders it.

**Expected gain:** The computation runs in parallel with a fully responsive UI at 60fps. The cost is a structured-clone message boundary and a second instance's memory. Worth it when the work is large and recurring; overkill for a one-off.

---

## Optimization 9 — Lazy-load the wasm module

**Problem:** Shipping the multi-megabyte `.wasm` on the initial page load delays first paint for a feature the user may never reach.

**Before:** `index.html` instantiates `main.wasm` on load; the landing page waits for the whole download.

**After:** Load and instantiate the module only when the user navigates to the feature that needs it:
```js
async function loadGo() {
  const go = new Go();
  const r = await WebAssembly.instantiateStreaming(fetch("feature.wasm"), go.importObject);
  go.run(r.instance);
}
document.getElementById("open-editor").addEventListener("click", loadGo);
```

**Expected gain:** The landing page stays light; the wasm cost is paid only by users who use the feature, and only when they do. Trades a one-time delay on first feature use for a fast initial load.

---

## Optimization 10 — Content-hash and cache aggressively

**Problem:** A large immutable binary re-downloaded on every visit wastes bandwidth and time, but caching by a stable filename serves stale code after a deploy.

**Before:**
```html
<script>WebAssembly.instantiateStreaming(fetch("main.wasm"), go.importObject)...</script>
<!-- Cache-Control: max-age=31536000 → users stuck on old builds -->
```

**After:**
```html
<script>WebAssembly.instantiateStreaming(fetch("main.a1b2c3.wasm"), go.importObject)...</script>
<!-- new build = new URL; long immutable cache is now safe -->
```

**Expected gain:** First visit pays the download; repeat visits hit the cache instantly, and a new release invalidates automatically via the changed hash. Apply the same to `wasm_exec.js`.

---

## Optimization 11 — Trim the dependency tree

**Problem:** Binary size is largely a function of what you import. Pulling in heavy packages (`regexp`, full `fmt` formatting, `time/tzdata`, `reflect`-heavy libraries) inflates the binary the user downloads.

**Before:**
```go
import (
    "regexp"        // pulls in the regex engine
    "encoding/json" // reflect-heavy
)
```

**After:**
```go
// Replace a one-off regexp with strings.Contains/HasPrefix where it suffices.
// Prefer code-generated (de)serialization over reflect-based JSON in hot paths.
import "strings"
```
Audit what dominates with `go tool nm main.wasm` (unstripped) or `wasm-objdump -x`.

**Expected gain:** Variable, but trimming a heavy transitive dependency can shave hundreds of KB to megabytes. The discipline: import only what a *browser* build needs, gated with build tags if the same package serves both targets.

---

## Optimization 12 — Consider TinyGo for size-critical builds

**Problem:** The standard toolchain bundles the full Go runtime and GC; even after stripping and compression the floor is high. When binary size is the binding constraint, the standard toolchain cannot get under it.

**Before:**
```bash
GOOS=js GOARCH=wasm go build -ldflags="-s -w" -o main.wasm   # e.g. ~2 MB compressed
```

**After:**
```bash
tinygo build -o main.wasm -target wasm ./...   # often an order of magnitude smaller
```

**When it applies:** Your code stays within TinyGo's supported language and standard-library subset (limited reflection, fewer packages, its own `syscall/js` behaviour). Use the standard toolchain when you need full fidelity.

**Expected gain:** Dramatically smaller binaries — frequently 10x — at the cost of compatibility constraints you must validate. The detailed trade-off lives in [04-wasm-interop-and-performance](../04-wasm-interop-and-performance/).

---

## Optimization 13 — Reduce allocation to cut GC pauses and the memory floor

**Problem:** wasm linear memory only grows — it never returns pages to the browser — so a peak working set is permanent for the instance. And the GC runs cooperatively on the single thread, so its pauses show up as jank.

**Before:**
```go
func render(items []Item) string {
    s := ""
    for _, it := range items { s += format(it) } // O(n) reallocations, garbage churn
    return s
}
```

**After:**
```go
func render(items []Item) string {
    var b strings.Builder
    b.Grow(len(items) * 32) // preallocate; reuse buffers across calls where possible
    for _, it := range items { b.WriteString(format(it)) }
    return b.String()
}
```

**Expected gain:** Fewer allocations mean fewer GC cycles (less main-thread jank) and a lower memory high-water mark (which, because memory never shrinks, is permanent). In hot paths, pooling buffers (`sync.Pool`) further cuts churn.

---

## Optimization 14 — Show a loading state so the wait is perceived, not dead

**Problem:** Until `go.run` registers the API, the Go side is inert. Interactive controls that are visible but do nothing make the page feel broken during the (multi-second) load.

**Before:** The page renders its full UI immediately; clicking a button before Go boots silently does nothing.

**After:**
```js
showSpinner();
WebAssembly.instantiateStreaming(fetch("main.wasm"), go.importObject)
  .then(r => { go.run(r.instance); })   // main registers goApp and signals ready
  .then(() => hideSpinner());
```
Have Go set a `window.goReady = true` flag (or dispatch an event) once its API is registered, and gate the controls on it.

**Expected gain:** Not a speed gain but a perceived-performance and correctness gain: no dead-but-visible controls, no confused users clicking into the void during the load.

---

## Benchmarking and Measurement

Optimization without measurement is folklore. For Go wasm the useful signals are:

```bash
# Binary size, stripped and compressed
GOOS=js GOARCH=wasm go build -ldflags="-s -w" -o main.wasm
du -h main.wasm
gzip -9 -c main.wasm | wc -c     # approximate wire size with gzip
brotli -q 11 -c main.wasm | wc -c

# What pulled in weight (build unstripped to keep symbols)
GOOS=js GOARCH=wasm go build -o main.debug.wasm
go tool nm main.debug.wasm | sort -k2 -n | tail
```

In the browser (the numbers that actually matter to users):

```js
// Time-to-interactive phases
const t0 = performance.now();
const r = await WebAssembly.instantiateStreaming(fetch("main.wasm"), go.importObject);
const tCompiled = performance.now();
go.run(r.instance);              // main registers the API
const tReady = performance.now();
console.log({ instantiate: tCompiled - t0, run: tReady - tCompiled });
```

- **Network panel:** transferred size (compressed) vs. resource size (decompressed), and whether the MIME/encoding are correct.
- **Performance panel:** long tasks on the main thread (jank from un-chunked compute or GC pauses).
- **Memory panel:** heap snapshots over time to catch `js.Func` leaks and the permanent growth of linear memory.

Track these before and after each change. The two headline metrics: compressed binary size (drives load time) and main-thread long-task duration (drives jank).

---

## When NOT to Reach for Go wasm

These optimizations make Go wasm faster; none of them make it the right tool when it is not.

- **Light, DOM-bound UI with no Go to reuse:** plain JavaScript is smaller, has no boundary cost, and no megabyte download. Choosing Go wasm here is the most common over-engineering mistake.
- **Public pages where first-load size is a hard constraint:** even a stripped, compressed binary is heavy. A marketing page should not ship a Go runtime.
- **Workloads that are DOM-heavy and compute-light:** you pay boundary cost with nothing to amortise it against.
- **Anything needing true multi-threaded parallelism without the Web Worker plumbing:** the single thread is a hard ceiling.

Reach for Go wasm when you have substantial reused Go logic, shared client/server rules that must not diverge, or genuine client-side compute whose value outweighs the runtime baggage. Then apply the optimizations above — strip, compress, stream, lazy-load, batch the boundary, and respect the single thread — to make the choice pay off.

---

## Summary

A Go wasm front end has two cost centres that demand different fixes. **Load cost** is attacked by shrinking and serving the binary well: strip with `-ldflags="-s -w"`, compress with brotli/gzip at build time, stream-compile with `instantiateStreaming`, content-hash for caching, trim heavy imports, consider TinyGo when size is the binding constraint, and lazy-load modules that back optional features. **Runtime cost** is attacked by respecting the boundary and the single thread: cross the Go↔JS boundary coarsely (build results in Go, assign once), cache `js.Value` handles, move bytes with `CopyBytes*`, chunk long work or offload it to a Web Worker, and reduce allocation to cut GC pauses and the permanent memory floor. Measure everything — compressed size for load, main-thread long tasks for jank. And the highest-leverage optimization is upstream of all of these: deciding honestly whether the feature should be Go wasm at all. When the reused-Go-logic value does not outweigh the download and boundary cost, the best optimization is plain JavaScript.
