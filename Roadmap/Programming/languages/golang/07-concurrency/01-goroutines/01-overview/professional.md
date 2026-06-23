# Goroutines — Professional Level (Under the Hood)

## Table of Contents
1. [Introduction](#introduction)
2. [The GMP Model](#the-gmp-model)
3. [Anatomy of a `g` Struct](#anatomy-of-a-g-struct)
4. [The `go` Statement at the Assembly Level](#the-go-statement-at-the-assembly-level)
5. [Run Queues: Local, Global, and Net Poller](#run-queues-local-global-and-net-poller)
6. [Work-Stealing](#work-stealing)
7. [Sysmon: the Background Monitor](#sysmon-the-background-monitor)
8. [Asynchronous Preemption (Go 1.14+)](#asynchronous-preemption-go-114)
9. [Stack Growth and Shrinking](#stack-growth-and-shrinking)
10. [The Network Poller and `Gwaiting`](#the-network-poller-and-gwaiting)
11. [Syscalls and the `M`-Park Dance](#syscalls-and-the-m-park-dance)
12. [GOMAXPROCS and `Pidle`](#gomaxprocs-and-pidle)
13. [Goroutine Identity and Reuse](#goroutine-identity-and-reuse)
14. [Tracing the Scheduler](#tracing-the-scheduler)
15. [Limits, Failure Modes, and Defaults](#limits-failure-modes-and-defaults)
16. [Self-Assessment](#self-assessment)
17. [Summary](#summary)

---

## Introduction

Everything you have learned about goroutines so far is true at the level of behaviour. This document explains *how* the Go runtime makes them work: the scheduler's data structures, the algorithms that move goroutines between threads, the technique used to preempt a tight loop, and the mechanisms that let a million goroutines share a handful of OS threads.

The references throughout point at files in the Go runtime source (`src/runtime/`), which is by design readable Go code. The runtime is not a black box; you can read it.

---

## The GMP Model

The Go scheduler is a work-stealing scheduler over three abstractions:

| Letter | Meaning | Lives in |
|---|---|---|
| **G** | Goroutine — the unit of work | `runtime.g` struct |
| **M** | Machine — an OS thread | `runtime.m` struct |
| **P** | Processor — a logical scheduler context | `runtime.p` struct |

Their relationship:

```
              Gs (millions)
              ┌──────────────────────────────┐
              │  G G G G G G G G G G G G ... │
              └──────────────────────────────┘
                          ↓ scheduled onto
              ┌──────────────────────────────┐
              │     P     P     P     P      │  <- GOMAXPROCS Ps
              └──────────────────────────────┘
                          ↓ executed by
              ┌──────────────────────────────┐
              │  M  M  M  M  M  M  M  ...    │  <- as many Ms as needed
              └──────────────────────────────┘
                          ↓ run on
              ┌──────────────────────────────┐
              │     OS kernel threads         │
              └──────────────────────────────┘
```

### What is a P?

A `P` is the scheduler's per-CPU bookkeeping: a local run queue of runnable Gs, a small free list of Gs and stacks, and the scheduler state for one logical processor. By default `GOMAXPROCS = NumCPU`, so on a 16-core machine there are 16 Ps.

A `G` can run only when bound to a `P`, and a `P` can run only when bound to an `M`. The triple `(G, P, M)` is the runtime's atomic unit of execution.

### Why Ps exist

Without Ps, the scheduler would need a global lock to dequeue runnable goroutines. Ps give each scheduler "lane" its own runqueue, so most scheduling is contention-free. Ps also make it possible to enforce `GOMAXPROCS` without counting Ms: there is exactly one P per concurrent execution slot.

### Ms come and go

A new M is created when:

- A G makes a blocking syscall and the P needs another M to keep running.
- All Ms are busy and there are runnable Gs.

Idle Ms are parked on a list and reused. Go 1.21+ also retires Ms that have been idle for too long, returning their resources to the OS.

---

## Anatomy of a `g` Struct

`runtime.g` (in `runtime/runtime2.go`) is the in-memory representation of a goroutine. Selected fields:

```go
type g struct {
    stack       stack       // current stack range [stack.lo, stack.hi)
    stackguard0 uintptr     // checked by stack-growth prologue
    m           *m          // current M (or nil if not running)
    sched       gobuf       // saved register state when not running
    atomicstatus uint32     // Grunnable, Grunning, Gwaiting, ...
    goid         int64      // unique ID (not exposed via API)
    waitreason  waitReason  // why is it blocked, if any
    preempt     bool        // request to preempt at next safe point
    parentGoid  int64       // who spawned us (since 1.21)
    // ... ~50 more fields
}
```

A `g` is small — roughly a few hundred bytes — separate from its stack. The runtime keeps a free list of `g` structs and reuses them across goroutines, so the per-goroutine bookkeeping cost amortises near zero.

The `goid` is intentionally not exposed through `runtime` package: it is unstable across versions and would tempt patterns the runtime authors consider harmful.

---

## The `go` Statement at the Assembly Level

When you write `go f(x)`, the compiler emits a call to `runtime.newproc`:

```go
// runtime/proc.go
func newproc(fn *funcval) {
    gp := getg()
    pc := getcallerpc()
    systemstack(func() {
        newg := newproc1(fn, gp, pc)
        // place on local runq
        runqput(pp, newg, true)
        if mainStarted {
            wakep()  // maybe wake another P
        }
    })
}
```

Concretely:

1. Allocate or recycle a `g` struct from the P-local free list.
2. Allocate a 2 KB stack (also from a free list when possible).
3. Initialise `g.sched` so that, when this G is dispatched, control jumps to a small assembly trampoline that calls `f`.
4. Push the new G onto the current P's local run queue.
5. If there are idle Ps and we have surplus work, wake one (`wakep`).

The whole thing runs in a few hundred nanoseconds — far cheaper than `pthread_create`, which calls into the kernel and allocates a megabyte.

### The arguments are a closure

The compiler synthesises a `funcval` that captures `f` and the *evaluated* arguments. That is why `go f(getValue())` evaluates `getValue()` in the parent goroutine before the new G is even allocated.

---

## Run Queues: Local, Global, and Net Poller

The scheduler chooses the next G to run by looking, in order, at three queues:

```
1. Local run queue of the current P  (lock-free, ~256 capacity)
2. Global run queue                  (mutex-protected, unbounded)
3. Network poller                    (Gs woken by I/O readiness)
```

### Local run queue

A 256-slot ring buffer per P. Lock-free for the owner P (uses atomics). Pushes and pops are nanosecond-scale.

When the queue overflows, the owner P moves half of it to the global run queue.

### Global run queue

A linked list, protected by `sched.lock`. Used as overflow for local queues and as the seed for new Ps.

To prevent global-queue starvation, the scheduler pulls from the global queue every 61 ticks (`sched_tick % 61 == 0`), even if the local queue is non-empty.

### Network poller

The runtime has a single goroutine per platform that calls `epoll_wait` (Linux), `kevent` (BSD/macOS), or `GetQueuedCompletionStatus` (Windows). When an I/O is ready, the runtime moves the parked G back to runnable state. The scheduler treats the net poller as a third source of work.

This is why a Go web server with 100 000 idle WebSocket connections runs on 4 OS threads: only the connection that just became readable is on a runqueue; the other 99 999 Gs are parked in `Gwaiting` and consume no scheduling attention until their I/O event fires.

---

## Work-Stealing

When a P's local runqueue is empty and the global queue is empty, the P does not idle — it tries to *steal* work from another P.

```go
// runtime/proc.go (simplified)
for i := 0; i < 4; i++ {
    p2 := randomPotherThanSelf()
    if g := runqsteal(self, p2, ...); g != nil {
        return g
    }
}
```

The thief takes half of the victim's local queue. Stealing is the load-balancing mechanism: an unevenly distributed workload self-balances within a few microseconds.

If stealing also fails:

1. Check the network poller for ready Gs.
2. Run the GC if it is helpful.
3. Park the M.

A parked M is genuinely idle: it is sleeping on a futex/condition variable, costing zero CPU. When new work arrives and a P needs help, `wakep` wakes the M.

---

## Sysmon: the Background Monitor

`sysmon` is a special M that runs *without a P*. It runs forever in `runtime.sysmon` (in `runtime/proc.go`). Its job is to do the things the regular scheduler can't:

- **Retake Ps from goroutines that have been running too long.** Sysmon checks every ~10ms; if a G has been on the same P for >10ms, sysmon sets `g.preempt = true` and (in Go 1.14+) sends a signal to preempt it.
- **Retake Ps from blocked syscalls.** If an M has been in a syscall longer than ~20μs, sysmon hands the P to another M so the runtime can keep scheduling.
- **Trigger garbage collection** if it has been longer than `GOGC` allows.
- **Force network poll** to make sure I/O is checked even when all goroutines are CPU-bound.
- **Forcibly close idle network conns** in some scenarios.

Sysmon runs at adaptive frequency: as fast as 20 microseconds when the system is busy, slowing to 10 milliseconds when idle.

Sysmon is the reason your CPU-bound goroutines do not starve the scheduler: even if every goroutine is in a tight loop, sysmon eventually tells the runtime to preempt them.

---

## Asynchronous Preemption (Go 1.14+)

Before Go 1.14, preemption was *cooperative*: the runtime could only preempt a goroutine at function-call boundaries (where the stack-growth check lived). A function with no inner calls — say, a tight loop — could run forever, ignoring preemption requests.

Famous bug:

```go
for { /* no calls */ }
```

In pre-1.14 Go with `GOMAXPROCS=1`, this loop blocked GC and every other goroutine. The whole runtime froze.

Go 1.14 introduced **asynchronous preemption** based on POSIX signals (Linux: `SIGURG`):

1. Sysmon sees a G has run too long.
2. The runtime sends `SIGURG` to the M running that G.
3. The signal handler installs a frame that, on return, puts the G into a safe parking state.
4. The G is descheduled; the M picks up another G.

Asynchronous preemption makes the scheduler *truly preemptive*. Tight loops, infinite recursion (until stack exhaustion), and CPU-hot workloads no longer stall GC or other goroutines.

The implementation is delicate: signals can interrupt at any instruction, so the runtime must verify that the interrupted state is "safe" — registers properly saved, stack maps known. The mechanism is documented in the Go runtime sources and was the subject of Austin Clements' GopherCon 2020 talk.

---

## Stack Growth and Shrinking

A goroutine starts with a stack of 2 KB (since 1.4; before that, 8 KB). When the stack overflows, the runtime grows it.

### How the check works

Every function prologue (compiled by `cmd/compile`) inserts a stack-bound check:

```asm
CMPQ SP, g_stackguard0(R14)   ; compare SP to lo guard
JLS  morestack                ; if too low, grow
```

If `SP` falls below `stackguard0`, the function jumps into `runtime.morestack`, which:

1. Allocates a new stack twice the size of the current one.
2. Copies the contents of the old stack to the new stack.
3. Adjusts every pointer that points into the old stack (the runtime knows where they all are because of the per-instruction stack maps the compiler emits).
4. Resumes execution at the calling function.

Stack growth is rare in steady state but occurs on first call, deep recursion, or large local variables.

### Shrinking

The garbage collector triggers stack shrinking. If a goroutine's stack is mostly empty, the GC may copy it back down to a smaller stack to save memory. Shrinking is conservative — it only happens if at least 75% of the stack is unused.

### Limits

The default maximum stack size is 1 GB on 64-bit systems (1 GiB on Linux). You can change it with `runtime/debug.SetMaxStack`. Hitting the limit causes the program to crash with "stack overflow."

---

## The Network Poller and `Gwaiting`

Every blocking I/O operation in Go's `net`, `os`, and `time` packages is implemented via the network poller. When a goroutine calls `conn.Read`:

1. The runtime sets the file descriptor to non-blocking.
2. The goroutine attempts the read; if no data, the syscall returns `EAGAIN`.
3. The runtime parks the goroutine in `Gwaiting`, registers the FD with epoll/kqueue, and the M moves on to other work.
4. When epoll/kqueue reports the FD is readable, the netpoll goroutine puts the G back into `Grunnable`.

This is why goroutine I/O does not consume threads. The OS knows about a small pool of Ms; it does not know there are 50 000 goroutines reading from sockets.

### Why this is more efficient than thread-per-connection

The kernel's `epoll_wait` is a single syscall per N I/O events, far cheaper than waking N threads. Combine that with the per-goroutine 2KB stack (versus per-thread 1MB stack), and Go's I/O model is roughly two orders of magnitude more memory-efficient than the thread-per-connection model used by classical Apache or Java's older NIO patterns.

---

## Syscalls and the `M`-Park Dance

Some syscalls are not pollable (file I/O on most filesystems, DNS lookups via cgo). The goroutine cannot be parked on epoll; the M actually blocks in the kernel.

The runtime handles this via a hand-off:

1. Before a blocking syscall, the runtime calls `entersyscall`. This detaches the M from its P.
2. Sysmon notices the M has been in syscall too long and assigns the P to another M (creating one if necessary).
3. When the syscall returns, the M tries to reacquire its old P. If unavailable, it grabs any idle P. If none, the M is parked.

Effect: a goroutine doing `os.Read` on a file does block one OS thread, but the rest of the runtime keeps running on other threads.

### Cost

Every blocking syscall adds overhead from the P hand-off: typically ~1-2μs. For high-frequency syscall workloads, this matters; for an HTTP server, it disappears in the noise.

---

## GOMAXPROCS and `Pidle`

`GOMAXPROCS` controls the number of Ps. Setting it to N means up to N goroutines can run *in parallel* (truly simultaneously on different cores).

### Defaults

Since Go 1.5, the default is `runtime.NumCPU()`. Since Go 1.16, on Linux, it respects cgroup CPU quotas (so containers see the right number).

In Go 1.22+, `runtime.GOMAXPROCS(0)` returns the current value without changing it.

### When to override

| Situation | Adjustment |
|---|---|
| Container with CPU limit but old Go runtime | Set `GOMAXPROCS` to the limit explicitly via `automaxprocs` library |
| Latency-sensitive service co-located with other work | Reduce GOMAXPROCS to leave headroom |
| CPU-bound batch job alone on a host | Default is correct |
| Bench mark to compare single-thread performance | Set `GOMAXPROCS=1` to remove scheduler noise |

### `Pidle` and wake-up logic

Idle Ps live on a stack (`sched.pidle`). When a goroutine is spawned and the spawner has surplus work, the runtime pops a P from `pidle` and wakes a corresponding M. This is the `wakep` step of `newproc`.

If there are no idle Ps, the goroutine simply lands on the spawner's local runq and will be picked up later. No M-creation is forced.

---

## Goroutine Identity and Reuse

Goroutines have IDs (`g.goid`), but the runtime does not expose them. The reasons:

- IDs would tempt code to track goroutines as identities (anti-pattern; use `context.Context`).
- Goroutine structs are recycled; IDs change semantics across versions.
- A stable ID would enable goroutine-local storage, which the Go authors deliberately do not provide.

You can reach the ID via `runtime/debug.Stack` parsing or unsafe tricks, but **don't.** Pass identity in `context.Context` instead.

### Reuse

When a G exits, its struct is placed on the P-local g free list (`p.gFree`) for reuse. The stack may be recycled too. This is why goroutine creation amortises so cheaply — most "creations" are reuses.

---

## Tracing the Scheduler

`GODEBUG=schedtrace=1000` prints scheduler statistics every 1000 ms:

```
SCHED 1003ms: gomaxprocs=8 idleprocs=2 threads=12 spinningthreads=1 idlethreads=4 runqueue=3 [0 1 0 4 0 0 2 0]
```

Fields:

- `gomaxprocs` = current P count
- `idleprocs` = Ps not running anything
- `threads` = total Ms
- `spinningthreads` = Ms actively looking for work (not yet parked)
- `idlethreads` = Ms parked
- `runqueue` = global runq depth
- `[...]` = each P's local runq depth

Add `scheddetail=1` for per-P / per-M / per-G detail. Beware: extremely chatty.

### `runtime/trace`

```go
trace.Start(f)
defer trace.Stop()
```

Produces a binary trace consumable by `go tool trace`. The browser visualisation shows every goroutine's life, every syscall, every GC pause, every preemption. Indispensable for debugging scheduler-induced latency.

---

## Limits, Failure Modes, and Defaults

| Limit | Default | Adjustable? |
|---|---|---|
| Goroutine count | unbounded | implicitly by memory |
| Per-goroutine starting stack | 2 KB | not via API |
| Per-goroutine max stack | 1 GB on 64-bit | `debug.SetMaxStack` |
| `GOMAXPROCS` | `NumCPU()` | env var or `runtime.GOMAXPROCS` |
| Local runq capacity | 256 | not adjustable |
| Sysmon period | 20 μs to 10 ms (adaptive) | not adjustable |
| Async preemption signal | `SIGURG` (Linux) | not adjustable |
| Scheduler tick period for global runq pickup | every 61 ticks | not adjustable |

### Failure modes

- **OOM from goroutine leak.** Each leaked goroutine costs ~2 KB stack + closure heap. A million leaks is ~2-4 GB.
- **Stack overflow.** Hit at 1 GB; usually means infinite recursion.
- **Scheduler livelock.** Pre-1.14 with a tight loop and `GOMAXPROCS=1`. Solved by async preemption.
- **GC starvation.** Too few cycles between GC triggers; goroutines pile on the global queue. Tune `GOGC` or reduce allocation rate.
- **Cgo deadlock.** Cgo calls do not yield; if every M is in cgo, the runtime cannot schedule. Set `GOMAXPROCS` higher than expected concurrent cgo callers.

---

## Self-Assessment

- [ ] I can describe the GMP model in a whiteboard interview.
- [ ] I know where in the runtime sources `newproc`, `findrunnable`, `runqsteal`, and `sysmon` live.
- [ ] I can explain how a goroutine moves between Grunnable, Grunning, Gwaiting, and Gdead.
- [ ] I understand why async preemption was needed and how SIGURG implements it.
- [ ] I know what work-stealing is and when it kicks in.
- [ ] I can read a `GODEBUG=schedtrace=1000` line and interpret it.
- [ ] I have used `runtime/trace` to debug a real latency issue.
- [ ] I know when goroutine-per-connection breaks down (memory) and when event loops would help (rarely).
- [ ] I understand stack growth: when, how, what it costs.
- [ ] I have read at least 200 lines of `runtime/proc.go`.

---

## Summary

The Go scheduler is a work-stealing, partly preemptive scheduler over an `(M, P, G)` triple. Each P holds a local 256-entry runqueue; idle Ps steal work from busy ones. A background monitor thread (`sysmon`) preempts goroutines that run too long, hands off Ps stuck in syscalls, and pokes the network poller. Asynchronous preemption (Go 1.14+) ensures even tight loops can be paused. Goroutines start with 2 KB stacks that grow on demand. I/O is multiplexed through a single epoll/kqueue/IOCP loop, so 100 000 idle network goroutines cost almost nothing.

The whole edifice exists for one reason: to make "spawn a goroutine" feel free, while still scaling to millions of them. Once you understand how it works, you can debug the few failure modes that occur (cgo deadlocks, GC starvation, scheduler latency) instead of treating the runtime as magic.

Read `runtime/proc.go`. Read `runtime/runtime2.go`. Read `runtime/netpoll.go`. They are some of the best-commented Go code in existence, and they make every goroutine you ever write a little less mysterious.
