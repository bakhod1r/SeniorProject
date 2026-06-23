---
layout: default
title: Runtime Internals — Junior
parent: Runtime Internals Used by Stdlib
grand_parent: Concurrency in Stdlib
ancestor: Go
nav_order: 2
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/23-concurrency-in-stdlib/04-runtime-internals/junior/
---

# Runtime Internals Used by Stdlib — Junior Level

[← Back](../)

## Table of Contents
1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [What Is the `runtime` Package?](#what-is-the-runtime-package)
5. [Why You Already Depend on the Runtime Without Knowing It](#why-you-already-depend-on-the-runtime-without-knowing-it)
6. [The Big Picture: Layers of the Stack](#the-big-picture-layers-of-the-stack)
7. [`runtime.Gosched` — Yielding to Other Goroutines](#runtimegosched--yielding-to-other-goroutines)
8. [`runtime.LockOSThread` and `runtime.UnlockOSThread`](#runtimelockosthread-and-runtimeunlockosthread)
9. [`runtime.SetFinalizer`](#runtimesetfinalizer)
10. [`runtime.Goexit`](#runtimegoexit)
11. [`runtime.GC`](#runtimegc)
12. [`runtime.NumGoroutine`, `NumCPU`, `GOMAXPROCS`](#runtimenumgoroutine-numcpu-gomaxprocs)
13. [`runtime.Stack` — Inspecting Goroutine Stacks](#runtimestack--inspecting-goroutine-stacks)
14. [`runtime.KeepAlive`](#runtimekeepalive)
15. [How `sync.Mutex` Talks to the Runtime (Sketch)](#how-syncmutex-talks-to-the-runtime-sketch)
16. [How `time.Sleep` Talks to the Runtime (Sketch)](#how-timesleep-talks-to-the-runtime-sketch)
17. [How `net.Conn.Read` Talks to the Runtime (Sketch)](#how-netconnread-talks-to-the-runtime-sketch)
18. [Code Examples](#code-examples)
19. [Real-World Analogies](#real-world-analogies)
20. [Mental Models](#mental-models)
21. [Coding Patterns](#coding-patterns)
22. [Clean Code](#clean-code)
23. [Error Handling](#error-handling)
24. [Performance Tips](#performance-tips)
25. [Best Practices](#best-practices)
26. [Edge Cases and Pitfalls](#edge-cases-and-pitfalls)
27. [Common Mistakes](#common-mistakes)
28. [Common Misconceptions](#common-misconceptions)
29. [Tricky Points](#tricky-points)
30. [Test](#test)
31. [Tricky Questions](#tricky-questions)
32. [Cheat Sheet](#cheat-sheet)
33. [Self-Assessment Checklist](#self-assessment-checklist)
34. [Summary](#summary)
35. [What You Can Build](#what-you-can-build)
36. [Further Reading](#further-reading)
37. [Related Topics](#related-topics)

---

## Introduction
> Focus: "What is the `runtime` package? Why does the standard library depend on it? Which helpers does it expose, and when should I reach for them?"

The Go standard library looks self-contained on the surface. You import `sync`, `time`, `net`, `os/signal`, `runtime/pprof`, and they all just work. But under the hood every single one of these packages is built on top of a small set of low-level helpers living in the `runtime` package. The same package gives you a handful of *exported* helpers — `runtime.Gosched`, `runtime.LockOSThread`, `runtime.SetFinalizer`, `runtime.GC`, `runtime.Stack`, `runtime.NumGoroutine`, `runtime.Goexit` — that you can call directly from your code when you need to cooperate with the runtime more closely than the higher-level packages allow.

This file teaches you the *vocabulary* and the *intuition* for these helpers. We are not yet diving into the source code; that is `middle.md` and `senior.md`. We are establishing answers to these questions:

1. What is the **`runtime` package**, and how does it differ from the rest of the standard library?
2. What does each of the major exported helpers do, and *when* would I call it?
3. Which stdlib packages use which runtime helpers under the hood?
4. What kinds of bugs are caused by misuse of these helpers?
5. How do I think about the boundary between "user code" and "runtime code"?

After reading this file you should be able to:
- Explain in plain English what `Gosched`, `LockOSThread`, `SetFinalizer`, `Goexit`, `GC`, `Stack`, and `KeepAlive` do.
- Decide when a problem calls for `LockOSThread` versus when it does not.
- Write a goroutine that uses `SetFinalizer` correctly and explain why a closure-based finalizer would be wrong.
- Read a goroutine dump and identify the state of each goroutine.
- Look at `sync.Mutex.Lock()` in your code and visualise the chain of calls that eventually reaches the runtime.

You will *not* yet know the source-code-level details of `gopark`, `goready`, `note`, or `sema`. That is `middle.md`. You will *not* yet know how the netpoller, timer wheel, or race detector hook into the runtime. That is `senior.md`.

---

## Prerequisites

- **Required.** Comfort with goroutines and `go` keyword.
- **Required.** Experience writing code with `sync.Mutex` and `sync.WaitGroup`.
- **Required.** Familiarity with `defer`.
- **Required.** Awareness that goroutines are *not* the same as OS threads: many goroutines share each thread.
- **Helpful.** Some exposure to `pprof` or the `net/http/pprof` import.
- **Helpful.** A rough idea of what garbage collection does in Go (frees memory you no longer reference).

You do *not* need to know:
- The internal scheduler (M/P/G data structures).
- The Go memory model in detail.
- Hardware memory barriers — that is section 22.
- Cgo or assembly.

If you can write `go func() { ... }()` and use `sync.WaitGroup` to wait for it, you are ready.

---

## Glossary

| Term | Definition |
|------|-----------|
| **`runtime` package** | The standard library package containing low-level runtime support. Some functions are exported (`runtime.Gosched`, `runtime.GC`); many internal functions are accessible via `go:linkname`. |
| **Goroutine (G)** | A user-space lightweight thread managed by the Go runtime. Cheap to create; a typical Go program has hundreds to millions of goroutines. |
| **OS thread (M)** | A real operating-system thread. Goroutines are multiplexed on a small pool of OS threads. |
| **Processor (P)** | A scheduling slot. The number of Ps equals `GOMAXPROCS`. Each P runs one goroutine at a time on one M. |
| **Run queue** | A FIFO of runnable goroutines waiting for a P. There is one local queue per P and one global queue. |
| **Park / Unpark** | Internal verbs for moving a goroutine off and back onto a run queue. `gopark` parks; `goready` unparks. |
| **Yield** | Voluntarily give up the CPU. `runtime.Gosched` is the public yield. |
| **Finalizer** | A function the GC runs when an unreachable object is about to be freed. Registered via `runtime.SetFinalizer`. |
| **STW** | Stop-the-world. A brief pause where all goroutines are halted. Required for some GC phases and `runtime.Stack(buf, true)`. |
| **Netpoller** | The runtime's I/O multiplexer. Wraps `epoll` on Linux, `kqueue` on BSD/macOS, IOCP on Windows. Drives blocking `net.Conn.Read`/`Write`. |
| **Sysmon** | A special goroutine that runs without a P. Polls the netpoller, forces preemption of long-running goroutines, triggers GC. |
| **Cgo** | The mechanism for calling C code from Go. Has thread-affinity implications via `LockOSThread`. |
| **Block profile** | A pprof profile recording where goroutines spend time blocked on synchronization. Enabled with `runtime.SetBlockProfileRate`. |
| **Mutex profile** | A pprof profile recording mutex contention. Enabled with `runtime.SetMutexProfileFraction`. |
| **Race detector** | Compile-time instrumentation (`-race`) that detects data races at run time. Uses callbacks from the runtime to ThreadSanitizer. |
| **`go:linkname`** | A compiler directive that lets one package call an unexported function in another package by linking names. The stdlib uses it to access internal `runtime` functions without making them public API. |
| **Preemption** | Forcing a goroutine to yield its CPU even if it does not call any runtime function. Since Go 1.14, done via signals (`SIGURG`). |

---

## What Is the `runtime` Package?

The `runtime` package is the **lowest layer of the Go standard library** that is still callable from user code. It implements:

- The goroutine scheduler (M/P/G model).
- Memory allocation (`mallocgc`).
- The garbage collector (`mgc`, `mgcsweep`, `mgcmark`).
- Channels (`chan`).
- The netpoller for I/O multiplexing.
- The timer subsystem.
- Signal handling.
- Profiling support (CPU profile, heap profile, block profile).
- Tracing support (`runtime/trace`).
- Stack management (growable stacks, defer chain, panic propagation).

Most of this machinery is internal. The user-callable surface — what you see when you read `pkg.go.dev/runtime` — is small:

```
runtime.GOMAXPROCS
runtime.GC
runtime.Goexit
runtime.Gosched
runtime.LockOSThread
runtime.UnlockOSThread
runtime.NumCPU
runtime.NumGoroutine
runtime.SetFinalizer
runtime.SetBlockProfileRate
runtime.SetCPUProfileRate
runtime.SetMutexProfileFraction
runtime.Stack
runtime.KeepAlive
runtime.Pinner       (Go 1.21+)
runtime.MemProfileRate
runtime.MemStats / ReadMemStats
runtime.Caller, Callers, FuncForPC  (stack inspection)
runtime.NumCgoCall
runtime.Goroutine status helpers
```

A larger pile of `runtime` functions is *unexported* but accessible from other stdlib packages via `go:linkname`. Examples you will encounter:

```
runtime_Semacquire / runtime_Semrelease   — used by sync.Mutex, sync.WaitGroup
runtime_procPin / runtime_procUnpin       — used by sync.Pool
runtime_canSpin / runtime_doSpin          — used by sync.Mutex
runtime_nanotime                          — used by time
runtime_notifyListWait / NotifyOne / NotifyAll  — used by sync.Cond
runtime_pollOpen / pollWait / pollClose   — used by internal/poll (used by net, os)
```

These are *not* part of the public API. They can change between Go versions. Stdlib uses them; user code is expected not to.

### Why is the runtime not a regular package?

A regular Go package is compiled with the same conventions as user code: stack growth, GC barriers, scheduler safepoints. The runtime *implements* those mechanisms, so it has to operate beneath them. The runtime is special-cased by the compiler in several ways:

- It can be marked `//go:nosplit` to disable stack-growth checks.
- It can be marked `//go:nowritebarrier` to disable GC write barriers.
- It can write inline assembly in `.s` files for platform-specific operations.
- It has access to the compiler's internal types like `g`, `m`, `p` (in `runtime/runtime2.go`).

For day-to-day programming you do not need to know any of this. You just need to know that the helpers in the `runtime` package give you a controlled way to interact with the layer that everything else runs on.

---

## Why You Already Depend on the Runtime Without Knowing It

Every line of concurrent Go you have ever written has called into the runtime. A short list:

| Your code | Stdlib package | Runtime function ultimately called |
|-----------|----------------|------------------------------------|
| `go f()` | language | `runtime.newproc` |
| `ch <- v` | language | `runtime.chansend` |
| `<-ch` | language | `runtime.chanrecv` |
| `select { case ... }` | language | `runtime.selectgo` |
| `mu.Lock()` | sync | `runtime_SemacquireMutex` |
| `wg.Wait()` | sync | `runtime_SemacquireWaitGroup` |
| `time.Sleep(d)` | time | `runtime.timeSleep` -> `gopark` |
| `time.After(d)` | time | `runtime.timeSleep` |
| `conn.Read(buf)` | net | `runtime_pollWait` -> `gopark` |
| `os.Open("file")` | os | syscall + finalizer registration |
| `pool.Get()` | sync | `runtime_procPin` |
| `wg.Done()` | sync | `atomic` (only the slow path enters runtime) |

In other words, the runtime is the operating system of your goroutines. The stdlib types you import are just nice typed wrappers around runtime primitives. Once you understand this layering, the question "why is my goroutine doing X?" becomes "what runtime function is it parked in?", and the goroutine dump answers immediately.

---

## The Big Picture: Layers of the Stack

A useful mental picture:

```
+------------------------------------------------------+
|  Your program                                        |
|    go f();   ch <- v;   mu.Lock();   conn.Read()     |
+------------------------------------------------------+
|  Standard library packages (typed wrappers)          |
|    sync.Mutex, sync.WaitGroup, time.Timer, net.Conn  |
+------------------------------------------------------+
|  runtime/internal helpers (go:linkname'd)            |
|    semacquire, gopark, goready, notesleep,           |
|    pollOpen, procPin, timeSleep                      |
+------------------------------------------------------+
|  runtime package (scheduler, GC, netpoll, signals)   |
|    schedule, findrunnable, mallocgc, sysmon          |
+------------------------------------------------------+
|  OS abstractions                                     |
|    futex (Linux), Mach semaphores (macOS),           |
|    epoll/kqueue/IOCP, pthread, signals               |
+------------------------------------------------------+
|  Hardware                                            |
|    CPU cores, caches, memory, NICs                   |
+------------------------------------------------------+
```

When you write `mu.Lock()`, you cross all of these layers. When you write `runtime.Gosched()`, you skip the second layer and talk directly to the third (and through it, the fourth).

---

## `runtime.Gosched` — Yielding to Other Goroutines

```go
func Gosched()
```

**What it does.** Yields the current goroutine. The current goroutine is removed from its P, added to the back of the local run queue, and the scheduler picks another runnable goroutine on the same P. The yielding goroutine stays `_Grunnable` — it is not blocked, just placed at the back of the queue.

**When to use it.**

Historically — before Go 1.14 — `Gosched` was used to make tight CPU loops *cooperative*:

```go
// Pre-1.14
for !done.Load() {
    runtime.Gosched()
}
```

Before 1.14, the scheduler could only preempt at function-call safepoints. A tight loop without function calls would never be preempted, starving every other goroutine on the same P. `Gosched` inserted an explicit safepoint.

Since Go 1.14, **asynchronous preemption** uses signals (`SIGURG` on Linux) to preempt even loops with no function calls. Manual `Gosched` is rarely needed in modern Go. The exceptions:

1. **Benchmarks** — when you specifically want to insert a yield to give other goroutines a chance.
2. **Spin loops where you know you cannot block but want to be polite.** Even then, a real wait (channel receive, mutex `Lock`, `sync.Cond.Wait`) is almost always better than spinning + `Gosched`.

**What `Gosched` is not.**

- It is not `sleep`. The goroutine stays runnable; it does not wait for a duration.
- It is not `unlock and yield`. It does not release any mutex you are holding.
- It is not a blocking operation. The goroutine cannot park in `Gosched` — it always returns immediately when the scheduler picks it again.

**Example: when `Gosched` makes a visible difference (pre-1.14 style).**

```go
package main

import (
    "fmt"
    "runtime"
    "sync"
    "time"
)

func main() {
    runtime.GOMAXPROCS(1)
    var wg sync.WaitGroup

    wg.Add(1)
    go func() {
        defer wg.Done()
        // CPU-bound loop with no function calls
        for i := 0; i < 1<<30; i++ {
            // do nothing
        }
        fmt.Println("loop done")
    }()

    time.Sleep(100 * time.Millisecond)
    fmt.Println("main running")
    wg.Wait()
}
```

On Go 1.14+, "main running" prints almost immediately because async preemption interrupts the loop. On Go 1.13 it would not print until the loop finished (or maybe forever, depending on optimizations).

Adding `runtime.Gosched()` inside the loop makes it cooperative even on old Go:

```go
for i := 0; i < 1<<30; i++ {
    if i%1000 == 0 {
        runtime.Gosched()
    }
}
```

**Source pointer.** `runtime/proc.go` `Gosched` and `Gosched_m`.

---

## `runtime.LockOSThread` and `runtime.UnlockOSThread`

```go
func LockOSThread()
func UnlockOSThread()
```

**What they do.** `LockOSThread` pins the current goroutine to its current OS thread. Until you call `UnlockOSThread` the same number of times (or the goroutine exits), the goroutine runs *only* on that thread, and the thread runs *no other* goroutines.

**Why you would want this.** Some OS-level state is *per-thread*, not per-process:

- **Signal masks** on Linux are per-thread.
- **OpenGL contexts** are per-thread (`glXMakeCurrent` binds a context to the current thread).
- **GUI main loops on macOS** must run on the original main thread.
- **`setuid`, `seteuid`, `setresuid`** on Linux are per-thread, not per-process.
- **`pthread_setspecific` data** is per-thread.
- **OpenSSL error queue** on some versions is per-thread.

If your goroutine sets per-thread state, makes a Go call, and then makes another C call expecting the state to be there, but in between the Go runtime moved the goroutine to a different OS thread — your state is gone (or worse, you see another goroutine's state).

`LockOSThread` says "I need this OS thread for the duration of this goroutine's work."

**Example: a dedicated OpenGL worker.**

```go
package main

import (
    "runtime"
)

func glWorker(commands <-chan func()) {
    runtime.LockOSThread()
    defer runtime.UnlockOSThread()

    // initialize OpenGL context on this thread
    glInit()

    for cmd := range commands {
        cmd() // runs on the same OS thread
    }

    glShutdown()
}

func main() {
    cmds := make(chan func())
    go glWorker(cmds)

    // any goroutine can submit GL work via cmds; it always runs on the dedicated thread
    cmds <- func() { glClear() }
    cmds <- func() { glDrawArrays(...) }
    close(cmds)
}
```

This pattern — a dedicated goroutine pinned to a thread, fed by a channel — is the standard way to serve C libraries that need thread affinity. Any goroutine can request work via the channel; the dedicated goroutine handles it on the right thread.

**Counting and balancing.**

`LockOSThread` is reference-counted per goroutine. If you call it three times, you must call `UnlockOSThread` three times. The standard pattern is:

```go
runtime.LockOSThread()
defer runtime.UnlockOSThread()
```

**What happens if a locked goroutine exits without unlocking?**

The Go runtime *terminates the OS thread*. The thread is not returned to the pool of available Ms. This is sometimes what you want — a dedicated worker that is born locked to a thread and dies with it — but it is wasteful if the goroutine was meant to be short-lived.

**`init` and the main goroutine.**

The main goroutine starts on the initial OS thread. Calling `LockOSThread` from an `init` function pins the main goroutine to that thread for the lifetime of the program, which has subtle implications:

- The main goroutine cannot migrate.
- Signal handlers running on the main thread interact differently.
- Some macOS APIs require this — the main thread is the "main thread" for AppKit, so a GUI program often calls `LockOSThread` from `init`.

**Caveats.**

- `LockOSThread` reduces parallelism. A locked M cannot serve other goroutines.
- Long-running locked goroutines can exhaust the OS thread budget (default 10000).
- A goroutine that is locked cannot be preempted by another goroutine wanting the same M — but it can still be preempted by async preemption for GC.

**Source pointer.** `runtime/proc.go` `LockOSThread`, `UnlockOSThread`, `dolockOSThread`.

---

## `runtime.SetFinalizer`

```go
func SetFinalizer(obj any, finalizer any)
```

**What it does.** Associates a finalizer function with `obj`. When the garbage collector finds `obj` unreachable, it:

1. Clears the association (`obj` no longer has a finalizer).
2. Queues `finalizer(obj)` to be run on a dedicated goroutine.
3. Marks `obj` reachable again (because the finalizer holds a reference).
4. After the finalizer runs and `obj` becomes unreachable a *second* time, the GC frees it.

So an object with a finalizer survives one extra GC cycle.

**Calling conventions.**

- `obj` must be a pointer to an object allocated by `new`, `&Literal{}`, or `&localVar`. It cannot be a value type.
- `finalizer` must be a function whose single parameter type is assignable from the type of `obj`.

```go
type Resource struct{ fd int }

r := &Resource{fd: 42}
runtime.SetFinalizer(r, func(p *Resource) {
    closeFd(p.fd)
})
```

**When to use a finalizer.**

The honest answer is: **almost never as a primary cleanup mechanism.** The Go documentation discourages it. Use `defer` and explicit `Close` methods. Finalizers are appropriate for:

1. **Warning about leaks.** `os.File` has a finalizer that warns if `Close` was never called.
2. **C resources where Go cannot enforce cleanup.** Memory allocated by `malloc` in a C library that the Go side wraps in a struct.
3. **GUI / system handles that must never leak even if the user forgets.**

**Calling `SetFinalizer` correctly.**

The single most common bug with `SetFinalizer` is using a *closure* that captures the object:

```go
// BUG: closure captures r
runtime.SetFinalizer(r, func(_ *Resource) {
    cleanup(r.fd)
})
```

This is a self-referential cycle through the finalizer table. `r` is referenced by the closure, the closure is referenced by the finalizer table, the finalizer table is rooted by the runtime. `r` is *never* unreachable, so the finalizer never runs.

The fix: use the parameter, not the captured variable.

```go
// OK
runtime.SetFinalizer(r, func(p *Resource) {
    cleanup(p.fd)
})
```

A method value with `r` as the receiver has the same problem:

```go
// BUG: method value holds a hidden pointer to r
runtime.SetFinalizer(r, r.Cleanup)

// OK: explicit function takes the receiver as a parameter
runtime.SetFinalizer(r, (*Resource).Cleanup)
```

**Removing a finalizer.**

```go
runtime.SetFinalizer(obj, nil)
```

Clears any finalizer associated with `obj`. Useful in `Close` methods: once the resource is explicitly closed, unregister the finalizer so it doesn't run later.

```go
func (r *Resource) Close() error {
    if r.closed {
        return nil
    }
    r.closed = true
    runtime.SetFinalizer(r, nil)
    return doClose(r.fd)
}
```

**Timing guarantees.**

- Finalizers do not run in any particular order across objects.
- Finalizers run on a dedicated goroutine; if one blocks, all subsequent finalizers wait.
- Finalizers may run a long time after the object becomes unreachable, or never (e.g., if the program exits before a GC cycle).
- Finalizers are not called when the program exits.

**Source pointer.** `runtime/mfinal.go`.

---

## `runtime.Goexit`

```go
func Goexit()
```

**What it does.** Terminates the calling goroutine after running all deferred functions.

`Goexit` is more aggressive than `return`. It unwinds the entire goroutine, running every `defer` at every level, then ends the goroutine. The main goroutine calling `Goexit` does *not* exit the program; instead the runtime panics with `"no goroutines (main called runtime.Goexit) - deadlock!"` if no other goroutines remain.

**Why does this exist?**

Primarily for `testing`. When you call `t.Fatal` inside a deeply nested call, `testing.T.FailNow` calls `Goexit`. This unwinds all defers (test cleanup), then ends the test goroutine. Without `Goexit`, `FailNow` would have to either `panic` (which would kill the test binary) or set a flag and rely on every layer to check it.

**Example: test cleanup.**

```go
func helper(t *testing.T) {
    f, err := os.Open("data")
    if err != nil {
        t.Fatal(err) // calls Goexit eventually
    }
    defer f.Close() // runs before the goroutine exits
    // ...
}
```

If `t.Fatal` is called, the deferred `f.Close()` still runs.

**When you might want `Goexit` in non-test code.**

Rarely. One legitimate use is unwinding from a goroutine you spawned for a single task: `Goexit` ensures all defers run cleanly. But `return` does the same thing as long as you return from the *top* function. `Goexit` is only useful if you want to exit *from deep inside* without propagating an error all the way up.

**`recover` and `Goexit`.**

`Goexit` is *not* a panic. `recover` in a deferred function returns `nil`. The goroutine ends regardless of `recover`.

```go
defer func() {
    if r := recover(); r != nil {
        log.Println("recovered:", r)
    }
}()
runtime.Goexit() // recover returns nil; goroutine still ends
```

**Source pointer.** `runtime/panic.go` `Goexit`, `runtime/proc.go` `goexit0`.

---

## `runtime.GC`

```go
func GC()
```

**What it does.** Triggers a garbage collection cycle and blocks until it completes.

The Go GC runs *concurrently* with user code most of the time, but has some stop-the-world phases:

1. **Mark setup** — brief STW to install write barriers.
2. **Concurrent mark** — runs in parallel with user code.
3. **Mark termination** — brief STW to finalize marking.
4. **Concurrent sweep** — runs in parallel with user code.

`runtime.GC()` causes the runtime to:
- Schedule a GC cycle to start now.
- Wait for it to reach the end of mark termination.

The function returns when the heap is cleaned up.

**When to use `runtime.GC()`.**

- **Tests and benchmarks** — between benchmark iterations to reduce variance.
- **Diagnostics** — to force finalizers to run before checking for leaks.
- **One-shot batch jobs** — after a large workload, force a sweep before measuring memory.

**When NOT to use it.**

- In any hot path. Each `GC()` call is expensive.
- "To be tidy" between operations. The GC is already smart; it runs when needed.
- To "reduce memory usage" without measuring. Use `GOMEMLIMIT` instead.

**Source pointer.** `runtime/mgc.go` `GC`.

---

## `runtime.NumGoroutine`, `NumCPU`, `GOMAXPROCS`

```go
func NumGoroutine() int
func NumCPU() int
func GOMAXPROCS(n int) int
```

**`NumGoroutine`.** Returns the total number of goroutines currently in existence. The read is racy (the value can change before you use it) but the read itself is safe.

Use cases:
- Quick health check on a metrics endpoint.
- Detect leaks ("at startup we had 10, now we have 100k").

**`NumCPU`.** Returns the number of logical CPUs visible to the process at startup. Static — does not change at runtime, even if you change cgroup limits.

**`GOMAXPROCS`.** Reads or sets the maximum number of Ps. Default is `NumCPU()`. Calling with 0 returns the current setting without changing it.

```go
runtime.GOMAXPROCS(4)        // set to 4
prev := runtime.GOMAXPROCS(0) // read current
```

Setting `GOMAXPROCS` higher than `NumCPU` typically hurts (more context switching, more cache thrashing). Setting it lower can be useful to limit parallelism in resource-constrained environments. For containerized Go services, libraries like `automaxprocs` set it to match the cgroup CPU quota.

---

## `runtime.Stack` — Inspecting Goroutine Stacks

```go
func Stack(buf []byte, all bool) int
```

**What it does.** Writes a textual representation of stack traces into `buf`. If `all` is false, only the current goroutine; if true, all goroutines (with STW).

**Format.** Each goroutine looks like:

```
goroutine 7 [chan receive, 2 minutes]:
github.com/example/foo.consume(0xc0000a4000)
    /home/user/go/foo/foo.go:42 +0xa0
created by github.com/example/foo.Start
    /home/user/go/foo/foo.go:18 +0x12c
```

- First line: id, status, optional duration.
- Stack frames in order from innermost to outermost.
- "created by" shows where the goroutine was spawned.

**When to use it.**

- Inside a panic handler to dump all goroutines.
- On a debug-only HTTP endpoint.
- In response to a signal (SIGUSR1).

**Cost.** With `all=true`, the runtime calls `stopTheWorld("runtime.Stack")` for the duration of the dump. On a busy server with 10k goroutines this can pause everything for hundreds of milliseconds.

For routine monitoring, use `runtime.NumGoroutine()` (no STW) and only call `runtime.Stack(buf, true)` on demand.

---

## `runtime.KeepAlive`

```go
func KeepAlive(x any)
```

**What it does.** Marks `x` as currently reachable. The compiler is otherwise free to drop a variable from the live set as soon as it can prove no further use, which can let the GC reclaim the object early — even before the function that allocated it has returned.

This matters with `unsafe.Pointer`, cgo, and other low-level interop:

```go
func cWork(p *MyStruct) {
    cBuf := unsafe.Pointer(p)
    C.useBuffer(cBuf)
    // without KeepAlive, the GC might think p is dead here
    runtime.KeepAlive(p)
}
```

Why does the GC think `p` is dead? Because after `cBuf` is computed, `p` itself is no longer used by Go. The compiler may remove `p` from the live set. The Go runtime doesn't know that `C.useBuffer` still has a pointer derived from it.

`KeepAlive(p)` is a no-op at run time but tells the compiler "the value `p` is still alive as of this line." It is your way to extend the live range manually.

---

## How `sync.Mutex` Talks to the Runtime (Sketch)

To make the runtime concrete, here is a sketch of what happens when you call `mu.Lock()`. We use a simplified view; the real implementation is in `src/sync/mutex.go` and `src/runtime/sema.go`.

```go
type Mutex struct {
    state int32   // bit field: locked + waiter count + starving flag + woken flag
    sema  uint32  // semaphore for waiters
}

func (m *Mutex) Lock() {
    // Fast path: CAS state from 0 (unlocked, no waiters) to mutexLocked (1).
    if atomic.CompareAndSwapInt32(&m.state, 0, mutexLocked) {
        return
    }
    // Slow path
    m.lockSlow()
}

func (m *Mutex) lockSlow() {
    // 1. Spin a few times (only on multi-core, only if no other waiters).
    // 2. Set the "waiting" bit in state.
    // 3. Block on the semaphore: runtime_SemacquireMutex(&m.sema, ...)
    //    This calls into runtime/sema.go semacquire1, which:
    //      - allocates a sudog (a small struct representing the waiter)
    //      - links the sudog into a treap keyed by &m.sema
    //      - calls gopark to put the goroutine in _Gwaiting state
    // 4. When woken, re-check state and try again.
}

func (m *Mutex) Unlock() {
    // Atomically clear locked bit.
    new := atomic.AddInt32(&m.state, -mutexLocked)
    if new == 0 {
        return // no waiters
    }
    m.unlockSlow(new)
}

func (m *Mutex) unlockSlow(new int32) {
    // Wake one waiter via runtime_Semrelease(&m.sema, ...)
    //   - find the sudog at &m.sema in the treap
    //   - remove it
    //   - call goready to mark the waiter _Grunnable
    //   - put it on the local run queue of some P
}
```

What you need to internalize:

1. **The fast path is one CAS, no runtime call.** Uncontended mutex Lock/Unlock is essentially free.
2. **The slow path goes through the runtime.** When contention happens, the goroutine `gopark`s — leaves the run queue — and waits.
3. **The waker calls `goready`** to put the waiter back on a run queue.
4. **The semaphore is keyed by address.** Multiple mutexes share one global treap, keyed by the address of `m.sema`.

We will revisit this in `middle.md` with source line references.

---

## How `time.Sleep` Talks to the Runtime (Sketch)

```go
func Sleep(d Duration) {
    // calls runtime.timeSleep(int64(d))
}

// In runtime/time.go (sketch):
func timeSleep(ns int64) {
    if ns <= 0 { return }
    t := acquireTimer()
    t.when = nanotime() + ns
    t.f = goroutineReady    // function called when timer fires
    t.arg = getg()          // the goroutine to wake
    addTimer(t)              // insert into the per-P timer heap
    gopark(/*reason: sleep*/)// suspend until t.f runs
}

func goroutineReady(arg any, _ uintptr) {
    goready(arg.(*g), 0)
}
```

The per-P timer heap is checked:
- At every scheduler iteration (`runtime.checkTimers`).
- By `sysmon` periodically.
- By `runtime.netpoll` when waiting for I/O.

When the timer's `when` is in the past, the heap pops it and runs `t.f`. `goready` puts the sleeping goroutine back on a run queue, and the next time a P is free, the goroutine resumes after `time.Sleep`.

---

## How `net.Conn.Read` Talks to the Runtime (Sketch)

```go
func (c *Conn) Read(buf []byte) (int, error) {
    // calls internal/poll.FD.Read
}

// In internal/poll/fd_unix.go (sketch):
func (fd *FD) Read(buf []byte) (int, error) {
    for {
        n, err := syscall.Read(fd.Sysfd, buf)
        if err == syscall.EAGAIN || err == syscall.EWOULDBLOCK {
            // fd would block; wait for it
            if err := fd.pd.waitRead(); err != nil {
                return 0, err
            }
            continue
        }
        return n, err
    }
}

func (pd *pollDesc) waitRead() error {
    return runtime_pollWait(pd.runtimeCtx, 'r')
}

// In runtime/netpoll.go (sketch):
func pollWait(ctx uintptr, mode int) int {
    pd := (*pollDesc)(unsafe.Pointer(ctx))
    // record this G as a reader
    pd.rg = gp
    gopark(/*reason: IO wait*/)
    return 0
}
```

The netpoller (epoll on Linux) is checked:
- By `sysmon` when no Ps are available.
- By any P during `findrunnable` when it has no local work.

When `epoll_wait` returns an fd ready for read, `runtime.netpoll` looks up the `pollDesc`, finds the parked goroutine in `pd.rg`, and calls `goready` on it.

---

## Code Examples

### Example 1 — Yielding in a benchmark setup

```go
func warmup() {
    // do some priming work
    for i := 0; i < 1<<20; i++ {
        _ = i * i
        if i%100000 == 0 {
            runtime.Gosched() // give other goroutines a chance
        }
    }
}
```

### Example 2 — A cgo worker

```go
package main

/*
#include <stdio.h>
void say_hi(int n) {
    printf("hi %d from thread\n", n);
}
*/
import "C"

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
        for i := 0; i < 5; i++ {
            C.say_hi(C.int(i))
        }
    }()

    wg.Wait()
    fmt.Println("done")
}
```

### Example 3 — Finalizer leak warning

```go
type Conn struct {
    id     int
    closed bool
}

func newConn(id int) *Conn {
    c := &Conn{id: id}
    runtime.SetFinalizer(c, func(p *Conn) {
        if !p.closed {
            fmt.Printf("warning: Conn %d not closed\n", p.id)
        }
    })
    return c
}

func (c *Conn) Close() {
    c.closed = true
    runtime.SetFinalizer(c, nil)
}
```

### Example 4 — Goexit-aware test helper

```go
func mustOpen(t *testing.T, path string) *os.File {
    t.Helper()
    f, err := os.Open(path)
    if err != nil {
        t.Fatal(err) // runs Goexit, but defers in t.Cleanup still execute
    }
    t.Cleanup(func() { f.Close() })
    return f
}
```

### Example 5 — Periodic GC for a batch tool

```go
func processBatch(items []Item) {
    for i, it := range items {
        process(it)
        if i%1000 == 999 {
            runtime.GC() // explicit cleanup every 1000 items
        }
    }
}
```

### Example 6 — Dump goroutines on signal

```go
func init() {
    c := make(chan os.Signal, 1)
    signal.Notify(c, syscall.SIGUSR1)
    go func() {
        for range c {
            buf := make([]byte, 1<<20)
            n := runtime.Stack(buf, true)
            os.Stderr.Write(buf[:n])
        }
    }()
}
```

### Example 7 — KeepAlive across cgo

```go
type Buffer struct {
    data []byte
}

func cProcess(b *Buffer) {
    p := unsafe.Pointer(&b.data[0])
    C.process(p, C.size_t(len(b.data)))
    runtime.KeepAlive(b) // ensure b is not freed before C is done
}
```

### Example 8 — Reading runtime stats

```go
func logStats() {
    var m runtime.MemStats
    runtime.ReadMemStats(&m)
    fmt.Printf("goroutines=%d  heap=%dMB  next_gc=%dMB  num_gc=%d\n",
        runtime.NumGoroutine(),
        m.HeapAlloc>>20,
        m.NextGC>>20,
        m.NumGC,
    )
}
```

### Example 9 — Pin OS thread for the entire program

```go
func init() {
    // On macOS, the main thread is sacred for AppKit
    runtime.LockOSThread()
}
```

### Example 10 — Wait for finalizer to run (testing)

```go
func TestFinalizer(t *testing.T) {
    ran := make(chan struct{})
    obj := new(struct{})
    runtime.SetFinalizer(obj, func(_ *struct{}) { close(ran) })

    obj = nil
    for i := 0; i < 10; i++ {
        runtime.GC()
        select {
        case <-ran:
            return
        default:
        }
    }
    t.Fatal("finalizer never ran")
}
```

### Example 11 — Cleanly stopping a `LockOSThread` worker

```go
func worker(ctx context.Context) {
    runtime.LockOSThread()
    defer runtime.UnlockOSThread()

    setupThreadLocal()
    defer teardownThreadLocal()

    <-ctx.Done()
}
```

### Example 12 — `Goexit` ends a goroutine but not the program

```go
package main

import (
    "fmt"
    "runtime"
    "time"
)

func main() {
    go func() {
        defer fmt.Println("worker defer")
        runtime.Goexit()
        fmt.Println("never printed")
    }()

    time.Sleep(100 * time.Millisecond)
    fmt.Println("main continues")
}
```

Output:
```
worker defer
main continues
```

### Example 13 — Counting goroutines for a leak test

```go
func TestNoLeak(t *testing.T) {
    before := runtime.NumGoroutine()
    workload()
    time.Sleep(50 * time.Millisecond) // let goroutines exit
    runtime.GC()
    after := runtime.NumGoroutine()
    if after > before+1 {
        t.Errorf("leaked goroutines: before=%d after=%d", before, after)
    }
}
```

(Better: use `go.uber.org/goleak` which handles flakiness.)

### Example 14 — Adjusting GOMAXPROCS at startup

```go
func init() {
    // Use 2 fewer than detected, leaving headroom for sidecars
    n := runtime.NumCPU() - 2
    if n < 1 {
        n = 1
    }
    runtime.GOMAXPROCS(n)
}
```

### Example 15 — Print all goroutines on panic

```go
func mainRecover() {
    defer func() {
        if r := recover(); r != nil {
            buf := make([]byte, 1<<20)
            n := runtime.Stack(buf, true)
            fmt.Fprintf(os.Stderr, "panic: %v\n%s\n", r, buf[:n])
            panic(r) // re-raise so the program exits with the trace
        }
    }()
    realMain()
}
```

---

## Real-World Analogies

**The runtime as the operating system of your goroutines.** Goroutines are processes; OS threads are CPUs; the runtime is the OS that schedules processes onto CPUs. `runtime.Gosched` is `sched_yield`. `LockOSThread` is `sched_setaffinity`. `Stack(buf, true)` is `ps -ef`.

**Finalizers as expiration dates.** You stick a date on a yogurt container. When you eventually clean out the fridge, you discard expired items. The yogurt sits in the fridge until cleanup happens; cleanup doesn't happen on a schedule, only when you happen to look.

**`Goexit` as the emergency exit.** A normal exit is walking to the door. `panic` is the fire alarm. `Goexit` is the emergency exit: you skip levels, run sprinklers (defers), and leave the building. The rest of the building (program) continues.

**`LockOSThread` as the reserved table.** Some restaurants reserve specific tables for specific guests (per-thread state). Once you sit down (lock), the host (runtime) keeps that table for you and no one else uses it. You leave (unlock) when done.

**Block profile as the traffic camera.** A camera at every intersection records every car that waited. After an hour you can see which intersections cause traffic. The cameras add a small overhead, so you only turn them on when investigating.

---

## Mental Models

**The runtime is the bedrock.** Every goroutine sits on top of it. Every concurrent primitive in stdlib is a typed wrapper over runtime primitives.

**The "park / unpark" model.** Every blocking primitive in Go works the same way: the goroutine calls `gopark`, going from `_Grunning` to `_Gwaiting`. The thing that unblocks it calls `goready`, going from `_Gwaiting` to `_Grunnable`. The scheduler eventually moves it to `_Grunning` on some P.

**Reads are cheap; writes are expensive.** `NumGoroutine` is a cheap atomic load. `Stack(buf, true)` is an STW. Pick the cheaper option when the cheap one tells you what you need.

**Profile rates trade overhead for fidelity.** `SetBlockProfileRate(1)` records every event; expensive. `SetBlockProfileRate(1000)` records ~1/1000; cheap. Start cheap.

**Finalizers run later, on another goroutine, in unspecified order.** Treat them as best-effort warnings, not as primary cleanup.

---

## Coding Patterns

### Pattern 1: cgo worker channel

```go
type cgoRequest struct {
    arg     int
    respond chan int
}

func cgoWorker(reqs <-chan cgoRequest) {
    runtime.LockOSThread()
    defer runtime.UnlockOSThread()

    for r := range reqs {
        result := callC(r.arg)
        r.respond <- result
    }
}
```

### Pattern 2: explicit close + finalizer warning

```go
type Resource struct {
    closed atomic.Bool
}

func (r *Resource) Close() error {
    if !r.closed.CompareAndSwap(false, true) {
        return nil
    }
    runtime.SetFinalizer(r, nil)
    return doClose(r)
}

func New() *Resource {
    r := &Resource{}
    runtime.SetFinalizer(r, func(p *Resource) {
        if !p.closed.Load() {
            log.Printf("LEAK: Resource %p was never Closed", p)
        }
    })
    return r
}
```

### Pattern 3: dump-on-signal

```go
func InstallDumpHandler() {
    c := make(chan os.Signal, 1)
    signal.Notify(c, syscall.SIGUSR1)
    go func() {
        for range c {
            dumpStacks()
        }
    }()
}

func dumpStacks() {
    buf := make([]byte, 1<<20)
    for {
        n := runtime.Stack(buf, true)
        if n < len(buf) {
            os.Stderr.Write(buf[:n])
            return
        }
        buf = make([]byte, 2*len(buf))
    }
}
```

### Pattern 4: GC at the end of a batch

```go
func batch(items []Item) {
    debug.SetGCPercent(-1) // disable auto-GC
    defer debug.SetGCPercent(100)
    for _, it := range items {
        process(it)
    }
    runtime.GC() // one big sweep at the end
}
```

### Pattern 5: leak-detect a workload

```go
func TestWorkload(t *testing.T) {
    g0 := runtime.NumGoroutine()
    workload()
    time.Sleep(100 * time.Millisecond)
    runtime.GC()
    g1 := runtime.NumGoroutine()
    if g1 > g0 {
        t.Errorf("goroutine leak: %d -> %d", g0, g1)
    }
}
```

---

## Clean Code

- Always pair `LockOSThread` with `defer UnlockOSThread`.
- Always pair `SetFinalizer(x, f)` with `defer runtime.SetFinalizer(x, nil)` in `Close`.
- Always test cleanly: do not rely on finalizers running in tests; force `runtime.GC()` if you must.
- Document any `LockOSThread` with a comment explaining *why*.
- Never put `runtime.GC()` or `runtime.Stack(buf, true)` in any code path the user runs frequently.
- Keep the surface of `unsafe.Pointer` + `runtime.KeepAlive` minimal and isolated to small functions.

---

## Error Handling

The runtime helpers covered here mostly do not return errors. Things to watch:

- `runtime.SetFinalizer` may *panic* if `obj` is not a pointer to an allocated object, or if `finalizer` is not a callable with the right argument type. Treat panics from `SetFinalizer` as programmer errors at setup time; do not try to `recover` and continue.
- `runtime.LockOSThread` cannot fail.
- `runtime.Goexit` does not return.
- `runtime.GC` does not return an error but can be observed via `runtime.MemStats` afterward.

---

## Performance Tips

- Prefer atomics and channels over runtime helpers when possible — runtime helpers tend to be coarse.
- Do not enable block / mutex profiles in production at rate 1 — too expensive.
- Set `GOMEMLIMIT` for predictable memory; don't fight GC with `runtime.GC()`.
- For containerized services, use `automaxprocs` to set `GOMAXPROCS` from cgroup limits.

---

## Best Practices

1. **Use `LockOSThread` sparingly and intentionally.**
2. **Treat finalizers as belt-and-braces warnings, not primary cleanup.**
3. **Always have `runtime.NumGoroutine()` and `runtime/metrics` on your dashboard.**
4. **Install a `SIGUSR1` dump handler in any long-running service.**
5. **Never leave high-rate profiles on in production.**
6. **Document any direct use of `runtime` helpers in a top comment.**

---

## Edge Cases and Pitfalls

- A goroutine calling `LockOSThread` from inside `init` pins the main goroutine for the program's life.
- A finalizer that captures the object never runs.
- Calling `runtime.GC()` from inside a finalizer is a deadlock risk.
- `Goexit` from main without other goroutines causes the program to crash with "no goroutines".
- `runtime.Stack(buf, true)` causes STW; harmful in hot paths.
- `runtime.NumGoroutine` includes runtime's own goroutines (finalizer goroutine, GC workers).
- Setting `GOMAXPROCS=1` does *not* prevent multiple Ms from existing — it just limits how many goroutines run simultaneously.
- Calling `runtime.GC()` rapidly causes thrashing and worse performance.
- Some GUI-related cgo calls (macOS AppKit) require the main thread; you must `LockOSThread` from `init`.

---

## Common Mistakes

1. **`SetFinalizer` with a closure capturing the object** — object never reclaimed.
2. **`LockOSThread` without `UnlockOSThread`** — thread leaked.
3. **`Gosched` in tight loops thinking it relieves contention on a held mutex** — it doesn't.
4. **`runtime.GC()` in a hot path** — quadratic slowdown.
5. **Counting goroutines for leak detection without a settling barrier** — flaky tests.
6. **Forgetting `runtime.KeepAlive` after cgo with `unsafe.Pointer`** — GC may free buffer while C uses it.
7. **Using `Goexit` from `main`** — program crashes.
8. **Calling blocking operations from inside a finalizer** — stalls all subsequent finalizers.

---

## Common Misconceptions

- "The runtime is just the garbage collector." — No, it includes the scheduler, netpoller, timer wheel, signal handling, profiling, tracing.
- "`Gosched` makes my code faster." — Rarely; it adds scheduler overhead.
- "`LockOSThread` improves performance." — Only for cgo workloads that need thread affinity. In pure Go it usually hurts.
- "Finalizers replace `Close`." — No; timing is non-deterministic.
- "`runtime.GC()` frees memory." — It triggers a cycle; the cycle frees memory. Calling it repeatedly does not help.
- "`NumGoroutine` reads from one P." — It's a global count.

---

## Tricky Points

- The finalizer goroutine is *one* goroutine for the whole program. If your finalizer is slow, *all* other finalizers wait.
- `SetFinalizer` on a small object (size 0) may not run because the object may share an address with other zero-size objects.
- `LockOSThread` does not prevent the goroutine from being preempted by async preemption (for GC); it only prevents *migration* to another M.
- `Goexit` from a goroutine other than main runs all defers then ends the goroutine. The program continues if other goroutines exist.
- `runtime.Stack(buf, true)` is the same as `pprof.Lookup("goroutine").WriteTo(w, 2)`.

---

## Test

Quick self-check (answers at the end of the file).

1. What does `runtime.Gosched()` do?
2. When should you use `runtime.LockOSThread()`?
3. Why is a finalizer that captures its object never going to run?
4. What is the difference between `Goexit` and `return`?
5. What does `runtime.NumGoroutine()` count?
6. What is the cost of `runtime.Stack(buf, true)`?
7. What is `KeepAlive` for?
8. Which stdlib package does `runtime_SemacquireMutex` come from?
9. What is the difference between `runtime.lock` and `sync.Mutex`?
10. Why are notes one-shot?

---

## Tricky Questions

**Q.** Does `runtime.Gosched()` release any locks I am holding?
**A.** No. `Gosched` only yields the CPU; mutexes you hold are still held.

**Q.** Can `runtime.SetFinalizer` be called twice on the same object?
**A.** Yes; the second call replaces the first. To remove a finalizer, pass `nil`.

**Q.** Does `LockOSThread` prevent GC stop-the-world?
**A.** No. STW still pauses your goroutine; `LockOSThread` only affects scheduling across OS threads.

**Q.** Will `runtime.GC()` block forever if another goroutine is in a long syscall?
**A.** No. Goroutines in `_Gsyscall` are not part of the STW participants; their Ps are detached.

**Q.** What is the goroutine state shown in a dump while a goroutine is `time.Sleep`-ing?
**A.** `sleep` (or `chan receive` if it's actually `<-time.After(d)`).

---

## Cheat Sheet

| Helper | Purpose | Pair with |
|--------|---------|-----------|
| `Gosched()` | Yield to other goroutines | nothing |
| `LockOSThread()` | Pin G to current M | `defer UnlockOSThread()` |
| `SetFinalizer(p, f)` | Register cleanup callback | `Close` that calls `SetFinalizer(p, nil)` |
| `Goexit()` | Terminate goroutine with defers | only call from non-main goroutines |
| `GC()` | Force a GC cycle | sparingly |
| `Stack(buf, true)` | Dump all goroutines | only on demand or in panic handler |
| `NumGoroutine()` | Total live goroutines | atomic read; safe in hot paths |
| `KeepAlive(x)` | Extend live range | for unsafe / cgo |
| `GOMAXPROCS(n)` | Set P count | typically once at startup |

---

## Self-Assessment Checklist

- [ ] I can name 5 runtime helpers and explain when to use each.
- [ ] I can write a cgo worker pinned to one OS thread.
- [ ] I know why a finalizer must use its parameter, not a captured variable.
- [ ] I can write a panic handler that dumps all goroutines.
- [ ] I know the difference between `Goexit` and `return`.
- [ ] I know what a goroutine state line in a stack dump means.
- [ ] I can sketch what `sync.Mutex.Lock` does on the slow path.
- [ ] I know not to put `runtime.GC()` in a hot path.
- [ ] I know `runtime.Stack(buf, true)` is STW.
- [ ] I can pair `LockOSThread` with `UnlockOSThread`.

---

## Summary

The `runtime` package is the bedrock of Go concurrency. Its exported helpers — `Gosched`, `LockOSThread`, `SetFinalizer`, `Goexit`, `GC`, `Stack`, `KeepAlive`, `NumGoroutine`, `GOMAXPROCS` — give you a controlled way to interact with the layer that the rest of stdlib is built on. Most of the time you use stdlib types (`sync.Mutex`, `time.Timer`, `net.Conn`) and never call the runtime directly. But when you need to interact with cgo, debug a hung program, or understand what `sync.Mutex.Lock` is really doing, these helpers are the door into the lower layer.

Key lessons:

1. The runtime is the scheduler + GC + netpoller + signal handler + profiler + tracer, all in one.
2. Almost every stdlib concurrency primitive ends up calling internal runtime functions like `gopark`, `goready`, `semacquire`, `semrelease`.
3. The exported helpers are mostly *diagnostic* (Stack, NumGoroutine, GC, profile rate setters) or *coordination* (Gosched, LockOSThread, SetFinalizer, Goexit, KeepAlive).
4. Misuse — finalizer closures, unbalanced LockOSThread, hot-path GC — is the source of many production bugs.

---

## What You Can Build

After this file you can build:

- A cgo-bound worker that handles OpenGL or similar thread-affine calls.
- A long-running service with a SIGUSR1 dump handler and panic-time stack dump.
- A library that warns when its resources are not properly Closed.
- A test helper that detects goroutine leaks.
- A health endpoint that reports `runtime.NumGoroutine` and key MemStats.

In `middle.md` you will go deeper: reading the source of `runtime.sema`, `gopark`, `goready`, `note`, and tracing the exact call chain from `mu.Lock()` to the scheduler.

---

## Further Reading

- The `runtime` package documentation — https://pkg.go.dev/runtime
- *Diagnostics* — https://go.dev/doc/diagnostics
- *Go's runtime* — Russ Cox blog posts on memory allocator, scheduler design
- *The Go scheduler* — Dmitry Vyukov design doc, https://golang.org/s/go11sched
- *Profiling Go programs* — https://go.dev/blog/pprof
- *Effective Go* — https://go.dev/doc/effective_go

---

## Related Topics

- Section 22 — Memory ordering barriers (the layer below runtime primitives).
- Section 10 — The scheduler internals (M/P/G in depth).
- Section 23.01 — `sync` package primitives (Mutex, WaitGroup, Once, Pool, Map).
- Section 23.02 — `atomic` package.
- Section 23.03 — `context` package (cooperates with goroutines via channels).
- Section 23.05 — Channel internals.

---

## Test Answers

1. Yields the current goroutine; it stays runnable.
2. When a C library needs per-thread state (OpenGL, signal masks, etc.).
3. Because the closure references the object, making it reachable forever via the finalizer table.
4. `Goexit` runs all defers then terminates the goroutine, even from deep stacks; `return` only returns from the current function.
5. The global total number of goroutines including runtime's own.
6. STW pause; can be hundreds of ms on a busy server.
7. Marks a variable as still reachable, preventing premature GC.
8. `sync.Mutex.Lock` slow path.
9. `runtime.lock` is for runtime-internal data; `sync.Mutex` is built on the runtime.
10. Because they are designed for one-shot signalling between the runtime and its Ms; for repeated signals use a channel.

---

## Closing thought

The runtime feels mysterious until you realize it is just the operating system of your goroutines. Once you can read a goroutine dump and identify "this goroutine is parked on `runtime_pollWait` inside `internal/poll.(*FD).Read`", you have all the vocabulary you need to diagnose 90% of concurrency problems. The remaining 10% — race conditions, memory model edge cases, scheduling pathologies — is what `middle.md`, `senior.md`, and `professional.md` are for.

The next file walks through `gopark`, `goready`, `note`, `sema`, and `procPin` with source-code line references, so you can read `runtime/sema.go` and recognise every line.

---

## Deeper Walkthroughs

This section revisits each helper with a fuller story, more examples, and the gotchas that only show up in real code.

### Gosched — what actually happens in the scheduler

When you call `runtime.Gosched()`, the runtime performs the following sequence (paraphrasing `runtime/proc.go`):

1. The function is marked `//go:nosplit` so it does not grow the stack.
2. It calls `mcall(gosched_m)`, which switches to the `g0` system stack on the current M.
3. `gosched_m` runs `goschedImpl` which:
   - Changes the calling G's state from `_Grunning` to `_Grunnable`.
   - Calls `dropg()` to detach the G from its current M.
   - Calls `globrunqput(gp)` to push the G onto the *global* run queue.
   - Calls `schedule()` to pick the next runnable G.

Note the detail: `Gosched` does *not* keep the G on the local run queue. It pushes to the *global* queue. This is intentional — by going to the global queue, the G is more likely to be picked up by a different P, providing better balancing.

This means `Gosched` is slightly more expensive than just rotating within one P. If you want to yield to a *specific* known goroutine, channels are the right tool, not `Gosched`.

### Gosched vs runtime.Gosched_m vs runtime.Goyield

You will see `Gosched_m` and a related `goyield` in the source. `Gosched_m` is the M-stack helper; `goyield` is similar but used internally by the scheduler when it needs a yield without giving up to the global queue. The exported `Gosched` is the only one you should ever call.

### Gosched and the `GODEBUG=schedtrace` output

With `GODEBUG=schedtrace=1000` you can see scheduling events per second. After a `Gosched`, you may notice the same goroutine reappear in `_Grunnable` state on a different P than before. This is the global-queue redistribution at work.

### LockOSThread — when the OS thread is sacred

There are categories of code that *must* run on a specific OS thread:

**Category A: AppKit / Cocoa main thread (macOS).** The macOS UI framework requires that all UI code run on the original main thread (the one with the process's main `NSApplication`). Go programs that build macOS GUIs must call `runtime.LockOSThread` from `init` so the main goroutine never migrates.

**Category B: Per-thread state in C libraries.** OpenGL, OpenSSL (older versions), some database client libraries, and many GUI libraries store state in thread-local storage (TLS). Calling them from different threads breaks them.

**Category C: Per-thread signal masks.** Linux signal masks are per-thread. If your code needs to mask/unmask signals around a specific operation, you must stay on the same thread between the mask change and the operation.

**Category D: Per-thread Linux capabilities, namespaces, fs_root.** These are all per-thread on Linux. Tools like rootless containers manipulate them; you must `LockOSThread` to ensure your changes apply consistently.

**Category E: Per-thread uid/gid.** Linux `setresuid` is per-thread (via `setresuid32` syscall, despite POSIX nominally being per-process). Servers like sshd use this to drop privileges per connection; if you replicate that, `LockOSThread` is mandatory.

**Category F: cgo callbacks into Go.** When C code calls back into Go (via `//export`), the Go runtime needs to know which goroutine to run. If the C side calls from a specific thread for stateful reasons, you usually want `LockOSThread` to pin the Go side too.

### LockOSThread — what does NOT need it

- Pure Go code (no per-thread state).
- Cgo calls that are stateless (computes a value, returns).
- Most modern OpenSSL usage (recent versions are thread-safe).
- Calls into databases that have their own thread pool.

### LockOSThread — the cost

A locked M cannot run other goroutines. If your `GOMAXPROCS` is 8 and you have 4 long-running locked goroutines, you have only 4 Ps available for the rest of your program. Tail latency suffers.

A locked goroutine that exits *terminates* its OS thread. The thread is returned to the OS, not the runtime's M pool. This is the runtime's signal: "this goroutine owned this thread for its life; the thread had per-thread state that we cannot risk reusing."

If you make many short-lived locked goroutines, you burn OS threads. Go has a default limit of 10000 OS threads (`runtime/proc.go` `sched.maxmcount`); exceeding it crashes the program with `runtime: program exceeds 10000-thread limit`.

### LockOSThread — debugging

If you suspect a thread leak, dump goroutine state and look at the M count. `runtime.NumGoroutine()` gives goroutines; for Ms, you need to inspect `runtime/metrics` `/sched/threads:threads` (or `pprof.Lookup("threadcreate")` to see where threads were created).

### SetFinalizer — the full reachability picture

The GC sees the finalizer table as a root. When the GC marks, it scans this table; objects with finalizers are kept alive *for the first cycle they would otherwise be unreachable*. Then the finalizer runs, and after that the object is treated as a normal candidate for the next cycle.

Key implications:

- A finalized object survives **at least one extra GC cycle**.
- During that cycle, the object is reachable, so anything it points to is also kept alive.
- After the finalizer runs, if no new reference was created, the object is freed in the next cycle.

The "anything it points to is kept alive" point matters: if your finalizer is a method on a parent struct, the parent stays alive too.

### SetFinalizer — order across multiple objects

The GC does not guarantee any order between finalizers. If object A points to object B and both have finalizers, A's finalizer is *not* guaranteed to run before B's. In practice, Go's GC tries to run them in reverse-allocation order, but you cannot rely on it.

The Go runtime *does* guarantee that finalizers are run after the objects become unreachable — never before. So your finalizer always sees a "logically dead" object.

### SetFinalizer — programs that exit

When your Go program exits via `main` returning or `os.Exit`, **finalizers do not run**. The runtime simply terminates. So:

- Anything that needs to be cleaned up at exit must be done explicitly, before `main` returns.
- Finalizers are only useful during the steady-state lifetime of the program.
- For "release C resources before exit", use `defer` in `main`, not finalizers.

### Goexit — the recover surprise

`Goexit` is *not* a panic. `recover` returns `nil` from inside a deferred function during `Goexit`:

```go
func worker() {
    defer func() {
        r := recover()
        fmt.Println("recover returned:", r) // prints "<nil>"
    }()
    runtime.Goexit()
}
```

This is sometimes surprising. The deferred function runs, but it cannot tell whether the goroutine ended via `return`, `Goexit`, or panic-recover, because in two of three cases `recover` returns `nil`.

If you need to distinguish, set a flag:

```go
done := false
defer func() {
    if !done {
        fmt.Println("did not complete normally")
    }
}()
// ... work
done = true
```

### Goexit — implications for testing

`testing.T.FailNow`, `t.Fatal`, `t.Skipf` all internally call `Goexit`. The cleanup functions registered with `t.Cleanup` *do* run (because they are deferred). Old-style `defer f.Close()` inside the test function also runs.

But state that is set up *outside* the test goroutine (in the test runner, in package-level vars) is not cleaned up by `Goexit`. This is why `t.Cleanup` exists — it integrates with the test runner.

### GC — what blocks during a GC cycle

A GC cycle has these phases:

1. **GC mark setup (STW).** Brief (sub-millisecond on most heaps). All goroutines pause while the runtime sets up mark workers and enables write barriers.
2. **Concurrent mark.** Mutators run with write barriers enabled. GC workers mark concurrently.
3. **Mark termination (STW).** Brief, drains worker queues, disables write barriers.
4. **Concurrent sweep.** Sweep happens lazily as memory is reused, in parallel with mutators.

`runtime.GC()` waits for steps 1-3 to complete. It does *not* wait for the concurrent sweep, because sweep is amortized.

### GC — what triggers it normally

Without manual `runtime.GC()`, the runtime triggers GC when:

- The heap has grown by `GOGC%` since the last GC (default 100% = double).
- `GOMEMLIMIT` is set and the heap is approaching the limit.
- A goroutine explicitly calls `debug.FreeOSMemory()` or `runtime.GC()`.

### NumGoroutine — what counts

Goroutines counted:

- Your goroutines (`go f()`).
- Runtime-managed goroutines: finalizer goroutine, signal goroutine, forced-GC goroutine, GC workers, profiler goroutines.

So a "fresh" program with `main` doing nothing reports `runtime.NumGoroutine() > 1`, typically 2-5.

### NumCPU — what is "logical"

`NumCPU()` returns the number of logical CPUs visible at process startup. On a machine with 8 cores × 2 threads (hyperthreading), it returns 16. On a containerized environment, it returns the host's CPU count unless cgroup limits are translated by a library like `automaxprocs`.

This is why containers often see surprising performance: Go thinks it has 64 CPUs but the cgroup gives it 2 worth of CPU time. `GOMAXPROCS` defaults to `NumCPU()`, so the runtime spawns 64 Ps and they all contend for 2 actual CPU shares.

### GOMAXPROCS — when to set it explicitly

- In containers without `automaxprocs` — set to match your CPU quota.
- For services that share the machine — set to leave headroom.
- For deterministic benchmarks — set to 1.
- For tools that want to limit parallelism — set lower than `NumCPU`.

Avoid setting it higher than `NumCPU` — it does not give you more CPU, just more context switching.

### Stack — the format in detail

A sample dump:

```
goroutine 12 [chan receive, 14 minutes]:
main.consumer(0xc0000ba000)
        /home/user/foo.go:42 +0x90
created by main.main in goroutine 1
        /home/user/foo.go:18 +0x108
```

- `12` — goroutine id, allocated sequentially.
- `[chan receive, 14 minutes]` — current wait reason and how long the goroutine has been in this state.
- `main.consumer(0xc0000ba000)` — the function at the top of the stack and its first argument's value at function entry.
- `/home/user/foo.go:42 +0x90` — file and line, plus offset into the function.
- `created by main.main in goroutine 1` — the parent goroutine.

The "minutes" annotation is added by `pprof`-style printing when `debug=2`. It indicates how long the goroutine has been in the current state — useful for spotting wedged goroutines.

### Stack — how `pprof` does it

`net/http/pprof`'s goroutine handler calls `pprof.Lookup("goroutine").WriteTo(w, debug)`. With `debug=2`, it writes the same format as `runtime.Stack(buf, true)`. With `debug=1`, it writes a count and a short summary.

### KeepAlive — when the compiler kills your variable

This is subtle. Consider:

```go
func cWork(buf *Buffer) {
    p := unsafe.Pointer(&buf.data[0])
    C.use(p, C.size_t(len(buf.data)))
}
```

The Go compiler may decide that `buf` is dead after the first line because all uses are through `p`. The GC can then free `buf.data`. If `C.use` is still running, you have a use-after-free.

`runtime.KeepAlive(buf)` after the C call forces the compiler to keep `buf` in the live set until that point:

```go
func cWork(buf *Buffer) {
    p := unsafe.Pointer(&buf.data[0])
    C.use(p, C.size_t(len(buf.data)))
    runtime.KeepAlive(buf)
}
```

`KeepAlive` is a runtime no-op — at the machine level nothing happens. It is a *compile-time hint*.

### KeepAlive — alternative: use a value that the compiler tracks

If you can avoid `unsafe.Pointer`, you can avoid `KeepAlive`:

```go
func cWork(buf *Buffer) {
    C.use((*C.char)(unsafe.Pointer(&buf.data[0])), C.size_t(len(buf.data)))
}
```

But the moment you create a separate `unsafe.Pointer` variable, the compiler may lose track. The rule of thumb: any time you derive a pointer that the GC cannot follow back to the original, add `runtime.KeepAlive` at the end of the function.

---

## More Code Examples (continued)

### Example 16 — Inspecting the timer subsystem

```go
func main() {
    fmt.Println("Before:", runtime.NumGoroutine())
    t := time.NewTimer(time.Hour)
    fmt.Println("After NewTimer:", runtime.NumGoroutine())
    t.Stop()
    fmt.Println("After Stop:", runtime.NumGoroutine())
}
```

Output (modern Go):
```
Before: 2
After NewTimer: 2
After Stop: 2
```

Notice: `time.NewTimer` does *not* create a goroutine. The timer is added to the per-P timer heap; no goroutine is spawned. Older Go versions had a dedicated timer goroutine, but since Go 1.14 each P handles its own timers.

### Example 17 — Inspecting an http server's goroutine count

```go
func main() {
    go func() {
        time.Sleep(100 * time.Millisecond)
        fmt.Println("after 100ms, goroutines:", runtime.NumGoroutine())
    }()
    http.ListenAndServe(":8080", nil)
}
```

A bare http server uses 2-3 goroutines: one for `Accept`, plus runtime ones. Each connection adds 2 more (one for read, one for write). If you see thousands of goroutines after a few seconds, you have a connection that does not close.

### Example 18 — Finalizer with proper cleanup

```go
type dbConn struct {
    handle uintptr
    closed atomic.Bool
}

func openDB() (*dbConn, error) {
    h, err := cOpen()
    if err != nil {
        return nil, err
    }
    c := &dbConn{handle: h}
    runtime.SetFinalizer(c, func(p *dbConn) {
        if !p.closed.Load() {
            log.Printf("WARNING: dbConn leaked (handle=%x)", p.handle)
            cClose(p.handle) // best-effort
        }
    })
    return c, nil
}

func (c *dbConn) Close() error {
    if !c.closed.CompareAndSwap(false, true) {
        return nil
    }
    runtime.SetFinalizer(c, nil)
    return cClose(c.handle)
}
```

### Example 19 — Pin once for many cgo calls

```go
func processFile(items []Item) error {
    runtime.LockOSThread()
    defer runtime.UnlockOSThread()

    if err := cOpenContext(); err != nil {
        return err
    }
    defer cCloseContext()

    for _, it := range items {
        if err := cProcessItem(C.int(it.value)); err != nil {
            return err
        }
    }
    return nil
}
```

By pinning once for the whole batch, you avoid swapping contexts.

### Example 20 — Goexit-based "early return" pattern (rare)

```go
func fetchAndProcess(ctx context.Context) {
    defer cleanup()

    data, err := fetch(ctx)
    if err != nil {
        log.Printf("fetch failed: %v", err)
        runtime.Goexit() // skip the rest, but cleanup still runs
    }

    process(data)
}
```

This is unusual; prefer `return` with an explicit error. `Goexit` makes sense only when you cannot propagate the error (e.g., goroutine entry function).

### Example 21 — Profiling startup and shutdown

```go
func main() {
    if os.Getenv("GO_PROFILE") == "1" {
        f, _ := os.Create("cpu.prof")
        defer f.Close()
        pprof.StartCPUProfile(f)
        defer pprof.StopCPUProfile()
    }

    runService()
}
```

### Example 22 — runtime.Caller for logging context

```go
func logCaller(format string, args ...any) {
    _, file, line, ok := runtime.Caller(1)
    if !ok {
        log.Printf(format, args...)
        return
    }
    log.Printf("[%s:%d] "+format, append([]any{filepath.Base(file), line}, args...)...)
}
```

`runtime.Caller` is in the same package; it gives you the caller's file and line. Useful for custom log wrappers.

### Example 23 — runtime.Callers + runtime.CallersFrames for full stacks

```go
func currentStack(skip, depth int) []string {
    pcs := make([]uintptr, depth)
    n := runtime.Callers(skip+2, pcs)
    frames := runtime.CallersFrames(pcs[:n])
    var lines []string
    for {
        f, more := frames.Next()
        lines = append(lines, fmt.Sprintf("%s\n\t%s:%d", f.Function, f.File, f.Line))
        if !more {
            break
        }
    }
    return lines
}
```

This is the safer way to get a stack trace than parsing `runtime.Stack`.

### Example 24 — Detecting cgo overuse with NumCgoCall

```go
func logCgoStats() {
    fmt.Printf("cgo calls so far: %d\n", runtime.NumCgoCall())
}
```

If `NumCgoCall` grows fast (millions/second), you may benefit from batching cgo calls.

### Example 25 — Reading MemStats

```go
func memSnapshot() {
    var m runtime.MemStats
    runtime.ReadMemStats(&m)
    fmt.Printf("alloc=%dMB sys=%dMB num_gc=%d pause_total=%dms\n",
        m.Alloc>>20, m.Sys>>20, m.NumGC, m.PauseTotalNs/1e6)
}
```

`ReadMemStats` is expensive; do not call it in a hot loop. For production use `runtime/metrics` instead.

### Example 26 — Using runtime/metrics

```go
import "runtime/metrics"

func metricsSnapshot() {
    samples := []metrics.Sample{
        {Name: "/sched/goroutines:goroutines"},
        {Name: "/gc/heap/live:bytes"},
        {Name: "/sync/mutex/wait/total:seconds"},
    }
    metrics.Read(samples)
    fmt.Printf("goroutines=%d  heap_live=%dMB  mutex_wait=%.3fs\n",
        samples[0].Value.Uint64(),
        samples[1].Value.Uint64()>>20,
        samples[2].Value.Float64(),
    )
}
```

This is the modern, low-overhead way to monitor runtime stats.

---

## Internal Functions You Will See in Source

When you look at the runtime source or stdlib `sync` source, you encounter several internal helpers that are commonly accessed via `go:linkname`. A short tour so you can recognise them:

### `runtime_Semacquire(s *uint32)`

Used by `sync.WaitGroup.Wait` and `sync.Mutex.Lock` (slow path). Decrements `*s`; if `*s` would go negative, parks the goroutine in a FIFO queue keyed by the address of `s`. Implemented in `runtime/sema.go`.

### `runtime_Semrelease(s *uint32, handoff bool, skipframes int)`

Increments `*s`; if there are waiters, wake one. `handoff` controls whether the woken goroutine is given the semaphore directly (used by mutex starvation mode).

### `runtime_procPin() int`

Disables preemption of the current goroutine and returns the current P's id. Used by `sync.Pool.Get`/`Put` to safely index a per-P shard.

### `runtime_procUnpin()`

Re-enables preemption.

### `runtime_canSpin(i int) bool`

Returns whether spinning is worthwhile for the current state. Used by `sync.Mutex` slow path: spin a few times before going to the semaphore.

### `runtime_doSpin()`

Performs one spin iteration (a small fixed number of CPU PAUSE instructions on x86, or YIELD on ARM).

### `runtime_nanotime() int64`

Returns a monotonic nanosecond clock. Used by `time.Now()` for the monotonic component and by mutexes / semaphores for fairness timestamps.

### `runtime_notifyListAdd / Wait / NotifyOne / NotifyAll`

Backing for `sync.Cond`. Each `Cond` has a `notifyList` of waiters; `Wait` adds the goroutine, `Signal` wakes one, `Broadcast` wakes all.

### `runtime_pollOpen / pollWait / pollClose / pollSetDeadline / pollUnblock`

Backing for `internal/poll`. The `net` package's blocking semantics rely entirely on these.

---

## Patterns You Will See in Standard Library Source

When you read `src/sync/mutex.go`, `src/net/fd_posix.go`, `src/time/sleep.go`, you will see recognisable structure:

1. **Fast path with atomic CAS.** Most operations succeed without entering the runtime.
2. **Slow path that calls `runtime_*`.** A `go:linkname` declaration ties a stub to an unexported runtime function.
3. **Symmetric wake.** The release / unlock side mirrors the acquire / lock side: same internal function, opposite direction.
4. **Per-P state.** Many primitives use per-P sharding (timers, finalizer queue, profile buffers) to avoid contention.

Recognising these patterns makes the stdlib source readable. After reading 3-4 of these implementations, you can predict the structure of the rest.

---

## Common Runtime-related Build Tags and Directives

You will see in stdlib source:

| Directive | Meaning |
|-----------|---------|
| `//go:linkname localName pkg.remoteName` | Link `localName` in this package to `pkg.remoteName`, even if remote is unexported |
| `//go:nosplit` | Function must not grow the stack — used in runtime fast paths |
| `//go:nowritebarrier` | Disables GC write barriers — used in low-level runtime code |
| `//go:noinline` | Prevent inlining — used to keep stack frames stable for debugging |
| `//go:systemstack` | Function runs on the system stack (`g0`), not a user goroutine's stack |
| `//go:notinheap` | Type instances must not be allocated on the GC-managed heap |

User code rarely needs these; they appear when reading runtime source.

---

## More Real-world Analogies

**`runtime.Stack(buf, true)` as evacuation drill.** Calling it stops everyone and asks them to assemble in the parking lot so you can count heads. Useful but slow; do not do it every minute.

**Finalizer goroutine as the trash collector.** One truck for the whole city. If one bin takes a long time to empty, every other bin waits. Keep your bins simple.

**`LockOSThread` as a private office.** A locked goroutine has a private office (OS thread); the office is unavailable to everyone else. Don't reserve it unless you actually need the desk.

**`runtime/metrics` as the dashboard.** Smooth, real-time, low-overhead. The `runtime.Stack` is the security camera you only check after an incident.

**`KeepAlive` as a sticky note.** "Don't throw this out yet" — the GC sees the sticky note even if no one is using the object directly.

---

## Mental Models, Extended

### The "every block has a corresponding wake" model

For every place a goroutine parks, there is a place that wakes it.

| Where it parks | Where it wakes |
|----------------|----------------|
| `chan recv` (empty chan) | `chan send` |
| `chan send` (full chan) | `chan recv` |
| `select` (no ready case) | any of the channels becomes ready |
| `sync.Mutex.Lock` (contended) | `sync.Mutex.Unlock` |
| `sync.WaitGroup.Wait` | `sync.WaitGroup.Done` brings counter to 0 |
| `sync.Cond.Wait` | `Signal` or `Broadcast` |
| `time.Sleep` | timer heap reaches the deadline |
| `net.Conn.Read` | netpoller sees fd ready |

The "block" and the "wake" are like a key and lock. They use the same address as the rendezvous: the address of the semaphore for mutexes, the address of the channel for channels, the file descriptor for the netpoller.

### The "Goroutines do not block; they park" model

A goroutine *cannot* block an OS thread. When you "block on a mutex", what really happens is:

1. Your G is removed from the M (the OS thread).
2. The M is free to run another G.
3. Your G is parked on the mutex's wait queue.
4. When the mutex unlocks, your G is moved back to a runnable queue.
5. Some M (possibly a different one) eventually runs your G.

This is why you can have millions of goroutines blocked on channels with only `GOMAXPROCS` OS threads.

The exception: a goroutine in a syscall keeps its M (because the M is in the kernel). The runtime detects long syscalls and spawns extra Ms (`sysmon`'s job) so the Ps don't sit idle. This is why `NumGoroutine` and the M count can both be very large in services with many blocking I/O calls.

### The "scheduler ticks" model

The scheduler is event-driven. It runs when:

- A G goes runnable (via `goready`).
- A G's quantum is exceeded (preemption signal).
- A G goes to sleep / parks (via `gopark`).
- A G exits (via `goexit0`).
- A P has nothing to do (calls `findrunnable`).
- `sysmon` wakes a sleeping M.

It does *not* run on a fixed clock interval. Goroutines yield (cooperative or preempted), and the scheduler picks the next.

---

## Coding Patterns, Extended

### Pattern 6: Counting finalizers in tests

```go
func TestFinalizerRuns(t *testing.T) {
    var ran atomic.Int32
    for i := 0; i < 10; i++ {
        obj := new(int)
        runtime.SetFinalizer(obj, func(_ *int) {
            ran.Add(1)
        })
        _ = obj
    }
    runtime.GC()
    runtime.GC()
    time.Sleep(100 * time.Millisecond)
    if ran.Load() != 10 {
        t.Errorf("expected 10 finalizers, got %d", ran.Load())
    }
}
```

### Pattern 7: Throttled `runtime.GC()` for long-running batch jobs

```go
type gcThrottler struct {
    last time.Time
}

func (t *gcThrottler) maybeGC() {
    if time.Since(t.last) > 30*time.Second {
        runtime.GC()
        t.last = time.Now()
    }
}
```

### Pattern 8: Async runtime stats emitter

```go
func emitStats(interval time.Duration) {
    samples := []metrics.Sample{
        {Name: "/sched/goroutines:goroutines"},
        {Name: "/gc/heap/live:bytes"},
    }
    t := time.NewTicker(interval)
    defer t.Stop()
    for range t.C {
        metrics.Read(samples)
        log.Printf("goroutines=%d heap=%dMB",
            samples[0].Value.Uint64(),
            samples[1].Value.Uint64()>>20)
    }
}
```

### Pattern 9: Locking and unlocking around a stateful C function

```go
func runtimeSensitiveC(arg int) (result int, err error) {
    runtime.LockOSThread()
    defer runtime.UnlockOSThread()

    saved := C.set_state(C.int(arg))
    defer C.restore_state(saved)

    return int(C.compute()), nil
}
```

### Pattern 10: Periodic goroutine-count assertion

```go
func startWatchdog(threshold int) {
    go func() {
        t := time.NewTicker(10 * time.Second)
        defer t.Stop()
        for range t.C {
            if n := runtime.NumGoroutine(); n > threshold {
                log.Printf("ALERT: %d goroutines (threshold %d)", n, threshold)
                buf := make([]byte, 1<<20)
                n := runtime.Stack(buf, true)
                log.Println(string(buf[:n]))
            }
        }
    }()
}
```

---

## More Edge Cases and Pitfalls

### Edge case: SetFinalizer on a stack-allocated object

The runtime panics if you call `SetFinalizer` on something that is not heap-allocated:

```go
func main() {
    var x int
    runtime.SetFinalizer(&x, func(_ *int) { /* never runs */ })
}
```

In this snippet, `x` is escape-analyzed. If the compiler escapes `x` to the heap (because of `SetFinalizer`), it works. If the compiler does not (which happens in some older versions), the runtime aborts.

The safe pattern: explicitly heap-allocate via `new` or `&Composite{}`:
```go
x := new(int)
runtime.SetFinalizer(x, func(_ *int) { /* runs eventually */ })
```

### Edge case: SetFinalizer on an interior pointer

```go
type S struct { a, b int }
s := &S{}
runtime.SetFinalizer(&s.b, func(_ *int) { /* panic at run time */ })
```

The runtime requires `obj` to be a pointer to the *start* of an allocated object, not an interior pointer. The above panics.

### Edge case: LockOSThread inside a deferred function

```go
func foo() {
    defer runtime.LockOSThread() // !! this locks at function exit
    work()
}
```

This locks the goroutine to its current thread *after* `work()` finishes, which is probably not what you want. The convention is to lock *first*, defer the unlock:

```go
func foo() {
    runtime.LockOSThread()
    defer runtime.UnlockOSThread()
    work()
}
```

### Edge case: Gosched in a goroutine holding a runtime lock

If you call `Gosched` while inside a runtime call that holds a runtime lock (very rare unless writing a runtime patch), you can deadlock. Don't try to.

### Edge case: `runtime.GC()` from inside a finalizer

The finalizer goroutine cannot wait for itself. Calling `runtime.GC()` from inside a finalizer is undefined behavior; in current Go it may deadlock.

### Edge case: `Goexit` from main without other goroutines

```go
func main() {
    runtime.Goexit()
}
```

Output:
```
fatal error: no goroutines (main called runtime.Goexit) - deadlock!
```

The runtime detects that no goroutines remain and aborts.

### Edge case: Finalizer that creates new references

```go
var liveSet = make(map[*Resource]struct{})

runtime.SetFinalizer(r, func(p *Resource) {
    liveSet[p] = struct{}{} // re-stores p in a live map
})
```

The finalizer reaches `p` back to the live set. The GC will free `p` only after no more references exist. The finalizer is *not* called again (finalizers are one-shot).

Best practice: never resurrect objects in finalizers. Treat them as one-way cleanup.

---

## More Common Mistakes

### Mistake: Assuming finalizers run at program exit

They do not. If you need cleanup on exit, do it explicitly:

```go
defer cleanupAll()
```

### Mistake: Holding a mutex across `runtime.Gosched`

```go
mu.Lock()
runtime.Gosched()
heavy()
mu.Unlock()
```

Other goroutines waiting on `mu` are still blocked. `Gosched` does not release the mutex.

### Mistake: Using `NumGoroutine` to throttle work

```go
for runtime.NumGoroutine() < 100 {
    go work()
}
```

Goroutine count is not a reliable concurrency limiter. Use semaphores (`golang.org/x/sync/semaphore`) or worker pools.

### Mistake: `LockOSThread` for every cgo call

```go
func tinyCgo() int {
    runtime.LockOSThread()
    defer runtime.UnlockOSThread()
    return int(C.tinyFunction())
}
```

For one stateless cgo call, the lock/unlock cost exceeds the cgo call cost. Reserve `LockOSThread` for batches or for calls that require thread affinity.

### Mistake: `runtime.Stack(buf, true)` in a metrics emitter

```go
go func() {
    for range time.Tick(time.Second) {
        buf := make([]byte, 1<<20)
        n := runtime.Stack(buf, true) // STW every second!
        emitMetric("goroutine_dump", string(buf[:n]))
    }
}()
```

STW every second is catastrophic. Use `runtime.NumGoroutine()` for routine metrics.

---

## More Common Misconceptions

- "The runtime is single-threaded." — False. The runtime uses many threads internally (Ms, sysmon, GC workers, finalizer goroutine).
- "Channels are slower than mutexes." — Depends on the case. For pure synchronization, mutexes are faster. For data transfer, channels are often clearer and not significantly slower.
- "`runtime.GC()` runs faster on a smaller heap." — Approximately yes; GC pause time scales with live heap size.
- "Async preemption fires instantly." — There is a small latency (microseconds) before sysmon detects a long-running goroutine and sends `SIGURG`.
- "`Gosched` is a sleep with zero duration." — No, it does not block; it just moves the goroutine to the back of the run queue.

---

## More Tricky Points

### Trick 1: A locked goroutine can still be GC'd if unreferenced

`LockOSThread` does not keep the goroutine itself alive. If nothing references the goroutine, it can still be collected — though in practice goroutines are always "reachable" from their stack frames, so this rarely matters.

### Trick 2: `runtime.GC()` is idempotent within a cycle

Calling `runtime.GC()` twice in a row only triggers two cycles. There is no shortcut.

### Trick 3: Finalizers run on the order they become unreachable

If A and B both have finalizers, and A becomes unreachable before B, A's finalizer is queued before B's. They run in queue order, but the gap between "queued" and "runs" is unspecified.

### Trick 4: `Goexit` does not call `os.Exit`

`os.Exit` terminates the program immediately, skipping defers. `Goexit` terminates the goroutine and runs its defers. Very different.

### Trick 5: `runtime.NumGoroutine()` is not constant under concurrent goroutine creation

If you read it in a tight loop, you may see different values each time:

```go
for i := 0; i < 5; i++ {
    fmt.Println(runtime.NumGoroutine())
}
```

This is expected; do not rely on the value being stable.

---

## More Test Questions (Self-Check)

11. What is the difference between `runtime.Gosched` and `time.Sleep(0)`?
12. Why does `LockOSThread` block other goroutines on the same M?
13. Can a finalizer access fields of the object it is finalizing?
14. What happens to the OS thread when a locked goroutine exits?
15. What is `runtime.KeepAlive(x)` at the assembly level?
16. Why might `runtime.NumGoroutine()` increase even though your code creates no new goroutines?
17. What is the smallest meaningful `GOMAXPROCS`?
18. Why does `runtime.Stack(buf, true)` need stop-the-world?
19. Can `runtime.GC()` deadlock?
20. What is `runtime/metrics` and how does it relate to `runtime.MemStats`?

### Answers

11. `time.Sleep(0)` may either return immediately (most modern runtimes) or trigger `Gosched`-like behavior; it is not specified. `runtime.Gosched()` always yields. Prefer `Gosched` when that is your intent.
12. A locked goroutine pins the OS thread; the runtime cannot use that thread for other goroutines.
13. Yes, that is the point of the finalizer's argument. But the object should be treated as logically dead — do not "revive" it for normal use.
14. The runtime destroys the OS thread.
15. A no-op. It exists for the compiler, not the CPU.
16. Runtime-managed goroutines may be spawned for GC, profiling, or finalizers.
17. 1.
18. To walk stacks consistently while goroutines are not mutating them.
19. In normal use, no — but indirectly yes (e.g., if you call it from inside a finalizer, or if you trigger a GC inside an already-running GC critical section).
20. `runtime/metrics` is the modern, low-overhead API; `runtime.MemStats` requires STW for some fields. Prefer `metrics` for production monitoring.

---

## Extended Cheat Sheet

| Concept | Detail |
|---------|--------|
| Goroutine states | `_Grunning`, `_Grunnable`, `_Gwaiting`, `_Gsyscall`, `_Gdead` |
| State strings in dump | `running`, `runnable`, `IO wait`, `chan send/recv`, `select`, `sync.Mutex.Lock`, `sync.Cond.Wait`, `semacquire`, `sleep`, `finalizer wait` |
| Park reasons | `waitReasonChanReceive`, `waitReasonChanSend`, `waitReasonSelect`, `waitReasonSyncMutexLock`, `waitReasonSemacquire`, `waitReasonSleep`, `waitReasonIOWait` |
| Common runtime helpers in stdlib | `semacquire`, `semrelease`, `gopark`, `goready`, `procPin`, `procUnpin`, `notesleep`, `notewakeup`, `nanotime`, `pollWait` |
| GODEBUG flags | `gctrace=1`, `schedtrace=1000`, `scheddetail=1`, `asyncpreemptoff=1`, `madvdontneed=1`, `cgocheck=2`, `tracebackancestors=N` |
| Environment vars | `GOMAXPROCS`, `GOGC`, `GOMEMLIMIT`, `GOTRACEBACK`, `GODEBUG` |
| Profile endpoints | `/debug/pprof/goroutine`, `/heap`, `/block`, `/mutex`, `/profile`, `/trace`, `/threadcreate` |

---

## What's Next

Read `middle.md`. There you will:

- See actual source-code excerpts from `runtime/sema.go`, `runtime/proc.go`, `runtime/lock_futex.go`.
- Walk through `gopark` and `goready` step by step.
- See how `sync.Mutex.Lock` (slow path) reaches `semacquire1`.
- Understand the `note` type and how it is used in the runtime's own mutex implementation.
- Learn the difference between `runtime.lock` (runtime-internal) and `sync.Mutex` (user-visible).

Then in `senior.md` you will move to networking, timers, and the race detector.

