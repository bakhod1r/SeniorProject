# GOOS=js/wasm in the Browser — Hands-on Tasks

> Practical exercises from easy to hard. Each task says what to build, what success looks like, and a hint or expected outcome. Solutions are sketched at the end. Every task assumes you serve over HTTP (never `file://`) with the `application/wasm` MIME type, and copy `wasm_exec.js` from `$(go env GOROOT)/lib/wasm/`.

---

## Easy

### Task 1 — Build and boot a hello-world

Create a module, write a `main.go` that `fmt.Println`s a greeting, build it for wasm, copy the glue, write the HTML bootstrap, and serve the folder.

Success:
- `GOOS=js GOARCH=wasm go build -o main.wasm` produces `main.wasm`.
- The page loads and the greeting appears in the browser console (DevTools).

**Goal.** Get the full build-glue-serve loop working end to end.

---

### Task 2 — Write to the DOM from Go

Extend Task 1 so Go creates an `<h1>` and appends it to the body using `js.Global().Get("document")`, `Call("createElement", ...)`, `Set("innerText", ...)`, and `Call("appendChild", ...)`. End `main` with `select{}`.

Success: the heading is rendered by Go, visible on the page.

**Goal.** Use `Get`/`Set`/`Call` to manipulate the DOM and confirm `select{}` keeps the instance alive.

---

### Task 3 — A counting button

Add a `<button>` and a `<p>`. Wrap a Go handler with `js.FuncOf`, register it with `addEventListener("click", ...)`, and update the paragraph with a click count. Confirm that removing `select{}` breaks the button after the first interaction.

Success: clicking increments the displayed count; removing `select{}` makes later clicks do nothing.

**Goal.** Wire a Go callback into a DOM event and witness the lifecycle trap firsthand.

---

### Task 4 — Read an input value

Add a text `<input>`. On its `input` event, read `this.Get("value").String()` and echo it into a `<p>`. Try calling `.Int()` on the value and observe the panic; then parse with `strconv` instead.

Success: typing updates the echo live; you can explain why `.Int()` panicked.

**Goal.** Read form state and learn that input values are strings, and that wrong-type conversions panic.

---

### Task 5 — Print to the console as a debug tool

From Go, call `js.Global().Get("console").Call("log", "from Go", 42, true)`. Confirm it appears in DevTools. Note that `fmt.Println` also reaches the console via the runtime.

Success: structured values print to the browser console.

**Goal.** Establish your primary wasm debugging channel.

---

## Medium

### Task 6 — Serve with the correct MIME and prove it matters

Serve with a tiny Go file server (which sets `application/wasm`), then deliberately serve the `.wasm` with `text/plain` (e.g. a misconfigured server) and observe `instantiateStreaming` failing with a MIME warning. Switch to the buffered fallback (`arrayBuffer()` → `WebAssembly.instantiate`) and confirm it works regardless of MIME.

Success: you can reproduce the MIME failure and fix it two ways.

**Goal.** Understand the streaming MIME requirement and the buffered fallback.

---

### Task 7 — Release a one-shot callback

Use `setTimeout` to fire a Go callback once. Wrap it with `FuncOf` and `Release()` it inside the callback (via a captured variable). Then write the buggy version that creates a new `FuncOf` in a loop without releasing, and watch memory climb in the Memory panel.

Success: the one-shot fires and frees itself; the leaking version shows monotonic heap growth.

**Goal.** Internalise the `Release()` discipline and see a leak with your own eyes.

---

### Task 8 — Await a `fetch` from a goroutine

Implement the `await(promise)` helper (bridge `then`/`catch` to channels). Use it from a `go func()` to `fetch` a small JSON endpoint, read `resp.Call("text")`, and render it. Then move the `await` call directly into a click handler (no goroutine) and observe the deadlock.

Success: the goroutine version fetches and renders; the synchronous version hangs the handler.

**Goal.** Bridge Promises correctly and reproduce the classic event-loop deadlock.

