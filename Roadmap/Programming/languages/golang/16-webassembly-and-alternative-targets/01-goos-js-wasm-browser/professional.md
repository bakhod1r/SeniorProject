# GOOS=js/wasm in the Browser — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [What `go.run` Actually Does, Step by Step](#what-gorun-actually-does-step-by-step)
3. [The `wasm_exec.js` Glue: the Syscall Bridge](#the-wasm_execjs-glue-the-syscall-bridge)
4. [How `js.Value` Is Represented Internally](#how-jsvalue-is-represented-internally)
5. [The `js.Func` Reference Table and Why `Release()` Is Mandatory](#the-jsfunc-reference-table-and-why-release-is-mandatory)
6. [The Scheduler on a Single Thread](#the-scheduler-on-a-single-thread)
7. [How `CopyBytesToGo` / `CopyBytesToJS` Reach Linear Memory](#how-copybytestogo--copybytestojs-reach-linear-memory)
8. [How `net/http` and `time` Are Wired to the Host](#how-nethttp-and-time-are-wired-to-the-host)
9. [The Build: GOOS=js Internals and Toolchain Coupling](#the-build-goosjs-internals-and-toolchain-coupling)
10. [Serving: MIME, Compression, and Streaming Compilation](#serving-mime-compression-and-streaming-compilation)
11. [Memory Growth and the GC on wasm](#memory-growth-and-the-gc-on-wasm)
12. [Programmatic Inspection and Tooling](#programmatic-inspection-and-tooling)
13. [Edge Cases the Runtime Reveals](#edge-cases-the-runtime-reveals)
14. [Operational Playbook](#operational-playbook)
15. [Summary](#summary)

---

## Introduction

The professional level treats Go-in-the-browser not as an API to call but as a runtime contract between three subsystems: the Go runtime compiled into the `.wasm`, the `wasm_exec.js` glue that hosts it, and the browser's WebAssembly engine and event loop. Most opaque failures — instances that exit early, callbacks that panic the whole module, memory that climbs without bound — come from misunderstanding how these three layers talk.

This file is for engineers who own the wasm build pipeline, debug production wasm front ends, build wasm-aware tooling, or need to reason about boundary cost and memory growth from the implementation, not the documentation. After reading you will:

- Know what `go.run` does internally, from instantiation to `main` to the run loop
- Understand the syscall bridge in `wasm_exec.js` and what each imported function does
- Reason about `js.Value`'s internal NaN-boxed representation and the reference table behind `js.Func`
- Explain how `CopyBytes*` reaches into the module's linear memory in one operation
- Know how `net/http` and `time` are wired to host APIs, and where that wiring leaks
- Operate the build and serving pipeline with the toolchain-coupling and compression details that matter

---

## What `go.run` Actually Does, Step by Step

`go.run(instance)` in `wasm_exec.js` is the entry point that turns a compiled module into a running Go program. Stripped to essentials:

1. **Set up the import object.** Before instantiation, `new Go()` builds `go.importObject`, a table of host functions the module imports under the namespace `gojs` (modern Go) — the syscall bridge. The module cannot link without it.
2. **Capture the instance and its memory.** `go.run(instance)` stores `instance.exports.mem` (the module's `WebAssembly.Memory`) and a `DataView` over its buffer. All Go↔JS data movement reads and writes this buffer.
3. **Write `argv`/`env` into linear memory.** The glue lays out the argument vector and environment at a known offset, mirroring how an OS hands `argc`/`argv` to a process.
4. **Call the exported `run` (the runtime entry).** This starts the Go runtime: it initialises the scheduler, the GC, and the goroutine that will run `main`.
5. **Run until the program parks.** The exported entry returns control to JavaScript when the Go runtime has nothing runnable — i.e. when `main` blocks (`select{}`, a channel receive) or when all goroutines are parked waiting on events.
6. **Resume via callbacks and timers.** When a `js.Func` is invoked, or a timer the runtime scheduled fires, the glue calls back into the exported `resume` function. The runtime then runs whatever became runnable, and parks again.

The key insight: **`go.run` is not a blocking call that holds the thread.** It returns to the event loop as soon as Go has nothing to do, and the program is resumed event-by-event. This is exactly why `select{}` keeps the program alive without freezing the page: the main goroutine is parked, the exported entry has returned, and the event loop is free to dispatch the callbacks that will call `resume`.

When `main` returns, the runtime signals exit; the glue resolves `go.run`'s promise and the instance is done. Any later callback into the instance is a call into a finished program.

---

## The `wasm_exec.js` Glue: the Syscall Bridge

`wasm_exec.js` defines the `Go` class and the import object. The import object is the set of host functions the `.wasm` calls to do anything it cannot do itself — every interaction with the outside world. The functions cluster into:

- **`runtime.wasmExit`** — the runtime calling "I am done," code N. Resolves `go.run`.
- **`runtime.wasmWrite`** — `write(fd, ptr, len)`. This is how `fmt.Println` reaches `console.log`: stdout/stderr are buffered and flushed to the console.
- **`runtime.scheduleTimeoutEvent` / `clearTimeoutEvent`** — the runtime asking the host to wake it after a duration. This is how `time.Sleep`, timers, and the scheduler's idle wakeups work, implemented via `setTimeout`.
- **`runtime.getRandomData`** — fills a buffer from `crypto.getRandomValues`. This is how `crypto/rand` and map-seed randomness work.
- **`runtime.walltime` / `nanotime`** — clock sources backed by `Date.now()` and `performance.now()`.
- **`syscall/js.*`** — the boundary primitives: `valueGet`, `valueSet`, `valueCall`, `valueNew`, `valueIndex`, `valuePrepareString`, `copyBytesToGo`, `copyBytesToJS`, and the value-table management functions. Every `js.Value` method bottoms out in one of these.

Each call from Go to one of these functions is the literal "boundary crossing." It is a wasm-to-JS call with arguments marshalled through linear memory — cheap individually, but real in aggregate, which is why coarse boundary design matters.

The glue's ABI is *coupled to the runtime version*. The set of imports, their signatures, and the memory layout the glue expects are exactly what the runtime in a same-version `.wasm` provides. A mismatched glue calls functions that do not exist or marshals arguments the runtime reads differently — hence the obscure failures on version skew.

---

## How `js.Value` Is Represented Internally

A `js.Value` is not a pointer to a JS object copied into Go memory. JS values live on the JS side; Go holds a *reference* to them. The representation uses a technique called **NaN-boxing**.

A 64-bit IEEE-754 float has a large space of NaN bit patterns that are never produced by normal arithmetic. The runtime packs reference information into these unused NaN payloads:

- A real JS number is stored *as itself* — a float `js.Value` is literally the float. This makes number round-trips cheap: no table lookup.
- `undefined`, `null`, `true`, `false`, and the global object have fixed, predefined encodings.
- An object, function, string, or symbol is stored as a NaN-boxed pattern whose payload is an **index into a per-instance reference table** on the JS side. The Go side holds the index; the JS side resolves it to the real object when a boundary function is called.

The reference table is reference-counted on the Go side. When a `js.Value` referring to a table entry is created, the count goes up; when it is garbage-collected by Go's GC, a finalizer decrements it, and when the count hits zero the JS-side slot is freed. This is why most `js.Value`s do *not* need manual release — Go's GC manages the table entry through finalizers. The exception is `js.Func`, which is held by a JS-side registration that Go's GC cannot see (next section).

Two consequences for the practitioner:

- **Numbers and booleans are essentially free to pass.** They are encoded inline.
- **Strings cost a marshalling step.** `valuePrepareString` copies the UTF-8 bytes through linear memory; a `String()` conversion reads them back. Strings are not free the way numbers are.

---

## The `js.Func` Reference Table and Why `Release()` Is Mandatory

`js.FuncOf(fn)` does two things: it allocates an id, and it stores `fn` in a Go-side map keyed by that id, while installing a JS-side wrapper function in the value table that, when called, invokes the runtime's `resume` path and dispatches to the Go closure by id.

The asymmetry that forces `Release()`: the JS-side wrapper is referenced from the value table, and the Go-side closure is referenced from a package-level map. **Neither reference is visible to Go's garbage collector as collectible** — the closure is reachable from a live global map, so the GC will never finalize it, and so the table slot is never freed. The finalizer mechanism that frees ordinary `js.Value`s does not apply.

`Release()` is the explicit teardown: it deletes the closure from the Go-side map and frees the table slot. Without it:

- The Go closure (and everything it captures) stays alive forever.
- The value-table slot stays occupied.
- In a long-lived app that creates `js.Func`s per event or per render, both grow monotonically — a textbook leak.

This is the implementation reason behind the middle-level rule. Session-long callbacks (created once in `main`) can be left unreleased because their count is bounded; ephemeral callbacks must be released after their last invocation, and calling a released `js.Func` panics because the id no longer maps to a closure.

---

## The Scheduler on a Single Thread

Go's runtime expects multiple OS threads (`M`s) onto which it multiplexes goroutines (`G`s) via processors (`P`s). On `GOOS=js/wasm` there is **one M and one P** — the browser gives the runtime a single thread.

The scheduler therefore runs goroutines cooperatively: a goroutine runs until it blocks (channel op, syscall, `time.Sleep`, mutex contention), at which point the scheduler picks another runnable goroutine. When *no* goroutine is runnable, the runtime parks: the exported entry returns to JavaScript, and the program waits for an external event (a `js.Func` invocation or a scheduled timeout) to call `resume`.

This design produces the model the middle level describes from the outside:

- **`select{}` and `<-ch` park** because they block the goroutine and, if nothing else is runnable, the whole runtime yields to the event loop. The loop is free; the page is responsive.
- **A `for {}` busy loop spins** because the goroutine never blocks — it stays runnable, the scheduler never parks, the exported entry never returns, and the event loop is starved. The tab freezes.
- **Goroutines are concurrent, not parallel** because there is exactly one P. Two CPU-bound goroutines interleave at blocking points but never execute simultaneously.

There is no preemption that helps a CPU-bound loop here in the way it would on a multicore native target: a tight non-yielding loop on the single thread monopolises it. The only real escape to parallelism is a second wasm instance in a Web Worker, with its own runtime on its own thread.

---

## How `CopyBytesToGo` / `CopyBytesToJS` Reach Linear Memory

A wasm module's memory is a single contiguous `ArrayBuffer` — *linear memory*. The Go heap, stack, and globals all live inside it. JavaScript can read and write this buffer directly through a `Uint8Array` view.

`CopyBytesToJS(dst, src)`:

1. Go computes the address and length of `src` (a `[]byte`) within linear memory.
2. The runtime calls the host `copyBytesToJS` with that address/length and the `dst` `Uint8Array`.
3. The glue constructs a `Uint8Array` *view* over the module's memory at the given offset and calls `dst.set(view)` — a single bulk copy in JS.

`CopyBytesToGo(dst, src)` is the mirror: a bulk read from a JS `Uint8Array` into the linear-memory region backing the Go `[]byte`.

This is why the bulk functions are the only acceptable way to move binary data. The alternative — `SetIndex(i, b)` per byte — is one boundary crossing per byte, each marshalling a single value through the table. For a 1 MB image that is a million crossings versus one. The bulk path touches linear memory directly and copies the whole region in a single JS `TypedArray.set`.

The constraint that the JS side must be a `Uint8Array` (not a plain array, not a bare `ArrayBuffer`) is exactly because the implementation needs a typed-array view it can `set` into linear memory.

---

## How `net/http` and `time` Are Wired to the Host

`GOOS=js` has no kernel, so packages that would syscall are either stubbed or re-routed to host APIs.

### `net/http` client → `fetch`

The Go HTTP *client* on wasm has a transport (`RoundTripper`) backed by the browser's `fetch`. `http.Get`, `http.Client.Do`, and the wrapping `net/http` machinery work — the request is translated into a `fetch` call, and the `Response` is built from the `fetch` `Response`. Consequences:

- **CORS and same-origin apply** exactly as for JS `fetch`. A cross-origin request without CORS headers fails, surfaced as a Go `error`.
- **Some transport knobs are ignored.** Connection pooling, `Transport` timeouts, and TLS configuration are the browser's to manage; the Go-level settings have limited or no effect.
- **There is no HTTP server.** `net.Listen` does not work; you cannot serve from inside the browser.
- **Request bodies and streaming** map to `fetch` semantics, with the browser's limitations on streaming request bodies.

### `time` → `setTimeout` and host clocks

`time.Now()` reads `walltime`/`nanotime`, backed by `Date.now()` and `performance.now()`. `time.Sleep` and timers register a `scheduleTimeoutEvent` that the glue implements with `setTimeout`; when it fires, the host calls `resume` and the runtime wakes the sleeping goroutine. This is why `time.Sleep` correctly yields the event loop rather than busy-waiting.

### Everything else kernel-shaped

`os.Open` on real paths, `net.Dial`, `os/exec`, and signals do not work. The professional rule: assume a package that touches files, sockets, processes, or signals is unavailable on `GOOS=js`, and route the need through a host API via `syscall/js`. `net/http`'s client is the notable, deliberate exception.

---

## The Build: GOOS=js Internals and Toolchain Coupling

`GOOS=js GOARCH=wasm go build -o main.wasm` invokes the standard compiler and linker with the wasm backend. What lands in the binary:

- The full Go runtime (scheduler, GC, allocator) compiled to wasm.
- The standard library packages your code transitively imports.
- The `syscall/js` package, whose functions are `//go:wasmimport`-style calls into the `gojs` namespace that `wasm_exec.js` provides.

The binary *imports* the host functions enumerated by `go.importObject`. This import list is the ABI contract with the glue. Because the runtime and the glue are produced by the same toolchain, they agree on the import list, the memory layout, and the value-table protocol. Upgrading Go changes any of these; a stale `wasm_exec.js` then mismatches.

The glue lives at `$(go env GOROOT)/lib/wasm/wasm_exec.js` on modern Go (it relocated from `misc/wasm/`). The build pipeline must copy it from the *building* toolchain, every build. Hard-coding the old `misc/wasm` path is a common upgrade-time breakage. Pinning the Go toolchain (the `toolchain` directive plus a fixed CI image) keeps the binary and glue in lockstep for reproducibility.

`-ldflags="-s -w"` strips the symbol table and DWARF info, reducing size at the cost of readable stack traces. `-trimpath` removes local path prefixes for reproducibility. These are detailed in [optimize.md](optimize.md) and [04-wasm-interop-and-performance](../04-wasm-interop-and-performance/).

---

## Serving: MIME, Compression, and Streaming Compilation

The serving layer is where production wasm front ends most often misbehave.

- **MIME type.** `WebAssembly.instantiateStreaming` requires `Content-Type: application/wasm`. A wrong type makes streaming compilation refuse the response. Go's own `http.FileServer` sets it correctly on modern Go; many CDNs and object stores do not by default and must be configured.
- **Compression.** The `.wasm` is large; serve it brotli- or gzip-compressed with the correct `Content-Encoding`. The browser decompresses transparently and `instantiateStreaming` compiles the decompressed bytes. Compression is the largest single lever on download time and is purely a serving concern.
- **Streaming vs. buffered.** `instantiateStreaming` compiles as bytes arrive — faster time-to-interactive. If you cannot set the MIME type, the [buffered fallback](middle.md) (`arrayBuffer()` then `instantiate`) works but loses the overlap.
- **Caching.** Content-hash the filename (`main.<hash>.wasm`) and set a long-lived immutable cache header. The bundle changes only per release; hash-based names give safe long caching.
- **SRI.** Subresource Integrity on `wasm_exec.js` pins exactly which glue bytes run.

Operating these in production — CDN config, cache invalidation, the glue/binary versioning — is the subject of [05-wasm-in-production](../05-wasm-in-production/).

---

## Memory Growth and the GC on wasm

The module's linear memory is a `WebAssembly.Memory` that can only *grow*, never shrink. The Go GC reclaims Go-heap memory for reuse, but it does not return pages to the browser: once the linear memory has grown to satisfy a peak, it stays at that high-water mark for the instance's life.

Implications:

- **A transient spike permanently raises the floor.** Processing a large buffer once grows memory; freeing it lets Go reuse the space, but the tab's reported memory does not drop. Plan peak working set, not average.
- **`CopyBytes*` into a large `make([]byte, n)`** allocates within linear memory; very large allocations can force memory growth that never reverses.
- **Leaks compound the floor.** A `js.Func` leak (closures captured and never released) keeps growing the live set, forcing repeated growth.

The GC itself runs cooperatively on the single thread like everything else — a GC cycle competes with your code and with paint for the thread. For latency-sensitive UI work, watch for GC pauses showing up as jank; reducing allocation in hot paths reduces both pause frequency and the memory high-water mark. Memory-leak detection on wasm uses the browser's heap profiler plus Go-level allocation discipline.

---

## Programmatic Inspection and Tooling

- **`go.dev/play`-style hosting** aside, the practical inspection tools are the browser's: DevTools shows `console.log` output (Go stdout), the Network panel shows the `.wasm` download and its MIME/encoding, and the Memory panel profiles linear-memory growth.
- **`wasm-objdump` / `wasm2wat`** (from the WABT toolkit) disassemble the module to inspect imports, exports, and sizes — useful to confirm the import list matches the glue, or to see which sections dominate size.
- **`go tool nm main.wasm`** lists symbols (when not stripped) to find what pulled in weight.
- **Source maps and DWARF** are limited; for stack traces, build without `-w` in development so panic traces are readable, and strip for production.
- **`twiggy` / `wasm-opt`** (Binaryen) analyse and post-optimize size; `wasm-opt` can shave bytes, though gains over a stripped Go binary are modest.

The senior point: most production debugging is in DevTools (console for panics, Network for serving issues, Memory for leaks), with WABT/Binaryen tools reserved for size and import-list forensics.

---

## Edge Cases the Runtime Reveals

- **Panic out of a callback kills the instance.** A panic that unwinds into the JS-invoked `js.Func` wrapper takes the whole module down, not just a goroutine. Recover at the callback boundary.
- **`main` returning ends everything.** Even with live `js.Func`s registered, `main`'s return resolves `go.run` and tears down. Park `main`.
- **Released `js.Func` invoked later panics.** The id no longer maps to a closure. Release only after the last call.
- **Numbers pass inline; strings and objects do not.** NaN-boxing makes numeric round-trips cheap and string/object round-trips a table-and-marshal step. Hot-path string conversions add up.
- **Linear memory never shrinks.** Peak working set is permanent for the instance. A one-time large allocation raises the floor forever.
- **`http` client works, `http` server and `net.Dial` do not.** The one deliberate convenience is the `fetch`-backed client.
- **Glue/binary version skew fails obscurely.** Mismatched ABI, not a clean error. Regenerate the glue from the building toolchain.
- **`crypto/rand` works** via `getRandomData` → `crypto.getRandomValues`; do not assume randomness is unavailable on wasm.

These are pointers to reach for the runtime source (`runtime/*_js.go`, `runtime/lock_js.go`, the `syscall/js` package, and `lib/wasm/wasm_exec.js`) when behaviour surprises you. The implementation is tractable and well-commented.

---

## Operational Playbook

| Scenario | Recipe |
|----------|--------|
| Build for the browser | `GOOS=js GOARCH=wasm go build -ldflags="-s -w" -o main.wasm` |
| Refresh the glue | `cp "$(go env GOROOT)/lib/wasm/wasm_exec.js" .` (in the build, every build) |
| Serve with correct MIME | Use `http.FileServer` (sets `application/wasm`) or configure the CDN explicitly |
| Compress for transport | Serve `.wasm` brotli/gzip with `Content-Encoding`; the browser decompresses |
| Stream-compile | `WebAssembly.instantiateStreaming(fetch(url), go.importObject)` (needs the MIME) |
| MIME unfixable | Buffered fallback: `arrayBuffer()` → `WebAssembly.instantiate` |
| Diagnose early exit | Confirm `main` parks (`select{}`/channel); a returned `main` tears down the instance |
| Diagnose frozen tab | Find the non-yielding loop on the main thread; chunk it or move to a Web Worker |
| Diagnose memory climb | Browser Memory profiler; audit for unreleased `js.Func`s; remember memory never shrinks |
| Diagnose "released Func" panic | A one-shot was released before its last invocation; fix the release timing |
| Diagnose version skew | Regenerate `wasm_exec.js` from the building toolchain; pin the Go version |
| Shrink the binary | `-ldflags="-s -w"`, trim heavy imports, consider TinyGo (see optimize.md) |
| Move bytes | `Uint8Array` + `CopyBytesToJS` / `CopyBytesToGo`, never per-byte `SetIndex` |
| Inspect imports/size | `wasm-objdump -x main.wasm`; `go tool nm main.wasm` |

---

## Summary

Go in the browser is a three-layer runtime contract: the Go runtime compiled into the `.wasm`, the `wasm_exec.js` glue that hosts it and provides the syscall bridge, and the browser engine plus event loop. `go.run` is not a blocking call — it starts the runtime, runs until Go parks, returns to the event loop, and resumes event-by-event through `resume`, which is precisely why `select{}` keeps the program alive without freezing the page while a busy loop starves the single thread.

The professional details are the ones that explain the surface behaviour: `js.Value` is NaN-boxed, so numbers pass inline and only objects and strings cost a table-and-marshal step; `js.Func` is held by a JS-side registration invisible to Go's GC, which is the implementation reason `Release()` is mandatory for ephemeral callbacks; `CopyBytes*` reaches directly into linear memory for a single bulk copy, the only viable way to move binary data; the scheduler runs one M and one P, making goroutines concurrent but never parallel; `net/http`'s client is wired to `fetch` (CORS and all) while servers and sockets do not exist; and linear memory only grows, so peak working set is permanent. The build couples the binary and glue through an ABI that changes per Go version, so the pipeline regenerates the glue from the building toolchain and pins the version. Knowing where the complexity actually sits — the bridge, the table, the single-threaded scheduler, the linear-memory model — turns opaque production failures into mechanical diagnoses.
