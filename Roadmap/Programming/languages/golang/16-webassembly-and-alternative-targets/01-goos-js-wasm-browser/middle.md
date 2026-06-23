# GOOS=js/wasm in the Browser — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [The `syscall/js` Type System: `js.Value` and Its Methods](#the-syscalljs-type-system-jsvalue-and-its-methods)
3. [Crossing the Boundary: `ValueOf`, `Get/Set`, `Call/Invoke/New`](#crossing-the-boundary-valueof-getset-callinvokenew)
4. [Converting JS Values to Go Types](#converting-js-values-to-go-types)
5. [`js.Func`, `FuncOf`, and the Mandatory `Release()`](#jsfunc-funcof-and-the-mandatory-release)
6. [The Execution Model: One Thread, One Event Loop](#the-execution-model-one-thread-one-event-loop)
7. [Goroutines on wasm and Why `select{}` Is Required](#goroutines-on-wasm-and-why-select-is-required)
8. [Awaiting a JS Promise from Go](#awaiting-a-js-promise-from-go)
9. [Passing Bytes Efficiently: `CopyBytesToGo` / `CopyBytesToJS`](#passing-bytes-efficiently-copybytestogo--copybytestojs)
10. [Reading Inputs and Handling Events](#reading-inputs-and-handling-events)
11. [The Non-Streaming Instantiation Fallback](#the-non-streaming-instantiation-fallback)
12. [What Does Not Exist on `GOOS=js`](#what-does-not-exist-on-goosjs)
13. [Common Errors and Their Real Causes](#common-errors-and-their-real-causes)
14. [Best Practices for Real Widgets](#best-practices-for-real-widgets)
15. [Pitfalls You Will Meet](#pitfalls-you-will-meet)
16. [Self-Assessment](#self-assessment)
17. [Summary](#summary)

---

## Introduction

You already know the mechanics from [junior.md](junior.md): two environment variables produce `main.wasm`, the `wasm_exec.js` glue boots it, and `select{}` keeps the instance alive. The middle-level question is *how the bridge actually works* — what a `js.Value` is, what each method on it costs, how you convert across the boundary safely, and how the single-threaded event loop shapes every design decision you make.

This file is about writing a *real* widget, not a hello-world. That means handling many callbacks without leaking them, awaiting asynchronous JS APIs like `fetch`, moving binary data across the boundary without per-byte overhead, and understanding why a misplaced blocking call deadlocks the whole page.

After reading this you will:
- Know what `js.Value` represents and which methods read, write, or call across the boundary
- Convert JS values to Go types (`Int`, `Float`, `String`, `Bool`, `Truthy`) and know when each panics
- Wrap Go callbacks with `js.FuncOf` and release them with `Func.Release()` to avoid leaks
- Await a JS `Promise` from a goroutine using a channel
- Move `[]byte` across the boundary with `CopyBytesToGo` / `CopyBytesToJS` instead of element-by-element
- Diagnose deadlocks and "released value" panics from first principles

---

## The `syscall/js` Type System: `js.Value` and Its Methods

`syscall/js` exposes exactly one important type: `js.Value`. It is an opaque handle to a JavaScript value living on the JS side of the boundary. It is *not* a copy. When you hold a `js.Value` for `document`, the bytes of the DOM tree are not in Go memory; you hold a reference the runtime can resolve back to the real object.

A `js.Value` can refer to any JS value: an object, a function, a number, a string, `null`, `undefined`, a typed array. You discover which with `Type()`:

```go
v := js.Global().Get("document")
switch v.Type() {
case js.TypeObject:   // ...
case js.TypeFunction: // ...
case js.TypeNull, js.TypeUndefined:
    // missing element, absent property
}
```

The methods on `js.Value` fall into three groups:

| Group | Methods | Crosses boundary? |
|-------|---------|-------------------|
| **Read** | `Get`, `Index`, `Length`, `Type` | Yes (each call) |
| **Write** | `Set`, `SetIndex` | Yes |
| **Call** | `Call`, `Invoke`, `New` | Yes |
| **Convert** | `Int`, `Float`, `String`, `Bool`, `Truthy`, `IsNull`, `IsUndefined`, `IsNaN` | Reads a cached representation; cheap |

The mental model that matters: **every `Get`/`Set`/`Call`/`Index` is a round trip across the Go↔JS boundary.** They are not free. A loop that does a thousand `Get`s is a thousand boundary crossings. This single fact drives most of the performance advice in this topic and in [04-wasm-interop-and-performance](../04-wasm-interop-and-performance/).

---

## Crossing the Boundary: `ValueOf`, `Get/Set`, `Call/Invoke/New`

### `js.ValueOf` — Go → JS

`js.ValueOf(x)` wraps a Go value into a `js.Value`. It accepts `nil`, `bool`, integers and floats, `string`, `[]interface{}` (becomes a JS array), `map[string]interface{}` (becomes a JS object), and an existing `js.Value` (passed through). Anything else panics.

```go
arr := js.ValueOf([]interface{}{1, 2, 3})            // a JS array
obj := js.ValueOf(map[string]interface{}{"x": 1.0})  // a JS object {x: 1}
```

`Set`, `Call`, `New`, and `Invoke` call `ValueOf` on every argument implicitly, so you can pass Go strings and numbers directly — but only the types `ValueOf` accepts. A `[]byte` is *not* one of them (see [CopyBytes](#passing-bytes-efficiently-copybytestogo--copybytestojs)).

### `Get` / `Set` — properties

```go
el.Get("value")            // read a property → js.Value
el.Set("disabled", true)   // write a property
```

### `Call` / `Invoke` / `New` — invocation

```go
doc.Call("getElementById", "out")       // method call on an object
fn.Invoke(arg1, arg2)                    // call a function value directly
js.Global().Get("Date").New()            // `new Date()` — a constructor call
```

- `Call(name, args...)` invokes a *method* named `name` on the receiver.
- `Invoke(args...)` calls the receiver itself as a function (use when you already hold the function value).
- `New(args...)` is the `new` operator — constructs an object from a constructor.

### `Index` / `SetIndex` / `Length` — arrays and array-likes

```go
list := doc.Call("querySelectorAll", "li")
n := list.Length()
for i := 0; i < n; i++ {
    item := list.Index(i)   // one crossing per element
}
```

---

## Converting JS Values to Go Types

A `js.Value` must be converted before you can use it as a Go scalar. The conversion methods read the value's already-fetched representation, so they are cheap — but they *panic on type mismatch*, which is the single most common runtime crash in Go wasm code.

| Method | Returns | Panics if the value is not… |
|--------|---------|------------------------------|
| `Int()` | `int` | a number |
| `Float()` | `float64` | a number |
| `String()` | `string` | a string |
| `Bool()` | `bool` | a boolean |
| `Truthy()` | `bool` | (never panics — JS truthiness) |

The lesson: `Int()` on a value that is `undefined` panics; `Truthy()` never does. When you read an optional property, guard it:

```go
v := el.Get("dataset").Get("count")
if v.Type() == js.TypeString {
    n, _ := strconv.Atoi(v.String())
    _ = n
}
```

`Truthy()` is the safe way to test presence, mirroring JavaScript's own `if (x)`:

```go
if el.Get("checked").Truthy() {
    // checkbox is checked
}
```

Note that `el.Get("value")` on a text input always returns a *string* (the DOM stores input values as strings), so parse with `strconv` — do not call `.Int()` on it and expect it to coerce.

---

## `js.Func`, `FuncOf`, and the Mandatory `Release()`

A Go function cannot be handed to JavaScript directly. You wrap it with `js.FuncOf`, which returns a `js.Func` — a `js.Value` that JS can invoke and that, when invoked, runs your Go closure:

```go
cb := js.FuncOf(func(this js.Value, args []js.Value) any {
    // this  = the JS `this` at call time
    // args  = the arguments JS passed
    return nil // returned value is converted via ValueOf and handed back to JS
})
el.Call("addEventListener", "click", cb)
```

### The leak

`FuncOf` registers the closure in a global table inside `wasm_exec.js` so the JS side can find it by an integer id. **That registration is never garbage collected.** Every `FuncOf` you create lives forever unless you explicitly call:

```go
cb.Release()
```

`Release()` removes the entry from the table. If you create a `js.Func` per event, per render, or per request and never release it, you leak monotonically — the table grows without bound and the page's memory climbs until it crashes.

### The two patterns

**Long-lived callback** (an event listener that lives for the whole session): create it once, never release it, let it die when the page unloads. This is the common case and the leak does not matter because the count is fixed.

**Short-lived callback** (a one-shot Promise resolver, a callback you attach and detach): release it as soon as it has fired.

```go
var cb js.Func
cb = js.FuncOf(func(this js.Value, args []js.Value) any {
    defer cb.Release() // fire once, then free the table slot
    // handle the single callback
    return nil
})
js.Global().Call("setTimeout", cb, 100)
```

The trap: releasing a `js.Func` and then letting JS call it again is a panic. Release only when you are certain the function will not be invoked again.

---

## The Execution Model: One Thread, One Event Loop

Go on `GOOS=js` runs on **one thread**. There is no parallelism. The Go scheduler is cooperatively multiplexed onto the browser's single JavaScript event loop. This has three consequences you must internalise:

1. **Your Go code and the page share one thread.** While Go is running a synchronous computation, the browser cannot paint, cannot process clicks, cannot fire timers. A long Go loop *freezes the tab*.
2. **Callbacks run as event-loop tasks.** When a click fires, the browser schedules your `js.FuncOf` closure as a task. It runs to completion (or to a blocking point) before the loop moves on.
3. **Go's blocking primitives yield to the loop.** When a goroutine blocks on a channel receive, a `time.Sleep`, or `select{}`, the Go runtime parks it and *returns control to the JavaScript event loop*. This is why `select{}` does not freeze the page — it parks the goroutine, and the loop keeps spinning to dispatch other callbacks.

The distinction between "parking" and "spinning" is the whole game. `select{}` and `<-ch` park (good — the loop is free). A `for {}` busy-loop spins (bad — the loop is starved and the page hangs).

---

## Goroutines on wasm and Why `select{}` Is Required

Goroutines work on wasm. `go func()` schedules a goroutine, channels synchronise them, `sync.Mutex` works. But they are **concurrent, not parallel** — only one runs at any instant, interleaved on the single thread at blocking points.

`main` returning is fatal because of how `go.run` works: when the `main` goroutine completes, the Go runtime tells the JS glue the program has exited, and `wasm_exec.js` tears the instance down. Every registered `js.Func` becomes a call into a dead instance. Hence the idiom:

```go
func main() {
    registerCallbacks()
    select {} // park main forever; the event loop keeps dispatching callbacks
}
```

An alternative to `select{}` is to block on a channel you close from a "shutdown" callback, giving you a clean exit path:

```go
func main() {
    done := make(chan struct{})
    js.Global().Set("shutdown", js.FuncOf(func(js.Value, []js.Value) any {
        close(done)
        return nil
    }))
    <-done // exit cleanly when JS calls window.shutdown()
}
```

Both park the main goroutine and free the event loop. The channel form is preferable when you have cleanup (releasing `js.Func`s) to run before exit.

---

## Awaiting a JS Promise from Go

The browser's async APIs (`fetch`, `crypto.subtle`, the File API) return Promises. Go has no `await`, so you bridge a Promise into a channel using its `then`/`catch` methods. The canonical helper:

```go
func await(promise js.Value) (js.Value, error) {
    resCh := make(chan js.Value, 1)
    errCh := make(chan js.Value, 1)

    onResolve := js.FuncOf(func(this js.Value, args []js.Value) any {
        resCh <- args[0]
        return nil
    })
    defer onResolve.Release()

    onReject := js.FuncOf(func(this js.Value, args []js.Value) any {
        errCh <- args[0]
        return nil
    })
    defer onReject.Release()

    promise.Call("then", onResolve).Call("catch", onReject)

    select {
    case res := <-resCh:
        return res, nil
    case e := <-errCh:
        return js.Value{}, fmt.Errorf("promise rejected: %s", e.Call("toString").String())
    }
}
```

Use it from a goroutine — never from `main` or directly inside an event callback in a way that blocks the loop:

```go
go func() {
    resp, err := await(js.Global().Call("fetch", "/api/data"))
    if err != nil {
        return
    }
    text, _ := await(resp.Call("text"))
    js.Global().Get("document").
        Call("getElementById", "out").
        Set("innerText", text.String())
}()
```

The critical rule: **`await` must run on a goroutine, not on the event-loop task that is currently executing.** If you call `await` synchronously from inside a click handler, the handler blocks waiting for `resCh`, but the resolve callback that would fill `resCh` can only run *after* the handler returns control to the event loop — which it never does. That is a deadlock (see [Pitfalls](#pitfalls-you-will-meet)).

---

## Passing Bytes Efficiently: `CopyBytesToGo` / `CopyBytesToJS`

A Go `[]byte` is not a type `js.ValueOf` accepts, and copying bytes one at a time with `SetIndex` would be one boundary crossing per byte — catastrophic for anything but tiny buffers. `syscall/js` provides two bulk-copy functions that move the whole buffer in a single operation:

```go
// JS Uint8Array → Go []byte
func CopyBytesToGo(dst []byte, src js.Value) int

// Go []byte → JS Uint8Array
func CopyBytesToJS(dst js.Value, src []byte) int
```

Both return the number of bytes copied (the min of the two lengths). The JS side **must be a `Uint8Array`** (or `Uint8ClampedArray`) — not a plain array, not an `ArrayBuffer`. Allocate one with `New`:

```go
// Send Go bytes to JS
data := []byte("hello")
u8 := js.Global().Get("Uint8Array").New(len(data))
js.CopyBytesToJS(u8, data)
// now u8 can be passed to a JS API, e.g. WebSocket.send, Blob, fetch body

// Receive bytes from JS (e.g. from a file read)
func readBytes(u8 js.Value) []byte {
    n := u8.Get("length").Int()
    buf := make([]byte, n)
    js.CopyBytesToGo(buf, u8)
    return buf
}
```

This is the only correct way to move binary payloads — image data, file contents, WebSocket frames — across the boundary. Anything else is too slow to use.

---

## Reading Inputs and Handling Events

A realistic widget reads form state and reacts to events. The pieces compose like this:

```go
func main() {
    doc := js.Global().Get("document")
    input := doc.Call("getElementById", "name")
    out := doc.Call("getElementById", "greeting")

    handler := js.FuncOf(func(this js.Value, args []js.Value) any {
        // `this` is the input element; read its current value
        name := this.Get("value").String()
        out.Set("innerText", "Hello, "+name)

        // prevent default form behaviour if this is a submit
        if len(args) > 0 {
            args[0].Call("preventDefault")
        }
        return nil
    })
    // handler is long-lived; do not Release it

    input.Call("addEventListener", "input", handler)
    select {}
}
```

Key points: the event object arrives as `args[0]`; `this` is the element the listener is bound to; `preventDefault` and `stopPropagation` are method calls on `args[0]`. Cache `doc`, `input`, and `out` once outside the handler — re-fetching them on every keystroke is wasteful boundary traffic.

---

## The Non-Streaming Instantiation Fallback

`WebAssembly.instantiateStreaming` requires the server to send `Content-Type: application/wasm`. When you cannot control the server's MIME type (a CDN, an object store, a quirky dev server), fall back to fetching the bytes first and compiling from an `ArrayBuffer`:

```js
const go = new Go();
fetch("main.wasm")
  .then(r => r.arrayBuffer())
  .then(bytes => WebAssembly.instantiate(bytes, go.importObject))
  .then(result => go.run(result.instance))
  .catch(console.error);
```

This path does not require the MIME type, at the cost of buffering the whole module before compiling instead of streaming-compiling as it downloads. For a multi-megabyte Go binary the difference is measurable but not fatal; prefer streaming when you can set the header.

---

## What Does Not Exist on `GOOS=js`

`GOOS=js` means JavaScript *is* the operating system, and the browser provides no real OS facilities. The following compile but fail at runtime or are stubbed:

- **File system.** `os.Open`, `os.ReadFile` against real paths do not work — there is no disk. Use the browser File API or `fetch` through `syscall/js`. (The non-browser story, with a virtual FS, is [02-wasi-and-wasip1](../02-wasi-and-wasip1/).)
- **Network sockets.** `net.Dial` and the low-level `net` package do not work. HTTP, however, *does*: Go's `net/http` client on wasm is wired to the browser's `fetch`, so `http.Get` works (subject to CORS).
- **Threads / true parallelism.** `runtime.GOMAXPROCS` is effectively 1. No `os/exec`, no signals.
- **`time`** works (timers map to the event loop), but be aware sleeping parks a goroutine and yields the loop.

The practical rule: anything that needs the kernel must instead go through a JavaScript API via `syscall/js`. `net/http`'s client is the one big convenience the runtime provides for you.

---

## Common Errors and Their Real Causes

### `panic: syscall/js: call of Value.Int on string`

You called a typed conversion on a `js.Value` of the wrong kind — almost always `.Int()` on an input's `.value`, which is a string. Read with `.String()` and parse with `strconv`.

### The page freezes during a computation

A synchronous Go loop is running on the single thread and starving the event loop. Break the work into chunks scheduled via `setTimeout`/`requestAnimationFrame`, or move it behind a goroutine that yields. There is no second thread to offload to (without Web Workers, which the standard runtime does not use).

### A `fetch` from inside a click handler hangs

You called the blocking `await` synchronously inside the event callback. The resolve callback cannot run until the handler yields, but the handler is waiting on it. Wrap the async work in `go func() { ... }()`.

### `panic: syscall/js: call on released Func`

You `Release()`d a `js.Func` and JS invoked it afterward. Release only one-shot callbacks, and only after they have fired.

### Memory climbs steadily over time

You are creating a `js.Func` per event/render and never releasing it. Either reuse one long-lived `js.Func` or release short-lived ones.

---

## Best Practices for Real Widgets

1. **Cache `js.Value` handles** (`document`, frequently-touched elements) once; do not re-`Get` them in hot paths.
2. **Create long-lived listeners once**; release only short-lived, one-shot `js.Func`s, and only after they fire.
3. **Run async work (`await`, `fetch`) on a goroutine**, never blocking the current event-loop task.
4. **Guard typed conversions** — check `Type()` or use `Truthy()` before `.Int()`/`.String()` on optional values.
5. **Move bytes with `CopyBytesToGo`/`CopyBytesToJS`**, never element-by-element.
6. **Batch DOM writes** to minimise boundary crossings; build a string and set it once rather than appending in a loop.
7. **Recover panics inside callbacks** if a single bad input should not kill the whole instance.
8. **Exit cleanly via a channel** when you need to release resources, rather than `select{}`.

---

## Pitfalls You Will Meet

### Pitfall 1 — Deadlock awaiting a Promise on the event-loop task

The signature bug. `await(fetch(...))` called directly in a click handler blocks forever: the resolver runs only after the handler yields, but the handler is blocked. Fix: `go func(){ await(...) }()`.

### Pitfall 2 — Leaking `js.Func`

Creating a fresh `FuncOf` for every render or every event without releasing it. The internal table grows unbounded. Fix: reuse a single long-lived `js.Func`, or `Release()` one-shots.

### Pitfall 3 — Calling a released `js.Func`

Releasing too eagerly. A `setTimeout` callback you released before it fired panics when it does. Release only after the last invocation.

### Pitfall 4 — `.Int()` on `undefined`/string

Reading an optional or string-valued property and converting blindly. Fix: `Type()` guard or `Truthy()`.

### Pitfall 5 — Busy-looping instead of parking

`for {}` to "keep alive" instead of `select{}`. A busy loop starves the event loop and hangs the tab. `select{}` parks; a busy loop spins.

### Pitfall 6 — Treating `[]byte` as `ValueOf`-able

Passing a `[]byte` to `Set`/`Call` directly. `ValueOf` panics on `[]byte`. Use a `Uint8Array` plus `CopyBytesToJS`.

### Pitfall 7 — Forgetting CORS applies

Go's `http.Get` on wasm goes through `fetch`, so the browser's same-origin and CORS rules govern it exactly as they govern JS. A cross-origin request without CORS headers fails, and the error surfaces as a Go `error`.

### Pitfall 8 — Assuming goroutines give parallelism

Spawning goroutines to speed up CPU-bound work. They interleave on one thread; there is no speedup. Parallelism in the browser requires Web Workers, which the standard Go runtime does not orchestrate for you.

---

## Self-Assessment

You can move on to [senior.md](senior.md) when you can:

- [ ] Explain what a `js.Value` is and which of its methods cross the boundary
- [ ] Use `ValueOf`, `Get`/`Set`, `Call`/`Invoke`/`New`, and `Index` correctly
- [ ] Convert JS values to Go types and predict which conversions panic
- [ ] Wrap a Go callback with `FuncOf` and decide whether and when to `Release()` it
- [ ] Explain the single-threaded event-loop model and why `select{}` does not freeze the page
- [ ] Await a JS Promise from a goroutine and explain the deadlock if you do it on the event-loop task
- [ ] Move a `[]byte` across the boundary with `CopyBytesToGo`/`CopyBytesToJS`
- [ ] List what does not exist on `GOOS=js` and what `net/http` does provide
- [ ] Diagnose the "released Func", "wrong-type conversion", and "frozen tab" failures

---

## Summary

The `syscall/js` bridge is built around one type, `js.Value` — an opaque handle to a JavaScript value whose `Get`/`Set`/`Call`/`Index` methods each cross the Go↔JS boundary, and whose `Int`/`Float`/`String`/`Bool`/`Truthy` conversions read a cached representation cheaply but panic on type mismatch. Go callbacks reach JavaScript through `js.FuncOf`, which registers them in a table that is never garbage-collected, making `Func.Release()` mandatory for any callback that is not session-long.

Everything else follows from the execution model: one thread, one event loop, goroutines that are concurrent but never parallel. Blocking primitives like `select{}` and channel receives *park* the goroutine and hand control back to the loop, which is why they keep the page responsive; a busy loop *spins* and freezes the tab. Awaiting a Promise means bridging `then`/`catch` into a channel and doing so on a goroutine, never on the event-loop task that must run the resolver. Binary data crosses with `CopyBytesToGo`/`CopyBytesToJS` in one operation, never byte-by-byte. Master those — boundary cost, the release discipline, and the loop model — and you can build a responsive Go widget that talks to the DOM and the network without leaking or deadlocking.
