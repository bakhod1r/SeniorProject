# Wasm in Production — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [The Two Runtime Contracts: `js/wasm` and `wasip1`](#the-two-runtime-contracts-jswasm-and-wasip1)
3. [wazero's Execution Model: Compiler vs Interpreter](#wazeros-execution-model-compiler-vs-interpreter)
4. [Compile-Once Lifecycle and Its Memory Accounting](#compile-once-lifecycle-and-its-memory-accounting)
5. [The Host ABI: `go:wasmexport`, `go:wasmimport`, and Memory](#the-host-abi-gowasmexport-gowasmimport-and-memory)
6. [Enforcing Limits: Memory Pages, Context Cancellation, Instruction Budget](#enforcing-limits-memory-pages-context-cancellation-instruction-budget)
7. [WASI Capability Surface: Preopens, Clock, Randomness, Env](#wasi-capability-surface-preopens-clock-randomness-env)
8. [Streaming Compilation Internals (Browser)](#streaming-compilation-internals-browser)
9. [Compression and Caching as a Toolchain Concern](#compression-and-caching-as-a-toolchain-concern)
10. [A Hermetic Build Pipeline for Both Targets](#a-hermetic-build-pipeline-for-both-targets)
11. [Operational Playbook](#operational-playbook)
12. [Edge Cases the Runtime Reveals](#edge-cases-the-runtime-reveals)
13. [Professional-Level Checklist](#professional-level-checklist)
14. [Summary](#summary)

---

## Introduction

The professional level treats "Wasm in production" as the surface of several contracts: the toolchain's ABI between Go and the runtime, the runtime's contract for memory and cancellation, the browser's contract for streaming compilation, and the build pipeline that must produce a reproducible, version-matched pair of artefacts for each target. Misunderstanding any one of these produces the opaque failures that dominate Wasm incident channels: a blank page, an intermittent corrupt decode, a host that OOMs under a hostile guest, a per-request latency cliff.

This file is for engineers who own Wasm infrastructure: the build pipeline, the wazero host, the CDN/serving layer, or a multi-tenant plugin platform. After reading you will know what each contract guarantees, where it does not, and how to operate it.

---

## The Two Runtime Contracts: `js/wasm` and `wasip1`

Standard Go emits two distinct Wasm flavours with different host contracts. Conflating them is the root of many "it ran in dev" failures.

| | `GOOS=js GOARCH=wasm` | `GOOS=wasip1 GOARCH=wasm` |
|---|---|---|
| Host | A JavaScript engine (browser, Node) | A WASI runtime (wazero, Wasmtime, edge) |
| Glue | `wasm_exec.js` (version-matched shim) | none — WASI is the ABI |
| Entry | `go.run(instance)` after instantiate | `_start` (WASI command) |
| IO | through JS (`fetch`, DOM, console) | through `wasi_snapshot_preview1` syscalls |
| Sockets | via JS only | **none** in `wasip1` |
| Use | browser delivery | server / edge embedding |

The `js/wasm` contract is a *bidirectional bridge*: `wasm_exec.js` implements the runtime's imports (timers, the event loop, `syscall/js` calls), and the Go runtime drives the JS event loop cooperatively on one thread. The `wasip1` contract is a *syscall surface*: the module imports a fixed set of WASI functions the runtime provides. They are not interchangeable — a `js/wasm` binary cannot run in wazero, and a `wasip1` binary cannot run in a browser without a WASI polyfill. (Details: [01-goos-js-wasm-browser](../01-goos-js-wasm-browser/professional.md), [02-wasi-and-wasip1](../02-wasi-and-wasip1/professional.md).)

Since Go 1.24, `//go:wasmexport` lets a `wasip1` *library* module export functions a host calls directly (the "reactor" pattern), in addition to the classic `_start` command model. This is the basis of the in-process plugin architecture.

---

## wazero's Execution Model: Compiler vs Interpreter

[wazero](https://wazero.io) is a pure-Go runtime — zero CGo, zero external dependencies — which is exactly why it embeds cleanly into a Go host and ships as a single static binary. It offers two engines:

- **The optimizing compiler** (default on supported arch: amd64, arm64): translates Wasm to native machine code at `CompileModule`. Higher first-compile cost, fast steady-state execution. Use it for hot, long-lived, repeatedly-invoked guests.
- **The interpreter** (`NewRuntimeConfigInterpreter`): no native codegen, portable everywhere, lower startup cost, slower execution. Use it for short-lived, rarely-called guests, or unsupported architectures.

```go
cfg := wazero.NewRuntimeConfigCompiler()      // or NewRuntimeConfigInterpreter()
rt := wazero.NewRuntimeWithConfig(ctx, cfg)
```

The choice is a throughput-vs-startup tradeoff; measure with your guest and call pattern. The compiler's win materializes only when execution dominates compile-amortized-over-N-calls.

---

## Compile-Once Lifecycle and Its Memory Accounting

The runtime exposes three lifecycle objects with very different costs:

1. **`Runtime`** — owns the engine and host modules. One per process (or per isolation domain). Closing it frees everything.
2. **`CompiledModule`** — the result of `CompileModule(bytes)`. Expensive to produce, immutable, **safe to share and reuse** across instances and goroutines. This is the artefact you cache and version by digest.
3. **`Module` (instance)** — the result of `InstantiateModule(compiled)`. Cheap, holds the guest's mutable linear memory, **not** safe to share. One per invocation for isolation.

```go
rt := wazero.NewRuntime(ctx)               // process-lifetime
defer rt.Close(ctx)

compiled, _ := rt.CompileModule(ctx, guestBytes)   // once
defer compiled.Close(ctx)

// per call:
mod, _ := rt.InstantiateModule(ctx, compiled, cfg) // cheap
defer mod.Close(ctx)                                // frees this call's memory
```

Memory accounting that matters in production: each live instance holds its linear memory (up to its page cap) plus runtime bookkeeping. Worst-case host memory ≈ `concurrent_instances × max_pages_per_instance × 64 KiB` + compiled-module footprint. Size your instance-concurrency limit from that product and the host's headroom — this is a capacity calculation, not a guess.

---

## The Host ABI: `go:wasmexport`, `go:wasmimport`, and Memory

The host and guest communicate over a numbers-and-memory ABI. There is no shared object graph; everything structured crosses as bytes in the guest's linear memory.

**Guest exports (Go 1.24+):**

```go
//go:wasmexport process
func process(ptr, length uint32) uint64 {   // returns packed (ptr<<32 | len)
	input := readGuestMem(ptr, length)
	out := transform(input)
	return writeGuestMem(out)                 // allocate in guest, return location
}
```

**Host reads/writes guest memory** through `api.Module.Memory()`:

```go
fn := mod.ExportedFunction("process")
inPtr := writeIntoGuest(ctx, mod, input)        // copy input into guest memory
res, _ := fn.Call(ctx, uint64(inPtr), uint64(len(input)))
outPtr, outLen := unpack(res[0])
out, _ := mod.Memory().Read(uint32(outPtr), uint32(outLen))
```

**Host functions the guest imports** (the capability door):

```go
rt.NewHostModuleBuilder("env").
	NewFunctionBuilder().
	WithFunc(func(ctx context.Context, m api.Module, ptr, n uint32) {
		msg, _ := m.Memory().Read(ptr, n)
		logger.Info("guest", "msg", string(msg))
	}).
	Export("log").
	Instantiate(ctx)
```

ABI design rules: keep the boundary signature small (pass `(ptr, len)` pairs, return packed locations), agree on an allocator convention (who allocates the result buffer — usually the guest exports a `malloc`/`alloc` the host calls), and never let a guest-supplied pointer/length go un-bounds-checked — `Memory().Read` returns `ok=false` on out-of-range, which you must honor. The cost of this boundary, and zero-copy techniques, are the subject of [04-wasm-interop-and-performance](../04-wasm-interop-and-performance/professional.md).

---

## Enforcing Limits: Memory Pages, Context Cancellation, Instruction Budget

Three independent enforcement mechanisms; an untrusted guest needs all three.

**Memory pages** — hard ceiling on linear memory growth:

```go
cfg := wazero.NewRuntimeConfig().WithMemoryLimitPages(256) // 16 MiB
```

A guest `memory.grow` beyond the cap fails *inside the guest* (it observes an allocation error); the host is unaffected.

**Context cancellation** — wall-clock timeout that can interrupt compute:

```go
rt := wazero.NewRuntimeWithConfig(ctx,
	wazero.NewRuntimeConfig().WithCloseOnContextDone(true))
callCtx, cancel := context.WithTimeout(ctx, 50*time.Millisecond)
defer cancel()
_, err := fn.Call(callCtx, args...)   // ErrDeadlineExceeded-style failure on timeout
```

`WithCloseOnContextDone(true)` instruments compiled/interpreted code to poll for cancellation, so a pure CPU loop is interruptible. Without it, the deadline only takes effect at host-function boundaries — useless against `for {}`.

**Instruction budget ("fuel")** — deterministic, load-independent fairness, finer than wall-clock. wazero does not expose a single `WithFuel(n)` knob; the practical approaches are (a) periodic cancellation via `WithCloseOnContextDone` plus a watchdog, or (b) experimental/community metering listeners that count executed operations and cancel the context when a budget is exhausted. Deterministic metering matters for multi-tenant fairness (wall-clock varies with host load) and for reproducibility. Implement it as a budget that, when exhausted, cancels the call's context — reusing the same interruption path as the timeout.

---

## WASI Capability Surface: Preopens, Clock, Randomness, Env

For `wasip1` guests, wazero's `WithFS`/`ModuleConfig` controls the WASI capabilities. Deny-by-default means an empty config grants nothing:

```go
cfg := wazero.NewModuleConfig().
	WithName("").                                // anon, allows many instances
	WithFS(scopedReadOnlyFS).                    // preopen: only this subtree, RO
	WithSysWalltime().WithSysNanotime().         // grant a clock, or omit to deny
	WithRandSource(controlledRand).              // deterministic/seeded if needed
	WithEnv("TENANT", tenantID)                  // exactly the env you choose
```

Each grant is a deliberate capability: a *preopened* directory is the only filesystem the guest can see (it cannot escape it — there is no ambient root); omitting the clock denials make the guest non-deterministic-dependent; `WithRandSource` lets you make execution reproducible for testing or fair. The professional discipline mirrors POSIX least-privilege: grant the narrowest preopen, the fewest syscalls, nothing "to make it work." (Full WASI capability semantics: [02-wasi-and-wasip1](../02-wasi-and-wasip1/professional.md).)

Crucially, `wasip1` has **no socket syscalls** — there is no capability you can grant to give a guest raw networking. Network access for a guest is always via a *host function* you write, which is exactly where you enforce policy.

---

## Streaming Compilation Internals (Browser)

`WebAssembly.instantiateStreaming(fetch(url), importObject)` overlaps three phases that otherwise run serially: network download, module compilation, and instantiation. The engine begins compiling functions as soon as enough bytes have arrived, so compile time hides behind download time. The hard requirement is `Content-Type: application/wasm` — the engine refuses to stream-compile any other MIME type and rejects the promise.

Implications you must engineer for:

- A misconfigured MIME type does not merely slow things — `instantiateStreaming` *rejects*. You either fix the header or fall back to buffered `instantiate(arrayBuffer)`, which ignores MIME but loses the overlap.
- `Content-Encoding: gzip`/`br` is transparent to streaming: the browser decompresses as it streams, and the engine still sees `application/wasm`. Pre-compressed delivery and streaming compilation compose cleanly.
- For very large modules, the engine may tier-compile (a fast baseline first, optimized later). This is engine-internal; you cannot control it from Go, but it is why startup feels fast even on multi-MB modules.

---

## Compression and Caching as a Toolchain Concern

Treat compression and cache-addressing as build-pipeline outputs, not server runtime behaviour:

- **Pre-compress at build** (`brotli -q 11`, `gzip -9`) so serving is a static file send, not a per-request CPU cost. Brotli beats gzip ~10–15% on Wasm; ship both, negotiate via `Accept-Encoding` with `Vary: Accept-Encoding`.
- **Strip the binary** (`-ldflags="-s -w"`, `-trimpath`) to shave size and remove local-path leakage before compression.
- **Content-address** the output (`app.<sha>.wasm`) so it can be served `Cache-Control: public, max-age=31536000, immutable` without ever serving stale code; the unhashed entry HTML stays `no-cache`.
- **Hash the shim too** (`wasm_exec.<sha>.js`) so a Go upgrade never strands a stale glue file against a fresh binary.

The serving layer then has one job: send the right pre-built variant with the right three headers (`Content-Type`, `Content-Encoding`, `Cache-Control`/`Vary`).

---

## A Hermetic Build Pipeline for Both Targets

A reproducible pipeline pins the toolchain and produces version-matched artefacts:

```bash
#!/usr/bin/env bash
set -euo pipefail
GO=go            # pinned via go.mod 'toolchain go1.24.x' + 'go version'

# --- Browser target ---
SHIM="$($GO env GOROOT)/lib/wasm/wasm_exec.js"
[ -f "$SHIM" ] || SHIM="$($GO env GOROOT)/misc/wasm/wasm_exec.js"
GOOS=js GOARCH=wasm $GO build -trimpath -ldflags="-s -w" -o out/app.wasm ./cmd/web
H=$(shasum -a 256 out/app.wasm | cut -c1-8)
install -m644 out/app.wasm "public/app.${H}.wasm"
install -m644 "$SHIM"      "public/wasm_exec.${H}.js"
brotli -q11 -k "public/app.${H}.wasm"; gzip -9 -k "public/app.${H}.wasm"

# --- Server/edge guest target ---
GOOS=wasip1 GOARCH=wasm $GO build -trimpath -ldflags="-s -w" -o out/guest.wasm ./cmd/plugin
GH=$(shasum -a 256 out/guest.wasm | cut -c1-12)
install -m644 out/guest.wasm "artifacts/guest.${GH}.wasm"   # digest = version

echo "browser app.${H}.wasm + wasm_exec.${H}.js ; guest digest ${GH} ; $($GO version)"
```

Hermetic properties: pinned toolchain (so `wasm_exec.js` and ABI are stable), `-trimpath` (no machine-specific paths), content-addressed outputs, and the guest's digest *is* its version for the registry. Run it in one CI step; verify nothing else mutates the artefacts.

---

## Operational Playbook

| Incident | First check | Likely fix |
|----------|-------------|-----------|
| Blank page, no console error | `wasm_exec.js` version vs binary | re-pin shim to the building Go version |
| `Incorrect response MIME type` | response `Content-Type` at CDN edge | set `application/wasm` at origin + CDN metadata |
| Intermittent corrupt decode | `Vary` honored by shared cache? | add `Vary: Accept-Encoding`, fix CDN cache key |
| Users on stale code post-deploy | filename hashed? `Cache-Control` on HTML? | content-hash filenames; `no-cache` on entry HTML |
| Server p99 cliff per request | recompiling per request? | `CompileModule` once; instantiate per call |
| Host OOM under load | per-instance page cap; concurrency limit | `WithMemoryLimitPages`; bound concurrent instances |
| Request hangs | `WithCloseOnContextDone` set? deadline set? | enable it; wrap calls in context deadline |
| Guest trap crashes host | host treating guest error as fatal | recover/log guest errors; never `panic` on a trap |
| One tenant starves others | per-tenant concurrency / fairness | semaphore per tenant; instruction-budget metering |

---

## Edge Cases the Runtime Reveals

- **A guest-supplied (ptr,len) can be out of range.** `Memory().Read` returns `ok=false`; ignoring it reads garbage or panics. Always check.
- **`memory.grow` invalidates prior memory views.** A `[]byte` you read before the guest grew memory may be stale; re-read after any call that can grow memory.
- **Named modules cannot be instantiated twice.** `WithName("foo")` collides on the second instance; use `WithName("")` for per-request instances.
- **Closing the `Runtime` closes everything.** A `defer rt.Close` in a request handler tears down the shared compiled module — close *instances* per request, the runtime at process shutdown.
- **`wasip1` `_start` runs `main` and exits.** For repeated calls you want the reactor pattern (`//go:wasmexport`), not re-running `_start`.
- **Brotli quality vs build time.** `-q 11` is slow; for CI iteration use `-q 5` locally and `-q 11` only on release builds.
- **`Content-Length` may be the compressed length.** Progress bars computing against it while the browser decompresses can mismatch; measure against the encoded length you actually read.

---

## Professional-Level Checklist

You have mastered this level when you can:

- [ ] Distinguish the `js/wasm` bridge contract from the `wasip1` syscall contract and why binaries aren't interchangeable
- [ ] Choose wazero's compiler vs interpreter from the call pattern and justify it
- [ ] Manage the Runtime / CompiledModule / Module lifecycle with correct sharing and memory accounting
- [ ] Design a numbers-and-memory ABI with `go:wasmexport`/`go:wasmimport`, bounds-checked
- [ ] Enforce memory pages, interruptible deadlines, and an instruction budget on untrusted guests
- [ ] Configure the WASI capability surface (preopens, clock, rand, env) deny-by-default
- [ ] Explain streaming compilation's MIME requirement and how it composes with `Content-Encoding`
- [ ] Build a hermetic pipeline producing version-matched, content-addressed artefacts for both targets
- [ ] Run the operational playbook from symptom to fix
- [ ] Anticipate the runtime edge cases (memory invalidation, named-module collisions, `_start` semantics)

---

## Summary

Professionally, "Wasm in production" is the operation of several contracts. The toolchain emits two non-interchangeable flavours — `js/wasm` (a bidirectional JS bridge needing a version-matched `wasm_exec.js`) and `wasip1` (a socket-less WASI syscall surface) — and the build pipeline must produce content-addressed, stripped, pre-compressed, version-matched artefacts for whichever you ship. On the server, [wazero](https://wazero.io) gives a pure-Go runtime whose Runtime/CompiledModule/Module lifecycle you exploit by compiling once and instantiating per call; its real production weight is in the ABI (a bounds-checked numbers-and-memory boundary via `go:wasmexport`/`go:wasmimport`), the three enforcement mechanisms every untrusted guest needs (page cap, interruptible deadline, instruction budget), and the deny-by-default WASI capability surface. In the browser, streaming compilation demands `application/wasm` and composes cleanly with transparent `Content-Encoding`. Tie it together with a hermetic, toolchain-pinned pipeline and an operational playbook that maps each opaque symptom — blank page, corrupt decode, latency cliff, host OOM, hung request — to a known contract violation and its fix.