---

### Task 9 — Pass bytes both ways

From Go, build a `Uint8Array` with `New(n)`, fill it with `CopyBytesToJS`, and pass it to a JS function that logs its length. Then receive a `Uint8Array` from JS (e.g. `new TextEncoder().encode("hi")` set on a global) and read it into a Go `[]byte` with `CopyBytesToGo`.

Success: bytes round-trip in both directions with bulk copies.

**Goal.** Use the only correct mechanism for binary data across the boundary.

---

### Task 10 — Expose a Go API namespace to JS

Register `js.Global().Set("goApp", obj)` with two methods: `add(a, b)` returning a number, and `upper(s)` returning a string. Call them from the JS console: `goApp.add(2, 3)`, `goApp.upper("hi")`.

Success: JS can call your Go functions by name and gets correct return values.

**Goal.** Design a coarse exported API surface on a single namespace.

---

### Task 11 — Keep the page responsive during a long loop

Write a Go function that sums to a large N synchronously and observe the tab freeze. Then rewrite it to process in chunks, yielding between chunks with `requestAnimationFrame` (via a `FuncOf`), updating a progress bar. Confirm the page stays interactive.

Success: the chunked version shows progress and the page responds to clicks throughout.

**Goal.** Respect the single-thread jank budget by chunking and yielding.

---

### Task 12 — Strip and compress the binary

Build with and without `-ldflags="-s -w"`; compare `du -h main.wasm`. Then gzip the binary and compare. Serve the gzipped version with `Content-Encoding: gzip` and confirm the page still boots.

Success: you can quantify the size reduction from stripping and from compression.

**Goal.** Treat binary size as a measurable budget.

---

## Hard

### Task 13 — Return a Promise from Go to JS

Expose `goApp.delayedHash(s)` that returns a JS Promise. Construct it with `Promise.New(executor)`, do the (simulated-async) work on a goroutine, and `resolve.Invoke(result)` / `reject.Invoke(err)`. Call it from JS with `await goApp.delayedHash("x")`.

Success: JS `await`s your Go function as a normal async API.

**Goal.** Bridge Go async work into a JS-consumable Promise, releasing the executor's `FuncOf`s correctly.

---

### Task 14 — Recover panics at the callback boundary

Wrap your exported callbacks in a `safe(fn)` helper that recovers panics and reports a sanitized error to the page instead of crashing the instance. Trigger a panic (e.g. a deliberate `.Int()` on a string) and confirm the page survives and shows the error.

Success: a panic in one callback no longer kills the whole app.

**Goal.** Contain the blast radius of a callback panic.

---

### Task 15 — Clean shutdown via a channel

Replace `select{}` with `<-done`, where `done` is closed by a `window.shutdown()` callback. Before exit, `Release()` all your `js.Func`s. Confirm calling `shutdown()` from the console exits `main` cleanly and that callbacks are freed.

Success: the program exits on command with resources released.

**Goal.** Implement a graceful lifecycle with cleanup, not just an infinite park.

---

### Task 16 — A shared validator: same Go on client and server

Write a Go package `validate` with an email-rule function. Compile it once into a server binary and once into wasm. On the page, validate the field live in Go wasm; on the server, validate the same payload with the same package. Demonstrate identical results and that the server still rejects a payload the client was bypassed on.

Success: one validation source of truth runs in both places; the server remains authoritative.

**Goal.** Realise the headline use case — shared client/server logic — and prove client validation is not a security boundary.

---

### Task 17 — Build a real widget (live Markdown preview)

Compile an existing Go Markdown library to wasm. On `input` in a textarea, render the Markdown to HTML in Go and assign it to a preview `<div>` with `Set("innerHTML", ...)` once per keystroke (coarse, single crossing). Cache the DOM handles outside the handler.

Success: typing Markdown renders a live preview, with no per-element boundary chatter.

**Goal.** Ship a non-trivial widget that reuses a Go library and respects boundary cost.

