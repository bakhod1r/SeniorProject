# Goroutines vs OS Threads — Specification

## Table of Contents
1. [Introduction](#introduction)
2. [What the Go Spec Says (and Does Not Say) About Threads](#what-the-go-spec-says-and-does-not-say-about-threads)
3. [The Go Runtime Documentation](#the-go-runtime-documentation)
4. [POSIX Threads (`pthreads`)](#posix-threads-pthreads)
5. [Linux `clone(2)` Reference](#linux-clone2-reference)
6. [The Go Memory Model and Thread Visibility](#the-go-memory-model-and-thread-visibility)
7. [`runtime` Package APIs Related to Threads](#runtime-package-apis-related-to-threads)
8. [`runtime/metrics` Names Related to Threads](#runtimemetrics-names-related-to-threads)
9. [GMP-Related Versions and Release Notes](#gmp-related-versions-and-release-notes)
10. [`GODEBUG` Knobs Related to Threads](#godebug-knobs-related-to-threads)
11. [`GOMAXPROCS` Specification](#gomaxprocs-specification)
12. [Cgroup Integration Specification](#cgroup-integration-specification)
13. [References](#references)

---

## Introduction

This file catalogues *normative* sources for goroutine and thread behaviour. Anything not stated here is implementation detail and may change between Go versions. Distinguishing "guaranteed" from "current behaviour" is critical for writing portable, future-proof Go.

---

## What the Go Spec Says (and Does Not Say) About Threads

The Go Programming Language Specification (`https://go.dev/ref/spec`) uses the word **"goroutine"** and never **"thread"** (except in `runtime.LockOSThread` documentation, which is package documentation, not the spec). The spec's *Go statements* section reads:

> A "go" statement starts the execution of a function call as an independent concurrent thread of control, or goroutine, within the same address space.

This is the only mention of "thread" in the language spec, and it is loose — "thread of control" is colloquial. The spec deliberately leaves goroutine-to-OS-thread mapping unspecified.

### What the spec does specify

- A `go` statement starts a goroutine.
- All goroutines share an address space.
- Goroutine creation does not block the caller (except for argument evaluation).
- Return values from `go` statements are discarded.

### What the spec does not specify

- Whether goroutines are 1:1 with OS threads, M:N multiplexed, or coroutines.
- How many OS threads are created.
- Which OS thread a goroutine runs on.
- Whether goroutines can migrate between OS threads.
- Whether OS threads of a Go program are visible to the OS as such.

This freedom is intentional. The Go runtime can change scheduler algorithm and threading model between releases without breaking the language guarantee. Go 1 → Go 2 may not change this.

### Practical consequence

User code must not assume:

- A particular thread ID for a goroutine.
- Affinity of a goroutine to a thread (without `LockOSThread`).
- Direct correspondence between goroutine count and thread count.

User code may assume:

- Goroutines share memory.
- The runtime will eventually schedule a runnable goroutine.
- Synchronisation primitives (channels, mutexes, atomics) work across goroutines regardless of which thread runs them.

---

## The Go Runtime Documentation

The `runtime` package (`https://pkg.go.dev/runtime`) documents the public API that controls (and inspects) the goroutine-thread relationship. Excerpts:

### `runtime.GOMAXPROCS`

> GOMAXPROCS sets the maximum number of CPUs that can be executing simultaneously and returns the previous setting. It defaults to the value of runtime.NumCPU. If n < 1, it does not change the current setting. This call will go away when the scheduler improves.

The "this call will go away" caveat is from 2012 and remains in the docs. The scheduler has improved enormously since then, but `GOMAXPROCS` is still there. Treat the comment as aspirational.

### `runtime.NumCPU`

> NumCPU returns the number of logical CPUs usable by the current process. The set of available CPUs is checked by querying the operating system at process startup. Changes to operating system CPU allocation after process startup are not reflected.

Importantly: "usable by the current process." On Linux, this respects `sched_setaffinity` if set before process start. As of Go 1.16+, it also respects cgroup CPU quota (rounded up).

### `runtime.NumGoroutine`

> NumGoroutine returns the number of goroutines that currently exist.

No surprises. Includes runtime-internal goroutines (sysmon, GC workers, finalizer).

### `runtime.LockOSThread`

> LockOSThread wires the calling goroutine to its current operating system thread. The calling goroutine will always execute in that thread, and no other goroutine will execute in it, until the calling goroutine has made as many calls to UnlockOSThread as to LockOSThread. If the calling goroutine exits without unlocking the thread, the thread will be terminated.

Key normative claims:

- The locked goroutine *only* runs on its locked thread.
- No other goroutine runs on the locked thread.
- The lock is reference-counted (matching `Lock` / `Unlock` calls).
- Goroutine exit while locked terminates the thread.

### `runtime.UnlockOSThread`

> UnlockOSThread undoes an earlier call to LockOSThread. If this drops the locking count to zero, it unwires the calling goroutine from its fixed operating system thread. If there are no active LockOSThread calls, this is a no-op.

### `runtime.Goexit`

> Goexit terminates the goroutine that calls it. No other goroutine is affected.

Calling Goexit on the main goroutine: program continues (with other goroutines). Notable difference from returning from `main`.

### `runtime.Gosched`

> Gosched yields the processor, allowing other goroutines to run. It does not suspend the current goroutine, so execution resumes automatically.

Yields the M (the OS thread) to other Gs *if any are runnable*. If none are, returns immediately.

---

## POSIX Threads (`pthreads`)

POSIX threads are the underlying abstraction the Go runtime uses on Unix-like systems. Brief reference for comparison:

### `pthread_create(3)`

```c
int pthread_create(pthread_t *thread, const pthread_attr_t *attr,
                   void *(*start_routine)(void *), void *arg);
```

- Allocates a thread descriptor, a stack (default ~8 MB on Linux), and pushes it to the kernel's run queue.
- On Linux, implemented via `clone(2)` with flags similar to those Go's runtime uses.
- Returns immediately; the new thread starts asynchronously.

### `pthread_join(3)`

```c
int pthread_join(pthread_t thread, void **retval);
```

- Blocks until `thread` returns.
- Retrieves the thread's return value (a `void *`).

Goroutines have no `Join` equivalent. Use `sync.WaitGroup` or `errgroup`.

### `pthread_cancel(3)`

```c
int pthread_cancel(pthread_t thread);
```

- Requests that `thread` be cancelled. The thread acts on this at cancellation points.

Goroutines have no equivalent. Use `context.Context`.

### `pthread_self(3)`

Returns the calling thread's ID. Goroutines have no equivalent public API.

### Stack size

`pthread_attr_setstacksize` allows setting per-thread stack size. Goroutines start at 2 KB and grow.

### Thread-local storage

`pthread_key_create` + `pthread_getspecific`. Goroutines have no equivalent (no goroutine-local storage by design; use `context.Context`).

---

## Linux `clone(2)` Reference

`clone(2)` is the Linux syscall the Go runtime uses for thread creation. Reference: `man 2 clone`.

```
int clone(int (*fn)(void *), void *child_stack, int flags, void *arg, ...);
```

Relevant flags used by the Go runtime:

| Flag | Effect |
|---|---|
| `CLONE_VM` | The child shares the calling process's virtual memory. |
| `CLONE_FS` | Child shares filesystem context (cwd, root, umask). |
| `CLONE_FILES` | Child shares the file descriptor table. |
| `CLONE_SIGHAND` | Child shares signal handlers (must be combined with `CLONE_VM`). |
| `CLONE_THREAD` | Child is part of the same thread group as the caller. Combined with `CLONE_SIGHAND`. |
| `CLONE_SYSVSEM` | Shares System V semaphore undo lists. |
| `CLONE_SETTLS` | Sets the TLS pointer for the new thread (used by Go assembly). |

`CLONE_THREAD` implies `CLONE_SIGHAND` and `CLONE_VM`. Without `CLONE_THREAD`, the call creates a process, not a thread.

### `clone3(2)` (newer)

Linux 5.3+ adds `clone3(2)`, a structured version. Go runtime may use it on newer kernels. Functionally similar.

---

## The Go Memory Model and Thread Visibility

The Go memory model (`https://go.dev/ref/mem`) is the formal contract between goroutines. It does not mention threads at all.

Key normative points:

- A read of variable `v` is guaranteed to see a write of `v` only if there is a *happens-before* relationship between them.
- Happens-before is established by goroutine creation, channel ops, mutex ops, atomic ops, `WaitGroup`, `Once`, etc.

Why this matters for thread/goroutine equivalence:

- The memory model talks about goroutines, not threads.
- If your code is correct under the memory model, it is thread-safe regardless of how the runtime maps goroutines to threads.
- Conversely, "thread-safe" intuitions from other languages may not apply to Go: a single goroutine can be interrupted by the scheduler at almost any instruction (since async preemption); operations that are atomic at the assembly level may not be atomic at the language level.

### Word-tearing

Go memory model says (since the 2022 revision): "Implementations should make multi-word values… read/write as a single operation if possible. However, … implementations may tear large operations." So `int32`, `int64` on a 64-bit machine are usually atomic on access, but the spec does not promise it. Use `sync/atomic` or other synchronisation for shared multi-word values.

---

## `runtime` Package APIs Related to Threads

| API | Purpose |
|---|---|
| `runtime.NumGoroutine()` | Live goroutine count. |
| `runtime.GOMAXPROCS(n)` | Get/set the GOMAXPROCS. |
| `runtime.NumCPU()` | Logical CPUs usable. |
| `runtime.LockOSThread()` | Pin calling goroutine to its current OS thread. |
| `runtime.UnlockOSThread()` | Release the pin. |
| `runtime.Goexit()` | Terminate calling goroutine. |
| `runtime.Gosched()` | Yield. |
| `runtime.Stack(buf, all)` | Stack trace of current goroutine, or all goroutines. |
| `runtime.SetFinalizer(obj, fn)` | Schedule a finalizer (runs in a goroutine). |

Notably absent:

- No goroutine ID API.
- No "current thread ID" API (use `runtime.LockOSThread` + `syscall.Gettid` on Linux).
- No "set goroutine name" API.

---

## `runtime/metrics` Names Related to Threads

Go 1.16+ provides structured runtime metrics via `runtime/metrics`. Relevant names:

| Metric | Description |
|---|---|
| `/sched/gomaxprocs:threads` | Current `GOMAXPROCS`. |
| `/sched/goroutines:goroutines` | Live goroutines (same as `runtime.NumGoroutine()`). |
| `/sched/latencies:seconds` | Histogram of scheduler latency. |
| `/sched/pauses/total/gc:seconds` | Total GC pause time. |
| `/cgo/go-to-c-calls:calls` | Total cgo calls Go → C. |

Read with `runtime/metrics.Read`:

```go
samples := []metrics.Sample{
    {Name: "/sched/gomaxprocs:threads"},
    {Name: "/sched/goroutines:goroutines"},
}
metrics.Read(samples)
for _, s := range samples {
    fmt.Println(s.Name, s.Value.Uint64())
}
```

There is **no** public metric for "total OS threads" — that must be obtained via OS APIs (`/proc/self/status` on Linux).

---

## GMP-Related Versions and Release Notes

| Go version | Threading-relevant change |
|---|---|
| 1.0 (2012) | Initial cooperative scheduler; `GOMAXPROCS=1` default. |
| 1.1 (2013) | M:N scheduler with `P` abstraction introduced (Dmitry Vyukov). |
| 1.4 (2014) | Initial 2 KB goroutine stack reduced from 8 KB. Concurrent GC. |
| 1.5 (2015) | `GOMAXPROCS` defaults to `NumCPU`. |
| 1.10 (2018) | `LockOSThread` improvements: terminating the goroutine terminates the thread. |
| 1.14 (2020) | **Asynchronous preemption** via `SIGURG`. Tight loops are now preemptable. |
| 1.16 (2021) | Runtime reads Linux cgroup v1 CPU quota for `GOMAXPROCS`. |
| 1.17 (2021) | Register-based ABI. Reduces per-call overhead. |
| 1.18 (2022) | Generics. Memory model revised (formalises atomics, weak memory). |
| 1.20 (2023) | `runtime/coverage` integration; scheduler tweaks for low-latency. |
| 1.21 (2023) | `runtime/metrics` adds latency metrics. Backwards-compatible default `GODEBUG`. |
| 1.22 (2024) | `for` loop variable scope change (fixes captured-variable goroutine bug). |
| 1.23 (2024) | Plan9-port maintenance. `runtime` traces include cgo. |

Compatibility promise: language semantics are stable across Go 1; the scheduler implementation is *not* part of the promise. New scheduler features may appear, old behaviour may change as long as observable semantics hold.

---

## `GODEBUG` Knobs Related to Threads

Environment variables that control scheduler / thread behaviour. **Not part of Go 1 compatibility promise.** Use for diagnostics, not production.

| Knob | Effect |
|---|---|
| `GODEBUG=schedtrace=N` | Every N ms, print scheduler stats: `gomaxprocs`, `threads`, `idlethreads`, `idleprocs`, `runqueue`. |
| `GODEBUG=scheddetail=1` | When `schedtrace` is on, also print per-G/per-M/per-P state. |
| `GODEBUG=asyncpreemptoff=1` | Disable async preemption (regression to pre-1.14 cooperative behaviour). |
| `GODEBUG=cgocheck=2` | Thorough check for invalid pointer passing across cgo. |
| `GODEBUG=allocfreetrace=1` | Print stack traces for every allocation / free. Very chatty. |
| `GODEBUG=gctrace=1` | Print GC events; affects scheduling timing. |
| `GODEBUG=netdns=cgo` / `go` | Choose between cgo-based and pure-Go DNS resolver. cgo-based holds Ms during resolution. |
| `GODEBUG=tracebackancestors=N` | Show `N` levels of goroutine creators in stack traces. |
| `GOMAXPROCS=N` (env) | Set `GOMAXPROCS` at program start. |
| `GOTRACEBACK=all` | On panic, print stacks of all goroutines (default is current only). |
| `GOTRACEBACK=crash` | On panic, dump core. |
| `GOTRACEBACK=system` | Show extra runtime detail in tracebacks. |
| `GODEBUG=tracebackswarmancestors=N` | (Newer Go versions) Limit creator-ancestor depth. |

Documented at `https://pkg.go.dev/runtime#hdr-Environment_Variables`.

### Reading `schedtrace` output

Example line:

```
SCHED 1000ms: gomaxprocs=4 idleprocs=0 threads=11 spinningthreads=1 needspinning=0 idlethreads=4 runqueue=12 [3 5 2 2]
```

| Field | Meaning |
|---|---|
| `gomaxprocs` | Current `GOMAXPROCS`. |
| `idleprocs` | Ps with nothing to do. |
| `threads` | Total Ms (running + parked + in-syscall). |
| `spinningthreads` | Ms actively looking for work. |
| `needspinning` | Counter for "need more spinning Ms." |
| `idlethreads` | Parked Ms in the M-pool. |
| `runqueue=12` | Global runqueue size. |
| `[3 5 2 2]` | Per-P runqueue sizes. |

Spinning Ms briefly burn CPU when looking for work — usually for ~30 µs. High `spinningthreads` consistently is unusual.

---

## `GOMAXPROCS` Specification

### Default value

- Pre-1.5: `1`.
- 1.5+: `runtime.NumCPU()`.
- 1.16+ on Linux: `max(1, ceil(cgroup_quota_cpus))`. Pre-1.16: just `NumCPU()`.
- 1.18+: cgroup v1 and v2 both supported on Linux.

### Setting

Three ways:

1. `GOMAXPROCS` environment variable at startup.
2. `runtime.GOMAXPROCS(n)` at any time.
3. Default (auto-detected).

### Behaviour when `n < 1`

`runtime.GOMAXPROCS(0)` reads the current value (does not change).
`runtime.GOMAXPROCS(-1)` reads the current value (does not change).

For `n >= 1`, sets to `n` and returns the old value.

### Constraints

- No upper bound enforced by the language. Setting `GOMAXPROCS=10000` will succeed; the scheduler will struggle.
- Changing `GOMAXPROCS` while goroutines are running causes the runtime to add or remove Ps; runnable Gs are redistributed.

### Best-practice constraint

- Never set above `NumCPU`. No throughput benefit; adds scheduler overhead.
- Set below `NumCPU` only if sharing the box with other CPU-intensive processes.

---

## Cgroup Integration Specification

Go's cgroup-aware `GOMAXPROCS` (1.16+ on Linux) reads:

- **cgroup v1**: `/sys/fs/cgroup/cpu/<self-cgroup>/cpu.cfs_quota_us` divided by `cpu.cfs_period_us`.
- **cgroup v2**: `/sys/fs/cgroup/<self-cgroup>/cpu.max`.

If the cgroup has no quota, falls back to `NumCPU()`. If quota is fractional (e.g., 0.5), rounds up to 1.

This is what `go.uber.org/automaxprocs` does for older Go versions or non-Linux containers.

### Common quota expressions

| Kubernetes resource | Linux cgroup | Resulting GOMAXPROCS (Go 1.16+) |
|---|---|---|
| `cpu: 500m` | 50 ms / 100 ms | 1 |
| `cpu: 1` | 100 ms / 100 ms | 1 |
| `cpu: 2500m` | 250 ms / 100 ms | 3 |
| `cpu: 4` | 400 ms / 100 ms | 4 |
| (no limit) | (no quota) | `NumCPU()` |

### Caveats

- Reading the cgroup once at startup. Quota changes after startup are not detected.
- `cpu: 200m` requesting 0.2 CPU sets `GOMAXPROCS=1` (rounded up). The pod is throttled by the kernel, not by the Go runtime.

---

## References

- **Go Language Specification** — Go statements: <https://go.dev/ref/spec#Go_statements>
- **Go Memory Model** (revised 2022): <https://go.dev/ref/mem>
- **`runtime` package**: <https://pkg.go.dev/runtime>
- **`runtime/metrics` package**: <https://pkg.go.dev/runtime/metrics>
- **POSIX Threads** — Open Group Specification: <https://pubs.opengroup.org/onlinepubs/9699919799/basedefs/pthread.h.html>
- **`man 7 pthreads`** — overview on Linux.
- **`man 2 clone`** — Linux clone syscall reference.
- **`man 2 gettid`** — thread ID.
- **`man 7 cgroups`** — Linux cgroups overview.
- **`man 7 cgroups-v2`** — cgroup v2.
- **Design doc: Non-cooperative goroutine preemption** (Austin Clements, 2018): <https://github.com/golang/proposal/blob/master/design/24543-non-cooperative-preemption.md>
- **Design doc: Scalable Go Scheduler** (Dmitry Vyukov, 2012): <https://docs.google.com/document/d/1TTj4T2JO42uD5ID9e89oa0sLKhJYD0Y_kqxDv3I3XMw>
- **HACKING.md** — runtime invariants: <https://github.com/golang/go/blob/master/src/runtime/HACKING.md>
- **`proc.go`** — Go runtime scheduler source: <https://github.com/golang/go/blob/master/src/runtime/proc.go>
- **`os_linux.go`** — Linux-specific runtime: <https://github.com/golang/go/blob/master/src/runtime/os_linux.go>
- **`netpoll.go`** — netpoller: <https://github.com/golang/go/blob/master/src/runtime/netpoll.go>
- **`signal_unix.go`** — Unix signal handling: <https://github.com/golang/go/blob/master/src/runtime/signal_unix.go>
- **`go.uber.org/automaxprocs`** — cgroup-aware `GOMAXPROCS` for older Go: <https://github.com/uber-go/automaxprocs>
- **Project Loom** — JDK virtual threads (analogue of goroutines): <https://openjdk.org/projects/loom/>
- **"Scheduling Multithreaded Computations by Work Stealing"** (Blumofe & Leiserson, 1994): seminal paper on work-stealing schedulers.
- **"The Implementation of Lua 5.0"** — coroutine-based scheduling for comparison.
- **GopherCon 2020: Pardon the Interruption** (Austin Clements): <https://www.youtube.com/watch?v=1I1WmeSjRSw>
- **GopherCon 2018: The Scheduler Saga** (Kavya Joshi): <https://www.youtube.com/watch?v=YHRO5WQGh0k>
