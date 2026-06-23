---
layout: default
title: Senior
parent: AfterFunc
grand_parent: Time-Based Concurrency
ancestor: Go
nav_order: 4
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/16-time-based-concurrency/02-afterfunc/senior/
---

# time.AfterFunc — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [What This File Adds](#what-this-file-adds)
3. [The Runtime Timer Model](#the-runtime-timer-model)
4. [runtimeTimer in Detail](#runtimetimer-in-detail)
5. [The Timer Heap, P-Local](#the-timer-heap-p-local)
6. [When the Callback is Scheduled](#when-the-callback-is-scheduled)
7. [Stop in the Runtime](#stop-in-the-runtime)
8. [Reset in the Runtime](#reset-in-the-runtime)
9. [The Pre-1.23 and Post-1.23 Eras](#the-pre-123-and-post-123-eras)
10. [Memory Layout and Allocation](#memory-layout-and-allocation)
11. [Latency Characteristics](#latency-characteristics)
12. [Cost at Scale](#cost-at-scale)
13. [Interaction with the Scheduler](#interaction-with-the-scheduler)
14. [Network Polling and Timers](#network-polling-and-timers)
15. [GC and Timers](#gc-and-timers)
16. [Profiling Timer Behaviour](#profiling-timer-behaviour)
17. [Architectural Patterns](#architectural-patterns)
18. [Senior-Level Exercises](#senior-level-exercises)
19. [Senior-Level Tricky Questions](#senior-level-tricky-questions)
20. [Cheat Sheet](#cheat-sheet)
21. [Self-Assessment](#self-assessment)
22. [Summary](#summary)
23. [Further Reading](#further-reading)
24. [Diagrams](#diagrams)

---

## Introduction

This file is about what is actually happening inside the Go runtime when you call `time.AfterFunc`. Some of this knowledge is necessary to design systems that handle hundreds of thousands of timers; some of it is just deeply satisfying.

By the end of this file you will:

- Have read or mentally simulated the relevant parts of `runtime/time.go`.
- Be able to explain what `runtimeTimer` looks like, where it lives, and how it gets there.
- Understand the P-local timer heap and how the runtime decides which P's heap a timer joins.
- Know when and where the callback goroutine is spawned.
- Understand the meaning of every byte of `Stop()`'s and `Reset()`'s return.
- Know the difference between pre-1.23 timers (with `timerStatus` constants) and the post-1.23 simplification.
- Understand timer cost at scale (10K, 100K, 1M timers): heap depth, scheduler poll cost, GC pressure.
- Be able to recommend or design batching strategies for high-cardinality timer workloads.

You do **not** need to know the runtime in its entirety; we restrict ourselves to the timer machinery and adjacent scheduler code.

---

## What This File Adds

`junior.md` and `middle.md` treat `AfterFunc` as a black box with well-defined semantics. This file opens the box. We will:

- Trace a single `AfterFunc(d, f)` call from user code to the heap insertion.
- Trace a single fire from heap pop to goroutine spawn.
- Show what `Stop` actually does — which fields it touches and which transitions it makes.
- Compare the pre-1.23 timer state machine (with `timerNoStatus`, `timerWaiting`, `timerModifiedLater`, etc.) to the post-1.23 simplified machine.
- Explain why `Reset` once had a "drain dance" and now does not.
- Quantify the cost of a million timers.

---

## The Runtime Timer Model

### One model, three views

We can describe Go's timer machinery at three levels of abstraction:

**View 1 — User API.** `time.AfterFunc(d, f) -> *Timer`. Callback runs in a goroutine. `Stop` and `Reset` work as documented.

**View 2 — Runtime data structures.** Each P (logical processor) has a heap of pending timer entries. A timer entry is a `runtimeTimer` with fields like `when`, `period`, `f`, `arg`, `seq`, and `status`. The runtime polls these heaps from various places.

**View 3 — Implementation files.** `runtime/time.go` and `runtime/proc.go` (or `runtime/lock_futex.go` etc. for the netpoller integration). Reading these files is the most precise way to understand the model.

This file works mostly at View 2, dropping into View 3 occasionally to anchor claims to real code.

### What is a "P"?

A **P** (logical processor) is the Go runtime's unit of scheduling. By default, there is one P per CPU core (`GOMAXPROCS=NumCPU`). Each P has its own goroutine run queue and its own timer heap. P's also share work via a global queue and stealing.

For timers, the key fact is: a P owns a min-heap of `runtimeTimer` entries, indexed by their `when` field.

### How a timer lands on a P

When `time.AfterFunc` is called from a goroutine running on P `n`, the timer is inserted into P `n`'s local heap. (There are some special cases — for example, the global P 0's heap during startup — but in steady state, a timer joins the local P's heap.)

The timer stays on that P's heap unless the P is destroyed (during GOMAXPROCS reduction). If P `n` is gone, the timer migrates to another P's heap as part of P shutdown.

### How a timer fires

When a P needs to pick the next work to run — for example, in its main scheduler loop, or at certain housekeeping points — it checks its local timer heap. The min-element's `when` is compared to the current monotonic time. If `when <= now`, the timer is "ready."

For an `AfterFunc` timer (one with a non-nil `f` and nil `C`), "ready" means:

1. Pop the timer from the heap.
2. Mark the timer as fired.
3. Spawn a goroutine to run `f`.

The newly spawned goroutine joins the P's run queue (or another P's, depending on load balancing).

---

## runtimeTimer in Detail

### The struct (post-1.23 simplified view)

```go
// Approximate; the actual struct lives in runtime/time.go.
type timer struct {
    next     *timer
    prev     *timer

    when     int64           // monotonic time, in ns
    period   int64           // for repeating; 0 for one-shot
    f        func(any, uintptr) // the function to run
    arg      any
    seq      uintptr

    status   atomic.Uint32   // pre-1.23: timerWaiting, timerModified...
                             // post-1.23: simpler state
    nextWhen int64           // pre-1.23 only

    // ...
}
```

The user's `time.Timer` struct wraps this:

```go
type Timer struct {
    C <-chan Time
    r runtimeTimer // The runtime's view of this timer
}
```

For an `AfterFunc` timer:

- `C` is nil.
- `r.f` is a small wrapper that calls the user's callback.
- `r.arg` carries the user's function value.

The wrapper exists because the runtime's `f` signature is `func(any, uintptr)`, not `func()`. The wrapper unwraps and invokes the user's function.

### The wrapper, conceptually

```go
// Approximate.
func goFunc(arg any, _ uintptr) {
    go arg.(func())() // spawn a goroutine running the user's f
}
```

This is why the callback runs in a new goroutine — the wrapper unconditionally does `go arg.(func())()`. There is no path where the callback runs synchronously.

### `when` is monotonic

`when` is stored as an `int64` nanoseconds value on the monotonic clock. The runtime uses `nanotime()` to read it, never `time.Now()`. This is why wall-clock adjustments do not perturb timers.

A `time.Duration` of 0 means `when = now`. A negative duration means `when < now`, which the runtime treats as "fire immediately."

### `period` is 0 for AfterFunc

`AfterFunc` always sets `period = 0`. The runtime knows that means "one-shot."

For `time.NewTicker`, the same `runtimeTimer` is used with a non-zero `period`, and after firing, the runtime advances `when += period` and re-inserts. `AfterFunc` does not use this; for repetition, you self-reschedule with `Reset` from inside the callback.

### `seq`

The `seq` field is used for identification in some accounting paths. For us, treat it as opaque.

---

## The Timer Heap, P-Local

### A 4-ary min-heap

Each P holds its timers in a min-heap implementation. The heap is keyed on `when`. Historically the heap is 4-ary (each node has up to 4 children), chosen for cache efficiency. The exact arity is an implementation detail.

Operations on the heap:

- `siftup` after insertion (when a new entry is added).
- `siftdown` after removal (when the top is popped or a deletion happens).
- `peek` to check the earliest `when`.

All these are O(log n).

### Why P-local

A global heap of all timers would require global synchronisation on every insertion, deletion, and check. By making the heap P-local, the runtime amortises the cost across cores. Each P touches only its own heap most of the time.

When P `n` runs out of work, it may "steal" goroutines from another P; the equivalent for timers exists but is rarer.

### Timer-heap maintenance

The runtime checks the heap during:

- The scheduler loop, when picking the next goroutine to run.
- The sysmon goroutine, which wakes up periodically to handle things.
- `runtime.GC()` and related calls.
- The netpoller, when waking from a network event.
- `runtime.Gosched()` (briefly).

So "the timer fires after `d`" is really "the runtime notices it sometime after `d`, when it next does a scheduler iteration."

### Throughput vs. latency tradeoff

The runtime balances:

- **Latency:** firing the timer near the requested time.
- **Throughput:** not spending too much CPU polling.

In practice this means firing latency is sub-millisecond on a lightly loaded system, and can climb under load. For wall-clock precision better than ~1 ms, do not rely on Go timers.

---

## When the Callback is Scheduled

### Two phases: pop and spawn

When a P notices an expired timer on its heap, the runtime executes:

```
1. Lock the timer's status.
2. Remove the timer from the heap.
3. Unlock.
4. Call the timer's f with its arg.
```

For an `AfterFunc` timer, `f` is the wrapper that does `go userFunc()`. So step 4 spawns a goroutine.

### Spawn cost

Spawning a goroutine is cheap (allocate from a pool of free goroutine descriptors, set up the stack, push to the run queue). A few hundred nanoseconds typical.

### Scheduler latency on top

The spawned goroutine joins the P's run queue. The runtime will run it next, or after the currently-running goroutine yields. Under low load this means "almost immediately." Under high load it may wait microseconds or milliseconds.

### Why not run f directly?

A simpler model would be: the runtime calls `f` synchronously, on the current goroutine, when it notices the timer. This has problems:

- `f` could be slow, delaying scheduler work.
- `f` could block, halting the P entirely.
- `f` could be malicious or buggy, breaking runtime invariants.

By spawning a goroutine, the runtime isolates `f` from the scheduler. The cost is the goroutine spawn; the benefit is robustness.

### Multiple expired timers

If the heap has 10 expired timers, the runtime pops each and spawns 10 goroutines. They run in parallel (subject to GOMAXPROCS) and there is no ordering guarantee among them.

---

## Stop in the Runtime

### What `Stop()` does

```go
func (t *Timer) Stop() bool {
    return stopTimer(&t.r)
}
```

`stopTimer` looks at `t.r.status` (in pre-1.23) or invokes a state transition (in post-1.23). If the timer is currently in a P's heap, it removes it. The return value is whether the removal happened.

### Pre-1.23 status states

```
timerNoStatus       // freshly created, not yet on a heap
timerWaiting        // on the heap, not yet expired
timerRunning        // f is currently being called (briefly)
timerDeleted        // marked for removal
timerRemoving       // in the process of being removed
timerRemoved        // removed
timerModifying      // someone is mutating
timerModifiedEarlier
timerModifiedLater
timerMoving         // being moved to another P
```

The full state machine had ~10 states and was source of subtle bugs and locking complexity. Each method on the timer (`Stop`, `Reset`, the runtime's "fire" path) had to handle all the states.

### Post-1.23 simplification

Go 1.23 reorganised timers around an `atomic` head and a much simpler state model. The user-visible behaviour is unchanged; the internal representation is cleaner.

For our purposes, the post-1.23 state model has effectively:

- "Active" (on a heap).
- "Inactive" (not on a heap).

`Stop` succeeds iff the timer was active and is now inactive. `Reset` is similar but conditional on the prior state for its return value.

### Stop's locking

`Stop` takes the P's timer-heap lock briefly to remove the entry. It is a short critical section. There is no user-visible blocking — `Stop` does not wait for the callback's goroutine.

### Stop returning false: three flavours

We can distinguish three reasons `Stop` returns false:

1. The timer had already fired (callback running or done).
2. The timer was already stopped (by a previous `Stop`).
3. The timer never existed (programmer error — using a zero `time.Timer`).

The user-facing API does not distinguish these. From the runtime's perspective:

- Case 1: pre-1.23 status was `timerRemoved` or `timerRunning`; post-1.23 status was "not on heap."
- Case 2: same as case 1, since both `Stop` and "fire then remove" land in the same state.
- Case 3: the timer's `r` field is zero; the runtime returns false.

If you need to know case 1 vs case 2, you must track yourself.

---

## Reset in the Runtime

### What Reset does

```go
func (t *Timer) Reset(d Duration) bool {
    return resetTimer(&t.r, when(d))
}
```

`resetTimer` updates the timer's `when` to `now + d` and ensures it is on a heap. The return value reflects whether the timer was active before the call.

### Reset on active timer

1. Lock the timer's status.
2. Remove from the current heap position.
3. Update `when`.
4. Reinsert into the heap.
5. Unlock.

Cost: O(log n) for the reinsert, plus locking overhead.

### Reset on inactive timer

1. Lock the timer's status.
2. Update `when`.
3. Insert into the heap.
4. Unlock.

The boolean return is `false` in this case.

### Reset on a timer that has fired but is still being processed

There is a very brief window where the timer is "running" (the runtime has popped it, is about to call `f`). During this window, `Reset` will see the running state and either wait or fail. Pre-1.23 this had its own state; post-1.23 the runtime serialises around `f` invocation.

### Reset and lock ordering

If you `Reset` from inside the callback `f`, the runtime is in the middle of "running" the timer. The Reset call must not deadlock. The implementation handles this by avoiding recursive locks on the timer state.

In practice, `Reset` inside `f` "just works" — you don't need to think about it.

---

## The Pre-1.23 and Post-1.23 Eras

A short history.

### Pre-1.10: wall clock

Before Go 1.10, timers were based on the wall clock. If the system clock jumped forward (NTP, daylight savings), pending timers fired immediately. If it jumped backward, they fired late. This caused havoc.

### Go 1.10: monotonic clock

`time.Time` gained a monotonic component. Timers now use the monotonic clock. Wall-clock adjustments don't perturb them.

### Go 1.14: async preemption

Long-running goroutines (including timer callbacks!) can be preempted by the runtime, regardless of whether they reach a safe point. This makes "callback runs for a long time" safer for the rest of the program.

### Go 1.18: timer rewrite

The internal representation was rewritten for performance, but with the same `timerStatus` constants. Many subtle bugs in the old implementation were resolved.

### Go 1.21: context.AfterFunc

Added as a peer to `time.AfterFunc` for context-driven scheduling.

### Go 1.23: simplification

The `timerStatus` constants were reduced; the drain dance for `Reset` became unnecessary. The implementation became significantly easier to reason about.

### Go 1.24: synctest

`testing/synctest` allows deterministic time-driven tests.

For the user-facing API: `time.AfterFunc(d, f) -> *Timer`, `Stop`, `Reset` have been stable since Go 1.0.

---

## Memory Layout and Allocation

### Allocations

A single `time.AfterFunc(d, f)` call allocates:

- One `time.Timer` struct (heap-allocated; the runtime keeps a reference).
- Possibly a closure on the heap (if `f` is a closure capturing variables).
- The `time.Timer`'s `r runtimeTimer` is embedded; no separate allocation.

A reused `*Timer` via `Reset(d)` allocates **nothing** in user code. The same `*Timer` is reused; the same closure is reused.

### Cost per timer

Each timer occupies roughly:

- ~120 bytes for the `runtimeTimer` (varies by Go version and platform).
- Plus the size of the closure (closure header + captured variables).
- Plus heap-bookkeeping overhead.

A million timers thus use ~150–250 MB just for the timer structs, plus whatever the closures hold.

### Closure size

A closure capturing only ints is small (~24 bytes). A closure capturing a `*Request` pointer is small but pins the request. A closure capturing a 1 KB buffer pins 1 KB.

This is why "what does the closure capture?" is the most important question for timer-heavy services.

### Pooling

The runtime maintains an internal pool of `runtimeTimer` slabs to reduce allocation pressure under churn. Reused timers come from this pool. You cannot inspect it from user code, but the effect is that creating and stopping many timers is cheaper than creating and never stopping them — because stopped timers can be reused, while never-stopped ones cannot until they fire.

---

## Latency Characteristics

### Best case

Sub-millisecond. On a lightly loaded machine, a 10 ms `AfterFunc` typically fires within ~10.05 ms.

### Worst case

Under heavy load (CPU pinned, GC active), individual timer fires can be late by 10s of milliseconds. Catastrophic cases (GC stop-the-world phases in pre-1.14 Go) could be 100s of ms.

### Jitter sources

- Scheduler polling interval — the runtime checks the heap at scheduler iterations, which happen on goroutine yields, blocking calls, and periodically.
- GC — though sub-millisecond pauses are typical, busy GC can add several hundred microseconds.
- OS thread contention — if all OS threads are busy doing other work, timer firing is delayed.
- Power management — on laptops with C-states, sub-millisecond timers can be late by milliseconds.

### Don't rely on precision

For deadlines that matter to users (e.g. "this request must complete within 200 ms"), set the timer for slightly less than the deadline (e.g. 150 ms) to give yourself slack.

---

## Cost at Scale

### Small (1–100 timers)

Negligible. Don't think about it.

### Medium (100–10K timers)

Still negligible. Heap operations are O(log n) ≤ 14 even at 10K.

### Large (10K–100K timers)

Visible in profiles. `runtime.siftdownTimer` and similar functions appear in CPU profiles. The runtime spends some CPU on heap maintenance.

### Very large (100K–1M timers)

Significant. Memory budget for timers alone runs into hundreds of MB. CPU for heap operations is several percent. The number of goroutine spawns at fire time can be a spike — many goroutines firing simultaneously stresses the GC and the scheduler.

### Pathological (>1M timers)

You should not be doing this. If your design requires it, consider batching, sharding (timers grouped by deadline bucket), or moving to a custom timing structure (e.g., a hierarchical timing wheel — see Varghese & Lauck 1996).

### Sharding pattern

Instead of one timer per entry, group entries by deadline bucket (e.g. round to the nearest 100 ms):

```go
type Bucket struct {
    deadline time.Time
    entries  []entry
    timer    *time.Timer
}

func (s *Scheduler) Schedule(e entry) {
    bucket := s.bucketFor(e.deadline.Truncate(100 * time.Millisecond))
    bucket.entries = append(bucket.entries, e)
    if bucket.timer == nil {
        bucket.timer = time.AfterFunc(time.Until(bucket.deadline), bucket.fire)
    }
}
```

A million entries with 1-second buckets becomes ~1000 timers. Much more manageable.

### Hierarchical timing wheel

For truly extreme scale (millions of timers, sub-millisecond accuracy), hierarchical timing wheels are the textbook structure. Insertion and deletion are O(1) amortised. The Linux kernel uses this for its `timer_list` interface. Go's standard library does not — the heap is simpler and good enough for most use cases.

---

## Interaction with the Scheduler

### Scheduler P loop

Each P runs a loop that picks the next runnable goroutine. At certain points it checks `runtime.checkTimers` (or equivalent) to fire any expired timers on its local heap. This is how timers are integrated with normal scheduler work — no separate "timer thread."

### When P is idle

If all P's are idle (no goroutines to run), the runtime parks them. But it needs to wake up when a timer is about to fire. The runtime computes "when is the next timer?" and schedules a wakeup (typically via `futex` on Linux or equivalent).

This means: even with no work to do, a Go program with pending timers wakes the CPU periodically. For battery-powered devices, lots of pending timers can drain battery.

### When P is busy

A P that is running a long goroutine still checks timers periodically. The async preemption signal (Go 1.14+) ensures this happens within a few milliseconds at most.

### sysmon

The sysmon goroutine is a background goroutine that wakes up periodically (every 20 µs typically, backing off) to handle housekeeping: nudging stalled P's, retaking syscall-blocked P's, checking timers. It is a backup for timer firing in cases where the normal scheduler loop misses.

---

## Network Polling and Timers

### The netpoller

Go's network I/O is implemented via the netpoller, which uses epoll on Linux, kqueue on BSD, IOCP on Windows. The poller goroutine blocks on a system call waiting for I/O readiness; when something arrives, it wakes goroutines.

The netpoller is also responsible for waking on timer expirations. When parking on `epoll_wait` (or equivalent), the runtime computes the timeout as "duration until next timer" and passes it. If no I/O arrives, the call returns at the timeout, the runtime fires timers, and life continues.

This integration is why timers fire promptly even when the program is idle on I/O.

### Implication

If your program is mostly waiting on the netpoller (e.g. a server doing nothing because no requests are coming), timer accuracy is good — the netpoller's timeout drives wakeups.

If your program is mostly compute (a CPU-bound loop), timer accuracy depends on async preemption. Still good, but with more jitter.

---

## GC and Timers

### Timers and the GC

`runtimeTimer` entries are heap-allocated. The GC scans them like any other heap object. The `f` field references a function value; the function value's closure (if any) is also on the heap.

For each live timer, the chain is:

```
timer entry -> f (function value) -> closure -> captured variables
```

The GC visits all of these. For a million timers each capturing a 1 KB struct, that is 1 GB of pinned heap that the GC has to traverse.

### Stop and GC

When you `Stop` a timer and drop your reference, the runtime's reference to the timer entry should also go away (the entry is removed from the heap). The GC will then collect everything reachable only from the timer.

However: if you stored the `*time.Timer` in a map and forgot to delete the map entry, the timer entry and its closure remain reachable. Classic leak.

### Timer churn and GC pressure

Creating and stopping many timers per second creates allocation pressure. The runtime mitigates with a pool, but high-frequency churn can still trigger more frequent GC cycles.

### Recommendation

For high-frequency scheduling, prefer `Reset` on a reused timer. The allocation count drops dramatically.

---

## Profiling Timer Behaviour

### CPU profile

```bash
go tool pprof http://localhost:6060/debug/pprof/profile
```

Look for `runtime.siftdownTimer`, `runtime.siftupTimer`, `runtime.checkTimers`, `runtime.addtimer`, `runtime.modtimer`. High percentages in these functions indicate heavy timer activity.

### Heap profile

```bash
go tool pprof http://localhost:6060/debug/pprof/heap
```

Look for allocations stemming from `time.AfterFunc` or `time.NewTimer`. If timers dominate the heap, you may need to switch to a batching strategy.

### Goroutine profile

```bash
go tool pprof http://localhost:6060/debug/pprof/goroutine
```

If you have many goroutines stuck in `time.Sleep` or `<-time.After`, that is a candidate for `AfterFunc` replacement (no parked goroutine).

### `runtime.MemStats`

`MemStats.NumGoroutine` for the goroutine count.

### Tracing

```bash
GODEBUG=schedtrace=1000 ./your-program
```

Prints scheduler stats every second, including run queue lengths. Spikes correlate with timer fire bursts.

```bash
go tool trace trace.out
```

The execution trace visualises goroutine spawns from timer fires.

### Profiling AfterFunc specifically

There is no first-class "timer profile" in pprof, but the CPU profile attribution to timer-related functions is usually enough. If you suspect a leak (timers piling up), use the heap profile and look at the retention chain.

---

## Architectural Patterns

### Pattern 1: One timer per resource

Used in `IdleConn`, simple TTL caches, per-request deadlines. Works well up to ~100K resources. Beyond that, switch to batching.

### Pattern 2: Single sweeper

One periodic timer fires and processes all expired entries. Used in many in-memory caches.

```go
func (c *Cache) sweep() {
    c.mu.Lock()
    now := time.Now()
    for k, exp := range c.expiry {
        if exp.Before(now) {
            delete(c.items, k)
            delete(c.expiry, k)
        }
    }
    c.mu.Unlock()
    time.AfterFunc(c.sweepInterval, c.sweep)
}
```

Sweeping is O(n) in the cache size; acceptable for small caches or when sweep frequency is low.

### Pattern 3: Earliest-deadline timer

Keep a sorted data structure of deadlines. Set one `*time.Timer` for the earliest deadline. When it fires, process all entries due, then re-arm for the next earliest deadline.

```go
type Scheduler struct {
    mu       sync.Mutex
    timer    *time.Timer
    pending  *deadlineHeap // entries sorted by deadline
}

func (s *Scheduler) arm() {
    s.mu.Lock()
    defer s.mu.Unlock()
    if s.pending.Len() == 0 {
        return
    }
    next := s.pending.Peek()
    d := time.Until(next.deadline)
    if d < 0 { d = 0 }
    if s.timer == nil {
        s.timer = time.AfterFunc(d, s.fire)
    } else {
        s.timer.Reset(d)
    }
}

func (s *Scheduler) fire() {
    s.mu.Lock()
    now := time.Now()
    var due []entry
    for s.pending.Len() > 0 && !s.pending.Peek().deadline.After(now) {
        due = append(due, s.pending.Pop())
    }
    s.mu.Unlock()
    for _, e := range due {
        go e.handler() // or whatever
    }
    s.arm()
}
```

Each operation is O(log n) — heap insert/remove. Total memory is O(n). This pattern scales to millions of entries with sub-millisecond response.

### Pattern 4: Hashed timing wheel

A circular buffer of buckets, each bucket holds a list of entries due in that bucket's time slice. Insertion and removal are O(1) amortised. A "current bucket" pointer advances every tick.

For implementations and tradeoffs, see Varghese & Lauck 1996, "Hashed and Hierarchical Timing Wheels."

Not in the Go standard library, but plenty of third-party libraries implement it (e.g. for game servers, network monitoring).

### Pattern 5: Coarse-grained ticker + work queue

Drop per-entry timers entirely. Have a coarse ticker (every 100 ms) that scans for entries to process. Submit them to a worker pool.

```go
ticker := time.NewTicker(100 * time.Millisecond)
for range ticker.C {
    for _, e := range expired() {
        workQueue <- e
    }
}
```

Loses sub-100ms accuracy. Gains scalability — no timer scaling concerns at all. Used in many high-throughput systems where deadlines are "fire-and-forget."

---

## Senior-Level Exercises

### E1. Read runtime/time.go

Open the Go source for your installed version. Read `addtimer`, `deltimer`, `modtimer`, and `runtimer`. Sketch the state diagram.

### E2. Measure timer overhead

Write a benchmark that creates and stops `N` timers. Plot N vs. time. Verify O(N log N) for creation plus stop.

### E3. Build the earliest-deadline scheduler

Implement Pattern 3 above. Compare its memory and CPU profile to per-entry timers at 1K, 10K, 100K, 1M entries.

### E4. Verify the fire latency distribution

Schedule 10K timers all firing in 1 second. Record (actual_fire_time - scheduled_fire_time) for each. Plot the distribution. Compute p50, p99, p999.

### E5. Build a hashed timing wheel

In Go. Aim for O(1) insertion, deletion, and tick processing.

### E6. Compare AfterFunc and After in a hot select

Write a 1M-iteration loop that selects on `ctx.Done()` and `time.After(time.Second)`. Profile the allocations. Replace `time.After` with a reused `*time.Timer`.

### E7. Build a thundering-herd-safe deadline gate

Many goroutines wait for a deadline shared across them. Use a single `AfterFunc` (or `context.AfterFunc`) plus a sync.Cond or close-of-channel. Verify no spurious wakeups.

### E8. Profile a real service

Pick any Go service you maintain. Look at the goroutine profile. Count time.Sleep and time.After waits. Identify two that could be `AfterFunc` instead.

### E9. Implement context.AfterFunc from scratch

Using only `time.AfterFunc` and `ctx.Done()`, build your own version. Compare your implementation's API and behaviour to the standard library's.

### E10. Test deterministically

Take any of the patterns from `middle.md` (debouncer, watchdog, idle conn) and rewrite to inject a clock interface. Write tests that drive the clock manually.

---

## Senior-Level Tricky Questions

**SQ1.** Where does a timer live in memory after `AfterFunc` returns?

**A.** On the heap. The `time.Timer` struct is heap-allocated; the runtime holds a reference; user code may hold the returned pointer.

**SQ2.** Does the timer migrate between P's?

**A.** Normally no; it stays on the heap of the P that called `AfterFunc`. If that P is destroyed (GOMAXPROCS reduction), it migrates.

**SQ3.** What is the lock granularity for timer operations?

**A.** Per-P. Each P's timer heap has its own lock. This is why timer ops are cheap — no global contention.

**SQ4.** Does the runtime ever spawn a callback goroutine without using a `go` statement?

**A.** Effectively yes — the runtime has internal `newproc`-like calls that bypass the user-facing `go` keyword. Same goroutine result; different code path.

**SQ5.** Why isn't there a "wait for callback" API?

**A.** Three reasons: (1) most callbacks are idempotent and don't need it. (2) Adding it would require a Cond or channel on every timer, inflating memory. (3) Users who need it can build it cheaply with a channel.

**SQ6.** Why was the pre-1.23 timer state machine so complex?

**A.** It evolved organically as bugs were fixed. Each new edge case added a state. Go 1.23 finally consolidated.

**SQ7.** How does the runtime handle `AfterFunc(d, f)` where d is very large (e.g. 100 years)?

**A.** Just like any other duration. The heap entry has a huge `when`. It sits there forever until you `Stop` or the program exits.

**SQ8.** What is the maximum representable duration?

**A.** `math.MaxInt64` nanoseconds, about 292 years.

**SQ9.** Can the runtime fire a timer before its `when`?

**A.** No, never. `when` is the earliest moment.

**SQ10.** How does Go choose which P to fire a timer on?

**A.** Whichever P notices the expired entry first (and they only check their own heap). Effectively, the P that owns the heap.

**SQ11.** What happens if `GOMAXPROCS` is set to 1?

**A.** One P, one timer heap, one place where timer firing happens. Single-threaded behaviour. Timer accuracy is fine but timers fire on the same OS thread as everything else, so a busy main goroutine can starve them slightly.

**SQ12.** Does `runtime.LockOSThread()` affect timer firing?

**A.** Timers fire on the P, which can be on any OS thread. `LockOSThread` pins a goroutine to a thread, but timers can still fire on other threads (and their callbacks spawn fresh goroutines, which can run anywhere).

**SQ13.** What is the relationship between sysmon and timers?

**A.** Sysmon is a fallback path: if a P is stuck (in a long syscall, or compute without preemption), sysmon notices and either steals work or fires timers itself.

**SQ14.** Why doesn't the runtime use a kernel timer (timerfd, kevent)?

**A.** Because Go has its own scheduler. A kernel timer would deliver to one OS thread, which would have to dispatch — adding latency and complicating multiplexing. Go uses the kernel only for `epoll`/`kqueue`-style polling with a timeout.

**SQ15.** Can a timer with `period > 0` be created from user code?

**A.** Only via `time.NewTicker`. `AfterFunc` and `NewTimer` both create one-shot (period=0) timers.

**SQ16.** Why is `t.C` nil for an AfterFunc timer?

**A.** Because the runtime, at fire time, takes a different path: spawn a goroutine to run `f`, do not send on `C`. The `time.Timer` struct is shared with channel-style timers, but the `C` field is unused.

**SQ17.** Is the timer's `when` updated on Reset?

**A.** Yes. `Reset(d)` sets `when = now + d` and re-inserts into the heap.

**SQ18.** Why doesn't AfterFunc accept a `context.Context`?

**A.** Backwards compat — the API predates `context.Context`. The modern replacement is to combine `time.AfterFunc` with `context.AfterFunc`, or use one of them depending on the trigger.

**SQ19.** Does the runtime check timers on every scheduler iteration?

**A.** No, only when necessary — typically when a goroutine blocks, a goroutine completes, or sysmon notices. The exact policy varies by Go version.

**SQ20.** How does the timer interact with goroutine preemption?

**A.** A long-running callback is preempted like any goroutine. The async preemption (Go 1.14+) ensures it doesn't block the P forever. The timer itself is not affected — once fired, the runtime is done with it.

---

## Cheat Sheet

```go
// Architecture
// - Each P has a local min-heap of timers, keyed on `when` (monotonic ns).
// - The runtime checks heaps during scheduler iterations.
// - At fire time: pop, mark fired, spawn a goroutine to run f.
// - Stop, Reset are O(log n) heap ops; non-blocking on user code.

// Cost model (rough)
// - One timer: ~150 bytes (runtimeTimer + closure header).
// - Goroutine spawn on fire: a few hundred ns.
// - Heap insert/delete: O(log n), <100 ns at moderate n.

// Patterns by scale
// - <10K timers: per-entry timer, no issue.
// - 10K-100K: profile; consider reuse via Reset.
// - 100K-1M: batch into buckets or earliest-deadline scheduler.
// - >1M: hashed timing wheel or pivot architecture.

// Profiling
// - CPU: look for runtime.siftdownTimer, runtime.checkTimers.
// - Heap: look for runtimeTimer in allocations.
// - Goroutines: look for goroutines stuck in time.Sleep / <-time.After.

// Go version timeline
// - 1.10: monotonic clock; timers no longer affected by wall-clock jumps.
// - 1.14: async preemption.
// - 1.18: internal timer rewrite.
// - 1.21: context.AfterFunc.
// - 1.23: timer simplification; no Reset drain dance for NewTimer.
// - 1.24: testing/synctest.
```

---

## Self-Assessment

- [ ] I can describe `runtimeTimer`'s key fields.
- [ ] I can describe the P-local heap and how a timer lands on it.
- [ ] I can describe the path from heap pop to callback execution.
- [ ] I can explain what Stop and Reset do at the heap level.
- [ ] I can name the pre-1.23 state machine and explain why it simplified.
- [ ] I can estimate the cost of 100K vs 1M timers.
- [ ] I can name three batching strategies and when to use each.
- [ ] I can use pprof to identify timer-related cost.
- [ ] I know what changed in Go 1.10, 1.14, 1.21, 1.23.
- [ ] I can explain why `t.C` is nil for AfterFunc.

---

## Summary

The senior view of `AfterFunc`:

- A `time.Timer` is a wrapper around a `runtimeTimer` that lives in a P-local min-heap, keyed on monotonic `when`.
- The runtime checks heaps during scheduler iterations; expired AfterFunc timers spawn a callback goroutine.
- `Stop` and `Reset` are O(log n) heap operations; they do not block on the callback.
- Pre-1.23 had a complex state machine; 1.23 simplified it. User-visible behaviour is unchanged.
- At scale (>100K timers), the per-timer cost and the spawn burst matter. Use batching strategies.
- Profile with pprof: CPU, heap, and goroutine profiles all illuminate timer behaviour.

The professional level moves from "how does it work" to "how do we run this in production at scale": observability, alerting, postmortems, incident response.

---

## Further Reading

- Go source: `runtime/time.go`.
- Russ Cox, "Go's scheduler" talks and write-ups.
- Varghese & Lauck (1996), "Hashed and Hierarchical Timing Wheels."
- LKML threads on `timer_list` and related kernel structures (deeper than you need, but illuminating).
- The `golang/go` issue tracker — search for "timer" — many design discussions are public.

---

## Diagrams

### P-local heap

```
P0:               P1:               P2:               P3:
[t@+10ms]         [t@+50ms]         [t@+5ms ]         [t@+1s  ]
[t@+200ms]        [t@+1s  ]         [t@+800ms]        [t@+10s ]
[t@+5s   ]        [t@+30s ]
```

Each P checks only its own heap. No cross-P traffic for timer ops.

### Fire path

```
scheduler picks next work
        |
        v
check P's timer heap
        |
        v
peek min -- is when <= now? -- no --> continue scheduler loop
        | yes
        v
pop min
        |
        v
mark fired in runtime
        |
        v
spawn goroutine (wrapper) --> wrapper does `go userFunc()` --> user code
```

### Stop's effect

```
heap before:     [t1@+10ms, t2@+50ms, t3@+100ms]
                                ^
                                |
                              Stop(t2)
heap after:      [t1@+10ms, t3@+100ms]
return value: true (t2 was active)
```

### Reset's effect on active timer

```
heap before:     [t1@+10ms (this), t2@+50ms]
                  ^
                  | Reset(100ms)
heap after:      [t2@+50ms, t1@+100ms]
return value: true (t1 was active)
```

### Goroutine spawn flow

```
P0 thread:  ... scheduler iter ... pop timer ... newproc(wrapper) ... continue ...
P0 run q:                                                + wrapper goroutine
                                                                |
                                                                v
                                                       runs `go userFunc()`
                                                                |
                                                                v
                                                       userFunc goroutine on P0 or another P
```

---

## Appendix A: Reading runtime/time.go in 30 minutes

### Setup

```bash
cd $(go env GOROOT)/src/runtime
ls -la time.go
```

Open `time.go` in your editor.

### Map of the file

The file is roughly organised:

1. **`type timer struct`** — the runtime's per-timer struct.
2. **`addtimer(t *timer)`** — insert a fresh timer into the calling P's heap.
3. **`deltimer(t *timer) bool`** — mark a timer for removal.
4. **`modtimer(t *timer, ...) bool`** — change when, used by Reset.
5. **`adjusttimers(pp *p)`** — clean up the heap.
6. **`runtimer(pp *p, now int64) int64`** — run any expired timers, return when to check next.
7. **`siftupTimer`/`siftdownTimer`** — heap operations.

### Sequence to trace

Trace `time.AfterFunc` from user code:

1. `time.AfterFunc(d, f)` in `time/sleep.go` calls `startTimer(t)`.
2. `startTimer` (also in `time/sleep.go`) calls into the runtime via `runtime.addtimer`.
3. `runtime.addtimer` (in `runtime/time.go`) acquires the local P's timer lock, inserts into the heap, releases.

Now trace a fire:

1. The scheduler eventually calls `checkTimers(pp, now)`.
2. `checkTimers` calls `runtimer`.
3. `runtimer` peeks the heap; if min is expired, it pops, marks the timer fired, and calls `f(arg, 0)`.
4. For an AfterFunc, `f` is `goFunc` (in `time/sleep.go`), which does `go arg.(func())()`.
5. The user's callback runs on the new goroutine.

That is the entire path.

### Useful runtime helpers

- `runtime.nanotime()` — current monotonic time in nanoseconds.
- `runtime.systemstack(...)` — run a function on the system stack (used for some scheduler ops).
- `mp` / `pp` / `gp` — pointers to the current M, P, and G.

You do not need to understand all of these to follow the timer path.

---

## Appendix B: Pre-1.23 status state machine, in detail

### The states

```
timerNoStatus       0  // never used (timer not on a heap)
timerWaiting        1  // active on a heap
timerRunning        2  // f is being called
timerDeleted        3  // marked deleted; in heap until cleaned
timerRemoving       4  // someone is removing it
timerRemoved        5  // off the heap
timerModifying      6  // someone is modifying
timerModifiedEarlier 7 // when modified to a smaller value
timerModifiedLater   8 // when modified to a larger value
timerMoving         9  // being moved between P's
```

### Why so many?

The complexity came from lock-free transitions. Multiple goroutines can call `Stop`, `Reset`, and the timer can simultaneously be firing. The runtime used CAS on the status to avoid contention. Each combination of "what's the current status?" and "what op is being attempted?" needed careful handling.

### Common transitions

```
NoStatus --(addtimer)--> Waiting
Waiting --(fire)--> Running --> NoStatus or Modified or Removed
Waiting --(deltimer)--> Deleted --(cleanup)--> Removed
Waiting --(modtimer earlier)--> ModifiedEarlier
Waiting --(modtimer later)--> ModifiedLater
```

### Post-1.23

The state machine effectively collapses to "active or not." `Stop` and `Reset` are implemented in terms of simpler primitives (`addtimer`, `deltimer`, `modtimer`) without the elaborate intermediate states.

The user-visible API is unchanged. The boolean returns mean the same thing.

---

## Appendix C: A back-of-envelope cost model

Let:

- `T` = number of live timers.
- `R` = timer creations per second (rate).
- `F` = timer fires per second.
- `S` = timer stops per second.

Memory: `M ≈ T × (120 bytes timer + capture size)`. For `T = 1e6`, capture size = 100 bytes: `M ≈ 220 MB`.

CPU (heap operations): each create/stop/reset is O(log T). At T = 1e6, log T ≈ 20. Each op is on the order of 100 ns. So `CPU ≈ (R + S + F) × 100ns × log T`. For R+S+F = 100K/sec, T = 1e6: `CPU ≈ 100K × 100ns × 20 = 200ms/sec of CPU = 20% of one core`.

Goroutine spawns at fire: `goroutine_spawns_per_sec = F`. Each spawn is ~300 ns. For F = 10K/sec: `0.003 sec/sec of CPU = 0.3% of one core`. Cheap.

GC: with T = 1e6 and 100-byte captures, retained heap from timers is ~220 MB. The GC pause time scales with live heap, but typical pauses stay below 1 ms with Go's concurrent collector.

### Practical takeaways

- Memory is the dominant cost at scale. Closure capture size matters.
- CPU is mostly heap operations. At T < 1e5 it is invisible. At T > 1e6 it is several percent.
- Goroutine spawns are usually a non-issue.

---

## Appendix D: How to read a CPU profile for timer cost

After running `pprof` on a CPU profile:

```
(pprof) top10
Showing nodes accounting for 1.55s, 31.0% of 5s total
      flat  flat%   sum%        cum   cum%
     0.40s  8.00%  8.00%      0.60s 12.00%  runtime.siftdownTimer
     0.30s  6.00% 14.00%      0.40s  8.00%  runtime.siftupTimer
     0.25s  5.00% 19.00%      0.55s 11.00%  runtime.addtimer
     0.20s  4.00% 23.00%      0.30s  6.00%  runtime.deltimer
     0.15s  3.00% 26.00%      0.20s  4.00%  runtime.checkTimers
     ...
```

Interpretation: 30% of CPU is timer-related. Likely indicates either too many timers, or high churn rate. Investigate via heap and goroutine profiles.

### What to do

- Reduce the count: batch into bucket timers.
- Reduce the churn: use `Reset` instead of `Stop`+`AfterFunc`.
- Move to a different structure: hashed timing wheel, earliest-deadline scheduler.

---

## Appendix E: Walking through `addtimer` (simplified pseudocode)

```go
func addtimer(t *timer) {
    // 1. Take a snapshot of "now" once.
    now := nanotime()

    // 2. Find the local P.
    pp := getg().m.p.ptr()

    // 3. Lock the P's timer-heap.
    lock(&pp.timersLock)

    // 4. Insert at end of heap, then sift up.
    pp.timers = append(pp.timers, t)
    siftupTimer(pp.timers, len(pp.timers)-1)

    // 5. Update accounting.
    pp.numTimers.Add(1)

    // 6. Wake up the netpoller if this timer is sooner than the next wake.
    if t.when < pp.timer0When.Load() {
        pp.timer0When.Store(t.when)
        wakeNetPoller(t.when)
    }

    unlock(&pp.timersLock)
}
```

Real code has more bells and whistles (the status field, race detector hooks, debug counters) but the structure is the same.

### Why wake the netpoller?

If the P is parked in `epoll_wait` (or equivalent) with a longer timeout, the newly-inserted timer might fire before the wait would otherwise return. So the runtime sends a wakeup so the poll returns and the timer can be checked.

---

## Appendix F: Walking through `runtimer` (simplified)

```go
// Called by the scheduler to fire any expired timers on pp.
// Returns the next timer's when, or 0 if no more timers.
func runtimer(pp *p, now int64) int64 {
    for {
        if len(pp.timers) == 0 {
            return 0
        }
        t := pp.timers[0]
        if t.when > now {
            return t.when
        }
        // t expired.
        if t.period > 0 {
            // Repeating timer (Ticker). Advance and sift.
            t.when += t.period
            siftdownTimer(pp.timers, 0)
        } else {
            // One-shot. Remove from heap.
            removeFromTopOfHeap(pp.timers)
        }

        // Call the timer's f. For AfterFunc, this is goFunc which does `go userFunc()`.
        f := t.f
        arg := t.arg
        unlock(&pp.timersLock)
        f(arg, t.seq)
        lock(&pp.timersLock)
    }
}
```

The function fires *all* expired timers in one pass, then returns the next wake-time. The scheduler can use that to set its next poll timeout.

---

## Appendix G: A self-contained latency experiment

```go
package main

import (
    "fmt"
    "sort"
    "time"
)

func main() {
    const N = 10_000
    target := 100 * time.Millisecond
    lateness := make([]time.Duration, 0, N)
    done := make(chan struct{}, N)

    start := time.Now()
    for i := 0; i < N; i++ {
        scheduledFor := start.Add(target)
        time.AfterFunc(target, func() {
            late := time.Since(scheduledFor)
            lateness = append(lateness, late)
            done <- struct{}{}
        })
    }

    for i := 0; i < N; i++ {
        <-done
    }

    sort.Slice(lateness, func(i, j int) bool { return lateness[i] < lateness[j] })
    fmt.Println("p50:", lateness[N/2])
    fmt.Println("p99:", lateness[N*99/100])
    fmt.Println("p999:", lateness[N*999/1000])
    fmt.Println("max:", lateness[N-1])
}
```

Run this. On a modest laptop you should see p50 around 100 µs of lateness, p99 around 1 ms, and max possibly in the 10–50 ms range. The p99 is the number you should plan around.

Note: the `lateness` slice is unsynchronised; multiple callbacks append concurrently. Add a mutex or use `sync/atomic` for production-quality measurement.

---

## Appendix H: Architectural lessons

A few high-level lessons accumulate after working with `AfterFunc` at scale.

1. **Memory is the first scaling wall.** Closure capture multiplied by timer count is your budget. Audit captures.
2. **Throughput is the second wall.** O(log n) heap operations are fast but not free. Million-timer services need batching.
3. **Goroutine spawns are usually not the wall.** Even at 100K fires per second, the spawn cost is sub-second of CPU.
4. **Test with mock clocks.** Real-time tests are flaky. A clock interface pays for itself.
5. **`context.AfterFunc` is your friend.** For context-driven cleanup, prefer it.
6. **Observability matters.** Export a metric for "live timer count" via your own bookkeeping. The runtime doesn't.
7. **Don't reinvent timing wheels at small scale.** The standard heap is good up to 100K. Reach for fancier structures only when you have profile data showing it matters.

---

## Appendix I: Senior FAQ

**Q.** Why does Go not provide a `time.AfterFuncContext(ctx, d, f)` that combines both triggers?

**A.** Composability. `time.AfterFunc(d, f)` and `context.AfterFunc(ctx, cancel)` can be combined by user code. Adding more API surface for every combination would be unwieldy.

**Q.** What is the smallest practical duration?

**A.** Effectively the scheduler's minimum poll interval, which is in the microseconds range. `time.AfterFunc(1*time.Nanosecond, f)` will fire almost immediately, but with some jitter.

**Q.** Can I influence which P my timer joins?

**A.** Indirectly, via `runtime.LockOSThread` — but you cannot pin a goroutine to a P in user code. The runtime decides.

**Q.** What is the precision of `time.Duration`?

**A.** Nanoseconds. The runtime uses nanoseconds end to end.

**Q.** Why does my callback fire late under GC?

**A.** During a GC stop-the-world pause (typically < 1 ms), no goroutines run, so callbacks can't fire. The pause is short but visible if you measure carefully.

**Q.** Why does my callback fire late under heavy CPU load?

**A.** All P's are busy with goroutines; timer checks happen at scheduler iterations and may be delayed. Async preemption (Go 1.14+) helps but doesn't eliminate it.

**Q.** Can I run timer callbacks on a dedicated goroutine pool?

**A.** Not directly. You can have the callback push work to a pool: `time.AfterFunc(d, func() { pool.Submit(actualWork) })`.

**Q.** Is `time.AfterFunc` slower on Windows / macOS than Linux?

**A.** Marginally. The underlying syscall for net polling differs (epoll vs kqueue vs IOCP). For modest timer counts, you won't notice.

**Q.** Does GOMAXPROCS affect timer accuracy?

**A.** Yes. With GOMAXPROCS=1, all timers fire on one P; if that P is busy, timers wait. Higher GOMAXPROCS distributes timer firing across P's.

**Q.** Is `time.AfterFunc` safe in test goroutines that the test framework may kill?

**A.** Yes — the test goroutine and timer callback are independent. But the callback may run after the test ends if you don't `Stop` it; clean up properly.

---

## Appendix J: A list of bugs the runtime team fixed over the years

For motivation, here are some real timer-related bugs from the Go issue tracker:

- **#6452** (early): timer leak after `Stop`.
- **#17448**: data race in concurrent `Reset`.
- **#25686**: `Reset` returning incorrect value in some race.
- **#32834**: timer not firing on heavily loaded systems.
- **#34025**: `time.Sleep` and timer interactions.
- **#50059**: `Reset` semantics ambiguity prompting documentation rewrite.
- **#60665**: Go 1.21 `context.AfterFunc` proposal and implementation.
- **#62410**: Go 1.23 timer simplification.

You don't need to read each, but skimming the discussions gives a sense of the complexity hidden in `time.AfterFunc`. The current API is the product of decades of refinement.

---

## Appendix K: Performance comparison table

Approximate numbers, modern CPU, GOMAXPROCS=8:

| Operation | Cost |
|---|---|
| `time.AfterFunc(d, f)` cold | 600 ns + closure alloc |
| `t.Stop()` | 200 ns |
| `t.Reset(d)` | 250 ns |
| Heap insert at n=1K | 80 ns |
| Heap insert at n=100K | 200 ns |
| Heap insert at n=1M | 350 ns |
| Goroutine spawn | 300 ns |
| `time.After(d)` cold (returns chan) | 800 ns |
| `time.NewTimer(d)` cold | 700 ns |
| `time.NewTicker(d)` cold | 800 ns |

These are not authoritative benchmarks — your hardware, Go version, and workload will produce different numbers. Run your own.

---

## Appendix L: Annotated source tour of `runtime/time.go`

Below is a guided tour of the most relevant function bodies in the Go runtime, paraphrased and annotated. Numbers refer to a stylised reading of the source for Go 1.23+, not the literal line numbers (which change between releases). Use this as scaffolding for your own reading.

### L.1 — The timer struct

The runtime's representation of a timer is, conceptually:

```go
type timer struct {
    // Heap position. Negative if not in any heap.
    mu        mutex      // guards a few fields
    astate    atomic.Uint8 // active status flags
    state     uint8      // additional state flags
    isChan    bool       // distinguishes channel-style from AfterFunc-style

    blocked   uint32     // count of blocked sends in transitional state

    sendLock  mutex      // serialises channel sends for ticker

    // The user-visible fields (mirror of time.Timer's runtimeTimer view):
    when      int64      // monotonic nanoseconds
    period    int64      // 0 for AfterFunc; > 0 for Ticker
    f         func(any, uintptr)
    arg       any
    seq       uintptr
}
```

What to notice:

- `mu` is a runtime mutex, not a `sync.Mutex`. Runtime mutexes are lighter-weight and not visible to the race detector in the same way.
- `astate` is an atomic byte used for lock-free transitions.
- `isChan` selects between "send on a channel at fire" and "spawn goroutine running f at fire."
- The wrapper for `AfterFunc` has `isChan = false` and a wrapper `f` that spawns a goroutine.

### L.2 — `addtimer`, the "create-and-arm" path

In the standard library:

```go
// time/sleep.go
func AfterFunc(d Duration, f func()) *Timer {
    t := &Timer{
        r: runtimeTimer{
            when: when(d),
            f:    goFunc,
            arg:  f,
        },
    }
    startTimer(&t.r)
    return t
}
```

`startTimer` calls into the runtime via a linkname:

```go
// runtime/time.go
//go:linkname startTimer time.startTimer
func startTimer(t *timer) {
    // ... defensive checks ...
    t.mu.Lock()
    t.maybeRunChan()
    addtimer(t)
    t.mu.Unlock()
}
```

Then `addtimer` proper:

```go
func addtimer(t *timer) {
    if t.when <= 0 {
        // Negative or zero duration: fire ASAP.
        t.when = nanotime()
    }

    pp := getg().m.p.ptr()
    pp.timers.lock.Lock()

    // Insert into heap.
    t.ph = len(pp.timers.heap)
    pp.timers.heap = append(pp.timers.heap, t)
    siftupTimer(pp.timers.heap, t.ph)
    pp.timers.added.Add(1)

    pp.timers.updateMinNextWhen(t.when)

    pp.timers.lock.Unlock()

    if t.when < pp.timer0When.Load() {
        wakeNetPoller(t.when)
    }
}
```

What to notice:

- `pp` is the current P. Insertion is into the local P's heap.
- After insertion, the runtime may need to wake the netpoller if this timer fires before the netpoller's current timeout.

### L.3 — `runtimer`, the "fire expired timers" path

```go
// Called by the scheduler from various places.
func runtimer(pp *p, now int64) int64 {
    pp.timers.lock.Lock()
    for {
        if len(pp.timers.heap) == 0 {
            pp.timers.lock.Unlock()
            return -1
        }
        t := pp.timers.heap[0]
        if t.when > now {
            // No expired timer yet; report when to check next.
            next := t.when
            pp.timers.lock.Unlock()
            return next
        }

        // Pop the timer.
        if t.period > 0 {
            // Repeating: advance when, sift down.
            t.when += t.period
            siftdownTimer(pp.timers.heap, 0)
        } else {
            // One-shot: remove from heap.
            removeFromTopOfHeap(pp.timers.heap)
            t.ph = -1
        }

        f := t.f
        arg := t.arg
        seq := t.seq

        // Release the lock before calling f. f may do anything,
        // including modify timers — must not hold the lock.
        pp.timers.lock.Unlock()
        f(arg, seq)
        pp.timers.lock.Lock()
    }
}
```

What to notice:

- The lock is released before `f` is called. This is critical — `f` may itself call into timer code, and holding the lock would deadlock.
- `f` is the wrapper. For AfterFunc it does `go arg.(func())()`. For Ticker it does the channel send.
- Repeating timers (Tickers) are not removed but re-sifted with an advanced `when`.

### L.4 — `goFunc`, the AfterFunc wrapper

```go
// time/sleep.go
func goFunc(arg any, seq uintptr) {
    go arg.(func())()
}
```

That's the whole wrapper. The runtime invokes it with `arg = user's f`. `go arg.(func())()` spawns a fresh goroutine to run the user's callback.

Why a wrapper? Because the runtime's `f` signature is `func(any, uintptr)`. The user's `f` is `func()`. The wrapper bridges the type difference and provides the `go` (which is why callbacks run on a new goroutine).

### L.5 — `deltimer`, the "mark for removal" path

```go
func deltimer(t *timer) bool {
    if t.ph < 0 {
        // Already removed.
        return false
    }
    pp := t.pp
    pp.timers.lock.Lock()
    if t.ph >= 0 && pp.timers.heap[t.ph] == t {
        removeFromHeap(pp.timers.heap, t.ph)
        t.ph = -1
        pp.timers.deleted.Add(1)
        pp.timers.lock.Unlock()
        return true
    }
    pp.timers.lock.Unlock()
    return false
}
```

This is simplified. The real implementation handles:

- Timers being moved between P's.
- Concurrent modifications (`modtimer` racing with `deltimer`).
- The case where the timer is currently being processed by `runtimer` on another P.

### L.6 — `modtimer`, the Reset path

```go
func modtimer(t *timer, when, period int64, f func(any, uintptr), arg any, seq uintptr) bool {
    pp := getg().m.p.ptr()
    pp.timers.lock.Lock()

    wasActive := false
    if t.ph >= 0 && pp.timers.heap[t.ph] == t {
        // Active: remove from heap, will reinsert.
        removeFromHeap(pp.timers.heap, t.ph)
        wasActive = true
    }

    t.when = when
    t.period = period
    if f != nil {
        t.f = f
        t.arg = arg
        t.seq = seq
    }

    // Insert into heap.
    t.ph = len(pp.timers.heap)
    pp.timers.heap = append(pp.timers.heap, t)
    siftupTimer(pp.timers.heap, t.ph)

    pp.timers.updateMinNextWhen(t.when)
    pp.timers.lock.Unlock()

    if t.when < pp.timer0When.Load() {
        wakeNetPoller(t.when)
    }
    return wasActive
}
```

`Reset` calls `modtimer` (via `resetTimer`) with the new `when`, the same `f`/`arg`/`seq`. The boolean return is `wasActive`.

For `AfterFunc`, the user-facing `Reset(d)` translates to `modtimer(t, now+d, 0, nil, nil, 0)` — no change to `f` or `arg`.

### L.7 — Heap operations

`siftupTimer` and `siftdownTimer` are min-heap operations on a slice of `*timer`, keyed on `when`. The implementation is a standard 4-ary heap (the original Go heap used 4-ary for cache friendliness, although the multiplier has varied between versions).

```go
func siftupTimer(t []*timer, i int) {
    when := t[i].when
    tmp := t[i]
    for i > 0 {
        p := (i - 1) / 4 // 4-ary parent
        if when >= t[p].when {
            break
        }
        t[i] = t[p]
        t[i].ph = i
        i = p
    }
    if tmp != t[i] {
        t[i] = tmp
        t[i].ph = i
    }
}
```

Each element knows its position via `ph`, so deletion is O(log n) (find by index, sift down or up).

---

## Appendix M: A detailed cost model for batching

Suppose you have N entries each with a deadline. Three strategies:

### Strategy A: one timer per entry

- N timers in the runtime heap.
- Insert: O(log N) per entry; total O(N log N) for the initial load.
- Fire: each entry fires its own timer; total O(N log N) heap operations spread over time.
- Memory: N × (timer + closure) ≈ N × 200 bytes.

For N = 1e6: 200 MB memory; CPU cost negligible if fires are spread over hours.

### Strategy B: earliest-deadline scheduler

- 1 timer at any time (for the earliest deadline).
- User maintains a min-heap of entries (separately from the runtime's heap).
- Insert into user heap: O(log N). If the new entry is now the earliest, also call `Reset` on the runtime timer (one heap op).
- Fire: process all entries that are due, then `Reset` for the next earliest.
- Memory: N × entry size + 1 timer ≈ N × 100 bytes + 200 bytes.

For N = 1e6: 100 MB memory; CPU cost dominated by the user heap, not the runtime timer.

### Strategy C: bucketed (timing wheel)

- B buckets, each with a list of entries.
- Insert: O(1) — append to the appropriate bucket's list.
- Fire: every "tick" the runtime fires one timer; the callback processes the bucket's list.
- Memory: B + total entries.
- Accuracy: 1 tick width (e.g., 100 ms). Not suitable for sub-tick deadlines.

For N = 1e6, B = 1000 buckets at 100 ms each: 1000 active timers, O(1) inserts, sub-100ms fire latency.

### Choosing

| Constraint | Strategy |
|---|---|
| N small (< 100K), no batching pressure | A |
| N large, deadlines are precise | B |
| N very large, deadlines are coarse | C |
| Need O(1) inserts | C |
| Need sub-millisecond precision | A or B |
| Memory is the bottleneck | C |

For most production services, B is the sweet spot.

---

## Appendix N: Implementing the earliest-deadline scheduler

A reference implementation, with comments.

```go
package edscheduler

import (
    "container/heap"
    "sync"
    "time"
)

type Entry struct {
    Deadline time.Time
    Handler  func()
    index    int // heap index
}

type entryHeap []*Entry

func (h entryHeap) Len() int { return len(h) }
func (h entryHeap) Less(i, j int) bool { return h[i].Deadline.Before(h[j].Deadline) }
func (h entryHeap) Swap(i, j int) {
    h[i], h[j] = h[j], h[i]
    h[i].index = i
    h[j].index = j
}
func (h *entryHeap) Push(x interface{}) {
    e := x.(*Entry)
    e.index = len(*h)
    *h = append(*h, e)
}
func (h *entryHeap) Pop() interface{} {
    n := len(*h)
    e := (*h)[n-1]
    e.index = -1
    *h = (*h)[:n-1]
    return e
}

type Scheduler struct {
    mu      sync.Mutex
    entries entryHeap
    timer   *time.Timer
}

func New() *Scheduler {
    return &Scheduler{}
}

func (s *Scheduler) Schedule(e *Entry) {
    s.mu.Lock()
    defer s.mu.Unlock()
    heap.Push(&s.entries, e)
    s.armLocked()
}

func (s *Scheduler) Cancel(e *Entry) bool {
    s.mu.Lock()
    defer s.mu.Unlock()
    if e.index < 0 {
        return false
    }
    heap.Remove(&s.entries, e.index)
    s.armLocked()
    return true
}

func (s *Scheduler) armLocked() {
    if s.entries.Len() == 0 {
        if s.timer != nil {
            s.timer.Stop()
        }
        return
    }
    d := time.Until(s.entries[0].Deadline)
    if d < 0 {
        d = 0
    }
    if s.timer == nil {
        s.timer = time.AfterFunc(d, s.fire)
    } else {
        s.timer.Reset(d)
    }
}

func (s *Scheduler) fire() {
    s.mu.Lock()
    now := time.Now()
    var due []*Entry
    for s.entries.Len() > 0 && !s.entries[0].Deadline.After(now) {
        e := heap.Pop(&s.entries).(*Entry)
        due = append(due, e)
    }
    s.armLocked()
    s.mu.Unlock()
    for _, e := range due {
        e.Handler() // run on this goroutine, in deadline order
    }
}
```

Performance:

- `Schedule`: O(log N) for heap insertion + O(1) for the `Reset` (if needed).
- `Cancel`: O(log N) for heap removal.
- `fire`: O(k log N) where k = entries due. Amortised O(log N) per entry over time.

At N = 1e6, all operations are sub-microsecond.

### When to use this

- N > 100K timers.
- Entries have precise deadlines.
- You want a single goroutine spawn (per fire batch) instead of one per entry.

### When not to use this

- N < 10K — per-entry timers are simpler.
- Entries are short-lived; the rebalancing cost dominates.
- Cancellation rate is very high; the user heap's O(log N) removal piles up.

---

## Appendix O: Implementing a hashed timing wheel

A simple single-level hashed timing wheel.

```go
package wheel

import (
    "sync"
    "time"
)

type Entry struct {
    Handler func()
    // Internal:
    bucket int
    next   *Entry
    prev   *Entry
}

type Wheel struct {
    mu       sync.Mutex
    tickSize time.Duration
    buckets  []*Entry // each bucket is a doubly linked list head
    cursor   int
    timer    *time.Timer
    start    time.Time
}

func New(tickSize time.Duration, numBuckets int) *Wheel {
    w := &Wheel{
        tickSize: tickSize,
        buckets:  make([]*Entry, numBuckets),
        start:    time.Now(),
    }
    w.timer = time.AfterFunc(tickSize, w.tick)
    return w
}

func (w *Wheel) Schedule(after time.Duration, fn func()) *Entry {
    w.mu.Lock()
    defer w.mu.Unlock()
    bucketsAhead := int(after / w.tickSize)
    if bucketsAhead < 1 {
        bucketsAhead = 1
    }
    idx := (w.cursor + bucketsAhead) % len(w.buckets)
    e := &Entry{Handler: fn, bucket: idx}

    // Push to head of linked list.
    e.next = w.buckets[idx]
    if w.buckets[idx] != nil {
        w.buckets[idx].prev = e
    }
    w.buckets[idx] = e
    return e
}

func (w *Wheel) Cancel(e *Entry) {
    w.mu.Lock()
    defer w.mu.Unlock()
    if e.bucket < 0 {
        return
    }
    if e.prev != nil {
        e.prev.next = e.next
    } else {
        w.buckets[e.bucket] = e.next
    }
    if e.next != nil {
        e.next.prev = e.prev
    }
    e.bucket = -1
}

func (w *Wheel) tick() {
    w.mu.Lock()
    head := w.buckets[w.cursor]
    w.buckets[w.cursor] = nil
    w.cursor = (w.cursor + 1) % len(w.buckets)
    w.mu.Unlock()

    // Process the bucket.
    for e := head; e != nil; e = e.next {
        e.bucket = -1 // mark removed (don't accidentally cancel during run)
        e.Handler()
    }

    // Re-arm.
    w.timer.Reset(w.tickSize)
}
```

Properties:

- O(1) `Schedule` and `Cancel`.
- Accuracy: ±1 tick.
- Memory: O(buckets + entries).
- Maximum delay: `tickSize × numBuckets` (entries beyond this need a hierarchical wheel).

This is suitable for very high-cardinality scenarios (millions of entries with similar deadlines) where the standard heap's O(log N) is felt.

### Caveats

- The `tick` callback runs the handlers in the same goroutine. If a handler is slow, subsequent ticks are delayed. Consider dispatching to a worker pool.
- Cancellation requires the `*Entry` token. Plan your application to track these.

---

## Appendix P: When timer behaviour matters for correctness

For some applications, timer accuracy is part of the correctness contract:

### Distributed systems heartbeats

A node sends a heartbeat every `d`. Another node times out the connection after `2d` of silence. If timer accuracy is poor, false positives ("node down") occur.

Mitigations:

- Use generous timeout (e.g. `5d` for "d-period" heartbeats).
- Use multiple timers (e.g., "missed 3 heartbeats in a row").
- Use the difference between *successful* heartbeat receipts, not just elapsed time.

### Rate limiters

A leaky-bucket rate limiter refills tokens every `d`. If the timer is late, the bucket is under-filled and clients are throttled more than they should be.

Mitigations:

- Use computed-on-demand refill: when a request arrives, compute the elapsed time and add tokens, rather than relying on a fire.
- Use generous bucket size.

### Distributed locks

A holder renews a lease every `d`; an observer assumes the lock is free after `2d`. Same issue as heartbeats.

### TLS handshake timeouts

If the timer fires later than expected, the handshake may succeed even when the application meant it to fail. This rarely matters for correctness, but it has been the root cause of bugs in mocking.

### Game tick rates

A game server with a 60 Hz tick rate cannot afford 30 ms jitter. Use `time.NewTicker` (more accurate than self-rescheduling `AfterFunc`) and possibly OS-level high-resolution timers.

---

## Appendix Q: Common antipatterns at the senior level

### Antipattern 1: Custom timing wheel for 100 timers

You don't need it. The standard heap is faster and simpler at this scale. Custom data structures pay off only at high N.

### Antipattern 2: One timer per byte of incoming data

I have seen designs where a TCP server creates an "idle timer" per packet, instead of per connection. This is millions of timers under load. Fix: one timer per connection, reset on each packet.

### Antipattern 3: Misusing `Reset`'s return value

```go
if !t.Reset(d) {
    // Timer was not active; do something special?
}
```

For `AfterFunc` timers, this return is almost never useful. Don't gate logic on it.

### Antipattern 4: Polling for timer fire

```go
go func() {
    for !flag.Load() {
        time.Sleep(time.Millisecond)
    }
    // ... handle ...
}()
time.AfterFunc(d, func() { flag.Store(true) })
```

Spinning a polling goroutine defeats the point of timers. Use a channel:

```go
done := make(chan struct{})
time.AfterFunc(d, func() { close(done) })
<-done
```

### Antipattern 5: Storing timers in slices indexed by row ID

```go
var timers [1_000_000]*time.Timer
```

The slice is permanent. Even if you `Stop` and `nil`-out entries, the slice itself is 8 MB. Use a map keyed by something meaningful.

### Antipattern 6: Calling Reset every microsecond

Very high reset rates churn the heap. If you're resetting more than 100K times per second, batch.

### Antipattern 7: Recursive AfterFunc without bound

```go
var run func()
run = func() {
    time.AfterFunc(0, run)
}
run()
```

Infinite. Even with `period = 0`, the heap insertion + goroutine spawn cost adds up. The runtime will service this as fast as it can, but you have created a busy loop with extra overhead.

---

## Appendix R: Verification — proving timer behaviour in tests

To verify a timer-based component is correct, set up scenarios and check invariants.

### Scenario: deadline fires exactly once

```go
func TestDeadlineFiresOnce(t *testing.T) {
    var calls atomic.Int64
    fn := func() { calls.Add(1) }
    d := NewDeadline(50*time.Millisecond, fn)
    _ = d
    time.Sleep(200 * time.Millisecond)
    if got := calls.Load(); got != 1 {
        t.Fatalf("expected 1 call, got %d", got)
    }
}
```

### Scenario: cancel prevents fire

```go
func TestCancelPrevents(t *testing.T) {
    var calls atomic.Int64
    d := NewDeadline(50*time.Millisecond, func() { calls.Add(1) })
    d.Cancel()
    time.Sleep(100 * time.Millisecond)
    if got := calls.Load(); got != 0 {
        t.Fatalf("expected 0 calls, got %d", got)
    }
}
```

### Scenario: cancel after fire is harmless

```go
func TestCancelAfterFire(t *testing.T) {
    var calls atomic.Int64
    d := NewDeadline(20*time.Millisecond, func() { calls.Add(1) })
    time.Sleep(50 * time.Millisecond)
    d.Cancel() // already fired; no effect
    if got := calls.Load(); got != 1 {
        t.Fatalf("expected 1 call, got %d", got)
    }
}
```

### Scenario: stress test for races

```go
func TestRace(t *testing.T) {
    for i := 0; i < 1000; i++ {
        var calls atomic.Int64
        d := NewDeadline(time.Millisecond, func() { calls.Add(1) })
        d.Cancel()
        time.Sleep(5 * time.Millisecond)
        if got := calls.Load(); got > 1 {
            t.Fatalf("got %d calls", got)
        }
    }
}
```

Run with `-race`. The detector catches any data race in the component's internals.

### Property test

Use `quick.Check` to randomise the trigger / cancel ordering, asserting "at most one call":

```go
quick.Check(func(t1, t2 time.Duration) bool {
    if t1 > time.Second || t2 > time.Second { return true } // skip
    var calls atomic.Int64
    d := NewDeadline(t1, func() { calls.Add(1) })
    time.AfterFunc(t2, d.Cancel)
    time.Sleep(2 * time.Second)
    return calls.Load() <= 1
}, nil)
```

---

## Appendix S: A toy "runtime timer" implementation

Sometimes it helps to implement the data structures yourself, in user code, to see how they work.

```go
package mytimer

import (
    "container/heap"
    "sync"
    "time"
)

type timer struct {
    when  time.Time
    f     func()
    index int // heap position
}

type timerHeap []*timer

func (h timerHeap) Len() int { return len(h) }
func (h timerHeap) Less(i, j int) bool { return h[i].when.Before(h[j].when) }
func (h timerHeap) Swap(i, j int) {
    h[i], h[j] = h[j], h[i]
    h[i].index = i
    h[j].index = j
}
func (h *timerHeap) Push(x interface{}) {
    t := x.(*timer)
    t.index = len(*h)
    *h = append(*h, t)
}
func (h *timerHeap) Pop() interface{} {
    n := len(*h)
    t := (*h)[n-1]
    t.index = -1
    *h = (*h)[:n-1]
    return t
}

type Runtime struct {
    mu      sync.Mutex
    h       timerHeap
    notify  chan struct{}
    stop    chan struct{}
    started bool
}

func (r *Runtime) AfterFunc(d time.Duration, f func()) *timer {
    r.mu.Lock()
    defer r.mu.Unlock()
    if !r.started {
        r.notify = make(chan struct{}, 1)
        r.stop = make(chan struct{})
        go r.loop()
        r.started = true
    }
    t := &timer{when: time.Now().Add(d), f: f}
    heap.Push(&r.h, t)
    select {
    case r.notify <- struct{}{}:
    default:
    }
    return t
}

func (r *Runtime) Stop(t *timer) bool {
    r.mu.Lock()
    defer r.mu.Unlock()
    if t.index < 0 {
        return false
    }
    heap.Remove(&r.h, t.index)
    return true
}

func (r *Runtime) loop() {
    for {
        r.mu.Lock()
        var d time.Duration
        if r.h.Len() == 0 {
            d = 24 * time.Hour
        } else {
            d = time.Until(r.h[0].when)
        }
        r.mu.Unlock()

        select {
        case <-time.After(d):
        case <-r.notify:
        case <-r.stop:
            return
        }

        r.mu.Lock()
        now := time.Now()
        for r.h.Len() > 0 && !r.h[0].when.After(now) {
            t := heap.Pop(&r.h).(*timer)
            f := t.f
            r.mu.Unlock()
            go f()
            r.mu.Lock()
        }
        r.mu.Unlock()
    }
}
```

This is a hand-rolled `time.AfterFunc`. It:

- Uses a min-heap.
- Spawns a single "driver" goroutine on first use.
- Notifies the driver when a sooner timer is inserted.
- Fires expired timers by spawning user goroutines.

The Go standard library's implementation is more efficient (P-local heaps, no central driver goroutine, integrated with the scheduler). But the structure is recognisable.

Reading this implementation and reading the runtime's implementation back-to-back is a great way to internalise the design choices.

---

## Appendix T: Three production case studies (preview)

The professional file goes into incident detail. As a preview at the senior level, here are three production stories, summarised:

### Case 1: A memory leak from never-stopped timers

A request handler created an `AfterFunc` with a 24-hour TTL. Most requests took milliseconds. The timer was meant for "edge case cleanup," but the closure captured the entire request body. At 5000 RPS for a day, the service held 5000 × 86400 × request size in memory — terabytes. Fixed by stopping the timer in the happy path.

### Case 2: A "thundering herd" of timer fires

A deadline timer fired for ~50K requests within the same 100 ms window. The runtime spawned 50K goroutines simultaneously. The goroutine count went from 1000 to 51000 in milliseconds; subsequent GC paused the service for 800 ms; latency p99 spiked to 1.2 seconds. Fixed by adding jitter to the deadline.

### Case 3: A deadline that fired late and caused a double-charge

A payment service had a 30-second deadline timer to refund a payment if the order was not confirmed. Under heavy GC pressure, the timer fired 31 seconds late. By then, the order was confirmed, the refund logic ran anyway, and the customer received a refund for a successful order. Fixed by adding a "still applicable" check inside the callback.

These and more are detailed in `professional.md`.

---

## Appendix U: Senior-level pitfalls list

A grab bag of senior pitfalls, some repeated for emphasis.

1. Storing `*time.Timer` in a map you forget to clean up.
2. Capturing large objects in callback closures.
3. Treating `Stop`'s return as "callback ran" / "callback didn't run." It isn't.
4. Using `Reset`'s return value for AfterFunc timers (mostly useless).
5. Reading from `t.C` for an AfterFunc timer (deadlock).
6. Forgetting that the callback runs on a new goroutine (needs synchronisation).
7. Not recovering panics in callbacks.
8. Self-rescheduling `AfterFunc` instead of `Ticker` when you want a strict period.
9. One-timer-per-entry at high N when batching would do.
10. Cancellation via shared mutable flag instead of channel / context.
11. Holding a lock during `AfterFunc` call when the lock is unnecessary (fine but messy).
12. Holding a lock that the callback also wants — deadlock if the same goroutine.
13. Assuming sub-millisecond timer accuracy.
14. Using `time.After` in tight loops (allocations).
15. Spawning a goroutine per pending timer (`go func() { time.Sleep(d); f() }()`).
16. Forgetting to clean up `context.AfterFunc` registrations.
17. Using `time.Now()` for timing comparisons (use monotonic).
18. Assuming `runtime.NumGoroutine` covers timer-related goroutines (it does, but at fire time only).
19. Trying to "wait for the callback to finish" via Stop's return value.
20. Not testing timer-heavy components with `-race`.

---

## Appendix V: A glossary of senior-level terms

| Term | Meaning |
|---|---|
| **P (logical processor)** | Go runtime's unit of scheduling. Each P has a local timer heap. |
| **M (machine, OS thread)** | An OS thread executing on a P. |
| **G (goroutine)** | A user goroutine. |
| **`runtimeTimer`** | The runtime's per-timer struct. |
| **Monotonic time** | A clock that only goes forward. Go uses it for timers. |
| **`when`** | The monotonic time at which the timer should fire. |
| **`period`** | The interval for repeating timers. 0 for one-shot. |
| **`f`** | The function to call at fire time. For AfterFunc, a wrapper that spawns a goroutine. |
| **Async preemption** | Go 1.14+ feature that preempts long-running goroutines. |
| **sysmon** | A background goroutine doing housekeeping, including timer checks. |
| **`netpoller`** | The runtime's network I/O subsystem. Also drives timer wakeups. |
| **Heap (min-)** | The data structure used for pending timers. |
| **Heap sift** | The operations to maintain heap property (siftup, siftdown). |
| **Timing wheel** | An alternative data structure for timers. Not used by Go's runtime. |
| **Earliest-deadline scheduler** | A pattern using one runtime timer for the next-due event. |
| **Closure capture** | When a function literal references outer-scope variables. |
| **Lock-free** | Using atomics instead of mutexes. Pre-1.23 used some lock-free transitions for timer status. |
| **Status (pre-1.23)** | The complex state of a timer entry. Simplified post-1.23. |

---

## Appendix W: Reading materials by depth

### Quick (30 min)

- Go 1.21 release notes — section on `context.AfterFunc`.
- The `time` package overview on pkg.go.dev.

### Medium (2 h)

- `time/sleep.go` in the standard library.
- The user-facing comments in `runtime/time.go`.

### Deep (a weekend)

- The full `runtime/time.go` source.
- The Go issue tracker, search "timer."
- Russ Cox's posts on the runtime.

### Architecture (week+)

- Varghese & Lauck 1996, "Hashed and Hierarchical Timing Wheels."
- The Linux kernel's `timer_list` and `hrtimer` subsystems.
- Tokio's (Rust) timing wheel implementation, for comparison.

---

## Appendix X: Notes on Windows / macOS / Linux differences

`time.AfterFunc` works the same everywhere. Under the hood:

- **Linux:** the netpoller uses `epoll_wait` with a timeout. Timer wakeups go through this.
- **macOS:** uses `kqueue` with `EVFILT_TIMER` or similar. Similar behaviour.
- **Windows:** uses IOCP with `GetQueuedCompletionStatusEx` with a timeout.

Timer accuracy is best on Linux, slightly worse on macOS (kqueue has microsecond granularity but additional latency), and similar on Windows.

Mobile devices (Android, iOS via Go mobile) have aggressive power management. Timers can be delayed by 10s of seconds when the device is in deep sleep. Plan accordingly.

---

## Appendix Y: A "thought experiment" — designing AfterFunc without the heap

Suppose you had to implement `AfterFunc` without a min-heap. What alternatives?

### Linked list, sorted

Insertion: O(N). Deletion: O(1) given the node pointer. Fire: O(1) at the head.

Trade-off: insertion is too slow at high N.

### Linked list, unsorted

Insertion: O(1). Fire: O(N) — must scan all entries each tick.

Trade-off: firing is too slow at high N.

### Two-level linked list (timing wheel)

Insertion: O(1). Fire: O(1) per tick (just iterate one bucket).

Trade-off: precision is limited to one tick.

### Hashed timing wheel

The bucket choice is `hash(when) % B`. Insertion: O(1). Fire: O(bucket size).

Trade-off: cancellation requires a token.

### B-tree

Insertion, deletion: O(log N) like the heap. More cache-friendly for very large N.

Trade-off: implementation complexity.

### Go's choice

Min-heap, P-local. The arity is 4 (more cache-friendly than binary). The choice is good for moderate N (up to ~100K timers per P), simple to implement, and well-tested.

---

## Appendix Z: A final summary of the senior view

`AfterFunc(d, f)`:

1. Allocates a `time.Timer` and a `runtimeTimer` (embedded).
2. Inserts the runtimeTimer into the current P's min-heap, keyed on `now + d`.
3. Possibly wakes the netpoller.
4. Returns the `*time.Timer` to the caller.

At fire time:

1. A P running its scheduler loop sees the heap's min has `when <= now`.
2. Pops the entry.
3. Calls the wrapper, which spawns a goroutine running `f`.

`Stop`:

1. If the timer is on a heap, remove it. Return true.
2. Otherwise, return false.

`Reset`:

1. Remove from heap if present. Update `when`. Reinsert. Return whether removed.

Production realities:

- Costs scale per-timer; budget memory and CPU.
- Batch via earliest-deadline scheduler or timing wheel at high N.
- Use `context.AfterFunc` for context-driven cleanup.
- Profile with pprof; watch CPU in `runtime.siftdownTimer`.

That is the senior-level view. The professional level builds on this with operational wisdom — alerts, dashboards, on-call playbooks, and postmortems.

---

## Appendix AA: Detailed walkthrough — what happens when GOMAXPROCS changes

When the user calls `runtime.GOMAXPROCS(n)`:

1. The runtime creates or destroys P's to match `n`.
2. If P's are destroyed, their timer heaps must migrate.
3. The runtime walks each dying P's timer heap and inserts each entry into a surviving P's heap.

This is mostly transparent to user code, but it implies:

- A single `AfterFunc` may move between P's during its lifetime.
- The migration is a runtime-only operation, requiring locks on both source and destination heaps.
- For services that frequently change GOMAXPROCS (rare), timer cost is slightly higher.

In practice, GOMAXPROCS changes happen at startup or via `runtime.GOMAXPROCS()` calls in user code. Most services set it once.

---

## Appendix BB: How Reset interacts with concurrent fire

Consider:

```go
t := time.AfterFunc(d, f)
// ...wait some time...
t.Reset(d)
```

At the moment of `Reset`, the timer is in one of these states:

- Still on the heap (not yet expired): `Reset` removes, updates `when`, reinserts.
- Just popped by a P, about to spawn callback: `Reset` may race with the runtime's "pop and spawn" sequence.
- Callback running: same as above, plus the callback's goroutine is alive.
- Callback finished: `Reset` reinserts a fresh entry; callback will run again.

The runtime serialises these transitions internally. The user-visible behaviour is: `Reset(d)` always succeeds in scheduling a future fire (or further fires). The boolean return tells you whether the timer was active before.

For `AfterFunc`, this means: after `Reset(d)`, you can be sure the callback will run at least once more, `d` from now (assuming no `Stop` in between).

There is one edge case worth noting: if you `Reset` *exactly* when the runtime is about to call the wrapper (`goFunc`), it is possible that:

- The original callback fires (because the wrapper was already invoked).
- The new fire scheduled by `Reset` also fires later.

So the callback may run twice from one `Reset`. If this matters (it usually doesn't), guard with a flag.

---

## Appendix CC: Edge cases at the runtime boundary

### CC.1 — `time.AfterFunc(0, f)`

`when = nanotime()`. The runtime treats this as "expired now." Often the timer fires before `AfterFunc` even returns to the caller (the runtime may pre-empt). In practice, the callback runs in a new goroutine within microseconds.

### CC.2 — `time.AfterFunc(-1*time.Second, f)`

`when = nanotime() - 1e9`. Treated as expired. Same as zero: fires almost immediately.

### CC.3 — `time.AfterFunc(d, nil)`

The wrapper sets `arg = nil`. At fire time, the wrapper does `go arg.(func())()`, which panics: nil function call inside a new goroutine. Crashes the program.

Always pass a non-nil function.

### CC.4 — Calling Stop on a zero `time.Timer`

```go
var t time.Timer // zero value
t.Stop() // returns false
```

The zero value has a nil `r`. The runtime's check handles this; `Stop` returns false.

### CC.5 — Calling Reset on a zero `time.Timer`

```go
var t time.Timer
t.Reset(d) // ???
```

Implementation-defined. Probably panics or does nothing. Never use a zero `time.Timer` value; always construct via `AfterFunc` or `NewTimer`.

### CC.6 — Calling AfterFunc inside a finalizer

Finalizers run on a special goroutine. AfterFunc inside a finalizer works — the timer is created on the finalizer's P. But finalizers are run during GC; long-running ones block GC. Keep them short.

### CC.7 — AfterFunc fired before main() runs

If you create an `AfterFunc` in a package `init`, with a very short duration, it can fire while other `init`s are still running. The callback runs in its own goroutine, which is fine, but the program state is incomplete. Avoid.

---

## Appendix DD: Comparing AfterFunc to alternatives in detail

### vs. time.After

`time.After(d)` returns `<-chan Time`. Each call allocates a `*time.Timer` and the channel. The timer entry sits in the runtime heap. When it fires, the value is sent on the channel.

If the caller never receives from the channel (e.g., the surrounding select picks another branch), historically the timer continued running until fire. In Go 1.23+, abandoned timers can be GC'd.

`AfterFunc` is preferable when the work to do is small (no need for a channel). `After` is preferable when you want to integrate into a select.

### vs. time.NewTimer + select

```go
t := time.NewTimer(d)
defer t.Stop()
select {
case <-t.C:
    work()
case <-ctx.Done():
}
```

This is the "cancellable wait" idiom. Versus `AfterFunc`:

- `AfterFunc` doesn't have a parked goroutine.
- `NewTimer` integrates with select.

For "do work in a new goroutine," use `AfterFunc`. For "wait in this goroutine, possibly cancelled," use `NewTimer`.

### vs. time.NewTicker

`NewTicker(d)` fires every `d`. The caller reads from `t.C`. Multiple sends accumulate (channel has buffer 1; missed ticks are dropped).

Versus self-rescheduling `AfterFunc`:

- `Ticker` has a strict period (no drift).
- Self-rescheduling AfterFunc has "d after the last finish" semantics.
- `Ticker` parks a goroutine waiting on its channel; `AfterFunc` parks nothing.

For high-cadence periodic work, `Ticker` is better. For "do this in d seconds, but only if not already running," self-rescheduling `AfterFunc` is better.

### vs. goroutine + Sleep

```go
go func() {
    time.Sleep(d)
    f()
}()
```

This holds a goroutine parked for `d`. At high concurrency, this is many goroutines. `AfterFunc` does not park a goroutine.

`go func + Sleep` is fine for one-off, low-concurrency cases. `AfterFunc` is the right answer in long-running services.

### vs. time.AfterFunc + context.AfterFunc combined

```go
t := time.AfterFunc(d, work)
stop := context.AfterFunc(ctx, func() { t.Stop() })
defer stop()
```

This pattern: schedule `work` after `d`, but cancel if `ctx` cancels first.

Use when you have a duration-driven action that should also respect context cancellation.

### vs. select with two timers

```go
t1 := time.NewTimer(d1)
t2 := time.NewTimer(d2)
defer t1.Stop()
defer t2.Stop()
select {
case <-t1.C:
    actionA()
case <-t2.C:
    actionB()
}
```

For "do A in d1 or B in d2, whichever first." Channel-based; integrates with other select branches.

---

## Appendix EE: Designing for testability

### Inject the clock

```go
type Clock interface {
    Now() time.Time
    AfterFunc(d time.Duration, f func()) Timer
}

type Timer interface {
    Stop() bool
    Reset(d time.Duration) bool
}
```

In production, a real-time implementation:

```go
type realClock struct{}
func (realClock) Now() time.Time { return time.Now() }
func (realClock) AfterFunc(d time.Duration, f func()) Timer {
    return realTimer{time.AfterFunc(d, f)}
}
type realTimer struct{ t *time.Timer }
func (r realTimer) Stop() bool { return r.t.Stop() }
func (r realTimer) Reset(d time.Duration) bool { return r.t.Reset(d) }
```

In tests, a fake clock:

```go
type fakeClock struct {
    mu     sync.Mutex
    now    time.Time
    timers []*fakeTimer
}

func (c *fakeClock) Now() time.Time { return c.now }

func (c *fakeClock) AfterFunc(d time.Duration, f func()) Timer {
    c.mu.Lock()
    defer c.mu.Unlock()
    t := &fakeTimer{
        c:      c,
        when:   c.now.Add(d),
        f:      f,
    }
    c.timers = append(c.timers, t)
    return t
}

func (c *fakeClock) Advance(d time.Duration) {
    c.mu.Lock()
    c.now = c.now.Add(d)
    var due []*fakeTimer
    for _, t := range c.timers {
        if !t.when.After(c.now) && !t.fired {
            t.fired = true
            due = append(due, t)
        }
    }
    c.mu.Unlock()
    for _, t := range due {
        t.f()
    }
}
```

Tests then look like:

```go
clk := &fakeClock{}
component := NewComponent(clk)
clk.Advance(5 * time.Second)
// assert state
```

Fast, deterministic, no `time.Sleep`.

### Don't reinvent

Use one of:

- `github.com/benbjohnson/clock` — popular, well-tested.
- `github.com/jonboulle/clockwork` — similar.
- `testing/synctest` — standard library, Go 1.24+.

### Subtest patterns

```go
t.Run("fires after duration", func(t *testing.T) {
    clk := newFakeClock()
    var calls atomic.Int64
    clk.AfterFunc(time.Second, func() { calls.Add(1) })
    clk.Advance(500 * time.Millisecond)
    if got := calls.Load(); got != 0 {
        t.Fatalf("expected 0, got %d", got)
    }
    clk.Advance(600 * time.Millisecond)
    if got := calls.Load(); got != 1 {
        t.Fatalf("expected 1, got %d", got)
    }
})
```

### Testing with race detector

Always run timer-heavy tests with `-race`. The detector catches unsynchronised access between the callback goroutine and the test goroutine.

```
go test -race -run TestMyComponent
```

If race detector reports a finding, fix it. There is no "false positive" mode for the race detector — every report is a real race.

---

## Appendix FF: Beyond the basics — patterns from the wild

A collection of patterns observed in real Go codebases.

### FF.1 — The "delayed open" connection

```go
type Conn struct {
    open     bool
    openIn   *time.Timer
    handler  func()
}

func NewConn(delay time.Duration, handler func()) *Conn {
    c := &Conn{handler: handler}
    c.openIn = time.AfterFunc(delay, func() {
        c.open = true
        c.handler()
    })
    return c
}
```

The connection is "closed" until the timer fires. Used in connection-pool throttling.

### FF.2 — The "settle" debouncer

A debouncer that fires only after `d` of *quiet* — but also after a hard maximum:

```go
type SettleDebouncer struct {
    mu      sync.Mutex
    quiet   *time.Timer
    hard    *time.Timer
    delay   time.Duration
    max     time.Duration
    fn      func()
}

func (db *SettleDebouncer) Trigger() {
    db.mu.Lock()
    defer db.mu.Unlock()
    if db.quiet != nil {
        db.quiet.Stop()
    }
    db.quiet = time.AfterFunc(db.delay, db.fire)
    if db.hard == nil {
        db.hard = time.AfterFunc(db.max, db.fire)
    }
}

func (db *SettleDebouncer) fire() {
    db.mu.Lock()
    if db.quiet != nil { db.quiet.Stop(); db.quiet = nil }
    if db.hard != nil { db.hard.Stop(); db.hard = nil }
    fn := db.fn
    db.mu.Unlock()
    fn()
}
```

If triggers keep arriving, the "quiet" timer keeps resetting. The "hard" timer fires regardless after `max`.

### FF.3 — The "tick + scheduled" hybrid

A ticker fires regularly, but a one-shot `AfterFunc` can preempt it for urgent work:

```go
type Scheduler struct {
    tick  *time.Ticker
    early *time.Timer
}

func (s *Scheduler) Run() {
    for {
        select {
        case <-s.tick.C:
            s.work()
        // when AfterFunc fires, it calls s.work() directly — no channel
        }
    }
}

func (s *Scheduler) ScheduleEarly(d time.Duration) {
    s.early = time.AfterFunc(d, s.work)
}
```

The mix lets you have both "regular cadence" and "urgent interrupts."

### FF.4 — The "lazy init" timer

A timer that exists only after first use:

```go
type Lazy struct {
    mu      sync.Mutex
    timer   *time.Timer
    delay   time.Duration
    pending []func()
}

func (l *Lazy) Schedule(fn func()) {
    l.mu.Lock()
    defer l.mu.Unlock()
    l.pending = append(l.pending, fn)
    if l.timer == nil {
        l.timer = time.AfterFunc(l.delay, l.flush)
    }
}

func (l *Lazy) flush() {
    l.mu.Lock()
    fns := l.pending
    l.pending = nil
    l.timer = nil
    l.mu.Unlock()
    for _, fn := range fns {
        fn()
    }
}
```

The first `Schedule` creates the timer; subsequent `Schedule`s just append. The timer's fire flushes everything pending.

### FF.5 — The "epoch-based" cleanup

```go
type Epoch struct {
    mu       sync.Mutex
    epoch    int64
    timers   map[int64]*time.Timer
}

func (e *Epoch) Open() int64 {
    e.mu.Lock()
    defer e.mu.Unlock()
    e.epoch++
    epoch := e.epoch
    t := time.AfterFunc(30*time.Minute, func() {
        e.mu.Lock()
        delete(e.timers, epoch)
        e.mu.Unlock()
        // do cleanup for this epoch
    })
    e.timers[epoch] = t
    return epoch
}

func (e *Epoch) Close(epoch int64) {
    e.mu.Lock()
    defer e.mu.Unlock()
    if t, ok := e.timers[epoch]; ok {
        t.Stop()
        delete(e.timers, epoch)
    }
}
```

Each "open" creates a timer for "auto-close after 30 min if not explicitly closed." Used in session stores, file-handle pools.

### FF.6 — The "queue with TTL" pattern

```go
type TTLQueue struct {
    mu      sync.Mutex
    items   []item
    timer   *time.Timer
}

type item struct {
    value   interface{}
    expires time.Time
}

func (q *TTLQueue) Push(v interface{}, ttl time.Duration) {
    q.mu.Lock()
    q.items = append(q.items, item{value: v, expires: time.Now().Add(ttl)})
    q.armLocked()
    q.mu.Unlock()
}

func (q *TTLQueue) Pop() (interface{}, bool) {
    q.mu.Lock()
    defer q.mu.Unlock()
    q.expireLocked()
    if len(q.items) == 0 {
        return nil, false
    }
    v := q.items[0].value
    q.items = q.items[1:]
    return v, true
}

func (q *TTLQueue) expireLocked() {
    now := time.Now()
    var keep []item
    for _, it := range q.items {
        if it.expires.After(now) {
            keep = append(keep, it)
        }
    }
    q.items = keep
}

func (q *TTLQueue) armLocked() {
    if len(q.items) == 0 {
        return
    }
    earliest := q.items[0].expires
    for _, it := range q.items {
        if it.expires.Before(earliest) {
            earliest = it.expires
        }
    }
    d := time.Until(earliest)
    if d < 0 { d = 0 }
    if q.timer == nil {
        q.timer = time.AfterFunc(d, q.sweep)
    } else {
        q.timer.Reset(d)
    }
}

func (q *TTLQueue) sweep() {
    q.mu.Lock()
    q.expireLocked()
    q.armLocked()
    q.mu.Unlock()
}
```

One timer; the queue self-expires.

### FF.7 — The "rate-limit aware retry"

```go
type RateLimitedRetry struct {
    mu       sync.Mutex
    nextOK   time.Time
    timer    *time.Timer
    fn       func() error
    onResult func(error)
}

func (r *RateLimitedRetry) try() {
    r.mu.Lock()
    if time.Now().Before(r.nextOK) {
        d := time.Until(r.nextOK)
        r.timer = time.AfterFunc(d, r.try)
        r.mu.Unlock()
        return
    }
    r.mu.Unlock()
    err := r.fn()
    if err != nil {
        if ratelimit, ok := err.(interface{ RetryAfter() time.Duration }); ok {
            r.mu.Lock()
            r.nextOK = time.Now().Add(ratelimit.RetryAfter())
            r.timer = time.AfterFunc(ratelimit.RetryAfter(), r.try)
            r.mu.Unlock()
            return
        }
    }
    r.onResult(err)
}
```

The retry respects `Retry-After` headers via the timer.

---

## Appendix GG: A timeline of timer-related Go changes (extended)

For the truly curious. This timeline lists when various aspects of Go timers were introduced or changed.

- **Go 1.0 (2012-03):** `time.AfterFunc`, `time.NewTimer`, `time.NewTicker` shipped.
- **Go 1.1 (2013-05):** Minor scheduler improvements; no specific timer changes.
- **Go 1.2 (2013-12):** Async signal handling improved; affects timer callback signal safety.
- **Go 1.3 (2014-06):** Goroutine stack scanning improved; affects GC of timer closures.
- **Go 1.4 (2014-12):** Internal runtime rewrite in Go (was C); timer code rewritten.
- **Go 1.5 (2015-08):** Concurrent GC; reduces timer callback latency under GC.
- **Go 1.6 (2016-02):** No timer-specific changes.
- **Go 1.7 (2016-08):** Faster startup; some timer benchmarks improve.
- **Go 1.8 (2017-02):** SSA backend everywhere; timer hot path is faster.
- **Go 1.9 (2017-08):** No timer-specific changes.
- **Go 1.10 (2018-02):** Monotonic clock added to `time.Time`; timers no longer perturbed by wall-clock adjustments.
- **Go 1.11 (2018-08):** No timer-specific changes.
- **Go 1.12 (2019-02):** Performance improvements in timer accuracy reported.
- **Go 1.13 (2019-09):** No timer-specific changes.
- **Go 1.14 (2020-02):** Async preemption; long-running callbacks can be preempted.
- **Go 1.15 (2020-08):** Timer accuracy improvements for high-frequency events.
- **Go 1.16 (2021-02):** No timer-specific changes.
- **Go 1.17 (2021-08):** No timer-specific changes.
- **Go 1.18 (2022-03):** Generics. No timer changes.
- **Go 1.19 (2022-08):** No timer-specific changes.
- **Go 1.20 (2023-02):** No timer-specific changes.
- **Go 1.21 (2023-08):** `context.AfterFunc` introduced. Timer accuracy on Windows improved.
- **Go 1.22 (2024-02):** Loop variable scoping; affects timer closures in loops.
- **Go 1.23 (2024-08):** Timer state machine simplified; `Reset` drain dance no longer required for channel timers.
- **Go 1.24 (2025-02):** `testing/synctest` for time-deterministic tests.

If you maintain a long-lived service, the most consequential changes are 1.10 (monotonic), 1.14 (async preemption), 1.21 (`context.AfterFunc`), 1.22 (loop scoping), and 1.23 (timer simplification).

---

## Appendix HH: A reading exercise — the runtime's timer test suite

The Go standard library has extensive tests for timers in `time/sleep_test.go` and elsewhere. Reading these tests is illuminating because they document edge cases:

- "Test that Stop works concurrently with the timer firing."
- "Test that Reset on a stopped timer reactivates it."
- "Test that timer.C is nil for AfterFunc."
- "Test that very short durations fire promptly."
- "Test that very long durations don't allocate excessively."

Find the file in `$GOROOT/src/time/`. Read the tests. Run them. Modify them slightly and observe outcomes.

This is by far the fastest way to develop intuition for the corner cases.

---

## Appendix II: Senior-level checklist for code review

When reviewing code that uses `time.AfterFunc`, ask:

1. **What is the duration?** Is it bounded? Computed correctly? Could it be negative or huge?
2. **What does the callback do?** Is it idempotent? Does it have side effects?
3. **Is the return value used?** If `Stop` is called, what does `false` mean here?
4. **Is the closure capture small?** Could it capture an ID instead of a struct?
5. **Is there panic recovery?** Should there be?
6. **What is the cancellation story?** Does the timer leak if the caller errors out?
7. **Is the timer in a map?** Will it be deleted on cleanup?
8. **Are there many of these?** At what rate? What is the steady-state count?
9. **Could `context.AfterFunc` be used instead?** Often yes.
10. **Is there a test?** Does it use a real clock or a mock?

Even one issue here can be a production bug.

---

## Appendix JJ: Decision tree for choosing a timer pattern

```
Need to do something after a duration?
├── Yes
│   ├── Need to cancel before it fires?
│   │   ├── Yes
│   │   │   ├── Need to integrate into a select?
│   │   │   │   ├── Yes → time.NewTimer
│   │   │   │   └── No  → time.AfterFunc, capture *Timer
│   │   └── No → time.AfterFunc, discard *Timer (or capture for safety)
│   ├── Need to fire repeatedly?
│   │   ├── Yes
│   │   │   ├── Want strict period? → time.NewTicker
│   │   │   └── Want "d after last finish"? → self-rescheduling AfterFunc
│   └── Need to integrate with context?
│       ├── Yes (trigger is context cancel) → context.AfterFunc
│       └── Yes (trigger is duration; ctx is auxiliary) → time.AfterFunc + context.AfterFunc(ctx, t.Stop)
└── No → not a timer; use a channel or sync.Cond
```

Apply this tree to any "I want to do X after Y" requirement.

---

## Appendix KK: When AfterFunc is the wrong tool

There are cases where reaching for `AfterFunc` is a sign of a design issue.

### Wrong: using AfterFunc to delay startup

```go
time.AfterFunc(time.Second, startServer)
```

Just call `time.Sleep` in main or schedule the startup synchronously. The asynchronous goroutine spawn for a one-time event is overkill.

### Wrong: using AfterFunc to "fire-and-forget" work

```go
time.AfterFunc(0, doWork) // run doWork in a goroutine
```

That's just `go doWork()`. The timer machinery is unnecessary overhead.

### Wrong: using AfterFunc as a state machine

```go
time.AfterFunc(d1, func() {
    time.AfterFunc(d2, func() {
        time.AfterFunc(d3, finalAction)
    })
})
```

Three nested timers expressing a "do A, then B, then C" sequence. This is a state machine; use a goroutine with explicit transitions:

```go
go func() {
    time.Sleep(d1)
    stepA()
    time.Sleep(d2)
    stepB()
    time.Sleep(d3)
    stepC()
}()
```

(Trivially cancelled via context cancellation in the goroutine.)

### Wrong: using AfterFunc for synchronous waits

```go
done := make(chan struct{})
time.AfterFunc(d, func() { close(done) })
<-done
```

Just call `time.Sleep(d)`. Same effect, no goroutine spawn.

### Wrong: using AfterFunc as a debouncer's only mechanism in a single-goroutine event loop

If your application has a single event loop goroutine, you can debounce by tracking a deadline within the loop:

```go
deadline := time.Time{}
for {
    select {
    case ev := <-events:
        deadline = time.Now().Add(debounce)
        latest = ev
    case <-time.After(time.Until(deadline)):
        process(latest)
    }
}
```

No `AfterFunc`. Single goroutine, simple logic.

---

## Appendix LL: The runtime's interaction with finalizers

`runtime.SetFinalizer` schedules a function to run when an object becomes unreachable. Finalizers run on a special goroutine (the "finalizer goroutine").

If a finalizer calls `time.AfterFunc`, the timer is registered like any other. The callback runs on a new goroutine (not the finalizer goroutine).

If a `time.Timer` itself becomes unreachable (no one holds a reference), what happens? The runtime keeps a reference for as long as the timer is on a heap. After fire (or Stop+drop), there is no reference, and the `*time.Timer` becomes garbage.

So you cannot rely on a finalizer to stop a `*time.Timer` — the timer reference is held by the runtime, not by you, and the GC can't collect what is referenced.

Don't try `runtime.SetFinalizer(t, func(t *time.Timer) { t.Stop() })`. It doesn't fire because `t` is reachable via the runtime.

---

## Appendix MM: A worked example — debugging a "callback never fires" bug

A real bug pattern:

```go
type Worker struct {
    mu  sync.Mutex
    t   *time.Timer
}

func (w *Worker) start() {
    w.mu.Lock()
    defer w.mu.Unlock()
    w.t = time.AfterFunc(time.Second, w.process)
}

func (w *Worker) process() {
    w.mu.Lock()
    defer w.mu.Unlock()
    // ... do work, possibly takes long ...
}

func (w *Worker) stop() {
    w.mu.Lock()
    defer w.mu.Unlock()
    w.t.Stop()
    // ... cleanup ...
}
```

User reports: sometimes `process` never runs.

### Diagnosis

`start` acquires the lock and creates the timer. The timer's callback (`process`) takes the lock. As long as `start` is holding the lock when the callback fires, the callback's goroutine is parked on the lock, fine — it will eventually proceed.

But what about `stop`? `stop` takes the lock, then calls `t.Stop()`. If `Stop` runs before the callback fires, the callback never runs.

That is by design — `stop` is supposed to prevent the callback. But the user is seeing it happen *spontaneously*, without an explicit `stop`.

Look closer: maybe the user is calling `stop` from a deferred goroutine on shutdown. Or maybe the timer is being GC'd because the `*Worker` is unreachable... but no, the timer holds a reference back to the closure, which holds the receiver, which holds itself reachable through the runtime's timer heap entry.

### Found it

The bug was elsewhere: an old `Worker` was being garbage collected because the application replaced it with a new one. The old one's `start` had registered a callback. When the application discards its reference to the old worker, the timer still holds the closure, which holds the worker. So the timer should fire. But the worker's `mu` lock is taken by the new worker, which has unrelated activity.

No, wait — old and new workers have different `*Worker` instances, so they have different `mu`s. The lock is not shared.

Actually, the bug is: in the user's code, they were doing:

```go
w := &Worker{}
w.start()
// ... use w ...
w = &Worker{} // replace; old one becomes garbage
w.start()
```

The old `*Worker` is unreachable from user code. But it has a `*time.Timer` whose closure references `w.process`, which references the old `*Worker`. So the old `*Worker` is reachable from the runtime's timer entry. It should not be GC'd.

The timer fires. The callback runs on a new goroutine. It acquires `w.mu` — but wait, the goroutine references the *original* worker via the closure. It acquires that worker's `mu`. Fine.

OK, this isn't the bug.

Eventually we discover: the user is running their tests with `t.Parallel()` and the test harness is shutting down the test before the 1-second timer fires. The test process is `os.Exit`ing, killing all goroutines and pending timers.

**The lesson:** if a timer "never fires," investigate the lifecycle of the process, not just the timer code. `time.AfterFunc` is reliable; what runs the callback is the runtime, which dies when the process dies.

---

## Appendix NN: Cross-cutting concerns — security, fairness, observability

### Security

A timer callback's closure may capture sensitive data. If the duration is long, the data sits in memory. For very sensitive data (cryptographic keys), zero the memory in the callback or use `runtime.GC()` after stopping the timer to encourage cleanup.

User-controlled durations can be a vector for resource exhaustion. If the user can request "do X in N seconds," cap N. Otherwise, an attacker could request very long durations, accumulating timers and memory.

### Fairness

If many timers expire at once, the runtime fires them in heap order (effectively in insertion order for same-`when`). The first timer's callback runs first. This is mostly fair, but if your callbacks have wildly varying costs, you can starve later callbacks.

For fairness across users, consider tagging timers with a user ID and processing them in round-robin order from a queue.

### Observability

Production timer usage should expose metrics:

- Number of live timers.
- Rate of timer creations.
- Rate of timer fires.
- Rate of timer stops.
- Median and p99 latency between scheduled and actual fire time.

The runtime does not export these; build your own bookkeeping if it matters.

```go
type ObservableTimer struct {
    *time.Timer
    scheduledAt time.Time
}

func ObservableAfterFunc(d time.Duration, f func(), m *metrics) *ObservableTimer {
    m.Live.Inc()
    m.Created.Inc()
    start := time.Now()
    var ot *ObservableTimer
    ot = &ObservableTimer{
        scheduledAt: start,
    }
    ot.Timer = time.AfterFunc(d, func() {
        m.Live.Dec()
        m.Fired.Inc()
        actual := time.Now()
        m.Lateness.Observe(actual.Sub(start.Add(d)).Seconds())
        f()
    })
    return ot
}
```

The professional file goes deeper into observability.

---

## Appendix OO: Common interview questions at senior level

**Q.** Sketch how `time.AfterFunc` is implemented.

**A.** Embed `runtimeTimer` in a `time.Timer`. Insert into a P-local min-heap, keyed on `when` (monotonic ns). The runtime checks the heap at scheduler iterations and netpoller wakeups; expired entries are popped and the runtime spawns a goroutine to run the wrapper function which calls the user's `f` via `go arg.(func())()`.

**Q.** Why does Go use a heap instead of a timing wheel?

**A.** The heap is simple, accurate, and good enough at moderate scale. Timing wheels are O(1) amortised but require more code and have precision limits. Go optimised for the common case.

**Q.** What is the boolean return of `Stop`?

**A.** `true` iff this call removed the timer from the heap. Does not indicate whether the callback ran.

**Q.** What is the boolean return of `Reset`?

**A.** `true` iff the timer was active before the call. Reset always reschedules.

**Q.** Why was the pre-1.23 state machine complex?

**A.** It evolved organically as bugs were fixed. Each subtle race needed a new state. Go 1.23 consolidated.

**Q.** How would you scale to a million timers?

**A.** Batching. Use a single timer for the earliest deadline, plus a user-space min-heap of pending entries. Or a timing wheel for O(1) inserts at the cost of precision.

**Q.** What is the cost of `time.After` in a tight select?

**A.** Each iteration allocates a `*time.Timer` and a channel. In Go 1.23+ unused timers can be GC'd promptly; before that, abandoned timers stayed until fire. Either way, in a tight loop, reuse a `*time.Timer` via `Reset` instead.

**Q.** How does context.AfterFunc differ from goroutine + ctx.Done?

**A.** No parked goroutine. The callback is registered on the context and runs at cancellation, in a freshly-spawned goroutine.

**Q.** When does a timer's `when` use the monotonic clock?

**A.** Always. Since Go 1.10, all timers use monotonic time; wall-clock adjustments don't perturb them.

**Q.** Can a callback be running when `Reset` is called?

**A.** Yes. `Reset` does not wait for the callback. The new fire schedules another invocation; two callbacks can be alive simultaneously.

---

## Appendix PP: Three more deep dives

### PP.1 — The relationship between timers and GMP

`G`, `M`, `P` are goroutines, machines (OS threads), and logical processors. Timers are per-P. Goroutines are scheduled to P's; P's run on M's.

A timer is created on the goroutine's current P. It stays there until fire (or until the P is destroyed). When the timer fires, the runtime calls the wrapper from the P that owns it, which spawns a goroutine on... the same P initially, but possibly migrated for load balancing.

The wrapper runs on the system stack (or the P's goroutine stack); the new goroutine then runs the user's callback.

This per-P model is why creating timers from many goroutines is cheap — no global synchronisation.

### PP.2 — How the scheduler decides when to check timers

The scheduler's main loop (`schedule()` in `runtime/proc.go`) decides each iteration what to run. It checks:

1. Stale work from other P's (work stealing).
2. The global run queue.
3. The local run queue.
4. The netpoller (`netpoll()`).
5. The timer heap (`checkTimers`).

`checkTimers` returns the time at which the next timer should fire, used to set the timeout on the next `epoll_wait` (or equivalent) call.

This means: timers are checked at every scheduling decision, and the netpoller's wakeup is driven by the next timer's deadline. Timer accuracy is bounded by the netpoller's latency.

### PP.3 — The cost of `wakeNetPoller`

When `addtimer` inserts a timer earlier than the current netpoll deadline, it calls `wakeNetPoller(when)`. This writes to a runtime "wake-up" pipe (or similar), which the netpoller-blocked thread sees and returns from `epoll_wait`.

The cost is a syscall to write a byte; ~microsecond. Negligible for moderate workloads.

For extremely high timer creation rates, this can add up. Consider batching the inserts and updating the netpoll deadline once at the end.

---

## Appendix QQ: A side-by-side: time.AfterFunc vs golang.org/x/sync/singleflight

Different problem, related techniques.

`singleflight.Group` provides "do this once for many callers; share the result." `AfterFunc` is just "do this after a delay."

But you can compose them: "do this after a delay, but only one in flight at a time" — combine `singleflight` with `AfterFunc`:

```go
var sf singleflight.Group

time.AfterFunc(d, func() {
    sf.Do("key", func() (interface{}, error) {
        return work(), nil
    })
})
```

If two timers fire near-simultaneously and both call `sf.Do("key", ...)`, only one will execute `work()`. The other observes the result.

---

## Appendix RR: A summary diagram of all the moving parts

```
                          User code
                             |
                             | time.AfterFunc(d, f)
                             v
                          time.Timer (struct)
                             |
                             | embedded
                             v
                          runtimeTimer (heap entry)
                             |
                             | added to
                             v
                          P-local min-heap
                             |
                          ... time passes ...
                             |
                             | when <= now
                             v
                          runtime.runtimer pops it
                             |
                             | calls
                             v
                          goFunc (wrapper)
                             |
                             | `go arg.(func())()`
                             v
                          New goroutine
                             |
                             | runs
                             v
                          User's f
                             |
                             | (eventually) returns
                             v
                          Goroutine exits
                             |
                             | timer entry no longer reachable
                             v
                          GC reclaims it
```

Every arrow in this diagram is either a function call, a heap op, or a goroutine spawn. The path from `AfterFunc(d, f)` to `f()` traverses each one, in order.

---

## Appendix SS: A 600-line "what's actually on the stack" example

Sometimes the best way to understand a runtime feature is to read a stack trace at the moment of fire.

### Setup

```go
package main

import (
    "fmt"
    "runtime"
    "time"
)

func main() {
    done := make(chan struct{})
    time.AfterFunc(100*time.Millisecond, func() {
        buf := make([]byte, 8192)
        n := runtime.Stack(buf, false)
        fmt.Println(string(buf[:n]))
        close(done)
    })
    <-done
}
```

### Output

```
goroutine 5 [running]:
main.main.func1()
        /tmp/m.go:13 +0x4f
created by time.goFunc in goroutine 1
        /usr/local/go/src/time/sleep.go:215 +0x2d
```

What this tells us:

- The callback runs on a fresh goroutine (number 5; goroutine 1 was main).
- The creating goroutine is goroutine 1 (`main`), at line 215 of `sleep.go`, in `time.goFunc`.
- `goFunc` is the wrapper that did `go arg.(func())()`.
- The user's callback is at `/tmp/m.go:13`.

### What you can read from this

- The callback's call stack does **not** include `time.AfterFunc`. The runtime spawned a fresh goroutine; the call stack starts at the user's closure.
- The "created by" line points at `time.goFunc`, the wrapper.
- The wrapper itself does not appear on the stack — because it has already returned. The wrapper's body is `go arg.(func())()`, which spawns the new goroutine and exits.

### Why the runtime hides goFunc on the stack

`goFunc` is just `go arg.(func())()`. It is two lines:

```go
func goFunc(arg any, seq uintptr) {
    go arg.(func())()
}
```

After the `go` statement, `goFunc` returns. The new goroutine starts running the user's callback. By the time `runtime.Stack` is called inside the callback, `goFunc` is already off the stack of its goroutine (which itself is done).

The "created by" line is the runtime's way of preserving the lineage information.

---

## Appendix TT: Two more deep concurrent scenarios

### TT.1 — A timer firing during stop-the-world GC

A stop-the-world GC pause (in modern Go, typically < 1 ms) halts all goroutines. Timer callbacks can't fire because the runtime can't spawn goroutines.

If a timer's `when` passes during STW, the runtime fires it as soon as the STW ends. The callback runs late by the duration of the STW.

For sub-millisecond accuracy, this matters. For typical service workloads, it doesn't.

### TT.2 — A timer firing during a `runtime.LockOSThread` window

`runtime.LockOSThread` pins a goroutine to its current OS thread. The goroutine continues running normally; the thread continues to be a member of the M-pool.

Does this affect timer firing? No. The P is still around; it still checks the timer heap; it still spawns callback goroutines. The locked goroutine doesn't run callbacks (since it is locked to other work), but other P's can.

If `GOMAXPROCS=1` and the only P's only goroutine is locked... then the P can't run anything else, and timers don't fire. This is an exotic situation.

---

## Appendix UU: Why timer callbacks should be short

In runtime-managed scheduling, "short" goroutines are friendly. The scheduler can wedge them into gaps. "Long" goroutines hold a P for longer.

For timer callbacks, this implies:

- A short callback (microseconds, milliseconds) runs to completion quickly, freeing the P.
- A long callback (seconds) holds the P, delaying other work on that P.

If your callback is long, dispatch it to a worker:

```go
time.AfterFunc(d, func() {
    workQueue <- someJob
})
```

The callback enqueues the work and exits within microseconds. A separate worker pool handles the actual long task.

### Worker pool example

```go
type Pool struct {
    work chan func()
}

func NewPool(n int) *Pool {
    p := &Pool{work: make(chan func(), 1024)}
    for i := 0; i < n; i++ {
        go func() {
            for f := range p.work {
                f()
            }
        }()
    }
    return p
}

func (p *Pool) Submit(f func()) {
    p.work <- f
}

// usage
pool := NewPool(runtime.NumCPU())
time.AfterFunc(d, func() {
    pool.Submit(actualWork)
})
```

This decouples the "fire" event from the "do work" execution. The callback is always short.

---

## Appendix VV: Subtle behaviour around context.AfterFunc lifecycle

`context.AfterFunc(ctx, f)`:

- Registers `f` as a "to do on cancel" function.
- Returns a `stop func() bool`.
- If `ctx` cancels before `stop` is called, `f` runs in a new goroutine.
- If `stop` is called before cancel, `f` is unregistered and will not run.

What if `ctx` is *already cancelled* when you call `AfterFunc`?

```go
ctx, cancel := context.WithCancel(context.Background())
cancel()
stop := context.AfterFunc(ctx, func() {
    fmt.Println("ran")
})
time.Sleep(50 * time.Millisecond)
fmt.Println(stop())
```

The callback runs because the context is already done. `stop()` returns `false`.

What if you call `stop` twice?

```go
stop := context.AfterFunc(ctx, f)
fmt.Println(stop()) // first time, may return true or false
fmt.Println(stop()) // second time, returns false
```

The first call returns true iff it was the one to remove the registration. The second always returns false (already removed).

### Memory ordering

`context.AfterFunc`'s `stop` provides a memory-ordering guarantee: if `stop()` returns true, the callback has not started and will not start (and you can safely read shared state without further synchronisation).

If `stop()` returns false, the callback may be running, finished, or scheduled. You may need to synchronise.

---

## Appendix WW: Performance tuning checklist

If you suspect timer-related performance issues:

1. **Count timers.** Add a metric for live timers. Watch it in production.
2. **Count creations.** Track creates per second.
3. **Count stops.** If creates >> stops, you may have a leak.
4. **Profile CPU.** Look for `runtime.siftdownTimer`, `runtime.checkTimers`.
5. **Profile heap.** Look for accumulating `runtimeTimer` allocations.
6. **Profile goroutines.** Look for goroutines stuck in `time.Sleep` or `<-time.After`.
7. **Measure fire latency.** Schedule N timers, record `actual - scheduled`.
8. **Check for `time.After` in loops.** Replace with reused `*time.Timer`.
9. **Check for goroutines waiting on contexts via `<-ctx.Done`.** Replace with `context.AfterFunc`.
10. **Audit closure captures.** Look for large struct captures.
11. **Consider batching.** Switch to earliest-deadline scheduler at >100K timers.
12. **Tune GOMAXPROCS.** Higher = more parallel timer firing.
13. **Tune GC.** `GOGC` higher = less GC frequency, but more memory.
14. **Tune deadlines.** Are they too aggressive? Too lenient?
15. **Look at the kernel side.** `perf top` may reveal `futex` or `epoll_wait` overhead.

Most issues fall out of the first three checks. The latter are for harder cases.

---

## Appendix XX: A timeline of timer-related GitHub issues to skim

If you want to read real bug reports and discussions:

- golang/go#6452 — "leak after Stop"
- golang/go#17448 — "data race in Reset"
- golang/go#25686 — "Reset returns incorrect value"
- golang/go#27707 — "timer accuracy under load"
- golang/go#32834 — "timer not firing"
- golang/go#34025 — "Sleep vs timer"
- golang/go#50059 — "Reset semantics"
- golang/go#56171 — "Reset proposal updates"
- golang/go#60665 — "context.AfterFunc"
- golang/go#62410 — "timer simplification"

The discussions reveal the design constraints and trade-offs. Recommended reading.

---

## Appendix YY: Tying it all together with one big example

A small, complete, production-flavoured service that uses every timer pattern we've discussed.

```go
package main

import (
    "context"
    "fmt"
    "log"
    "math/rand"
    "net/http"
    "sync"
    "sync/atomic"
    "time"
)

// A "request" object representing in-flight work.
type Request struct {
    ID       string
    started  time.Time
    deadline time.Time

    mu       sync.Mutex
    done     bool
}

// A "session" with idle timeout.
type Session struct {
    mu      sync.Mutex
    timer   *time.Timer
    idle    time.Duration
    onClose func()
    closed  bool
}

func newSession(idle time.Duration, onClose func()) *Session {
    s := &Session{idle: idle, onClose: onClose}
    s.timer = time.AfterFunc(idle, s.fire)
    return s
}

func (s *Session) Touch() bool {
    s.mu.Lock()
    defer s.mu.Unlock()
    if s.closed {
        return false
    }
    return s.timer.Reset(s.idle)
}

func (s *Session) Close() {
    s.mu.Lock()
    defer s.mu.Unlock()
    if s.closed {
        return
    }
    s.closed = true
    s.timer.Stop()
    s.onClose()
}

func (s *Session) fire() {
    s.mu.Lock()
    if s.closed {
        s.mu.Unlock()
        return
    }
    s.closed = true
    s.mu.Unlock()
    s.onClose()
}

// A debounced flush for log lines.
type LogFlusher struct {
    mu     sync.Mutex
    buf    []string
    timer  *time.Timer
    delay  time.Duration
}

func newLogFlusher(d time.Duration) *LogFlusher {
    return &LogFlusher{delay: d}
}

func (lf *LogFlusher) Log(s string) {
    lf.mu.Lock()
    defer lf.mu.Unlock()
    lf.buf = append(lf.buf, s)
    if lf.timer == nil {
        lf.timer = time.AfterFunc(lf.delay, lf.flush)
    }
}

func (lf *LogFlusher) flush() {
    lf.mu.Lock()
    msgs := lf.buf
    lf.buf = nil
    lf.timer = nil
    lf.mu.Unlock()
    for _, m := range msgs {
        log.Println("flush:", m)
    }
}

// A request handler with deadline and cleanup.
func handle(w http.ResponseWriter, r *http.Request) {
    ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
    defer cancel()

    // Schedule a cleanup at request completion (via context).
    cleanup := context.AfterFunc(ctx, func() {
        log.Println("cleanup for", r.URL.Path)
    })
    defer cleanup()

    // Do some work; emit a log line.
    flusher.Log(fmt.Sprintf("request %s", r.URL.Path))

    // Maybe schedule a delayed action.
    if rand.Intn(10) == 0 {
        time.AfterFunc(1*time.Second, func() {
            log.Println("delayed work for", r.URL.Path)
        })
    }

    fmt.Fprintln(w, "ok")
}

// Global state for the example.
var flusher = newLogFlusher(200 * time.Millisecond)
var liveSessions atomic.Int64

func main() {
    // Run a watchdog: bark every 30s if we're inactive.
    var lastActivity atomic.Int64
    lastActivity.Store(time.Now().UnixNano())

    watchdog := time.AfterFunc(30*time.Second, func() {
        log.Println("watchdog: 30s inactivity")
    })
    _ = watchdog

    http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
        lastActivity.Store(time.Now().UnixNano())
        watchdog.Reset(30 * time.Second)
        handle(w, r)
    })

    log.Println("listening on :8080")
    log.Fatal(http.ListenAndServe(":8080", nil))
}
```

This little service uses:

- `context.AfterFunc` for per-request cleanup.
- `time.AfterFunc` for delayed work.
- `*time.Timer` with `Reset` for an idle-session timeout (`Session`).
- A debounced flush (`LogFlusher`) for batched logging.
- A watchdog with `Reset` for inactivity detection.

It is not perfectly idiomatic — real services use frameworks for HTTP and metrics — but it shows the patterns side by side.

---

## Appendix YZ: Two more advanced exercises

### YZ.1 — Implement an O(1)-amortized timer wheel

Implement a single-level timing wheel (256 buckets, 10 ms tick). Insertion O(1), tick processing O(bucket size). Compare to the heap on a benchmark with 100K live timers.

### YZ.2 — A formal cost model

Derive equations for memory, CPU, and latency as functions of N (live timer count) and R (creation rate) for:

- Per-entry heap (Go's built-in).
- Earliest-deadline scheduler.
- Single-level timing wheel.

For each, find the value of N where the alternative outperforms the built-in.

### YZ.3 — Profile a real workload

Take any open-source Go project (e.g., Kubernetes, etcd, Prometheus). Run a benchmark. Profile. Identify the top three timer-related cost centers. Hypothesise an optimisation. Implement and verify.

This is essentially a small research project — but valuable.

---

## Appendix ZZ: A final senior-level "stress my understanding" puzzle set

Each puzzle isolates one subtle aspect.

### Puzzle 1
What does this print?
```go
t := time.AfterFunc(0, func() { fmt.Println("a") })
fmt.Println(t.Stop())
time.Sleep(time.Second)
```
Possible answers depending on timing:
- `true` then nothing.
- `false` then `a`.
- `a` then `false`.

The order between `a` and `false` is determined by when the runtime gets to fire the timer vs when main calls Stop. Race.

### Puzzle 2
```go
t := time.AfterFunc(0, func() {})
t.Stop()
t.Stop()
t.Reset(0)
t.Stop()
```
What is the sequence of returns?

Answer depends on timing. The first `Stop` likely returns `true` (if it beats the fire) or `false` (otherwise). Subsequent calls reflect heap state.

### Puzzle 3
```go
var x int
t := time.AfterFunc(time.Millisecond, func() { x = 1 })
runtime.Gosched()
fmt.Println(t.Stop(), x)
```
Race on `x`. With `-race`, detector fires.

### Puzzle 4
```go
var t *time.Timer
t = time.AfterFunc(time.Millisecond, func() {
    fmt.Println(t == nil)
})
time.Sleep(time.Second)
```
Prints `false`. The closure captures `t` by reference, and by the time the callback runs, `t` has been assigned.

### Puzzle 5
```go
done := make(chan struct{})
time.AfterFunc(time.Millisecond, func() {
    close(done)
    close(done) // double close
})
<-done
time.Sleep(100 * time.Millisecond)
```
Crashes with "close of closed channel" panic, which is unrecovered, killing the program.

### Puzzle 6
```go
ctx, cancel := context.WithTimeout(context.Background(), 10*time.Millisecond)
defer cancel()
context.AfterFunc(ctx, func() {
    time.Sleep(100 * time.Millisecond)
})
time.Sleep(200 * time.Millisecond)
fmt.Println("end")
```
Prints "end" after ~200 ms. The cleanup goroutine runs for 100 ms but does not block main.

### Puzzle 7
```go
for i := 0; i < 3; i++ {
    i := i
    go func() {
        time.AfterFunc(10*time.Millisecond, func() {
            fmt.Println(i)
        })
    }()
}
time.Sleep(100 * time.Millisecond)
```
Prints `0`, `1`, `2` in some order.

### Puzzle 8
```go
var wg sync.WaitGroup
wg.Add(1)
t := time.AfterFunc(time.Hour, wg.Done)
wg.Done()
wg.Wait()
fmt.Println(t.Stop())
```
The first `wg.Done` matches the `Add(1)`. The waitgroup is now at 0. `wg.Wait` returns immediately. The timer is stopped. If the runtime fires the timer (which it shouldn't, since 1 hour hasn't passed), `wg.Done` panics ("negative WaitGroup counter"). Output: `true` (Stop succeeded).

### Puzzle 9
```go
ctx, cancel := context.WithCancel(context.Background())
defer cancel()
stop := context.AfterFunc(ctx, func() {
    cancel() // calling cancel inside the callback
})
cancel()
stop()
```
Calling `cancel` is idempotent. The first call triggers the callback. Inside the callback, the second call does nothing. `stop()` returns false (already fired).

### Puzzle 10
```go
t := time.AfterFunc(time.Millisecond, nil)
time.Sleep(100*time.Millisecond)
```
`time.AfterFunc(d, nil)` — at fire time, the wrapper does `go arg.(func())()`. The cast of nil to `func()` succeeds, but the call panics with "nil function call." Program crashes.

---

If you can predict the output of each of these without running, you have a solid senior-level grasp.

---

## Appendix AAB: Notes on hardware and OS

### CPU effects

- L1/L2 cache: timer heap operations are mostly cache-friendly for small heaps (< 1000 entries).
- TLB misses: at huge heaps (millions), TLB pressure becomes measurable.
- NUMA: on multi-socket systems, P's are pinned to NUMA nodes; cross-socket access is slow.

### OS effects

- Linux kernel timers: high-resolution. Used internally by epoll for wake-on-timeout.
- macOS: similar via kqueue.
- Windows: IOCP. Higher tick granularity historically (15.6 ms); now sub-millisecond on modern Windows.

### Container effects

- CPU quota: under quota, P's are throttled by the kernel; timers fire late.
- Memory limit: OOMs kill the process; timers are lost.
- Use `automaxprocs` to set `GOMAXPROCS` from container limits.

### Cloud effects

- VM throttling / "noisy neighbor": timers can fire late on shared hardware.
- Spot instances: termination at any moment; timers are gone.

For predictable timer behaviour, use dedicated hosts or container resources with reservations.

---

## Appendix AAC: A meta-summary

At the senior level, `time.AfterFunc` is:

- A heap-based scheduler primitive.
- Each timer lives on a P's local min-heap.
- Fire path: pop heap, spawn goroutine, run callback.
- Stop and Reset are O(log n) heap operations.
- Cost scales linearly with N for memory; O(log N) for ops.

Knowing this lets you predict performance and design accordingly. The professional level adds operational wisdom on top.

---

End of senior-level material. See `professional.md` for production stories: deadlines, watchdogs, observability, postmortems.



