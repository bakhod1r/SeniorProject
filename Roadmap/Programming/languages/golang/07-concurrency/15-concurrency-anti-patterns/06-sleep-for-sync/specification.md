---
layout: default
title: Specification
parent: Sleep for Sync
grand_parent: Concurrency Anti-Patterns
ancestor: Go
nav_order: 5
permalink: /roadmap/programming-languages/golang/07-concurrency/15-concurrency-anti-patterns/06-sleep-for-sync/specification/
---

# Sleep for Synchronization — Specification

## Table of Contents
1. [Purpose](#purpose)
2. [Scope](#scope)
3. [`time.Sleep` Semantics](#timesleep-semantics)
4. [The Monotonic Clock](#the-monotonic-clock)
5. [The Wall Clock](#the-wall-clock)
6. [Timer Specifications](#timer-specifications)
7. [Ticker Specifications](#ticker-specifications)
8. [`time.After` And `time.AfterFunc`](#timeafter-and-timeafterfunc)
9. [Scheduler Implications](#scheduler-implications)
10. [`testing/synctest` Specification](#testingsynctest-specification)
11. [Race Detector And Sleep](#race-detector-and-sleep)
12. [Happens-Before Edges Around Sleep And Timers](#happens-before-edges-around-sleep-and-timers)
13. [Context And Timer Interaction](#context-and-timer-interaction)
14. [Platform Differences](#platform-differences)
15. [Allocation Behaviour](#allocation-behaviour)
16. [Sleep In Locked Threads](#sleep-in-locked-threads)
17. [Sleep In Cgo](#sleep-in-cgo)
18. [Sleep In Signal Handlers](#sleep-in-signal-handlers)
19. [References To The Go Specification](#references-to-the-go-specification)
20. [Quick Reference](#quick-reference)

---

## Purpose

This document is the normative reference for `time.Sleep` and related timing primitives in Go, as relevant to the "sleep for synchronisation" anti-pattern. It does not attempt to specify the Go language or runtime; rather it states precisely what the standard library guarantees and what it does not, so that callers can reason about correctness.

## Scope

Covered:

- `time.Sleep`.
- `time.Now`.
- `time.NewTimer`, `time.Timer.Stop`, `time.Timer.Reset`.
- `time.NewTicker`, `time.Ticker.Stop`, `time.Ticker.Reset`.
- `time.After`, `time.AfterFunc`, `time.Tick`.
- `testing/synctest.Test`, `testing/synctest.Wait`.
- Interaction with `context.Context` deadlines and cancellation.
- Interaction with the Go memory model.

Not covered:

- The full Go language specification.
- The internal goroutine scheduler beyond what callers can observe.
- Operating system kernel timer mechanisms.

---

## `time.Sleep` Semantics

```go
func Sleep(d Duration)
```

### Stated guarantees

1. **Pause duration**. `time.Sleep(d)` pauses the current goroutine for *at least* `d`.
2. **Negative or zero durations**. `time.Sleep(0)` and `time.Sleep(d)` with `d <= 0` return immediately without parking the goroutine.
3. **Caller resumes**. After `time.Sleep` returns, control returns to the caller.

### Not guaranteed

1. **Upper bound on actual duration**. There is no upper bound: the goroutine may wake at `t + d + ε`, where `ε` is non-negative and unbounded. `ε` depends on scheduler load, GC activity, OS scheduling, etc.
2. **Order of wakeups**. If multiple goroutines `Sleep(d)` for the same `d`, the order in which they resume is unspecified.
3. **Cancellation**. `time.Sleep` has no cancellation channel. The goroutine sleeps the full duration regardless of context, signals, or other goroutines.
4. **Interaction with signals**. Go's signal handling does not interrupt `time.Sleep`.

### Implementation notes (non-normative)

The Go runtime implements `time.Sleep` by creating a timer with `when = nanotime() + d` and parking the goroutine via `gopark`. The timer fires when the runtime's scheduler reaches it, at which point the goroutine is unparked and placed on the local run queue.

---

## The Monotonic Clock

### Specification

Since Go 1.9, `time.Now()` returns a `Time` value that contains both:

- A *wall clock* reading (`time.Time.Wall`).
- A *monotonic clock* reading (`time.Time.ext`).

Operations on `time.Time` use the monotonic component when both operands carry it. Specifically:

- `t1.Sub(t2)` returns `(t1.mono - t2.mono)` if both have monotonic readings; otherwise uses wall clock.
- `t1.Before(t2)`, `t1.After(t2)`, `t1.Equal(t2)` use monotonic clock when both have it.
- `time.Since(t)` is equivalent to `time.Now().Sub(t)`.
- `time.Until(t)` is equivalent to `t.Sub(time.Now())`.

### Stripping the monotonic component

The monotonic component is stripped by:

- `t.Round(0)` (a no-op for the wall clock, but explicitly drops monotonic).
- Marshalling (`MarshalBinary`, `MarshalText`, `MarshalJSON`).
- `t.Truncate(d)`, `t.Round(d)` for `d > 0`.
- `t.In(loc)`.

After stripping, comparisons and subtraction use the wall clock and may be affected by NTP adjustments or system clock changes.

### Guarantees

- Monotonic clock never goes backwards within a single process.
- `time.Since(start)` is always non-negative if `start` retains its monotonic reading.
- `time.Sleep(d)` is implemented against the monotonic clock; wall clock changes do not affect it.

### Non-guarantees

- Monotonic clock readings are not comparable across processes.
- Monotonic clock has no defined epoch; the value is meaningful only as a delta within one process.

---

## The Wall Clock

### Specification

The wall clock component of `time.Time` represents calendar time. It is subject to:

- NTP corrections (may jump forward or backward).
- System clock changes (`settimeofday`).
- Timezone changes (DST).
- Leap seconds (Linux: may step or smear depending on kernel/NTP config).

### Use cases

- Display to humans.
- Persistence (databases, logs).
- Calendar-based scheduling (e.g. "run at 03:00 every day").

### Anti-uses

- Measuring elapsed time within a process: use monotonic clock (`time.Since`).
- Deciding "did N seconds pass since X happened?" within a process: use monotonic.

---

## Timer Specifications

```go
type Timer struct {
    C <-chan Time
    // ...
}

func NewTimer(d Duration) *Timer
func (t *Timer) Stop() bool
func (t *Timer) Reset(d Duration) bool
```

### `NewTimer(d)`

- Creates a `Timer` that sends the current time on `t.C` after at least `d`.
- The channel `t.C` is buffered with capacity 1.
- If no goroutine receives from `t.C` before the timer fires again (after `Reset`), the buffered value remains; the runtime does not block while trying to send.

### `Stop()` semantics

- Returns `true` if the call stops the timer before it fires.
- Returns `false` if the timer has already fired or been stopped.
- Does *not* drain `t.C`. If the timer fired but the channel was not yet received, the value remains.

Standard idiom (pre-Go 1.23):

```go
if !t.Stop() {
    select {
    case <-t.C:
    default:
    }
}
```

Go 1.23 changed timer semantics: after `Stop`, the channel is implicitly drained, so the boilerplate is no longer required. Code targeting older Go must still drain manually.

### `Reset(d)` semantics

- Changes the timer to fire after at least `d` from now.
- Returns `true` if the timer was active, `false` if expired or stopped.
- Pre-Go 1.23: must call `Stop` first; otherwise old fires may interleave with new ones.
- Go 1.23+: `Reset` handles draining correctly without explicit `Stop`.

### `t.C` behaviour

- Single buffered channel.
- Receives the time the timer fired (which may differ from the requested fire time by an unbounded `ε`).
- After `Stop`, no further sends occur (pre-1.23: unless the timer had already started firing; post-1.23: cleanly).

---

## Ticker Specifications

```go
type Ticker struct {
    C <-chan Time
}

func NewTicker(d Duration) *Ticker
func (t *Ticker) Stop()
func (t *Ticker) Reset(d Duration)
```

### `NewTicker(d)`

- Creates a `Ticker` that sends the current time on `t.C` every `d`.
- `d` must be positive; panics otherwise.
- The channel `t.C` is buffered with capacity 1.

### Drift accumulation

- Ticks do not accumulate. If the receiver is slow, ticks are dropped (the channel buffer is 1).
- The ticker schedules each tick as `previous + d`, *not* as `now + d`. This means missed ticks do not cause future ticks to drift.
- However, if `d` is so small that the runtime cannot keep up, ticks are effectively rate-limited.

### `Stop()`

- Stops the ticker. No further sends occur.
- Does not close `t.C` or drain the buffered value.

### `Reset(d)` (Go 1.15+)

- Changes the tick period to `d`.
- The first tick after `Reset` is at `now + d`.

### `time.Tick(d)`

- Convenience function returning `NewTicker(d).C`.
- The underlying `*Ticker` is *not exposed* and cannot be stopped. **Leaks for the lifetime of the program.**
- Acceptable only for one-shot top-level program control where the leak is the same as program exit.

---

## `time.After` And `time.AfterFunc`

### `time.After(d Duration) <-chan Time`

- Equivalent to `time.NewTimer(d).C`.
- The underlying timer cannot be stopped.
- Each call allocates a new timer.
- For repeated use in a loop, prefer `time.NewTimer` + `Reset` to avoid allocation churn.
- Pre-Go 1.23: leaks if `select` chooses another case. Post-1.23: garbage-collected normally.

### `time.AfterFunc(d Duration, f func()) *Timer`

- Schedules `f` to run after at least `d`.
- `f` runs on a dedicated goroutine (not the caller's).
- Returns a `*Timer` that can be `Stop`ped or `Reset`.
- If `Stop` returns `false`, `f` may have already started or completed.

### `f` callback semantics

- `f` should be short and non-blocking. Long callbacks delay other timers on the same scheduling lane.
- `f` may run concurrently with other goroutines; synchronise shared state as usual.
- Panics in `f` crash the program just like any other goroutine panic.

---

## Scheduler Implications

### Goroutine state during `Sleep`

A goroutine in `time.Sleep`:

- Is in state `Gwaiting` with reason `waitReasonSleep`.
- Holds no CPU.
- May be moved between Ps by the runtime.

### Wakeup mechanism

When the timer fires:

- The runtime calls `goready` on the goroutine.
- The goroutine is placed on the firing P's local run queue.
- The goroutine is scheduled when the P is free.

### Wake latency

Wake latency is the time from "timer fire time" to "goroutine actually running". It is:

- Sub-microsecond under no contention.
- Bounded by `GOMAXPROCS` and the runtime's preemption rate (10ms by default since Go 1.14).
- Effectively unbounded under heavy load.

### `GOMAXPROCS` interaction

With `GOMAXPROCS=1`, all sleeping goroutines wake serially. The first to wake may run for up to the preemption quantum (10ms) before the second runs. This is a common cause of test flakiness in CI runners that pin to 1 CPU.

### Preemption

Go 1.14+ supports asynchronous preemption. A goroutine running too long is interrupted by a signal and rescheduled. `time.Sleep` itself is not affected (it parks immediately), but the goroutine you are racing against may be preempted between operations, changing the effective timing of side effects.

---

## `testing/synctest` Specification

The `testing/synctest` package (Go 1.24+) provides deterministic time control for tests.

### `synctest.Test(t *testing.T, f func(t *testing.T))`

- Runs `f` in a *bubble*: a goroutine group with a virtual clock.
- All goroutines spawned inside `f` (transitively) are members of the bubble.
- Time-related calls inside the bubble use the virtual clock:
  - `time.Now()` returns virtual time.
  - `time.Sleep(d)` parks until virtual clock advances by `d`.
  - `time.NewTimer`, `time.After`, `time.AfterFunc`, `time.NewTicker` use virtual time.
- The virtual clock starts at midnight UTC on a fixed date (currently `2000-01-01`).
- When all goroutines in the bubble are durably blocked, the virtual clock advances to the next pending timer.
- When `f` returns, the bubble exits and any remaining goroutines are reported as leaks.

### `synctest.Wait()`

- Inside a bubble, blocks the calling goroutine until all other bubble goroutines are durably blocked.
- Does *not* advance virtual time.
- Returns when the bubble reaches a quiescent state.
- If called outside a bubble, panics.

### Durably blocked

A goroutine is durably blocked if it is parked on an operation that can only be unblocked by:

- Other bubble goroutines.
- The bubble's virtual clock.

Operations that satisfy this:

- Channel send/receive on a bubble-created channel.
- Mutex acquire on a mutex used only inside the bubble.
- `time.Sleep`, `time.After`, etc.
- `sync.Cond.Wait`.
- `runtime.Gosched` (treated as a yield, not durable block — does not contribute to advancement).

Operations that do *not* satisfy:

- File I/O.
- Network I/O.
- `syscall` calls.
- Cgo calls.
- Channel operations on channels created outside the bubble.

### Deadlock detection

If all bubble goroutines are durably blocked and no pending timer can fire (the timer heap is empty), `synctest.Test` panics with a deadlock message. This is the diagnostic for "missing producer" bugs.

### Output guarantees

- `time.Since(t)` returns the virtual elapsed time since `t` was captured inside the bubble.
- Cross-bubble time comparisons are unspecified.
- The bubble's virtual time is *not* synchronised with the OS clock or with other bubbles.

---

## Race Detector And Sleep

### What `-race` detects

- Concurrent unsynchronised access to a memory location where at least one access is a write.
- Implemented via the LLVM ThreadSanitizer algorithm with happens-before tracking.

### What `-race` does *not* detect related to sleep

- Insufficient sleep duration (the "sleep too short" flake). The test reads valid memory; the read just happens before the producer wrote, but that is not a race in the technical sense — there is no concurrent unsynchronised access *if the read happens before the write at all*.
- Goroutines outliving the test.
- Time-ordering bugs unrelated to memory.

### Implication

A test that passes `-race` and contains `time.Sleep` may still be flaky. The race detector is necessary but not sufficient.

---

## Happens-Before Edges Around Sleep And Timers

The Go memory model (`https://go.dev/ref/mem`) specifies happens-before relations. Relevant edges:

### `time.Sleep`

- The call to `time.Sleep(d)` and the return from it are sequenced within the same goroutine.
- `time.Sleep` does *not* establish a happens-before edge with operations in other goroutines.

### Timer fire

- The send of `time.Time` on `t.C` happens before the receive completes.
- The receive on `t.C` happens before subsequent operations in the receiving goroutine.

### `time.AfterFunc`

- The call to `AfterFunc` is synchronised with the start of the callback `f` via the channel/timer machinery; specifically, all writes before the `AfterFunc` call happen before `f` begins executing.

### `sync.WaitGroup.Wait`

- `wg.Done()` happens before `wg.Wait()` returns. This is why waitgroups synchronise; sleeps do not.

### Channel close

- A close of a channel happens before any receive on that channel observes the close.

### `synctest.Wait`

- All operations performed by other bubble goroutines before they durably blocked happen before `synctest.Wait()` returns.

---

## Context And Timer Interaction

### `context.WithTimeout(parent, d)`

- Creates a derived context.
- `ctx.Done()` is closed after `d` (using the runtime's timer machinery) or when `parent.Done()` closes, whichever is first.
- `ctx.Err()` returns `context.DeadlineExceeded` if the timeout fired.

### `context.WithDeadline(parent, t)`

- Same as `WithTimeout` but with an absolute deadline.

### `context.AfterFunc(ctx, f)` (Go 1.21+)

- Calls `f` when `ctx.Done()` closes.
- Returns a stop function; calling it removes the callback.
- `f` runs on a new goroutine.

### Cancellable wait pattern

```go
select {
case <-time.After(d):
    // timed out
case <-ctx.Done():
    return ctx.Err()
}
```

This is the canonical cancellable sleep. `time.After` cannot be `Stop`ped; in Go 1.23+ it is GC'd cleanly when no longer referenced, in older Go versions it leaks the underlying timer until it fires.

For repeated waits, use `time.NewTimer` + `Stop` to avoid the leak.

---

## Platform Differences

### Linux

- Monotonic clock: `CLOCK_MONOTONIC` via vDSO when available.
- Wall clock: `CLOCK_REALTIME` via vDSO when available.
- Timer resolution: 1ms typical, 100µs with tickless kernels.

### macOS / Darwin

- Monotonic clock: `mach_absolute_time` (no syscall).
- Wall clock: `gettimeofday` or `clock_gettime`.
- Timer resolution: ~1ms.

### Windows

- Monotonic clock: `QueryPerformanceCounter`.
- Wall clock: `GetSystemTimeAsFileTime`.
- Timer resolution: 16ms by default; can be improved with `timeBeginPeriod(1)` to 1ms.

### Implication for tests

A test that relies on sub-millisecond timing accuracy will behave differently across platforms. Use `synctest` or a fake clock for deterministic timing.

---

## Allocation Behaviour

### `time.Sleep`

- Allocates a `*runtime.timer` per call (Go runtime detail; not exposed to user).
- The allocation is small (~80 bytes).
- The runtime pools timers per-P to reduce allocation pressure.

### `time.After`

- Allocates a new `Timer` per call. The `*Timer` includes a channel.
- Cost: ~100-150ns per call plus the channel allocation.

### `time.NewTimer` + `Reset`

- One allocation at creation; `Reset` reuses.
- Preferred in hot loops.

### `time.NewTicker`

- One allocation at creation.
- Internal state is reused; only `Stop` releases.

### Garbage collection

- Stopped timers are GC'd normally once unreferenced.
- Pre-Go 1.23: a `time.After` whose channel is unreferenced was *not* GC'd until the timer fired. This was a leak in long-running selects.
- Go 1.23+: garbage collector can reclaim unfired timers whose channels are unreferenced.

---

## Sleep In Locked Threads

### `runtime.LockOSThread`

Pins the calling goroutine to its current OS thread. The thread is dedicated to that goroutine; no other goroutine can run on it.

### Sleep on a locked thread

- The goroutine is parked normally.
- The OS thread is *idle* (not running other goroutines).
- Other goroutines pinned to other threads run normally.
- Other unpinned goroutines run on other Ps' threads.

### Implication

If many goroutines are `LockOSThread`-ed and all are sleeping, the corresponding OS threads are wasted. In CGo-heavy programs (e.g. OpenGL contexts pinned to threads), this can starve the program.

Avoid `time.Sleep` in `LockOSThread` goroutines. Use channels or condition variables instead.

---

## Sleep In Cgo

### Cgo call semantics

A goroutine in a `C.foo()` call is in state `Gsyscall`. The runtime detects long syscalls and may spawn additional OS threads (`runtime.lockedm`).

### `time.Sleep` after Cgo

After returning from Cgo, `time.Sleep` works normally on the Go side. The OS thread used for the Cgo call may be released back to the runtime pool.

### `time.Sleep` *inside* Cgo (C code)

If C code calls `sleep(3)` or `nanosleep`, the OS thread is blocked from the runtime's perspective. Go has no virtual-time control over C-level sleeps; `testing/synctest` cannot fake them.

Implication: do not test code that includes C-level sleeps with `synctest`. Stub the C function for testing.

---

## Sleep In Signal Handlers

### Go signal handlers

Go signal handlers run on a special goroutine (the "signal goroutine") that the runtime spawns. User-installed handlers (via `signal.Notify`) receive signals on a channel; the handler itself is just a channel receive.

### Sleep in a signal goroutine

The signal goroutine should not sleep. If it does, subsequent signals queue up and may be coalesced; signal delivery is delayed.

### Recommendation

Signal handlers should be short:

```go
sigCh := make(chan os.Signal, 1)
signal.Notify(sigCh, os.Interrupt)
go func() {
    for sig := range sigCh {
        log.Printf("got signal %v", sig)
        // do not sleep here
    }
}()
```

---

## References To The Go Specification

The Go specification does not directly cover `time.Sleep` (it is a library function, not a language primitive). The relevant references:

- The Go Programming Language Specification: https://go.dev/ref/spec — primarily for memory model, goroutine semantics, channels.
- The Go Memory Model: https://go.dev/ref/mem — happens-before rules for goroutines, channels, mutexes, atomics, and finalisers.
- `time` package documentation: https://pkg.go.dev/time
- `testing/synctest` package documentation: https://pkg.go.dev/testing/synctest
- `context` package documentation: https://pkg.go.dev/context

---

## Quick Reference

### `time.Sleep(d)` invariants

- Sleeps for *at least* `d`; upper bound unspecified.
- Returns immediately for `d <= 0`.
- Not cancellable.
- Uses monotonic clock.
- No happens-before with other goroutines.

### `Timer` invariants

- `t.C` is buffered (cap 1).
- `Stop` does not drain.
- `Reset` semantics differ before/after Go 1.23.

### `Ticker` invariants

- `t.C` is buffered (cap 1).
- Ticks are dropped, not queued.
- `Stop` must be called to avoid leaks.

### `time.After` invariants

- Allocates per call.
- Timer GC behaviour improved in Go 1.23.

### `synctest` invariants

- Virtual time advances only when all bubble goroutines durably blocked.
- External I/O breaks the bubble.
- `synctest.Wait` is a quiescence barrier, not a time advancer.

### Happens-before

- `wg.Done` → `wg.Wait` return: yes.
- `close(ch)` → `<-ch`: yes.
- `time.Sleep` → other goroutine's operations: no.
- `synctest.Wait` → other bubble goroutines' prior operations: yes.

### Cancellable wait

```go
select {
case <-time.After(d):
case <-ctx.Done():
    return ctx.Err()
}
```

### Repeated wait without leak

```go
t := time.NewTimer(d)
defer t.Stop()
for {
    select {
    case <-t.C:
        // do work
        t.Reset(d) // Go 1.23+: safe; older Go: must drain first
    case <-ctx.Done():
        return
    }
}
```

### `time.Tick` warning

```go
ticks := time.Tick(d) // leaks; cannot Stop
```

Replace with `NewTicker` + `Stop` for any non-trivial use.
