# TinyGo for Wasm & Embedded — Specification

## Table of Contents
1. [Introduction](#introduction)
2. [Where TinyGo Is Specified](#where-tinygo-is-specified)
3. [Relationship to the `gc` Toolchain](#relationship-to-the-gc-toolchain)
4. [Command Reference](#command-reference)
5. [Target Taxonomy](#target-taxonomy)
6. [Flag Reference](#flag-reference)
7. [The Garbage-Collector / Scheduler Matrix](#the-garbage-collector--scheduler-matrix)
8. [Standard-Library and Language Support Divergences](#standard-library-and-language-support-divergences)
9. [The `tinygo` Build Tag](#the-tinygo-build-tag)
10. [WebAssembly Specifics: `wasm_exec.js`](#webassembly-specifics-wasm_execjs)
11. [Version History and Maturity](#version-history-and-maturity)
12. [References](#references)

---

## Introduction

TinyGo is a **second, independent Go compiler** built on the LLVM toolchain. It targets environments the upstream `gc` compiler does not serve well: small WebAssembly binaries, WASI-based edge runtimes, and bare-metal microcontrollers. It is not a fork of `gc`; it parses Go source, reuses the upstream `go/types` and `go/ssa` analysis stack, then lowers to LLVM IR and emits machine code or Wasm through LLVM and `lld`.

TinyGo implements the Go *language* but only a curated subset of the Go *standard library and runtime*. The trade is deliberate: binaries that are orders of magnitude smaller (kilobytes, not megabytes) and that run on devices with kilobytes of RAM, at the cost of features that require a heavy runtime — full reflection, OS-level parallelism, and the complete `os`/`net` surface.

This file is a formal reference for the command set, the target taxonomy, the flag surface, the GC/scheduler combinations, and the precise divergences from `gc`. It does not teach embedded programming; it states what the tool guarantees.

---

## Where TinyGo Is Specified

TinyGo has no language specification of its own — the language it accepts is the **Go language specification** (`go.dev/ref/spec`). What is TinyGo-specific is the *implementation contract*: which targets exist, which flags are valid, and which packages are supported. The authoritative sources, in decreasing formality:

1. **TinyGo Reference documentation** — `tinygo.org/docs/reference/`, in particular the *command reference*, *build flags*, and *language support* (the standard-library support matrix).
2. **`tinygo help`** and **`tinygo help <command>`** — terse, command-line oriented.
3. **`tinygo targets`, `tinygo info <target>`, `tinygo env`** — machine-introspectable truth about installed targets and configuration.
4. **Toolchain source** — `github.com/tinygo-org/tinygo`, notably `targets/*.json` (the target definitions) and `compileopts/` (the option parser).

Where the reference is silent, `tinygo info <target>` and the target JSON are the de-facto specification for a given release.

---

## Relationship to the `gc` Toolchain

TinyGo and `gc` accept the same language but differ in runtime semantics. The differences below are not bugs; they are the design.

| Aspect | `gc` (upstream) | TinyGo |
|--------|-----------------|--------|
| Backend | Custom SSA + native codegen | LLVM IR → `lld` |
| Concurrency | OS threads, real parallelism, `GOMAXPROCS` | Cooperative scheduler; **no parallelism**; goroutines multiplexed on one logical thread |
| Garbage collector | Concurrent mark-sweep | Selectable: conservative / precise / leaking (section 7) |
| Reflection | Full `reflect` | Partial `reflect` (section 8) |
| cgo | Full support | Limited; supported on some targets, unavailable on most MCUs |
| Binary size | Megabytes | Kilobytes |
| Build tag | `gc` (via `compiler` tag space) | `tinygo` is set (section 9) |

The single most consequential divergence is concurrency: TinyGo's scheduler is cooperative and single-threaded, so code that relies on goroutines running *simultaneously* on multiple cores will not behave as it does under `gc`.

---

## Command Reference

The TinyGo CLI mirrors the `go` command's verbs where it can. Each command takes a package path or `.go` file and most accept the build flags in section 6.

| Command | Purpose |
|---------|---------|
| `tinygo build` | Compile a package to an output file (`-o`). The primary command; produces `.wasm`, `.elf`, `.hex`, `.bin`, `.uf2`, etc., depending on `-o` extension and target. |
| `tinygo flash` | Build, then write the firmware to a connected board and reset it. Selects the programmer from the target definition (e.g. OpenOCD, `bossac`, mass-storage UF2). |
| `tinygo run` | Build and run. For Wasm/WASI targets, runs in a bundled runtime; for native, runs locally; for some boards, flashes and streams output. |
| `tinygo test` | Compile and run a package's tests on the target (or in an emulator/the host where supported). |
| `tinygo gdb` | Build with debug info, flash, and attach a GDB session (via the target's debug adapter, typically OpenOCD). |
| `tinygo monitor` | Open a serial monitor on the board's port; reads program output over UART/USB-CDC. |
| `tinygo targets` | List every available target name (the values valid for `-target`). |
| `tinygo info <target>` | Print the resolved configuration for a target: CPU, features, default GC, default scheduler, build tags, linker, emulator. |
| `tinygo env` | Print TinyGo environment variables (`TINYGOROOT`, `GOROOT`, `GOOS`, `GOARCH`, etc.), analogous to `go env`. |
| `tinygo version` | Print the TinyGo version and the underlying Go and LLVM versions. |
| `tinygo clean` | Remove the build cache. |

---

## Target Taxonomy

A **target** is a named bundle (a `.json` definition plus inherited bases) describing CPU, triple, features, default GC, default scheduler, libc, linker, and post-link tooling. `tinygo targets` enumerates them. The taxonomy splits into three families.

### WebAssembly targets

| Target | Runtime | Notes |
|--------|---------|-------|
| `wasm` | Browser | Requires the matching **`wasm_exec.js`** glue (section 10). Imports host functions for DOM/JS interop via `syscall/js`. |
| `wasi` / `wasip1` | Server / edge (WASI Preview 1) | Self-contained module using WASI system calls; runs under `wasmtime`, `wasmer`, Wasmer Edge, Fastly, Spin, etc. No `wasm_exec.js`. `wasip1` is the explicit name; `wasi` is the conventional alias. |
| `wasm-unknown` | Freestanding | Minimal Wasm with no host imports beyond what you declare; for fully custom embeddings. |

WebAssembly targets are covered in depth by siblings **01-goos-js-wasm-browser** (the `js/wasm` GOOS/GOARCH path under `gc`) and **02-wasi-and-wasip1**. TinyGo is the alternative compiler for both.

### Embedded (bare-metal microcontroller) targets

These produce firmware that runs with no operating system. A non-exhaustive list (run `tinygo targets` for the installed set):

- **Arduino family** — `arduino` (Uno, AVR), `arduino-nano33` (SAMD21 + nRF), `arduino-mega2560`.
- **Raspberry Pi** — `pico` (RP2040), `pico2` (RP2350).
- **BBC** — `microbit`, `microbit-v2`.
- **Espressif** — `esp32`, `esp32c3` (RISC-V), `esp8266`.
- **Nordic** — `nrf52840`, `nrf51`.
- **STMicroelectronics** — `stm32` boards such as `bluepill`, `nucleo-f103rb`, `stm32f4disco`.

Each embedded target maps to an LLVM triple (`armv6m`, `riscv32`, `avr`, etc.) and carries board-specific machine-package pin maps.

### Native targets

TinyGo can also compile for the host OS (`linux/amd64`, `darwin/arm64`, …) primarily as a fast path for testing and for producing small native binaries. This is the least-emphasised family; for production native Go, `gc` remains the right tool.

---

## Flag Reference

The flags below apply to `tinygo build`, `tinygo flash`, `tinygo run`, and `tinygo test` unless noted. Defaults are target-dependent; `tinygo info <target>` reports the effective defaults.

| Flag | Valid values | Default | Meaning |
|------|--------------|---------|---------|
| `-target` | any name from `tinygo targets`; or a path to a target `.json` | host | Selects the target. Omitting it builds for the host. |
| `-o` | path | required for `build` | Output file. Extension drives the post-link format (`.wasm`, `.hex`, `.bin`, `.uf2`, `.elf`). |
| `-gc` | `conservative`, `precise`, `leaking`, `none` | `conservative` | Garbage-collector strategy (section 7). |
| `-scheduler` | `none`, `tasks`, `asyncify` | target-dependent | Goroutine scheduler strategy (section 7). |
| `-opt` | `0`, `1`, `2`, `s`, `z` | `z` | LLVM optimisation level. `z` = minimise size (the embedded default); `s` = size with less aggression; `0`–`2` = speed tiers. |
| `-no-debug` | (boolean) | off | Strip DWARF debug info; reduces binary size. |
| `-panic` | `print`, `trap` | `print` | Panic strategy. `print` emits a message then aborts; `trap` issues a trap/`unreachable` with no message (smaller). |
| `-stack-size` | size (e.g. `2048`, `8kb`) | target-dependent | Goroutine stack size. Critical on MCUs where RAM is scarce. |
| `-print-allocs` | a regexp of package paths | off | Print heap allocations matching the pattern, with source locations — escape-analysis diagnostics. |
| `-tags` | space/comma-separated build tags | none | Additional build constraints, like `go build -tags`. |
| `-ldflags` | linker flag string | none | Passed through to the linker (e.g. `-X` for `var` injection). |
| `-serial` | `none`, `uart`, `usb` | target-dependent | Which serial implementation `machine.Serial` maps to. |
| `-monitor` | (boolean) | off | After `flash`/`run`, open the serial monitor automatically. |
| `-size` | `none`, `short`, `full` | `none` | Print binary section sizes (code/data/bss) after build. |

`-gc`, `-scheduler`, `-opt`, and `-panic` are the four knobs that dominate binary size and runtime behaviour; the rest are situational.

---

## The Garbage-Collector / Scheduler Matrix

TinyGo decouples memory management from concurrency. Both are compile-time choices.

### Garbage collectors (`-gc`)

| Value | Behaviour | Use when |
|-------|-----------|----------|
| `conservative` | Mark-sweep GC that scans the stack/globals conservatively (any word that *looks* like a pointer is treated as one). The default. | General use; correct without precise type info. |
| `precise` | Mark-sweep GC using exact pointer maps. Fewer false retentions than conservative. | When you want tighter memory behaviour and the target supports it. |
| `leaking` | A bump allocator that **never frees**. Smallest, fastest allocation; memory grows until reset. | Short-lived programs, deterministic workloads, or extreme size constraints. |
| `none` | No allocator at all; any heap allocation is a link/compile error. | Code provably allocation-free. |

### Schedulers (`-scheduler`)

| Value | Behaviour | Concurrency available |
|-------|-----------|----------------------|
| `none` | No scheduler. `go` statements, channels, and blocking ops are unsupported (link error if used). Smallest output. | None |
| `tasks` | Stackful cooperative scheduler using separate goroutine stacks; context switches at blocking points. | Goroutines, channels, `select` — cooperatively, single-threaded |
| `asyncify` | LLVM `asyncify`-based coroutine transform; suspends/resumes without separate native stacks. The default for **Wasm** targets, where stack switching is otherwise hard. | Same surface as `tasks`, single-threaded |

**Invariant across all schedulers:** there is no preemption and no multi-core parallelism. `GOMAXPROCS` has no parallel effect. A goroutine that never blocks (e.g. a tight loop with no channel/IO op) can starve all others.

The effective default pair is target-driven — e.g. Wasm defaults to `conservative` + `asyncify`; many MCUs default to `conservative` + `tasks`. Confirm with `tinygo info <target>`.

---

## Standard-Library and Language Support Divergences

TinyGo supports a large subset of the standard library, but the gaps are load-bearing. The authoritative, version-specific matrix is at `tinygo.org/docs/reference/lang-support`. The categories that bite in practice:

- **`reflect` is partial.** Core reflection works, but not the whole surface. Downstream consequences:
  - `encoding/json` works for many types but can fail or mis-handle types that depend on unsupported reflection paths.
  - `fmt` verbs that rely on deep reflection (e.g. `%+v`/`%#v` on complex nested types, some interface introspection) may render incompletely.
  - Any library leaning on `reflect.Value.Call`, struct-tag-driven generic machinery, or dynamic type construction is at risk.

- **No goroutine parallelism.** As stated in section 7, the scheduler is cooperative and single-threaded. `sync` primitives exist but never guard against *parallel* access because there is none; `GOMAXPROCS` does not create parallelism.

- **cgo is limited.** Supported on some targets, absent on most microcontrollers. Do not assume cgo-dependent packages compile.

- **`os` and the filesystem are limited or absent.** On MCUs there is no OS, so `os.Open`, the filesystem, processes, and signals are unavailable or stubbed. On WASI, a subset is provided through WASI calls.

- **`net` is partial.** Networking depends entirely on the target. Edge/WASI and certain boards provide some support; bare-metal MCUs generally do not have the full `net` package.

- **Other commonly affected packages.** `os/exec`, `plugin`, `runtime` internals (no `runtime.GOMAXPROCS` parallel effect, partial `runtime` introspection), and parts of `text/template`/`html/template` (reflection-heavy) may be unsupported or partial.

The rule of thumb: anything that needs an OS, real threads, or deep reflection is the part most likely to be missing. Always consult the support matrix for the exact release before committing to a dependency.

---

## The `tinygo` Build Tag

When TinyGo compiles, the build constraint **`tinygo` is set** (in addition to the usual `GOOS`/`GOARCH` and a `gc`-compatible compiler tag space). This lets code adapt at build time without runtime detection.

```go
//go:build tinygo
// ... TinyGo-specific implementation (avoids unsupported reflect, etc.)
```

```go
//go:build !tinygo
// ... full-gc implementation
```

Libraries that want to support both compilers use this tag to provide a reduced code path under TinyGo — for example substituting a hand-written encoder where `encoding/json`'s reflection path would be unsupported. Conversely, `//go:build !tinygo` guards code that must only build under `gc`.

TinyGo also sets target-specific tags (board names, CPU/architecture tags); `tinygo info <target>` lists the full tag set applied for a given target.

---

## WebAssembly Specifics: `wasm_exec.js`

The browser `wasm` target requires a JavaScript glue file, `wasm_exec.js`, that instantiates the module and implements the host functions the runtime imports (memory growth, `syscall/js` interop, time, randomness).

**Critical constraint:** TinyGo ships its **own** `wasm_exec.js`, and it is **version-matched** to the TinyGo release that produced the `.wasm`. It is *not* interchangeable with the `wasm_exec.js` from the standard `gc` toolchain (`$(go env GOROOT)/lib/wasm/wasm_exec.js`), nor across mismatched TinyGo versions. Mixing them produces import-mismatch or runtime failures at instantiation.

Locate the correct file via `tinygo env TINYGOROOT` (it lives under `targets/` in the TinyGo installation). The `wasi`/`wasip1` targets need no such glue — they are self-contained WASI modules and run directly under a WASI host. The interop and performance characteristics of these modules are the subject of sibling **04-wasm-interop-and-performance**, and production deployment of Wasm builds is covered in **05-wasm-in-production**.

---

## Version History and Maturity

TinyGo is a mature, actively maintained project (originating in 2018) but moves independently of the upstream Go release cycle, and its support matrix expands release to release. Notable trajectory:

- **Early releases** established the LLVM backend, the cooperative scheduler, and the first microcontroller targets.
- **Wasm and WASI support** matured into first-class targets, with `asyncify` enabling goroutines in the browser and `wasip1` aligning with the standardised WASI Preview 1 name.
- **The GC and scheduler matrix** (conservative/precise/leaking/none; none/tasks/asyncify) was generalised so memory and concurrency strategies became orthogonal compile-time choices.
- **The supported-package matrix** has grown steadily — more of `crypto`, `encoding`, and `sync` works now than in early versions — but the structural gaps (full `reflect`, OS parallelism, complete `os`/`net`) remain by design.
- **Language coverage** tracks the Go language closely, including generics, while pacing slightly behind the very latest `gc` language additions.

Because the exact supported set is release-specific, treat `tinygo version` (which also reports the bundled Go and LLVM versions) plus `tinygo.org/docs/reference/lang-support` as the source of truth for any given build. Do not rely on a feature being present without checking the matrix for your installed version.

---

## References

- [TinyGo Reference documentation](https://tinygo.org/docs/reference/) — authoritative.
- [Build flags reference](https://tinygo.org/docs/reference/usage/) — command and flag surface.
- [Language support matrix](https://tinygo.org/docs/reference/lang-support/) — supported packages and language features.
- [Microcontrollers / supported boards](https://tinygo.org/docs/reference/microcontrollers/) — target list and pin maps.
- [WebAssembly with TinyGo](https://tinygo.org/docs/guides/webassembly/) — `wasm`/`wasi` usage and `wasm_exec.js`.
- [TinyGo source](https://github.com/tinygo-org/tinygo) — `targets/*.json`, `compileopts/`.
- [Go language specification](https://go.dev/ref/spec) — the language TinyGo accepts.
- Related: `01-goos-js-wasm-browser`, `02-wasi-and-wasip1`, `04-wasm-interop-and-performance`, `05-wasm-in-production`.
