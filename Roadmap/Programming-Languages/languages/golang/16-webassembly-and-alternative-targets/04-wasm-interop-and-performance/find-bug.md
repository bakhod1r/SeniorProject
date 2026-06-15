# Wasm Interop & Performance — Find the Bug

> Each scenario contains a real-world bug in Go-compiled WebAssembly interop or performance. The target is `GOOS=js GOARCH=wasm` unless noted: Go runs in a sandbox and reaches JavaScript only through `syscall/js` and `wasm_exec.js`; every `Get`/`Set`/`Call`/`ValueOf` is a boundary crossing; wasm linear memory can grow and detach cached views; the runtime ships inside the binary and runs single-threaded. For each: read the symptom, find the bug, explain the root cause, apply the fix.

---

## Bug 1 — Memory growth invalidating a cached TypedArray view

```js
// JS, set up once at startup
const mem = new Uint8Array(inst.exports.mem.buffer, framePtr, frameLen);
function render() {
  // works for the first few seconds, then draws a blank/garbled frame
  ctx.putImageData(new ImageData(new Uint8ClampedArray(mem), W, H), 0, 0);
}
```

**Symptom.** Rendering works, then goes blank or garbled after the app has been running and allocating for a while; `mem.byteLength` reads `0`.

**Root cause.** The Go heap grew, the runtime called `memory.grow`, and the engine reallocated the backing `ArrayBuffer`, **detaching** the old one. The `mem` view, constructed once over the old buffer, is now invalid.

**Fix.** Never cache a view across allocation. Re-derive it from the *current* buffer every render:

```js
function render() {
  const mem = new Uint8Array(inst.exports.mem.buffer, framePtr, frameLen);
  ctx.putImageData(new ImageData(new Uint8ClampedArray(mem), W, H), 0, 0);
}
```

---

## Bug 2 — `js.Func` registered per event, never released

```go
func attach() {
    js.Global().Get("button").Call("addEventListener", "click",
        js.FuncOf(func(this js.Value, args []js.Value) any {
            doWork()
            return nil
        }))
}
// attach() is called on every navigation
```

**Symptom.** JS heap grows steadily over a long session; eventually the tab slows and crashes. Go's `HeapAlloc` looks fine.

**Root cause.** Each `FuncOf` allocates a reference-table slot the JS side holds forever. Calling `attach` repeatedly leaks one slot (and its closure) per call.

**Fix.** Register once for the program's lifetime, or keep a handle and `Release` it on teardown:

```go
var clickCb js.Func
func attach() {
    if clickCb.Truthy() { return } // already attached
    clickCb = js.FuncOf(func(this js.Value, args []js.Value) any { doWork(); return nil })
    js.Global().Get("button").Call("addEventListener", "click", clickCb)
}
// on teardown: clickCb.Release()
```

---

## Bug 3 — Death by a thousand crossings in a render loop

```go
func draw(pixels []Pixel) {
    canvas := js.Global().Get("document").Call("getElementById", "c")
    ctx := canvas.Call("getContext", "2d")
    for _, p := range pixels { // 250,000 pixels
        ctx.Call("fillRect", p.X, p.Y, 1, 1) // one crossing per pixel
    }
}
```

**Symptom.** Drawing is far slower than the equivalent plain-JS version; the profile shows almost all time in `wasm_exec.js` glue, not in wasm compute.

**Root cause.** 250,000 `Call("fillRect", ...)` crossings per frame. The boundary cost, not the drawing, dominates.

**Fix.** Build the pixel buffer in Go and cross once. Write into an `ImageData` backing array via `CopyBytesToJS` (or a shared view) and `putImageData` in a single call:

```go
buf := make([]byte, len(pixels)*4)
for i, p := range pixels { encodeRGBA(buf[i*4:], p) } // pure compute, no crossings
js.CopyBytesToJS(imageDataArray, buf)                  // one crossing
ctx.Call("putImageData", imageData, 0, 0)              // one crossing
```

---

## Bug 4 — Copying a huge buffer every frame

```go
func tick(audioData js.Value) {
    n := audioData.Get("length").Int()
    buf := make([]byte, n)
    js.CopyBytesToGo(buf, audioData) // 2 MB copied every frame, 60x/sec
    process(buf)
}
```

**Symptom.** Smooth at low rates, but at 60 fps the GC churns and frames drop; allocation rate is high.

**Root cause.** A fresh 2 MB allocation and full copy every frame. The copy is one crossing (fine) but the per-frame allocation feeds the single-thread GC, and if the data has not changed, the copy is wasted entirely.

**Fix.** Reuse a buffer and share zero-copy where the data is already in wasm memory. If the source genuinely lives on the JS side and changes each frame, at least reuse the destination:

