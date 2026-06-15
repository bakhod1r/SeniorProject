# WASI & `GOOS=wasip1` — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [The `wasip1`-or-Not Decision: First Principles](#the-wasip1-or-not-decision-first-principles)
3. [`wasip1` as a Sandbox Boundary](#wasip1-as-a-sandbox-boundary)
4. [Designing a Plugin System on `wasip1` + wazero](#designing-a-plugin-system-on-wasip1-wazero)
5. [Capability Scoping as an Architectural Concern](#capability-scoping-as-an-architectural-concern)
6. [Determinism, Resource Limits, and Untrusted Code](#determinism-resource-limits-and-untrusted-code)
7. [The Host Interop ABI as a Versioned Contract](#the-host-interop-abi-as-a-versioned-contract)
8. [Serverless and Edge: Cold Start and Density](#serverless-and-edge-cold-start-and-density)
9. [The Preview-1 to Preview-2 Migration Path](#the-preview-1-to-preview-2-migration-path)
10. [`wasip1` vs Containers vs Native Plugins](#wasip1-vs-containers-vs-native-plugins)
11. [Observability and Debugging Across the Sandbox](#observability-and-debugging-across-the-sandbox)
12. [Anti-Patterns](#anti-patterns)
13. [Senior-Level Checklist](#senior-level-checklist)
14. [Summary](#summary)

---

## Introduction

A senior engineer's relationship with `wasip1` is not "can I compile to it" but "what does it buy the architecture, what does it cost, and where does its sandbox boundary actually sit relative to the threats I care about." The mechanical content — the build command, capabilities, `go:wasmimport`, the exec wrapper — lives in [junior.md](junior.md) and [middle.md](middle.md). This file is about design and trade-offs.

`wasip1` is, at root, a *portable, deny-by-default, fast-starting compute unit*. The senior decisions are: when that unit is the right shape for a system; how to scope its capabilities so the sandbox is real and not theatre; how to design a host/guest ABI that survives version churn; and how to reason about its place against containers, native plugins, and the looming preview-2 transition.

After reading this you will:
- Decide whether `wasip1` fits a system based on threat model, workload shape, and operational reality
- Design a Go-host-embeds-Go-guest plugin system with wazero, with a versioned interop contract
- Scope capabilities so untrusted code is actually contained
- Reason about determinism, fuel/limits, and resource exhaustion for untrusted modules
- Plan the preview-1 → preview-2 migration instead of being surprised by it

---

## The `wasip1`-or-Not Decision: First Principles

`wasip1` is a tool, not a destination. The decision is downstream of two real questions: *what is the workload's shape?* and *what is the trust boundary I need?*

### What `wasip1` actually buys you

Three things, none of which a native binary or a container provides at the same point on the cost curve:

1. **A capability sandbox with no ambient authority.** The unit starts with zero file, env, and (effectively) network access. You grant precisely what it needs. This is a stronger default than a container, which inherits a whole filesystem image and a network namespace.
2. **Fast, dense instantiation.** A compiled module instantiates in microseconds-to-milliseconds and shares no kernel-level isolation machinery. You can run thousands of short-lived instances where containers would be too heavy.
3. **True portability of the artifact.** One `.wasm` runs on every conforming runtime and every CPU architecture, unchanged. No `GOARCH` matrix, no per-arch image.

### What `wasip1` costs you

- **No general networking, no threads, no subprocesses.** Whole classes of program do not port.
- **Large binaries.** A Go `wasip1` binary embeds the runtime and is MB-scale; density and cold-start are bounded by this. TinyGo trades stdlib coverage for size.
- **Boundary friction.** Every host call crosses a memory boundary with manual pointer/length marshalling. Rich data interchange is awkward on preview 1.
- **A moving standard.** You target preview 1 while the ecosystem builds preview 2. Bets made today carry migration cost.

### When the answer is yes

- You run *untrusted or semi-trusted* code (user scripts, third-party plugins, customer logic) and want a strong, auditable containment boundary.
- Your workload is *function-shaped*: read input, transform, write output, exit.
- You need *high-density, fast-starting* execution units (edge, serverless, per-request isolation).
- You want *one portable artifact* across architectures and host languages.

### When the answer is no

- The workload is a network server, needs many cores, or shells out to other processes.
- Binary size and per-instance memory are hard-constrained and TinyGo's stdlib gaps are unacceptable.
- You need rich, high-throughput data exchange with the host — the preview-1 boundary will dominate.
- A container already gives you the isolation you need and you do not value the density or portability.

---

## `wasip1` as a Sandbox Boundary

The sandbox is the whole point, so be precise about what it does and does not protect.

### What the boundary guarantees

- **Memory isolation.** The guest cannot read or write host memory; it has its own linear memory. A buffer overrun in the guest cannot corrupt the host. This is enforced by the wasm execution model itself, not by policy.
- **Capability containment.** The guest can only touch the filesystem, env, and host functions you granted. There is no `open("/etc/passwd")` that succeeds by default; there is no descriptor to resolve it against.
- **Control-flow integrity.** The guest cannot jump into arbitrary host code; it can only call the imports you wired.

### What the boundary does NOT guarantee

- **Resource fairness.** A guest can spin the CPU, allocate until it exhausts its linear-memory budget, or write garbage to a granted directory. Memory isolation is not resource isolation. You need fuel/limits (see below).
- **Correctness of granted I/O.** If you preopen a sensitive directory, the guest reads your secrets. The sandbox limits *reach*, not *intent*; capability scoping is a design responsibility, not a default.
- **Side-channel resistance.** wasm sandboxing is not a defence against timing or cache side channels in the general case.
- **Safety of host imports.** Every `go:wasmimport` you expose is an attack surface. A host function that, say, takes a guest-supplied path and opens it on the host *re-introduces ambient authority through the back door*. The boundary is only as tight as your weakest host import.

The senior framing: **wasm gives you memory isolation for free and capability containment by construction, but resource limits and the safety of your host ABI are entirely on you.** A sandbox with a careless host import is not a sandbox.

---

## Designing a Plugin System on `wasip1` + wazero

The canonical senior use case: a Go host that loads and runs Go-compiled (or any-language) `.wasm` plugins safely. wazero — a pure-Go, dependency-free, CGo-free runtime — is the natural choice because it embeds cleanly in a Go program.

### The shape

```go
import "github.com/tetratelabs/wazero"
import "github.com/tetratelabs/wazero/imports/wasi_snapshot_preview1"

func runPlugin(ctx context.Context, wasmBytes []byte, input []byte) ([]byte, error) {
	r := wazero.NewRuntime(ctx)
	defer r.Close(ctx)

	// Provide WASI preview-1 host functions (fd_write, clock_time_get, ...).
	wasi_snapshot_preview1.MustInstantiate(ctx, r)

	// Compile once; reuse the compiled module across many instantiations.
	compiled, err := r.CompileModule(ctx, wasmBytes)
	if err != nil {
		return nil, err
	}

	// Configure capabilities explicitly and minimally.
	cfg := wazero.NewModuleConfig().
		WithStdin(bytes.NewReader(input)).
		WithStdout(&out).
		WithArgs("plugin").
		// No filesystem, no env: this plugin gets nothing it does not need.
		WithSysWalltime() // grant a clock only because this plugin needs time

	mod, err := r.InstantiateModule(ctx, compiled, cfg)
	if err != nil {
		return nil, err
	}
	defer mod.Close(ctx)
	return out.Bytes(), nil
}
```

### The design decisions that matter

- **Compile once, instantiate many.** `CompileModule` is the expensive step (it AOT/JIT-compiles the bytes). Cache the `CompiledModule` and instantiate per request. This is the difference between a plugin system that scales and one that recompiles on every call.
- **Capabilities are per-instance, set by the host.** The host decides whether *this* plugin invocation gets a clock, a scratch directory, specific env. Two invocations of the same plugin can have different capability sets. This is the architectural lever: capability scoping lives in the host, not the plugin.
- **Define your interop ABI deliberately.** stdio is the simplest contract (stdin in, stdout out). For richer interaction, expose host functions via wazero's `HostModuleBuilder` and call them from the guest with `go:wasmimport`. Keep the ABI small and versioned (see [The Host Interop ABI](#the-host-interop-abi-as-a-versioned-contract)).
- **Bound execution.** Set a `context.WithTimeout` and close the module when it fires; configure memory limits. An untrusted plugin must not be able to hang or OOM the host.

### Why this beats native Go plugins

Go's `plugin` package loads native shared objects: no sandbox, same-toolchain-version coupling, platform restrictions, and a plugin crash can take down the host. A `wasip1` + wazero plugin is sandboxed, portable, version-decoupled at the ABI level, and isolated — a plugin panic stays in the guest.

---

## Capability Scoping as an Architectural Concern

In a native process, "what can this code touch" is implicit and broad. In `wasip1`, it is explicit and narrow — but only if you design it that way. Capability scoping is where the sandbox becomes real or theatre.

### Principles

- **One scratch directory, not the real tree.** If a plugin needs to write output, give it a per-invocation temp dir mounted at a fixed guest path. Never preopen a directory that contains anything you would not hand the plugin author directly.
- **Env is data, not configuration leakage.** Pass only the env vars the guest's contract specifies. A blanket "forward my environment" flag (some runtimes offer it) defeats the model — it leaks `AWS_SECRET_ACCESS_KEY` and friends into untrusted code.
- **Host imports are the privileged surface.** Each `go:wasmexport`-consumed host function the host provides is a capability. Treat the set of host functions as your privilege model. A host function that performs I/O on the guest's behalf must validate and scope its arguments exactly as if they came from an untrusted network client — because they do.
- **Deny by default, grant per intent.** Build the host so a new plugin gets *nothing*, and each capability is added by an explicit, reviewable decision. The audit question "what can plugin X do?" should be answerable by reading the host's instantiation config for X.

### The back-door problem

The most common scoping failure is a well-meaning host function:

```go
// DANGEROUS host import: takes a guest-supplied path, opens it on the HOST.
func hostReadFile(guestPathPtr, guestPathLen uint32) []byte { /* os.ReadFile(path) */ }
```

This re-introduces full ambient authority. The guest passes `/etc/passwd` and the host reads it. The wasm sandbox is intact — memory is isolated — but the *capability* boundary is gone because the host volunteered to be a confused deputy. Every host function that touches host resources on guest-supplied parameters must scope and validate those parameters against an allowlist the host controls.

---

## Determinism, Resource Limits, and Untrusted Code

Running untrusted code is the headline `wasip1` use case, and it demands more than the sandbox.

### Resource limits

The wasm sandbox does not stop a guest from burning CPU or memory. You must bound both:

- **CPU / instruction budget.** Wasmtime offers *fuel*: each instruction consumes fuel, the guest traps when it runs out. wazero offers context-based interruption (close the module from a timeout goroutine). Use one; a guest with an infinite loop must be stoppable.
- **Memory.** Cap the guest's linear-memory growth (max pages). A guest that allocates unboundedly should trap, not OOM the host.
- **Wall-clock.** Wrap every invocation in `context.WithTimeout`. Untrusted code gets a deadline, full stop.
- **Output size.** A guest writing to a host buffer must not be able to exhaust host memory; bound the stdout/host-call output you accept.

### Determinism

`wasip1` is *closer* to deterministic than native code but is not deterministic by default:

- **Clocks and randomness are non-deterministic** by design (`clock_time_get`, `random_get` read host state). For reproducible execution (e.g. consensus, replay, audit), the host can supply a *fixed clock* and a *seeded PRNG* through its WASI implementation — wazero lets you inject both. This is how blockchain and deterministic-replay systems use wasm.
- **Goroutine scheduling** is single-threaded and cooperative, which removes one large source of non-determinism (no data races across cores), but I/O ordering still depends on the host.
- **Floating-point** is deterministic in wasm by specification (IEEE-754, no extended precision), which is a real advantage over some native targets for reproducibility.

The senior point: `wasip1` *enables* determinism if you control the host's clock/random/IO, but you must opt into it. The default is non-deterministic.

---

## The Host Interop ABI as a Versioned Contract

When a host and guest exchange more than stdio, the set of host functions (`go:wasmimport`) plus exported guest functions (`go:wasmexport`, Go 1.24) is an *ABI*. Treat it like any other inter-process contract: versioned, documented, evolved compatibly.

### Why it is fragile

- The boundary types are primitive (`int32`, `int64`, floats, pointers). Everything richer is a pointer+length convention you invent. Change the convention and old guests break.
- The guest and host are compiled separately, often by different teams or at different times. There is no compile-time check that they agree. A signature mismatch is a runtime instantiation failure or, worse, silent memory corruption.
- A `go:wasmimport`/`go:wasmexport` signature change is a breaking ABI change even if the Go function signature "looks compatible."

### Design discipline

- **Version the ABI explicitly.** Expose a host import or guest export like `abi_version() -> int32` and check it at instantiation. Refuse mismatched majors.
- **Pass length-prefixed byte buffers, not ad-hoc layouts.** Serialise structured data (JSON, protobuf, a fixed binary layout) into a guest buffer, pass pointer+length, deserialise on the other side. This decouples the ABI from Go struct layout.
- **Keep the function set small.** Every host function is forever (or until a major bump). A narrow ABI — a handful of `host_call(opcode, in_ptr, in_len) -> (out_ptr, out_len)` style functions — ages better than dozens of specific ones.
- **Document ownership and lifetime** of every pointer crossing the boundary: who allocates, who frees, how long it is valid. Memory bugs here are not caught by the type system.

`go:wasmexport` (Go 1.24) makes the guest a callable library: the host instantiates the module and calls exported functions directly, rather than relying solely on `main` + stdio. This enables a request/response plugin model, but it raises the ABI-versioning stakes — covered in [professional.md](professional.md).

---

## Serverless and Edge: Cold Start and Density

The economic argument for `wasip1` at the edge is cold start and density.

- **Cold start.** A container cold-starts in hundreds of milliseconds to seconds (image pull, namespace setup, runtime init). A wasm module instantiates in microseconds-to-low-milliseconds from already-compiled bytes. For per-request isolation at the edge, this is the difference between viable and not.
- **Density.** Thousands of wasm instances coexist in one process with shared compiled modules; thousands of containers do not fit on one node. Per-tenant isolation becomes cheap.
- **Portability.** One artifact runs on every edge node regardless of CPU architecture — relevant when edge fleets are heterogeneous (x86 + ARM).

The caveats a senior must price in:

- **Go binary size** bounds density and the bytes shipped to each edge node. Compilation caching (ship pre-compiled artifacts where the runtime supports it) and TinyGo are the levers.
- **No networking** means the *host platform* must route requests in and responses out (often via host-provided fds or a preview-2-style HTTP interface). Your `wasip1` function is pure compute; the platform owns I/O.
- **Compilation cost** is paid once per module per node; AOT-compile and cache (`wasmtime compile`, wazero's compilation cache) so cold start is instantiation-only, not compilation.

---

## The Preview-1 to Preview-2 Migration Path

`wasip1` is today's target; preview 2 is the direction. A senior plans for the transition rather than being surprised by it.

### What changes in preview 2

- The flat `wasi_snapshot_preview1` import list is replaced by the **Component Model**: typed interfaces described in WIT, composable components, and real interfaces for sockets (`wasi:sockets`), HTTP (`wasi:http`), and more.
- Host interop stops being pointer+length marshalling and becomes typed interface calls — richer, safer, but a different ABI.
- Networking becomes a first-class, portable capability instead of a runtime-specific extension.

### What this means for code you write today

- **`go:wasmimport`/`go:wasmexport` ABIs are preview-1-shaped.** They will need adaptation for the component world. Keep them small and well-isolated so the migration touches a thin layer.
- **Adapter tooling exists now.** The `wasi-preview1-adapter` and component-adapter tooling can wrap a `wasip1` core module into a preview-2 component, letting preview-1 binaries run in preview-2 hosts. This is the bridge: build `wasip1` today, adapt to components when the host ecosystem demands it.
- **Go's roadmap is toward preview 2 / components**, but the standard toolchain emits preview 1 today. Do not assume a `go build` will suddenly produce components; track the release notes.

### Migration strategy

Isolate everything WASI- and ABI-specific behind a thin interface in your codebase. Keep business logic platform-agnostic. When preview 2 lands in the toolchain (or via adapter), only the thin layer changes. The teams that suffer in the migration are those that scattered `go:wasmimport` calls and pointer arithmetic throughout the codebase.

---

## `wasip1` vs Containers vs Native Plugins

A senior should be able to place `wasip1` against its alternatives crisply.

| Dimension | `wasip1` (wasm) | Container | Native Go `plugin` |
|-----------|-----------------|-----------|--------------------|
| Isolation boundary | Memory + capability, in-process | Kernel namespaces + cgroups | None (same address space) |
| Cold start | µs–ms | 100ms–seconds | ms (dlopen) |
| Density per node | Thousands | Tens–hundreds | N/A |
| Networking | None (preview 1) | Full | Full (host process) |
| Multi-core | No | Yes | Yes |
| Subprocesses | No | Yes | Yes |
| Portability of artifact | Every arch/runtime | Per-arch image | Same toolchain + OS only |
| Crash containment | Guest trap, host survives | Process isolation | Crash takes down host |
| Untrusted code | Strong default sandbox | Moderate (escape surface) | Unsafe |

The decision: `wasip1` wins for *sandboxed, dense, portable, function-shaped* workloads — especially untrusted code. Containers win when you need full OS facilities (networking, processes, cores) with moderate isolation. Native plugins win only when you fully trust the plugin and need raw performance with no boundary cost — and accept the coupling and crash risk.

---

## Observability and Debugging Across the Sandbox

The sandbox that protects you also obscures you. Plan observability into the host.

- **Logs cross the boundary as data.** The guest cannot write to your logging backend; it writes to stdout/stderr or a host log function. The host is responsible for capturing, attributing (which plugin/tenant), and forwarding guest output. Design a host log import with a level and a tenant tag.
- **Metrics are host-side.** Instrument the host around instantiation and invocation: compile time, instantiation time, execution time, fuel consumed, memory high-water mark, trap reasons. The guest cannot emit to your metrics system directly.
- **Traps are your error signal.** A guest that runs out of fuel, exceeds memory, or hits an unknown import *traps*. The host receives a typed error. Map trap reasons to actionable diagnostics ("plugin X exceeded its fuel budget" not "module trapped").
- **Debugging the guest** is harder than native: DWARF support in wasm is improving but uneven across runtimes. The practical workflow is to build and test the same Go code natively (where the debugger works) and reserve `wasip1` runs for integration testing the boundary. The exec wrapper running `go test` under `wasip1` in CI catches what native testing cannot.

---

## Anti-Patterns

- **Treating the memory sandbox as a full sandbox.** Memory isolation is free; resource limits and host-ABI safety are not. A module without fuel/timeout limits is a DoS waiting to happen.
- **A confused-deputy host import.** A host function that performs host I/O on guest-supplied, unvalidated parameters re-opens ambient authority. Validate and scope every such argument.
- **Forwarding the whole host environment to the guest.** Leaks secrets into untrusted code. Pass only contractually-required env.
- **Preopening a broad directory "to be safe."** `--dir=/` or the project root hands the guest everything. Grant a per-invocation scratch dir.
- **Scattering `go:wasmimport`/pointer arithmetic throughout the codebase.** Makes the preview-2 migration a rewrite. Isolate the ABI behind a thin layer.
- **Recompiling the module on every invocation.** `CompileModule` is the expensive step. Compile once, instantiate many.
- **Designing a `wasip1` service that needs networking.** Preview 1 has none; betting on a runtime extension makes you non-portable and stuck.
- **Assuming determinism without controlling the host clock/random.** Default `wasip1` is non-deterministic; inject fixed clock/seed if you need replay.
- **An unversioned host/guest ABI.** Separately compiled guest and host with no version check silently corrupt or fail. Version the ABI and check it at instantiation.
- **Ignoring binary size for edge/density.** A multi-MB module bounds your density and cold-start budget; measure it and consider TinyGo.

---

## Senior-Level Checklist

- [ ] Decide `wasip1`-or-not from workload shape and threat model, not novelty
- [ ] Treat memory isolation as given; add fuel/timeout/memory limits explicitly
- [ ] Scope capabilities per invocation in the host; deny by default
- [ ] Audit every host import as a privilege; validate guest-supplied arguments
- [ ] Never forward the full environment; pass only contractual env
- [ ] Compile modules once, instantiate per request (wazero `CompiledModule`)
- [ ] Version the host/guest ABI and check it at instantiation
- [ ] Isolate all WASI/ABI specifics behind a thin layer for the preview-2 migration
- [ ] Inject fixed clock/seed when determinism or replay is required
- [ ] Capture guest logs/metrics/traps host-side with tenant attribution
- [ ] Measure binary size and cold start for edge/density use
- [ ] Test the `wasip1` path in CI via the exec wrapper

---

## Summary

`wasip1` is a portable, deny-by-default, fast-starting compute unit, and the senior job is to decide when that unit is the right architectural shape and how to make its sandbox real. The boundary gives you memory isolation for free and capability containment by construction — a stronger default than a container — but it gives you neither resource fairness nor safety of your host ABI. Those are design responsibilities: fuel and timeouts to contain untrusted CPU/memory, careful argument scoping on every host import to avoid the confused-deputy back door, and per-invocation capability grants so "what can this plugin do" is answerable from the host config.

The flagship use case — a Go host embedding Go-compiled plugins via wazero — rewards a small, versioned host/guest ABI, compile-once-instantiate-many, and capability scoping that lives in the host. Against the alternatives, `wasip1` wins for sandboxed, dense, portable, function-shaped workloads, especially untrusted code; it loses where you need networking, cores, or subprocesses, which is where containers belong.

Finally, you target preview 1 today while the ecosystem builds preview 2. The teams that will migrate cheaply are those that isolated their WASI and ABI specifics behind a thin layer and kept business logic platform-agnostic. The command is one line; the architecture around the sandbox boundary is the senior work.
