# GOOS=js/wasm in the Browser — Interview Questions

> Practice questions ranging from junior to staff-level. Each has a model answer, common wrong answers, and follow-up probes.

---

## Junior

### Q1. How do you compile a Go program for the browser?

**Model answer.** Set two environment variables and build: `GOOS=js GOARCH=wasm go build -o main.wasm`. The output `main.wasm` is a WebAssembly module, not a native binary — it cannot be run from a terminal. To run it you also need Go's glue file `wasm_exec.js` (copied from the toolchain), an HTML page that loads the glue, creates a `Go` instance, instantiates the module, and calls `go.run(instance)`, and an HTTP server that serves the `.wasm` with the `application/wasm` MIME type.

**Common wrong answers.**
- "Just `go build`." (No — that targets your machine.)
- "`./main.wasm` runs it." (No — it needs a host.)
- "You don't need any JavaScript." (You need a small bootstrap.)

**Follow-up.** *Where is `wasm_exec.js`?* — `$(go env GOROOT)/lib/wasm/wasm_exec.js` on modern Go (it moved from `misc/wasm/`).

---

### Q2. Why does an interactive Go wasm program need `select{}` at the end of `main`?

**Model answer.** When `main` returns, the Go runtime signals the program has exited and `wasm_exec.js` tears the instance down — every registered callback becomes a call into a dead program. To keep the program alive so its event listeners keep firing, `main` must not return. `select{}` blocks the main goroutine forever, which parks it and hands control back to the browser's event loop. The page stays responsive because the loop keeps dispatching callbacks.

**Common wrong answers.**
- "`select{}` keeps the CPU busy so the program runs." (No — it parks; it does not spin.)
- "It freezes the page." (No — it parks the goroutine, not the loop.)

**Follow-up.** *What's an alternative to `select{}`?* — Block on a channel you close from a shutdown callback, giving a clean exit path for cleanup.

---

### Q3. What is `syscall/js` and what is `js.Value`?

**Model answer.** `syscall/js` is the standard-library package that bridges Go and JavaScript on the wasm target. `js.Value` is an opaque handle to a JavaScript value — an object, function, number, string, etc. It is a reference, not a copy: holding the `js.Value` for `document` does not copy the DOM into Go. You reach JS through `js.Global()` (the `window` object) and navigate with `Get`/`Set`/`Call`.

**Follow-up.** *Do `Get`/`Set`/`Call` cross the boundary?* — Yes, each one is a round trip across the Go↔JS boundary; the conversion methods (`Int`, `String`, …) are cheaper.

---

### Q4. Why is `main.wasm` several megabytes for a hello-world?

**Model answer.** The Go runtime and garbage collector are compiled into every binary. Even a trivial program ships the whole runtime, so the baseline is multiple megabytes uncompressed. This is expected, not a build mistake. You reduce it by stripping debug info (`-ldflags="-s -w"`), serving compressed (brotli/gzip), and, for size-critical cases, using TinyGo.

**Follow-up.** *Does compression change the file Go reads?* — No; the browser decompresses transparently and compiles the original bytes. Compression is a serving concern that shrinks download time.

---

### Q5. Can you read a file from disk with `os.Open` on `GOOS=js`?

**Model answer.** No. `GOOS=js` means JavaScript is the operating system and the browser provides no real file system. `os.Open` against a real path does not work. To read a file the user picked, you go through the browser's File API via `syscall/js`. One convenience the runtime does provide: Go's `net/http` *client* is wired to the browser's `fetch`, so `http.Get` works (subject to CORS).

**Follow-up.** *Does `net.Dial` work?* — No. There are no sockets. The non-browser wasm target with a virtual FS is WASI (`GOOS=wasip1`).

---

## Middle

### Q6. When must you call `Func.Release()`, and what happens if you don't?

**Model answer.** `js.FuncOf` registers your Go closure in a table inside the glue so JS can call it by id. That registration is invisible to Go's garbage collector, so the closure and its captured state live forever unless you call `Release()`. For a session-long listener registered once in `main`, you can skip release — the count is fixed. For ephemeral callbacks (a one-shot Promise resolver, a per-render handler), you must release after the last invocation, or you leak monotonically and the tab eventually crashes.

**Common wrong answer.** "Go's GC frees it." (No — the global registration keeps it reachable.)

**Follow-up.** *What happens if you release too early?* — Calling a released `Func` panics. Release only after the last call.

---

### Q7. Why does awaiting a `fetch` synchronously inside a click handler deadlock?

**Model answer.** Awaiting a Promise means bridging its `then`/`catch` into a channel and receiving on that channel. The resolve callback that fills the channel can only run as a *new* event-loop task — after the current handler returns control to the loop. If the handler blocks on the channel receive, it never returns, so the resolver never runs, so the channel never receives. Deadlock. The fix is to run the await on a goroutine (`go func(){ ... }()`), letting the handler return immediately and the resolver run later.

