# Wasm Interop & Performance — Junior Level

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
> Focus: "What is the Go↔JS boundary?" and "Why is my hello-world wasm binary several megabytes?"

When you compile Go to WebAssembly for the browser (`GOOS=js GOARCH=wasm`), your Go code runs inside a sandbox that *cannot* touch the DOM, the network, or the screen directly. The only way out is through JavaScript — and Go reaches JavaScript through one package, `syscall/js`, riding on a glue script the toolchain ships called `wasm_exec.js`.

Every time your Go code reads a property, calls a function, or hands a value to JavaScript, it makes a *boundary crossing*. Each crossing has a cost. A single one is cheap. A million per second — say, one per pixel or one per DOM node in a tight loop — is not. The single most important performance idea in this entire topic is: **minimise how often you cross the boundary.**

The second big surprise is *size*. A trivial Go wasm program that just prints "hello" compiles to roughly **2 MB** (and ~1.5 MB after gzip). That is not your code — it is the Go runtime, the garbage collector, and the scheduler, all of which ship *inside* the `.wasm` file because the browser has none of them.

```bash
GOOS=js GOARCH=wasm go build -o main.wasm
ls -lh main.wasm   # ~2.0M for hello-world
```

After reading this file you will:
- Understand what the Go↔JS boundary is and why each crossing costs
- Know what `js.Value`, `js.Global()`, `Get`, `Set`, and `Call` actually do
- Know why a Go wasm binary is multiple megabytes and how to shrink it a bit
- Understand that Go wasm is single-threaded and that the GC runs inside it
- Measure a binary's size and the wire size your users download

You do **not** need to understand the wasm ABI, `go:wasmimport`, or wasip1's host-function calling convention yet. This file is about the moment you first wire a Go function to a button and wonder why the megabytes and the milliseconds add up.

---

## Prerequisites

- **Required:** A working Go installation, 1.21 or newer. Check with `go version`. (1.21+ is assumed throughout this topic; the wasm story has shifted across versions.)
- **Required:** Comfort building for the browser target. See [01-goos-js-wasm-browser](../01-goos-js-wasm-browser/junior.md) — you should already be able to compile a `.wasm`, copy `wasm_exec.js`, and load it from an HTML page.
- **Required:** Basic JavaScript: knowing what a function, an object property, and a `Uint8Array` are.
- **Helpful:** Familiarity with the browser DevTools — the Console and the Network tab at minimum.
- **Helpful:** A rough sense of what a garbage collector does.

If you can already get a "hello from Go" message into the browser console via wasm, you are ready.

---

## Glossary

| Term | Definition |
|------|-----------|
| **The boundary** | The line between Go (running in wasm) and JavaScript (running in the host). Crossing it has a fixed per-call cost. |
| **`syscall/js`** | The Go standard-library package that lets Go call into JavaScript and back. Only available under `GOOS=js`. |
| **`wasm_exec.js`** | The toolchain-provided JavaScript glue that loads the module, wires up the boundary, and implements the syscalls Go needs. |
| **`js.Value`** | A Go handle that *refers* to a JavaScript value. It is not the JS value itself; it is a reference across the boundary. |
| **`js.Global()`** | Returns the JS global object (`window` in a browser). The entry point to everything: `document`, `console`, etc. |
| **`js.ValueOf(x)`** | Converts a Go value into a `js.Value`. Allocates and "boxes" the value into the JS world. |
| **Boundary crossing** | Any `Get`, `Set`, `Call`, `Invoke`, `New`, or `js.ValueOf` — each one passes control between the two worlds. |
| **Linear memory** | The single contiguous byte buffer that *is* the wasm module's memory. JavaScript can view it as an `ArrayBuffer`. |
| **`CopyBytesToGo` / `CopyBytesToJS`** | Bulk byte-copy helpers that move a whole `[]byte` across the boundary in one call instead of byte-by-byte. |
| **Binary size** | The size of the `.wasm` file. Dominated by the Go runtime + GC, not your code. |
| **Wire size** | What the user actually downloads, after gzip/brotli compression. |
| **TinyGo** | An alternative Go compiler that produces much smaller wasm, at the cost of an incomplete standard library. A tradeoff, covered in [03-tinygo-for-wasm-and-embedded](../03-tinygo-for-wasm-and-embedded/junior.md). |

