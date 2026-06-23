# Goroutine Lifecycle — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [The `g` Struct](#the-g-struct)
3. [Runtime States in Detail](#runtime-states-in-detail)
4. [State Transition Functions](#state-transition-functions)
5. [Birth: `runtime.newproc`](#birth-runtimenewproc)
6. [Death: `runtime.goexit0` and `gfput`](#death-runtimegoexit0-and-gfput)
7. [The `g` Free List](#the-g-free-list)
8. [Parking and Wakeup: `gopark` / `goready`](#parking-and-wakeup-gopark--goready)
9. [Syscall Transitions](#syscall-transitions)
10. [Async Preemption and Lifecycle](#async-preemption-and-lifecycle)
11. [Stack Growth: `_Gcopystack`](#stack-growth-_gcopystack)
12. [Goroutine Profiles](#goroutine-profiles)
13. [`runtime/trace` Implementation](#runtimetrace-implementation)
14. [Reading the Runtime Source](#reading-the-runtime-source)
15. [Summary](#summary)

---

## Introduction
> Focus: "Show me the actual `runtime` constants, transition functions, and source lines that implement the goroutine lifecycle."

The professional level is where the runtime stops being a black box. The states described in plain English at junior level are real constants in `runtime/runtime2.go`. Every transition is a function in `runtime/proc.go`. Every birth and death has a precise sequence of operations. This document maps the lifecycle onto Go 1.22 source code, with file and approximate line references.

---

## The `g` Struct

Every goroutine is represented by a `g` struct. Defined in `runtime/runtime2.go`:

```go
type g struct {
    stack       stack          // offset known to runtime/cgo
    stackguard0 uintptr        // offset known to liblink
    stackguard1 uintptr

    _panic    *_panic
    _defer    *_defer
    m         *m              // current m; offset known to arm liblink
    sched     gobuf
    syscallsp uintptr
    syscallpc uintptr
    stktopsp  uintptr
    param     unsafe.Pointer
    atomicstatus atomic.Uint32 // _Gidle, _Grunnable, _Grunning, ...
    stackLock uint32
    goid      uint64
    schedlink guintptr
    waitsince int64            // approx time when the g become blocked
    waitreason waitReason      // why it was parked

    preempt       bool        // preemption signal
    preemptStop   bool        // transition to _Gpreempted on preempt
    preemptShrink bool        // shrink stack at synchronous safe point

    asyncSafePoint bool

    paniconfault bool
    gcscandone   bool
    throwsplit   bool
    activeStackChans bool
    parkingOnChan atomic.Bool

    raceignore     int8
    nocgocallback  bool
    tracking       bool
    trackingSeq    uint8
    trackingStamp  int64
    runnableTime   int64
    lockedm        muintptr      // M to which this G is locked (LockOSThread)
    sig            uint32
    writebuf       []byte
    sigcode0       uintptr
    sigcode1       uintptr
    sigpc          uintptr
    parentGoid     uint64
    gopc           uintptr   // pc of go statement that created this goroutine
    ancestors      *[]ancestorInfo
    startpc        uintptr   // pc of goroutine function
    racectx        uintptr
    waiting        *sudog     // sudog structures this g is waiting on
    cgoCtxt        []uintptr  // cgo traceback context
    labels         unsafe.Pointer // profiler labels
    timer          *timer        // cached timer for time.Sleep
    selectDone     atomic.Uint32 // are we participating in a select and did someone win the race?

    coroarg *coro          // argument during coroutine transfers

    gcAssistBytes int64
}
```

Key fields for lifecycle:

| Field | Meaning |
|---|---|
| `atomicstatus` | The current state: `_Gidle`, `_Grunnable`, ... |
| `goid` | Unique ID. Not exposed to user code. |
| `sched` | Saved registers (gobuf): PC, SP, BP, G itself. Used to resume the goroutine. |
| `stack` | The bounds of the goroutine's stack. Grows by `runtime.morestack`. |
| `waitreason` | Why this goroutine is parked. Strings like "chan receive", "select", "GC sweep wait". |
| `lockedm` | Set by `LockOSThread`; non-nil means this `g` is pinned to `m`. |
| `gopc` | PC of the `go` statement that created it. Used by `pprof` for the "creator stack." |
| `startpc` | PC of the goroutine's entry function. |
| `parentGoid` | The `goid` of the creating goroutine. Tracked since Go 1.21 for profiling. |
| `_panic`, `_defer` | The defer/panic chains. Walked during unwinding on goroutine exit. |

---

## Runtime States in Detail

From `runtime/runtime2.go`:

```go
const (
    _Gidle            = iota // 0
    _Grunnable               // 1 ready to run, on a run queue
    _Grunning                // 2 executing user code on an M
    _Gsyscall                // 3 executing a syscall, not on a run queue
    _Gwaiting                // 4 blocked on the runtime, e.g. chan op, lock, gopark
    _Gmoribund_unused        // 5 unused state, kept for ABI compatibility
    _Gdead                   // 6 unused; on the free list or just finished
    _Genqueue_unused         // 7 unused
    _Gcopystack              // 8 stack is being moved
    _Gpreempted              // 9 paused by async preemption, parked on suspendG
    _Gscan            = 0x1000 // ORed with _G state to indicate GC scanning
)
```

### `_Gidle` (0)

A freshly allocated `g` that has not yet started. Transient — set in `runtime.malg` and immediately changed to `_Gdead` (because the `g` will be initialized later).

### `_Grunnable` (1)

The goroutine is on a run queue (per-P local or global) and is waiting to be picked up. It has a valid `sched` (PC, SP). Transitioning to this state happens when:

- `runtime.newproc` finishes initialization.
- A wakeup (`goready`) is signaled.
- The scheduler returns a goroutine after preemption.

### `_Grunning` (2)

The goroutine is currently executing on an M. There is exactly one `_Grunning` goroutine per running M. The `m.curg` pointer points to it.

### `_Gsyscall` (3)

The goroutine is executing a syscall (`runtime.entersyscall` was called). The M is detached from its P; another M may pick up the P. When the syscall returns (`runtime.exitsyscall`), the goroutine becomes `_Grunnable` or `_Grunning` again.

This state is special: the runtime cannot move the `g`'s stack or scan it while in `_Gsyscall`, because the user-controlled syscall might be holding pointers into the stack.

### `_Gwaiting` (4)

The goroutine is parked by `gopark`. Reasons (the `waitreason` field):

- `waitReasonChanReceive` ("chan receive")
- `waitReasonChanSend` ("chan send")
- `waitReasonSelect` ("select")
- `waitReasonSyncCondWait` ("sync.Cond.Wait")
- `waitReasonSemacquire` ("semacquire")
- `waitReasonSleep` ("sleep")
- `waitReasonGCSweepWait` ("GC sweep wait")
- ... (many more, all enumerated in `runtime2.go`)

A `_Gwaiting` goroutine consumes zero CPU. It will be unparked by `goready`.

### `_Gdead` (6)

The goroutine has finished its work. Its `g` struct is on the per-P or global `gFree` list, ready to be reused. The stack is also reusable.

### `_Gcopystack` (8)

Transient state during stack growth (`runtime.copystack`). The `g`'s stack is being copied to a new, larger allocation. While in this state, no other goroutine should touch this `g`.

### `_Gpreempted` (9)

A new state introduced for async preemption (Go 1.14+). The goroutine has been preempted at an arbitrary point (not a safe point) and is parked until the scheduler can resume it.

### `_Gscan` (0x1000)

A bit flag, ORed with one of the other states, to indicate that the GC is currently scanning this goroutine's stack. The GC sets this bit, scans, and clears it. Other code that wants to manipulate the goroutine must wait.

---

## State Transition Functions

The runtime uses helper functions to enforce valid transitions. From `runtime/proc.go`:

```go
// casgstatus(g, old, new) atomically transitions g from old to new state.
// It is the canonical way to change a g's state.
func casgstatus(gp *g, oldval, newval uint32) { ... }
```

`casgstatus` is the only sanctioned way to change `gp.atomicstatus`. It uses `atomic.Cas` and panics on disallowed transitions (`bad g status: ...`).

The allowed transitions form a directed graph:

```
_Gidle      -> _Gdead             (in malg)
_Gdead      -> _Grunnable         (in newproc, when reusing a g)
_Grunnable  -> _Grunning          (in execute)
_Grunning   -> _Grunnable         (in runtime.Gosched, preemption)
_Grunning   -> _Gsyscall          (in entersyscall)
_Grunning   -> _Gwaiting          (in gopark)
_Grunning   -> _Gdead             (in goexit0)
_Grunning   -> _Gcopystack        (in newstack/copystack)
_Grunning   -> _Gpreempted        (in preemptStop path)
_Gsyscall   -> _Grunning          (in exitsyscallfast)
_Gsyscall   -> _Grunnable         (in exitsyscall, normal path)
_Gwaiting   -> _Grunnable         (in goready)
_Gcopystack -> _Grunning          (after copystack returns)
_Gpreempted -> _Gwaiting          (when scheduler accepts the preempt)
```

Plus the `_Gscan` bit, which can be set during `_Grunnable`, `_Grunning`, `_Gsyscall`, or `_Gwaiting`.

---

## Birth: `runtime.newproc`

Source: `runtime/proc.go`, around `func newproc(fn *funcval)`.

The compiled form of `go f(x, y)` becomes a call equivalent to:

```go
runtime.newproc(siz, fn) // simplified
// arguments x, y already pushed onto a buffer
```

Inside `newproc`:

```go
func newproc(fn *funcval) {
    gp := getg()
    pc := getcallerpc()
    systemstack(func() {
        newg := newproc1(fn, gp, pc)

        pp := getg().m.p.ptr()
        runqput(pp, newg, true) // append to local run queue

        if mainStarted {
            wakep() // ensure there is an M to run it
        }
    })
}
```

`newproc1` is where the `g` is acquired:

```go
func newproc1(fn *funcval, callergp *g, callerpc uintptr) *g {
    mp := acquirem()
    pp := mp.p.ptr()
    newg := gfget(pp)             // try the per-P free list
    if newg == nil {
        newg = malg(stackMin)      // allocate a fresh g
        casgstatus(newg, _Gidle, _Gdead)
        allgadd(newg)
    }
    // ... copy arguments, set up sched.PC and sched.SP ...
    newg.sched.pc = abi.FuncPCABI0(goexit) + sys.PCQuantum
    newg.sched.g = guintptr(unsafe.Pointer(newg))
    gostartcallfn(&newg.sched, fn)
    newg.parentGoid = callergp.goid
    newg.gopc = callerpc
    newg.startpc = fn.fn
    casgstatus(newg, _Gdead, _Grunnable)
    // ... assign goid, etc. ...
    releasem(mp)
    return newg
}
```

Key steps:

1. **Acquire a `g`.** From `gfget` (free list) or `malg` (fresh allocation).
2. **Set up the saved registers.** PC points at the function entry; SP points at the top of the new stack. A special `goexit` is set as the return address so that when `fn` returns, control transfers to runtime cleanup.
3. **Record creator stack** in `gopc` for `pprof`.
4. **Transition to `_Grunnable`** via `casgstatus`.

The newly runnable `g` is then pushed onto the run queue with `runqput`. A waiting M may be woken with `wakep`.

---

## Death: `runtime.goexit0` and `gfput`

When the goroutine's entry function returns, control transfers to `goexit` (assembly), which calls `goexit1`, which schedules `goexit0` to run on the M's `g0` (system stack).

`goexit0` (in `runtime/proc.go`):

```go
func goexit0(gp *g) {
    mp := getg().m
    pp := mp.p.ptr()

    casgstatus(gp, _Grunning, _Gdead)
    gcController.addScannableStack(pp, -int64(gp.stack.hi-gp.stack.lo))
    if isSystemGoroutine(gp, false) {
        sched.ngsys.Add(-1)
    }
    gp.m = nil
    locked := gp.lockedm != 0
    gp.lockedm = 0
    mp.lockedg = 0
    gp.preemptStop = false
    gp.paniconfault = false
    gp._defer = nil
    gp._panic = nil
    gp.writebuf = nil
    gp.waitreason = waitReasonZero
    gp.param = nil
    gp.labels = nil
    gp.timer = nil

    if gcBlackenEnabled != 0 && gp.gcAssistBytes > 0 {
        // flush assist credit
    }

    // Note: we leave `gp.stack` and `gp.stackguard0` alone — they'll
    // be reused by the next g.
    dropg()
    if GOARCH == "wasm" {
        gfput(pp, gp)
        schedule()
    }
    if mp.lockedInt != 0 {
        throw("internal lockOSThread error")
    }
    gfput(pp, gp)
    if locked {
        // The locked-to-thread g died. Per docs, we must kill the M.
        if GOOS != "plan9" {
            gogo(&mp.g0.sched)
        }
    }
    schedule()
}
```

Sequence:

1. `casgstatus(_Grunning -> _Gdead)`.
2. Clear `g` fields: defers, panics, labels, timer.
3. Drop the `g`'s association with the current M (`dropg`).
4. `gfput(pp, gp)` — put `gp` on the P's free list of `g`s.
5. If `LockOSThread` was active, kill this M (since it cannot serve other goroutines).
6. `schedule()` — pick the next `g` to run on this M.

The `g` struct is now ready for reuse.

---

## The `g` Free List

Each P has a local list of dead `g`s, plus a global list. From `runtime2.go`:

```go
type p struct {
    // ...
    gFree struct {
        gList
        n int32
    }
    // ...
}

type schedt struct {
    // ...
    gFree struct {
        lock    mutex
        stack   gList    // gs with stacks
        noStack gList    // gs without stacks
        n       int32
    }
    // ...
}
```

- Per-P list: lock-free local stash for fast `go f()` reuse.
- Global list: shared, mutex-protected. Split by whether the `g` retains its stack.

The lookup, `gfget`, prefers the local list, falls back to the global. Adding (`gfput`) keeps a balance: if the local list grows beyond a threshold (~64), some are moved to the global list.

### Why reuse?

Allocating a `g` involves a stack allocation and several initializations. Reuse skips both — `gfget` returns a `g` whose stack is already allocated. This is a big optimization for "spawn many short-lived goroutines" patterns.

### Caveat: stack size

A reused `g` may have a stack that grew during its prior life. If the old goroutine grew its stack to 4 KB, the next user inherits the 4 KB stack — not the 2 KB minimum. This is fine (just slightly more memory) but explains why "goroutine memory usage" is not always 2 KB per goroutine.

---

## Parking and Wakeup: `gopark` / `goready`

`runtime.gopark` parks the current goroutine. It is the canonical way to enter `_Gwaiting`.

```go
func gopark(unlockf func(*g, unsafe.Pointer) bool,
            lock unsafe.Pointer,
            reason waitReason,
            traceReason traceBlockReason,
            traceskip int)
```

What it does:

1. Records `waitreason` and `waitsince`.
2. Calls `casgstatus(_Grunning -> _Gwaiting)`.
3. Calls `unlockf` (atomically releases caller's lock, e.g., the channel lock).
4. Calls `schedule()` to pick the next goroutine.

The current goroutine resumes only when `goready(gp, traceskip)` is called by some other code path (channel send, mutex unlock, timer fire).

```go
func goready(gp *g, traceskip int) {
    systemstack(func() {
        ready(gp, traceskip, true)
    })
}
```

`ready` calls `casgstatus(_Gwaiting -> _Grunnable)` and pushes the goroutine onto a run queue.

### Wait reasons

The `waitReason` enum (in `runtime2.go`) is the source of the strings you see in goroutine stack dumps. A short selection:

```go
const (
    waitReasonZero                  waitReason = iota
    waitReasonGCAssistMarking
    waitReasonIOWait
    waitReasonChanReceive
    waitReasonChanSend
    waitReasonSelect
    waitReasonSyncCondWait
    waitReasonSemacquire
    waitReasonSleep
    waitReasonGCSweepWait
    // ... ~40 in total
)
```

When you see `[chan receive, 12 minutes]` in `pprof`, that string comes from this enum.

---

## Syscall Transitions

`runtime.entersyscall` is called before a goroutine performs a blocking syscall. From `runtime/proc.go`:

```go
func entersyscall() {
    // simplified
    save(getcallerpc(), getcallersp())
    casgstatus(_Grunning, _Gsyscall)
    pp := mp.p.ptr()
    pp.m = 0
    mp.p = 0
    // ... bookkeeping ...
}
```

The M's P is detached. Another M can pick up the P and continue running other goroutines.

On return from the syscall:

```go
func exitsyscall() {
    if exitsyscallfast() {
        casgstatus(_Gsyscall, _Grunning)
        return
    }
    // slow path
    casgstatus(_Gsyscall, _Grunnable)
    schedule()
}
```

`exitsyscallfast` tries to re-acquire the original P (or any idle P). If successful, the goroutine resumes immediately. Otherwise it becomes `_Grunnable` and the scheduler picks it up later.

---

## Async Preemption and Lifecycle

Since Go 1.14, the runtime can preempt a goroutine at *any* point, not just safe points. The mechanism:

1. The `sysmon` goroutine detects a long-running `_Grunning` goroutine (>10ms on one M).
2. It sends a signal to the M (`SIGURG` on Linux).
3. The signal handler examines the goroutine and, if safe, sets it up to enter `_Gpreempted` and call `gopreempt_m`.
4. The goroutine is parked in `_Gpreempted`, then transitioned to `_Gwaiting` and put on a run queue as `_Grunnable`.

Lifecycle-wise, preemption is invisible. The goroutine sees no change in behavior; only its scheduling timing differs.

The `_Gpreempted` state exists to mark "this goroutine is paused at an arbitrary PC and must be carefully resumed." Other runtime code that wants to scan or move the goroutine respects this state.

---

## Stack Growth: `_Gcopystack`

When a function call would exceed the current stack size, the runtime triggers stack growth:

1. Function prologue checks SP against `stackguard0`.
2. On overflow, calls `runtime.morestack`.
3. `morestack` calls `runtime.newstack`.
4. `newstack` calls `runtime.copystack`.
5. `copystack` transitions the `g` to `_Gcopystack`.
6. New, larger stack is allocated. Old stack contents are copied. Pointers in the stack and in goroutine registers are adjusted.
7. The `g` transitions back to `_Grunning`.

The lifecycle does not change but is momentarily paused. The runtime guarantees no other code touches the `g` during `_Gcopystack`.

---

## Goroutine Profiles

`runtime.GoroutineProfile` returns one `StackRecord` per live goroutine. From the user's perspective:

```go
import "runtime"

records := make([]runtime.StackRecord, 1024)
n, ok := runtime.GoroutineProfile(records)
```

Under the hood, the runtime iterates `allgs` (a slice holding every live `g`), and for each not-`_Gdead` goroutine, walks the stack.

`pprof goroutine` uses this. The output groups goroutines by stack trace. A "leak" appears as a tall bar of identical stacks.

The `debug=2` text format also includes the `waitreason`, `waitsince`, and the creator stack (`gopc`), making it the most actionable debug tool for lifecycle issues.

---

## `runtime/trace` Implementation

`runtime/trace` records every state transition with a nanosecond timestamp. The runtime emits events at:

- `_Grunnable` → `_Grunning` (event `GoStart`)
- `_Grunning` → `_Gwaiting` (event `GoBlock*` with reason)
- `_Gwaiting` → `_Grunnable` (event `GoUnblock`)
- `_Grunning` → `_Gsyscall` (event `GoSysCall`)
- `_Gsyscall` → `_Grunning` (event `GoSysExit`)
- Goroutine creation (event `GoCreate`)
- Goroutine death (event `GoEnd`)

When you open `go tool trace`, you see a timeline of these events per-goroutine. The visualization is the most accurate picture of lifecycle that exists.

---

## Reading the Runtime Source

To go further:

- `runtime/runtime2.go` — `g`, `m`, `p` structs; state constants.
- `runtime/proc.go` — `newproc`, `goexit0`, `gopark`, `goready`, `entersyscall`, `exitsyscall`, `schedule`.
- `runtime/stack.go` — stack growth, `_Gcopystack`.
- `runtime/preempt.go` — async preemption, `_Gpreempted`.
- `runtime/mgc.go` — GC marking, `_Gscan` interactions.
- `runtime/trace2.go` — the tracer.

Build with `-gcflags=all=-l` to disable inlining so stack traces are precise. Use `dlv` (Delve) to step through the runtime.

---

## Summary

At the professional level, the goroutine lifecycle is a precise state machine implemented in `runtime/proc.go`. The states (`_Gidle`, `_Grunnable`, `_Grunning`, `_Gsyscall`, `_Gwaiting`, `_Gdead`, plus `_Gcopystack` and `_Gpreempted`) are constants in `runtime/runtime2.go`. Transitions go through `casgstatus`, which enforces a directed graph of valid moves. Birth is `runtime.newproc`; death is `runtime.goexit0` + `gfput`. Parking is `gopark`; wakeup is `goready`. Syscalls are bracketed by `entersyscall` / `exitsyscall`. Async preemption uses the new `_Gpreempted` state.

The runtime reuses dead `g` structs via per-P and global free lists, which is why `runtime.NumGoroutine` returns the count of *live* goroutines rather than ever-allocated `g`s. Stack growth is a brief `_Gcopystack` interlude. The GC scans live goroutine stacks and uses the `_Gscan` bit to coordinate.

This vocabulary — the actual names, the actual functions — is what you bring to a runtime bug, a strange `pprof` output, or a discussion with the Go team. It is also the foundation for understanding the scheduler internals in [../../10-scheduler-deep-dive](../../10-scheduler-deep-dive/).

See also:

- [02-detecting-leaks](../02-detecting-leaks/) — using runtime introspection to find leaks.
- [03-preventing-leaks](../03-preventing-leaks/) — patterns informed by the runtime model.
- [specification.md](specification.md) — what is in the spec vs what is "just" implementation.
