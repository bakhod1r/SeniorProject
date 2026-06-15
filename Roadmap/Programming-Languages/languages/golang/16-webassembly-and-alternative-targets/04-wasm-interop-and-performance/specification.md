# Wasm Interop & Performance — Specification

## Table of Contents
1. [Introduction](#introduction)
2. [Where This Is Specified](#where-this-is-specified)
3. [The `syscall/js` Package Surface](#the-syscalljs-package-surface)
4. [`js.Value` Semantics (Per Reference)](#jsvalue-semantics-per-reference)
5. [`js.Func` and `Release` (Specified Lifetime)](#jsfunc-and-release-specified-lifetime)
6. [`CopyBytesToGo` / `CopyBytesToJS` Contract](#copybytestogo-copybytestojs-contract)
7. [The `go:wasmimport` / `go:wasmexport` Directives](#the-gowasmimport-gowasmexport-directives)
8. [Linear Memory and the WebAssembly Spec](#linear-memory-and-the-webassembly-spec)
9. [Build Targets and Flags](#build-targets-and-flags)
10. [Differences Across Go Versions](#differences-across-go-versions)
11. [References](#references)

---

## Introduction

The Go language specification (`go.dev/ref/spec`) does not describe wasm interop or performance — these are properties of the *toolchain* and the *`syscall/js` package*, not the language. The authoritative sources are the package documentation, the compiler directive documentation, the Go Wiki's WebAssembly page, and the upstream WebAssembly and WASI specifications for the host side.

Sources of truth, in decreasing formality:
1. **`syscall/js` package docs** — `pkg.go.dev/syscall/js`, the API contract for the `js` target.
2. **`cmd/compile` directive docs** — `go:wasmimport`, `go:wasmexport` semantics.
3. **WebAssembly Core Specification** — linear memory, `memory.grow`, value types.
4. **WASI preview 1 (`wasip1`)** — the host ABI for the non-browser target.
5. **Toolchain source** — `src/syscall/js/`, `lib/wasm/wasm_exec.js`, `src/runtime/`.

This file separates what the references *guarantee* from what is implementation behaviour you can observe but should not depend on.

---

## Where This Is Specified

- `syscall/js` is documented and is **explicitly marked as not subject to the Go 1 compatibility promise** — its API may change. This is stated in the package docs and matters for long-lived code.
- The directives `//go:wasmimport` and `//go:wasmexport` are documented under the compiler's directive list and the WebAssembly wiki page.
- Binary layout follows the **WebAssembly Core Specification** (sections, types, memory).
- The build targets `GOOS=js GOARCH=wasm` and `GOOS=wasip1 GOARCH=wasm` are documented in the Go release notes and the `cmd/go` environment docs.

---

## The `syscall/js` Package Surface

The package is available only when `GOOS=js`. Its core entry points, per the docs:

| Symbol | Contract |
|--------|----------|
| `js.Global() Value` | Returns the JavaScript global object (`globalThis`). |
| `js.ValueOf(x any) Value` | Converts a Go value to a `Value`. Accepts `nil`, `bool`, integers, floats, `string`, `[]any`, `map[string]any`, and `Value`/`Func`. Other types panic. |
| `Value.Get(p string) Value` | JS `v[p]`. |
| `Value.Set(p string, x any)` | JS `v[p] = x`. |
| `Value.Index(i int) Value` / `SetIndex(i int, x any)` | Array element access. |
| `Value.Call(m string, args ...any) Value` | JS `v.m(args...)`. Panics on JS exception. |
| `Value.Invoke(args ...any) Value` | JS `v(args...)`. |
| `Value.New(args ...any) Value` | JS `new v(args...)`. |
| `Value.Int()/Float()/Bool()/String()` | Extract a Go scalar. Panics on type mismatch. |
| `Value.Type() Type` | One of `TypeUndefined`, `TypeNull`, `TypeBoolean`, `TypeNumber`, `TypeString`, `TypeSymbol`, `TypeObject`, `TypeFunction`. |
| `Value.IsUndefined()/IsNull()/IsNaN()/Truthy()` | Predicates. |
| `js.FuncOf(fn func(this Value, args []Value) any) Func` | Wraps a Go func as a callable JS function. |
| `Func.Release()` | Frees the function's reference-table slot. |
| `js.CopyBytesToGo(dst []byte, src Value) int` | Bulk copy from a JS `Uint8Array`/`Uint8ClampedArray` to a Go slice. |
| `js.CopyBytesToJS(dst Value, src []byte) int` | Bulk copy from a Go slice to a JS typed array. |

---

## `js.Value` Semantics (Per Reference)

The docs specify, and these are the load-bearing guarantees:

- A `Value` **references** a JavaScript value. It is comparable with `==` only via `Value.Equal`; do not use `==` on `Value` directly (the docs note the zero value and comparability caveats).
- `ValueOf` of an unsupported type **panics**. The accepted set is exactly the list above.
- `Get` on a missing property returns a `Value` of type `TypeUndefined` — **not** an error and **not** a panic.
- A failed `Call`/`Invoke`/`New` (the JS side throws) causes a **Go panic** carrying a value that wraps the JS error; recover to handle it.
- Scalar extractors (`Int`, `Float`, `Bool`, `String`) **panic** if the underlying value is not of the requested type. Check `Type()` first for untrusted input.

What is *not* specified (implementation detail, do not depend on): the NaN-boxing encoding, the exact reference-table mechanism, slot recycling timing, and finalizer timing.

---

## `js.Func` and `Release` (Specified Lifetime)

The docs state: `FuncOf` returns a `Func` that **must be released** by calling `Release` when it is no longer needed, otherwise the program **keeps a reference to it (a memory leak)**. This is a hard contract, not advice:

- A `Func` registered for the lifetime of the program need not be released (it lives until exit).
- A `Func` created transiently (per event, per promise) **must** be released, or each creation leaks.
- After `Release`, invoking the function from JS yields an error.

The package does not specify *when* the slot is reclaimed beyond "after Release," and does not provide reference counting — the caller owns the lifetime.

---

## `CopyBytesToGo` / `CopyBytesToJS` Contract

Per the docs:
- `CopyBytesToGo(dst []byte, src Value) int` — copies bytes from `src` (which must be a `Uint8Array` or `Uint8ClampedArray`) into `dst`. Returns the number of bytes copied, which is `min(len(dst), src.length)`. Panics if `src` is not a recognised typed array.
- `CopyBytesToJS(dst Value, src []byte) int` — the reverse; `dst` must be a `Uint8Array`/`Uint8ClampedArray`. Returns `min(dst.length, len(src))`.

The functions perform a single bulk copy. The docs do not guarantee a performance characteristic, but the implementation is a typed-array copy over linear memory.

---

## The `go:wasmimport` / `go:wasmexport` Directives

For non-`js` targets (notably `wasip1`):

- `//go:wasmimport <module> <name>` binds a Go function *declaration* (no body) to an imported host function. Specified parameter/result types are restricted to wasm-representable scalars: `int32`, `uint32`, `int64`, `uint64`, `float32`, `float64`, `unsafe.Pointer`, and `uintptr` (and pointer types under documented rules). Strings/slices/structs are **not** directly representable and must be passed via pointers into linear memory.
- `//go:wasmexport <name>` (Go 1.24+) exports a Go function to the host under `<name>`, with the same type restrictions.
- The directives are documented as part of the compiler's directive set; the exact allowed-type matrix is given in the WebAssembly wiki and release notes and has expanded across versions.
- These directives are **not** available (and not needed) on the `js` target, which uses `syscall/js` instead.

---

## Linear Memory and the WebAssembly Spec

The host-side behaviour that drives the detached-buffer rule is specified by the **WebAssembly Core Specification**, not by Go:

- A module has one linear memory, addressed as a contiguous byte array, sized in 64 KiB pages.
- The `memory.grow` instruction increases the memory by a number of pages; it returns the previous size or `-1` on failure.
- On the JavaScript embedding side, growing memory **may detach the existing `ArrayBuffer`** and replace it with a new one (the JS API spec for `WebAssembly.Memory.prototype.grow` describes this). Any `TypedArray`/`DataView` over the old buffer is invalidated.

Go's runtime calls `memory.grow` through its allocator; the detachment is a property of the embedding, which is why cached JS views must be re-derived. This is specified behaviour, not a Go quirk.

---

## Build Targets and Flags

- `GOOS=js GOARCH=wasm` — browser target; uses `syscall/js` + `wasm_exec.js`.
- `GOOS=wasip1 GOARCH=wasm` — WASI preview 1; uses `go:wasmimport` host functions. Introduced as a preview in Go 1.21, stabilised thereafter.
- `-ldflags="-s -w"` — `-s` omits the symbol table, `-w` omits DWARF debug info. Documented under `cmd/link`. Reduces binary size by removing debug/name data only.
- `wasm_exec.js` location: `$(go env GOROOT)/lib/wasm/wasm_exec.js` in Go 1.21+; previously `$(go env GOROOT)/misc/wasm/wasm_exec.js`.

---

## Differences Across Go Versions

- **Go 1.21** — `wasm_exec.js` moved to `lib/wasm/`; `wasip1` target introduced as a preview; `go:wasmimport` documented for wasip1.
- **Go 1.22** — `go:wasmimport` allowed-type expansion and wasip1 refinements.
- **Go 1.24** — `//go:wasmexport` added, allowing Go functions to be exported to a wasm host; reactor-style modules become possible.
- Across versions, the `syscall/js` API remains *outside* the Go 1 compatibility promise — treat it as stable-in-practice but formally subject to change.
- Binary-size floor has trended roughly stable (multiple MB for the `js` target); no version has eliminated the runtime-ships-inside-the-binary fact for standard Go.

---

## References

- [`syscall/js` package documentation](https://pkg.go.dev/syscall/js) — the authoritative API and the no-compatibility-promise note.
- [Go Wiki: WebAssembly](https://go.dev/wiki/WebAssembly) — targets, `go:wasmimport`, size guidance.
- [`wasm_exec.js` in the Go source tree](https://cs.opensource.google/go/go/+/refs/tags/master:lib/wasm/wasm_exec.js) — the host-side implementation.
- [Go compiler directives — `go:wasmimport` / `go:wasmexport`](https://pkg.go.dev/cmd/compile) — directive semantics.
- [WebAssembly Core Specification](https://webassembly.github.io/spec/core/) — linear memory and `memory.grow`.
- [MDN: `WebAssembly.Memory.prototype.grow`](https://developer.mozilla.org/en-US/docs/WebAssembly/JavaScript_interface/Memory/grow) — ArrayBuffer detachment on grow.
- [WASI preview 1](https://github.com/WebAssembly/WASI) — the wasip1 host ABI.
- Related: [02-wasi-and-wasip1](../02-wasi-and-wasip1/specification.md), [01-goos-js-wasm-browser](../01-goos-js-wasm-browser/specification.md), [05-wasm-in-production](../05-wasm-in-production/specification.md).