---

## Core Concepts

### The boundary is the whole game

A wasm module is a sealed box. It has its own memory and its own instruction set, and it can call only the functions the host explicitly imports into it. For Go-in-the-browser, the host is JavaScript, and the imports are wired up by `wasm_exec.js`.

So when Go wants to set the text of a `<div>`, it cannot reach into the DOM. It must ask JavaScript: "please find the element, please set its `textContent`." Each of those asks is a function call *out of* the box and a result *back into* the box. That round trip is the boundary crossing, and it is the unit you must learn to count.

### A `js.Value` is a handle, not a value

This trips up everyone at first. When you write:

```go
doc := js.Global().Get("document")
```

`doc` is **not** the JavaScript `document` object sitting in Go memory. It is a small Go value that *refers* to the real `document` living on the JS side. Every operation on it — `doc.Get("body")`, `doc.Call("getElementById", "app")` — crosses the boundary to act on the real thing.

Because of this, two ideas follow naturally:
- **Caching a handle is cheap and worth it.** Fetch `document` once, reuse the handle.
- **Operating on a handle is not free.** Each `Get`/`Set`/`Call` is a crossing.

### `js.ValueOf` boxes and allocates

To pass a Go value to JavaScript, it has to be converted into something the JS side understands. `js.ValueOf(42)`, `js.ValueOf("hi")`, `js.ValueOf([]interface{}{...})` all *allocate* a representation on the boundary. Doing this once is nothing. Doing it inside a 60-frames-per-second render loop, once per object, is a steady stream of allocations and crossings that the GC then has to clean up.

### The runtime ships inside the binary

The browser has a JavaScript engine, but it has *no Go runtime*. There is no goroutine scheduler, no Go garbage collector, no Go memory allocator built into the browser. So the compiler bundles all of them into your `.wasm`. That is why "hello world" is ~2 MB: you are shipping a small operating system for Go along with your three lines of code.

This is the headline performance fact of Go wasm. Your code is a rounding error; the runtime is the file.

### Go wasm is single-threaded

Under `GOOS=js GOARCH=wasm`, your Go program runs on a *single* JavaScript thread. Goroutines still work — they are multiplexed cooperatively onto that one thread — but there is no true parallelism. You cannot saturate multiple CPU cores from Go wasm today. A long compute loop will *block the browser's UI thread* unless you yield or move it to a Web Worker (a JS-side concern).

### Compute can be fast; chatter is slow

Here is the nuance that makes wasm worth using. Code that stays *inside* the box — number crunching, image filters, parsing, compression — runs at near-native speed because the CPU is executing compiled wasm instructions with no boundary in sight. Code that *chats* with JavaScript constantly — updating the DOM node by node, reading mouse coordinates every event — is dominated by crossing cost, not compute. Wasm shines for the former and disappoints for the latter.

---

## Real-World Analogies

**1. A drive-through window.** You (Go) are in the kitchen; the customer (JavaScript) is at the window. Handing one bag through the window is fast. But if you handed *one fry at a time* — open window, pass fry, close, repeat — you would spend all day at the window and none cooking. Batch the order into one bag. That bag is `CopyBytesToJS`; the fries are individual `Set` calls.

**2. International phone calls billed per call.** Each call connects, you say one word, you hang up. The per-call connection fee dwarfs the one word. Saying a whole sentence per call — batching — is how you keep the bill down. The connection fee is the boundary cost.

**3. Shipping the whole factory with the product.** Imagine buying a coffee machine and finding the entire factory that built it packed in the box. That is the Go runtime riding inside your 2 MB wasm. You only wanted the machine (your code), but it cannot run without the factory (the runtime and GC).

**4. A translator between two rooms.** Go speaks one language, JavaScript another. `wasm_exec.js` is the translator standing in the doorway. Every sentence that crosses the doorway must be translated, which takes time. Fewer trips through the doorway, fewer translations.

---

## Mental Models

### Model 1 — Count the crossings

Before optimizing anything, ask: *how many times does this code path cross the boundary?* Not "how much work does it do," but "how many `Get`/`Set`/`Call`/`ValueOf`." That count, multiplied by the frequency, is usually your performance ceiling for UI-heavy code.

### Model 2 — The box and the doorway

