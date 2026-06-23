# Go Runtime GMP — Junior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Pros & Cons](#pros--cons)
8. [Use Cases](#use-cases)
9. [Code Examples](#code-examples)
10. [Coding Patterns](#coding-patterns)
11. [Clean Code](#clean-code)
12. [Product Use / Feature](#product-use--feature)
13. [Error Handling](#error-handling)
14. [Security Considerations](#security-considerations)
15. [Performance Tips](#performance-tips)
16. [Best Practices](#best-practices)
17. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
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
29. [Diagrams & Visual Aids](#diagrams--visual-aids)

---

## Introduction
> Focus: "What is the GMP scheduler? How does Go decide which goroutine runs on which CPU? Why does `GOMAXPROCS` matter?"

When you write `go f()`, the Go runtime takes the function call and turns it into a **goroutine**. The runtime then has to decide *when* and *where* that goroutine actually executes. That decision is made by the **scheduler**, the busiest piece of code in any Go program you write.

The Go scheduler is built on three abstractions:

- **G** — a goroutine. The smallest unit of independently scheduled work. A `g` struct in the runtime tracks its stack, state, and current location.
- **M** — a machine. An OS thread, created via `clone()` on Linux or `pthread_create` elsewhere. An `m` struct tracks the thread.
- **P** — a processor. A logical execution context required to run Go code. A `p` struct holds a queue of runnable goroutines and bookkeeping. The number of P's defaults to `GOMAXPROCS`, which defaults to `runtime.NumCPU()`.

The scheduler's job: take many G's, multiplex them onto a small number of M's, with each M needing a P to actually run a G. Goroutines move between P's as they become ready; M's are created and parked as needed for syscalls and network I/O.

This file is your introduction. You will get the vocabulary, the basic mental model, and enough understanding to debug common scheduler-related symptoms. The deep mechanics — async preemption, the scheduler's lock-free queues, stack growth — live in `professional.md` and in the `10-scheduler-deep-dive` chapter.

After reading you will:

- Know what G, M, P stand for and how they fit together.
- Understand what `GOMAXPROCS` controls and what its default is.
- Recognise when the scheduler runs your goroutines (creation, blocking, preemption, completion).
- Know how to inspect the scheduler with `GODEBUG=schedtrace=1000`.
- Understand "work stealing" at a high level.
- See why "thread vs goroutine" is the wrong question — Go's answer is "goroutine on a thread, mediated by a processor."

---

## Prerequisites

- **Required:** Familiarity with goroutines: how to spawn one with `go`, how the program shuts down when `main` returns. See [01-goroutines/01-overview](../../01-goroutines/01-overview/).
- **Required:** Awareness that operating systems have OS threads (kernel-managed units of execution) and that they are limited in number and expensive.
- **Required:** Basic Go syntax.
- **Helpful:** Some understanding of how OS schedulers work (Linux's CFS, BSD's queues). Not strictly required but useful background.
- **Helpful:** Exposure to other M:N runtimes — Erlang's BEAM, Java's Project Loom, Rust's Tokio.

---

## Glossary

| Term | Definition |
|------|-----------|
| **G** | A *goroutine*. The runtime's smallest unit of independent execution. The `g` struct holds the goroutine's stack pointer, status, and identity. |
| **M** | A *machine*, i.e., an OS thread. The `m` struct holds thread-local state, the currently-running `g`, and a pointer to a `p` (when one is acquired). |
| **P** | A *processor*. A logical execution context. The `p` struct holds the local run queue, memory cache, and is required to execute Go code. |
| **GMP scheduler** | The Go runtime scheduler, which manages G's on M's using P's as the gating resource. |
| **Run queue** | A queue of runnable G's. Each P has its own *local* run queue; there is also a *global* run queue. |
| **Work stealing** | When a P's local queue is empty, it tries to steal half the queue from another P. Keeps cores busy. |
| **sysmon** | A special M (system monitor) that runs without a P and handles background tasks: detecting long-running goroutines, retaking P's from blocked syscalls, GC scheduling, etc. |
| **netpoll** | The integrated network poller (epoll on Linux, kqueue on BSD, IOCP on Windows). Lets goroutines block on I/O without blocking their OS thread. |
| **GOMAXPROCS** | The number of P's. Defaults to `runtime.NumCPU()`. Caps the number of OS threads executing Go code simultaneously. |
| **Preemption** | The runtime interrupting a running goroutine to switch to another. In Go 1.14+, supported asynchronously via signals. |
| **Syscall** | A blocking call into the OS kernel. The runtime handles syscalls specially to free up the P for other goroutines. |
| **Park** | Putting a goroutine to sleep (it becomes non-runnable). Wake = making it runnable again. |
| **`runtime.Gosched`** | A hint that the current goroutine is willing to yield to others. Rarely needed. |
| **`runtime.LockOSThread`** | Pin the calling goroutine to its current OS thread. Used for thread-local state in foreign code. |
| **`g0`** | Each M's scheduling-context goroutine. The "system stack" the runtime uses to execute scheduler code. |

---

## Core Concepts

### G, M, and P explained

**G is a goroutine.** When you write `go f(x)`, the runtime allocates a `g` struct, sets its stack pointer to a new small stack (~2 KB), and queues it for execution. The G holds:

- The function to call and its arguments.
- A stack (a contiguous block of memory).
- The current PC (program counter).
- The state: runnable, running, waiting, dead.
- A pointer to the M it is currently running on, if any.

**M is an OS thread.** Created by the runtime via `clone()` (Linux) or equivalent. Each M:

- Has a pointer to the G it is currently running.
- Has a pointer to a P (if it has acquired one).
- Has its own scheduling-context goroutine (`g0`) for running runtime code.
- Can be parked (sleeping) when there is no work.

**P is a processor.** Created in fixed quantity (`GOMAXPROCS`). Each P:

- Holds a *local run queue* of runnable G's (a ring buffer of 256 slots).
- Owns a small allocator cache (mcache) for fast allocation.
- Tracks per-P statistics.
- Can be detached from an M during syscalls or when idle.

To execute a goroutine, an M must hold a P. That is the rule. If there are 16 M's but only 8 P's, only 8 M's can run Go code at once. The others are doing syscalls, GC, or are parked.

### How a goroutine gets to run

```
1. You write `go f()`.
2. The runtime allocates a G, queues it on the current P's local queue.
3. The current M finishes its current G (or yields).
4. The M picks the next G from the P's local queue.
5. The M sets its register state to the G's saved state and jumps to the G's PC.
6. The G runs. Eventually it returns, blocks, or is preempted.
7. The M picks the next G from the P's local queue. If empty, it tries:
   - Global queue.
   - Stealing from another P's queue.
   - Netpoll (any I/O ready?).
   - Park.
```

This loop is called the **schedule loop**. It is implemented in `runtime/proc.go` in a function literally called `schedule()`.

### What "running on a thread" means

A goroutine runs on an M, which is an OS thread. From the OS's perspective, that thread is using CPU time. The OS does not know there are goroutines; it just sees `N` threads, one per M.

When the goroutine blocks (channel, mutex, sleep), the M parks the G and looks for another. The G's stack stays in memory; only the M's instruction pointer changes. From the OS's view, the thread keeps running — just executing different goroutines' code.

When the goroutine does a blocking *syscall* (like reading a regular file), the M itself is blocked by the kernel. The runtime handles this by detaching the P from the M and giving the P to another (parked) M. The original M stays with the syscall; when it returns, the M tries to reacquire a P.

### GOMAXPROCS

`GOMAXPROCS` is the number of P's. Since Go 1.5 it defaults to `runtime.NumCPU()`. It caps the number of OS threads that can run Go code simultaneously.

```go
runtime.GOMAXPROCS(0) // returns current value
runtime.GOMAXPROCS(4) // set to 4, return previous
```

Setting it to 1 forces all goroutines to share a single P (and thus a single thread for Go execution). Concurrency persists; parallelism is gone.

In modern Go (1.5+), the default is usually right. Containerised environments sometimes need adjustment (Docker may not report container CPU limits to Go correctly). The `automaxprocs` package fixes this; recent Go versions handle it natively when running in cgroup v2.

### Work stealing

When an M finishes a G and the P's local queue is empty:

1. Check the global queue (cheap, takes a few G's at a time).
2. If still empty, randomly pick another P and steal half its run queue.
3. If all P's are empty, check netpoll for ready I/O.
4. If still nothing, park the M.

Work stealing keeps cores busy when work is unbalanced. A P that is hammered will see its queue drained by hungry P's.

### sysmon: the background watchdog

`sysmon` is a special M created at startup. It runs without a P, waking up roughly every 10 ms (with backoff) to:

- Retake P's from M's stuck in syscalls for too long.
- Preempt G's that have been running too long (set `g.preempt = true`).
- Trigger garbage collection if needed.
- Poll the network if no other M is doing it.
- Force-park M's that have been idle too long.

`sysmon` is the reason long syscalls do not block Go's other goroutines: it notices the M has been in a syscall and reassigns the P.

### The network poller (netpoll)

Network I/O is special. When a goroutine does `conn.Read`:

- The runtime sets the underlying file descriptor to non-blocking.
- It registers the FD with the kernel's poll mechanism (epoll on Linux).
- The goroutine is parked (status = waiting).
- The M does *not* block; it goes off to run other G's.
- When the FD becomes ready, the netpoll wakes the goroutine.
- The goroutine becomes runnable; whichever P picks it next continues the `Read`.

This is how Go scales to tens of thousands of concurrent connections on a few OS threads. Network blocking is invisible at the application level — your code looks synchronous — but the runtime turns it into asynchronous I/O.

### Putting it together

Picture a typical Go web server:

- `GOMAXPROCS = 8` (8 cores).
- 8 P's, each with its own run queue.
- 8 active M's, each running on a P.
- A few extra M's parked.
- `sysmon` is the 9th M (no P).
- The network poller is registered with epoll.
- 10 000 idle connections = 10 000 goroutines parked on `netpoll`.
- 100 active requests = 100 G's distributed across P queues.

The system handles 10 000 concurrent connections on 8 OS threads because most of the goroutines are waiting on I/O, not running on CPU.

---

## Real-World Analogies

### The kitchen with stations and chefs

A restaurant has:

- 8 cooking stations (P's). Each has a counter where orders queue.
- 8 chefs (M's). Each works at a station.
- 100 orders (G's). They wait at stations, get cooked, and leave.

Chef-at-station serves orders from the station's counter. When the counter is empty, the chef checks the central order queue (global run queue). If that's empty too, the chef walks to another station and takes half the orders (work stealing). When a chef has to go to the freezer for ingredients (syscall), they hand the station to another chef and come back later.

The maître d' (sysmon) walks around making sure no chef is stuck and no station is starving.

### The airport with gates and planes

- Gates (P's): 8 of them at the airport.
- Planes (M's): some at gates, some idle.
- Flights (G's): some at gates, some queued.

A plane (M) needs a gate (P) to operate. If a plane is held up at an external facility (syscall), the gate is freed for another plane. When the plane returns, it queues for the next available gate.

This analogy emphasises that *running* requires a gate. M without a P is grounded.

### The race track with multiple lanes

`GOMAXPROCS = 4` is a track with 4 lanes. There may be 100 runners (goroutines), but only 4 can run at once. The others wait on the side. When a runner stumbles (blocks), another takes their lane.

---

## Mental Models

### Model 1: "P is the right to execute"

Think of P's as licences. There are exactly `GOMAXPROCS` licences. To execute Go code, an M must hold a licence. M without P? Doing syscall, GC, idle, or sysmon. G without M? Waiting on a P's queue, or parked.

### Model 2: "Goroutines have stacks; everything else is bookkeeping"

A G's primary content is its stack. The runtime juggles G's between M's; each G's stack stays put. Switching G's = switching stack pointers. Cheap.

### Model 3: "The scheduler is a job market"

P's have local job boards (run queues). M's are workers. M's start by checking their P's local board; if empty, check the central board; if empty, raid another P. When work is found, work happens.

### Model 4: "Threads are heavy; goroutines are light because P is the unit of accounting"

The OS thinks each M is a separate thread, each with kernel state. The Go runtime sees P as the unit of concurrent work — and there are only `GOMAXPROCS` P's. M's come and go; P's persist. P holds the run queue, the allocator cache, the per-CPU state. It is the "logical core" Go pretends to have.

---

## Pros & Cons

### Pros

- **Massive concurrency.** Thousands or millions of goroutines on a small handful of OS threads.
- **Cheap goroutine creation.** A few hundred nanoseconds; no kernel involvement.
- **Cheap context switches.** Goroutine-to-goroutine switches are tens of nanoseconds, not microseconds.
- **Integrated I/O.** Network blocking is automatic; user code looks synchronous.
- **Per-P locality.** Caches, allocators, queues are per-P, reducing contention.

### Cons

- **Less control.** You cannot pin a goroutine to a specific CPU (only to an OS thread).
- **Hidden complexity.** Runtime behaviour can surprise (preemption timing, GOMAXPROCS in containers).
- **Stack growth.** Goroutines grow their stacks as needed; growth involves copying and a brief pause.
- **No fine-grained priority.** All goroutines are equal; no high/low priority queues.
- **Scheduler ceiling.** Around 1M runnable goroutines per process before scheduler overhead dominates.

---

## Use Cases

| Scenario | Why GMP matters |
|---|---|
| High-concurrency HTTP server | netpoll keeps thousands of connections cheap; GMP balances active requests across cores. |
| ETL pipeline with many I/O steps | Goroutines wait on disk/network; M reuse keeps overhead low. |
| CPU-bound parallel computation | `GOMAXPROCS` P's run simultaneously; work stealing balances load. |
| Game server | Per-player goroutines, mostly waiting on input; netpoll handles many connections. |
| CLI tool with parallel sub-tasks | `errgroup` + small-N parallelism, runtime picks cores. |

---

## Code Examples

### Example 1: Inspect runtime constants

```go
package main

import (
    "fmt"
    "runtime"
)

func main() {
    fmt.Println("NumCPU:", runtime.NumCPU())
    fmt.Println("GOMAXPROCS:", runtime.GOMAXPROCS(0))
    fmt.Println("NumGoroutine:", runtime.NumGoroutine())
}
```

`NumCPU` reflects the OS-visible logical CPUs. `GOMAXPROCS` defaults to that value. `NumGoroutine` returns the live goroutine count, including system goroutines (GC, sysmon).

### Example 2: Force single-threaded execution

```go
runtime.GOMAXPROCS(1)
```

Only one P; only one M executes Go code at a time. CPU-bound parallelism is gone, but concurrency remains.

### Example 3: Schedule trace

```bash
GODEBUG=schedtrace=1000 go run main.go
```

Every 1000 ms, the runtime prints a summary of the scheduler state:

```
SCHED 1003ms: gomaxprocs=8 idleprocs=0 threads=12 spinningthreads=0 idlethreads=4 runqueue=0 [3 2 4 3 5 4 2 3]
```

This tells you:
- 8 P's.
- 0 idle (all running).
- 12 OS threads exist.
- Global run queue length: 0.
- Per-P run queue lengths: 3, 2, 4, 3, 5, 4, 2, 3.

### Example 4: Detailed schedule trace

```bash
GODEBUG=schedtrace=100,scheddetail=1 go run main.go
```

Prints per-G, per-M, per-P state. Verbose; useful for debugging strange scheduler behaviour.

### Example 5: Pinning a goroutine to its OS thread

```go
runtime.LockOSThread()
defer runtime.UnlockOSThread()
// All code here runs on the same OS thread for its lifetime.
```

Use cases: foreign code with thread-local state (OpenGL contexts, certain JNI / Cgo libraries). Otherwise unnecessary.

### Example 6: Voluntarily yield

```go
runtime.Gosched()
```

A hint to the scheduler. In modern Go (1.14+ async preemption), rarely needed.

### Example 7: Long syscall

```go
data, _ := os.ReadFile("/large/file") // blocking syscall
```

While the read is in progress, the M handling this goroutine is blocked in the kernel. `sysmon` notices and detaches the P, giving it to another M. When the read returns, the original M tries to reacquire a P (or queues the G if it can't).

You do not see any of this in your code — it just works.

### Example 8: Network I/O

```go
conn.Read(buf) // appears blocking
```

The runtime sets `conn`'s FD non-blocking, registers it with epoll, and parks the goroutine. The M moves on to other goroutines. When the FD has data, the netpoll wakes the goroutine.

### Example 9: A CPU-bound goroutine

```go
go func() {
    for i := 0; i < 1_000_000_000; i++ {
        _ = i * i
    }
}()
```

This goroutine never yields voluntarily. In Go 1.14+ async preemption, the runtime preempts it every ~10 ms via a SIGURG signal, ensuring others get to run.

### Example 10: `runtime.NumGoroutine` over time

```go
go func() {
    for {
        fmt.Println("goroutines:", runtime.NumGoroutine())
        time.Sleep(time.Second)
    }
}()
```

A simple in-process monitor. Production code exposes the same value as a Prometheus gauge.

---

## Coding Patterns

### Pattern 1: One goroutine per request

The default web server pattern. `net/http` creates a goroutine per incoming request. The scheduler distributes them across P's.

### Pattern 2: Worker pool

A fixed number of long-running goroutines reading from a channel. The scheduler keeps them on P's; the channel ops are efficient. See `01-what-is-concurrency` for the template.

### Pattern 3: Per-CPU sharded state

```go
shards := make([]Shard, runtime.NumCPU())
```

Matching shard count to CPU count gives roughly one shard per P. Reduces contention.

### Pattern 4: Wait for goroutines via `sync.WaitGroup` or `errgroup`

Lifetime management. The scheduler handles the running; the synchronisation primitives handle the joining.

---

## Clean Code

- **Do not depend on goroutine identity.** There is no public goroutine ID. The runtime may move goroutines between threads.
- **Do not assume execution order between goroutines.** The scheduler is free to interleave however it likes.
- **Use channels and `sync` primitives for ordering.** Not `time.Sleep`.
- **Do not call `runtime.GOMAXPROCS` in libraries.** It is a process-wide setting that the caller controls.
- **Prefer not to use `runtime.LockOSThread`.** It defeats the scheduler's flexibility.

---

## Product Use / Feature

| Feature | Scheduler role |
|---|---|
| Live updates / pub-sub | Many goroutines parked on netpoll; scheduler wakes them on events. |
| Background tasks | Long-running goroutines on dedicated P resources. |
| Multi-core analytics | Parallel goroutines on `GOMAXPROCS` P's; work stealing balances. |
| Webhook delivery | Goroutines blocked on outbound HTTP; netpoll handles wakeups. |
| Cron-like timers | A few goroutines on `time.Ticker`; cheap. |

---

## Error Handling

The scheduler itself rarely "errors" from your code's perspective. But scheduler-induced issues manifest as:

- Long pauses: a goroutine in a tight loop without preemption (pre-1.14) starves others.
- Mysterious delays: the network poller is busy or the P count is wrong.
- Memory bloat: goroutine leaks, scheduler tracks too many G's.

Diagnostics:

- `GODEBUG=schedtrace=1000` shows scheduler state.
- `pprof goroutine` profile shows goroutine call stacks.
- `runtime.NumGoroutine` over time shows growth or leaks.

---

## Security Considerations

- **Goroutine exhaustion.** A naive endpoint that spawns one goroutine per request can be DDoSed. Bound concurrency.
- **Thread exhaustion.** Each blocking syscall consumes an OS thread (M). If many goroutines do long syscalls simultaneously, M count balloons. Tune carefully.
- **Untrusted code.** A goroutine cannot be killed by another goroutine; it must cooperate. Adversarial goroutines can loop forever (mitigated by async preemption keeping the scheduler responsive, but they still consume CPU).

---

## Performance Tips

- **Match `GOMAXPROCS` to actual CPU.** In containers, use `automaxprocs` or rely on Go 1.21+ cgroup detection.
- **Avoid `runtime.LockOSThread` unless needed.** It removes a goroutine from the scheduler's flexibility.
- **Avoid `runtime.GOMAXPROCS(1)` for CPU-bound workloads.** Loses parallelism.
- **For tight CPU loops, ensure they are preemptible.** Modern Go does this automatically (1.14+).
- **Use `sync.Pool` for short-lived allocations to reduce GC pressure.** GC pauses block all goroutines.

---

## Best Practices

1. Trust the scheduler defaults unless profiling says otherwise.
2. Set `GOMAXPROCS` explicitly only in special environments (containers without proper cgroup info, NUMA tuning).
3. Use `GODEBUG=schedtrace` for diagnosing scheduler behaviour.
4. Expose `runtime.NumGoroutine` as a metric in production.
5. Use `runtime.LockOSThread` sparingly.
6. Run with the latest Go version — scheduler improvements arrive every release.
7. Profile with `go tool trace` for detailed scheduler insight.
8. Use `errgroup` + `context.Context` for goroutine lifetimes.
9. Cap goroutine creation at boundaries to prevent exhaustion.
10. Do not assume any execution order between goroutines.

---

## Edge Cases & Pitfalls

### `GOMAXPROCS` ≠ container CPU quota

In Docker / Kubernetes, Go may default `GOMAXPROCS` to the host's logical CPU count, not the container's quota. Result: the scheduler thinks it has 64 cores but cgroups throttle it to 2. Use `automaxprocs` or upgrade to Go 1.21+ for cgroup awareness.

### Tight loops without preemption (pre-1.14)

```go
go func() {
    for { x++ }
}()
```

Before Go 1.14, this could starve other goroutines because the scheduler only preempted at function call boundaries. Modern Go uses signal-based async preemption, so this is mostly fixed.

### `runtime.LockOSThread` and deadlock

```go
runtime.LockOSThread()
defer runtime.UnlockOSThread()
ch <- 1  // blocks if no receiver; that receiver may need this thread!
```

Pinning yourself to a thread can cause subtle deadlocks if other code expects to acquire the same thread.

### syscall storms

Many goroutines doing simultaneous blocking syscalls can spike M count. Each syscall holds an M. If 10 000 goroutines simultaneously call `os.ReadFile`, you may get 10 000 OS threads temporarily.

### Idle threads

If `GOMAXPROCS = 32` but actual concurrency is low, the runtime parks unused M's. They appear in `ps -L` but consume little. Sysmon eventually reaps them.

---

## Common Mistakes

| Mistake | Fix |
|---|---|
| Setting `GOMAXPROCS = 1` to "simplify" debugging | Reproduces concurrency but loses parallelism; bugs may hide. |
| Calling `runtime.LockOSThread` for thread affinity | Loses scheduler flexibility; usually not what you want. |
| Counting on a goroutine ID for logging | No public API; use explicit context. |
| Manually calling `runtime.Gosched` in a loop | Trust the scheduler in Go 1.14+. |
| Assuming `runtime.NumGoroutine` includes only user goroutines | It includes system goroutines (GC, sysmon). |
| Tuning `GOMAXPROCS` without measurement | Default is usually right. |

---

## Common Misconceptions

> *"Each goroutine has its own OS thread."* — No. Many goroutines share each OS thread; `GOMAXPROCS` caps simultaneously-running OS threads.

> *"`go f()` creates a thread."* — No. It queues a G on a P's local queue. No thread is created unless the runtime needs another M.

> *"The scheduler is fair and round-robin."* — Roughly, but not strictly. Work stealing creates locality bias; preemption is best-effort.

> *"`GOMAXPROCS` is a hint."* — No. It is a hard cap on simultaneously executing M's running Go code.

> *"More goroutines = more parallelism."* — More concurrency, not parallelism. Parallelism is capped by `GOMAXPROCS`.

> *"Setting `runtime.LockOSThread` is necessary for performance."* — Rarely. The scheduler manages affinity well by default.

---

## Tricky Points

### A blocked goroutine does not block its OS thread

For *cooperative* blocks — channels, mutexes, sleep, network I/O — the runtime parks the G and the M moves on. The thread keeps running.

### A blocked goroutine *does* block its OS thread for syscalls

For OS syscalls (file I/O, exec, etc.), the M is genuinely blocked by the kernel. The runtime detaches the P and gives it to another M.

### M's are not garbage collected; they are pooled

Created M's hang around. When idle, they park. The runtime reuses parked M's instead of creating new ones.

### `runtime.NumGoroutine` includes the runtime's own goroutines

Even a "Hello, World" Go program has 2–6 goroutines depending on version: main, GC sweeper, possibly netpoll, sysmon (sysmon has no G but consumes an M).

### `sysmon` runs without a P

Special-cased. It is not subject to GOMAXPROCS.

---

## Test

```go
package gmp_test

import (
    "runtime"
    "testing"
)

func TestNumCPUMatchesGOMAXPROCS(t *testing.T) {
    if runtime.GOMAXPROCS(0) != runtime.NumCPU() {
        t.Skipf("GOMAXPROCS != NumCPU; OK in containers")
    }
}

func TestGoroutineCountIsLow(t *testing.T) {
    // A simple test should have very few goroutines beyond the test framework.
    if n := runtime.NumGoroutine(); n > 20 {
        t.Errorf("unexpectedly high goroutine count: %d", n)
    }
}
```

---

## Tricky Questions

**Q.** What is the smallest unit the Go scheduler manages?

**A.** A goroutine (G). The scheduler moves G's between P's and M's.

---

**Q.** Why is P necessary? Why not just M and G?

**A.** P localises the run queue, allocator cache, and other per-CPU state. Without P, every M would contend on a global queue. With P, an M's queue is contention-free as long as no other M steals from it. P also provides a hard cap on parallelism (`GOMAXPROCS`) independent of how many M's exist.

---

**Q.** What is `g0`?

**A.** Each M's "scheduling-context goroutine." When the M is between user goroutines (i.e., running scheduler code itself), it executes on `g0`'s stack. This separates user code from runtime code.

---

**Q.** What happens to a syscall on a Go program?

**A.** The M that called the syscall is blocked in the kernel. The runtime (via sysmon if the syscall is long) detaches the M's P and gives it to another (parked or new) M, so other goroutines can keep running. When the syscall returns, the M tries to reacquire a P (or queues its G on the global queue and parks itself).

---

**Q.** Why might `runtime.NumGoroutine` rise without obvious cause?

**A.** Most commonly: leaks. Some goroutine is being spawned but never exits. Less commonly: the program is genuinely spawning more goroutines (network connections, request handlers). Use `pprof` to inspect.

---

## Cheat Sheet

```
G : goroutine. Started with `go`. Tracked by runtime.
M : OS thread. Created by runtime as needed. Pool-managed.
P : processor. Logical context. Count = GOMAXPROCS = NumCPU by default.

To run Go code:
  M must hold a P.
  P feeds G's from its local run queue.
  Steal from other P's when queue is empty.
  Global queue is the fallback.
  Netpoll wakes G's blocked on I/O.

sysmon:
  Background monitor, no P, runs every ~10 ms.
  Preempts long-running G's.
  Retakes P's from blocked syscall M's.

GOMAXPROCS:
  Set/get via runtime.GOMAXPROCS(n).
  Default: runtime.NumCPU().
  Cap on parallelism, not on goroutine count.

Diagnostics:
  GODEBUG=schedtrace=1000 — periodic scheduler summary.
  GODEBUG=scheddetail=1   — verbose per-G/M/P.
  runtime.NumGoroutine()  — live goroutine count.
  go tool trace           — detailed timeline.
```

---

## Self-Assessment Checklist

- [ ] I can name what G, M, P each stand for and explain their roles.
- [ ] I know what `GOMAXPROCS` defaults to and how to change it.
- [ ] I understand why an M must hold a P to execute Go code.
- [ ] I know what work stealing is and when it kicks in.
- [ ] I know what `sysmon` does without needing to read the source.
- [ ] I have used `GODEBUG=schedtrace` to inspect a running Go program.
- [ ] I understand the difference between cooperative blocks (channels) and syscalls in scheduler terms.
- [ ] I know what `runtime.NumGoroutine` returns and why it includes system goroutines.
- [ ] I can describe what `netpoll` does.
- [ ] I know that `runtime.LockOSThread` exists and when to use it.

---

## Summary

The Go scheduler runs goroutines on OS threads via the GMP model. G's are goroutines; M's are OS threads; P's are logical processors that gate execution. The scheduler distributes G's across P's, lets M's steal work when their P is empty, and integrates the network poller so blocking I/O does not waste threads.

The default settings work for most code. `GOMAXPROCS` defaults to CPU count; the runtime creates and reuses M's as needed. `sysmon` runs in the background, preempting long-running goroutines and retaking P's from blocked syscalls.

You do not need to think about the scheduler day to day. But when goroutines do not run as you expect — long delays, mysterious starvation, container CPU surprises — knowing the GMP model gives you the vocabulary to investigate. The next file (`middle.md`) zooms in on run queues, work stealing, netpoll, and tuning.

---

## What You Can Build

- A diagnostic helper that prints scheduler stats on demand.
- A small benchmark suite that demonstrates `GOMAXPROCS` effects.
- A tool that inspects `runtime.NumGoroutine` over time to detect leaks.
- A worker pool that scales with `GOMAXPROCS`.
- A web server that uses netpoll efficiently for tens of thousands of connections.

---

## Further Reading

- The Go Programming Language Specification: <https://go.dev/ref/spec>
- The Go runtime package: <https://pkg.go.dev/runtime>
- Dmitry Vyukov, *Scalable Go Scheduler Design Doc*: <https://go.dev/s/go11sched>
- Go source code: <https://github.com/golang/go/blob/master/src/runtime/proc.go>
- Kavya Joshi, *The Scheduler Saga* (GopherCon talk): <https://www.youtube.com/watch?v=YHRO5WQGh0k>
- Ardan Labs, *Scheduling in Go: Part I/II/III*: <https://www.ardanlabs.com/blog/2018/08/scheduling-in-go-part1.html>
- William Kennedy, *Concurrency, Goroutines and GOMAXPROCS*: <https://www.ardanlabs.com/blog/2014/01/concurrency-goroutines-and-gomaxprocs.html>

---

## Related Topics

- [01-what-is-concurrency](../01-what-is-concurrency/) — what concurrency is.
- [02-csp-model](../02-csp-model/) — the model Go's syntax implements.
- [04-memory-model](../04-memory-model/) — happens-before across goroutines.
- [05-when-to-use-concurrency](../05-when-to-use-concurrency/) — decision framework.
- [10-scheduler-deep-dive](../../10-scheduler-deep-dive/) — full internals (later chapter).

---

## Diagrams & Visual Aids

### G, M, P relationship

```
+---------+        +---------+         +---------+
|  G1     |        |  G2     |         |  G3     |
+---------+        +---------+         +---------+
     |                  |                   |
   runs on            runs on             waits
     |                  |
+---------+        +---------+
|   M1    |        |   M2    |
| holds P |        | holds P |
+---------+        +---------+
     |                  |
+---------+        +---------+
|   P0    |        |   P1    |
| queue:  |        | queue:  |
| [G3..]  |        | [G7..]  |
+---------+        +---------+
```

### Work stealing

```
P0: [running G0]  queue: [G1, G2, G3, G4, G5, G6]
P1: [running G7]  queue: [] <-- empty, steals from P0
P1: [running G7]  queue: [G4, G5, G6]   (took half)
P0: [running G0]  queue: [G1, G2, G3]
```

### Syscall handling

```
Before:
  M1 (holds P0) running G7 (G7 calls syscall)

During syscall:
  M1 is blocked in kernel
  sysmon detaches P0 from M1
  P0 is given to M2 (parked, now active)
  Other G's on P0's queue continue running

After syscall:
  G7 needs a P to continue
  M1 tries to acquire any P
  If none free, G7 goes to global queue and M1 parks
```

### Netpoll integration

```
Goroutine: conn.Read(buf)
  -> runtime: fd set non-blocking
  -> runtime: register fd in epoll
  -> goroutine parked
  -> M continues with other goroutines

Network event arrives:
  -> netpoll: epoll_wait returns ready fd
  -> netpoll: wake the parked goroutine
  -> goroutine put on P's queue (or global)
  -> some M picks it up, conn.Read returns data
```

### GOMAXPROCS effect

```
GOMAXPROCS=4 on an 8-core machine:
  Cores: [used] [used] [used] [used] [idle] [idle] [idle] [idle]
  Go uses 4 cores for goroutine execution.
  Other 4 are available to other processes (and to runtime syscall threads).

GOMAXPROCS=1:
  Cores: [used] [idle] [idle] [idle] [idle] [idle] [idle] [idle]
  All Go code serialised on one core.
  Concurrency works; parallelism does not.
```

### A typical 8-core Go web server

```
P0 ----- M1 ----- G123 (handler)
P1 ----- M2 ----- G456 (handler)
P2 ----- M3 ----- G789 (handler)
...
P7 ----- M8 ----- G890 (handler)

Parked Ms: M9 (was on a recent syscall), M10 (idle)
Sysmon:   M11 (no P, monitoring)

Goroutines parked on netpoll: 10 000+ idle connections
Goroutines in global queue: a few
Goroutines per P: 5-20 typical
```
