# WASI & `GOOS=wasip1` — Interview Questions

> Practice questions ranging from junior to staff-level. Each has a model answer, common wrong answers, and follow-up probes.

---

## Junior

### Q1. What is WASI, and how does it relate to `GOOS=wasip1`?

**Model answer.** WASI (WebAssembly System Interface) is a standardized, capability-based set of "syscalls" that lets a WebAssembly module interact with a host outside the browser — files, clock, randomness, stdio, args, env. `GOOS=wasip1 GOARCH=wasm` is Go's target for **WASI preview 1**: it compiles ordinary Go into a `.wasm` that performs its I/O through the `wasi_snapshot_preview1` import set, runnable on Wasmtime, wazero, WasmEdge, or Node. It was added in Go 1.21.

**Common wrong answers.**
- "WASI is for running wasm in the browser." (No — that is `GOOS=js`. WASI is specifically for *outside* the browser.)
- "It is the same as the Component Model / preview 2." (No — Go targets preview 1.)

**Follow-up.** *What two environment variables do you set to build it?* — `GOOS=wasip1` and `GOARCH=wasm`; both are required.

---

### Q2. Why can't a `wasip1` program read `/etc/hosts` by default?

**Model answer.** WASI is capability-based with no ambient authority. A module starts with no filesystem access at all — there is no descriptor pointing at any directory. To read a file, the host must *preopen* the directory (`--dir`), which gives the module a descriptor to resolve paths against. `/etc` is never preopened in a normal run, so it is invisible. This is the opposite of a native process, which inherits the launching user's ambient authority.

**Common wrong answer.** "Because wasm can't do file I/O." (It can — but only against preopened directories.)