Your Go code lives in a box. The doorway is the boundary. Work done inside the box is fast. Work that requires stepping through the doorway is slow *per step*. Design so the hot work happens inside the box and only the results step out.

### Model 3 — Size is runtime, not code

When the binary is too big, your instinct is "delete my code." Wrong target. The bulk is the runtime. The levers that actually move size are stripping debug info, choosing a smaller toolchain (TinyGo), and compressing the wire. Your business logic is rarely the problem.

### Model 4 — One thread, cooperative

Picture a single lane of traffic. Goroutines take turns; nobody overtakes. A long-running Go computation parks in the lane and blocks everything behind it — including the browser repainting the screen. Either keep computations short or hand the long ones off the main lane.

### Model 5 — Memory is one big byte array

The wasm module's entire memory is a single contiguous buffer. JavaScript can wrap that buffer in a `Uint8Array` and read it directly — no copy. This is the key to moving large data (images, audio) efficiently: instead of copying bytes across the boundary one call at a time, both sides look at the *same* bytes.

---

## Pros & Cons

### Pros

- **Near-native compute.** CPU-bound kernels (parsers, filters, math) run fast inside the box.
- **Reuse real Go code.** A Go library that already works on the server can often run unchanged in the browser.
- **Type safety and tooling.** You write Go, not hand-written JavaScript, for complex logic.
- **Memory sharing is possible.** Large buffers can be shared with JS without per-byte copying.

### Cons

- **Big binaries.** ~2 MB minimum for the browser target before compression.
- **Boundary cost.** UI-heavy code that crosses constantly is slower than plain JavaScript.
- **Single-threaded.** No true parallelism from Go; long work blocks the UI thread.
- **GC inside the sandbox.** The Go garbage collector runs on that one thread and can pause it.
- **Startup cost.** The module must be downloaded, compiled, and instantiated before anything runs.

The honest summary: Go wasm is excellent for *compute-heavy, boundary-light* work and a poor fit for *boundary-heavy* UI glue. Match the tool to the job.

---

## Use Cases

Reach for Go wasm when:

- **You have a compute kernel.** Image processing, audio DSP, parsing, compression, cryptography, simulation — work that stays inside the box.
- **You want to reuse a Go library in the browser.** A markdown renderer, a regex engine, a chess engine, a diff algorithm already written in Go.
- **The data is large but the interaction is occasional.** Process a whole image at once, then hand back one result.
- **Correctness matters more than the last kilobyte.** Internal tools, dashboards, developer tooling where a 2 MB download is acceptable.

Avoid Go wasm (or at least think hard) when:

- **The work is mostly DOM manipulation.** Per-node updates cross the boundary constantly; plain JS or a JS framework is faster and smaller.
- **Bundle size is the top constraint.** A 2 MB baseline is a non-starter for a landing page; consider TinyGo, see [03-tinygo-for-wasm-and-embedded](../03-tinygo-for-wasm-and-embedded/junior.md).
- **You need true multithreading.** Go wasm cannot use multiple cores today.

---

## Code Examples

### Example 1 — A single boundary crossing

```go
package main

import "syscall/js"

func main() {
    // One crossing to fetch console, one to call log.
    js.Global().Get("console").Call("log", "hello from Go")
    select {} // keep the program alive
}
```

Build and load:

```bash
GOOS=js GOARCH=wasm go build -o main.wasm
cp "$(go env GOROOT)/lib/wasm/wasm_exec.js" .   # path is GOROOT/misc/wasm before Go 1.21
```

### Example 2 — Caching a handle (good) vs refetching (bad)

```go
// BAD: crosses the boundary to fetch `document` on every call.
func setTextBad(id, text string) {
    doc := js.Global().Get("document")           // crossing
    el := doc.Call("getElementById", id)          // crossing
    el.Set("textContent", text)                   // crossing
}

// GOOD: fetch the handle once, reuse it.
var doc = js.Global().Get("document")             // one crossing, at startup

func setTextGood(id, text string) {
    el := doc.Call("getElementById", id)          // crossing
    el.Set("textContent", text)                   // crossing
}
```

The `Get("document")` is hoisted out of the hot path. Small change, real saving when called often.

### Example 3 — Measuring binary size

