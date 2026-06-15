# TinyGo for Wasm & Embedded — Interview Questions

> Practice questions ranging from junior to staff-level. Each has a model answer, common wrong answers, and follow-up probes.

---

## Junior

### Q1. What is TinyGo and why does it exist?

**Model answer.** TinyGo is an alternative Go compiler built on LLVM, aimed at environments the standard `gc` toolchain cannot reach: microcontrollers with kilobytes of RAM, and small WebAssembly modules where binary size matters. Where `gc` produces multi-megabyte binaries with a runtime that assumes an OS, threads, and a garbage collector, TinyGo produces KB-scale binaries with a minimal runtime that can run bare-metal on an Arm Cortex-M, RISC-V, AVR, or as a compact `.wasm`.

It is the *same language* — TinyGo parses Go source — but a *different implementation* that trades completeness for size and reach. It is not a fork of `gc`; it reuses `go/types` and the standard `go` tooling for parsing and type-checking, then lowers to LLVM IR instead of the `gc` SSA backend.

**Common wrong answers.**
- "TinyGo is a stripped-down version of Go the language." (No — the language is the same; the compiler and runtime are different.)
- "It's a transpiler to C." (No — it lowers to LLVM IR and uses LLVM's backends.)
- "It replaces `gc` for all builds." (No — it targets constrained environments; `gc` is the default for servers and CLIs.)

**Follow-up.** *Why LLVM specifically?* — LLVM already has mature backends for Arm, RISC-V, AVR, WebAssembly, and aggressive size/dead-code optimization. Reusing it means TinyGo gets dozens of targets and a battle-tested optimizer instead of writing code generators from scratch.

---

### Q2. How big is a TinyGo binary compared to a `gc` binary?

**Model answer.** Order-of-magnitude smaller. A trivial `gc` Go binary is a few megabytes because it statically links the full runtime, the garbage collector, the scheduler, and reflection metadata. The equivalent TinyGo binary is often tens of kilobytes. For WebAssembly, a "hello world" `.wasm` from `gc` is on the order of a couple of megabytes; from TinyGo it can be a few kilobytes to tens of kilobytes.

The savings come from a minimal runtime, dead-code elimination at the LLVM level, no full reflection support by default, and a simpler GC. This is the entire reason TinyGo exists: a `gc` binary does not fit in a microcontroller's flash, and a multi-MB `.wasm` is a poor fit for the browser or an edge function.

**Follow-up.** *Where does most of the `gc` size go?* — The runtime: scheduler, GC, type/reflection tables, and the assumption of a hosted OS. TinyGo's runtime is a fraction of that.

---

### Q3. Is TinyGo a drop-in replacement for the `go` command?

**Model answer.** No, and this is the single most common misconception. TinyGo runs *most* Go programs but not *all*. It implements a subset of the standard library, has limited `reflect` support, a different (cooperative) scheduler, and different GC behavior. Programs that lean on dynamic reflection, the full `net/http` server stack, or heavy `encoding/json` over arbitrary types may fail to compile or behave differently.

You write ordinary Go, but you must validate that your program and its dependencies fall within the supported subset. Treat TinyGo as a different compiler with overlapping but not identical capabilities, not as a faster `go build`.

**Common wrong answer.** "If it compiles with `go`, it compiles with TinyGo." (No — the supported surface is narrower.)

**Follow-up.** *Name something that commonly breaks.* — `encoding/json` unmarshalling into dynamic types via reflection, anything depending on full `reflect` (struct tag walking over arbitrary types), large parts of `net`, and goroutine patterns that assume real parallelism.

---

### Q4. How do you build a TinyGo program for the browser?

**Model answer.** Use the wasm target:

```
tinygo build -o main.wasm -target wasm ./main.go
```

TinyGo ships its *own* `wasm_exec.js` — the JavaScript glue that instantiates the module and bridges the Go runtime to the browser — which differs from the one shipped with `gc`. You must use TinyGo's copy (found under the TinyGo install's `targets/` directory), not the `gc` one, because the runtime ABI differs.

This is closely related to the `gc` browser path covered in **sibling topic 01 (`GOOS=js wasm` browser)**; TinyGo is the size-optimized alternative to that same use case.

