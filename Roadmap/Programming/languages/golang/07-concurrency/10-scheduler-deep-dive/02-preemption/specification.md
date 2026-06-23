# Goroutine Preemption — Specification

## Table of Contents
1. [Scope](#scope)
2. [Authoritative References](#authoritative-references)
3. [Definitions](#definitions)
4. [Runtime Guarantees](#runtime-guarantees)
5. [Compiler Contracts](#compiler-contracts)
6. [Signal Discipline](#signal-discipline)
7. [Platform Matrix](#platform-matrix)
8. [`GODEBUG` Flags](#godebug-flags)
9. [Runtime Source Files](#runtime-source-files)
10. [Compatibility Notes](#compatibility-notes)

---

## Scope

This document specifies the contract between Go user code, the Go compiler, and the Go runtime regarding **goroutine preemption**. It covers Go 1.14 and later. Behaviour in Go 1.13 and earlier (cooperative-only) is described where relevant for comparison.

This is a *practical* specification: it documents the runtime as built, not a language-level guarantee enshrined in the Go specification. The Go language specification (https://go.dev/ref/spec) does not mention preemption. The runtime makes the guarantees described here.

---

## Authoritative References

- **Proposal #24543** — *Non-cooperative goroutine preemption*, Austin Clements, 2018. The design document for async preemption. https://github.com/golang/go/issues/24543
- **CL 201760** — the initial implementation, merged for Go 1.14.
- **Go 1.14 release notes** — user-facing announcement.
- **Runtime source** — `src/runtime/preempt.go`, `src/runtime/preempt_*.s`, `src/runtime/proc.go`, `src/runtime/signal_unix.go`.
- **`go tool compile -d=ssa/check/on`** — for inspecting compiler decisions about safe-points.

---

## Definitions

| Term | Definition |
|---|---|
| **Goroutine (G)** | An independently scheduled unit of execution as defined by the Go runtime. |
| **M** | An OS thread, managed by the runtime. |
| **P** | A logical processor; the runtime's unit of execution context for goroutines. |
| **Preemption** | The act of removing a running G from its P, returning it to a run queue or parking it. |
| **Cooperative preemption** | Preemption triggered by a compiler-inserted check at function prologue, dependent on the goroutine reaching that prologue. |
| **Asynchronous preemption** | Preemption triggered by an OS signal (Unix) or thread-suspension API (Windows), independent of the goroutine's instruction stream. |
| **Safe-point** | A program counter at which the runtime has full type information for all live values and can stop the goroutine safely. |
| **`stackPreempt`** | The magic value `0xfffffade` (32-bit) or `0xfffffffffffffade` (64-bit) the runtime stores in `g.stackguard0` to force preemption. |
| **`SIGURG`** | The signal used on Unix systems for async preemption. |

---

## Runtime Guarantees

### G1. Eventual preemption

If a goroutine has been running on a P for more than approximately 10 milliseconds and the runtime requests its preemption, the goroutine will reach a safe-point and yield in bounded time.

Bound: the longest legitimately unsafe region the goroutine traverses, typically tens of microseconds.

### G2. Cooperative preemption fires at function prologues

For any non-`//go:nosplit` Go function, the compiled prologue includes a stack-bound check that the runtime can repurpose for preemption.

### G3. Async preemption is enabled by default on supported platforms

When `GODEBUG=asyncpreemptoff=0` (the default) and the platform supports async preemption, the runtime will use it.

### G4. Preemption preserves the user-visible state of the goroutine

After a preemption fires and the goroutine resumes, all general-purpose registers, floating-point registers, status flags, and stack contents are identical to their values at the moment of preemption. The user code observes preemption only through wall-clock latency.

### G5. Preemption is not delivered during write barriers, atomic intrinsics, or runtime critical sections

The runtime guarantees that no async preemption interrupts a PC the compiler has marked as not-async-safe.

### G6. Cgo calls are not preemptible

A goroutine that has entered a cgo call cannot be preempted until it returns to Go.

### G7. `runtime.Gosched` yields synchronously

A call to `runtime.Gosched` returns only after the calling goroutine has been re-scheduled, which may be after other goroutines have run.

### G8. `runtime.Goexit` runs deferred functions

A call to `runtime.Goexit` causes the calling goroutine to terminate. All currently registered `defer`red functions for that goroutine run before termination.

### G9. `LockOSThread` does not prevent preemption

A goroutine bound to a thread via `runtime.LockOSThread` may still be preempted. After preemption, it will resume on the same M.

---

## Compiler Contracts

### C1. Prologue check

The compiler emits, at the entry of every non-`//go:nosplit` function, an instruction sequence equivalent to:

```
load g.stackguard0 into a register
compare against the proposed new SP
branch to morestack if too small
```

### C2. PCDATA tables

The compiler emits, for every function, the following PC-indexed tables:

- `PCDATA_StackMapIndex`
- `PCDATA_InlTreeIndex`
- `PCDATA_UnsafePoint`

### C3. Marking unsafe points

Write barriers, atomic CAS retry sequences, and inlined runtime helpers emit `PCDATA_UnsafePoint` markers around their unsafe regions.

### C4. `//go:nosplit`

A function annotated `//go:nosplit` has no prologue stack-bound check. Such functions are also reachable from the signal handler and other contexts where calling `morestack` is forbidden. Use is restricted to runtime code and a few low-level user libraries; the Go vet tool flags abuse.

### C5. `//go:nowritebarrier` and `//go:nowritebarrierrec`

These directives instruct the compiler to error if the function would emit a write barrier. They are independent of preemption but related: code marked `nowritebarrier` is, by extension, async-safe everywhere.

---

## Signal Discipline

### S1. Reserved signal: `SIGURG`

The runtime claims `SIGURG` for async preemption. User programs may still observe `SIGURG` via `os/signal.Notify`, but the runtime processes it first.

### S2. Signal masks

The runtime ensures `SIGURG` is unblocked on every M it creates. Programs that mask `SIGURG` via `pthread_sigmask` or equivalent will disable async preemption on the masking thread.

### S3. Signal handlers

User code that calls `signal.Notify(c, syscall.SIGURG)` does *not* prevent the runtime from receiving the signal; the runtime's handler runs first. The signal is then forwarded to the user channel.

### S4. Reentrancy

The signal handler is itself non-preemptible. The handler runs `nosplit` code and does not allocate.

### S5. Signal stack

On Unix, the runtime installs a signal stack via `sigaltstack(2)` for each M. The handler runs on this stack rather than the goroutine's user stack.

---

## Platform Matrix

| GOOS | GOARCH | Async preemption | Mechanism |
|---|---|---|---|
| linux | amd64 | Yes | `SIGURG` via `tgkill(2)` |
| linux | arm64 | Yes | `SIGURG` via `tgkill(2)` |
| linux | 386 | Yes | `SIGURG` via `tgkill(2)` |
| linux | arm | Yes | `SIGURG` via `tgkill(2)` |
| linux | ppc64 | Yes | `SIGURG` via `tgkill(2)` |
| linux | riscv64 | Yes | `SIGURG` via `tgkill(2)` |
| linux | s390x | Yes | `SIGURG` via `tgkill(2)` |
| linux | mips64 | Yes | `SIGURG` via `tgkill(2)` |
| darwin | amd64 | Yes | `SIGURG` |
| darwin | arm64 | Yes | `SIGURG` |
| freebsd | amd64 | Yes | `SIGURG` |
| netbsd | amd64 | Yes | `SIGURG` |
| openbsd | amd64 | Yes | `SIGURG` |
| windows | amd64 | Yes | `SuspendThread`/`SetThreadContext` |
| windows | arm64 | Yes | `SuspendThread`/`SetThreadContext` |
| windows | 386 | Yes | `SuspendThread`/`SetThreadContext` |
| plan9 | * | No | Cooperative only |
| solaris | amd64 | Yes | `SIGURG` |
| aix | ppc64 | Limited | varies |
| wasip1 / js | wasm | No | Cooperative only |

On platforms without async preemption, cooperative preemption is the sole mechanism. Tight loops without function calls will not be preempted on such platforms — exactly as in pre-1.14 Go.

---

## `GODEBUG` Flags

| Flag | Effect |
|---|---|
| `asyncpreemptoff=1` | Disables async preemption. Cooperative preemption still works. For debugging only. |
| `schedtrace=N` | Every `N` ms, prints a one-line scheduler summary to stderr. |
| `scheddetail=1` | When combined with `schedtrace`, prints per-G and per-M detail. |
| `gctrace=1` | Prints GC events including STW start/end, indirectly observing preemption latency. |

`GODEBUG` is parsed at program start. Changes via `os.Setenv` after start have no effect on the runtime.

---

## Runtime Source Files

| File | Contents |
|---|---|
| `src/runtime/preempt.go` | `isAsyncSafePoint`, `asyncPreempt2`, the user-facing Go side of async preemption. |
| `src/runtime/preempt_*.s` | Per-architecture `asyncPreempt` assembly trampoline. |
| `src/runtime/proc.go` | `preemptone`, `preemptall`, `sysmon`, `retake`, `goschedImpl`, `gopreempt_m`. |
| `src/runtime/signal_unix.go` | Signal dispatch, `doSigPreempt`, `sigPreempt`, `preemptM` (Unix). |
| `src/runtime/signal_*.go` | Per-architecture `pushCall` and `sigctxt`. |
| `src/runtime/os_linux.go` | `signalM` -> `tgkill`. |
| `src/runtime/os_*.go` | Equivalent for other OSes. |
| `src/runtime/preempt_windows.go` | Windows-specific `preemptM` via `SuspendThread`. |
| `src/runtime/stack.go` | `newstack` — the cooperative path's bridge between morestack and `gopreempt_m`. |
| `src/runtime/asm_*.s` | `morestack` per architecture. |
| `src/cmd/compile/internal/ssa/...` | Compiler logic that emits `PCDATA_UnsafePoint`. |

---

## Compatibility Notes

### Backward compatibility

Programs that worked under Go 1.13's cooperative-only preemption continue to work under Go 1.14+. The async path is additive: anything that was preemptible before is still preemptible; many things that were *not* preemptible before now are.

### Forward compatibility

The runtime contract above is stable in spirit. Specific magic numbers (10 ms tick, `stackPreempt` value), file names, and function names may change between minor versions. User code must not depend on them.

### Behaviour the spec does NOT promise

- **Exact preemption latency.** The 10 ms tick is an implementation detail.
- **Order of preemption when multiple goroutines exceed the threshold simultaneously.**
- **Whether a specific PC will be considered async-safe.** This depends on compiler optimisations and may change.
- **The set of signals used by the runtime.** A future Go could switch from `SIGURG` to something else.

User code should treat preemption as a black box: "eventually fair, eventually responsive." Anything more specific is implementation-dependent and brittle.

---

## End of Specification