```bash
GOOS=js GOARCH=wasm go build -o main.wasm
ls -lh main.wasm
# -rw-r--r--  2.0M  main.wasm     (typical hello-world)

# Strip debug info and the symbol table:
GOOS=js GOARCH=wasm go build -ldflags="-s -w" -o main.wasm
ls -lh main.wasm
# -rw-r--r--  1.6M  main.wasm     (smaller, but still MB-scale)
```

`-s` drops the symbol table; `-w` drops DWARF debug info. They shave a few hundred KB but do not change the order of magnitude. The runtime is still in there.

### Example 4 — Measuring the wire size your users pay

```bash
gzip -9 -c main.wasm | wc -c    # what gzip transfer would cost
# ~1500000   (~1.5 MB over the wire)

# brotli usually does better:
brotli -q 11 -c main.wasm | wc -c
# ~1200000   (~1.2 MB)
```

Users download the *compressed* size, not the on-disk size. Always serve `.wasm` with compression. See [05-wasm-in-production](../05-wasm-in-production/junior.md) for serving and caching.

### Example 5 — Exposing a Go function to JavaScript

```go
func add(this js.Value, args []js.Value) any {
    a := args[0].Int()   // boundary read
    b := args[1].Int()   // boundary read
    return a + b         // boxed back across the boundary
}

func main() {
    js.Global().Set("goAdd", js.FuncOf(add))
    select {}
}
```

```js
// In JavaScript, after the module is running:
console.log(goAdd(2, 3)); // 5
```

Each `args[i].Int()` is a read across the boundary; the returned `int` is boxed back. Fine for occasional calls; expensive if called millions of times.

### Example 6 — Doing the heavy work inside the box

```go
// GOOD shape: one crossing in, big compute inside, one result out.
func sumOfSquares(this js.Value, args []js.Value) any {
    n := args[0].Int()
    total := 0
    for i := 1; i <= n; i++ { // pure compute, no crossings
        total += i * i
    }
    return total // one crossing out
}
```

The loop never touches JavaScript. Only the input and the single result cross. This is the pattern wasm rewards.

---

## Coding Patterns

### Pattern: hoist handle lookups to startup

Fetch `document`, `console`, frequently-used elements, and constructor references *once* and store them in package-level `js.Value`s. Never re-`Get` them inside a loop.

### Pattern: batch, do not drip

If you must send many values to JS, assemble them on the Go side and send them in **one** call (one array, one JSON string, one byte buffer) rather than one call per value.

```go
// Drip (bad): N crossings.
for _, v := range items { list.Call("push", v) }

// Batch (good): build once, cross once.
arr := js.ValueOf(items) // one conversion
list.Call("replaceWith", arr)
```

### Pattern: compute in, result out

Shape every exported function as: read inputs (a few crossings), run the loop with zero crossings, return one result. Keep the boundary at the edges, never in the middle.

### Pattern: serve compressed

Production servers must send `.wasm` with `Content-Encoding: gzip` or `br`. The browser decompresses transparently. This is the cheapest size win available and costs you nothing in code.

---

## Clean Code

- **Name handles for what they refer to.** `document`, `consoleLog`, `appRoot` — not `v1`, `v2`.
- **Centralise the boundary.** Keep `syscall/js` calls in one thin layer (a `dom` package) so the rest of your Go code is plain Go and testable off-wasm.
- **Don't sprinkle `js.Global().Get(...)` everywhere.** Each one is a crossing and a maintenance smell.
- **Release what you allocate.** Every `js.FuncOf` you create and keep must be `Release()`d when no longer needed, or it leaks (covered more in middle.md).
- **Keep `main` alive deliberately.** Use `select {}` or a done-channel; do not let `main` return while callbacks are still expected.

---

## Product Use / Feature

When you ship Go wasm in a product, it touches:

- **First-load time.** A 1.5 MB compressed download plus compile/instantiate time delays interactivity. Budget for it; lazy-load the wasm if it is not needed immediately.
- **Perceived smoothness.** Because Go wasm is single-threaded, a long Go computation freezes the page. Break work up or move it to a worker.
- **Feature scope.** Wasm is ideal for a self-contained feature (an in-browser image editor, an offline calculator, a client-side parser) rather than the whole UI.
- **Caching strategy.** The `.wasm` rarely changes; cache it aggressively with a content-hashed filename. See [05-wasm-in-production](../05-wasm-in-production/junior.md).

