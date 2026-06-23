---
layout: default
title: Senior
parent: Ticker
grand_parent: Time-Based Concurrency
ancestor: Go
nav_order: 4
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/16-time-based-concurrency/01-ticker/senior/
---

# time.Ticker — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [What the Senior Level Adds](#what-the-senior-level-adds)
3. [The runtimeTimer Struct](#the-runtimetimer-struct)
4. [The Pre-1.14 Single-Heap Scheduler](#the-pre-114-single-heap-scheduler)
5. [The 1.14 Per-P Timer Heap Redesign](#the-114-per-p-timer-heap-redesign)
6. [The Four-Heap Era (1.14 to 1.22)](#the-four-heap-era-114-to-122)
7. [The Go 1.23 Redesign](#the-go-123-redesign)
8. [Channel Buffer Semantics Pre and Post 1.23](#channel-buffer-semantics-pre-and-post-123)
9. [Stop Edge Cases](#stop-edge-cases)
10. [Reset Edge Cases](#reset-edge-cases)
11. [How Send Into t.C Happens](#how-send-into-tc-happens)
12. [The asyncpreempt and Timer Interaction](#the-asyncpreempt-and-timer-interaction)
13. [Garbage Collection of Timers](#garbage-collection-of-timers)
14. [time.After Versus NewTimer Allocation Cost](#timeafter-versus-newtimer-allocation-cost)
15. [Heap Operations Complexity Analysis](#heap-operations-complexity-analysis)
16. [Tickers Under Heavy Load](#tickers-under-heavy-load)
17. [Performance Comparison Microbenchmarks](#performance-comparison-microbenchmarks)
18. [Interaction with GOMAXPROCS](#interaction-with-gomaxprocs)
19. [Locking Inside the Runtime Timer Code](#locking-inside-the-runtime-timer-code)
20. [Designing Custom Timer Wheels](#designing-custom-timer-wheels)
21. [Edge Cases You Will Encounter in Production](#edge-cases-you-will-encounter-in-production)
22. [Diagnosing Ticker Problems with pprof](#diagnosing-ticker-problems-with-pprof)
23. [Diagnosing Ticker Problems with execution traces](#diagnosing-ticker-problems-with-execution-traces)
24. [Live Migration and Suspend Resume](#live-migration-and-suspend-resume)
25. [Memory Ordering of Tick Delivery](#memory-ordering-of-tick-delivery)
26. [Comparison with Other Languages](#comparison-with-other-languages)
27. [When Ticker Is the Wrong Tool](#when-ticker-is-the-wrong-tool)
28. [Two Production Incidents Reconstructed](#two-production-incidents-reconstructed)
29. [Building a Ticker From Scratch](#building-a-ticker-from-scratch)
30. [Coalesced Timer Service](#coalesced-timer-service)
31. [Tickers and the Network Poll Loop](#tickers-and-the-network-poll-loop)
32. [Cgo and Tickers](#cgo-and-tickers)
33. [Scheduler Latency Budget](#scheduler-latency-budget)
34. [Choosing Between Ticker, Timer, and Sleep](#choosing-between-ticker-timer-and-sleep)
35. [Pathological Patterns Worth Naming](#pathological-patterns-worth-naming)
36. [Designing APIs That Wrap Tickers](#designing-apis-that-wrap-tickers)
37. [Tickers in Library Code](#tickers-in-library-code)
38. [The Future of Tickers](#the-future-of-tickers)
39. [Reading the Source](#reading-the-source)
40. [Self-Assessment](#self-assessment)
41. [Summary](#summary)

---

## Introduction

At the senior level the question is not "how do I use a ticker correctly" — that is junior. It is not "how do I integrate it with cancellation and adaptive intervals" — that is middle. The senior question is "what does the runtime actually do when I call `NewTicker`, `Stop`, `Reset`, or receive from `t.C`, and which of those operations cost what under load?"

This file opens the implementation. It walks through the runtime's timer subsystem, traces through `Stop` and `Reset` edge cases at the level of the `runtimeTimer` struct, contrasts the pre-Go-1.23 four-heap design with the current single-heap-per-P design, and explains why the channel buffer of `t.C` changed semantics in Go 1.23. By the end you should be able to:

- Sketch the `runtimeTimer` struct from memory.
- Trace `NewTicker` → `startTimer` → heap insertion → fire → channel send.
- Explain why `Stop` is O(log N) and what happens to the freed slot.
- Articulate every state a timer can be in (`timerWaiting`, `timerRunning`, `timerDeleted`, etc.) and what transitions are legal.
- Explain the relationship between the timer heap and the netpoll/work-stealing scheduler.
- Reason about timer behaviour at extreme scale (10k+ tickers in one process).
- Diagnose ticker performance issues using `pprof`, `runtime/trace`, and the runtime's own counters.
- Decide when a ticker is the wrong abstraction and a custom timer wheel, a sleep-based loop, or a real-time clock interface would serve better.

Be warned: the material here references symbols that have moved or been renamed across Go versions. The source pointers in this document target Go 1.22–1.24, with explicit notes when older versions differ. If you are running Go 1.18 you will still recognise the shapes — only file layouts will differ.

---

## What the Senior Level Adds

Middle-level code answers questions about *behaviour*: when does the ticker fire, how does Reset interact with pending ticks, how do I handle slow consumers, how do I write a non-flaky test. Senior-level questions are about *mechanism*:

1. Where in memory does the timer state live?
2. Which goroutine, exactly, performs the channel send when the ticker fires?
3. What does the runtime's data structure look like, and what are its complexity guarantees?
4. How does the runtime's scheduler interact with the netpoll, the GC, and the timer subsystem to keep wake-ups timely?
5. What changed in Go 1.23, and what did that change buy you?
6. Why is `time.After` more expensive than a long-lived ticker, in terms of cache misses, heap operations, and GC pressure?
7. How would you design your own timer wheel, and when would that be better than the standard library?
8. What is the failure mode when a process has 100 000 active timers?
9. What is the memory cost per timer, and what are the lifetime invariants?
10. What does an execution trace look like for a ticker-heavy program, and how do you read it?

This document treats each in turn. The discussion is concrete: it shows code from the standard library where it is illuminating, names types and fields by their exact identifiers, and points to commit hashes when the discussion concerns a specific historical change.

---

## The runtimeTimer Struct

The user-facing `time.Ticker` is a thin wrapper around the runtime's `timer` struct (declared in `runtime/time.go`). Through Go 1.22 it looks roughly like this (simplified):

```go
type timer struct {
    pp puintptr // P that owns this timer (or 0 if none)

    when     int64        // monotonic ns, when timer should fire
    period   int64        // ns between fires (0 for one-shot)
    f        func(any, uintptr) // callback when timer fires
    arg      any          // arg to f
    seq      uintptr      // arg to f

    nextwhen int64        // for modify race resolution
    status   atomic.Uint32 // see timer states below
}
```

Key fields:

- **`when`** — the monotonic-clock nanosecond timestamp at which the timer fires next. The runtime compares `when` against `nanotime()` to decide whether to fire.
- **`period`** — for ticking timers, the recurrence in nanoseconds. After firing, the runtime advances `when` by `period`.
- **`f`** — the callback invoked when the timer fires. For `Ticker`, `f` is `sendTime`, which performs a non-blocking send on the channel.
- **`arg`** — the channel itself, cast to `any`.
- **`status`** — an atomic state field. Possible values: `timerNoStatus`, `timerWaiting`, `timerRunning`, `timerDeleted`, `timerRemoving`, `timerRemoved`, `timerModifying`, `timerModifiedEarlier`, `timerModifiedLater`, `timerMoving`. (We will return to these.)

In Go 1.23 the struct simplified — the elaborate state machine collapsed into a smaller, lock-protected form. The state names became obsolete and the queue moved per-P. Both eras are covered below.

### Why So Many States Pre-1.23

The pre-1.23 timer code minimised lock contention by using atomic CAS on `status`. A timer being modified by user code (via `Reset` or `Stop`) had to coordinate with the timer-firing goroutine on another P. The state machine encoded "in flight" mutations so that the firing goroutine could check for them and skip or re-evaluate.

For example, calling `Stop` on a timer whose status is `timerWaiting` transitions it to `timerModifying`, then to `timerDeleted`. If another goroutine on the owning P is concurrently firing, it sees `timerDeleted` and skips firing. The timer's slot in the heap is collected lazily, the next time the heap is touched.

This is sophisticated but error-prone — many bugs across 1.14 to 1.22 traced to subtle race conditions in this state machine. Go 1.23 replaced it with a lock-and-list design that is slower in microbenchmarks but easier to reason about.

### The sendTime Callback

For tickers, `f` is `sendTime`:

```go
// runtime/time.go, paraphrased
func sendTime(c any, seq uintptr) {
    ch := c.(chan Time)
    select {
    case ch <- Now():
    default:
    }
}
```

It is a non-blocking send. If the channel's buffer (capacity 1) is full, the value is discarded. This is *how* missed ticks vanish: not because the runtime tracks "you missed one," but because the send itself drops the value silently when the consumer is behind.

The `Now()` call is the current monotonic + wall time. It is the value the consumer receives. Sending the *fire time* (i.e. `when`) would be more pedantic but rounds slightly differently — the runtime chose "now at the moment of the send," not "the scheduled when," which means a tick observed on a contested CPU may have a slightly later timestamp than the original `when`.

### The arg Field

`arg` is `any` (interface{}). For a ticker, it holds the channel. The interface header is two words (type pointer + data pointer). The data pointer references the channel, which lives on the heap.

Why the indirection? Because the runtime's timer subsystem treats `f` and `arg` opaquely — different timers' `f`s do different things. Some (`time.AfterFunc`) call a user function. Some (the package-level `time.After`) send into a one-shot channel. Some (in internal Go internals) trigger garbage collection assists. The interface gives one shape to all.

### Memory Cost

Per timer (pre-1.23):

- `time.Ticker` struct: ~3 words (channel pointer, runtime handle, etc.).
- `runtime.timer` struct: ~10–12 words.
- The buffered channel: a `hchan` with capacity-1 element buffer, plus its `qcount`, `dataqsiz`, `buf`, `elemsize`, `sendx`, `recvx`, `lock`. Around 100 bytes.

Total: roughly 200–300 bytes per ticker. For a service with 10 000 tickers, that is 2–3 MB just for the structures. The GC pressure depends on how many tickers churn versus persist.

In Go 1.23 these costs are similar in absolute terms but the layout simplified. Tickers no longer carry the state-machine atomics; the per-P queue holds a slice of pointers protected by a mutex.

### Field Walkthrough Pre-1.23

Pre-1.23 the timer struct includes additional fields not shown in the simplified version:

```go
type timer struct {
    pp puintptr

    when     int64
    period   int64
    f        func(any, uintptr, int64)
    arg      any
    seq      uintptr

    nextwhen int64
    status   atomic.Uint32

    // Newer field added during the 1.20–1.22 redesign attempts:
    // some versions add a runtimeRand or other bookkeeping.
}
```

`puintptr` is a "packed unsafe.Pointer" type that the GC understands but does not trace. The `pp` field holds the P that owns this timer, so the runtime knows whose heap to mutate. When a timer is on no heap (status `timerRemoved`), `pp` is nil.

`when` and `nextwhen`: the dual fields exist because Reset is implemented as "set `nextwhen`, then atomically update `when` next time the heap is touched." This avoids holding a lock for the entire Reset.

`f` is the timer callback. Its signature is `func(arg any, seq uintptr, fired int64)` — `fired` is the time at which the runtime decided to fire (in nanoseconds since boot). For `Ticker`, `f` is `sendTime`.

`arg` and `seq`: for tickers, `arg` is the channel and `seq` is unused.

### Field Walkthrough Post-1.23

Post-1.23, the struct is much simpler:

```go
type timer struct {
    mu       mutex
    astate   atomic.Uint32 // status used for atomic peek
    state    uint32
    isChan   bool   // ticker timers
    blocked  uint32
    period   int64
    f        func(arg any, seq uintptr, delta int64)
    arg      any
    seq      uintptr
    when     int64
    ts       *timers // owning slice
}
```

The state machine simplifies. The `isChan` flag distinguishes tickers from other timers. The `blocked` field counts pending sends. The `ts` pointer ties the timer to the owning P's timer slice.

The `mu` mutex protects the timer's own state during Reset/Stop. The atomic `astate` field is a non-locked view for fast-path checks.

### Cost Per Field

`when`: 8 bytes. The hot field — every heap comparison reads it.
`period`: 8 bytes. Read on fire and Reset; rarely written.
`f`: 8 bytes (function pointer).
`arg`: 16 bytes (interface header).
`seq`: 8 bytes.
`status`/`astate`: 4 bytes.
`pp`/`ts`: 8 bytes.

Total: ~60 bytes for the core fields plus alignment, plus the mutex (~12 bytes), bringing the struct to ~80 bytes.

### Memory Alignment Considerations

`when` is read frequently for heap comparisons. Placing it first (or aligned to a cache line) helps. The runtime developers have tweaked the layout multiple times for performance; current layouts are within a few percent of optimal for typical access patterns.

---

## The Pre-1.14 Single-Heap Scheduler

Before Go 1.14, the runtime used a single global heap of timers, protected by a single mutex (`timers` and `timersLock`). One dedicated OS thread, "timerproc," slept on a condition variable. When a timer was added that fired sooner than the next existing one, the producer would signal the condition variable to wake timerproc.

Problems with this design:

1. **Lock contention.** Every timer add/remove acquired the global lock. With 10k tickers being reset frequently, the lock was a hot spot.
2. **Cross-CPU traffic.** The timer was added by one goroutine on one P, fired on the timerproc thread, and the callback ran on yet another P (the channel's receiver). Cache lines moved across CPUs.
3. **Latency.** Timerproc itself competed with other goroutines for OS threads. Under load it could fall behind.

This design was acceptable for the modest concurrency levels of early Go. As services scaled past tens of thousands of goroutines, the global heap became a bottleneck, especially for code that used `time.After` extensively.

### Why It Was Replaced

Workloads with thousands of concurrent timers — typical in network servers using `time.After` for per-request timeouts — saw timer operations dominate CPU profiles. The 1.14 redesign moved timer state off the global lock.

---

## The 1.14 Per-P Timer Heap Redesign

Go 1.14 (proposal: golang/proposal/blob/master/design/26116-timers.md) introduced per-P timer heaps. Each `P` (logical processor in the M:N scheduler) owns its own heap of timers. The runtime's scheduler thread that runs a P also services that P's timers.

### Key Design Decisions

- **Per-P heap.** Each P has its own 4-heap (a variant of binary heap with 4 children per node, for cache locality). Adding or removing a timer touches only the owning P's lock.
- **Locality.** A goroutine that calls `time.NewTimer` typically runs on some P. The new timer is added to that P's heap. Most of the time, the same P fires it.
- **Work-stealing.** When a P's run queue is idle, it may steal timers from other Ps to even out the load. The cost is occasional cross-P traffic, but only when one P is idle.
- **Scheduler integration.** The scheduler's main loop, `findrunnable`, checks the P's timer heap on each tick. If the next timer is due, it fires it inline before parking. This eliminates the dedicated timerproc thread.

### The 4-Heap Choice

A 4-heap places four children per parent, versus the classic binary heap's two. The benefits:

- Cache-friendly: parent and four children fit in fewer cache lines.
- Shallower tree: a heap of N elements has depth log_4(N) instead of log_2(N).
- Slightly more work per sift, but fewer cache misses.

For typical workloads (1000–10000 timers per P), the 4-heap wins on modern CPUs.

### The Result

Microbenchmarks showed an order-of-magnitude reduction in lock contention for `time.After`-heavy workloads. Production code did not always notice — many services were not bottlenecked by timers — but applications using thousands of per-request timers saw measurable CPU savings.

### The State Machine

The trade-off: with timers being touched concurrently by multiple Ps (the owning P firing, another P stealing, the user goroutine modifying), the bookkeeping became elaborate. The `status` field's atomic state machine handled this:

```
timerNoStatus -> timerWaiting (on AddTimer)
timerWaiting -> timerRunning (when fire starts)
timerRunning -> timerNoStatus (one-shot done) or timerWaiting (recurring)
timerWaiting -> timerModifying (on Reset)
timerModifying -> timerModifiedEarlier or timerModifiedLater (depending on new when)
timerWaiting -> timerDeleted (on Stop)
timerDeleted -> timerRemoving -> timerRemoved (during heap cleanup)
```

This state diagram is paraphrased; the exact transitions are subtle and documented in `runtime/time.go` comments. Many production bugs over 2020-2023 traced to corner cases in this machine.

---

## The Four-Heap Era (1.14 to 1.22)

For nine Go releases, the four-heap-per-P design was the canonical timer implementation. Let's look at what `Stop` and `Reset` did to a timer in this era.

### Stop, Step by Step

1. The user calls `t.Stop()` on a `*time.Ticker`.
2. The `Ticker` calls `runtime.stopTimer(&t.r)`.
3. `stopTimer` does a CAS on `t.r.status` from `timerWaiting` to `timerDeleted`. If the CAS succeeds, the timer is logically removed; physical removal happens later.
4. If the CAS fails because the timer is in `timerRunning` or `timerModifying`, the code spins briefly and retries.
5. Physical removal: when the owning P's scheduler next walks the heap (in `runtimer`, `checkTimers`, or `clearDeletedTimers`), it sees `timerDeleted` entries and removes them.

The CAS-based `Stop` is O(1) in the common case — no heap operation, no lock. Physical cleanup is amortised across firing operations.

### Reset, Step by Step

1. The user calls `t.Reset(d)` on a `*time.Ticker`.
2. The `Ticker` calls `runtime.resetTimer(&t.r, when)`.
3. `resetTimer` looks at the current status:
   - `timerWaiting` or `timerModifiedEarlier`/`timerModifiedLater`: CAS to `timerModifying`, set `nextwhen = when`, CAS to the appropriate Modified state. The heap rebalance happens lazily on the next check.
   - `timerDeleted`: re-add to the heap with `addtimer`.
   - `timerRemoved`: re-add to the heap.
   - `timerNoStatus`: re-add to the heap.
4. The timer is now scheduled to fire at the new `when`.

Reset on a timer in `timerWaiting` is again O(1): no heap operation up front. The heap's invariant is restored when the next `checkTimers` runs.

### Lazy Heap Maintenance

The lazy approach to deletions and modifications was the source of subtle correctness issues. The runtime relied on the next `checkTimers` to discover that a timer's `when` had changed or that it should be removed. Between `Reset` and the next check, the timer might fire at the *old* `when`, or be skipped.

The standard library's `sendTime` callback handled this by checking the channel's state and the run-time `when` at the moment of fire. If the timer had been moved, the fire was either suppressed or rescheduled.

### Cross-P Stop and Reset

If `Stop` is called from a goroutine running on a different P from the timer's owning P, the CAS still works — the status field is on the timer struct, accessible from any P. But the cleanup happens on the owning P. Until then, the timer entry consumes a heap slot.

`Reset` from a different P is harder. Re-adding requires acquiring the owning P's timer lock. If the timer was deleted and is being re-added, the new add goes to the *calling* P, not the original — the timer migrates Ps. This was a source of subtle bugs in workloads with extensive `Reset` use across goroutines.

### Heap Walk

`checkTimers` runs from the scheduler's main loop, after every transition through `findrunnable`. It does:

1. Acquire the P's timer lock.
2. Pop the head of the heap (the timer with smallest `when`).
3. If `when > nanotime()`, push back and exit (no timers ready).
4. If status is `timerDeleted`, drop and goto 2.
5. Otherwise, CAS to `timerRunning`, release lock, run `f(arg, seq)`, re-acquire lock.
6. If recurring (`period > 0`), update `when = when + period`, CAS to `timerWaiting`, push back.
7. Otherwise, CAS to `timerNoStatus`, do not push back.
8. Goto 2 until heap head is in the future.

Locality: most of this runs on the same P, touching the same cache lines.

### Work-Stealing of Timers

When a P's run queue is empty and the scheduler tries to find work, it can steal timers from other Ps. The mechanism:

1. The idle P's scheduler picks a random other P.
2. It checks that P's timer head: is the timer due now?
3. If yes, steal it — atomically transfer ownership.
4. Fire it locally.

This balances load when one P has many due timers and another is idle. It also means a timer added on P0 may fire on P1, breaking locality.

Work-stealing of timers was added in Go 1.14 alongside per-P heaps. Before that, the global heap had no notion of stealing — the dedicated timerproc fired all timers.

Trade-off: stealing improves utilisation but adds cross-CPU traffic. For most workloads, the trade-off is favourable.

### Steal-by-Need Versus Eager Steal

The scheduler steals timers lazily: only when a P has nothing else to do. An idle P does not actively scan other Ps' heaps; it only checks when its own run queue is exhausted.

This avoids unnecessary cross-P interference in the common case (all Ps busy).

### Concurrent Access to a P's Heap

If P0 is firing a timer locally while P1 is trying to steal:

- P1 acquires P0's timer lock (read or write, depending on operation).
- The locks serialise; one waits for the other.
- The total work is the same; throughput is slightly lower than if there were no contention.

For lightly-contended scenarios, the lock is acquired rarely. For pathological scenarios (every P trying to steal from one P), the lock becomes a bottleneck.

### Heap Operations Are Inlined

In recent Go versions, key heap operations (sift-up, sift-down) are inlined or specialised for the timer code. This avoids function-call overhead for hot paths.

The inlining trades binary size for speed. The runtime is happy to make this trade.

---

## The Go 1.23 Redesign

Go 1.23 (released August 2024) replaced the elaborate state machine with a simpler design. The proposal is golang/go#54595 and golang/go#57070.

### What Changed

- **Single lock per P, not atomic state machine.** Each P's timer queue is a slice of `*timer` pointers, protected by the P's timer lock. State transitions happen under the lock.
- **Channel buffer increased to capacity ≥ 1.** Previously, `time.NewTicker` used a buffered channel of capacity 1, but the buffer's semantics around concurrent send and receive were subtle. In 1.23 the buffer behaviour was clarified: a send always succeeds (no drop) but only one value is "current" — older values are overwritten. This is implemented via the channel internals having a "skip" pointer.
- **GC-driven cleanup.** Timers no longer rely on `Stop` for memory reclamation. A timer with no live user references can be garbage-collected even before firing. The runtime detects unreferenced timers via a hidden finalizer.

### The Channel Buffer Change in Detail

Pre-1.23: `t.C` is `make(chan Time, 1)`. The runtime's `sendTime` does `select { case ch <- Now(): default: }`. If the buffer is full, the value is dropped.

Post-1.23: `t.C` still has capacity 1, but the runtime's send semantics use a different path. The send always *succeeds* by replacing the buffered value if one is present. The consumer always sees the most recent tick, never a stale one.

For most consumers this is invisible — they receive one tick per cycle either way. But for code that depends on the "drop" semantics (e.g. polling `t.C` in a non-blocking way to check liveness without consuming), the behaviour may differ.

The other change: `Stop` and `Reset` now drain the channel automatically. Pre-1.23, after `Stop` you might still observe one buffered tick; post-1.23, `Stop` guarantees that subsequent reads from `t.C` block forever (until `Reset` is called).

### Why The Buffer Change

The pre-1.23 dropping semantics led to confusing behaviour around `Reset`. After `Reset(d)`, a previously-buffered tick could be observed, leaking the old period's schedule into the new one. The post-1.23 model — always observe the latest, always reset cleanly — matches user intuition.

The cost: a tiny implementation overhead per send (the channel must check whether to overwrite). In practice it is negligible.

### GC of Tickers

Pre-1.23, a ticker held a reference to its `runtimeTimer`, the runtime heap held the timer, and the timer held the channel. Result: the ticker structure was unreachable from the GC's perspective only after `Stop` removed the timer from the heap. Forgetting `Stop` permanently leaked the ticker.

Post-1.23, the runtime tracks tickers via weak handles. The GC traces user references to `*time.Ticker`; if none exist, the timer becomes eligible for finalisation, the heap entry is removed, and the channel is collected. This makes "forgot to Stop" merely wasteful instead of catastrophic.

But: the GC's timing is not specified. A leaked ticker may continue to fire for many GC cycles before being collected. Always call `Stop`.

### Per-P State Simplification

The pre-1.23 state machine encoded many transient states. Post-1.23, a timer is in one of a small set of states:

- Not on any heap (the default after construction is similar; after Stop).
- On a P's heap, waiting to fire.
- Currently firing.

Transitions happen under the P's timer lock. No CAS spinning; no atomic state field. The implementation is shorter, easier to audit, and unlikely to harbour subtle races.

### Performance Trade-offs

In Go 1.23 microbenchmarks, `Stop` and `Reset` are slightly slower (lock acquire vs. atomic CAS), but `findrunnable`-driven firing is faster (no state-machine checks). Real workloads — microservices, distributed systems — are mostly unchanged or slightly improved.

The biggest win is correctness. Tickers behave more predictably across Reset/Stop sequences. Code that worked "most of the time" pre-1.23 now works consistently.

### Migration Considerations

Code that compiled and ran correctly on Go 1.22 should run correctly on Go 1.23 with no source changes. The redesign is internal.

However, you may notice:

- Slightly different timer firing timestamps under heavy contention (within microseconds; not user-visible normally).
- The pre-1.23 "stale tick on `t.C` after Reset" hazard is gone. If your code intentionally relied on observing a stale tick (rare), it won't.
- Memory usage may differ slightly due to layout changes.

Benchmark before and after. For most production code, the difference is in the noise.

### What 1.23 Did Not Change

- The public API of `time.Ticker`: `C`, `Stop`, `Reset`. Unchanged.
- The buffer of `t.C` as visible to user code: still capacity 1.
- The fact that `Stop` does not close `t.C`. Still requires explicit exit path.
- The fire rate: still relative to monotonic time, drift-corrected.
- Behaviour on Reset(0): still panics.

### Reading the 1.23 Implementation

The 1.23 timer code is largely in `src/runtime/time.go`. Key functions:

- `addtimer`: adds a timer to the current P's heap (or a designated P).
- `deltimer`: removes a timer.
- `modtimer`: modifies a timer's `when` and/or `period` (used by Reset).
- `timers.run`: walks the heap, fires due timers.
- `timers.check`: peeks the next-due timer for the scheduler.

The functions are shorter than their pre-1.23 counterparts. The lock-based design has fewer special cases.

---

## Channel Buffer Semantics Pre and Post 1.23

The change deserves its own treatment because it affects user-visible behaviour in subtle ways.

### Pre-1.23

The channel `t.C` has capacity 1. The send is:

```go
select {
case ch <- Now():
default:
}
```

State transitions:

- Empty buffer, send arrives → buffer holds value. Send returns.
- Full buffer, send arrives → default case taken. Value dropped.

This means:

- A consumer that reads slowly *will* miss ticks. The first read returns the *oldest* unobserved tick (the one in the buffer). Subsequent ticks are dropped.
- A `Stop` does not drain the buffer. A read after `Stop` may return the last buffered value, then block forever.

### Post-1.23

The buffer of `t.C` still has capacity 1 conceptually, but the send semantics changed. From the proposal: send *always succeeds*, replacing the buffered value if present.

State transitions:

- Empty buffer, send arrives → buffer holds value.
- Full buffer, send arrives → buffer overwritten. The previous value is lost.

This means:

- A slow consumer always sees the *most recent* tick on read, never a stale one.
- A `Stop` empties the buffer and prevents future sends. Subsequent reads block forever.
- A `Reset` after `Stop` re-enables sends and the buffer state from before Stop is cleared.

### User-Visible Impact

Most consumers do not notice. They read in a loop, observe one tick per cycle, do work, repeat.

A consumer that polled `t.C` non-blockingly to "check if a tick is pending" sees different behaviour:

```go
select {
case now := <-t.C:
    // pre-1.23: any buffered tick, possibly stale
    // post-1.23: the most recent tick
default:
    // no tick yet
}
```

The post-1.23 semantics align with "latest signal," which is what most code wants.

### Concurrency Implications

In both eras, `Reset` and `<-t.C` are individually safe to call from different goroutines. But the ordering matters more pre-1.23 because of the stale-value risk. Post-1.23, the runtime cleans up so the ordering is less critical.

### Migration Notes

If you have code that relied on "drop" semantics — for example, a slow consumer that periodically checks `len(t.C) > 0` (which always returns 0 or 1 anyway) — the behaviour is unchanged. The change is subtle and most real code is unaffected.

If you have code that did `select { case <-t.C: default: }` to check for *any* buffered tick after waiting some unspecified period, the pre-1.23 version may observe a tick from many periods ago. Post-1.23 it observes only the most recent. This is usually an improvement.

---

## Stop Edge Cases

Stop is conceptually simple but the corners are sharp.

### Stop Returns a Bool — Mostly Meaningless for Ticker

`time.Ticker.Stop` returns no value (`func (t *Ticker) Stop()`). Only `time.Timer.Stop` returns a bool. The Timer's bool indicates whether the stop succeeded in preventing the timer from firing. For ticker, the semantics are continuous — "did the next tick fire before stop" is not a useful question because ticks have been firing all along.

### Stop From the Firing Goroutine

In some patterns the callback for `time.AfterFunc` calls `Stop` on its own ticker:

```go
var t *time.Ticker
t = time.NewTicker(time.Second)
go func() {
    for now := range t.C {
        if shouldExit(now) {
            t.Stop()
            return
        }
        work(now)
    }
}()
```

After `Stop`, the `range` will block forever because `t.C` is not closed. The `return` after `Stop` is what breaks out. This is fine — the `range` never gets another chance to receive.

If `return` were omitted:

```go
for now := range t.C {
    if shouldExit(now) {
        t.Stop()
        // missing return
    }
    work(now)
}
```

The loop blocks on the next receive forever. This is a leak.

### Stop While Another Goroutine Is Receiving

```go
t := time.NewTicker(time.Second)
go consumer(t)
time.Sleep(5 * time.Second)
t.Stop() // consumer is parked in <-t.C
```

After `Stop`, the consumer's pending receive on `t.C` continues to block. `Stop` does not close the channel. The consumer leaks unless there is another exit path (a `select` with `ctx.Done()`).

### Double Stop

Calling `Stop` twice is safe; the second call is a no-op. The runtime detects the timer is not in the heap.

### Stop on a Garbage-Collected Ticker (Post 1.23)

If the user dropped all references to the ticker, Go 1.23+ will eventually GC it. Calling `Stop` on a *reference you held but are unaware was GC'd* is impossible — if you held the reference, the GC could not collect. The case is theoretical.

### Stop Inside the Tick Callback

For `time.AfterFunc`, the callback runs in a separate goroutine. Calling `Stop` on the timer from inside the callback is permitted but redundant — the timer has already fired and `Stop` cannot un-fire. For tickers, `time.AfterFunc` is not used.

### Stop Race With Reset

If goroutine A calls `Stop` while goroutine B calls `Reset`:

- Pre-1.23: depending on the order of atomic ops, the ticker may end up in `timerRemoved`, `timerWaiting`, or `timerModifiedLater` state. The result is observably non-deterministic.
- Post-1.23: the lock serialises the operations. If `Stop` wins, `Reset` re-arms; if `Reset` wins, `Stop` cancels.

Either way, code that races Stop against Reset has unclear semantics. Use a mutex or single-goroutine ownership of the ticker.

### Stop on a Ticker That Has Never Fired

`Stop` on a freshly constructed ticker that has not yet fired works: the timer is removed from the heap before the first fire. The channel buffer is empty.

### Stop Then Reset Then Stop

```go
t := time.NewTicker(time.Second)
t.Stop()
t.Reset(2 * time.Second)
t.Stop()
```

Each call is well-defined. After the second `Stop`, the ticker is dormant. The channel has no buffered value (assuming no fire happened between Reset and the second Stop).

### Stop in a defer With a Panic

```go
defer t.Stop()
panic("boom")
```

The deferred `Stop` runs during panic propagation. The timer is removed from the heap. Subsequent panics in the defer chain do not prevent `Stop` from being called — defers run independently.

This is one reason `defer t.Stop()` is the right idiom: it is panic-safe.

---

## Reset Edge Cases

Reset is the source of many production bugs because the API looks simple but interacts with the runtime in non-obvious ways.

### Reset on a Newly Created Ticker

```go
t := time.NewTicker(time.Second)
t.Reset(2 * time.Second)
```

The ticker has not fired yet. The first fire is scheduled at `start + 1s`. After `Reset(2s)`, the schedule is `Reset_call_time + 2s`. The first 1-second timer is removed (or its `when` is updated).

### Reset to the Same Period

```go
t := time.NewTicker(time.Second)
// ... half a second elapses ...
t.Reset(time.Second)
```

The new fire time is now `Reset_call_time + 1s`. The original schedule (`start + 1s`) is discarded. So `Reset` to the same period shifts the phase. This is occasionally surprising — calling `Reset(period)` thinking it is idempotent in fact resets the phase.

### Reset From a Goroutine Holding t.C

If a goroutine has just received from `t.C` and calls `Reset`, the next fire is `Reset_call_time + d`. The previous schedule's slot is replaced.

### Reset After Drain

```go
select {
case <-t.C:
default:
}
t.Reset(d)
```

The drain pulls any buffered tick. The Reset schedules the next fire at `Reset_call_time + d`. From the consumer's perspective, no ticks fire between the drain and the next `<-t.C` for at least `d`.

### Reset While a Tick Is in Flight

If the runtime's `sendTime` callback is partway through executing when `Reset` is called, the runtime serialises:

- Post-1.23 (lock-based): `Reset` blocks until the in-flight fire completes, then mutates the timer. The next fire is scheduled relative to `Reset_call_time`, not relative to the in-flight fire.
- Pre-1.23 (CAS-based): the `Reset` may observe the timer in `timerRunning` state and spin briefly. Once the firing callback returns and the state transitions, `Reset` proceeds.

In both eras, the user sees a coherent result: one or zero ticks land on `t.C` between Reset and the next observation.

### Reset to Zero or Negative

Panics. Same as `NewTicker(0)`.

```go
t.Reset(0) // panic: non-positive interval for Ticker.Reset
```

Wrap user-supplied durations:

```go
if d <= 0 {
    d = minPeriod
}
t.Reset(d)
```

### Reset Race With Itself

Two goroutines calling `Reset` concurrently:

- Pre-1.23: each `Reset` does its own CAS dance. The final state is whichever Reset won the last CAS — observably non-deterministic but always one or the other, not a corrupt state.
- Post-1.23: serialised by the lock. The last `Reset` wins.

If you have multiple writers, route through a single owner or use a mutex.

### Reset From the Tick Handler

```go
for {
    select {
    case <-ctx.Done():
        return
    case <-t.C:
        if adapt() {
            t.Reset(newPeriod())
        }
    }
}
```

This is the common adaptive-poll pattern. The Reset happens after the receive, so there is no race with an in-flight send. The next tick is at `Reset_call_time + newPeriod`. Clean.

### Reset to a Long Period

```go
t := time.NewTicker(time.Second)
// ... fires twice ...
t.Reset(time.Hour)
// One tick may already be buffered at this point.
```

If a tick was in `t.C` when `Reset` was called, the consumer will see that buffered tick immediately on the next receive — not after an hour. To prevent: drain before Reset.

### Reset Cascade: Reset From Inside an AfterFunc Callback

If you use `time.AfterFunc` for one-shot scheduling and the callback calls `Reset`:

```go
var t *time.Timer
t = time.AfterFunc(time.Second, func() {
    t.Reset(time.Second) // re-arm
})
```

This is a manual ticker. It works, but you must hold a reference to `t` from inside its own callback — requires the variable trick above. For tickers, just use `*time.Ticker` directly.

### Reset Performance

Each `Reset` is, in the common case, O(log N) where N is the number of timers on the owning P's heap. The cost is the heap sift after `when` changes. For most workloads this is a few hundred nanoseconds.

If you Reset thousands of times per second across many tickers, the total CPU spent in heap operations becomes noticeable. Profile with `pprof` to confirm.

### Reset Sequencing Across Goroutines

If goroutine A holds a reference to a ticker and calls `Reset`, and goroutine B is reading from `t.C`, the sequence of observable events:

1. A calls `Reset(d)`.
2. Until A's Reset takes effect (acquire lock, mutate `when`, release lock), the runtime fires according to the old schedule.
3. After Reset takes effect, the next fire is at `Reset_time + d`.
4. B observes the fire when it reads from `t.C`.

The wall-clock latency between A's Reset call and the runtime mutating `when` is sub-microsecond on uncontended systems. Pre-1.23, the lazy heap walk may delay the *visible* effect until the next `checkTimers`, but typically that runs within microseconds.

For practical purposes, Reset takes effect "immediately" from the perspective of either A or B.

### Reset and Channel Stability

`Reset` does not change `t.C`. The same channel value is reused. Pointers held by other goroutines remain valid. This is the main reason Reset is preferred over Stop+NewTicker — wiring is preserved.

### Reset of a Recently-Stopped Ticker

```go
t := time.NewTicker(time.Second)
t.Stop()
// at this point, the ticker is not in any P's heap
t.Reset(time.Second)
// the ticker is re-added to the current P's heap
```

The Reset puts the ticker back on the heap. On post-1.23, this is straightforward. On pre-1.23, the timer's status transitions: `timerRemoved -> timerWaiting`. The owning P may be different from the original (it is now whichever P called Reset).

### Reset After Heavy GC

If the GC is in a STW (stop-the-world) phase, all goroutines pause. Tickers do not fire during STW. After STW ends, due timers fire in a burst. If you Reset during this burst, the effect is as if the Reset happened at the resume time, not the original call time.

This is rare — STW pauses are short (sub-millisecond on Go 1.5+). But for latency-sensitive code measuring tick precision, GC pauses are the dominant source of jitter.

---

## How Send Into t.C Happens

When a ticker fires, the runtime's scheduler (running on some P) executes `sendTime(c, 0)`. Walk through this in detail:

1. The scheduler's `findrunnable` notices the head of the P's timer heap has `when <= nanotime()`.
2. The runtime pops the timer, transitions its status to `timerRunning`.
3. The runtime calls `f(arg, seq)`. For a ticker, this is `sendTime(c, 0)`.
4. `sendTime` does `select { case c <- Now(): default: }`.
5. If the channel buffer is empty, `Now()` is enqueued; if full, the value is discarded (pre-1.23) or overwrites (post-1.23).
6. The scheduler advances the timer's `when` by `period` and re-inserts it into the heap (status `timerWaiting`).
7. The scheduler continues to the next timer or returns to its main loop.

The whole sequence takes microseconds at most. The channel send is the slowest part; the heap operations are fast.

### Who Receives

Whichever goroutine is parked in `<-t.C` (or, if many, the first to attempt receive after the send). The runtime's channel implementation wakes one parked receiver. The wake-up moves the receiver from `Gwaiting` to `Grunnable`. The scheduler then runs the receiver on some P (possibly the same P that ran `sendTime`, possibly another).

The latency from `when` to the receiver actually executing its handler is therefore: nanoseconds for the heap operation, plus channel send (sub-microsecond), plus scheduler wake-up (microseconds on average, possibly more under load).

### Locality

Best case: the timer is on the same P as the goroutine that constructed the ticker, the firing runs on the same P, the consumer parks on the same P. All cache-local.

Worst case: the timer migrates to another P via work-stealing, fires there, sends on a channel whose receiver is on a third P. Three cache transfers per tick.

For most workloads this is irrelevant. For high-frequency tickers on busy systems, locality matters and the work-stealing aggressiveness can be tuned (though it is rarely necessary).

### Affinity and Pinning

If you want to keep a ticker's fire path on a specific P, you have limited options:

- `runtime.LockOSThread()` pins a goroutine to an OS thread (M), which usually corresponds to a P, but not always.
- The runtime does not expose direct P assignment.
- Work-stealing may move the timer regardless.

For most code, accept the locality the runtime provides. For latency-critical code, use `runtime.LockOSThread` on the consumer and rely on the fact that the consumer's P is also typically the firing P.

### Wake-Up Path Detailed

When `sendTime` performs `ch <- Now()`:

1. The channel's internal lock is acquired.
2. If a receiver is parked on the channel, it is dequeued.
3. The value is copied into the receiver's stack frame (if direct hand-off) or into the channel's buffer.
4. The receiver's goroutine is marked runnable.
5. The runtime schedules the receiver: either onto the calling P's run queue or onto the global queue, depending on policy.
6. The channel lock is released.

This is all sub-microsecond on modern hardware. The biggest variable cost is the lock acquisition under contention.

### Lock Contention on the Channel

If many goroutines are racing on `t.C`, the channel's internal lock can become contended. For ticker channels, this is unusual — typically one consumer per ticker.

If you fan out a ticker to many consumers via copying, you would use a separate broadcaster pattern (sync.Cond or a slice of channels with a sender goroutine), not direct multi-consumer access to `t.C`.

### When the Send Drops

Pre-1.23: if the consumer is slower than the period, the buffer is full when the send arrives. The select's `default` case is taken; no error, no log. The runtime keeps firing the ticker; the user observes a slower effective rate.

Post-1.23: the send overwrites. The consumer always sees the most recent tick.

Either way, the runtime does not signal "I dropped a tick" to user code. The only signal is the absence of a tick at the expected time.

### Memory Order Guarantees

The Go memory model establishes happens-before for channel ops:

- The runtime's tick at time `when` happens before the receive of that tick by the consumer.
- The data state of the runtime at time `when` (any variables written before that nanosecond) happens before the consumer reads them after the receive.

In practice, this means: if you write `lastTickAt = time.Now()` somewhere observable, and then receive from `t.C`, the read sees the write. For state shared across the tick path, the happens-before holds.

### Tracing a Single Tick Through the Runtime

Walk through a single fire in detail. Setup: a 1-second ticker constructed on the goroutine running on P0. The consumer parks on `<-t.C`.

T = 0:
- User code calls `time.NewTicker(time.Second)` on G1 running on P0.
- `time.NewTicker` allocates a `*Ticker`, sets `t.r.when = nanotime() + 1e9`, calls `runtime.startTimer(&t.r)`.
- `startTimer` acquires P0's timer lock, appends to the heap, sift-up, releases lock.
- Control returns to user; G1 reaches `<-t.C` and parks.

T = 0.5:
- Some other goroutine runs on P0; the scheduler's `findrunnable` checks the timer heap; `when = 1.0`, not yet; continues.

T = 1.0 (approximately):
- The scheduler's `findrunnable` checks the heap; the head's `when` is now <= `nanotime()`.
- The runtime acquires the lock, pops the head, transitions to `timerRunning`, releases the lock.
- The runtime calls `t.r.f(t.r.arg, t.r.seq, nanotime())`. For tickers, `f` is `sendTime`.
- `sendTime` casts `arg` to `chan Time`, performs `select { case ch <- Now(): default: }`. The buffer is empty, so the send succeeds.
- The send wakes G1: G1's `chan recv` discovers a value, the goroutine transitions from `Gwaiting` to `Grunnable`.
- The runtime re-acquires the lock, updates `t.r.when = old_when + period`, transitions to `timerWaiting`, pushes back into the heap.
- Control returns to the scheduler's main loop; G1 is in the run queue.

T = 1.0 + ε:
- The scheduler picks G1 from the run queue. G1 resumes after `<-t.C` with the new tick.
- G1 runs its handler.

The total time from `when` to user code resuming is on the order of microseconds, dominated by scheduler dispatch and cache effects.

### When Multiple Ps Are Involved

If G1 is parked on `<-t.C` on a different P (G1 last ran on P1), the sequence differs slightly:

- P0 fires the timer, calls `sendTime`, the send wakes G1. G1's "running P" is P1.
- The runtime checks: is P1 available? If yes, G1 is added to P1's local run queue. If no, G1 goes to the global run queue.
- If G1 is on P1's local queue, P1's scheduler picks it up on its next dispatch.
- If G1 is on the global queue, any P that exhausts its local queue takes it.

The cross-P case adds maybe a microsecond of latency in the wake-up path.

### Locks Held During Send

The runtime's timer lock is released *before* `sendTime` is called. So the channel send happens with no timer lock held. This is intentional: the channel send may block briefly (well, no, it's a non-blocking select), but the design assumes the timer lock should not be held across user-supplied callbacks. Even though `sendTime` is an internal callback, the convention applies.

For `AfterFunc`, where the callback is user code that may run arbitrarily long, this is essential — holding the timer lock across user code would block all timer operations on that P.

### Implications for Backpressure

If you wrote a custom `f` that holds the lock (you can't, since timers' `f` is set by the runtime), you'd block the P's timer subsystem. The standard library's `sendTime` does not hold any lock and is fast.

The fire path is unblockable from user code. Tickers fire when the runtime decides, independent of user-side backpressure. The user-side "backpressure" is the dropped tick.

---

## The asyncpreempt and Timer Interaction

Go 1.14 introduced asynchronous preemption. The scheduler can interrupt a goroutine even if it does not yield voluntarily. This affects timers in subtle ways.

### How Asyncpreempt Works

A goroutine running tight CPU-bound code (no function calls, no channel ops) used to be uninterruptible. The 1.14 change adds signal-based preemption: every ~10ms the runtime checks if a goroutine should yield, and sends it a signal that triggers a soft-preempt.

### Why This Matters for Timers

Pre-1.14, a tight goroutine could starve the timer subsystem if it never yielded. Tickers would fire late or not at all (because no P was free to fire them).

Post-1.14, the goroutine is preempted, the P gets a chance to fire its timers, and the ticker fires on time.

### A Pathological Pre-1.14 Example

```go
go func() {
    for {
        x++ // tight loop, no yield
    }
}()
t := time.NewTicker(time.Second)
for {
    <-t.C // may fire late or never
    fmt.Println("tick")
}
```

Pre-1.14 on a single-P configuration, the ticker might never fire. The runtime had no way to preempt the tight loop. Post-1.14, asyncpreempt kicks in.

### Implications for User Code

You no longer need to defensively `runtime.Gosched()` in CPU-bound code to "let timers fire." The runtime handles preemption. This is one of the under-appreciated wins of Go 1.14.

The corollary: tickers in Go 1.14+ are more predictable than in earlier versions. Code that worked in Go 1.13 with tight loops may now fire ticks at unexpected moments due to asyncpreempt; usually this is fine and goes unnoticed.

---

## Garbage Collection of Timers

Pre-1.23 ticker GC behaviour: the runtime heap held the timer entry; the timer entry held the channel; the channel was referenced from the ticker; the ticker was referenced by user code. Removing user references did not free the ticker until the heap entry was removed by `Stop`.

Result: forgetting `Stop` was a permanent leak.

Post-1.23: the runtime uses weak pointers (or a finalizer-like mechanism) to track tickers. When user references vanish, the GC eventually:

1. Detects the ticker is unreachable.
2. Schedules its finalisation.
3. The finaliser stops the timer and frees the heap entry.

The "eventually" is unspecified. Typical GC cycles run every few seconds in steady-state services. A leaked ticker may continue to fire for many seconds before being collected.

### Why Not Rely on GC

- The GC's timing is not predictable. For latency-sensitive code, the post-Stop quiescence is what matters; GC alone is too slow.
- Pre-1.23 code does not benefit. If your code runs on older Go, GC won't save you.
- Code that depends on GC for correctness is fragile and hard to reason about.

So: `Stop` remains mandatory. The 1.23 change is a defensive net, not a permission slip.

### What the GC Sees

The GC's root set includes all live goroutine stacks, globals, and certain runtime structures. A ticker is reachable if:

- The user has a reference to `*time.Ticker` in a live variable.
- A goroutine is parked in `<-t.C` (the channel is reachable via the goroutine's stack).
- The runtime's timer heap holds the timer.

The last condition is the killer pre-1.23: even without user references or parked receivers, the heap holds the timer. In 1.23, the heap entry can be cleared when user references vanish.

### Finalizers Are Not Used Directly

The runtime does not literally call `runtime.SetFinalizer` on tickers — that has overheads. Instead, the timer subsystem has internal bookkeeping that lets it know which tickers are still user-referenced.

The exact mechanism is internal and may change. The user-visible contract is what matters: `Stop` works, and post-1.23 forgetting `Stop` is recoverable.

### Implications for Test Suites

If your test suite frequently constructs tickers without Stop (in code under test that has a bug), pre-1.23 your test process accumulates timers. Post-1.23 the leaks self-clean. Either way, write the test to fail on leaks via `goleak`.

---

## time.After Versus NewTimer Allocation Cost

`time.After(d)` is implemented as:

```go
func After(d Duration) <-chan Time {
    return NewTimer(d).C
}
```

Each call allocates a fresh `time.Timer` and exposes its channel. The Timer is not explicitly stopped; it fires once and is then unreferenced.

### The Allocation

Each `time.After` allocates:

- A `time.Timer` struct.
- A `runtime.timer` struct.
- A buffered channel.

Total: ~200 bytes. On Go 1.21, profiles often show `time.After` near the top of allocation-heavy services.

### The Liveness Problem (Pre-1.23)

Pre-1.23, the timer must remain alive until it fires, because the runtime heap holds a reference to it. So even after the user discards the channel reference, the heap holds the timer for `d`. For a 1-minute `time.After` called in a 1-second loop, you accumulate 60 alive timers at any given moment.

In Go 1.23 this changed (timers without user references can be GC'd). For most code, the in-flight timer lifetime is short, so the savings are marginal.

### NewTimer + Reset Versus After

For a loop, the cheaper shape is one `time.NewTimer`, reset per iteration:

```go
t := time.NewTimer(d)
defer t.Stop()
for {
    select {
    case <-ctx.Done():
        return
    case <-t.C:
        work()
    }
    if !t.Stop() {
        select {
        case <-t.C:
        default:
        }
    }
    t.Reset(d)
}
```

This is verbose but allocation-free per iteration. For high-frequency loops, the savings add up.

### When time.After Is Acceptable

- The call is rare (e.g. one per request, not one per microsecond).
- The duration is short (the alive-timer window is brief).
- Readability matters more than allocation count.

For most service code, `time.After` is fine. For hot paths in latency-sensitive code, profile first and consider `NewTimer`+`Reset` or a dedicated ticker.

### A Concrete Benchmark

```go
func BenchmarkAfter(b *testing.B) {
    b.ReportAllocs()
    for i := 0; i < b.N; i++ {
        select {
        case <-time.After(time.Microsecond):
        }
    }
}

func BenchmarkNewTimer(b *testing.B) {
    b.ReportAllocs()
    t := time.NewTimer(time.Microsecond)
    defer t.Stop()
    for i := 0; i < b.N; i++ {
        select {
        case <-t.C:
        }
        t.Reset(time.Microsecond)
    }
}

func BenchmarkTicker(b *testing.B) {
    b.ReportAllocs()
    t := time.NewTicker(time.Microsecond)
    defer t.Stop()
    for i := 0; i < b.N; i++ {
        <-t.C
    }
}
```

On Go 1.22, x86_64, idle machine (approximate):

| Benchmark | ns/op | B/op | allocs/op |
|---|---|---|---|
| After | 11000 | 192 | 3 |
| NewTimer+Reset | 10500 | 0 | 0 |
| Ticker | 10300 | 0 | 0 |

`time.After` allocates 3x per iteration; the others don't. The difference is small in nanoseconds but compounds at scale.

### The Hidden Cost of time.After Pre-1.23

Beyond the allocation visible in `B/op`, pre-1.23 `time.After` has a subtler cost: each timer remains in the runtime's per-P heap for its full duration, even if the caller stopped waiting (e.g., the surrounding select chose a different case).

Consider:

```go
for {
    select {
    case <-ctx.Done():
        return
    case <-time.After(time.Hour):
        // happens once per hour
    case <-fastEvent:
        // happens dozens of times per second
    }
}
```

Each iteration creates a `time.After(time.Hour)` timer. The fast event triggers, the loop iterates, and a new `time.After(time.Hour)` is created. The previous one is now unreferenced from user code — but the runtime's heap still holds it.

After running for a minute with hundreds of fast events per second, the heap holds thousands of one-hour timers, each waiting an hour to expire and be removed. The memory and heap-walk cost grow.

The fix in this pattern is to hoist the `time.After` out:

```go
t := time.NewTimer(time.Hour)
defer t.Stop()
for {
    select {
    case <-ctx.Done():
        return
    case <-t.C:
        // happens once per hour
        t.Reset(time.Hour)
    case <-fastEvent:
    }
}
```

Now there's only one timer ever. Hour-long, but one. The fast event does not create new timers.

This pre-1.23 leak shape is exactly what Go 1.23's GC-of-unreferenced-timers fixes: an abandoned `time.After` timer no longer occupies heap permanently. But again, your code may run on 1.20–1.22, and even on 1.23 the cleanup is eventual, not immediate.

### Stop Behaviour of time.After

`time.After` does not return the timer, so you cannot call `Stop` on it. Once started, it runs to completion (or is GC'd post-1.23).

The whole reason `time.After` exists is convenience — you write `<-time.After(d)` instead of `t := time.NewTimer(d); <-t.C`. The convenience costs you cancel-ability.

For non-cancellable, one-shot delays in non-loop code, `time.After` is fine. In loops, or when you might want to cancel, use `time.NewTimer`.

### Comparing Real-World Profiles

A web service that uses `time.After` extensively (e.g., per-request timeout via `time.After` rather than `context.WithTimeout`) frequently shows `time.startTimer` in the top of `pprof -alloc_objects` output. After migrating to `context.WithTimeout`, the allocations drop and GC pressure decreases.

Even on Go 1.23 where the unreferenced-timer leak is GC'd, the allocation itself is real and avoidable.

---

## Heap Operations Complexity Analysis

The runtime's per-P timer heap is a 4-heap. Operations:

- **AddTimer**: O(log_4 N) = O(log N / 2) sift-up.
- **DeleteTimer (CAS-only)**: O(1) — just marks state.
- **DeleteTimer (heap cleanup)**: O(log N) amortised.
- **MoveTimer (Reset)**: O(log N) if heap position changes; O(1) if status-only.
- **PopMin (check next timer)**: O(1) peek; O(log N) re-heapify if removed.

For N = 10 000 timers per P, each operation is roughly 14 levels in a binary heap, or 7 in a 4-heap. With cache locality, this is dozens of nanoseconds.

### Heap Operations Per Tick

Each tick on a recurring ticker does:

- Pop from heap (O(log N)).
- Run callback (O(1) + channel send overhead).
- Re-insert with new `when` (O(log N)).

So each tick is O(log N) heap work. For 10 000 timers, ~14 comparisons per fire. At 1000 fires per second, ~14 000 comparisons per second per P. Trivial.

### Heap Growth

Pre-1.14: the global heap could grow to millions of entries in unusual workloads. Heap operations dominated CPU.

Post-1.14: per-P heaps cap practical sizes. If you have 100 000 tickers and 8 Ps, each P holds ~12 500. Operations stay sub-microsecond.

If you create timers faster than they fire (uncommon but possible with `time.After` in a tight loop), the heap can grow unboundedly until GC or `Stop` collects them.

### Heap Implementation Notes

The 4-heap structure is implemented in `runtime/time.go`. The parent of index `i` is `(i-1)/4`; the children are `4i+1, 4i+2, 4i+3, 4i+4`. Sift-down compares with the smallest child.

Cache layout: a 4-heap with 64-bit fields fits 16 entries per cache line (with each entry being a pointer or small struct, 8 bytes). A parent's four children fit in one cache line — sift-down accesses one line per level.

### Sift-Up

When a new timer is added (or an existing timer's `when` is reduced), it needs to "bubble up" toward the root:

```go
func siftUp(heap []*timer, i int) {
    for i > 0 {
        parent := (i - 1) / 4
        if heap[parent].when <= heap[i].when {
            break
        }
        heap[parent], heap[i] = heap[i], heap[parent]
        i = parent
    }
}
```

Comparison count: at most log_4(N) — for N = 10 000, four levels deep.

### Sift-Down

When the root is removed (after firing), the last element is moved to the root and "bubbles down":

```go
func siftDown(heap []*timer, i, n int) {
    for {
        c1 := 4*i + 1
        if c1 >= n {
            return
        }
        // find smallest child
        smallest := c1
        for j := c1 + 1; j < c1+4 && j < n; j++ {
            if heap[j].when < heap[smallest].when {
                smallest = j
            }
        }
        if heap[i].when <= heap[smallest].when {
            return
        }
        heap[i], heap[smallest] = heap[smallest], heap[i]
        i = smallest
    }
}
```

Each level requires up to 4 comparisons to find the smallest child. At log_4(N) levels and 4 comparisons each: ~14 comparisons for N = 10 000.

### Lazy Deletion Cleanup

The pre-1.23 lazy-deletion strategy means the heap holds tombstones (entries marked `timerDeleted`). Over time these accumulate. The runtime periodically cleans them up — when at least a quarter of the heap is tombstones, a full sweep removes them.

This means the *physical* heap size can be larger than the *logical* timer count. Memory usage can be moderately wasteful in heavy-Reset/Stop workloads.

Post-1.23 uses different cleanup: the lock-protected slice can be compacted more eagerly when entries are removed.

### Edge Case: Zero-Size Heap

If a P has no timers, the heap is empty. `checkTimers` is a no-op. No memory cost.

### Edge Case: Single-Element Heap

A heap with one element fires at exactly its `when`. No comparisons needed. The fire path optimises for this case.

### Edge Case: Many Tickers, Same Period

If many tickers have the same period, they tend to fire in waves — each firing is one heap pop, callback, and reinsert. Reinsertion places them back near the head (since their new `when` is similar). This creates a "treadmill" pattern that is efficient.

But: each fire still allocates the channel send and wakes the receiver. The runtime fires them in sequence (single-threaded per P). For 1000 tickers all firing at the same instant, that's 1000 fires on one P, which takes milliseconds.

To distribute load, jitter the periods slightly so fires interleave rather than burst.

---

## Tickers Under Heavy Load

What happens when a process has many tickers and the system is heavily loaded?

### Scenario 1: 100 000 Tickers, Idle Workload

The Ps' heaps hold ~12 500 entries each (on 8 Ps). Each fire is sub-microsecond. The total fire rate is bounded by the slowest ticker × count; assuming 1-second periods, the system fires ~100 000 times per second. At ~1us per fire that is 100ms of CPU per second, or 12.5% on each of 8 cores. Not great, not terrible.

### Scenario 2: 100 000 Tickers, CPU-Bound Workload

The Ps are busy running CPU-bound goroutines. `findrunnable` is called less frequently. Tickers fire late. The latency from `when` to receive may grow to tens of milliseconds.

If the work attached to each tick is fast, this is fine. If the work cascades (each tick spawns goroutines that contend for Ps), the system can fall behind in waves.

### Scenario 3: 100 000 Tickers, I/O-Bound Workload

Ps are mostly idle (goroutines parked in `<-`netpoll`). `findrunnable` runs frequently. Tickers fire on time.

This is the friendliest scenario. Tickers in I/O-heavy services rarely cause problems.

### Scenario 4: Catastrophic — Tickers Outpace Fires

If the periods are short (sub-millisecond) and you have many tickers, the system may not keep up. Each P's heap grows because `findrunnable` cannot drain it fast enough. Memory grows. Eventually OOM.

Symptoms:

- `runtime.NumGoroutine` rises.
- `runtime/trace` shows scheduler at 100% utilisation.
- `pprof` shows time in `runtime.runtimer` and `runtime.findrunnable`.

Solution: longer periods, fewer tickers, or batched processing.

### Realistic Thresholds

A modern server can comfortably handle 10 000 active tickers with 1-second periods. 100 000 tickers strains things but is feasible. A million tickers is over the practical limit — refactor to coalesce.

### How to Test High Counts

A reproducible benchmark for many tickers:

```go
func BenchmarkManyTickers(b *testing.B) {
    for _, n := range []int{100, 1000, 10000, 100000} {
        b.Run(fmt.Sprintf("n=%d", n), func(b *testing.B) {
            tickers := make([]*time.Ticker, n)
            for i := range tickers {
                tickers[i] = time.NewTicker(time.Second)
            }
            defer func() {
                for _, t := range tickers {
                    t.Stop()
                }
            }()
            b.ResetTimer()
            for i := 0; i < b.N; i++ {
                select {
                case <-tickers[0].C:
                }
            }
        })
    }
}
```

This measures the cost of receiving on one ticker while N total tickers are alive. As N grows, the cost per receive should rise modestly (more heap walking).

### Sample Numbers

On Go 1.22, x86_64 (4-core, 32GB):

| n | ns/op |
|---|---|
| 100 | 1100 |
| 1 000 | 1400 |
| 10 000 | 2200 |
| 100 000 | 6800 |

The growth is sub-linear in N (heap walk is log N). At 100k tickers, each receive costs ~7us. Over millions of receives per second total across the ticker fleet, the system is using single-digit milliseconds of CPU. Acceptable for most services.

### The Wake-Up Cost Dominates

At low N, the wake-up cost (channel send + scheduler dispatch) dominates. At high N, the heap walk becomes visible. Even at 100k, the total cost is microseconds per fire — not a problem for typical periods.

### Per-Goroutine Memory

If each ticker is owned by its own goroutine (typical pattern), each goroutine costs ~2KB of stack. 100k goroutines = 200MB of stack space. This may dominate the per-timer cost.

To avoid: coalesce many tickers into one, or use callback-based scheduling (`time.AfterFunc`) which does not need a dedicated consumer.

---

## Performance Comparison Microbenchmarks

A small benchmark suite that I find informative. Code:

```go
package timerbench

import (
    "context"
    "testing"
    "time"
)

func BenchmarkTickerHotPath(b *testing.B) {
    t := time.NewTicker(time.Microsecond)
    defer t.Stop()
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        <-t.C
    }
}

func BenchmarkTickerWithSelect(b *testing.B) {
    t := time.NewTicker(time.Microsecond)
    defer t.Stop()
    ctx := context.Background()
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        select {
        case <-ctx.Done():
            return
        case <-t.C:
        }
    }
}

func BenchmarkTimeAfter(b *testing.B) {
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        <-time.After(time.Microsecond)
    }
}

func BenchmarkTimerReuse(b *testing.B) {
    t := time.NewTimer(time.Microsecond)
    defer t.Stop()
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        <-t.C
        t.Reset(time.Microsecond)
    }
}

func BenchmarkTickerReset(b *testing.B) {
    t := time.NewTicker(time.Microsecond)
    defer t.Stop()
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        t.Reset(time.Microsecond)
    }
}

func BenchmarkTickerStartStop(b *testing.B) {
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        t := time.NewTicker(time.Microsecond)
        t.Stop()
    }
}
```

Indicative numbers on Go 1.22, AMD Zen 3:

| Benchmark | ns/op | Notes |
|---|---|---|
| TickerHotPath | 1040 | one receive, sustained |
| TickerWithSelect | 1080 | select adds ~40ns |
| TimeAfter | 1130 | allocates per iteration |
| TimerReuse | 1050 | NewTimer + Reset, no alloc |
| TickerReset | 200 | Reset only, no fire |
| TickerStartStop | 380 | construct + stop |

Take-aways:

- Sustained tickers in a loop run at ~1us per fire on a 1-microsecond period. That is the floor — most of the time is in the channel send and scheduler wake.
- `time.After` is ~10% slower due to allocation. On 64-bit ARM and Apple Silicon, the gap is smaller; on older x86, larger.
- Construct+Stop is ~380ns. If you create a million tickers per second, that's ~380ms of CPU per second — visible. Refactor.
- Reset alone (no fire) is ~200ns. The runtime's heap op + lock acquisition.

Note: these are *microbenchmarks*. Real code includes work between ticks; the relative cost of the ticker is usually negligible.

---

## Interaction with GOMAXPROCS

`GOMAXPROCS` is the number of Ps the runtime uses. Each P has its own timer heap. The implications:

- More Ps = smaller per-P heaps. Operations are faster per timer.
- More Ps = more cross-P traffic when tickers migrate.
- More Ps = more memory (each P's heap allocates a slice).

For most services, `GOMAXPROCS` defaults to `runtime.NumCPU()`. This is a reasonable trade-off.

### Setting GOMAXPROCS for Many-Ticker Workloads

If your service has millions of timers, more Ps reduce per-heap depth. But more Ps also mean more scheduler overhead in steady state.

Empirically, services with very high timer counts (10k+ active) benefit from `GOMAXPROCS=N_cores` where N_cores is the actual physical core count (not the hyperthread count). Hyperthreads share L1 cache; running both threads on the same core does not double timer throughput.

### Setting GOMAXPROCS=1

Single-P. All timers in one heap. No migration, no cross-P traffic. Simple but limited.

For tiny services (script-like, single-purpose), this is fine. For anything with concurrent I/O, multi-P is essential.

### GOMAXPROCS Changes at Runtime

`runtime.GOMAXPROCS(n)` is callable to change the P count. Tickers do not migrate automatically when Ps are added — they stay on their original P unless work-stealing kicks in.

If you spin down a P (decrease GOMAXPROCS), the timers on that P are redistributed during cleanup.

In practice, you set GOMAXPROCS at startup and leave it.

---

## Locking Inside the Runtime Timer Code

The runtime's timer code has its own locks. They are not user-visible but they affect performance.

### Per-P Timer Lock

Each P has a `timersLock`. Operations that modify the heap (add, remove, sift) acquire it.

For most operations, the goroutine doing the operation is *running on* the owning P. In that case, the lock acquire is uncontested — fast.

When `Reset` is called from a different P (the timer was constructed elsewhere), the calling P must acquire the timer's owning P's lock. This is contested if the owning P is busy firing.

Pre-1.23 used CAS-on-status to avoid this lock in many cases. Post-1.23 uses the lock universally for simplicity.

### Lock Hierarchy

The runtime's lock hierarchy is documented (loosely) in `runtime/proc.go`. Timer locks must be acquired *after* scheduler locks. Violating the order can deadlock; the runtime asserts the ordering in debug builds.

User code does not see this; it matters only if you read the runtime source.

### Contention Symptoms

If `pprof` shows time in `runtime.runtimer` or `runtime.checkTimers`, you may have heap-walk overhead. If it shows time in `runtime.lock2` from a timer call site, you may have lock contention. The latter is rare in practice.

---

## Designing Custom Timer Wheels

For workloads where the standard library's ticker is the wrong abstraction — too many timers, too varied periods, too much per-timer cost — a custom timer wheel can outperform.

### What Is a Timer Wheel

A timer wheel is a circular array indexed by time modulo some bucket size. Each bucket holds a list of timers due in that bucket's time window. To advance the wheel, you increment the "current time" cursor and process the current bucket.

Insertion is O(1) (compute the bucket from the deadline, append to its list). Firing is O(K) where K is the number of timers in the current bucket. Deletion is O(1) (remove from list).

For workloads with many short-lived timers all within a similar time window, this is much faster than a heap.

### When To Use

Build a custom wheel when:

- You have hundreds of thousands of concurrent timers.
- The timer periods are all within a known range (a small multiple of the bucket size).
- The standard library's runtime overhead is showing up in CPU profiles.

Most workloads do not meet these criteria. The standard library is good enough.

### Hierarchical Timing Wheels

For timers across a wide range of periods (sub-second to days), a single wheel does not work. The hierarchical timing wheel (HTW) layers multiple wheels at different granularities. Linux kernel and many network systems use HTWs.

Implementing one in Go is feasible but rare. Libraries: [`github.com/RussellLuo/timingwheel`](https://github.com/RussellLuo/timingwheel) is well-tested.

### Performance Profile

A HTW typically has:

- O(1) insert.
- O(1) per tick when no timers expire.
- O(K) per tick when K timers expire.
- Lower memory per timer than a heap (no node pointers).

For 1 million timers with 1-second median period and 1ms bucket, the wheel uses ~1MB and runs comfortably on a single CPU. The standard library's heap-based approach would struggle at this scale.

### Caveat

A wheel does not give you per-timer cancellation as cheaply as a heap. Cancellation requires removing from a linked list, which means storing list pointers in each timer.

For our purposes: be aware that wheels exist; do not reach for them unless profiling clearly shows the heap-based runtime is the bottleneck.

### A Sketch of a Simple Wheel

For pedagogy, a minimal single-level wheel:

```go
type Wheel struct {
    mu       sync.Mutex
    buckets  [][]*WheelTimer
    bucketDur time.Duration
    cur      int
    now      time.Time
}

type WheelTimer struct {
    deadline time.Time
    fn       func()
    bucket   int
    idx      int
}

func NewWheel(buckets int, bucketDur time.Duration) *Wheel {
    return &Wheel{
        buckets:   make([][]*WheelTimer, buckets),
        bucketDur: bucketDur,
        now:       time.Now(),
    }
}

func (w *Wheel) Add(d time.Duration, fn func()) *WheelTimer {
    w.mu.Lock()
    defer w.mu.Unlock()
    bucketOff := int(d/w.bucketDur) + 1
    if bucketOff >= len(w.buckets) {
        bucketOff = len(w.buckets) - 1
    }
    bucket := (w.cur + bucketOff) % len(w.buckets)
    t := &WheelTimer{
        deadline: w.now.Add(d),
        fn:       fn,
        bucket:   bucket,
        idx:      len(w.buckets[bucket]),
    }
    w.buckets[bucket] = append(w.buckets[bucket], t)
    return t
}

func (w *Wheel) Tick() {
    w.mu.Lock()
    w.now = w.now.Add(w.bucketDur)
    w.cur = (w.cur + 1) % len(w.buckets)
    fires := w.buckets[w.cur]
    w.buckets[w.cur] = nil
    w.mu.Unlock()
    for _, t := range fires {
        t.fn()
    }
}

func (w *Wheel) Remove(t *WheelTimer) {
    w.mu.Lock()
    defer w.mu.Unlock()
    if t.idx < len(w.buckets[t.bucket]) && w.buckets[t.bucket][t.idx] == t {
        // swap-remove
        last := len(w.buckets[t.bucket]) - 1
        w.buckets[t.bucket][t.idx] = w.buckets[t.bucket][last]
        w.buckets[t.bucket][t.idx].idx = t.idx
        w.buckets[t.bucket] = w.buckets[t.bucket][:last]
    }
}
```

`Tick` advances the wheel by one bucket duration. To drive `Tick`, you use a single `time.Ticker` with period equal to `bucketDur`. Everything else inside the wheel.

Limitations: timers further out than `len(buckets) * bucketDur` are clamped to the last bucket and fire late. For typical 5-minute windows with 1-second buckets, you have 300 buckets — plenty for "timers expiring in the next 5 minutes."

For longer timers, use a hierarchical wheel: the slow wheel's buckets each hold a fast wheel.

### When You Should Not Build This

Most services have hundreds, not millions, of timers. The runtime's heap handles this easily. The wheel approach pays off when:

- Timer counts are in the tens of thousands or more.
- Most timers expire on schedule (cancellation rate is low).
- The precision allowed by `bucketDur` is acceptable.

If you build one, instrument it heavily — fan-out latency, bucket size distribution, cancel rate.

---

## Edge Cases You Will Encounter in Production

A grab-bag of real production scenarios.

### Edge Case 1: Ticker in an HTTP Handler

```go
func handler(w http.ResponseWriter, r *http.Request) {
    t := time.NewTicker(time.Second)
    defer t.Stop()
    for i := 0; i < 5; i++ {
        select {
        case <-r.Context().Done():
            return
        case <-t.C:
            fmt.Fprintf(w, "tick %d\n", i)
            if f, ok := w.(http.Flusher); ok {
                f.Flush()
            }
        }
    }
}
```

A streaming response that sends one chunk per second for five seconds. Cancelled if the client disconnects.

This works. Edge case: if the client connects and immediately disconnects, the handler exits in microseconds, the ticker fires nothing, `Stop` runs.

### Edge Case 2: Ticker in a Server Shutdown

```go
type Server struct {
    cancel  context.CancelFunc
    ticker  *time.Ticker
    done    chan struct{}
}

func (s *Server) Start(parent context.Context) {
    ctx, cancel := context.WithCancel(parent)
    s.cancel = cancel
    s.ticker = time.NewTicker(time.Second)
    s.done = make(chan struct{})
    go s.run(ctx)
}

func (s *Server) Stop(timeout time.Duration) error {
    s.cancel()
    select {
    case <-s.done:
        return nil
    case <-time.After(timeout):
        return errors.New("shutdown timeout")
    }
}
```

`Stop` cancels and waits. If the loop exits within `timeout`, return nil. Otherwise, error.

Subtle: if the loop hangs (e.g. on a long downstream call), `time.After` fires the timeout. The loop's goroutine is leaked, but the server's API returned cleanly. Forensics: where is the goroutine?

### Edge Case 3: Goroutine Leak via Forgotten Stop

```go
func loop() {
    t := time.NewTicker(time.Second)
    for range t.C {
        work()
    }
}
```

Called from `main`. No exit path. The loop runs forever; the ticker fires forever; no leak yet (in the sense that nothing accumulates). Then refactor: someone wraps `loop()` in `go loop()` to spawn it as a background. Now main returns, `loop` continues, no problem yet.

Then refactor again: `loop` is called per-request inside an HTTP handler. Each request spawns a goroutine that never returns. Within minutes, the process has thousands of leaked goroutines.

The original `loop()` was the bug — the missing `Stop` and `ctx` parameter. The first refactor was fine. The second exposed the bug.

Lesson: write `loop` correctly from the start, even if today's caller is `main`.

### Edge Case 4: Reset Called on Nil Ticker

```go
var t *time.Ticker
go func() {
    time.Sleep(time.Second)
    t = time.NewTicker(time.Second) // assign late
}()
t.Reset(2 * time.Second) // nil pointer
```

Race + nil deref. Initialise tickers eagerly, or guard reads with a sync.Once.

### Edge Case 5: Stop Called From a Finaliser

If you set a finaliser on a struct that holds a ticker, the finaliser may call `Stop`. Finalisers run in the GC goroutine, which is special — calling some runtime functions from a finaliser is unsafe.

`Stop` itself is safe to call from a finaliser. But avoid this pattern: rely on explicit `Close` methods, not GC finalisers.

### Edge Case 6: Tickers in Closure Captures

```go
for i := 0; i < 5; i++ {
    go func() {
        t := time.NewTicker(time.Second)
        defer t.Stop()
        for {
            <-t.C
            fmt.Println(i) // captures loop variable
        }
    }()
}
```

Two bugs: the loop variable `i` is captured by reference (pre-Go-1.22), and the goroutine has no exit path. Fixes:

- Capture `i` by value: `func(i int) { ... }(i)`.
- Add a `ctx` parameter.
- `defer t.Stop()` (already there).

Go 1.22 fixed the loop-variable capture; if your `go.mod` says 1.22+, the capture is per-iteration.

### Edge Case 7: Period Drift From Slow Handler

A 1-second ticker; the handler takes 0.5s. The ticker fires at 1.0, 2.0, 3.0, ... The handler runs from 1.0–1.5, 2.0–2.5, 3.0–3.5. No drift, no drops.

The handler takes 0.9s. Ticker still fires at 1.0, 2.0, 3.0. Handler runs 1.0–1.9, 2.0–2.9, 3.0–3.9. Still no drift. The next fire happens immediately after the handler ends, since the receive happens *first* and then the work runs.

The handler takes 1.1s. Ticker fires at 1.0; handler runs 1.0–2.1. Meanwhile the runtime tried to fire at 2.0 — the channel was empty (the consumer was busy), but the buffer absorbed one. At 2.1 the handler ends; receive gets the 2.0 tick immediately; handler runs 2.1–3.2. At 3.0 the runtime tried to fire but the buffer (with the 2.0 tick) was full — drop. Then 3.2 receive ... wait, no, the 2.0 tick was consumed already.

The exact sequencing depends on implementation. The take-away: handler longer than period = dropped ticks.

### Edge Case 8: Channel Close Versus Stop

```go
t := time.NewTicker(time.Second)
close(t.C) // does not compile? actually does compile - t.C is <-chan
```

Actually, `t.C` is `chan time.Time` (bidirectional) in source but exposed as `<-chan time.Time` (receive-only) via the field tag. You cannot close `<-chan`. Compilation fails.

If you try to wrap and close, the receiver sees a zero value and `ok == false`. The runtime's `sendTime` then panics on the next fire (send on closed channel). Do not try to close `t.C`.

### Edge Case 9: Ticker As Map Key

```go
m := map[*time.Ticker]struct{}{}
t := time.NewTicker(time.Second)
m[t] = struct{}{}
```

Tickers are pointer-typed, so they work as map keys. The hash is by pointer identity. Useful for "tickers I should stop on shutdown."

### Edge Case 10: Ticker That Outlives Its Owner

```go
type Component struct {
    t *time.Ticker
}

func New() *Component {
    c := &Component{t: time.NewTicker(time.Second)}
    runtime.SetFinalizer(c, func(c *Component) {
        c.t.Stop()
    })
    return c
}
```

The finalizer Stops the ticker when `c` is collected. Pre-1.23, this is the best you can do without explicit Close. Post-1.23, the GC handles it without the finalizer.

But: finalizers run on the GC goroutine, which has constraints. Avoid finalizers if you can; provide an explicit Close.

### Edge Case 11: Time Travel via Reset

```go
t := time.NewTicker(time.Second)
// ... fires at 1.0, 2.0 ...
t.Reset(time.Millisecond)
// next fire is at 2.001 (Reset_call_time + 1ms), not 3.0
```

`Reset` schedules relative to "now," not relative to the prior cadence. The ticker effectively jumps forward (or backward) in its schedule.

If the consumer is reading expecting "1 tick per second," they observe an unexpected burst of fast ticks. Document this behaviour or guard against unexpected Reset.

### Edge Case 12: Concurrent NewTicker

```go
var wg sync.WaitGroup
for i := 0; i < 100; i++ {
    wg.Add(1)
    go func() {
        defer wg.Done()
        t := time.NewTicker(time.Second)
        defer t.Stop()
        <-t.C
    }()
}
wg.Wait()
```

100 goroutines, each creates and stops a ticker. The runtime serialises heap operations on the calling P; cross-P additions go to the caller's P. Throughput is acceptable on modern hardware (millions of Add+Stop per second across cores).

The hot path is: lock P's timer mutex, heap add, unlock, then the receive parks, then `sendTime` fires (acquiring the lock again), then unlock. For a 1-second period in a 1-second test, most goroutines complete their fire before the test ends.

### Edge Case 13: Ticker With Zero Period via Atomic Compute

```go
t := time.NewTicker(time.Second)
go func() {
    for {
        t.Reset(0) // panic
    }
}()
```

`Reset(0)` panics. The panic propagates up the goroutine; if the goroutine is the main thread, the program crashes. Always sanity-check duration.

### Edge Case 14: Ticker in a Pool

```go
pool := sync.Pool{
    New: func() any {
        return time.NewTicker(time.Hour)
    },
}
```

Tickers in a pool. When taken from the pool, `Reset` to the desired period. When returned, `Stop` and `Reset` to a placeholder. This avoids constructing many tickers in churn-heavy code.

Pre-1.23: the pool keeps the runtime heap entry alive. Post-1.23: same — pooled tickers are referenced, so the GC does not collect them.

This pattern is rarely worth it. The cost of construct+stop is hundreds of nanoseconds; the complexity of the pool is high.

### Edge Case 15: Ticker as Channel in Select Default

```go
select {
case <-t.C:
    work()
default:
    // no tick yet
}
```

Useful for "do work if there's a tick, skip otherwise." Pre-1.23 the channel may contain a stale tick. Post-1.23 it contains the latest, if any.

For polling-style code, this is fine. For accounting "did I miss a tick?" — count ticks observed versus ticks expected.

---

## Diagnosing Ticker Problems with pprof

`pprof` is the standard CPU and memory profiler in Go. For ticker-related problems:

### Goroutine Profile

```
http://localhost:6060/debug/pprof/goroutine?debug=2
```

Output groups goroutines by stack. If you see hundreds of goroutines parked at:

```
goroutine 12345 [chan receive, 5 minutes]:
github.com/yourcorp/yoursvc/internal.(*Worker).run(...)
    /src/internal/worker.go:42 +0x150
```

with all of them parked at the same line that calls `<-t.C`, you have either:

- Many `Worker`s, each with its own ticker (intentional? scale issue?).
- A leak — `Worker`s spawned but not stopped.

Use the `?debug=2` form to see all stacks; use the default to get a summary by stack.

### CPU Profile

```
go tool pprof http://localhost:6060/debug/pprof/profile?seconds=30
```

If `runtime.runtimer`, `runtime.checkTimers`, or `runtime.sendTime` are at the top of `top`, your ticker subsystem is hot. Investigate timer count and period.

### Heap Profile

```
go tool pprof http://localhost:6060/debug/pprof/heap
```

If `time.startTimer` allocations dominate, you are constructing tickers frequently. Reuse them with `Reset`.

### Block Profile

```
runtime.SetBlockProfileRate(1)
go tool pprof http://localhost:6060/debug/pprof/block
```

Block profiles show contention. If a goroutine is blocked on `runtime.lockWithRank` from a timer site, you have contention on a P's timer lock. Rare but diagnostic.

### Mutex Profile

```
runtime.SetMutexProfileFraction(1)
go tool pprof http://localhost:6060/debug/pprof/mutex
```

Mutex profile shows lock waits. Similar diagnostic value to block profile for locks.

### Allocations

```
go tool pprof -alloc_objects http://localhost:6060/debug/pprof/heap
```

Shows allocation counts. If `time.After` shows up with thousands of allocations per second, replace with a reusable timer.

---

## Diagnosing Ticker Problems with execution traces

`runtime/trace` produces a detailed view of scheduler decisions, including timer firing events.

### Capturing a Trace

```go
import "runtime/trace"

f, _ := os.Create("trace.out")
trace.Start(f)
defer trace.Stop()
// ... run workload for some seconds ...
```

Then:

```
go tool trace trace.out
```

The browser UI shows per-P timelines. Timer fires are annotated. You can see:

- When each timer fires.
- Which P fired it.
- How long the goroutine took to wake after the fire.
- Scheduler latency.

### Reading the Trace

Each P has a row. Goroutine activity is colored. Timer events appear as small spikes. Click a spike to see details.

If you have a 1-second ticker but the spikes are spaced at 1.2-second intervals, your ticker is firing late. Investigate: is the P busy? Is the heap deep? Is the consumer slow?

### When to Use a Trace

- Suspected scheduler issue (tickers firing late).
- Suspected wake-up latency (tickers fire on time but the goroutine takes long to run).
- Performance regression in ticker-heavy code.

Traces are heavyweight (megabytes per second). Capture briefly under representative load.

---

## Live Migration and Suspend Resume

Cloud VMs may be live-migrated between hosts. Laptops may sleep. What does the monotonic clock do?

### Linux

`CLOCK_MONOTONIC` does not include time spent suspended. After a 10-minute suspend, monotonic time has advanced by ~milliseconds (the active time), not 10 minutes.

For tickers: a 1-second ticker that has fired 5 times before suspend will fire its 6th tick at "5 seconds of active time + 1 second of active time," not at "5 seconds + 10 minutes." Suspend is invisible to monotonic.

`CLOCK_BOOTTIME` includes suspend time. The Go runtime uses `CLOCK_MONOTONIC`, not `CLOCK_BOOTTIME`, so this is the relevant behaviour.

### macOS

`CLOCK_UPTIME_RAW` (the macOS equivalent of `CLOCK_MONOTONIC`) does not include sleep. Same effect as Linux.

### Windows

`QueryPerformanceCounter` does not pause during sleep. The Go runtime uses it (with adjustments). Tickers may "catch up" after a sleep, firing rapidly to process accumulated `when`s.

### Cloud Live Migration

The hypervisor pauses the VM during migration. Monotonic time in the guest typically does not advance during the pause. After resume, tickers continue at their previous schedule.

If your code uses wall-clock time for scheduling (e.g. "fire at 02:00 UTC"), the wall clock may jump forward by the migration delay. Plan accordingly.

### Implications

For server workloads, suspend and migration are rare and brief. Tickers usually behave reasonably either way.

For laptop-based tools or mobile apps, suspend is common and long. Don't rely on monotonic time for "elapsed since boot"; use wall-clock with monotonic correction, or `CLOCK_BOOTTIME` via syscall if you need it.

---

## Memory Ordering of Tick Delivery

The Go memory model specifies happens-before relationships for channels. For tickers:

1. The runtime's call to `sendTime(c, 0)` includes any data writes the runtime made before that call.
2. The consumer's receive from `c` happens-after the send.
3. Therefore, any writes the runtime made before the send are visible to the consumer after the receive.

This is the standard channel guarantee. For user-level reasoning: data written before a tick is observed by code after the receive.

### In Practice

```go
var lastTickAt time.Time
// no synchronisation visible here, but the channel provides it

go func() {
    t := time.NewTicker(time.Second)
    defer t.Stop()
    for now := range t.C {
        lastTickAt = now // write
    }
}()

// reader
fmt.Println(lastTickAt) // race - lastTickAt is not synced with reader
```

The channel synchronises writer and the *next* receiver, but not with arbitrary other readers. If you have multiple goroutines reading `lastTickAt`, you need a mutex or atomic.

The memory model is about happens-before *across the channel*. It does not protect arbitrary reads from arbitrary other goroutines.

### Atomicity of time.Time

`time.Time` is a struct of multiple fields. Reading and writing it concurrently is *not* atomic. A reader may see a torn value. Use `atomic.Value` or a mutex.

```go
var lastTickAt atomic.Pointer[time.Time]

case now := <-t.C:
    n := now
    lastTickAt.Store(&n)

// reader
t := lastTickAt.Load()
if t != nil {
    fmt.Println(*t)
}
```

This is the safe pattern for "publish the latest tick time."

---

## Comparison with Other Languages

Brief comparisons to put Go's `Ticker` in context.

### Python — `asyncio.sleep` and `Timer`

Python's asyncio has `loop.call_later(delay, callback)` and `loop.call_at(time, callback)`. Tickers are usually built as `await asyncio.sleep(period)` loops:

```python
async def loop():
    while True:
        await asyncio.sleep(1)
        await work()
```

This is a sleep-based loop, not a heap-based ticker. Each sleep is one entry in asyncio's heap. Cancellation via cancelling the task.

### JavaScript — `setInterval`

Browser's `setInterval(callback, ms)` calls `callback` every `ms` milliseconds (approximately). Implementation is browser-specific. Notable: drift is not corrected — repeated `setInterval` fires can pile up if the page is busy.

`setInterval` is simpler than Go's `Ticker` (no Reset, no separate channel) but also less controlled.

### Java — `ScheduledExecutorService`

```java
ScheduledExecutorService ses = Executors.newScheduledThreadPool(1);
ScheduledFuture<?> future = ses.scheduleAtFixedRate(task, 0, 1, TimeUnit.SECONDS);
// ...
future.cancel(false);
```

Heap-based scheduler, supports both fixed-rate and fixed-delay (different drift semantics). More featureful than Go's ticker; also more verbose.

### Rust — `tokio::time::interval`

```rust
let mut interval = tokio::time::interval(Duration::from_secs(1));
loop {
    interval.tick().await;
    work().await;
}
```

Similar to Go's ticker: a heap entry, async receive, supports `reset`. Tokio's documentation explicitly notes the "missed tick behaviour" choice (burst, delay, or skip), which is configurable. Go's ticker hard-codes "drop."

### Erlang — `erlang:send_after`

Erlang sends a message to a process after a delay. The process pattern-matches on the message:

```erlang
erlang:send_after(1000, self(), tick),
receive
    tick -> work(), loop()
end.
```

No dedicated ticker type. Periodic behaviour is loop-on-message. Lightweight processes make this idiomatic.

### Compared

Go's `Ticker` is mid-spectrum: more structured than `setInterval`, less featureful than Java's `ScheduledExecutorService`, similar to Rust's `tokio::time::interval`. The drop-on-slow-consumer behaviour is opinionated and matches "freshness over completeness."

---

## When Ticker Is the Wrong Tool

`Ticker` is the right tool for steady periodic work in goroutine-friendly code. It is the wrong tool when:

### Wrong: Hard Real-Time

Microsecond-precision audio, real-time control, hardware sampling. The Go runtime's scheduler and GC introduce jitter that exceeds tolerances. Use a real-time OS, dedicated hardware, or a callback-based system.

### Wrong: Wall-Clock Scheduling

"Every day at 02:00 UTC." A 24-hour ticker drifts and is sensitive to leap seconds. Use a cron library that schedules on wall-clock boundaries.

### Wrong: One-Shot Delays

"Sleep 5 seconds then fire once." Use `time.NewTimer` or `time.AfterFunc`. A ticker for one-shot use is wasteful — its `period` is unused.

### Wrong: Sub-Millisecond Periods

The runtime's scheduling latency is in microseconds. A 100us ticker has ~10% jitter per fire. For high-rate code, use a tight loop with `runtime.Gosched()`, or use the `time.Now()` reads from elsewhere as a clock.

### Wrong: Per-Request Periodic Work

Spawning a ticker per HTTP request, expecting it to die with the handler, is fragile. The ticker outlives the handler if it has not yet been Stopped. Use a single shared ticker (or none) and key by request.

### Wrong: Distributed Synchronisation

Two services that need to "tick together" cannot use independent `time.Ticker`s on each node — their clocks drift. Use a coordinator (a leader broadcasting "now"), or use deterministic event timestamps.

### Right Almost Everywhere Else

For heartbeats, polls, telemetry, batched writes, cache janitors, reconcilers — `Ticker` is excellent.

---

## Two Production Incidents Reconstructed

Concrete failure modes, with root cause and fix.

### Incident 1: The Goroutine Pileup

A service that processes uploaded files exposes an HTTP endpoint. Each request spawns a goroutine that monitors the upload progress and emits progress events to a SSE stream every 100ms:

```go
func uploadHandler(w http.ResponseWriter, r *http.Request) {
    upload, err := startUpload(r.Body)
    if err != nil {
        http.Error(w, err.Error(), 500)
        return
    }
    go monitor(upload, w)
    upload.Wait()
}

func monitor(upload *Upload, w http.ResponseWriter) {
    t := time.NewTicker(100 * time.Millisecond)
    defer t.Stop()
    for range t.C {
        p := upload.Progress()
        fmt.Fprintf(w, "data: %d%%\n\n", p)
        if p == 100 {
            return
        }
    }
}
```

In testing, this works. Single uploads complete; `monitor` returns; the ticker stops. The reviewer approves.

In production, occasional clients abandon their uploads mid-flight (browser closes, network drops). The HTTP server detects the abandonment and `upload.Wait()` returns immediately. The handler exits. But `monitor` is still running.

`monitor`'s ticker keeps firing. It calls `fmt.Fprintf(w, ...)` on a `ResponseWriter` whose underlying connection is closed. The Fprintf eventually returns an error, but `monitor` ignores the error and loops. The only exit condition is `p == 100`, which never triggers because the upload was abandoned.

The goroutine leaks. Over days, the process accumulates thousands of leaked goroutines. Eventually memory pressure causes the orchestrator to restart the pod. The team thought they had a memory leak in the upload buffer; the real leak was the ticker goroutines.

**Diagnosis path**: `runtime.NumGoroutine()` rising over hours. `pprof goroutine?debug=2` showed thousands of identical stacks parked at `monitor`'s `<-t.C`. The fix:

```go
func uploadHandler(w http.ResponseWriter, r *http.Request) {
    ctx := r.Context()
    upload, err := startUpload(r.Body)
    if err != nil {
        http.Error(w, err.Error(), 500)
        return
    }
    done := make(chan struct{})
    go monitor(ctx, upload, w, done)
    upload.Wait()
    close(done)
}

func monitor(ctx context.Context, upload *Upload, w http.ResponseWriter, done <-chan struct{}) {
    t := time.NewTicker(100 * time.Millisecond)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case <-done:
            return
        case <-t.C:
            p := upload.Progress()
            if _, err := fmt.Fprintf(w, "data: %d%%\n\n", p); err != nil {
                return
            }
            if p == 100 {
                return
            }
        }
    }
}
```

Three exit conditions: client cancelled, upload completed, write failed. The leak is impossible.

**Lessons**:

- A ticker goroutine that depends on a single-condition exit is a leak waiting for an unhappy path.
- Always wire `r.Context()` through to background goroutines spawned in handlers.
- Always check the error from writes to the `ResponseWriter`. A closed connection is signalled by error, not by panic.

### Incident 2: The Migration Storm

A platform service runs hundreds of tenants. Each tenant has a "reconciler" goroutine that pulls latest config from a control plane every minute. To avoid the thundering herd at minute boundaries, each tenant's reconciler is constructed with `time.NewTicker(time.Minute)` at tenant boot:

```go
func tenantReconciler(ctx context.Context, tenantID string) {
    t := time.NewTicker(time.Minute)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case <-t.C:
            reconcile(ctx, tenantID)
        }
    }
}
```

At normal operation, each tenant boots at a different time, so their tickers naturally fire at different wall-clock instants. Good.

The team performs a rolling deploy. As pods are gracefully replaced, all tenants on the new pod boot within a small window — say, 5 seconds. Their tickers all fire roughly every minute *from those 5 seconds*. The phases are clustered within a 5-second window.

After the deploy, every minute, ~5 seconds of "reconcile storm" hits the control plane. The control plane's QPS spikes; it shed load; tenants started failing to reconcile; alerts fire.

The diagnosis: the ticker firing pattern was clustered in time because boot times were clustered. The fix:

```go
func tenantReconciler(ctx context.Context, tenantID string) {
    offset := time.Duration(rand.Int63n(int64(time.Minute)))
    select {
    case <-ctx.Done():
        return
    case <-time.After(offset):
    }
    t := time.NewTicker(time.Minute)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case <-t.C:
            reconcile(ctx, tenantID)
        }
    }
}
```

The initial offset spreads the tickers' phases across the full period. Even after a clustered deploy, the storm dissolves into a smooth load.

**Lessons**:

- Tickers do not magically de-synchronise. Clustered creation times produce clustered fire times.
- `rand.Int63n` is enough; you do not need crypto-random for jitter.
- Always think about deploy timing when you spawn many tickers with the same period.

---

## Building a Ticker From Scratch

To deepen understanding, build a `Ticker`-equivalent from `time.NewTimer`. This is what `time.NewTicker` does conceptually, minus the runtime integration.

### Naive Implementation

```go
type MyTicker struct {
    C       <-chan time.Time
    out     chan time.Time
    period  time.Duration
    cancel  context.CancelFunc
    done    chan struct{}
}

func NewMyTicker(period time.Duration) *MyTicker {
    if period <= 0 {
        panic("non-positive interval")
    }
    out := make(chan time.Time, 1)
    ctx, cancel := context.WithCancel(context.Background())
    t := &MyTicker{
        C:       out,
        out:     out,
        period:  period,
        cancel:  cancel,
        done:    make(chan struct{}),
    }
    go t.run(ctx)
    return t
}

func (t *MyTicker) run(ctx context.Context) {
    defer close(t.done)
    timer := time.NewTimer(t.period)
    defer timer.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case now := <-timer.C:
            select {
            case t.out <- now:
            default:
            }
            timer.Reset(t.period)
        }
    }
}

func (t *MyTicker) Stop() {
    t.cancel()
    <-t.done
}

func (t *MyTicker) Reset(d time.Duration) {
    panic("Reset not implemented in this naive version")
}
```

This works. Each fire is a separate timer that re-arms itself. The send into `t.out` is non-blocking (matches the standard ticker's drop-on-full behaviour).

### Adding Reset

```go
type MyTicker struct {
    C       <-chan time.Time
    out     chan time.Time
    period  time.Duration
    reset   chan time.Duration
    cancel  context.CancelFunc
    done    chan struct{}
}

func NewMyTicker(period time.Duration) *MyTicker {
    if period <= 0 {
        panic("non-positive interval")
    }
    out := make(chan time.Time, 1)
    ctx, cancel := context.WithCancel(context.Background())
    t := &MyTicker{
        C:       out,
        out:     out,
        period:  period,
        reset:   make(chan time.Duration, 1),
        cancel:  cancel,
        done:    make(chan struct{}),
    }
    go t.run(ctx)
    return t
}

func (t *MyTicker) run(ctx context.Context) {
    defer close(t.done)
    period := t.period
    timer := time.NewTimer(period)
    defer timer.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case now := <-timer.C:
            select {
            case t.out <- now:
            default:
            }
            timer.Reset(period)
        case d := <-t.reset:
            period = d
            if !timer.Stop() {
                select {
                case <-timer.C:
                default:
                }
            }
            timer.Reset(period)
        }
    }
}

func (t *MyTicker) Stop() {
    t.cancel()
    <-t.done
}

func (t *MyTicker) Reset(d time.Duration) {
    if d <= 0 {
        panic("non-positive interval")
    }
    select {
    case t.reset <- d:
    default:
        // buffer full; latest reset is what matters
        // could drain and resend, but the resulting period will be d either way
    }
}
```

The Reset channel coalesces multiple Resets into one — the latest call wins. The select in `run` picks up the Reset, updates `period`, stops the in-flight timer, drains its channel if needed, and re-arms.

### Comparison With time.NewTicker

The custom version uses a goroutine; `time.NewTicker` does not — the standard library's ticker is part of the runtime's timer subsystem, no extra goroutine. So the custom version is more expensive (one extra goroutine per ticker). For learning purposes, this is fine; for production, use the standard library.

### What's Missing

- No fan-out: only one consumer can read from `C`. The standard library has the same property.
- No pause/resume: would require an extra channel.
- No phase alignment.
- No jitter.

If you need any of these, build on top.

---

## Coalesced Timer Service

A different approach: instead of one ticker per task, run one shared ticker and dispatch many tasks from it.

### Why Coalesce

If you have hundreds of tasks all wanting "every 5 seconds," constructing a ticker per task creates hundreds of runtime timers. Coalescing into one ticker that fires once per period and runs all tasks reduces overhead.

### Implementation

```go
type TimerService struct {
    mu     sync.Mutex
    tasks  map[string]*scheduledTask
    period time.Duration
    cancel context.CancelFunc
    done   chan struct{}
}

type scheduledTask struct {
    period  time.Duration
    last    time.Time
    do      func(ctx context.Context)
}

func NewTimerService(checkPeriod time.Duration) *TimerService {
    return &TimerService{
        tasks:  make(map[string]*scheduledTask),
        period: checkPeriod,
    }
}

func (s *TimerService) Start(parent context.Context) {
    ctx, cancel := context.WithCancel(parent)
    s.cancel = cancel
    s.done = make(chan struct{})
    go s.run(ctx)
}

func (s *TimerService) Stop() {
    if s.cancel == nil {
        return
    }
    s.cancel()
    <-s.done
}

func (s *TimerService) Schedule(name string, period time.Duration, do func(ctx context.Context)) {
    s.mu.Lock()
    s.tasks[name] = &scheduledTask{period: period, do: do, last: time.Now()}
    s.mu.Unlock()
}

func (s *TimerService) Unschedule(name string) {
    s.mu.Lock()
    delete(s.tasks, name)
    s.mu.Unlock()
}

func (s *TimerService) run(ctx context.Context) {
    defer close(s.done)
    t := time.NewTicker(s.period)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case now := <-t.C:
            s.tick(ctx, now)
        }
    }
}

func (s *TimerService) tick(ctx context.Context, now time.Time) {
    s.mu.Lock()
    var due []*scheduledTask
    for _, task := range s.tasks {
        if now.Sub(task.last) >= task.period {
            due = append(due, task)
            task.last = now
        }
    }
    s.mu.Unlock()
    for _, task := range due {
        task.do(ctx)
    }
}
```

One ticker, many tasks. The check period (`s.period`) is the granularity — tasks fire within that window of their target period.

For example, with `checkPeriod = 1 * time.Second` and a task period of 5 seconds, the task fires every 5 to 6 seconds (worst case 1 second of slack).

### Trade-offs

- Saves memory and runtime overhead for many tasks.
- Loses some precision (limited by `checkPeriod`).
- Single thread of execution for the tick handler. If tasks are slow, they queue.
- Recovery from panic in `task.do` would need explicit handling.

### When to Use

- Many tasks with similar periods.
- Periods on the order of seconds or longer (precision allowed to drift).
- Centralised management is a feature, not a bug (you can audit all scheduled tasks).

For high-frequency, precision-critical tasks, stick with one `time.Ticker` per task.

---

## Tickers and the Network Poll Loop

Go's network stack uses `netpoll` (epoll on Linux, kqueue on BSDs, IOCP on Windows). The scheduler's `findrunnable` interleaves netpoll checks with timer checks.

### The Interleaving

Each pass through `findrunnable`:

1. Check the local P's run queue.
2. Check the local P's timer heap.
3. Check the global run queue.
4. Try to steal from other Ps.
5. Block on netpoll, with a timeout determined by the next timer.

Step 5 is key: the scheduler does not poll netpoll separately from timers. Instead, it computes the time until the next timer fires and uses that as the netpoll timeout. When netpoll returns (because an I/O event or the timer fired), the scheduler processes both.

### Implications

A long timer in one P's heap can delay netpoll wake-ups on that P. In practice this is fine because:

- The longest typical timer is the GC pacer (seconds).
- I/O wake-ups interrupt the poll early.
- Work-stealing distributes load.

If you have a very long ticker (e.g. `time.NewTicker(time.Hour)`), the netpoll timeout on that P is bounded by the next timer — but other timers (short ones, on the same P, in other goroutines) cap the wait.

### When Things Go Wrong

If a P has only one timer and it is far in the future, and that P has nothing else to do, the scheduler blocks netpoll until either I/O arrives or the timer fires. This is correct but means CPU usage is zero in that interval — which is what you want.

The pathology: a P with no timers, no goroutines, no I/O. The scheduler blocks netpoll indefinitely. If a new timer is added to that P, the scheduler needs to be woken up. The runtime sends a "wakeup" signal (a pipe write) to break netpoll out of its wait.

This wakeup mechanism is internal to the runtime; user code does not see it. But it explains why adding a short timer to an idle service can have surprisingly low latency — the runtime is good at waking up.

---

## Cgo and Tickers

Calling C code via `cgo` interacts with Go's scheduler in nuanced ways. Tickers are not exempt.

### What Cgo Does to a Goroutine

When a Go function calls a C function:

1. The Go goroutine "enters cgo." Its M (OS thread) is dedicated to the cgo call.
2. If the cgo call is long-running, the P is released; another goroutine can run on a different M+P combination.
3. When the cgo call returns, the goroutine is rescheduled.

### How Tickers Are Affected

If a goroutine is parked in `<-t.C` and then makes a cgo call, the receive happens first. The goroutine receives, then enters cgo.

If a goroutine is *in* a cgo call when a tick is sent to `t.C`, nothing happens to the goroutine — the cgo call runs to completion. The tick is buffered (capacity 1). When the cgo call returns, the next receive sees the buffered tick.

If the cgo call takes longer than the period, subsequent ticks are dropped (buffer full). Effective rate falls.

### Tickers Inside Cgo Callbacks

If your cgo code calls back into Go (via `//export`), you can use a ticker inside the callback. But the callback runs on a special M dedicated to that purpose; spawning a ticker inside the callback creates a ticker whose owning P may shift unpredictably.

For most applications, the safer pattern is: don't create tickers inside cgo callbacks. Create them in pure Go code and pass them in.

### Locking Implications

The runtime's timer locks are not held across cgo calls. So tickers do not deadlock with cgo.

However, if your cgo code calls a library that internally creates threads and uses POSIX timers, you have two timer subsystems competing. The Go runtime is oblivious to the C-level timers.

### Practical Advice

Avoid mixing tickers with long cgo calls in the same goroutine. If you need a ticker, dedicate a goroutine to the ticker loop and have it dispatch work via channels to cgo-calling goroutines.

---

## Scheduler Latency Budget

How long, in the worst case, between a ticker's scheduled fire time and the consumer running its handler?

### Latency Components

1. **Timer subsystem latency**: from `when` to the runtime executing `sendTime`. Typically sub-microsecond on an idle system; can be longer if findrunnable is busy with other work.
2. **Channel send latency**: `sendTime` does a non-blocking send. Sub-microsecond.
3. **Wake-up latency**: from the channel send to the receiver goroutine being marked runnable. Sub-microsecond.
4. **Scheduling latency**: from runnable to actually running on a P. Variable — depends on P availability. Sub-microsecond on idle, milliseconds on saturated.
5. **OS thread latency**: if the P is on a different OS thread than is currently running, scheduling latency adds. Sub-microsecond on Linux with `SCHED_FIFO`, milliseconds with default scheduling.

Total budget: 1us to 10ms depending on system load.

### Measurement

```go
func MeasureLatency(period time.Duration, n int) []time.Duration {
    var latencies []time.Duration
    t := time.NewTicker(period)
    defer t.Stop()
    start := time.Now()
    for i := 0; i < n; i++ {
        now := <-t.C
        expected := start.Add(time.Duration(i+1) * period)
        latencies = append(latencies, now.Sub(expected))
    }
    return latencies
}
```

Note: `now` from `t.C` is the time the runtime *sent*, not when the consumer received. If you want full-loop latency, measure `time.Now()` at receive time:

```go
recvTime := time.Now()
delay := recvTime.Sub(expected)
```

The difference (`recvTime` minus `now`) is the channel + scheduling delay, which is what most production code cares about.

### Tightening the Budget

For applications with strict latency requirements:

- Reduce `GOMAXPROCS` to the actual core count (don't oversubscribe).
- Use `runtime.LockOSThread` on the consumer goroutine to pin it to an OS thread. The kernel can use FIFO scheduling, reducing wake latency.
- Disable GC during latency-critical windows: `debug.SetGCPercent(-1)`. Cost: heap grows.
- Run on a kernel with low-latency configuration (PREEMPT_RT on Linux).

For typical workloads, the default Go scheduler is fine and these tunings are overkill.

---

## Choosing Between Ticker, Timer, and Sleep

A decision matrix.

| Use case | Best primitive | Why |
|---|---|---|
| Steady periodic work, single goroutine | `time.NewTicker` | Single allocation, runtime support, integrates with select |
| Steady periodic work, no select | `time.NewTicker` + `range t.C` | Concise; only if you have an exit path other than range |
| One-shot delay | `time.NewTimer` or `time.After` | Timer reusable; After convenient |
| Recurring delay with variable period each iteration | `time.NewTimer` + `Reset` | Allocation-free |
| Many tasks at varying periods | Coalesced service (one Ticker) | Single runtime timer |
| Fire after delay, no need to cancel | `time.AfterFunc` | Runs in goroutine; no consumer needed |
| Tight loop with periodic logging | `time.Now()` modulo period | No timer needed; check inline |
| Sleep within a function | `time.Sleep` | Simplest; no allocation if d is small |
| Cancellable sleep | `select { case <-ctx.Done(): ; case <-time.After(d): }` | One-shot, integrates with cancellation |
| Sleep that can be Skipped on cancel | as above | Same |

### Sleep Versus After Versus Timer for One-Shot Wait

```go
time.Sleep(d)                              // uncancellable
<-time.After(d)                            // cancellable, allocates
t := time.NewTimer(d); defer t.Stop(); <-t.C   // cancellable, reusable
```

`Sleep` is cheapest but uncancellable. For tests or scripts, fine. For server code where you may want to cancel, use `After` or `Timer`.

`After` allocates. `Timer` reused is allocation-free after the first.

### Ticker Versus AfterFunc for Recurring Work

```go
// Ticker approach
t := time.NewTicker(d)
defer t.Stop()
for {
    select {
    case <-ctx.Done():
        return
    case <-t.C:
        work()
    }
}
```

```go
// AfterFunc approach (recursive)
var fire func()
fire = func() {
    work()
    if ctx.Err() == nil {
        time.AfterFunc(d, fire)
    }
}
time.AfterFunc(d, fire)
```

Both work. Ticker is more idiomatic, integrates with select, easier to read. AfterFunc has no consumer goroutine — the work runs in the timer's own goroutine. For very lightweight work where you don't want a dedicated consumer, AfterFunc is leaner.

But: AfterFunc-recursive has subtler cancellation. Ticker's `defer Stop` is straightforward; AfterFunc's chain of "next AfterFunc" needs explicit context checking.

### When Sleep is Right

In tests, scripts, and simple synchronous code, `time.Sleep` is the cleanest:

```go
func waitForReady() {
    for {
        if isReady() {
            return
        }
        time.Sleep(100 * time.Millisecond)
    }
}
```

In a server, prefer `select` with `ctx.Done()` so the wait is cancellable. But for simple polling in a script, `Sleep` is fine.

---

## Pathological Patterns Worth Naming

Patterns to recognise and refactor.

### Pattern: Ticker Inside Goroutine Inside Loop

```go
for _, item := range items {
    go func(item Item) {
        t := time.NewTicker(time.Second)
        defer t.Stop()
        for {
            select {
            case <-ctx.Done():
                return
            case <-t.C:
                process(item)
            }
        }
    }(item)
}
```

One ticker per item. If `items` has thousands of entries, you have thousands of tickers and goroutines. Often the right answer is one outer ticker that walks `items` per tick.

### Pattern: Stop in Catch but Not in Happy Path

```go
t := time.NewTicker(time.Second)
for {
    if err := work(); err != nil {
        t.Stop()
        return err
    }
    select {
    case <-ctx.Done():
        // forgot t.Stop()
        return ctx.Err()
    case <-t.C:
    }
}
```

The Stop only runs on the error path. The cancel path leaks. Use `defer t.Stop()`.

### Pattern: Ticker for Backoff

```go
t := time.NewTicker(period)
defer t.Stop()
for attempts := 0; attempts < 5; attempts++ {
    if err := tryOnce(); err == nil {
        return
    }
    <-t.C
}
```

A ticker for a one-shot delay sequence is wasteful. Use `time.NewTimer` and `Reset`, or just `time.Sleep` if you don't need cancellation.

### Pattern: Ticker With Mutex Held

Discussed above. Move the work outside the mutex.

### Pattern: Drift-Driven Polling

```go
last := time.Now()
for {
    if time.Since(last) > period {
        work()
        last = time.Now()
    }
    time.Sleep(time.Millisecond)
}
```

This reinvents the ticker poorly: a sleep-poll loop. Use `time.NewTicker`.

### Pattern: Reset After Receive Without Coordinating With Stop

```go
go func() {
    for {
        select {
        case <-stop:
            t.Stop()
            return
        case <-t.C:
            t.Reset(newPeriod()) // racy with the Stop case
        }
    }
}()
go func() {
    stop <- struct{}{} // signals stop
    t.Stop() // duplicate; first goroutine also calls Stop
}()
```

Two paths Stop the same ticker. Use a single owner.

---

## Designing APIs That Wrap Tickers

If you expose a ticker via your library's public API, consider these design choices.

### Expose a Channel or a Method?

Option A: expose a channel.

```go
type Heartbeat struct {
    C <-chan time.Time
}

func New() *Heartbeat { /* ... */ }
```

Pros: easy to use in `select`. Mirrors `time.Ticker`.

Cons: no place to put error or status information.

Option B: expose a callback.

```go
type Heartbeat struct{}

func New(handler func(time.Time)) *Heartbeat { /* ... */ }
```

Pros: simpler usage for the caller (no `select` loop).

Cons: callback runs in your library's goroutine. The caller must reason about concurrency.

Option C: expose both.

```go
type Heartbeat struct {
    Tick <-chan time.Time
    Err  <-chan error
}
```

Pros: integrates with select; signals errors.

Cons: more API surface; caller must drain both channels.

For most cases, Option A is best.

### Exposing Reset

If your wrapper allows changing the period, expose a `SetPeriod(d)` method, not the underlying ticker.

```go
type Heartbeat struct {
    // ...
}

func (h *Heartbeat) SetPeriod(d time.Duration) {
    h.cmds <- setPeriod{d: d}
}
```

The internal goroutine handles the reset, avoiding races.

### Exposing Stop

Always expose a `Close` or `Stop` method that:

- Cancels the goroutine.
- Waits for it to exit.
- Is idempotent.

```go
func (h *Heartbeat) Close() error {
    h.closeOnce.Do(func() {
        h.cancel()
        <-h.done
    })
    return nil
}
```

`sync.Once` makes Close idempotent.

### Documenting the Drop Behaviour

If your API's "tick channel" is buffer-1, the user may not realise ticks are dropped under load. Document explicitly:

> Tick events may be dropped if the consumer does not read promptly. The channel buffer holds at most one event.

### Aligning With Standard Library Idioms

Where possible, mimic `time.Ticker`'s shape. Users expect `t.C` to be a channel, `t.Stop()` to be a method. Don't invent a new shape unless the standard library's is genuinely insufficient.

---

## Tickers in Library Code

A library that exposes long-running tickers needs to be careful about lifetime.

### Constructor That Spawns

```go
func NewHeartbeat(period time.Duration) *Heartbeat {
    h := &Heartbeat{}
    h.Start()
    return h
}
```

This is a footgun: the constructor side-effects, the user might forget to call `Close`, the lifetime is unclear.

Better:

```go
func NewHeartbeat(period time.Duration) *Heartbeat {
    return &Heartbeat{period: period}
}

func (h *Heartbeat) Start(ctx context.Context) error {
    /* start goroutine */
}
```

Explicit `Start` with a context. The library cannot start anything without permission.

### Configurable Clock

For testability, accept a `Clock` interface:

```go
func NewHeartbeat(period time.Duration, clock Clock) *Heartbeat {
    return &Heartbeat{period: period, clock: clock}
}

type Clock interface {
    NewTicker(d time.Duration) Ticker
}

type Ticker interface {
    C() <-chan time.Time
    Stop()
    Reset(d time.Duration)
}
```

Provide a default `RealClock` for production use; tests pass a mock.

### No Goroutines Spawned by Default

If your library exposes types that hold tickers, prefer constructors that do not spawn until the user opts in. Lazy spawning is friendly:

```go
type Cache struct {
    janitorStarted bool
    janitorPeriod  time.Duration
}

func NewCache() *Cache {
    return &Cache{janitorPeriod: time.Minute}
}

func (c *Cache) StartJanitor(ctx context.Context) {
    if c.janitorStarted {
        return
    }
    c.janitorStarted = true
    go c.janitor(ctx)
}
```

The user chooses when to start the goroutine.

### Documenting Lifetime

Make explicit in package docs:

> Heartbeat manages a background goroutine. Callers must call Close to stop it; failing to do so leaks a goroutine.

Better: enforce via API design (constructor returns a `Closer` interface, etc.) so the linter or reviewer flags missing Close calls.

### Linter Support

Custom linters can detect:

- `time.NewTicker` without a corresponding `Stop`.
- `time.Tick` usage (always wrong outside trivial programs).
- `time.After` inside a `for { select }` loop.

The `staticcheck` project's `SA1015` rule flags `time.Tick`. Adding custom rules to your CI catches regressions.

### Common API Mistakes

Some real-world API mistakes seen in code review:

- Exposing `t.C` via an embedded `*time.Ticker` field, which the caller can then `Stop` themselves, surprising the library.
- A library function that returns a `chan time.Time` but does not document who owns the underlying ticker.
- A constructor that spawns multiple tickers without a single Close to stop all.
- A `Close` that does not wait for the goroutine to exit, leading to "Close returned but the goroutine is still running" race in tests.

All of these are avoidable with a small amount of design care.

### Versioned API

If your library expects to support multiple Go versions including pre-1.23, document the behaviour explicitly:

> On Go versions before 1.23, callers must explicitly call Close. On Go 1.23 and later, the goroutine is eventually garbage-collected if Close is not called, but for predictable behaviour Close is still recommended.

The cost of saying it explicitly is nil; the cost of not saying it is bug reports.

---

## Tickers and the Internal Scheduler

A deeper look at how the scheduler treats tickers as scheduling units.

### Scheduler's Main Loop

The Go scheduler's main loop (`schedule()`) runs:

1. Run any goroutines on the local P's run queue.
2. Check `checkTimers` on the local P.
3. If still nothing to do, check the global run queue.
4. If still nothing, try to steal work from other Ps (including their timer heaps).
5. If still nothing, block on netpoll with a timeout determined by the next timer.

Step 2 is where tickers fire. The scheduler is biased toward locality: timer fires happen on the P that owns the timer, when possible.

### Priority

The scheduler does not prioritise timers over running goroutines. A long-running goroutine that does not yield can starve timers on the same P (pre-1.14 asyncpreempt).

Post-1.14, asyncpreempt forces yields. Timers are never starved by user code for more than ~10ms.

### Timer Stealing Heuristics

The exact rules for when one P steals from another have evolved across Go versions. As of Go 1.22:

- If a P has been idle for longer than ~1 microsecond and its run queue is empty, it tries to steal from a random other P.
- Stealing checks both the other P's run queue and its timer heap.
- A timer is "stealable" if its `when` is in the past.

The exact thresholds are tuned conservatively to avoid excessive cross-P traffic.

### A Word on Real-Time

The Go scheduler is not a real-time scheduler. It does not guarantee bounded latency. For real-time work, use a real-time OS and either C with explicit thread affinity or Go with carefully constrained goroutine count and `runtime.LockOSThread`.

That said, the scheduler is very good. On a well-provisioned system, tick fires happen within microseconds of their scheduled time. Tail latencies are dominated by GC pauses, which are sub-millisecond on Go 1.10+.

---

## Reading the Source for runtime/time.go

The runtime's time code is dense. A few landmarks.

### File Structure (Go 1.22)

```
src/runtime/time.go
```

Top of file: type declarations (`timer`, `timeTimer`, `runtimeTimer`).

Middle: heap operations (`addtimer`, `deltimer`, `siftupTimer`, `siftdownTimer`).

End: scheduler integration (`checkTimers`, `runtimer`, `nextTimer`).

The file is ~1500 lines.

### Key Functions

`addtimer(t *timer)`: adds a timer to the calling P's heap. Acquires the timer lock, performs heap sift-up, releases the lock.

`deltimer(t *timer) bool`: marks the timer for deletion. Returns true if the deletion was effective (timer was waiting). Returns false if the timer was already running or already removed.

`resettimer(t *timer, when int64) bool`: changes a timer's `when`. Equivalent to delete + add but more efficient. Returns the old "active" state.

`checkTimers(pp *p, now int64)`: walks the head of `pp`'s heap, firing all timers with `when <= now`. Called from the scheduler's main loop.

`runtimer(pp *p, t *timer)`: fires a single timer. Calls `t.f(t.arg, t.seq)`.

`nextTimer(pp *p) int64`: returns the `when` of the next timer on `pp`'s heap, or `MaxInt64` if empty. Used by the scheduler to compute netpoll timeout.

### Concurrency Annotations

The runtime code has informal annotations indicating which mutex protects each field. For timers:

- `t.status` is protected by atomic CAS (pre-1.23).
- `t.when`, `t.period`, `t.f`, `t.arg`, `t.seq` are protected by the owning P's timer lock when the timer is on a heap. They are free to be read by the owning goroutine after `deltimer` removes the timer.

The conventions are documented in comments at the top of `time.go`. Read them before modifying anything.

### Common Pitfalls When Reading

- The state machine pre-1.23 is intricate. Read the state transition comments carefully; they specify which states can transition to which others.
- Some functions look short but call other functions that take locks. The lock order matters.
- Go-version-specific code is sometimes gated by build tags. Watch for `//go:build go1.21` style annotations.

### Tracing a Call

Set a delve breakpoint on `addtimer` to see it called from user code:

```bash
dlv debug main.go
break runtime.addtimer
continue
```

When the program hits `addtimer`, inspect the stack: the user-level call to `time.NewTicker` should be a few frames up. This is informative for debugging "where does this timer come from" in unfamiliar code.

---

## Specific Timer Subsystem Bugs Over the Years

A few historically interesting bugs that shaped the current design.

### Bug: Lost Tick on Reset Race (Go 1.14)

Early in the 1.14 cycle, a race condition existed where `Reset` could lose a tick if it raced with `checkTimers`. The state machine was patched; the fix is in the `runtime` package's commit log.

Lesson: lazy heap maintenance is hard.

### Bug: Stuck Heap (Go 1.16)

A workload with many tickers, frequent Reset, and high core count triggered a heap corruption that left timers "stuck" — never fired despite being in the past. The fix involved tightening the CAS-spin logic in `cleantimers`.

Lesson: the state machine's correctness depends on every possible interleaving.

### Bug: Slow netpoll Wake (Go 1.19)

A bug where `wakeNetPoller` could fail to wake the netpoll thread when a new timer was added, leading to multi-millisecond delays. Fixed in 1.20.

Lesson: even infrastructure code has subtle bugs.

### Bug: Reset(0) Panic Inconsistency (Go 1.20)

Earlier Go versions had inconsistent behaviour on `Reset(0)` versus `Reset(-1)`. 1.20 standardised on panic for both.

Lesson: input validation should be consistent across similar APIs.

### Bug: GC Did Not Collect Tickers (Pre-1.23)

The long-standing leak: tickers were never GC'd until Stop. Documented but unloved. Fixed in 1.23 via internal weak references.

Lesson: the absence of GC integration was a feature/bug debate that took years to resolve.

---

## Tickers in a Microservice Context

A more applied look at how to think about tickers in a typical Go microservice.

### Service Lifecycle

A microservice has phases:

1. Boot: configure, connect dependencies.
2. Start: spawn background goroutines (tickers).
3. Serve: handle requests.
4. Shutdown: stop background goroutines, drain requests.
5. Exit.

Tickers belong to phase 2 (spawning) and phase 4 (stopping).

### Pattern: Component With Start/Stop

```go
type Component struct {
    cancel context.CancelFunc
    done   chan struct{}
}

func (c *Component) Start(ctx context.Context) error {
    ctx, c.cancel = context.WithCancel(ctx)
    c.done = make(chan struct{})
    go c.run(ctx)
    return nil
}

func (c *Component) Stop(ctx context.Context) error {
    c.cancel()
    select {
    case <-c.done:
        return nil
    case <-ctx.Done():
        return ctx.Err()
    }
}

func (c *Component) run(ctx context.Context) {
    defer close(c.done)
    t := time.NewTicker(time.Second)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case <-t.C:
            c.work(ctx)
        }
    }
}
```

This shape — Start, Stop, internal `run` — is the canonical microservice component for a ticker-based loop. Compose components via an orchestrator.

### Pattern: Service Manager

```go
type Service struct {
    components []*Component
}

func (s *Service) Run(ctx context.Context) error {
    for _, c := range s.components {
        if err := c.Start(ctx); err != nil {
            return err
        }
    }
    <-ctx.Done()
    return s.shutdown()
}

func (s *Service) shutdown() error {
    shutdownCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
    defer cancel()
    for i := len(s.components) - 1; i >= 0; i-- {
        if err := s.components[i].Stop(shutdownCtx); err != nil {
            log.Printf("component stop: %v", err)
        }
    }
    return nil
}
```

Reverse order for shutdown — last-started, first-stopped. Each component gets up to `shutdownCtx`'s deadline to exit cleanly.

### Pattern: Health Check Endpoint

```go
func (s *Service) HealthHandler(w http.ResponseWriter, r *http.Request) {
    for _, c := range s.components {
        if !c.Healthy() {
            http.Error(w, fmt.Sprintf("unhealthy: %s", c.Name()), http.StatusServiceUnavailable)
            return
        }
    }
    w.Write([]byte("ok"))
}
```

A component's `Healthy()` reports whether its ticker is firing within tolerance. Kubernetes liveness probes hit this.

### Pattern: Metrics Per Component

Each component publishes counters:

- ticks observed
- last tick time
- errors per period
- p95 work latency

These feed dashboards and alerts.

### Pattern: Graceful Degradation

If a component's downstream is unavailable, its ticker keeps firing — the work just errors. The component continues to be "running" but is non-functional. The orchestrator can detect this via metrics and decide whether to abort the service or continue.

This is a deliberate choice: do not crash on downstream failure. Tickers provide a heartbeat that the component is alive even when the work is failing.

---

## Tickers as Synchronization Primitives

A less-obvious use: using a ticker to introduce a regular synchronisation point between cooperating goroutines.

### Pattern: Batch Processor Sync

```go
func batchProcessor(ctx context.Context, in <-chan Item) {
    t := time.NewTicker(100 * time.Millisecond)
    defer t.Stop()
    var batch []Item
    for {
        select {
        case <-ctx.Done():
            return
        case item := <-in:
            batch = append(batch, item)
            if len(batch) >= 100 {
                flush(batch)
                batch = batch[:0]
            }
        case <-t.C:
            if len(batch) > 0 {
                flush(batch)
                batch = batch[:0]
            }
        }
    }
}
```

The ticker provides a maximum latency bound: even with no incoming items, a partial batch flushes every 100ms. This is a synchronisation point on the time axis.

### Pattern: Periodic Snapshot

```go
func snapshotter(ctx context.Context, data *atomic.Pointer[Snapshot], producer *Producer) {
    t := time.NewTicker(time.Second)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case <-t.C:
            snap := producer.Snapshot()
            data.Store(&snap)
        }
    }
}
```

The data is updated atomically each second. Readers see a consistent point-in-time view. The ticker drives the cadence; the atomic pointer is the synchronisation.

### Pattern: Distributed Lease Refresh

A distributed lock that uses leases requires periodic refresh:

```go
func keepLease(ctx context.Context, lock *DistLock) {
    t := time.NewTicker(lock.LeaseDuration / 3)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case <-t.C:
            if err := lock.Refresh(ctx); err != nil {
                log.Printf("lease refresh failed: %v", err)
                return // lose the lock
            }
        }
    }
}
```

The 1/3 fraction is conservative — refresh three times per lease lifetime, so a single dropped refresh does not lose the lock.

---

## Tickers and Cgo Profiling

If your code uses both tickers and cgo, profiling can be tricky.

### CPU Profiles With cgo

`pprof` collects CPU samples via SIGPROF. cgo code runs with the signal mask configured by the C library; samples may not be collected during cgo calls. This means CPU time spent in cgo is undercounted.

If your ticker handlers call into cgo, the profile may show low CPU usage on the handler, but real CPU is being burned in the cgo call.

### Allocation Profiles

Allocations in cgo are not Go heap allocations and do not appear in heap profiles. If you use cgo to call into a C allocator that backs your ticker work, the profile is misleading.

### Mixed Profiling

For accurate profiles of cgo-heavy code, use external tools (`perf` on Linux) alongside `pprof`. The combined view shows both Go and C costs.

This is more relevant for tickers when the ticker's handler is heavy cgo work — e.g. signaling a C library every period.

---

## Designing for High Tick Rate

If you need a ticker at hundreds of kHz, the standard library is at its limits. Some patterns help.

### Sub-Millisecond Periods

A 1us ticker fires a million times per second. The runtime can sustain this on a modern CPU, but the consumer must be fast — receive, work, return — in less than a microsecond on average.

For sub-microsecond per-fire work, the ticker is overkill. Use a tight loop with `runtime.Gosched()` if you need any yielding, or `time.Now()` reads for time-aware computation.

### Batched Tick Processing

Instead of one tick per work unit, batch:

```go
t := time.NewTicker(time.Millisecond)
defer t.Stop()
for range t.C {
    for i := 0; i < 1000; i++ {
        doWork()
    }
}
```

One ticker fire processes 1000 work units. Total throughput is 1 million per second with one tick per millisecond, not one tick per work unit.

### Manual Time Polling

For very high rates, avoid the channel send entirely:

```go
const period = 1 * time.Microsecond
last := time.Now()
for {
    if time.Since(last) >= period {
        doWork()
        last = last.Add(period)
    }
    runtime.Gosched()
}
```

This polls `time.Now()` in a tight loop. No channel, no scheduler dispatch. The cost is busy-waiting between work units.

Use this only when the standard library's ticker is provably insufficient. It is essentially what hard real-time code does.

---

## Trace Analysis Worked Example

A worked example of reading an execution trace from a ticker-heavy program.

### Setup

```go
package main

import (
    "context"
    "os"
    "runtime/trace"
    "time"
)

func main() {
    f, _ := os.Create("trace.out")
    trace.Start(f)
    defer trace.Stop()

    ctx, cancel := context.WithCancel(context.Background())
    for i := 0; i < 10; i++ {
        go worker(ctx, time.Duration(i+1)*100*time.Millisecond)
    }
    time.Sleep(3 * time.Second)
    cancel()
}

func worker(ctx context.Context, period time.Duration) {
    t := time.NewTicker(period)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case <-t.C:
            // simulate brief work
            time.Sleep(5 * time.Millisecond)
        }
    }
}
```

This spawns 10 workers with periods from 100ms to 1s, each doing 5ms of "work" per tick.

### Capturing

Run the program. It writes `trace.out`. Open it:

```bash
go tool trace trace.out
```

The browser opens a trace viewer.

### Reading

The "View trace" page shows per-P timelines. Each goroutine's activity is colored. Look for:

- **Timer fires**: small annotations marking ticker fire events.
- **Goroutine wake-ups**: arrows from a sender to a receiver.
- **GC pauses**: vertical bars across all Ps.
- **Idle Ps**: gaps in the timeline.

For our setup:

- Each tick fires roughly on schedule.
- The "Sleep 5ms" appears as a gap in the goroutine's activity.
- Different goroutines fire at different times, so the load is distributed.

### Diagnosing Problems

If the trace shows tickers firing late (long delay from the fire event to the consumer running), look at:

- Was the consumer's P busy with other work?
- Was GC running?
- Are too many goroutines runnable at once?

If the trace shows GC pauses dominating, tune GC (lower GOGC) or refactor allocation-heavy code.

If the trace shows scheduler latency, investigate GOMAXPROCS or work-stealing.

---

## Building Your Own Clock Abstraction

For production code that mixes real and fake time (in tests), a clock abstraction is essential. Here is a more complete implementation than the middle-level sketch.

### Full Interface

```go
type Clock interface {
    Now() time.Time
    Since(t time.Time) time.Duration
    Sleep(d time.Duration)
    After(d time.Duration) <-chan time.Time
    NewTicker(d time.Duration) Ticker
    NewTimer(d time.Duration) Timer
    AfterFunc(d time.Duration, f func()) Timer
}

type Ticker interface {
    C() <-chan time.Time
    Stop()
    Reset(d time.Duration)
}

type Timer interface {
    C() <-chan time.Time
    Stop() bool
    Reset(d time.Duration) bool
}
```

### Real Implementation

```go
type realClock struct{}

func NewRealClock() Clock { return realClock{} }

func (realClock) Now() time.Time                  { return time.Now() }
func (realClock) Since(t time.Time) time.Duration { return time.Since(t) }
func (realClock) Sleep(d time.Duration)           { time.Sleep(d) }
func (realClock) After(d time.Duration) <-chan time.Time {
    return time.After(d)
}

func (realClock) NewTicker(d time.Duration) Ticker {
    return &realTicker{t: time.NewTicker(d)}
}

type realTicker struct {
    t *time.Ticker
}

func (r *realTicker) C() <-chan time.Time { return r.t.C }
func (r *realTicker) Stop()                { r.t.Stop() }
func (r *realTicker) Reset(d time.Duration) { r.t.Reset(d) }

func (realClock) NewTimer(d time.Duration) Timer {
    return &realTimer{t: time.NewTimer(d)}
}

type realTimer struct {
    t *time.Timer
}

func (r *realTimer) C() <-chan time.Time      { return r.t.C }
func (r *realTimer) Stop() bool                { return r.t.Stop() }
func (r *realTimer) Reset(d time.Duration) bool { return r.t.Reset(d) }

func (realClock) AfterFunc(d time.Duration, f func()) Timer {
    return &realTimer{t: time.AfterFunc(d, f)}
}
```

### Fake Implementation Skeleton

```go
type FakeClock struct {
    mu     sync.Mutex
    now    time.Time
    timers []*fakeTimer
}

func NewFakeClock(start time.Time) *FakeClock {
    return &FakeClock{now: start}
}

func (c *FakeClock) Now() time.Time {
    c.mu.Lock()
    defer c.mu.Unlock()
    return c.now
}

func (c *FakeClock) Advance(d time.Duration) {
    c.mu.Lock()
    target := c.now.Add(d)
    // ... walk timers, fire those due ...
    c.now = target
    c.mu.Unlock()
}

// (rest of the fake implementation follows the middle-level sketch)
```

### Recommendation

Use [`github.com/benbjohnson/clock`](https://github.com/benbjohnson/clock) instead of writing your own. It is well-maintained, handles edge cases (e.g. AfterFunc + Reset), and includes a `Mock` that supports all the relevant operations.

When `testing/synctest` matures in Go 1.24, switch to it for new code.

---

## Specific Performance Optimizations

A grab-bag of optimisations relevant to ticker-heavy code.

### Optimization: Reduce Ticker Count

Coalesce tickers by sharing one ticker among many tasks. See the "Coalesced Timer Service" section.

Result: O(N) fewer timer heap operations per period.

### Optimization: Increase Periods

A 100ms ticker fires 10x more often than a 1s ticker. If the work tolerates 1s precision, use 1s. The cost difference is 10x at the runtime level.

### Optimization: Avoid Reset Storms

If you Reset thousands of times per second, the heap operations dominate. Coalesce reset signals so only one Reset fires per period.

### Optimization: Fewer Tickers, More Work Per Tick

If a ticker's handler does little work (e.g. checks a flag), consider whether the work can be inline-batched instead. One tick per second that processes a queue of pending tasks is cheaper than one tick per task.

### Optimization: Sync Reads with Atomic

If the ticker's handler frequently reads shared state, use `atomic.Pointer` or `atomic.Int64` rather than a mutex. Mutex acquisition is hundreds of nanoseconds; atomic reads are tens.

### Optimization: Avoid Sleeping Tickers

A ticker with a very long period (hours, days) sits in the heap doing nothing. Use `time.AfterFunc` for one-shot delays of that length. Frees the heap slot when the work completes.

### Optimization: Pre-Allocate Closures

If your tick handler creates closures every fire, allocations grow. Pre-create the closure once and reuse it.

### Optimization: GOMAXPROCS=NumCPU

Default is fine on most systems. Don't oversubscribe. Hyperthreads do not double timer throughput.

### Optimization: Profile, Don't Guess

Run `pprof` and `runtime/trace`. The actual cost of your tickers is usually not where you expect.

### Optimization: Track Drop Rate

Even if you do not formally measure drops, expose a counter. A creeping drop rate is the earliest sign that your consumer is slow.

```go
type Loop struct {
    ticks   atomic.Int64
    drops   atomic.Int64
    period  time.Duration
    start   time.Time
}

func (l *Loop) Run(ctx context.Context) {
    l.start = time.Now()
    t := time.NewTicker(l.period)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case now := <-t.C:
            l.recordTick(now)
            work()
        }
    }
}

func (l *Loop) recordTick(now time.Time) {
    l.ticks.Add(1)
    expected := int64(time.Since(l.start) / l.period)
    actual := l.ticks.Load()
    if expected > actual {
        l.drops.Add(expected - actual)
    }
}
```

Compares the count of received ticks against the count that *should* have fired given elapsed time. The difference is the drop count.

### Optimization: Bound the Handler

If the handler's worst case exceeds the period, you will drop ticks. Bound the worst case with a timeout:

```go
case <-t.C:
    ctx, cancel := context.WithTimeout(parent, l.period/2)
    if err := work(ctx); err != nil {
        log.Printf("work: %v", err)
    }
    cancel()
```

Half the period is a conservative bound. The handler must finish in half a period, leaving half for scheduler overhead and any subsequent fires.

---

## Final Notes on Practical Discipline

A few sentences I want to repeat because they are easy to forget.

- `Stop` is mandatory. The 1.23 GC integration is a safety net, not a hammock.
- `defer t.Stop()` runs on every exit path, including panic. Use it.
- `Reset` is for changing periods, not for re-phasing. To re-phase, Stop + new Ticker.
- The runtime's drop semantics are deliberate. If you are dropping ticks, your consumer is slow — fix the consumer, not the ticker.
- Jitter at startup, not at runtime, for de-correlating instances.
- `time.After` is a sometimes-trap. In loops, prefer `NewTimer` + `Reset` or a long-lived `Ticker`.
- `time.Tick` is a usually-trap. Avoid it in code that may run more than briefly.
- Tickers in tests should use a fake clock. Real-time tests slow CI and are flaky.
- Profile before optimising. The runtime is faster than your intuition.

Apply these consistently and ticker bugs become rare.

---

---

## The Future of Tickers

A few changes are on the Go horizon (as of 2024).

### testing/synctest

Experimental in 1.23, expected stable in 1.24 or 1.25. Lets you write tests against the standard `time` package with fast simulated time. May obsolete the `Clock` abstraction pattern.

### Timer-Specific GC

Continued refinement of GC's interaction with timers. Expect "forgot to Stop" leaks to become less catastrophic over time.

### Possible Reset Semantics Clarification

The current Reset docs are clear in 1.23 but the corner cases (Reset on stopped, Reset during fire) could be clarified further. Watch the release notes.

### Per-Timer Drop Statistics

A request that the runtime expose "tick drop count per ticker" has been discussed; not yet accepted. If you need this, instrument yourself.

---

## Reading the Source

The relevant files:

- `src/time/tick.go` — `Ticker`, `NewTicker`, `Stop`, `Reset`. ~100 lines.
- `src/time/sleep.go` — `Timer`, `NewTimer`, `Sleep`, `After`, `AfterFunc`. ~250 lines.
- `src/time/time.go` — `Time`, `Now`, formatting. Large but separable.
- `src/runtime/time.go` — `timer` struct, heap, `addtimer`, `deltimer`, `resettimer`, `runtimer`, `checkTimers`. ~1500 lines. Substantially different pre and post 1.23.

To navigate:

```
$ cd $(go env GOROOT)
$ ls src/time/
$ ls src/runtime/time*
```

Read `src/time/tick.go` end-to-end first. Then `src/time/sleep.go`. Then dip into `src/runtime/time.go` for the heap mechanics.

If you read post-1.23 source, the simplified design will make sense quickly. If you read 1.20–1.22, the state machine is intricate; read the comments at the top of `runtime/time.go` for orientation.

### Notable Commits

- `e5b1b5e0b6` (2014) — original timer subsystem.
- Go 1.14 commit `aa9b50d` — per-P timer heaps.
- Go 1.23 commit series — the redesign, including changes to channel buffer semantics and GC of timers.

For each commit, `git show` to read the change with surrounding context.

---

## Self-Assessment

Senior-level questions. You should be able to answer each in a paragraph or two, with reference to the runtime.

1. Sketch the `runtimeTimer` struct fields and explain the purpose of each.
2. Describe what `Stop` does, step by step, from the user call to the heap state.
3. Describe what `Reset` does, step by step. What is the difference pre- and post-Go-1.23?
4. What is the state machine of a pre-1.23 timer? List the states and the transitions.
5. Why did Go 1.14 move from a single global timer heap to per-P heaps?
6. What is a 4-heap and why is it used here?
7. What changed about the channel buffer of `t.C` in Go 1.23?
8. Why does `time.After` allocate more than `NewTimer` + `Reset`?
9. How does the runtime garbage-collect tickers post-1.23, and why is `Stop` still mandatory?
10. What is the worst-case complexity of `Stop`, `Reset`, and the fire path?
11. How does asyncpreempt affect ticker behaviour pre- and post-Go-1.14?
12. What does an execution trace of a healthy ticker look like, and what does an unhealthy one look like?
13. What happens to a ticker during a VM live migration?
14. Why is `time.Tick` discouraged at the runtime level?
15. What lock(s) does `Reset` acquire? What about `Stop`?
16. When would you build a custom timer wheel instead of using `time.Ticker`?
17. What is the memory cost per ticker, and how does that scale at 10 000 tickers?
18. Explain happens-before for a tick send/receive. What guarantees does the consumer get?
19. Compare Go's `Ticker` to Rust's `tokio::time::interval` and Java's `ScheduledExecutorService`. What are the key differences?
20. Read `src/time/tick.go` and `src/runtime/time.go`. Summarise how `NewTicker(d)` translates into runtime state.
21. What is the difference between sift-up and sift-down in the 4-heap? When is each used?
22. Trace the wake-up path from `sendTime` to the consumer goroutine running its handler.
23. What is work-stealing for timers? When does it kick in?
24. Walk through a Reset call where the calling goroutine is on a different P from the timer's owning P. What changes?
25. Why does the runtime release the timer lock before calling `f(arg, seq)`?
26. What is the difference between `timerWaiting`, `timerRunning`, `timerDeleted` (pre-1.23)?
27. Describe a scenario where you would build a hierarchical timing wheel instead of relying on per-P heaps.
28. How does GC interact with timers post-1.23?
29. What is the cost of `time.After` in a tight loop versus a reused `time.NewTimer`?
30. Given a pprof goroutine dump showing 1000 goroutines parked at `<-t.C`, what diagnostics do you run next?

If you can answer 25 or more without notes, you have senior-level grasp. If fewer, target the gaps.

### Deeper Questions for Discussion

These do not have one-line answers; they invite design conversation.

- How would you redesign the timer subsystem if you were starting from scratch with knowledge of Go's other primitives?
- What pieces of the timer state machine could be lifted into the language (rather than the runtime) without losing performance?
- If `time.Ticker.C` were unbuffered, what would change? Why is buffer-1 the right default?
- How might you implement priority among timers (e.g., "this ticker fires first if multiple are due")?
- Could the timer subsystem be implemented in user-space (no runtime support)? What would the cost be?
- What if `time.Now()` were not monotonic? How would tickers behave?
- How would you instrument the runtime's timer code to expose per-timer histograms (fire latency, drop count, drift)?

These questions have no single right answer; they reveal how deeply you have thought about the system.

---

## Summary

The senior level of `time.Ticker` is about the runtime. A `Ticker` is a thin user-facing wrapper around the runtime's `timer` struct, which lives in a per-P 4-heap (pre-1.23) or per-P slice (post-1.23). The runtime's `findrunnable` walks the heap and fires due timers inline; firing calls `sendTime` which does a non-blocking send on `t.C`.

`Stop` and `Reset` mutate the timer's state. Pre-1.23 used an elaborate atomic state machine to avoid lock contention; post-1.23 uses a simpler lock-based design. Edge cases — Stop racing Reset, Reset on a Stopped timer, Reset during a fire — are well-defined in both eras but observably different in some traces.

The channel buffer of `t.C` changed semantics in Go 1.23: from "drop on full" to "overwrite on full." Most user code does not notice; code that depends on the drop semantics may need attention.

Performance: a sustained tick costs ~1us per fire. A `Stop`+`NewTicker` cycle costs ~400ns. A `time.After` call allocates ~200 bytes. For most workloads these are negligible; for tickers-heavy services, profile and optimise.

The future: `testing/synctest` will let you write fast tests against the real `time` package. Continued GC integration will make "forgot to Stop" merely wasteful instead of catastrophic. The runtime's complexity is shrinking; user code stays simple.

Read the source. `src/time/tick.go` is short; `src/runtime/time.go` is dense but worth the time. The contract — `NewTicker`, `Stop`, `Reset`, `t.C` — has not changed in years, but the implementation underneath has evolved substantially. Knowing the implementation is what separates "I know how to use Ticker" from "I know how Ticker works."

### Closing Notes on Practice

Senior-level knowledge of `Ticker` is rarely tested by writing more `Ticker` code. It is tested by:

- Reviewing other people's ticker code and catching the subtle bugs.
- Diagnosing a service that has been leaking ticker goroutines for weeks.
- Deciding when to coalesce, when to jitter, when to use a wheel.
- Debating with a colleague whether `time.After` in the new code is fine (sometimes yes, sometimes no, the senior knows which).
- Reading an execution trace and pointing at the spot where the ticker fires late.

These are the marks of a senior who has internalised the material. The code itself is straightforward; the judgement is the difference.

### Recommendations for Further Study

- Read the Go 1.23 release notes section on timers.
- Read the original Go 1.14 timer proposal (golang/proposal/blob/master/design/26116-timers.md).
- Read `runtime/time.go` for your current Go version.
- Build the example wheel from this document and benchmark it against `time.Ticker` at scale.
- Write a service with a large number of tickers and profile it with `pprof` and `runtime/trace`.
- Contribute to a project that uses tickers extensively (Kubernetes, etcd, Cortex, etc.) and read its conventions.

The material in this document is dense. You will not absorb it in one read. Come back to it when you face a real ticker problem; the relevant section will then click into place.

### A Final Heuristic

When in doubt about whether your ticker usage is "senior" or "middle":

- If you can explain the runtime-level behaviour of your code, you are senior.
- If you can predict how the code will degrade under unusual load (10x tickers, 10x periods, 10x consumers), you are senior.
- If you have read at least once through `runtime/time.go` and understood it, you are senior.
- If your tests run in microseconds and your prod code runs at the intended cadence forever, you are senior.

The bar is high but reachable. Most Go programmers never need to reach it. If your job calls for it, this document is a roadmap.

[← Back to Ticker index](./)
