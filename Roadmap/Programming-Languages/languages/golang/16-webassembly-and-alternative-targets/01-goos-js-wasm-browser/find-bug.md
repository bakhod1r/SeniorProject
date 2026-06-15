# GOOS=js/wasm in the Browser — Find the Bug

> Each snippet contains a real-world bug in Go-to-browser-WebAssembly code. Recall the model: `GOOS=js GOARCH=wasm go build` produces a `main.wasm` that the `wasm_exec.js` glue boots via `go.run`; `syscall/js` bridges Go and JavaScript; the program runs single-threaded on the browser's event loop; and `main` returning tears the instance down. For each: identify the symptom, the root cause, and the fix.

---

## Bug 1 — Interactive program with no `select{}`

```go
func main() {
    btn := js.Global().Get("document").Call("getElementById", "btn")
    btn.Call("addEventListener", "click", js.FuncOf(func(js.Value, []js.Value) any {
        js.Global().Get("console").Call("log", "clicked")
        return nil
    }))
}
```

**Symptom:** The button does nothing when clicked. Setup ran, but no click is ever logged.

**Root cause:** `main` returns immediately after registering the listener. When `main` returns, the runtime signals exit and `wasm_exec.js` tears down the instance — the registered `js.Func` is now a call into a dead program.

**Fix:** park `main` so the instance stays alive:

```go
func main() {
    // ... register listener ...
    select {} // block forever; the event loop keeps dispatching callbacks
}
```

---

## Bug 2 — One-shot callback never released

```go
func startPolling() {
    js.Global().Call("setInterval", js.FuncOf(func(js.Value, []js.Value) any {
        poll()
        return nil
    }), 1000)
}
```

**Symptom:** Memory is fine — this one is actually *correct* for an interval that lives forever. The bug is the next pattern.

```go
func onEachRender(data []Item) {
    for range data {
        cb := js.FuncOf(func(js.Value, []js.Value) any { return nil })
        js.Global().Call("setTimeout", cb, 0)
        // cb is never Release()d
    }
}
```

**Symptom:** Heap grows monotonically; after enough renders the tab crashes.

**Root cause:** Every `FuncOf` registers the closure in a table the glue owns, invisible to Go's GC. Creating one per item per render and never releasing it leaks each closure forever.

**Fix:** release one-shots after they fire:

```go
var cb js.Func
cb = js.FuncOf(func(js.Value, []js.Value) any { defer cb.Release(); return nil })
js.Global().Call("setTimeout", cb, 0)
```

---

## Bug 3 — Awaiting a Promise inside a click handler

```go
btn.Call("addEventListener", "click", js.FuncOf(func(js.Value, []js.Value) any {
    resp, _ := await(js.Global().Call("fetch", "/api/data")) // await blocks on a channel
    render(resp)
    return nil
}))
```

**Symptom:** The handler hangs forever the first time the button is clicked; the tab becomes unresponsive.

**Root cause:** `await` blocks on a channel that the Promise's resolve callback fills. But the resolve callback can only run as a *new* event-loop task — after the current handler returns. The handler is blocking inside the loop task, so it never returns, so the resolver never runs. Deadlock.

**Fix:** run the async work on a goroutine so the handler returns and the loop is free to run the resolver:

```go
btn.Call("addEventListener", "click", js.FuncOf(func(js.Value, []js.Value) any {
    go func() {
        resp, _ := await(js.Global().Call("fetch", "/api/data"))
        render(resp)
    }()
    return nil
}))
```

---

## Bug 4 — Busy loop instead of parking

```go
func main() {
    setup()
    for {} // "keep alive"
}
```

**Symptom:** The page freezes completely — no paint, no clicks, 100% CPU on one core.

**Root cause:** `for {}` never blocks, so the goroutine stays runnable, the scheduler never parks, control never returns to the event loop, and the loop is starved. Unlike `select{}`, a busy loop *spins* instead of *parking*.

**Fix:** park with `select{}` (or a channel receive), which yields the thread to the event loop:

```go
func main() {
    setup()
    select {}
}
```

---

## Bug 5 — `.Int()` on an input value

```go
input.Call("addEventListener", "input", js.FuncOf(func(this js.Value, _ []js.Value) any {
    n := this.Get("value").Int() // panic
    js.Global().Get("console").Call("log", n*2)
    return nil
}))
```

**Symptom:** `panic: syscall/js: call of Value.Int on string`, which crashes the instance.

**Root cause:** A DOM input's `value` is always a *string*, even for `<input type="number">`. `.Int()` panics on a non-number `js.Value`.

**Fix:** read as a string and parse:

```go
s := this.Get("value").String()
n, err := strconv.Atoi(s)
if err != nil { return nil }
```

---

## Bug 6 — Stale `wasm_exec.js` after a Go upgrade