---

### Task 18 — Offload compute to a Web Worker

Move a CPU-bound Go computation into a wasm instance running inside a Web Worker. The main thread posts a message; the worker computes and posts the result back; the main thread renders it without ever janking.

Success: a heavy computation runs while the main page stays at 60fps.

**Goal.** Achieve true parallelism — the only path past the single thread.

---

## Bonus / Stretch

### Task 19 — Diagnose a version-mismatch failure

Build `main.wasm` with your current Go, then swap in a `wasm_exec.js` from a different Go version (or hand-edit it). Observe the obscure runtime failure. Restore the matching glue and confirm recovery.

**Goal.** Recognise glue/binary version skew by symptom, not by guessing.

---

### Task 20 — Measure time-to-interactive

Instrument the page: log `performance.now()` at script start, after instantiation, and after `go.run` registers the API. Compare streaming vs. buffered instantiation, and compressed vs. uncompressed serving. Produce a small table.

**Goal.** Quantify the load phases and the levers that move them.

---

### Task 21 — Soak-test for leaks

Write a harness that mounts and unmounts a widget (registering and releasing its `js.Func`s) thousands of times in a loop with `requestAnimationFrame`. Snapshot the heap before and after in the Memory panel. Compare a correct version against one that forgets `Release()`.

**Goal.** Catch leaks the way production would — over time, not in a single session.

---

### Task 22 — Decide: wasm or plain JS?

Take a concrete feature (e.g. a date-range picker vs. a CSV-parsing-and-charting tool). For each, write a short recommendation: does the reused-Go-logic value outweigh the megabyte download and boundary cost? Justify with the size budget and the compute profile.

**Goal.** Make Go wasm a deliberate choice, not a reflex.

---

## Solutions (sketched)

### Solution 1
```bash
mkdir hello-wasm && cd hello-wasm
go mod init example.com/hello
printf 'package main\nimport "fmt"\nfunc main(){ fmt.Println("hi from Go wasm") }\n' > main.go
GOOS=js GOARCH=wasm go build -o main.wasm
cp "$(go env GOROOT)/lib/wasm/wasm_exec.js" .
# index.html loads wasm_exec.js, new Go(), instantiateStreaming, go.run
python3 -m http.server 8080
```

### Solution 2
`doc := js.Global().Get("document")`; `h := doc.Call("createElement","h1")`; `h.Set("innerText","Rendered by Go")`; `doc.Get("body").Call("appendChild", h)`; then `select{}`.

### Solution 3
`FuncOf` handler increments a captured `clicks` and sets the paragraph. Without `select{}`, `main` returns, the instance exits, and the listener is dead after setup.

### Solution 4
Read `this.Get("value").String()`. `.Int()` panics because the DOM value is a string; `strconv.Atoi` is the correct parse.

### Solution 5
`js.Global().Get("console").Call("log", ...)`. `fmt.Println` reaches the same console via the runtime's `wasmWrite`.

### Solution 6
`http.FileServer` sets `application/wasm`. A `text/plain` server makes `instantiateStreaming` warn and refuse; `fetch(...).then(r=>r.arrayBuffer()).then(b=>WebAssembly.instantiate(b, go.importObject))` works regardless.

### Solution 7
```go
var cb js.Func
cb = js.FuncOf(func(js.Value, []js.Value) any { defer cb.Release(); /*...*/; return nil })
js.Global().Call("setTimeout", cb, 100)
```
The leaking version creates a `FuncOf` per iteration without `Release()`; the heap grows monotonically.

### Solution 8
The `await` helper bridges `then`/`catch` to buffered channels and `select`s. Run it inside `go func(){...}()`. Synchronously inside a handler it deadlocks: the resolver needs the handler to yield first.

### Solution 9
```go
u8 := js.Global().Get("Uint8Array").New(len(data)); js.CopyBytesToJS(u8, data)
// receive:
n := u8.Get("length").Int(); buf := make([]byte, n); js.CopyBytesToGo(buf, u8)
```