```go
var buf []byte
func tick(audioData js.Value) {
    n := audioData.Get("length").Int()
    if cap(buf) < n { buf = make([]byte, n) }
    buf = buf[:n]
    js.CopyBytesToGo(buf, audioData) // reused allocation
    process(buf)
}
```

---

## Bug 5 — Assuming goroutines give parallelism

```go
func computeAll(tiles [][]byte) {
    var wg sync.WaitGroup
    for _, t := range tiles {
        wg.Add(1)
        go func(t []byte) { defer wg.Done(); heavyFilter(t) }(t)
    }
    wg.Wait() // expected to use all cores
}
```

**Symptom.** No speedup over a sequential loop; total time is the sum, not the max, of the tile times.

**Root cause.** Go wasm is single-threaded. Goroutines time-share one thread — concurrency, not parallelism. They cannot saturate multiple cores.

**Fix.** For true parallelism, run multiple wasm *instances* in multiple Web Workers, each processing a tile, coordinated by JS `postMessage`. Within one instance, a sequential loop is as fast as goroutines and simpler.

---

## Bug 6 — GC pause on the single thread stalling the UI

```go
func animate() {
    for {
        frame := buildFrameObjects() // allocates thousands of small objects/frame
        render(frame)
        time.Sleep(16 * time.Millisecond)
    }
}
```

**Symptom.** Periodic jank — every few hundred frames a visible hitch.

**Root cause.** Per-frame allocation raises GC frequency; each collection runs foreground on the one thread, stealing from the frame budget and from repaint. The hitch is a GC cycle.

**Fix.** Slash allocation in the hot loop: reuse frame objects/buffers (`sync.Pool` or preallocated slices), avoid `js.ValueOf` of composites per frame. Fewer allocations → fewer GCs → no hitch.

---

## Bug 7 — Refetching a stable handle in a loop

```go
func update(items []Item) {
    for _, it := range items {
        js.Global().Get("document").Call("getElementById", it.ID).
            Set("textContent", it.Text) // Get("document") every iteration
    }
}
```

**Symptom.** Slower than necessary; crossing count scales as 3×N when it could be lower.

**Root cause.** `js.Global().Get("document")` is a stable lookup repeated every iteration — a wasted crossing each time.

**Fix.** Hoist the stable handle to package level (or out of the loop):

```go
var document = js.Global().Get("document")
func update(items []Item) {
    for _, it := range items {
        document.Call("getElementById", it.ID).Set("textContent", it.Text)
    }
}
```

(The deeper fix is to batch into one DOM write, but hoisting alone removes N crossings.)

---

## Bug 8 — `main` returns, callbacks stop firing

```go
func main() {
    js.Global().Set("greet", js.FuncOf(func(this js.Value, args []js.Value) any {
        return "hi " + args[0].String()
    }))
    // main returns here
}
```

**Symptom.** `greet(...)` works for an instant then `greet is not a function` / the runtime has exited.

**Root cause.** When `main` returns, the Go program exits and `wasm_exec.js` tears the instance down. Registered callbacks die with it.

**Fix.** Keep the program alive:

```go
func main() {
    js.Global().Set("greet", js.FuncOf(/* ... */))
    select {} // parks main forever; runtime yields to the event loop
}
```

---

## Bug 9 — Sharing a slice pointer without `runtime.KeepAlive`

```go
func draw() {
    buf := make([]byte, W*H*4)
    fill(buf)
    ptr := unsafe.Pointer(&buf[0])
    js.Global().Call("blit", uintptr(ptr), len(buf))
    // buf is no longer referenced after this line
}
```

**Symptom.** Intermittent garbage pixels or crashes, especially under memory pressure.

**Root cause.** After the last Go reference to `buf`, the GC may move or reclaim it. If `blit` reads asynchronously or the GC runs during the call, JS reads freed/moved memory.

**Fix.** Keep the slice alive across the call:

```go
js.Global().Call("blit", uintptr(unsafe.Pointer(&buf[0])), len(buf))
runtime.KeepAlive(buf)
```

(And ensure `blit` reads synchronously; the pointer must not be used after the call returns.)

---

## Bug 10 — `js.ValueOf` of a composite inside the hot path

```go
func sendBatch(rows []Row) {
    for _, r := range rows {
        channel.Call("postMessage", js.ValueOf(map[string]any{
            "id": r.ID, "v": r.Value,
        })) // builds a fresh JS object + boxes every field, per row
    }
}
```

**Symptom.** High allocation rate, GC churn, slow throughput.

**Root cause.** `js.ValueOf(map[...])` allocates a JS object and boxes each field on every iteration, and each `postMessage` is a separate crossing.

