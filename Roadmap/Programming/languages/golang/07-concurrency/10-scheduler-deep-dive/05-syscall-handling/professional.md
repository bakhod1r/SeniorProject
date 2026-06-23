# Syscall Handling — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [Source Files You Will Read](#source-files-you-will-read)
3. [`reentersyscall` Line by Line](#reentersyscall-line-by-line)
4. [`exitsyscall` and the Fast/Slow Branch](#exitsyscall-and-the-fastslow-branch)
5. [`exitsyscallfast` Internals](#exitsyscallfast-internals)
6. [`sysmon` Loop and `retake` for `_Psyscall`](#sysmon-loop-and-retake-for-_psyscall)
7. [`handoffp` Implementation](#handoffp-implementation)
8. [The `_Psyscall` State Machine](#the-_psyscall-state-machine)
9. [Per-Platform Thread Creation: `newosproc`](#per-platform-thread-creation-newosproc)
10. [The Netpoller Init and Wakeup Paths](#the-netpoller-init-and-wakeup-paths)
11. [`entersyscallblock` — the Pre-Emptive Handoff](#entersyscallblock--the-pre-emptive-handoff)
12. [Cgo Call Internals](#cgo-call-internals)
13. [Locked Goroutines Across Syscalls](#locked-goroutines-across-syscalls)
14. [Reading Runtime Telemetry from C Code](#reading-runtime-telemetry-from-c-code)
15. [Summary](#summary)

---

## Introduction

At professional level you read the Go runtime source. You can point to the exact lines that implement syscall handoff, sysmon's check, and per-OS thread creation. You can patch the runtime to add diagnostics or experiment with alternative policies.

References are to Go 1.22 source, with file paths relative to `src/runtime/`. Line numbers drift between minor versions; the structure is stable. Open the source in another window as you read.

The mental model from middle and senior pages stays the same — we are now annotating it with code citations.

---

## Source Files You Will Read

| File | Contents |
|---|---|
| `runtime2.go` | Type definitions for `g`, `m`, `p`, `sched`, state constants like `_Psyscall`. |
| `proc.go` | Scheduler core: `entersyscall`, `exitsyscall`, `sysmon`, `handoffp`, `schedule`, `findRunnable`. |
| `os_linux.go` | Linux `newosproc` (calls `clone(2)`), signal init, OS time. |
| `os_darwin.go` | macOS `newosproc` (uses `bsdthread_create`). |
| `os_windows.go` | Windows `newosproc` (`CreateThread`). |
| `netpoll.go` | Cross-platform netpoller core. |
| `netpoll_epoll.go` | Linux epoll integration. |
| `netpoll_kqueue.go` | BSD/macOS kqueue integration. |
| `cgocall.go` | `cgocall`, `cgocallback`, cgo M state. |
| `preempt.go` | Async preemption (touches syscall paths). |
| `sys_linux_amd64.s` | Assembly syscall stubs (where `entersyscall`/`exitsyscall` are emitted around `SYSCALL`). |

`HACKING.md` (alongside the source) is required prerequisite reading.

---

## `reentersyscall` Line by Line

`runtime.entersyscall` is a thin wrapper:

```go
//go:nosplit
func entersyscall() {
    reentersyscall(getcallerpc(), getcallersp())
}
```

The real work is `reentersyscall`:

```go
//go:nosplit
func reentersyscall(pc, sp uintptr) {
    gp := getg()

    // Disable preemption because we hold m.p.
    gp.m.locks++
    gp.stackguard0 = stackPreempt
    gp.throwsplit = true

    // Leave SP and PC for trace.
    save(pc, sp)
    gp.syscallsp = sp
    gp.syscallpc = pc
    casgstatus(gp, _Grunning, _Gsyscall)

    if staticLockRanking {
        // ... lock rank tracking ...
    }

    if sched.sysmonwait.Load() {
        systemstack(entersyscall_sysmon)
    }

    if gp.m.p.ptr().runSafePointFn != 0 {
        // runSafePointFn may schedule, so it has to be done on the systemstack.
        systemstack(runSafePointFn)
    }

    gp.m.syscalltick = gp.m.p.ptr().syscalltick
    gp.sysblocktraced = true
    pp := gp.m.p.ptr()
    pp.m = 0
    gp.m.oldp.set(pp)
    gp.m.p = 0
    atomic.Store(&pp.status, _Psyscall)
    if sched.gcwaiting.Load() {
        systemstack(entersyscall_gcwait)
    }

    gp.m.locks--
}
```

Annotated:

| Step | Code | Purpose |
|---|---|---|
| 1 | `gp.m.locks++` | Disable preemption — we are about to be in an inconsistent state. |
| 2 | `gp.stackguard0 = stackPreempt` | Make sure any function-prologue stack check fires (paranoia). |
| 3 | `save(pc, sp)` | Save the caller's PC and SP into `gp` so the runtime can restore them. |
| 4 | `casgstatus(gp, _Grunning, _Gsyscall)` | Atomically transition G state. |
| 5 | `sched.sysmonwait` check | If sysmon is asleep waiting for activity, wake it so it can do handoff if needed. |
| 6 | `runSafePointFn` check | GC may have scheduled a "do this safe point work" function. |
| 7 | Detach P from M | Set `pp.m = 0`, save oldp, clear `m.p`. |
| 8 | `atomic.Store(&pp.status, _Psyscall)` | Flag the P. |
| 9 | `gcwaiting` check | If GC wants to stop the world, help it. |
| 10 | `gp.m.locks--` | Re-enable preemption. |

After this the M executes the actual SYSCALL instruction in the wrapper (e.g., `Syscall6`).

### Why the `m.locks++` / `m.locks--` bracket?

`m.locks` is the runtime's preemption disable counter. Anything > 0 means "don't preempt me". Setting it during `reentersyscall` is essential because halfway through, the M's P is in an inconsistent state (`m.p == 0` but `pp.status == _Psyscall`).

---

## `exitsyscall` and the Fast/Slow Branch

```go
//go:nosplit
func exitsyscall() {
    gp := getg()

    gp.m.locks++
    if getcallersp() > gp.syscallsp {
        throw("exitsyscall: syscall frame is no longer valid")
    }

    gp.waitsince = 0
    oldp := gp.m.oldp.ptr()
    gp.m.oldp = 0
    if exitsyscallfast(oldp) {
        // Fast path: re-acquired oldp (or some P).
        // ... profiling hooks ...
        gp.m.locks--
        if gp.preempt {
            // Preemption was requested while we were in syscall.
            gp.stackguard0 = stackPreempt
        } else {
            gp.stackguard0 = gp.stack.lo + _StackGuard
        }
        gp.throwsplit = false

        if sched.disable.user && !schedEnabled(gp) {
            // Schedule was disabled while we were away.
            Gosched()
        }
        return
    }

    gp.m.locks--

    // Slow path. Park M, requeue G.
    mcall(exitsyscall0)

    // Re-enter Go scheduling on the new M.
    gp.syscallsp = 0
    gp.m.syscalltick++
    gp.throwsplit = false
}
```

The two outcomes:

- **Fast path**: `exitsyscallfast(oldp)` returns true. We have a P. Mark the G running and continue inline.
- **Slow path**: `mcall(exitsyscall0)` switches to the M's g0 stack and parks the M.

Notice the `gp.preempt` check: a preemption can be requested *while we were in syscall*. We honour it on the way out by setting `stackguard0 = stackPreempt`, which causes the next function-prologue check to call `morestack`, which calls into the scheduler.

---

## `exitsyscallfast` Internals

```go
//go:nosplit
func exitsyscallfast(oldp *p) bool {
    // Freezetheworld set the stopwait but did not retake P's.
    if sched.stopwait == freezeStopWait {
        return false
    }

    // Try to re-acquire the old P.
    if oldp != nil && oldp.status == _Psyscall && atomic.Cas(&oldp.status, _Psyscall, _Pidle) {
        // Yes! Re-attach.
        wirep(oldp)
        exitsyscallfast_reacquired()
        return true
    }

    // Try to get any other P.
    if sched.pidle != 0 {
        var ok bool
        systemstack(func() {
            ok = exitsyscallfast_pidle()
        })
        if ok {
            return true
        }
    }
    return false
}
```

The key CAS:

```go
atomic.Cas(&oldp.status, _Psyscall, _Pidle)
```

If sysmon already CAS'd it to `_Pidle` (handoff started), our CAS fails. We then fall to looking for any idle P.

`exitsyscallfast_pidle` is the systemstack helper:

```go
func exitsyscallfast_pidle() bool {
    lock(&sched.lock)
    pp, _ := pidlegetSpinning(0)
    if pp != nil && atomic.Load(&sched.sysmonwait) != 0 {
        atomic.Store(&sched.sysmonwait, 0)
        notewakeup(&sched.sysmonnote)
    }
    unlock(&sched.lock)
    if pp != nil {
        acquirep(pp)
        return true
    }
    return false
}
```

A global lock taken briefly (`sched.lock`). `pidlegetSpinning` pops the head of the idle-P list. If we got one, attach.

The wakeup of sysmon: if we just acquired a P, sysmon should know that the system has work — wake it if it was sleeping.

---

## `sysmon` Loop and `retake` for `_Psyscall`

`sysmon` is launched at startup with no P:

```go
func sysmon() {
    lock(&sched.lock)
    sched.nmsys++
    unlock(&sched.lock)

    lasttrace := int64(0)
    idle := 0
    delay := uint32(0)

    for {
        if idle == 0 {
            delay = 20  // 20 microseconds
        } else if idle > 50 {
            delay *= 2
        }
        if delay > 10*1000 {
            delay = 10 * 1000  // cap at 10 ms
        }
        usleep(delay)

        now := nanotime()

        // ... scheduler bookkeeping ...

        // Retake: preempt long-running Gs, hand off syscall Ps.
        if retake(now) != 0 {
            idle = 0
        } else {
            idle++
        }

        // ... GC trigger, scavenge, etc ...
    }
}
```

`retake` is the function we care about:

```go
func retake(now int64) uint32 {
    n := 0
    lock(&allpLock)
    for i := 0; i < len(allp); i++ {
        pp := allp[i]
        if pp == nil {
            continue
        }
        pd := &pp.sysmontick
        s := pp.status
        sysretake := false
        if s == _Prunning || s == _Psyscall {
            // Preempt G if it's running too long.
            t := int64(pp.schedtick)
            if int64(pd.schedtick) != t {
                pd.schedtick = uint32(t)
                pd.schedwhen = now
            } else if pd.schedwhen+forcePreemptNS <= now {
                preemptone(pp)
                sysretake = true
            }
        }
        if s == _Psyscall {
            // Retake P from syscall if it's been more than 1 sysmon tick.
            t := int64(pp.syscalltick)
            if !sysretake && int64(pd.syscalltick) != t {
                pd.syscalltick = uint32(t)
                pd.syscallwhen = now
                continue
            }
            if runqempty(pp) && sched.nmspinning.Load()+sched.npidle.Load() > 0 &&
                pd.syscallwhen+10*1000 > now {
                continue
            }
            // Need to decrement number of idle locked M's
            // (pretending that one more is running) before the CAS.
            unlock(&allpLock)
            incidlelocked(-1)
            if atomic.Cas(&pp.status, s, _Pidle) {
                if traceEnabled() {
                    traceGoSysBlock(pp)
                    traceProcStop(pp)
                }
                n++
                pp.syscalltick++
                handoffp(pp)
            }
            incidlelocked(1)
            lock(&allpLock)
        }
    }
    unlock(&allpLock)
    return uint32(n)
}
```

The interesting check:

```go
if runqempty(pp) && sched.nmspinning.Load()+sched.npidle.Load() > 0 &&
    pd.syscallwhen+10*1000 > now {
    continue
}
```

This says: **if the P has nothing to do AND there are spinning Ms or idle Ps available AND the syscall is < 10 µs old, don't bother handing off.** The runtime is being conservative: handoff is only worthwhile if (a) there is work waiting, or (b) the syscall is long enough that we cannot afford to wait.

The CAS from `_Psyscall` to `_Pidle` is the moment of handoff. If we win, we own the P and call `handoffp(pp)` to dispose of it.

---

## `handoffp` Implementation

```go
func handoffp(pp *p) {
    // 1. If P has runnable work, start an M to run it.
    if !runqempty(pp) || sched.runqsize != 0 {
        startm(pp, false)
        return
    }
    // 2. If GC wants the P, start an M.
    if gcBlackenEnabled != 0 && gcMarkWorkAvailable(pp) {
        startm(pp, false)
        return
    }
    // 3. If no spinning M and no idle P, start a spinning M.
    if sched.nmspinning.Load()+sched.npidle.Load() == 0 &&
        sched.nmspinning.CompareAndSwap(0, 1) {
        startm(pp, true)
        return
    }
    lock(&sched.lock)
    if sched.gcwaiting.Load() {
        pp.status = _Pgcstop
        sched.stopwait--
        if sched.stopwait == 0 {
            notewakeup(&sched.stopnote)
        }
        unlock(&sched.lock)
        return
    }
    // 4. If safe-point function pending, run it.
    if pp.runSafePointFn != 0 && atomic.Cas(&pp.runSafePointFn, 1, 0) {
        sched.safePointFn(pp)
        sched.safePointWait--
        if sched.safePointWait == 0 {
            notewakeup(&sched.safePointNote)
        }
    }
    if sched.runqsize != 0 {
        unlock(&sched.lock)
        startm(pp, false)
        return
    }
    // ... more special cases ...

    // 5. No work for this P; park it.
    pidleput(pp, 0)
    unlock(&sched.lock)
}
```

The cases (numbered above):

1. **P has runnable Gs**: spin up an M to run them. Most common case.
2. **GC needs CPU**: same.
3. **No spinning Ms anywhere**: create one — important for waking up the scheduler.
4. **Safe-point work**: run it now.
5. **Nothing to do**: park the P on the idle list.

`startm(pp, spinning)`:

```go
func startm(pp *p, spinning bool) {
    mp := mget()  // try to get a parked M from sched.midle
    if mp == nil {
        // No parked M. Create one.
        var fn func()
        if spinning {
            fn = mspinning
        }
        newm(fn, pp, -1)
        return
    }
    // Wake an existing parked M.
    if mp.spinning {
        throw("startm: m is spinning")
    }
    if mp.nextp != 0 {
        throw("startm: m has p")
    }
    mp.spinning = spinning
    mp.nextp.set(pp)
    notewakeup(&mp.park)
}
```

`mget()` pulls from `sched.midle` (the M pool). If empty, `newm` → `newm1` → `newosproc` → `clone(2)` (Linux).

Time cost:

- `mget` success: ~100 ns + the cost of waking the M (a futex wake on Linux, ~1 µs).
- `newm` (cold path): ~5–50 µs because of `clone(2)`.

---

## The `_Psyscall` State Machine

```
        Schedule()
      [_Prunning]
            |
        entersyscall
            |
       [_Psyscall]  <----- M still attached via oldp,
            |                 P available for handoff
            |
       +----+----+---------------------------------------+
       |         |                                       |
   exitsyscallfast                                  sysmon's retake
   CAS _Psyscall->_Pidle                            CAS _Psyscall->_Pidle
       |                                                 |
       v                                                 v
   acquirep -> [_Prunning]                          handoffp(pp)
                                                          |
                                                          v
                                                    [_Pidle] / [_Prunning]
                                                    (depending on whether
                                                     handoffp parked or
                                                     started an M)
```

The CAS race between `exitsyscallfast` and `retake` is the central concurrency invariant. Only one of them wins. If `exitsyscallfast` wins, the M re-attaches and continues — sysmon's handoff is skipped this round. If sysmon wins, the M takes the slow path.

This is what makes the syscall handling lock-free in the common case.

---

## Per-Platform Thread Creation: `newosproc`

### Linux

```go
// runtime/os_linux.go
func newosproc(mp *m) {
    stk := unsafe.Pointer(mp.g0.stack.hi)
    var oset sigset
    sigprocmask(_SIG_SETMASK, &sigset_all, &oset)
    ret := retryOnEAGAIN(func() int32 {
        r := clone(cloneFlags, stk,
            unsafe.Pointer(mp),
            unsafe.Pointer(mp.g0),
            unsafe.Pointer(abi.FuncPCABI0(mstart)))
        if r >= 0 {
            return 0
        }
        return -r
    })
    sigprocmask(_SIG_SETMASK, &oset, nil)
    if ret != 0 {
        print("runtime: failed to create new OS thread (have ", mcount(), " already; errno=", ret, ")\n")
        if ret == _EAGAIN {
            println("runtime: may need to increase max user processes (ulimit -u)")
        }
        throw("newosproc")
    }
}

var cloneFlags = uintptr(_CLONE_VM | _CLONE_FS | _CLONE_FILES | _CLONE_SIGHAND |
    _CLONE_SYSVSEM | _CLONE_THREAD)
```

Note `sigprocmask` blocks all signals during clone. The child inherits the blocked set; `minit` later unblocks signals once the M is fully set up. This prevents signals being delivered to a half-initialised M.

### macOS

```go
// runtime/os_darwin.go
func newosproc(mp *m) {
    stk := unsafe.Pointer(mp.g0.stack.hi)
    var attr pthreadattr
    if pthread_attr_init(&attr) != 0 {
        writeErrStr(failthreadcreate)
        exit(1)
    }
    if pthread_attr_setstacksize(&attr, threadStackSize) != 0 {
        writeErrStr(failthreadcreate)
        exit(1)
    }
    if pthread_attr_setdetachstate(&attr, _PTHREAD_CREATE_DETACHED) != 0 {
        writeErrStr(failthreadcreate)
        exit(1)
    }
    var oset sigset
    sigprocmask(_SIG_SETMASK, &sigset_all, &oset)
    err := pthread_create(&attr, abi.FuncPCABI0(mstart_stub), unsafe.Pointer(mp))
    sigprocmask(_SIG_SETMASK, &oset, nil)
    if err != 0 {
        writeErrStr(failthreadcreate)
        exit(1)
    }
}
```

macOS uses `pthread_create` (which under the hood calls `bsdthread_create`). The detached state means the runtime does not need to `pthread_join`.

### Windows

```go
// runtime/os_windows.go
func newosproc(mp *m) {
    thandle := stdcall6(_CreateThread, 0, 0,
        abi.FuncPCABI0(tstart_stdcall), uintptr(unsafe.Pointer(mp)),
        0, 0)
    // ...
}
```

Windows uses `CreateThread` directly. The new thread starts at `tstart_stdcall` (assembly stub), which calls `mstart`.

### Cost comparison

| Platform | Thread create | Notes |
|---|---|---|
| Linux | `clone(2)` | ~5–50 µs. Direct syscall; no libc round-trip. |
| macOS | `bsdthread_create` via pthreads | ~50–100 µs. Slightly heavier; pthreads adds overhead. |
| Windows | `CreateThread` | ~50–200 µs depending on AV/EDR hooking. |
| FreeBSD | `thr_new` | ~10–50 µs. Similar to Linux. |

The runtime's M pool absorbs this cost. Once an M exists, waking it is ~1 µs (a futex wake on Linux, condition signal on macOS, event on Windows).

---

## The Netpoller Init and Wakeup Paths

The netpoller has two activities: registering fds and polling for readiness.

### Registration (per-fd, once)

```go
// runtime/netpoll.go
func poll_runtime_pollOpen(fd uintptr) (*pollDesc, int) {
    pd := pollcache.alloc()
    // ... init pollDesc ...
    var errno int32
    errno = netpollopen(fd, pd)
    return pd, int(errno)
}

// runtime/netpoll_epoll.go
func netpollopen(fd uintptr, pd *pollDesc) int32 {
    var ev epollevent
    ev.events = _EPOLLIN | _EPOLLOUT | _EPOLLRDHUP | _EPOLLET
    *(**pollDesc)(unsafe.Pointer(&ev.data)) = pd
    return -epollctl(epfd, _EPOLL_CTL_ADD, int32(fd), &ev)
}
```

`_EPOLLET` is edge-triggered. The kernel reports readiness once per state change, not continuously. The runtime is responsible for draining the fd until `EAGAIN`.

### Wait

```go
// runtime/netpoll.go (called by scheduler)
func netpoll(delay int64) gList {
    if epfd == -1 {
        return gList{}
    }
    var waitms int32
    if delay < 0 {
        waitms = -1
    } else if delay == 0 {
        waitms = 0
    } else if delay < 1e6 {
        waitms = 1
    } else if delay < 1e15 {
        waitms = int32(delay / 1e6)
    } else {
        waitms = 1e9
    }

    var events [128]epollevent
retry:
    n := epollwait(epfd, &events[0], int32(len(events)), waitms)
    if n < 0 {
        if n != -_EINTR {
            println("runtime: epollwait on fd", epfd, "failed with", -n)
            throw("runtime: netpoll failed")
        }
        if waitms > 0 {
            return gList{}
        }
        goto retry
    }
    var toRun gList
    for i := int32(0); i < n; i++ {
        ev := &events[i]
        if ev.events == 0 {
            continue
        }
        // ... handle ev_wakeup_pipe ...
        pd := *(**pollDesc)(unsafe.Pointer(&ev.data))
        var mode int32
        if ev.events&(_EPOLLIN|_EPOLLRDHUP|_EPOLLHUP|_EPOLLERR) != 0 {
            mode += 'r'
        }
        if ev.events&(_EPOLLOUT|_EPOLLHUP|_EPOLLERR) != 0 {
            mode += 'w'
        }
        if mode != 0 {
            netpollready(&toRun, pd, mode)
        }
    }
    return toRun
}
```

`netpoll(delay)` is called from `findRunnable` (the scheduler's main "find me a goroutine" function). It returns a `gList` of goroutines now ready to resume.

`netpollready` unparks the goroutine attached to the pollDesc and adds it to the list.

### Wakeup pipe

The netpoller registers a special pipe (`netpollWakeup`). Calling `netpollBreak()` writes one byte to this pipe, which makes `epollwait` return immediately. This is how the scheduler wakes the netpoller when other work appears (avoiding busy-waiting on `epollwait`'s timeout).

---

## `entersyscallblock` — the Pre-Emptive Handoff

```go
//go:nosplit
func entersyscallblock() {
    gp := getg()
    gp.m.locks++
    gp.throwsplit = true
    gp.stackguard0 = stackPreempt
    gp.m.syscalltick = gp.m.p.ptr().syscalltick
    gp.sysblocktraced = true
    gp.m.p.ptr().syscalltick++

    pc := getcallerpc()
    sp := getcallersp()
    save(pc, sp)
    gp.syscallsp = gp.sched.sp
    gp.syscallpc = gp.sched.pc

    casgstatus(gp, _Grunning, _Gsyscall)

    systemstack(entersyscallblock_handoff)

    save(getcallerpc(), getcallersp())
    gp.m.locks--
}

func entersyscallblock_handoff() {
    if traceEnabled() {
        traceGoSysCall()
        traceGoSysBlock(getg().m.p.ptr())
    }
    handoffp(releasep())
}
```

Unlike `entersyscall`, which detaches the P but leaves the handoff to sysmon, `entersyscallblock` calls `handoffp` immediately. Used when the runtime *knows* the next operation will block for a while:

- `semasleep` (semaphore wait).
- `notetsleep` with deep timeouts.
- Internal blocking operations.

When you write user-level code calling `<-ch` (an unbuffered channel receive with no sender), the runtime parks the G via `gopark`, not `entersyscallblock`. They are different mechanisms — `gopark` is purely user-space and doesn't involve the kernel at all.

---

## Cgo Call Internals

```go
// runtime/cgocall.go
func cgocall(fn, arg unsafe.Pointer) int32 {
    if !iscgo && GOOS != "solaris" && GOOS != "illumos" && GOOS != "windows" {
        throw("cgocall unavailable")
    }
    if fn == nil {
        throw("cgocall nil")
    }
    if raceenabled {
        racereleasemerge(unsafe.Pointer(&racecgosync))
    }
    mp := getg().m
    mp.ncgocall++
    mp.ncgo++

    // Reset traceback so that it does not see the cgo call.
    mp.cgoCallers = nil

    // Announce we are entering a system call.
    entersyscall()

    osPreemptExtEnter(mp)

    mp.incgo = true
    errno := asmcgocall(fn, arg)

    mp.incgo = false
    mp.ncgo--

    osPreemptExtExit(mp)

    exitsyscall()

    // From the now-current goroutine, scan stack for any pointers and
    // pin them so GC won't reclaim them while we're in cgo.
    KeepAlive(fn)
    KeepAlive(arg)
    KeepAlive(mp)

    return errno
}
```

Note:

- `entersyscall` is called first (so the P can be handed off).
- `mp.incgo = true` is set after, distinguishing "in cgo" from "in regular syscall" for telemetry.
- `asmcgocall` is the assembly that switches stacks. It saves the goroutine context, switches to the M's g0 stack, calls the C function, switches back, restores the goroutine context.
- `exitsyscall` is called after the C function returns.
- `osPreemptExtEnter/Exit` manage preemption signals during the cgo call (different platforms have different rules about signal delivery to threads in foreign code).

The cgo cost breakdown (for a 1 ns C function):

| Step | Cost |
|---|---|
| `entersyscall` | ~30 ns |
| Stack switch (asm) | ~10 ns |
| C function itself | ~1 ns |
| Stack switch back | ~10 ns |
| `exitsyscall` (fast path) | ~30 ns |
| Total | ~80–150 ns |

For C functions that take > 1 µs, this overhead is negligible. For C functions that take < 100 ns, the cgo overhead dominates and is usually not worth it.

---

## Locked Goroutines Across Syscalls

When a `LockOSThread`'d G enters a syscall:

1. `entersyscall` runs normally. P detaches.
2. Sysmon may hand off the P. Handoff is unaffected by the lock.
3. When the syscall returns, `exitsyscall` tries to reacquire. It must find a P for the *specific* M (since the G is locked to it).
4. If no P is free, the M parks. The G waits on the M, not on a generic runqueue.

The interesting case is the slow path. In `exitsyscall0`:

```go
func exitsyscall0(gp *g) {
    casgstatus(gp, _Gsyscall, _Grunnable)
    dropg()
    var pp *p
    if schedEnabled(gp) {
        pp, _ = pidleget(0)
    }
    var locked bool
    if pp == nil {
        globrunqput(gp)
        // Below, we stoplockedm if locked. The schedule on
        // the locked M will check the special handle.
        locked = gp.lockedm != 0
    } else {
        // ... ack sysmon, acquirep ...
    }
    if locked {
        stoplockedm()
        execute(gp, false)
    }
    stopm()
    schedule()
}
```

When the G is locked and we have no P, `stoplockedm` is called. It parks the M but in a state where only this specific G can wake it. When eventually a P is available, the runtime knows to wake this M (not any M).

Performance: locked goroutines can starve worse than unlocked ones, because the runtime cannot run them on any free M. Always size your locked-G workload carefully.

---

## Reading Runtime Telemetry from C Code

Sometimes you need to read scheduler state from inside C (cgo callbacks, profiling). The runtime exposes some via `_cgo_thread_start` and friends, but most state is private.

What is available:

- `runtime.callers(skip, pcbuf)` returns the Go stack at the current point.
- `runtime/metrics` (Go 1.16+) is a stable API for reading scheduler metrics.
- `/proc/self/status` on Linux gives thread count.

What is not available:

- The raw P/M/G state machine. The runtime does not export it.
- `goid` (intentionally hidden).
- The exact `sched.midle` size.

For low-level inspection, you can patch the runtime locally (it is just Go code). Don't ship patched runtimes; do use them for debugging.

---

## Summary

At professional level, syscall handling is no longer a mechanism — it is a piece of source code you can navigate. You know:

- **`reentersyscall`** in `runtime/proc.go` is where the G/P/M state transition happens for syscalls.
- **`exitsyscall` and `exitsyscallfast`** in the same file are the return paths, with the critical CAS on `_Psyscall` → `_Pidle`.
- **`sysmon`** loops every 20 µs–10 ms, calling `retake`, which hands off Ps in `_Psyscall` for > 10 µs.
- **`handoffp`** decides whether to start an M, run a safe-point function, or park the P.
- **`newosproc`** is per-OS: `clone(2)` on Linux, `pthread_create` on macOS, `CreateThread` on Windows.
- **The netpoller** (`netpoll_epoll.go`, `netpoll_kqueue.go`, `netpoll_windows.go`) is a separate path that does not involve `entersyscall` at all.
- **`entersyscallblock`** is the pre-emptive variant for known-long calls.
- **`cgocall`** is `entersyscall` + stack switch + `exitsyscall`, with M-state bookkeeping for "in cgo".
- **Locked Gs** complicate the slow path: the M can only resume its locked G.

You can patch the runtime, write profilers that inspect syscall paths, and explain to anyone why a specific syscall took the path it took.

The specification level catalogues the invariants and runtime guarantees more formally, separating "what the language promises" from "what the runtime currently does".