**Common wrong answer.** "Reuse the `wasm_exec.js` from `$(go env GOROOT)/misc/wasm`." (No — that one matches `gc`'s ABI, not TinyGo's.)

**Follow-up.** *How would you target a server-side or edge WASI runtime instead of the browser?* — Use `-target wasi` (or `wasip1`), which produces a module against the WASI system interface rather than browser glue. See **sibling topic 02 (WASI and wasip1)**.

---

### Q5. How do you flash a TinyGo program onto a microcontroller?

**Model answer.** Use `tinygo flash` with a board target:

```
tinygo flash -target=arduino-nano33 ./main.go
```

TinyGo knows a catalog of boards (`tinygo flash -target=...`) — Arduino, Raspberry Pi Pico, micro:bit, ESP32, and many more. The target encodes the chip, memory layout, and the programmer/upload method. `tinygo flash` compiles, links against the right linker script, and uploads the firmware over the board's programming interface in one step. `tinygo build` alone just produces the firmware image without uploading.

**Follow-up.** *What does the `-target` flag actually select?* — A target description: CPU architecture, linker script (flash/RAM layout), default scheduler and GC, build tags, and the flash/upload tool. It is the bridge between portable Go source and a specific board.

---

## Middle

### Q6. Explain the scheduler modes. Why does TinyGo need them?

**Model answer.** Go's concurrency model assumes a runtime scheduler that multiplexes goroutines onto OS threads. On a bare-metal microcontroller there are no OS threads, and in single-threaded WebAssembly there is no preemption. TinyGo therefore offers selectable scheduler modes via `-scheduler`:

- **`tasks`** — a cooperative scheduler using separate stacks per goroutine, switched at blocking points (channel ops, `time.Sleep`, etc.). The default on most embedded targets. Goroutines work, but cooperatively, not preemptively.
- **`asyncify`** — an LLVM/Binaryen transformation that lets goroutines suspend and resume in WebAssembly, where there is no native stack-switching primitive. This is how goroutines and blocking calls work inside a `.wasm`. It adds code size and overhead but makes `go func()` and channels usable in the browser.
- **`none`** — no scheduler at all. Goroutines, channels, and `time.Sleep` that would require scheduling are unavailable. Smallest and fastest; suitable for a tight bare-metal loop that never spawns goroutines.

The mode is a deliberate trade between concurrency support, binary size, and runtime overhead.

**Common wrong answer.** "TinyGo goroutines run on real threads." (No — there is no true parallelism; the scheduler is cooperative.)

**Follow-up.** *What happens to a goroutine that never yields under `tasks`?* — It starves the others. Cooperative scheduling means a CPU-bound loop with no blocking point hogs the scheduler. You must insert a yield (e.g., a channel op or `runtime.Gosched`-style break) or restructure.

---

### Q7. Do goroutines run in parallel under TinyGo?

**Model answer.** No. TinyGo provides goroutines and channels (under `tasks` or `asyncify` schedulers) so concurrent *code* works, but they are cooperatively scheduled on a single execution context. There is no multi-core parallelism, and on WebAssembly there is a single thread by definition. You get concurrency (interleaving) but not parallelism (simultaneous execution).

This matters for correctness reasoning: code that *happens* to work on `gc` because of true parallelism or preemption may deadlock or starve under cooperative scheduling, and vice versa — race conditions that `gc`'s race detector would catch may be masked by the single-threaded execution. Do not assume timing behavior carries over.

**Follow-up.** *So is a mutex pointless under TinyGo wasm?* — Logically a mutex still expresses intent and protects against re-entrancy across yield points, but it will never contend across cores because there is one. The bug it usually catches — concurrent mutation — can still occur across cooperative yield boundaries, so keep it.

---

### Q8. Walk through the three GC modes and when `leaking` is acceptable.

**Model answer.** TinyGo selects a GC via `-gc`:

- **`conservative`** (the default) — a mark-sweep collector that conservatively scans memory, treating any bit pattern that looks like a pointer as a pointer. Small and simple; it can occasionally retain garbage (false positives) but never frees live memory. Fine for most embedded and wasm workloads.
- **`precise`** — a collector that uses type information to scan only real pointers, reducing false retention. More accurate, slightly more metadata.
- **`leaking`** — allocates and *never* frees. There is no collector at all. Allocation is a bump pointer; deallocation is a no-op.

