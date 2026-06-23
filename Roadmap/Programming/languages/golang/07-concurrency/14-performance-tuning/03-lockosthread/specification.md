# `LockOSThread` Performance — Specification

> This page records the **tuning-relevant guarantees** of `runtime.LockOSThread` and `runtime.UnlockOSThread`. For full API semantics see the Go runtime documentation; this page extracts only what a performance engineer must rely on.

## Table of Contents

1. [Scope](#scope)
2. [Normative Guarantees](#normative-guarantees)
3. [Performance Contracts](#performance-contracts)
4. [Measurement Contracts](#measurement-contracts)
5. [Non-Guarantees](#non-guarantees)
6. [Edge Cases](#edge-cases)
7. [Version Compatibility](#version-compatibility)
8. [Cross-Platform Differences](#cross-platform-differences)
9. [Compliance Checklist](#compliance-checklist)

---

## Scope

This specification covers `runtime.LockOSThread`, `runtime.UnlockOSThread`, and their interaction with:

- The scheduler (G–M–P binding).
- The M lifecycle (creation, destruction).
- Preemption (async and cooperative).
- cgo call paths.
- `runtime/metrics` and `runtime/trace` outputs.

It does *not* cover:

- Goroutine semantics in general (covered in 01-goroutines).
- Channel internals (covered in 09-channel-internals).
- Scheduler internals at the algorithmic level (covered in 10-scheduler-deep-dive).

The aim is to give a performance engineer a concise set of invariants they can rely on across Go versions ≥ 1.16.

---

## Normative Guarantees

The following statements are guarantees of the Go runtime and may be relied on for performance reasoning:

**G-1.** A goroutine that calls `LockOSThread` runs only on the M it was running on at the time of the call, until the lock count returns to zero.

**G-2.** An M holding a locked G runs only that G until the lock count returns to zero.

**G-3.** `LockOSThread` and `UnlockOSThread` are reference-counted. N matched calls to `LockOSThread` require N matched calls to `UnlockOSThread` to release the pin.

**G-4.** A locked G that exits (returns from the goroutine's top-level function, or via `runtime.Goexit`) without releasing the lock causes the underlying M to be destroyed. The M is not returned to the runtime's pool.

**G-5.** A locked G that releases its lock (count reaches zero) frees the M to participate in normal scheduling.

**G-6.** A locked G is still subject to preemption. The runtime may pause it for GC, scheduler timeslice, or other reasons. Pinning prevents *migration*, not *preemption*.

**G-7.** A locked G that blocks in a syscall (including cgo) causes the runtime to detach the P from the M. The M remains locked to the G; the P is reused for other Ms.

**G-8.** A locked G's M is counted in `/sched/threads:threads` (Go 1.21+) and in `/proc/<pid>/status`'s `Threads:` line on Linux.

**G-9.** Initialisation and finalisation of per-thread state on a locked M run on that M; goroutine code executing under the lock observes only that M's state.

---

## Performance Contracts

The following are not strict guarantees but are reliable across Go ≥ 1.16 on Linux x86_64:

**P-1.** Each `LockOSThread` retires exactly one M from the pool available for general scheduling.

**P-2.** When pinning saturates the M pool, the runtime grows the pool (creates new Ms) within ~10 ms of the saturation event.

**P-3.** The per-call overhead of `LockOSThread` itself is < 100 ns on modern hardware.

**P-4.** The per-call overhead of `UnlockOSThread` is < 100 ns.

**P-5.** Preempting a locked G via `tgkill(SIGURG)` costs ~1–3 µs of kernel time per preemption event on Linux.

**P-6.** A locked G in a tight CPU loop without function calls is preemptible (via async preemption) but at a higher cost than a normal G.

**P-7.** cgo calls from a locked G benefit from stable TLS, which provides 5–25% throughput improvement for tight cgo loops calling short C functions. The improvement is negligible for long C calls.

**P-8.** The M-creation cost (a `clone(2)` syscall on Linux) is ~10–50 µs. Burst pinning that forces M creation pays this once per new M.

**P-9.** The M-destruction cost (a `pthread_exit` or equivalent) is ~10–30 µs. Pinning patterns that destroy and recreate Ms (exit-while-locked patterns) pay this each iteration.

**P-10.** Cgo on a locked G keeps the M associated with the G for the call's duration. The P is detached; the M does not pick up other work.

---

## Measurement Contracts

The runtime exposes the following observability surfaces relevant to pinning:

**M-1.** `runtime/metrics` metric `/sched/threads:threads` (Go 1.21+): current count of OS threads owned by the Go runtime. Increases by exactly 1 for each pinned worker that retires an M and forces M creation.

**M-2.** `runtime/metrics` metric `/sched/latencies:seconds`: histogram of how long runnable Gs wait before getting a P. Sensitive to over-pinning.

**M-3.** `runtime.NumGoroutine()`: total goroutine count (includes pinned).

**M-4.** `/proc/<pid>/status` `Threads:` (Linux): kernel-visible thread count of the process. Matches `/sched/threads:threads` plus a few non-runtime threads (e.g., sysmon).

**M-5.** `runtime/pprof` `goroutine` profile with labels (`pprof.SetGoroutineLabels`): pinned workers can be tagged for filtering.

**M-6.** `runtime/trace` (`runtime/trace.Start`): emits events for cgo enter/exit, scheduler activity, GC pauses. Locked Gs show up as Gs that stay on one M throughout the trace.

**M-7.** `GODEBUG=schedtrace=N` env var: prints scheduler statistics every N ms, including the `threads=` and `idleprocs=` fields.

**M-8.** `GODEBUG=scheddetail=1` env var (combined with `schedtrace`): adds per-P and per-M detail. The `lockedg=<id>` field on an M indicates a pin.

---

## Non-Guarantees

The following are not guaranteed by the runtime:

**N-1.** `LockOSThread` does not set CPU affinity. The OS scheduler may move the thread between cores at any time.

**N-2.** `LockOSThread` does not affect priority or scheduling class. The thread runs at the same nice level and policy as before.

**N-3.** `LockOSThread` does not pin memory to a NUMA node. Use `numactl` or syscalls to control that.

**N-4.** The specific M number / TID assigned to a locked G is implementation-defined and may change between Go versions.

**N-5.** The order in which the runtime grows the M pool to compensate for pinning is not specified.

**N-6.** The specific cost of preempting a locked G is not bounded; it depends on the kernel signal-delivery cost, which varies with kernel version.

**N-7.** The implementation does not promise to recycle Ms efficiently after `UnlockOSThread`. An M that was locked may stay parked for some time before being reused.

**N-8.** `LockOSThread` semantics with respect to `runtime.Goexit` (vs panic) are documented but not exhaustively tested across versions; rely on `defer UnlockOSThread()` for clarity.

---

## Edge Cases

**E-1. Nested locks.** Multiple `LockOSThread` calls on the same G nest. Matching `UnlockOSThread` calls are required. Mixing this with `defer UnlockOSThread()` is fragile; prefer single Lock/Unlock pairs.

**E-2. Lock on `main`.** Calling `LockOSThread` in `main` (or in a package `init`) pins the main goroutine. On macOS the main thread is special (AppKit/CFRunLoop); pinning is required for GUI frameworks but unnecessary for server code.

**E-3. Lock in `init`.** Calling `LockOSThread` in an `init` function pins the `init`-running goroutine. Effects persist into `main` because `init` runs on the main goroutine.

**E-4. `runtime.Goexit` from a locked G.** Treated as exit-while-locked: the M is destroyed.

**E-5. Panic from a locked G.** If recovered, the goroutine continues running locked. If unrecovered, the runtime crashes the process.

**E-6. Cross-G locking.** A G cannot lock another G's M. Only the running G can call `LockOSThread`.

**E-7. Multiple Gs claiming the same M.** Impossible by construction. The first Lock binds the M; subsequent Gs cannot run on it until release.

**E-8. cgo callback into Go from a non-Go thread.** Such callbacks run on a special G that the runtime creates per thread. The G is implicitly locked to that thread for the duration of the callback.

**E-9. Lock during GC stop-the-world.** GC STW briefly pauses all Gs, including locked ones. After resume, the lock is intact.

**E-10. Lock with `LockOSThread` count zero plus internal lock.** The runtime maintains a separate internal lock count (`lockedInt`) used for runtime internals (e.g., during cgo). User code should not interact with this.

---

## Version Compatibility

| Version | Change | Effect on pinning |
|---|---|---|
| ≤ 1.13 | Cooperative preemption only | Pinned tight loops without function calls were uninterruptible. |
| 1.14 | Async preemption via `SIGURG` | Pinned Gs now preemptible; small per-fire cost via `tgkill`. |
| 1.16 | Cgroup-aware `GOMAXPROCS` | Pinned-M cost more visible in misconfigured containers. |
| 1.21 | `/sched/threads:threads` metric | Standard observability for pinned-M growth. |
| 1.22 | Minor scheduler tweaks | No semantic change to `LockOSThread`. |

The semantic contract has been stable. The mechanics and observability have evolved.

---

## Cross-Platform Differences

**Linux.** Reference platform. M = kernel thread via `clone(2)`. Preemption = `tgkill` + `SIGURG`. NUMA available.

**macOS.** M = Mach thread via `bsdthread_create`. Preemption = `pthread_kill` + `SIGURG`. Main thread special for GUI; AppKit requires `main` pinned.

**Windows.** M = Windows thread via `CreateThread`. Preemption = `QueueUserAPC` + thread suspend (no SIGURG). Most pinning code Just Works but the kernel mechanics differ.

**FreeBSD / Solaris / Plan9 / etc.** `LockOSThread` is supported wherever Go runs. Semantics match Linux to first order. Preemption mechanics vary.

For cross-platform code, rely only on the normative guarantees in this spec. Avoid relying on specific TID values, signal numbers, or syscall traces.

---

## Compliance Checklist

A library or service using `LockOSThread` should:

- [ ] Have a comment at every `LockOSThread` call explaining why pinning is required.
- [ ] Pair every `LockOSThread` with a `defer UnlockOSThread()` in the same function, or document why not.
- [ ] Encapsulate pinning inside a worker goroutine, not on a caller's goroutine.
- [ ] Expose a channel or function-based API; never require callers to be on the pinned thread.
- [ ] Initialise per-thread state inside the pinned goroutine, after `LockOSThread`, before the work loop.
- [ ] Clean up per-thread state inside the pinned goroutine, before `UnlockOSThread`.
- [ ] Provide a shutdown mechanism (channel close, context cancel) that drains the worker.
- [ ] Log a startup line including the pinned-worker count for the service.
- [ ] Track `process_threads_total` (or `/sched/threads:threads`) in monitoring.
- [ ] Alert if thread count exceeds expected baseline + pinned count by a meaningful margin.

A code review checklist:

- [ ] Is the pin justified? (cgo thread-affine, OS thread-affine, measured locality benefit)
- [ ] Is the M cost bounded? (no per-request pinning)
- [ ] Is the lock/unlock balanced? (defer or explicit unlock)
- [ ] Is the worker's lifecycle managed? (init, drain, shutdown)
- [ ] Is the worker's failure handled? (panic recovery, replacement)
- [ ] Is the worker observable? (pprof labels, metrics)

These checks together implement the spec at the engineering level.