**Follow-up.** *Does spawning a goroutine give parallelism here?* — No, it gives concurrency. The goroutine parks on the channel and yields the loop; it does not run on a second thread.

---

### Q8. How do you move a `[]byte` across the boundary efficiently?

**Model answer.** With `js.CopyBytesToGo(dst, src)` and `js.CopyBytesToJS(dst, src)`. These move the whole buffer in a single bulk copy directly through the module's linear memory. The JS side must be a `Uint8Array`. The wrong way — `SetIndex` per byte — is one boundary crossing per byte, catastrophic for anything but tiny buffers. Note `js.ValueOf` does not accept `[]byte` at all, so there is no per-element shortcut anyway.

**Follow-up.** *Why must the JS side be a `Uint8Array`?* — The implementation constructs a typed-array view over linear memory and `set`s into it; it needs a byte-typed array.

---

### Q9. Explain the single-threaded execution model. Why does `select{}` not freeze the page but `for {}` does?

**Model answer.** Go on wasm runs one M and one P — one thread, one event loop. Goroutines are concurrent but never parallel. Blocking primitives like `select{}` and channel receives *park* the goroutine; when nothing is runnable the runtime returns control to the JS event loop, which stays free to paint and dispatch callbacks. A `for {}` busy loop never blocks, so the goroutine stays runnable, the scheduler never parks, control never returns to the loop, and the tab freezes. Parking yields; spinning starves.

**Follow-up.** *How do you run CPU-heavy work without jank?* — Chunk it and yield via `requestAnimationFrame`, or move it to a Web Worker (a second instance) for true parallelism.

---

### Q10. What does `js.ValueOf` accept, and what happens with a Go struct?

**Model answer.** `ValueOf` accepts `nil`, `bool`, integers and floats, `string`, `[]any` (→ JS array), `map[string]any` (→ JS object), and existing `Value`/`Func`. It panics on anything else — including a `[]byte` and an arbitrary Go struct. To pass a struct to JS, marshal it: build a `map[string]any`, or `json.Marshal` it to a string, or to bytes and `CopyBytesToJS`. `Get`/`Set`/`Call` apply `ValueOf` to arguments, so they inherit the same restriction.

**Follow-up.** *Which conversions panic on the way back?* — `Int`, `Float`, `Bool` panic on a type mismatch; `Truthy` never does. Guard optional reads with `Type()` or `Truthy()`.

---

### Q11. What breaks when `wasm_exec.js` doesn't match the toolchain that built the `.wasm`?

**Model answer.** The glue and the binary share an internal ABI — the set of imported host functions, the memory layout, and the value-table protocol — that changes between Go versions. A mismatched pair produces obscure runtime failures, not a clean error: the module calls functions the glue does not provide, or arguments are marshalled differently than the runtime expects. The fix is to copy `wasm_exec.js` from the *building* toolchain on every build and pin the Go version for reproducibility.

**Follow-up.** *What changed about the glue's location recently?* — It moved from `misc/wasm/wasm_exec.js` to `lib/wasm/wasm_exec.js`. Scripts hard-coding the old path break on upgrade.

---

### Q12. How do you expose a Go function to JavaScript, and how should the API be shaped?

**Model answer.** Wrap it with `js.FuncOf` and set it on a namespace object: `js.Global().Set("goApp", api)` where `api` has `validate`, `render`, etc. Shape the surface coarsely — each function does a meaningful unit of work so the boundary is crossed once per operation — and pass plain data (objects, strings, `Uint8Array`) so the JS side does not need to know Go exists. For async work, return a Promise constructed with `Promise.New(executor)` and resolve it from a goroutine.

**Follow-up.** *Why coarse rather than many small functions?* — Every call crosses the expensive boundary; coarse operations amortise the cost and keep the JS↔Go contract small.

---

## Senior

### Q13. When do you choose Go wasm over plain JavaScript for a feature?

**Model answer.** The justification must be substantial reused Go logic, not a dislike of JavaScript. Choose Go wasm when you have an existing Go library (parser, crypto, domain rules) to reuse without a rewrite, or when server and client must share rules that change often and must never diverge, or when the work is genuinely compute-bound so the multi-megabyte runtime baggage amortises against real work. Choose plain JS when the work is light DOM glue, when first-load size is a hard constraint (public pages), or when there is no Go to reuse. Reaching for Go wasm where plain JS would do is the most common over-engineering mistake here.

**Follow-up.** *What's the dominant cost?* — The megabyte download and the per-crossing boundary cost. Both must be outweighed by the reused-logic value.

---

### Q14. How does the boundary cost shape your architecture?

