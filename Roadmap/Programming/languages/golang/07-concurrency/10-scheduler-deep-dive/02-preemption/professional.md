# Goroutine Preemption — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [The `asyncPreempt` Trampoline — amd64](#the-asyncpreempt-trampoline--amd64)
3. [The `asyncPreempt` Trampoline — arm64](#the-asyncpreempt-trampoline--arm64)
4. [The `asyncPreempt` Trampoline — riscv64](#the-asyncpreempt-trampoline--riscv64)
5. [Signal Handler Internals — Linux/amd64](#signal-handler-internals--linuxamd64)
6. [Windows Implementation: SuspendThread/SetThreadContext](#windows-implementation-suspendthreadsetthreadcontext)
7. [The Compiler's pcdata Tables](#the-compilers-pcdata-tables)
8. [Why `SIGURG`: A Compatibility Argument](#why-sigurg-a-compatibility-argument)
9. [Race Detector and Preemption](#race-detector-and-preemption)
10. [Performance Budget of an Async Preemption](#performance-budget-of-an-async-preemption)
11. [Reading the Runtime Source Map](#reading-the-runtime-source-map)
12. [Summary](#summary)

---

## Introduction

The professional level pulls back the curtain on the trampoline itself. You will read the per-architecture assembly stubs that implement async preemption, follow the signal handler line by line on Linux/amd64, and survey the Windows analogue. The goal is to be able to *patch* the runtime — or at least debug it — when async preemption misbehaves.

References are to Go 1.22 source. Line numbers drift; the file names and function names are stable.

---

## The `asyncPreempt` Trampoline — amd64

File: `src/runtime/preempt_amd64.s`.

```
// asyncPreempt saves all user registers and calls asyncPreempt2.
// When asyncPreempt2 returns the registers will be restored.
//
// The signal handler must arrange for this function to be run as if
// the interrupted thread had made a "call" to asyncPreempt.
TEXT ·asyncPreempt(SB),NOSPLIT|NOFRAME,$0-0
    PUSHQ BP
    MOVQ  SP, BP
    // Save flags before clobbering them
    PUSHFQ
    // obj doesn't understand ADD/SUB on SP, but does understand ADJSP
    ADJSP $368
    // But vet doesn't know ADJSP, so suppress vet stack checking
    NOP   SP
    MOVQ  AX, 0(SP)
    MOVQ  CX, 8(SP)
    MOVQ  DX, 16(SP)
    MOVQ  BX, 24(SP)
    MOVQ  SI, 32(SP)
    MOVQ  DI, 40(SP)
    MOVQ  R8, 48(SP)
    MOVQ  R9, 56(SP)
    MOVQ  R10, 64(SP)
    MOVQ  R11, 72(SP)
    MOVQ  R12, 80(SP)
    MOVQ  R13, 88(SP)
    MOVQ  R14, 96(SP)
    MOVQ  R15, 104(SP)
    #ifdef GOOS_darwin
    #ifdef GOARCH_amd64
        CMPB internal∕cpu·X86+const_offsetX86HasAVX(SB), $0
        JE   2(PC)
        VZEROUPPER
    #endif
    #endif
    MOVUPS X0, 112(SP)
    MOVUPS X1, 128(SP)
    MOVUPS X2, 144(SP)
    MOVUPS X3, 160(SP)
    MOVUPS X4, 176(SP)
    MOVUPS X5, 192(SP)
    MOVUPS X6, 208(SP)
    MOVUPS X7, 224(SP)
    MOVUPS X8, 240(SP)
    MOVUPS X9, 256(SP)
    MOVUPS X10, 272(SP)
    MOVUPS X11, 288(SP)
    MOVUPS X12, 304(SP)
    MOVUPS X13, 320(SP)
    MOVUPS X14, 336(SP)
    MOVUPS X15, 352(SP)
    CALL ·asyncPreempt2(SB)
    MOVUPS 352(SP), X15
    MOVUPS 336(SP), X14
    MOVUPS 320(SP), X13
    MOVUPS 304(SP), X12
    MOVUPS 288(SP), X11
    MOVUPS 272(SP), X10
    MOVUPS 256(SP), X9
    MOVUPS 240(SP), X8
    MOVUPS 224(SP), X7
    MOVUPS 208(SP), X6
    MOVUPS 192(SP), X5
    MOVUPS 176(SP), X4
    MOVUPS 160(SP), X3
    MOVUPS 144(SP), X2
    MOVUPS 128(SP), X1
    MOVUPS 112(SP), X0
    MOVQ 104(SP), R15
    MOVQ 96(SP), R14
    MOVQ 88(SP), R13
    MOVQ 80(SP), R12
    MOVQ 72(SP), R11
    MOVQ 64(SP), R10
    MOVQ 56(SP), R9
    MOVQ 48(SP), R8
    MOVQ 40(SP), DI
    MOVQ 32(SP), SI
    MOVQ 24(SP), BX
    MOVQ 16(SP), DX
    MOVQ 8(SP), CX
    MOVQ 0(SP), AX
    ADJSP $-368
    POPFQ
    POPQ BP
    RET
```

Key points:

- `NOSPLIT|NOFRAME`. The function must not have a normal Go prologue — if it did, the prologue's stack check could itself trigger preemption, recursing forever.
- 368 bytes of stack: 14 GPRs + 16 XMM registers + flags + frame pointer.
- `CALL ·asyncPreempt2(SB)` is the bridge to Go code. `asyncPreempt2`, in `runtime/preempt.go`, calls `gopreempt_m` or `goschedImpl` depending on `g.preemptStop`.
- After return, the registers are restored bit-for-bit. The trampoline `RET`s — to the *original* PC, because the signal handler had arranged for the original RIP to be the return address on the new stack.

The mental model: the signal handler "calls" `asyncPreempt`. The "return" from `asyncPreempt` lands at the *interrupted* instruction. To the user code, the preemption is invisible — registers identical, flags identical, RIP unchanged.

---

## The `asyncPreempt` Trampoline — arm64

File: `src/runtime/preempt_arm64.s`.

```
TEXT ·asyncPreempt(SB),NOSPLIT|NOFRAME,$0-0
    MOVD R30, -496(RSP)
    SUB  $496, RSP
    MOVD R29, -8(RSP)
    SUB  $8, RSP, R29
    #ifdef GOOS_ios
    MOVD R30, (RSP)
    #endif
    STP  (R0, R1), 8(RSP)
    STP  (R2, R3), 24(RSP)
    STP  (R4, R5), 40(RSP)
    STP  (R6, R7), 56(RSP)
    STP  (R8, R9), 72(RSP)
    STP  (R10, R11), 88(RSP)
    STP  (R12, R13), 104(RSP)
    STP  (R14, R15), 120(RSP)
    STP  (R16, R17), 136(RSP)
    STP  (R19, R20), 152(RSP)
    STP  (R21, R22), 168(RSP)
    STP  (R23, R24), 184(RSP)
    STP  (R25, R26), 200(RSP)
    MOVD NZCV, R0
    MOVD R0, 216(RSP)
    MOVD FPSR, R0
    MOVD R0, 224(RSP)
    FSTPD (F0, F1), 232(RSP)
    FSTPD (F2, F3), 248(RSP)
    // ... (continues for all FP registers)
    CALL ·asyncPreempt2(SB)
    // ... (mirror restore)
    ADD  $8, RSP
    MOVD -8(RSP), R29
    LDP  -16(RSP), (R29, R30)
    ADD  $496, RSP
    RET  (R30)
```

The arm64 stub saves 28 integer registers (R0–R28 minus reserved), 32 FP registers (F0–F31), NZCV (condition flags) and FPSR (FP status). Total frame: 496 bytes.

Note `RET (R30)`. On arm64, `R30` (link register) holds the return address. The signal handler arranges for the original PC to live in R30 before `asyncPreempt` runs, so the final `RET (R30)` returns to user code.

---

## The `asyncPreempt` Trampoline — riscv64

File: `src/runtime/preempt_riscv64.s`.

```
TEXT ·asyncPreempt(SB),NOSPLIT|NOFRAME,$0-0
    MOV X1, -464(X2)
    SUB $464, X2
    MOV X5, 8(X2)
    MOV X6, 16(X2)
    MOV X7, 24(X2)
    MOV X8, 32(X2)
    // X9 is g, skipped
    MOV X10, 40(X2)
    MOV X11, 48(X2)
    MOV X12, 56(X2)
    // ... X13..X31 ...
    MOVD F0, 192(X2)
    MOVD F1, 200(X2)
    // ... F2..F31 ...
    CALL ·asyncPreempt2(SB)
    // mirror restore
    ADD $464, X2
    JMP (X1)
```

`X2` is SP on riscv64. `X1` is the link register. The pattern is the same: save all caller-save registers, call `asyncPreempt2`, restore, jump through the link register to return.

The lesson across architectures: each new port needs its own trampoline that knows the platform's register save area. Adding a new GOARCH means writing roughly 100 lines of preempt assembly.

---

## Signal Handler Internals — Linux/amd64

The handler entry point is `runtime.sigtramp` (in `runtime/sys_linux_amd64.s`), which calls `runtime.sigtrampgo`, which calls `runtime.sighandler`. The relevant code path for async preemption is in `runtime/signal_unix.go`:

```go
// Simplified
func sighandler(sig uint32, info *siginfo, ctxt unsafe.Pointer, gp *g) {
    c := &sigctxt{info, ctxt}

    if sig == sigPreempt && debug.asyncpreemptoff == 0 {
        // Possibly an async preemption.
        doSigPreempt(gp, c)
        // Continue: there can be other handlers for SIGURG.
        atomic.Store(&gp.m.signalPending, 0)
    }
    // ... handle other signals ...
}

func doSigPreempt(gp *g, ctxt *sigctxt) {
    // Check if we can preempt
    if wantAsyncPreempt(gp) {
        if ok, newpc := isAsyncSafePoint(gp, ctxt.sigpc(), ctxt.sigsp(), ctxt.siglr()); ok {
            // Adjust the signal context so that we'll re-enter execution
            // at asyncPreempt.
            ctxt.pushCall(abi.FuncPCABI0(asyncPreempt), newpc)
        }
    }
}
```

`ctxt.pushCall` does the magic of "fake a call." On amd64 it is:

```go
// runtime/signal_amd64.go
func (c *sigctxt) pushCall(targetPC, resumePC uint64) {
    // Make it look like we are at a CALL instruction.
    pc := c.rip()
    sp := c.rsp() - 8
    *(*uint64)(unsafe.Pointer(uintptr(sp))) = resumePC
    c.set_rsp(sp)
    c.set_rip(targetPC)
}
```

Translated: decrement SP by 8 bytes, push the resume PC (the interrupted instruction) onto the user stack, set the saved RIP to `asyncPreempt`. When the kernel `sigreturn`s, the thread is "at" the call. `asyncPreempt`'s final `RET` will pop the resume PC and continue.

The eight bytes are written to the *user* stack, not the signal stack. This is normally safe because the goroutine's stack has a red zone of unused space below SP. Edge case: a goroutine very close to stack overflow could be in trouble. The runtime's stack-growth checks should have triggered first; the situation is rare.

---

## Windows Implementation: SuspendThread/SetThreadContext

Windows has no signals. The preemption mechanism is:

```go
// runtime/preempt_windows.go (conceptual)
func preemptM(mp *m) {
    if !mp.signalPending.CompareAndSwap(0, 1) {
        return
    }
    SuspendThread(mp.thread)
    var ctx CONTEXT
    ctx.ContextFlags = CONTEXT_CONTROL | CONTEXT_INTEGER
    GetThreadContext(mp.thread, &ctx)

    if isAsyncSafePoint(mp.curg, ctx.Rip, ctx.Rsp, 0) {
        // push call to asyncPreempt
        ctx.Rsp -= 8
        *(*uint64)(unsafe.Pointer(uintptr(ctx.Rsp))) = ctx.Rip
        ctx.Rip = uint64(funcPC(asyncPreempt))
        SetThreadContext(mp.thread, &ctx)
    }
    ResumeThread(mp.thread)
}
```

The mechanism is functionally identical: pause the thread, rewrite its PC, resume. Windows just exposes a direct API where Unix uses signals.

A subtlety: `SuspendThread` is *synchronous* — when it returns, the thread is paused. On Unix, signal delivery is asynchronous. Sysmon on Windows therefore has slightly tighter latency guarantees.

---

## The Compiler's pcdata Tables

For every function, the compiler emits several PC-indexed tables:

- `PCDATA_StackMapIndex` — which stack map applies at each PC.
- `PCDATA_InlTreeIndex` — which inlined function this PC belongs to.
- `PCDATA_UnsafePoint` — flags marking PCs as not-async-safe.

`PCDATA_UnsafePoint` is the relevant one. Each entry is a small integer:

```
const (
    PCDATA_UnsafePointSafe   = -1  // the default — safe
    PCDATA_UnsafePointUnsafe = -2  // never safe (e.g., inside write barrier)
    PCDATA_Restart1          = -3  // restart-this-instruction marker
    PCDATA_Restart2          = -4
    PCDATA_RestartAtEntry    = -5
)
```

The signal handler reads this table:

```go
// runtime/preempt.go
func isAsyncSafePoint(gp *g, pc, sp, lr uintptr) (bool, uintptr) {
    f := findfunc(pc)
    if !f.valid() {
        return false, 0
    }
    smi := pcdatavalue(f, abi.PCDATA_StackMapIndex, pc, nil)
    if smi == -2 { // unsafe point
        return false, 0
    }
    up := pcdatavalue(f, abi.PCDATA_UnsafePoint, pc, nil)
    if up != abi.UnsafePointSafe {
        // Don't preempt at unsafe points.
        return false, 0
    }
    return true, pc
}
```

The compiler emits `UnsafePoint` markers around:

- Write barriers.
- Atomic CAS retry loops generated by the compiler.
- Calls to runtime functions that may park.
- The "restart sequence" used for some lock-free runtime structures.

This metadata is the bridge between the compiler (which knows what is safe) and the runtime (which acts on that knowledge at signal time).

---

## Why `SIGURG`: A Compatibility Argument

When the proposal was being discussed, the obvious candidates were `SIGUSR1`, `SIGUSR2`, and a real-time signal. The reasons each was rejected:

- **`SIGUSR1`, `SIGUSR2`** — too commonly used by user programs. A library that installs a `SIGUSR1` handler would silently break the Go runtime (or vice versa). Backward-compatibility risk too high.
- **Real-time signals (`SIGRTMIN..SIGRTMAX`)** — supported on Linux but not macOS or older Unixes. Not portable.
- **`SIGURG`** — defined by POSIX, semantically tied to socket OOB data (essentially a dead feature in modern programs), almost never used by libraries. Available everywhere Go ships.

The runtime now treats `SIGURG` specially: a program may still install its own `SIGURG` handler via `os/signal.Notify`, and the runtime will forward to it after its own preemption work is done. The runtime does not "steal" the signal.

---

## Race Detector and Preemption

The race detector (`-race`) instruments memory accesses with calls to `__tsan_read` and `__tsan_write`. Each call is a function call, so cooperative preemption fires often. But the race-detector runtime itself has internal critical sections — areas where it would not be safe to async-preempt.

The Go runtime marks `__tsan_*` PCs as unsafe points. Async preemption skips them. This is one of several reasons race-detector builds run noticeably slower: more PCs are forbidden, sysmon retries more often, and the cost of declined signals accumulates.

---

## Performance Budget of an Async Preemption

Approximate cycle costs on a modern amd64:

| Step | Cost |
|---|---|
| `tgkill(SIGURG)` syscall | ~200–500 ns |
| Kernel signal delivery (build signal frame) | ~500–1500 ns |
| `sigtramp` + `sigtrampgo` entry | ~100 ns |
| `isAsyncSafePoint` check + pcdata lookup | ~50–200 ns |
| `pushCall` rewrite | ~30 ns |
| `sigreturn` | ~300–800 ns |
| `asyncPreempt` save-all-regs | ~80 ns |
| `asyncPreempt2` -> `goschedImpl` | ~150 ns |
| `schedule()` (no work to steal) | ~200 ns |
| `asyncPreempt` restore-all-regs | ~80 ns |
| **Total** | **~2–4 microseconds** |

For perspective: a goroutine that runs for 10 ms before being preempted spent 0.02–0.04 % of its time on the preemption itself. Practically free.

The cost matters only when preemption fires *often* — say, every few microseconds. That happens in pathological cases (lots of locks, lots of GC). In healthy code, the per-event cost is negligible compared to the time between events.

---

## Reading the Runtime Source Map

If you want to study preemption end-to-end, read in this order:

1. `runtime/preempt.go` — the per-goroutine state and decision logic.
2. `runtime/proc.go` — search for `preemptone`, `sysmon`, `retake`, `goschedImpl`, `gopreempt_m`.
3. `runtime/signal_unix.go` — search for `doSigPreempt`, `sigPreempt`, `preemptM`.
4. `runtime/preempt_amd64.s` (or your platform) — the trampoline.
5. `runtime/signal_amd64.go` (or your platform) — `pushCall`.
6. `runtime/os_linux.go` — search for `signalM`, `tgkill`.
7. `runtime/preempt_windows.go` (if curious about non-Unix).
8. `cmd/compile/internal/ssa/poset.go` and friends — where the compiler decides what is async-safe.

The whole subsystem is small — fewer than 2000 lines of Go and assembly across all platforms. A focused weekend can give you full coverage.

---

## Summary

At the professional level you should be able to read and modify the trampoline. You know that `asyncPreempt` is a NOSPLIT/NOFRAME stub that saves the full register file, calls `asyncPreempt2`, and restores. You know each architecture has its own version (amd64, arm64, riscv64, ppc64, mips64, s390x, 386, arm). You know how the signal handler rewrites the saved RIP to "fake a call" into the trampoline, and you understand the `pushCall` trick. You can name the four pcdata flavours that drive `isAsyncSafePoint`, and you know which runtime functions mark themselves as preempt-off via `mp.preemptoff`. You can ballpark the cost: 2–4 microseconds per fired event. You know Windows uses `SuspendThread`/`SetThreadContext` instead of signals, and you can name why `SIGURG` was chosen. Above all, you can navigate the source — the runtime is no longer a black box, and the answer to almost any "why does Go preempt here but not there" question is in a hundred-line block of `runtime/preempt.go`.
