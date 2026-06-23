# The G-M-P Model — Junior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Pros & Cons](#pros-cons)
8. [Use Cases](#use-cases)
9. [Code Examples](#code-examples)
10. [Coding Patterns](#coding-patterns)
11. [Clean Code](#clean-code)
12. [Product Use / Feature](#product-use-feature)
13. [Error Handling](#error-handling)
14. [Security Considerations](#security-considerations)
15. [Performance Tips](#performance-tips)
16. [Best Practices](#best-practices)
17. [Edge Cases & Pitfalls](#edge-cases-pitfalls)
18. [Common Mistakes](#common-mistakes)
19. [Common Misconceptions](#common-misconceptions)
20. [Tricky Points](#tricky-points)
21. [Test](#test)
22. [Tricky Questions](#tricky-questions)
23. [Cheat Sheet](#cheat-sheet)
24. [Self-Assessment Checklist](#self-assessment-checklist)
25. [Summary](#summary)
26. [What You Can Build](#what-you-can-build)
27. [Further Reading](#further-reading)
28. [Related Topics](#related-topics)
29. [Diagrams & Visual Aids](#diagrams-visual-aids)

---

## Introduction
> Focus: "What do the letters G, M, and P actually mean, and why does the Go runtime need all three?"

You already know that the line `go f()` starts a goroutine and that the runtime takes care of running it on the available CPU cores. The piece that makes this work is the **Go scheduler**, and the scheduler is built around three pieces of runtime data — three Go structs in the file `runtime/runtime2.go`:

- **G** stands for **goroutine**. There is one `g` struct per goroutine you create, including the special "system" goroutines the runtime uses for its own work.
- **M** stands for **machine**. An `m` represents one OS thread. The Go runtime asks the kernel for an OS thread, and that thread is wrapped by an `m` for the runtime's own bookkeeping.
- **P** stands for **processor** — but not a hardware CPU. A `p` is a **logical scheduling context**: a slot that gives an M permission to run user Go code. There are exactly `GOMAXPROCS` of them.

The mental shorthand you can take everywhere:

> G is *what runs*. M is *who runs it* (an OS thread). P is *the right to run* (a license, plus a small local queue of upcoming goroutines).

To execute one line of your Go program, all three must come together: a runnable G is picked from a P's local queue, the M that owns that P runs the G's code on a CPU core. When any of the three is missing — no runnable G, or no available M, or no free P — the scheduler reshuffles until it can complete the triangle again.

This page is the gentle on-ramp. We will not yet read runtime source line by line (that is the professional level), and we will not yet trace work-stealing or syscall handoff in detail (those are separate subsections under `10-scheduler-deep-dive`). What you will leave with is a clear, mostly correct picture of the three letters, why three is the right number, and why the redesign that introduced **P** in 2012 made Go go from "noticeably slow above 4 cores" to "scales to dozens of cores".

After reading this file you will:

- Know what each of G, M, and P represents
- Understand why Go separates "thread" (M) from "scheduling context" (P)
- Know that there are exactly `GOMAXPROCS` Ps and many more Ms and even more Gs
- Recognise the local runqueue (LRQ) per P and the single global runqueue (GRQ)
- Understand the historical motivation: Go 1.0 had one global runqueue and one lock, which did not scale
- Be able to read a goroutine trace (`go tool trace`) and tell which P ran which goroutine
- Know where in the runtime source the structs live: `runtime/runtime2.go`

You do not yet need to understand work-stealing, async preemption, sysmon, or the details of how a syscall hands off a P. Those sit under the same parent and are covered there.

---

## Prerequisites

- **Required:** A working understanding of "goroutine" at the level of section `01-goroutines`. You should be comfortable spawning a goroutine, using `sync.WaitGroup`, and reading the output of `runtime.NumGoroutine`.
- **Required:** Awareness that an OS thread is the kernel's unit of CPU scheduling, and that creating one is expensive compared to function calls.
- **Helpful:** A vague idea of what `GOMAXPROCS` does (defaults to the number of CPU cores). The dedicated subsection `03-gomaxprocs-tuning` covers it deeply; this page only needs the rough picture.
- **Helpful:** Familiarity with the file `runtime/proc.go` existing — you do not have to have read it.

If you can write a small program that spawns N goroutines, waits for them with a `WaitGroup`, and prints `runtime.NumGoroutine()` before and after, you are ready.

---

## Glossary

| Term | Definition |
|---|---|
| **G** | A goroutine. Concrete: a `g` struct in `runtime/runtime2.go`. Holds the goroutine's stack pointer, status, the function it is running, and pointers used by the scheduler. |
| **M** | A "machine" — Go runtime's wrapper around one OS thread. Concrete: an `m` struct. The kernel scheduler decides when an M's thread runs on a CPU; the Go runtime decides which G that M will execute. |
| **P** | A "processor" or scheduling context. Concrete: a `p` struct. There are exactly `GOMAXPROCS` of them. A P owns a local runqueue of up to 256 runnable Gs plus per-P caches (sudog pool, defer pool, mcache for the allocator). |
| **Local runqueue (LRQ)** | The per-P bounded queue of runnable goroutines. Capacity 256. Accessed almost lock-free from the owning M; thieves use atomics. |
| **Global runqueue (GRQ)** | The single runtime-wide queue of runnable goroutines that overflow from local queues or arrive from system goroutines. Guarded by `sched.lock`. Drained periodically (every 61 schedule iterations) to ensure fairness. |
| **`GOMAXPROCS`** | The number of Ps. Equivalently, the maximum number of user-Go goroutines that may execute simultaneously. Defaults to `runtime.NumCPU()`. |
| **Idle M list** | `sched.midle` — a linked list of Ms that have no work and are parked on a futex waiting to be woken. |
| **Idle P list** | `sched.pidle` — a linked list of Ps not currently bound to a running M. |
| **Spinning M** | An M actively looking for work (briefly burns CPU spinning before parking). Caps at `GOMAXPROCS/2` to avoid wasted CPU. |
| **`newproc`** | The runtime function called by `go f()`. Allocates or reuses a `g`, sets up its stack, and places it on the current P's local runqueue. |
| **`schedule()`** | The main scheduler loop, run by each M. Picks the next G to run, switches stacks, jumps into the G's code. |
| **`findrunnable`** | The function `schedule()` calls when its P's local queue is empty. Implements the search order: local, global, netpoll, steal, park. |
| **`sysmon`** | A dedicated runtime goroutine that runs without a P and watches the system: forcing preemption on long-running Gs, retaking Ps from blocked syscalls, triggering GC. |
| **G0** | Each M has a special bootstrap goroutine called `g0` that runs scheduler code itself. It has a large OS-thread-sized stack. User Gs run on small growable stacks; scheduler code runs on g0. |
| **`runtime/runtime2.go`** | The source file where the structs `g`, `m`, `p`, `sched`, and friends are declared. The canonical reference for the layout. |
| **`runtime/proc.go`** | The source file where the scheduler logic lives: `schedule`, `findrunnable`, `newproc`, `gopark`, `goready`, work-stealing, idle lists. |

---

## Core Concepts

### Three letters, three responsibilities

If you collapsed the runtime scheduler into one sentence, it would be: *"Many Gs share few Ms via exactly `GOMAXPROCS` Ps."* That sentence is the M:N relationship in compressed form. Each letter exists because no two of them can be merged without breaking either scalability or correctness.

- **G must be its own thing** because goroutines are far more numerous than threads and far cheaper to create. A `g` struct is around 200–300 bytes plus a 2-KiB initial stack — small enough to keep millions live.
- **M must be its own thing** because the kernel is the entity that puts code on a CPU. The Go runtime cannot bypass the kernel; it can only ask for OS threads via `clone(2)` (on Linux) and pin its scheduling structures to them.
- **P must be its own thing** because between G and M sits a piece of state that should *not* be shared globally (or you serialise everything through one lock) and should *not* be tied to an OS thread (or you cannot move work off a thread that is about to block). P is that piece of state.

Once you internalise this division of responsibility, every mechanism in the scheduler becomes natural: "park the G," "park the M," "hand off the P." Each of the three has its own state machine; the scheduler is the choreography between them.

### G — the goroutine

A `g` is the runtime's record of "one execution of one function." It does *not* know which CPU it is running on. It barely knows which M it is running on (only via a back-pointer set when it is scheduled). Its core members are:

- `stack` — pointers to the bottom and top of the goroutine's stack, which lives on the heap.
- `sched` — saved register set used when the G is parked: PC, SP, BP, and a function value pointer. When the scheduler resumes a G it loads these into the CPU registers.
- `atomicstatus` — one of `_Gidle`, `_Grunnable`, `_Grunning`, `_Gsyscall`, `_Gwaiting`, `_Gdead`. Transitions are atomic.
- `m` — back-pointer to the M currently executing this G (nil if not running).
- `waitreason` — for parked goroutines, a code naming why (sleep, channel, mutex, etc.). Visible in `runtime.Stack` output.
- `goid` — a monotonically increasing id, useful for tracing but **deliberately not exposed** in the public Go API.

You can think of a `g` as a saved process context, much like a kernel saves a thread's registers in `task_struct`. The difference: the Go runtime, not the kernel, controls the saving and the resumption.

### M — the OS thread wrapper

An `m` represents one OS thread that the runtime has acquired (via `clone(2)`/`pthread_create`-like flags). The thread does whatever the runtime tells it; it does not know it is running Go in particular.

Core members:

- `g0` — a special goroutine whose stack *is* the OS thread's stack (typically 8 KiB or more). Runs scheduler code, GC code, signal handling.
- `curg` — the user goroutine currently executing on this M (or nil if running scheduler code on g0).
- `p` — the P currently attached. May be nil briefly (between schedule loop iterations or during a syscall).
- `nextp` — a hint for which P to attach to next when waking from a parked state.
- `spinning` — true when the M is actively searching for work before parking.

An M's life cycle: created on demand when an idle P needs work and no idle M is available; reused via the idle list when work runs out; never destroyed in the common case (the runtime keeps Ms around as a thread pool).

### P — the scheduling context

A `p` is the most important struct in this whole subsystem. It is the piece that did not exist in Go 1.0. Core members:

- `runq` — the local runqueue, a 256-slot ring buffer of `*g`. Accessed without locks by the owning M.
- `runqhead`, `runqtail` — atomic indices into the ring buffer. Other Ps reading via work-stealing only need atomics, not the runtime mutex.
- `runnext` — a single-slot "skip-the-queue" cache. A G placed in `runnext` is the next to run, ahead of `runq`. This makes channel-driven ping-pong fast: when goroutine A unblocks goroutine B by sending on a channel, B lands in `runnext` so it runs immediately when A blocks or yields.
- `mcache` — a per-P allocator cache; tiny allocations skip the central allocator entirely.
- `sudogcache` — pool of `sudog` structs (used when a G parks on a channel or `sync.Cond`).
- `deferpool` — pool of `_defer` records.
- `m` — back-pointer to the M currently holding this P (nil when idle).
- `status` — one of `_Pidle`, `_Prunning`, `_Psyscall`, `_Pgcstop`, `_Pdead`.

The P is what makes the scheduler scale. Almost every operation a running goroutine does — pop the next G to run, push a freshly-spawned G, allocate a small object, recycle a `sudog` — touches only P-local state, with no contention against other cores. Cross-P operations (work-stealing, global queue access) are the exception, not the rule.

### Why exactly `GOMAXPROCS` Ps?

A P is a *license to run user Go code*. The runtime caps the number of licenses at `GOMAXPROCS` so that the number of goroutines simultaneously executing user code never exceeds it. This is how Go bounds CPU parallelism without bounding the number of OS threads (Ms can exist beyond `GOMAXPROCS`, they just cannot run user code without grabbing a P first).

If you set `GOMAXPROCS=1`, only one goroutine runs user code at any moment, even on a 32-core machine. If you set `GOMAXPROCS=32`, up to 32 do, assuming enough runnable goroutines.

Crucially, an M that does *not* hold a P can still exist and do work — but only runtime work: a thread blocked in a syscall, the sysmon thread, a thread in cgo. Those Ms hold no license to schedule user Gs.

### The local runqueue and the global runqueue

Each P has a 256-slot ring buffer of runnable `*g`. When `go f()` creates a new G, the new G is placed in the *current* P's local queue. When that P's M needs another G to run, it picks one from the head of its local queue without taking any lock.

Two situations push goroutines beyond a single P's local queue:

1. **Overflow**: the local queue is full (256 entries). The owning M takes a batch of half the queue plus the new G and moves them to the global runqueue (`sched.runq`).
2. **System-wide work**: goroutines created or woken by the runtime in non-P contexts (sysmon, the finalizer goroutine) land on the global queue too.

The global runqueue is protected by `sched.lock`. To avoid starving it, every P drains one G from the global queue every 61st iteration of `schedule()` (the number is arbitrary, large enough to be cheap, small enough to be timely).

### Idle lists for both M and P

Two singly-linked lists in the global `sched` struct keep track of "things ready but not in use":

- `sched.midle` — chain of parked Ms. An M parks here when it has no P and no work. Waking is a futex wake.
- `sched.pidle` — chain of unbound Ps. A P lands here when its M went into a long syscall or when the M is finishing work and parking.

When `newproc` puts a G onto a busy P and there is an idle P and an idle M, the runtime can wake both to start running the new G in parallel. The pair of lists makes this fast: pop a P, pop an M, glue them, futex-wake.

### How the three letters compose at runtime

A loop, in pseudocode, executed by every M:

```
for {
    G := find_runnable(P)        // local, then runnext, then global, then steal, then park
    execute(G)                   // jump into the G's saved PC; runs until it blocks or yields
}
```

That is — in extreme caricature — the whole scheduler. Everything else is *what `find_runnable` does* and *how `execute` is interrupted*. Both topics get their own subsections: `04-work-stealing` for the search, `02-preemption` for the interruption.

---

## Real-World Analogies

### G, M, P as crew, ship, dock-slot

Imagine a busy port with three docks. Each dock has a queue of containers waiting to be loaded onto cargo ships. Containers (Gs) are plentiful. Cargo ships (Ms) come and go; one ship can serve one dock at a time. The dock-slot itself (P) is a fixed piece of infrastructure: the port has exactly three dock-slots. A dock-slot's queue is short and ordered; an empty dock can pull from the central yard if its queue runs dry. A ship in port without a free dock has to wait or leave.

This analogy captures the M:N relationship and why `GOMAXPROCS` is a hard cap on parallelism.

### G, M, P as task, worker, desk

A office of remote contractors. Each desk (P) has an inbox of tasks (Gs). A contractor (M) sits at a desk and works the inbox. There are more contractors than desks; extra contractors wait in the lounge (idle M list). If a contractor has to step out for a phone call (syscall), they leave the desk, and another waiting contractor moves in to keep the inbox draining. The desk's stack of tools (mcache, sudog cache, defer pool) is permanent furniture — it stays with the desk, not the contractor.

This analogy captures why P holds caches and why M can be detached during a syscall.

### G, M, P as recipe, cook, station

A kitchen has four cooking stations (P), eight cooks (M), and a thousand recipes to make tonight (G). Each station has a small ticket rail with the next ten recipes; a giant order spike (global queue) sits at the pass. A cook at a station pulls tickets from their station's rail; when the rail is empty they glance at the spike or peek at another station's rail and "borrow" half (work-stealing). When a recipe calls for "leave the soup to simmer for ten minutes" the cook hands the station to a relief cook and goes to chop vegetables off-station.

This analogy captures local queues, the global queue, work-stealing, and station handoff during blocking work.

---

## Mental Models

### Triangle, not a list

The scheduler is not a list of "things on threads"; it is a triangle of three independent state machines that must align. Picture three vertices labelled G, M, P, with an edge meaning "currently attached":

```
       G  ←→  M
        \   /
         P
```

For user code to advance, all three edges must exist simultaneously: a running G, on an M, with a P. Every time you see a strange runtime behavior ("my goroutine is runnable but not progressing"), the question to ask is *which edge is broken?* — almost always either "no idle M" or "no idle P".

### G is the cheap one, P is the rare one, M is whatever the OS lets us have

Cardinality intuitions:

- Gs: thousands to millions per process.
- Ms: tens to hundreds per process (commonly between `GOMAXPROCS` and `GOMAXPROCS + number-of-syscalls-in-flight`).
- Ps: exactly `GOMAXPROCS`, often single or low double digits.

Most production Go programs have far more Gs than Ms and a small number of Ps. Knowing this ratio shapes your debugging intuition.

### Local-first, global-last

The scheduler always prefers local data over global. Local runqueue first; then `runnext`; then the global queue; then steal from another P; then poll the network; then ask the global queue again; finally park. This ordering is why Go scales: hot paths touch only one cache line, owned by one core, in 99% of operations.

---

## Pros & Cons

**Pros of the G-M-P design**:

- **Scales to many cores**: per-P local queues remove the global hot lock that crippled Go 1.0 above ~4 cores.
- **Cheap goroutines**: G is small, so millions are practical.
- **Cheap context switches**: switching Gs on the same M is just saving and restoring a few registers in user space.
- **Clean syscall handling**: when an M blocks, its P is reclaimed, so other Gs keep running.
- **Good cache locality**: each P keeps its own caches (mcache, sudog, defer), and goroutines that ping-pong on a channel tend to stay on the same P via `runnext`.

**Cons**:

- **Cooperative-then-preemptive**: until Go 1.14, a tight loop without function calls could pin an M and prevent scheduling. Async preemption fixes most of this but not all (we cover it in `02-preemption`).
- **Cgo cost**: a cgo call holds an M outside the scheduler's view, so cgo-heavy code may grow Ms beyond `GOMAXPROCS`.
- **Hard to introspect**: the structs are unexported. You must use `go tool trace` and `runtime/trace` rather than inspect `g`, `m`, `p` directly.
- **Surprises around `GOMAXPROCS` in containers**: pre-1.25 default sometimes overshot the cgroup CPU quota; tools like `automaxprocs` were needed (now covered upstream in `03-gomaxprocs-tuning`).

---

## Use Cases

You write Go code that benefits from understanding G-M-P every day, whether you realise it or not:

- **High-concurrency servers**: a single Go process serving 100k+ connections needs the M:N model. Each connection becomes a goroutine; the scheduler handles the multiplexing.
- **CPU-bound parallel computation**: parallel `for` loops over a slice using `runtime.GOMAXPROCS` workers. Understanding that P is the actual cap on parallelism stops you from spawning 10000 CPU-bound goroutines on a 4-core box and expecting more throughput.
- **Mixed I/O and CPU workloads**: knowing that syscalls hand off the P prevents you from worrying that one slow disk read will stall every other goroutine.
- **Profiling and tracing**: reading `go tool trace` output requires you to read "G123 on P2 on M5" comfortably.
- **Tuning containerized workloads**: setting `GOMAXPROCS` to match a cgroup quota requires you to know that P count = parallelism cap.

---

## Code Examples

### Example 1 — Counting the three letters

```go
package main

import (
    "fmt"
    "runtime"
    "sync"
)

func main() {
    fmt.Println("GOMAXPROCS (number of Ps):", runtime.GOMAXPROCS(0))
    fmt.Println("NumCPU:                    ", runtime.NumCPU())
    fmt.Println("NumGoroutine (Gs) initial: ", runtime.NumGoroutine())

    var wg sync.WaitGroup
    for i := 0; i < 100; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            // do nothing, just exist
        }()
    }
    fmt.Println("NumGoroutine (Gs) peak:    ", runtime.NumGoroutine())
    wg.Wait()
    fmt.Println("NumGoroutine (Gs) final:   ", runtime.NumGoroutine())
}
```

You will observe many Gs (up to ~101 at peak: the 100 spawned plus the main one), but the runtime never exposes the count of Ms directly through the public API — `runtime.NumThread` does not exist. The closest public hook is `runtime/metrics` reading `/sched/threads`.

### Example 2 — Observing the P boundary

```go
package main

import (
    "fmt"
    "runtime"
    "sync"
)

func main() {
    runtime.GOMAXPROCS(2)
    var wg sync.WaitGroup
    wg.Add(2)

    go func() {
        defer wg.Done()
        for i := 0; i < 5; i++ {
            fmt.Println("A")
            runtime.Gosched()
        }
    }()

    go func() {
        defer wg.Done()
        for i := 0; i < 5; i++ {
            fmt.Println("B")
            runtime.Gosched()
        }
    }()

    wg.Wait()
}
```

With `GOMAXPROCS=2`, both goroutines progress in parallel — two Ps, two Ms running them. With `GOMAXPROCS=1`, the output still interleaves but only one G runs at any instant. `runtime.Gosched()` voluntarily yields the current M to the scheduler so the other G can run.

### Example 3 — Seeing the local runqueue overflow

```go
package main

import (
    "runtime"
    "sync/atomic"
)

func main() {
    runtime.GOMAXPROCS(1)
    var counter int64
    done := make(chan struct{})

    // Spawn 1000 goroutines from inside a single goroutine on a single P.
    // The local runqueue has only 256 slots; the rest will spill to the global queue.
    go func() {
        for i := 0; i < 1000; i++ {
            go func() {
                atomic.AddInt64(&counter, 1)
                if atomic.LoadInt64(&counter) == 1000 {
                    close(done)
                }
            }()
        }
    }()

    <-done
}
```

The local runqueue holds at most 256 runnable Gs per P. With one P and 1000 spawns happening fast, about 744 of them spill into the global runqueue. This program runs correctly anyway — the runtime handles the overflow — but it illustrates that the bound exists.

### Example 4 — Looking at a trace

```go
package main

import (
    "os"
    "runtime/trace"
    "sync"
)

func main() {
    f, _ := os.Create("trace.out")
    defer f.Close()
    trace.Start(f)
    defer trace.Stop()

    var wg sync.WaitGroup
    for i := 0; i < 8; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            n := 0
            for j := 0; j < 1e7; j++ {
                n += j
            }
            _ = n
        }()
    }
    wg.Wait()
}
```

Run, then `go tool trace trace.out`. In the "Goroutines" or "Procs" timeline you will see exactly `GOMAXPROCS` lanes (one per P) and goroutines snapping between lanes. That visual is the strongest mental anchor for the G-M-P model.

---

## Coding Patterns

You do not write code "with" G-M-P; you write code that *cooperates with* the scheduler. Three patterns flow directly from the model:

### Pattern 1 — Worker pool sized to GOMAXPROCS

For CPU-bound work, spawn `runtime.GOMAXPROCS(0)` workers. More than that buys nothing because P count caps user-code parallelism.

```go
n := runtime.GOMAXPROCS(0)
jobs := make(chan Job, n*2)
var wg sync.WaitGroup
for i := 0; i < n; i++ {
    wg.Add(1)
    go func() {
        defer wg.Done()
        for j := range jobs {
            process(j)
        }
    }()
}
```

### Pattern 2 — Bounded goroutine count for I/O-bound work

For I/O-bound work, the parallelism is bounded by the *external system* (database, downstream API), not by P count. Use a semaphore or a worker pool sized to the I/O concurrency limit, not to `GOMAXPROCS`.

```go
sem := make(chan struct{}, 200)
for _, url := range urls {
    sem <- struct{}{}
    go func(u string) {
        defer func() { <-sem }()
        fetch(u)
    }(url)
}
```

The scheduler will happily oversubscribe Ms to cover the syscalls.

### Pattern 3 — `runtime.Gosched` for tight CPU loops

Until Go 1.14, a tight loop without function calls could not be preempted. `runtime.Gosched()` was a manual cooperation point. Since Go 1.14 async preemption handles most cases; `Gosched` is rarely needed today but appears in older code. Reading "why is this here?" answers: it predates async preemption.

---

## Clean Code

The G-M-P model rewards code that is *easy for the scheduler to do its job with*:

- **Prefer many small goroutines to one big mutex region**: the scheduler is good at switching between many small units. It is bad at preempting one long critical section.
- **Avoid `runtime.LockOSThread` unless you need it**: it pins a G to its M permanently, which means that M can never serve other Gs and the runtime has to spawn a new M to replace it. It is needed for cgo with thread-local storage and for some signal handling, almost nowhere else.
- **Do not block on Cgo for long durations**: a long cgo call pins an M outside the Go scheduler. Many concurrent long cgo calls means many extra Ms, sometimes hundreds.
- **Avoid spinning loops without `runtime.Gosched()` (or, better, channel-based waiting)**: a tight CPU spin is hostile to other goroutines.

---

## Product Use / Feature

When you build a feature, G-M-P shows up in:

- **Throughput estimation**: "How many requests per second can my service handle?" depends on whether each request is CPU-bound (capped at `GOMAXPROCS`) or I/O-bound (capped by external systems).
- **Container sizing**: setting CPU requests/limits in Kubernetes interacts with `GOMAXPROCS`. Mismatched values cause throttling.
- **Latency tail**: a long-running goroutine that does not yield will, on rare occasions, delay the scheduler from servicing other Gs. Async preemption mostly hides this, but ten-second STW pauses in old code (Go ≤ 1.13) often traced to this.
- **Observability stack**: emit `runtime/metrics` to expose P count, M count, idle Ps, runqueue length; alert on saturation.

---

## Error Handling

There is little to "handle" about G-M-P directly. The relevant runtime errors:

- `runtime: program exceeds 10000-thread limit` — you have created more than 10000 Ms (the default limit, settable via `debug.SetMaxThreads`). Almost always caused by goroutines doing slow cgo or being stuck in syscalls. The fix is not raising the limit but understanding *why* so many Ms exist.
- `runtime: out of memory: cannot allocate ...` — Gs use 2 KiB stacks initially; with millions of Gs you can hit memory limits. Reduce the count or refactor to fewer goroutines.
- Deadlock detection — when *every* G in the program is parked, the runtime prints `fatal error: all goroutines are asleep - deadlock!`. The scheduler's `findrunnable` is what checks this condition.

---

## Security Considerations

The scheduler does not present its own attack surface in the usual sense, but:

- **Resource exhaustion**: untrusted input that triggers unbounded goroutine creation is a DoS. Always cap concurrency.
- **Side-channel exposure**: shared CPU usage between goroutines is observable. For cryptographic code, prefer constant-time primitives; do not rely on scheduling timing for security.
- **`runtime.LockOSThread` and seccomp**: if your code uses seccomp or per-thread credentials, you must call `LockOSThread` and never release. Otherwise the runtime can move your goroutine to a different M with different credentials.

---

## Performance Tips

- **Do not exceed `GOMAXPROCS` worker goroutines for CPU-bound work**. The extra goroutines only add context-switch overhead.
- **Channels in a tight ping-pong stay on one P** thanks to `runnext`. If profiling shows your channel-based pipeline is faster than you expected, you are seeing `runnext` in action.
- **Avoid global locks**: they collapse parallelism by forcing all Gs through one critical section. The whole point of P-local data is to avoid this.
- **Watch for unintended global queue use**: if you spawn goroutines from a goroutine without a P (rare — typically only from cgo callbacks), they go to the global queue. Same when a P's local runqueue overflows.
- **Mind the cost of `LockOSThread`**: it disables the M-from-P handoff for that goroutine. Sustained use balloons M count.

---

## Best Practices

- **Read `runtime/runtime2.go` once**. You do not need to memorise it. Just see the struct definitions so the names are real.
- **Use `go tool trace`** before guessing about scheduler behavior. The visual is unambiguous.
- **Set `GOMAXPROCS` explicitly in production**. Even if it equals the auto-detected value today, future changes (CPU upgrades, container limit changes) won't surprise you.
- **Prefer channels and `sync.WaitGroup`** over `runtime.Gosched`. The latter exists for very specific old-Go-style patterns.
- **Avoid premature parallelism**. The scheduler is cheap, but goroutines aren't free; profile first.

---

## Edge Cases & Pitfalls

- **`runtime.NumGoroutine` includes runtime-internal goroutines**: GC workers, the finalizer goroutine, the sysmon goroutine. So a "freshly started" program reports >1 even before you spawn anything.
- **The main goroutine is special only at exit**. While running it is a regular G in some P's runqueue.
- **An M without a P cannot run user Go code** — but can run runtime code (e.g., GC mark assists). This is sometimes confusing in stack traces.
- **`GOMAXPROCS` can be changed at runtime** via `runtime.GOMAXPROCS(n)`. Decreasing it triggers `stopTheWorld`/`startTheWorld`. Don't do this on the hot path.
- **Sysmon does not use a P**. Sysmon is one of a small set of system goroutines that bypass the normal P-based scheduling.

---

## Common Mistakes

1. **Confusing P with a CPU core**. They map by default but are independent. You can set `GOMAXPROCS=2` on a 32-core machine; you then have 2 Ps.
2. **Counting Ms by counting Gs**. They are unrelated counts. A thousand goroutines on a 4-core machine typically corresponds to ~4 active Ms.
3. **Assuming `runtime.Gosched` is needed in modern Go**. Async preemption since 1.14 makes it almost obsolete.
4. **Thinking `LockOSThread` is "more parallelism"**. It is *less* parallelism — it removes one M from the pool that could serve other goroutines.
5. **Believing `GOMAXPROCS=1` makes Go "single-threaded"**. There is still an M running sysmon, possibly Ms in syscalls, possibly Ms in cgo. `GOMAXPROCS=1` caps user-code parallelism, not thread count.

---

## Common Misconceptions

- **"More goroutines = more parallelism."** False. Parallelism is capped at `GOMAXPROCS`.
- **"Goroutines run on threads, that's it."** True at the surface, false in detail: P sits between them and is the actual scheduling unit.
- **"The Go scheduler is preemptive."** Mostly, since 1.14. Before that it was cooperative. The mechanism is a signal-driven async preemption, not a traditional timer interrupt.
- **"Channel sends always synchronise via the runtime."** Often, but not always — when the buffer has room and no waiter is parked, the operation is a simple lock + copy + index update under `c.lock`, not a full scheduler hand-off.
- **"`GOMAXPROCS=runtime.NumCPU()` is always the right setting."** Inside a Linux container with CPU quota less than the full machine, the auto value (pre-1.25) overshoots and you get throttled. Use `automaxprocs` or, on Go 1.25+, the cgroup-aware default.

---

## Tricky Points

- **`g0` runs scheduler code, not your code**. Stack traces sometimes show `runtime.systemstack(...)` calls; those are switches to `g0` to run something that must execute on a known-large stack.
- **`runnext` makes channel ping-pong fast**. When goroutine A wakes goroutine B via a channel send, B lands in A's P's `runnext` slot, so as soon as A blocks or yields, B runs immediately without going through the normal runqueue.
- **Fairness via the 61-tick rule**. Without it, two goroutines bouncing on `runnext` could starve the global queue. The scheduler counts iterations and dips into the GRQ every 61.
- **Idle-P list as a priority queue**. The runtime sometimes prefers to wake an idle P bound to a previously-used M for cache-locality reasons.

---

## Test

A quick written test you can take from memory:

1. How many of each (G, M, P) does a typical Go program have? Order of magnitude.
2. Which file defines the structs `g`, `m`, `p`?
3. What does the P's `runq` hold? How big is it?
4. What happens if `runq` is full and a goroutine spawns a new one?
5. What is `runnext` and what scenario is it optimised for?
6. Does an M need a P to run user Go code? Does it need a P to run sysmon work?
7. Which goroutine state is `_Gsyscall` and what triggers the transition?
8. Name two reasons P was added in 2012.
9. How often does an M sip from the global runqueue when its local is non-empty?
10. What is `g0`?

Answers form a complete mental model — if any feels fuzzy, reread the matching section.

---

## Tricky Questions

**Q1.** A goroutine spawns a million more goroutines and then exits. How many of the million live in the spawner's P's local runqueue?

*Answer*: at most 256 minus the slots already occupied. The rest cascade into the global runqueue in batches of 128 (half the local queue at the moment of overflow).

**Q2.** With `GOMAXPROCS=1`, is the Go runtime single-threaded?

*Answer*: No. Only one M may run user Go code at a time, but other Ms can exist (sysmon, syscall-blocked Ms, cgo). The kernel may schedule any of them on any CPU.

**Q3.** Why is the number of Ms not strictly bounded?

*Answer*: Because a long syscall can park its M outside the scheduler. To keep running user code the runtime needs a fresh M for the abandoned P. If many syscalls block at once, many Ms accumulate. The hard cap is `debug.SetMaxThreads(n)`, default 10000.

**Q4.** What happens to the local runqueue when its P's M makes a syscall?

*Answer*: The P is detached and parked on `sched.pidle`. The runqueue stays attached to the P. When another M picks the P up, it inherits the queue. The going-into-syscall M does *not* run other Gs while blocked.

**Q5.** Can a goroutine migrate between Ps?

*Answer*: Yes, frequently — via work-stealing. When a P's runqueue empties, its M tries to steal half from another P's queue, moving those Gs to the local queue and from there to its M's CPU.

---

## Cheat Sheet

```
G   = goroutine        — many (thousands to millions)
M   = OS thread        — tens to hundreds
P   = scheduling slot  — exactly GOMAXPROCS

To run user code:  needs G + M + P
To run runtime:    needs M (P optional)

Per-P data: runq (256), runnext (1), mcache, sudogcache, deferpool
Global:     sched.runq (linked list), sched.midle, sched.pidle, sched.lock

Hot paths touch only P-local data, no global lock.
Local-first search:  runnext → runq → global (1/61) → steal → netpoll → park

newproc       creates a G, puts on current P's runq
schedule      M's main loop
findrunnable  the search
gopark        sleep this G (used by channels, mutexes, sleep, IO)
goready       wake a G (puts on a P's runq)
```

---

## Self-Assessment Checklist

- [ ] I can state in one sentence what each of G, M, and P is.
- [ ] I can explain why P exists and what Go 1.0 looked like without it.
- [ ] I know where the structs live in the runtime source.
- [ ] I know the order of `findrunnable`'s search.
- [ ] I can read a `go tool trace` output and identify P lanes.
- [ ] I know what `runnext` optimises and why it matters.
- [ ] I know the difference between idle P list and idle M list.
- [ ] I know that an M without a P cannot run user code.
- [ ] I can predict the behavior of a tiny program under `GOMAXPROCS=1`.
- [ ] I can name at least two pitfalls of `runtime.LockOSThread`.

---

## Summary

G is the goroutine, M is the OS thread the runtime borrowed, P is the scheduling context that brokers between them. The triangle G ↔ M ↔ P must be complete for user code to advance. Ps are exactly `GOMAXPROCS`; Ms are however many the runtime needs (mostly equal to the number of currently-runnable Gs plus a few for syscalls); Gs are however many the program creates. The local-first design — per-P runqueues, per-P caches, `runnext`, work-stealing only on demand — is what lets Go scale to dozens of cores. Once you can place every scheduler concept on this triangle, the rest of the deep-dive section is variations on a theme.

---

## What You Can Build

With this understanding you can:

- Build a worker pool sized correctly for CPU-bound parallelism (size = `GOMAXPROCS`).
- Build I/O-bound clients that exploit the runtime's syscall handoff to overlap network requests.
- Read `go tool trace` outputs and explain "this goroutine sat on P3 for 12 ms, then migrated to P1".
- Tune a containerized service's CPU usage by setting `GOMAXPROCS` to match the cgroup quota.
- Debug "why does my Go program use 50 threads?" by tracing it back to slow syscalls or cgo calls.

---

## Further Reading

- **Dmitry Vyukov, *"Scalable Go Scheduler Design"*** (May 2012) — the original design doc that introduced P. <https://docs.google.com/document/d/1TTj4T2JO42uD5ID9e89oa0sLKhJYD0Y_kqxDv3I3XMw/edit>
- **Dmitry Vyukov, *"Go Preemptive Scheduler Design"*** (2013) — follow-up on preemption.
- **The Go source**: `src/runtime/runtime2.go` (structs), `src/runtime/proc.go` (scheduler logic). Browse online at <https://cs.opensource.google/go/go>.
- **Ardan Labs blog**, *"Scheduling In Go" series* (Bill Kennedy, 2018) — three-part walk-through.
- **Jaana Dogan**, *"Go scheduler: implementing language with lightweight concurrency"* (2017) — visual explanation.
- **`runtime/HACKING.md`** in the Go source tree — Russ Cox's developer-facing notes.
- **`go tool trace` user guide** in the Go docs.

---

## Related Topics

- [02-preemption](../02-preemption/) — how the scheduler interrupts running goroutines
- [03-gomaxprocs-tuning](../03-gomaxprocs-tuning/) — choosing the right number of Ps
- [04-work-stealing](../04-work-stealing/) — how empty Ps refill their runqueues
- [05-syscall-handling](../05-syscall-handling/) — the P-from-M handoff when an M blocks
- [01-goroutines/01-overview](../../01-goroutines/01-overview/) — goroutines at the surface level
- [01-goroutines/02-vs-os-threads](../../01-goroutines/02-vs-os-threads/) — the M side in depth
- [09-channel-internals](../../09-channel-internals/) — what `gopark`/`goready` look like from the channel side

---

## Diagrams & Visual Aids

### The triangle

```
                  +--------------------+
                  |  G  (goroutine)    |
                  |  - stack           |
                  |  - sched (regs)    |
                  |  - status          |
                  +--------+-----------+
                           |
                           | currently executing on
                           v
                  +--------------------+
                  |  M  (OS thread)    |
                  |  - g0 stack        |
                  |  - curg = this G   |
                  |  - p = this P      |
                  +--------+-----------+
                           |
                           | holds license from
                           v
                  +--------------------+
                  |  P  (sched slot)   |
                  |  - runq[256]       |
                  |  - runnext         |
                  |  - mcache          |
                  |  - sudog/defer     |
                  +--------------------+
```

### M:N at a glance, `GOMAXPROCS = 4`

```
Gs:    G1 G2 G3 G4 G5 G6 G7 G8 G9 G10 G11 ...   (thousands)

Ps:    [P0] [P1] [P2] [P3]                       (exactly GOMAXPROCS)
       |    |    |    |
       LRQ  LRQ  LRQ  LRQ   (256 slots each)
       |    |    |    |
Ms:    M1   M2   M3   M4    plus idle Ms in sched.midle
                            plus blocked-in-syscall Ms
```

### The local-first search inside `schedule()`

```
schedule():
  G := nil

  every 61st iteration:
      G = globrunqget(p, 1)        # fairness sip from global
      if G != nil: goto execute

  G = runqget(p)                   # local: runnext, then runq head
  if G != nil: goto execute

  G = findrunnable(p)
      tries: global queue (batch)
      tries: netpoll (ready I/O)
      tries: work-steal from other P
      tries: global queue once more
      else:  releases P, parks M

  execute(G):
      switch to G's stack
      jump to G's saved PC
```

### Idle lists

```
sched.pidle  →  P_a → P_b → P_c → nil
sched.midle  →  M_a → M_b → M_c → nil

wake_pair():
   pop a P from sched.pidle
   pop an M from sched.midle
   m.nextp = p
   futex_wake(m.park)
```

### Pre-G-M-P (Go 1.0): one global queue

```
                  +------------------+
                  |  sched.runq      |   single global runqueue
                  |  guarded by      |   *every* op contends here
                  |  sched.lock      |
                  +------------------+
                          ^
                  M1 M2 M3 M4 ... (all Ms compete on one lock)
```

This is the design Vyukov replaced. Above 4–8 cores, the lock collapsed throughput. Adding P, per-P runqueues, and work-stealing was the cure — and the modern G-M-P model is the result.