`leaking` is acceptable when the program's total allocation over its lifetime fits in available memory. Two patterns: (1) a short-lived program that runs, allocates a bounded amount, produces output, and exits — common for a wasm function invoked per request that is then torn down; (2) a microcontroller program that does all its allocation at startup and then runs a steady-state loop with zero further allocation. In both, never collecting is free performance: no GC pauses, no collector code in the binary, smallest and fastest.

`leaking` is *unacceptable* for a long-running program that allocates continuously — it will exhaust memory and crash.

**Common wrong answer.** "`leaking` means there are memory leaks (bugs)." (No — it is a deliberate strategy: no GC, allocate-only. Whether it is a problem depends on the allocation profile.)

**Follow-up.** *How do you know if `leaking` is safe for your firmware?* — Bound the allocation: prefer stack allocation and preallocated buffers, audit for per-iteration heap allocation (escape analysis, `-print-allocs`), and confirm total heap growth is bounded by design.

---

### Q9. What exactly is limited about `reflect` in TinyGo, and what breaks because of it?

**Model answer.** Full `reflect` requires extensive runtime type metadata — names, field tags, method sets, the ability to construct and mutate arbitrary values dynamically. That metadata is large and is one of the biggest contributors to binary size. TinyGo implements a *subset* of `reflect`: enough for many common cases, but historically lacking complete support for things like dynamic struct field iteration, full `Method`/`Call` reflection, and constructing arbitrary types at runtime.

What breaks downstream:
- **`encoding/json`** over arbitrary/dynamic types. Marshalling and unmarshalling into `interface{}` or via reflective struct-tag walking may fail or be incomplete. Code-generated or schema-fixed serialization works better.
- ORMs, validators, and DI frameworks that walk struct tags reflectively.
- Anything using `reflect.Value.Call` or building types via `reflect.New`/`reflect.StructOf`.

The practical guidance: prefer static, code-generated, or hand-written serialization on TinyGo; avoid dependencies built on heavy reflection.

**Follow-up.** *Has this improved over time?* — Yes, `reflect` coverage has grown across releases, but it remains a subset by design — full reflection metadata fights the size goal. Always check the current docs and test your specific use.

---

### Q10. What does the `machine` package give you?

**Model answer.** `machine` is TinyGo's hardware abstraction layer for embedded targets. It exposes the chip's peripherals as Go APIs: GPIO pins (`machine.D13.Configure(...)`, `.High()`, `.Low()`), and the standard buses and analog peripherals — I2C, SPI, ADC (analog read), PWM (analog-ish output), and UART. The package is target-specific: the same `machine.LED` symbol maps to a different physical pin on an Arduino versus a Pico, resolved at build time by the `-target`.

It is the embedded analog of `os`/`syscall` on a hosted platform — the boundary between portable Go and the metal. On top of `machine`, the community driver library at **tinygo.org/x/drivers** provides device drivers (sensors, displays, radios) written against these primitives.

**Follow-up.** *Why isn't this in the standard library?* — The standard library targets hosted OSes; bare-metal peripheral access is outside its model. `machine` is TinyGo-specific and necessarily non-portable across boards at the pin level (though the bus APIs — I2C/SPI — are portable in shape).

---

### Q11. How do you decide between TinyGo, `gc`, and C for an embedded project?

**Model answer.** A rough decision tree:

- **`gc`** — not a contender for true microcontrollers; its runtime and binary size assume a hosted OS. Reserve it for Linux-class embedded boards (a Raspberry Pi running Linux is just a small server).
- **TinyGo** — the right choice when you want Go's ergonomics (goroutines, channels, slices, the type system, a familiar language and test tooling) on a constrained MCU or in a small wasm module, and your workload fits the supported subset. You accept slower compiles, a stdlib subset, and cooperative concurrency.
- **C/C++** — when you need the absolute smallest footprint, the most mature vendor SDK and driver ecosystem, hard real-time determinism, or a chip TinyGo doesn't target. C remains the lingua franca of embedded with the deepest tooling.

