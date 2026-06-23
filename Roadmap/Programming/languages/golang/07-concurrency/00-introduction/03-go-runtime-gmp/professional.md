# Go Runtime GMP — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [The `g` Struct](#the-g-struct)
3. [The `m` Struct](#the-m-struct)
4. [The `p` Struct](#the-p-struct)
5. [Scheduler Initialisation](#scheduler-initialisation)
6. [The Schedule Loop](#the-schedule-loop)
7. [Sysmon Internals](#sysmon-internals)
8. [Async Preemption Protocol](#async-preemption-protocol)
9. [Scheduler Invariants](#scheduler-invariants)
10. [Reading the Source](#reading-the-source)
11. [Summary](#summary)

---

## Introduction

This file peeks inside the Go runtime's scheduler implementation. Most production engineers never need this level of detail; it is useful for those who:

- Maintain Go runtime forks.
- Build tools (profilers, debuggers, tracing systems).
- Investigate scheduler-related performance issues that resist higher-level analysis.
- Want a deeper appreciation for what the runtime does on your behalf.

The source files of interest are in `src/runtime/`:

- `proc.go` — the scheduler core.
- `runtime2.go` — struct definitions (`g`, `m`, `p`, etc.).
- `sema.go` — semaphore implementation backing channels and mutexes.
- `chan.go` — channels.
- `time.go` — timers.
- `mgcsweep.go`, `mgcmark.go`, `mgc.go` — garbage collector.

Line numbers shift between versions; the layout has been stable for years.

---

## The `g` Struct

A simplified view of `g` (from Go 1.22's `runtime2.go`):

```go
type g struct {
    stack       stack   // [stack.lo, stack.hi) — current stack bounds
    stackguard0 uintptr // checked against stack pointer in prologue
    stackguard1 uintptr // for system stack

    _panic    *_panic   // innermost panic
    _defer    *_defer   // innermost defer

    m         *m      // current M (nil if not running)
    sched     gobuf   // saved scheduling info
    syscallsp uintptr // saved sp for syscalls
    syscallpc uintptr // saved pc for syscalls

    param        unsafe.Pointer // generic param for sleep/wake
    atomicstatus atomic.Uint32  // _Grunnable, _Grunning, _Gwaiting, _Gdead
    schedlink    guintptr       // intrusive linked list for queues
    waitsince    int64          // approx time when blocked
    waitreason   waitReason     // why blocked (channel, mutex, IO, ...)

    preempt       bool     // preemption requested?
    preemptStop   bool     // preempt rather than reschedule
    preemptShrink bool     // shrink stack at next safe point
    asyncSafePoint bool    // at async safe point?

    goid     uint64
    parentGoid uint64
    waiting *sudog // waiting goroutines (for channel ops)
    timer   *timer // for time.Sleep

    // ... many more fields ...
}
```

Key observations:

- **`stack`** is the goroutine's stack range. Growable.
- **`sched`** holds the saved register state (PC, SP) for context switches.
- **`atomicstatus`** is the state machine: `_Gidle → _Grunnable → _Grunning → ... → _Gdead`.
- **`m`** is non-nil only when this G is currently running on an M.
- **`schedlink`** is the intrusive list pointer used to chain G's onto queues.
- **`preempt`** is the cooperative-preemption flag, checked at function prologue.
- **`waiting`** is the list of sudogs (suspended-on-channel records) this G has registered.

### G states

```
_Gidle      0  // just allocated; not yet initialised
_Grunnable  1  // ready to run; in a runqueue
_Grunning   2  // currently running on an M
_Gsyscall   3  // executing a syscall (off-CPU but consuming an M)
_Gwaiting   4  // blocked (channel, mutex, IO, sleep)
_Gdead      6  // finished; struct may be reused
_Gcopystack 8  // stack being copied (grow / shrink)
_Gpreempted 9  // suspended for preemption
```

The state transitions are well-defined; transitions go through atomic CAS.

### Stack management

Each G starts with an ~2 KB stack. Stack overflow is detected by the function prologue:

```
SP < stackguard0 ? grow
```

When growth is needed, the runtime allocates a 2x larger stack, copies the old contents (re-relocating pointers), updates `stackguard0`, and resumes. Shrinks happen during GC if the stack is mostly empty.

The stack is *not* contiguous with the M's OS stack. Each G has its own stack; M's `g0` has the system stack.

---

## The `m` Struct

A simplified view of `m`:

```go
type m struct {
    g0          *g     // scheduler goroutine (system stack)
    gsignal     *g     // signal-handling goroutine
    tls         [6]uintptr // thread-local storage slots
    mstartfn    func()
    curg        *g     // current G being executed
    caughtsig   guintptr
    p           puintptr // attached P (nil if none)
    nextp       puintptr // next P after current G blocks
    oldp        puintptr // saved during syscalls

    id          int64
    mallocing   int32
    throwing    int32
    preemptoff  string  // if != "", keep curg from preempting
    locks       int32   // count of held locks
    dying       int32
    profilehz   int32

    spinning      bool   // looking for work
    blocked       bool   // blocked on note
    inwb          bool   // in write barrier
    newSigstack   bool

    schedlink   muintptr // for the M idle list
    lockedg     guintptr // G locked to this M via LockOSThread
    ...
}
```

Key fields:

- **`g0`** is a special G whose stack is the OS thread's stack. The scheduler runs on `g0` when between user goroutines.
- **`curg`** is the user G currently executing on this M.
- **`p`** is the attached P; nil if this M has no P (in syscall or idle).
- **`spinning`** indicates the M is actively looking for work (not yet parked). Used in the scheduler to avoid creating new M's when others are searching.
- **`lockedg`** is the goroutine locked to this M (via `runtime.LockOSThread`).

### M creation

M's are created via `clone()` on Linux, `pthread_create` elsewhere, when:

- A goroutine blocks on a syscall and another runnable G is waiting.
- Sysmon decides to wake a new M to balance load.
- The runtime starts up (initial M is the main thread).

M's are pooled. A parked M sits in `sched.midle`; the runtime reuses it.

---

## The `p` Struct

A simplified view of `p`:

```go
type p struct {
    id      int32
    status  uint32 // _Pidle, _Prunning, _Psyscall, _Pgcstop, _Pdead
    link    puintptr

    schedtick   uint32  // incremented on each scheduler call
    syscalltick uint32  // incremented on each syscall

    m       muintptr // back-link to current M

    // run queue (lock-free)
    runqhead uint32
    runqtail uint32
    runq     [256]guintptr

    runnext guintptr // priority slot for freshly spawned G

    // per-P allocator cache
    mcache *mcache

    // per-P GC state
    gcAssistTime int64
    gcFractionalMarkTime int64

    // per-P timer heap
    timers []*timer

    // ... many more fields ...
}
```

Key fields:

- **`runq`** is the local run queue, 256 slots, lock-free via `runqhead` / `runqtail` indices.
- **`runnext`** is the priority slot for the most recently spawned G.
- **`mcache`** is per-P allocator cache — fast path for small allocations without locking.
- **`timers`** is the per-P timer heap (since Go 1.14).

### P states

```
_Pidle     0 // not in use
_Prunning  1 // assigned to an M
_Psyscall  2 // attached M is in a syscall
_Pgcstop   3 // GC is running
_Pdead     4 // unused
```

### runq operations

`runqput(p, g, next)` adds a G to the queue:
- If `next == true`, place in `runnext` (push previous occupant to `runq` if needed).
- Else, push to `runqtail`. If queue is full, move half to global queue.

`runqget(p)` takes a G:
- First try `runnext`.
- Else pop from `runqhead`.

`runqsteal(p2, p)` steals half of `p2`'s queue into `p`.

These operations are lock-free for the owning M; stealers use atomic CAS.

---

## Scheduler Initialisation

`runtime.schedinit()` runs at program startup:

1. Detects `GOMAXPROCS` (from env or `NumCPU`).
2. Allocates the P array.
3. Initialises sysmon as a special M.
4. Sets up the global queue.
5. Starts the initial M (main goroutine).

The first user goroutine is the `main` function, scheduled onto an M holding a P.

After init, the scheduler is on autopilot.

---

## The Schedule Loop

The function `schedule()` in `proc.go` is the heart of the scheduler. Simplified pseudo-code:

```go
func schedule() {
    mp := getg().m
    pp := mp.p.ptr()

top:
    if pp.runqsize() == 0 {
        // Every 61 iterations, check global queue first
        if pp.schedtick%61 == 0 {
            gp := globrunqget(pp, 1)
            if gp != nil { execute(gp); return }
        }
    }

    // Local queue
    gp := runqget(pp)
    if gp != nil { execute(gp); return }

    // Global queue
    gp = globrunqget(pp, 0)
    if gp != nil { execute(gp); return }

    // Netpoll (non-blocking)
    if netpollinited() && atomic.Load(&netpollWaiters) > 0 {
        gp = netpoll(false)
        if gp != nil {
            injectglist(gp)
            goto top
        }
    }

    // Work stealing
    for i := 0; i < 4; i++ {
        victim := randomP()
        gp = runqsteal(pp, victim, ...)
        if gp != nil { execute(gp); return }
    }

    // Blocking netpoll
    if netpollinited() {
        gp = netpoll(true)
        if gp != nil {
            injectglist(gp)
            goto top
        }
    }

    // Park
    stopm()
}
```

After parking, when woken (by `wakep()`), the M starts the loop again.

The real code is more intricate — it handles spinning M counts, P stealing, GC coordination, finaliser dispatching, etc. But the high-level shape matches the above.

---

## Sysmon Internals

`sysmon()` runs in a dedicated M without a P. Its loop:

```go
func sysmon() {
    for {
        usleep(delay)
        if shouldGC() { gcTrigger() }
        retake() // detach P from M's in long syscalls
        forcegc() // if too long since last GC
        scvg() // scavenge unused memory
        ...
    }
}
```

The `delay` starts at 20 µs and grows up to 10 ms when idle. The growth is to reduce sysmon's own CPU consumption.

### `retake()`

```go
for each P:
    if P.status == _Psyscall:
        if now - P.syscalltick > 20µs:
            // Forcibly detach P from the M
            handoffp(P)
    elif P.status == _Prunning:
        if G has been running > 10ms:
            preemptone(P) // signal preemption
```

### `preemptone()`

Sets `g.preempt = true` on the running G. In Go 1.14+, also sends `SIGURG` to the M to trigger async preemption.

---

## Async Preemption Protocol

Async preemption (Go 1.14+) lets the scheduler interrupt tight loops with no function calls.

### How it works

1. Sysmon notices G has been running > 10 ms.
2. Sysmon sends `SIGURG` to the M.
3. The signal handler runs: `runtime.asyncPreempt`.
4. The handler examines the G's PC. Is it at an "async-safe" point?
5. If yes, save state and yield. The runtime resumes the G later, restoring state.
6. If no, ignore the signal — try again next time.

### Async-safe points

Most Go code is async-safe at any instruction. The exceptions:

- Inside the runtime's critical sections.
- During stack growth.
- During GC marking.
- A few low-level operations.

The compiler emits metadata (in `pcdata` / `funcdata`) telling the signal handler what state the registers are in at each PC. The handler uses this to construct a `gobuf` (saved register state) and yield.

### Cost

Async preemption costs ~1 µs per preemption (signal handling + state save/restore + scheduling). Negligible compared to a 10 ms quantum.

### Limitations

- Cgo code is not preemptible (the M is in C land).
- Some runtime functions are non-preemptive.
- Locked goroutines (`LockOSThread`) preempt within their thread but cannot move.

---

## Scheduler Invariants

Several invariants the runtime maintains:

1. **A G is on at most one queue at a time.** Local runq, global runq, or wait queue.
2. **A G in `_Grunning` state has a non-nil `m`.** Conversely, `g.m == nil` ⇒ G is not running.
3. **An M with `p != nil` is running Go code; `p == nil` means syscall or idle.**
4. **The number of M's running Go code is at most `GOMAXPROCS` at any time.**
5. **`sched.lock` protects only the global queue and a few global fields.** Per-P state is lock-free.
6. **Sysmon never holds a P.** It runs on its own M.
7. **A G locked to an M via `LockOSThread` runs only on that M.**

Violations of these invariants are runtime bugs and trigger `throw()` panics.

---

## Reading the Source

If you want to dig deeper:

- `src/runtime/proc.go` — start here. The scheduler core.
- `src/runtime/runtime2.go` — struct definitions.
- `src/runtime/lock_futex.go` — low-level locking (Linux).
- `src/runtime/sema.go` — semaphores backing `sync.Mutex` etc.
- `src/runtime/preempt.go` — async preemption.
- `src/runtime/sigqueue.go` — signal handling.

The code is C-like Go with extensive comments. Reading it is a graduate-level exercise but rewarding.

Useful starting points:

- `runtime.main` — what runs before your `main()`.
- `runtime.newproc` — what `go f()` invokes.
- `runtime.gopark` — how a goroutine blocks.
- `runtime.goready` — how a goroutine becomes runnable.
- `runtime.findrunnable` — work stealing.
- `runtime.entersyscall` / `exitsyscall` — syscall integration.

The runtime is built with a specially-handled compilation: parts are written in assembly, parts have unsafe-go conventions. Read with care.

### Tools

- `go build -gcflags="-m"` shows escape analysis decisions.
- `objdump` on the binary shows generated assembly.
- `delve` debugger can step through runtime code (set `GOFLAGS=-tags=noasynchronous` for older Go).

---

## Summary

The Go scheduler is implemented in roughly 5000 lines of Go (plus assembly) in `src/runtime/`. The G, M, P structs hold goroutine, OS thread, and processor state respectively. The schedule loop (`schedule()` and `findrunnable()`) picks the next goroutine, with work stealing and netpoll as fallbacks. Sysmon runs in the background, retaking P's, preempting long-running G's, and dispatching GC.

Async preemption (Go 1.14+) makes tight loops preemptible via signals — `SIGURG` on Unix. The signal handler examines the PC, finds a safe point, and yields.

Reading the source rewards deep understanding. The runtime is one of the highest-quality concurrent codebases in any language, with careful attention to lock-free operations, cache locality, and invariants.

The specification file (next) gathers references for those who want to verify claims against authoritative documentation.
