# Goroutine Preemption — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Safe-Points in Depth](#safe-points-in-depth)
3. [Write Barriers and Preemption](#write-barriers-and-preemption)
4. [Stack Maps and PC-Value Tables](#stack-maps-and-pc-value-tables)
5. [The `preemptStop` Flag and GC Parking](#the-preemptstop-flag-and-gc-parking)
6. [The Sysmon State Machine](#the-sysmon-state-machine)
7. [Per-P Schedtick Bookkeeping](#per-p-schedtick-bookkeeping)
8. [Why Preemption Sometimes Declines](#why-preemption-sometimes-declines)
9. [Interaction with Locked OS Threads](#interaction-with-locked-os-threads)
10. [`runtime.Gosched` vs Preemption — Subtle Differences](#runtimegosched-vs-preemption--subtle-differences)
11. [Reproducible Preemption Latency Measurement](#reproducible-preemption-latency-measurement)
12. [Summary](#summary)

---

## Introduction

The senior level moves from "what fires preemption" to "what *prevents* it." You will now think about safe-points, write barriers, system-stack code, and the small but crucial set of runtime functions that must run uninterrupted. You will also start to measure preemption empirically — using `runtime/trace`, perf counters, and crafted micro-benchmarks.

After this file you should be able to participate in a runtime discussion about preemption: "Why doesn't sysmon preempt this case?", "What is `g.asyncSafePoint`?", "What guarantees does Go give about pre-emption latency?"

---

## Safe-Points in Depth

A safe-point is a PC at which the runtime can stop a goroutine and have well-defined state. There are three flavours in Go.

### Cooperative safe-points

These are function prologues. The compiler emits a stack map describing every pointer-typed local. When `morestack` redirects to `gopreempt_m`, the GC can scan the goroutine's stack confidently.

### Async-safe-points

These are introduced by Go 1.14. The compiler emits, for every "interruptible" PC in user code, a register map that names which registers contain pointers. The signal handler, on entry, looks up the saved RIP in this table; if found, async preemption is allowed and the runtime can suspend the goroutine.

Almost every instruction in user-compiled code is an async-safe-point. The exceptions are intentionally narrow:

- Inside the function prologue itself (before the stack guard check has set up the frame).
- Inside the epilogue (after the frame is torn down).
- Inside write barriers.
- Inside compiler-generated atomic intrinsics.
- Inside hand-written assembly without explicit pcdata declarations.

### Unsafe regions

These are PCs the compiler explicitly marks as un-preemptible. Code reachable only via the system stack (the goroutine's `g0` stack) is unsafe. Code inside `runtime.cgocall` after the M has crossed to C is unsafe.

The signal handler implementation in `runtime/preempt.go`:

```go
// Simplified
func isAsyncSafePoint(gp *g, pc, sp, lr uintptr) bool {
    mp := gp.m
    if mp.locks != 0 || mp.mallocing != 0 || mp.preemptoff != "" || mp.p.ptr().status != _Prunning {
        return false
    }
    f := findfunc(pc)
    if !f.valid() {
        return false
    }
    if hasPrefix(funcname(f), "runtime.") {
        if isWriteBarrier(f) {
            return false
        }
        // some runtime funcs are safe; others are not — driven by pcdata
    }
    return true
}
```

The `mp.preemptoff` field is interesting: it is a string that, when non-empty, tells the runtime "don't preempt this M; the reason is named in the string." It is used in places like `(*hchan).sendDirect` where pointer atomicity must be preserved.

---

## Write Barriers and Preemption

Go's garbage collector uses a write barrier to maintain its tricolor invariant. The write barrier is a tiny inline function that runs *every time a Go program writes a pointer*. In assembly it looks roughly like:

```
TEXT runtime.gcWriteBarrier(SB), NOSPLIT, $0-0
    // capture old value of *dst, log it for marking
    // store new value
    RET
```

Inside this sequence, the program is in a transient state: the pointer write is partially complete, the shadow log might be inconsistent. Preempting here would let the GC observe an impossible heap.

The Go runtime marks every write-barrier PC as not-async-safe. The signal handler, on landing in a write-barrier PC, simply declines and returns. The next sysmon tick will retry.

The cost: each write barrier is a tiny preemption-free window, on the order of a few nanoseconds. Hot pointer-writing code (e.g., a slice of pointers being filled) creates many such windows. In aggregate, this can cap the rate at which async preemption fires, but for typical workloads the effect is irrelevant.

---

## Stack Maps and PC-Value Tables

For both cooperative and async paths, the GC must be able to scan the goroutine's stack and find pointers. The compiler emits, for every safe-point PC, a **stack map**: a bitmap describing which slots in the frame contain pointers.

For async-safe-points, the compiler additionally emits a **register map**: a bitmap describing which registers (in the Go 1.17+ register ABI) contain pointers.

These maps live in the per-function PC-data tables, indexed by PC offset. The relevant functions are in `runtime/symtab.go` (`pcvalue`, `funcMaxSPDelta`).

When the signal handler enters, it does a binary search:

```go
sm, _ := stackmapdata(stkmap, off)
rm, _ := regmapdata(regmap, off)
```

If both maps are present and the PC is not in a forbidden range, the handler can preempt. Otherwise, decline.

---

## The `preemptStop` Flag and GC Parking

For ordinary preemption, a goroutine yields by being placed on the run queue — it is "ready to run, but not running." For GC STW, the goroutine must instead *park* — be marked unrunnable until the STW phase ends.

The `g.preemptStop` flag distinguishes the two. When the scheduler stops a goroutine for preemption, it checks `g.preemptStop`:

```go
// simplified runtime/proc.go gopreempt_m equivalent
if gp.preemptStop {
    park_m(gp)         // sleep until released
} else {
    goschedImpl(gp)    // back to run queue
}
```

GC code that wants to STW sets `g.preemptStop = true` on every active goroutine and then triggers `preemptone` on each P. As goroutines reach safe-points, they park. When all are parked, GC can begin.

After the STW phase, the GC clears `preemptStop` and wakes the goroutines.

This is the second reason async preemption mattered so much for the GC: without bounded preemption latency, you cannot bound STW *start* latency, and STW *start* dominated 1.13-era pauses.

---

## The Sysmon State Machine

Sysmon is one goroutine, running outside the normal scheduler. It has its own M (the "system monitor M", `mSysmon`) that is never associated with any P. Its main loop:

```go
func sysmon() {
    lasttrace := int64(0)
    idle := 0
    delay := uint32(0)
    for {
        if idle == 0 {
            delay = 20
        } else if idle > 50 {
            delay *= 2
        }
        if delay > 10*1000 {
            delay = 10 * 1000
        }
        usleep(delay)

        // ... GC trigger logic ...
        // ... network poller ...

        now := nanotime()
        next, _ := timeSleepUntil()

        // retake Ps blocked in syscalls or running for too long
        if retake(now) != 0 {
            idle = 0
        } else {
            idle++
        }

        // ... force GC if needed ...

        if lasttrace+10e9 < now && debug.scheddetail > 0 {
            schedtrace(true)
            lasttrace = now
        }
    }
}
```

The `retake` function is the preemption trigger. It walks `allp[]` and for each P:

```go
pd := &pp.sysmontick
schedtick := atomic.Load(&pp.schedtick)
if pd.schedtick != schedtick {
    pd.schedtick = schedtick
    pd.schedwhen = now
} else if pd.schedwhen+forcePreemptNS <= now {
    preemptone(pp)
}
```

If the P's `schedtick` has not advanced for 10 ms — meaning the same goroutine has been running — sysmon preempts.

---

## Per-P Schedtick Bookkeeping

`p.schedtick` increments every time the scheduler picks a new G on that P. So:

- `schedtick` changed since last sysmon look → P recently context-switched → no preempt needed.
- `schedtick` unchanged for 10 ms → same goroutine still running → preempt.

This is a beautifully cheap mechanism. Sysmon does not need to know *which* goroutine is running, only whether the scheduler has activity. A single atomic load per P per tick.

A second counter, `p.syscalltick`, tracks how many syscalls have started on this P. It is used for syscall handling, not preemption proper, but it is part of the same `sysmontick` struct.

---

## Why Preemption Sometimes Declines

The signal handler can decide "this is not a good moment" and return without preempting. Conditions that cause decline:

1. **`mp.locks != 0`** — the M holds a runtime lock.
2. **`mp.mallocing != 0`** — the M is in the middle of an allocation.
3. **`mp.preemptoff != ""`** — explicit "don't preempt" set by some runtime function.
4. **PC inside a write barrier.**
5. **PC inside compiler-generated atomic sequences.**
6. **PC inside cgo or `gosignal` machinery.**
7. **PC has no register map** (e.g., hand-written assembly without `PCDATA`).
8. **Goroutine is on the system stack (`g.m.g0`).**

After declining, the handler returns normally. The thread resumes at its original PC and keeps running. Sysmon, on its next tick, will see the goroutine still has not yielded and will try again. Eventually — when the goroutine leaves the unsafe region — preemption fires.

This is why preemption is *eventually*, not *always*, prompt. The mechanism guarantees forward progress in bounded time, but not instantaneous response.

---

## Interaction with Locked OS Threads

A goroutine that has called `runtime.LockOSThread` is bound to a specific M. Other goroutines may still be scheduled on that M's P, but they will not use that M.

Preemption of a locked goroutine works normally. The signal goes to the M, the handler does its job, the goroutine yields. When the goroutine is rescheduled, the runtime ensures it lands on the same M.

The interaction matters for the inverse case: an M whose only locked goroutine has been parked. Such an M is *idle* but not reusable. If many goroutines lock OS threads, you can end up with many idle Ms — a tax on RSS.

---

## `runtime.Gosched` vs Preemption — Subtle Differences

Both move the current goroutine off the P. But:

- **`Gosched`** never enters the signal handler. It is a normal function call that ends in `goschedImpl`. No signal overhead.
- **`Gosched`** places the goroutine on the *global* run queue, not the local one (in some Go versions; this has varied). The intent is to give *any* P a chance to run it next.
- **`Gosched`** can be called from runtime code with locks held — though doing so is rare.
- **Async preemption** lands the goroutine via `asyncPreempt`, which then calls `gopreempt_m`, which places it on the *global* run queue with similar intent.

A subtlety: the work-stealing scheduler periodically drains the global queue into local ones. A `Gosched`-yielded goroutine may not run again for a few thousand instructions, depending on traffic.

---

## Reproducible Preemption Latency Measurement

A simple program that measures async preemption latency:

```go
package main

import (
    "fmt"
    "runtime"
    "sync/atomic"
    "time"
)

var hot uint64

func spinner() {
    for {
        atomic.AddUint64(&hot, 1)
    }
}

func main() {
    runtime.GOMAXPROCS(1)

    go spinner()
    time.Sleep(50 * time.Millisecond) // let spinner pin the P

    samples := 50
    var max time.Duration
    for i := 0; i < samples; i++ {
        start := time.Now()
        runtime.Gosched() // forces us back through the scheduler
        d := time.Since(start)
        if d > max {
            max = d
        }
        time.Sleep(time.Millisecond)
    }

    fmt.Println("max main-goroutine resume latency:", max)
    fmt.Println("hot iterations:", atomic.LoadUint64(&hot))
}
```

With one P, the main goroutine and the spinner share. Each time main yields, sysmon eventually preempts the spinner so main can run again. The max latency observed should be on the order of 10–20 ms, matching the sysmon tick.

Run twice — once with default `GODEBUG`, once with `asyncpreemptoff=1` — and observe the latency explode in the second run.

---

## Summary

At the senior level you should think of preemption as a *system*, not a single event. Safe-points, register maps, sysmon ticks, signal delivery, write-barrier exclusion zones — these are the moving parts. You should know that the signal handler is not omnipotent: it consults metadata the compiler emitted, refuses to preempt unsafe PCs, and depends on sysmon to retry later. You should be able to measure preemption latency, distinguish the cost from the latency, and explain why pinned cgo calls, locked OS threads, and pointer-heavy write barriers each interact with preemption differently. The runtime gives you bounded preemption latency *on average*, with the worst case still tied to the longest legitimately unsafe region a goroutine traverses. For a Go service, that worst case is typically tens of microseconds and an excellent fit for the GC's bounded-pause goals.