### Solution 10
```go
obj := js.Global().Get("Object").New()
obj.Set("add", js.FuncOf(func(_ js.Value, a []js.Value) any { return a[0].Int()+a[1].Int() }))
obj.Set("upper", js.FuncOf(func(_ js.Value, a []js.Value) any { return strings.ToUpper(a[0].String()) }))
js.Global().Set("goApp", obj)
```
These handlers are session-long; do not release them.

### Solution 11
The synchronous sum starves the loop. The chunked version processes `perFrame` items, updates the progress bar, then `requestAnimationFrame(step)`; `step.Release()` when done.

### Solution 12
`-ldflags="-s -w"` strips symbols/DWARF (smaller, no readable traces). `gzip -9 main.wasm` plus `Content-Encoding: gzip` cuts wire size ~60–70%; the browser decompresses transparently.

### Solution 13
```go
func delayedHash(_ js.Value, args []js.Value) any {
    exec := js.FuncOf(func(_ js.Value, p []js.Value) any {
        resolve, reject := p[0], p[1]
        go func() {
            res, err := work(args[0].String())
            if err != nil { reject.Invoke(err.Error()); return }
            resolve.Invoke(res)
        }()
        return nil
    })
    // release exec after the executor runs is unsafe (goroutine outlives it);
    // simplest: leave exec for GC via a Release inside the goroutine after resolve/reject.
    return js.Global().Get("Promise").New(exec)
}
```

### Solution 14
```go
func safe(fn func(js.Value, []js.Value) any) js.Func {
    return js.FuncOf(func(this js.Value, args []js.Value) any {
        defer func(){ if r:=recover(); r!=nil { showErr(fmt.Sprintf("error: %v", r)) } }()
        return fn(this, args)
    })
}
```
The instance survives a panicking input.

### Solution 15
`done := make(chan struct{})`; `shutdown` callback `close(done)`; `<-done` in `main`; release all `js.Func`s before returning.

### Solution 16
Shared `validate` package imported by both the server `main` (native build) and the wasm `main`. Identical rule, identical result. Bypassing the client (calling the API directly) still hits the server check — proving the client copy is UX only.

### Solution 17
Cache `textarea` and `preview` handles once. Handler: `html := md.Render(textarea.Get("value").String())`; `preview.Set("innerHTML", html)`. One crossing per keystroke for the whole document — coarse, not per-node.

### Solution 18
Worker script instantiates its own `main.wasm`; `onmessage` runs the Go compute and `postMessage`s the result; the main thread renders on its `onmessage`. Two instances, message-passing boundary, true parallelism.

### Solution 19
A mismatched `wasm_exec.js` fails obscurely (the ABI differs). Re-copy from `$(go env GOROOT)/lib/wasm/wasm_exec.js` of the building toolchain.

### Solution 20
Log `performance.now()` at three points. Streaming + compressed wins on time-to-interactive; buffered + uncompressed is the slowest. Tabulate the deltas.

### Solution 21
Mount/unmount loop with `requestAnimationFrame`. Correct version: stable heap. Forgetting `Release()`: monotonic growth, eventual crash.

### Solution 22
Date picker: light DOM glue, no Go to reuse → plain JS. CSV-parse-and-chart: substantial reusable Go parsing/compute, behind a login where load size is tolerable → Go wasm is defensible.

---

## Checkpoints

After the easy tasks: you can build, glue, serve, manipulate the DOM, wire a callback, and read inputs.
After the medium tasks: you can fix MIME issues, release one-shots, await Promises without deadlock, move bytes, expose an API, chunk long work, and measure size.
After the hard tasks: you can return Promises to JS, contain callback panics, shut down cleanly, share a validator across client/server, ship a real widget, and offload to a Web Worker.
After the bonus tasks: you can diagnose version skew, measure time-to-interactive, soak-test for leaks, and defend (or refuse) the decision to use Go wasm per feature.
