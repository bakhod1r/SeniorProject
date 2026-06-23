---
layout: default
title: Senior
parent: Timer Leaks
grand_parent: Time-Based Concurrency
ancestor: Go
nav_order: 4
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/16-time-based-concurrency/03-timer-leaks/senior/
---

# Timer Leaks — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [What "Leak" Means at the Runtime Level](#what-leak-means-at-the-runtime-level)
3. [The Timer Heap Before Go 1.14](#the-timer-heap-before-go-114)
4. [The Per-P Heap Reform (Go 1.14)](#the-per-p-heap-reform-go-114)
5. [Why Unreferenced Timers Were Retained Pre-1.23](#why-unreferenced-timers-were-retained-pre-123)
6. [The Go 1.23 Timer GC Fix](#the-go-123-timer-gc-fix)
7. [Reading a Heap Profile of Timer Pressure](#reading-a-heap-profile-of-timer-pressure)
8. [Reading a Runtime Trace During a Timer Storm](#reading-a-runtime-trace-during-a-timer-storm)
9. [`runtime` Source Tour: From `time.NewTimer` to the Heap](#runtime-source-tour-from-timenewtimer-to-the-heap)
10. [Cross-P Migration and Stealing](#cross-p-migration-and-stealing)
11. [Interaction With the Scheduler and `sysmon`](#interaction-with-the-scheduler-and-sysmon)
12. [The `netpoll` Deadline Integration](#the-netpoll-deadline-integration)
13. [Designing for Millions of Timers](#designing-for-millions-of-timers)
14. [Case Postmortems](#case-postmortems)
15. [Self-Assessment](#self-assessment)
16. [Summary](#summary)

---

## Introduction

At middle level you learned the user-facing rules: use `NewTimer` not `After`, use `NewTicker` not `Tick`, follow the Stop-drain-Reset pattern, and prefer `context.WithTimeout`. Those rules are sufficient for almost all production code.

At senior level the goal changes. You need to be able to:

- Explain *why* the rules are what they are, in terms of the Go runtime's actual data structures.
- Diagnose a timer-related performance problem from a heap profile, an execution trace, and a goroutine dump simultaneously.
- Decide when to violate the rules — for example, when a per-key timer is acceptable and when a sweeper is mandatory.
- Read a Go runtime release note and predict whether your service will see a regression or an improvement.
- Tell the story of how the timer subsystem got to its current state across major Go versions, because the design choices are tightly coupled to the underlying scheduler.

We will work from the bottom up. The bottom is the runtime's `timer` struct and the per-P heap that orders them. From there we will reconstruct the user-visible behaviour and trace the leaks back to specific runtime mechanisms.

After reading this you will:

- Explain in detail why `time.After` pinned memory pre-1.23 and why it does not pin it the same way on 1.23+.
- Reproduce a timer-heavy heap profile and read it in `pprof`.
- Inspect `runtime/trace` output and identify timer pressure patterns.
- Argue about the trade-offs of per-key vs sweeper designs with numbers.
- Reason about timer-related changes in future Go releases by reading source diffs.

A note on dates and CL numbers. The Go timer subsystem has been reworked multiple times. We refer to representative changes — particularly the per-P heap reform around Go 1.14 and the timer-as-GC-object change around Go 1.23 (which lived under CL 462895 and surrounding CLs in the runtime tree). Read the actual release notes for the precise wording; the principles we discuss are stable across the rewordings.

---

## What "Leak" Means at the Runtime Level

A goroutine can "leak" because it is parked on a channel that nobody will ever signal. A file descriptor can "leak" because the process holds it open after it is no longer needed. A timer can "leak" in a similar but subtler way: the runtime tracks pending timers in a heap, and that heap retains:

1. The `runtime.timer` struct itself (a small fixed-size record).
2. The user-visible `*time.Timer` value (slightly larger, includes a channel or a callback closure).
3. Anything reachable from the callback closure (for `AfterFunc`) — captured variables, captured pointers, anything the closure can read.

If the timer is "active" in the runtime's view (queued in the heap, not stopped), the GC cannot collect any of the above. The closure pins the captured world. The `*time.Timer` pins the closure. The runtime's heap pins the `*time.Timer`.

For `*time.Timer` created by `time.NewTimer` and friends, the channel is a buffered `chan time.Time` of capacity one. The channel is a small fixed allocation; the time value sent into it is a value (`time.Time` is 24 bytes). Not large per timer, but multiply by millions and it matters.

For `time.After`, the user never sees the `*time.Timer`. The user sees only the channel. So *user code* cannot stop the timer. From the user's perspective, the timer is "leaked from the start" until it fires on its own.

Pre-1.23, the runtime kept the timer pinned through the timer heap regardless of user references. The timer was unreachable from user code but reachable from the runtime, so the GC could not free it. The timer therefore lived until its fire time, regardless of how brief its user-visible lifetime was.

This is the precise definition of "timer leak" we are working with: **the period during which a timer is live in the runtime heap, separate from how long the user actually needs it.**

A `time.NewTimer` you `defer t.Stop()` on has minimal leak: its live time matches its useful time. A `time.After` whose channel nobody reads (and whose 5-minute duration is much longer than the useful lifetime) has a maximal leak: 5 minutes of pinned memory for zero seconds of useful work.

### Distinguishing leak from churn

It is useful to distinguish two related problems:

- **Timer leak**: memory pinned per-timer for longer than necessary.
- **Timer churn**: rate of timer allocation that the GC has to absorb.

`time.After` in a hot loop produces both. The fix (a reusable `NewTimer`) eliminates churn primarily and leak secondarily.

`time.AfterFunc` with a large captured closure produces leak primarily (each timer pins a big object) but not necessarily churn (if called once per request, the rate is moderate).

`time.NewTicker` never stopped produces leak primarily (one ticker pinned for the lifetime of the process), no churn (one allocation).

You diagnose these differently. Churn shows up in `pprof -alloc_space` (high `flat` allocation rate). Leak shows up in `pprof -inuse_space` (high `flat` retained size). Both can show up in goroutine count.

---

## The Timer Heap Before Go 1.14

The original Go timer implementation was a single global heap with a single global lock. Whenever any goroutine called `time.NewTimer`, `time.Sleep`, or `time.After`, the runtime took the lock, inserted the timer into the heap, and released the lock.

There was a single dedicated goroutine (`timerproc`) that read the top of the heap, slept until the next fire time, fired the timer, and repeated. On wake it took the global lock to remove the entry.

This worked for small numbers of timers. It did not scale. As GOMAXPROCS grew and as services accumulated tens of thousands of pending timers, the global lock became a bottleneck. Every timer create, every timer stop, every timer fire went through the same lock.

In addition, the global heap meant that the timer code was a separate "P" of its own attention. The scheduler had no special knowledge of timers; the timer goroutine was just another goroutine that happened to call into low-level scheduler primitives.

### Symptoms of the global-heap design

On a service running 200 000 timers (say, an HTTP server with many pending RPCs):

- Lock contention on `runtime.timersLock`.
- A dedicated OS thread (`timerproc`) consuming non-trivial CPU just to drive timer fires.
- Tail latency spikes when many timers fired in the same millisecond.

These symptoms motivated the redesign.

### How leaks looked in this era

In Go 1.9–1.13, leaked timers all queued into the same global heap. A leak of a million `time.After` calls produced:

- A million entries in one heap.
- Heap operations O(log 1,000,000) ≈ 20 comparisons per insert/remove.
- Contention spikes whenever many timer creates overlapped.

You could see this in `pprof -alloc_space` as `time.NewTimer` at the top, and in CPU profiles as `runtime.timerproc` and `runtime.siftupTimer` near the top.

The fix from the user side was the same as today (avoid `time.After` in loops). The runtime fix came in 1.14.

---

## The Per-P Heap Reform (Go 1.14)

Go 1.14 reworked the timer subsystem so that each P (processor) owns its own timer heap. The `runtime.p` struct gained a `timers` field — a slice that backs the heap — and a `timer0When` field that caches the top of the heap for fast comparison.

The reform delivered several wins:

1. **Lock contention disappeared.** Most timer operations only touch the local P's heap and use the per-P lock, which is rarely contested.
2. **The dedicated `timerproc` goroutine was eliminated.** Instead, the scheduler itself checks each P's timer heap as part of normal scheduling. The check is cheap because `timer0When` is a single int64 comparison.
3. **Tickers and timers scaled with GOMAXPROCS.** Doubling P meant doubling the total timer-heap capacity for free.

### Where the timer lives now

When you call `time.NewTimer(d)` from a goroutine running on P0, the timer is inserted into P0's heap. The runtime records which P owns the timer.

If the goroutine migrates to P3 later, the timer still belongs to P0. When the timer fires, it fires on P0's schedule check, even if no goroutine is currently running on P0.

If P0 is idle, the scheduler may try to *steal* timers from P0 onto another P. Stealing is opportunistic and aims to keep all Ps responsive.

### Why per-P does not eliminate the leak

Per-P heaps are a *scaling* fix. They distribute the heap load. They do not eliminate the fundamental issue that the runtime retains each timer until it fires or is stopped.

In other words: a million leaked timers in 1.13 were a million entries in one heap. A million leaked timers in 1.14+ are roughly `1,000,000 / GOMAXPROCS` entries per heap. Smaller per heap. Still a million in aggregate. Still pinning a million timer structs.

### Stop and Reset under per-P

Before 1.14, `Stop` had to acquire the global timer lock. After 1.14, `Stop` has to find which P owns the timer, take that P's lock, and modify the heap.

The runtime caches the owning P in the timer struct, so the lookup is fast. But there is still a subtle race: between `Stop` being called and the timer actually being removed, the timer might fire on its owning P. The runtime uses internal flags to mark a timer as "stopped" so the firing path knows to skip it.

This is one reason `Stop`'s return value can be `false` even when you call `Stop` "before" the fire: by the time `Stop` actually runs, the timer may have started firing.

### Where to look in source

In the Go source tree, the per-P timer code lives in `runtime/time.go` and `runtime/proc.go`. Key entry points:

- `runtime.addtimer(t *timer)` — add a timer to the current P's heap.
- `runtime.deltimer(t *timer) bool` — remove a timer, returning whether it was active.
- `runtime.modtimer(t *timer, when, period int64, f func(any, uintptr), arg any, seq uintptr)` — modify a timer in place.
- `runtime.runtimer(pp *p, now int64) int64` — drain expired timers from `pp`.
- `runtime.checkTimers(pp *p, now int64) (next int64, more bool)` — checked from the scheduler.

Reading those functions teaches you the invariants the runtime enforces on timer state.

---

## Why Unreferenced Timers Were Retained Pre-1.23

The 1.14 reform fixed scaling but not retention. A timer in a per-P heap is reachable from the runtime, so the GC keeps it alive. This is true regardless of whether user code has a reference to the timer.

For most uses this is fine. The user-visible `*time.Timer` references the runtime `timer` via an internal pointer. The runtime keeps both alive. When the timer fires, the runtime removes the entry from the heap, the user reads the channel, and everything becomes garbage in due course.

The pathological case is `time.After`. The function constructs a `runtime.timer`, wires it into the channel, and returns the channel. The user never sees the `*time.Timer` or the `runtime.timer`. From the user's perspective, the only live reference is the channel. From the GC's perspective, the entire chain is reachable because the runtime heap holds the timer, the timer holds the channel callback, the channel callback holds the channel, and the channel is referenced by user code (in the `select` case).

Even if the user code drops the channel reference (say, the goroutine exited because its parent cancelled it), the timer remains in the runtime heap until it fires. The chain looks like:

```
runtime heap → runtime.timer → callback → channel
                                          (no user ref)
```

The runtime heap is the root that keeps the chain alive. The GC walks the heap as a root in the same way it walks goroutine stacks. So the timer survives.

This is the retention bug. For a `time.After(5 * time.Minute)` called once and then ignored, the runtime retains the timer and its accessories for five minutes. For a hot loop calling `time.After(5 * time.Minute)` once per millisecond, the runtime accumulates 300 000 entries in steady state.

### A worked example of retention

```go
package main

import (
    "fmt"
    "runtime"
    "time"
)

func main() {
    for i := 0; i < 1_000_000; i++ {
        _ = time.After(1 * time.Hour)
    }

    runtime.GC()
    runtime.GC()

    var m runtime.MemStats
    runtime.ReadMemStats(&m)
    fmt.Printf("HeapAlloc: %d MB\n", m.HeapAlloc/(1<<20))
    fmt.Printf("HeapInuse: %d MB\n", m.HeapInuse/(1<<20))
    fmt.Printf("Sys: %d MB\n", m.Sys/(1<<20))

    // Sleep to let any pending GC settle.
    time.Sleep(2 * time.Second)

    runtime.ReadMemStats(&m)
    fmt.Printf("After sleep — HeapAlloc: %d MB\n", m.HeapAlloc/(1<<20))
}
```

On Go 1.22 or earlier, you will see `HeapAlloc` in the hundreds of MB. The million timer structs, the million callbacks, the million channel buffers are all retained.

On Go 1.23 or later, you will see `HeapAlloc` in the tens of MB. The GC reclaims the bulk of the chain after the first `runtime.GC()` call.

This single program is the cleanest reproducer of the leak — and the fix.

### Why retention was hard to fix

You might think the runtime should "just" not hold a reference for timers that no user code references. But:

- The runtime cannot tell whether the channel-side of a `time.After`-style timer is referenced. The channel could be in a goroutine's stack, in a struct field, in a `select` case in another goroutine, anywhere.
- Removing the timer from the heap before fire would break the user's reading code: the user calls `<-time.After(d)` expecting to receive after `d`. Cutting it short is a semantic change.
- The timer's callback runs internal runtime code that the user never sees but which the runtime depends on.

So pre-1.23, the runtime took the conservative position: "if I ever queued this timer, I keep it queued until it fires or someone Stops it."

The 1.23 fix changed the rules in a clever way that we cover next.

---

## The Go 1.23 Timer GC Fix

Go 1.23 introduced what is often summarised as "timers are now garbage collected like any other object." The reality is more nuanced.

The high-level mechanism:

1. The `runtime.timer` struct was reorganised so it can be embedded directly into the user-visible `*time.Timer` (or the unnamed wrapper used by `time.After`).
2. The runtime's timer heap was changed to hold *weak pointers* (or weak-pointer-like entries) to timers, rather than direct pointers.
3. The GC can therefore identify timers whose only live reference is the runtime heap entry, and reclaim them.

When a timer is reclaimed, the runtime treats it as a "cancelled" timer: at fire time, the runtime checks the validity flag and, if unset, skips the timer.

This delivers a surprising property: **for `time.After(d)` whose channel is never read and never referenced, the timer can be GC'd before its fire time.** The runtime never delivers the value. The heap entry is reclaimed lazily.

For *referenced* timers (e.g., `time.NewTimer` whose `*time.Timer` you hold), nothing changes — the GC sees the user reference and keeps everything alive.

### Walking through the cases

#### `time.After` whose channel is read

```go
select {
case t := <-time.After(d):
    fmt.Println(t)
}
```

The channel is reachable from the goroutine's stack frame. The channel keeps the timer alive. The timer fires, sends, the user reads, everything proceeds normally. Same as pre-1.23.

#### `time.After` whose channel is never read

```go
ch := time.After(time.Hour)
_ = ch
// ch goes out of scope
```

Pre-1.23: the timer stays in the heap for one hour. Memory is pinned.

Post-1.23: as soon as `ch` is unreachable, the timer can be reclaimed. The GC notices and removes the heap entry.

#### `time.After` in a loop, fast path always wins

```go
for {
    select {
    case msg := <-ch:
        handle(msg)
    case <-time.After(d):
        return
    }
}
```

Pre-1.23: each iteration's `time.After` timer survives in the heap until `d` elapses. If the loop iterates faster than `d`, you accumulate.

Post-1.23: each iteration's `time.After` timer becomes unreachable as soon as the `select` returns (the `case <-time.After(d):` arm closes the channel reference). The GC reclaims it on the next cycle.

The reclamation is lazy. You still pay allocation cost. But the *retention* time drops from `d` to "until the next GC cycle," which is often milliseconds.

#### `time.NewTimer` you hold and forget to Stop

```go
t := time.NewTimer(d)
// ... function returns without calling t.Stop() ...
```

The `*time.Timer` is unreferenced after the function returns. Pre-1.23: still retained. Post-1.23: reclaimable.

You still should write `defer t.Stop()` because the *intent* is clearer and because in tests you may want deterministic behaviour. But the catastrophic retention is gone.

### What did **not** change

`*time.Ticker` is still a leak if you do not `Stop` it. The reason is subtle: a ticker's heap entry is *re-inserted* after each fire (so the timer can tick again). The re-insertion happens inside the runtime, and the runtime holds a strong reference to keep the ticker firing. The user-visible reference is irrelevant.

If you create a `*time.Ticker` and never `Stop` it, the runtime keeps ticking forever, even if no user code references the ticker. Each tick consumes CPU. The channel buffer fills, but the ticker keeps trying.

Always `Stop` a ticker. Go 1.23 did not change that.

### Performance implications

Workloads that were `time.After`-heavy but properly managed (e.g., per-RPC timeouts that always finish quickly) see real improvements on Go 1.23+:

- Lower `HeapInuse` because reclamation happens early.
- Lower GC pressure because the retained set is smaller.
- Roughly similar `TotalAlloc` because allocation rates are unchanged.

Workloads that were timer-leaking due to `time.Tick` or unstopped `NewTicker` see no improvement. The fix targets `time.After` style retention, not ticker style.

### How to verify on your codebase

```bash
# Build with Go 1.23+
go version
go build -o app ./cmd/myservice

# Run with memstats logging
GODEBUG=gctrace=1 ./app 2> gc.log

# Look for HeapAlloc trend.
```

Compare to the same service running on Go 1.22. The `time.After` leak should manifest as a steadily growing `HeapAlloc` on 1.22 and as a flatter curve on 1.23. The difference is the leak.

### Subtleties

The Go 1.23 change is sometimes described as "the runtime no longer holds timers strongly." This is approximate. The runtime holds them *weakly enough that the GC can prove they are not user-reachable.* The exact mechanism is complex — it involves split tracking of timer state and lazy reclamation tied to the GC cycle.

For an authoritative description, read the Go 1.23 release notes and the surrounding CLs in the runtime tree, particularly the changes to `runtime/time.go` between Go 1.22 and 1.23. Names of helper functions like `runtime.addtimer`, `runtime.cleantimers`, `runtime.deltimer` are the entry points to trace.

---

## Reading a Heap Profile of Timer Pressure

A heap profile shows where allocations come from and what is currently retained. Timer leaks show up in distinctive ways. Let us walk through how to read them.

### Capture

```bash
go tool pprof -alloc_space http://localhost:6060/debug/pprof/heap
```

`alloc_space` shows total bytes allocated since process start, partitioned by call site. This is the right view for timer churn.

```bash
go tool pprof -inuse_space http://localhost:6060/debug/pprof/heap
```

`inuse_space` shows bytes currently retained. This is the right view for timer retention.

### Interpreting `alloc_space`

A leaky `time.After`-in-loop service shows:

```
(pprof) top10
Showing nodes accounting for 7.81GB, 89.32% of 8.74GB total
      flat  flat%   sum%        cum   cum%
    4.21GB 48.17% 48.17%     4.21GB 48.17%  time.NewTimer
    2.34GB 26.78% 74.95%     6.55GB 74.95%  time.After
    0.82GB  9.38% 84.33%     0.82GB  9.38%  runtime.gopark
    0.44GB  5.03% 89.36%     0.44GB  5.03%  runtime.makechan
    ...
```

`time.NewTimer` at the top means: many calls have allocated `*time.Timer` structs. The `cum` column for `time.After` includes `time.NewTimer` because `time.After` calls `NewTimer` internally.

To find the source code line:

```
(pprof) list time.After
Total: 8.74GB
ROUTINE ======================== time.After in time/sleep.go
    2.34GB     6.55GB (flat, cum) 74.95% of Total
         .          .     30:func After(d Duration) <-chan Time {
         .     4.21GB     31:	return NewTimer(d).C
    2.34GB     2.34GB     32:}
```

Now zoom out to find callers of `time.After`:

```
(pprof) peek time.After
Showing nodes accounting for 8.74GB, 100% of 8.74GB total
----------------------------------------------------------+-------------
      flat  flat%   sum%        cum   cum%   calls calls% + context
----------------------------------------------------------+-------------
                                            5.20GB 79.39% |   main.(*Worker).run /app/worker.go:45
                                            1.05GB 16.03% |   main.(*Client).Call /app/client.go:88
                                            0.30GB  4.58% |   main.(*Pool).Get /app/pool.go:23
    2.34GB 26.78% 26.78%     6.55GB 74.95%                | time.After
```

Three call sites contribute. `worker.go:45` is the biggest. Open the file, look at line 45, and you will see `<-time.After(d)` inside a loop. That is the leak.

### Interpreting `inuse_space`

Same service in `inuse_space`:

```
(pprof) top10
Showing nodes accounting for 1.24GB, 92.18% of 1.35GB total
      flat  flat%   sum%        cum   cum%
    0.78GB 57.78% 57.78%     0.78GB 57.78%  time.NewTimer
    0.21GB 15.56% 73.33%     0.21GB 15.56%  runtime.makechan
    0.18GB 13.33% 86.67%     0.18GB 13.33%  runtime.allocm
    0.07GB  5.19% 91.85%     0.07GB  5.19%  bufio.NewReaderSize
    ...
```

On Go 1.22, this is the steady-state retention. ~780 MB of currently-pending `*time.Timer` structs. That is your leak in megabytes.

On Go 1.23+, the same workload shows:

```
(pprof) top10
      flat  flat%   sum%        cum   cum%
    0.07GB 18.42% 18.42%     0.07GB 18.42%  time.NewTimer
    0.15GB 39.47% 57.89%     0.15GB 39.47%  runtime.makechan
    ...
```

The `inuse` dropped because GC reclaims unreferenced timers. The `alloc_space` is unchanged — you still allocate the same rate of timers; they just do not pile up.

### Identifying the call site of leaked tickers

For tickers, `time.NewTicker` shows up directly:

```
(pprof) top10
      flat  flat%   sum%        cum   cum%
    0.45GB 33.33% 33.33%     0.45GB 33.33%  time.NewTicker
    ...
(pprof) peek time.NewTicker
                                            0.30GB 66.67% |   main.(*Service).process /app/service.go:120
                                            0.10GB 22.22% |   main.(*Cache).expireLoop /app/cache.go:88
                                            0.05GB 11.11% |   main.runHeartbeat /app/heartbeat.go:45
```

Each call site needs a matching `Stop`. Check each one. If you find a `NewTicker` without a `Stop`, you have your leak.

### The `goroutine` profile

```
go tool pprof http://localhost:6060/debug/pprof/goroutine
(pprof) top
Showing nodes accounting for 52341 of 52341 total
      flat  flat%   sum%        cum   cum%
    50000 95.53% 95.53%      50000 95.53%  main.(*Worker).run
     1234  2.36% 97.89%       1234  2.36%  main.(*Client).Call
       ...
```

50 000 goroutines parked in `Worker.run`. The leak is in `Worker.run`. Match this with `pprof goroutine?debug=2` to see the exact stack trace and which line each goroutine is parked on.

If most are parked on `time.After`, you have a `time.After`-in-loop bug. If they are parked on `time.Tick`, you have a `time.Tick` bug.

---

## Reading a Runtime Trace During a Timer Storm

`runtime/trace` is the high-resolution view of what the scheduler and goroutines are doing. For timer issues, it shows:

- When timers fire.
- Which P fires them.
- How many goroutines wake up as a result.
- How long the wakeup takes to schedule.

### Capturing a trace

```go
import "runtime/trace"

func main() {
    f, err := os.Create("trace.out")
    if err != nil { log.Fatal(err) }
    defer f.Close()
    if err := trace.Start(f); err != nil { log.Fatal(err) }
    defer trace.Stop()

    // ... run workload ...
}
```

For a server, capture for a fixed window:

```go
go func() {
    f, _ := os.Create("trace.out")
    trace.Start(f)
    time.Sleep(10 * time.Second)
    trace.Stop()
    f.Close()
}()
```

Then:

```bash
go tool trace trace.out
```

Opens a browser. Navigate to "View trace."

### What to look for

In the trace timeline:

1. **Goroutines column** — shows each goroutine and its events.
2. **Procs (Ps) column** — shows each P and what it is running.
3. **Timer firings** — marked as events on Ps.

For a timer storm, you will see:

- A burst of timer-fire events on multiple Ps simultaneously.
- A corresponding burst of goroutine wakeups.
- A spike in scheduler activity (Gready, Gwaking).
- Possibly garbage collection events triggered by allocation churn.

Healthy timer usage looks like sparse, evenly distributed fire events. Leak symptoms look like dense bursts, often correlated with GC cycles.

### Filtering by event type

In the trace UI, filter by event type "ProcStart" and "ProcStop" to see scheduling. Filter by "TimerStart" and "TimerEnd" (in newer Go versions; older versions use different labels) to see timer activity.

For programmatic analysis:

```go
import "internal/trace" // not stable, alternative: use go tool trace -d
```

Or run:

```bash
go tool trace -d trace.out > trace.txt
```

Then grep for timer-related events. Heavy event volume on timer-related code is a leak smell.

### Correlating trace with pprof

The trace tells you *when* things happen. pprof tells you *where* in code. Together they reveal *who* is causing the burst.

Workflow:

1. Capture pprof while the issue is happening. Identify the call site.
2. Capture a trace during a known-bad window.
3. In the trace, find the burst. Note the timestamp and Ps involved.
4. Cross-reference with the pprof call site to confirm the suspect.

---

## `runtime` Source Tour: From `time.NewTimer` to the Heap

Let us trace what happens when you call `time.NewTimer(d)`. This walkthrough is approximate — exact function names and signatures change across Go versions. The high-level structure is stable.

### The user-side: `time/sleep.go`

```go
// time/sleep.go
func NewTimer(d Duration) *Timer {
    c := make(chan Time, 1)
    t := &Timer{
        C: c,
        r: runtimeTimer{
            when: when(d),
            f:    sendTime,
            arg:  c,
        },
    }
    startTimer(&t.r)
    return t
}
```

The user constructs a `Timer` struct embedding a `runtimeTimer`. The runtime function `startTimer` is implemented in `runtime/time.go`.

The `f` field is the callback that fires when the timer expires. For `NewTimer`, the callback is `sendTime`, which sends the current time on the channel `c`.

### The runtime-side: `runtime/time.go`

```go
//go:linkname startTimer time.startTimer
func startTimer(t *timer) {
    addtimer(t)
}

func addtimer(t *timer) {
    // Validate state.
    if t.status.Load() != timerNoStatus {
        throw("addtimer called with initialized timer")
    }
    t.status.Store(timerWaiting)

    cleantimers(getg().m.p.ptr())

    addInitializedTimer(t, t.when)
}

func addInitializedTimer(t *timer, when int64) {
    if when < 0 {
        when = maxWhen
    }
    pp := getg().m.p.ptr()
    lock(&pp.timersLock)
    cleantimers(pp)
    doaddtimer(pp, t)
    unlock(&pp.timersLock)
    wakeNetPoller(when)
}
```

`addtimer` (and its successor functions in 1.23+) is the entry point. It acquires the current P's timer lock, cleans up any expired timers in the heap, and inserts the new timer. Then it calls `wakeNetPoller` to make sure the net poller wakes in time to fire the timer.

### Heap operations

```go
func doaddtimer(pp *p, t *timer) {
    if netpollInited.Load() == 0 {
        netpollGenericInit()
    }
    if t.pp != 0 {
        throw("doaddtimer: P already set in timer")
    }
    t.pp.set(pp)
    i := len(pp.timers)
    pp.timers = append(pp.timers, t)
    siftupTimer(pp.timers, i)
    if t == pp.timers[0] {
        pp.timer0When.Store(t.when)
    }
    pp.numTimers.Add(1)
}
```

The timer is appended to the slice and sifted up to maintain heap order. `pp.timer0When` is updated if the new timer became the soonest-to-fire.

### Fire path

The scheduler calls `checkTimers` regularly:

```go
func checkTimers(pp *p, now int64) (rnow, pollUntil int64, ran bool) {
    if pp.timer0When.Load() == 0 {
        return now, 0, false
    }
    // ... if a timer is due, runtimer ...
    ran = runtimer(pp, now) >= 0
    return now, next, ran
}

func runtimer(pp *p, now int64) int64 {
    for {
        t := pp.timers[0]
        if t.when > now {
            return t.when
        }
        // Timer is ready to fire.
        // Re-set or remove from heap.
        // Call t.f(t.arg, t.seq).
    }
}
```

For a single-shot timer (`period == 0`), the heap entry is removed. For a ticker (`period > 0`), the entry is updated with `when += period` and resifted.

The callback `t.f(t.arg, ...)` runs *on the scheduler thread*. For `sendTime`, the callback is small: send on a channel. For `AfterFunc`, the callback may invoke user code on a fresh goroutine.

### Stop path

```go
func deltimer(t *timer) bool {
    for {
        switch s := t.status.Load(); s {
        case timerWaiting, timerModifiedLater:
            if t.status.CompareAndSwap(s, timerDeleted) {
                // Marked for deletion.
                // The actual removal happens in cleantimers.
                return true
            }
        case timerRunning, timerRemoving:
            // Wait and retry.
            osyield()
        case timerDeleted, timerRemoved:
            // Already stopped or already removed.
            return false
        case timerModifying:
            osyield()
        }
    }
}
```

`deltimer` uses CAS on a status field. It marks the timer for deletion but does not necessarily remove it from the heap immediately. The actual heap removal happens lazily on the next `cleantimers` call.

This lazy-deletion pattern is what allows `Stop` to be cheap: it does not have to shuffle the heap.

### Reset path

```go
func resettimer(t *timer, when int64) bool {
    return modtimer(t, when, 0, t.f, t.arg, t.seq)
}

func modtimer(t *timer, when, period int64, f func(any, uintptr), arg any, seq uintptr) bool {
    // Atomically update when, possibly resifting heap or marking modified.
}
```

`Reset` is implemented as a `modtimer`. The runtime handles the heap reordering atomically.

### Status state machine

```
                +----------------+
       New ---> | timerNoStatus  |
                +----------------+
                       |
                       v
                +----------------+
                | timerWaiting   | <-- in heap, scheduled
                +----------------+
                  ^   |        \
                  |   |         \-- (firing) --> timerRunning --> timerRemoved
                  |   |
                  |   +-- (stop) --> timerDeleted --> timerRemoved (cleantimers)
                  |
                  +-- (reset) <-- timerModifying ...
```

The full state machine has more nodes (modifiedEarlier, modifiedLater, modifying, etc.) to handle concurrent Stop+Reset+Modify. For our purposes, the key insight is:

- A timer is "in the heap" if status is `timerWaiting` or a modified variant.
- `Stop` flips it to `timerDeleted` lazily.
- `cleantimers` reaps deleted timers and shrinks the heap.

This lazy reaping is why a freshly-stopped timer can briefly remain in heap memory. It does not affect correctness, only timing of memory release.

### Where the Go 1.23 GC fix slots in

In Go 1.23+, the `timer` struct gained a finalizer-like mechanism: when the GC determines that nothing user-reachable points to the timer's user-visible wrapper, the runtime can transition the timer's status to "abandoned." On the next `cleantimers` pass, abandoned timers are removed and their memory reclaimed.

The mechanism is integrated with the GC such that the runtime can prove safety: no concurrent fire can deliver to a channel that has been GC'd, because the timer's status is checked before the callback runs.

This is the missing piece that fixed pre-1.23 retention. It is also why the senior-level question "what changed in Go 1.23 with respect to timers" is best answered by referring to the `cleantimers` and `timer.status` interaction, not to a single "timers are now GC'd" sentence.

---

## Cross-P Migration and Stealing

Timers are owned by the P that created them. But Ps can come and go (idle Ps may be stopped under low load), and Ps can be unbalanced (one P with thousands of timers, others empty). The runtime handles this with stealing.

### Idle P stealing

When a P goes idle, its timers do not vanish. The runtime keeps the heap in place. If the idle P stays idle long enough that timers on it would expire, the runtime promotes them to another P that is awake.

The promotion logic is in `runtime/proc.go`'s scheduler loop. The function `findRunnable` checks other Ps' timer heaps when the local P has nothing to do.

### Why this matters for leaks

If your service has uneven timer distribution — say, all timers are created on the main goroutine which always runs on P0 — then P0's timer heap becomes very long while other Ps' heaps are empty. The runtime mitigates this with stealing, but if your `time.After` rate exceeds the steal rate, P0's heap can become a bottleneck.

This is rare but it happens. The symptom is one P pinned at high CPU while others are idle. The fix is to spread timer creation across goroutines on different Ps — typically a non-issue in normal Go code, but worth knowing.

### Why this matters for the GC

When the GC scans, it visits each P's timer heap. A million timers on one P is a million GC scan entries. A million timers spread across 16 Ps is roughly 62 500 entries per P. The latter is much faster to scan.

---

## Interaction With the Scheduler and `sysmon`

`sysmon` is the runtime's monitoring thread. It runs periodically (every ~10 ms by default) and performs housekeeping:

- Forcing GC if memory pressure is high.
- Preempting goroutines that have been running too long.
- Checking timers on idle Ps.
- Pumping the net poller.

For timers, `sysmon` provides a safety net. If no P is awake to fire a timer (e.g., all Ps are idle), `sysmon` wakes one up.

In practice, `sysmon` is rarely the bottleneck for timer leaks. But it does add a small fixed overhead per timer due to its checks.

### `sysmon` and net poller

The net poller is the runtime's mechanism for blocking on I/O readiness. It sleeps using OS primitives (`epoll`/`kqueue`/`IOCP`) and wakes when an FD becomes ready *or* when the timeout expires.

When you add a timer, the runtime updates the net poller's wakeup time to be the minimum of (its current wakeup, your timer's fire time). This guarantees the runtime wakes up in time to fire your timer.

For a service with many timers, this means the net poller is woken often. Idle services with few timers can sleep for long periods.

A pathology: if you have a million timers all set to fire at slightly different times (e.g., spread across a 30-second window), the runtime wakes the net poller continuously. The CPU usage of "just sitting there" is non-zero.

The fix: batch timers when you can. If you have a million "fire 30 seconds from now" needs, see if you can serve them all with a single ticker that wakes every second and checks a sorted list.

---

## The `netpoll` Deadline Integration

`net.Conn.SetReadDeadline` and friends do not use the public timer API. They use `runtime_pollSetDeadline`, which integrates with the net poller directly.

When you set a read deadline:

1. The runtime records the deadline on the file descriptor's net-poll entry.
2. The next read on the FD will return `os.ErrDeadlineExceeded` if the deadline elapses.
3. When the FD is closed, the deadline is cancelled automatically.

There is one internal timer per FD per deadline direction (read/write). Each `SetReadDeadline` call resets that timer.

This is much more efficient than spawning a goroutine with `time.After` to race against the read. There is no extra goroutine. The timer entry is in the runtime, integrated with the poller, and reaped automatically.

For senior-level service design, this is the answer to "how do we time out a network operation." Use deadlines, not external timers.

### When deadlines do not help

- Operations that do not respect deadlines. For example, a third-party library that blocks indefinitely on something not under the poller's control.
- Synchronous CPU work. Deadlines do not interrupt running goroutines.
- Operations that need cancellation propagation across many callers. Use `context.Context` on top of deadlines.

### Composing deadlines with context

```go
ctx, cancel := context.WithTimeout(ctx, d)
defer cancel()

c.SetReadDeadline(deadline(ctx))

n, err := c.Read(p)
if err != nil {
    if ctx.Err() != nil { return ctx.Err() }
    return err
}
```

The trick is using `ctx.Deadline()` to set the conn deadline. That way both the context and the conn agree on when to give up.

A more polished helper:

```go
func readWithCtx(ctx context.Context, c net.Conn, p []byte) (int, error) {
    if d, ok := ctx.Deadline(); ok {
        c.SetReadDeadline(d)
    }
    n, err := c.Read(p)
    if err != nil && ctx.Err() != nil {
        return n, ctx.Err()
    }
    return n, err
}
```

No external timer. No goroutine. The runtime's net poller drives both cancellation paths.

---

## Designing for Millions of Timers

Some workloads inherently need many concurrent timers:

- A distributed cache with per-key TTL.
- A scheduler that fires tasks at arbitrary future times.
- A rate limiter that resets per-IP buckets.

The naive design — one `*time.Timer` per entity — works up to ~100 000 entities. Beyond that, the runtime timer heap becomes a hotspot.

### Pattern 1: Sweeper

A single goroutine sweeps a data structure on a periodic schedule, expiring entries whose deadline has passed.

```go
type Cache struct {
    mu sync.Mutex
    items map[string]Item
}

type Item struct {
    Value      []byte
    Expiry     time.Time
}

func (c *Cache) Sweep(ctx context.Context) {
    t := time.NewTicker(time.Second)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case now := <-t.C:
            c.mu.Lock()
            for k, it := range c.items {
                if !it.Expiry.After(now) {
                    delete(c.items, k)
                }
            }
            c.mu.Unlock()
        }
    }
}
```

One timer for the entire cache. Resolution: 1 second. Memory: proportional to active entries, not timers.

### Pattern 2: Bucketed wheel

For very large numbers of timers with coarse resolution, a *hashed timing wheel* (Varghese & Lauck, 1987) is more efficient than a heap. The wheel has N slots; each slot is a list of timers scheduled for that slot. Insertion is O(1). Each tick advances the wheel by one slot and fires all timers in that slot.

Go does not have a built-in timing wheel, but you can implement one in a few hundred lines. Use it when:

- You have millions of timers.
- Latency precision of "within one wheel slot" is acceptable (e.g., one second).
- You can afford the wheel size in memory.

Libraries: `github.com/RussellLuo/timingwheel` is a clean implementation.

### Pattern 3: Sorted heap with manual advance

For mid-scale (hundreds of thousands of timers) with precise timing needs, an in-memory sorted heap advanced by a single internal goroutine is a good middle ground:

```go
type DelayQueue struct {
    mu    sync.Mutex
    heap  timerHeap
    wake  chan struct{}
}

func (q *DelayQueue) Schedule(at time.Time, f func()) {
    q.mu.Lock()
    heap.Push(&q.heap, &entry{when: at, f: f})
    q.mu.Unlock()
    select {
    case q.wake <- struct{}{}:
    default:
    }
}

func (q *DelayQueue) Run(ctx context.Context) {
    var t *time.Timer
    for {
        q.mu.Lock()
        next := time.Hour
        if q.heap.Len() > 0 {
            next = time.Until(q.heap[0].when)
        }
        q.mu.Unlock()

        if t == nil {
            t = time.NewTimer(next)
        } else {
            if !t.Stop() {
                select { case <-t.C: default: }
            }
            t.Reset(next)
        }

        select {
        case <-ctx.Done():
            t.Stop()
            return
        case <-q.wake:
            // re-evaluate next fire time
        case <-t.C:
            q.mu.Lock()
            now := time.Now()
            for q.heap.Len() > 0 && !q.heap[0].when.After(now) {
                e := heap.Pop(&q.heap).(*entry)
                go e.f()
            }
            q.mu.Unlock()
        }
    }
}
```

One `*time.Timer` for the whole queue, regardless of how many entries. Insertion is O(log N). Fire is O(K log N) for K firings.

### Trade-off summary

| Design | Timers in runtime | Insert cost | Fire latency | Memory |
|---|---|---|---|---|
| One timer per entity | N | O(log N runtime) | Exact | Highest |
| Sweeper | 1 | O(1) | Up to sweep interval | Lowest |
| Wheel | 1 | O(1) | Up to slot | Mid |
| Sorted heap with single timer | 1 | O(log N user) | Exact | Mid |

For most services, "sweeper" is the right answer. For high-precision schedulers, "sorted heap with single timer" is the right answer. The "one timer per entity" approach is the obvious-looking design that quietly drains the runtime.

---

## Case Postmortems

Three real-shaped incidents and how they were diagnosed and fixed. Names changed.

### Postmortem 1: The streaming service that ran out of memory after 14 hours

A video streaming service ran on a fleet of Go pods. After about 14 hours, pods would OOMKill and restart. New pods were healthy for another 14 hours. The pattern was extremely regular.

Investigation:

- `runtime.NumGoroutine` over time: grew from 3 000 at start to 50 000+ near OOM.
- `pprof -inuse_space` at 12-hour mark: 60% of inuse was `time.NewTimer`.
- `pprof goroutine?debug=2`: 47 000 goroutines parked in a function called `streamReader.heartbeat`.

The heartbeat function:

```go
func (s *streamReader) heartbeat() {
    for {
        select {
        case <-s.stop:
            return
        case <-time.After(30 * time.Second):
            s.send(ping)
        }
    }
}
```

`time.After(30 * time.Second)` in a loop. Every successful heartbeat allocated a fresh timer and dropped the previous one's reference. Pre-1.23 (the service was on Go 1.20), the timers stayed in the heap for 30 seconds each.

But that alone would not have caused unbounded growth — 30 seconds of retention should plateau. The actual leak was different:

- Streams could be closed via `s.stop`, but the closure of `s.stop` happened in another goroutine. Race between the closure and the iteration meant that some `streamReader.heartbeat` goroutines never noticed `s.stop` had closed (they were parked on `time.After` at the moment of close), and the `s.stop` channel was a `chan struct{}` that only signalled once, not closed.

So:

1. `time.After` allocations piled up at a steady 30-second retention.
2. Some goroutines never exited, even after their stream was logically closed.

Two bugs compounding.

The fix:

```go
func (s *streamReader) heartbeat() {
    t := time.NewTimer(30 * time.Second)
    defer t.Stop()
    for {
        if !t.Stop() {
            select { case <-t.C: default: }
        }
        t.Reset(30 * time.Second)
        select {
        case <-s.stop:
            return
        case <-t.C:
            s.send(ping)
        }
    }
}
```

And `s.stop` was changed to `close(s.stop)` instead of `s.stop <- struct{}{}` so all waiters got the signal.

After deployment, `NumGoroutine` plateaued at ~3 500 across pods. No more OOMs.

### Postmortem 2: The "intermittent" CPU spike

A payment service occasionally pegged at 100% CPU for 30–60 seconds, then returned to normal. The pattern was unpredictable. Latency P99 spiked during the events.

Investigation:

- pprof CPU profile during a spike: `runtime.runqsteal`, `runtime.checkTimers`, `runtime.siftdownTimer` near the top.
- pprof inuse: ~2 million `*time.Ticker` in heap.
- Searching the codebase for `time.NewTicker` revealed 30+ call sites.
- One of them, in a request handler:

```go
func (h *Handler) HandleRequest(r *Request) {
    t := time.NewTicker(time.Second)
    // ... use t ...
    // BUG: no t.Stop()
}
```

The handler ran several times per second. Each invocation created a `*time.Ticker` and forgot to stop it. The ticker continued firing indefinitely. Over hours, millions of leaked tickers accumulated. The runtime spent more and more time managing the timer heap.

The CPU spike happened when GC ran: the GC's mark phase walked the giant timer heap, and the work was significant enough to spike one or two cores.

Fix: `defer t.Stop()` in the handler. Within an hour after deployment, the leaked tickers were being collected (because the user-visible `*time.Ticker` was unreferenced, but pre-1.23 the runtime held them — the team upgraded to 1.21 which had partial improvements but not the full fix; full collection happened only after a restart).

### Postmortem 3: The "memory tripled in one deployment"

A backend service had been stable for months. After a deployment, memory tripled. Nothing in the diff looked memory-related.

Investigation:

- The diff added a new feature: a "request inspector" that ran a callback after each request to log slow requests.

```go
func InspectRequest(req *Request, slowAfter time.Duration) {
    time.AfterFunc(slowAfter, func() {
        log.Printf("slow request: id=%s payload=%v", req.ID, req.Payload)
    })
}
```

`req.Payload` was sometimes large (several KB). The closure captured the entire `req` by pointer. While the inspector was waiting for `slowAfter` (default 5 seconds), the entire request was retained.

At 10 000 RPS:

- 10 000 × 5 = 50 000 in-flight inspectors.
- Average payload ~5 KB.
- 50 000 × 5 KB = 250 MB pinned by inspectors alone.

The fix was to capture only the needed fields:

```go
func InspectRequest(req *Request, slowAfter time.Duration) {
    id := req.ID
    summary := summarize(req.Payload)
    time.AfterFunc(slowAfter, func() {
        log.Printf("slow request: id=%s summary=%v", id, summary)
    })
}
```

`id` is a string, `summary` is small. Closure size went from ~5 KB to ~256 bytes. Retained memory dropped from 250 MB to ~12 MB.

The bug was not a "leak" in the strict sense — every timer eventually fired and freed its closure. It was *retention*: the closure was held longer than needed by capturing too much.

Senior-level lesson: `AfterFunc` closures are a stealth memory amplifier. Audit every `AfterFunc` callsite for capture size.

---

## Self-Assessment

1. Explain what happens in the runtime when you call `time.After(5 * time.Minute)`. Where is the timer stored?
2. Why was the timer subsystem global pre-1.14, and why was that a scaling problem?
3. Describe the per-P timer heap. Which struct holds it? Which functions modify it?
4. What is `cleantimers` and when does it run?
5. Pre-Go 1.23, why could an unreferenced `time.After` timer not be garbage collected?
6. Describe the Go 1.23 mechanism (in broad strokes) that allows unreferenced timers to be collected.
7. Why did the 1.23 change not help with leaked `*time.Ticker`s?
8. How does `c.SetReadDeadline` differ from racing `time.After` against `c.Read`? Which is preferable and why?
9. What is the trade-off between "one timer per entity" and "sweeper" designs?
10. In a CPU profile, which runtime functions point at timer pressure?

Bonus:

11. You are designing a key-value store with 10 million keys, each with a TTL ranging from one second to one day. Naive design has one timer per key. What is your design instead, and why?
12. You see `time.AfterFunc` calls in a hot path. The callback captures a *Request. What is your refactor?
13. Your service is on Go 1.22. You profile and find `time.NewTimer` dominates `inuse_space`. You upgrade to 1.23 and the `inuse_space` drops by 90% but `alloc_space` is unchanged. Explain.
14. Describe the relationship between the timer heap and the net poller wakeup.
15. A colleague proposes using `time.Tick` because "it returns a clean channel and we never need to stop it." Convince them.

---

## Summary

The Go timer subsystem is not magic; it is a per-P min-heap accessed by the scheduler, with carefully designed atomic state transitions for `Stop`, `Reset`, and concurrent fire. The user-facing rules at junior and middle level fall out of this design:

- A timer is alive in the runtime as long as it is in some P's heap.
- It is in the heap until it fires or you call `Stop`.
- Therefore "forgetting to Stop" is the same as "asking the runtime to retain the timer."

Pre-Go 1.23, the runtime held timers strongly through the heap; user-side unreachability did not free them. Go 1.23 changed that for unreferenced timers, but tickers and stoppable-but-unstopped timers still leak.

At senior level, your skill is to:

- Trace a leak from a pprof heap profile through to the call site.
- Decide whether a 1.23 upgrade will help or not.
- Choose between per-entity timers, sweepers, and wheels based on the workload.
- Identify capture-induced retention in `AfterFunc` closures.

The next page (professional) takes this knowledge into production operation: how to monitor timer pressure, how to alert on timer leaks, and how to build SLOs that catch timer-related regressions early.

---

## Appendix A: A Glossary for the Runtime Internals

- **P**: A "processor" — a runtime abstraction for a logical CPU. The number of Ps is `GOMAXPROCS`.
- **M**: An OS thread. The runtime multiplexes goroutines across Ms.
- **G**: A goroutine. Each one has a tiny stack and runs on an M when scheduled.
- **timer heap**: A min-heap of `runtime.timer` structs ordered by fire time. One per P.
- **`runtime.timer`**: The runtime-internal timer struct. Fields: `when`, `period`, `f`, `arg`, `status`, etc.
- **`*time.Timer`**: The user-visible wrapper. Embeds a `runtime.timer`.
- **`net poller`**: Runtime's I/O readiness mechanism. Sleeps on `epoll`/`kqueue`/`IOCP`. Wakes when an FD is ready or when its timeout expires.
- **`sysmon`**: A runtime monitoring thread that runs periodically to do housekeeping.
- **`cleantimers`**: Runtime function that prunes deleted/expired timer entries from a P's heap.
- **`checkTimers`**: Runtime function called from the scheduler to fire any due timers on a P.
- **`addtimer` / `deltimer` / `modtimer`**: Runtime entry points for timer manipulation.

---

## Appendix B: Reading Lists

For a deeper dive, here are starting points (find the corresponding sources in the Go source tree):

1. `runtime/time.go` — the heart of timer machinery.
2. `runtime/proc.go` — scheduler integration, `findRunnable`, `runtimer` callbacks.
3. `time/sleep.go` — user-side wrappers.
4. `runtime/netpoll.go` — net poller integration with timers.
5. Release notes for Go 1.14 (per-P heap) and Go 1.23 (timer GC fix).
6. `runtime/trace/trace.go` and `internal/trace` — for the trace format used by `go tool trace`.
7. The Go GitHub issue tracker — search "timer" for ongoing discussions.

---

## Appendix C: Sample Reproduction Programs

### Reproducer 1: pre-1.23 retention

```go
package main

import (
    "fmt"
    "runtime"
    "time"
)

func main() {
    runtime.GC()
    var m runtime.MemStats
    runtime.ReadMemStats(&m)
    base := m.HeapAlloc

    for i := 0; i < 100_000; i++ {
        _ = time.After(10 * time.Second)
    }

    runtime.GC()
    runtime.ReadMemStats(&m)
    fmt.Printf("after creation, before any fires:\n")
    fmt.Printf("  HeapAlloc delta = %d KB\n", (m.HeapAlloc-base)/1024)

    time.Sleep(15 * time.Second)
    runtime.GC()
    runtime.ReadMemStats(&m)
    fmt.Printf("after all timers fired:\n")
    fmt.Printf("  HeapAlloc delta = %d KB\n", (m.HeapAlloc-base)/1024)
}
```

Run this on Go 1.22 and Go 1.23. The first measurement should differ by an order of magnitude. The second should match (because after firing, both versions release the memory).

### Reproducer 2: ticker leak

```go
package main

import (
    "fmt"
    "runtime"
    "time"
)

func main() {
    for i := 0; i < 10_000; i++ {
        _ = time.NewTicker(time.Hour)
    }
    runtime.GC()
    runtime.GC()

    var m runtime.MemStats
    runtime.ReadMemStats(&m)
    fmt.Printf("HeapInuse: %d MB\n", m.HeapInuse>>20)
}
```

10 000 leaked tickers. On any Go version, this allocates noticeable memory and does not release. Even Go 1.23 does not collect tickers (the runtime keeps re-inserting them after each tick).

### Reproducer 3: per-P heap distribution

```go
package main

import (
    "fmt"
    "runtime"
    "sync"
    "time"
)

func main() {
    n := runtime.GOMAXPROCS(0)
    var wg sync.WaitGroup
    for i := 0; i < n; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for j := 0; j < 100_000; j++ {
                _ = time.NewTimer(time.Hour)
            }
        }()
    }
    wg.Wait()

    var m runtime.MemStats
    runtime.ReadMemStats(&m)
    fmt.Printf("HeapInuse with %d Ps: %d MB\n", n, m.HeapInuse>>20)
}
```

Distributes timer creation across goroutines, which typically run on different Ps. The total timer count is `n * 100_000`, spread across n heaps.

---

## Appendix D: How To Investigate A Timer Suspect

If you suspect a timer leak in a service, follow this playbook:

1. Connect to the service's pprof endpoint.
2. `curl http://.../debug/pprof/goroutine?debug=2 > goroutines.txt`. Search for `time.After`, `time.Tick`, `time.NewTimer`. Count goroutines parked on each.
3. `go tool pprof -inuse_space http://.../debug/pprof/heap`. `top10`. If `time.NewTimer`, `time.NewTicker`, or `time.After` appears, drill down with `peek` and `list`.
4. `go tool pprof -alloc_space http://.../debug/pprof/heap`. Same analysis. High allocation rates often indicate churn.
5. Snapshot `runtime.MemStats` over a 10-minute window. Plot `HeapAlloc` and `HeapInuse`. Trends matter more than instantaneous values.
6. If suspicion is high, capture a `runtime/trace`. Look for dense timer-fire events.
7. Once you have the call site, audit it for:
   - `time.After` or `time.Tick` in a loop or hot path.
   - Missing `defer t.Stop()` for `NewTimer` or `NewTicker`.
   - `Reset` without drain.
   - `AfterFunc` callbacks with heavy captures.
8. Patch, deploy, re-measure.

This playbook applied with discipline diagnoses 95% of real-world timer issues.

---

## Appendix E: Timing-Wheel Implementation Sketch

For curiosity, here is the skeleton of a hashed timing wheel suitable for millions of timers:

```go
type Wheel struct {
    slots     []*list.List // ring buffer
    n         int          // number of slots
    tickDur   time.Duration
    cur       int          // current slot index
    mu        sync.Mutex
}

func NewWheel(n int, tick time.Duration) *Wheel {
    w := &Wheel{n: n, tickDur: tick, slots: make([]*list.List, n)}
    for i := range w.slots {
        w.slots[i] = list.New()
    }
    return w
}

func (w *Wheel) Run(ctx context.Context) {
    t := time.NewTicker(w.tickDur)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case <-t.C:
            w.advance()
        }
    }
}

func (w *Wheel) advance() {
    w.mu.Lock()
    w.cur = (w.cur + 1) % w.n
    slot := w.slots[w.cur]
    var fire []func()
    for e := slot.Front(); e != nil; e = e.Next() {
        ent := e.Value.(*entry)
        if ent.rounds == 0 {
            fire = append(fire, ent.f)
        } else {
            ent.rounds--
        }
    }
    // Remove fired entries.
    next := list.New()
    for e := slot.Front(); e != nil; e = e.Next() {
        ent := e.Value.(*entry)
        if ent.rounds > 0 {
            next.PushBack(ent)
        }
    }
    w.slots[w.cur] = next
    w.mu.Unlock()
    for _, f := range fire {
        go f()
    }
}

func (w *Wheel) Schedule(d time.Duration, f func()) {
    w.mu.Lock()
    defer w.mu.Unlock()
    ticks := int(d / w.tickDur)
    slot := (w.cur + ticks) % w.n
    rounds := ticks / w.n
    w.slots[slot].PushBack(&entry{rounds: rounds, f: f})
}

type entry struct {
    rounds int
    f      func()
}
```

This is a hashed-and-hierarchical-free version. Scheduling is O(1). Each tick fires entries whose `rounds == 0`. Memory is proportional to the number of pending entries, with one slot list per ring slot.

For a million pending timers, total runtime overhead is a single `*time.Ticker` driving the wheel. Compare to a million `*time.Timer` instances in the runtime heap — orders of magnitude less.

In production, libraries like `RussellLuo/timingwheel` implement a hierarchical version that improves performance for very long durations.

---

## Appendix F: Reading the Go 1.23 Runtime Diff

If you want to read the actual code change, the relevant CLs are in the `runtime/time.go` and `runtime/mgcsweep.go` files. The high-level structure of the change:

1. The `timer` struct gained additional fields for GC-aware status tracking.
2. The `runtime.timers` heap data structure was simplified.
3. The `addtimer`, `deltimer`, and `modtimer` functions were rewritten in places to use atomic state transitions that the GC can observe.
4. A new "sentinel" status (`timerNoStatus` after GC) marks timers that the GC reclaimed mid-flight.
5. The fire path checks the sentinel and skips reclaimed timers.

The effect:

- A timer that has been GC'd before its fire time simply does not fire. The channel value is never sent.
- The user-side semantics are unchanged: from the user's perspective, they dropped the channel reference and lost interest, so it does not matter that the value was never sent.
- The runtime saves the memory and the CPU it would have spent firing into a discarded channel.

This is a subtle but important change. Read it carefully if you maintain Go-level libraries that depend on timer behaviour.

---

## Appendix G: Comparison to Other Runtimes

For context: how do other runtimes handle this problem?

- **Java**: `java.util.Timer` uses a single thread per timer instance. Multiple timers can share a `ScheduledThreadPoolExecutor`. `ScheduledFuture.cancel(false)` does not remove the entry from the queue — it just marks it cancelled. The executor cleans up later. Same "lazy deletion" pattern as Go.
- **Rust (tokio)**: Tokio's timer is a hierarchical timing wheel. Dropping a `Sleep` future cancels it immediately, including removing from the wheel. No equivalent of pre-1.23 retention.
- **Node.js**: `setTimeout` uses libuv's timer wheel. `clearTimeout` removes immediately. No retention issue.
- **Python (asyncio)**: `asyncio.call_later` returns a `Handle` you can `cancel`. The cancellation marks the handle and removes lazily from the heap.

Go's design is closest to Java's: lazy deletion, periodic cleanup. The pre-1.23 retention was an artefact of how the heap was rooted from the runtime. The 1.23 fix moved Go closer to the tokio/libuv ideal of "drop = cancel".

---

## Appendix H: Best Practices Distilled

If you are setting style guidelines for a Go team, the timer-related rules should be:

1. **No `time.After` inside `for` loops.** Use `time.NewTimer`.
2. **No `time.Tick` outside `main`.** Use `time.NewTicker` with `defer Stop`.
3. **Every `time.NewTimer` and `time.NewTicker` must have `defer t.Stop()` on the same logical block.**
4. **`time.Reset` must be preceded by `Stop` and a non-blocking channel drain, unless the channel was just read.**
5. **`time.AfterFunc` closures must not capture large objects. Capture only the fields needed.**
6. **Per-call timeouts use `context.WithTimeout`, not external timers.**
7. **Network I/O timeouts use `SetReadDeadline` / `SetWriteDeadline`, not external timers.**
8. **High-cardinality TTL needs (caches, sessions) use sweepers, not per-entity timers.**

Enforce these in code review or with `gocritic` / `staticcheck`. Most violations are easy to catch automatically.

---

## Appendix I: Future Directions

Looking ahead, several improvements are plausible in future Go versions:

- **First-class timing wheel** in the standard library, exposed as `time.Wheel` or similar. The runtime already has the building blocks; lifting them into a user-facing API would standardise the pattern.
- **Compile-time linting** for `time.After` in loops. `go vet` could plausibly add this rule.
- **Tighter integration with `context`** so that `context.WithDeadline` and the I/O deadline machinery share a single underlying mechanism.
- **Improved tooling** for "show me all active timers" via `runtime/pprof` or `runtime/trace`.

None of this is announced, but the trend is clear: timers are a known operational pain point, and the Go team has been iterating on them for years.

---

## Appendix J: Worked Example — Diagnosing A Timer Leak From A Heap Profile

Let us walk through a complete diagnosis end-to-end. Assume a service that you suspect is leaking. You have shell access and pprof endpoints exposed on `localhost:6060`.

### Step 1: snapshot

```bash
curl -s http://localhost:6060/debug/pprof/heap > heap.pprof
curl -s 'http://localhost:6060/debug/pprof/goroutine?debug=2' > goroutines.txt
```

### Step 2: identify large allocators

```bash
go tool pprof -inuse_space heap.pprof
(pprof) top10
Showing nodes accounting for 1.42GB, 86.45% of 1.64GB total
      flat  flat%   sum%        cum   cum%
    0.84GB 51.24% 51.24%     0.84GB 51.24%  time.NewTimer
    0.21GB 12.83% 64.07%     0.21GB 12.83%  bytes.makeSlice
    0.18GB 11.00% 75.07%     0.18GB 11.00%  encoding/json.Unmarshal
    0.11GB  6.71% 81.78%     0.11GB  6.71%  net/http.(*Server).Serve
    0.08GB  4.67% 86.45%     0.08GB  4.67%  runtime.malg
    ...
```

`time.NewTimer` is half of inuse. This is a timer leak.

### Step 3: find the call site

```
(pprof) peek time.NewTimer
Showing nodes accounting for 1.64GB, 100% of 1.64GB total
----------------------------------------------------------+-------------
      flat  flat%   sum%        cum   cum%   calls calls% + context
----------------------------------------------------------+-------------
                                            0.72GB 85.71% |   time.After
                                            0.09GB 10.71% |   main.handleConn
                                            0.03GB  3.57% |   main.runHeartbeat
    0.84GB 51.24% 51.24%     0.84GB 51.24%                | time.NewTimer
```

Most of the leak is `time.After` (which calls `NewTimer`). The next biggest is `handleConn`.

```
(pprof) peek time.After
----------------------------------------------------------+-------------
                                            0.45GB 62.50% |   main.(*Worker).loop
                                            0.18GB 25.00% |   main.(*Client).Do
                                            0.09GB 12.50% |   main.handleConn
    0.72GB 43.90% 43.90%     0.72GB 43.90%                | time.After
```

`main.(*Worker).loop` is the largest contributor.

```
(pprof) list (*Worker).loop
ROUTINE ======================== main.(*Worker).loop in /app/worker.go
    0.45GB     0.45GB (flat, cum) 27.44% of Total
         .          .     38:func (w *Worker) loop() {
         .          .     39:    for {
         .          .     40:        select {
         .          .     41:        case msg := <-w.in:
         .          .     42:            w.handle(msg)
    0.45GB     0.45GB     43:        case <-time.After(w.idleTimeout):
         .          .     44:            return
         .          .     45:        }
         .          .     46:    }
         .          .     47:}
```

Line 43 is the leak. `time.After` in a hot loop.

### Step 4: cross-check with goroutines

```
grep -A 3 'goroutine ' goroutines.txt | grep -c 'time.After'
47315
```

47 000 goroutines are parked on `time.After`. Consistent with the heap profile.

### Step 5: fix

Edit `worker.go`:

```go
func (w *Worker) loop() {
    t := time.NewTimer(w.idleTimeout)
    defer t.Stop()
    for {
        if !t.Stop() {
            select { case <-t.C: default: }
        }
        t.Reset(w.idleTimeout)
        select {
        case msg := <-w.in:
            w.handle(msg)
        case <-t.C:
            return
        }
    }
}
```

### Step 6: verify

Deploy. Wait 30 minutes. Re-snapshot:

```
(pprof) top10
Showing nodes accounting for 0.42GB, 78.45% of 0.54GB total
      flat  flat%   sum%        cum   cum%
    0.12GB 22.22% 22.22%     0.12GB 22.22%  bytes.makeSlice
    0.09GB 16.67% 38.89%     0.09GB 16.67%  encoding/json.Unmarshal
    0.07GB 12.96% 51.85%     0.07GB 12.96%  net/http.(*Server).Serve
    0.05GB  9.26% 61.11%     0.05GB  9.26%  runtime.malg
    0.03GB  5.56% 66.67%     0.03GB  5.56%  time.NewTimer
    ...
```

`time.NewTimer` is now at 5%. The leak is gone.

Total elapsed time for the diagnosis: ~30 minutes of analysis, plus deployment and verification. This is the kind of investigation that senior Go engineers should be able to run from memory.

---

## Appendix K: An Architectural Pattern for Heavy Timer Use

When you build a system that genuinely needs many concurrent timers, the architecture should be:

1. A *single* internal scheduler component that owns one or two `*time.Timer` instances.
2. User-facing API that does not expose timers.
3. Internal data structure: heap, wheel, or sorted skiplist.
4. Cancellation as a first-class operation: every scheduled entry has a handle whose `Cancel()` is O(1) or O(log N).
5. Tests that verify entries are reaped after they fire or are cancelled.

Example skeleton:

```go
type Scheduler struct {
    mu    sync.Mutex
    heap  itemHeap
    wake  chan struct{}
}

type Item struct {
    when    time.Time
    fn      func()
    cancelled atomic.Bool
}

func (s *Scheduler) Schedule(d time.Duration, fn func()) *Item {
    it := &Item{when: time.Now().Add(d), fn: fn}
    s.mu.Lock()
    heap.Push(&s.heap, it)
    s.mu.Unlock()
    select { case s.wake <- struct{}{}: default: }
    return it
}

func (it *Item) Cancel() {
    it.cancelled.Store(true)
}

func (s *Scheduler) Run(ctx context.Context) {
    t := time.NewTimer(time.Hour)
    defer t.Stop()
    for {
        s.mu.Lock()
        if s.heap.Len() == 0 {
            s.mu.Unlock()
            select {
            case <-ctx.Done():
                return
            case <-s.wake:
                continue
            }
        }
        nextWhen := s.heap[0].when
        s.mu.Unlock()

        d := time.Until(nextWhen)
        if !t.Stop() { select { case <-t.C: default: } }
        t.Reset(d)

        select {
        case <-ctx.Done():
            return
        case <-s.wake:
            // re-evaluate
        case <-t.C:
            s.mu.Lock()
            now := time.Now()
            for s.heap.Len() > 0 && !s.heap[0].when.After(now) {
                it := heap.Pop(&s.heap).(*Item)
                if !it.cancelled.Load() {
                    go it.fn()
                }
            }
            s.mu.Unlock()
        }
    }
}
```

This is the production-grade shape. Per-item cost is O(log N) for insertion, O(1) for cancellation, O(log N) per fire. Total active runtime timers: one. Total scheduled items can be in the millions.

For a billion-key cache, you would not even use this — you would use a wheel because O(log N) starts to hurt. But for hundreds of thousands of items with precise timing, this scheduler is the right shape.

---

## Appendix L: Putting It All Together

The senior-level mental model is:

1. **Every timer in the user's code creates a `runtime.timer` entry in a per-P heap.**
2. **The runtime keeps that entry alive until the timer fires or is stopped.**
3. **Pre-Go 1.23, that liveness pinned all reachable state from the timer.**
4. **Go 1.23 added a mechanism to reclaim unreferenced timers before they fire, narrowing the retention window.**
5. **Tickers and `AfterFunc` still require explicit cleanup.**
6. **For high cardinality, build your own scheduler with one runtime timer.**
7. **For per-call timeouts, use `context.WithTimeout`.**
8. **For network I/O, use deadlines.**

The user-facing rules at junior and middle level are the surface. This is the underlying machinery. Knowing it lets you:

- Reason about which Go versions exhibit which leaks.
- Design APIs that do not surprise callers with hidden timer costs.
- Investigate production incidents starting from a heap profile.
- Make informed decisions about when to roll your own scheduler.

That is the senior-level material. The professional page next discusses operationalising this knowledge: monitoring, alerting, SLOs, and incident response.

---

## Appendix M: A Final Worked Code Audit

Read the following code carefully. Identify every timer-related issue. The answer key is below.

```go
package main

import (
    "context"
    "log"
    "net/http"
    "time"
)

type Client struct {
    base    *http.Client
    timeout time.Duration
}

func (c *Client) Get(url string) ([]byte, error) {
    req, _ := http.NewRequest("GET", url, nil)
    done := make(chan struct{})
    var body []byte
    var err error
    go func() {
        resp, e := c.base.Do(req)
        if e != nil {
            err = e
            close(done)
            return
        }
        defer resp.Body.Close()
        body, err = io.ReadAll(resp.Body)
        close(done)
    }()
    select {
    case <-done:
        return body, err
    case <-time.After(c.timeout):
        return nil, fmt.Errorf("timeout")
    }
}

type Server struct {
    clients map[string]*Conn
}

func (s *Server) start() {
    go func() {
        for now := range time.Tick(30 * time.Second) {
            s.expire(now)
        }
    }()
}

type Worker struct {
    in chan Job
}

func (w *Worker) run() {
    timeout := 5 * time.Second
    for {
        select {
        case j := <-w.in:
            w.handle(j)
        case <-time.After(timeout):
            log.Println("idle")
        }
    }
}

type Cache struct {
    items map[string]*Item
}

type Item struct {
    Value []byte
    timer *time.Timer
}

func (c *Cache) Set(key string, value []byte, ttl time.Duration) {
    item := &Item{Value: value}
    item.timer = time.AfterFunc(ttl, func() {
        delete(c.items, key)
    })
    c.items[key] = item
}
```

### Answer key

1. `Client.Get`: `time.After(c.timeout)` per call. Should use `context.WithTimeout`. Also the goroutine running `c.base.Do(req)` does not respect the context, so on timeout it continues running until the request completes. Two bugs.
2. `Server.start`: `time.Tick(30 * time.Second)`. Outside of `main`. Should be `time.NewTicker` with `defer Stop`. Plus the goroutine has no exit path — if `Server` is destroyed, the goroutine never returns.
3. `Worker.run`: `time.After` in a `for` loop. The classic leak. Should use a reusable `NewTimer`.
4. `Cache.Set`: `AfterFunc` callback captures `c` and `key`. The closure pins the cache and the key until the timer fires. Also there is no synchronisation around `c.items`, so concurrent `Set` and the callback firing will race. The callback should hold a mutex.

A code review that catches all four is a solid demonstration of senior-level understanding.

---

## Appendix N: Closing Thought

The Go timer subsystem rewards a specific kind of attention. It is not deep in the way a memory allocator is deep, with intricate data structures and tens of thousands of lines of code. But it is *tricky* in the way that scheduling code is always tricky: the interactions between user code and runtime are subtle, the correctness conditions involve atomic state transitions, and the symptoms of misuse can take hours or days to manifest.

You do not need to memorise the source. You need to internalise three things:

- *Where* the timer lives (a per-P heap).
- *How long* it lives (until it fires or is stopped).
- *Who* owns the cleanup obligation (you, the user, except for the narrow class of 1.23-reclaimable timers).

Internalise those, and the user-facing rules become inevitable consequences. You will spot violations on first read of any pull request. You will diagnose leaks from one screenshot of pprof. You will make architectural decisions about per-entity vs sweeper without hesitation.

That is the senior level. The next page takes it to production.

---

## Appendix O: The Atomic State Machine of `runtime.timer`

The `runtime.timer` struct uses an atomic `status` field to coordinate among Stop, Reset, fire, and clean operations. Understanding this state machine is the difference between guessing about timer behaviour and reasoning about it.

The states (as of Go 1.20–1.22, with naming variations across versions):

- `timerNoStatus` (0): freshly created, not in any heap.
- `timerWaiting` (1): in a P's heap, scheduled to fire.
- `timerRunning` (2): the timer's callback is currently executing.
- `timerDeleted` (3): marked for removal but still physically present in the heap.
- `timerRemoving` (4): being removed from the heap.
- `timerRemoved` (5): physically removed; the struct may be reused.
- `timerModifying` (6): being updated in place.
- `timerModifiedEarlier` (7): modified to fire sooner; heap order needs fixup.
- `timerModifiedLater` (8): modified to fire later; heap order needs fixup.
- `timerMoving` (9): being moved between P heaps.

The transitions, simplified:

```
                +--------------+
                | timerNoStatus|
                +------+-------+
                       | addtimer
                       v
                +--------------+
                | timerWaiting +<------+
                +------+-------+       |
                       |               |
       Stop:           | Fire:         | Reset:
       CAS to          | CAS to        | CAS to
       timerDeleted    | timerRunning  | timerModifying
                       |               |
                       v               v
              +-----------------+   +----------------+
              | timerRunning   |   | timerModifying  |
              +--------+--------+   +-------+--------+
                       |                    |
                       | callback returns   | done modifying
                       v                    v
              +-----------------+   +----------------+
              | timerRemoved   |   | timerModifiedEarlier|
              | (if !period)   |   | or              |
              | OR back to     |   | timerModifiedLater  |
              | timerWaiting   |   +-------+--------+
              | (if period > 0)|           |
              +----------------+           | cleantimers
                                           v
                                  back to timerWaiting in heap
```

Several invariants hold:

- A transition is always via CAS, so two goroutines racing on Stop+Reset never corrupt the timer.
- The runtime never mutates the heap structure for a timer in `timerRunning`; it waits for the callback to finish.
- `cleantimers` is responsible for actually removing entries marked `timerDeleted` and re-sifting entries marked `timerModifiedEarlier`/`Later`.

If you want to read this in the source, look for the function `dodeltimer`, `dodeltimer0`, `addtimer`, `modtimer`, and `cleantimers` in `runtime/time.go` of any version between 1.14 and 1.22. The exact CAS values change but the structure is stable.

### Why the state machine matters

Without this state machine, concurrent `Stop` and `Reset` would race. Consider two goroutines:

- Goroutine A: calls `Stop()`.
- Goroutine B: calls `Reset(d)`.

Both run at almost the same time. Without atomic states:

- A might mark the timer deleted while B is mid-flight in `Reset`.
- B might modify the timer's `when` while A is mid-flight in `Stop`.
- The heap could end up with a stale `when` or a missing entry.

With atomic states:

- A CASes from `Waiting` to `Deleted`. If successful, A is the owner.
- B CASes from `Waiting` to `Modifying`. If B sees `Deleted`, B knows A won; B aborts or re-adds.

The CAS race resolves cleanly. No goroutine corrupts shared state.

### What this means for user code

For the user, the implication is that **`Stop()` and `Reset()` are safe to call concurrently** — meaning the runtime will not crash or corrupt heap state. But the *user-visible behaviour* (channel state, fire delivery) still depends on the order in which the calls execute.

In practice, this means: **do not call `Reset` and `Stop` from two different goroutines without external synchronisation if you care about whether the timer fires.** The runtime is safe; your program logic may not be.

---

## Appendix P: The `cleantimers` Function

`cleantimers` is one of the unsung heroes of the timer subsystem. Its job is to remove the heap entries for timers that have been marked `timerDeleted` and to re-sort entries marked `timerModifiedEarlier`/`Later`.

It is called:

- At the top of `addtimer`, before inserting a new timer.
- At the top of `deltimer` for some implementations.
- From the scheduler when it checks a P's timers.
- From `cleantimers` itself recursively to drain a batch.

Its high-level behaviour:

```go
func cleantimers(pp *p) {
    gp := getg().m.curg
    for {
        if len(pp.timers) == 0 {
            return
        }

        t := pp.timers[0]
        if t.pp.ptr() != pp {
            throw("cleantimers: bad p")
        }

        switch s := t.status.Load(); s {
        case timerDeleted:
            if !t.status.CompareAndSwap(s, timerRemoving) {
                continue
            }
            dodeltimer0(pp)
            if !t.status.CompareAndSwap(timerRemoving, timerRemoved) {
                throw("cleantimers: status not removing")
            }
            pp.deletedTimers.Add(-1)

        case timerModifiedEarlier, timerModifiedLater:
            if !t.status.CompareAndSwap(s, timerMoving) {
                continue
            }
            t.when = t.nextwhen
            dodeltimer0(pp)
            doaddtimer(pp, t)
            if !t.status.CompareAndSwap(timerMoving, timerWaiting) {
                throw("cleantimers: status not moving")
            }

        default:
            return
        }
    }
}
```

(Simplified; exact code varies.)

The function loops as long as the top of the heap is in a "cleanable" state. Once the top is `timerWaiting` (i.e., legitimate and scheduled), the function returns.

This is the reason "Stop is lazy": `Stop` just CASes the status. The actual heap shuffle is deferred until `cleantimers` runs. This makes `Stop` O(1) most of the time, with the heap maintenance amortised across other operations.

### What this means for leak diagnosis

If you have a huge backlog of `timerDeleted` entries that have not yet been cleaned, the heap stays large even though many entries are logically dead. The `pp.deletedTimers` counter tracks how many such zombies exist. When the count exceeds some threshold (e.g., `len(timers)/4`), `cleantimers` works harder to reap them.

This means that observing a large heap immediately after a flurry of `Stop` calls does not necessarily mean a leak — it means the lazy cleanup has not yet run. Wait a moment and re-check.

But sustained large heap size *does* mean leak: either timers are being created faster than they fire, or they are being created without `Stop` and waiting out their full duration.

---

## Appendix Q: Timer Coalescing and System-Level Considerations

Some operating systems coalesce timer wakeups to save power. Linux's `epoll_wait` with a timeout can be served by the kernel using a relative timer in the kernel's timer wheel. Multiple `epoll_wait` calls with slightly different timeouts may be coalesced if the kernel decides that running them together is acceptable.

This is largely transparent to Go but matters for two reasons:

1. **Power management**: on laptops or low-power devices, the runtime trying to wake every 100µs can prevent the CPU from sleeping. Coalescing helps.
2. **Latency precision**: a timer set for "exactly 250 ms from now" may fire 252 ms or 280 ms later due to coalescing. Go's docs note that timers have at-best millisecond precision on most systems and "fire at or after the specified duration."

For high-precision timing (e.g., audio, video synchronisation), Go's standard timer is not the right tool. Use a `time.Ticker` with very short duration and accept the OS-level jitter, or use `time.Now()` polling in a tight loop with `runtime.Gosched()` for sub-millisecond responsiveness.

For most server workloads, the jitter is irrelevant.

### Sleep behaviour vs busy-wait

`time.Sleep` is implemented via a `runtime.timer` internally. It does *not* busy-wait. It parks the goroutine using `gopark`, the scheduler runs other goroutines, and the timer fires later to unpark.

If you write:

```go
end := time.Now().Add(d)
for time.Now().Before(end) {}
```

This is a busy-wait that pegs a CPU core. Do not do this. `time.Sleep(d)` does the right thing.

### Sleep precision and `monotonic` clock

`time.Now()` returns a `time.Time` that internally contains both a wall clock reading and a monotonic clock reading. `time.Since` and `time.Until` use the monotonic component, so they are immune to wall-clock jumps (NTP adjustments, manual clock changes, DST).

This matters for timer-related code: if you compute `deadline := time.Now().Add(d)` and then call `time.Until(deadline)`, the result is monotonic-correct. The runtime uses monotonic time internally for all timer scheduling.

If you serialise a `time.Time` to JSON, the monotonic reading is dropped. The deserialised value uses wall-clock time only. This is rarely a problem but worth knowing.

---

## Appendix R: A Cookbook for Heavy Schedulers

If you are building a system that schedules tasks at arbitrary future times (a job scheduler, a rate limiter with per-key reset, a delayed message queue), here is a recipe.

### Design 1: in-memory delay queue (up to ~100K pending entries)

Use a single sorted slice or heap, driven by one runtime timer:

```go
type DelayQueue struct {
    mu     sync.Mutex
    heap   delayHeap
    waker  chan struct{}
    closed atomic.Bool
}

type delayItem struct {
    fireAt time.Time
    f      func()
}

type delayHeap []*delayItem

// Implement heap.Interface
func (h delayHeap) Len() int { return len(h) }
func (h delayHeap) Less(i, j int) bool { return h[i].fireAt.Before(h[j].fireAt) }
func (h delayHeap) Swap(i, j int) { h[i], h[j] = h[j], h[i] }
func (h *delayHeap) Push(x any) { *h = append(*h, x.(*delayItem)) }
func (h *delayHeap) Pop() any {
    old := *h
    n := len(old)
    x := old[n-1]
    *h = old[:n-1]
    return x
}

func NewDelayQueue() *DelayQueue {
    q := &DelayQueue{waker: make(chan struct{}, 1)}
    return q
}

func (q *DelayQueue) Schedule(d time.Duration, f func()) {
    q.mu.Lock()
    heap.Push(&q.heap, &delayItem{fireAt: time.Now().Add(d), f: f})
    q.mu.Unlock()
    select {
    case q.waker <- struct{}{}:
    default:
    }
}

func (q *DelayQueue) Close() {
    q.closed.Store(true)
    select {
    case q.waker <- struct{}{}:
    default:
    }
}

func (q *DelayQueue) Run() {
    t := time.NewTimer(time.Hour)
    if !t.Stop() {
        <-t.C
    }
    defer t.Stop()

    for {
        if q.closed.Load() {
            return
        }

        q.mu.Lock()
        if q.heap.Len() == 0 {
            q.mu.Unlock()
            select {
            case <-q.waker:
                continue
            }
        }
        next := q.heap[0].fireAt
        q.mu.Unlock()

        d := time.Until(next)
        if d <= 0 {
            q.fire()
            continue
        }

        if !t.Stop() {
            select {
            case <-t.C:
            default:
            }
        }
        t.Reset(d)

        select {
        case <-q.waker:
        case <-t.C:
            q.fire()
        }
    }
}

func (q *DelayQueue) fire() {
    q.mu.Lock()
    now := time.Now()
    var fired []*delayItem
    for q.heap.Len() > 0 && !q.heap[0].fireAt.After(now) {
        fired = append(fired, heap.Pop(&q.heap).(*delayItem))
    }
    q.mu.Unlock()
    for _, it := range fired {
        it.f()
    }
}
```

Properties:

- One `*time.Timer` for the whole queue.
- O(log N) scheduling.
- Fires happen "in order" by `fireAt`.

This is the right shape for most workloads. Tested up to ~1M pending entries on commodity hardware.

### Design 2: timing wheel for very large or very long-tail workloads

The wheel discussed earlier scales to billions of entries because insertion is O(1). The trade-off is coarser fire resolution (one slot per tick).

### Design 3: per-bucket worker

For workloads with rate-limit-style periodicity (e.g., "every IP gets reset every minute"), do not schedule individual timers. Use a single periodic ticker and iterate over buckets:

```go
func (l *RateLimiter) sweep() {
    t := time.NewTicker(time.Minute)
    defer t.Stop()
    for now := range t.C {
        l.mu.Lock()
        for ip, b := range l.buckets {
            if b.lastReset.Add(time.Minute).Before(now) {
                b.count = 0
                b.lastReset = now
            }
        }
        l.mu.Unlock()
    }
}
```

This is a sweeper. One timer total. Easy to reason about.

---

## Appendix S: Production Operating Practices

For services that run continuously in production, build the following habits.

### Practice 1: Timer-count metrics

Expose `runtime.NumGoroutine` as a metric. Expose a derived "active timers" estimate by parsing pprof goroutine dumps (manually or via a periodic in-process job that counts goroutines parked on timer-related call sites).

Track these metrics over weeks. A creeping upward trend is the early signal of a timer leak.

### Practice 2: Alert on growth, not absolute value

Absolute number of goroutines or timers depends on traffic and architecture. Growth over time is the universal symptom.

Alert template: "NumGoroutine has grown by more than 50% over the last 24 hours without a corresponding increase in QPS."

### Practice 3: Heap-profile diffing in CI

For services where memory matters, capture `inuse_space` profiles at the end of integration tests. Compare across PRs. If a PR adds timer allocation patterns, the diff highlights them.

Tools like `pprof-differ` or simple custom scripts can do this.

### Practice 4: Lint timer patterns

Configure `golangci-lint` with `gocritic`'s `timeAfterLoop` check. Add custom linters for `time.Tick` usage outside `main`. Make these mandatory in CI.

### Practice 5: Runbook for timer leaks

Document the diagnosis flow in your team's runbook:

1. Check NumGoroutine trend.
2. If trending up, capture pprof inuse_space and alloc_space.
3. If `time.NewTimer` or `time.NewTicker` is in the top, drill down with `peek` and `list`.
4. Identify the call site. Confirm fix with `git log` against the suspected file.
5. Patch, deploy, observe.

A team that runs this drill once per quarter (perhaps as part of game days) builds the muscle to do it instinctively in real incidents.

---

## Appendix T: The Subtle Bug of Channel Capacity

`time.Timer.C` is a `chan Time` with capacity 1. This means the runtime can send at most one value before the channel buffer fills. If nobody reads, subsequent fires would block — but for a one-shot `*Timer`, there are no subsequent fires.

For a `*Ticker`, the runtime *drops* additional ticks that cannot be enqueued. The ticker's documented behaviour is: "if the receiver falls behind, ticks are dropped." This is by design — it prevents a slow consumer from being overwhelmed.

But it can be a surprise. If your consumer is slow, you do not see "all" the ticks. Your code may assume a tick rate of 1/sec but the consumer can fall behind and the actual delivery may be lower.

If you need every tick to be observed (e.g., for billing or accounting), do not use a `Ticker`. Use a `for { sleep; do }` loop, or maintain a counter that you compute from `time.Since(start)` divisions.

### What this means for leak detection

If you see a goroutine parked on `<-t.C` for a ticker that has been firing for hours, the channel buffer is full (one element waiting). The ticker continues firing into a full buffer; those fires are silently dropped. The runtime does not warn you. You can detect this only by noticing that downstream actions have ceased.

This is rare in practice but it has caused incidents. The fix is usually to make the consumer faster or to skip the ticker entirely in favour of `time.Now()` based scheduling.

---

## Appendix U: `time.NewTimer(0)` and Immediate Fires

`time.NewTimer(0)` schedules a timer to fire immediately. The runtime queues it in the heap with `when == now`. On the next scheduler check (which happens within microseconds), the timer fires.

This pattern is occasionally useful:

```go
t := time.NewTimer(0)
for {
    select {
    case <-t.C:
        doWork()
        t.Reset(workInterval)
    case <-ctx.Done():
        return
    }
}
```

Allows the loop to fire once immediately on startup, then settle into a periodic rhythm. Equivalent to:

```go
doWork()
t := time.NewTimer(workInterval)
for {
    select {
    case <-t.C:
        doWork()
        t.Reset(workInterval)
    case <-ctx.Done():
        return
    }
}
```

The `NewTimer(0)` version is slightly more elegant because all loop logic is in one branch.

### `time.Sleep(0)` and `runtime.Gosched`

`time.Sleep(0)` does not call into the timer machinery. It is essentially a no-op. For yielding the CPU, use `runtime.Gosched()`. For sleeping a real duration, use `time.Sleep(d)` with `d > 0`.

---

## Appendix V: Lessons From The Runtime Maintainers

If you read the Go runtime mailing list and design documents, several themes recur in timer-related discussions:

1. **Timers are global state, even when per-P.** Any change to timer machinery affects every Go program. Changes are conservative.
2. **Backwards compatibility is paramount.** The Go 1.23 timer GC fix had to preserve the existing user-visible semantics of `time.After`, `time.Tick`, etc. No "you must now call Stop" rule was added.
3. **Performance is measured across many workloads.** A change that helps a web server may hurt a batch processor. The runtime team runs benchmarks across categories before changing timer semantics.
4. **The user-facing API is intentionally minimal.** No `time.NewSchedulableThing`, no `time.Wheel`. The user is expected to build their own scheduler if they need more than `Timer` and `Ticker`.

This conservative approach is one reason `time.After` retention took until 1.23 to fix: the change required runtime invariants to be carefully reworked without breaking any user code.

For senior-level Go engineers, this conservatism is worth understanding. When proposing changes to your team's code, similar trade-offs apply: prefer compatibility over cleanliness, prefer composable primitives over framework-style schedulers, and document your invariants.

---

## Appendix W: Detecting Leaks With `runtime/debug`

`runtime/debug` exposes some advanced introspection:

```go
import "runtime/debug"

// Force GC.
debug.FreeOSMemory()

// Set a soft memory limit.
debug.SetMemoryLimit(2 << 30) // 2 GB

// Get GC stats.
var st debug.GCStats
debug.ReadGCStats(&st)
fmt.Println(st.NumGC, st.PauseTotal)
```

For timer leak detection specifically, the most useful is `debug.FreeOSMemory()`. Calling it forces GC and returns memory to the OS. If a service's RSS does not drop after `FreeOSMemory`, the memory is still live in some heap structure. For timer leaks specifically, the live memory is the runtime timer heap and its referenced objects.

You can also use `runtime.GC()` repeatedly to force GC cycles. After two cycles, anything truly unreachable should be reclaimed (the second cycle gives finalizers a chance to run).

### A correlation trick

Sometimes a leak suspect is not obvious. Compare two snapshots taken N minutes apart:

```bash
curl http://localhost:6060/debug/pprof/heap > before.pprof
sleep 600
curl http://localhost:6060/debug/pprof/heap > after.pprof

go tool pprof -base before.pprof -inuse_space after.pprof
(pprof) top10
```

The `-base` flag computes the *difference* between two profiles. The output shows what allocated and was not freed during the window. For a steady-state leak, this is the leak itself.

---

## Appendix X: A Note On `select` Evaluation Order

The Go specification states that all communication operations in a `select` are evaluated *before* the runtime decides which case proceeds. Specifically, every channel expression and every send-value expression is evaluated.

For:

```go
select {
case <-ch:
case <-time.After(d):
}
```

This means: `time.After(d)` is evaluated. The function is called. A timer is allocated. A channel reference is produced. The select then waits for either `ch` or the new timer's channel to receive.

If `ch` wins, the timer's channel is dropped. The timer is still in the runtime heap. The runtime will eventually fire it; the channel will buffer the value; nothing will read; the buffered value is unreferenced after the runtime cleans up.

This is the precise mechanism of the `time.After`-in-loop leak. The evaluation order guarantees the allocation. The select choice does not undo it.

You sometimes see proposed "fixes" like:

```go
var timerCh <-chan time.Time
if needTimeout {
    timerCh = time.After(d)
}
select {
case <-ch:
case <-timerCh:
}
```

If `needTimeout` is false, `timerCh` is nil, and the second case is unreachable (receive from nil blocks forever). No timer allocated.

If `needTimeout` is true, a timer is allocated, same as before. The "fix" only helps when timeouts are conditional. For unconditional loops, it does not change anything.

The real fix remains: reusable `NewTimer`.

---

## Appendix Y: A History of Go Timer-Related Changes

A timeline, from memory of release notes and source history:

- **Go 1.0–1.8**: Single global timer heap, single `timerproc` goroutine. Scales poorly.
- **Go 1.9**: Internal refactoring of timer code but no behaviour change.
- **Go 1.13**: Some optimisations in the timer firing path.
- **Go 1.14**: **Per-P timer heaps**. Major scalability improvement. `timerproc` eliminated.
- **Go 1.15**: Polishing of per-P implementation; faster Stop/Reset paths.
- **Go 1.16**: `time.Tick` documentation improved to warn about leaks.
- **Go 1.17**: Internal improvements to the timer's state machine.
- **Go 1.18**: Generics introduced (unrelated to timers but worth noting for the same release).
- **Go 1.20**: Various scheduler improvements that incidentally help timer-heavy workloads.
- **Go 1.21**: Profile-guided optimisation may incidentally improve timer code in some builds.
- **Go 1.22**: Range-over-int and other language features; timers unchanged.
- **Go 1.23**: **Timer GC fix**. Unreferenced timers can be collected before fire. Major improvement for `time.After` retention.
- **Go 1.24+** (post-cutoff): expected further refinements; check the release notes.

For senior-level engineers maintaining services across Go versions, knowing this timeline helps you:

- Predict whether a Go version upgrade will help or hurt.
- Plan migrations: "we should upgrade to 1.23 to free up RSS in the streaming service."
- Estimate effort: "moving from 1.20 to 1.23 should drop heap by 30% for that service."

---

## Appendix Z: Closing Worked Example — A Cache With Per-Key TTL

To consolidate everything, here is a complete cache implementation that handles per-key TTL correctly, scales to millions of keys, and does not leak.

```go
package cache

import (
    "container/heap"
    "context"
    "sync"
    "time"
)

type Item struct {
    key     string
    value   []byte
    expiry  time.Time
    index   int // for heap.Interface
}

type expiryHeap []*Item

func (h expiryHeap) Len() int            { return len(h) }
func (h expiryHeap) Less(i, j int) bool  { return h[i].expiry.Before(h[j].expiry) }
func (h expiryHeap) Swap(i, j int)       { h[i], h[j] = h[j], h[i]; h[i].index = i; h[j].index = j }
func (h *expiryHeap) Push(x any)         { it := x.(*Item); it.index = len(*h); *h = append(*h, it) }
func (h *expiryHeap) Pop() any           {
    old := *h
    n := len(old)
    x := old[n-1]
    x.index = -1
    *h = old[:n-1]
    return x
}

type Cache struct {
    mu      sync.Mutex
    items   map[string]*Item
    expiry  expiryHeap
    waker   chan struct{}
    closed  bool
    closeCh chan struct{}
}

func New() *Cache {
    return &Cache{
        items:   make(map[string]*Item),
        waker:   make(chan struct{}, 1),
        closeCh: make(chan struct{}),
    }
}

func (c *Cache) Set(key string, value []byte, ttl time.Duration) {
    expiry := time.Now().Add(ttl)
    c.mu.Lock()
    defer c.mu.Unlock()
    if old, ok := c.items[key]; ok {
        if old.index >= 0 {
            heap.Remove(&c.expiry, old.index)
        }
    }
    it := &Item{key: key, value: value, expiry: expiry}
    c.items[key] = it
    heap.Push(&c.expiry, it)

    // Wake the expirer if this new item expires sooner than current top.
    select {
    case c.waker <- struct{}{}:
    default:
    }
}

func (c *Cache) Get(key string) ([]byte, bool) {
    c.mu.Lock()
    defer c.mu.Unlock()
    it, ok := c.items[key]
    if !ok {
        return nil, false
    }
    if time.Now().After(it.expiry) {
        return nil, false
    }
    return it.value, true
}

func (c *Cache) Delete(key string) {
    c.mu.Lock()
    defer c.mu.Unlock()
    it, ok := c.items[key]
    if !ok {
        return
    }
    delete(c.items, key)
    if it.index >= 0 {
        heap.Remove(&c.expiry, it.index)
    }
}

func (c *Cache) Close() {
    c.mu.Lock()
    if !c.closed {
        c.closed = true
        close(c.closeCh)
    }
    c.mu.Unlock()
}

func (c *Cache) Run(ctx context.Context) {
    t := time.NewTimer(time.Hour)
    if !t.Stop() {
        <-t.C
    }
    defer t.Stop()

    for {
        c.mu.Lock()
        if c.closed {
            c.mu.Unlock()
            return
        }

        var nextWhen time.Time
        if c.expiry.Len() > 0 {
            nextWhen = c.expiry[0].expiry
        } else {
            nextWhen = time.Now().Add(time.Hour)
        }
        c.mu.Unlock()

        d := time.Until(nextWhen)
        if d <= 0 {
            c.expire()
            continue
        }

        if !t.Stop() {
            select {
            case <-t.C:
            default:
            }
        }
        t.Reset(d)

        select {
        case <-ctx.Done():
            return
        case <-c.closeCh:
            return
        case <-c.waker:
            // re-evaluate
        case <-t.C:
            c.expire()
        }
    }
}

func (c *Cache) expire() {
    c.mu.Lock()
    defer c.mu.Unlock()
    now := time.Now()
    for c.expiry.Len() > 0 && !c.expiry[0].expiry.After(now) {
        it := heap.Pop(&c.expiry).(*Item)
        if cur, ok := c.items[it.key]; ok && cur == it {
            delete(c.items, it.key)
        }
    }
}
```

Things to notice:

- **One `*time.Timer`** for the entire cache, regardless of size.
- **One sweeper goroutine** owns all timing decisions.
- **`Set` wakes the sweeper** if a new key expires sooner than the current next-expiry.
- **`Close` triggers exit** via `closeCh`.
- **No per-key timers**, no `AfterFunc`, no `time.After`.
- **No leak**: the sweeper holds one timer; `defer t.Stop()` covers all exits.

This design scales to millions of keys. The heap is O(log N) per operation. The runtime timer machinery sees exactly one timer regardless of cache size.

### Variations

- For caches where ordering by expiry is rare and most keys are accessed-and-deleted before TTL, a *sweeper* without a heap (just iterate the map every N seconds) is simpler and often faster.
- For caches with strict consistency (e.g., "the cache must remove the key within 1ms of its TTL"), the heap-based approach with a per-cache timer is the right shape.

---

## Appendix AA: A Note on Concurrency Safety of `*Ticker`

`time.Ticker` documents:

> Ticker is fundamentally goroutine-safe in that its API can be called from any goroutine.

But there are subtleties:

- `t.Stop()` is safe to call from any goroutine, and safe to call multiple times.
- `t.Reset(d)` was added in Go 1.15. It is similarly safe to call from any goroutine.
- Reading from `t.C` is safe from any goroutine, but **each tick is delivered to exactly one reader**. If two goroutines compete on `<-t.C`, only one gets each tick.

If you need fan-out tick delivery to multiple consumers, build a single-reader goroutine that re-broadcasts on a `chan` or a sync.Cond:

```go
func ticker(d time.Duration, out []chan<- time.Time) {
    t := time.NewTicker(d)
    defer t.Stop()
    for now := range t.C {
        for _, ch := range out {
            select {
            case ch <- now:
            default: // drop if consumer is slow
            }
        }
    }
}
```

Now N consumers can each have their own channel and never compete.

---

## Appendix AB: A Comprehensive Test for Timer Leak Regression

If your team is paranoid about timer leaks (and you should be), add a regression test:

```go
func TestNoTimerLeak(t *testing.T) {
    runtime.GC()
    runtime.GC()
    var before runtime.MemStats
    runtime.ReadMemStats(&before)
    baseGoroutines := runtime.NumGoroutine()

    for i := 0; i < 10_000; i++ {
        // Run the function under test in a way that completes quickly.
        ctx, cancel := context.WithCancel(context.Background())
        s := NewServer(ctx)
        s.HandleRequest("test")
        cancel()
        s.Wait()
    }

    runtime.GC()
    runtime.GC()
    time.Sleep(100 * time.Millisecond)
    runtime.GC()

    var after runtime.MemStats
    runtime.ReadMemStats(&after)

    if got := runtime.NumGoroutine() - baseGoroutines; got > 10 {
        t.Errorf("goroutine leak: started with %d, ended with %d (delta %d)",
            baseGoroutines, runtime.NumGoroutine(), got)
    }

    deltaAlloc := after.HeapAlloc
    if deltaAlloc > before.HeapAlloc + 10*1024*1024 {
        t.Errorf("heap grew %d bytes during test, suspect leak",
            deltaAlloc-before.HeapAlloc)
    }
}
```

This test:

1. Captures baseline goroutine count and memory.
2. Runs the operation many times in a loop.
3. Forces GC.
4. Compares.

It catches both goroutine leaks and timer-related memory leaks. The 10MB threshold is generous and may need adjustment for your service.

Add this test to your suite. Run it on every PR. It will catch the most insidious timer regressions before they reach production.

---

## Appendix AC: Final Closing

The journey through this page has been long. Let us recap what you should walk away knowing:

1. **The runtime timer subsystem** is per-P min-heaps with carefully designed atomic state transitions.
2. **Pre-Go 1.23 retention** was due to the runtime holding strong references to timers in its heap.
3. **The Go 1.23 fix** added GC-awareness so unreferenced timers can be reclaimed before fire.
4. **Tickers are still leak-risk** because the runtime keeps them firing forever.
5. **`AfterFunc` callbacks** are stealth memory amplifiers due to closure captures.
6. **Network I/O deadlines** are integrated with the net poller and are the right tool for I/O timeouts.
7. **High-cardinality timing needs** demand custom schedulers — wheel or sorted-heap-with-single-timer.
8. **Investigation flow** for a suspected leak: NumGoroutine trend → pprof inuse_space → peek → list → fix.
9. **Production practices** include metrics, alerts on growth, lint rules, and regression tests.
10. **Future Go versions** will likely continue refining timers. Stay current on release notes.

The professional page (next) takes these concepts into the operations realm: how to set SLOs, how to alert, how to run incident response, and how to communicate timer-related risk to stakeholders.

---

## Appendix AD: Suggested Exercises

1. Read the Go 1.23 release notes section on timers. Summarise the user-visible behaviour change in your own words.
2. Find the `runtime.timer` struct definition in the Go source tree for any version. List the fields and explain each.
3. Run the reproducer programs in Appendix C on Go 1.22 and Go 1.23. Record the memory delta.
4. Profile a real service of yours. Identify any timer-related entries in pprof's top 10. Determine whether they are leaks or normal.
5. Refactor a piece of code in your codebase that uses `time.After` inside a loop. Measure before and after.
6. Write a timing wheel from scratch. Compare its memory footprint to per-entity timers for 1M entries.
7. Implement a `Cache` with per-key TTL using the design in Appendix Z. Test with 100K keys and verify memory is bounded.
8. Read the source of `runtime.checkTimers` in Go 1.22 and 1.23. Diff the implementations and explain the differences.
9. Add a `goleak.VerifyTestMain` to one of your test suites. Fix any leaks it finds.
10. Add the timer regression test from Appendix AB to your CI. Tune the thresholds.

Each of these exercises consolidates a specific piece of knowledge. Working through several of them builds the fluency needed to discuss timers at staff level.

---

## Appendix AE: Glossary, Expanded

- **Allocation rate**: bytes allocated per second. Visible in `pprof -alloc_space`.
- **Async preemption**: the runtime's ability to interrupt a running goroutine for scheduling. Added in Go 1.14. Interacts with timers in that long-running goroutines without I/O can now be preempted to allow timer fires.
- **Channel buffer**: the underlying queue for a buffered channel. `time.Timer.C` is capacity 1.
- **CAS (Compare-And-Swap)**: atomic operation used in the timer state machine.
- **Capacity (channel)**: the number of values a channel can buffer without blocking the sender.
- **Closure**: a function value that captures variables from its enclosing scope. `AfterFunc` callbacks are closures.
- **Deadline**: a specific point in time after which an operation should give up.
- **Drain**: read all queued values from a channel.
- **Epoch**: in Go GC terminology, a single garbage collection cycle.
- **Fanout**: distributing input across many parallel workers.
- **Finalizer**: a function called by the GC when an object is about to be collected. Go has `runtime.SetFinalizer`.
- **G (goroutine)**: a user-level thread managed by the Go runtime.
- **Garbage Collection (GC)**: the runtime's automatic memory reclamation.
- **Goroutine leak**: a goroutine that never exits.
- **Heap (data structure)**: a tree-shaped data structure with the heap property. Used for priority queues like the timer heap.
- **HeapAlloc**: bytes currently allocated for live objects.
- **HeapInuse**: bytes of memory mapped for the Go heap.
- **HeapSys**: total memory allocated for the Go heap, including freed portions not yet returned to the OS.
- **In-use space (pprof)**: bytes currently retained by allocations.
- **M (machine)**: an OS thread used by the runtime.
- **Monotonic clock**: a clock that always advances and is unaffected by wall-clock adjustments.
- **Net poller**: runtime mechanism for blocking on I/O events.
- **OOM (Out Of Memory)**: process killed by the kernel due to memory exhaustion.
- **P (processor)**: a logical CPU slot in the runtime scheduler.
- **Pinning**: keeping memory alive longer than necessary.
- **Pprof**: profiling tool integrated with the Go runtime.
- **Quantum**: the unit of execution time assigned to a goroutine before potential preemption.
- **Reaper**: in our context, the runtime function `cleantimers` that removes deleted timer entries.
- **Reference counting**: a memory management technique not used by Go.
- **Retention**: the duration for which memory remains live (allocated and reachable).
- **RSS (Resident Set Size)**: the portion of process memory currently in RAM.
- **Sentinel value**: a special marker in a state machine (e.g., `timerRemoved`).
- **Sift (heap operation)**: rebalancing a heap after an insertion or removal.
- **Stack scan**: GC operation that walks a goroutine's stack looking for pointers.
- **Stop the world (STW)**: a GC phase during which all goroutines are paused.
- **sysmon**: the runtime's monitoring thread.
- **Tick**: a single fire event from a ticker.
- **Timing wheel**: a data structure that schedules timers using ring buffers.
- **TTL (Time To Live)**: the duration after which a value expires.
- **Wall clock**: real-world time, subject to NTP and DST adjustments.

This glossary provides a reference for the technical vocabulary that recurs throughout the page. Use it when you encounter a term you are unsure about.

---

## Appendix AF: Bridge To The Professional Page

This page (Senior) has been about *understanding* timers. The Professional page is about *operating* them.

Topics covered next:

- Setting SLOs and SLIs for timer health.
- Configuring alerts on goroutine and memory growth.
- Building runbooks for timer-related incidents.
- Continuous profiling with tools like Pyroscope and Parca.
- Tracing across distributed systems, where one service's timer leak might be triggered by another's behaviour.
- Postmortem-quality storytelling for timer incidents.
- Vendor and library guidance: how to evaluate third-party Go libraries for timer hygiene.

Read on if you operate Go services in production. The Senior page is your foundation; the Professional page is your operating manual.

---

## Appendix AG: A Note on `select` With Many `time.After` Cases

Occasionally you see code like:

```go
select {
case x := <-chA:
case y := <-chB:
case <-time.After(d1):
case <-time.After(d2):
case <-time.After(d3):
}
```

Three separate `time.After` calls. Three separate timer allocations. The select picks the earliest expiry. If `chA` or `chB` wins, all three timers leak.

This is almost always wrong. Combine into a single timer with the minimum duration:

```go
d := minDuration(d1, d2, d3)
t := time.NewTimer(d)
defer t.Stop()
select {
case x := <-chA:
case y := <-chB:
case <-t.C:
    // figure out which deadline was met
}
```

Or use `context.WithDeadline` for each deadline and read `ctx.Done()`.

The lesson: every `time.After` in a `select` is an allocation. Multiple `time.After` calls in one `select` are multiple allocations. Combine when possible.

---

## Appendix AH: Conclusion

Timers are a unique kind of resource in Go: invisible until they misbehave, with cleanup obligations that are not enforced by the type system. The runtime is willing to help you in some ways (Go 1.23 reclamation) but the user contract remains: **stop what you start**, **drain before you reset**, and **prefer cancellable APIs**.

When you write Go code, treat timers like file descriptors or network connections. The fact that they have no `Close` method in the way `os.File` does is an accident of the API, not a license to ignore cleanup. The `Stop` method *is* the close. Use it.

The Go runtime is one of the most carefully engineered pieces of software you can read. The timer subsystem is a small, intricate corner of it. Spending time inside that corner — understanding `addtimer`, `cleantimers`, `runtimer`, `siftupTimer` — pays off the moment you investigate your first production timer leak.

You are ready for that investigation now.

---

## Appendix AI: A Deeper Dive Into `runtime.timer.status` Transitions

Earlier we sketched the state machine. Here we walk through each transition in detail, with code-shaped pseudo-Go.

### Transition: `timerNoStatus` → `timerWaiting`

This happens on `addtimer`. The runtime takes the current P's `timersLock`, sets the status with CAS, and inserts into the heap.

```go
func addtimer(t *timer) {
    if !t.status.CompareAndSwap(timerNoStatus, timerWaiting) {
        // Either already inserted, or in a weird state.
        throw("addtimer: bad status")
    }
    pp := getg().m.p.ptr()
    lock(&pp.timersLock)
    cleantimers(pp)
    doaddtimer(pp, t)
    unlock(&pp.timersLock)
    wakeNetPoller(t.when)
}
```

`doaddtimer` appends to the slice and sifts up. The timer is now in the heap, status `timerWaiting`.

### Transition: `timerWaiting` → `timerDeleted` (via Stop)

`deltimer` (the runtime-side of `Stop`) CASes the status without taking the P's lock. The lazy approach.

```go
func deltimer(t *timer) bool {
    for {
        switch s := t.status.Load(); s {
        case timerWaiting, timerModifiedLater:
            if t.status.CompareAndSwap(s, timerDeleted) {
                // Increment deletedTimers count on the owning P.
                t.pp.ptr().deletedTimers.Add(1)
                return true
            }
        case timerModifiedEarlier:
            if t.status.CompareAndSwap(s, timerDeleted) {
                t.pp.ptr().deletedTimers.Add(1)
                return true
            }
        case timerDeleted, timerRemoved, timerRemoving:
            // Already deleted or being removed.
            return false
        case timerRunning, timerMoving:
            // Wait and retry.
            osyield()
        }
    }
}
```

The timer is logically deleted. Physically it is still in the heap, but `cleantimers` will reap it.

### Transition: `timerDeleted` → `timerRemoving` → `timerRemoved` (via cleantimers)

When `cleantimers` runs and the top of the heap is `timerDeleted`:

```go
case timerDeleted:
    if !t.status.CompareAndSwap(timerDeleted, timerRemoving) {
        continue
    }
    dodeltimer0(pp) // remove from heap[0]
    if !t.status.CompareAndSwap(timerRemoving, timerRemoved) {
        throw("cleantimers: bad state")
    }
    pp.deletedTimers.Add(-1)
```

The two-step CAS ensures another goroutine cannot interfere mid-removal. The first CAS claims ownership of the removal; the second confirms completion.

### Transition: `timerWaiting` → `timerRunning` (via fire)

When the scheduler picks up a due timer:

```go
case timerWaiting:
    if !t.status.CompareAndSwap(timerWaiting, timerRunning) {
        continue
    }
    runOneTimer(pp, t, now)
```

`runOneTimer` invokes the callback. After:

```go
if t.period > 0 {
    // Ticker: re-schedule.
    t.when += t.period
    if t.when < now {
        t.when = now + t.period
    }
    siftdownTimer(pp.timers, 0)
    if !t.status.CompareAndSwap(timerRunning, timerWaiting) {
        throw("bad status after run")
    }
} else {
    // One-shot: remove.
    dodeltimer0(pp)
    if !t.status.CompareAndSwap(timerRunning, timerNoStatus) {
        throw("bad status after run")
    }
}
```

For tickers, the timer goes back to `timerWaiting` with a new fire time. For one-shots, it returns to `timerNoStatus`.

### Transition: `timerWaiting` → `timerModifying` → `timerModifiedEarlier`/`Later` (via Reset)

```go
func modtimer(t *timer, when int64) bool {
    var mp *m
loop:
    for {
        switch s := t.status.Load(); s {
        case timerWaiting:
            // Try to start modifying.
            if t.status.CompareAndSwap(s, timerModifying) {
                break loop
            }
        case timerNoStatus, timerRemoved:
            // Re-add the timer.
            mp = acquirem()
            if t.status.CompareAndSwap(s, timerModifying) {
                wasRemoved = true
                break loop
            }
            releasem(mp)
        case timerDeleted:
            if t.status.CompareAndSwap(s, timerModifying) {
                t.pp.ptr().deletedTimers.Add(-1)
                pending = true
                break loop
            }
        case timerModifying, timerRunning, timerRemoving, timerMoving:
            osyield()
        case timerModifiedEarlier, timerModifiedLater:
            if t.status.CompareAndSwap(s, timerModifying) {
                pending = true
                break loop
            }
        }
    }

    oldWhen := t.when
    t.when = when
    if wasRemoved {
        t.nextwhen = 0
    } else {
        t.nextwhen = when
    }

    newStatus := timerModifiedLater
    if when < oldWhen {
        newStatus = timerModifiedEarlier
    }
    if !t.status.CompareAndSwap(timerModifying, newStatus) {
        throw("bad status in modtimer")
    }

    // ...
}
```

The CASed state shows whether the new fire time is earlier or later than the previous. `cleantimers` uses this to know whether to re-sift up or down.

### Why all this complexity?

Concurrency. Multiple goroutines can be doing Stop/Reset/Fire/Clean simultaneously. Without atomic CAS, the heap state would corrupt.

For user code, the implication is mostly that operations are *correct* under concurrent access. They are not necessarily *intuitive*: if you Stop while a Reset is in flight, the outcome depends on the CAS ordering.

The recommendation remains: do not call Stop and Reset from different goroutines without explicit synchronisation.

---

## Appendix AJ: Sizing The Per-P Timer Heap

The runtime does not pre-allocate timer heap space. The slice grows as timers are added. Once a P's heap shrinks, the slice does not necessarily release memory back to the runtime — Go's slice growth/shrink rules apply.

If a service has a transient burst of timers (say, 100 000 simultaneous timeouts) and then settles back to 100 timers, the slice may stay at capacity 100 000 even though it only has 100 elements. Memory is wasted but not "leaked" in the strict sense.

This is one of the reasons why `pprof -inuse_space` might show "high" usage from `time.NewTimer` even after the leak is fixed: the underlying slice retains its capacity.

A long-lived service that has experienced a burst will eventually rebalance via GC and slice reclamation, but it can take time. If you want to force the issue, restart the process.

### How to inspect runtime timer state

Runtime internals are not directly exposed to user code, but you can approximate the active timer count by examining `runtime.NumGoroutine()` and parsing pprof stack traces.

Several third-party libraries provide deeper introspection. For example, `pkg.go.dev/golang.org/x/exp/runtimedebug` and various profiling agents.

For most production services, you do not need to inspect timer internals directly. The pprof view of `time.NewTimer` allocations and the goroutine dump's parked-on-timer count tell you everything you need to know.

---

## Appendix AK: Cross-Reference With `context.Context` Internals

`context.WithTimeout(parent, d)` internally:

1. Creates a derived context with a `Done()` channel.
2. Schedules a single `time.AfterFunc` to call the context's cancel function.
3. Returns the context and a cancel function.

The cancel function:

1. Closes the `Done()` channel.
2. Cancels the underlying `AfterFunc` timer.

Reading the source of `context.WithTimeout`:

```go
func WithTimeout(parent Context, timeout time.Duration) (Context, CancelFunc) {
    return WithDeadline(parent, time.Now().Add(timeout))
}

func WithDeadline(parent Context, d time.Time) (Context, CancelFunc) {
    // ...
    c := &timerCtx{
        cancelCtx: newCancelCtx(parent),
        deadline:  d,
    }
    propagateCancel(parent, c)
    dur := time.Until(d)
    if dur <= 0 {
        c.cancel(true, DeadlineExceeded, nil)
        return c, func() { c.cancel(false, Canceled, nil) }
    }
    c.mu.Lock()
    defer c.mu.Unlock()
    if c.err == nil {
        c.timer = time.AfterFunc(dur, func() {
            c.cancel(true, DeadlineExceeded, nil)
        })
    }
    return c, func() { c.cancel(true, Canceled, nil) }
}
```

The `c.timer = time.AfterFunc(...)` is the single timer allocation per `WithTimeout` call. The `cancel` function calls `c.timer.Stop()`. The discipline is built into the API.

This is why "use `context.WithTimeout` for per-call timeouts" is such a strong recommendation: the right cleanup pattern is enforced by the API. Users only need to remember `defer cancel()`.

### Subtle interaction with parent cancellation

If `parent` is cancelled before the timer fires, `propagateCancel` ensures the derived context is also cancelled. Internally, this might involve another goroutine that watches `parent.Done()` and propagates.

So a `context.WithTimeout` may have *one extra goroutine* per call, depending on the propagation strategy. The runtime is smart about this: for simple cancellation chains, it does not spawn extra goroutines. For complex chains (cancellable contexts deeply nested), it might.

This is rarely a problem in practice but worth being aware of.

---

## Appendix AL: Profiling Methodology For Timer Issues

A structured approach to diagnosis:

### Phase 1: Initial signals

- `runtime.NumGoroutine()` over time — trend up is suspicious.
- `runtime.MemStats.HeapAlloc` over time — saw-tooth with rising floor is suspicious.
- Process RSS over time — steady rise is the canonical symptom.

These are *aggregate* signals. They tell you "something is leaking" without telling you what.

### Phase 2: pprof drill-down

Capture pprof, look at top inuse/alloc, identify timer-related entries:

- `time.NewTimer`, `time.NewTicker`, `time.After`, `time.Tick`, `time.AfterFunc`.

If any of these are in the top 10, you have a timer-related contribution.

### Phase 3: Call site identification

Use `peek` and `list` in pprof to find the source-code line. Cross-check with the goroutine dump (`pprof goroutine?debug=2`) to see how many goroutines are parked at that line.

### Phase 4: Code inspection

Read the suspect code. Look for the anti-patterns:

- `time.After` in a `for` loop.
- `time.Tick` outside `main`.
- `NewTimer` or `NewTicker` without `defer Stop`.
- `Reset` without drain.
- `AfterFunc` with heavy capture.

### Phase 5: Hypothesis and fix

Form a hypothesis: "this leak is X timers per request times Y request rate equals Z timer accumulation." If the math matches the observed memory, your hypothesis is good.

Apply the fix. Deploy. Measure.

### Phase 6: Verification

After fix:

- pprof inuse_space should show timer functions out of the top 10.
- NumGoroutine should plateau.
- HeapAlloc should stabilise.

If verification fails, your hypothesis was wrong or incomplete. Return to Phase 4.

This methodology is essentially the same as for any leak, but the indicator functions are timer-specific.

---

## Appendix AM: Real Code Walks — Bigger Examples

Let us walk through one more realistic before/after.

### A WebSocket server with idle disconnect

Original code:

```go
package wsserver

import (
    "github.com/gorilla/websocket"
    "log"
    "net/http"
    "time"
)

const idleTimeout = 60 * time.Second

type Client struct {
    conn *websocket.Conn
    send chan []byte
    done chan struct{}
}

func (c *Client) readPump() {
    defer c.conn.Close()
    for {
        _, message, err := c.conn.ReadMessage()
        if err != nil {
            return
        }
        select {
        case c.send <- echo(message):
        case <-time.After(time.Second):
            log.Println("send queue full, dropping")
        }
    }
}

func (c *Client) writePump() {
    for {
        select {
        case msg := <-c.send:
            c.conn.WriteMessage(websocket.TextMessage, msg)
        case <-time.After(idleTimeout):
            c.conn.WriteMessage(websocket.PingMessage, nil)
        case <-c.done:
            return
        }
    }
}

func Handler(w http.ResponseWriter, r *http.Request) {
    conn, err := upgrader.Upgrade(w, r, nil)
    if err != nil {
        return
    }
    c := &Client{conn: conn, send: make(chan []byte, 8), done: make(chan struct{})}
    go c.writePump()
    c.readPump()
    close(c.done)
}
```

Issues:

1. `readPump` uses `time.After(time.Second)` inside a loop. Allocation per iteration when the send queue is full.
2. `writePump` uses `time.After(idleTimeout)` inside a select inside a loop. Allocation per iteration regardless of activity.
3. `writePump` does not stop the idle timer when a message is processed — but `time.After`'s timer is implicit, so this manifests as allocation churn rather than a single leak.

For 1 000 concurrent clients each receiving 5 messages per second from `c.send`, that is:

- 5 000 `time.After` calls per second in `writePump`.
- Each timer pre-1.23 retained for 60 seconds.
- 300 000 timers in steady state.

That is a lot.

Refactored:

```go
package wsserver

import (
    "github.com/gorilla/websocket"
    "log"
    "net/http"
    "time"
)

const (
    idleTimeout = 60 * time.Second
    sendTimeout = time.Second
)

type Client struct {
    conn *websocket.Conn
    send chan []byte
    done chan struct{}
}

func (c *Client) readPump() {
    defer c.conn.Close()
    sendT := time.NewTimer(sendTimeout)
    defer sendT.Stop()
    for {
        _, message, err := c.conn.ReadMessage()
        if err != nil {
            return
        }

        if !sendT.Stop() {
            select {
            case <-sendT.C:
            default:
            }
        }
        sendT.Reset(sendTimeout)

        select {
        case c.send <- echo(message):
        case <-sendT.C:
            log.Println("send queue full, dropping")
        }
    }
}

func (c *Client) writePump() {
    idleT := time.NewTimer(idleTimeout)
    defer idleT.Stop()
    for {
        if !idleT.Stop() {
            select {
            case <-idleT.C:
            default:
            }
        }
        idleT.Reset(idleTimeout)

        select {
        case msg := <-c.send:
            c.conn.WriteMessage(websocket.TextMessage, msg)
        case <-idleT.C:
            c.conn.WriteMessage(websocket.PingMessage, nil)
        case <-c.done:
            return
        }
    }
}

func Handler(w http.ResponseWriter, r *http.Request) {
    conn, err := upgrader.Upgrade(w, r, nil)
    if err != nil {
        return
    }
    c := &Client{conn: conn, send: make(chan []byte, 8), done: make(chan struct{})}
    go c.writePump()
    c.readPump()
    close(c.done)
}
```

Each client now has exactly two `*time.Timer` instances (one for read, one for write) for its lifetime. Allocation drops from 5 000 per second to ~zero in steady state.

For 1 000 clients:

- Active timers: 2 000 (was: 300 000).
- Allocation rate: zero.

This is the kind of optimisation that pays dividends across the lifetime of the service. Not just in memory, but in GC pause times — fewer allocations means fewer GC cycles.

---

## Appendix AN: Considerations For Library Authors

If you are publishing a Go library that uses timers internally, follow these guidelines:

1. **Document timer lifecycle.** State explicitly whether callers must call Stop, Close, or some equivalent.
2. **Provide a Close method.** Libraries with internal timers should expose explicit cleanup.
3. **Use `context.Context` for cancellation.** Accept a `ctx` parameter and treat its cancellation as the cleanup trigger.
4. **Default to one timer per logical work unit.** Do not create one timer per item if a sweeper would suffice.
5. **Avoid `time.Tick` entirely.** Use `time.NewTicker` even in your library's `init` or top-level setup.
6. **Use `time.AfterFunc` sparingly.** Document any closure captures that affect retention.
7. **Test for leaks.** Use `goleak` in your test suite. Make leak checks part of CI.

Examples of good libraries:

- `github.com/sony/gobreaker`: circuit breaker with explicit timer management.
- `golang.org/x/sync/singleflight`: no timers at all, but a model of clean concurrent state.

Examples of pitfalls to avoid:

- Libraries that spawn goroutines with `time.Tick` "for periodic cleanup" without exposing a Stop method.
- Libraries that take `*time.Duration` parameters and use them inside `time.After` calls.
- Libraries with `AfterFunc` callbacks that capture user-provided values without documentation.

If you maintain a library used by many services, a single timer leak in your code multiplies across all of them. Be careful.

---

## Appendix AO: Cross-Language Comparison Revisited

Let us revisit how Go's timer model compares to peers, with senior-level depth.

### Java's `java.util.concurrent.ScheduledExecutorService`

Java's analogue is `ScheduledExecutorService.schedule(Callable, delay, unit)` returning a `ScheduledFuture`. The future has a `cancel(boolean)` method.

Implementation: a `DelayQueue` (a `PriorityQueue` of `Delayed` items) drained by a worker thread.

Cancellation: marks the future cancelled. The actual queue removal happens lazily, similar to Go's `cleantimers`. If many cancelled futures accumulate, the queue can grow.

Java exposes `purge()` to force cleanup of cancelled futures. Go's runtime does it automatically.

Leak semantics: similar to pre-1.23 Go. A scheduled task that is cancelled stays in the queue until purged or the worker picks it up.

### Tokio's `tokio::time::sleep`

Tokio's sleep is a `Future`. Polling it sets up a timer in the runtime's hashed timing wheel. Dropping the future cancels it: the wheel entry is removed.

This is the "drop = cancel" model. No retention if the user drops the future.

The trade-off: implementing it requires careful borrow-checker dance in Rust. The Go runtime would need similar machinery, which is partly what the 1.23 change added.

### Node.js `setTimeout`

`setTimeout` returns a `Timeout` object. `clearTimeout(t)` cancels.

Libuv's timer wheel handles the underlying scheduling. Cancellation removes from the wheel.

Node's model is simpler than Go's because Node is single-threaded; no concurrent Stop/Reset races to worry about.

### Comparison

| Runtime | Schedule cost | Cancel cost | Retention if dropped |
|---|---|---|---|
| Go pre-1.23 | O(log N) | O(1) lazy | Until fire time |
| Go 1.23+ | O(log N) | O(1) lazy | Until next GC |
| Tokio | O(1) wheel | O(1) | Immediate |
| Java | O(log N) | O(1) lazy | Until purge or pickup |
| Node.js | O(1) wheel | O(1) | Immediate |

Tokio and Node.js have the cleanest semantics. Java and Go (pre-1.23) have similar retention quirks. Go 1.23+ moves closer to the Tokio/Node model.

The Tokio/Node model is enabled by single-threaded scheduling (Node) or careful Rust-level lifetimes (Tokio). Go's multi-threaded GC-collected nature makes "drop = immediate cancel" harder. Hence the 1.23 mechanism that approximates it through GC awareness.

---

## Appendix AP: The Future Of Go Timers

Speculation, but plausible based on community discussions:

- **Compile-time linting** for `time.After` in loops. Tools like `staticcheck` are already adding rules.
- **Improved `runtime/trace`** with more timer-specific events to make timer storms easier to spot.
- **Standard library scheduler primitive** — perhaps `time.Wheel` — for high-cardinality scheduling.
- **Better `context` integration**: a `context.WithDeadline` that is even cheaper.
- **GODEBUG knobs** for timer behavior (some already exist, like `asyncpreemptoff`).

None of these are announced as of this writing. But the trajectory is clear: timers are an ongoing area of attention.

---

## Appendix AQ: Final Checklist For Senior Engineers

You should be able to do all of these without reference to this page:

- [ ] Explain why `time.After` is "leaky" in terms of the runtime heap.
- [ ] Describe the per-P timer heap design and why it scales better than a global heap.
- [ ] State what changed in Go 1.23 and which workloads benefit.
- [ ] Identify which workloads still leak even on Go 1.23+.
- [ ] Recognise a timer leak in pprof inuse_space within 60 seconds.
- [ ] Apply the Stop+drain+Reset pattern fluently.
- [ ] Choose between per-entity timers, sweeper, and wheel for a given workload.
- [ ] Write a leak-free idle-timeout select loop from memory.
- [ ] Configure goleak in tests.
- [ ] Design a regression test that catches new timer leaks.
- [ ] Diagnose an `AfterFunc` capture leak.
- [ ] Refactor a `time.Tick` to `time.NewTicker` + `defer Stop`.
- [ ] Convince a junior that adding `default:` does not fix the leak.
- [ ] Compose `context.WithTimeout` with network deadlines correctly.
- [ ] Implement a sorted-heap-based scheduler with one runtime timer.

If you can do all of these, you have completed the senior-level material for timer leaks.

---

## Appendix AR: A Closing Story

Several years ago, a Go team running a large fleet noticed that pods were OOMKilling roughly every ten hours. Restart logs showed clean shutdowns followed by clean startups; no panic, no segfault. RSS grew linearly from launch.

They captured pprof. Top inuse: `time.NewTimer` at 45%. Top stack: a function called `metrics.flushLoop`. The function:

```go
func (m *Metrics) flushLoop() {
    for {
        select {
        case <-m.shutdown:
            return
        case <-time.After(m.flushInterval):
            m.flush()
        }
    }
}
```

`m.flushInterval` was 30 seconds. The pod's lifetime was about 10 hours. Number of leaked timers per pod: about 1 200. Each timer's body was small — but the metrics package had a habit of storing accumulated state in module-level variables that were captured (indirectly) by goroutine stack scans. The combination produced a memory profile that grew by ~50 MB per hour.

The fix was the reusable-timer rewrite. After deployment, RSS stabilised at half the previous peak. The OOMs stopped.

The lesson: a single `time.After` in a single loop, fired every 30 seconds, over a 10-hour pod lifetime, multiplied across thousands of pods, was the difference between a stable service and a constantly recycling one. Timer hygiene is not a micro-optimisation. It is the structural integrity of long-running Go systems.

If you take one thing from this entire page, take that.

---

## Appendix AS: Beyond Timer Leaks

The patterns and techniques in this page generalise. Many of the lessons apply to:

- **Goroutine leaks**: forgotten goroutines parked on never-signalled channels.
- **Connection leaks**: HTTP clients without idle conn limits.
- **File descriptor leaks**: `os.Open` without `defer Close`.
- **Memory leaks via captures**: closures that capture more than they need.
- **Context leaks**: `context.WithCancel` without `defer cancel`.

In each case, the pattern is: a resource was acquired and the cleanup obligation was implicit but forgotten. The fix is to make cleanup explicit (e.g., `defer Stop`, `defer Close`) and to verify cleanup in tests.

Mastering timer hygiene is partly about timers and partly about a discipline that extends to all resource management in Go. Carry the discipline outward.

---

## Appendix AT: References To Cross-Link

When teaching or writing about timers, the following pages in this Roadmap are useful neighbors:

- `01-goroutines/01-overview/senior.md`: deeper coverage of goroutine internals.
- `16-time-based-concurrency/01-tickers/senior.md`: ticker-specific internals.
- `16-time-based-concurrency/02-after-vs-newtimer/senior.md`: the precise difference between `time.After` and `time.NewTimer` at the runtime level.
- `16-time-based-concurrency/04-context-deadlines/senior.md`: how context layers on top of timers.

The full timer story spans several pages. This page focuses on leaks; the others fill in the rest.

---

## Appendix AU: Bonus — Reading a `runtime/trace` Output

Suppose you captured a trace and want to inspect it without the GUI. You can do:

```bash
go tool trace -d trace.out > trace.txt
```

The text output has events like:

```
ProcStart p=0 g=0 off=12345
GoStart g=42 off=12346
GoBlock g=42 reason="select" off=12380
TimerCreate p=0 t=0xc000123080 when=98765432 off=12400
ProcStop p=0 g=0 off=12450
ProcStart p=0 g=0 off=12500
TimerFire p=0 t=0xc000123080 off=12501
GoUnblock g=42 off=12502
GoStart g=42 off=12503
GoEnd g=42 off=12510
ProcStop p=0 g=0 off=12520
```

Each line is an event. The `off` is a nanosecond offset from the trace start. From this you can compute:

- How long was g=42 blocked? `12502 - 12380 = 122ns`.
- How long was the timer pending? `12501 - 12400 = 101ns`.
- Was the fire on the same P that created the timer? Yes (p=0 in both).

For a timer storm investigation:

```bash
grep TimerCreate trace.txt | wc -l  # how many timers created
grep TimerFire trace.txt | wc -l    # how many fired
```

If create count vastly exceeds fire count, you have timers in flight (normal) or unfired/leaked timers (suspicious depending on duration).

For more sophisticated analysis, write a small Go program using `internal/trace` (unstable but useful for one-off scripts) to parse and aggregate events.

---

## Appendix AV: A Note On `time.Sleep`

`time.Sleep(d)` is the simplest timer API: it parks the current goroutine for `d` and resumes. Internally, it uses a `runtime.timer` like everything else.

Is `time.Sleep` ever a leak? No, because the goroutine is the entity holding the timer's lifecycle. When the timer fires, the goroutine wakes and continues. The timer is removed from the heap.

But `time.Sleep` *blocks the goroutine*. If you have many goroutines all sleeping, you have many parked goroutines. That is not a "timer" leak per se, but it can be a goroutine concentration issue.

Avoid `time.Sleep` in code that needs to be cancellable. Use `select` with a `<-ctx.Done()` arm.

```go
// Cancellable sleep
func sleep(ctx context.Context, d time.Duration) error {
    t := time.NewTimer(d)
    defer t.Stop()
    select {
    case <-ctx.Done():
        return ctx.Err()
    case <-t.C:
        return nil
    }
}
```

This is the canonical pattern. Use it instead of `time.Sleep` whenever the sleep might need to be interrupted.

---

## Appendix AW: Goroutine Stack Scan Implications

When the GC runs, it scans every goroutine's stack. A goroutine parked on `<-time.After(d)` has the timer's channel reference on its stack. The GC sees the reference and keeps the timer alive.

This is *user-side* retention. It exists regardless of Go version. Even on 1.23+, a goroutine that holds a timer reference keeps the timer alive.

So the 1.23 fix specifically targets *unreferenced* timers — those not held by any goroutine stack, struct field, or global. For timers that are referenced (the normal case for `NewTimer` + `defer Stop`), nothing changed.

This is why the 1.23 fix is sometimes described as "fixing only the `time.After` leak." The user-visible references for `time.After` are minimal: just the channel returned to the caller. If the caller's goroutine drops the channel, the timer can be reclaimed.

For `NewTimer`, the user typically keeps the `*time.Timer` value on their stack until the function returns. The GC sees the reference. No reclaim until the user-side reference is gone.

This nuance matters when you predict which workloads will benefit from a 1.23 upgrade. Workloads heavy in `time.After` benefit a lot. Workloads heavy in `NewTimer` + Stop benefit less (they were already well-managed).

---

## Appendix AX: Final Words

The timer subsystem is a microcosm of Go runtime design: practical, scalable, with sensible defaults but unforgiving of misuse. The user-facing APIs hide complexity that, when leaked through misuse, becomes the operator's problem.

At senior level, your job is to know the complexity well enough to:

- Avoid misuse in code you write.
- Catch misuse in code you review.
- Diagnose misuse in code you operate.
- Design APIs and abstractions that prevent misuse downstream.

The four exercises blend into one habit: think about timer lifecycles the way you think about file descriptors or database connections. They are resources. They must be cleaned up. The runtime helps you, but it cannot help you with what it cannot see.

The next page (Professional) takes this knowledge into the operations realm: how to monitor timer health at scale, how to set SLOs that catch regressions, how to run incident response when a timer leak is hurting production, and how to communicate timer risk to non-engineering stakeholders.

Continue on if you operate Go services. The path is well-trodden, the tooling is mature, and the discipline pays back many times over the cost of learning it.

---

## Appendix AY: Concurrency Patterns That Avoid Timers Entirely

Sometimes the right answer is to not use a timer at all. Several patterns achieve "time-based" behaviour without any explicit timer:

### Pattern 1: Polling with `time.Since`

For loose timing requirements:

```go
start := time.Now()
for {
    if time.Since(start) > deadline {
        return errTimeout
    }
    // do some work
    runtime.Gosched()
}
```

No timer. Just `time.Now()` reads. Cheap. But it pegs a CPU core if the loop has no internal blocking. Use only when the loop has natural blocking (e.g., a channel receive with `default`).

### Pattern 2: Time-stamped messages

Embed timestamps in messages and process based on `time.Since(msg.Timestamp)`:

```go
type Msg struct {
    Timestamp time.Time
    Payload   []byte
}

func process(m Msg) {
    if time.Since(m.Timestamp) > maxAge {
        return // too old
    }
    // process
}
```

No timer. The "expiry" check is implicit in the message.

### Pattern 3: Generation counters

For "the user has stopped interacting" detection, use a counter that increments on each interaction. A periodic check compares the current counter to a snapshot. If unchanged, the user is idle.

```go
var actionCounter atomic.Int64

func userAction() {
    actionCounter.Add(1)
}

func idleCheck() bool {
    snapshot := actionCounter.Load()
    time.Sleep(time.Second)
    return actionCounter.Load() == snapshot
}
```

One sleep, one snapshot. No long-running timer per user.

### Pattern 4: Bucketed counters

For rate limiting, bucket events by time slot:

```go
type Limiter struct {
    buckets [60]atomic.Int64 // one per second of last minute
}

func (l *Limiter) Record() {
    idx := time.Now().Second()
    l.buckets[idx].Add(1)
}

func (l *Limiter) Recent(d time.Duration) int64 {
    var total int64
    for i := 0; i < int(d.Seconds()); i++ {
        idx := (time.Now().Second() - i + 60) % 60
        total += l.buckets[idx].Load()
    }
    return total
}
```

No timer. The bucket structure encodes time implicitly via the array index.

Pattern selection is part of senior-level design. When you reach for `time.NewTimer`, ask first: do I need a timer, or can I encode time some other way?

---

## Appendix AZ: Migration Path For A Legacy Codebase

If you inherit a codebase with hundreds of timer-related issues, do not try to fix all of them at once. Migrate in waves:

### Wave 1: Stop the bleeding

- Find the worst offenders. Use pprof to identify the top three call sites for `time.NewTimer` allocation.
- Patch those three. Deploy. Measure.
- Likely you fix 70% of the leak with 5% of the changes.

### Wave 2: Linting in CI

- Add `gocritic` with `timeAfterLoop` enabled.
- Set CI to fail on new violations but warn on existing ones (using `nolint` directives for grandfathered cases).
- This stops new leaks from being added.

### Wave 3: Refactor by module

- Pick one module at a time.
- Search for `time.After`, `time.Tick`, `time.NewTicker`, `time.AfterFunc`, `time.NewTimer`.
- Audit each occurrence. Apply the right pattern.
- Add tests with goleak.

### Wave 4: Remove `nolint` directives

- As modules are refactored, remove their grandfathered exemptions.
- Eventually the codebase is fully compliant.

### Wave 5: Maintain

- New PRs must pass lint.
- Quarterly review of timer-related metrics.
- Annual game-day exercise simulating a timer leak.

This migration takes months in a large codebase but is sustainable. The alternative — a giant single PR — risks breaking things and is hard to review. Incremental progress is the right approach.

---

## Appendix BA: An Extended Q&A

Several questions come up frequently in interviews and code reviews. Detailed answers:

### Q: "Why does Go not just garbage collect timers like other languages?"

It does, on 1.23+. The change is recent. The reason it took until 1.23 is that the GC needed careful coordination with the runtime's timer machinery, including the per-P heap and the atomic state machine. The naive approach (just put a finalizer on each timer) would have been correct but slow. The Go team chose a more integrated mechanism for performance.

### Q: "If Go 1.23 fixes the leak, why should I still avoid `time.After` in loops?"

Two reasons. First, the fix is GC-bounded: timers are reclaimed when the GC runs, which may be hundreds of milliseconds after they become unreachable. In a high-rate loop, you still accumulate timers temporarily. Second, even if memory is reclaimed quickly, the *allocation rate* is the same; you still pay the GC pressure and the allocator cost.

The reusable-timer pattern eliminates both. Allocations drop to zero in steady state.

### Q: "How do I know which timer is leaking?"

Pprof's call-site attribution is your friend. `peek time.NewTimer` followed by `list <caller>` gives you the exact source line. Cross-check with `pprof goroutine?debug=2` to see how many goroutines are parked at that line. The line with the most parked goroutines is usually the leak.

### Q: "Can a `*time.Ticker` ever be unused without leaking?"

No. The runtime keeps re-inserting the ticker's heap entry after each fire. If you do not call `Stop`, the ticker fires forever. The channel buffer (capacity 1) fills, subsequent fires are dropped, but the timer entry is re-inserted into the heap on each fire.

This means: even Go 1.23+ does not save you. Always `Stop` a `*time.Ticker`.

### Q: "Is there a way to count active timers in the runtime?"

Not directly via public API. You can approximate via `runtime.NumGoroutine` (each timer goroutine is one goroutine), parse pprof goroutine dumps, or expose the count via custom runtime debug build flags.

In Go internals, each P has `numTimers` and `deletedTimers` atomic counters. They are not exposed to user code.

### Q: "What is the performance impact of `defer t.Stop()`?"

Negligible. `defer` overhead in modern Go is a few nanoseconds. `t.Stop()` on a non-active timer is a quick atomic CAS. The cost is far less than the GC pressure of a leaked timer.

### Q: "When should I use `time.AfterFunc` instead of `NewTimer` + goroutine?"

`AfterFunc` is fine when:

- The callback is fire-and-forget.
- The callback does not need to read from a channel.
- The callback is small and does not capture heavy state.

Use `NewTimer` + goroutine when:

- You need to integrate with a `select`.
- The cleanup logic is complex.
- You want full synchronisation control.

In most production code, `NewTimer` + goroutine is preferable because it composes better.

### Q: "Can timer code call into user code on a runtime thread?"

Yes. `AfterFunc` callbacks run on a fresh goroutine, not on a runtime thread directly. But the goroutine is created from runtime code, and the runtime owns the scheduling.

`sendTime` (the internal callback for `NewTimer`) does run on the runtime's scheduling thread. But it only does a single send-with-default on the channel and returns. User code never runs there.

### Q: "What is `nextwhen` in the `runtime.timer` struct?"

Used during `Modify` operations. The new `when` value is stored in `nextwhen` until the modification is committed via `cleantimers`. This avoids a race where another goroutine sees a half-modified `when`.

### Q: "Why does the runtime use lazy deletion instead of immediate?"

Performance. Immediate deletion would require a heap removal on every `Stop`, which is O(log N). Lazy deletion is O(1) for the CAS and amortises the heap work across `cleantimers` calls.

The downside is that the heap can be larger than the active timer count. This is observable in `pprof -inuse_space` as briefly higher numbers right after a flurry of Stop calls. It self-corrects on the next `cleantimers` pass.

### Q: "Does `runtime.GC()` force `cleantimers` to run?"

Not directly. `runtime.GC()` triggers a garbage collection cycle, which may reclaim timer memory if the timers are unreferenced. But `cleantimers` is a runtime-internal function tied to the scheduler, not to GC.

In practice, the scheduler runs `cleantimers` frequently enough that lazy deletions are reaped within milliseconds of the Stop call. You should not need to force it.

---

## Appendix BB: One More Code Audit For Practice

Read the following. Identify all timer-related issues.

```go
package server

import (
    "context"
    "log"
    "net/http"
    "sync"
    "time"
)

type Server struct {
    mu        sync.Mutex
    conns     map[string]*Conn
    shutdown  chan struct{}
}

type Conn struct {
    id       string
    lastSeen time.Time
    ws       *Websocket
    closer   *time.Timer
}

func (s *Server) accept(c *Conn) {
    s.mu.Lock()
    s.conns[c.id] = c
    c.closer = time.AfterFunc(30*time.Minute, func() {
        s.disconnect(c.id)
    })
    s.mu.Unlock()
}

func (s *Server) touch(id string) {
    s.mu.Lock()
    defer s.mu.Unlock()
    c, ok := s.conns[id]
    if !ok {
        return
    }
    c.lastSeen = time.Now()
    c.closer.Reset(30 * time.Minute)
}

func (s *Server) heartbeat() {
    for {
        select {
        case <-s.shutdown:
            return
        case <-time.Tick(time.Minute):
            s.sendHeartbeats()
        }
    }
}

func (s *Server) HandleConnection(ctx context.Context, ws *Websocket) {
    c := &Conn{id: newID(), ws: ws}
    s.accept(c)
    for {
        select {
        case <-ctx.Done():
            return
        case msg := <-ws.Recv():
            s.touch(c.id)
            select {
            case ws.Send() <- msg:
            case <-time.After(time.Second):
                log.Println("send timeout")
            }
        }
    }
}

func (s *Server) sweepIdle(ctx context.Context) {
    t := time.NewTimer(time.Minute)
    for {
        select {
        case <-ctx.Done():
            return
        case <-t.C:
            s.expireIdle()
        }
        t.Reset(time.Minute)
    }
}
```

### Answer key

1. **`accept`**: `time.AfterFunc` callback captures `s` and `c.id`. `c.id` is a string (small). `s` is a pointer (small). Captures are fine. But the timer is created without explicit cleanup if `disconnect` does not stop it. Audit `disconnect` for `c.closer.Stop()` — if missing, that is a leak on graceful disconnect.

2. **`touch`**: `c.closer.Reset(30 * time.Minute)` without `Stop` first. This is the `Reset` gotcha. For `AfterFunc` it is slightly different because there is no channel to drain, but the runtime's documented contract still requires `Stop` before `Reset`. The behaviour without `Stop` is technically undefined and historically has bugs.

3. **`heartbeat`**: `time.Tick(time.Minute)` inside a `for` loop. Each iteration creates a fresh leaked ticker. After ten minutes of running, there are nine leaked tickers each firing every minute, plus the one currently being read. This is a *catastrophic* leak. Should be `time.NewTicker` outside the loop with `defer Stop`.

4. **`HandleConnection`**: `time.After(time.Second)` inside the inner `select`, inside the outer `for`. Per-message allocation. Should be a reusable `NewTimer`.

5. **`sweepIdle`**: Missing `defer t.Stop()`. Also missing the Stop+drain before `Reset`. If the loop iterates very fast (e.g., if `expireIdle` is slow), `t.C` might still have a value when `Reset` is called.

A senior-level review would catch all five and request a comprehensive refactor.

---

## Appendix BC: Refactor Of The Above

Here is the leak-free version:

```go
package server

import (
    "context"
    "log"
    "net/http"
    "sync"
    "time"
)

type Server struct {
    mu        sync.Mutex
    conns     map[string]*Conn
    shutdown  chan struct{}
}

type Conn struct {
    id       string
    lastSeen time.Time
    ws       *Websocket
}

const (
    idleAfter        = 30 * time.Minute
    heartbeatPeriod  = time.Minute
    sweepPeriod      = time.Minute
    sendTimeout      = time.Second
)

func (s *Server) accept(c *Conn) {
    s.mu.Lock()
    c.lastSeen = time.Now()
    s.conns[c.id] = c
    s.mu.Unlock()
}

func (s *Server) touch(id string) {
    s.mu.Lock()
    defer s.mu.Unlock()
    if c, ok := s.conns[id]; ok {
        c.lastSeen = time.Now()
    }
}

func (s *Server) heartbeat(ctx context.Context) {
    t := time.NewTicker(heartbeatPeriod)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case <-s.shutdown:
            return
        case <-t.C:
            s.sendHeartbeats()
        }
    }
}

func (s *Server) HandleConnection(ctx context.Context, ws *Websocket) {
    c := &Conn{id: newID(), ws: ws}
    s.accept(c)
    defer s.disconnect(c.id)

    sendT := time.NewTimer(sendTimeout)
    defer sendT.Stop()

    for {
        if !sendT.Stop() {
            select {
            case <-sendT.C:
            default:
            }
        }
        sendT.Reset(sendTimeout)

        select {
        case <-ctx.Done():
            return
        case msg, ok := <-ws.Recv():
            if !ok {
                return
            }
            s.touch(c.id)
            select {
            case ws.Send() <- msg:
            case <-sendT.C:
                log.Println("send timeout")
            }
        }
    }
}

func (s *Server) sweepIdle(ctx context.Context) {
    t := time.NewTicker(sweepPeriod)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case <-t.C:
            s.expireIdle()
        }
    }
}

func (s *Server) expireIdle() {
    cutoff := time.Now().Add(-idleAfter)
    s.mu.Lock()
    var toClose []*Conn
    for id, c := range s.conns {
        if c.lastSeen.Before(cutoff) {
            toClose = append(toClose, c)
            delete(s.conns, id)
        }
    }
    s.mu.Unlock()
    for _, c := range toClose {
        c.ws.Close()
    }
}
```

Changes:

1. Removed per-connection `AfterFunc`. Replaced with a sweeper that checks `lastSeen` on each cycle.
2. `heartbeat` uses `NewTicker` + `defer Stop`.
3. `HandleConnection` uses a reusable `NewTimer` for send timeouts, with the Stop+drain+Reset pattern.
4. `sweepIdle` uses `NewTicker` + `defer Stop`.
5. Removed per-connection timer state from `Conn`.

The result:

- One ticker for heartbeats. One ticker for sweeping. One reusable timer per active connection.
- No `time.After`. No `time.Tick`. No `AfterFunc`.
- Total runtime timers: 2 + active connections.

For 10 000 connections, that is 10 002 timers. Linear in connection count, not in operations. Bounded memory.

---

## Appendix BD: Concluding Senior-Level Material

We have covered:

- The fundamental architecture of the Go timer subsystem.
- The state machine that ensures concurrent correctness.
- The per-P heap design and its scaling implications.
- The Go 1.23 GC fix and its scope.
- Detection via pprof, runtime trace, goroutine dumps.
- Design patterns for high-cardinality timing: sweepers, wheels, sorted heaps.
- Real case postmortems and refactors.
- A migration path for legacy codebases.
- Comparisons with peer runtimes.
- Reading the Go runtime source code for timers.

The senior-level reader now has the depth to:

- Reason about timer behaviour across Go versions.
- Diagnose any production timer leak from first principles.
- Design systems that scale beyond the per-entity-timer limit.
- Mentor mid-level engineers on timer hygiene.
- Contribute to runtime-level discussions and changes.

The professional page next moves to operations: SLOs, alerts, dashboards, postmortems. Senior-level depth plus operational fluency is what makes a staff-level Go engineer.

Thank you for reading this far. The discipline you have built here will pay off many times in your career.

---

## Appendix BE: A Few Recommended Habits

To close, a personal note. The following habits, internalised over years, make timer hygiene automatic:

1. **When you write `time.NewTimer`, immediately write `defer t.Stop()` on the next line.** Do not let the function grow without that line.
2. **When you write `time.NewTicker`, immediately write `defer t.Stop()` on the next line.** Same rule.
3. **When you see `time.After`, ask "is this in a loop or a hot path?"** If yes, refactor before committing.
4. **When you see `time.Tick`, ask "is this in `main`?"** If no, refactor before committing.
5. **When you see `Reset`, ask "is the channel drained?"** If unsure, add the drain.
6. **When you see `AfterFunc`, ask "what does the closure capture?"** Minimise captures.
7. **When you review a PR, scan for any of the above patterns first.** Most timer issues hit the eye in five seconds with this scan.
8. **When you operate a service for the first time, capture a baseline pprof at startup.** Reference it later when something seems off.
9. **When you encounter a timer-related incident, write a postmortem.** Share with the team. Build collective muscle.
10. **When you teach others, lead with the question "where does the timer live?"** That single question unlocks the rest.

These habits are not heavy. They are micro-investments that pay back continuously. Adopt them, and timer-related problems become rare in your work.

---

## Appendix BF: The Last Thing

The Go runtime team has worked hard to make timers as easy as possible. The 1.23 fix is the latest in a long series of improvements. The community has built linters and tools to catch misuse.

Despite all that, every year there are production incidents traced back to a single `time.After` in a loop. The reason is not that the rules are unknown — the rules are widely documented. The reason is that the rules are easy to forget in the moment of writing code, and they have no compile-time enforcement.

The remedy is discipline, mentorship, and tooling. This page contributes to the first two. The community's linters and CI rules contribute to the third.

When you encounter the next timer leak, fix it cleanly, document the cause, and teach someone else. That is how the lore propagates. That is how Go-the-community gets a little better at this with each generation of engineers.

Go forth and write leak-free timers.

---