**Model answer.** The Go↔JS boundary is expensive per *crossing*, not per byte, so you design coarse: do the work in Go and cross once. Building an HTML string in Go and assigning `innerHTML` once beats setting `innerText` per cell in a loop; handing JS one structured object beats a hundred property writes; moving bytes with `CopyBytes*` beats per-element copies. The mental model is a network call — you batch instead of making a thousand tiny requests. Cache `js.Value` handles for repeatedly-touched objects so you do not re-`Get` them in hot paths.

**Follow-up.** *Why is a number cheaper to pass than a string?* — `js.Value` is NaN-boxed; numbers are encoded inline, while strings and objects require a marshalling step through linear memory and the value table.

---

### Q15. How do you keep a long-lived Go wasm SPA from leaking memory?

**Model answer.** Make `js.Func` release discipline systematic. Distinguish session-long callbacks (registered once in `main`, never released, bounded count) from ephemeral ones (per-request, per-render, per-component) which must be released after their last invocation, ideally by the same scope that creates them. Detach dynamically-added listeners with `removeEventListener` plus `Release()` on unmount. Soak-test by mounting/unmounting thousands of times and watching heap growth. Remember that wasm linear memory only ever grows — it never returns pages to the browser — so a peak working set is permanent and leaks compound the floor.

**Follow-up.** *Why doesn't Go's GC catch the `js.Func` leak?* — The closure is held by a JS-side registration the GC cannot see; it stays reachable from a live global map.

---

### Q16. A panic happens inside a `js.FuncOf` callback. What is the blast radius, and how do you contain it?

**Model answer.** A panic that unwinds out of a callback into the JS-invoked wrapper takes the **whole wasm instance** down — not just a goroutine. The Go side of the page is dead; every other callback stops working. To contain it, recover at the top of every exported callback so a single bad input cannot kill the app, and return errors as data (a result object with an `error` field, or a rejected Promise) rather than panicking. Sanitize recovered panic messages before surfacing them — they may contain paths or sensitive state.

**Follow-up.** *Is that different from a panic in a goroutine on a normal Go program?* — Yes; there a goroutine panic crashes the process, but here the instance is the process and the callback boundary is where you must recover.

---

### Q17. Walk through the load sequence and how you optimize time-to-interactive.

**Model answer.** The user waits for: download the `.wasm` → compile → run `main` → register the API. Until that finishes the Go side is inert. To optimize: stream-compile with `instantiateStreaming` so compilation overlaps download (needs the `application/wasm` MIME); compress on the wire with brotli/gzip (the largest lever on download time); show a loading state until `go.run` has registered the API so controls are not dead-but-visible; content-hash the filename for long immutable caching; and lazy-load the module if it backs a feature the user may never reach, keeping the landing page light.

**Follow-up.** *What if you can't set the MIME type on a CDN?* — Use the buffered fallback: `fetch` → `arrayBuffer()` → `WebAssembly.instantiate`. It loses the streaming overlap but works without the header.

---

### Q18. What are the security implications of shipping a Go wasm bundle?

**Model answer.** The binary is downloaded to every visitor and is fully inspectable — never embed secrets (API keys, tokens, proprietary logic); `-ldflags="-s -w"` strips symbols but not logic. Client-side validation is a UX feature, not a security boundary: a user can bypass the wasm and call your API directly, so every authoritative check must run server-side (which is exactly why sharing Go validation between client and server is convenient — the server copy is the trusted one). CORS and same-origin govern Go's `fetch`-backed HTTP client just as they govern JS. Use content-hashed `.wasm` names and SRI on `wasm_exec.js` to pin and detect tampering, and sanitize recovered-panic output so it does not leak internals to the DOM.

**Follow-up.** *The wasm runs with what privileges?* — Exactly the page's JS privileges, no more — it is in the same sandbox.

---

## Staff / Architect

### Q19. Design the build and deploy pipeline for a production Go wasm front end.

**Model answer.** Stages:

1. **Build** with a pinned Go toolchain: `GOOS=js GOARCH=wasm go build -ldflags="-s -w" -trimpath -o main.wasm`.
2. **Glue** copied from the *building* toolchain every build (`$(go env GOROOT)/lib/wasm/wasm_exec.js`), versioned with the binary as one artefact — never a stale committed copy.
3. **Content-hash** both `main.<hash>.wasm` and the glue for immutable caching.
4. **Compress** to brotli + gzip variants at build time; serve with `Content-Encoding`.
5. **Serve** with `application/wasm` MIME (configure the CDN explicitly — defaults often wrong) and long immutable cache headers; SRI on the glue.
6. **Verify** in CI: build succeeds, the page boots under a headless browser, binary size is under budget (fail the build if it regresses), and a smoke test exercises the exported API.

The glue/binary version coupling and CDN MIME config are the two things that most often break in production. Treat them as gated checks.

**Follow-up.** *How do you catch a size regression?* — A CI step that diffs `du` of the compressed `.wasm` against a budget and fails the build past a threshold.

