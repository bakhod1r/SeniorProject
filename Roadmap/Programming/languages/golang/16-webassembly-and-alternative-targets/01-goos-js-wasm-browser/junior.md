# GOOS=js/wasm in the Browser — Junior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Pros & Cons](#pros-cons)
8. [Use Cases](#use-cases)
9. [Code Examples](#code-examples)
10. [Coding Patterns](#coding-patterns)
11. [Clean Code](#clean-code)
12. [Product Use / Feature](#product-use-feature)
13. [Error Handling](#error-handling)
14. [Security Considerations](#security-considerations)
15. [Performance Tips](#performance-tips)
16. [Best Practices](#best-practices)
17. [Edge Cases & Pitfalls](#edge-cases-pitfalls)
18. [Common Mistakes](#common-mistakes)
19. [Common Misconceptions](#common-misconceptions)
20. [Tricky Points](#tricky-points)
21. [Test](#test)
22. [Tricky Questions](#tricky-questions)
23. [Cheat Sheet](#cheat-sheet)
24. [Self-Assessment Checklist](#self-assessment-checklist)
25. [Summary](#summary)
26. [What You Can Build](#what-you-can-build)
27. [Further Reading](#further-reading)
28. [Related Topics](#related-topics)
29. [Diagrams & Visual Aids](#diagrams-visual-aids)

---

## Introduction
> Focus: "How do I run Go code inside a web browser?" and "What are all these files I suddenly need?"

You already know how to build a normal Go program: `go build` produces a native binary for your operating system. WebAssembly (wasm) is a different compilation *target* — a portable bytecode that runs inside the browser's JavaScript engine, in the same sandbox as the page's JavaScript. Go can compile to it by setting two environment variables:

```bash
GOOS=js GOARCH=wasm go build -o main.wasm
```

`GOOS=js` says "the operating system is JavaScript." `GOARCH=wasm` says "the CPU architecture is WebAssembly." The output, `main.wasm`, is not a native executable you can run from a terminal. It is a module the browser loads — but it cannot load alone. A browser does not know how to start a Go program, so Go ships a small piece of JavaScript called `wasm_exec.js` that bridges the two worlds. You load that, instantiate the `.wasm`, and call `go.run(instance)`.

After reading this file you will:
- Build a Go program for the browser and find the output
- Locate and copy `wasm_exec.js`
- Write the HTML/JS that boots your wasm module
- Serve the files with the right MIME type so the browser accepts them
- Read and change the page (the DOM) from Go using `syscall/js`
- Understand why a Go wasm program needs `select{}` at the end of `main`

You do **not** need to understand goroutine scheduling on wasm, Promises, or binary-size tuning yet. This file is about the moment you say "I wrote Go, and now a button on a web page runs it."

---

## Prerequisites

- **Required:** A working Go installation, version 1.21 or newer. The glue file moved to a new location in 1.21, and these notes assume the modern layout. Check with `go version`.
- **Required:** Comfort writing a basic `main.go` and running `go build`.
- **Required:** A modern browser (Chrome, Firefox, Edge, Safari — all support wasm).
- **Required:** The ability to serve files over HTTP. Opening an HTML file with `file://` will *not* work for wasm; the browser refuses to instantiate it. Any static server works (`go run` a tiny one, or `python3 -m http.server`).
- **Helpful:** A little HTML and JavaScript — enough to know what a `<script>` tag and a button click are.
- **Helpful:** Browser DevTools open, so you can see `console.log` output and errors.

If `go version` prints `go1.21` or higher and you can serve a folder over HTTP, you are ready.

---

## Glossary

| Term | Definition |
|------|-----------|
| **WebAssembly (wasm)** | A portable, low-level bytecode format that browsers run in a sandbox, alongside JavaScript. |
| **`GOOS=js`** | The "operating system" value telling Go to target the JavaScript host environment. |
| **`GOARCH=wasm`** | The "architecture" value telling Go to emit WebAssembly. |
| **`main.wasm`** | The compiled WebAssembly module — the output of the build. Conventionally named `main.wasm`. |
| **`wasm_exec.js`** | The JavaScript glue Go ships. It defines the `Go` class that sets up the runtime, the syscall bridge, and `go.run()`. |
| **`syscall/js`** | The Go standard-library package that lets Go code call into and out of JavaScript. |
| **`js.Global()`** | Returns the JavaScript global object (`window` in a browser). The entry point to everything in JS. |
| **`js.Value`** | A Go handle to a JavaScript value (an object, number, string, function…). |
| **`js.Func`** | A Go function wrapped so JavaScript can call it (e.g. as an event listener). |
| **The DOM** | The Document Object Model — the tree of elements that makes up the web page, reachable via `document`. |
| **`select{}`** | An empty select statement that blocks forever, used to stop `main` from returning so the program keeps running. |
| **MIME type** | The content type a server sends. wasm must be served as `application/wasm`. |

---

## Core Concepts

### The build is two environment variables

A normal build targets your machine. To target the browser you override `GOOS` and `GOARCH`:

```bash
GOOS=js GOARCH=wasm go build -o main.wasm
```

Everything else about the build is the same — your packages, your imports, your `go.mod`. The result is `main.wasm`, which you cannot run with `./main.wasm`. It is meant to be loaded by a browser.

### You need the glue file, and it must match your Go version

The browser knows how to load a `.wasm` module, but it does not know how to start *a Go program* inside one. Go provides the missing glue as a JavaScript file, `wasm_exec.js`. In modern Go (1.24+) it lives at:

```bash
$(go env GOROOT)/lib/wasm/wasm_exec.js
```

In Go 1.21–1.23 it is at `$(go env GOROOT)/misc/wasm/wasm_exec.js`. Either way you **copy it next to your HTML** and load it with a `<script>` tag. One rule matters above all: **the `wasm_exec.js` must come from the same Go toolchain that built the `.wasm`.** The glue and the binary share an internal contract; mixing versions causes obscure runtime errors. Copy it fresh every time you upgrade Go.

```bash
cp "$(go env GOROOT)/lib/wasm/wasm_exec.js" .
```

### The bootstrap: instantiate, then run

In your HTML you do four things in JavaScript:

1. Load `wasm_exec.js` (it defines a global `Go` class).
2. Create a `Go` instance: `const go = new Go();`
3. Fetch and instantiate `main.wasm`, passing `go.importObject` (the syscall bridge functions the module needs).
4. Call `go.run(instance)` to start your `main`.

`WebAssembly.instantiateStreaming` does the fetch-and-compile in one efficient step.

### The program must not return

In a normal Go program, when `main` returns, the process exits — and that is fine. In a browser, when `main` returns, the **wasm instance exits**: your callbacks stop working, your event listeners go dead, and the program is gone. If your page is supposed to keep reacting to clicks, `main` must *not* return. The idiom is to block forever at the end of `main`:

```go
func main() {
    setupButton()
    select {} // block forever; keeps the instance alive
}
```

If you forget this, your button works once during setup and then silently does nothing. This is the single most common beginner surprise.

### Talking to the page with `syscall/js`

`syscall/js` is the bridge. The key entry point is `js.Global()`, which returns the JS global object (`window`). From there you reach `document`, call methods, read and set properties:

```go
doc := js.Global().Get("document")
el := doc.Call("getElementById", "output")
el.Set("innerText", "Hello from Go!")
```

`Get` reads a property, `Set` writes one, `Call` invokes a method. That is most of what you need for basic DOM work.

### Serve it as `application/wasm`

`WebAssembly.instantiateStreaming` requires the server to send the `.wasm` file with the `Content-Type: application/wasm` header. Many simple servers do this automatically now, but some do not. If you see a warning like *"incorrect response MIME type. Expected 'application/wasm'"*, your server is the problem — switch to one that sets the header, or fall back to the non-streaming path (shown later).

---

## Real-World Analogies

**1. A foreign appliance and its power adapter.** Your `main.wasm` is an appliance built for a different outlet. `wasm_exec.js` is the adapter that lets it plug into the browser's wall socket. Without the matching adapter, nothing turns on — and an adapter for the wrong appliance can fry it (version mismatch).

**2. A translator in a meeting.** Go speaks Go; the browser speaks JavaScript. `syscall/js` is the interpreter sitting between them, relaying every request and answer. Each sentence relayed takes a moment — which is why you do not want to relay thousands of tiny sentences when one paragraph would do.

**3. Keeping the lights on.** A normal program is a guest who does their task and leaves. A browser app is a shopkeeper who must stay open all day to serve customers (clicks). `select{}` is the shopkeeper deciding not to go home — staying behind the counter, ready.

**4. A ticket window.** `js.Global()` is the front desk of the whole building. From the desk you can be directed to any room (`document`, `localStorage`, `fetch`). You never walk into a room directly; you ask the desk.

---

## Mental Models

### Model 1 — Two worlds, one bridge

There is the **Go world** (your compiled code, its own memory, its goroutines) and the **JS world** (the DOM, `window`, the event loop). They do not share memory directly. `syscall/js` is the only door between them, and every value that crosses is wrapped in a `js.Value` handle.

### Model 2 — `main` is a daemon, not a script

On the server, `main` runs and exits. In the browser, treat `main` as starting a long-lived service: register your handlers, then block. The "work" happens later, in callbacks, triggered by the user.

### Model 3 — The glue is half the program

The `.wasm` is useless without `wasm_exec.js`. Think of "the program" as the *pair*: `main.wasm` + the exact `wasm_exec.js` that built it. Ship them together.

### Model 4 — JavaScript is the operating system

`GOOS=js` is literal: to this Go program, JavaScript *is* the OS. There is no real file system, no real network sockets, no threads. Anything the OS would normally provide, you instead get by asking JavaScript (e.g. `fetch` instead of `net/http` dialing a socket).

### Model 5 — Handles, not copies

When you do `js.Global().Get("document")`, you do not copy the document into Go memory. You get a *handle* (`js.Value`) that refers to the live JS object. Reading and writing through it reaches across the bridge each time.

---

## Pros & Cons

### Pros

- **Reuse Go code in the browser.** Share validation, parsing, crypto, or business logic between your server and your front end without rewriting it in JavaScript.
- **Real concurrency model.** Goroutines and channels work (cooperatively scheduled), so Go's concurrency style carries over.
- **Strong typing and tooling.** You keep the Go compiler, `go vet`, and the standard library where it applies.
- **No plugin needed.** wasm runs in every modern browser natively.
- **Good for compute.** CPU-heavy work (image processing, simulations) can run client-side.

### Cons

- **Large binaries.** A trivial Go wasm program is megabytes, because the Go runtime and garbage collector are bundled in. This is a real concern — see sibling [04-wasm-interop-and-performance](../04-wasm-interop-and-performance/).
- **Boundary cost.** Every Go↔JS call crosses the bridge and is comparatively slow. Chatty DOM code is sluggish.
- **No threads.** Go's wasm runtime is single-threaded; you cannot use OS threads for parallelism.
- **No direct syscalls.** No file or socket access; you go through JavaScript (`fetch`, `localStorage`).
- **Glue/version coupling.** The `wasm_exec.js` must match the toolchain, an easy thing to get wrong.

---

## Use Cases

Compile Go to browser wasm when:

- **You want to reuse server-side Go logic on the client** — form validation, data parsing, units conversion — so the rules live in one place.
- **You need client-side compute** — hashing, compression, a small simulation, an image filter — that you would rather not rewrite in JS.
- **You have an existing Go library** (e.g. a Markdown renderer, a parser) and want it to run in a page.
- **You are building a demo or playground** that runs Go in the browser (the Go Playground's "share" experience is wasm-adjacent in spirit).

Do **not** reach for Go wasm when:

- You just need a button to toggle a class — plain JavaScript is smaller and simpler.
- Binary size is critical and your logic is trivial — the megabyte baseline will dominate.
- You need true multi-threading in the browser today — the Go port is single-threaded.

---

## Code Examples

### Example 1 — The smallest possible Go wasm program

`main.go`:

```go
package main

import "fmt"

func main() {
    fmt.Println("Hello from Go WebAssembly!")
}
```

Build it:

```bash
GOOS=js GOARCH=wasm go build -o main.wasm
```

This one prints to the browser's console (`fmt.Println` is wired to `console.log` on wasm) and then returns — which is fine here because it does no further work.

### Example 2 — Copying the glue file

```bash
# Modern Go (1.24+):
cp "$(go env GOROOT)/lib/wasm/wasm_exec.js" .

# Go 1.21–1.23:
# cp "$(go env GOROOT)/misc/wasm/wasm_exec.js" .
```

You now have `wasm_exec.js` next to `main.wasm`.

### Example 3 — The HTML bootstrap

`index.html`:

```html
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body>
  <script src="wasm_exec.js"></script>
  <script>
    const go = new Go();
    WebAssembly.instantiateStreaming(fetch("main.wasm"), go.importObject)
      .then((result) => {
        go.run(result.instance);
      });
  </script>
</body>
</html>
```

`go.importObject` carries the syscall bridge functions the module imports. `go.run` starts `main`.

### Example 4 — Serving the folder

The browser refuses `file://`. Serve over HTTP. A tiny Go server that sets the right MIME type:

```go
package main

import (
    "log"
    "net/http"
)

func main() {
    fs := http.FileServer(http.Dir("."))
    log.Println("serving on http://localhost:8080")
    log.Fatal(http.ListenAndServe(":8080", fs))
}
```

Modern Go's `http.FileServer` already serves `.wasm` as `application/wasm`. Open `http://localhost:8080` and check the console.

### Example 5 — Writing to the page (DOM)

`main.go`:

```go
package main

import "syscall/js"

func main() {
    doc := js.Global().Get("document")
    body := doc.Get("body")

    h1 := doc.Call("createElement", "h1")
    h1.Set("innerText", "Rendered by Go")
    body.Call("appendChild", h1)

    select {} // keep running so the page stays interactive
}
```

`createElement`, `appendChild`, and `innerText` are ordinary DOM calls — just spelled through `Get`/`Set`/`Call`.

### Example 6 — A button that calls Go

This is the canonical interactive example. The Go function is wrapped with `js.FuncOf` so JavaScript can invoke it.

`index.html` body adds:

```html
<button id="btn">Click me</button>
<p id="out"></p>
<script src="wasm_exec.js"></script>
<script>
  const go = new Go();
  WebAssembly.instantiateStreaming(fetch("main.wasm"), go.importObject)
    .then((r) => go.run(r.instance));
</script>
```

`main.go`:

```go
package main

import (
    "fmt"
    "syscall/js"
)

func main() {
    clicks := 0

    handler := js.FuncOf(func(this js.Value, args []js.Value) any {
        clicks++
        out := js.Global().Get("document").Call("getElementById", "out")
        out.Set("innerText", fmt.Sprintf("clicked %d times", clicks))
        return nil
    })

    btn := js.Global().Get("document").Call("getElementById", "btn")
    btn.Call("addEventListener", "click", handler)

    select {} // block forever; without this, the button stops working
}
```

Click the button: the paragraph updates. Remove `select {}` and the very first click does nothing, because the instance already exited.

---

## Coding Patterns

### Pattern: register-then-block

Every browser wasm `main` follows the same shape: set up callbacks and listeners, then `select {}`.

```go
func main() {
    registerCallbacks()
    select {}
}
```

### Pattern: cache `document` once

Reaching `js.Global().Get("document")` crosses the bridge every time. Read it once and reuse the handle:

```go
var doc = js.Global().Get("document")
```

### Pattern: wrap handlers with `js.FuncOf`

Any Go function the browser calls (event listeners, callbacks) must be a `js.Func`:

```go
cb := js.FuncOf(func(this js.Value, args []js.Value) any {
    // ...
    return nil
})
```

### Pattern: a build script

Encode the three steps so you never forget the glue copy:

```bash
#!/usr/bin/env bash
set -euo pipefail
GOOS=js GOARCH=wasm go build -o main.wasm
cp "$(go env GOROOT)/lib/wasm/wasm_exec.js" .
echo "built main.wasm and refreshed wasm_exec.js"
```

---

## Clean Code

- **Always copy `wasm_exec.js` from the building toolchain.** Do not commit a stale copy and forget it. Make the copy part of your build script.
- **Put `select {}` at the very end of `main`** for any interactive app, and add a comment explaining why. Future readers will not know it is load-bearing.
- **Name the output `main.wasm`** by convention so your HTML and tutorials line up.
- **Cache `js.Value` handles** for things you touch repeatedly (`document`, frequently-used elements) instead of re-fetching.
- **Keep DOM access in one place.** Do not scatter `js.Global().Get("document")` across the codebase; wrap it in small helpers.
- **Return `nil` from `js.FuncOf` callbacks** unless you specifically need to return a value to JS.

---

## Product Use / Feature

When you ship a Go wasm front-end feature, you are dealing with:

- **A static-asset pipeline.** Three files travel together: `main.wasm`, `wasm_exec.js`, and your HTML/JS. Your build must produce and deploy all three.
- **Caching and versioning.** `main.wasm` is large; you want it cached, but invalidated on each release (content-hashed filenames help).
- **Load time.** Users wait for the megabyte download and compile before the app reacts. A loading indicator until `go.run` completes is good UX.
- **Graceful fallback.** Decide what an unsupported browser sees (rare in 2026, but worth a thought).

For most teams, Go wasm is a *targeted* tool — one heavy computation or one shared library compiled to the browser — not a whole-app framework.

---

## Error Handling

### "incorrect response MIME type. Expected 'application/wasm'"

`instantiateStreaming` requires `Content-Type: application/wasm`. Your server is not sending it. Fix the server, or use the non-streaming fallback:

```js
WebAssembly.instantiate(
  await (await fetch("main.wasm")).arrayBuffer(),
  go.importObject
).then((r) => go.run(r.instance));
```

### "go_run is not a function" or "Go is not defined"

`wasm_exec.js` did not load, or loaded after your bootstrap script. Make sure `<script src="wasm_exec.js"></script>` comes **before** the script that does `new Go()`.

### The page works once, then goes dead

You forgot `select {}` (or your blocking happened too early). `main` returned, the instance exited, your listeners are gone. Add `select {}` as the last statement.

### "TypeError: WebAssembly.instantiateStreaming … magic word" / weird runtime panics

Usually a version mismatch: your `wasm_exec.js` is from a different Go version than the one that built `main.wasm`. Re-copy the glue from the current toolchain and rebuild.

### Calling DOM functions returns "undefined"

Your element does not exist yet, or the id is wrong. If your script runs before the element is in the DOM, the `getElementById` returns a null-ish value. Place scripts after the elements, or after `DOMContentLoaded`.

### A panic in a `js.FuncOf` callback

An unrecovered panic in a callback crashes the whole instance — the app dies. Recover inside long-lived callbacks if a single bad input should not kill the page.

---

## Security Considerations

- **wasm runs in the page's sandbox.** It has exactly the privileges the page's JavaScript has — no more. It cannot read arbitrary files or reach other origins beyond what CORS allows.
- **Same-origin and CORS still apply.** Going through `fetch` from Go means the browser's CORS rules govern you, just like JS.
- **Do not embed secrets in `main.wasm`.** The file is downloaded to the client and is fully inspectable. Anything compiled in (API keys, tokens) is public.
- **Validate on the server too.** Client-side Go validation is a UX nicety, not a security boundary. A user can bypass the wasm entirely and call your API directly.
- **Subresource integrity.** Consider SRI hashes for `wasm_exec.js` and content-hashed names for `main.wasm` so a tampered asset is detectable.
- **A panic should not leak internals.** Error text shown in the DOM can reveal stack details; sanitize what you display.

---

## Performance Tips

- **Minimize boundary crossings.** Each `Get`/`Set`/`Call` crosses the Go↔JS bridge. Batch DOM updates; do not loop a thousand `Set("innerText", …)` calls.
- **Cache handles.** Re-fetching `document` or the same element repeatedly wastes crossings.
- **Expect a large download.** The baseline binary is megabytes; serve it gzipped/brotli-compressed and cached. Size tuning is the sibling topic [04-wasm-interop-and-performance](../04-wasm-interop-and-performance/).
- **Keep heavy work off the first paint.** Show the page, then start compute, so the user is not staring at a blank screen during load.
- **Do not block the event loop.** A long synchronous Go loop freezes the page (single thread). Break long work into chunks or yield.

---

## Best Practices

1. **Always end interactive `main` with `select {}`** and comment why.
2. **Refresh `wasm_exec.js` on every Go upgrade**, ideally automatically in the build script.
3. **Serve `.wasm` as `application/wasm`** and over HTTP, never `file://`.
4. **Cache `js.Value` handles** for repeatedly-used objects.
5. **Wrap browser-called functions in `js.FuncOf`** and (at this level, mention) plan to release them — see middle.md for `Release()`.
6. **Name files conventionally** (`main.wasm`, `wasm_exec.js`) to match tooling and docs.
7. **Treat client-side logic as untrusted** by your server; keep authoritative checks server-side.
8. **Show a loading state** until `go.run` starts, given the download size.

---

## Edge Cases & Pitfalls

### Pitfall 1 — Forgetting `select {}`

The classic. The app sets up, `main` returns, the instance exits, and every callback silently stops. Always block at the end of an interactive `main`.

### Pitfall 2 — Opening with `file://`

Double-clicking `index.html` gives `file://`, and the browser refuses to instantiate wasm from it (and the MIME type is wrong). You must serve over HTTP.

### Pitfall 3 — Mismatched `wasm_exec.js`

You upgraded Go but kept the old glue file. Symptoms range from "Go is not defined"-adjacent oddities to runtime panics. Re-copy the glue from the current toolchain.

### Pitfall 4 — Script order

`wasm_exec.js` must load before the bootstrap that calls `new Go()`. Put it first.

### Pitfall 5 — Touching elements that do not exist yet

A script in `<head>` runs before the `<body>` elements exist. `getElementById` returns null-ish; calls fail. Place the bootstrap after the elements, or wait for `DOMContentLoaded`.

### Pitfall 6 — Assuming files and sockets work

`os.Open` and `net.Dial` do not work on `GOOS=js`. There is no OS to provide them. Use JavaScript (`fetch`, `localStorage`) through `syscall/js` instead — see sibling [02-wasi-and-wasip1](../02-wasi-and-wasip1/) for the non-browser file story.

### Pitfall 7 — Expecting threads

`go func()` works, but it is cooperatively scheduled on one thread. CPU-bound goroutines do not run in parallel and a tight loop blocks everything.

### Pitfall 8 — Caching the wasm too aggressively

If `main.wasm` is cached by filename and you ship a new build, users may run stale code. Use content-hashed filenames or cache-busting query strings.

---

## Common Mistakes

- **No `select {}`** in an interactive program — the most common mistake by far.
- **Loading from `file://`** instead of an HTTP server.
- **Stale `wasm_exec.js`** after a Go upgrade.
- **Wrong script order** (bootstrap before the glue).
- **Wrong MIME type** from a bare static server.
- **Re-fetching `document`** in every callback instead of caching it.
- **Embedding secrets** in the wasm, thinking it is hidden.
- **Forgetting the wasm is downloaded to the client** — treating client validation as authoritative.

---

## Common Misconceptions

> *"`main.wasm` is an executable I can run from the terminal."*

No. It is a module the browser loads. It needs `wasm_exec.js` and a host (the browser, or `node` with the same glue) to run.

> *"Go wasm replaces JavaScript."*

No. It runs *alongside* JavaScript, in the same sandbox, and reaches the DOM *through* JavaScript via `syscall/js`. You still need a little JS to bootstrap it.

> *"I can `os.Open` files."*

No. `GOOS=js` has no real file system in the browser. File access goes through JavaScript APIs.

> *"Goroutines give me parallelism here."*

No. The browser port is single-threaded; goroutines are concurrent but not parallel.

> *"The wasm hides my source code."*

No. It is downloaded to the client and inspectable. Do not put secrets in it.

> *"Any version of `wasm_exec.js` works."*

No. It must match the toolchain that built the binary.

---

## Tricky Points

- **`fmt.Println` goes to the console.** On wasm, standard output is wired to `console.log`. Handy for quick debugging.
- **`js.Global()` is `window`** in the browser. In Node it is `global`. Same code, different host object.
- **`go.run` is async-ish.** It returns control to the browser; your Go code keeps running via the event loop and `select {}`.
- **`select {}` blocks the goroutine, not the page.** The browser's event loop keeps spinning; only the `main` goroutine parks, which is exactly what you want.
- **The importObject is required.** `instantiateStreaming(fetch(...), go.importObject)` — omit `go.importObject` and the module will not link (it imports the syscall bridge).
- **Errors in instantiation are reported via the promise.** Add a `.catch` to see them, especially MIME/version issues.

---

## Test

Try this in a scratch folder.

```bash
mkdir wasm-test && cd wasm-test
go mod init example.com/wt
cat > main.go <<'EOF'
package main

import "syscall/js"

func main() {
    doc := js.Global().Get("document")
    doc.Get("body").Set("innerText", "Hello, wasm!")
    select {}
}
EOF
GOOS=js GOARCH=wasm go build -o main.wasm
cp "$(go env GOROOT)/lib/wasm/wasm_exec.js" .
cat > index.html <<'EOF'
<!DOCTYPE html><html><body>
<script src="wasm_exec.js"></script>
<script>
const go = new Go();
WebAssembly.instantiateStreaming(fetch("main.wasm"), go.importObject)
  .then(r => go.run(r.instance));
</script>
</body></html>
EOF
```

Serve it (`go run` a file server, or `python3 -m http.server`) and open the page.

Now answer:
1. What happens if you remove `select {}`? (Answer: the page may still show the text because it was set before `main` returned — but any later callbacks would not fire.)
2. What happens if you open `index.html` via `file://`? (Answer: the browser refuses to instantiate the wasm.)
3. What happens if you load an old `wasm_exec.js`? (Answer: runtime errors / version-mismatch failures.)
4. Where did `Hello, wasm!` come from — Go or JS? (Answer: Go, via `syscall/js` setting `body.innerText`.)

---

## Tricky Questions

**Q1.** My build produced `main.wasm`. Why can't I run `./main.wasm`?

A. It is WebAssembly bytecode, not a native binary. It needs a host (browser or Node with the matching `wasm_exec.js`) to load and start it.

**Q2.** Do I have to write any JavaScript at all?

A. A little — the bootstrap that loads `wasm_exec.js`, creates `new Go()`, instantiates the module, and calls `go.run`. After that, your logic can live entirely in Go.

**Q3.** Why does my button work the first time during setup but not on later clicks?

A. You almost certainly forgot `select {}`. `main` returned, the instance exited, and the listener is dead.

**Q4.** Where is `wasm_exec.js`?

A. `$(go env GOROOT)/lib/wasm/wasm_exec.js` in modern Go (1.24+); `$(go env GOROOT)/misc/wasm/wasm_exec.js` in 1.21–1.23. Copy it next to your HTML.

**Q5.** Why must I serve over HTTP?

A. Browsers do not instantiate wasm from `file://`, and `instantiateStreaming` needs an `application/wasm` MIME type that only an HTTP server provides.

**Q6.** Is `fmt.Println` lost in the browser?

A. No — it goes to the browser console (`console.log`). Open DevTools to see it.

**Q7.** My wasm is several megabytes. Did I do something wrong?

A. No. The Go runtime and GC are bundled in, so even "hello world" is large. Shrinking it is a separate topic — see [04-wasm-interop-and-performance](../04-wasm-interop-and-performance/).

**Q8.** Can I read a local file the user picked?

A. Not with `os.Open`. You use the browser's File API through `syscall/js`, reading bytes that JavaScript hands you.

**Q9.** Does `select {}` freeze the browser?

A. No. It parks the `main` goroutine; the browser's event loop keeps running and dispatching your callbacks. A tight *busy* loop would freeze the page, but `select {}` is not busy.

**Q10.** What is `go.importObject`?

A. The set of host functions (the syscall bridge) that the wasm module imports. You must pass it during instantiation or the module will not link.

---

## Cheat Sheet

```bash
# Build for the browser
GOOS=js GOARCH=wasm go build -o main.wasm

# Copy the glue (modern Go 1.24+)
cp "$(go env GOROOT)/lib/wasm/wasm_exec.js" .
# (Go 1.21–1.23: misc/wasm/wasm_exec.js)

# Serve over HTTP (never file://), with application/wasm MIME
python3 -m http.server 8080
```

```html
<!-- Bootstrap order matters: glue first -->
<script src="wasm_exec.js"></script>
<script>
  const go = new Go();
  WebAssembly.instantiateStreaming(fetch("main.wasm"), go.importObject)
    .then(r => go.run(r.instance));
</script>
```

```go
// syscall/js essentials
js.Global()                          // the window object
js.Global().Get("document")          // a property
el.Set("innerText", "hi")            // write a property
el.Call("addEventListener", "click", // call a method
        js.FuncOf(func(this js.Value, args []js.Value) any {
            return nil
        }))
select {}                            // keep the instance alive
```

| Symptom | Likely Cause | Fix |
|---------|--------------|-----|
| App dead after setup | No `select {}` | Block at end of `main` |
| Won't instantiate | Opened via `file://` | Serve over HTTP |
| MIME warning | Server not sending `application/wasm` | Use a proper server / non-streaming path |
| Weird runtime errors | Stale `wasm_exec.js` | Re-copy from current Go |
| `Go is not defined` | Glue loaded after bootstrap | Put glue `<script>` first |

---

## Self-Assessment Checklist

You can move on to [middle.md](middle.md) when you can:

- [ ] Build a Go program with `GOOS=js GOARCH=wasm`
- [ ] Find and copy the correct `wasm_exec.js` for your Go version
- [ ] Write the HTML bootstrap (glue, `new Go()`, instantiate, `go.run`)
- [ ] Serve the files over HTTP with the right MIME type
- [ ] Read and write the DOM from Go via `Get`/`Set`/`Call`
- [ ] Wrap a Go function with `js.FuncOf` and register it as an event listener
- [ ] Explain why interactive programs need `select {}`
- [ ] Explain why `os.Open` and `net.Dial` do not work
- [ ] Diagnose the "works once then dies" and MIME-type failures
- [ ] Explain why `main.wasm` cannot be run from a terminal

---

## Summary

Compiling Go to the browser is two environment variables — `GOOS=js GOARCH=wasm` — producing a `main.wasm` that the browser loads with the help of Go's `wasm_exec.js` glue (now at `$(go env GOROOT)/lib/wasm/wasm_exec.js`). You bootstrap it with a few lines of JavaScript: load the glue, create a `Go` instance, `instantiateStreaming` the module, and `go.run` it. From there, `syscall/js` is your bridge to JavaScript and the DOM — `js.Global()`, `Get`/`Set`/`Call`, and `js.FuncOf` to expose Go callbacks.

The defining quirk is the execution model: when `main` returns, the instance exits, so interactive programs must block forever with `select {}`. Serve over HTTP with `application/wasm`, keep `wasm_exec.js` matched to your toolchain, treat the bundle as public and large, and minimize trips across the Go↔JS boundary. Master those and a Go function can run behind a button on a web page.

---

## What You Can Build

After learning this:

- **A "Hello, DOM" page** rendered entirely from Go.
- **An interactive widget** — a counter, a converter, a live validator — whose logic is Go behind an event listener.
- **A shared-logic demo** that runs the same Go validation in the browser that runs on your server.
- **A tiny compute tool** — a hash calculator, a small parser — running client-side with no backend call.

You cannot yet:
- Convert JS values to Go types cleanly and handle callbacks at scale (next: middle.md)
- Await Promises (e.g. `fetch`) from Go (middle.md / senior.md)
- Pass byte slices efficiently across the boundary (`CopyBytesToGo`/`CopyBytesToJS`, senior.md)
- Shrink the binary or tune boundary cost ([04-wasm-interop-and-performance](../04-wasm-interop-and-performance/))

---

## Further Reading

- [`syscall/js` package documentation](https://pkg.go.dev/syscall/js) — the authoritative API reference.
- [Go Wiki: WebAssembly](https://go.dev/wiki/WebAssembly) — official getting-started and FAQ.
- [WebAssembly with Go (go.dev)](https://go.dev/wiki/WebAssembly#getting-started) — the canonical walkthrough.
- [MDN: WebAssembly.instantiateStreaming](https://developer.mozilla.org/docs/WebAssembly/JavaScript_interface/instantiateStreaming_static) — the browser side of instantiation.

---

## Related Topics

- [16.2 WASI and wasip1](../02-wasi-and-wasip1/) — the non-browser wasm target, with file access
- [16.4 wasm Interop & Performance](../04-wasm-interop-and-performance/) — binary size and boundary-cost tuning
- [16.5 wasm in Production](../05-wasm-in-production/) — shipping and operating wasm front ends
- 06.x Build Constraints — how `GOOS`/`GOARCH` and build tags select files

---

## Diagrams & Visual Aids

```
The three files that travel together:

    your-app/
    ├── index.html      ← bootstrap (loads glue, runs wasm)
    ├── wasm_exec.js     ← Go's glue (MUST match toolchain)
    └── main.wasm        ← your compiled Go (GOOS=js GOARCH=wasm)
```

```
Boot sequence:

    browser loads index.html
            │
            ▼
    <script src="wasm_exec.js">   defines global `Go`
            │
            ▼
    const go = new Go()
            │
            ▼
    instantiateStreaming(fetch("main.wasm"), go.importObject)
            │
            ▼
    go.run(instance)   ──►  Go main() starts
            │
            ▼
    main() registers callbacks, then select {}  (stays alive)
```

```
Two worlds, one bridge:

    ┌──────────── Go world ────────────┐     ┌──── JS world ────┐
    │  your code, goroutines, GC       │     │  window          │
    │                                  │     │  document (DOM)   │
    │   js.Global() ───────────────────┼────►│  fetch, console   │
    │   el.Set("innerText", "hi") ─────┼────►│  (each call       │
    │   js.FuncOf(cb)  ◄───────────────┼─────│   crosses here)   │
    └──────────────────────────────────┘     └──────────────────┘
                 syscall/js is the only door
```

```
The lifecycle trap:

    main() returns           main() ends with select{}
    ----------------         --------------------------
    instance EXITS           instance STAYS ALIVE
    callbacks die            callbacks keep firing
    button stops working     button keeps working
```
