# GOOS=js/wasm in the Browser — Specification

## Table of Contents
1. [Introduction](#introduction)
2. [Where `GOOS=js/wasm` Is Specified](#where-goosjswasm-is-specified)
3. [The `GOOS`/`GOARCH` Pair](#the-goosgoarch-pair)
4. [The `syscall/js` Package Surface](#the-syscalljs-package-surface)
5. [`js.Value` Conversion Semantics](#jsvalue-conversion-semantics)
6. [`js.Func` and `FuncOf`/`Release` Semantics](#jsfunc-and-funcofrelease-semantics)
7. [`CopyBytesToGo` / `CopyBytesToJS` Contract](#copybytestogo--copybytestojs-contract)
8. [The `wasm_exec.js` Glue and Its Location](#the-wasm_execjs-glue-and-its-location)
9. [The Host Embedding Contract (`go.run`, `importObject`)](#the-host-embedding-contract-gorun-importobject)
10. [What `GOOS=js` Provides and Omits](#what-goosjs-provides-and-omits)
11. [Differences Across Go Versions](#differences-across-go-versions)
12. [References](#references)

---

## Introduction

The Go language specification (`go.dev/ref/spec`) does not define `GOOS=js/wasm`; it is a *port* and a *standard-library package*, not a language feature. The authoritative sources are the `syscall/js` package documentation, the Go WebAssembly wiki, and the toolchain's runtime and glue source.

Sources of truth, in decreasing formality:

1. **`syscall/js` package documentation** — `pkg.go.dev/syscall/js`, the API reference for the bridge.
2. **Go WebAssembly wiki** — `go.dev/wiki/WebAssembly`, the getting-started and embedding guide.
3. **Toolchain source** — the runtime files (`runtime/*_js.go`), the `syscall/js` package, and `lib/wasm/wasm_exec.js` (the glue).

This file separates documented API contracts from convention and implementation detail. Where the docs are silent, the source is the de-facto specification.

---

## Where `GOOS=js/wasm` Is Specified

Three layers are documented separately:

1. **The build target.** `GOOS=js GOARCH=wasm` is a supported port, listed in `go tool dist list` (`js/wasm`). Its supported-ness and constraints are described in the WebAssembly wiki, not the language spec.
2. **The `syscall/js` API.** Documented at `pkg.go.dev/syscall/js`. This is the stable, exported contract: `Value`, `Func`, `Global`, `ValueOf`, `FuncOf`, `CopyBytesToGo`, `CopyBytesToJS`, and the `Value` methods.
3. **The host glue contract.** `wasm_exec.js` and the `Go` object it defines are documented by example in the wiki. The `importObject`/`run` protocol is part of the toolchain, versioned with it.

A caveat the `syscall/js` docs state explicitly: the package is **subject to change** and its API is not covered by the Go 1 compatibility promise to the same degree as the rest of the standard library. In practice it has been stable since Go 1.12, but the documentation reserves the right to change it.

---

## The `GOOS`/`GOARCH` Pair

```
GOOS=js GOARCH=wasm go build -o main.wasm
```

- `GOOS=js` selects the JavaScript host environment as the operating system.
- `GOARCH=wasm` selects the WebAssembly architecture.
- The pair is the *only* combination for browser wasm; `wasm` is not valid with other `GOOS` values for the browser (the non-browser wasm target uses `GOOS=wasip1 GOARCH=wasm` — see [02-wasi-and-wasip1](../02-wasi-and-wasip1/)).
- The output is a WebAssembly module, conventionally `main.wasm`. It is not a native executable and cannot be run directly; it requires a host (the browser with `wasm_exec.js`, or Node with the same glue).
- Build constraints select `js`/`wasm`-tagged files. A file named `*_js.go` or guarded by `//go:build js` is included only for this target; `//go:build js && wasm` is the precise guard.

---

## The `syscall/js` Package Surface

The documented exported API:

| Symbol | Signature (paraphrased) | Role |
|--------|--------------------------|------|
| `Global()` | `func Global() Value` | Returns the JS global object (`window`/`global`). |
| `ValueOf(x any)` | `func ValueOf(x any) Value` | Wraps a Go value as a `Value`. |
| `Value` | type | Opaque handle to a JS value. |
| `Value.Get(p)` | `func (Value) Get(string) Value` | Read a property. |
| `Value.Set(p, x)` | `func (Value) Set(string, any)` | Write a property. |
| `Value.Call(m, args...)` | `func (Value) Call(string, ...any) Value` | Invoke a method. |
| `Value.Invoke(args...)` | `func (Value) Invoke(...any) Value` | Call the value as a function. |
| `Value.New(args...)` | `func (Value) New(...any) Value` | The `new` operator. |
| `Value.Index(i)` / `SetIndex(i,x)` | — | Array element access. |
| `Value.Length()` | `func (Value) Length() int` | Array/array-like length. |
| `Value.Int/Float/String/Bool/Truthy` | — | Convert to a Go type / JS truthiness. |
| `Value.Type()` | `func (Value) Type() Type` | The JS type tag. |
| `Value.IsNull/IsUndefined/IsNaN` | — | Predicates. |
| `Func` | type | A Go function wrapped for JS, embeds `Value`. |
| `FuncOf(fn)` | `func FuncOf(func(this Value, args []Value) any) Func` | Wrap a Go callback. |
| `Func.Release()` | `func (Func) Release()` | Free the callback's table entry. |
| `CopyBytesToGo(dst []byte, src Value)` | `func(...) int` | Bulk copy JS `Uint8Array` → Go. |
| `CopyBytesToJS(dst Value, src []byte)` | `func(...) int` | Bulk copy Go → JS `Uint8Array`. |
| `Error` | type | Wraps a JS error value as a Go `error`. |

`Value.Type()` returns one of the documented `Type` constants: `TypeUndefined`, `TypeNull`, `TypeBoolean`, `TypeNumber`, `TypeString`, `TypeSymbol`, `TypeObject`, `TypeFunction`.

---

## `js.Value` Conversion Semantics

The documented behaviour of the conversion methods:

- `Int()` returns the value as an `int`; **panics** if `Type()` is not `TypeNumber`. The conversion truncates toward zero, matching Go's float-to-int conversion.
- `Float()` returns the value as `float64`; panics if not `TypeNumber`.
- `String()` returns the value as a `string`; if the value is not a string, the documented behaviour is that it returns a string of the form `"<T value>"` rather than panicking — but the practical, relied-upon contract is to call it only on `TypeString`. (Treat non-string `String()` as a programming error.)
- `Bool()` returns the value as a `bool`; panics if not `TypeBoolean`.
- `Truthy()` reports JavaScript truthiness (the result of `!!value`); never panics. This is the safe presence test.
- `IsNull()`, `IsUndefined()`, `IsNaN()` are predicates that never panic.

`ValueOf` accepts: `Value` (returned as-is), `Func`, `nil`, `bool`, all integer and float types, `string`, `[]any` (→ JS array), and `map[string]any` (→ JS object). Any other type causes `ValueOf` to **panic** with `ValueError`. Notably, `[]byte` is *not* accepted — bytes must go through `CopyBytesToJS`.

`Get`, `Set`, `Call`, `Invoke`, `New`, and `SetIndex` apply `ValueOf` to their arguments, so they inherit the same accepted-type set and panic behaviour.

---

## `js.Func` and `FuncOf`/`Release` Semantics

Documented contract:

- `FuncOf(fn)` returns a `Func` wrapping `fn`. When JavaScript invokes the wrapped function, `fn` is called with `this` set to the JS receiver and `args` the JS arguments (each a `Value`). The value `fn` returns is converted via `ValueOf` and returned to JS.
- The callback **must not block the event loop**: per the documentation, the invoked Go function runs on the goroutine that the JS runtime is executing; long or blocking work must be delegated to a separate goroutine.
- `Func` embeds `Value`, so a `Func` can be passed wherever a `Value` is expected (e.g. as an event listener argument).
- `Release()` frees resources associated with the `Func`. The documentation states it **must be called to let the Func and its closure be garbage collected** — `Func`s are not collected automatically. Invoking a released `Func` from JS is undefined/erroneous (in practice, a panic).

The documented guidance: create a `Func` once for a long-lived callback and never release it (or release at program end); for short-lived callbacks, release after the last invocation.

---

## `CopyBytesToGo` / `CopyBytesToJS` Contract

```
func CopyBytesToGo(dst []byte, src Value) int
func CopyBytesToJS(dst Value, src []byte) int
```

Documented behaviour:

- Both copy the minimum of `len(dst)` and the JS array's length, returning the number of bytes copied.
- The JS-side `Value` **must be a `Uint8Array` or `Uint8ClampedArray`.** Passing any other type panics.
- The copy is a single bulk operation; it does not cross the boundary per element.

These are the only specified mechanism for transferring byte slices across the boundary; there is no `ValueOf([]byte)` path.

---

## The `wasm_exec.js` Glue and Its Location

The glue is shipped with the toolchain, not generated by `go build`. Its location:

- **Modern Go (1.24+):** `$(go env GOROOT)/lib/wasm/wasm_exec.js`.
- **Go 1.21–1.23:** `$(go env GOROOT)/misc/wasm/wasm_exec.js`.

The relocation from `misc/wasm` to `lib/wasm` is the principal path change practitioners must track. The contract:

- The glue defines a global `Go` class.
- The glue's ABI (the set and signatures of host functions in `importObject`, the memory layout, the value-table protocol) is **coupled to the toolchain version** that built the `.wasm`. A mismatched glue produces undefined runtime behaviour.
- The toolchain documentation directs you to copy the glue from the building toolchain into your serving directory.

---

## The Host Embedding Contract (`go.run`, `importObject`)

Documented by example in the wiki; the embedding protocol a host must follow:

1. Load `wasm_exec.js` so the `Go` class is defined.
2. `const go = new Go();` — creates an instance carrying `go.importObject`.
3. Instantiate the module, passing `go.importObject`:
   `WebAssembly.instantiateStreaming(fetch("main.wasm"), go.importObject)`.
4. `go.run(instance);` — starts the Go program. Returns a promise that resolves when the Go program exits (i.e. when `main` returns).

Constraints stated or implied by the contract:

- `go.importObject` is **required** at instantiation; without it the module fails to link (it imports the syscall bridge).
- `instantiateStreaming` requires the response `Content-Type` to be `application/wasm`; otherwise the buffered `WebAssembly.instantiate(arrayBuffer, importObject)` path must be used.
- A single `Go` instance corresponds to a single program run; reusing one across runs is not part of the contract.
- The program must be served over HTTP(S); browsers refuse to instantiate wasm from `file://`.

---

## What `GOOS=js` Provides and Omits

Provided:

- `fmt`/stdout and stderr → `console.log`/`console.error` via the runtime's `wasmWrite`.
- `crypto/rand` → `crypto.getRandomValues` via `getRandomData`.
- `time` (clocks and timers) → host clocks and `setTimeout`.
- `net/http` **client** → the browser's `fetch` (subject to CORS).
- Goroutines, channels, `sync` primitives — concurrent, multiplexed on one thread.

Omitted (compile but fail or are stubbed at runtime):

- Real file system access (`os.Open` on real paths). There is no disk.
- Network sockets (`net.Dial`, `net.Listen`); no HTTP server.
- OS process control (`os/exec`), signals.
- True parallelism / multiple OS threads; `GOMAXPROCS` is effectively 1.

The omissions follow from `GOOS=js`: JavaScript is the OS, and the browser provides no kernel facilities. Anything kernel-shaped must be reached through a JS API via `syscall/js`. The non-browser wasm target with a virtual file system is [02-wasi-and-wasip1](../02-wasi-and-wasip1/).

---

## Differences Across Go Versions

- **Go 1.11** — initial `js/wasm` port; `syscall/js` introduced (API churned in this release).
- **Go 1.12** — `syscall/js` API stabilised into roughly its current shape; `Func`, `FuncOf`, `Release`, the conversion methods, and `CopyBytes*` settle.
- **Go 1.13** — `Value` comparison and `Equal` refinements.
- **Go 1.14–1.16** — runtime/scheduler improvements for wasm; `net/http` client wired to `fetch` solidified.
- **Go 1.17+** — incremental runtime and size improvements; the API surface unchanged.
- **Go 1.21** — toolchain directive and reproducibility tooling mature; the `go.work`/build-tag interactions are documented; `wasm_exec.js` still under `misc/wasm`.
- **Go 1.24** — `wasm_exec.js` relocated to `$(go env GOROOT)/lib/wasm/wasm_exec.js`. The principal path-location change to track.

The `syscall/js` API has been effectively stable since Go 1.12; the notable evolutions are runtime/size improvements and the glue-file relocation, not API changes. The package documentation nonetheless continues to flag the API as subject to change.

---

## References

- [`syscall/js` package documentation](https://pkg.go.dev/syscall/js) — authoritative API reference.
- [Go Wiki: WebAssembly](https://go.dev/wiki/WebAssembly) — getting started, embedding, and FAQ.
- [Go Wiki: WebAssembly — Getting Started](https://go.dev/wiki/WebAssembly#getting-started) — the canonical walkthrough.
- [MDN: WebAssembly.instantiateStreaming](https://developer.mozilla.org/docs/WebAssembly/JavaScript_interface/instantiateStreaming_static) — the host instantiation contract.
- [Source: `lib/wasm/wasm_exec.js`](https://cs.opensource.google/go/go/+/refs/tags/master:lib/wasm/wasm_exec.js) — the glue implementation.
- [Source: `runtime` wasm files (`*_js.go`)](https://cs.opensource.google/go/go/+/refs/tags/master:src/runtime/) — the runtime/host wiring.