The honest framing: TinyGo trades some of C's footprint and ecosystem maturity for Go's safety and productivity. Choose it when team familiarity with Go and code maintainability outweigh the last kilobytes and the breadth of vendor C SDKs.

**Follow-up.** *Where does Rust fit?* — Often the real competitor to TinyGo for new embedded work: comparable safety story, smaller-than-Go footprint, no GC, growing HAL ecosystem. TinyGo wins on Go familiarity and simplicity; Rust wins on zero-cost abstractions and no GC.

---

### Q12. Why are TinyGo compiles slower than `gc`?

**Model answer.** `gc` is famous for fast compilation — it has its own purpose-built, speed-optimized backend. TinyGo routes through LLVM, which runs a long pipeline of optimization and lowering passes to achieve the size and performance wins, and that pipeline is slower than `gc`'s backend. You pay compile time to buy small, optimized output.

This is an accepted trade: embedded and wasm artifacts are built less often than server binaries, and the size/footprint payoff is worth the slower build. It is a reason not to adopt TinyGo for ordinary server development where `gc`'s fast iteration loop is a feature.

**Follow-up.** *Does this affect the edit-test loop on hardware?* — Yes; combined with flashing time, the embedded iteration loop is slower than a server `go run`. Teams mitigate with host-side unit tests under `gc` for pure logic, reserving TinyGo flash cycles for hardware-dependent code.

---

## Senior

### Q13. A team wants to run an existing Go HTTP-handler library inside a Cloudflare/Fastly edge function via TinyGo wasm. What do you tell them?

**Model answer.** Several things to set expectations.

