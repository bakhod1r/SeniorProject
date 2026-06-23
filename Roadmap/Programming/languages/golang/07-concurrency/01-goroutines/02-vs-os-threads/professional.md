# Goroutines vs OS Threads — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [How the Runtime Creates an M](#how-the-runtime-creates-an-m)
3. [M States in the Runtime](#m-states-in-the-runtime)
4. [The `entersyscall` / `exitsyscall` Dance](#the-entersyscall--exitsyscall-dance)
5. [The Netpoller — Implementation](#the-netpoller--implementation)
6. [Sysmon — The Background Monitor](#sysmon--the-background-monitor)
7. [How `LockOSThread` Is Implemented](#how-lockosthread-is-implemented)
8. [Signal Delivery to Ms](#signal-delivery-to-ms)
9. [`clone(2)` Flags Used by the Runtime](#clone2-flags-used-by-the-runtime)
10. [Stack Allocation for Ms vs Goroutines](#stack-allocation-for-ms-vs-goroutines)
11. [Async Preemption Internals](#async-preemption-internals)
12. [Cgo Internals](#cgo-internals)
13. [`/sched/threads` Telemetry](#schedthreads-telemetry)
14. [Reading the Runtime Source](#reading-the-runtime-source)
15. [Summary](#summary)

---

## Introduction

The professional level is where the runtime stops being a black box. You read `src/runtime/proc.go`, you trace `clone(2)` syscalls, you understand why an M parked in a cgo call cannot serve another goroutine — and you know which file, in the Go source, makes that decision.

This document maps the conceptual model of "goroutines and threads" onto the actual runtime code. References are to Go 1.22 source, with line numbers approximate (subject to drift between minor versions).

---

## How the Runtime Creates an M

When the scheduler needs more parallelism (an idle P with no M), it calls `runtime.startm` (`runtime/proc.go`):

```
startm()
  if mp == nil:
    newm(fn=nil, _p_=p)
      mp = allocm(_p_, fn)
      newm1(mp)
        // platform-specific
        newosproc(mp)
```

On Linux, `newosproc` calls `clone(2)` directly with carefully chosen flags. From `runtime/os_linux.go`:

```go
func newosproc(mp *m) {
    stk := unsafe.Pointer(mp.g0.stack.hi)
    ret := retryOnEAGAIN(func() int32 {
        r := clone(cloneFlags, stk, unsafe.Pointer(mp), unsafe.Pointer(mp.g0), unsafe.Pointer(abi.FuncPCABI0(mstart)))
        if r >= 0 {
            return 0
        }
        return -r
    })
    if ret != 0 {
        // EAGAIN/EPERM — fatal
    }
}
```

Where `cloneFlags` is:

```go
const cloneFlags = _CLONE_VM | _CLONE_FS | _CLONE_FILES | _CLONE_SIGHAND |
    _CLONE_SYSVSEM | _CLONE_THREAD
```

These flags mean:

| Flag | Meaning |
|---|---|
| `CLONE_VM` | Share the parent's memory. |
| `CLONE_FS` | Share filesystem info (cwd, root, umask). |
| `CLONE_FILES` | Share the file descriptor table. |
| `CLONE_SIGHAND` | Share signal handlers. |
| `CLONE_SYSVSEM` | Share System V semaphores. |
| `CLONE_THREAD` | The new task is in the same thread group as the caller — i.e., it's a thread, not a process. |

This is the same set of flags `glibc`'s `pthread_create` uses. From the kernel's perspective, the Go runtime is creating a POSIX thread.

The new M starts executing at `mstart` (assembly), which calls `mstart0` → `mstart1` → the M-main loop in `schedule()`.

---

## M States in the Runtime

An M (struct `m` in `runtime/runtime2.go`) carries dozens of fields. Key state variables:

| Field | Purpose |
|---|---|
| `g0` | The M's "system goroutine" — runs scheduler code, GC, stack growth. Has a large (~8 KB or more) stack on the OS thread. |
| `curg` | The currently executing user goroutine on this M (or nil). |
| `p` | The current P bound to this M (or nil if detached). |
| `nextp` | A P to be associated when M resumes from syscall. |
| `oldp` | Previous P, kept for hint when re-attaching. |
| `spinning` | True if the M is actively looking for work (briefly burns CPU). |
| `blocked` | True if the M is parked. |
| `incgo` | True during a cgo call. |
| `mLockProfile` | Tracks Lock contention for pprof. |
| `lockedg` | If non-nil, this M is locked to `lockedg` (via `LockOSThread`). |

### M lifecycle states

```
Created (newosproc, mstart)
       |
       v
    Spinning  <----+
       |           |
       v           |
    Running G      |
       |           |
       +--> Syscall (enterSyscall)
       |        |
       |        v
       |     Detached from P
       |        |
       |        v (syscall returns)
       |     Re-attach or park
       |
       +--> Cgo call (similar to syscall)
       |
       +--> Park (no work, M-pool)
       |
       v
    Destroyed (rare; usually returned to M-pool)
```

The runtime keeps a free list of parked Ms in `sched.midle`. When the scheduler needs an M, it pulls from this list first; only if empty does it `clone(2)`.

---

## The `entersyscall` / `exitsyscall` Dance

The compiler inserts `runtime.entersyscall` and `runtime.exitsyscall` around each syscall. From `runtime/proc.go`:

```go
func entersyscall() {
    reentersyscall(getcallerpc(), getcallersp())
}

func reentersyscall(pc, sp uintptr) {
    gp := getg()
    // ... save registers ...
    save(pc, sp)
    gp.syscallsp = sp
    gp.syscallpc = pc
    casgstatus(gp, _Grunning, _Gsyscall)

    if sched.sysmonwait.Load() {
        systemstack(entersyscall_sysmon)
    }

    pp := gp.m.p.ptr()
    pp.m = 0
    gp.m.oldp.set(pp)
    gp.m.p = 0
    atomic.Store(&pp.status, _Psyscall)
    // ... handoff logic ...
}
```

Key points:

1. The G's status goes from `_Grunning` to `_Gsyscall`.
2. The P's status goes to `_Psyscall`. It is still associated with this M's `oldp`, but the `m.p` field is cleared.
3. If `sysmonwait` is set, the sysmon goroutine is woken — it will eventually hand off the P if the syscall takes too long.

`sysmon` (covered below) checks every ~20 µs:

```go
// In retake(), inside sysmon
for i := 0; i < len(allp); i++ {
    pp := allp[i]
    if pp.status == _Psyscall {
        t := pp.syscalltick
        if pp.syscallwhen + 10*1000 < now { // 10 µs
            if atomic.Cas(&pp.status, _Psyscall, _Pidle) {
                handoffp(pp)
            }
        }
    }
}
```

If a P has been in `_Psyscall` for > 10 µs, `handoffp` is called: the P is detached from the syscalling M and given to a fresh M (potentially newly created).

When the syscall returns, `exitsyscall` runs:

```go
func exitsyscall() {
    gp := getg()
    oldp := gp.m.oldp.ptr()
    gp.m.oldp = 0

    if exitsyscallfast(oldp) {
        // Re-acquired oldp; resume immediately.
        casgstatus(gp, _Gsyscall, _Grunning)
        return
    }
    // Slow path: park M, schedule G to run later.
    mcall(exitsyscall0)
}
```

The "fast path" tries to re-attach to `oldp` without going through the scheduler. If `oldp` was handed off to another M, the slow path takes over: M parks itself, the G is placed back on a runqueue.

---

## The Netpoller — Implementation

The netpoller lives in `runtime/netpoll.go` (cross-platform) plus per-OS files: `netpoll_epoll.go` (Linux), `netpoll_kqueue.go` (BSD/macOS), `netpoll_windows.go`.

### Registration

When the runtime sees the first call to `runtime_pollOpen` (from `internal/poll`), it sets the fd to non-blocking and registers it with `epoll`:

```go
// Linux
func netpollopen(fd uintptr, pd *pollDesc) int32 {
    var ev epollevent
    ev.events = _EPOLLIN | _EPOLLOUT | _EPOLLRDHUP | _EPOLLET
    *(**pollDesc)(unsafe.Pointer(&ev.data)) = pd
    return -epollctl(epfd, _EPOLL_CTL_ADD, int32(fd), &ev)
}
```

Note `_EPOLLET` — edge-triggered. This is important because level-triggered would wake the runtime continuously.

### Parking on a fd

When a goroutine calls `read` on a non-ready fd, it calls `netpollblock(pd, mode)`:

```go
func netpollblock(pd *pollDesc, mode int32, waitio bool) bool {
    gpp := &pd.rg
    if mode == 'w' { gpp = &pd.wg }
    for {
        // Park the current G against pd.
        if gpp.CompareAndSwap(0, pdWait) {
            break
        }
    }
    if waitio || netpollcheckerr(pd, mode) == 0 {
        gopark(netpollblockcommit, unsafe.Pointer(gpp), waitReasonIOWait, traceBlockNet, 5)
    }
    // ... resume path ...
}
```

`gopark` is the runtime's "put this goroutine to sleep" primitive. The goroutine state becomes `_Gwaiting`. The M is freed to schedule other work.

### Waking via `epoll_wait`

The scheduler's findRunnable function periodically calls `netpoll`:

```go
// Linux
func netpoll(delay int64) gList {
    var waitms int32
    if delay < 0 { waitms = -1 }
    else if delay == 0 { waitms = 0 }
    else if delay < 1e6 { waitms = 1 }
    else if delay < 1e15 { waitms = int32(delay / 1e6) }
    else { waitms = 1e9 }

    var events [128]epollevent
    n := epollwait(epfd, &events[0], int32(len(events)), waitms)
    var toRun gList
    for i := int32(0); i < n; i++ {
        ev := &events[i]
        pd := *(**pollDesc)(unsafe.Pointer(&ev.data))
        netpollready(&toRun, pd, mode)
    }
    return toRun
}
```

`netpollready` finds the parked goroutine and adds it to the run list. The scheduler picks up these goroutines for execution.

### Why this is fast

- No M is held while a goroutine is parked on an fd.
- `epoll_wait` is the only kernel-side blocking call; one M serves arbitrarily many fds.
- Edge-triggered avoids re-firing on the same readiness.

---

## Sysmon — The Background Monitor

`runtime.sysmon` is a special goroutine that does *not* require a P. It runs on its own M (the "sysmon thread") and is launched at program start. From `runtime/proc.go`:

```go
func sysmon() {
    for {
        if idle == 0 {
            delay = 20  // 20 µs
        } else if idle > 50 {
            delay *= 2
        }
        if delay > 10*1000 { delay = 10 * 1000 } // cap at 10 ms

        usleep(delay)

        // Various periodic tasks:
        retake(now)         // preempt long-running Gs, hand off syscall Ps
        injectglist(...)    // wake idle Ms when work is pending
        forcegcperiod check
        scavengeheap check
    }
}
```

Periods of interest:

| Task | Frequency |
|---|---|
| Preempt long-running G (cooperative) | every 10 ms |
| Force preemption (async, signal-based) | every 10 ms |
| Hand off P from syscalling M | when syscall > 10 µs |
| Scavenge heap | every ~5 min if idle |
| Force GC | if no GC for 2 min |

Sysmon is critical: without it, syscall handoff would never happen, and stuck Gs would never get preempted. The cost is one M permanently dedicated.

---

## How `LockOSThread` Is Implemented

`runtime.LockOSThread` is conceptually simple but the implementation has subtleties. From `runtime/proc.go`:

```go
func LockOSThread() {
    if atomic.Load(&newmHandoff.haveTemplateThread) == 0 && GOOS != "plan9" {
        // Start the template thread so child processes inherit it.
        startTemplateThread()
    }
    gp := getg()
    gp.m.lockedExt++
    if gp.m.lockedExt == 0 {
        // overflow
        throw("LockOSThread nesting overflow")
    }
    dolockOSThread()
}

func dolockOSThread() {
    if GOARCH == "wasm" { return }
    gp := getg()
    gp.m.lockedg.set(gp)
    gp.lockedm.set(gp.m)
}
```

The cross-pointer between `g.lockedm` and `m.lockedg` is the lock. The scheduler checks these in `findRunnable`:

```go
func findRunnable() (gp *g, inheritTime, tryWakeP bool) {
    // ...
    // Don't steal from a P with a locked G.
    if pp.runq.size() > 0 && pp.runq.peek().lockedm != 0 {
        // skip
    }
    // ...
}
```

A locked G stays on its M. When the locked G is dequeued, only its locked M can pick it up. When the M finds work, it checks if the work belongs to a locked G — if so, the M signals "wake the right M" and parks if it is not the right one.

### `UnlockOSThread`

```go
func UnlockOSThread() {
    gp := getg()
    if gp.m.lockedExt == 0 {
        return
    }
    gp.m.lockedExt--
    dounlockOSThread()
}

func dounlockOSThread() {
    if GOARCH == "wasm" { return }
    gp := getg()
    if gp.m.lockedInt != 0 || gp.m.lockedExt != 0 {
        return
    }
    gp.m.lockedg = 0
    gp.lockedm = 0
}
```

The pinning is released only when both internal and external lock counts reach 0. (`lockedInt` is for runtime-internal pins; `lockedExt` is for user code.)

### What happens when a locked G exits?

`gdestroy` (called when G returns) checks `lockedm`:

```go
if gp.lockedm != 0 {
    if gp.m.lockedg.ptr() == gp {
        gp.m.lockedExt = 0
        gp.m.lockedInt = 0
        gp.m.lockedg.set(nil)
    }
    if mp := gp.lockedm.ptr(); mp != gp.m {
        // Shouldn't happen.
    }
    gp.lockedm.set(nil)
}
```

After this the M may be reused or destroyed. The runtime is conservative: if `LockOSThread` was used for OS state (e.g., `setns`), the runtime cannot easily "reset" the thread, so it destroys it.

---

## Signal Delivery to Ms

The runtime installs signal handlers in `runtime/signal_unix.go` via `sigaction` (Linux). The handler is `sigtramp` (assembly), which dispatches to `sigtrampgo`:

```go
func sigtrampgo(sig uint32, info *siginfo, ctx unsafe.Pointer) {
    gp := getg()
    mp := gp.m
    // Determine if this is a Go signal or a foreign signal.
    if sigfwdgo(sig, info, ctx) {
        return
    }
    // Otherwise handle as Go signal.
    sighandler(sig, info, ctx, gp)
}
```

For `signal.Notify`, the runtime maintains a single signal-receiving goroutine. `sighandler` queues the signal to that goroutine.

For internal signals (`SIGURG` for async preemption, `SIGPROF` for the CPU profiler), the runtime handles them directly in `sighandler`.

### Async preemption via `SIGURG`

When sysmon decides to preempt a long-running G, it calls `preemptM(mp)` (`runtime/preempt.go`), which sends `SIGURG` to the M's underlying thread (via `tgkill(2)` on Linux). The signal handler arranges for the G to resume at a "safe point" where the runtime can save its state and deschedule it.

The signal handler does *not* actually preempt the goroutine inline. Instead it modifies the G's saved PC to point to `asyncPreempt`, an assembly stub that calls the scheduler. When the G next runs, it immediately enters `asyncPreempt` and gives up the CPU.

### Why `SIGURG`?

It is rarely used by other software, has no kernel-defined "default action" beyond ignoring, and is reliably deliverable. The runtime documentation: "SIGURG was chosen because it has the most useful properties for this purpose."

---

## `clone(2)` Flags Used by the Runtime

Recap of the runtime's clone flags and what they imply:

```
_CLONE_VM       — share memory (must, otherwise it's a fork)
_CLONE_FS       — share filesystem info (so chdir from any thread is global)
_CLONE_FILES    — share fd table (a socket opened in one thread is visible in all)
_CLONE_SIGHAND  — share signal disposition (one process-wide handler table)
_CLONE_SYSVSEM  — share System V semaphores
_CLONE_THREAD   — same thread group, same PID, separate TID
```

Notable absences:

- `CLONE_NEWNS` and other namespace flags. Go does not auto-namespace child threads.
- `CLONE_SETTLS` is set internally by the runtime via assembly to install the M's TLS.
- `CLONE_CHILD_CLEARTID`, `CLONE_CHILD_SETTID`: set, with the TID stored in the M struct for sysmon's use.

For comparison, `fork(2)` uses no `CLONE_VM` — the child gets a copy of memory. Go's `os/exec` uses `clone(CLONE_VM | CLONE_VFORK | SIGCHLD)` for posix_spawn-style spawn, which is much faster than fork+exec.

---

## Stack Allocation for Ms vs Goroutines

Two stacks per M, two per goroutine:

| Stack | Used for | Size |
|---|---|---|
| `M.g0.stack` | The M's "system stack" — runs scheduler, GC, stack growth | Allocated on the OS thread; 8 KB+ |
| `M.gsignal.stack` | The signal-handling stack | Allocated; ~32 KB |
| `G.stack` | The goroutine's user-code stack | Allocated on demand; starts at 2 KB |
| `G.stackguard0` | Stack growth check pointer | Marker, not a stack itself |

OS-thread-level stacks (`g0`, `gsignal`) are allocated via `mmap` directly. They live as long as the M.

Goroutine stacks come from the runtime's stack pool. When a G needs more stack, the runtime allocates a new stack (typically double size) and copies. This is **not** the same as thread stack — thread stacks cannot grow because they would need to be remapped, which the OS does not support.

The original 2 KB goroutine stack lives in a "stack pool" segregated by size class. After a G exits, its stack is returned to the pool for reuse. This is how goroutine creation is fast: no allocation, just pool pop.

---

## Async Preemption Internals

The full async preemption flow:

1. **Decision**: sysmon notices a G has run for > 10 ms without yielding. Calls `preemptM(mp)`.
2. **Signal**: `preemptM` calls `tgkill(tid, SIGURG)` on Linux. The kernel queues the signal.
3. **Delivery**: the kernel delivers `SIGURG` to thread `tid`. The Go signal handler (`sigtrampgo`) runs.
4. **Inspection**: the handler checks if the signal is for preemption (`sigPreempt`). If so:
5. **Safety check**: is the goroutine at a "preemptable PC"? Some PCs (in assembly, inside cgo, inside runtime critical sections) are not safe to preempt.
6. **If safe**: the handler modifies the `ucontext`'s PC to point at `asyncPreempt2` (an assembly stub). The signal handler returns; the thread resumes at `asyncPreempt2`.
7. **`asyncPreempt2`**: saves all registers (it must save *everything* because the preempted code may have been doing anything). Calls back into the scheduler via `gopreempt_m`.
8. **Reschedule**: `gopreempt_m` puts the G back on a runqueue and calls `schedule()` to pick a new G.

This is one of the most intricate pieces of the runtime. It is what allows Go 1.14+ to preempt arbitrary code, including pure-arithmetic loops that have no function calls.

Reference: `runtime/preempt.go`, `runtime/signal_unix.go`, `runtime/preempt_arm64.s` (and other arches).

---

## Cgo Internals

Each cgo call (`C.foo()`) is wrapped by the cgo tool with a Go function that:

1. Calls `runtime.cgocall(fn, arg)`.
2. `cgocall` sets `m.incgo = true`.
3. `cgocall` invokes `entersyscall` (so the P can be handed off).
4. `cgocall` calls `asmcgocall` (assembly), which switches to the M's `g0` system stack and invokes the C function.
5. C function runs. The Go runtime is now passive on this M.
6. When C returns, `asmcgocall` switches back. `cgocall` calls `exitsyscall`.

During the cgo call:

- The M's P is detached.
- Other Ms can pick up Gs from that P.
- If many Ms are simultaneously in cgo, the runtime creates more Ms.

After the cgo call:

- The M tries to re-attach to a P.
- If no P available, M parks.

### Cgo callback (C calling Go)

Some cgo libraries (e.g., a C library that takes a callback) call into Go. The Go-side entry is `crosscall2` (assembly), which:

1. Calls `runtime.cgocallback`.
2. `cgocallback` may need to spin up runtime state if this is a fresh thread (created by C, not by Go).
3. Runs the Go function with a Go G temporarily attached.
4. Returns to C.

This is expensive — much more than a cgo call from Go to C. Avoid frequent C → Go callbacks.

---

## `/sched/threads` Telemetry

Go 1.21 added the `runtime/metrics` API. From `runtime/metrics/description.go`:

```go
{
    Name: "/sched/gomaxprocs:threads",
    Description: "The current runtime.GOMAXPROCS setting, or the number of operating system threads that can execute user-level Go code simultaneously.",
    Kind: KindUint64,
}
```

There is no first-class "total thread count" metric exposed (yet). Common ways to get the count:

### Linux

```go
data, _ := os.ReadFile("/proc/self/status")
for _, line := range strings.Split(string(data), "\n") {
    if strings.HasPrefix(line, "Threads:") {
        fmt.Println(strings.TrimSpace(strings.TrimPrefix(line, "Threads:")))
    }
}
```

### Cross-platform via reflection on `_runtime`

There is no public API. Workaround: use `runtime.GOMAXPROCS(0)` plus a hand-tuned constant for sysmon/GC overhead, or rely on `/sched/threads:threads` if it lands in a future Go version.

For now, scrape `/proc/self/status` on Linux; on macOS use `sysctl` or `task_info`; on Windows use `GetProcessTimes` and other Win32 APIs.

---

## Reading the Runtime Source

The Go runtime source is in `src/runtime/` of the Go repo. Key files:

| File | Purpose |
|---|---|
| `proc.go` | Scheduler: `schedule`, `findRunnable`, `entersyscall`, `exitsyscall`, `sysmon`, `LockOSThread` |
| `runtime2.go` | Type definitions for `g`, `m`, `p`, `sched` |
| `os_linux.go` | Linux-specific: `newosproc`, `osinit`, `mpreinit` |
| `signal_unix.go` | Signal handling, async preemption signal delivery |
| `preempt.go` | Async preemption decision logic |
| `netpoll.go` | Netpoller core |
| `netpoll_epoll.go` | Linux epoll implementation |
| `cgocall.go` | Cgo call entry / exit |
| `mheap.go` | Stack pool, heap management |

A productive way to learn: pick a behaviour (e.g., "what happens when I call `time.Sleep`?"), find the entry point (`time.Sleep`), and trace it through the runtime. You will encounter `gopark`, the timer heap, and `netpoll` integration.

### `HACKING.md`

`src/runtime/HACKING.md` is required reading. Covers scheduler invariants, GC interaction, stack semantics, and how to debug runtime issues.

### Design docs

The `golang/proposal` repo has design docs for major runtime changes. Notable:

- 24543: Non-cooperative goroutine preemption (Go 1.14).
- 36365: Improve `runtime.LockOSThread` (Go 1.10).
- 19367: Loosely-coupled `GOMAXPROCS` and CPU quota (Go 1.16-ish discussion).

---

## Summary

The professional view of goroutines vs OS threads is *grounded in the runtime source*. You can answer:

- **How is a goroutine created?** `runtime.newproc` → `g` struct, 2 KB stack, runqueue push.
- **How is an M created?** `runtime.newm` → `clone(2)` with specific flags → `mstart` → scheduler loop.
- **How does a blocking syscall not block the program?** `entersyscall` detaches P; sysmon hands it off if syscall > 10 µs; `exitsyscall` re-attaches or parks the M.
- **How does network I/O avoid M cost?** Netpoller registers fd with `epoll`, parks the goroutine, wakes via `epoll_wait` in any M.
- **How is `LockOSThread` enforced?** Cross-pointers `g.lockedm` and `m.lockedg`; scheduler skips locked Gs when stealing.
- **How does async preemption work?** Sysmon → `SIGURG` → signal handler modifies PC to `asyncPreempt` stub → reschedule.
- **What does cgo cost?** Each call holds an M; the runtime spawns extra Ms under load.

At this level the runtime is no longer magic. It is a well-engineered, ~50 kloc C-like program shipped as part of every Go binary, and you can read it.

Next level (specification) catalogues the formal language and runtime guarantees, plus references the POSIX threads and Linux clone(2) standards that the runtime sits on top of.
