# WASI & `GOOS=wasip1` — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [The `wasip1` ABI: What the Module Imports](#the-wasip1-abi-what-the-module-imports)
3. [The Capability Model in Detail (Preopens, Env, Args)](#the-capability-model-in-detail-preopens-env-args)
4. [Path Mapping: Host Path vs Guest Path](#path-mapping-host-path-vs-guest-path)
5. [The `go run` / `go test` Exec Wrapper](#the-go-run-go-test-exec-wrapper)
6. [Calling the Host: `go:wasmimport` (Go 1.21)](#calling-the-host-gowasmimport-go-121)
7. [Networking on `wasip1`: What Is and Is Not There](#networking-on-wasip1-what-is-and-is-not-there)
8. [Concurrency: Goroutines on One Thread](#concurrency-goroutines-on-one-thread)
9. [Build Tags and Platform-Specific Code](#build-tags-and-platform-specific-code)
10. [Runtime Differences You Will Actually Hit](#runtime-differences-you-will-actually-hit)
11. [`wasip1` vs `wasip2` / The Component Model](#wasip1-vs-wasip2-the-component-model)
12. [Common Errors and Their Real Causes](#common-errors-and-their-real-causes)
13. [When `wasip1` Is Right and When It Is Wrong](#when-wasip1-is-right-and-when-it-is-wrong)
14. [Best Practices](#best-practices)
15. [Pitfalls You Will Meet in Real Projects](#pitfalls-you-will-meet-in-real-projects)
16. [Self-Assessment](#self-assessment)
17. [Summary](#summary)

---

## Introduction

You already know the mechanical effect of `GOOS=wasip1 GOARCH=wasm go build`: it produces a `.wasm` module that runs on a WASI runtime outside the browser, with zero ambient authority. The middle-level questions are *what does that module actually import from the host*, *how do capabilities flow from the run command into your program*, and *what does the toolchain do differently — exec wrappers, host imports, build tags — once you leave the "hello world" demo*.

This file zooms in from "it works" to "I understand the boundary." The boundary is everything in `wasip1`: the ABI your module imports, the capabilities the host grants, the path translation between host and guest, and the precise edges where portability stops being free.

After reading this you will:
- Know exactly which functions a `wasip1` module imports and from where
- Trace a capability from `--dir`/`--env` on the command line to `os.Open`/`os.Getenv` in your code
- Understand host-path-to-guest-path mapping and why "file not found" is almost always a mapping bug
- Use `go:wasmimport` to call a host-provided function (Go 1.21)
- State precisely what networking and concurrency do and do not work
- Diagnose every common `wasip1` error from a one-line message

---

## The `wasip1` ABI: What the Module Imports

A compiled `wasip1` module is not self-contained. It is a list of *imported functions* plus your code. Dump the imports of any Go `wasip1` binary and you will see entries from one module namespace: `wasi_snapshot_preview1`.

```bash
GOOS=wasip1 GOARCH=wasm go build -o main.wasm .
wasm-tools print main.wasm | grep '(import "wasi_snapshot_preview1"'
# (import "wasi_snapshot_preview1" "fd_write" (func ...))
# (import "wasi_snapshot_preview1" "fd_read" (func ...))
# (import "wasi_snapshot_preview1" "path_open" (func ...))
# (import "wasi_snapshot_preview1" "clock_time_get" (func ...))
# (import "wasi_snapshot_preview1" "random_get" (func ...))
# (import "wasi_snapshot_preview1" "args_sizes_get" (func ...))
# ... and a few dozen more
```

`wasi_snapshot_preview1` is the formal name of WASI preview 1. Every preview-1 runtime — Wasmtime, wazero, WasmEdge, Node's WASI shim — promises to supply implementations of these functions. The Go runtime's syscall layer is wired to call them: `os.Stdout.Write` lowers to `fd_write`, `time.Now` to `clock_time_get`, `crypto/rand` to `random_get`, `os.Open` to `path_open` against a preopened directory.

The practical consequence: **a `wasip1` module can only do what `wasi_snapshot_preview1` exposes.** There is no `fork`, no `socket` (in the standard set), no `ptrace`. If the Go standard library needs a syscall preview 1 does not have, that code path either returns `ENOSYS`-style errors or is compiled out by build tags. This is why "it compiled" does not mean "it will work" — the import list is the real contract.

---

## The Capability Model in Detail (Preopens, Env, Args)

The junior file introduced "deny by default." Here is the mechanism.

A `wasip1` module starts with a *file descriptor table* that the host populates before `main` runs. By convention:

- **fd 0, 1, 2** — stdin, stdout, stderr. The host wires these to its own streams (or to `/dev/null` if not granted).
- **fd 3, 4, …** — *preopened directories*, one per `--dir`. Each carries a guest path the module is allowed to resolve against.

When your Go code calls `os.Open("/data/x.txt")`, the runtime does not perform a raw `open`. It calls `path_open` *relative to a preopened fd* whose guest path is a prefix of `/data`. If no preopen covers that path, there is no fd to resolve against, and the call fails with a permission/not-found error. The directory is invisible because there is literally no descriptor pointing at it.

Environment and arguments work the same way: the module imports `environ_get` / `args_get`, and the host returns *only* what it was told to pass.

```bash
# Three independent capability grants:
wasmtime \
  --dir=./data \                # grants a preopen fd
  --env API_TOKEN=secret \      # populates environ_get
  main.wasm --verbose input.txt # populates args_get
```

Inside the program:

```go
os.Getenv("API_TOKEN")     // "secret" — because --env granted it
os.Getenv("PATH")          // ""       — never granted
os.Args                    // [main.wasm --verbose input.txt]
os.ReadFile("/data/x.txt") // ok       — covered by the --dir preopen
os.ReadFile("/etc/passwd") // error    — no preopen covers /etc
```

The mental model that matters: **the same `main.wasm` is more or less powerful depending entirely on the flags at run time.** The capability set is a property of the invocation, not the binary.

---

## Path Mapping: Host Path vs Guest Path

This is the single most common source of confusion, so it deserves its own section.

A preopen has two paths: the **host path** (a real directory on the machine) and the **guest path** (what the module sees). Runtimes let you set them independently.

Wasmtime's syntax (recent versions):

```bash
# host ./data is visible to the guest as /data
wasmtime --dir=./data::/data main.wasm

# host ./data is visible to the guest as . (current dir)
wasmtime --dir=./data::. main.wasm

# shorthand: host and guest paths identical
wasmtime --dir=./data main.wasm   # guest also sees ./data (runtime-dependent)
```

wazero's CLI uses `--mount`:

```bash
wazero run -mount=./data:/data main.wasm
```

The trap: your Go code hardcodes a *guest* path, but you grant a *host* path with a different guest mapping. The directory is preopened, yet `os.Open` still fails, because the path the code asks for is not the guest path the host advertised.

```go
// Code expects guest path /data:
os.ReadFile("/data/in.json")
```

```bash
# But the mapping advertises guest path /input:
wasmtime --dir=./data::/input main.wasm   # FAILS: /data not preopened
wasmtime --dir=./data::/data  main.wasm   # works
```

Rule: **the guest path in your code must match the guest side of the mapping.** When debugging "file not found for a file that exists," check the guest path first, not the host path.

---

## The `go run` / `go test` Exec Wrapper

You can run and test `wasip1` builds with the normal Go workflow, but `go` cannot execute a `.wasm` itself — it shells out to a runtime via an *exec wrapper*.

When you run `go run .` with `GOOS=wasip1 GOARCH=wasm`, the toolchain looks for an executable named `go_wasip1_wasm_exec` on your `PATH` (the Go distribution ships one under `$(go env GOROOT)/lib/wasm/`, or `misc/wasm/` in older layouts). That script reads the `GOWASIRUNTIME` environment variable to decide which runtime to invoke (defaulting to `wasmtime`), then executes the produced `.wasm` with it.

```bash
export GOOS=wasip1 GOARCH=wasm
export GOWASIRUNTIME=wasmtime          # or wazero, wasmedge
export PATH="$PATH:$(go env GOROOT)/lib/wasm"

go run .                               # builds, then runs via the wrapper
go test ./...                          # builds the test binary, runs it via the wrapper
```

Two things to internalise:

- **Without the wrapper on `PATH`, `go run`/`go test` fail to launch the binary.** The error is usually a confusing "exec format error" or "no such file" because the OS cannot run wasm directly.
- **Capabilities for `go test` come from the runtime, not from `go`.** If a test reads a fixture file, the wrapper must preopen its directory. `GOWASIRUNTIME` plus runtime-specific flags (set via `GOWASIRUNTIMEARGS` on some setups) control this. Tests that touch the filesystem need their `testdata/` preopened.

Putting wasm tests in CI is valuable: it exercises the `wasip1` code path on every commit and catches build-tag mistakes (a file that compiles natively but not under `wasip1`).

---

## Calling the Host: `go:wasmimport` (Go 1.21)

`go:wasmimport` (added in **Go 1.21**, the same release as the port) lets your Go code call a function *provided by the host runtime* rather than by WASI. This is how you talk to a custom embedding — a Go host using wazero, a runtime extension, a plugin ABI you define.

The directive sits above a function declaration with no body; the linker binds it to a host import.

```go
//go:build wasip1

package main

import "unsafe"

// Import a function the host provides under module "env", name "log_message".
// The host must supply a matching implementation at instantiation time.
//
//go:wasmimport env log_message
func hostLog(ptr unsafe.Pointer, size uint32)

func logToHost(msg string) {
	b := []byte(msg)
	if len(b) == 0 {
		return
	}
	hostLog(unsafe.Pointer(&b[0]), uint32(len(b)))
}

func main() {
	logToHost("hello from the guest")
}
```

Critical constraints (the source of most `go:wasmimport` confusion):

- **Parameter and result types are restricted.** Only the wasm-native scalar types are allowed across the boundary: `int32`/`uint32`, `int64`/`uint64`, `float32`/`float64`, `unsafe.Pointer`, and a few pointer-shaped types. You cannot pass a Go `string`, `[]byte`, or `struct` directly; you pass a pointer + length and the host reads guest linear memory.
- **The host must supply the import.** If you run this on stock `wasmtime main.wasm` with no `env.log_message` defined, instantiation fails with "unknown import." `go:wasmimport` only works against a host that provides the function — typically your own embedder.
- **Memory ownership is manual.** The host reads bytes out of the guest's linear memory at the pointer you pass. You must keep the backing slice alive across the call (the example takes `&b[0]` of a live slice) and ensure the host does not retain the pointer past the call.

`go:wasmimport` is the *inbound* half of host interop. The *outbound* half — exporting Go functions to the host — is `go:wasmexport`, added in **Go 1.24**, covered in [professional.md](professional.md).

---

## Networking on `wasip1`: What Is and Is Not There

Be precise here, because overclaiming wastes hours.

WASI preview 1 has **no general networking API**. There is no portable `socket`/`connect`/`bind`/`listen` in `wasi_snapshot_preview1`. Consequently:

- `net.Dial("tcp", ...)` — does not work on portable `wasip1`. There is no outbound socket primitive.
- `net.Listen("tcp", ":8080")` — does not work. You cannot write a portable TCP server.
- `http.Get` / `http.ListenAndServe` — fail for the same reason; they sit on `net`.

There is one narrow exception worth knowing. Preview 1 defines `sock_accept` (and some runtimes add non-standard `sock_*` extensions). This supports *pre-opened* listening sockets: the *host* opens the listener and hands the module an already-bound fd, and the module accepts connections on it. This is how some serverless/edge platforms route requests into a `wasip1` module. But:

- It is **not** how Go's `net` package works on `wasip1` out of the box; Go's `wasip1` net support is restricted, and accepting on a host-provided fd requires runtime-specific glue.
- Runtimes differ wildly. WasmEdge ships a non-standard socket extension; stock Wasmtime does not expose general sockets to preview-1 guests. Code that relies on an extension is **not portable**.

The honest summary: treat `wasip1` as having no networking. If you need sockets today, either use a runtime extension (and accept non-portability) or wait for preview 2, whose WASI sockets interface is the real networking story. Do not design a `wasip1` service around "it'll have networking soon."

---

## Concurrency: Goroutines on One Thread

`wasip1` is single-threaded. The wasm preview-1 execution model has no threads, and Go's `wasip1` runtime schedules all goroutines cooperatively on a single OS thread.

What this means concretely:

- **Goroutines work.** `go func() { ... }()`, channels, `sync.WaitGroup`, `select` — all function correctly. The scheduler still multiplexes them.
- **There is no parallelism.** `GOMAXPROCS` is effectively 1. CPU-bound goroutines do not run on multiple cores; they take turns. A parallel `for` loop over goroutines does not speed up on `wasip1`.
- **Blocking is cooperative.** A goroutine blocked on a WASI call (e.g. a slow `fd_read` from stdin) yields to others, but there is no preemption across cores because there is only one.
- **No `fork`/`exec`.** `os/exec` is unavailable; you cannot spawn subprocesses or OS threads.

Design implication: `wasip1` is for *concurrency as structure* (organising I/O-bound work cleanly), not *parallelism as speedup*. If your workload only goes fast with multiple cores, `wasip1` is the wrong target.

---

## Build Tags and Platform-Specific Code

`wasip1` is a `GOOS`, so the build-constraint system treats it like any other platform. Use it to fence code that cannot compile or run under wasm.

```go
//go:build !wasip1

package transport

// Native path: a real TCP server.
func Serve(addr string) error { /* net.Listen ... */ }
```

```go
//go:build wasip1

package transport

import "errors"

// wasm path: networking is unavailable; fail loudly and early.
func Serve(addr string) error {
	return errors.New("transport.Serve: not supported on wasip1 (no networking)")
}
```

Notes:

- The constraint identifier is `wasip1` (the `GOOS`), not `wasm` (the `GOARCH`). `//go:build wasm` matches *both* `js/wasm` and `wasip1/wasm`; use `//go:build wasip1` when you specifically mean the WASI target, and `//go:build js` for the browser target.
- File-name suffixes also work: `transport_wasip1.go` is compiled only for `wasip1`, `transport_js.go` only for `js`.
- A common combined tag is `//go:build wasm` for code shared by *both* wasm targets, with `wasip1`/`js`-specific files for the divergent parts.

Guard at the *seam*, not throughout. Isolate the unsupported operation behind one interface, provide a `wasip1` implementation that returns a clear error, and keep the rest of the codebase platform-agnostic.

---

## Runtime Differences You Will Actually Hit

"Portable across all WASI runtimes" is true for the standard preview-1 feature set and false at the edges. The differences you will meet:

- **Path mapping syntax differs.** Wasmtime uses `--dir=host::guest`; wazero's CLI uses `-mount=host:guest`; WasmEdge uses `--dir guest:host` (order reversed). Read your runtime's docs; do not assume.
- **Socket extensions differ.** WasmEdge has a non-standard socket API; Wasmtime exposes preview-1 sockets only minimally. Code using either is non-portable.
- **Clock and randomness are standard** (`clock_time_get`, `random_get`) and behave consistently everywhere.
- **Resource limits differ.** Wasmtime has *fuel* (an instruction budget) and memory limits; wazero exposes limits through its embedding API; the CLIs surface these differently. There is no portable in-module way to query them.
- **`stdin` EOF behaviour** can differ subtly between runtimes when stdin is not connected. Always handle `io.EOF` and empty input.
- **Argument-zero (`os.Args[0]`)** is the module name on some runtimes and a full path on others. Do not depend on its exact value.

Practical rule: pick one runtime as your reference, pin its version, and test on the runtimes you actually deploy to. "It runs on my Wasmtime" is necessary, not sufficient.

---

## `wasip1` vs `wasip2` / The Component Model

WASI is versioned in *previews*, and the distinction governs what you can build.

- **Preview 1 (`wasip1`)** is a flat list of imported functions in the `wasi_snapshot_preview1` namespace. It is mature, universally supported, and is exactly what `GOOS=wasip1` targets today.
- **Preview 2 (often "WASI 0.2")** is rebuilt on the **Component Model**: rich interface types, a real `wasi:sockets` networking story, `wasi:http`, composable components, and a `world` description in WIT (WebAssembly Interface Types). It is more capable but newer, and the Go *standard* toolchain does **not** emit preview-2 components today.

Where Go is heading: the team has stated intent to support preview 2 / components, and external tooling (e.g. component-adapters that wrap a `wasip1` core module into a preview-2 component) exists today as a bridge. But for current standard-toolchain work, **you target `wasip1`, full stop.**

Why it matters at the middle level: tutorials and tooling labelled "WASI 0.2," "Component Model," "WIT," or "`wasi:http`" are about preview 2. They do not directly apply to a `GOOS=wasip1` build. When you read about WASI sockets "just working," check whether the article is about preview 2 — almost always it is.

---

## Common Errors and Their Real Causes

A field guide to the messages you will actually see.

### `unknown import: wasi_snapshot_preview1::sock_accept` (or another `sock_*`)

Your code (or a dependency) pulled in a networking path the runtime does not implement. Cause: a `net`-based call leaked into the `wasip1` build, or a dependency assumes sockets. Fix: guard the networking code with `//go:build !wasip1` and provide a wasm-friendly path, or remove the dependency on that path.

### `unknown import: env::<yourfunc>`

You used `go:wasmimport` against a host that does not provide the named function. Cause: running a module that expects a custom host import on a stock CLI runtime. Fix: run it on the embedder that supplies the import, or stub the import for standalone runs.

### "operation not permitted" / "no such file or directory" for a file that exists

No preopen covers the path, or the *guest* path in your code does not match the preopen's guest mapping. Fix: add `--dir`, and verify the guest path (see [Path Mapping](#path-mapping-host-path-vs-guest-path)).

### "GOOS/GOARCH pair wasip1/wasm not supported"

Go older than 1.21. Upgrade.

### `//go:wasmexport requires go1.24` (or the directive is ignored)

`go:wasmexport` was added in Go 1.24. On an older toolchain it is unrecognised or rejected. Upgrade, or use only `go:wasmimport` (1.21).

### `go run` / `go test` produce "exec format error" or do nothing

The exec wrapper is not on `PATH`, or `GOWASIRUNTIME` points at a runtime that is not installed. Fix: add `$(go env GOROOT)/lib/wasm` to `PATH` and set `GOWASIRUNTIME`.

### Program hangs forever

Usually a blocking network read or a wait on a subprocess — operations that never complete on `wasip1`. Fix: audit for `net`, `os/exec`, and blocking syscalls; guard them.

### `go:wasmimport` call corrupts data or panics

You passed a Go pointer to memory that moved or was freed, or you passed an unsupported type. Fix: pin the backing slice (keep it referenced), pass `unsafe.Pointer(&b[0])` + length, and use only the allowed scalar/pointer types.

---

## When `wasip1` Is Right and When It Is Wrong

A decision matrix for design review.

| Situation | `wasip1`? | Why |
|-----------|-----------|-----|
| Read input, compute, write output (filter) | Yes | The shape `wasip1` is built for. |
| Sandboxed execution of untrusted/user code | Yes | Deny-by-default capability model. |
| Plugin loaded by a Go host (wazero) | Yes | Host grants exactly the capabilities the plugin needs. |
| Edge/serverless function with fast cold start | Yes | Microsecond-to-millisecond instantiation. |
| Portable CLI distributed as one artifact | Yes | One `.wasm` for all architectures. |
| TCP/HTTP server that listens on a port | No | No general networking on preview 1. |
| CPU-bound workload needing many cores | No | Single-threaded; no parallelism. |
| Tool that shells out to other binaries | No | No `os/exec`, no `fork`. |
| Tightly size-constrained deployment | Maybe | Go `wasip1` binaries are MB-scale; consider TinyGo. |
| Code needing preview-2 features (`wasi:http`) | No (yet) | Go standard toolchain targets preview 1. |

The pattern: **`wasip1` fits function-shaped, I/O-light, sandbox-friendly compute.** It does not fit daemon-shaped, network-bound, multi-core, or subprocess-driven workloads.

---

## Best Practices

1. **Pin Go ≥ 1.21** (≥ 1.24 if you need `go:wasmexport`). The port and each directive have hard version floors.
2. **Match guest paths in code to the preopen mapping**, and document the required `--dir`/`--env` next to the run command.
3. **Grant the minimum capability.** Narrow preopens, only the env vars you need; never `--dir=/`.
4. **Guard unsupported operations behind `//go:build !wasip1`** and provide a `wasip1` path that fails with a clear message — never one that hangs.
5. **Test under `wasip1` in CI** using the exec wrapper, so the wasm code path is exercised on every commit.
6. **Pin and name your runtime** (and its version) in docs and CI; behaviour drifts across runtimes and versions.
7. **For `go:wasmimport`, keep the backing memory alive** across the call and use only allowed boundary types.
8. **Do not design around networking or subprocesses.** If you need them, `wasip1` is the wrong target today.

---

## Pitfalls You Will Meet in Real Projects

### Pitfall 1 — Guest/host path confusion
A file exists and `--dir` was passed, yet `os.Open` fails. The code uses a guest path the mapping does not advertise. Always verify the guest side of the mapping.

### Pitfall 2 — A dependency drags in `net`
Your own code avoids networking, but a transitive dependency imports `net` on a path your build reaches. The module fails to instantiate with an `unknown import` socket error. Audit imports; guard or replace the dependency on `wasip1`.

### Pitfall 3 — Expecting `go test` to find fixtures
A test reads `testdata/x.json`, passes natively, fails under the exec wrapper because `testdata/` was not preopened. Configure the runtime args so the wrapper grants the directory.

### Pitfall 4 — `go:wasmimport` on a stock runtime
A module with a custom host import is run on `wasmtime main.wasm` with no embedder. Instantiation fails with `unknown import: env::...`. `go:wasmimport` requires a host that provides the function.

### Pitfall 5 — Using `go:wasmexport` on Go < 1.24
The directive is rejected or silently ineffective. It is a Go 1.24 feature; check `go version`.

### Pitfall 6 — Confusing the two wasm `GOOS` values
`//go:build wasm` matches both `js` and `wasip1`. A file meant only for the WASI target leaks into the browser build (or vice versa). Use the specific `wasip1` / `js` tags for divergent code.

### Pitfall 7 — Passing a moved Go pointer to the host
A `go:wasmimport` call receives a pointer into a slice that was reallocated or went out of scope. The host reads garbage or the program panics. Keep the backing slice referenced for the call's duration.

### Pitfall 8 — Assuming runtime parity
Code that uses WasmEdge's socket extension is shipped as "portable" and fails on Wasmtime. Extensions are not standard preview 1; only the standard set is portable.

---

## Self-Assessment

You can move on to [senior.md](senior.md) when you can:

- [ ] Name the import namespace a `wasip1` module uses and list five functions in it
- [ ] Trace a capability from a `--dir`/`--env` flag to the Go call that consumes it
- [ ] Explain host-path vs guest-path mapping and diagnose a mapping-caused "not found"
- [ ] Set up and explain the `go run`/`go test` exec wrapper and `GOWASIRUNTIME`
- [ ] Write a `go:wasmimport` declaration and state its type and version constraints
- [ ] State precisely what networking does and does not work on `wasip1`
- [ ] Explain why goroutines work but parallelism does not on `wasip1`
- [ ] Use `//go:build wasip1` correctly and distinguish it from `//go:build wasm` and `//go:build js`
- [ ] List three runtime differences that break naive portability
- [ ] Articulate the difference between preview 1 and preview 2 and which Go targets

---

## Summary

At the middle level, `wasip1` stops being "another `GOOS`" and becomes a precise contract. A compiled module imports the `wasi_snapshot_preview1` function set and nothing else; everything it can do flows through those imports plus whatever the host grants at run time. Capabilities — preopened directories, environment variables, arguments — arrive through the file-descriptor table and the `environ_get`/`args_get` imports, which is why the same `.wasm` is more or less powerful depending entirely on the run command. The most common bug is not a Go bug at all: it is a mismatch between the guest path in your code and the guest side of the host's path mapping.

`go:wasmimport` (Go 1.21) opens the inbound host-interop door, with strict boundary-type and memory-ownership rules; `go:wasmexport` (Go 1.24) is the outbound half. Networking is effectively absent on preview 1 — treat it as unavailable rather than betting on runtime extensions — and execution is single-threaded, so `wasip1` is for clean I/O-bound concurrency, not multi-core speedup. Fence unsupported operations behind `//go:build wasip1`, test the wasm path in CI through the exec wrapper, pin your runtime, and remember that everything labelled "Component Model" or "WASI 0.2" is preview 2, which the Go standard toolchain does not yet emit.