---

## Error Handling

- **JavaScript exceptions become Go panics.** A failing `Call` (e.g. calling a method that throws) surfaces in Go as a panic carrying a `js.Error`. Recover where you must keep running.

```go
func safeCall(fn js.Value, args ...any) (result js.Value, err error) {
    defer func() {
        if r := recover(); r != nil {
            err = fmt.Errorf("js call failed: %v", r)
        }
    }()
    return fn.Invoke(args...), nil
}
```

- **`Undefined` and `Null` are not errors.** `Get` on a missing property returns `js.Undefined()`, not a panic. Check `.IsUndefined()` / `.IsNull()` before using a value.
- **Type mismatches panic.** `args[0].Int()` on a value that is actually a string panics. Validate with `.Type()` first if input is untrusted.
- **A returned-but-never-released `js.Func` leaks.** Not an error you will see immediately, but a slow memory growth. Track your `FuncOf` lifetimes.

---

## Security Considerations

- **Wasm is sandboxed, but the boundary is a trust seam.** Go cannot escape the sandbox, but anything it hands to JavaScript runs with the page's full privileges. Do not pass unsanitised strings into `innerHTML` from Go — you can create XSS through the boundary just as easily as from JS.
- **The `.wasm` is fully visible.** Anyone can download and disassemble it. Do not ship secrets (API keys, tokens) inside the binary; the runtime being large does not hide them.
- **Untrusted input crossing in.** Values arriving from JS (`args`) are attacker-controllable in the browser. Validate types and ranges before using them.
- **Memory you expose to JS is exposed fully.** If you share a `Uint8Array` view over linear memory, JavaScript can read *all* of that memory region, not just the slice you meant. Be deliberate about what you expose.

---

## Performance Tips

- **Count crossings first.** The number of `Get`/`Set`/`Call`/`ValueOf` per hot path is your primary metric.
- **Cache `js.Value` handles** at startup; never refetch in a loop.
- **Batch data across the boundary** — one array or one byte buffer, not N small calls.
- **Use `CopyBytesToGo`/`CopyBytesToJS`** for large `[]byte` instead of element-by-element copies (see middle.md).
- **Keep compute inside the box.** A pure Go loop is fast; the same loop sprinkled with `Set` calls is not.
- **Strip the binary** with `-ldflags="-s -w"` and serve it gzip/brotli compressed.
- **Avoid per-frame allocations.** `js.ValueOf` allocates; doing it 60 times a second creates GC pressure that can cause pauses on the single thread.

---

## Best Practices

1. **Treat the boundary as expensive by default.** Optimize for fewer crossings before optimizing the compute.
2. **Isolate `syscall/js` in one package.** Keep the rest of your Go pure and unit-testable on a normal build.
3. **Hoist handle lookups** out of hot paths to package level.
4. **Always serve `.wasm` compressed** with a content-hashed cache-busting name.
5. **Measure both numbers:** on-disk binary size and compressed wire size.
6. **Never block the UI thread for long.** Chunk heavy work or offload it.
7. **Release every `js.Func`** you no longer need.
8. **Be honest about fit.** If the feature is mostly DOM glue, Go wasm may be the wrong tool — reach for [03-tinygo-for-wasm-and-embedded](../03-tinygo-for-wasm-and-embedded/junior.md) or plain JS.

---

## Edge Cases & Pitfalls

### Pitfall 1 — Refetching handles in a loop

`js.Global().Get("document")` inside a render loop crosses the boundary every iteration. Hoist it out.

### Pitfall 2 — Death by a thousand crossings

A loop that does `el.Set(...)` per item looks innocent but multiplies the boundary cost by N. Batch instead.

### Pitfall 3 — Expecting threads

Spawning goroutines does not give you parallelism under wasm. They cooperatively share one thread. A CPU-bound goroutine still blocks everyone.

### Pitfall 4 — Blocking `main`'s exit

If `main` returns, the Go program ends and your callbacks stop firing. Use `select {}` to keep it alive when you have registered JS callbacks.

### Pitfall 5 — Forgetting to copy the matching `wasm_exec.js`

