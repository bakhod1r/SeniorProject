# GOOS=js/wasm in the Browser — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [The Go-wasm-or-Not Decision: First Principles](#the-go-wasm-or-not-decision-first-principles)
3. [The Boundary Is the Architecture](#the-boundary-is-the-architecture)
4. [Designing the JS↔Go API Surface](#designing-the-jsgo-api-surface)
5. [Binary Size as a Product Constraint](#binary-size-as-a-product-constraint)
6. [The Single Thread and the Jank Budget](#the-single-thread-and-the-jank-budget)
7. [Lifecycle and Leak Discipline at Scale](#lifecycle-and-leak-discipline-at-scale)
8. [Error Propagation Across the Boundary](#error-propagation-across-the-boundary)
9. [Loading Strategy and Time-to-Interactive](#loading-strategy-and-time-to-interactive)
10. [Versioning the Glue and the Module Together](#versioning-the-glue-and-the-module-together)
11. [Security Posture of a Shipped wasm Bundle](#security-posture-of-a-shipped-wasm-bundle)
12. [Alternatives: TinyGo, Web Workers, and Plain JS](#alternatives-tinygo-web-workers-and-plain-js)
13. [Anti-Patterns](#anti-patterns)
14. [Senior-Level Checklist](#senior-level-checklist)
15. [Summary](#summary)

---

## Introduction

A senior engineer's question is never "can Go run in the browser" — it can — but "should this particular work be Go in the browser, and if so, where do I draw the boundary so the megabyte download and the boundary-crossing cost buy more than they cost." The mechanics are in [junior.md](junior.md) and [middle.md](middle.md). This file is about the design and the trade-offs.

Go-to-browser-wasm is a *targeted* tool. It shines when you have substantial Go logic — a parser, a crypto routine, a domain validator, a simulation — that you want to run client-side without rewriting it in JavaScript, and where the logic's value dwarfs the runtime's baggage. It is the wrong tool for a button that toggles a class.

After reading this you will:
- Decide whether to compile a given workload to Go wasm based on size, boundary cost, and reuse
- Design the JS↔Go API surface so the boundary is crossed coarsely, not chattily
- Treat binary size and time-to-interactive as product constraints with concrete budgets
- Reason about the single-threaded jank budget and where to offload work
- Manage `js.Func` lifecycle and error propagation across a real codebase
- Choose between the standard toolchain, TinyGo, Web Workers, and not using Go at all

---

## The Go-wasm-or-Not Decision: First Principles

The decision reduces to three real questions.

### What does Go wasm actually buy you?

1. **Code reuse without rewrite.** A validation library, a Markdown renderer, a financial-rules engine that already exists in Go can run client-side verbatim. The alternative — maintaining a second JavaScript implementation that must stay bug-for-bug compatible — is a recurring tax. Go wasm eliminates the divergence.
2. **One source of truth for shared logic.** Validation, parsing, and business rules that run on both server and client stay identical because they are the same code. This is the strongest argument and the most common justification in practice.
3. **Client-side compute in a typed, GC'd language.** CPU-heavy work — image processing, compression, a discrete simulation — runs in the browser with Go's concurrency model and standard library, no backend round-trip.

### What does it cost you?

- **Megabytes of download.** The Go runtime and GC are bundled into every binary. A trivial program is multiple megabytes uncompressed. This is the dominant cost and is covered as a budget below.
- **Boundary cost.** Every `Get`/`Set`/`Call` is a round trip. Chatty DOM code is slow regardless of how fast the Go logic is.
- **A second toolchain in the build.** The deploy pipeline grows a wasm build step, a glue-file copy, content-hashing, and compression. Operationally this is real surface — see [05-wasm-in-production](../05-wasm-in-production/).
- **No threads.** Single-threaded execution caps what client-side compute can do without Web Workers.

### When the answer is yes

- You have substantial, existing Go logic that would be expensive and error-prone to port to JS.
- Server and client must share rules that change often and must never diverge.
- The workload is compute-bound (the runtime baggage amortises against real work).
- The product can absorb a multi-megabyte first load (internal tools, dashboards, apps behind a login).

### When the answer is no

- The logic is trivial UI glue; plain JavaScript is smaller and simpler.
- First-load size is a hard product constraint (public marketing pages, low-bandwidth markets).
- The work is DOM-manipulation-heavy and compute-light; you will pay boundary cost with nothing to amortise it against.
- You need true multi-threaded parallelism in the browser today.

The senior framing: **Go wasm is justified by the Go logic, not by the desire to avoid JavaScript.** If the answer to "what substantial Go are we reusing" is "none," reconsider.

---

## The Boundary Is the Architecture

The defining performance characteristic of Go wasm is that the Go↔JS boundary is expensive, and the cost is *per crossing*, not per byte. This single fact dictates the architecture: **design so the boundary is crossed coarsely.**

A chatty design crosses the boundary thousands of times for fine-grained operations:

```go
// Anti-pattern: one crossing per cell
for i := 0; i < rows; i++ {
    for j := 0; j < cols; j++ {
        table.Call("rows").Index(i).Call("cells").Index(j).Set("innerText", data[i][j])
    }
}
```

A coarse design does the work in Go and crosses once:

```go
// Build the whole HTML in Go memory, cross the boundary once
var b strings.Builder
renderTable(&b, data)
container.Set("innerHTML", b.String())
```

The same principle governs data exchange: hand JS one structured object or one byte buffer, not a hundred property writes. The mental model is a network call — you would not make a thousand tiny HTTP requests where one batched request would do, and the boundary has the same shape. Everything in [04-wasm-interop-and-performance](../04-wasm-interop-and-performance/) is downstream of this principle.

---

## Designing the JS↔Go API Surface

Expose Go to JavaScript through a small, deliberate surface — a handful of functions registered on a single namespace, not a sprawl of globals.

```go
func main() {
    api := js.Global().Get("Object").New()
    api.Set("validate", js.FuncOf(validate))
    api.Set("render", js.FuncOf(render))
    api.Set("hash", js.FuncOf(hash))
    js.Global().Set("goApp", api) // one namespace, three coarse entry points

    select {}
}
```

JS then calls `goApp.validate(payload)`. Design principles for the surface:

- **Coarse, not chatty.** Each exported function should do a meaningful unit of work — validate a whole form, render a whole view, hash a whole buffer — so the boundary is crossed once per operation.
- **Plain data in, plain data out.** Accept and return JS objects, strings, and `Uint8Array`s — types `ValueOf` and `CopyBytes` handle — not Go-specific structures. The JS side should not need to know Go exists.
- **Synchronous unless it must be async.** A pure computation can return its result directly. Anything that awaits (`fetch`, file reads) must return a Promise; construct one with `js.Global().Get("Promise").New(executor)` and resolve it from a goroutine.
- **Stable signatures.** The exported names and shapes are an API contract with the JS side. Treat changes as you would any API change — versioned, documented.

Returning a Promise from Go is the idiomatic way to expose async work:

```go
func fetchData(this js.Value, args []js.Value) any {
    handler := js.FuncOf(func(this js.Value, pArgs []js.Value) any {
        resolve, reject := pArgs[0], pArgs[1]
        go func() {
            result, err := doWork()
            if err != nil {
                reject.Invoke(err.Error())
                return
            }
            resolve.Invoke(result)
        }()
        return nil
    })
    // handler is one-shot per call; release it after the executor runs is unsafe
    // because the goroutine may outlive it — release inside the goroutine instead.
    return js.Global().Get("Promise").New(handler)
}
```

---

## Binary Size as a Product Constraint

A Go wasm binary is large because the runtime and GC ship inside it. Treat size as a budget, not an afterthought.

### The levers, in order of impact

1. **Strip debug info.** `-ldflags="-s -w"` removes the symbol table and DWARF debug info. Meaningful reduction, no functional cost (you lose readable stack traces).
2. **Compress for transport.** Brotli or gzip on the `.wasm` typically cuts the wire size by 60–70%. This is the single biggest win for *download* time and is purely a serving concern. The server must send `Content-Encoding` and the browser decompresses; the decompressed size is unchanged.
3. **Trim the dependency tree.** Every imported package that pulls in `reflect`, `fmt`'s full formatter, `regexp`, or `time/zoneinfo` adds weight. Audit what the binary actually needs.
4. **Consider TinyGo** for size-critical cases — it produces dramatically smaller binaries at the cost of language/stdlib compatibility (see [Alternatives](#alternatives-tinygo-web-workers-and-plain-js)).

Detailed measurement and the full set of flags live in [04-wasm-interop-and-performance](../04-wasm-interop-and-performance/) and in this topic's [optimize.md](optimize.md). The senior point is that "the binary is 8 MB" is a number you own, with a budget and a compression pipeline, not a fact you accept.

### Size affects the architecture too

A large binary makes lazy-loading attractive: do not ship the wasm on the landing page; load it when the user reaches the feature that needs it. This trades a longer time-to-first-interaction-with-the-feature for a faster initial page. Whether that trade is right is a product decision.

---

## The Single Thread and the Jank Budget

Go wasm runs on the browser's one main thread. A frame is ~16ms at 60fps. Any synchronous Go computation that exceeds the frame budget *blocks paint and input* — the page janks or freezes.

The discipline: **no synchronous Go computation may exceed a few milliseconds on the main thread.** Longer work must either:

- **Be chunked** and yielded between frames via `requestAnimationFrame` or `setTimeout(0)`, letting the event loop paint and process input between chunks.
- **Be moved to a Web Worker** running its own wasm instance, communicating with the main thread by message-passing. This is the only path to true parallelism, and it requires a separate instance and a serialization boundary.

```go
// Cooperative chunking: process N items per frame, yield in between
func processChunked(items []Item) {
    const perFrame = 200
    var i int
    var step js.Func
    step = js.FuncOf(func(this js.Value, args []js.Value) any {
        end := min(i+perFrame, len(items))
        for ; i < end; i++ {
            process(items[i])
        }
        if i < len(items) {
            js.Global().Call("requestAnimationFrame", step)
        } else {
            step.Release() // done; free the one-shot
        }
        return nil
    })
    js.Global().Call("requestAnimationFrame", step)
}
```

The trap senior engineers must catch in review: a goroutine does **not** rescue you here. Goroutines are concurrent, not parallel; a CPU-bound goroutine still consumes the one thread. The only real offload is a Web Worker.

---

## Lifecycle and Leak Discipline at Scale

In a small demo, leaking `js.Func`s does not matter — there are a fixed handful. In a long-lived single-page app, it is a slow memory leak that crashes the tab after hours of use. The senior responsibility is to make the discipline systematic, not ad hoc.

- **Distinguish session-long from ephemeral callbacks by construction.** Session-long listeners (registered once in `main`) are never released. Ephemeral callbacks (per-request resolvers, per-render handlers) must be released. Encode the distinction in the code's structure so reviewers can see it.
- **Own the release in the same scope that creates it.** A `js.Func` created for a one-shot Promise should be released by the goroutine that resolves the Promise, not left to chance.
- **Detach listeners you attach dynamically.** `addEventListener` without a matching `removeEventListener` plus `Release()` leaks both the JS listener and the Go callback when components unmount.
- **Test for leaks.** A soak test that mounts and unmounts a component thousands of times and watches heap growth catches what code review misses. Memory-leak detection on wasm is the same discipline as in any long-lived runtime.

The systemic risk is that leak discipline is invisible until production. A senior engineer treats `Release()` the way they treat closing files or cancelling contexts — a resource lifecycle that must be owned, not hoped for.

---

## Error Propagation Across the Boundary

Errors do not cross the Go↔JS boundary for free; you design the propagation.

- **A panic in a `js.FuncOf` callback crashes the whole instance.** Unlike a panic in a goroutine that only kills that goroutine on a normal Go program, a panic that unwinds out of a callback into the JS runtime takes the instance down. The page's Go side is dead. **Recover at the top of every exported callback** if a single bad input must not kill the app:

  ```go
  func safe(fn func(js.Value, []js.Value) any) js.Func {
      return js.FuncOf(func(this js.Value, args []js.Value) any {
          defer func() {
              if r := recover(); r != nil {
                  reportToJS(fmt.Sprintf("internal error: %v", r))
              }
          }()
          return fn(this, args)
      })
  }
  ```

- **Return errors as data, not panics.** An exported function that can fail should return a result object with an `error` field, or reject a Promise — not panic. JS code expects to handle errors, not to have the runtime die.
- **Do not leak internals.** A recovered panic's message may contain stack details, file paths, or sensitive values. Sanitize what you surface to the DOM or to JS callers.

---

## Loading Strategy and Time-to-Interactive

The user waits for: download the `.wasm` → compile it → run `main` → register callbacks. Until that completes, the Go side is inert. The senior concern is the perceived and actual time-to-interactive.

- **Stream-compile** with `instantiateStreaming` so compilation overlaps download. This requires the `application/wasm` MIME type; the [non-streaming fallback](middle.md) buffers the whole module first and is slower.
- **Compress on the wire** (brotli/gzip) so the download phase shrinks; this is the largest lever on time-to-interactive.
- **Show a loading state** until `go.run` has executed and the app has registered its API. The DOM should not present interactive controls that silently do nothing because Go has not booted yet.
- **Lazy-load the module** if it backs a feature the user may never reach. The landing page stays light; the wasm loads on demand.
- **Cache aggressively with content-hashed filenames** (`main.<hash>.wasm`). The bundle is large and immutable per release; long cache lifetimes plus hash-based invalidation give you fast repeat visits without stale-code risk.

---

## Versioning the Glue and the Module Together

`wasm_exec.js` and `main.wasm` share an internal ABI that changes between Go releases. A `main.wasm` built with Go 1.23 and a `wasm_exec.js` from Go 1.21 will fail in obscure ways. The senior discipline:

- **Treat the pair as one artefact.** They are produced by the same toolchain, deployed together, and content-hashed together. Never source `wasm_exec.js` from a CDN that floats while pinning the binary.
- **Regenerate the glue in the build, never commit a stale copy.** The build script copies `wasm_exec.js` from the building toolchain (`$(go env GOROOT)/lib/wasm/wasm_exec.js` on modern Go) every time it builds the binary.
- **Pin the Go toolchain.** A reproducible wasm build pins the Go version (the `toolchain` directive plus a fixed CI image) so the glue and binary always match.
- **Watch for the path move.** The glue relocated from `misc/wasm/` to `lib/wasm/` in newer Go. Build scripts that hard-code the old path break silently on upgrade.

This is the wasm analogue of any ABI-coupling problem: two artefacts that must be versioned in lockstep, with the build as the enforcement point.

---

## Security Posture of a Shipped wasm Bundle

The `.wasm` runs in the page's sandbox with exactly the page's privileges — no more. But "shipped to the client" has the usual consequences:

- **The binary is fully public and inspectable.** It is downloaded to every visitor. Anything compiled in — API keys, tokens, proprietary algorithms — is readable. Never embed secrets. `-ldflags="-s -w"` strips symbols but does not hide logic.
- **Client-side validation is a UX feature, not a security boundary.** A user can bypass the wasm entirely and call your API directly. Every authoritative check must run server-side. Shared Go validation between client and server is convenient precisely because the server copy is the one that is trusted.
- **CORS and same-origin still apply.** Go's `http.Get` on wasm goes through `fetch`; the browser's origin policy governs it exactly as it governs JS.
- **Integrity of the assets.** Subresource Integrity (SRI) on `wasm_exec.js` and content-hashed `.wasm` filenames let you detect tampering and pin exactly which bytes run.
- **Recovered panics must not leak internals** to the DOM (see [Error Propagation](#error-propagation-across-the-boundary)).

---

## Alternatives: TinyGo, Web Workers, and Plain JS

A senior engineer considers the alternatives before reaching for the standard toolchain.

### TinyGo

TinyGo compiles Go to wasm with a much smaller runtime, producing binaries an order of magnitude smaller. The cost: it implements a *subset* of the language and standard library — reflection is limited, some packages are unsupported, and `syscall/js` support has its own quirks. Use TinyGo when binary size is the binding constraint and your code stays within its supported surface; use the standard toolchain when you need full language and stdlib fidelity. The detailed comparison lives in [04-wasm-interop-and-performance](../04-wasm-interop-and-performance/).

### Web Workers

The only path to true parallelism. Run a Go wasm instance inside a Web Worker; the main thread stays responsive while the worker computes. The cost is a message-passing boundary (structured-clone serialization) and a second instance's memory. Worth it for sustained CPU-bound work that would otherwise jank the main thread.

### Plain JavaScript

Often the right answer. If the work is light and DOM-bound, or the team has no substantial Go to reuse, plain JS (or a normal front-end framework) is smaller, simpler, and has no boundary cost. Choosing Go wasm where plain JS would do is the most common over-engineering mistake in this space.

---

## Anti-Patterns

- **Reaching for Go wasm to "avoid writing JavaScript."** The justification must be substantial reused Go logic, not language preference. You will still write JS to bootstrap.
- **A chatty boundary.** Thousands of `Get`/`Set`/`Call` crossings in a loop. Build the result in Go and cross once.
- **CPU-bound goroutines on the main thread "for parallelism."** They interleave on one thread; no speedup, and they still jank the page. Use a Web Worker or chunk the work.
- **Leaking `js.Func`s in a long-lived SPA.** A slow memory leak that crashes the tab after hours. Own the release lifecycle.
- **Panicking out of callbacks.** Takes down the whole instance. Recover at the top of exported callbacks; return errors as data.
- **Committing a stale `wasm_exec.js`.** The glue must match the toolchain that built the binary. Regenerate in the build.
- **Embedding secrets in the binary.** It is downloaded to every client and fully inspectable.
- **Treating client-side validation as a security boundary.** It is a UX nicety; the server is the authority.
- **Shipping a multi-megabyte binary on a public landing page** without compression, lazy-loading, or a size budget.
- **Ignoring time-to-interactive.** No loading state, no streaming compile, no compression — the user stares at dead controls.

---

## Senior-Level Checklist

- [ ] Justify Go wasm by substantial reused Go logic or shared client/server rules, not by avoiding JS
- [ ] Design a coarse JS↔Go API surface on one namespace; cross the boundary once per operation
- [ ] Set a binary-size budget; strip with `-ldflags="-s -w"` and compress with brotli/gzip
- [ ] Keep main-thread synchronous work under the frame budget; chunk or offload to a Web Worker
- [ ] Make `js.Func` release discipline systematic; soak-test for leaks
- [ ] Recover panics at the top of exported callbacks; return errors as data, sanitized
- [ ] Stream-compile, show a loading state, lazy-load, and content-hash the bundle
- [ ] Version `wasm_exec.js` and `main.wasm` as one artefact; pin the toolchain
- [ ] Embed no secrets; keep authoritative validation server-side
- [ ] Evaluate TinyGo, Web Workers, and plain JS before committing to the standard toolchain

---

## Summary

Compiling Go to browser wasm is a targeted architectural choice, not a default. It earns its place when there is substantial Go logic to reuse or shared client/server rules that must never diverge, and where the workload's value amortises the multi-megabyte runtime baggage and the per-crossing boundary cost. Where the work is light, DOM-bound, or has no Go to reuse, plain JavaScript is the better answer.

The boundary is the architecture: design coarse exported functions on a single namespace, pass plain data and byte buffers, and build results in Go so the Go↔JS boundary is crossed once per operation rather than thousands of times. Treat binary size as a budget with stripping and compression; treat the single thread as a hard jank constraint that goroutines cannot escape — only chunking or a Web Worker can. Make `js.Func` release discipline systematic to avoid the slow leak that crashes a long-lived SPA, recover panics so a bad input cannot kill the instance, and version the glue and the binary together as one toolchain-pinned artefact. The binary is public and untrusted, so embed no secrets and keep the server as the validation authority. Get those decisions right and Go wasm delivers reused, typed, client-side compute; get them wrong and it delivers an 8 MB download that janks the page.