```bash
$ go version
go version go1.24.0 ...
$ GOOS=js GOARCH=wasm go build -o main.wasm
$ # wasm_exec.js was copied two Go versions ago and committed
$ # serve and open: obscure runtime errors, the program never starts
```

**Symptom:** The module instantiates but the Go program misbehaves or fails to start, with cryptic errors — not a clean "version mismatch" message.

**Root cause:** `wasm_exec.js` and `main.wasm` share an internal ABI (import list, memory layout, value-table protocol) that changes between Go versions. A stale glue mismatches the binary.

**Fix:** copy the glue from the building toolchain on every build:

```bash
$ cp "$(go env GOROOT)/lib/wasm/wasm_exec.js" .
```

Make it part of the build script and pin the Go toolchain so glue and binary always match.

---

## Bug 7 — Hard-coded old glue path

```bash
#!/usr/bin/env bash
GOOS=js GOARCH=wasm go build -o main.wasm
cp "$(go env GOROOT)/misc/wasm/wasm_exec.js" .   # path no longer exists
```

**Symptom:** `cp: .../misc/wasm/wasm_exec.js: No such file or directory` after upgrading to a newer Go.

**Root cause:** The glue relocated from `misc/wasm/` to `lib/wasm/` in newer Go. The script hard-codes the old path.

**Fix:** use the current path, with a fallback for older toolchains:

```bash
SRC="$(go env GOROOT)/lib/wasm/wasm_exec.js"
[ -f "$SRC" ] || SRC="$(go env GOROOT)/misc/wasm/wasm_exec.js"
cp "$SRC" .
```

---

## Bug 8 — Wrong MIME breaks streaming instantiation

```js
const go = new Go();
WebAssembly.instantiateStreaming(fetch("main.wasm"), go.importObject)
  .then(r => go.run(r.instance));
```

```
TypeError: WebAssembly.instantiateStreaming(): Response has unsupported
MIME type 'text/plain' expected 'application/wasm'
```

**Symptom:** The page fails to start; the console shows a MIME-type error.

**Root cause:** `instantiateStreaming` requires the server to send `Content-Type: application/wasm`. The static server (or CDN/object store) is sending `text/plain`.