The glue script is version-locked to the toolchain. Using a `wasm_exec.js` from a different Go version causes obscure load failures. Always copy the one from your current `GOROOT`.

### Pitfall 6 — Assuming the binary size is your code

Deleting features barely moves a Go wasm binary; the runtime dominates. Target the runtime (strip, compress, or switch toolchain), not your logic.

### Pitfall 7 — Leaking `js.Func`

`js.FuncOf` registers a callback that JS holds a reference to. If you never `Release()` it, neither side can reclaim it.

### Pitfall 8 — Long compute freezing the page

A 500 ms Go loop on the main thread is a 500 ms frozen UI. The browser cannot even repaint until you yield.

---

## Common Mistakes

- **Putting `js.Global().Get(...)` in hot loops.** Hoist it once.
- **Copying large byte slices element-by-element** across the boundary instead of using `CopyBytesToJS`.
- **Shipping a 2 MB binary uncompressed** and blaming wasm for being slow to load.
- **Assuming goroutines parallelise.** They do not under wasm.
- **Forgetting `select {}`** and watching callbacks silently stop.
- **Treating `js.Value` as a copied value** instead of a live handle.
- **Trying to delete your way to a small binary** instead of stripping and compressing.
- **Leaking `js.Func` callbacks** by never releasing them.

---

## Common Misconceptions

> *"Wasm is always faster than JavaScript."*

No. Compute-heavy code in the box is faster. Boundary-heavy UI code is often *slower* than plain JS because of crossing cost.

> *"`js.Value` holds the JavaScript object in Go memory."*

No. It is a reference across the boundary. Operating on it crosses every time.

> *"My binary is big because my code is big."*

No. The Go runtime and GC dominate. Hello-world is already ~2 MB.

> *"Go wasm can use all my CPU cores."*

No. It runs on a single thread today. No true parallelism.

> *"Compressing the `.wasm` changes how fast it runs."*

No. Compression shrinks the *download*. Once decompressed and compiled, runtime speed is unaffected.

> *"Goroutines don't work in wasm."*

They do — they are just multiplexed onto one thread, so they give concurrency, not parallelism.

---

## Tricky Points

- **A `js.Value` is only valid in the goroutine/event that produced it conceptually** — passing handles around carelessly across async boundaries can surprise you; keep their lifetimes tight.
- **`js.ValueOf` of a Go slice or map allocates a fresh JS object each time.** Reusing a pre-built handle avoids repeated allocation.
- **`Get` on a missing property returns `Undefined`, not an error.** Silent, not loud.
- **The boundary cost is roughly fixed per call**, so 1 call moving 1 MB is far cheaper than 1,000,000 calls moving 1 byte each — even though the total bytes are similar.
- **Stripping with `-s -w` removes debug info**, which makes stack traces less useful. Worth it for production, painful while debugging.
- **`select {}` blocks forever by design** — it is the idiomatic "keep the wasm alive" line, not a bug.

---

## Test

Try this in a scratch folder.

```bash
mkdir wasmperf && cd wasmperf
go mod init example.com/wasmperf
cat > main.go <<'EOF'
package main

import "syscall/js"

func main() {
    js.Global().Get("console").Call("log", "hello from Go wasm")
    select {}
}
EOF
GOOS=js GOARCH=wasm go build -o main.wasm
ls -lh main.wasm
GOOS=js GOARCH=wasm go build -ldflags="-s -w" -o main.stripped.wasm
ls -lh main.stripped.wasm
gzip -9 -c main.stripped.wasm | wc -c
```

Now answer:
1. Roughly how big is the unstripped binary? (Answer: ~2 MB.)
2. How much did `-s -w` save — a little or a lot? (Answer: a few hundred KB; same order of magnitude.)
3. Why is the binary multiple MB despite three lines of code? (Answer: the Go runtime + GC ship inside it.)
4. How many boundary crossings does the `console.log` line make? (Answer: two — one `Get`, one `Call`.)

---

## Tricky Questions

**Q1.** My Go wasm UI is slower than the JavaScript version it replaced. How is that possible?

A. Almost certainly boundary cost. If the code updates the DOM node-by-node, every update is a crossing, and crossings dominate. Wasm wins on compute, not on DOM chatter.

**Q2.** Can I make the binary as small as a JavaScript bundle?

