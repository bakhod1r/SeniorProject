# WASI & `GOOS=wasip1` — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [What the Toolchain Does for `GOOS=wasip1`](#what-the-toolchain-does-for-goos-wasip1)
3. [The Import Surface: `wasi_snapshot_preview1` in Detail](#the-import-surface-wasi_snapshot_preview1-in-detail)
4. [`go:wasmimport` Internals and Type Rules](#gowasmimport-internals-and-type-rules)
5. [`go:wasmexport` Internals (Go 1.24)](#gowasmexport-internals-go-124)
6. [The Memory Boundary: Pointers, Pinning, and the GC](#the-memory-boundary-pointers-pinning-and-the-gc)
7. [The `_start` / `_initialize` Lifecycle](#the-_start-_initialize-lifecycle)
8. [The Exec Wrapper and `GOWASIRUNTIME`](#the-exec-wrapper-and-gowasiruntime)
9. [Embedding a Go Guest in a Go Host with wazero](#embedding-a-go-guest-in-a-go-host-with-wazero)
10. [Build Flags, Size, and Reproducibility](#build-flags-size-and-reproducibility)
11. [CI/CD for `wasip1` Artifacts](#cicd-for-wasip1-artifacts)
12. [Edge Cases the Source Reveals](#edge-cases-the-source-reveals)
13. [Operational Playbook](#operational-playbook)
14. [Summary](#summary)

---

## Introduction

The professional level treats `wasip1` not as a build flag but as the surface area of a contract between four subsystems: the Go compiler and linker, the wasm execution model, the WASI preview-1 ABI, and the host runtime that supplies it. The `go build` command emits a module, but every import that module declares is later resolved by a host under strict instantiation checks. Misunderstanding the import surface, the memory boundary, or the lifecycle is the single most common source of opaque "unknown import" and "memory corruption" failures.

This file is for engineers who build `wasip1` infrastructure, embed wasm in Go hosts, define host/guest ABIs, or own the correctness of sandboxed execution. After reading you will:

- Know what the toolchain does for `GOOS=wasip1`, end to end.
- Reason about the `wasi_snapshot_preview1` import set as the module's actual contract.
- Use `go:wasmimport` (Go 1.21) and `go:wasmexport` (Go 1.24) with correct type and memory rules.
- Understand the `_start`/`_initialize` lifecycle that distinguishes a command from a reactor.
- Embed a Go-compiled guest inside a Go host with wazero, correctly and performantly.

`wasip1` is conceptually simple — Go compiled to a sandboxed module — but its details govern the safety and reproducibility of the system for years. Treating it as "just another `GOOS`" misses the ABI machinery that makes host interop safe.

---

## What the Toolchain Does for `GOOS=wasip1`

When you run `GOOS=wasip1 GOARCH=wasm go build`, the toolchain:

1. **Selects the `wasip1` runtime support.** The Go runtime has a port (`runtime/os_wasip1.go`, `syscall/syscall_wasip1.go`, and friends) whose syscall layer calls `wasi_snapshot_preview1` functions instead of Linux/Darwin syscalls.
2. **Compiles to the wasm instruction set.** `GOARCH=wasm` selects the wasm backend; the result is a `.wasm` binary in the standard WebAssembly binary format.
3. **Emits imports for the WASI functions the runtime uses.** Every WASI call the linked runtime can reach becomes an `(import "wasi_snapshot_preview1" "...")` entry in the module.
4. **Emits a `_start` export.** A `wasip1` `go build` produces a *command* module: the host calls the exported `_start`, which runs Go's runtime init and your `main`, then exits. (With `go:wasmexport`, additional exports appear; see below.)
5. **Embeds the Go runtime.** The scheduler, GC, and stdlib are compiled into the module — which is why even a trivial binary is several MB.

The output is a single self-describing artifact: its import section is the complete list of host obligations, and its export section is the complete list of entry points. Dumping both (`wasm-tools print`, `wasm-objdump -x`) tells you everything the host must provide and everything it can call.

---

## The Import Surface: `wasi_snapshot_preview1` in Detail

The module imports a fixed namespace. The functions Go's `wasip1` runtime relies on include:

| Function | Backs (Go) |
|----------|------------|
| `fd_write` | `os.Stdout.Write`, file writes |
| `fd_read` | `os.Stdin.Read`, file reads |
| `fd_close`, `fd_seek`, `fd_fdstat_get` | file descriptor management |
| `path_open` | `os.Open`, `os.OpenFile` (relative to a preopen) |
| `path_filestat_get`, `path_unlink_file`, `path_create_directory` | filesystem metadata/mutation |
| `fd_prestat_get`, `fd_prestat_dir_name` | enumerating preopened directories |
| `clock_time_get`, `clock_res_get` | `time.Now`, monotonic time |
| `random_get` | `crypto/rand`, `math/rand` seeding |
| `args_sizes_get`, `args_get` | `os.Args` |
| `environ_sizes_get`, `environ_get` | `os.Getenv`, `os.Environ` |
| `poll_oneoff` | timers, `time.Sleep`, blocking |
| `proc_exit` | `os.Exit`, normal termination |
| `sched_yield` | scheduler cooperation |

Three professional observations:

- **The import set defines feasibility, not the language.** A Go feature whose syscalls are not in this set either errors at runtime or is excluded by build tags. There is no `socket`, `fork`, `execve`, `mmap`-with-arbitrary-flags, or `ptrace` here.
- **`poll_oneoff` is how blocking works.** Single-threaded Go on `wasip1` uses `poll_oneoff` to wait on timers and fds, yielding the one thread cooperatively. Runtimes implement it differently; subtle blocking/timing bugs trace back here.
- **Preopen discovery is dynamic.** At startup the Go runtime calls `fd_prestat_get`/`fd_prestat_dir_name` to learn which directories were preopened and at which guest paths, building the mapping the `os` package resolves against. This is why the guest path is whatever the *host advertised*, not what your code wishes.

A host that does not implement every imported function fails instantiation with `unknown import`. This is the contract being enforced.

---

## `go:wasmimport` Internals and Type Rules

`go:wasmimport` (Go 1.21) declares that a Go function is implemented by a host import. The directive form:

```go
//go:wasmimport <module> <name>
func f(args...) (result...)
```

The compiler emits an `(import "<module>" "<name>" (func ...))` with a signature derived from the Go function, and the linker leaves the body unresolved — the host supplies it at instantiation.

### Allowed types (the hard rule)

Only types that map directly to wasm value types or to guest memory may cross the boundary:

- `int32`, `uint32` → wasm `i32`
- `int64`, `uint64` → wasm `i64`
- `float32` → wasm `f32`, `float64` → wasm `f64`
- `unsafe.Pointer` → `i32` (a guest linear-memory offset)
- `uintptr` (in pointer-ish positions), and pointer-to-allowed-types in specific contexts
- `bool` and `string`/slice support has tightened across versions; the portable, always-correct approach is to pass a pointer + length and let the host read memory

You **cannot** pass a Go `string`, `[]byte`, `map`, `interface`, or `struct` value directly across a `go:wasmimport` boundary in a way that survives version changes. The compiler rejects unsupported types with a clear error. Pass primitives and memory offsets.

### The marshalling convention

Because rich types do not cross, the universal pattern is pointer + length:

```go
//go:wasmimport host emit
func emit(ptr unsafe.Pointer, n uint32) uint32 // returns bytes consumed, say

func send(b []byte) {
	if len(b) == 0 {
		return
	}
	emit(unsafe.Pointer(&b[0]), uint32(len(b)))
}
```

The host receives the offset and length, reads that range out of the guest's linear memory, and acts on it. You define and document the serialisation (raw bytes, JSON, protobuf) layered on top.

---

## `go:wasmexport` Internals (Go 1.24)

`go:wasmexport` (added in **Go 1.24**) is the inverse: it exposes a Go function *to the host* as a wasm export.

```go
//go:wasmexport process
func process(ptr unsafe.Pointer, n uint32) uint32 {
	input := unsafe.Slice((*byte)(ptr), n)
	// ... compute over input, write result somewhere the host can read ...
	return resultLen
}
```

Key facts and constraints:

- **Version floor: Go 1.24.** On earlier toolchains the directive is unrecognised. Code using it will not build on 1.21–1.23. This is the most common `go:wasmexport` mistake — using it after reading a current blog post on an older toolchain.
- **Same type rules as `go:wasmimport`.** Parameters and results must be wasm-native scalars or pointers. Rich data crosses as pointer + length.
- **It changes the module from a pure command to a reactor.** A module with exported functions is meant to be instantiated once and *called multiple times* by the host, rather than run-once via `_start`. The host instantiates, then invokes `process` per request. This is the request/response plugin model.
- **The Go runtime must be initialised before exports are called.** With reactor-style usage the host calls `_initialize` (not `_start`) once to run runtime/package init, then calls the exported functions. Getting this lifecycle wrong (calling an export before init) is a class of subtle bug.

`go:wasmexport` is what makes a `wasip1` module a callable library rather than a one-shot program — the foundation for performant plugin systems where compile-once-instantiate-once-call-many is the pattern.

---

## The Memory Boundary: Pointers, Pinning, and the GC

The most dangerous part of host interop is memory, because the type system does not protect you here.

### The model

- The guest has a single **linear memory** (a `[]byte`-like region). Pointers passed across the boundary are *offsets into this memory*, not host addresses.
- The host reads/writes the guest's linear memory at those offsets. It cannot follow Go pointers into structured objects; it sees raw bytes.

### The GC hazard

Go's garbage collector can move or free objects. If you pass `unsafe.Pointer(&b[0])` to the host and the slice is collected or moved before/while the host reads it, the host reads freed or relocated memory — corruption or a crash.

Mitigations:

- **Keep the backing object live across the call.** In the simplest case, the slice referenced by `&b[0]` is reachable for the duration of the synchronous `go:wasmimport` call, which is enough for a host that reads synchronously and does not retain the pointer.
- **For asynchronous or retained access, the host must copy** the bytes out during the call; the guest must not assume the pointer is valid afterward.
- **`runtime.Pinner` (Go 1.21+)** can pin an object so the GC will not move it for the pin's duration — useful when a pointer must remain stable across a sequence of host operations.
- **Never pass a pointer the host will hold past the call** unless you have explicitly pinned and lifecycle-managed the memory. Document ownership for every pointer in the ABI.

### Practical rule

Treat every cross-boundary pointer as valid only for the synchronous duration of the call, unless you have pinned it and documented otherwise. The compiler will not catch a violation; the symptom is intermittent corruption that looks like a runtime bug.

---

## The `_start` / `_initialize` Lifecycle

There are two host-callable lifecycles, and conflating them causes real bugs.

- **Command modules (default `go build`).** The module exports `_start`. The host calls `_start` once; Go runs runtime init, package `init` functions, and `main`; the program runs to completion and calls `proc_exit`. This is the CLI / one-shot model. A command module is *consumed* by running it.
- **Reactor modules (`go:wasmexport` usage).** The module exports `_initialize` plus your exported functions. The host calls `_initialize` *once* to run runtime and package init, then calls exported functions *repeatedly* without re-initialising. The module persists across calls. This is the library / plugin model.

The professional consequences:

- A reactor whose exports are called before `_initialize` runs against an uninitialised runtime — undefined behaviour. Hosts (and wazero/Wasmtime helpers) must enforce the order.
- A command module's `main` calling `proc_exit` tears down the instance; you cannot then call exports. If you need repeated calls, you need the reactor model, hence Go 1.24's `go:wasmexport`.
- Re-`_initialize`-ing is not supported; for a fresh state you instantiate a new module instance (cheap, given a cached compiled module).

---

## The Exec Wrapper and `GOWASIRUNTIME`

`go run` and `go test` cannot execute a `.wasm` directly; the toolchain delegates to an exec wrapper.

- The wrapper is `go_wasip1_wasm_exec`, shipped in the Go distribution under `$(go env GOROOT)/lib/wasm/` (older layouts: `misc/wasm/`). It must be on `PATH`.
- It reads **`GOWASIRUNTIME`** to choose the runtime (`wasmtime` default; also `wazero`, `wasmedge`, `wasmer` on supported wrapper versions) and invokes it on the built `.wasm`.
- It forwards `os.Args` and may forward runtime arguments; filesystem/env capabilities for tests come from the runtime invocation, so fixture directories must be preopened by the wrapper's runtime args.

```bash
export PATH="$PATH:$(go env GOROOT)/lib/wasm"
export GOWASIRUNTIME=wazero
GOOS=wasip1 GOARCH=wasm go test ./...
```

In CI this is the mechanism that lets you run the full `go test` suite against the `wasip1` build, catching build-tag and ABI mistakes that native testing cannot. Pin the runtime version; behaviour (especially around stdin EOF and path mapping) varies.

---

## Embedding a Go Guest in a Go Host with wazero

The professional reference embedding: a Go program that compiles, instantiates, and drives a `wasip1` guest, with no CGo and no external runtime binary.

```go
import (
	"github.com/tetratelabs/wazero"
	"github.com/tetratelabs/wazero/api"
	"github.com/tetratelabs/wazero/imports/wasi_snapshot_preview1"
)

type PluginHost struct {
	rt       wazero.Runtime
	compiled wazero.CompiledModule
}

func NewPluginHost(ctx context.Context, wasm []byte) (*PluginHost, error) {
	// A compilation cache makes repeated process starts cheap.
	cache := wazero.NewCompilationCache()
	rt := wazero.NewRuntimeWithConfig(ctx,
		wazero.NewRuntimeConfig().WithCompilationCache(cache))

	wasi_snapshot_preview1.MustInstantiate(ctx, rt)

	// Provide a custom host function the guest calls via go:wasmimport.
	_, err := rt.NewHostModuleBuilder("host").
		NewFunctionBuilder().
		WithFunc(func(_ context.Context, m api.Module, ptr, n uint32) uint32 {
			buf, _ := m.Memory().Read(ptr, n) // read guest memory safely
			log.Printf("guest: %s", buf)
			return n
		}).
		Export("emit").
		Instantiate(ctx)
	if err != nil {
		return nil, err
	}

	compiled, err := rt.CompileModule(ctx, wasm) // expensive: do once
	if err != nil {
		return nil, err
	}
	return &PluginHost{rt: rt, compiled: compiled}, nil
}

func (h *PluginHost) Run(ctx context.Context, input []byte) ([]byte, error) {
	ctx, cancel := context.WithTimeout(ctx, 2*time.Second) // bound execution
	defer cancel()

	var out bytes.Buffer
	cfg := wazero.NewModuleConfig().
		WithStdin(bytes.NewReader(input)).
		WithStdout(&out)
	mod, err := h.rt.InstantiateModule(ctx, h.compiled, cfg)
	if err != nil {
		return nil, err // includes traps: fuel/timeout/unknown-import
	}
	defer mod.Close(ctx)
	return out.Bytes(), nil
}
```

Professional notes:

- **`Memory().Read`/`Write` are the safe boundary API** on the host side: they validate the offset and length against the guest's memory bounds, turning an out-of-range pointer into an error instead of a host crash.
- **`CompileModule` once, `InstantiateModule` per request.** Compilation dominates; instantiation is cheap. A `CompilationCache` persists compiled artifacts across host process restarts.
- **`context` is your kill switch.** Cancelling the context interrupts the guest; pair it with memory limits for untrusted code.
- **wazero is pure Go** — no CGo, cross-compiles cleanly, embeds in any Go binary. This is why it dominates the Go-host-embeds-wasm use case.

---

## Build Flags, Size, and Reproducibility

A Go `wasip1` binary embeds the runtime; size and reproducibility deserve attention.

- **Strip symbols:** `-ldflags="-s -w"` removes the symbol table and DWARF, shrinking the module meaningfully.
- **Trim paths:** `-trimpath` removes absolute build paths, improving reproducibility (the same source produces the same bytes across machines).
- **Reproducible builds:** pin the Go toolchain (the `go`/`toolchain` directives plus a fixed build image), pin `GOOS`/`GOARCH`, and use `-trimpath`. The standard library is compiled in, so the toolchain version materially affects output bytes.
- **TinyGo for small modules:** TinyGo emits far smaller `wasip1` modules at the cost of reduced stdlib and reflection support — covered in [16.3 TinyGo](../03-tinygo-for-wasm-and-embedded/professional.md). Choose TinyGo when size/density dominates and you can live within its subset.
- **AOT-compile artifacts:** for runtimes that support it (`wasmtime compile`), precompile the `.wasm` to a native artifact and ship that, so deployment cold start is instantiation-only.

---

## CI/CD for `wasip1` Artifacts

Treat the `.wasm` as a build artifact with its own pipeline.

```yaml
# Build the artifact
- run: GOOS=wasip1 GOARCH=wasm go build -trimpath -ldflags="-s -w" -o app.wasm ./cmd/app

# Test the wasip1 code path through the exec wrapper
- run: |
    export PATH="$PATH:$(go env GOROOT)/lib/wasm"
    export GOWASIRUNTIME=wazero
    GOOS=wasip1 GOARCH=wasm go test ./...

# Validate the module structurally (imports/exports as expected)
- run: wasm-tools validate app.wasm

# Smoke-run on the target runtime(s) you deploy to
- run: wasmtime run --dir=./testdata::/data app.wasm
```

- **Test under `wasip1` in CI**, not just natively. The native build can pass while the `wasip1` build pulls in `net` and fails to instantiate. The exec wrapper catches this.
- **Validate and inspect the module.** `wasm-tools validate` confirms it is well-formed; dumping imports confirms no unexpected host obligations (e.g. a stray `sock_*` import) slipped in.
- **Pin runtime versions** in the smoke-run; behaviour differs across versions and runtimes.
- **Test on every runtime you ship to**, not just one. "Runs on Wasmtime" does not imply "runs on WasmEdge."

---

## Edge Cases the Source Reveals

A close reading of the `wasip1` runtime port and the WASI ABI exposes corners most users never hit:

- **`os.Args[0]` is runtime-dependent.** Some runtimes pass the module filename, others a path; do not parse meaning from it.
- **Empty `environ`/`args` are normal.** With nothing granted, `args_sizes_get` returns the module name only and `environ_get` returns nothing; code must not assume a populated environment.
- **`poll_oneoff` precision varies.** `time.Sleep` resolution depends on the runtime's `poll_oneoff` implementation; do not rely on sub-millisecond timing portability.
- **`crypto/rand` requires `random_get`.** A runtime that stubs `random_get` to a constant breaks cryptographic randomness silently — verify on the runtimes you deploy to.
- **Preopen ordering matters.** The guest path resolution walks preopens; overlapping or shadowing mappings can resolve to a surprising directory. Keep mappings disjoint.
- **`proc_exit` with a nonzero code** is how `os.Exit(1)` surfaces; the host receives it as the module's exit status, not as a trap. Distinguish "the program exited nonzero" from "the module trapped."
- **Unsupported syscalls return `ENOSYS`-style errors**, not panics; code that ignores errors may proceed on a failed operation. Check errors.
- **`go:wasmimport`/`go:wasmexport` signatures are checked at compile time for type validity** but never checked against the *host's actual implementation* — a mismatch is a runtime failure or corruption. The ABI is your responsibility.

These are not facts to memorise but pointers to *reach for the spec and the runtime source* when something unexpected happens.

---

## Operational Playbook

| Scenario | Recipe |
|----------|--------|
| Build a `wasip1` module | `GOOS=wasip1 GOARCH=wasm go build -o app.wasm ./cmd/app` |
| Run it standalone | `wasmtime run --dir=./data::/data app.wasm` |
| Run/test via go | `PATH+=:$(go env GOROOT)/lib/wasm; GOWASIRUNTIME=wazero; go run .` |
| Inspect imports (host obligations) | `wasm-tools print app.wasm \| grep '(import'` |
| Diagnose `unknown import` | Dump imports; find the unexpected `sock_*`/`env::*`; guard or provide it |
| Shrink the binary | `-ldflags="-s -w" -trimpath`; consider TinyGo |
| Embed in a Go host | wazero: `CompileModule` once, `InstantiateModule` per call, `Memory().Read/Write` for the boundary |
| Call host funcs from guest | `go:wasmimport <mod> <name>`; pass pointer+length; keep memory live |
| Expose guest funcs to host (1.24+) | `go:wasmexport <name>`; reactor model; host calls `_initialize` first |
| Bound untrusted execution | wazero: `context.WithTimeout` + memory limit; Wasmtime: fuel + memory limit |
| Verify reproducibility | Pin toolchain + `-trimpath`; build twice; `cmp app.wasm app2.wasm` |
| AOT-cache for cold start | `wasmtime compile app.wasm -o app.cwasm`; ship the compiled artifact |

---

## Summary

`GOOS=wasip1 GOARCH=wasm` is a deceptively simple command: compile Go to a sandboxed module that runs outside the browser. The professional understanding is the contract that compilation creates with the host — the `wasi_snapshot_preview1` import set as the complete list of host obligations, the `_start` vs `_initialize` lifecycle that distinguishes a command from a reactor, and the memory boundary where the type system stops protecting you.

Host interop is the heart of the professional material. `go:wasmimport` (Go 1.21) lets the guest call host functions; `go:wasmexport` (Go 1.24) makes the guest a callable library. Both restrict boundary types to wasm-native scalars and pointers, both force rich data through a pointer+length convention, and both leave memory ownership and GC interaction entirely to you — pin what the host retains, keep slices live across calls, and treat every cross-boundary pointer as valid only for the call's duration unless proven otherwise.

The reference embedding is a Go host driving a Go guest with wazero: compile once, instantiate per request, read/write guest memory through the bounds-checked API, and bound execution with context and memory limits. Mastering the import surface, the lifecycle, and the memory boundary turns `wasip1` from a black box into a precise tool — and that precision is what makes a sandboxed plugin system safe rather than merely functional.
