---
layout: default
title: Specification
parent: Timer Leaks
grand_parent: Time-Based Concurrency
ancestor: Go
nav_order: 6
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/16-time-based-concurrency/03-timer-leaks/specification/
---

# Timer Leaks — Specification

## Table of Contents
1. [Introduction](#introduction)
2. [`time.After` (Specification)](#timeafter-specification)
3. [`time.NewTimer` (Specification)](#timenewtimer-specification)
4. [`Timer.Stop` (Specification)](#timerstop-specification)
5. [`Timer.Reset` (Specification)](#timerreset-specification)
6. [`time.AfterFunc` (Specification)](#timeafterfunc-specification)
7. [`time.Tick` and `time.NewTicker` (Specification)](#timetick-and-timenewticker-specification)
8. [`Ticker.Stop` and `Ticker.Reset` (Specification)](#tickerstop-and-tickerreset-specification)
9. [`time.Sleep` (Specification)](#timesleep-specification)
10. [`context.WithTimeout` and `context.WithDeadline` (Specification)](#contextwithtimeout-and-contextwithdeadline-specification)
11. [Runtime Timer Lifecycle](#runtime-timer-lifecycle)
12. [Behavioural Differences Across Go Versions](#behavioural-differences-across-go-versions)
13. [Memory Model Interactions](#memory-model-interactions)
14. [Documented vs Unspecified Behaviour](#documented-vs-unspecified-behaviour)
15. [Common Misreadings](#common-misreadings)
16. [References](#references)

---

## Introduction

This document is the reference specification for time-based concurrency primitives in Go, with emphasis on the behavioural details that distinguish a correct use from a leak. Three normative sources govern this material:

- **The `time` package documentation** (`pkg.go.dev/time`) — defines the public API for `Timer`, `Ticker`, `After`, `AfterFunc`, `Sleep`, `Tick`, and related functions.
- **The `context` package documentation** (`pkg.go.dev/context`) — defines `WithTimeout`, `WithDeadline`, and the cancel-function lifecycle.
- **The `runtime` package and Go source code** — defines the implementation of timers, which is not specified normatively but is consistent across versions.

Many behaviours are intentionally implementation-defined to allow the runtime to evolve. The largest such change to date is Go 1.23's timer rewrite, which altered several previously-relied-upon behaviours. Where versions differ, this document calls out the version-specific behaviour explicitly.

---

## `time.After` (Specification)

### Signature

```go
func After(d Duration) <-chan Time
```

### Documentation (from `pkg.go.dev/time`)

> After waits for the duration to elapse and then sends the current time on the returned channel. It is equivalent to `NewTimer(d).C`. The underlying Timer is not recovered by the garbage collector until the timer fires. If efficiency is a concern, use `NewTimer` instead and call `Timer.Stop` if the timer is no longer needed.

### Key normative points

1. The return type is `<-chan Time`. The caller cannot close it, send on it, or otherwise manipulate it.
2. The duration is measured from the call to `After`. There is no separate "start" operation.
3. Internally, `After` allocates a `*Timer`. The `*Timer` is not returned and cannot be stopped.
4. Documentation explicitly notes the GC interaction: pre-1.23, the timer is not collectible until it fires.

### Go 1.23 change

From the Go 1.23 release notes:

> The implementation of `time.After`, `time.Tick`, and similar functions has been changed to allow the garbage collector to reclaim the underlying timer when the channel is no longer referenced, even before the timer has fired. This change reduces memory usage for some programs that use these functions in loops.

After 1.23, the language-level guarantee is unchanged (the channel still delivers one tick after `d`), but the *memory* guarantee is improved: if no goroutine holds a reference to the returned channel, the timer can be collected.

### Subtle points

- `time.After(0)` is well-defined: a timer with zero duration fires "immediately" (i.e., as soon as the scheduler runs it).
- `time.After(-d)` for `d > 0` is well-defined: equivalent to `time.After(0)`.
- The channel has buffer size 1; the runtime's send into it is non-blocking. If the caller does not read, the value sits in the channel buffer.

---

## `time.NewTimer` (Specification)

### Signature

```go
func NewTimer(d Duration) *Timer

type Timer struct {
    C <-chan Time
    // unexported fields
}
```

### Documentation

> NewTimer creates a new Timer that will send the current time on its channel after at least duration d.

### Key normative points

1. The returned `*Timer` is the canonical handle for the timer. Through it the caller can `Stop` or `Reset` the timer.
2. The field `C` is the timer's channel; the caller receives the fired value from `C`.
3. The duration `d` is a *lower bound*: the channel is sent to *at least* `d` after the call. Late firing (e.g., due to GC or scheduling delay) is permitted.
4. The runtime guarantees the channel receives exactly one value per fire.

### Subtle points

- `NewTimer(d).C` is exactly what `After(d)` returns. The difference is that `NewTimer` keeps the `*Timer` reachable, so the caller can `Stop` it.
- The channel `C` has buffer size 1. Subsequent calls to `Reset` after a fire interact with this buffer; see the `Reset` specification below.
- Multiple goroutines may receive from `C`, but the runtime sends only once per fire. Only one receiver will get the value; others block until the next fire (which never happens unless `Reset` is called).

---

## `Timer.Stop` (Specification)

### Signature

```go
func (t *Timer) Stop() bool
```

### Documentation

> Stop prevents the Timer from firing. It returns true if the call stops the timer, false if the timer has already expired or been stopped. Stop does not close the channel, to prevent a read from the channel succeeding incorrectly.
>
> To ensure the channel is empty after a call to Stop, check the return value and drain the channel. For example, assuming the program has not received from t.C already:
>
> ```go
> if !t.Stop() {
>     <-t.C
> }
> ```
>
> This cannot be done concurrent to other receives from the Timer's channel or other calls to the Timer's Stop method.
>
> For a timer created with `NewTimer`, `Reset` should be invoked only on stopped or expired timers with drained channels.

### Key normative points

1. `Stop` returns `true` if it prevented the firing; `false` otherwise.
2. `Stop` does not close `C`.
3. After `Stop` returns `false`, `C` may contain a value (if the timer fired before `Stop` was called). The drain pattern is required.
4. `Stop` is not safe for concurrent use with other `Stop` or `Reset` calls on the same timer, or with receives from `C` from other goroutines.

### Go 1.23 change

From the Go 1.23 release notes:

> Timer.Stop now also discards any pending value in the channel `t.C`, so the drain pattern is no longer necessary.

After 1.23, `Stop` ensures `C` is empty on return. The drain pattern still works but is redundant.

### Subtle points

- `Stop` is idempotent in the sense that it can be called repeatedly without panic, but subsequent calls return `false`.
- For a timer that fires periodically (`time.AfterFunc` with a periodic argument — note: not supported in standard library, only via custom logic), `Stop` cancels future fires.
- On a `*Timer` created via `time.AfterFunc`, `Stop` returns `false` if the function has already started running. It does not interrupt the running function.

---

## `Timer.Reset` (Specification)

### Signature

```go
func (t *Timer) Reset(d Duration) bool
```

### Documentation (Go 1.22 and earlier)

> Reset changes the timer to expire after duration d. It returns true if the timer had been active, false if the timer had expired or been stopped.
>
> Reset should be invoked only on stopped or expired timers with drained channels. If a program has already received a value from `t.C`, the timer is known to have expired and the channel drained, so `t.Reset` can be used directly. If a program has not yet received a value from `t.C`, however, the timer must be stopped and—if `Stop` reports that the timer expired before being stopped—the channel explicitly drained.

### Documentation (Go 1.23+)

> Reset changes the timer to expire after duration d. It returns true if the timer had been active, false if the timer had expired or been stopped. Reset also discards any pending value in the channel.

### Key normative points

1. `Reset` re-arms a timer to fire after `d`.
2. Return value indicates whether the timer was active (true) or expired/stopped (false).
3. Pre-1.23: the caller is responsible for ensuring the channel is drained before calling `Reset`, or risks receiving a stale value.
4. Post-1.23: `Reset` clears the channel automatically.

### Cross-version compatibility

Code that must work on both pre-1.23 and post-1.23 should use the drain pattern. It is safe on all versions, merely redundant on 1.23.

```go
if !t.Stop() {
    select {
    case <-t.C:
    default:
    }
}
t.Reset(d)
```

### Subtle points

- `Reset` does not allocate a new timer; it reuses the existing one. This is the entire reason for the pattern of long-lived timers with `Reset`.
- Concurrent `Reset` calls have undefined behaviour. Synchronize externally.
- `Reset(0)` fires the timer immediately (after the current goroutine yields).

---

## `time.AfterFunc` (Specification)

### Signature

```go
func AfterFunc(d Duration, f func()) *Timer
```

### Documentation

> AfterFunc waits for the duration to elapse and then calls f in its own goroutine. It returns a Timer that can be used to cancel the call using its Stop method.

### Key normative points

1. `f` is called in a *new* goroutine, not in the caller's goroutine.
2. The returned `*Timer` can be used to cancel `f` via `Stop`.
3. `Stop` returns `true` if it prevented `f` from running; `false` if `f` has already started (and `Stop` does not interrupt it).
4. `f` runs at most once per `AfterFunc` call — there is no built-in periodic firing.

### Subtle points

- The `*Timer` returned by `AfterFunc` has a `C` field, but it is unused. Receiving from it blocks forever.
- `Reset` on an `AfterFunc` timer reschedules `f`. After `Reset`, `f` will run after the new duration (assuming it hasn't already started).
- If `f` panics, the panic propagates out of its goroutine, which terminates the program (just as any unrecovered panic does).
- The runtime does not guarantee which goroutine will execute `f`. It may be the runtime's own scheduler goroutine, a worker from a pool, or a freshly spawned goroutine. For most purposes this is invisible, but it matters for any code that inspects goroutine identity (which is discouraged anyway).

---

## `time.Tick` and `time.NewTicker` (Specification)

### Signatures

```go
func Tick(d Duration) <-chan Time

func NewTicker(d Duration) *Ticker

type Ticker struct {
    C <-chan Time
    // unexported fields
}
```

### `Tick` documentation

> Tick is a convenience wrapper for NewTicker providing access to the ticking channel only. While Tick is useful for clients that have no need to shut down the Ticker, be aware that without a way to shut it down the underlying Ticker cannot be recovered by the garbage collector; it "leaks". Unlike NewTicker, Tick will return nil if d <= 0.

### `NewTicker` documentation

> NewTicker returns a new Ticker containing a channel that will send the current time after each tick. The period of the ticks is specified by the duration argument. The ticker will adjust the time interval or drop ticks to make up for slow receivers. The duration d must be greater than zero; if not, NewTicker will panic.

### Key normative points

1. `Tick` is `NewTicker` with the `*Ticker` discarded; the leak is documented and intentional.
2. `NewTicker(0)` or `NewTicker(-d)` panics.
3. The ticker drops ticks if the receiver is slow; the channel never blocks the runtime.
4. The channel `C` has buffer size 1.

### Tick-dropping behaviour

If the receiver consumes a tick slower than the ticker's period, the runtime *drops* ticks rather than queueing them. This is by design — the alternative would be unbounded memory usage for slow receivers. Code that needs to count "missed" ticks must implement that logic separately (e.g., by comparing `time.Now()` against the expected tick time).

### Subtle points

- Tickers are documented as not being phase-stable. After missed ticks, the next tick fires based on the current time, not the original phase.
- The ticker's resolution is bounded by the OS scheduler. On Linux with `CONFIG_HZ=1000`, ticks finer than 1ms are not reliable.
- `time.Tick` in any function that is not the program's `main` is almost always a bug. `staticcheck` flags this as `SA1018`.

---

## `Ticker.Stop` and `Ticker.Reset` (Specification)

### Signatures

```go
func (t *Ticker) Stop()
func (t *Ticker) Reset(d Duration)
```

### Documentation

> Stop turns off a ticker. After Stop, no more ticks will be sent. Stop does not close the channel, to prevent a concurrent goroutine reading from the channel from seeing an erroneous "tick".
>
> Reset stops a ticker and resets its period to the specified duration. The next tick will arrive after the new period elapses. (Added in Go 1.15.)

### Key normative points

1. `Stop` is the only way to clean up a ticker. It must be called.
2. `Stop` does not close `C`. After `Stop`, the channel may still contain one pending tick.
3. `Reset` was added in Go 1.15. Code targeting earlier versions must `Stop` and create a new ticker.
4. `Reset(0)` or `Reset(-d)` is implementation-defined behaviour (may panic in some versions).

### Subtle points

- The "drain after stop" pattern applies to tickers as it does to timers: after `Stop`, `C` may have one pending value.
- A goroutine reading from a stopped ticker's channel may receive one final tick after `Stop`. Use a sentinel or check `time.Now()` against an expected next-fire if precise behaviour is needed.

---

## `time.Sleep` (Specification)

### Signature

```go
func Sleep(d Duration)
```

### Documentation

> Sleep pauses the current goroutine for at least the duration d. A negative or zero duration causes Sleep to return immediately.

### Key normative points

1. `Sleep` blocks the caller's goroutine, not the OS thread. Other goroutines on the same `P` continue to run.
2. The duration is a *lower bound*; the goroutine may sleep longer due to scheduling or GC delays.
3. `Sleep(0)` returns immediately. `Sleep(-d)` returns immediately.
4. `Sleep` does not allocate a `*Timer` or expose a cancellation mechanism. To make a cancellable sleep, use a timer with a select on a context.

### Sleep vs. context-aware sleep

`time.Sleep` is not cancellable. The standard pattern for cancellable sleep:

```go
func Sleep(ctx context.Context, d time.Duration) error {
    t := time.NewTimer(d)
    defer t.Stop()
    select {
    case <-t.C:
        return nil
    case <-ctx.Done():
        return ctx.Err()
    }
}
```

This pattern is so common that some teams add it to a shared package.

---

## `context.WithTimeout` and `context.WithDeadline` (Specification)

### Signatures

```go
func WithTimeout(parent Context, timeout time.Duration) (Context, CancelFunc)
func WithDeadline(parent Context, d time.Time) (Context, CancelFunc)
```

### Documentation

> WithTimeout returns WithDeadline(parent, time.Now().Add(timeout)).
>
> Canceling this context releases resources associated with it, so code should call cancel as soon as the operations running in this Context complete:
>
> ```go
> func slowOperationWithTimeout(ctx context.Context) (Result, error) {
>     ctx, cancel := context.WithTimeout(ctx, 100*time.Millisecond)
>     defer cancel()  // releases resources if slowOperation completes before timeout elapses
>     return slowOperation(ctx)
> }
> ```

### Key normative points

1. The cancel function *must* be called. Failure to call it leaks the internal timer.
2. The timer is sized to fire at the deadline. The cancel function stops the timer.
3. The cancel function is idempotent. Multiple calls are safe.
4. The context is automatically cancelled when its deadline arrives, even if cancel is not called. So the leak is *bounded* by the timeout duration.

### Internal mechanism

`WithTimeout` internally calls `WithDeadline`, which creates a `timerCtx`:

```go
type timerCtx struct {
    cancelCtx
    timer    *time.Timer
    deadline time.Time
}
```

The `timer` field is a `*time.Timer` created with `time.AfterFunc`, scheduled to fire at the deadline. The cancel function calls `timer.Stop()`. If the caller discards the cancel function, `timer` is never stopped; it fires at the deadline and is cleaned up by the runtime then.

### Implications for leak debugging

In a heap profile, leaked `WithTimeout` contexts appear under `context.(*timerCtx).Done` or `context.WithDeadline`. The fix is universal: assign and call the cancel function.

The `go vet -lostcancel` check detects calls to `WithCancel`, `WithTimeout`, and `WithDeadline` whose cancel function is provably not called on some execution path.

---

## Runtime Timer Lifecycle

This section describes the implementation-level lifecycle of a runtime timer. The behaviour is not normatively specified, but it has been consistent for many versions and is unlikely to change in ways that affect user code.

### States

A `runtime.timer` (the internal struct) has a state field. The states are:

- `timerNoStatus` — uninitialized
- `timerWaiting` — armed, waiting to fire
- `timerRunning` — currently executing its function
- `timerDeleted` — marked for removal
- `timerRemoving` — being removed from the heap
- `timerRemoved` — removed; struct is free for reuse
- `timerModifying` — being modified (mid-`Reset` or `Stop`)
- `timerModifiedEarlier` — modified to fire earlier; needs re-insertion
- `timerModifiedLater` — modified to fire later; needs re-insertion
- `timerMoving` — being moved to a different P

Transitions between these states are atomic, allowing concurrent `Stop` and runtime firing without locks.

### The Timer Heap

Each `P` owns a min-heap of `*runtime.timer` pointers, sorted by `when`. The heap is heap-ordered by `when` (smallest first).

When a goroutine calls `time.NewTimer`, the runtime:

1. Allocates a `time.Timer` (containing a `runtimeTimer` and a `chan Time`).
2. Sets `when = nanotime() + int64(d)`.
3. Atomically adds the timer to the current P's heap.

When the runtime detects that a timer is ready to fire (i.e., `when <= nanotime()`):

1. Removes the timer from the heap.
2. Calls the timer's function `f`. For a `time.NewTimer`, `f` sends `nanotime()` on the timer's channel.
3. If the timer is periodic (which standard `time.NewTimer` is not), reschedules it.

### When are timers checked?

The runtime checks for due timers in several places:

1. **Sysmon goroutine**: a background goroutine that wakes up every 10–20ms and walks the timer heaps of idle `P`s.
2. **Scheduler work-stealing**: when a `P` runs out of work, it checks its own timer heap and steals from others.
3. **Goroutine park**: when a goroutine parks (e.g., in a select), the scheduler checks if any timer is due before parking the M.

This multi-source checking ensures timers fire promptly even when individual Ps are idle or busy.

### GC interactions

A timer in the heap is GC-reachable through the runtime's internal references. This is the source of the pre-1.23 leak: even when user code drops all references, the runtime's heap reference keeps the timer alive.

Go 1.23 added a weak-reference mechanism: the runtime's reference is *weak* if no goroutine is reading from `t.C`. When the GC determines that the timer's channel is otherwise unreachable, the timer becomes eligible for collection even before firing.

This change requires careful implementation in the runtime — the timer's internal state must remain consistent across the GC's race with `Stop`/`Reset` calls. The details are in `src/runtime/time.go`.

---

## Behavioural Differences Across Go Versions

This section tabulates timer-related behavioural changes across recent Go versions. It is intended as a reference for engineers who must support code across multiple versions.

### Go 1.0 – Go 1.13

- Single global timer heap protected by a mutex.
- High contention under timer-heavy workloads.
- All semantics of `After`, `NewTimer`, `Stop`, `Reset` as documented.

### Go 1.14

- **Per-P timer heaps** introduced.
- Major performance improvement: timer operations no longer require a global lock.
- No user-visible API changes.
- Async preemption added (unrelated to timers but affects scheduler behaviour during long timer-heavy operations).

### Go 1.15

- **`Ticker.Reset`** added.
- Minor performance improvements to timer firing path.

### Go 1.16

- **`runtime/metrics`** package added.
- Several timer-related metrics exposed.

### Go 1.17 – Go 1.20

- Incremental optimizations.
- No semantic changes to documented timer behaviour.

### Go 1.21

- `slog` package added (unrelated to timers).
- Stable Go 1.21 release notes do not mention timer changes.
- `min` and `max` builtins added (unrelated).

### Go 1.22

- `for-range` loop variable scoping changes.
- No direct timer changes.

### Go 1.23 — Major Timer Rewrite

This is the largest timer-related change since 1.14. Highlights:

1. **GC eligibility**: timers without active channel receivers can be collected before firing.
2. **Synchronous channel delivery**: timer channels switched from async send-to-buffer to synchronous delivery.
3. **`Stop` clears the channel**: `Stop` now also drains any pending value in `t.C`.
4. **`Reset` clears the channel**: `Reset` now also drains any pending value.
5. **Performance improvements**: timer operations are roughly 2-3× faster on most workloads.

The release notes state:

> If a goroutine no longer holds a reference to the channel returned by `time.After`, `time.NewTimer`, or `time.NewTicker`, the underlying Timer or Ticker can be garbage collected immediately, even if it has not yet fired.

This invalidates the long-standing recommendation to avoid `time.After` in loops. On Go 1.23+, `time.After` in a loop is merely *wasteful* (extra allocations and CPU) rather than *catastrophic* (unbounded heap growth).

### Go 1.24

- Continued refinement of the 1.23 timer model.
- Additional trace events for timer lifecycle.

### Practical Implications

If your fleet is on Go 1.21 or earlier:
- All historical warnings about `time.After` apply at full strength.
- Drain-before-Reset is mandatory.
- Plan a Go 1.23 upgrade as a memory-pressure mitigation.

If your fleet is on Go 1.23 or later:
- The drain pattern still works and is harmless.
- `time.After` in loops is less catastrophic, but still wasteful — avoid in hot paths.
- Heap profiles still show timer-related allocations; the diagnostic technique is unchanged.

If your fleet is mixed:
- Treat the oldest version as the floor for any leak-resistance guarantee.
- Test your code on the oldest version you support.

---

## Memory Model Interactions

This section covers the happens-before relationships involving timers, which are subtle and occasionally surprising.

### Send on timer channel

When a timer fires, the runtime sends a value (`time.Now()`) on the timer's channel. This send happens-before the corresponding receive in user code (standard channel semantics).

```go
t := time.NewTimer(d)
go func() {
    <-t.C       // receives the fired value
    doWork()    // happens-after the timer fire
}()
```

`doWork()` is guaranteed to see all writes made by the runtime up to the moment of the channel send. In practice, this means timer fires are properly synchronized with surrounding code.

### Concurrent `Stop` and fire

If a goroutine calls `Stop` while the timer is in the process of firing, the semantics are:

- If `Stop` succeeds (returns `true`), the runtime guarantees that no send on `t.C` will occur.
- If `Stop` fails (returns `false`), the runtime *may* have already sent on `t.C`. The caller must drain.

This is a race-free interface as long as the caller respects the contract. Internally the runtime uses atomic operations on the timer's state field.

### `time.Now()` and monotonic clock

`time.Now()` returns a `Time` containing both wall-clock and monotonic components. Arithmetic on `Time` values uses the monotonic component, which is immune to NTP adjustments and DST. For timer-related code, always use `time.Since(t)` and `time.Until(t)` rather than manual `time.Now().Sub(t)`.

The runtime uses monotonic time exclusively for timer scheduling. Wall-clock adjustments do not affect timer fire times.

### `Sleep` and goroutine state

`time.Sleep(d)` parks the goroutine in `Gwaiting` state with `waitReason = waitReasonSleep`. The goroutine remains parked until the timer fires; then it is moved back to `Grunnable`.

Other goroutines may not observe writes made by the sleeping goroutine after it parks. This is implicit in the memory model but worth stating: a goroutine in `Sleep` has, effectively, paused all of its writes.

---

## Documented vs Unspecified Behaviour

This section separates what the Go specification guarantees from what is implementation behaviour subject to change.

### Guaranteed

1. `Timer.C` has buffer size 1.
2. `Timer.Stop` returns `true` if it prevented firing, `false` otherwise.
3. `Ticker.Stop` does not close the channel.
4. `NewTicker(d <= 0)` panics.
5. `time.After(d)` returns a channel that will deliver one value at time `>= now + d`.
6. `time.Sleep(d)` blocks for at least `d`.
7. `context.WithTimeout`'s cancel function, when called, releases the underlying timer.

### Implementation-defined

1. Per-P vs global timer heap (per-P since 1.14, may change).
2. The exact number of OS threads used to fire timers.
3. The precise timing of when GC collects unreferenced timers (Go 1.23+).
4. The order in which two timers with the same `when` fire.
5. Whether `Reset(0)` fires the timer in the current goroutine's iteration or the next.
6. The size of the `Timer` struct in memory.
7. The exact CPU cost of timer operations.

### Subject to Change

The Go team has stated intent to continue improving timer performance and behaviour. Reliance on implementation-defined behaviour should be marked in code comments and reviewed on every Go upgrade.

---

## Common Misreadings

A few common misreadings of the timer specification, with corrections.

### Misreading 1: "`time.After` is leak-free"

False on Go ≤ 1.22. The underlying timer is retained by the runtime until it fires, even if the returned channel is unreachable. On Go 1.23+, the leak is mitigated for *unreferenced* channels, but a channel held in a `select` is still referenced.

### Misreading 2: "`Stop` immediately frees the timer"

False. `Stop` marks the timer as cancelled. The runtime may take some time (typically until the next GC or until the runtime's internal cleanup) to remove the timer from its data structures.

### Misreading 3: "A stopped timer can be reused"

True, but only via `Reset`. You cannot reuse a `*Timer` by allocating a new `chan Time` for it; the channel and the timer are bound together.

### Misreading 4: "`Reset` is safe for concurrent use"

False. Concurrent `Reset` calls on the same timer have undefined behaviour. Synchronize externally.

### Misreading 5: "`time.AfterFunc(d, f)` runs `f` in the calling goroutine"

False. `f` runs in a goroutine of the runtime's choosing, separate from the caller's.

### Misreading 6: "Ticker fires exactly every `d`"

False. Tickers fire *approximately* every `d`. Phase drift, dropped ticks, and OS-level scheduling jitter all affect actual fire times.

### Misreading 7: "Discarding the cancel from `WithTimeout` is OK if the timeout is short"

True only in the sense that the leak is bounded by the timeout. But the leak still occurs, and at high QPS it accumulates. Always call cancel.

### Misreading 8: "Garbage collection cleans up leaked timers"

False on Go ≤ 1.22, partially true on Go 1.23+. Even on 1.23+, GC cannot collect a timer whose channel is reachable through any active goroutine.

### Misreading 9: "`time.Tick` is fine for short-lived programs"

True. The "leak" is irrelevant for programs that run for seconds. But `staticcheck` flags it because the pattern is dangerous in long-running code.

### Misreading 10: "Setting `MemProfileRate = 0` disables profiling entirely"

True, but disables *all* memory profiling. To merely *reduce* profiling overhead, set a large positive value (e.g., 1<<20).

---

## References

### Normative

- Go language specification: `https://go.dev/ref/spec`
- Go memory model: `https://go.dev/ref/mem`
- `time` package documentation: `https://pkg.go.dev/time`
- `context` package documentation: `https://pkg.go.dev/context`
- `runtime` package documentation: `https://pkg.go.dev/runtime`
- `runtime/metrics` package documentation: `https://pkg.go.dev/runtime/metrics`

### Release notes

- Go 1.14 release notes: `https://go.dev/doc/go1.14` (per-P timers)
- Go 1.15 release notes: `https://go.dev/doc/go1.15` (`Ticker.Reset`)
- Go 1.16 release notes: `https://go.dev/doc/go1.16` (`runtime/metrics`)
- Go 1.19 release notes: `https://go.dev/doc/go1.19` (`GOMEMLIMIT`)
- Go 1.23 release notes: `https://go.dev/doc/go1.23` (timer rewrite)

### Source code

- `src/time/sleep.go` — `Timer`, `NewTimer`, `After`, `Stop`, `Reset`, `AfterFunc`.
- `src/time/tick.go` — `Ticker`, `NewTicker`, `Tick`.
- `src/runtime/time.go` — internal timer implementation.
- `src/runtime/proc.go` — scheduler integration.
- `src/context/context.go` — `cancelCtx`, `timerCtx`, `WithTimeout`, `WithDeadline`.

### Tools

- `go vet`: `https://pkg.go.dev/cmd/vet`
- `staticcheck`: `https://staticcheck.io/docs/`
- `goleak`: `https://github.com/uber-go/goleak`
- `pprof`: `https://pkg.go.dev/net/http/pprof`

### Community

- Go GitHub issue tracker: `https://github.com/golang/go/issues`
- Go memory model proposal: `https://go.googlesource.com/proposal/+/master/design/memorymodel.md`
- Go 1.23 timer proposal discussion: search Go's issue tracker for "timer GC"

---

## Appendix A: Quick Reference Card

A one-page summary of the timer API contracts.

| Function | Returns | Caller obligation |
|---|---|---|
| `time.After(d)` | `<-chan Time` | Receive before next call (or accept leak) |
| `time.NewTimer(d)` | `*Timer` | Call `Stop` when done |
| `time.AfterFunc(d, f)` | `*Timer` | Optionally call `Stop` to cancel `f` |
| `time.Tick(d)` | `<-chan Time` | None (intentional leak) |
| `time.NewTicker(d)` | `*Ticker` | Call `Stop` when done |
| `time.Sleep(d)` | nothing | None |
| `context.WithTimeout(p, d)` | `(Context, CancelFunc)` | Always call cancel |
| `context.WithDeadline(p, t)` | `(Context, CancelFunc)` | Always call cancel |

| Method | Returns | Behaviour |
|---|---|---|
| `Timer.Stop()` | `bool` | Prevents firing; returns false if already fired/stopped |
| `Timer.Reset(d)` | `bool` | Re-arms; returns true if was active |
| `Ticker.Stop()` | nothing | Stops the ticker |
| `Ticker.Reset(d)` | nothing | Re-arms with new period (Go 1.15+) |

---

## Appendix B: Cross-Version Compatibility Matrix

For code that must support a range of Go versions, here is which APIs and behaviours are available where.

| Feature | Minimum Go version |
|---|---|
| `time.After`, `NewTimer`, `Stop`, `Reset` | 1.0 |
| `time.Tick`, `NewTicker` | 1.0 |
| `time.AfterFunc` | 1.0 |
| `time.Sleep` | 1.0 |
| `context.WithTimeout`, `WithDeadline` | 1.7 |
| `Ticker.Reset` | 1.15 |
| `runtime/metrics` | 1.16 |
| `GOMEMLIMIT` | 1.19 |
| `time.After` GC eligibility | 1.23 |
| `Timer.Stop` drains channel | 1.23 |
| `Timer.Reset` drains channel | 1.23 |

If you must support Go 1.16+, you have access to `runtime/metrics`, `Ticker.Reset`, and all standard timer APIs. The 1.23 improvements are bonus on newer runtimes; don't depend on them in code that must compile against older versions.

---

## Appendix C: Specification Gotchas Encountered in Practice

Beyond the misreadings listed above, a few additional subtleties have caused production bugs and are worth highlighting.

### Gotcha 1: `Timer.C` after `AfterFunc`

`time.AfterFunc` returns a `*Timer`, and `*Timer` has a `C` field. But for `AfterFunc` timers, `C` is unused. Receiving from `t.C` after `AfterFunc(d, f)` blocks forever.

This trips up code that tries to use a single `*Timer` interface for both `NewTimer` and `AfterFunc` cases. Don't do that; treat them as distinct.

### Gotcha 2: `time.Until` and negative durations

`time.Until(t)` returns `t.Sub(time.Now())`. If `t` is in the past, the result is negative. Passing this to `time.NewTimer` or `time.After` fires the timer immediately, which may not be the intended behaviour.

Always clamp before scheduling:

```go
d := time.Until(deadline)
if d < 0 {
    d = 0
}
t := time.NewTimer(d)
```

### Gotcha 3: `select` with multiple timer cases

```go
select {
case <-time.After(1 * time.Second):
case <-time.After(2 * time.Second):
}
```

Three timers are allocated (two for `After` calls, plus the runtime internals). The first one fires after 1 second. The second leaks for 2 seconds. Avoid this pattern; use one timer with the smallest duration.

### Gotcha 4: `for range t.C` and `Stop`

```go
t := time.NewTicker(d)
go func() {
    for range t.C {
        work()
    }
}()
// later:
t.Stop()
```

`Stop` does not close `t.C`. The `range` loop will block forever waiting for the next tick that never comes. Either close a separate done channel, or break out via context cancellation.

Correct pattern:

```go
t := time.NewTicker(d)
done := make(chan struct{})
go func() {
    for {
        select {
        case <-t.C:
            work()
        case <-done:
            return
        }
    }
}()
// later:
close(done)
t.Stop()
```

### Gotcha 5: Closures over loop variables

Pre-Go 1.22:

```go
for _, item := range items {
    time.AfterFunc(d, func() {
        process(item) // bug: item is the same variable across all iterations
    })
}
```

The closure captures the loop variable `item` by reference, not by value. All scheduled functions see the *last* `item` value. Fixed in Go 1.22 by changing loop semantics; on older versions, manually copy:

```go
for _, item := range items {
    item := item
    time.AfterFunc(d, func() {
        process(item)
    })
}
```

This is not directly a timer-leak issue but commonly co-occurs with timer code.

---

## Appendix D: Glossary

**Timer**: a `*time.Timer` value, which combines a channel and a runtime-managed scheduled fire.

**Ticker**: a `*time.Ticker` value, which periodically sends on a channel.

**`runtimeTimer`**: the runtime's internal representation of a timer, distinct from but pointed to by `time.Timer`.

**Timer heap**: a per-`P` min-heap of pending timers, sorted by their `when` field.

**`when`**: the monotonic time at which a timer should fire, in nanoseconds.

**Fire**: the act of a timer's scheduled function running. For `NewTimer`, this is sending on the channel. For `AfterFunc`, this is calling the function.

**Drain**: the pattern of receiving from a timer's channel to clear any pending fired value, typically before `Reset`.

**Stop**: the operation of preventing a future fire.

**Reset**: the operation of re-arming a timer with a new duration.

**Cancel function**: the function returned from `context.WithCancel`, `WithTimeout`, or `WithDeadline`, which must be called to release the context's resources.

**Cancellation propagation**: the mechanism by which `context.Context` informs its children that they have been cancelled.

**Per-P heap**: the per-processor timer heap introduced in Go 1.14.

**Sysmon**: the runtime's background goroutine that handles, among other things, due-timer detection on idle Ps.

---

## Appendix E: Summary

The Go timer subsystem is one of the language's most useful and most subtle features. Its public API is small and stable; its implementation has evolved significantly across versions. The specification, as documented in this file, is the contract you can rely on; the implementation details, as described in the professional file, are the operational realities you must navigate.

For most uses, the specification is straightforward: create a timer, use it, stop it. The standard idioms — `defer cancel()` after `context.WithTimeout`, reusable timer with `Reset`, drain before `Reset` on pre-1.23 — cover the common cases.

The cases where leaks occur are predictable: `time.After` in loops, missing `Stop`, missing cancel. The diagnostic and prevention techniques described in this specification's companion document cover them comprehensively.

When in doubt: read the source. The `time` and `runtime` packages are not large; the relevant files total perhaps 2,000 lines of Go. A careful reading takes an afternoon and pays off for the rest of your Go career.

---

End of specification document.
