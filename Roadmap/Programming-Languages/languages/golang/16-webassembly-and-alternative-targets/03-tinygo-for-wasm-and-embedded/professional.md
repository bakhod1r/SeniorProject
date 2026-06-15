# TinyGo for Wasm & Embedded — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [The Compilation Pipeline: Go SSA → LLVM IR → Codegen](#the-compilation-pipeline-go-ssa--llvm-ir--codegen)
3. [Why LLVM Enables Both MCU Codegen and Small Wasm](#why-llvm-enables-both-mcu-codegen-and-small-wasm)
4. [The Minimal Runtime](#the-minimal-runtime)
5. [Scheduler Internals: Asyncify vs Tasks](#scheduler-internals-asyncify-vs-tasks)
6. [The Three Garbage Collectors](#the-three-garbage-collectors)
7. [The ABI and Host Interop](#the-abi-and-host-interop)
8. [Binary-Size Internals: What Ships, What Is Stripped](#binary-size-internals-what-ships-what-is-stripped)
9. [The Drivers Ecosystem](#the-drivers-ecosystem)
10. [CI for Embedded and Edge](#ci-for-embedded-and-edge)
11. [Reproducible Firmware Builds](#reproducible-firmware-builds)
12. [Hardware-in-the-Loop Testing](#hardware-in-the-loop-testing)
13. [Flashing and OTA](#flashing-and-ota)
14. [Debugging with GDB, OpenOCD, and `tinygo gdb`](#debugging-with-gdb-openocd-and-tinygo-gdb)
15. [Edge Cases and Divergences from Standard Go](#edge-cases-and-divergences-from-standard-go)
16. [Operational Playbook](#operational-playbook)
17. [Summary](#summary)

---

## Introduction

TinyGo is not a stripped subset of the `gc` compiler. It is an entirely separate compiler that reuses the *front end* of Go — the parser, type checker, and SSA construction from `golang.org/x/tools/go/ssa` — and then diverges completely, lowering Go SSA to LLVM IR and handing the rest to LLVM. That single architectural decision explains almost everything that distinguishes TinyGo from upstream Go: kilobyte-scale binaries, microcontroller targets the `gc` compiler will never reach, WebAssembly modules an order of magnitude smaller than `GOOS=js`, and the absence of features (full reflection, unrestricted goroutine preemption, some `unsafe` patterns) that do not survive whole-program LLVM compilation.

This file is for engineers who ship TinyGo to production: firmware on Cortex-M and RIS-C-V boards, Wasm modules on Fastly Compute or embedded in a `wazero` host, or sensor fleets driven by `tinygo.org/x/drivers`. The reference page is [`01-goos-js-wasm-browser`](../01-goos-js-wasm-browser/) for the browser target this one undercuts on size, [`02-wasi-and-wasip1`](../02-wasi-and-wasip1/) for the WASI surface TinyGo implements, [`04-wasm-interop-and-performance`](../04-wasm-interop-and-performance/) for the host-boundary cost model, and [`05-wasm-in-production`](../05-wasm-in-production/) for the deployment patterns this page's CI section feeds into.

After reading you will:

- Trace a Go function from source through Go SSA, TinyGo's lowering passes, LLVM IR, and into machine code or Wasm.
- Reason about the minimal runtime: which scheduler you compiled in, which GC, and what each costs.
- Use the ABI deliberately — `//export`, `//go:wasmimport`, `//go:wasmexport` — with the right calling convention and memory model.
- Know precisely what is stripped from a TinyGo binary and why `-opt=z -no-debug` does what it does.
- Operate embedded and edge CI: reproducible firmware, hardware-in-the-loop, OTA, and on-chip debugging.

The recurring theme is that TinyGo is a *whole-program* compiler. There is no separate compilation, no linker fed pre-built archives, no runtime type information unless something demonstrably needs it. Every design consequence below flows from that.

---

## The Compilation Pipeline: Go SSA → LLVM IR → Codegen

The pipeline has five stages. Stages 1–2 are borrowed from the Go ecosystem; stages 3–5 are TinyGo and LLVM.

1. **Parse and type-check.** TinyGo loads packages with `go/types` and the standard `go/packages` machinery. This is the same type system as upstream Go; type errors are reported identically.
2. **Build Go SSA.** `golang.org/x/tools/go/ssa` lowers the typed AST into Go's own SSA form — a register-based IR with explicit `*ssa.Call`, `*ssa.Phi`, `*ssa.Alloc`, `*ssa.MakeInterface`, and so on. This SSA is *Go-semantic*: it still knows about interfaces, maps, channels, goroutines, and `defer`.
3. **Lower to LLVM IR.** TinyGo's `compiler` package walks Go SSA function by function and emits LLVM IR. Go-level constructs are translated into LLVM-level constructs plus calls into the TinyGo runtime: a `*ssa.MakeInterface` becomes a struct of `{typecode, value-pointer}`; a `*ssa.Go` (the `go` statement) becomes a `runtime.scheduleTask` (or asyncify) call; a channel send becomes `runtime.chanSend`; `defer` becomes a per-frame defer-frame linked list.
4. **TinyGo transform passes.** Before handing IR to LLVM's own optimizer, TinyGo runs custom passes (`transform/`): interface lowering (turn dynamic dispatch into switch-on-typecode where the whole-program set of implementers is known), goroutine lowering (asyncify or task-based coroutine transformation), heap-to-stack promotion for escape-free allocations, and func-value lowering. These passes exploit the fact that the *entire program is visible*.
5. **LLVM optimize and codegen.** The IR is run through LLVM's optimization pipeline at the requested `-opt` level, then through an LLVM target backend: a Cortex-M or RISC-V or x86 backend for native machine code, or the WebAssembly backend for `.wasm`.

### What a Go statement becomes

```
go source        : go worker(ch)
Go SSA           : go worker(t0)           ; *ssa.Go
TinyGo lowering  : call runtime.startGoroutine(@worker, %ch)  -- tasks mode
                 : or asyncify-rewritten state machine          -- asyncify mode
LLVM IR          : define internal void @worker(ptr %ch) { ... call @runtime.chanRecv ... }
codegen (wasm)   : (func $worker (param i32) ... call $runtime.chanRecv ...)
```

The crucial property is stage 4: because TinyGo sees the whole program, interface method calls whose concrete-type set is fully known are devirtualized into direct calls or a small `switch`. Standard Go cannot do this — it compiles packages separately and links archives, so dynamic dispatch must remain dynamic. This is the root of both TinyGo's size win and several of its restrictions (you cannot `plugin`-load a new implementer at runtime; the closed-world assumption forbids it).

### Reading the pipeline yourself

`tinygo build -o out.wasm -printir ./...` dumps the LLVM IR. Pairing it with `tinygo build ... -opt=0` (no optimization) versus `-opt=z` (size) shows exactly what the transform and LLVM passes elide. For SSA, point any `go/ssa`-based tool at the source — it is the *same* SSA TinyGo consumes.

---

## Why LLVM Enables Both MCU Codegen and Small Wasm

The reuse of LLVM is not incidental; it is the reason a single project covers a Cortex-M0+ with 16 KB of RAM and a Wasm module on an edge CDN.

- **One IR, many backends.** LLVM has mature, well-tuned backends for ARM Thumb, RISC-V, AVR, Xtensa (ESP32 via the Espressif fork), x86, and WebAssembly. TinyGo emits target-neutral IR plus a target triple and datalayout; LLVM does instruction selection, register allocation, and machine-specific scheduling. Adding a target is largely a matter of LLVM already supporting it plus a TinyGo target JSON (`targets/*.json`) describing the triple, CPU, linker script, and runtime flags.
- **Aggressive whole-program optimization.** `-opt=z` maps to LLVM's size-optimization pipeline (analogous to `-Oz` in Clang): aggressive inlining-then-outlining, dead-code elimination across the entire module, constant folding, and merge of identical functions. Because there is no separate-compilation boundary, DCE reaches everything the program provably never calls — including most of the runtime.
- **LTO by construction.** Standard Go links object archives; TinyGo compiles the whole program into one LLVM module (after `tinygo`'s package-level IR is linked with `llvm.LinkModules`), so link-time optimization is the *default*, not an opt-in. Cross-package inlining and devirtualization fall out for free.
- **Linker scripts and sections for MCUs.** For embedded targets LLVM emits ELF with the section layout the target JSON's linker script expects (`.text` in flash, `.data`/`.bss` in RAM, the vector table at the reset address). CMSIS-style startup and the interrupt vector table are supplied by TinyGo's target support files.

The Wasm and the MCU paths share stages 1–4 entirely. The divergence is only the LLVM target triple (`wasm32-unknown-wasi` / `wasm32-unknown-unknown` versus, say, `thumbv6m-unknown-unknown-eabi`) and the runtime build tags that select the right scheduler, allocator, and entry point.

---

## The Minimal Runtime

TinyGo does not use Go's runtime. It ships its own `runtime` package (in the TinyGo source tree, selected per target via build tags) that reimplements only what the program needs:

- **Memory.** A bump allocator or a conservative GC heap (see below), not Go's size-classed mcache/mcentral/mheap. There is no per-P cache because there are no Ps.
- **Scheduler.** A cooperative single-threaded scheduler (asyncify or tasks), not Go's work-stealing M:N scheduler. There is no OS-thread parallelism on most targets; goroutines are coroutines.
- **Channels, maps, slices, strings, interfaces.** Reimplemented to be small. Maps use a simpler hashmap. Interfaces carry a compact type code rather than a full `*_type` descriptor.
- **`os`, `time`, `sync`.** Partial: enough for the target. On bare metal, `time.Now` reads a hardware timer; on Wasm/WASI it calls a host clock import.

What is *absent* by default is as important as what is present. There is **no reflection metadata** unless the program uses `reflect` in a way that forces it; **no DWARF/type tables** with `-no-debug`; **no goroutine stack-growth machinery** of the upstream kind (TinyGo uses fixed or asyncify-managed stacks). The runtime is small enough — single-digit kilobytes after DCE — that it fits alongside application code on a microcontroller.

Build with `-print-allocs=.` to see which allocations the compiler could not prove stack-safe; on a constrained target, those are exactly the lines to scrutinize.

---

## Scheduler Internals: Asyncify vs Tasks

Goroutines on a single-threaded target are coroutines: the scheduler runs one to a blocking point (channel op, `time.Sleep`, `select`), parks it, and runs another. TinyGo has two implementations of "park and resume," selected by the `scheduler` build option (`-scheduler=asyncify|tasks|none|cores`).

### Tasks scheduler

The **tasks** scheduler gives each goroutine its own stack, allocated from the heap (or a fixed pool). Switching goroutines is a stack switch: save callee-saved registers and the stack pointer of the current goroutine, restore those of the next. This is the classic green-threads approach, implemented in a few lines of per-architecture assembly (`runtime/scheduler_tasks.go` + arch stubs).

- **Pros:** fast context switches; natural blocking semantics; works for native MCU code.
- **Cons:** every goroutine reserves a stack up front (you must size it; overflow corrupts the heap unless a guard is present); needs architecture-specific switch code.

### Asyncify scheduler

The **asyncify** scheduler is a Wasm-specific transformation. Wasm has no way to save and restore a native call stack, so TinyGo (via Binaryen's Asyncify pass, or its own equivalent transform) rewrites each function that can block into a *state machine* that can unwind its locals to a side buffer and rewind them on resume. A blocking call returns up the stack, saving live locals; resuming re-enters and fast-forwards to the saved program point.

- **Pros:** no native stack switching — required on Wasm where you cannot manipulate the call stack directly; one shared stack.
- **Cons:** code-size and runtime overhead — every potentially-blocking function carries unwind/rewind prologue logic; deeply nested blocking paths pay repeatedly.

### Choosing

| Target | Default scheduler | Notes |
|--------|-------------------|-------|
| Wasm (browser, WASI) | `asyncify` | Cannot switch native stacks in Wasm. |
| Cortex-M / RISC-V MCU | `tasks` | Real stacks; cheap switches. |
| Single-goroutine programs | `none` | No scheduler at all; smallest binary. |
| Multi-core (experimental) | `cores` | Maps goroutines to hardware cores. |

`-scheduler=none` is a real production lever: if your firmware is a single `main` loop with no concurrent goroutines and no blocking channel ops, compiling without a scheduler removes the entire coroutine machinery and shrinks the binary. The compiler errors if you then use a construct that requires scheduling, so the choice is checked.

---

## The Three Garbage Collectors

TinyGo ships three GC implementations, chosen with `-gc=conservative|leaking|precise|none`. Each makes a different trade between footprint, fragmentation, and correctness guarantees.

### Conservative (default for most targets)

A **conservative mark-sweep** collector. Allocation is a free-list/bump scan over fixed-size blocks. On collection, it scans the stack, globals, and live heap *conservatively*: any machine word that, interpreted as a pointer, falls inside the heap is treated as a live reference. This avoids needing precise pointer maps (the source of much of Go's metadata), at the cost of occasionally retaining garbage that a non-pointer integer happened to alias.

- Mechanics: blocks are tracked with a metadata bitmap; mark phase walks roots and follows anything pointer-shaped; sweep reclaims unmarked blocks.
- Footprint: small code, modest metadata. Fits MCUs.
- Caveat: conservative scanning means a stray integer can pin memory; on very small heaps this is rarely a practical problem but is worth knowing when chasing a leak.

### Leaking

The **leaking** "GC" never frees. Allocation is a pure bump pointer; `free` is a no-op; there is no collector at all.

- Use when: the program is short-lived (a Wasm request handler that is torn down per invocation, a firmware routine that allocates a bounded amount then runs forever without further allocation).
- Pros: smallest, fastest, zero GC pause, fully deterministic.
- Cons: heap grows monotonically. Unsuitable for long-running allocating loops.

This is genuinely the right choice for many edge-Wasm handlers: the host instantiates a fresh module per request (or resets linear memory), so "never free" is bounded by request lifetime.

### Precise

The **precise** GC uses compiler-emitted pointer maps so the collector knows exactly which words are pointers. It avoids the false-retention of conservative scanning and can move/compact in principle.

- Pros: no conservative over-retention; more accurate liveness.
- Cons: requires the compiler to emit and the runtime to consult pointer maps — more metadata, slightly larger binary.

### None

`-gc=none` forbids heap allocation entirely; any allocation that survives escape analysis is a compile error. The most extreme footprint setting, for the tightest MCU budgets.

| GC | Frees memory | Metadata cost | Pause | Typical use |
|----|--------------|---------------|-------|-------------|
| `conservative` | yes (mark-sweep) | low | stop-the-world, short | general MCU + Wasm |
| `leaking` | never | none | none | per-request Wasm, bounded firmware |
| `precise` | yes (precise mark) | moderate (pointer maps) | stop-the-world | heaps where over-retention matters |
| `none` | n/a (no heap) | none | none | tightest MCU; allocation = compile error |

---

## The ABI and Host Interop

TinyGo's value at the edge and in the browser is determined by how cleanly its functions cross the Wasm boundary. Three mechanisms cover the directions.

### Exporting Go functions to the host: `//go:wasmexport` and `//export`

```go
//go:wasmexport add
func add(a, b int32) int32 { return a + b }
```

`//go:wasmexport name` (the modern, spec-aligned directive) emits a Wasm export named `name` with a signature derived from the Go parameters. The older `//export name` pragma serves the same role for the legacy C-style ABI and is still widely used with `-buildmode=c-shared`-style exports. The host (a JS runtime, `wazero`, Wasmtime, Fastly's runtime) imports the module and calls the export by name.

### Importing host functions into Go: `//go:wasmimport`

```go
//go:wasmimport env log_message
func logMessage(ptr, len uint32)
```

`//go:wasmimport module name` declares a function *provided by the host*. The compiler emits a Wasm import `(import "module" "name" ...)` and every call site becomes a `call` to that import. The host must supply a matching function at instantiation or the module fails to instantiate.

### The calling convention and memory model

The Wasm function-call ABI is limited to the four core numeric types (`i32`, `i64`, `f32`, `f64`). Therefore:

- **Only scalars cross directly.** A Go `int32`/`int64`/`float32`/`float64` maps one-to-one. Pointers are passed as `i32` (a `wasm32` offset into linear memory).
- **Aggregates cross by linear-memory pointer + length.** Strings, slices, and structs are passed as `(ptr, len)` pairs. The host reads them out of the module's single linear-memory buffer. There is one shared address space — `wasm32` linear memory — and both sides agree on offsets.
- **Ownership and lifetime are manual at the boundary.** A pointer handed to the host is only valid while that memory is alive on the Go side (GC choice matters — see leaking GC). Hosts typically copy the bytes out immediately. For host→guest returns, the guest usually exposes a `malloc`-style export so the host can place bytes into guest memory at a guest-owned offset.

This is the same model `01`/`04` describe for `GOOS=js,GOARCH=wasm`, but TinyGo's smaller runtime and absence of the heavy `syscall/js` glue make the boundary cheaper and the module dramatically smaller. The `04-wasm-interop-and-performance` topic quantifies the per-call cost.

### WASI

For `-target=wasi`, TinyGo implements the `wasip1` (a.k.a. `wasi_snapshot_preview1`) imports — `fd_write`, `clock_time_get`, `random_get`, and so on — so `fmt.Println`, `time.Now`, and `crypto/rand` work against a WASI host without browser glue. See [`02-wasi-and-wasip1`](../02-wasi-and-wasip1/) for the syscall surface and its limits.

---

## Binary-Size Internals: What Ships, What Is Stripped

A "hello world" Wasm module is hundreds of kilobytes with `GOOS=js,GOARCH=wasm` and single-digit kilobytes with TinyGo. The difference is structural, not a tweak.

What **ships** in a TinyGo binary:

- The application code, after DCE.
- The reachable subset of the minimal runtime: the chosen scheduler, the chosen GC, and the runtime functions the program actually calls.
- Reachable stdlib functions, compiled from the same minimal runtime's reimplementations.
- Embedded assets (`//go:embed`).

What is **stripped** or never present:

- **Reflection metadata** by default. Upstream Go emits a `*_type` descriptor and method tables for (nearly) every type, because separate compilation cannot prove they are unused. TinyGo, whole-program, emits type information only for types whose `reflect` use it can prove. Programs that lean on broad reflection (some JSON, some ORMs) either pull in metadata or fail to compile.
- **Dead runtime.** Goroutine machinery if `-scheduler=none`; GC if `-gc=none`/`leaking`; most of the runtime's never-called paths via DCE.
- **DWARF debug info** with `-no-debug`. This removes the debugging sections entirely — meaningful on Wasm where they can dominate size, and on flash-constrained MCUs.
- **Per-package symbol bloat.** Whole-program merge of identical functions (LLVM's mergefunc-style pass) collapses duplicates.

The size knobs, in order of impact:

| Flag | Effect |
|------|--------|
| `-opt=z` | LLVM size-optimization pipeline (`-Oz`). Usually the biggest single win. |
| `-no-debug` | Strip DWARF/debug sections. Large on Wasm. |
| `-gc=leaking` / `-gc=none` | Remove the collector. |
| `-scheduler=none` | Remove the goroutine scheduler. |
| `-panic=trap` | Replace formatted panic messages with a bare `unreachable`/trap, dropping the panic-string formatting code. |
| `wasm-opt -Oz` (post-build) | Binaryen pass over the `.wasm`, further shrinking. |

After building Wasm, run it through `twiggy top out.wasm` or `wasm-objdump -x` to attribute bytes to functions and confirm the runtime is as small as expected. `-size=full` makes TinyGo print a per-package size breakdown directly.

---

## The Drivers Ecosystem

`tinygo.org/x/drivers` is the hardware-abstraction layer: a large collection of pure-Go drivers for sensors, displays, radios, and buses, written against TinyGo's `machine` package.

### Internals

- **`machine` package.** Per-target, it exposes the MCU peripherals: GPIO pins (`machine.D13`), `machine.I2C0`, `machine.SPI0`, `machine.UART0`, ADC, PWM. These are thin wrappers over memory-mapped registers; on a Cortex-M they compile down to direct register loads/stores, no syscall, no allocation.
- **Bus abstractions.** Drivers depend only on small interfaces (`drivers.I2C`, `drivers.SPI`) so the same driver works across boards. The interface is satisfied by `machine.I2C0` on real hardware or a fake in tests.
- **Driver structure.** A typical driver (e.g., a BME280 temperature sensor) is a struct holding the bus handle and the device address, with `Configure`, `Read`, and conversion methods that issue register reads over the bus and decode the bytes. No goroutines, no heap allocation in the hot path — by convention drivers are allocation-free so they run under `-gc=none` where needed.
- **Displays and radios.** Display drivers implement `drivers.Displayer` and often a `tinygo.org/x/tinyfont`/`tinydraw` rendering layer; radio drivers (LoRa, BLE, nRF24) wrap the SPI/UART transport plus the protocol state machine.

### Engineering with drivers

The interface-based design is what makes the **host-side simulator and unit tests** work: substitute a software-implemented `I2C` that records register traffic, and you can test driver logic on your laptop with `go test` (not `tinygo test`) at native speed. Reserve `tinygo test` for code that touches `machine` directly or exercises TinyGo-specific runtime behavior.

---

## CI for Embedded and Edge

Embedded/edge CI differs from server CI in one way: the build target is not the CI runner. You cross-compile, then validate either in an emulator or on real hardware.

### Build matrix

Run `tinygo build` across the real target set, not just the host:

```yaml
strategy:
  matrix:
    target: [wasi, wasm, arduino-nano33, pico, xiao-rp2040]
steps:
  - run: tinygo build -o out.bin -target=${{ matrix.target }} ./...
```

A green matrix proves the program compiles for every shipped target — which catches target-specific `machine` API drift and scheduler/GC incompatibilities early.

### Layered testing

- **Native unit tests** (`go test ./...`) for all logic written against interfaces (driver logic, protocol codecs, business logic). Fast, runs on the runner, no TinyGo needed.
- **`tinygo test`** for code exercising TinyGo runtime semantics. On Wasm/WASI targets, TinyGo can run the test binary under a Wasm runtime in CI without hardware.
- **Emulator tests** for firmware: run the ELF under QEMU (`-target` boards QEMU supports) or [`renode`](https://renode.io) for board-level simulation including peripherals.

### Edge (Fastly Compute, wazero)

For edge targets, the artifact is a `.wasm`. CI builds it with `-target=wasi` (or the Fastly Compute SDK target), then runs integration tests by loading the module into a `wazero` host (Go-native, no CGo, ideal for CI) and driving its exports. This validates the exact bytes you will deploy. The deployment side is covered in [`05-wasm-in-production`](../05-wasm-in-production/).

---

## Reproducible Firmware Builds

Firmware reproducibility matters for supply-chain attestation and field debugging (the binary on the bench must be bit-identical to the one in the field). The dimensions to pin:

- **TinyGo version.** TinyGo's compiler and runtime change codegen between releases; pin it (a fixed release tarball or a pinned Docker image such as `tinygo/tinygo:0.31.0`).
- **LLVM version.** TinyGo links a specific LLVM. The official Docker image bundles the matching LLVM; using it is the most reliable pin.
- **Target JSON and linker script.** These live in the TinyGo distribution and are pinned with the TinyGo version.
- **Go module dependencies.** Vendor them or pin via `go.sum`; the `vendor`/hermetic-build discipline from `06-code-organization` applies unchanged.
- **Build flags.** `-opt`, `-gc`, `-scheduler`, `-panic`, `-no-debug` all affect output bytes; record them.

A reproducibility gate, analogous to the standard Go one:

```bash
docker run --rm -v "$PWD:/src" tinygo/tinygo:0.31.0 \
  tinygo build -o /src/build1.bin -target=pico -no-debug ./cmd/fw
docker run --rm -v "$PWD:/src" tinygo/tinygo:0.31.0 \
  tinygo build -o /src/build2.bin -target=pico -no-debug ./cmd/fw
cmp build1.bin build2.bin
```

If they differ, a non-determinism is leaking — commonly an embedded build timestamp, a map-iteration-order-dependent generator, or VCS state. The standard Go `-trimpath` advice applies; `-no-debug` also removes path-bearing debug sections.

---

## Hardware-in-the-Loop Testing

Emulators (QEMU, renode) cover most logic, but real silicon catches timing, analog, and peripheral-quirk bugs an emulator cannot. A hardware-in-the-loop (HIL) rig wires the device under test to the CI system.

- **Topology.** A CI runner (often a Raspberry Pi or a dedicated host) is physically connected to the target board: USB for flashing, plus GPIO/UART/I2C/SPI lines or a logic analyzer for observation. The runner flashes the freshly built firmware and asserts behavior over those lines.
- **Test harness.** The firmware exposes a test mode (e.g., over UART or a debug GPIO) so the host can drive inputs and read outputs. Assertions are ordinary host-side `go test` cases that talk to the serial port.
- **Determinism and reset.** Each test power-cycles or resets the board (via the debug probe's reset line or a controllable power switch) so state does not leak between cases.
- **Renode as a middle tier.** Where physical rigs are scarce, [renode](https://renode.io) simulates the whole board — CPU plus peripherals plus even multi-node networks — and runs the *same* test harness against the simulation, giving HIL-like coverage in pure software for the common path, reserving the physical rig for release gates.

The pyramid: native unit tests (seconds, every push) → emulator/renode tests (minutes, every push) → physical HIL (slower, on merge/release). This keeps fast feedback fast while still touching real hardware before shipping.

---

## Flashing and OTA

### Flashing

`tinygo flash -target=<board> ./...` builds and programs the device in one step. Under the hood it selects a programmer per target:

- **Mass-storage bootloaders** (UF2, used by RP2040/Pico and many SAMD boards): TinyGo produces a `.uf2` and copies it to the board's mounted bootloader drive.
- **DFU** (USB Device Firmware Upgrade): `dfu-util` flashes over USB.
- **Debug probes** (`openocd`, `pyocd`, `bmp`): for SWD/JTAG targets, TinyGo drives the probe to write flash directly. `tinygo flash -programmer=openocd ...` selects it explicitly.
- **Serial bootloaders** (`esptool` for ESP32, `avrdude` for AVR/Arduino).

The right programmer is encoded in the target JSON; override it with `-programmer` when your hardware differs.

### OTA

TinyGo does not provide OTA itself — OTA is an application/bootloader concern. The production pattern:

- A small **bootloader** owns flash layout: it knows two (or more) application slots (A/B) and a metadata region recording which slot is active and valid.
- The application, over its network link (Wi-Fi, LoRa, BLE, cellular), downloads a new image into the *inactive* slot, verifies it (CRC plus a signature — never flash an unauthenticated image), writes the metadata to mark the new slot pending, and resets.
- The bootloader boots the pending slot; the application sets a "confirmed" flag after a successful health check. If it never confirms (a crash loop), the bootloader rolls back to the last-good slot on the next reset.

A/B slotting plus signed images plus a confirm-or-rollback watchdog is the minimum for safe field updates. The image you OTA must be the reproducible, signed artifact from the firmware-build gate above.

---

## Debugging with GDB, OpenOCD, and `tinygo gdb`

On-chip debugging works because TinyGo emits DWARF (when you do *not* pass `-no-debug`) that maps machine instructions back to Go source.

### The stack

- **OpenOCD** (or `pyocd`, or a Black Magic Probe) speaks to the target's debug port (SWD/JTAG) over a hardware probe (ST-Link, CMSIS-DAP, J-Link) and exposes a **GDB remote server** on a TCP port.
- **GDB** (the cross-targeted `gdb-multiarch` / `arm-none-eabi-gdb`) connects to that server, loads the ELF for symbols, and lets you set breakpoints, single-step, inspect Go variables, and read memory-mapped registers.

### `tinygo gdb`

`tinygo gdb -target=<board> ./...` automates the dance: it builds with debug info, launches the configured debug server (OpenOCD/pyocd per the target JSON), and starts GDB already connected to the target with the ELF loaded. You land at a prompt able to `break main.main`, `continue`, `step`, and `print myVar`.

```bash
tinygo gdb -target=pico ./cmd/fw
# (gdb) break main.loop
# (gdb) continue
# (gdb) print sensor.temperature
```

Practical notes:

- **Build with debug info.** Debugging requires DWARF, so do *not* combine debugging with `-no-debug`. Keep a debug build separate from the size-optimized shipping build.
- **`-opt=z` hurts debuggability.** Aggressive inlining and merging make stepping confusing; debug at `-opt=1` or `-opt=0`, then reproduce the bug at the shipping opt level only if it is optimization-dependent.
- **Wasm debugging** is a different toolchain: source maps / DWARF-in-Wasm consumed by browser devtools or a Wasm-aware debugger, not GDB-over-SWD. The on-chip stack above is for MCUs.
- **`tinygo lldb`** is the LLDB-based equivalent where LLDB is the available debugger.

For printf-style debugging on bare metal, `machine.Serial` (the UART that also backs `tinygo monitor`) carries `println` output; `tinygo monitor` opens the serial console after flashing.

---

## Edge Cases and Divergences from Standard Go

TinyGo is Go-the-language, but the whole-program LLVM model and minimal runtime create real divergences a professional must anticipate:

- **Reflection is limited.** Whole-program compilation means broad runtime reflection — especially anything that enumerates all types or builds values from arbitrary `reflect.Type` — may not be supported or may bloat the binary. Encoding libraries that lean on reflection (`encoding/json` for arbitrary types) work in many cases but not all; test against your actual types.
- **Goroutine scheduling is cooperative.** With asyncify/tasks on a single thread, a tight CPU loop that never hits a blocking point will *not* yield. There is no preemptive scheduler on most targets. Insert yield points or restructure hot loops.
- **`cgo` support is restricted.** Cross-compiling to an MCU with CGo is constrained; many programs avoid CGo entirely. Wasm/WASI generally cannot use arbitrary CGo.
- **Some `unsafe` patterns differ.** Pointer-shape assumptions that hold under conservative GC may behave differently than under upstream Go's precise GC.
- **Stack sizes are fixed (tasks).** A goroutine stack overflow under the tasks scheduler corrupts memory unless a guard catches it; size goroutine stacks deliberately on constrained targets.
- **Not all of the standard library is present.** The reimplemented stdlib covers a large, growing subset; check the support matrix on tinygo.org rather than assuming a package is available.
- **Maps and goroutine behavior have subtle differences** from the `gc` runtime; do not depend on `gc`-specific timing or iteration quirks.

These are not bugs; they are the cost of fitting Go into kilobytes and into Wasm. The discipline is: write logic against interfaces, test it natively under `gc` Go, and reserve `tinygo`-specific testing for the runtime-touching layer.

---

## Operational Playbook

| Scenario | Recipe |
|----------|--------|
| Smallest possible Wasm module | `-opt=z -no-debug -gc=leaking -scheduler=asyncify -panic=trap`, then `wasm-opt -Oz`. |
| Smallest possible MCU firmware | `-opt=z -no-debug -gc=none -scheduler=none` (if single-goroutine, no heap). |
| Attribute Wasm bytes to functions | `twiggy top out.wasm` or `tinygo build -size=full`. |
| Inspect the IR a function lowers to | `tinygo build -printir -opt=z ./...`. |
| Export a function to a Wasm host | `//go:wasmexport name` above the func. |
| Import a host function | `//go:wasmimport module name` on the func declaration. |
| Pass a string/slice to the host | Pass `(ptr, len)` into linear memory; host reads from the module's memory. |
| Run firmware tests without hardware | QEMU or renode in CI against the built ELF. |
| Run Wasm tests in CI | Load the `.wasm` into `wazero` and drive its exports. |
| Reproducible firmware build | Pin TinyGo+LLVM via the official Docker image; build twice; `cmp`. |
| Debug on-chip | `tinygo gdb -target=<board> ./...` (build *with* debug info). |
| Flash a board | `tinygo flash -target=<board> ./...`; `-programmer=openocd` to override. |
| Serial console after flash | `tinygo monitor`. |
| Safe field update | A/B slots + signed image + confirm-or-rollback bootloader. |
| Find allocations the GC must manage | `tinygo build -print-allocs=. ./...`. |

---

## Summary

TinyGo is a second Go compiler that shares Go's front end and SSA, then lowers to LLVM IR and lets LLVM produce either microcontroller machine code or small WebAssembly. Every distinctive trait flows from that whole-program, LLVM-based design: devirtualization and aggressive dead-code elimination that shrink binaries to kilobytes, a minimal hand-written runtime with a cooperative scheduler (asyncify on Wasm, real-stack tasks on MCUs) and a choice of conservative, leaking, precise, or no garbage collector, and a Wasm ABI built on scalars-plus-linear-memory with `//go:wasmimport`/`//go:wasmexport`/`//export` as the host-interop surface.

The professional skill set is twofold. First, *understand the pipeline well enough to choose its knobs deliberately*: which scheduler, which GC, which optimization level, and what each costs in size, speed, and determinism — and why reflection, preemption, and parts of the stdlib are absent. Second, *operate it in production*: cross-compiled CI matrices, native-first layered testing with emulator and hardware-in-the-loop gates, reproducible firmware via pinned TinyGo+LLVM, safe A/B signed OTA, and on-chip debugging through OpenOCD and `tinygo gdb`.

Treat TinyGo as what it is — an LLVM compiler with a Go front end — and its restrictions stop being surprises and become predictable consequences you design around.

---

## Further Reading

- TinyGo documentation — https://tinygo.org/docs/
- `tinygo.org/x/drivers` — driver ecosystem source and device list.
- Sibling topics: [`01-goos-js-wasm-browser`](../01-goos-js-wasm-browser/), [`02-wasi-and-wasip1`](../02-wasi-and-wasip1/), [`04-wasm-interop-and-performance`](../04-wasm-interop-and-performance/), [`05-wasm-in-production`](../05-wasm-in-production/).
