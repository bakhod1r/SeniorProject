# WASI & `GOOS=wasip1` — Specification

## Table of Contents
1. [Introduction](#introduction)
2. [Where `wasip1` Is Specified](#where-wasip1-is-specified)
3. [The `wasip1` Port (Go)](#the-wasip1-port-go)
4. [The WASI Preview 1 ABI](#the-wasi-preview-1-abi)
5. [The Capability Model (Per Spec)](#the-capability-model-per-spec)
6. [`go:wasmimport` (Specified Behaviour)](#gowasmimport-specified-behaviour)
7. [`go:wasmexport` (Specified Behaviour)](#gowasmexport-specified-behaviour)
8. [Module Lifecycle: `_start` and `_initialize`](#module-lifecycle-_start-and-_initialize)
9. [WASI Preview 1 vs Preview 2](#wasi-preview-1-vs-preview-2)
10. [Differences Across Go Versions](#differences-across-go-versions)
11. [References](#references)

---

## Introduction

The Go language specification (`go.dev/ref/spec`) does not specify `wasip1`. The target is part of the *toolchain* and the *WASI standard*, not the language. Authority is split across three bodies of text:

1. **The Go port documentation** — the `GOOS=wasip1 GOARCH=wasm` target, the compiler directives, and the runtime support — anchored by the official blog post and the WebAssembly wiki.
2. **The WASI preview 1 ABI** — the `wasi_snapshot_preview1` interface, specified by the WASI subgroup.
3. **The Go compiler directive documentation** — `go:wasmimport` and `go:wasmexport`, documented in the `cmd/compile` reference.

Sources of truth, in decreasing formality: the WASI preview-1 specification (for the ABI), the Go release notes and `cmd/compile` docs (for the directives and version floors), and the toolchain source (`runtime`, `syscall`) where prose is silent. This file separates "what the standard guarantees" from convention and implementation detail.

---

## Where `wasip1` Is Specified

The target is documented officially in:

1. **The Go 1.21 release notes** — the introduction of `GOOS=wasip1 GOARCH=wasm`.
2. **The Go blog: "WASI support in Go"** (`go.dev/blog/wasi`) — the authoritative announcement and rationale.
3. **The Go WebAssembly wiki** (`go.dev/wiki/WebAssembly`) — covers both wasm targets, including `wasip1`.
4. **The `cmd/compile` documentation** — the `go:wasmimport` and `go:wasmexport` directives and their constraints.
5. **The WASI preview-1 specification** — the `wasi_snapshot_preview1` interface definition.

Where the prose is silent (e.g. exact preopen resolution, `poll_oneoff` precision), the runtime source (`src/runtime/os_wasip1.go`, `src/syscall/*_wasip1.go`) is the de-facto specification.

---

## The `wasip1` Port (Go)

The Go port is specified by the combination of `GOOS=wasip1` and `GOARCH=wasm`:

- `GOOS=wasip1` selects the WASI-preview-1 operating-system port; `GOARCH=wasm` selects the WebAssembly architecture. **Both are required**; either alone is not a valid target.
- The port compiles to a standard WebAssembly binary (`.wasm`) whose I/O is performed through `wasi_snapshot_preview1` imports.
- The produced module is, by default, a **command** module exporting `_start`.
- The build constraint identifier is `wasip1` (the `GOOS`). `//go:build wasm` matches both `js/wasm` and `wasip1/wasm`; `//go:build wasip1` matches only the WASI target.

Per the release notes, the port supports the standard library subset that does not require facilities absent from preview 1: full networking, OS threads, and subprocess creation are not supported. File I/O is supported but only against preopened directories.

---

## The WASI Preview 1 ABI

WASI preview 1 (formally `wasi_snapshot_preview1`) is specified by the WASI subgroup of the Bytecode Alliance / W3C WebAssembly Community Group. It defines a flat set of imported functions a conforming host must provide.

Specified properties relevant to Go:

- The interface is a **single module namespace**, `wasi_snapshot_preview1`, containing functions for file descriptors (`fd_*`), paths (`path_*`), clocks (`clock_*`), randomness (`random_get`), arguments (`args_*`), environment (`environ_*`), polling (`poll_oneoff`), process control (`proc_exit`), and scheduling (`sched_yield`).
- The interface is **capability-based**: there is no ambient authority. A function that operates on a resource requires a file descriptor that the host granted; there is no way to name a resource the host did not provide.
- File operations are performed **relative to preopened directory descriptors**. The `fd_prestat_*` functions let the guest enumerate preopens and their advertised guest paths.
- Networking in preview 1 is **not a general API**. The interface defines `sock_accept` (accepting on a host-provided listening socket) and `sock_recv`/`sock_send` for already-connected sockets, but no `socket`/`connect`/`bind`/`listen`. There is no portable way for a guest to *originate* a connection or *create* a listener.

A host that fails to provide any function the module imports causes instantiation to fail with an unresolved-import error.

---

## The Capability Model (Per Spec)

The WASI specification mandates the capability model:

- A module begins with only the file descriptors the host placed in its descriptor table: by convention fds 0/1/2 (stdio) and fds for each preopened directory.
- The module cannot fabricate authority. To open a path, it must resolve it relative to a preopen whose advertised path is an ancestor; absent such a preopen, the path is unreachable.
- Environment variables and arguments are supplied entirely by the host via `environ_get`/`args_get`; nothing is inherited implicitly.

The specification frames this as the central security property: **a WASI module's authority is exactly the set the host granted, and nothing more.** The host invocation, not the module, determines the capability set.

---

## `go:wasmimport` (Specified Behaviour)

`go:wasmimport` is a compiler directive, specified in the `cmd/compile` documentation. Added in **Go 1.21**.

Specified form and rules:

- Syntax: `//go:wasmimport <module> <name>` immediately preceding a function declaration with no body.
- The directive declares that the function is implemented by a host-provided wasm import named `<name>` in module `<module>`.
- The function's parameters and results are restricted to types that map to wasm value types: the integer types (`int32`/`uint32`/`int64`/`uint64`), the float types (`float32`/`float64`), `unsafe.Pointer`, and a small set of pointer-shaped types. The set of permitted types has been refined across releases; unsupported types are a compile-time error.
- The host must supply a matching implementation at instantiation; otherwise instantiation fails.

The directive is specified to work for both `wasip1` and `js/wasm` builds, but the host that supplies the import differs (a WASI/embedder host vs the JavaScript host).

---

## `go:wasmexport` (Specified Behaviour)

`go:wasmexport` is a compiler directive, specified in the `cmd/compile` documentation. Added in **Go 1.24**.

Specified form and rules:

- Syntax: `//go:wasmexport <name>` immediately preceding a function definition.
- The directive exports the Go function from the wasm module under the name `<name>`, making it callable by the host.
- Parameter and result types are restricted to the same wasm-native set as `go:wasmimport`.
- A module that uses `go:wasmexport` is intended to be used as a **reactor**: the host calls `_initialize` once to run runtime and package initialisation, then calls the exported functions.
- The directive requires **Go 1.24 or newer**; earlier toolchains do not recognise it.

This is the specified mechanism for exposing Go functionality to a host as a callable library, complementing the inbound `go:wasmimport`.

---

## Module Lifecycle: `_start` and `_initialize`

The WASI specification (and the Go port) define two module shapes:

- **Command.** Exports `_start`. The host calls `_start` once; the module runs to completion (typically calling `proc_exit`). This is the default for `go build` of a `package main`. The instance is consumed by running it.
- **Reactor.** Exports `_initialize` plus other functions. The host calls `_initialize` once for initialisation, then calls exported functions any number of times without re-initialising. This is the shape produced when a module exposes `go:wasmexport` functions for repeated invocation.

The specification requires that `_initialize` (reactor) or `_start` (command) run before any other exported function is called, so that runtime and module initialisation complete first. Calling an exported function before initialisation is unspecified behaviour.

---

## WASI Preview 1 vs Preview 2

WASI is versioned in *previews*, and the distinction is specified by the WASI subgroup:

- **Preview 1 (`wasi_snapshot_preview1`)** — the flat, function-list ABI described above. Mature, stable, universally supported. **This is what Go's `GOOS=wasip1` targets.**
- **Preview 2 ("WASI 0.2")** — a redesign on top of the **Component Model**, with typed interfaces described in WIT (WebAssembly Interface Types), composable components, and standard interfaces including `wasi:sockets` (real networking), `wasi:http`, `wasi:filesystem`, and `wasi:clocks`.

Specified status for Go: the Go *standard toolchain* emits **preview 1** modules. It does not emit preview-2 components today. The Go project has stated intent to support the Component Model / preview 2, and external adapter tooling can wrap a `wasip1` core module into a preview-2 component, but the canonical `go build` output is a preview-1 module.

The practical specification consequence: documentation, interfaces, and WIT worlds labelled "WASI 0.2," "Component Model," or `wasi:*` describe preview 2 and do not directly govern a `GOOS=wasip1` build.

---

## Differences Across Go Versions

The `wasip1` support has evolved:

- **Go 1.21** — `GOOS=wasip1 GOARCH=wasm` introduced. The `go:wasmimport` directive added (for both `wasip1` and `js/wasm`). The `go run`/`go test` exec wrapper (`go_wasip1_wasm_exec`) and `GOWASIRUNTIME` added. `runtime.Pinner` also added (1.21), useful for the memory boundary.
- **Go 1.22** — refinements to the `wasip1` port and `go:wasmimport` type handling; bug fixes in the runtime support.
- **Go 1.23** — continued refinements; improvements to the wasm backend and ABI handling.
- **Go 1.24** — `go:wasmexport` directive added, enabling reactor-style modules that export Go functions to the host. This is the version floor for exporting Go functions.

The mechanical target — `GOOS=wasip1 GOARCH=wasm go build` producing a preview-1 `.wasm` — has been stable since Go 1.21. The principal additions have been `go:wasmexport` (1.24) and incremental ABI/type refinements. Throughout, the standard toolchain has targeted **WASI preview 1**, not preview 2.

---

## References

- [Go blog: "WASI support in Go"](https://go.dev/blog/wasi) — authoritative announcement (Go 1.21).
- [Go wiki: WebAssembly](https://go.dev/wiki/WebAssembly) — overview of all Go wasm targets, including `wasip1`.
- [Go 1.21 release notes](https://go.dev/doc/go1.21) — the `wasip1` port and `go:wasmimport`.
- [Go 1.24 release notes](https://go.dev/doc/go1.24) — `go:wasmexport`.
- [`cmd/compile` directives documentation](https://pkg.go.dev/cmd/compile) — `go:wasmimport`, `go:wasmexport`.
- [WASI preview 1 specification](https://github.com/WebAssembly/WASI/blob/main/legacy/preview1/docs.md) — the `wasi_snapshot_preview1` ABI.
- [WASI.dev](https://wasi.dev) — the WASI project, preview 1 and preview 2.
- [Source: `src/runtime/os_wasip1.go`](https://cs.opensource.google/go/go/+/refs/tags/master:src/runtime/os_wasip1.go) — the runtime port.
