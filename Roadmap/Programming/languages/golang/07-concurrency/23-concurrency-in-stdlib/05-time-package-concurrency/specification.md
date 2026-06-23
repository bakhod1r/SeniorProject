---
layout: default
title: time Package Concurrency — Specification
parent: time Package Concurrency
grand_parent: Concurrency in Stdlib
ancestor: Go
nav_order: 6
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/23-concurrency-in-stdlib/05-time-package-concurrency/specification/
---

# time Package Concurrency — Specification

[← Back](../)

## Table of Contents
1. [Introduction](#introduction)
2. [`time` Package Godoc — Concurrency-Relevant Sections](#time-package-godoc--concurrency-relevant-sections)
3. [Monotonic Clock Specification](#monotonic-clock-specification)
4. [`Timer` and `Ticker` Contracts](#timer-and-ticker-contracts)
5. [`context` Package — Deadline Semantics](#context-package--deadline-semantics)
6. [Go 1.14 Release Notes — Timer Redesign](#go-114-release-notes--timer-redesign)
7. [Go 1.23 Release Notes — Timer/Ticker Changes](#go-123-release-notes--timertickers-changes)
8. [Runtime Comments from `runtime/time.go`](#runtime-comments-from-runtimetimego)
9. [Cross-Reference Table](#cross-reference-table)
10. [References](#references)

---

## Introduction

This file collects the normative statements that define how the `time` package behaves under concurrency: what `Sleep`, `Timer`, `Ticker`, `After`, and `AfterFunc` promise, how monotonic clocks are recorded, and how the runtime implements all of it. Citations are paraphrased where needed; pointers to the original sources are at the end.

---

## `time` Package Godoc — Concurrency-Relevant Sections

### `func Sleep(d Duration)`

> Sleep pauses the current goroutine for at least the duration d. A negative or zero duration causes Sleep to return immediately.

Key points:
- Pauses only the *current goroutine*, not the OS thread.
- "At least" — the actual sleep may be longer due to scheduler latency, OS timer resolution, GC pauses.
- Zero or negative: immediate return (not a yield; not equivalent to `runtime.Gosched`, though it does cycle through the scheduler).

### `func After(d Duration) <-chan Time`

> After waits for the duration to elapse and then sends the current time on the returned channel. It is equivalent to NewTimer(d).C. The underlying Timer is not recovered by the garbage collector until the timer fires. If efficiency is a concern, use NewTimer instead and call Timer.Stop if the timer is no longer needed.

The crucial sentence — "not recovered by GC until the timer fires" — is the leak warning. Go 1.23 weakened this: the underlying Timer *is* now GC-able if no goroutine is referencing the channel.

### `func Tick(d Duration) <-chan Time`

> Tick is a convenience wrapper for NewTicker providing access to the ticking channel only. While Tick is useful for clients that have no need to shut down the Ticker, be aware that without a way to shut it down the underlying Ticker cannot be recovered by the garbage collector; it "leaks". Unlike NewTicker, Tick will return nil if d <= 0.

Key normative statement: **the ticker cannot be GC'd**. Pre-1.23 this was strict; post-1.23 the runtime is more lenient if no goroutine references the channel.

### `type Timer`

> A Timer represents a single event. When the Timer expires, the current time will be sent on C, unless the Timer was created by AfterFunc.

> A Timer must be created with NewTimer or AfterFunc.

### `func (*Timer) Stop`

> Stop prevents the Timer from firing. It returns true if the call stops the timer, false if the timer has already expired or been stopped. Stop does not close the channel, to prevent a read from the channel succeeding incorrectly.

> To ensure the channel is empty after a call to Stop, check the return value and drain the channel. For example, assuming the program has not received from t.C already:
> ```go
> if !t.Stop() {
>     <-t.C
> }
> ```

This drain-pattern was the canonical idiom up to Go 1.22. Go 1.23 made it unnecessary (see below).

### `func (*Timer) Reset`

> Reset changes the timer to expire after duration d. It returns true if the timer had been active, false if the timer had expired or been stopped.

> For a Timer created with NewTimer, Reset should be invoked only on stopped or expired timers with drained channels.

> If a program has already received a value from t.C, the timer is known to have expired and the channel drained, so t.Reset can be used directly. If a program has not yet received a value from t.C, however, the timer must be stopped and—if Stop reports that the timer expired before being stopped—the channel explicitly drained:
> ```go
> if !t.Stop() {
>     <-t.C
> }
> t.Reset(d)
> ```

Again, this drain pattern is the pre-1.23 requirement.

### `type Ticker`

> A Ticker holds a channel that delivers "ticks" of a clock at intervals.

> The duration d must be greater than zero; if not, NewTicker will panic.

> Stop the ticker to release associated resources.

### `func (*Ticker) Reset`

> Reset stops a ticker and resets its period to the specified duration. The next tick will arrive after the new period elapses.

### `func AfterFunc(d Duration, f func()) *Timer`

> AfterFunc waits for the duration to elapse and then calls f in its own goroutine. It returns a Timer that can be used to cancel the call using its Stop method.

Key point: **`f` is invoked in its own goroutine**, not on the runtime's timer thread.

---

## Monotonic Clock Specification

From the `time` package documentation:

> Operating systems provide both a "wall clock," which is subject to changes for clock synchronization, and a "monotonic clock," which is not. The general rule is that the wall clock is for telling time and the monotonic clock is for measuring time. Rather than split the API, in this package the Time returned by time.Now contains both a wall clock reading and a monotonic clock reading; later time-telling operations use the wall clock reading, but later time-measuring operations, specifically comparisons and subtractions, use the monotonic clock reading.

> For example, this code always computes a positive elapsed time of approximately 20 milliseconds, even if the wall clock is changed during the operation being timed:
> ```go
> start := time.Now()
> ... operation that takes 20 milliseconds ...
> t := time.Now()
> elapsed := t.Sub(start)
> ```

> Other idioms, such as time.Since(start), time.Until(deadline), and time.Now().Before(deadline), are similarly robust against wall clock resets.

### When monotonic is stripped

> Because the monotonic clock reading has no meaning outside the current process, serializing a t.MarshalBinary, t.MarshalJSON, or t.MarshalText omits the monotonic clock reading, and t.Format provides no representation for it. Similarly, the constructors time.Date, time.Parse, time.ParseInLocation, and time.Unix, as well as the unmarshalers t.UnmarshalBinary, t.UnmarshalJSON, and t.UnmarshalText always create times with no monotonic clock reading.

> The canonical way to strip a monotonic clock reading is to use t = t.Round(0).

### Equality

> Two Times can be compared using the Before, After, and Equal methods. The Sub method subtracts two instants, producing a Duration. The Add method adds a Time and a Duration, producing a Time.

> Note that the Go == operator compares not just the time instant but also the Location and the monotonic clock reading. Therefore, Time values should not be used as map or database keys without first guaranteeing that the identical Location has been set for all values, which can be achieved through use of the UTC or Local method, and that the monotonic clock reading has been stripped by setting t = t.Round(0). In general, prefer t.Equal(u) to t == u, since t.Equal uses the most accurate comparison available and correctly handles the case when only one of its arguments has a monotonic clock reading.

---

## `Timer` and `Ticker` Contracts

### Buffer size of `Timer.C` and `Ticker.C`

Both are 1-buffered. Implementation: see `time/sleep.go:53` (Timer creation) and `time/tick.go:23` (Ticker creation).

```go
// Timer:
c := make(chan Time, 1)
```

Consequences:
- Ticker can lose ticks under slow consumer (no backpressure).
- Timer can hold a stale value after Reset/Stop (pre-1.23).

### Concurrency safety

- `Timer.Stop`, `Timer.Reset`, `Ticker.Stop`, `Ticker.Reset` are safe to call from any goroutine.
- The channel `t.C` can be received from any goroutine.
- Concurrent receives on the same channel race with the runtime's send — but the send is non-blocking, so at most one receiver wins.

---

## `context` Package — Deadline Semantics

From the `context` godoc:

> WithDeadline returns a copy of the parent context with the deadline adjusted to be no later than d. If the parent's deadline is already earlier than d, WithDeadline(parent, d) is semantically equivalent to parent. The returned context's Done channel is closed when the deadline expires, when the returned cancel function is called, or when the parent context's Done channel is closed, whichever happens first.

> Canceling this context releases resources associated with it, so code should call cancel as soon as the operations running in this Context complete.

> WithTimeout returns WithDeadline(parent, time.Now().Add(timeout)).

### Implementation note (since Go 1.21)

The `context` package internally uses `time.AfterFunc` to schedule the cancellation:

```go
// context/context.go (Go 1.21+, paraphrased)
c.timer = time.AfterFunc(d, func() {
    c.cancel(true, DeadlineExceeded, ...)
})
```

Before Go 1.21, the context package had its own duplicate timer-management code path. The unification cut allocations and centralised behaviour.

### `context.AfterFunc` (Go 1.21+)

> AfterFunc arranges to call f in its own goroutine after ctx is done (cancelled or timed out). If ctx is already done, AfterFunc calls f immediately in its own goroutine.
> Multiple calls to AfterFunc on a context operate independently; one does not replace another. Calling the returned stop function stops the association of ctx with f. It returns true if the call stopped f from being run.

This is the analog of `time.AfterFunc` keyed to context cancellation.

---

## Go 1.14 Release Notes — Timer Redesign

From the Go 1.14 release notes:

> Timers have been reimplemented to scale better with the number of CPUs. Timers are now associated with the P (processor) running the goroutine that created them. As a result, code that uses Timer or Ticker may use less CPU, particularly under high load.

The relevant CLs are:
- CL 171884 (initial timer rework)
- CL 171885, 171886, 171887 (follow-up cleanups)

Key changes:
- Global timer heap with global mutex → per-P timer heaps.
- `timer.heap` lives on the `p` struct as `p.timers`.
- Timer-firing integrated with scheduler's `findRunnable` path.

---

## Go 1.23 Release Notes — Timer/Ticker Changes

From the Go 1.23 release notes:

> The implementations of `time.After`, `time.Tick`, `time.NewTimer`, `time.NewTicker`, `(*Timer).Reset`, and `(*Ticker).Reset` have changed. Previously, the timer or ticker channel held a reference that prevented the garbage collector from recovering an unused timer or ticker. In Go 1.23, an unreferenced timer or ticker can be recovered by the garbage collector, even if its Stop method has not been called.

> Previously, the timer channel had a one-element buffer, so a stale tick value could be received after a Reset or Stop call. In Go 1.23, the channel is unbuffered (capacity 0), but the runtime guarantees that a send on the channel will never block. This means that after Reset or Stop, no stale value can be received; if a value was delivered to the channel before the Reset/Stop and not yet received, that value is now dropped.

> The new behaviours can be reverted by setting GODEBUG=asynctimerchan=1 in environments that require pre-1.23 semantics. The setting will be removed in a future release.

Key changes:
- Channel-pinning removed → leaked timers can be GC'd.
- Unbuffered channel semantics → no stale receives after Reset/Stop.
- Reset no longer requires the Stop-and-drain dance.

The main CL is CL 568086 (with a long stack of follow-ups).

---

## Runtime Comments from `runtime/time.go`

The runtime's timer code is heavily commented. Excerpts:

### Timer struct

From `runtime/time.go` (around line 30 in Go 1.22, restructured in 1.23):

```go
// Package time knows the layout of this structure.
// If this struct changes, adjust ../time/sleep.go:Timer.
// For GOOS=nacl, package syscall knows the layout of this structure.
// If this struct changes, adjust ../syscall/net_nacl.go:runtimeTimer.
type timer struct {
    // If this timer is on a heap, which P's heap it is on.
    // puintptr rather than *p to match uintptr in the rest of the runtime.
    pp puintptr

    // Timer wakes up at when, and then at when+period, ... if period > 0.
    // each time calling f(arg, now) in the timer goroutine, so f must be
    // a well-behaved function and not block.
    //
    // when must be positive on an active timer.
    when     int64
    period   int64
    f        func(any, uintptr)
    arg      any
    seq      uintptr

    // What to set the when field to in timerModifiedXX status.
    nextwhen int64

    // The status field holds one of the values below.
    status atomic.Uint32
}
```

### Timer status state machine

```go
// Values for the timer status field.
const (
    // Timer has no status set yet.
    timerNoStatus = iota

    // Waiting for timer to fire.
    // The timer is in some P's heap.
    timerWaiting

    // Running the timer function.
    // A timer will only have this status briefly.
    timerRunning

    // The timer is deleted and should be removed.
    // It should not be run, but it is still in some P's heap.
    timerDeleted

    // The timer is being removed.
    // The timer will only have this status briefly.
    timerRemoving

    // The timer has been stopped.
    // It is not in any P's heap.
    timerRemoved

    // The timer is being modified.
    // The timer will only have this status briefly.
    timerModifying

    // The timer has been modified to an earlier time.
    // The new when value is in the nextwhen field.
    // The timer is in some P's heap, possibly in the wrong place.
    timerModifiedEarlier

    // The timer has been modified to the same or a later time.
    // The new when value is in the nextwhen field.
    // The timer is in some P's heap, possibly in the wrong place.
    timerModifiedLater

    // The timer has been modified and is being moved.
    // The timer will only have this status briefly.
    timerMoving
)
```

In Go 1.23 the state space was simplified considerably.

### `runtimer`

The function that runs a single timer's callback:

```go
// runtimer examines the first timer in timers. If it is ready based on now,
// it runs the timer and removes or updates it.
// Returns 0 if it ran a timer, -1 if there are no more timers, or the time
// when the first timer should run.
// The caller must have locked the timers for pp.
// If a timer is run, this will temporarily unlock the timers.
//
//go:systemstack
func runtimer(pp *p, now int64) int64 { ... }
```

### Lock-free coordination

```go
// Timer operations are designed to be lock-free in the common case.
// The status field uses atomic CAS for transitions.
// adjusttimers is the only operation that requires holding the heap lock.
```

---

## Cross-Reference Table

| Concept | Source | Notes |
|---------|--------|-------|
| `time.Sleep` | `time/sleep.go:81` (`func Sleep`); `runtime/time.go` (`timeSleep`) | Calls `gopark` after `resettimer` |
| `time.After` | `time/sleep.go:155` | Convenience: `NewTimer(d).C` |
| `time.NewTimer` | `time/sleep.go:118` | Creates Timer with channel `C` of size 1 |
| `time.AfterFunc` | `time/sleep.go:177` | Schedules `f` to run in new goroutine |
| `(*Timer).Stop` | `time/sleep.go:60` | Returns false if already fired |
| `(*Timer).Reset` | `time/sleep.go:127` | Pre-1.23 races; 1.23+ race-free |
| `time.NewTicker` | `time/tick.go:23` | Creates Ticker with channel `C` of size 1 |
| `time.Tick` | `time/tick.go:69` | Convenience: leaks if function returns |
| `(*Ticker).Stop` | `time/tick.go:43` | Does not drain channel |
| `(*Ticker).Reset` | `time/tick.go:54` | Added in Go 1.15 |
| Per-P timer heap | `runtime/time.go` (`timer` struct, `addtimer`) | Go 1.14+ |
| Timer redesign | CL 568086 (Go 1.23) | Channel-pinning fix, race-free Reset |
| `context.WithTimeout` | `context/context.go` | Uses `time.AfterFunc` since 1.21 |
| `context.AfterFunc` | `context/context.go` (Go 1.21+) | Mirror of `time.AfterFunc` for contexts |
| Monotonic clock | `time/time.go:160` | Stored alongside wall in `Time.ext` |
| `time.Now()` | `time/time.go:1366` | Calls `now()` (runtime-provided) |
| OS sleep — Linux | `runtime/lock_futex.go` | `futexsleep` |
| OS sleep — Darwin | `runtime/lock_sema.go` | semaphore-based |
| OS sleep — Windows | `runtime/sys_windows_*.s` | `WaitForSingleObjectEx` |

---

## References

- The Go Programming Language Specification. https://go.dev/ref/spec.
- `time` package documentation. https://pkg.go.dev/time.
- `context` package documentation. https://pkg.go.dev/context.
- Go 1.14 Release Notes. https://go.dev/doc/go1.14#runtime.
- Go 1.21 Release Notes (context.AfterFunc). https://go.dev/doc/go1.21#context.
- Go 1.23 Release Notes (timer changes). https://go.dev/doc/go1.23#timer-changes.
- Issue 6239: runtime: scaling timer code. https://github.com/golang/go/issues/6239.
- Issue 27707: time: Timer/Ticker channel can deliver stale value. https://github.com/golang/go/issues/27707.
- CL 568086: time, runtime: redesign timers. https://go-review.googlesource.com/c/go/+/568086.
- Source: `runtime/time.go`, `time/sleep.go`, `time/tick.go`, `time/time.go`, `context/context.go`.
- Russ Cox, "Go internals: how time.After works." (various conference talks).
