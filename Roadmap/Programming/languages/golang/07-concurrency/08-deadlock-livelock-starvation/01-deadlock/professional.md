# Deadlock in Go — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [`checkdead` in `runtime/proc.go`](#checkdead-in-runtimeprocgo)
3. [The `gopark`/`goready` Cycle and the Detector's Counter](#the-goparkgoready-cycle-and-the-detectors-counter)
4. [What Counts as Alive: Special-Case Logic](#what-counts-as-alive-special-case-logic)
5. [Mutex Internals and Park States](#mutex-internals-and-park-states)
6. [`semroot` and the Semaphore Tree](#semroot-and-the-semaphore-tree)
7. [Why Channels Cannot Reuse Mutex Detection](#why-channels-cannot-reuse-mutex-detection)
8. [`runtime/trace` and Deadlock-Relevant Events](#runtimetrace-and-deadlock-relevant-events)
9. [Extending the Runtime: Partial-Deadlock Hypotheticals](#extending-the-runtime-partial-deadlock-hypotheticals)
10. [Summary](#summary)

---

## Introduction

This file is for engineers who want to understand exactly what the Go runtime does when it prints `fatal error: all goroutines are asleep - deadlock!`, and what it does *not* do. Everything below refers to Go 1.21+ source; details vary slightly across versions, but the architecture has been stable since Go 1.5.

The questions answered here:

- What code path in the runtime fires the message?
- Which goroutine states count as "asleep" and which as "alive"?
- Why does `time.Sleep` mask deadlock detection? Why does `runtime.LockOSThread`? Why does cgo?
- Why does the detector only handle whole-program deadlock, not partial?
- What would it take to extend the runtime to detect partial deadlock?

This is not a "you must know this to write Go" file. It is a "if you ever debug a deadlock that does not match the textbook, this is the level you reach" file.

---

## `checkdead` in `runtime/proc.go`

The function lives in `src/runtime/proc.go`. Its core (Go 1.21, simplified):

```go
func checkdead() {
    assertLockHeld(&sched.lock)

    // For -buildmode=c-archive or c-shared, the calling thread
    // is foreign; if it is running, we are not dead.
    if islibrary || isarchive {
        return
    }

    // If we are dying because of a signal caught on an already idle
    // thread, freezetheworld will cause all running threads to block.
    // And runtime will essentially enter into deadlock state, except
    // that there is a thread that will call exit soon.
    if panicking.Load() > 0 {
        return
    }

    // If we are not running under the toolchain that knows about race
    // detector, just skip.
    if raceenabled {
        // ...
    }

    var grunning, s uint32
    forEachG(func(gp *g) {
        if isSystemGoroutine(gp, false) {
            return
        }
        s = readgstatus(gp)
        switch s &^ _Gscan {
        case _Gwaiting,
            _Gpreempted:
            grunning++
        case _Grunnable,
            _Grunning,
            _Gsyscall:
            print("runtime: checkdead: ...")
            throw("checkdead: runnable g")
        }
    })

    unlock(&sched.lock)
    fatal("all goroutines are asleep - deadlock!")
}
```

Walk through:

- `assertLockHeld(&sched.lock)` — the function runs holding the scheduler lock. The caller (`stopm`, `notesleep`, etc.) takes the lock before calling.
- The early returns handle special build modes and ongoing panic.
- `forEachG` iterates every goroutine.
- `isSystemGoroutine` filters out runtime-internal goroutines: GC, sweep, finalizer, scavenger, trace reader.
- The switch counts goroutines in `_Gwaiting` and `_Gpreempted` (these are "alive enough to potentially wake"). It panics if it finds anything in `_Grunnable`, `_Grunning`, or `_Gsyscall` — those should have prevented `checkdead` from being called in the first place.
- If no runnable user goroutine remains, throw the fatal error.

The function is invoked from various park paths in the scheduler, after the parked goroutine's count has been updated. It is cheap — a single iteration over the goroutine list, no graph analysis.

---

## The `gopark`/`goready` Cycle and the Detector's Counter

Every blocking operation in Go ultimately calls `gopark`. Examples:

- Channel send/receive: `chansend` / `chanrecv` call `gopark`.
- Mutex acquire (slow path): `sync.runtime_SemacquireMutex` calls `semacquire` which calls `gopark`.
- WaitGroup wait: `sync.runtime_Semacquire` does the same.
- `select` with no immediately-ready case: `selectgo` calls `gopark`.
- `time.Sleep`: calls `goparkunlock` (a variant of `gopark`).

`gopark` does:

1. Marks the goroutine as `_Gwaiting`.
2. Records a reason (one of the `waitReason*` constants — `waitReasonChanReceive`, `waitReasonSemacquire`, etc.).
3. Stores the goroutine on a wait list (channel queue, semaphore root, etc.).
4. Calls `mcall(park_m)`, which switches to the M's scheduler context.
5. The scheduler picks another goroutine to run.

When that goroutine eventually wakes (via `goready`), it transitions `_Gwaiting → _Grunnable` and is placed on a run queue. `goready` is called from the "wake" side of every primitive: `chansend` waking a blocked receiver, `Mutex.Unlock` waking a contender, `Cond.Signal`, timer expiry.

The detector's counter (informally) is the number of non-system goroutines not in `_Gwaiting`. After each `gopark`, the scheduler checks: if this park leaves zero runnable goroutines, call `checkdead`. The check happens inside `stoplockedm` and `stopm`, the functions called when an M (OS thread) has nothing to run.

The crucial detail: `gopark` with a timer (like `time.Sleep`) does not decrement the live-count in the same way as a parameterless park. The timer wheel is itself a wakeup source. Let me clarify.

---

## What Counts as Alive: Special-Case Logic

`checkdead` does *not* simply count `_Gwaiting` vs other states. It has special logic to recognise that a `_Gwaiting` goroutine with a *pending wakeup* is alive in spirit:

```go
// Inside checkdead, after the forEachG loop:
if grunning == 0 {
    // Maybe there's a system goroutine that will wake one of us.
    // Check timers, finalizers, ...
    if anyTimersOrFinalizers() {
        return
    }
    fatal("all goroutines are asleep - deadlock!")
}
```

The real code is more elaborate, but the principle is correct: if any timer is pending in the timer heap, the runtime knows at least one goroutine will eventually wake. The detector returns without firing.

Sources of "alive in spirit":

- **Pending timers.** Any `time.Sleep`, `time.After`, `time.NewTimer`, `context.WithTimeout`, or `time.AfterFunc` puts a timer in the heap.
- **Finalizers.** The finalizer goroutine may run user code that wakes others.
- **Network poller.** If any FD is registered with the netpoller, the netpoller goroutine is potentially alive.
- **cgo calls.** Goroutines in `_Gsyscall` with the cgo flag are running foreign code that may eventually return.
- **Locked OS threads.** `runtime.LockOSThread` pins a goroutine to an OS thread; the runtime cannot reason about what that thread does. Counted as alive.

This is why the detector is silent in production:

- HTTP servers register listeners → netpoller alive.
- Most services have at least one `time.Ticker` for metrics/logs → timer alive.
- Many use cgo for crypto, DB drivers, image processing → cgo alive.

In production, the detector is effectively disabled.

---

## Mutex Internals and Park States

A blocked `sync.Mutex.Lock` shows up in stack dumps as:

```
goroutine 7 [semacquire]:
sync.runtime_SemacquireMutex(0x100d000, 0x0, 0x1)
        /usr/local/go/src/runtime/sema.go:77
sync.(*Mutex).lockSlow(0x100d000)
        /usr/local/go/src/sync/mutex.go:171
sync.(*Mutex).Lock(...)
        /usr/local/go/src/sync/mutex.go:90
```

The state is `[semacquire]`. The runtime's view: this goroutine is in `_Gwaiting` with `waitReason = waitReasonSyncMutexLock`. The semaphore root for the mutex (`&mu.sema`, a `uint32` inside the Mutex) is the address of the semaphore queue.

The "address" you see in the stack (`0x100d000`) is the address of the `uint32` semaphore counter, which is `&Mutex.sema` for `sync.Mutex`. To map this back to a named mutex in your codebase, print `&yourMutex.sema` at startup, or use a wrapper that records names.

When `Unlock` runs, it calls `runtime_Semrelease`, which finds the queue for that address and wakes one waiter via `goready`. The waiter transitions to `_Grunnable` and gets picked up by some M shortly.

The state `[sync.Mutex.Lock]` versus `[semacquire]`: in newer Go versions (1.20+), the wait reason is more descriptive — `waitReasonSyncMutexLock` produces `[sync.Mutex.Lock]` in the stack header. Older Go shows `[semacquire]`. The information is the same; the label is friendlier in newer Go.

---

## `semroot` and the Semaphore Tree

Underlying every `sync.Mutex.Lock`, `sync.WaitGroup.Wait`, `sync.Cond.Wait`, channel send/receive, and `select` is the runtime semaphore facility in `runtime/sema.go`. It maintains a global hash table of address → tree of waiters (a treap, keyed by address):

```go
type semaRoot struct {
    lock     mutex
    treap    *sudog
    nwait    atomic.Uint32
}

var semtable [251]struct {
    root semaRoot
    // ...
}
```

When a goroutine parks on address X, it is inserted into `semtable[hash(X)].root.treap`. When another goroutine releases X, it looks up the treap and pops a waiter.

For deadlock detection, the runtime does *not* walk the semtable to find cycles. It only counts globally. The treap is per-address; cycle detection would need cross-address walks. Not implemented.

If you wanted to implement partial-deadlock detection: walk the semtable, build a graph where each waiter's goroutine points to the goroutine that holds the resource it is waiting for (you'd need to record holders, which Go does not currently do for `sync.Mutex`), then run Tarjan's strongly connected components. The cost is paid by every `Lock`/`Unlock`, which is why it has not been added.

---

## Why Channels Cannot Reuse Mutex Detection

Channels use a different parking facility from `sync.Mutex`. A channel send or receive calls `gopark` directly with the channel's own `hchan` lock. The channel maintains a `recvq` and `sendq` (linked lists of `sudog`) — not the global semtable.

So even if the runtime added "who holds this mutex" tracking for `sync.Mutex`, it would not catch channel deadlocks. A channel does not have a "holder" — it has a queue. The wait graph for channels is "goroutine G is waiting to send on channel C, and there is no goroutine currently parked on `recvq` and no future receiver." The "no future receiver" half is undecidable at runtime without static analysis.

This is part of why partial deadlock detection is hard: the wait graph is not uniform across primitives. Mutex waits have a holder. Channel waits have a queue but no holder. Condvar waits have a "signal waiting" semantics. Each primitive needs its own analysis.

---

## `runtime/trace` and Deadlock-Relevant Events

`runtime/trace` emits events for every park and unpark. To investigate a partial deadlock:

```go
import "runtime/trace"

f, _ := os.Create("trace.out")
trace.Start(f)
// ... reproduce the bug ...
trace.Stop()
```

Then `go tool trace trace.out` opens an interactive viewer. Relevant events:

- `EvGoBlock*` — goroutine parked, with reason (channel, mutex, select, etc.).
- `EvGoUnblock` — goroutine made runnable by a wake.
- `EvGoCreate` — new goroutine.
- `EvGoEnd` — goroutine exited.

For each parked goroutine, the trace shows the moment of park and (if any) the moment of unblock. A goroutine with `EvGoBlockSync` (mutex) and no corresponding `EvGoUnblock` is stuck on a mutex.

The "Goroutine analysis" view in `go tool trace` groups goroutines by behaviour. A goroutine showing "Sync block: 100%" for the duration of the trace is permanently parked on a mutex — a strong deadlock candidate.

For mutex deadlocks specifically, look at the `Sync block profile` — it shows which mutexes have the longest waits. A mutex with `inf` wait or wait larger than the trace duration is likely deadlocked.

---

## Extending the Runtime: Partial-Deadlock Hypotheticals

If Go were to add partial-deadlock detection, what would it cost and how would it work?

**Approach 1: maintain a held-locks list per goroutine.**

- On `Mutex.Lock` success, append the mutex pointer to a per-goroutine list.
- On `Mutex.Unlock`, remove it.
- On `Mutex.Lock` failure (slow path, before parking), walk the wait graph: this goroutine waits for M, M's holder waits for N, ..., looking for a cycle.

Cost: every `Lock`/`Unlock` does a list append/remove. For uncontested locks (~99% in most programs), this is pure overhead.

Cycle detection is O(depth). In practice, lock-acquisition chains are short (depth 2–4), so cycle detection is cheap. But the overhead is paid by every program, deadlock or not.

This is essentially the `lockdep` model from the Linux kernel. Kernel developers accept the cost because deadlocks in the kernel are catastrophic. Go does not, because Go programs are user-space and an occasional deadlock is recoverable.

**Approach 2: opt-in `LockProfile` runtime mode.**

A `GODEBUG=lockdep=1` mode that turns on the held-list tracking only when set. Production runs without it; debug runs with it.

This is feasible. The discussion has appeared on the golang-dev mailing list periodically. The blocker is mostly engineering effort, not concept.

**Approach 3: third-party libraries.**

Libraries like `github.com/sasha-s/go-deadlock` implement Approach 1 in user space. You replace `sync.Mutex` with `deadlock.Mutex`, and the library does the bookkeeping. Production overhead is real (~30% on `Lock`/`Unlock`); not appropriate for hot paths in production, but useful for stress tests and CI.

```go
import "github.com/sasha-s/go-deadlock"

var mu deadlock.Mutex
```

The library prints a stack dump when it detects a cycle in the per-goroutine held set. No runtime change required.

For projects that experience repeated deadlocks, swapping in `go-deadlock` in CI is a low-cost step toward detection without runtime changes.

---

## Summary

Go's deadlock detection is implemented in `checkdead`, a single function in `runtime/proc.go` that runs in O(N) over goroutines after every park. It fires when no non-system goroutine is in a runnable or running state, and when no timers, finalizers, netpoller activity, cgo calls, or locked OS threads keep the program "alive in spirit."

The detector's narrowness is by design: a comprehensive partial-deadlock detector would require maintaining a wait-graph per primitive, walking it for cycles on every block, and paying that cost in every program forever. The Go team's tradeoff is to provide the cheap whole-program detector for free and leave partial detection to user-space tools (`go-deadlock`, custom analyzers) and observability (`pprof goroutine`, `runtime/trace`).

Each Go concurrency primitive has its own park/unpark mechanism. Mutexes use the `semroot` treap; channels use their own `hchan` queues; condvars use `notifyList`; `select` uses ad-hoc per-case logic. A detector that worked across all of them would need to understand the wait graph of each. None exists today.

For engineers debugging the hardest deadlocks, the tools are: `pprof goroutine?debug=2` for snapshots, `runtime/trace` for time-series, `runtime.Stack` for programmatic capture, and `GODEBUG=schedtrace=1000` for live scheduler state. With these, you can reconstruct any wait graph by hand and identify the cycle, given enough time and a clear mind.