**Fix:** configure the server to send `application/wasm` (Go's `http.FileServer` does this), or use the buffered fallback that does not require the MIME type:

```js
fetch("main.wasm").then(r => r.arrayBuffer())
  .then(b => WebAssembly.instantiate(b, go.importObject))
  .then(r => go.run(r.instance));
```

---

## Bug 9 — Glue loaded after the bootstrap

```html
<script>
  const go = new Go();  // ReferenceError: Go is not defined
  WebAssembly.instantiateStreaming(fetch("main.wasm"), go.importObject)
    .then(r => go.run(r.instance));
</script>
<script src="wasm_exec.js"></script>
```

**Symptom:** `ReferenceError: Go is not defined`.

**Root cause:** `wasm_exec.js` defines the global `Go` class, but it is loaded *after* the script that calls `new Go()`.

**Fix:** load the glue first:

```html
<script src="wasm_exec.js"></script>
<script>
  const go = new Go();
  WebAssembly.instantiateStreaming(fetch("main.wasm"), go.importObject)
    .then(r => go.run(r.instance));
</script>
```

---

## Bug 10 — Calling a released `js.Func`

```go
cb := js.FuncOf(func(js.Value, []js.Value) any { return nil })
el.Call("addEventListener", "click", cb)
cb.Release() // released immediately, but the listener is still attached
```

**Symptom:** `panic: syscall/js: call on released Func` the first time the element is clicked.

**Root cause:** `Release()` frees the table entry, but the listener is still registered. When JS invokes the now-released function, there is no closure to dispatch to.

**Fix:** for a long-lived listener, do not release it; for a one-shot, release only after the final invocation:

```go
cb := js.FuncOf(...)
el.Call("addEventListener", "click", cb) // session-long: never released
// (or, for a one-shot, removeEventListener + Release after it fires)
```

---

## Bug 11 — Re-fetching `document` in a hot path

```go
input.Call("addEventListener", "input", js.FuncOf(func(this js.Value, _ []js.Value) any {
    out := js.Global().Get("document").Call("getElementById", "out") // every keystroke
    out.Set("innerText", this.Get("value").String())
    return nil
}))
```

**Symptom:** Typing feels sluggish; the Performance panel shows boundary-crossing overhead on every keystroke.

**Root cause:** `js.Global().Get("document").Call("getElementById", ...)` crosses the boundary multiple times on *every* input event, re-resolving an element that never changes.

**Fix:** cache the handle once, outside the handler:

```go
out := js.Global().Get("document").Call("getElementById", "out")
input.Call("addEventListener", "input", js.FuncOf(func(this js.Value, _ []js.Value) any {
    out.Set("innerText", this.Get("value").String())
    return nil
}))
```

---

## Bug 12 — Per-element DOM writes in a loop

```go
for i, row := range rows {
    for j, cell := range row {
        table.Call("rows").Index(i).Call("cells").Index(j).Set("innerText", cell)
    }
}
```

**Symptom:** Rendering a large table takes seconds and janks the page.

**Root cause:** Each cell update is several boundary crossings; a large table is tens of thousands of crossings on the single thread.

**Fix:** build the HTML in Go and cross once:

```go
var b strings.Builder
renderTableHTML(&b, rows)
table.Set("innerHTML", b.String()) // one crossing for the whole table
```

---

## Bug 13 — Passing a `[]byte` directly to JS

```go
data := []byte{1, 2, 3}
js.Global().Get("myFunc").Invoke(data) // panic
```

**Symptom:** `panic: ValueOf: invalid value` (a `js.ValueError`).

**Root cause:** `js.ValueOf` (called implicitly by `Invoke`) does not accept `[]byte`. There is no automatic byte-slice conversion.

**Fix:** copy into a `Uint8Array`:

```go
u8 := js.Global().Get("Uint8Array").New(len(data))
js.CopyBytesToJS(u8, data)
js.Global().Get("myFunc").Invoke(u8)
```

---

## Bug 14 — CPU-bound goroutine expected to parallelize

```go
btn.Call("addEventListener", "click", js.FuncOf(func(js.Value, []js.Value) any {
    go heavyCompute() // "run it in the background so the page stays responsive"
    return nil
}))
```

**Symptom:** The page still freezes while `heavyCompute` runs; the goroutine did not help.

**Root cause:** Go on wasm has one P and one thread. Goroutines are concurrent, not parallel. A CPU-bound goroutine that never blocks monopolises the single thread exactly like inline code would — it never yields to the event loop.

**Fix:** chunk the work and yield via `requestAnimationFrame`, or move the computation to a Web Worker (a separate wasm instance) for true parallelism. A goroutine alone is not an escape from the single thread.

---

## Bug 15 — Panic in a callback kills the whole app

```go
js.Global().Set("process", js.FuncOf(func(_ js.Value, args []js.Value) any {
    cfg := args[0].Get("limit").Int() // panics if `limit` is undefined
    return doWork(cfg)
}))
```

**Symptom:** A malformed input from JS makes the *entire* page's Go side stop working — every other callback dies too, not just this one.

**Root cause:** A panic that unwinds out of a `js.FuncOf` callback into the JS-invoked wrapper takes down the whole wasm instance, not just a goroutine.

**Fix:** recover at the callback boundary and return an error as data:

```go
js.Global().Set("process", js.FuncOf(func(this js.Value, args []js.Value) any {
    defer func() {
        if r := recover(); r != nil {
            js.Global().Get("console").Call("error", fmt.Sprintf("process failed: %v", r))
        }
    }()
    v := args[0].Get("limit")
    if v.Type() != js.TypeNumber { return map[string]any{"error": "limit required"} }
    return doWork(v.Int())
}))
```

---

## Bug 16 — Reading an optional property without a type guard

```go
count := el.Get("dataset").Get("count").Int() // panic when data-count is absent
```

**Symptom:** `panic: syscall/js: call of Value.Int on undefined` on elements without the attribute.

**Root cause:** A missing `dataset` property reads as `undefined`; `.Int()` panics on it.

**Fix:** guard with `Type()` (or `Truthy()` / `IsUndefined()`):

```go
v := el.Get("dataset").Get("count")
count := 0
if v.Type() == js.TypeString {
    count, _ = strconv.Atoi(v.String()) // dataset values are strings
}
```

---

## Bug 17 — Opened via `file://`

```
$ open index.html   # double-click in the file manager
```

```
Fetch API cannot load file:///.../main.wasm. URL scheme "file" is not supported.
```

**Symptom:** The page loads but the wasm never instantiates; the console shows a `file://` fetch error.

**Root cause:** Browsers refuse to `fetch`/instantiate wasm from the `file://` scheme, and there is no `application/wasm` MIME over `file://` either.

**Fix:** serve over HTTP:

```bash
$ python3 -m http.server 8080   # then open http://localhost:8080
```

---

## Bug 18 — Assuming `os.ReadFile` works

```go
data, err := os.ReadFile("/etc/config.json") // err is non-nil on wasm
if err != nil { log.Fatal(err) }
```

**Symptom:** The read always fails; `log.Fatal` exits the program (tearing down the instance).

**Root cause:** `GOOS=js` has no real file system. `os.ReadFile` against a real path cannot succeed — JavaScript is the OS, and the browser provides no disk.

**Fix:** fetch the resource through the network (which *is* wired up) instead of the file system:

```go
resp, err := http.Get("/config.json") // wired to fetch on wasm
// ... read resp.Body ...
```

For user-selected files, use the browser File API via `syscall/js`. The non-browser wasm target with a virtual FS is WASI (`GOOS=wasip1`).

---

## Bug 19 — Cross-origin fetch failing silently

```go
go func() {
    resp, err := http.Get("https://api.other-domain.com/data")
    if err != nil { return } // error swallowed
    _ = resp
}()
```

**Symptom:** The request never returns useful data; nothing visible happens. DevTools shows a CORS error.

**Root cause:** Go's `http.Get` on wasm goes through the browser's `fetch`, so the same-origin and CORS rules apply exactly as they do for JS. A cross-origin request without proper CORS headers fails, and the error is being swallowed.

**Fix:** handle the error, and ensure the target sends CORS headers (or proxy through your own origin):

```go
resp, err := http.Get("https://api.other-domain.com/data")
if err != nil {
    js.Global().Get("console").Call("error", err.Error()) // surface it
    return
}
```

---

## Bug 20 — Caching `main.wasm` by a stable filename

```html
<script>
  WebAssembly.instantiateStreaming(fetch("main.wasm"), go.importObject) // same name every release
</script>
```

```
# server sends: Cache-Control: max-age=31536000
```

**Symptom:** Users keep running an old build after a deploy; the new code never reaches them until they hard-refresh.

**Root cause:** The `.wasm` is served with a long cache lifetime under a stable filename. The browser keeps the cached old bytes because the URL did not change.

**Fix:** content-hash the filename so a new build is a new URL, and keep the long immutable cache:

```html
<script>
  WebAssembly.instantiateStreaming(fetch("main.a1b2c3.wasm"), go.importObject)
</script>
```

The build emits `main.<hash>.wasm` and rewrites the reference; cache-busting is automatic per release.

---

## Bug 21 — `Truthy()` confused with `Bool()`

```go
if el.Get("checked").Bool() { // panics if `checked` is undefined/absent
    submit()
}
```

**Symptom:** `panic: syscall/js: call of Value.Bool on undefined` for elements where the property is not a boolean.

**Root cause:** `Bool()` panics on a non-boolean `js.Value`. The safe presence/truthiness test is `Truthy()`, which mirrors JS `!!value` and never panics.

**Fix:**

```go
if el.Get("checked").Truthy() {
    submit()
}
```

---

## Bug 22 — Leaking listeners on component unmount

```go
func (c *Component) mount() {
    c.cb = js.FuncOf(c.onClick)
    c.el.Call("addEventListener", "click", c.cb)
}
func (c *Component) unmount() {
    c.el.Call("remove") // removes the DOM node, but the callback table entry stays
}
```

**Symptom:** In an SPA that mounts/unmounts components repeatedly, heap and the `js.Func` table grow without bound.

**Root cause:** Removing the DOM element does not free the Go `js.Func` registered for it. The closure stays in the glue's table forever.

**Fix:** detach the listener and release the callback on unmount:

```go
func (c *Component) unmount() {
    c.el.Call("removeEventListener", "click", c.cb)
    c.cb.Release()
    c.el.Call("remove")
}
```

---

## Summary

Browser Go-wasm bugs cluster into a small number of families:

1. **Lifecycle.** The instance lives only while `main` runs. Park it with `select{}` or a channel receive — never let `main` return (Bug 1), never busy-loop instead of parking (Bug 4).
2. **`js.Func` ownership.** Callbacks are held in a glue-owned table invisible to Go's GC. Release ephemeral ones after their last call, detach listeners on unmount, and never call a released `Func` (Bugs 2, 10, 22).
3. **The single thread.** Goroutines are concurrent, not parallel. Do not block the event-loop task awaiting a Promise (Bug 3); do not expect a CPU-bound goroutine to parallelize (Bug 14); chunk or use a Web Worker.
4. **Type discipline at the boundary.** Conversions panic on mismatch — input values are strings (Bug 5), optional reads can be `undefined` (Bugs 16, 21), `[]byte` needs `CopyBytes*` (Bug 13). Guard with `Type()`/`Truthy()`.
5. **Panics escape into the instance.** An unrecovered panic in a callback kills the whole module — recover at the boundary (Bug 15).
6. **The host contract.** Match the glue to the toolchain (Bugs 6, 7), serve `application/wasm` over HTTP not `file://` (Bugs 8, 17), load the glue before the bootstrap (Bug 9), content-hash for caching (Bug 20).
7. **No kernel.** No file system or sockets (Bug 18); the HTTP client is `fetch`-backed and bound by CORS (Bug 19); and per-element DOM chatter is the boundary-cost trap (Bugs 11, 12).

Internalise those seven families and the rest of browser Go-wasm becomes mechanical.