**Follow-up.** *How do you grant access to `/data`?* — `wasmtime --dir=/data main.wasm` (or the runtime's mapping syntax).

---

### Q3. What works and what does not on `wasip1`?

**Model answer.** Works: stdio, `os.Args` and `os.Getenv` (if the host passes them), `time.Now` (clock), `crypto/rand` (random), and file I/O on preopened directories. Does not work: general networking (no portable sockets), OS threads / multi-core parallelism, and subprocesses (`os/exec`, `fork`, `exec`). Goroutines work but run cooperatively on a single thread.

**Follow-up.** *Can you run an HTTP server on `wasip1`?* — Not portably; preview 1 has no general networking.

---

### Q4. Why is a "hello world" `wasip1` binary several megabytes?

**Model answer.** The Go runtime — scheduler, garbage collector, and standard library — is compiled into every binary. That is expected, not a bug. To shrink it, build with `-ldflags="-s -w"` to strip symbols, or use TinyGo, which produces far smaller modules at the cost of stdlib coverage.

**Follow-up.** *Does the runtime get reloaded each instantiation?* — No; the compiled module is loaded once and can be instantiated cheaply many times.

---

### Q5. How do you run a `wasip1` build with `go run` or `go test`?

**Model answer.** `go` cannot execute a `.wasm` directly; it uses an exec wrapper. With `GOOS=wasip1 GOARCH=wasm`, put `$(go env GOROOT)/lib/wasm` on `PATH` (it ships the `go_wasip1_wasm_exec` wrapper) and set `GOWASIRUNTIME` to your runtime (default `wasmtime`). Then `go run .` and `go test ./...` build the module and run it via the chosen runtime.

**Follow-up.** *Why does `go test` need this?* — The test binary is also wasm; without the wrapper, the OS cannot launch it ("exec format error").

---

## Middle

### Q6. What namespace does a `wasip1` module import from, and why does that matter?

**Model answer.** It imports from `wasi_snapshot_preview1` — the formal name of WASI preview 1. The import section is the module's actual contract: it is the complete list of host functions the runtime must provide. If a code path needs a function not in this set (e.g. a socket call), the module either fails to instantiate with "unknown import" or that path was excluded by build tags. The import list, not the fact it compiled, determines what will actually run.

**Follow-up.** *How do you inspect it?* — `wasm-tools print app.wasm | grep '(import'`.

---

### Q7. Explain host path vs guest path in preopens.

**Model answer.** A preopen has a host path (a real directory) and a guest path (what the module sees). Runtimes let you map them independently: `wasmtime --dir=./data::/data` makes host `./data` visible to the guest as `/data`. The most common bug is that the code uses a guest path that does not match the guest side of the mapping — the directory is preopened, but the path the code asks for is not what the host advertised, so `os.Open` fails with "not found." When debugging, check the guest path first.

**Common wrong answer.** "The host and guest path are always the same." (Not necessarily — they are mapped, and syntax differs per runtime.)

**Follow-up.** *Does the mapping syntax differ across runtimes?* — Yes: Wasmtime `--dir=host::guest`, wazero `-mount=host:guest`, WasmEdge reverses the order. Read the docs.

---

### Q8. What is `go:wasmimport`, and when was it added?

**Model answer.** `go:wasmimport` (Go 1.21) is a compiler directive declaring that a Go function is implemented by a host-provided wasm import: `//go:wasmimport <module> <name>` above a bodyless function. It lets the guest call functions the host supplies — your own embedder, a runtime extension, a plugin ABI. Parameter and result types are restricted to wasm-native scalars (`int32`, `int64`, floats) and pointers; rich data crosses as a pointer + length, with the host reading guest linear memory. If the host does not provide the named import, instantiation fails.

**Follow-up.** *Can you pass a Go string directly?* — No; pass `unsafe.Pointer(&b[0])` plus length and have the host read memory.

---

### Q9. What is `go:wasmexport`, and what is its version floor?

**Model answer.** `go:wasmexport` (**Go 1.24**) is the inverse of `go:wasmimport`: it exports a Go function from the module so the host can call it. It turns the module from a run-once command into a reactor — the host instantiates once, calls `_initialize`, then calls the exported function repeatedly. It requires Go 1.24; on earlier toolchains the directive is unrecognised. A very common mistake is reading a current article and trying it on Go 1.21–1.23.

**Follow-up.** *What lifecycle function must run before an export is called?* — `_initialize`, to run runtime and package init.

---

### Q10. Why do goroutines work but parallelism does not?

**Model answer.** `wasip1` is single-threaded; Go's `wasip1` runtime schedules all goroutines cooperatively on one OS thread. So goroutines, channels, `select`, and `sync` primitives all work correctly, but `GOMAXPROCS` is effectively 1 — CPU-bound goroutines take turns rather than running on multiple cores. `wasip1` is for concurrency as structure, not parallelism as speedup. If a workload only goes fast on many cores, `wasip1` is the wrong target.

**Follow-up.** *How does blocking work then?* — Through `poll_oneoff`; a blocked goroutine yields the single thread cooperatively.

---

### Q11. How do you keep native-only code out of a `wasip1` build?

**Model answer.** Use build constraints. Guard the unsupported code with `//go:build !wasip1` and provide a `wasip1` implementation (`//go:build wasip1`) that fails with a clear error rather than hanging. Isolate the unsupported operation behind one interface so the rest of the codebase stays platform-agnostic. Note that `//go:build wasm` matches both `js` and `wasip1`; use the specific `wasip1`/`js` tags for divergent code.

**Common wrong answer.** "Use `//go:build wasm` for the WASI-specific code." (That also matches the browser target.)

**Follow-up.** *File-name suffix equivalent?* — `transport_wasip1.go` compiles only for `wasip1`.

---

### Q12. State precisely what networking is available on `wasip1`.

**Model answer.** No general networking. Preview 1 has no portable `socket`/`connect`/`bind`/`listen`, so `net.Dial`, `net.Listen`, and `http` do not work portably. There is a narrow exception: preview 1 defines `sock_accept` for accepting on a *host-provided* listening socket, which some platforms use to route requests into a module — but that requires runtime-specific glue and is not how Go's `net` package works out of the box. Some runtimes (WasmEdge) add non-standard socket extensions; code using them is not portable. The honest stance: treat `wasip1` as having no networking.

**Follow-up.** *Where does real WASI networking live?* — In preview 2's `wasi:sockets`, which Go's standard toolchain does not yet target.

---

## Senior

### Q13. When do you choose `wasip1` over a container or a native plugin?

**Model answer.** `wasip1` wins for sandboxed, dense, portable, function-shaped workloads — especially untrusted code. It gives a deny-by-default capability sandbox, memory isolation by construction, microsecond-to-millisecond cold start, thousands-per-node density, and one artifact across architectures. A container wins when you need full OS facilities — networking, multiple cores, subprocesses — with moderate isolation. A native Go `plugin` wins only when you fully trust the plugin and need zero boundary cost, accepting tight toolchain coupling and that a plugin crash takes down the host. So: untrusted/dense/portable compute → wasm; full-OS workload → container; trusted high-performance extension → native.

**Follow-up.** *Why not native plugins for untrusted code?* — They share the host address space; no sandbox, and a panic kills the host.

---

### Q14. Walk me through designing a plugin system on `wasip1` + wazero.

**Model answer.** A Go host uses wazero (pure Go, no CGo) to load `.wasm` plugins. Key decisions: (1) Instantiate the WASI preview-1 host functions. (2) `CompileModule` once and cache the compiled artifact — compilation is the expensive step; instantiate per request. (3) Define a small, versioned interop ABI — stdio for simple cases, or host functions via `HostModuleBuilder` + `go:wasmimport` for richer interaction, passing length-prefixed buffers. (4) Scope capabilities per invocation in the host config — a per-call scratch directory, only contractual env, nothing more. (5) Bound execution with `context.WithTimeout` and a memory limit so an untrusted plugin can't hang or OOM the host. Capability scoping living in the host, not the plugin, is the architectural lever.

**Follow-up.** *What is the biggest performance mistake here?* — Recompiling the module on every invocation instead of caching the compiled module.

---

### Q15. The wasm sandbox protects memory. What does it NOT protect, and how do you cover the gaps?

**Model answer.** Memory isolation and capability containment are free; three things are not. (1) **Resource fairness** — a guest can spin CPU or allocate unboundedly. Cover with fuel/instruction limits (Wasmtime fuel, wazero context interruption), memory caps, and wall-clock timeouts. (2) **Safety of granted I/O** — if you preopen a sensitive directory the guest reads it; scope capabilities narrowly. (3) **Safety of host imports** — a host function that performs host I/O on guest-supplied parameters re-introduces ambient authority (confused deputy). Validate and allowlist every guest-supplied argument in host functions. The sandbox is only as tight as your weakest host import.

**Common wrong answer.** "wasm is sandboxed, so untrusted code is safe." (Memory-safe, yes; resource-safe and ABI-safe, only if you design it.)

**Follow-up.** *Give a concrete confused-deputy example.* — A `hostReadFile(pathPtr, len)` import that opens whatever path the guest passes, including `/etc/passwd`.

---

### Q16. How do you make `wasip1` execution deterministic?

**Model answer.** `wasip1` is closer to deterministic than native but not by default. Floating-point is deterministic by the wasm spec, and single-threaded scheduling removes cross-core data-race nondeterminism. The non-deterministic parts are the clock (`clock_time_get`) and randomness (`random_get`), which read host state, plus I/O ordering. For reproducible execution — consensus, replay, audit — the host supplies a *fixed clock* and a *seeded PRNG* through its WASI implementation (wazero lets you inject both) and controls all I/O. You opt into determinism by controlling the host; the default is non-deterministic.

**Follow-up.** *Who uses this?* — Blockchain/smart-contract and deterministic-replay systems run wasm precisely for this controllable determinism.

---

### Q17. What is the preview-1 to preview-2 migration story, and how do you prepare?

**Model answer.** Preview 1 is the flat `wasi_snapshot_preview1` function list Go targets today. Preview 2 ("WASI 0.2") is rebuilt on the Component Model — typed WIT interfaces, composable components, and real `wasi:sockets`/`wasi:http`. The Go standard toolchain emits preview 1; preview 2 support is intended but not the default `go build` output. Preparation: isolate everything WASI- and ABI-specific (`go:wasmimport`/`go:wasmexport`, pointer marshalling) behind a thin layer, keep business logic platform-agnostic, and rely on adapter tooling (the wasi-preview1 component adapter) to run preview-1 cores in preview-2 hosts during the transition. Teams that scattered ABI code throughout face a rewrite.

**Follow-up.** *What does preview 2 fix that hurts on preview 1?* — Networking, rich typed interop instead of pointer+length, and composability.

---

### Q18. You ship a `wasip1` module that "runs on Wasmtime" but fails on a customer's WasmEdge. Diagnose.

**Model answer.** "Portable" means portable across the *standard* preview-1 feature set, not extensions. The likely causes: (1) the module uses a non-standard socket extension that WasmEdge provides differently or Wasmtime does not — dump the imports and look for non-`wasi_snapshot_preview1` entries; (2) path-mapping syntax differs, so a preopen that worked under one runtime's flags is wrong under another; (3) a runtime stubs a function (e.g. a constant `random_get`) the module depends on; (4) stdin EOF or `os.Args[0]` behaviour differs. Fix: stick to the standard import set, inspect imports in CI, pin runtime versions, and test on every runtime you ship to — not just one.

**Follow-up.** *How do you catch this before the customer does?* — A CI smoke-run on each target runtime plus an import-list assertion.

---

## Staff / Architect

### Q19. Design the host/guest ABI for a long-lived plugin platform. What makes it survive version churn?

**Model answer.** The set of `go:wasmimport` host functions plus `go:wasmexport` guest functions is an ABI between separately-compiled artifacts, with no compile-time agreement check — a mismatch is a runtime failure or silent corruption. Make it durable: (1) **Version it** — expose `abi_version() -> int32`, check it at instantiation, refuse mismatched majors. (2) **Pass length-prefixed serialised buffers** (JSON/protobuf/fixed layout), not Go struct layouts, so the ABI is decoupled from compiler internals. (3) **Keep the function set tiny** — prefer a narrow `host_call(opcode, in_ptr, in_len) -> (out_ptr, out_len)` over dozens of specific functions; every function is forever until a major bump. (4) **Document pointer ownership and lifetime** explicitly — who allocates, who frees, validity window. (5) **Isolate the ABI behind a thin layer** so the eventual preview-2 migration touches one place.

**Follow-up.** *Why not expose many typed host functions for convenience?* — Each is a permanent ABI commitment and an attack surface; a narrow opcode-dispatch ABI ages and audits better.

---

### Q20. Architect an edge platform that runs customer Go-compiled `wasip1` functions per request.

**Model answer.** The economics are cold start and density. (1) **Compilation:** AOT-compile each customer module once per node (`wasmtime compile` / wazero compilation cache); deployment cold start becomes instantiation-only (µs–ms), not compilation. (2) **Density:** thousands of instances share compiled modules in one process; per-tenant isolation is cheap. (3) **I/O:** preview 1 has no networking, so the *platform* owns request ingress/egress — route requests in via host-provided fds or a host-call ABI, and treat the function as pure compute. (4) **Isolation:** per-request capability scoping (scratch dir, scoped env), fuel/timeout/memory limits per invocation for untrusted tenant code. (5) **Size:** Go binaries are MB-scale; bound density with TinyGo where the stdlib subset suffices, and ship compiled artifacts to nodes. (6) **Observability:** capture guest logs/metrics/traps host-side with tenant attribution. (7) **Heterogeneous fleet:** one `.wasm` runs on x86 and ARM nodes unchanged.

**Follow-up.** *Where does this break vs a container-based edge platform?* — When functions need outbound network calls or many cores; then the platform must broker network via host calls (or move to preview-2 `wasi:http`) and accept single-threaded execution.

---

### Q21. How do you test and observe a sandboxed `wasip1` system in CI and production?

**Model answer.** **CI:** build the `.wasm`, then run the full `go test` suite under `wasip1` via the exec wrapper (`GOWASIRUNTIME`) — the native build can pass while the `wasip1` build pulls in `net` and fails to instantiate; only the wasm test run catches it. Add `wasm-tools validate` and an import-list assertion (no unexpected `sock_*`/`env::*`). Smoke-run on every target runtime. **Production:** the sandbox obscures the guest, so observability is host-side — instrument instantiation/invocation time, fuel consumed, memory high-water mark, and trap reasons; capture guest stdout/stderr or a host log function with tenant tags; map trap reasons to actionable messages ("plugin X exceeded fuel," not "module trapped"). Debug logic natively (where the debugger works) and reserve `wasip1` runs for boundary integration tests.

**Follow-up.** *Why is native debugging still relevant?* — DWARF support in wasm is uneven across runtimes; the same Go code debugged natively, then integration-tested under `wasip1`, is the pragmatic workflow.

---

### Q22. Should this workload be `wasip1` at all? Give me your decision framework.

**Model answer.** Two questions decide it: *what is the workload shape* and *what trust boundary do I need*. Choose `wasip1` when the workload is function-shaped (read input, transform, write output), I/O-light, and you need a strong deny-by-default sandbox for untrusted/semi-trusted code, high-density fast-starting execution, or a single portable artifact. Reject it when the workload is a network server, needs multiple cores, shells out to subprocesses, requires high-throughput rich data interchange with the host (the pointer+length boundary dominates), or is so size-constrained that even TinyGo's stdlib gaps are unacceptable. And weigh the moving-standard cost: you target preview 1 today and will pay migration cost for preview 2. If a container already gives the isolation you need and you don't value density or portability, a container is simpler.

**Follow-up.** *Name one trap that makes teams regret choosing `wasip1`.* — Designing a service around "networking is coming soon"; it is not there on preview 1, and betting on extensions makes you non-portable and stuck.

---

## Quick-fire

| Q | Crisp answer |
|---|--------------|
| Build command? | `GOOS=wasip1 GOARCH=wasm go build` |
| Added in Go version? | 1.21 |
| Import namespace? | `wasi_snapshot_preview1` |
| Browser target instead? | `GOOS=js GOARCH=wasm` |
| Grant a directory? | `--dir` (preopen) |
| Networking on preview 1? | No general sockets |
| Threads / parallelism? | Single-threaded; no |
| `go:wasmimport` version? | Go 1.21 |
| `go:wasmexport` version? | Go 1.24 |
| Build tag for WASI only? | `//go:build wasip1` |
| Run via `go run`? | Exec wrapper + `GOWASIRUNTIME` |
| Does Go target preview 2? | No — preview 1 |

---

## Mock Interview Pacing

A 30-minute interview on `wasip1` might cover:

- 0–5 min: warm-up — Q1, Q2, Q3.
- 5–15 min: middle topics — Q6, Q7, Q8/Q9, Q12.
- 15–25 min: a senior scenario — Q14, Q15, or Q17.
- 25–30 min: a curveball — Q19 or Q20.

If the candidate claims hands-on `wasip1` experience, drive straight to Q7 (path mapping) and Q15 (what the sandbox does not protect) — both are field-test questions. If they have only read about it, stay in middle territory and probe whether they understand the import surface (Q6) and the networking reality (Q12). A staff candidate should reach Q19 or Q20 within fifteen minutes and should never overclaim networking or confuse preview 1 with preview 2.