A. Not with standard Go. The runtime floor is ~2 MB. TinyGo gets dramatically smaller but drops parts of the standard library. See [03-tinygo-for-wasm-and-embedded](../03-tinygo-for-wasm-and-embedded/junior.md).

**Q3.** Why does my page freeze when I run a big Go loop?

A. Single thread. The Go loop and the browser's render both want that one thread. The loop wins until it finishes; the UI is frozen meanwhile.

**Q4.** Do I have to copy `wasm_exec.js`, or can I write my own?

A. Copy the one from your `GOROOT`. It is version-locked to the toolchain and implements exactly the syscalls your binary expects.

**Q5.** Is `js.ValueOf(myStruct)` a good idea inside a render loop?

A. No. It allocates a JS object every call and feeds the GC. Build the value once outside the loop, or pass raw bytes via `CopyBytesToJS`.

**Q6.** Does gzip make my program run faster?

A. No. It only shrinks the download. Runtime speed is set after decompression and compilation.

**Q7.** I spawned ten goroutines for a parallel computation. Why is it not faster?

A. There is one thread. The goroutines time-share it. Concurrency, not parallelism.

**Q8.** Where does the boundary cost actually come from?

A. Marshalling Go values to JS values (and back), the function-call indirection through `wasm_exec.js`, and the reference-table bookkeeping that maps `js.Value` handles to real JS objects.

**Q9.** Can JavaScript read my Go variables directly?

A. Not Go variables, but it *can* read your wasm linear memory if you expose it as a `Uint8Array`. That is how zero-copy data sharing works (middle.md).

**Q10.** My callbacks stopped firing after a while. Why?

A. Likely `main` returned, ending the program. Use `select {}`. (Or you released a `js.Func` still in use.)

---

## Cheat Sheet

```bash
# Build for the browser
GOOS=js GOARCH=wasm go build -o main.wasm

# Strip debug info / symbol table (smaller, less debuggable)
GOOS=js GOARCH=wasm go build -ldflags="-s -w" -o main.wasm

# Copy the matching glue script (Go 1.21+ path)
cp "$(go env GOROOT)/lib/wasm/wasm_exec.js" .

# Measure on-disk size and wire size
ls -lh main.wasm
gzip -9 -c main.wasm | wc -c
brotli -q 11 -c main.wasm | wc -c
```

```go
// Boundary essentials
v := js.Global()                  // window
doc := v.Get("document")          // handle (1 crossing)
el := doc.Call("getElementById", "app") // handle (1 crossing)
el.Set("textContent", "hi")       // 1 crossing
js.Global().Set("goFn", js.FuncOf(myFn)) // expose Go to JS
defer fn.Release()                // free a js.Func when done
select {}                         // keep the program alive
```

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| UI slower than JS | Boundary chatter | Batch; keep compute in the box |
| Binary ~2 MB | Runtime + GC | Strip, compress, or use TinyGo |
| Page freezes | Single-thread long loop | Chunk work or offload |
| Callbacks stop | `main` returned | `select {}` |
| Load fails | Mismatched `wasm_exec.js` | Copy from current GOROOT |

---

## Self-Assessment Checklist

You can move on to [middle.md](middle.md) when you can:

- [ ] Explain in one sentence what a boundary crossing is
- [ ] Explain why a `js.Value` is a handle, not a copied value
- [ ] Name the operations that cross the boundary (`Get`, `Set`, `Call`, `Invoke`, `New`, `ValueOf`)
- [ ] Explain why hello-world wasm is ~2 MB
- [ ] Strip a binary and measure its compressed wire size
- [ ] State that Go wasm is single-threaded and what that means for the UI
- [ ] Spot a refetched-handle-in-a-loop and hoist it
- [ ] Explain why compute-heavy code is fast but DOM-heavy code is not
- [ ] Keep a wasm program alive with `select {}`
- [ ] Decide whether a given feature is a good fit for Go wasm

---

## Summary

Compiling Go to WebAssembly puts your code in a sandbox that reaches JavaScript only through `syscall/js` and `wasm_exec.js`. Every `Get`, `Set`, `Call`, or `ValueOf` is a **boundary crossing** with a fixed cost; the single biggest performance lever is to make fewer of them. A `js.Value` is a *handle* to a live JS object, not a copy, so caching handles is cheap and refetching them in loops is wasteful.

