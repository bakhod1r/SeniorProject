# `LockOSThread` Performance — Professional Level

> At this level we open the runtime sources. We trace what `LockOSThread` mutates inside the scheduler, how M growth interacts with pinning, what `tgkill` actually costs in a Linux profile, and what changes between Go versions. The senior page should be familiar before reading this one; this page assumes you can read `runtime/proc.go` and a `runtime/trace` viewer with equal comfort.

## Table of Contents

1. [What `LockOSThread` Mutates](#what-lockosthread-mutates)
2. [The `lockedm` / `lockedg` Fields](#the-lockedm--lockedg-fields)
3. [Goroutine Scheduling Around a Locked G](#goroutine-scheduling-around-a-locked-g)
4. [M Creation Under Pinning Pressure](#m-creation-under-pinning-pressure)
5. [Pinned-G Exit and M Destruction](#pinned-g-exit-and-m-destruction)
6. [Preemption of a Pinned G in Detail](#preemption-of-a-pinned-g-in-detail)
7. [`tgkill` Cost Profile](#tgkill-cost-profile)
8. [Pinning and the GC Worker](#pinning-and-the-gc-worker)
9. [cgo + Pinning: the Runtime's Fast Path](#cgo--pinning-the-runtime-s-fast-path)
10. [`sched_setaffinity` and the Go Runtime](#sched_setaffinity-and-the-go-runtime)
11. [Version History: 1.10 → 1.22](#version-history-110--122)
12. [Cross-Platform: Linux, macOS, Windows](#cross-platform-linux-macos-windows)
13. [Self-Assessment](#self-assessment)
14. [Summary](#summary)

---

## What `LockOSThread` Mutates

In `runtime/proc.go`, `LockOSThread` is small. Pseudocode of the relevant logic:

```go
func LockOSThread() {
    mp := getg().m
    mp.lockedExt++
    dolockOSThread()
}

func dolockOSThread() {
    gp := getg()
    gp.m.lockedg.set(gp)
    gp.lockedm.set(gp.m)
}
```

Two pointers and one counter get set:

- `g.lockedm` — points to the M the G is locked to.
- `m.lockedg` — points to the G the M is locked to.
- `m.lockedExt` — counter of external Lock calls. When it returns to zero, the lock releases.

The scheduler checks both pointers at every scheduling decision. The check is two `if` statements; the cost per scheduling event is in the single-digit nanoseconds.

`UnlockOSThread` decrements the counter and, when it reaches zero, clears both pointers.

The simplicity matters: the runtime did not add an expensive data structure for pinning. The cost of pinning is not the *operation* — it is the effect on subsequent scheduling decisions.

---

## The `lockedm` / `lockedg` Fields

When the scheduler picks a G to run on an M, it consults `g.lockedm`:

- If `g.lockedm` is nil, the G can run on any M. Normal case.
- If `g.lockedm` is set and equals the current M, the G runs. Normal pinned case.
- If `g.lockedm` is set and points to a *different* M, the scheduler hands the G off to that M and picks a different G to run here.

The hand-off path is more expensive than direct execution because it involves enqueuing the G on the other M's local queue and waking that M (if parked). On a hot pinned-G path, you do not want this to happen often.

Conversely, when an M is about to pick a G to run, it consults `m.lockedg`:

- If `m.lockedg` is nil, pick any runnable G.
- If `m.lockedg` is set, the M can run *only* that G. It cannot pick up other work.

This is what makes one pinned G consume one M permanently: the M's run loop is gated on `lockedg` being ready. If the locked G is blocked, the M sleeps (calling `futex(FUTEX_WAIT)` on Linux) until the G is runnable again. The M is in the process's thread count but is not consuming CPU.

---

## Goroutine Scheduling Around a Locked G

A subtle case: a P is bound to an M with a locked G. The locked G blocks in a syscall. What happens?

```
P0 - M3 - G_locked  (G enters syscall)
```

The scheduler's handoff logic kicks in:

1. M3 enters the syscall (Go-side `entersyscall` is called).
2. The runtime detaches P0 from M3. (M3 keeps the lock to G; P0 is now free.)
3. P0 is acquired by another M (or a fresh M is spawned) to run other Gs.
4. M3 finishes the syscall (or the C call) and tries to re-acquire P0. Since P0 may be busy, M3 may have to wait.

This is good for throughput: the locked G blocking in cgo does not stop other work from running on P0. But the M (M3) cannot do anything else, and when the syscall returns, there may be contention to re-attach a P.

A worst-case scenario: many pinned Gs all in long cgo calls simultaneously. Each M is parked waiting for its cgo to return; P count is full of fresh Ms running everyone else. When the cgo calls return, the pinned Ms all want a P at once; they queue.

In practice, this is rare. The cgo concurrency budget keeps the count low.

---

## M Creation Under Pinning Pressure

The runtime grows Ms in `newm()`. Conditions that trigger:

- A G becomes runnable but no M is available to run it.
- An M enters a syscall, leaving its P with no holder; the runtime spawns an M to keep the P alive.
- A pinned G needs to run but its M is busy elsewhere (rare).

The M-creation rate is bounded by sysmon's polling rate (~every 10 ms) and by an internal heuristic that avoids creating too many Ms at once during bursts.

When you pin K goroutines, the immediate consequence is that K Ms are out of circulation. The runtime sees runnable Gs with no M and grows the M pool by K. The growth happens within a few milliseconds.

`debug.SetMaxThreads` caps total M count. Default 10 000. Exceeding it aborts the program with `runtime: program exceeds %d-thread limit`. If pinning pushes you near the limit, you have bigger problems than the cap; address the leak.

Each `newm` calls `clone(2)` on Linux:

```c
int flags = CLONE_VM|CLONE_FS|CLONE_FILES|CLONE_SIGHAND|CLONE_THREAD|CLONE_SYSVSEM|CLONE_SETTLS|CLONE_PARENT_SETTID|CLONE_CHILD_CLEARTID;
clone(start, stack_top, flags, m_struct, &tid, &tls, &tid);
```

Cost: ~10–50 µs on a modern kernel. The new thread starts in `mstart` (Go runtime entry point), grabs a P from the idle pool, and starts scheduling.

This means: bursting pinned-worker creation is expensive. Pre-warm pools at startup if you need predictable response time.

---

## Pinned-G Exit and M Destruction

When a pinned G exits without calling `UnlockOSThread`, the runtime takes the "exit while locked" path:

1. `goexit1` is called as the final G activity.
2. The runtime checks `g.lockedm != nil && m.lockedExt > 0`.
3. If locked, the M is destroyed: `mexit(osStack=false)` calls `pthread_exit` (Linux) or `ExitThread` (Windows).
4. The M is removed from the runtime's M list.

This is intentional: the M is in a "dirty" state (mutated TLS, mutated namespace, mutated signal mask) and the runtime cannot safely reuse it. Destroying the M is the correct call.

Cost of destruction: ~10–30 µs (kernel TID release, stack unmapping, runtime bookkeeping).

If the pin is via `lockedExt == 0` (internal locking, e.g., the runtime locks itself during certain phases like cgo callbacks), the M is not destroyed; it returns to the pool.

For the user-facing `LockOSThread`, the rule is: **exit while locked → M dies**. Plan for it.

---

## Preemption of a Pinned G in Detail

The async-preemption mechanism (Go 1.14+) targets a goroutine that has been running too long. The path:

1. `sysmon` (a runtime goroutine, runs on its own M) wakes every ~10 ms.
2. It scans Gs in `_Grunning` state. Any G that has been running for more than ~10 ms is marked for preemption.
3. The runtime calls `signalM(mp, sig)` on the running M, where `sig = sigPreempt = SIGURG` on Linux.
4. `signalM` calls `tgkill(tgid, m.procid, SIGURG)`.
5. The kernel delivers the signal to the specific TID.
6. The Go signal handler `sigtramp` → `sighandler` → `doSigPreempt` runs.
7. `doSigPreempt` checks if the G is at a safe point; if so, sets `g.preempt = true` and `g.stackguard0 = stackPreempt`.
8. The next function prologue (which checks `stackguard0`) sees the preempt and reschedules.

For a pinned G:

- All of steps 1–7 happen identically.
- Step 8: the G is rescheduled, but `g.lockedm` is set, so the M does *not* hand the G off to another M. The G simply re-enters the run queue and the M picks it back up immediately.

The net effect on a pinned G is: ~3–5 µs of preemption overhead per ~10 ms quantum (0.03–0.05%). Negligible for most workloads, noticeable for tight CPU loops.

`GODEBUG=asyncpreemptoff=1` disables this. Then only cooperative preemption (function-prologue stack check) applies. Tight CPU loops without function calls become un-preemptible — risky.

---

## `tgkill` Cost Profile

A flame graph of a service with many pinned, frequently-preempted Gs shows a noticeable `tgkill` slice:

```
runtime.preemptone
└── runtime.signalM
    └── syscall.RawSyscall(SYS_TGKILL, ...)
```

Each `tgkill` is ~1–2 µs of kernel time. At a default preemption rate (~100 Hz × pinned count), this is sub-1% CPU for typical pin counts.

If you see `tgkill` dominating in a profile:

- Lots of pinned Gs (> 50).
- Each running long quanta (CPU-bound).
- Preemption fires constantly.

The mitigations:

- Reduce pin count.
- Insert explicit yield points (`runtime.Gosched()`) in the hot loop so cooperative preemption catches it first.
- Set `GODEBUG=asyncpreemptoff=1` if you can guarantee the loop has frequent function calls (it must, otherwise the program freezes).

For a typical web service with 4–8 pinned workers, `tgkill` is in noise. For an embedded system with 32 pinned threads, it can become measurable.

---

## Pinning and the GC Worker

GC workers (the goroutines that perform mark/scan work concurrently) are not pinned. They are normal goroutines and run on whichever M has a free P.

Implication: a pinned worker's M does *not* participate in concurrent GC mark/scan. The GC's parallelism is bounded by `GOMAXPROCS − pinned_workers`. If you pin 4 Gs on `GOMAXPROCS=4`, the GC mark phase runs on the fresh Ms the runtime spawned. That works but is less efficient than running on the regular pool because the fresh Ms start with cold caches.

In the stop-the-world phases (still present in modern Go, just very short), the runtime stops *all* Gs, including pinned ones. The pinned G is paused via the standard preemption mechanism (SIGURG), then GC proceeds, then the G is resumed on the same M.

For a service with heavy pinning, GC pause analysis should consider whether pinned-worker quanta are aligned with STW windows; misalignment can briefly extend STW. Use `runtime/trace` to see this directly.

---

## cgo + Pinning: the Runtime's Fast Path

On a cgo call, the runtime does roughly:

```go
func cgocall(fn, arg unsafe.Pointer) int32 {
    mp := getg().m
    entersyscall()
    // call C via assembly stub: asmcgocall(fn, arg)
    exitsyscall()
    return ret
}
```

`entersyscall` marks the M as in cgo, detaches the P, and increments cgo counters. `exitsyscall` tries to re-acquire a P.

For an unpinned goroutine, `exitsyscall` may end up on a different M after the C call returns (the runtime moves the G to whichever M has a free P first). For a pinned goroutine, the G must come back to the same M; if that M lost its P during the call, the M has to wait for one.

Crucially: when a pinned G is in cgo, the M does *not* go through `dropg/execute` to pick up another goroutine — it stays parked, holding the lock to its G. The P, however, has been detached and reused.

The fast path on a pinned cgo call:

1. `cgocall` enters, `entersyscall` detaches P. M now holds G but no P.
2. C function runs.
3. C returns. `exitsyscall` runs.
4. Since `g.lockedm` is set, the runtime cannot place G on a different M; it tries to re-acquire a P for *this* M.
5. If a P is immediately available, attach and resume. If not, M sleeps; the runtime wakes it when a P is free.

The "if not, M sleeps" branch is rarely hit unless `GOMAXPROCS` is fully saturated by other pinned Gs. In typical workloads, the fast path is taken.

---

## `sched_setaffinity` and the Go Runtime

`runtime.LockOSThread` does not call `sched_setaffinity`. The M can still float across CPU cores at the kernel's discretion.

If you want kernel-level CPU pinning, layer it on top:

```go
import "golang.org/x/sys/unix"

runtime.LockOSThread()
defer runtime.UnlockOSThread()

var cpus unix.CPUSet
cpus.Set(2)  // pin to CPU 2
if err := unix.SchedSetaffinity(0, &cpus); err != nil {
    log.Fatal(err)
}
```

`SchedSetaffinity(0, ...)` operates on the calling thread (which is the M holding our G, because we locked).

Important interactions:

- If the M is later destroyed (pinned G exits without unlock), the affinity dies with it. No leak.
- If the M's lock releases (`UnlockOSThread` called and counter hits zero), the M returns to the pool *with the kernel affinity still set*. A subsequent goroutine that lands on this M inherits the affinity. This is rarely desired.

Best practice: pair `SchedSetaffinity` with `LockOSThread` *without* an `UnlockOSThread` (let the M die with the goroutine). That prevents affinity leakage to other goroutines.

NUMA: on machines with multiple memory nodes, set both CPU affinity and memory policy (`mbind` / `set_mempolicy`) for full locality. `numactl` does both for the whole process; in-process control requires Linux syscalls not covered by `unix` helpers.

---

## Version History: 1.10 → 1.22

A timeline of pinning-relevant runtime changes:

- **Go 1.10:** `LockOSThread`/`UnlockOSThread` were reference-counted. Behaviour: exit-while-locked destroys the M. Stable.
- **Go 1.13:** Net I/O moved to netpoller; cgo-bound Ms became more visibly the dominant non-runtime Ms. No `LockOSThread` change.
- **Go 1.14:** Async preemption introduced (`SIGURG` on Linux). Pinned Gs are preemptible the same way unpinned Gs are. Most existing pinning code unaffected.
- **Go 1.16:** Cgroup-aware `GOMAXPROCS` detection on Linux. Indirectly relevant: container CPU caps now reflect into `GOMAXPROCS`, making the "pin retires one M" cost more visible in misconfigured containers.
- **Go 1.18:** Generics arrived; no scheduler change.
- **Go 1.19:** `GOMEMLIMIT` arrived. Pinning unchanged.
- **Go 1.21:** `runtime/metrics` added `/sched/threads:threads` and detailed sub-metrics for sched latency. The standard way to observe pinning's effect.
- **Go 1.22:** No `LockOSThread` semantic change. Some scheduler micro-optimisations.

The semantic surface of `LockOSThread` has been stable for many years. The mechanics (preemption, M growth) have changed, but the contract has not.

When upgrading Go versions in a production service that uses pinning, the most important regression-watch metric is scheduler latency (`/sched/latencies:seconds`). Preemption-related changes can shift the distribution.

---

## Cross-Platform: Linux, macOS, Windows

`LockOSThread` works on every platform Go supports, but the underlying primitives differ:

**Linux.** M is a kernel thread created by `clone(2)`. Pinning binds the G to the kernel TID. Preemption is `tgkill` + `SIGURG`. NUMA-aware via `sched_setaffinity` / `mbind`.

**macOS.** M is a Mach thread, created by `bsdthread_create` (a libpthread internal). Pinning binds to the Mach thread. Preemption is `pthread_kill` + `SIGURG`. NUMA is not really a thing on macOS hardware.

**Windows.** M is a Windows thread, created by `CreateThread`. Pinning binds to the Windows thread. Preemption is via `QueueUserAPC` + thread suspension (no SIGURG analog; the runtime uses a different mechanism). NUMA available via `SetThreadIdealProcessor`.

For cross-platform code, `LockOSThread` is portable; per-platform tricks (CPU affinity, signal masking) are not. Wrap them behind a build-tagged interface.

A common macOS-specific use: pinning `main` for AppKit / OpenGL. The Mac main thread is special; the runtime knows to put `init`/`main` on the original thread, and `LockOSThread` ensures it stays.

---

## Self-Assessment

- [ ] I can read `runtime/proc.go`'s `dolockOSThread` and explain what each line does.
- [ ] I can trace a cgo call from a pinned G through `entersyscall` / `exitsyscall`.
- [ ] I have seen `tgkill` show up in a profile and identified whether pinning was the cause.
- [ ] I can quantify the cost of pinning preemption as a fraction of CPU.
- [ ] I have layered `sched_setaffinity` on top of `LockOSThread` for NUMA-aware pinning.
- [ ] I know what changes between Go versions affect pinning, and which do not.
- [ ] I can predict M-growth behaviour for a given pin count and `GOMAXPROCS`.

---

## Summary

Professionally, `LockOSThread` is a small piece of runtime mechanism with predictable consequences:

- Two pointers and a counter, set on `Lock`, cleared on the last `Unlock`.
- Scheduler honours the pointers on every scheduling decision.
- Pinned-G exit destroys the M (`pthread_exit` on Linux).
- Preemption still works via `tgkill(SIGURG)`; cost ~1–2 µs per fire.
- cgo fast-path is preserved; the runtime detaches the P while the C call runs.
- Affinity is not Go's job; layer `sched_setaffinity` on top if you need CPU pinning.

The contract has been stable across Go versions; only the surrounding mechanisms (preemption, cgroup detection, metrics) have evolved. Production tuning at the professional level is mostly about choosing the right metric to watch (`/sched/threads:threads`, `/sched/latencies:seconds`), the right capacity model (`Ms = GOMAXPROCS + pins + cgo + IO + baseline`), and the right architecture (single owner, bounded pool).

The remaining content for this section is in the specification, interview, tasks, find-bug, and optimize pages.