**Fix.** Serialize the whole batch once on the Go side and cross once:

```go
payload := encodeRows(rows)              // pure Go: e.g. a packed []byte
arr := js.Global().Get("Uint8Array").New(len(payload))
js.CopyBytesToJS(arr, payload)
channel.Call("postMessage", arr)         // one crossing, one transfer
```

---

## Bug 11 — Non-streaming instantiation wasting startup time

```js
fetch("main.wasm")
  .then(r => r.arrayBuffer())
  .then(bytes => WebAssembly.instantiate(bytes, go.importObject))
  .then(res => go.run(res.instance));
```

**Symptom.** Slow time-to-interactive; the wasm only starts compiling after the full download completes.

**Root cause.** Buffering the whole file before compiling serialises download and compile instead of overlapping them.

**Fix.** Stream — compile while downloading (requires `Content-Type: application/wasm`):

```js
WebAssembly.instantiateStreaming(fetch("main.wasm"), go.importObject)
  .then(res => go.run(res.instance));
```

---

## Bug 12 — Reading int64 across the boundary loses precision

```go
func id() any { return js.ValueOf(int64(9007199254740993)) } // > 2^53
```
```js
console.log(goID()); // prints 9007199254740992 — wrong
```

**Symptom.** Large integer identifiers come back altered by 1 or more.

**Root cause.** JS `number` is an IEEE-754 double; integers above 2^53 lose precision. `js.ValueOf(int64)` round-trips through a JS number.

**Fix.** Pass large integers as strings (or split into two 32-bit halves), and parse on the JS side as `BigInt` if exact arithmetic is needed:

```go
func id() any { return js.ValueOf(strconv.FormatInt(9007199254740993, 10)) }
```

---

## Bug 13 — Stripped binary makes the profiler useless

```bash
GOOS=js GOARCH=wasm go build -ldflags="-s -w" -o main.wasm
# then trying to read the DevTools flame chart...
```

**Symptom.** Wasm frames in the Performance panel are all unnamed (`wasm-function[1234]`), so you cannot tell what is hot.

**Root cause.** `-w` drops DWARF and `-s` drops the symbol table — exactly the data the profiler needs to name frames.

**Fix.** Profile with a non-stripped build; ship the stripped build to production:

```bash
GOOS=js GOARCH=wasm go build -o profile.wasm           # named frames for profiling
GOOS=js GOARCH=wasm go build -ldflags="-s -w" -o ship.wasm
```

---

## Bug 14 — Calling a throwing JS method without recovering

```go
func parse(input string) string {
    return js.Global().Get("JSON").Call("parse", input).Get("name").String()
}
// JSON.parse on malformed input throws
```

**Symptom.** A single bad input panics the whole wasm module; the app stops responding.

**Root cause.** A JS exception from `Call` surfaces as a Go panic. Unrecovered, it crashes the goroutine (and, in `main`, the program).

**Fix.** Recover at the boundary for untrusted input:

```go
func parse(input string) (out string, err error) {
    defer func() {
        if r := recover(); r != nil { err = fmt.Errorf("parse failed: %v", r) }
    }()
    return js.Global().Get("JSON").Call("parse", input).Get("name").String(), nil
}
```

---

## Bug 15 — `Int()` on an undefined property panics

```go
func width(el js.Value) int {
    return el.Get("dataset").Get("width").Int() // panics if data-width is absent
}
```

**Symptom.** Crashes on elements missing the attribute; works on those that have it.

**Root cause.** `Get` on a missing property returns `Undefined`; `Int()` on `Undefined` panics.

**Fix.** Check before extracting:

```go
func width(el js.Value) (int, bool) {
    v := el.Get("dataset").Get("width")
    if v.Type() != js.TypeString && v.Type() != js.TypeNumber { return 0, false }
    return v.Int(), true
}
```

---

## Bug 16 — Caching one handle per DOM node forever

```go
var cache = map[string]js.Value{}
func node(id string) js.Value {
    if v, ok := cache[id]; ok { return v }
    v := document.Call("getElementById", id)
    cache[id] = v // never evicted; grows for the life of the SPA
    return v
}
```

**Symptom.** JS heap grows over a long single-page-app session even as the DOM churns; detached DOM nodes are never collected.

**Root cause.** Each cached `js.Value` pins its JS object (and the DOM node) so JS GC cannot reclaim it. An unbounded cache of transient handles is a leak.

**Fix.** Cache only *stable* handles (the document, a canvas). For transient nodes, look them up on demand or use a bounded cache that releases entries when nodes are removed.

---

## Bug 17 — Wrong `wasm_exec.js` version

```bash
# project committed wasm_exec.js from Go 1.20; building with Go 1.23
GOOS=js GOARCH=wasm go build -o main.wasm
```

