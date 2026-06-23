# Goroutine Preemption — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [Cooperative vs Async Side by Side](#cooperative-vs-async-side-by-side)
3. [The Function Prologue in Detail](#the-function-prologue-in-detail)
4. [`g.preempt` and `g.stackguard0`](#gpreempt-and-gstackguard0)
5. [The morestack -> gopreempt Path](#the-morestack---gopreempt-path)
6. [Async Path: sysmon -> preemptM -> tgkill](#async-path-sysmon---preemptm---tgkill)
7. [The Signal Handler in Outline](#the-signal-handler-in-outline)
8. [Safe-Points — A First Look](#safe-points--a-first-look)
9. [Interaction with GC](#interaction-with-gc)
10. [Cgo and Preemption](#cgo-and-preemption)
11. [Tracing Preemption Events](#tracing-preemption-events)
12. [Observability with `GODEBUG=schedtrace`](#observability-with-godebugschedtrace)
13. [Common Pitfalls at This Level](#common-pitfalls-at-this-level)
14. [Summary](#summary)

---

## Introduction

At the junior level you learned *that* preemption exists and *what* it accomplishes. At the middle level you start to look inside. You will not yet stare at assembly trampolines, but you will trace the call chain through the runtime, name the structs that record preemption state, and explain — in code, not analogy — what differs between the two mechanisms.

By the end you should be able to point at a Go runtime source file and say "the cooperative path lives here, the async path lives here." You should be able to read a small `pprof` output and tell when preemption is doing real work.

---

## Cooperative vs Async Side by Side

A direct comparison.

| Aspect | Cooperative (pre-1.14, still active today) | Asynchronous (Go 1.14+) |
|---|---|---|
| Trigger | Function-call prologue checks `g.stackguard0` | Sysmon detects `G` running > 10 ms, sends signal |
| Mechanism | Compiler-inserted instructions | OS signal (`SIGURG` on Unix, suspend/resume on Windows) |
| Granularity | Per function call | Per safe-point, ~tens of nanoseconds anywhere |
| Latency | Bounded only by inter-call distance | Bounded by 10 ms + signal delivery (~microseconds) |
| Cost when fired | A few extra instructions | Signal delivery + register save + scheduler call |
| Cost when not fired | One compare-and-branch per call | Zero (sysmon ticks, but does not bother goroutines) |
| Fails when | Loops have no calls (the infamous `for {}`) | Cgo, locked OS threads, runtime-internal critical sections |
| Disable with | `//go:nosplit` (per-function, expert use only) | `GODEBUG=asyncpreemptoff=1` (process-wide, debugging only) |
| Sees `g.preempt` | Yes — that is the trigger | Yes — handler also checks it |
| Sees `g.stackguard0` | Yes — the poison value `stackPreempt` | No — uses signal-based path |

The two paths are not alternatives. In `preemptone`, both are tried:

```go
// Simplified from runtime/proc.go
func preemptone(pp *p) bool {
    mp := pp.m.ptr()
    if mp == nil || mp == getg().m {
        return false
    }
    gp := mp.curg
    if gp == nil || gp == mp.g0 {
        return false
    }

    gp.preempt = true
    gp.stackguard0 = stackPreempt  // cooperative

    if preemptMSupported && debug.asyncpreemptoff == 0 {
        pp.preempt = true
        preemptM(mp)                // async
    }
    return true
}
```

Whichever effect lands first wins. On a typical workload, function calls happen within microseconds, so the cooperative path fires first. On a tight numerical loop, the cooperative path is silent and async fires after the signal round trip.

---

## The Function Prologue in Detail

Every non-`//go:nosplit` Go function begins with code roughly equivalent to:

```
TEXT ·foo(SB), ABIInternal, $framesize
    MOVQ (TLS), R14          // load g into R14
    LEAQ -framesize(SP), AX  // compute end of new frame
    CMPQ AX, 16(R14)         // compare against g.stackguard0
    JLS  morestack_noctxt    // if SP would be below guard, grow stack
    // ... function body ...
```

(`R14` holds the current goroutine pointer in the Go 1.17+ register ABI on amd64. `16(R14)` is the offset of `stackguard0`. Offsets and exact register names vary per architecture.)

The check has two purposes:

1. **Stack growth.** If the function's frame would overflow the current stack, jump to `morestack` which allocates a bigger stack.
2. **Preemption.** The runtime sets `stackguard0 = stackPreempt`, a value larger than any real SP, so the comparison fails and `morestack` is called regardless of frame size.

`morestack` is shared infrastructure. Inside it, the runtime checks "is this a real stack overflow, or is `preempt` set?" and branches accordingly.

### What functions have a prologue?

- Most ordinary Go functions: **yes**.
- Functions marked `//go:nosplit`: **no**. The compiler skips the check entirely. These are reserved for runtime code that runs on tiny stacks or in signal handlers, where calling morestack would be unsafe.
- Assembly functions (`.s` files): **only if** the author explicitly emits the check. Most runtime assembly does not.

This is why some runtime functions are not preemptible cooperatively. They have no prologue.

---

## `g.preempt` and `g.stackguard0`

Two fields on the `g` struct govern preemption.

`g.preempt` — a `bool`, set by the scheduler when it wants this goroutine to yield. After the cooperative path triggers, `gopreempt_m` reads `g.preempt`, clears it, and runs the scheduler.

`g.stackguard0` — a `uintptr`, normally near the bottom of the goroutine's stack. The prologue check compares the future SP against this address. To force the check to fail, the runtime sets `stackguard0 = stackPreempt` (a magic constant on the order of `0xfffffade`).

The two fields are usually set together. Setting only `g.preempt` would do nothing — the prologue does not read `g.preempt`. Setting only `stackguard0` would trigger morestack, but morestack would then see no `preempt` request and re-enter the function. The combination is what causes a real yield.

In Go 1.14+, there is a related field `g.preemptStop`. If true, after the preemption fires, the goroutine is *parked* rather than re-queued. This is used by the GC for STW.

---

## The morestack -> gopreempt Path

The cooperative path's full trail:

```
function prologue
   |
   | SP <= stackguard0 ?
   v (yes)
runtime.morestack_noctxt   (assembly, in runtime/asm_amd64.s)
   |
   v
runtime.newstack            (Go, in runtime/stack.go)
   |
   | check g.preempt
   v (true)
runtime.gopreempt_m         (Go, in runtime/proc.go)
   |
   v
runtime.goschedImpl
   |
   | g is moved to global run queue
   v
runtime.schedule()          (picks next G)
```

`newstack` is interesting: it is the same function that grows the stack in a real overflow. The cooperative path is **the stack-growth code, reused**. That is why the mechanism is so efficient — there is no separate machinery.

When `newstack` reads `g.preempt == true`, it skips the actual reallocation, calls `gopreempt_m`, and the goroutine yields.

---

## Async Path: sysmon -> preemptM -> tgkill

Sysmon (`runtime.sysmon`, in `runtime/proc.go`) is a special goroutine without a P. It runs an infinite loop with adaptive sleep:

```go
for {
    delay := computeDelay()
    usleep(delay)

    retake(now())   // scan all Ps
    // ... GC trigger, network poller, other bookkeeping ...
}
```

`retake` iterates over `allp` and, for each P that has held the same goroutine for longer than `forcePreemptNS` (10 ms), calls `preemptone(p)`.

`preemptone` runs the joint cooperative+async logic. On the async side, it calls `preemptM(mp)`. On Linux/amd64:

```go
// runtime/signal_unix.go
func preemptM(mp *m) {
    if !atomic.Cas(&mp.signalPending, 0, 1) {
        return
    }
    if GOOS == "darwin" || GOOS == "ios" {
        execLock.rlock()
    }
    signalM(mp, sigPreempt)
    if GOOS == "darwin" || GOOS == "ios" {
        execLock.runlock()
    }
}
```

`signalM` is:

```go
// runtime/os_linux.go
func signalM(mp *m, sig int) {
    tgkill(getpid(), int(mp.procid), sig)
}
```

`tgkill(2)` is the Linux syscall that delivers a signal to a *specific thread* of a process. (Plain `kill(2)` delivers to any thread.) The signal here is `_SIGURG`.

---

## The Signal Handler in Outline

When `SIGURG` is delivered to the thread, the kernel saves the thread's CPU state (RIP, RSP, all general-purpose registers) onto a signal stack and invokes Go's signal handler, `runtime.sighandler` (`runtime/signal_unix.go`).

The handler runs in a constrained environment:

- It cannot allocate (no `mallocgc`).
- It cannot itself be preempted.
- It runs on the goroutine's stack or on a dedicated signal stack depending on platform.

The handler checks the saved state and decides whether preemption is safe at this PC. If not (mid-write-barrier, in cgo, on the system stack, etc.), it simply returns — the next sysmon tick will retry.

If preemption is safe, the handler manipulates the saved register state on the signal stack:

```
saved RIP = address of runtime.asyncPreempt
saved RSP = adjusted to reserve space for restoring registers
the original RIP and the original SP are stashed inside asyncPreempt's frame
```

When the signal handler returns, the kernel restores the (now-modified) saved state. The thread "resumes" at `asyncPreempt`, not at the original PC.

`asyncPreempt`, an assembly trampoline (we examine it at the professional level), saves the full register file, calls a Go function (`asyncPreempt2`), which calls `gopreempt_m`, which calls the scheduler. When the goroutine is rescheduled later, `asyncPreempt` restores the registers and returns to the *original* PC.

The user-visible effect: a goroutine that was executing instruction `X` is paused; when it next runs, it executes `X` as if nothing happened. The runtime stole some time in between.

---

## Safe-Points — A First Look

A **safe-point** is a program point where the runtime knows:

- All pointers in registers and on the stack are typed (the GC can find them).
- No write barrier is in progress.
- No atomic operation is half-finished.
- The goroutine is not on the system stack.

Cooperative preemption fires *only at function prologues*, which are by construction safe-points (the compiler emits stack maps for every prologue).

Asynchronous preemption can fire *almost anywhere*, but the signal handler checks for safety. The mechanism that lets the compiler tell the runtime "this PC is a safe-point" is **stack maps** plus a per-function metadata table the compiler emits.

The implementation detail: at every async-safe PC, the compiler records what registers contain pointers. The signal handler looks up the PC in the table; if the PC has an entry, it is an async-safe-point. Otherwise, the handler declines.

In Go 1.14, "every PC inside ordinary user code" became an async-safe-point. Pre-1.14, only function prologues were. That is the technical heart of the change.

---

## Interaction with GC

A stop-the-world phase requires every goroutine to reach a safe-point and park. Without async preemption, a tight loop could keep the GC waiting indefinitely. With async preemption, the GC can guarantee that within ~10 ms (the sysmon tick) every goroutine has been forced to a safe-point.

The flow during STW start:

```
1. GC sets the global "world stopping" flag.
2. For each P, the scheduler calls preemptone(p).
3. Cooperative + async paths fire.
4. Each goroutine, on its next safe-point, parks.
5. When all goroutines are parked, STW begins.
6. GC does its work.
7. GC clears the stopping flag; goroutines resume.
```

The 10 ms upper bound on STW start was the practical motivation for the entire async preemption project. Sub-millisecond STW pauses, which Go achieves today, would be impossible otherwise.

---

## Cgo and Preemption

A goroutine that has crossed into C code via cgo runs *on an OS thread but outside Go's safe-point system*. The runtime cannot rewrite its PC because the PC is somewhere in C. The signal handler, on detecting the goroutine is in cgo, declines to preempt.

The consequence: a cgo call that runs for a long time pins its M. If your program has many such calls, you may need to raise `GOMAXPROCS` to avoid starvation.

`runtime.cgocall` and `runtime.exitsyscall` are the bookkeeping boundary functions. When the cgo call returns, the goroutine becomes preemptible again, and at the *next* sysmon tick it can be preempted if necessary.

In practice: keep cgo calls short, or break them up. Long cgo calls are an antipattern for the same reasons long pre-1.14 loops were.

---

## Tracing Preemption Events

The `runtime/trace` package emits events for many scheduler activities. Enable it like this:

```go
import "runtime/trace"

f, _ := os.Create("trace.out")
trace.Start(f)
// ... workload ...
trace.Stop()
```

Then:

```
go tool trace trace.out
```

In the resulting UI, look for "GoPreempt" events. Each one corresponds to a preemption (cooperative or async — they are not distinguished in the trace, but you can infer from context).

`GoPreempt` events that cluster around sysmon ticks are the async path. `GoPreempt` events distributed throughout normal function call patterns are the cooperative path.

---

## Observability with `GODEBUG=schedtrace`

```
GODEBUG=schedtrace=1000 ./yourbinary
```

Every 1000 ms, the runtime prints to stderr a one-line scheduler snapshot:

```
SCHED 1006ms: gomaxprocs=8 idleprocs=0 threads=11 spinningthreads=0 idlethreads=2 runqueue=2 [12 5 0 8 1 3 0 7]
```

The numbers in brackets are per-P run-queue lengths. A consistently long run queue on one P, combined with high idle time on another, can hint at a preemption issue.

For preemption itself, the more targeted flag is `GODEBUG=schedtrace=1000,scheddetail=1`, which prints per-goroutine state.

---

## Common Pitfalls at This Level

### Pitfall: assuming preemption is instant

Async preemption is bounded by sysmon's ~10 ms tick. If you spawn 1000 goroutines that each run a 5 ms CPU burst and you depend on them being interleaved, you may be disappointed: many will run to completion before sysmon notices.

### Pitfall: writing a goroutine that disables it locally

There is no per-goroutine API to disable async preemption. The closest you can get is `//go:nosplit` (which only disables the cooperative prologue) plus avoiding any signal-delivering code, which is impractical in user code.

### Pitfall: forgetting that `LockOSThread` does not affect preemption

A goroutine bound to a thread is *still preemptible*. The lock affects which OS thread the goroutine *resumes on*, not whether it can yield.

### Pitfall: long write barriers

If your program writes pointers in a tight loop, each pointer write is a write barrier (a small runtime function call). Each write barrier is itself a brief un-preemptible window. Aggregated, they reduce the rate at which preemption can fire — though for normal code the effect is negligible.

---

## Summary

At the middle level you should now be able to: name the structs (`g.preempt`, `g.stackguard0`), name the functions (`preemptone`, `preemptM`, `signalM`, `tgkill`, `asyncPreempt`), trace the path of both cooperative and async preemption, and explain the role of safe-points and sysmon. You should know that cgo, write barriers, and the system stack are the regions where preemption cannot fire, and you should be able to enable `runtime/trace` and `GODEBUG=schedtrace` to observe preemption empirically. The most important takeaway is conceptual: pre-1.14 Go had a single, cheap, cooperative mechanism that fell apart in tight loops. Go 1.14 added a second, more expensive, signal-based mechanism on top. Today the runtime uses both. Understanding when each fires — and why neither fires inside C — separates the engineer who reads the runtime from the engineer who only consumes it.