---

### Q20. When would you reach for TinyGo or Web Workers instead of the standard toolchain on the main thread?

**Model answer.** **TinyGo** when binary size is the binding constraint — it produces binaries an order of magnitude smaller via a lighter runtime — *and* your code stays within its supported language/stdlib subset (limited reflection, fewer packages, its own `syscall/js` quirks). Use the standard toolchain when you need full language and stdlib fidelity. **Web Workers** when you have sustained CPU-bound work that would jank the main thread: run a wasm instance inside a worker so the main thread stays responsive, paying a message-passing (structured-clone) boundary and a second instance's memory. This is the only path to true parallelism, since goroutines are concurrent-only. **Plain JS** when the work is light and DOM-bound — often the right answer.

**Follow-up.** *Can goroutines give you parallelism to avoid a worker?* — No. One P, one thread; CPU-bound goroutines interleave and still starve the loop. A worker is the only real offload.

---

### Q21. How do you decide where to draw the JS↔Go boundary in a hybrid app?

**Model answer.** Keep DOM-heavy, event-driven UI in JavaScript (or a normal front-end framework) where it is small and idiomatic, and push only the substantial compute or shared-rules logic into Go behind a small, coarse API. The boundary should sit at a *coarse seam*: a few functions that each do a meaningful unit of work (validate a form, render a document, transform a buffer), passing plain data. Avoid a chatty design where JS drives Go through fine-grained calls — that pays boundary cost with nothing to amortise. The litmus test: each crossing should carry a batch of work, not a single property access.

**Follow-up.** *How do you expose async Go work to a JS framework cleanly?* — Return Promises from the exported functions; the framework consumes them like any other async API and never sees `syscall/js`.

---

### Q22. A production Go wasm page works in dev but janks and occasionally crashes the tab in the field. How do you diagnose it?

**Model answer.** Three suspects, checked with the browser's tools:

1. **Jank → main-thread blocking.** A synchronous Go computation exceeding the frame budget. The Performance panel shows long tasks; find the non-yielding loop and chunk it via `requestAnimationFrame` or offload to a Web Worker. Goroutines won't help — one thread.
2. **Crash over time → leak.** Unreleased `js.Func`s (per-event or per-render) grow the heap; combined with linear memory never shrinking, the tab eventually OOMs. The Memory panel's heap snapshots over time confirm growth; audit `FuncOf`/`Release` pairing and listener teardown.
3. **Occasional dead page → panic in a callback.** An unrecovered panic took down the whole instance. The console shows the panic (build dev without `-w` for a readable trace); add recover at callback boundaries and return errors as data.

Dev hides all three because sessions are short, inputs are clean, and the dataset is small. Reproduce with a soak test and adversarial inputs.

**Follow-up.** *Why does the same code never crash in dev?* — Short sessions never accumulate the leak, clean inputs never hit the panicking path, and small datasets never blow the frame budget.

---

## Quick-fire

| Q | Crisp answer |
|---|--------------|
| Build command? | `GOOS=js GOARCH=wasm go build -o main.wasm` |
| Where is the glue? | `$(go env GOROOT)/lib/wasm/wasm_exec.js` (moved from `misc/wasm`) |
| Why `select{}`? | `main` returning tears down the instance |
| `Func.Release()` needed? | Yes for ephemeral callbacks; leaks otherwise |
| Goroutines parallel? | No — concurrent on one thread |
| Move `[]byte`? | `CopyBytesToGo` / `CopyBytesToJS` (Uint8Array) |
| Does `os.Open` work? | No file system on `GOOS=js` |
| Does `http.Get` work? | Yes — client wired to `fetch` (CORS applies) |
| Await a Promise? | Bridge `then`/`catch` to a channel, on a goroutine |
| `instantiateStreaming` needs? | `application/wasm` MIME type |
| Panic in a callback? | Kills the whole instance — recover at the boundary |
| Reduce binary size? | `-ldflags="-s -w"`, compress, TinyGo |

---

## Mock Interview Pacing

A 30-minute interview on Go browser-wasm might cover:

- 0–5 min: warm-up — Q1, Q2, Q3.
- 5–15 min: middle topics — Q6, Q7, Q9, Q11.
- 15–25 min: a senior scenario — Q14, Q15, or Q16.
- 25–30 min: a curveball — Q19 or Q22.

If the candidate claims hands-on experience, drive straight to Q7 (the await deadlock) and Q15 (the `js.Func` leak) — both are field-test questions that separate readers from builders. If they have only read about it, stay in middle territory and probe whether they understand the single-threaded loop (Q9) and the release discipline (Q6). A staff candidate should reach the pipeline design (Q19) or the field-debugging scenario (Q22) within fifteen minutes, and should volunteer the TinyGo / Web Worker trade-offs (Q20) unprompted.
