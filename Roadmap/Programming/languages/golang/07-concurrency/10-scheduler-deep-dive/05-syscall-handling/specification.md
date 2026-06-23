# Syscall Handling — Specification

## Table of Contents
1. [Introduction](#introduction)
2. [What the Language Specifies](#what-the-language-specifies)
3. [What the Runtime Guarantees (Stable Contracts)](#what-the-runtime-guarantees-stable-contracts)
4. [What the Runtime Does Not Guarantee](#what-the-runtime-does-not-guarantee)
5. [Invariants Maintained by the Syscall Path](#invariants-maintained-by-the-syscall-path)
6. [Goroutine State Invariants](#goroutine-state-invariants)
7. [P State Invariants](#p-state-invariants)
8. [M State Invariants](#m-state-invariants)
9. [Concurrency Invariants Between sysmon and exitsyscall](#concurrency-invariants-between-sysmon-and-exitsyscall)
10. [Cgo Contract](#cgo-contract)
11. [`LockOSThread` Contract](#lockosthread-contract)
12. [Netpoller Contract](#netpoller-contract)
13. [Cross-References to Standards](#cross-references-to-standards)
14. [Summary](#summary)

---

## Introduction

The "specification" page distinguishes:

- What the **Go language specification** says (very little about syscalls).
- What the **runtime documents** (`runtime` package godoc; `HACKING.md`).
- What the **current implementation** does but is not documented as a contract.

You should rely only on documented behaviour in production code. The implementation may change.

---

## What the Language Specifies

The Go language specification (`go.dev/ref/spec`) does not mention syscalls, OS threads, sysmon, or the netpoller. It defines:

- The semantics of goroutines (concurrent execution).
- The memory model (happens-before relationships).
- Channel and sync primitives.

The spec does not say:

- How many OS threads will exist.
- Whether a syscall blocks other goroutines.
- That `time.Now()` uses VDSO.

Anything you read about the runtime implementation is implementation-defined. The spec promises *correctness*, not *performance*.

---

## What the Runtime Guarantees (Stable Contracts)

These are documented in `runtime` package godoc and `HACKING.md`:

1. **A syscall does not block other goroutines.** A goroutine in a syscall does not stop other goroutines from making progress (assuming `GOMAXPROCS > 1` or the syscall is netpoller-backed).
2. **`runtime.GOMAXPROCS(0)` returns the current setting.** Modifications via `runtime.GOMAXPROCS(n)` are immediate (subject to scheduler reshuffling).
3. **`runtime.LockOSThread()` pins the calling goroutine to the OS thread.** While the goroutine is locked, it runs only on that thread. `runtime.UnlockOSThread()` releases.
4. **A locked goroutine that exits leaves its thread in an unspecified state.** The runtime may destroy the thread.
5. **`runtime.NumGoroutine()` returns the goroutine count at some recent point.** Not strictly atomic but representative.
6. **`runtime.SetMaxThreads(n)` caps the number of OS threads.** Default 10000.
7. **The CPU profiler (`SIGPROF`) does not preempt goroutines synchronously.** Profiling samples are written to a per-M buffer.

These are stable and you can rely on them.

---

## What the Runtime Does Not Guarantee

Items that are widely *believed* to be true but are not contracted:

- **The 10 µs sysmon handoff threshold.** This is an implementation detail. The runtime may change it.
- **The size of the M idle pool.** No published cap.
- **The number of Ms a healthy program will have.** Depends on workload.
- **VDSO usage.** The runtime *may* use VDSO; on some platforms or kernels it falls back to real syscalls.
- **The exact CAS sequence in `exitsyscallfast`.** Internal.
- **The thread ID returned by `syscall.Gettid()` without `LockOSThread`.** Unstable; the goroutine can migrate.
- **Whether a specific syscall goes through the netpoller.** Implementation-defined; this is decided per fd type by the runtime.
- **The order in which goroutines on different runqueues are resumed.** No guarantee.
- **Whether `runtime.Gosched()` always yields.** It usually yields, but the runtime may keep the goroutine running if no other work is ready.

Do not write tests that assert these things. Do not document them in API contracts.

---

## Invariants Maintained by the Syscall Path

The runtime maintains the following invariants. Violation indicates a runtime bug.

### Goroutine state invariants

| Property | Always true? |
|---|---|
| `_Grunning` only when running on an M with a P | Yes |
| `_Gsyscall` only when M is in a syscall | Yes |
| `_Gwaiting` only when on a wait queue (channel, lock, netpoller) | Yes |
| `_Grunnable` only when on a runqueue (P-local or global) | Yes |

### P state invariants

| Property | Always true? |
|---|---|
| `_Prunning` ↔ M is attached and running Go code | Yes |
| `_Psyscall` ↔ M is attached but in a syscall | Yes |
| `_Pidle` ↔ no M attached, P on the idle list | Yes |
| `_Pgcstop` ↔ P halted for GC | Yes |
| At any time `GOMAXPROCS` Ps exist | Yes |

### M state invariants

| Property | Always true? |
|---|---|
| Every M has a `g0` system goroutine | Yes |
| At most one G is `curg` on an M at any time | Yes |
| If `m.p != nil`, then `m.p.m == m` and `m.p.status` is `_Prunning` or `_Psyscall` | Yes |
| If `m.lockedg != nil`, that G's `lockedm == m` | Yes |

### Cross-component invariants

- The total goroutine count = sum over M of (M's curg or 0) + Gs on runqueues + Gs on wait queues + Gs in syscall.
- An M is in *exactly one* of: running Go code with a P, in a syscall (P detached), parked in `sched.midle`, dead.
- A G is in *exactly one* of: running on an M, on a runqueue, on a wait queue, dead.

These are core scheduler invariants. The syscall path must preserve all of them across the transitions.

---

## Goroutine State Invariants

The G state transitions involving syscalls:

```
_Grunning --entersyscall--> _Gsyscall --exitsyscall--> _Grunning
                                     \
                                      --exitsyscall slow--> _Grunnable (on runqueue)
                                                                    \
                                                                     --schedule--> _Grunning
```

The `_Gsyscall` state must:

- Not be on any runqueue.
- Have valid `syscallpc` and `syscallsp` (for stack traces).
- Be associated with an M (`gp.m`).

Transition to `_Gwaiting` is impossible from `_Gsyscall` directly. The runtime always goes through `_Grunnable` or `_Grunning` first.

---

## P State Invariants

`_Psyscall` is the only state where:

- The P is attached to an M (`pp.m != 0` indirectly via `m.oldp`).
- The P can be CAS'd to `_Pidle` by either sysmon or `exitsyscallfast`.
- The P has a runqueue that other Ms can run from (via `handoffp`).

This is a unique state. `_Pidle` is similar (no running M) but does not have the "M is somewhere" implication.

---

## M State Invariants

An M in a syscall:

- Has `m.p == 0` (its P is detached).
- Has `m.oldp != 0` (remembers which P was its).
- Has `m.curg.atomicstatus == _Gsyscall`.
- Cannot be selected by any scheduler call (`findRunnable`, work stealing) — it is in the kernel.

Once the syscall returns:

- The M tries `exitsyscallfast(oldp)`.
- On success: `m.p = oldp`, `m.oldp = 0`, M is back in scheduler.
- On failure: M takes slow path; eventually `m.p = some_p` and `m.curg = some_g`.

If the M cannot find a P:

- It calls `stopm`, which parks it on `sched.midle` (or `sched.mlocked` for locked Ms).
- It will be woken by another goroutine's scheduler call that needs an M.

---

## Concurrency Invariants Between sysmon and exitsyscall

The critical lock-free interaction:

```
sysmon side:                          exitsyscall side:
  read pp.status                        read pp.status (must be _Psyscall)
  if _Psyscall and > 10 µs:             CAS pp.status _Psyscall->_Pidle
    CAS pp.status _Psyscall->_Pidle       if CAS won:
    if CAS won:                              acquirep(oldp)
       handoffp(pp)                          return fast path
```

Only one party wins the CAS. If sysmon wins:

- `handoffp` runs.
- `exitsyscallfast` sees `pp.status != _Psyscall`, returns false, slow path.

If `exitsyscall` wins:

- `exitsyscallfast` re-attaches and returns true.
- Sysmon's CAS fails; sysmon moves on.

This is the heart of the lock-free syscall handling. No `sched.lock` taken in the fast path.

### Memory ordering

The CAS on `pp.status` provides a release-acquire barrier. Anything written by sysmon before the CAS is visible to the M that picks up the P after.

---

## Cgo Contract

Cgo calls have these contracted properties:

1. **A cgo call holds an M for its duration.** The M cannot serve other goroutines.
2. **The P is detached and may be handed off.** Other goroutines continue on other Ms.
3. **The C function runs on the M's `g0` stack, not the goroutine's stack.** Stack size is fixed (~8 KB on Linux).
4. **The Go scheduler does not preempt code inside the C function.** Cooperative or asynchronous preemption requested while in cgo is deferred until `exitsyscall`.
5. **Signals delivered during a cgo call may be handled or deferred** — implementation-specific to the OS and runtime version.
6. **Calling Go from C (`crosscall2`) creates a new goroutine** on the calling thread or temporarily attaches one.

Not contracted:

- The exact overhead of a cgo call (depends on architecture, GO version).
- Whether multiple cgo calls in the same goroutine reuse the same M (they may; they may not).

---

## `LockOSThread` Contract

From `runtime` package documentation:

> `LockOSThread` wires the calling goroutine to its current operating system thread. The calling goroutine will always execute in that thread, and no other goroutine will execute in it, until the calling goroutine has made as many calls to `UnlockOSThread` as to `LockOSThread`.

Specific guarantees:

1. **The goroutine runs only on its locked M.** No migration.
2. **No other goroutine runs on the locked M** while the lock is held.
3. **Calls are counted.** Nested `LockOSThread`/`UnlockOSThread` pairs match.
4. **If the goroutine exits while locked, the thread is unusable**; the runtime treats it as compromised.
5. **`LockOSThread` is inherited by `runtime.LockOSThread` callers within the goroutine** but not by other goroutines spawned from it.

Not contracted:

- Whether the thread is destroyed immediately after a locked goroutine exits, or pooled for re-use.
- Whether the thread has any specific affinity (cpuset, NUMA).
- What signals are delivered to a locked goroutine vs to its M.

---

## Netpoller Contract

The netpoller is not exposed as a public API, so there is no formal contract. What is reliable:

- **All `net` package types** (`TCPConn`, `UDPConn`, `UnixConn`, `Listener`) use the netpoller. Read/Write calls park goroutines without holding an M.
- **`time.Sleep`, `time.After`, `time.NewTimer`** integrate with the netpoller (the runtime timer heap is netpoller-aware).
- **`select` with a `<-time.After()` case** uses the netpoller for the timeout.

Not contracted:

- Whether `os.Pipe` fds are netpoller-backed (depends on whether they were set non-blocking).
- Whether `os.File.Read` on a character device uses the netpoller.
- Whether `os/signal` channels are netpoller-backed (currently not — they use channel buffering).

If you need a guarantee that an fd is netpoller-backed, use the `net` package types.

---

## Cross-References to Standards

The Go syscall machinery sits on top of:

- **POSIX threads** (IEEE Std 1003.1-2017): provides `pthread_create`, `pthread_kill`, signal semantics. Go does not use libc's pthreads on Linux but matches their semantics.
- **Linux clone(2)** (`man 2 clone`): the kernel interface Go uses directly on Linux.
- **Linux epoll(7)** (`man 7 epoll`): the netpoller's Linux backend.
- **BSD kqueue(2)**: macOS/FreeBSD netpoller backend.
- **Windows IOCP** (I/O Completion Ports, MSDN): Windows netpoller backend.
- **POSIX signals** (`man 7 signal`): how the runtime delivers signals to specific threads.

For Go-specific design references:

- *Scalable Go Scheduler Design* (Dmitry Vyukov, 2012) — the original GMP design.
- Go proposal 24543: "Non-cooperative goroutine preemption" — added async preemption in Go 1.14.
- `runtime/HACKING.md` — invariants of the scheduler.
- `runtime/proc.go` comment headers — describe each function's contract.

These are the references a Go runtime engineer reaches for. As a user, you typically need only the godoc and the `HACKING.md`.

---

## Summary

The Go language specification says almost nothing about syscalls — only that goroutines run concurrently. The runtime documentation contracts a small but important set of guarantees:

- A syscall does not block other goroutines.
- `LockOSThread` pins a goroutine to its thread.
- `runtime.SetMaxThreads` caps OS threads (default 10000).
- Network I/O via `net` package uses the netpoller.

A larger set of behaviours is implementation-defined: the 10 µs sysmon threshold, the M-pool size, VDSO usage, exact CAS sequences. Production code should not depend on these.

The runtime maintains strict invariants on goroutine/P/M states across the syscall transitions. The CAS race between sysmon's handoff and `exitsyscallfast`'s re-attach is the central piece of lock-free machinery in the syscall path.

For interfaces with hardware or other languages (cgo, OS APIs), `LockOSThread` provides the only stable thread-affinity contract. Use it deliberately, understand its cost.

When in doubt, consult `runtime/HACKING.md` and the godoc; do not reverse-engineer guarantees from current behaviour.