The second surprise is size: a Go wasm binary is multiple megabytes because the Go runtime and garbage collector ship inside it, not because your code is large. Stripping with `-ldflags="-s -w"` and serving gzip/brotli-compressed shaves the download but not the order of magnitude.

Go wasm runs on a single thread — goroutines give concurrency, not parallelism — and the GC runs there too, so long computations freeze the UI. The tool shines for compute-heavy, boundary-light work and disappoints for DOM-heavy glue. Match the job to the tool.

---

## What You Can Build

After learning this:

- **A client-side compute widget** (hash, checksum, small parser) that runs Go in the browser with a clean boundary.
- **A "hello, measured" demo** where you report binary size and crossing counts and reason about them.
- **A DOM helper layer** that isolates `syscall/js` so the rest of your Go stays testable.
- **A correctly-served wasm asset** with stripping and compression applied.

You cannot yet:
- Share linear memory with JS via TypedArrays (next: middle.md)
- Use `CopyBytesToGo`/`CopyBytesToJS` for large buffers (middle.md)
- Call host functions via `go:wasmimport` on wasip1 (professional.md, and [02-wasi-and-wasip1](../02-wasi-and-wasip1/junior.md))
- Profile a wasm module systematically (professional.md)

---

## Further Reading

- [`syscall/js` package docs](https://pkg.go.dev/syscall/js) — the authoritative API reference.
- [Go Wiki: WebAssembly](https://go.dev/wiki/WebAssembly) — official getting-started and size notes.
- [`wasm_exec.js` in the Go source tree](https://cs.opensource.google/go/go/+/refs/tags/master:lib/wasm/wasm_exec.js) — read the glue.
- [Go 1.21 release notes (wasm changes)](https://go.dev/doc/go1.21#wasm) — `wasm_exec.js` location move, wasip1 preview.
- [MDN: WebAssembly](https://developer.mozilla.org/en-US/docs/WebAssembly) — what wasm is, from the browser side.

---

## Related Topics

- [16.1 GOOS=js GOARCH=wasm (Browser)](../01-goos-js-wasm-browser/junior.md) — build and load the module
- [16.2 WASI and wasip1](../02-wasi-and-wasip1/junior.md) — the non-browser target and host functions
- [16.3 TinyGo for Wasm and Embedded](../03-tinygo-for-wasm-and-embedded/junior.md) — the small-binary tradeoff
- [16.5 Wasm in Production](../05-wasm-in-production/junior.md) — serving, caching, compression
- 11.x Profiling and benchmarking — measuring Go performance generally

---

## Diagrams & Visual Aids

```
The boundary, conceptually:

   ┌─────────────── wasm sandbox ───────────────┐        ┌──── JavaScript host ────┐
   │  Go code + runtime + GC                     │        │  window, document, ...  │
   │                                             │        │                         │
   │   doc := js.Global().Get("document") ───────┼──────► │  (returns a handle)     │
   │                                             │ ◄──────┼───────                   │
   │   el.Set("textContent", "hi") ──────────────┼──────► │  el.textContent = "hi"  │
   │                                             │        │                         │
   └─────────────────────────────────────────────┘        └─────────────────────────┘
                  ▲ each arrow = one boundary crossing (has a cost)
```

```
Where the megabytes go:

   main.wasm (~2 MB)
   ├── your code .............  ~tens of KB
   ├── Go runtime ............  large
   ├── garbage collector .....  large
   ├── scheduler .............  medium
   └── reflect / stdlib bits .  medium
        (the runtime, not your code, is the file)
```

```
Compute vs chatter:

   GOOD (fast):                       BAD (slow):
   ┌──────────────┐                   ┌──────────────┐
   │ 1 crossing in│                   │  crossing    │
   │              │                   │  crossing    │
   │  big compute │  (in the box)     │  crossing    │  (boundary in
   │   no cross   │                   │  crossing    │   the loop)
   │              │                   │  crossing    │
   │1 crossing out│                   │  ...×N       │
   └──────────────┘                   └──────────────┘
```

```
Single thread, cooperative:

   one JS thread ──[goroutine A]──[goroutine B]──[GC]──[render]──...
                    (take turns; a long task blocks the rest, incl. paint)
```
