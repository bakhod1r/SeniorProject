# `LockOSThread` Performance — Junior Level

> This page assumes you have read [01-goroutines/02-vs-os-threads/junior.md](../../01-goroutines/02-vs-os-threads/junior.md). There you learned **what** a goroutine and an OS thread are, and **what** `runtime.LockOSThread` does at the semantic level. Here we focus on what pinning **costs** and **buys** for performance — how to think about it as a tuning knob, when it helps, when it hurts, and how to measure either case for yourself.

## Table of Contents

1. [Introduction](#introduction)
2. [What "Pinning" Means in One Picture](#what-pinning-means-in-one-picture)
3. [Why Performance Cares About Pinning](#why-performance-cares-about-pinning)
4. [The Scheduler Loses Flexibility](#the-scheduler-loses-flexibility)
5. [One Pinned Goroutine, One Retired M](#one-pinned-goroutine-one-retired-m)
6. [Cost Component: Lost Work-Stealing](#cost-component-lost-work-stealing)
7. [Cost Component: Forced M Creation](#cost-component-forced-m-creation)
8. [Cost Component: Preemption Becomes a Signal](#cost-component-preemption-becomes-a-signal)
9. [Benefit: Stable TLS and Cache Locality](#benefit-stable-tls-and-cache-locality)
10. [Benefit: cgo Amortisation](#benefit-cgo-amortisation)
11. [Benefit: Thread-Affine APIs Work At All](#benefit-thread-affine-apis-work-at-all)
12. [The Mental Model: A Bouncer at One Door](#the-mental-model-a-bouncer-at-one-door)
13. [Your First Benchmark: Pinned vs Unpinned](#your-first-benchmark-pinned-vs-unpinned)
14. [Counting Threads After Pinning](#counting-threads-after-pinning)
15. [The Single-Owner Pattern in One Page](#the-single-owner-pattern-in-one-page)
16. [Common Wrong Reasons to Pin](#common-wrong-reasons-to-pin)
17. [Common Right Reasons to Pin](#common-right-reasons-to-pin)
18. [Pinning and `GOMAXPROCS`: a Simple Rule](#pinning-and-gomaxprocs-a-simple-rule)
19. [Measuring Pinning's Effect on Throughput](#measuring-pinnings-effect-on-throughput)
20. [Measuring Pinning's Effect on Latency](#measuring-pinnings-effect-on-latency)
21. [The Forgotten `UnlockOSThread`](#the-forgotten-unlockosthread)
22. [Pinning Inside a Library: Don't](#pinning-inside-a-library-dont)
23. [A Pinned Goroutine That Panics](#a-pinned-goroutine-that-panics)
24. [What `GODEBUG=schedtrace` Shows](#what-godebugschedtrace-shows)
25. [Tiny Worked Example: Pinned Counter vs Atomic](#tiny-worked-example-pinned-counter-vs-atomic)
26. [Glossary](#glossary)
27. [Self-Check Quiz](#self-check-quiz)
28. [Hands-On Lab](#hands-on-lab)
29. [Summary](#summary)

---

## Introduction

`runtime.LockOSThread` is one of the smallest functions in the Go runtime API and one of the easiest to misuse. The call itself is two lines of documentation: *the goroutine that calls it will, from then on, run only on the OS thread it was running on when it called.* The pair, `runtime.UnlockOSThread`, undoes it. That is all.

The performance story is much larger. Pinning a goroutine to a thread is not free, and it is not always paid for by the thing you pinned for. The thread the goroutine sits on cannot run any other goroutine while the pinned one exists. The runtime's scheduler, which is built around the assumption that goroutines and threads are mostly interchangeable, loses one of its degrees of freedom for every pinned goroutine. If you pin sloppily, you can convert a healthy Go program into something that looks suspiciously like a thread-per-request server with one thread per pinned task.

The flip side: there are workloads where pinning saves more than it costs. The classic ones are cgo into thread-affine libraries (OpenGL, certain crypto contexts, namespace manipulation) and tight loops that benefit from stable cache and TLS state. In those cases, a single goroutine pinned to a thread for the lifetime of the program is the right answer, and the cost is bounded to one M instead of growing with the request count.

This page is the junior view. We focus on:

- **What pinning costs**, broken into named components.
- **What pinning buys**, broken into the same named components.
- **How to benchmark** the difference yourself in 20 lines of code.
- **The one pattern** — a single owner goroutine with a channel of work — that captures almost all production uses.

The senior and professional pages dig into the runtime mechanics, the `tgkill` preemption path, NUMA, and the production architectures that use pinning intentionally. Read those once you can finish the benchmarks here.

---

## What "Pinning" Means in One Picture

The Go scheduler has three primary entities. The semantics page lays them out in detail; here is the abridged sketch:

```
G  = goroutine (lightweight, runtime-scheduled)
M  = OS thread (heavyweight, kernel-scheduled)
P  = processor (a scheduling slot; up to GOMAXPROCS of them)

To run a G, the runtime binds it to a P, which is held by an M.
Normally, any G can land on any M via any P; the runtime moves them around.
```

`LockOSThread` changes one rule: the calling G can now run **only** on the specific M it is currently on. The M, in turn, can run **only** that G (it cannot pick up another G until the lock releases). The P bound to that M is the one G's P; if the G blocks in a syscall, the runtime usually detaches the P from the M (to keep other Gs running), but the M is still glued to G.

In one picture:

```
Before LockOSThread:
  Gs ↔ Ps ↔ Ms   (free movement)

After G1 calls LockOSThread on M3:
  G1 ⟷ M3        (locked together)
  Other Gs ↔ remaining Ms

When G1 returns (or calls UnlockOSThread), the lock breaks.
If G1 exits while locked, the M exits too.
```

This is the entire mechanism. Every performance consequence flows from it.

---

## Why Performance Cares About Pinning

Three reasons, in order of importance for most services:

1. **Throughput.** The runtime tunes thread count to roughly `GOMAXPROCS`. Each pinned goroutine removes one effective slot from the pool of slots available for normal work. If you pin three goroutines on a `GOMAXPROCS=4` machine, you have one M left for everything else. The remaining Gs queue.

2. **Tail latency.** If a request-handling goroutine pins itself (or runs on a pinned M because of cgo), it cannot be moved off when the M is busy. Preempting a pinned G is slower than preempting a normal one, because the runtime cannot just move the G to another M; it must wait for the G to yield, or it sends a signal (`SIGURG` on Linux) via the `tgkill` syscall.

3. **Memory.** Each M has a stack (typically 8 MB virtual; only the pages actually touched cost physical memory). Each pinned goroutine retires one M. If pinning is used as a per-request pattern (it shouldn't be), thread count and M-stack memory rise linearly with concurrency.

For most Go services, pinning is performance-relevant exactly when one of the following is true:

- You use **cgo** into a thread-affine library.
- You manipulate **OS-level state** (namespaces, signal masks, `setuid`) that the kernel tracks per-thread.
- You have a **hot CPU loop** where cache and TLS locality dominate.

If none of those apply, the right amount of pinning in your service is zero, and that is the choice with the best performance.

---

## The Scheduler Loses Flexibility

The Go scheduler is good at three things:

- **Work-stealing.** When a P runs out of runnable Gs, it steals from another P. This keeps cores busy.
- **Hand-off.** When a G blocks in a syscall, the scheduler hands the P to another M so other Gs keep running on that core.
- **Preemption.** When a G runs too long without yielding, the runtime preempts it (via `SIGURG` since Go 1.14) so other Gs get CPU time.

A pinned G partially defeats all three:

- **Work-stealing.** A pinned G cannot be stolen. If the M holding it is idle, the runtime can still steal *other* Gs to other Ms — but the pinned slot is wasted.
- **Hand-off.** When a pinned G blocks in a syscall, the runtime hands the P off, so Go-side throughput is preserved. But the M stays glued to the pinned G; thread count is not recovered.
- **Preemption.** A pinned G can still be preempted (the runtime sends a signal to the M). But the preemption is more expensive: a kernel signal is sent (~µs), and the G cannot be moved to a less-loaded M afterward.

The scheduler is built around the assumption that Ms are interchangeable. Pinning violates the assumption. Whenever you pin, you trade scheduler quality for some other property — thread-local state, cache locality, cgo amortisation. The trade can be worth it; it is never free.

---

## One Pinned Goroutine, One Retired M

The single most important number to internalise: **one pinned goroutine retires exactly one M for as long as it stays pinned**.

That M can still do other work *for that goroutine* — run its Go code, enter and exit syscalls, run blocking C calls — but it cannot pick up another goroutine. If you have `GOMAXPROCS=4` and you pin three goroutines, you have:

- 3 Ms doing the three pinned jobs.
- 1 M doing everything else (or the runtime grows more, see next section).

If the three pinned jobs are tiny (waking up once per second), you wasted three Ms full-time for negligible work. If the three pinned jobs are heavy (busy-looping on a single channel), you have a healthy program; you simply have a fixed-size thread pool by another name.

The first design question for any pinning candidate is:

> Is this work heavy enough — and stable enough — that retiring one full M for it is acceptable?

If yes: pin once at startup, never per request. If no: do not pin.

---

## Cost Component: Lost Work-Stealing

Work-stealing is what keeps Go scheduler latency low under uneven workloads. The runtime measures (via the `/sched/latencies:seconds` histogram in `runtime/metrics`) how long a runnable G waits before getting a P. A healthy service is sub-millisecond.

When you pin enough goroutines to noticeably reduce the pool of stealable Ms, that histogram shifts right. The pattern is visible:

- Long-tail scheduler latency rises.
- Throughput plateaus before CPU saturation.
- Tail latency of unrelated requests degrades.

The math: if the unpinned workload uses `n` Ms perfectly load-balanced, and you pin `k` of them away, the remaining work compresses onto `n−k` Ms. The runtime will grow new Ms to compensate (next section), but the new Ms start cold (cache misses, no per-M caches warmed) and the controller takes a moment to react. During that moment, throughput dips.

For workloads where pinning is per-request (don't do this), the histogram never recovers; new pinned Ms are constantly being created and destroyed, and work-stealing is always limping.

---

## Cost Component: Forced M Creation

Go does not have a hard cap on threads. (`debug.SetMaxThreads` exists; the default is 10 000.) When all existing Ms are busy and the runtime sees a runnable G with no free P, it creates a new M via the `clone(2)` syscall on Linux (`bsdthread_create` on macOS, `CreateThread` on Windows).

Pinning interacts with M creation in two ways:

1. **The pin holds an M permanently.** That M is not available for the runtime's pool. If three goroutines are pinned, three Ms are out of circulation regardless of whether they are doing useful work.

2. **Saturation forces growth.** If your service ran with 8 Ms before pinning, and you pin 3, the runtime will quickly create 3 more to recover throughput. Now your process has 11 Ms instead of 8. Each new M costs roughly 8 KB of kernel structure plus an 8 MB virtual stack reservation (only physical pages touched count).

Creating an M is not free either. The first time the runtime does a `clone(2)`, you pay ~10–50 µs. After it exists, you pay nothing additional until it sleeps and wakes. But if your pinning pattern causes Ms to come and go (don't), each cycle is microseconds of pure overhead.

---

## Cost Component: Preemption Becomes a Signal

Since Go 1.14, the runtime preempts long-running goroutines by sending `SIGURG` to the OS thread that holds them. The signal handler interrupts the G at a safe point and parks it back on the P's run queue.

For a normal (unpinned) G, preemption is followed by the runtime moving the G to whichever M picks it up first. For a pinned G, the runtime cannot move it; preemption only achieves "let some other G on this M run." If the M was holding only the pinned G (the common case), preemption is wasted — there is nothing else on it to run.

Concretely:

- Preempting a pinned G involves a `tgkill(2)` syscall (delivering `SIGURG` to that specific thread).
- The kernel signal cost is a few microseconds.
- The Go runtime then has to switch into the signal handler, save G state, and decide what to do next.

If your pinned goroutine spends 100% of its time on the same M, preemption attempts are essentially noise that costs some scheduler CPU. Usually fine. But for code that depends on every microsecond — high-frequency trading–style hot loops — even the noise matters. Some teams disable preemption on those threads explicitly (`GODEBUG=asyncpreemptoff=1` globally; there is no per-thread switch in stock Go).

---

## Benefit: Stable TLS and Cache Locality

The pinning cost components are real. The benefits, when they apply, are real too.

**Thread-local storage.** Every OS thread has its own TLS area. When a goroutine moves between Ms, any thread-local state of the M (FS:base on x86_64, errno location, `__thread` variables in cgo) does not move with it. If a goroutine reads a TLS variable then makes a function call that lets the scheduler move it, the second read may land on a different M, with different TLS contents.

Most Go code does not see this because Go does not use TLS directly. But cgo does — every C library that uses `errno`, `setlocale`, OpenGL contexts, CUDA contexts, or `__thread` variables touches TLS. Pinning makes that TLS stable across all calls from the pinned goroutine.

**Cache locality.** When a G runs on M3 then is rescheduled onto M7, all the L1 and L2 cache lines that M3 had warm are now stale. The new M starts cold. For most service workloads this is invisible — the request is short enough that cold cache barely matters. For tight loops that re-touch the same data structure thousands of times per second, the locality is measurable: 5–15% throughput improvement when the loop stays on one M.

Pinning a hot loop is a niche choice. Most teams should not, because the cost of retiring an M usually outweighs the cache-locality gain. But if you have measured the loop, identified that it dominates throughput, and confirmed cache misses are the bottleneck, pinning can be a reasonable tool. Always benchmark, not assume.

---

## Benefit: cgo Amortisation

Every cgo call has overhead — the runtime does some bookkeeping to mark the M as "in cgo," save the goroutine state, and hand off the P to another M so Go-side work continues. On x86_64 Linux with current Go versions, this overhead is roughly 50–200 ns per call.

If your goroutine makes thousands of cgo calls per second to the same library, each call pays the bookkeeping again. By pinning the goroutine to a single M:

- The "hand off P" step still happens, but the M does not have to be re-acquired afterward.
- TLS-bound C state (OpenGL context, locale) is stable.
- Some C runtimes cache state per thread (e.g., glibc's `malloc` arena); a stable thread improves arena locality.

Measured savings on `LockOSThread` for tight cgo loops are typically 5–25% on call rate, depending on what the C function does. The exact number varies by Go version. Always benchmark.

This is the strongest single performance argument for `LockOSThread`. If you have a cgo-heavy hot path, the single-owner pattern (see below) is worth setting up. If your cgo path is occasional (a handful of calls per request), the savings are too small to justify the M cost.

---

## Benefit: Thread-Affine APIs Work At All

Some C/OS APIs are not "fast on the same thread" — they are *only correct* on a specific thread.

- **OpenGL.** A GL context is owned by exactly one OS thread. Calls on a different thread are undefined behaviour.
- **Linux namespaces.** `setns(2)` and `unshare(2)` change *the calling thread's* namespace. Other threads in the process are unaffected. If you want to do work in a different network namespace, you must do it on the thread that called `setns`.
- **`syscall.Setuid` and friends.** Some uid/gid switches on Linux are per-thread (until recent kernel patches that made them process-wide).
- **CUDA contexts.** A CUDA context is bound to a thread. Calls from another thread fail.
- **Certain crypto HSM APIs.** Per-thread session state.

For these, pinning is not an optimisation — it is the only way to use the API correctly. The "performance" question is whether the architecture around the pinned goroutine is efficient, not whether to pin at all.

The single-owner pattern (next section) is how you build a Go-friendly facade over a thread-affine API while pinning exactly one goroutine.

---

## The Mental Model: A Bouncer at One Door

A useful image. Imagine a club with `GOMAXPROCS` doors, each watched by a bouncer (an M). Customers (goroutines) line up; whichever door is free, they walk through. The bouncer at each door watches who is inside and waves them on when they leave.

`LockOSThread` is: one customer says, *"I'm hosting a private party in this room; until I leave, only I use this door."* The bouncer is still on duty, but for that customer only. The other doors are now serving the entire remaining customer base.

If three customers run private parties, the club has one bouncer serving everyone else. If the club hires temp bouncers (creates new Ms), now it has five bouncers for the same building, three of them doing nothing but watching one door each.

That image catches most of the cost/benefit reasoning. A private party is the right call when the customer brought equipment (TLS state, GPU context) that cannot be shared. A private party is a bad call for someone who just wanted to dance — the cost to the rest of the club is the same either way.

---

## Your First Benchmark: Pinned vs Unpinned

Let's measure pinning's overhead on pure Go code, where pinning gives no benefit (because there is no TLS or cgo state). The number tells you the floor cost of pinning.

```go
package main

import (
    "runtime"
    "sync"
    "testing"
)

func work() int {
    n := 0
    for i := 0; i < 1000; i++ {
        n += i
    }
    return n
}

func BenchmarkUnpinned(b *testing.B) {
    var wg sync.WaitGroup
    for i := 0; i < b.N; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            _ = work()
        }()
    }
    wg.Wait()
}

func BenchmarkPinned(b *testing.B) {
    var wg sync.WaitGroup
    for i := 0; i < b.N; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            runtime.LockOSThread()
            defer runtime.UnlockOSThread()
            _ = work()
        }()
    }
    wg.Wait()
}
```

Run with `go test -bench=. -benchmem`. On a quiet 8-core Linux box you will typically see something like:

```
BenchmarkUnpinned-8   2000000   600 ns/op
BenchmarkPinned-8     1000000  1400 ns/op
```

That is, ~800 ns of overhead per pinned goroutine compared to unpinned, when the goroutine does almost nothing. The cost is dominated by lost scheduling flexibility and (on some Go versions) M-pool churn. For real workloads the relative cost shrinks (because the work itself is much larger than the pin overhead), but the *absolute* cost stays in the same range.

The takeaway: pinning is not "almost free." It is a measurable overhead. Use it deliberately.

---

## Counting Threads After Pinning

The most direct check that pinning is doing what you expect is reading the OS thread count of your process.

On Linux:

```go
package main

import (
    "fmt"
    "os"
    "runtime"
    "strings"
    "time"
)

func threadCount() int {
    data, _ := os.ReadFile("/proc/self/status")
    for _, line := range strings.Split(string(data), "\n") {
        if strings.HasPrefix(line, "Threads:") {
            var n int
            fmt.Sscanf(line, "Threads: %d", &n)
            return n
        }
    }
    return -1
}

func pinned(done chan struct{}) {
    runtime.LockOSThread()
    defer runtime.UnlockOSThread()
    <-done
}

func main() {
    fmt.Println("before:", threadCount())
    done := make(chan struct{})
    for i := 0; i < 4; i++ {
        go pinned(done)
    }
    time.Sleep(100 * time.Millisecond)
    fmt.Println("after pinning 4:", threadCount())
    close(done)
    time.Sleep(100 * time.Millisecond)
    fmt.Println("after release:", threadCount())
}
```

Sample output on a 4-core Linux machine:

```
before: 6
after pinning 4: 10
after release: 10
```

Four pinned goroutines added four threads. Note that the runtime did not reduce the thread count after `UnlockOSThread`: an M does not exit just because nothing is pinned to it anymore. Ms are pooled and reused.

For Go 1.21+, you can also use `runtime/metrics`:

```go
import "runtime/metrics"

samples := []metrics.Sample{{Name: "/sched/threads:threads"}}
metrics.Read(samples)
fmt.Println("threads:", samples[0].Value.Uint64())
```

This is the portable, in-process way.

---

## The Single-Owner Pattern in One Page

Almost every production use of `LockOSThread` looks like this:

```go
type Worker struct {
    in  chan Job
    out chan Result
}

func New() *Worker {
    w := &Worker{
        in:  make(chan Job, 16),
        out: make(chan Result, 16),
    }
    go w.loop()
    return w
}

func (w *Worker) loop() {
    runtime.LockOSThread()
    defer runtime.UnlockOSThread()
    // Initialise per-thread C state here, e.g.:
    //   C.create_context()
    // defer C.destroy_context()
    for job := range w.in {
        w.out <- process(job)
    }
}

func (w *Worker) Submit(j Job) Result {
    w.in <- j
    return <-w.out
}
```

What it gives you:

- **Exactly one M is retired**, regardless of how many callers Submit jobs.
- **All thread-affine work** (OpenGL, namespace switch, GPU context, pinned cgo) happens on that one M.
- **The rest of the program** stays goroutine-friendly; callers do not need to know they are talking to a pinned worker.

The pattern scales by pooling: have N workers, each pinned, each owning one resource (one GPU, one HSM session). Submit through a dispatch goroutine that load-balances. Thread count grows by exactly N, no more.

The senior page covers production architectures built on this pattern. For now, the picture above is the canonical shape.

---

## Common Wrong Reasons to Pin

Engineers reach for `LockOSThread` for the wrong reasons more often than the right ones:

- **"To make my goroutine 'faster'."** Pure Go code is not faster on a pinned thread. The scheduler is good. If anything, the pin slows the goroutine down by removing it from work-stealing.
- **"To avoid context switches."** Goroutine switches are not OS context switches; they are 50–200 ns of user-space code. Pinning does not reduce them — pinning *prevents M-to-M migration*, not G-to-G switching.
- **"To get a stable thread ID for logging."** Goroutines do not have stable IDs by design. Use `context.Context` for request tracing. If you must have a thread ID for cross-language logging, that is one specific case where pinning *plus* `gettid(2)` is the answer, but it is exotic.
- **"To prevent preemption."** `LockOSThread` does not prevent preemption. The goroutine can still be paused by the runtime via `SIGURG`. To avoid preemption you would need `GODEBUG=asyncpreemptoff=1` (process-wide and discouraged).
- **"To avoid race conditions."** Pinning does not give you exclusive access to data. Multiple goroutines can still touch the same memory; they just do so on different Ms.

If your reason for pinning is any of the above, do not pin.

---

## Common Right Reasons to Pin

Conversely, these are the reasons that justify the M cost:

- **cgo into a thread-affine library** (OpenGL, CUDA, certain crypto HSM SDKs, GUI toolkits, namespaced sockets).
- **OS thread-state operations**: `setns(2)`, `unshare(2)`, certain `prctl(2)` options, per-thread signal masks via `pthread_sigmask`.
- **Hot loops where cache locality is measured** to outweigh the M cost. Rare; almost always the *real* fix is reducing the loop's working set.
- **Owning a kernel-side resource** that the kernel binds to the calling thread (some `io_uring` configurations, perf events, etc.).
- **Specific `setuid`/capability changes** on Linux that are per-thread.

If your reason matches one of these, design the single-owner pattern and pin exactly one goroutine. Do not pin per request.

---

## Pinning and `GOMAXPROCS`: a Simple Rule

A simple budget rule:

> If your program pins `k` goroutines steadily, raise `GOMAXPROCS` by `k` from what it would otherwise be — or accept that you have `GOMAXPROCS − k` effective slots for non-pinned work.

Concretely, on a `GOMAXPROCS=4` host:

- 0 pinned: 4 slots for normal work.
- 1 pinned: 3 slots for normal work, 1 thread permanently busy.
- 4 pinned: 0 slots for normal work; the runtime will create new Ms beyond `GOMAXPROCS` to keep going (it does, because `GOMAXPROCS` caps *runnable* Gs, not Ms).

The third row is dangerous: you accidentally invented a thread-per-task service. New Ms exist, but they create scheduling pressure (every preemption now competes for the kernel's CPU time) and memory cost (each M has a stack reservation). If you find yourself pinning a number close to or exceeding `GOMAXPROCS`, redesign.

The senior page covers the autotuning angle (use `runtime/metrics`'s `/sched/threads:threads` to track the cost).

---

## Measuring Pinning's Effect on Throughput

To know whether pinning helped or hurt your service, run the same workload twice — once with the pin, once without — and compare. The clean way:

```go
package main

import (
    "fmt"
    "runtime"
    "sync"
    "time"
)

func run(pin bool, n, dur int) (ops int64) {
    var wg sync.WaitGroup
    stop := make(chan struct{})
    for i := 0; i < n; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            if pin {
                runtime.LockOSThread()
                defer runtime.UnlockOSThread()
            }
            for {
                select {
                case <-stop:
                    return
                default:
                    // unit of work
                    sum := 0
                    for j := 0; j < 100; j++ {
                        sum += j
                    }
                    _ = sum
                    atomic.AddInt64(&ops, 1)
                }
            }
        }()
    }
    time.Sleep(time.Duration(dur) * time.Second)
    close(stop)
    wg.Wait()
    return ops
}

func main() {
    fmt.Println("unpinned:", run(false, 8, 5))
    fmt.Println("pinned  :", run(true, 8, 5))
}
```

(Add `import "sync/atomic"` and declare `ops` as `int64` outside the goroutines for the snippet to compile. Pull out for clarity in tests.)

You'll typically see throughput drop noticeably for the pinned version when the worker count exceeds `GOMAXPROCS`. That is the cost of lost work-stealing.

---

## Measuring Pinning's Effect on Latency

Throughput is the easy measurement; latency requires more care. Use a histogram (e.g., `hdrhistogram-go` or `runtime/metrics`'s `/sched/latencies:seconds`) and capture the p50 / p99 / p99.9 over a steady-state run.

A direct test:

```go
import (
    "runtime/metrics"
    "time"
)

func sample() {
    s := []metrics.Sample{{Name: "/sched/latencies:seconds"}}
    metrics.Read(s)
    h := s[0].Value.Float64Histogram()
    // process h.Buckets / h.Counts to compute percentiles
}
```

Run the workload pinned, sample; run unpinned, sample. The percentile that usually changes first is p99: pinning shifts long-tail scheduler waits because work-stealing has less freedom.

For request-handling services, end-to-end latency matters more than scheduler latency. Use your service's own histogram (Prometheus, Datadog) and compare.

---

## The Forgotten `UnlockOSThread`

`runtime.LockOSThread` and `runtime.UnlockOSThread` are reference-counted: calling `LockOSThread` twice requires two `UnlockOSThread` calls to release. Most callers should pin exactly once per goroutine and never reach for the counter.

If a pinned goroutine exits without calling `UnlockOSThread`, two things happen:

1. The goroutine itself disappears (its stack is reclaimed).
2. The M it was pinned to is destroyed; the runtime calls `pthread_exit` on it.

This is normally fine. But the M cannot be reused. So if your pinned-goroutine pattern is "spawn pinned, do one thing, exit," every iteration costs you M creation + M destruction (~10–50 µs of kernel syscalls). For one-shot setup it's acceptable. For per-request: don't.

The correct shape is:

```go
go func() {
    runtime.LockOSThread()
    defer runtime.UnlockOSThread()
    // ... long-lived work ...
}()
```

Or, if the pin is purely to do thread-affine setup and the goroutine should die afterward, omit the `Unlock` so the M is destroyed alongside the goroutine — useful when the thread is in a state (custom namespace, broken signal mask) that you do not want to reuse.

---

## Pinning Inside a Library: Don't

If you are writing a library that other Go programs import, do not call `runtime.LockOSThread` inside a function that your caller is on. You will pin *their* goroutine without their knowledge, and they will be confused about why thread count is rising.

The correct shape if your library needs pinning:

```go
package mylib

// Start spawns a worker goroutine pinned to its own M.
// Submit sends work to it; the caller's goroutine stays unpinned.
func Start() *Worker {
    w := &Worker{in: make(chan Job, 16)}
    go w.loop()
    return w
}

func (w *Worker) loop() {
    runtime.LockOSThread()
    defer runtime.UnlockOSThread()
    // ...
}
```

The pin is encapsulated in the worker goroutine. The caller never sees it.

If you must call `LockOSThread` on the caller's goroutine for some unavoidable reason, document it loudly, ideally in the function's name (`MustRunOnPinnedThread`), and `UnlockOSThread` before returning.

---

## A Pinned Goroutine That Panics

A pinned goroutine that panics without `recover` does the usual Go thing: the runtime crashes the process. Fine.

A pinned goroutine that panics *with* `recover` is more interesting. After recovery, the goroutine is back to running normally, but it is still pinned. If your `defer recover()` is in the same function as the pin, and the function returns, the deferred `UnlockOSThread` runs (defers run on panic and on return). All good.

If your panic-recovery is in a *different* function from the pin, you may end up with a still-pinned goroutine running unrelated code:

```go
func badPattern() {
    defer recover()           // recovers panics, but does not unpin
    runtime.LockOSThread()
    panic("oops")
    // never reaches UnlockOSThread
}

func caller() {
    badPattern()
    // we are still on the pinned M; LockOSThread persists
    doMoreWork()              // accidentally pinned
}
```

The fix: always pair `LockOSThread` with `defer UnlockOSThread` *in the same function*. If you cannot, you have to be careful about which path unlocks.

For production code, the safest rule is *one pinned function per pinned goroutine*: the function calls `LockOSThread`, `defer UnlockOSThread`, and contains the entire pinned lifetime.

---

## What `GODEBUG=schedtrace` Shows

`GODEBUG=schedtrace=1000` makes the runtime print scheduler statistics every second:

```
SCHED 1003ms: gomaxprocs=4 idleprocs=0 threads=8 spinningthreads=1 ...
SCHED 2003ms: gomaxprocs=4 idleprocs=0 threads=11 spinningthreads=0 ...
```

`threads` is the M count. `idleprocs` is the number of Ps with no runnable G. Watch what happens when you start a pinned goroutine: `threads` rises by one.

If you also run `GODEBUG=scheddetail=1`, you get per-P and per-M information:

```
P0: status=1 schedtick=23 syscalltick=4 m=2 runqsize=0
M2: p=0 curg=27 mallocing=0 throwing=0 ...
```

`curg` is the G the M is currently running. For a pinned G, that field stays constant for the M's lifetime — diagnostic gold when you suspect a goroutine is stuck pinned.

Both flags slow the program down; use them in tests, not production.

---

## Tiny Worked Example: Pinned Counter vs Atomic

Let's see pinning in a small concrete program. The naive idea: pin a goroutine that owns a counter, and have callers send increments over a channel.

```go
package main

import (
    "fmt"
    "runtime"
    "sync"
    "sync/atomic"
    "time"
)

type PinnedCounter struct {
    ops chan int
    val int
}

func NewPinned() *PinnedCounter {
    c := &PinnedCounter{ops: make(chan int, 128)}
    go func() {
        runtime.LockOSThread()
        defer runtime.UnlockOSThread()
        for n := range c.ops {
            c.val += n
        }
    }()
    return c
}

func (c *PinnedCounter) Add(n int) { c.ops <- n }

func main() {
    pc := NewPinned()
    var a atomic.Int64

    bench := func(name string, add func()) {
        var wg sync.WaitGroup
        start := time.Now()
        for i := 0; i < 8; i++ {
            wg.Add(1)
            go func() {
                defer wg.Done()
                for j := 0; j < 100000; j++ {
                    add()
                }
            }()
        }
        wg.Wait()
        fmt.Println(name, time.Since(start))
    }

    bench("pinned", func() { pc.Add(1) })
    bench("atomic", func() { a.Add(1) })
}
```

On a typical machine you'll see something like:

```
pinned 130ms
atomic   6ms
```

The pinned-counter pattern is 20× slower for a trivial counter. Why: every increment is a channel send (50–100 ns) and the receiving goroutine is pinned so the runtime cannot dynamically load-balance it.

The lesson: pinning is for thread-affine state, not for "I want sequential access to a number." Sequential access has a much faster primitive: an atomic.

---

## Glossary

- **Pin / pinning.** Binding a goroutine to a specific OS thread via `runtime.LockOSThread`.
- **M (machine).** Internal Go runtime name for an OS thread.
- **G (goroutine).** A Go runtime task; lightweight, multiplexed onto Ms.
- **P (processor).** A scheduling slot. There are `GOMAXPROCS` of them.
- **Work-stealing.** Scheduler's mechanism to balance load across Ps by stealing runnable Gs from one P's queue to another's.
- **Hand-off.** When a G blocks in a syscall, the scheduler hands the P to a free M to keep Go-side work going.
- **TLS.** Thread-local storage. Per-thread memory areas; cgo libraries often rely on TLS.
- **Single-owner pattern.** One goroutine pinned at start, exposing a channel API to the rest of the program.

---

## Self-Check Quiz

1. How many Ms does a single pinned goroutine retire from the scheduler pool?
2. If `GOMAXPROCS=4` and three goroutines are pinned, how many slots are left for normal work?
3. Name one performance reason to pin and one performance reason *not* to pin.
4. Why does pinning a hot Go (non-cgo) loop usually not help throughput?
5. What is the minimum/maximum number of `UnlockOSThread` calls a pinned goroutine should make?
6. Where in `/proc/<pid>/status` can you read the thread count?
7. What `runtime/metrics` name reports the thread count?
8. In the single-owner pattern, who calls `LockOSThread`: the caller or the worker?
9. What happens to the M if a pinned goroutine exits without `UnlockOSThread`?
10. Why does `LockOSThread` not prevent preemption?

Answers:

1. Exactly one.
2. One (or the runtime grows extra Ms to compensate, but only one effective P-slot remains free).
3. To pin: cgo amortisation or thread-affine API. Not to pin: pure Go code does not benefit and you lose scheduler flexibility.
4. The Go scheduler already keeps a hot G running on the same M most of the time when the system is not contended; pinning gains little but costs flexibility.
5. Exactly one if you called Lock once. Reference-counted: N Locks need N Unlocks.
6. The `Threads:` line.
7. `/sched/threads:threads` (Go 1.21+).
8. The worker.
9. The M is destroyed by the runtime via `pthread_exit`; it cannot be reused.
10. The runtime still sends `SIGURG` to preempt; pinning only prevents *migration*, not preemption.

---

## Hands-On Lab

1. **Measure baseline thread count.** Write a Go program that prints `runtime/metrics` `/sched/threads:threads` once per second for 30 s under your service's normal workload. Note the baseline.
2. **Pin one goroutine for 30 s.** Add `go func() { runtime.LockOSThread(); time.Sleep(30 * time.Second); runtime.UnlockOSThread() }()` and rerun. Verify the thread count rises by 1.
3. **Pin four goroutines for 30 s.** Repeat with four pinned. Verify thread count rises by 4. Does total CPU usage change? Latency?
4. **Build the single-owner counter** from the worked example. Compare its throughput to `sync/atomic.Int64`. Confirm the atomic is ~20× faster.
5. **Run the pinned-vs-unpinned benchmark** from earlier. Note the per-op overhead of pinning when the work is trivial.
6. **Run with `GODEBUG=schedtrace=1000`.** Observe the `threads=` field rising as you start pinned goroutines.
7. **Try `debug.SetMaxThreads(8)`** and pin 10 goroutines. The 9th and 10th cause the runtime to abort the program — note the error message.

These exercises give you the muscle memory for the cost model. Senior-level decisions all flow from these numbers.

---

## Summary

`runtime.LockOSThread` pins one goroutine to one OS thread. Each pin retires one M from the pool of Ms available for general scheduling. The scheduler compensates by growing new Ms, but the retired one stays out until the pin releases.

Performance consequences:

- **Cost:** lost work-stealing flexibility, forced M creation, more expensive preemption, kernel resource usage.
- **Benefit:** stable TLS and cache locality, cgo amortisation, ability to use thread-affine APIs at all.

The right amount of pinning for most Go services is **zero**. The right amount for a service with cgo into OpenGL/CUDA/namespace switching is **one per resource**, owned by a long-lived goroutine via the single-owner pattern.

If you remember three numbers:

- **One pin = one M retired.**
- **~800 ns overhead per pin** on a trivial benchmark.
- **5–25% cgo savings** for tight cgo loops with stable TLS.

…you have most of the cost model the production engineer needs.

The middle, senior, and professional pages develop the patterns into real architectures: single-owner pools for GPUs, namespace switchers, signal-handling owners, and the runtime-internal mechanics that make pinning work.
