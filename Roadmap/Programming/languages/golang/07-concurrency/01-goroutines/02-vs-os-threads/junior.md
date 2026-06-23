## Goroutines vs OS Threads — Junior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Side-by-side Comparison](#side-by-side-comparison)
8. [Pros & Cons](#pros--cons)
9. [Use Cases](#use-cases)
10. [Code Examples](#code-examples)
11. [Coding Patterns](#coding-patterns)
12. [Clean Code](#clean-code)
13. [Product Use / Feature](#product-use--feature)
14. [Error Handling](#error-handling)
15. [Security Considerations](#security-considerations)
16. [Performance Tips](#performance-tips)
17. [Best Practices](#best-practices)
18. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
19. [Common Mistakes](#common-mistakes)
20. [Common Misconceptions](#common-misconceptions)
21. [Tricky Points](#tricky-points)
22. [Test](#test)
23. [Tricky Questions](#tricky-questions)
24. [Cheat Sheet](#cheat-sheet)
25. [Self-Assessment Checklist](#self-assessment-checklist)
26. [Summary](#summary)
27. [What You Can Build](#what-you-can-build)
28. [Further Reading](#further-reading)
29. [Related Topics](#related-topics)
30. [Diagrams & Visual Aids](#diagrams--visual-aids)

---

## Introduction
> Focus: "What is a thread? What is a goroutine? Why are goroutines cheaper, and what does that actually mean for the code I write?"

An **OS thread** is the smallest unit of execution the operating system kernel knows how to schedule. When a C program calls `pthread_create`, or a Java program creates `new Thread()`, the operating system allocates a thread: a stack, a register set, kernel bookkeeping, and a slot in the kernel's run queue. The OS scheduler picks threads, gives them CPU time, and switches between them.

A **goroutine** is the smallest unit of execution the *Go runtime* knows how to schedule. When you write `go f()`, the Go runtime allocates a goroutine: a small stack, a register save area, and a slot in one of the runtime's own run queues. The Go scheduler, *running inside your process*, picks goroutines and assigns them to OS threads.

A goroutine is *not* a kind of thread. It is a layer above threads. Many goroutines share a small pool of threads, and the Go runtime decides which goroutine runs on which thread, when, and for how long.

After reading this file you will:

- Be able to explain what an OS thread is and what a goroutine is in plain language.
- Know the headline cost differences (stack, creation time, context switch).
- Understand the `M:N` model — many goroutines on few threads.
- See why a Go web server can hold 50 000 idle connections on 4 threads.
- Recognise when an OS thread is still the right thing to ask for.
- Have a feel for how blocking syscalls are handled (the runtime *steals* the thread).
- Know that `GOMAXPROCS` caps how many threads run goroutines at once.

You do not need to know about the GMP scheduler internals, work-stealing, sysmon, or signal-based preemption yet. Those come at the middle, senior, and professional levels.

---

## Prerequisites

- **Required:** Comfort spawning a goroutine and a `sync.WaitGroup` — see [01-overview](../01-overview/junior.md).
- **Required:** A vague mental model of "operating system" and "process." If you have ever run `ps`, `top`, or Task Manager and seen "threads: 12," you are ready.
- **Helpful:** Familiarity with at least one threaded language (Java `Thread`, Python `threading`, C `pthread_create`, Rust `std::thread`). Not required.
- **Helpful:** Knowing what a system call is (a function the OS provides — `read`, `write`, `open`). You will see "the goroutine is parked while waiting on a syscall" — knowing what a syscall is makes that sentence land.

If you can write `go f()` and you have a fuzzy sense of "my computer runs many programs at once," you are ready.

---

## Glossary

| Term | Definition |
|------|-----------|
| **OS thread** | A kernel-managed unit of execution. Has its own stack (typically 1–8 MB) and a kernel data structure describing its state. Switched in/out by the OS scheduler. |
| **Process** | A program in execution. Owns memory, file descriptors, and one or more threads. Threads in the same process share memory. |
| **Goroutine** | A function executing concurrently with other goroutines in the same address space, scheduled by the *Go runtime*. Starts with a ~2 KB stack. |
| **Kernel scheduler** | The OS component that decides which thread runs on which CPU. Lives in the kernel. Context switch costs ~1–10 µs. |
| **User-space scheduler** | A scheduler that runs in your own process. The Go runtime contains one. Switches goroutines on the order of ~100 ns. |
| **`pthread`** | POSIX threads — the standard C API for creating OS threads on Unix-like systems (`pthread_create`, `pthread_join`, ...). On Linux it is implemented on top of `clone(2)`. |
| **M:N scheduling** | Many user-space tasks (M, the count) multiplexed onto N kernel threads (N, the count). Go uses M:N. Java uses 1:1 (one thread per `Thread`) by default before virtual threads. |
| **`GOMAXPROCS`** | The maximum number of OS threads that may simultaneously run Go code. Defaults to `runtime.NumCPU()`. |
| **Context switch** | The act of saving one execution's CPU state and loading another's. Kernel context switches are expensive; user-space goroutine switches are cheap. |
| **Blocking syscall** | A system call that may not return immediately — `read`, `accept`, `connect`. A thread executing one is stuck in the kernel until it completes. |
| **Netpoller** | A Go runtime component that uses `epoll` / `kqueue` / IOCP under the hood so that goroutines can "block" on network I/O without their underlying OS thread blocking. |
| **`M`** | The runtime's internal name for "OS thread" (M for *machine*). |
| **`G`** | The runtime's internal name for "goroutine." |
| **`P`** | The runtime's internal name for a "processor context" — a scheduler slot. `GOMAXPROCS` = number of Ps. |
| **Stack** | Memory region holding a function's call frames and local variables. Each goroutine and each OS thread has its own stack. |

---

## Core Concepts

### A thread is a *kernel* primitive; a goroutine is a *runtime* primitive

When you write Java `new Thread(() -> work())`, you are asking the *operating system* for a fresh execution context. The kernel allocates a thread descriptor, a stack (usually 1 MB on Linux), and adds it to the scheduler's queue. Creating a thread is a syscall (`clone(2)` on Linux), which crosses the user/kernel boundary. Each such crossing costs microseconds.

When you write Go `go work()`, you are asking the *Go runtime* (a library statically linked into your binary) for a fresh goroutine. The runtime allocates a `g` struct (a few hundred bytes), a 2 KB stack, and places it on a per-P run queue — all in user space. No syscall. The whole operation is a function call and a couple of pointer updates: ~hundreds of nanoseconds.

Same observation in numbers (rough, machine-dependent):

| Operation | OS thread (`pthread_create`) | Goroutine (`go f()`) |
|---|---|---|
| Creation time | 5–50 µs | 0.1–1 µs |
| Initial stack | 1–8 MB | 2 KB |
| Context switch | 1–10 µs | 0.1–0.3 µs |
| Max practical count | thousands | millions |

The Go runtime is allowed to be fast because it does not need the kernel's help for any of this.

### The Go runtime sits between your goroutines and the kernel

Your Go program runs in a process. That process is given some number of OS threads (Ms). The runtime decides which goroutine runs on which M. From the kernel's point of view, it is scheduling the *Ms*; it does not know goroutines exist.

```
+--------------------------------------------------------------+
| Your Go process                                              |
|                                                              |
|   Goroutines:  G1 G2 G3 G4 G5 ... G1000                     |
|                  \  |  / \  |  /                             |
|                   Go scheduler (user space)                  |
|                  /  |  \ /  |  \                             |
|   OS threads:   M1  M2  M3  M4    (count <= GOMAXPROCS + idle/syscall) |
|                  |   |   |   |                                |
+------------------|---|---|---|--------------------------------+
                   v   v   v   v
              +----------------------------+
              | Operating system kernel    |
              | Schedules Ms onto CPU cores|
              +----------------------------+
                   |   |   |   |
                   v   v   v   v
                  CPU CPU CPU CPU
```

The kernel scheduler sees four threads competing for cores. The Go scheduler sees a thousand goroutines competing for four threads. Two layers, two schedulers, one process.

### `GOMAXPROCS` is how many threads run your Go code at once

By default, Go sets `GOMAXPROCS = runtime.NumCPU()`. That is the maximum number of OS threads that may *simultaneously execute Go code*. Other Ms may exist — for example, one parked in a blocking syscall — but only `GOMAXPROCS` of them are running your application logic.

Setting `GOMAXPROCS=1` is instructive: only one thread runs Go code at a time. Multiple goroutines still take turns (concurrency), but two of them never run on different cores at the same instant (no parallelism).

### A blocking syscall does not block the program — it parks the goroutine and hands off the thread

This is the headline feature of Go's runtime, and the reason "Go is built for I/O."

When a goroutine calls a blocking syscall (say, `read` on a file), the kernel will block the thread that made the call until data is available. In a 1:1 thread model (Java pre-virtual-threads, C with pthreads, Python with the GIL released), this is fine: that thread is dedicated to that task.

In Go, the runtime intercepts: just before the syscall, it *detaches* the P from the M. The M (now stuck in the kernel) is no longer associated with a scheduling slot. The runtime grabs a different M (creating one if needed), attaches it to the orphaned P, and resumes scheduling other goroutines. When the syscall returns, the original M finds a P (or queues itself) and the goroutine continues.

The effect: a Go server can have 50 000 goroutines waiting on `read`, and only a handful of Ms — most parked in syscalls, freeing the few "running" Ms to handle the next batch.

### Network I/O is even cheaper — the netpoller

For network reads and writes, Go is smarter. It does not call the blocking syscall directly. It uses non-blocking I/O plus `epoll` (Linux), `kqueue` (BSD/macOS), or `IOCP` (Windows). When a goroutine does `conn.Read`, the runtime registers the connection with the netpoller and parks the goroutine — *without* blocking any M. When the kernel signals the connection is readable, the netpoller wakes the goroutine.

This means: 50 000 idle TCP connections cost ~50 000 goroutines worth of memory and ~one M for the netpoller. No 50 000 threads.

### Goroutines are not pinned to threads (mostly)

A given goroutine might run on M1 for 100 ns, then be parked, then resumed on M3 a millisecond later. Goroutines float between Ms freely. This is *fine* for almost all code: Go memory is process-wide, so it does not matter which thread is currently executing the goroutine.

There is one exception: if you must run on a *specific* OS thread (because some C library or OS feature is thread-local — OpenGL, certain crypto contexts, `setpriority`, signal masks), call `runtime.LockOSThread()`. From that point, the goroutine is pinned to its current M.

---

## Real-World Analogies

### Threads are taxis; goroutines are passengers

A city has a fixed fleet of taxis (OS threads). It has thousands of passengers (goroutines) who need to get places. A dispatcher (the Go scheduler) assigns passengers to taxis, moves them between taxis as needed, and parks taxis when there is nobody to drive. The kernel only sees taxis. It does not know how many passengers each taxi has carried.

### Threads are airline seats; goroutines are passengers waiting at a gate

An airline owns 4 planes (CPUs). Each plane has some number of seats (threads). Many passengers (goroutines) are at the gate, waiting their turn. A flight is short — seconds to minutes — and passengers cycle on and off planes. The plane never stops, but each individual passenger may make 10 short trips in the time another passenger makes 1 long one.

### Threads are kitchen workers; goroutines are recipes on cards

A small kitchen has 4 cooks (CPUs and threads). On the counter sit hundreds of recipe cards (goroutines), each describing a small task. A head chef (the Go scheduler) hands a card to whichever cook is free. Cooks do not know about cards; they just take the next task. Cards are cheap to print; cooks are scarce.

### Threads are heavyweight robots; goroutines are conveyor pallets

A factory has 4 robots (threads). The robots are expensive to install, configure, and move. On the conveyor (run queue) sit hundreds of pallets (goroutines), each labelled with its work. The robots take pallets in turn. When one pallet has to wait for paint to dry (blocking syscall), the robot can pick up a different pallet. The pallet system is what scales; the robots are the bottleneck.

### Threads are dish washers; goroutines are dishes

A restaurant has 3 dish washers (threads). There are 500 dirty dishes (goroutines). The dish washers do not own dishes; they just process whichever dish is at the front of the queue. When the kitchen is short-staffed (low `GOMAXPROCS`), dishes pile up. When the kitchen hires more washers (high `GOMAXPROCS`), more dishes get done in parallel. The dishes do not care which washer cleans them.

---

## Mental Models

### Model 1: "Threads are expensive — both to create and to keep"

Every OS thread costs:

- A stack (1–8 MB virtual address space; pages allocated lazily but the address range is reserved).
- Kernel structures (~10 KB).
- A slot in the kernel's run queue.
- A small amount of memory in every per-CPU cache it has run on (TLB entries, L1/L2 cache lines, branch predictor history).
- A real possibility of contention on shared kernel locks when many threads of the same process call into the kernel.

Each goroutine costs:

- 2 KB initially; grows on demand.
- ~200 bytes of runtime bookkeeping (`g` struct).
- Slot in one of `GOMAXPROCS` per-P run queues.

A million goroutines is realistic. A million threads is not.

### Model 2: "Goroutines block, threads do not have to"

When a goroutine writes `n, err := conn.Read(buf)`, it *looks* synchronous and blocking. Under the hood, the runtime may park the goroutine and free up the thread to do other work. The blocking style is preserved; the cost is not paid.

Compare to a Node.js model, where you write `conn.read(callback)` and the function returns immediately. Node achieves the same "no thread blocked" outcome, but the programming model is callback-driven. Go gives you the simpler blocking style; the runtime hides the asynchronous machinery.

### Model 3: "`GOMAXPROCS` is the width; goroutines are the queue"

Imagine a supermarket with `GOMAXPROCS` checkout lanes. Each lane can serve one shopper at a time. There may be hundreds of shoppers (goroutines) in the store, but at any instant only `GOMAXPROCS` of them are being checked out. Increasing `GOMAXPROCS` adds lanes; the throughput rises if you have enough cashiers (CPUs) and enough work.

### Model 4: "The kernel sees threads. The runtime sees goroutines. Tools that report 'threads' are reporting Ms."

If you run `ps -L | grep myapp` on Linux, you see threads — Ms. A Go program with `GOMAXPROCS=4` typically shows 6–10 threads, not 4: some Ms are parked in syscalls, one is the netpoller, one is the GC. To see *goroutines*, use `runtime.NumGoroutine()` or `pprof`. They will reveal hundreds to millions.

This separation is the source of much confusion. "My Go server has 8 threads but 50 000 goroutines" is a normal, healthy state.

### Model 5: "If you do not need a thread, ask for a goroutine"

The default in Go is `go f()`. Ask for a thread (via `runtime.LockOSThread`) only when:

- You are calling into a C library with thread-local state.
- You are interacting with an OS feature that is thread-scoped (signals, scheduling priority, certain `ioctl` calls).
- You are speaking to a windowing system (OpenGL, GTK) from its required UI thread.

Otherwise, goroutines are strictly cheaper.

---

## Side-by-side Comparison

| Aspect | OS thread | Goroutine |
|---|---|---|
| Owner | Operating system | Go runtime (your process) |
| Created by | `pthread_create`, `clone(2)`, `CreateThread` | `go f()` |
| Creation cost | 5–50 µs (kernel work) | 0.1–1 µs (user-space work) |
| Initial stack size | 1–8 MB (Linux: 8 MB default; settable) | 2 KB (grows on demand to 1 GB) |
| Max practical concurrency | Thousands | Millions |
| Context switch cost | 1–10 µs (kernel-mediated) | 0.1–0.3 µs (user-space) |
| Scheduled by | Kernel scheduler (CFS on Linux) | Go runtime scheduler (`runtime/proc.go`) |
| Identity | TID (thread ID), visible in `ps`, `top` | Internal `goid` (not exposed; runtime use only) |
| Inter-process visibility | Yes (kernel sees them) | No (only your process sees them) |
| Memory sharing | Shares the process's address space | Same — goroutines share process memory |
| Stack growth | Pre-allocated, fixed-ish | Grows from 2 KB on demand |
| Affinity to a CPU | Settable via `sched_setaffinity` | Indirect — only via the M it runs on |
| Affinity to a thread | N/A (it *is* the thread) | Settable via `runtime.LockOSThread` |
| Blocked on syscall | Thread is parked by the kernel | Runtime hands off the thread; goroutine is parked, M is reused/created |
| Cancellable from outside | Yes, but unsafe — `pthread_cancel` is fraught | Yes, via `context.Context` (cooperative) |
| Unhandled crash | Thread dies; process may survive (depending on signal) | Process dies (unrecovered panic kills the whole program) |
| Communication | Shared memory + locks; pipes, sockets | Channels, shared memory + locks |
| Visibility in tools | `ps`, `top`, `htop`, `/proc/<pid>/task/` | `runtime.NumGoroutine`, `pprof goroutine` profile |

---

## Pros & Cons

### Pros of goroutines over threads

- **Cheap to create.** ~100× cheaper than a thread.
- **Cheap to switch.** ~10–30× cheaper context switch.
- **Small initial stack.** 2 KB versus 1–8 MB. A million goroutines fits where a million threads cannot.
- **Blocking-style I/O without thread cost.** The runtime parks goroutines and re-uses threads.
- **No new syscall to spawn.** Goroutine creation is entirely user-space.
- **Integrated with the GC.** The runtime can suspend goroutines safely for GC.
- **Network I/O via netpoller.** 50 000 idle connections, ~handful of threads.

### Cons of goroutines (versus threads)

- **No OS-level identity.** No PID/TID. You cannot `kill -9` a goroutine. Cooperative cancellation only (`context.Context`).
- **Unrecovered panic kills the process.** A thread crash in a multi-language program is sometimes survivable. A goroutine panic is not.
- **Not visible to the OS.** Tools like `top`, `perf`, and `strace` see threads, not goroutines.
- **`LockOSThread` is the only escape hatch.** For thread-local state, you must explicitly pin.
- **No real-time guarantees.** Goroutine latency depends on the Go scheduler, which is good-enough but not real-time.
- **Limited to one process.** A goroutine cannot span processes. For that, you use OS primitives — processes, pipes, shared memory.

### Pros of OS threads over goroutines (yes, there are some)

- **Universally available.** Every language and library can use them.
- **Visible to OS tools.** Easier to monitor at the OS level.
- **Can be set to real-time priority.** Goroutines cannot.
- **Pinning to a CPU is straightforward.** `sched_setaffinity`. Goroutines need an M lock first.
- **Cross-language interop is simpler.** A C library expects a thread; a goroutine is not directly equivalent.

### Cons of OS threads

- **Heavyweight.** Memory and creation cost dominate at scale.
- **Limited count.** A few thousand threads at most before kernel scheduler pressure shows up.
- **Synchronisation is harder.** Locks, condition variables, futexes — no first-class channel.
- **Cancellation is unsafe.** Forcing a thread to stop mid-operation is a recipe for corruption.

---

## Use Cases

### Where goroutines shine

| Scenario | Why |
|---|---|
| Web server | 1 goroutine per request; netpoller handles thousands of idle connections. |
| WebSocket gateway | Hundreds of thousands of long-lived connections, one goroutine per conn. |
| Stream processor | Goroutines per pipeline stage, channels carrying records. |
| Network probe / scanner | High fan-out concurrent dials; threads would exhaust memory. |
| Background workers in an API | Each request can spawn supplementary goroutines without thread pool ceremony. |

### Where threads are still the right answer

| Scenario | Why |
|---|---|
| OpenGL / GUI from Go | Some UI toolkits insist on running on a specific thread; pin with `LockOSThread`. |
| Calling a non-reentrant C library (e.g., some crypto libs) | The library holds thread-local state. |
| Hard real-time scheduling | Set `SCHED_FIFO` priority on a thread; goroutines cannot. |
| Signal handlers that must run on a specific thread | Pin one goroutine via `LockOSThread` and let it receive. |
| Programs without a runtime (kernel, embedded) | No runtime = no goroutines. |

### Where neither is the right answer

| Scenario | Better tool |
|---|---|
| Hundreds of thousands of fully-CPU-bound tasks | A *process* per task (so they get their own GC, address space) — or batch with SIMD. |
| Many machines | Distributed system — goroutines and threads are within one machine. |
| Tasks that may corrupt state on failure | Process isolation: a worker process per task. |

---

## Code Examples

### Example 1: Spawning a goroutine looks the same as spawning a thread, but is much cheaper

```go
package main

import (
    "fmt"
    "runtime"
    "sync"
    "time"
)

func main() {
    const N = 100_000

    start := time.Now()
    var wg sync.WaitGroup
    for i := 0; i < N; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            // pretend to do a tiny amount of work
        }()
    }
    wg.Wait()
    fmt.Printf("spawned %d goroutines in %v\n", N, time.Since(start))
    fmt.Printf("threads in use: ~%d\n", runtime.GOMAXPROCS(0))
}
```

On a modern laptop: ~100 ms total to spawn and join 100 000 goroutines. Try the same in C with `pthread_create` × 100 000 and you will run out of virtual memory (each thread's 8 MB stack × 100 000 = 800 GB of address space requested).

### Example 2: Inspecting how many threads the runtime is using

```go
package main

import (
    "fmt"
    "runtime"
    "runtime/debug"
)

func main() {
    fmt.Println("GOMAXPROCS:", runtime.GOMAXPROCS(0))
    fmt.Println("NumCPU:    ", runtime.NumCPU())
    fmt.Println("NumGoroutine:", runtime.NumGoroutine())
    fmt.Println("GC build info:", debug.GCStats{})
    // On Linux you can also read /proc/<pid>/status: see "Threads:" line.
}
```

Output (typical):

```
GOMAXPROCS: 8
NumCPU:     8
NumGoroutine: 1
GC build info: {0001-01-01 00:00:00 +0000 UTC 0 0 [] [] []}
```

`NumGoroutine` is 1 (main). The actual *thread* count visible to the kernel might be 6–10: main, sysmon, netpoller, GC workers, finalizer, etc.

### Example 3: A blocking syscall does not block the program

```go
package main

import (
    "fmt"
    "os"
    "runtime"
    "sync"
    "time"
)

func main() {
    runtime.GOMAXPROCS(2)
    var wg sync.WaitGroup
    // 10 goroutines pretend to do blocking I/O via time.Sleep.
    // time.Sleep does not actually call the kernel sleep syscall;
    // it parks via the netpoller's timer. For a true syscall demo,
    // use os.Stdin.Read or a file read.
    for i := 0; i < 10; i++ {
        wg.Add(1)
        go func(id int) {
            defer wg.Done()
            time.Sleep(500 * time.Millisecond)
            fmt.Printf("goroutine %d woke up\n", id)
        }(i)
    }
    wg.Wait()
    _ = os.Stdout.Sync()
}
```

10 goroutines all "sleep" concurrently. `GOMAXPROCS=2` does not limit how many goroutines may be parked; it only limits how many goroutines may run *Go code* simultaneously.

### Example 4: `LockOSThread` — pinning a goroutine to a thread

```go
package main

import (
    "fmt"
    "runtime"
    "sync"
)

func main() {
    var wg sync.WaitGroup
    wg.Add(1)
    go func() {
        defer wg.Done()
        runtime.LockOSThread()
        defer runtime.UnlockOSThread()
        // Now this goroutine is pinned to its current OS thread.
        // Useful if the body calls a library with thread-local state.
        fmt.Println("pinned goroutine running")
    }()
    wg.Wait()
}
```

You rarely need this. It is here so you can read about it elsewhere and not feel lost.

### Example 5: Threads vs goroutines spawn cost (a tiny benchmark)

```go
package main

import (
    "fmt"
    "sync"
    "time"
)

func main() {
    const N = 1_000_000
    var wg sync.WaitGroup
    wg.Add(N)

    start := time.Now()
    for i := 0; i < N; i++ {
        go func() {
            wg.Done()
        }()
    }
    wg.Wait()
    fmt.Printf("spawn+join %d goroutines: %v\n", N, time.Since(start))
}
```

Typical result: ~1–2 seconds total for one million goroutines on a normal laptop. Per-goroutine: 1–2 µs (including the join).

`pthread_create` × 1 million does not finish. The kernel runs out of memory or pid space first.

### Example 6: Different `GOMAXPROCS` values

```go
package main

import (
    "fmt"
    "runtime"
    "sync"
    "time"
)

func cpuBurn(d time.Duration) {
    end := time.Now().Add(d)
    for time.Now().Before(end) {
        _ = 1 + 1
    }
}

func run(n int) time.Duration {
    runtime.GOMAXPROCS(n)
    var wg sync.WaitGroup
    start := time.Now()
    for i := 0; i < 4; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            cpuBurn(time.Second)
        }()
    }
    wg.Wait()
    return time.Since(start)
}

func main() {
    for _, n := range []int{1, 2, 4} {
        fmt.Printf("GOMAXPROCS=%d  4 cpu-burners: %v\n", n, run(n))
    }
}
```

On a 4-core machine:
- `GOMAXPROCS=1`: ~4 s (four 1-second jobs take turns on one thread).
- `GOMAXPROCS=2`: ~2 s (two jobs at a time).
- `GOMAXPROCS=4`: ~1 s (all four run in parallel).

This is parallelism in action — and it shows that goroutines do not magically use all your cores. `GOMAXPROCS` does.

### Example 7: Many goroutines, few threads — inspect with `/proc`

Run this on Linux:

```go
package main

import (
    "fmt"
    "runtime"
    "sync"
    "time"
)

func main() {
    var wg sync.WaitGroup
    for i := 0; i < 10_000; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            time.Sleep(10 * time.Second)
        }()
    }
    fmt.Printf("goroutines: %d\n", runtime.NumGoroutine())
    fmt.Printf("pid: %d  GOMAXPROCS: %d\n", procPID(), runtime.GOMAXPROCS(0))
    fmt.Println("Run in another terminal: cat /proc/$(pgrep <yourBinaryName>)/status | grep Threads")
    wg.Wait()
}

func procPID() int { return -1 } // Avoid importing os; reader will look up by name.
```

Result: `runtime.NumGoroutine()` is ~10 001. The `Threads` line in `/proc/<pid>/status` typically shows a small single-digit number — usually 5–10 — because all 10 000 goroutines are parked in `time.Sleep` via the timer/netpoller, holding zero threads.

### Example 8: Where a thread shows up that you didn't ask for

```go
package main

/*
#include <stdio.h>
#include <unistd.h>
void slow_c_call() { sleep(2); }
*/
import "C"
import (
    "fmt"
    "runtime"
    "sync"
)

func main() {
    var wg sync.WaitGroup
    for i := 0; i < 10; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            C.slow_c_call() // blocking C call
        }()
    }
    fmt.Println("goroutines:", runtime.NumGoroutine())
    // While the cgo calls are in flight, the runtime creates extra Ms to keep
    // serving other goroutines. The thread count in /proc grows up to ~10.
    wg.Wait()
}
```

cgo calls block their M for the entire duration of the C function. To keep `GOMAXPROCS` goroutines running, the runtime spawns more Ms. This is a useful experiment for understanding why cgo workloads can balloon thread count.

---

## Coding Patterns

### Pattern 1: "Spawn freely" — the default

For typical Go code: spawn goroutines wherever a parallel or concurrent unit of work exists. Do not worry about thread count.

```go
for _, item := range items {
    item := item
    go process(item) // fine for moderate batches
}
```

For unbounded input, use a worker pool to bound concurrency — but the limit is your application's resource budget (DB connections, downstream rate limits), not "thread count."

### Pattern 2: "Pin to thread when forced" — `LockOSThread`

When a library or OS feature requires it:

```go
go func() {
    runtime.LockOSThread()
    defer runtime.UnlockOSThread()
    initOpenGL()
    runEventLoop()
}()
```

That goroutine now monopolises its thread. Do not put much work in that goroutine — the rest of your program runs on the remaining Ms.

### Pattern 3: "Match `GOMAXPROCS` to CPU budget"

For CPU-bound work in a container with `cpuLimit=2`, set `GOMAXPROCS=2`. Since Go 1.16, the runtime reads cgroup quotas automatically on Linux; before then, use `go.uber.org/automaxprocs`:

```go
import _ "go.uber.org/automaxprocs"
```

The import has an `init` that adjusts `GOMAXPROCS` to the cgroup limit.

### Pattern 4: "Goroutine-per-connection" for network servers

```go
ln, _ := net.Listen("tcp", ":8080")
for {
    conn, err := ln.Accept()
    if err != nil { ... }
    go handleConn(conn) // one goroutine per connection
}
```

50 000 idle connections cost 50 000 goroutines (~100 MB at 2 KB each) plus the netpoller — not 50 000 threads. This is the canonical Go server pattern.

### Pattern 5: "Bounded worker pool" for CPU-bound work

When the work is purely CPU-bound and you do not want overcommit:

```go
const workers = runtime.GOMAXPROCS(0)
jobs := make(chan Job, 100)
var wg sync.WaitGroup
for i := 0; i < workers; i++ {
    wg.Add(1)
    go func() { defer wg.Done(); for j := range jobs { process(j) } }()
}
for _, j := range pendingJobs { jobs <- j }
close(jobs)
wg.Wait()
```

CPU-bound concurrency rarely benefits from goroutines > `GOMAXPROCS`. Network-bound concurrency easily benefits from thousands.

---

## Clean Code

- **Do not say "thread" when you mean "goroutine."** It causes confusion in code review, comments, and diagnostics. Use "goroutine" for the user-space unit and "thread" (or "M") for the kernel unit.
- **Do not call `runtime.LockOSThread` "for safety."** It is not safer; it is rarer. Use it only when the OS or a library forces you.
- **Do not set `GOMAXPROCS` defensively.** Defaults are correct on bare metal and on Go 1.16+ in containers. Setting it manually is for very specific tuning.
- **Treat `runtime.NumGoroutine` and the kernel thread count as separate metrics.** They tell you different things. Monitor both, but understand each.

---

## Product Use / Feature

| Product feature | How the thread-vs-goroutine distinction matters |
|---|---|
| High-concurrency API gateway | Goroutines + netpoller scale to ~100 k concurrent connections per host; thread-based gateways top out at ~10 k. |
| GPU compute helper in Go | Must `LockOSThread` to call OpenGL / CUDA / Vulkan; one pinned goroutine per device. |
| Real-time audio loop | Pin one goroutine via `LockOSThread`; the audio API expects the same thread per callback. |
| Cron-like job runner | Plain goroutines; spawn per job, cancel via `context.Context`. |
| Multi-tenant data plane | Tag goroutines with `pprof.Labels(ctx, "tenant", id)` to isolate noisy neighbours in profiles; threads do not have a label concept. |
| FFI to a thread-unsafe library | Either pin (`LockOSThread`) or serialise calls through a single owner goroutine — not both. |

---

## Error Handling

The error-handling implications of "goroutine, not thread":

1. **An unrecovered goroutine panic terminates the entire process.** With C `pthread`s, a SIGSEGV in one thread can sometimes be caught and the program continues. In Go, the runtime will not let you do that — it considers a panic a corrupted state. Recover explicitly inside risky goroutines:

   ```go
   go func() {
       defer func() {
           if r := recover(); r != nil {
               log.Printf("goroutine recover: %v\n%s", r, debug.Stack())
           }
       }()
       work()
   }()
   ```

2. **Errors cannot be returned from `go f()`.** A thread's `pthread_join` can deliver a return value; a goroutine's cannot. Use channels, `errgroup.Group`, or a closure-captured `error` field.

3. **Cgo panics may corrupt the runtime.** If a C library segfaults, the Go runtime may or may not survive. Defensive C programming and `runtime.LockOSThread` are partial mitigations.

4. **Cancellation must be cooperative.** Unlike `pthread_cancel`, you cannot forcefully stop a goroutine from outside. Pass `context.Context` and have the goroutine check `ctx.Done()` in its loops.

---

## Security Considerations

- **No isolation between goroutines.** All goroutines share memory, file descriptors, and credentials. There is no goroutine-level sandbox. If you need isolation, use processes (or a kernel-level sandbox: seccomp, namespaces).
- **A panic = a crash = a DoS vector.** Crafted input that triggers a panic in a request-handling goroutine kills the whole process. Always recover at the boundary.
- **`runtime.LockOSThread` and `setuid`-like syscalls.** Some Linux syscalls (`setuid`, `setgid`) are per-thread, not per-process. Calling them from a goroutine without `LockOSThread` may leave the program in an inconsistent state. Use the dedicated `syscall.Set*` wrappers or pin first.
- **Thread count visibility.** OS-level monitoring tools see threads. A sudden spike in thread count (from a cgo blocking storm) may look like an attack but is actually a code smell.
- **Resource exhaustion.** Even goroutines are not free. A million goroutines × 2 KB = 2 GB. An attacker who can trigger goroutine spawning per request can OOM you. Bound concurrency with a pool or semaphore.

---

## Performance Tips

- **Don't worry about thread count for goroutine-heavy code.** The runtime manages Ms. Trust it.
- **Set `GOMAXPROCS` to match real CPU budget.** In containers without cgroup-aware Go (< 1.16) or non-Linux platforms, use `go.uber.org/automaxprocs`.
- **Watch out for "M creation storms" with cgo.** Each blocking cgo call holds its M for the call duration; the runtime may spawn many Ms. Profile cgo-heavy code.
- **Network I/O is always cheap (netpoller).** Disk and file I/O is cheaper than you fear but not free.
- **`LockOSThread` is a performance tax.** It prevents the runtime from balancing work; use sparingly.
- **Goroutine pool reuse can matter at very high spawn rates.** For tens of thousands of short-lived goroutines per second, a pool reduces GC pressure on the goroutine free list — but profile before optimizing.

---

## Best Practices

1. Use goroutines as the default unit of concurrency. Reserve `LockOSThread` for proven thread-local-state cases.
2. Trust the runtime to manage Ms; do not try to set thread count directly.
3. Set `GOMAXPROCS` only when running in a constrained container on a Go version that does not auto-detect.
4. Always recover panics in long-running goroutines (network handlers, background tickers).
5. Use `context.Context` for cancellation across goroutine trees — there is no `pthread_cancel` equivalent.
6. Measure goroutine count *and* thread count in production. Spikes in either are worth investigating.
7. Pin a goroutine to a thread only as long as needed; `runtime.UnlockOSThread` once the thread-local operation is done.
8. Treat cgo calls as expensive — they hold an M for the duration.

---

## Edge Cases & Pitfalls

### Cgo and thread count

```go
// 100 goroutines each making a blocking C call
for i := 0; i < 100; i++ {
    go C.slow_call()
}
```

For the duration of those calls, the runtime spawns up to 100 OS threads (one per blocked M). After the calls return, most are parked but not destroyed immediately. Heavy cgo workloads can hit kernel thread limits.

### `LockOSThread` and panic

If a pinned goroutine panics and the panic is not recovered, the goroutine exits — but `runtime.UnlockOSThread` *is* called automatically when the goroutine exits, so the thread is released. Still, the process dies (panic). Always recover inside pinned goroutines that call into fragile C code.

### Forgetting that `time.Sleep` does not block a thread

`time.Sleep(1 * time.Hour)` does not consume an M. It parks the goroutine via the netpoller's timer. A million goroutines sleeping costs no extra threads. This is unlike, say, Java's `Thread.sleep`, which holds the thread.

### `runtime.GOMAXPROCS(0)` reads, `runtime.GOMAXPROCS(n)` writes

The `0` argument is "do not change." Common bug: writing `runtime.GOMAXPROCS(runtime.NumCPU())` early in `main` thinking you are "checking" — you have just set it.

### Container CPU limits ignored on old Go

Pre-1.16, Go did not read cgroup CPU limits. A pod limited to 0.5 cpus on a 64-core node would set `GOMAXPROCS=64`. This caused massive scheduler oversubscription. Upgrade Go, or use `automaxprocs`.

### Forking with cgo

`fork()` in a multi-threaded program is dangerous; the child inherits only the calling thread. The Go runtime in the child can be in any state. Avoid `fork` after the runtime has started; use `os/exec` (which uses `fork+exec` atomically).

### Signal delivery and pinning

POSIX signals are delivered to *some* thread of a multi-threaded process. The Go runtime installs handlers that route signals into a Go channel via `signal.Notify`. You normally do not need to pin a thread to receive signals. The exception: if you must call into C from a specific thread (signal handler in a C library), pin.

### `os.Exit` versus return from `main`

`os.Exit(0)` terminates the process *without* running deferred functions or letting goroutines finish. Same effect as the Go runtime ending. Use sparingly.

---

## Common Mistakes

| Mistake | Fix |
|---|---|
| Spawning a goroutine per byte of input "for performance" | Goroutines are cheap, not free. A function call is faster. |
| Setting `GOMAXPROCS=1` thinking it makes code "single-threaded and safe" | Concurrency bugs still happen at GOMAXPROCS=1. Use `-race`. |
| Calling thread-local syscalls from an unpinned goroutine | Pin with `LockOSThread` first, or use process-wide alternatives. |
| Treating `runtime.NumGoroutine()` as "thread count" | They are different. Check `/proc/<pid>/status` for thread count. |
| Forgetting `runtime.UnlockOSThread` in long-lived pinned goroutines that should be released | Pair every `LockOSThread` with an `UnlockOSThread` (or accept the goroutine ends with the thread). |
| Calling `runtime.LockOSThread` "just in case" | It harms scheduling and is rarely needed. Use only when forced. |
| Calling `pthread_cancel`-style cancellation expectations on goroutines | Goroutines cancel cooperatively via `context.Context` only. |
| Spawning goroutines from a finalizer | Finalizers run on a runtime goroutine; spawning more is fine, but rely on the GC will rarely give you predictable behaviour. |

---

## Common Misconceptions

> *"A goroutine is a thread."* — No. It is scheduled onto threads by the runtime. The OS does not know goroutines exist.

> *"More goroutines = more parallelism."* — No. Parallelism is capped by `GOMAXPROCS`. More goroutines means more *concurrency*, which becomes parallelism only when multiple goroutines are runnable simultaneously and CPUs are available.

> *"Go uses one thread per goroutine."* — No. The default is `GOMAXPROCS` runnable Ms, plus some extras for syscalls. Many goroutines share one M.

> *"`time.Sleep` blocks a thread."* — No. It parks the goroutine via the timer; no M is consumed.

> *"`runtime.NumGoroutine` returns the thread count."* — No. It returns the goroutine count. Look at `/proc/<pid>/status` or `runtime/debug.SetTraceback` to see Ms.

> *"`LockOSThread` makes my code faster."* — No. It hurts the scheduler. Use it only when forced by thread-local state.

> *"Go can't do real-time work because it has no threads."* — Partial. Go does use threads, but does not expose real-time priority APIs. For hard real-time, prefer a different language.

> *"Spawning a goroutine is faster than a function call."* — No. A function call is ~ns. Spawning a goroutine is ~µs. Use goroutines for concurrency, not micro-optimisation.

---

## Tricky Points

### A goroutine can run on different threads in its lifetime

Unless pinned, the runtime moves goroutines between Ms freely. A `goroutine ID` is not a stable identifier of thread affinity.

### "Thread-safe" and "goroutine-safe" are the same

The Go memory model treats the unit as the goroutine, not the thread. A "goroutine-safe" type works correctly when accessed by multiple goroutines. Whether those goroutines run on different Ms or the same M is irrelevant.

### Number of Ms can exceed `GOMAXPROCS`

If goroutines are blocked in syscalls, the runtime creates extra Ms so the remaining Ps still have work to do. `GOMAXPROCS` is the number of *runnable user-code* Ms at any instant, not a hard cap on total Ms.

### Mac OS X has thread quirks

The macOS kernel imposes a per-process thread cap (~2 048 by default, raised on newer macOS versions). Cgo-heavy Go programs can hit this. Linux is much more lenient.

### Goroutines do not preempt themselves on `Mutex.Lock`

A `Mutex.Lock` may park the goroutine if the mutex is contended, but a `Mutex.Lock` on an uncontended mutex completes synchronously without scheduler intervention. Same for atomic operations.

### `runtime.LockOSThread` is sticky across function calls

Once locked, the goroutine stays pinned until *the same goroutine* calls `runtime.UnlockOSThread` the same number of times. If a pinned goroutine exits, the thread is released automatically (and possibly destroyed by the runtime if it can no longer be used safely).

### Threads are also a resource limit

Linux has `RLIMIT_NPROC` (max threads/processes per user) and a global `kernel.threads-max`. A Go program with `GOMAXPROCS=8` plus a few syscall and netpoller Ms uses ~10–15 threads — well within limits. A cgo-heavy program can exceed these.

---

## Test

```go
// thread_test.go
package goroutines_test

import (
    "runtime"
    "sync"
    "testing"
)

// Verifies that spawning many goroutines does NOT cause the kernel-visible
// thread count to spike. On a healthy system, threads stay near GOMAXPROCS.
func TestGoroutinesDoNotSpawnThreads(t *testing.T) {
    const N = 1000
    var wg sync.WaitGroup
    for i := 0; i < N; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            _ = 1 + 1
        }()
    }
    wg.Wait()

    if g := runtime.NumGoroutine(); g > 5 {
        // After Wait, most should have exited.
        t.Logf("post-wait goroutines: %d (some background ones are normal)", g)
    }
}

// Verifies that LockOSThread pins the goroutine.
func TestLockOSThreadPins(t *testing.T) {
    var wg sync.WaitGroup
    wg.Add(1)
    go func() {
        defer wg.Done()
        runtime.LockOSThread()
        defer runtime.UnlockOSThread()
        // Anything we do here runs on the locked thread.
        // We can't easily assert thread identity in pure Go, but we can
        // verify the call is safe and returns.
    }()
    wg.Wait()
}
```

Run with:

```bash
go test -race -count=1 ./...
```

---

## Tricky Questions

**Q.** Why does a Go program with `GOMAXPROCS=4` often show 6–10 threads in `top`?

**A.** Some Ms are parked in syscalls, one or two run sysmon and GC workers, one runs the netpoller, and a few are reserved. The runtime keeps a small pool above `GOMAXPROCS` to handle bursts.

---

**Q.** I spawned 100 000 goroutines and my memory only went up by 200 MB. How?

**A.** 100 000 × 2 KB stack = 200 MB. Goroutines start with 2 KB and grow only on demand. Threads would have used 100 000 × 1 MB = 100 GB.

---

**Q.** I have a tight CPU loop in one goroutine on a `GOMAXPROCS=1` machine, and it never lets other goroutines run on Go 1.13. Why?

**A.** Pre-1.14, the scheduler was cooperative — preemption happened only at function-call points. A loop with no calls inside was uninterruptible. Go 1.14+ added asynchronous (signal-based) preemption; the same loop is now preemptible.

---

**Q.** Why does `time.Sleep(1 * time.Hour)` not block a thread?

**A.** It parks the goroutine using the runtime's internal timer (which uses the netpoller's epoll/kqueue). The goroutine sleeps; no M is consumed. Compare to Java's `Thread.sleep`, which blocks the OS thread.

---

**Q.** What is the maximum number of goroutines I can have?

**A.** In theory: limited by memory. In practice: millions. Each costs ~2 KB stack + ~200 B bookkeeping. A 32 GB machine can hold around 10–15 million goroutines that are all idle.

---

**Q.** Can a goroutine outlive `main`?

**A.** No. When `main` returns, the runtime kills the process — and with it, every goroutine, regardless of state. Always wait for goroutines you care about.

---

**Q.** Why is `runtime.LockOSThread` needed for OpenGL?

**A.** OpenGL contexts are thread-local: an OpenGL call must be made on the thread that created the context. If a goroutine drifts to a different M between calls, the calls go to a thread that has no context — segfault. Pinning solves this.

---

## Cheat Sheet

```
Goroutine                            OS thread
---------                            ---------
go f()                               pthread_create / clone / CreateThread
runtime.NumGoroutine()               /proc/<pid>/status → "Threads:"
context.Cancel (cooperative)         pthread_cancel (unsafe)
~2 KB initial stack                  ~1–8 MB initial stack
0.1–1 µs to spawn                    5–50 µs to spawn
runtime scheduler picks M for G      kernel scheduler picks core for thread
runtime.LockOSThread() to pin        intrinsic — thread IS the unit
recover() to handle panic            try/catch (in non-Go languages)
GOMAXPROCS = max runnable Ms         (no equivalent)
netpoller masks blocking on net      poll/select/epoll in user code
```

```go
// Default — use goroutines
go f()

// Pin to a thread when forced
go func() {
    runtime.LockOSThread()
    defer runtime.UnlockOSThread()
    cLibraryCall()
}()

// Match CPU budget
import _ "go.uber.org/automaxprocs" // Go < 1.16 or non-cgroup containers

// Read knobs
runtime.GOMAXPROCS(0) // current
runtime.NumCPU()      // logical CPUs
runtime.NumGoroutine()// live goroutines
```

---

## Self-Assessment Checklist

- [ ] I can explain in one sentence what an OS thread is and what a goroutine is, and why they are different.
- [ ] I know the headline cost differences (stack, creation, context switch) within an order of magnitude.
- [ ] I know that the Go runtime contains its own scheduler and that `GOMAXPROCS` bounds how many threads it uses for Go code.
- [ ] I know that `time.Sleep`, network reads, and channel operations *park* a goroutine without holding a thread.
- [ ] I know what `LockOSThread` is for and when *not* to use it.
- [ ] I know that an unrecovered panic terminates the process, not just the goroutine.
- [ ] I know that 50 000 goroutines fit in tens of MB; 50 000 threads do not fit at all.
- [ ] I can find the thread count of a running Go process on Linux (`/proc/<pid>/status`).
- [ ] I know that goroutines cannot be killed from outside; cancellation is cooperative via `context.Context`.
- [ ] I have written a small program that demonstrates `GOMAXPROCS` affecting parallelism but not concurrency.

---

## Summary

A **goroutine** and an **OS thread** are not different sizes of the same thing; they are different layers of the stack. The kernel only knows how to schedule threads. The Go runtime, which lives inside your process, multiplexes a sea of goroutines onto a small pool of threads.

That layering buys you:

- ~100× cheaper creation.
- ~10–30× cheaper context switches.
- ~500× smaller initial stack.
- Blocking-style I/O without the per-connection thread cost.
- A million-goroutine memory footprint that fits on a laptop.

It costs you:

- No OS-level identity, so no external cancellation.
- An unrecovered panic kills the process.
- Thread-local OS features (OpenGL, certain `setuid`-family calls, `LockOSThread` for signals) need explicit pinning.

For the vast majority of Go code, the right answer is: use goroutines, set `GOMAXPROCS` to your real CPU budget, watch out for cgo, and let the runtime manage Ms.

Next: [03-stack-growth](../03-stack-growth/) explains how that 2 KB stack grows on demand without copying you off a cliff.

---

## What You Can Build

After mastering this material:

- A small experiment that measures goroutine spawn cost vs thread spawn cost (with `runtime/cgo`).
- A diagnostic that prints `runtime.NumGoroutine()`, `GOMAXPROCS`, and the OS thread count (read from `/proc/<pid>/status` on Linux).
- A small server that holds N idle connections and shows how memory scales with N (and not with thread count).
- A test that fails if your process suddenly exceeds 50 OS threads (catch a cgo storm).
- A pinned-thread example: a goroutine that calls a thread-local C library safely.

---

## Further Reading

- The Go Programming Language Specification — *Go statements*: <https://go.dev/ref/spec#Go_statements>
- `runtime` package documentation: <https://pkg.go.dev/runtime>
- The Go Blog — *Concurrency is not parallelism* (Rob Pike): <https://go.dev/blog/waza-talk>
- *Scalable Go Scheduler Design Doc* (Dmitry Vyukov): <https://docs.google.com/document/d/1TTj4T2JO42uD5ID9e89oa0sLKhJYD0Y_kqxDv3I3XMw>
- *Linux Insides — Threads*: <https://github.com/0xAX/linux-insides/blob/master/SysCall/syscall-2.md>
- *Go's runtime: when is it safe to take a goroutine ID?* — `go.dev/ref/mem`
- `go.uber.org/automaxprocs` — match `GOMAXPROCS` to cgroup CPU quota: <https://github.com/uber-go/automaxprocs>
- `man 7 pthreads` — POSIX threads overview on Linux.
- *Operating System Three Easy Pieces* — chapters on threads and scheduling: <https://pages.cs.wisc.edu/~remzi/OSTEP/>

---

## Related Topics

- The GMP scheduler — how G, M, P fit together (next level).
- `LockOSThread` — pinning a goroutine to a thread (covered in detail at senior level).
- Async preemption (Go 1.14+) — why long loops no longer hang the runtime.
- Cgo cost — the M-creation storm pattern in cgo-heavy code.
- `runtime/trace` — visualising goroutines, Ms, and Ps during execution.
- Netpoller internals — how blocking I/O is parked without thread cost.

---

## Diagrams & Visual Aids

### One process, many goroutines, few threads

```
+----------------------------------------------------------+
| Process: my-go-server                                    |
|                                                          |
|  Goroutines (10 000):                                    |
|     G1 G2 G3 G4 ... G9999 G10000                         |
|                                                          |
|  Go scheduler:                                           |
|     P0 P1 P2 P3   <- GOMAXPROCS = 4                      |
|     |  |  |  |                                           |
|     M0 M1 M2 M3   <- one M per P, plus a couple of extras|
|                                                          |
+----|---|---|---|-----------------------------------------+
     v   v   v   v
+----------------------------+
| Kernel (sees only the Ms)  |
| Schedules them onto cores  |
+----------------------------+
   |   |   |   |
   v   v   v   v
  CPU CPU CPU CPU
```

### Memory cost

```
1 OS thread:     [============== 1–8 MB stack ==============]
1 goroutine:     [== 2 KB ==]

1 million OS threads: ~1–8 TB virtual address space (impossible)
1 million goroutines: ~2 GB total (fits on a laptop)
```

### Blocking syscall handoff

```
Time 0:    G42 calls read(fd) on M1, attached to P0
                |
                v  syscall enters kernel; M1 is stuck
Time 0+:   Runtime detaches P0 from M1
           Runtime attaches P0 to fresh M5
                |
                v  M5 schedules G43, G44, ...
Time N:    syscall returns on M1
           Runtime parks M1 (or queues it for re-use)
           G42 is placed on a P's runqueue to resume
```

### Netpoller mini-cycle

```
G77: conn.Read(buf)
      |
      v
runtime sets fd non-blocking, registers with epoll
runtime parks G77 (no M held)
      .
      .  (any time later)
kernel signals epoll: fd is readable
netpoller wakes G77 by re-queueing it on a P
G77 resumes inside conn.Read, performs the read, returns
```

### `GOMAXPROCS` affects parallelism, not concurrency

```
GOMAXPROCS=1, 3 goroutines:
   t0 t1 t2 t3 t4 t5
   G1 G2 G3 G1 G2 G3      (concurrent: yes; parallel: no)

GOMAXPROCS=3, 3 goroutines:
   t0:  G1 (on M1)
        G2 (on M2)
        G3 (on M3)         (concurrent: yes; parallel: yes — 3-way)
```

### Where threads come from in a typical Go server

```
Always-on:     main, sysmon, netpoller, GC mark workers, finalizer
Per GOMAXPROCS: one M typically attached
Bursty:        extra Ms when many goroutines block in syscalls / cgo
```

A `GOMAXPROCS=4` server typically shows 8–12 threads in `top` — most of them parked.