**Symptom.** Module fails to instantiate, or runs then errors with obscure messages about missing imports / mismatched syscalls.

**Root cause.** `wasm_exec.js` is version-locked to the toolchain. A stale glue script does not implement the syscall surface the new binary expects.

**Fix.** Always copy the glue from the toolchain that built the binary, and cache-bust them together:

```bash
cp "$(go env GOROOT)/lib/wasm/wasm_exec.js" .
```

---

## Bug 18 — Blocking the event loop inside a synchronous callback

```go
js.Global().Set("compute", js.FuncOf(func(this js.Value, args []js.Value) any {
    ch := make(chan int)
    js.Global().Call("setTimeout", js.FuncOf(func(js.Value, []js.Value) any {
        ch <- 42; return nil
    }), 0)
    return <-ch // waits for a timer that can only fire after this returns
}))
```

**Symptom.** `compute()` hangs the page forever.

**Root cause.** The callback runs synchronously on the one thread mid-event. It blocks on a channel that only a *later* event (the `setTimeout`) can satisfy — but that event cannot run until this callback returns. Deadlock.

**Fix.** Do not block a synchronous callback on a future event. Return a Promise, or spawn a goroutine that yields and resolves later:

```go
js.Global().Set("compute", js.FuncOf(func(this js.Value, args []js.Value) any {
    return newPromise(func(resolve js.Value) {
        go func() { result := doWork(); resolve.Invoke(result) }()
    })
}))
```

---

## Bug 19 — Tight loop never yielding, freezing the page

```go
func search(data []Record, q string) int {
    for i := range data { // millions of records, runs for ~800ms
        if match(data[i], q) { return i }
    }
    return -1
}
// called directly from a click handler
```

**Symptom.** The page freezes for nearly a second on each search; spinners stop, clicks queue up.

**Root cause.** A long, non-yielding computation never blocks, so the runtime never returns to the event loop and the browser cannot repaint.

**Fix.** Chunk-and-yield, or offload to a Worker. Chunking:

```go
func search(data []Record, q string) int {
    for i := range data {
        if i%50000 == 0 { time.Sleep(0) } // yield: lets the event loop repaint
        if match(data[i], q) { return i }
    }
    return -1
}
```

For an 800 ms job, a Web Worker instance is the better fix.

---

## Bug 20 — Assuming `CopyBytesToJS` resizes the destination

```go
func send(data []byte) {
    dst := js.Global().Get("Uint8Array").New(0) // length 0
    js.CopyBytesToJS(dst, data)                  // copies min(0, len) = 0 bytes
    channel.Call("postMessage", dst)             // sends empty array
}
```

**Symptom.** The receiver gets an empty array; no error, no panic.

**Root cause.** `CopyBytesToJS` copies `min(dst.length, len(src))` bytes — it does **not** grow the destination. A zero-length `dst` silently copies nothing.

**Fix.** Allocate the destination at the correct size first:

```go
dst := js.Global().Get("Uint8Array").New(len(data))
js.CopyBytesToJS(dst, data)
```

---

## Bug 21 — Mutating a shared buffer while JS still reads it

```go
func frame() {
    js.Global().Call("scheduleRead", uintptr(unsafe.Pointer(&buf[0])), len(buf))
    // JS reads buf asynchronously on the next animation frame
    fill(buf) // Go overwrites buf immediately
    runtime.KeepAlive(buf)
}
```

**Symptom.** JS sometimes reads a half-written frame — tearing/flicker.

**Root cause.** The zero-copy contract is "valid for the duration of the *synchronous* call." Here JS reads on a *later* frame while Go has already overwritten the buffer. The borrow outlived its safe window.

**Fix.** Either have JS read synchronously within the call, or double-buffer so Go writes to a different buffer than the one JS is currently reading:

```go
bufs := [2][]byte{makeBuf(), makeBuf()}
cur := 0
func frame() {
    fill(bufs[cur])
    js.Global().Call("read", uintptr(unsafe.Pointer(&bufs[cur][0])), len(bufs[cur]))
    runtime.KeepAlive(bufs[cur])
    cur ^= 1 // next frame writes the other buffer
}
```

---

## How to Practise

Cover the symptom and the code, predict the bug, then check. For the interop-specific bugs (1, 9, 18, 20, 21) reproduce them in a scratch app: they are load- or timing-dependent and only become intuitive once you have watched a cached view detach or a synchronous callback deadlock. The recurring root causes are: **crossings in a loop** (3, 7, 10), **lifetime mistakes** (2, 9, 16, 21), **the detached buffer** (1), **single-thread reality** (5, 6, 18, 19), and **boundary semantics** (12, 14, 15, 20).