1. **Subset compatibility first.** Audit the library and its transitive dependencies for heavy `reflect`, full `net/http` server usage, and dynamic `encoding/json`. Edge wasm with TinyGo will not run an arbitrary `net/http` server; the edge runtime supplies the request/response boundary (Fastly's Compute, some Cloudflare Workers Go support), and your code is invoked per request through that host interface, not via a listening socket.
2. **Scheduler.** Use `asyncify` if the code spawns goroutines or blocks; otherwise prefer `none` for the smallest module. Per-request invocations often favor a no-scheduler or minimal model.
3. **GC.** A per-request module that is instantiated and torn down is a candidate for `leaking` — bounded allocation per request, no collector overhead.
4. **Serialization.** Replace reflective JSON with code-generated or hand-written encoding to stay within the `reflect` subset and shrink the module.
5. **Size budget.** Edge platforms cap module size and cold-start time; TinyGo's KB-scale output is precisely why you'd choose it over `gc` here.

The deeper point: "wrap our existing handler" usually becomes "rewrite the I/O boundary against the edge host's ABI." The business logic ports; the server scaffolding does not. See **sibling topic 05 (wasm in production)** for the deployment and operational side.

**Follow-up.** *Why not just use `gc`'s wasip1 target at the edge?* — You can where the platform supports it, but the multi-MB binary and cold start are the problem TinyGo solves. The choice is size/cold-start (TinyGo) versus full compatibility (`gc`).

---

### Q14. How do you debug a TinyGo program running on a microcontroller?

**Model answer.** A layered approach because there is no console and no OS.

1. **`tinygo gdb`** — TinyGo integrates with GDB via an on-chip debugger (OpenOCD, J-Link, or the board's built-in debug probe). You get breakpoints, single-stepping, and memory/register inspection on the actual silicon. This is the primary tool for stepping through firmware.
2. **Serial / UART logging.** `println` and `machine.Serial` output over UART to a host terminal is the embedded equivalent of `printf` debugging — often the fastest way to confirm control flow and values.
3. **Host-side unit tests.** Factor pure logic out of hardware-touching code and test it with `tinygo test` (or even `go test` under `gc`) on the host, so you only debug on-device the parts that truly need hardware.
4. **GPIO/LED as a logic probe.** Toggling a pin and watching it on a logic analyzer or scope confirms timing and reachability when serial is unavailable.
5. **Build-level checks.** `-print-allocs` to find unexpected heap allocation; size reports to catch flash overflow; `-opt` levels to trade size vs. debuggability.

The constraint that shapes everything: minimal observability. You push as much logic as possible to host-testable code and use GDB-on-hardware for the irreducible remainder.

**Follow-up.** *What's a TinyGo-specific gotcha when debugging?* — Aggressive LLVM optimization can inline and reorder so heavily that source-level stepping is confusing; build at a lower `-opt` level for debugging, and remember the cooperative scheduler means a "hang" is often a goroutine that never yields, not a crash.

---

### Q15. Your TinyGo firmware works, then mysteriously hangs after running for a while. How do you reason about it?

**Model answer.** Enumerate the TinyGo-specific failure modes before general ones.

1. **Memory exhaustion under `leaking` GC (or false retention under `conservative`).** A steady-state loop that allocates per iteration will eventually exhaust the heap. Audit for per-iteration heap allocation; switch to preallocated buffers; verify with `-print-allocs`. If on `conservative`, false-positive pointer retention can grow the live set — consider `precise`.
2. **Cooperative scheduler starvation.** Under `tasks`, a goroutine in a tight loop with no blocking point never yields, so other goroutines (and the main loop) starve. Insert a yield point or restructure.
3. **Stack overflow.** Each goroutine has a fixed stack under `tasks`; deep recursion or large stack frames overflow it silently or corrupt memory. TinyGo stacks are not growable like `gc`'s.
4. **Hardware/peripheral lockup.** An I2C/SPI transaction waiting on a device that never responds, with no timeout, blocks forever. Add timeouts at the `machine` layer.
5. **Stack/heap collision.** On tiny MCUs the heap grows toward the stack; with no MMU, exhaustion manifests as corruption, not a clean OOM.

The method: reproduce with serial heartbeat logging to localize where it stops, check heap headroom, then bisect between allocation, scheduling, and peripheral causes.

**Follow-up.** *Why is this class of bug rarer on `gc`?* — Growable stacks, a real GC, preemptive scheduling, and an OS with virtual memory and OOM handling absorb many of these. TinyGo removes those safety nets to fit the metal, so the discipline moves to you.

---

### Q16. How does TinyGo's WebAssembly output differ from `gc`'s, beyond size?

**Model answer.** Several substantive differences:

- **Runtime ABI and glue.** TinyGo's `wasm_exec.js` and the import/export surface of the module differ from `gc`'s. They are not interchangeable; mixing them fails. (Contrast with **sibling topic 01**, the `gc` browser path.)
- **Concurrency.** `gc` wasm has a runtime that handles goroutines; TinyGo needs `asyncify` to make goroutines and blocking work in the single-threaded wasm sandbox, at a code-size and speed cost. Choosing `none` removes that capability entirely for the smallest module.
- **GC.** `gc` ships its full collector compiled to wasm; TinyGo offers the lighter `conservative`/`precise`/`leaking` choices, which is much of the size delta.
- **Targets.** TinyGo distinguishes `-target wasm` (browser) from `-target wasi`/`wasip1` (system interface). `gc` also supports `js/wasm` and `wasip1` but with the heavier runtime.
- **Interop cost.** Crossing the JS↔wasm boundary, marshalling values, and the overhead per call differ between the two runtimes — relevant to performance tuning. See **sibling topic 04 (wasm interop and performance)**.

The summary: same source language, two different runtime implementations producing wasm with different ABIs, concurrency stories, and footprints.

**Follow-up.** *Can a single project ship both a `gc` wasm and a TinyGo wasm?* — Yes, as a size/compatibility trade: ship TinyGo where it works and `gc` as a fallback for code that needs the full runtime. You maintain two glue setups, which is real overhead.

---

### Q17. What's your strategy for keeping a codebase buildable under both `gc` and TinyGo?

**Model answer.** Treat TinyGo compatibility as a portability constraint, enforced continuously.

1. **CI builds both.** A `go build`/`go test` job and a `tinygo build`/`tinygo test` job on every PR. The TinyGo job catches subset violations (a dependency that pulls in heavy `reflect`, an unsupported stdlib package) the moment they're introduced.
2. **Isolate hardware/wasm boundaries behind interfaces** with build tags (`//go:build tinygo` vs. not), so platform-specific code is swappable and the bulk of logic is shared and host-testable.
3. **Curate dependencies.** Prefer small, reflection-free libraries; vet transitive deps for TinyGo compatibility. A single reflection-heavy logging or JSON library can break the TinyGo build for the whole tree.
4. **Static serialization.** Standardize on code-generated or hand-written encoding so JSON/marshalling doesn't depend on the `reflect` subset.
5. **Document the supported target matrix** (boards, wasm targets, scheduler/GC choices) so contributors know the constraints.

The principle: the TinyGo build is the canary. If you only build under `gc`, TinyGo support rots silently and you discover it during a release crunch.

**Follow-up.** *How do you handle a must-have dependency that's reflection-heavy?* — Fork and strip it, replace it with a TinyGo-friendly equivalent, or wall it off behind a build tag so it only compiles on the `gc` path and provide a lean alternative on the TinyGo path.

---

### Q18. Explain how `asyncify` actually lets goroutines work in wasm.

**Model answer.** WebAssembly (in its baseline form) is single-threaded and has no native primitive to suspend a running function and resume it later with its stack intact — which is exactly what a cooperative scheduler needs to switch goroutines at a blocking point. `asyncify` is a Binaryen/LLVM transformation that rewrites the wasm so functions can *unwind* their state into a side buffer when a goroutine suspends and *rewind* it to resume, effectively implementing stack switching in software at the wasm level.

The practical consequences: it adds instrumentation to many functions, increasing code size and adding runtime overhead on every call that participates in suspension; in exchange, `go func()`, channels, `time.Sleep`, and blocking I/O at the host boundary all work inside the module. If your wasm never needs that — a pure compute function invoked and returned synchronously — `-scheduler=none` skips all of it for a smaller, faster module.

**Common wrong answer.** "Wasm threads handle this." (Threads are a separate, optional proposal and not how TinyGo's default goroutine support works; `asyncify` is a single-threaded software mechanism.)

**Follow-up.** *Cost-wise, when is `asyncify` worth it?* — When the programming model genuinely needs concurrency or blocking host calls and the code-size/overhead budget allows. For per-request edge compute that's mostly synchronous, `none` is usually the better default.

---

## Staff / Architect

### Q19. Design the build-and-test architecture for a product that ships the same Go logic to a cloud server (`gc`), an edge function (TinyGo wasi), and an IoT sensor (TinyGo embedded).

**Model answer.** One core, three thin platform shells, three build paths, continuously verified.

**Core.** A platform-agnostic `core` package: pure logic, no I/O, no `reflect`-heavy dependencies, no `net/http` server, static (code-generated) serialization. This must build under both `gc` and TinyGo. It is the only code shared across all three targets.

**Platform shells (build-tagged).**
- Server: `//go:build !tinygo` shell with full `net/http`, real DB clients, observability — built by `gc`.
- Edge: TinyGo `-target wasip1`, `-scheduler=none` (or `asyncify` if needed), likely `-gc=leaking` for per-request teardown; the shell adapts the edge host's request ABI to the core.
- Embedded: TinyGo `-target=<board>`, `-scheduler=tasks`, `-gc=conservative`; the shell wires `machine` peripherals and `tinygo.org/x/drivers` to the core.

**CI matrix.** Build and test all three on every PR. The two TinyGo jobs are the compatibility canaries; a dependency or reflection regression fails fast. Pure-logic tests run under `gc` for speed; hardware-touching and wasm-boundary tests run under their respective TinyGo targets (hardware tests possibly on a device farm or emulator).

**Dependency governance.** A vetted allowlist; new dependencies must pass the TinyGo build. Treat "compiles under TinyGo" as a release gate for `core`.

**Release artifacts.** Server binary (`gc`), `.wasm` for the edge (with its TinyGo glue/ABI), firmware image per board (`tinygo flash`/`build`). Each path pins its toolchain version.

The architectural thesis: the *language* unifies the three targets, but the *runtime implementations* and constraints differ, so the discipline is a small portable core, fat platform shells, and CI that exercises every compiler.

**Follow-up.** *What's the biggest risk?* — Silent core bloat: someone adds a reflection-heavy convenience to `core` that builds under `gc`, and the edge/embedded builds break weeks later. The CI canary and dependency allowlist exist specifically to prevent that.

---

### Q20. When is adopting TinyGo a strategic mistake, and how do you advise against it?

**Model answer.** TinyGo is a sharp tool with a narrow blade. It's a mistake when:

1. **You're building ordinary server software.** `gc`'s fast compiles, full stdlib, true parallelism, complete `reflect`, and mature ecosystem all dominate. TinyGo buys you nothing here and costs you compatibility and compile speed.
2. **Your dependency tree is reflection-heavy and immovable.** If the business logic is welded to ORMs, dynamic JSON, and DI frameworks, the porting cost may exceed the benefit — choose `gc` wasm (accepting size) or another language.
3. **The team has no embedded/wasm operational maturity.** Debugging on-device, reasoning about cooperative scheduling and manual memory discipline, and managing two compilers is real cost. Without that capacity, the project stalls.
4. **You need hard real-time guarantees or the broadest chip/SDK support.** C (or Rust) with vendor SDKs may be the responsible choice.

How to advise: frame it as fit-for-purpose, not better/worse. Ask what the actual constraint is — binary size, no-OS target, edge cold start. If none of those bind, `gc` is the answer. If they do bind, scope a spike: build the riskiest dependency under TinyGo first to surface subset incompatibilities before committing.

**Follow-up.** *What's a healthy adoption path?* — Start with a single, well-bounded artifact (one edge function or one sensor firmware), prove the toolchain and the subset constraints, build CI for it, then expand. Don't migrate a whole platform on a hunch.

---

### Q21. How would you bound and verify memory behavior for safety-critical TinyGo firmware?

**Model answer.** Make memory behavior a design property, not an emergent one.

1. **Eliminate steady-state heap allocation.** Architect the loop to allocate everything at startup — fixed buffers, pre-sized slices, pooled objects — so the hot path performs zero heap allocation. Verify with `-print-allocs` (or escape-analysis inspection) and fail CI if hot-path allocation appears.
2. **Choose GC by allocation profile.** With zero steady-state allocation, `leaking` is correct and free (no collector, no pauses). If allocation is unavoidable but bounded, size the heap to the worst case and use `precise` to avoid false retention.
3. **Bound stacks explicitly.** Under `tasks`, each goroutine stack is fixed and non-growable. Compute worst-case stack depth (no unbounded recursion; cap call depth) and size stacks with margin; the stack/heap collision on an MMU-less MCU is silent corruption otherwise.
4. **Worst-case static analysis.** Treat it like avionics: bound every buffer, every loop iteration count, every recursion. The absence of an OS/MMU means there's no runtime safety net to fall back on.
5. **Soak testing on hardware.** Run for extended periods with a serial heartbeat and heap-headroom telemetry to catch slow leaks the static analysis missed.

The framing for leadership: TinyGo gives Go ergonomics, but on bare metal you inherit C-level memory responsibility. The verification rigor must match.

**Follow-up.** *Would you ever pick `conservative` for safety-critical work?* — Cautiously; its false-positive retention is bounded-but-nondeterministic, which sits poorly with worst-case analysis. `leaking` (with zero steady-state allocation) or `precise` with a sized heap are easier to reason about formally.

---

### Q22. What are the long-term maintenance risks of betting on TinyGo, and how do you mitigate them?

**Model answer.** Strategic risks beyond day-one correctness:

1. **Subset drift across releases.** TinyGo's stdlib and `reflect` coverage evolve; a future release may change behavior or a dependency may start using a still-unsupported feature. *Mitigate:* pin the TinyGo version per artifact, build under it in CI, and upgrade deliberately with a test gate.
2. **Toolchain/LLVM coupling.** TinyGo tracks specific LLVM versions; build environments and reproducibility depend on a particular toolchain. *Mitigate:* hermetic, version-pinned builds (containerized), reproducible-build discipline — especially for firmware that may be rebuilt years later.
3. **Smaller ecosystem and bus factor.** Fewer maintainers and contributors than `gc`. A critical bug or an unsupported new chip may not be addressed on your timeline. *Mitigate:* keep the TinyGo-specific surface small and behind interfaces so you could swap toolchains or fall back to `gc` wasm / C if necessary; budget for upstream contribution.
4. **Compatibility regressions from your own dependencies.** A routine dependency bump can pull in reflection-heavy code that breaks the TinyGo build. *Mitigate:* dependency allowlist and the CI canary build (see Q17/Q19).
5. **Operational knowledge concentration.** Embedded/wasm debugging skills may live in one or two engineers. *Mitigate:* document runbooks (Q14/Q15) and spread the knowledge.

The staff-level point: TinyGo is a sound bet for genuinely constrained targets, but it's a *narrower-supported* path than mainline Go, so you de-risk by keeping the bet small, pinned, isolated, and continuously verified — never by assuming it behaves like `gc`.

**Follow-up.** *What's your exit strategy if TinyGo stops fitting?* — Because the core is portable and platform shells are thin and tagged, the exit is: re-target the shell. For edge, fall back to `gc` wasip1 (accept size). For embedded, the irreducible option is a C or Rust rewrite of the shell against the same logic spec — costly, which is exactly why you keep the shell thin.

---

## Quick-fire

| Q | Crisp answer |
|---|--------------|
| What backend does TinyGo use? | LLVM. |
| Binary size vs `gc`? | KB-scale vs MB-scale. |
| Drop-in replacement for `go`? | No — subset of stdlib/`reflect`, different runtime. |
| Browser wasm build flag? | `-target wasm` (with TinyGo's own `wasm_exec.js`). |
| Server/edge wasm target? | `-target wasi` / `wasip1`. |
| Flash a board? | `tinygo flash -target=<board>`. |
| Scheduler modes? | `none`, `tasks`, `asyncify`. |
| Goroutines in wasm via? | `asyncify`. |
| GC modes? | `conservative` (default), `precise`, `leaking`. |
| When is `leaking` OK? | Bounded total allocation (short-lived or startup-only alloc). |
| Goroutines parallel? | No — cooperative, single-threaded. |
| Common stdlib casualty? | `encoding/json` over dynamic/reflective types. |
| Hardware abstraction package? | `machine` (GPIO/I2C/SPI/ADC/PWM). |
| Driver library? | tinygo.org/x/drivers. |
| Compile speed vs `gc`? | Slower (LLVM optimization pipeline). |
| On-device debugger? | `tinygo gdb` (via OpenOCD/J-Link). |

---

## Mock Interview Pacing

A 30-minute interview on TinyGo might cover:

- 0–5 min: warm-up — Q1, Q2, Q3 (why it exists, size, not-a-drop-in).
- 5–15 min: middle topics — Q6 (schedulers), Q8 (GC modes), Q9 (`reflect` limits), Q11 (TinyGo vs `gc` vs C).
- 15–25 min: a senior scenario — Q13 (edge wasm), Q15 (the hang), or Q17 (dual-build).
- 25–30 min: a curveball — Q19 (three-target architecture) or Q20 (when not to use it).

If the candidate claims hands-on embedded experience, drive straight to Q14 (debugging), Q15 (the hang), and Q21 (memory bounding) — these separate people who flashed a blinky from people who shipped firmware. If they claim wasm/edge experience, probe Q13, Q16, and Q18 (`asyncify`). The single best filter for *depth* is Q3 plus Q7: candidates who think TinyGo is "just faster Go" or that goroutines run in parallel haven't operated it seriously. A staff candidate should reach the architecture framing in Q19 unprompted and treat TinyGo as fit-for-purpose, not a universal upgrade.

---

## Further Reading

- TinyGo documentation — https://tinygo.org/docs/
- TinyGo drivers (device library) — https://github.com/tinygo-org/drivers (https://tinygo.org/x/drivers)
- Sibling topic 01 — `GOOS=js wasm` in the browser (the `gc` browser path TinyGo optimizes for size).
- Sibling topic 02 — WASI and `wasip1` (the system-interface target for server/edge wasm).
- Sibling topic 04 — Wasm interop and performance (JS↔wasm boundary cost, relevant to both runtimes).
- Sibling topic 05 — Wasm in production (deployment and operational concerns for edge/embedded artifacts).
