---
layout: default
title: Specification
parent: Ticker
grand_parent: Time-Based Concurrency
ancestor: Go
nav_order: 6
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/16-time-based-concurrency/01-ticker/specification/
---

# time.Ticker — Specification

## Table of Contents
1. [Introduction](#introduction)
2. [Normative Sources](#normative-sources)
3. [API Surface](#api-surface)
4. [Runtime Guarantees](#runtime-guarantees)
5. [Non-Guarantees](#non-guarantees)
6. [The Channel](#the-channel)
7. [Memory Model Around the Channel](#memory-model-around-the-channel)
8. [Monotonic Clock Semantics](#monotonic-clock-semantics)
9. [Go 1.23 Timer GC Change](#go-123-timer-gc-change)
10. [`Reset` Semantics Across Versions](#reset-semantics-across-versions)
11. [Interactions with the Runtime](#interactions-with-the-runtime)
12. [Diagnostic Knobs](#diagnostic-knobs)
13. [Cross-Reference: Related Types](#cross-reference-related-types)
14. [References](#references)

---

## Introduction

`time.Ticker` is defined in the `time` package of the Go standard library. Its behaviour is specified by:

- The package documentation (`pkg.go.dev/time#Ticker`).
- The Go memory model (`go.dev/ref/mem`), in respect of channel sends and receives.
- Release notes for the language and runtime, notably 1.15 (introduction of `Reset`) and 1.23 (channel buffer change, GC behaviour).

This document distinguishes what is guaranteed by these normative sources from what is implementation-dependent. Implementation details may change between versions; guarantees must hold.

---

## Normative Sources

The primary normative source is the package documentation. The relevant prose, as of Go 1.23:

> A Ticker holds a channel that delivers "ticks" of a clock at intervals.

> ```go
> type Ticker struct {
>     C <-chan Time // The channel on which the ticks are delivered.
>     // contains filtered or unexported fields
> }
> ```

> `func NewTicker(d Duration) *Ticker`
> NewTicker returns a new Ticker containing a channel that will send the current time on the channel after each tick. The period of the ticks is specified by the duration argument. The ticker will adjust the time interval or drop ticks to make up for slow receivers. The duration d must be greater than zero; if not, NewTicker will panic.
>
> Before Go 1.23, the garbage collector did not recover tickers that had not been stopped, as with Stop, so code often immediately deferred t.Stop after calling NewTicker, to make the ticker recoverable when it was no longer needed. As of Go 1.23, the garbage collector can recover unreferenced tickers, even if they haven't been stopped. The Stop method is no longer necessary to help the garbage collector. (Code may of course still want to call Stop to stop the ticker for other reasons.)
>
> Before Go 1.23, NewTicker would only release the timer's resources when the ticker's Stop method was called. As of Go 1.23, the timer is associated with the Ticker, and the garbage collector recovers the timer when the Ticker is no longer reachable, even if its Stop method has not been called.
>
> The NewTicker function now returns a Ticker containing a channel with a 1-element time buffer, instead of an unbuffered channel.

> `func (t *Ticker) Stop()`
> Stop turns off a ticker. After Stop, no more ticks will be sent. Stop does not close the channel, to prevent a concurrent goroutine reading from the channel from seeing an erroneous "tick".

> `func (t *Ticker) Reset(d Duration)`
> Reset stops a ticker and resets its period to the specified duration. The next tick will arrive after the new period elapses. The duration d must be greater than zero; if not, Reset will panic. Added in Go 1.15.

These are the only normative statements about `time.Ticker`. Everything else is either derived from these or is implementation behaviour.

---

## API Surface

The complete API:

```go
package time

type Ticker struct {
    C <-chan Time
    // unexported fields
}

func NewTicker(d Duration) *Ticker
func (t *Ticker) Stop()
func (t *Ticker) Reset(d Duration) // added in 1.15
```

That is the entire public surface. No other methods, no other types, no other functions.

Related but separate:

```go
func Tick(d Duration) <-chan Time
```
`Tick` is a convenience wrapper for clients that do not need to shut down the ticker. The underlying `*Ticker` is unreachable from the caller and pre-1.23 was permanently leaked. As of Go 1.23 the GC can collect it, but the documentation still recommends `NewTicker` for any non-trivial use.

```go
type Time struct { /* opaque */ }
func (t Time) ...
```
The value delivered on `Ticker.C` is a `time.Time` carrying both a wall reading and a monotonic reading. See [Monotonic Clock Semantics](#monotonic-clock-semantics).

---

## Runtime Guarantees

The following are guaranteed by the documentation and the runtime implementation:

### G1. Minimum interval

For an `*Ticker` constructed with `NewTicker(d)`, consecutive ticks delivered on `t.C` are *at least* `d` apart in monotonic time.

The runtime does not deliver a tick before `d` has elapsed since the previous tick was scheduled. This is fundamental to the timer scheduler's design.

### G2. No tick after Stop

After `t.Stop()` returns, no new ticks are delivered on `t.C`. Ticks already in the channel buffer at the time of the call may still be observed by a receiver.

The runtime removes the ticker's underlying timer from the heap on `Stop`. The channel is not closed.

### G3. Stop is idempotent

Calling `Stop` multiple times is safe; the second and subsequent calls have no effect.

### G4. Reset establishes a new period

After `t.Reset(d2)`, the next tick is delivered no earlier than `d2` after the call. The previous period is forgotten. Reset, like NewTicker, panics if `d2 <= 0`.

Reset is documented to behave as: stop the ticker, then start a new ticker with period `d2`. Implementation-wise, prior to 1.23 this could allow an already-delivered tick from the prior period to be observed; in 1.23+ Reset drains any pending tick before returning.

### G5. The C channel is receive-only

`Ticker.C` is declared as `<-chan Time`. Closing it is impossible from outside the runtime; attempting to do so via reflection panics. Sending on it is impossible from outside the runtime.

### G6. NewTicker panics for non-positive d

`NewTicker(0)` and `NewTicker(-1*time.Second)` panic with the message "non-positive interval for NewTicker".

### G7. Stop does not close C

This is explicit in the docs: "Stop does not close the channel". Receivers waiting in `<-t.C` will not be woken by `Stop`. This is deliberate: a closed channel would deliver a zero `Time` to receivers, which would be indistinguishable from a real tick to naive code.

### G8. The Time value reflects delivery, approximately

The `Time` delivered on `t.C` is the time at which the runtime determined the tick should fire. It is monotonically non-decreasing across the same ticker's deliveries. The wall reading is the wall time at the moment of delivery.

### G9. Channel capacity is 1 (Go 1.23+)

In Go 1.23 and later, the channel returned in `Ticker.C` has capacity 1. Before 1.23 it was unbuffered with an internal "drop on full" mechanism in the runtime; the observable behaviour was equivalent ("drop a tick if the receiver is slow"), but the implementation differed.

### G10. GC collects unreferenced tickers (Go 1.23+)

In Go 1.23 and later, an `*Ticker` that is unreachable from any user goroutine, channel, or root may be garbage collected even if `Stop` has not been called. The runtime arranges this via a finalizer-like mechanism on the timer entry.

---

## Non-Guarantees

The following are explicitly not guaranteed and may vary between Go versions or platforms:

### N1. Exact delivery time

The runtime guarantees *no earlier than* `d`, but a tick may be delivered later than `d` after the previous tick, sometimes much later, if the scheduler is busy or if GC pauses the world.

### N2. Order of delivery in close-coupled tickers

If two tickers' deadlines fall in the same scheduler quantum, the order in which their values are delivered is unspecified.

### N3. Channel capacity (pre-1.23)

Before 1.23, the channel's behaviour was equivalent to capacity-1 in semantics but the implementation used a non-buffered channel with a special drop pathway. Code that introspects the channel (e.g., via `cap(t.C)`) would have seen 0 pre-1.23 and 1 post-1.23. Do not rely on `cap(t.C)`.

### N4. Behavior under runtime suspension

If the runtime is paused (e.g., debugger, GC long pause, host live-migration), tickers do not "catch up" on missed deliveries. After resumption, the next tick is delivered at the next scheduled deadline, which may be immediate if many deadlines passed during the pause.

### N5. CPU cost per tick

The per-tick CPU cost depends on the timer-heap size and scheduler load. No bound is documented.

### N6. Internal struct fields

The unexported fields of `*Ticker` are implementation details. They have changed multiple times and will likely change again.

### N7. Interaction with GOMAXPROCS

Tickers are delivered by the runtime regardless of `GOMAXPROCS`, but contention on the global timer heap may slow delivery in high-GOMAXPROCS settings. The specifics are not guaranteed.

### N8. Wall-clock alignment

Ticker values are *not* aligned to wall-clock boundaries. A `NewTicker(time.Minute)` created at wall time `14:23:17.412` will deliver ticks at approximately `14:24:17.412`, `14:25:17.412`, etc. (within the limits of N1). It will not deliver at the round-minute boundary.

---

## The Channel

`Ticker.C` is the channel through which tick values are delivered. Its properties:

- **Direction:** receive-only (`<-chan Time`).
- **Capacity:** 1 (Go 1.23+). Equivalent semantics pre-1.23.
- **Element type:** `time.Time` (value, not pointer).
- **Closed:** never, by design.

Delivery is non-blocking from the runtime's side. The runtime's timer goroutine attempts a non-blocking send; if the channel slot is full, the tick is dropped. There is no queue of pending ticks beyond the single-slot buffer.

### Receiving

Standard channel-receive semantics apply:

```go
v := <-t.C       // blocks until a tick is available or Stop drains
v, ok := <-t.C   // ok is true unless C is closed; C is never closed, so ok is always true
                 // (in practice; do not rely on this for shutdown)
```

A `select` with `case v := <-t.C:` is the canonical pattern.

### Sending

Cannot send on `t.C` from user code; the channel is receive-only at the type level.

### Closing

Cannot close `t.C` from user code; the channel is receive-only at the type level. The runtime never closes it.

### Comparison with `chan` value

`Ticker.C` is a typed channel value. It can be passed to functions, stored in maps, etc., like any other channel:

```go
func awaitTick(c <-chan time.Time) {
    <-c
}
ticker := time.NewTicker(time.Second)
awaitTick(ticker.C)
```

But the channel's behaviour is owned by the ticker; sending or receiving from it after `Stop` returns is undefined in the sense that no new values will arrive, but the channel is still valid for receive (will block forever).

---

## Memory Model Around the Channel

The Go memory model defines synchronization through channel operations:

> The send of a value on a channel is synchronized before the receive of that value from the channel.

This applies to ticker channels in the standard way: a write by goroutine A that happens-before a send on `t.C` is observable by goroutine B that receives the corresponding value from `t.C`.

The runtime itself does the send. The send is sequenced after whatever the runtime considers "computing the tick value", which includes reading the monotonic clock. So:

1. Anything observed by the runtime (clock state, etc.) before the send is observable by the receiver after `<-t.C`.
2. Anything written by the user before *creating* the ticker is observable inside the receiver via standard goroutine-creation happens-before.

In practice this rarely matters; the time value is a value type, not a reference, so there is no shared state to synchronize about. The synchronization is on the act of receiving itself.

### Race conditions

The runtime's internal data structures around the ticker (the timer-heap entry, the buffer slot) are mutated under runtime locks. From user code's perspective:

- Sending data through the ticker channel is impossible (receive-only).
- Receiving from the channel is race-free if only one goroutine receives.
- Multiple receivers on the same channel race on which one receives a given tick, but this is well-defined channel semantics (nondeterministic but not a data race).
- Calling `t.Stop()` and `t.Reset()` from multiple goroutines requires user-level synchronization. The documentation does not state that `Stop` or `Reset` are safe for concurrent use.

### Specifically about concurrent Stop/Reset

The documentation does not say `Stop` or `Reset` are safe for concurrent use. Reading the source (`runtime/time.go`), the underlying timer operations are protected by per-timer locks, so concurrent Stop/Reset is technically safe in 1.23+. But the package contract does not guarantee this; treat them as requiring external synchronization.

---

## Monotonic Clock Semantics

`time.Now()` in Go returns a `Time` value that carries both a wall reading and a monotonic reading. The `Time` delivered on `t.C` is similar: it has both readings populated.

### Computing intervals

When computing the interval between two ticks, use `time.Since(prev)` or `tick.Sub(prev)`. If both `Time` values carry monotonic readings (they do, when sourced from `time.Now()` or from `t.C`), the subtraction uses the monotonic component, ignoring wall-clock jumps.

### Wall-clock anchoring

The wall reading of a tick's `Time` value is the wall time at the moment the runtime computed the tick. Operators may change the wall clock; NTP may slew it. This means consecutive ticks can have wall readings that are *not* monotonically increasing. Do not assume `tick2.Wall > tick1.Wall`.

### Stripping monotonic

`tick.Round(0)` returns a `Time` with the monotonic reading stripped. Use this when:

- Storing a time as JSON (the monotonic reading is not serialized).
- Comparing to a time from another process (which has no monotonic reading).

After stripping, subtraction falls back to wall-clock differences, which can produce negative durations across clock jumps.

### Ticker vs Now

The runtime's tick scheduler uses an internal monotonic clock. This clock is the same source as `time.Now()`'s monotonic component. So:

```go
t := time.NewTicker(time.Second)
start := time.Now()
tick := <-t.C
elapsed := tick.Sub(start) // uses monotonic deltas; reliable
```

Reliable. But:

```go
fmt.Println(tick) // prints the wall reading
```

The wall reading is the wall clock at delivery. If the wall clock has jumped, the printout may be surprising.

---

## Go 1.23 Timer GC Change

Go 1.23 made two related changes affecting `time.Ticker`:

### Change 1: GC of unstopped tickers

Prior to 1.23, the runtime's timer heap held a reference to each active timer. The user's `*Ticker` value referenced the timer's channel; the timer entry referenced internal state. Neither end could be collected as long as the other was alive.

Concretely: if user code lost its `*Ticker` reference without calling `Stop`, the timer entry continued to fire (sending to a channel nobody was reading), wasting CPU and memory.

In 1.23, the runtime arranges for the timer entry to be conditionally collected when the `*Ticker` becomes unreachable from user goroutines/roots. The mechanism uses a runtime-internal weak-reference scheme on the channel.

Effect: code that forgets `Stop` no longer leaks tickers. It is still good practice to call `Stop` because (a) it stops the timer immediately rather than waiting for GC, (b) it makes intent explicit, (c) code that supports Go < 1.23 still needs `Stop`.

### Change 2: Channel buffer

Pre-1.23, `Ticker.C` was unbuffered. The runtime's `tickerproc` performed a non-blocking send into the channel; if the channel had no waiter, the value was dropped at the runtime level.

In 1.23+, `Ticker.C` is a `make(chan Time, 1)`. The runtime performs a non-blocking send into the channel; if the buffer slot is full, the send fails and the value is dropped at the channel level.

Observable difference: in 1.23+ you can receive a "pending" tick after calling `Stop`, if a tick was sitting in the buffer at the time of the call. Pre-1.23 the equivalent was a tick that the runtime had begun to send but not completed.

### Backwards compatibility

The semantic guarantees are the same: at most one tick is queued; slow receivers see dropped ticks. Code that follows the standard patterns (defer Stop, select on C) works identically across versions.

Code that relied on observable internals (e.g., `cap(t.C)`) sees different values pre- and post-1.23. Do not rely on internals.

---

## `Reset` Semantics Across Versions

`Reset` was added in Go 1.15. Its semantics have been clarified in subsequent versions.

### Go 1.15 — 1.18

The original `Reset` could deliver a stale tick from the previous period. The recommended pattern was:

```go
if !t.Stop() {
    select {
    case <-t.C:
    default:
    }
}
t.Reset(d)
```

But `time.Ticker.Stop` does not return a `bool` (unlike `time.Timer.Stop`). The above pattern is for `time.Timer.Reset`; the equivalent for `Ticker` was:

```go
t.Stop()
select {
case <-t.C:
default:
}
t.Reset(d)
```

Or use `time.Timer` instead.

### Go 1.18 — 1.22

Documentation clarified that `Reset` may or may not deliver a pending tick. Behaviour was unchanged.

### Go 1.23

`Reset` was rewritten to drain any pending tick atomically before re-arming the timer. Post-1.23, `t.Reset(d)` cleanly transitions to the new period; the next tick is delivered no earlier than `d` after the Reset call, and no pending tick from the previous period is received.

### Recommended pattern

For new code on Go 1.23+:

```go
t.Reset(d)
```

For code that must support older versions, prefer `time.Timer` with manual re-arming, or accept the possibility of a stale tick.

---

## Interactions with the Runtime

### Timer heap

The Go runtime maintains a per-P timer heap (since Go 1.14, replaced the global timer heap of earlier versions). Each `time.Ticker` corresponds to one heap entry; each fire updates the entry's deadline to `prev + d` and re-heapifies.

Operations:
- `NewTicker`: O(log N) heap insertion.
- `Stop`: O(log N) heap removal.
- `Reset`: O(log N) heap update.
- Per-fire: O(log N) heap update.

N is the number of timer entries on that P. Typically small (10s to 1000s); rarely a bottleneck.

### Scheduler interaction

The runtime checks the timer heap on each scheduler context switch. If a timer's deadline has passed, the runtime runs `runOneTimer`, which dispatches the timer's action — for a ticker, this is "send to channel."

If no P is scheduling (idle), the runtime arranges to wake at the soonest timer deadline using `nanosleep` or `futex_wait` syscalls.

### GC interaction

Pre-1.23: each ticker was a GC root via the timer heap; could not be collected until `Stop`.

1.23+: tickers can be collected via a runtime-internal mechanism. The timer heap holds weak references to the ticker's channel state; when the channel is unreachable from user code, the entry is purged at the next GC.

### Signal handling

Tickers are not affected by signals (SIGSTOP/SIGCONT etc.) at the user level. If the *kernel* pauses the process, monotonic time pauses too (Linux: `CLOCK_MONOTONIC` does not advance during freezer cgroup pause, but does during simple SIGSTOP — exact behavior varies). On unpause, the next tick fires when scheduled by the runtime, which may be immediately if many deadlines passed.

---

## Diagnostic Knobs

Several `GODEBUG` settings affect ticker behaviour or expose ticker state:

### `schedtrace`

`GODEBUG=schedtrace=1000` prints scheduler statistics every 1000 ms. The output includes timer-heap statistics per P:

```
SCHED 1000ms: gomaxprocs=8 idleprocs=2 threads=15 spinningthreads=0 idlethreads=5 runqueue=0 [0 0 0 0 0 0 0 0] timerslen=...
```

`timerslen` is the per-P timer count. Sustained high values indicate timer-heavy code.

### `tracebackancestors`

`GODEBUG=tracebackancestors=1` includes parent goroutine info in panic traces. Useful for finding "who spawned this leaking ticker goroutine."

### `gctrace`

`GODEBUG=gctrace=1` prints GC info. After 1.23 you can see whether the unfinalized-tickers count drops at GC.

### `asyncpreemptoff`

`GODEBUG=asyncpreemptoff=1` disables async preemption. Tickers can be delayed by tight loops in this mode.

### Runtime metrics

The `runtime/metrics` package exposes internal statistics that may help with ticker debugging:

- `/sched/timer-pending-microseconds` (hypothetical name — actual API varies by version) — pending timer queue depth.
- `/sched/timer-fires/sec` — timer fire rate.

Check the current version's metric list with `runtime/metrics.All()`.

---

## Cross-Reference: Related Types

### `time.Timer`

A one-shot timer. Similar mechanism, different semantics.

```go
type Timer struct {
    C <-chan Time
}
func NewTimer(d Duration) *Timer
func AfterFunc(d Duration, f func()) *Timer
func (t *Timer) Stop() bool
func (t *Timer) Reset(d Duration) bool
```

Differences from `Ticker`:
- One-shot; fires once at `d` from creation.
- `Stop` returns `bool` indicating whether the timer was active.
- `Reset` returns `bool` likewise.
- `AfterFunc` runs a function on a new goroutine rather than sending to a channel.

For variable intervals, `time.Timer` is the right primitive.

### `time.After`

```go
func After(d Duration) <-chan Time
```

Convenience wrapper for `NewTimer(d).C`. The Timer is not exposed; cannot be stopped. Each call allocates a new timer; using in a `select` loop is wasteful.

### `time.Tick`

```go
func Tick(d Duration) <-chan Time
```

Convenience wrapper for `NewTicker(d).C`. Pre-1.23, the underlying Ticker could not be stopped and leaked. Post-1.23, it can be GC'd. Still recommended only for the simplest use cases (no shutdown needed).

### `time.Sleep`

```go
func Sleep(d Duration)
```

Blocks the calling goroutine for at least `d`. Internally uses the same timer scheduler as Ticker. Not a substitute for Ticker in periodic work because Sleep does not provide a channel.

---

## Edge Cases and Corner Behaviours

### EC1. NewTicker(MaxDuration)

`time.NewTicker(math.MaxInt64)` is legal but unlikely useful. The maximum duration in Go is `math.MaxInt64` nanoseconds, approximately 292 years. The runtime accepts this; the ticker will never fire in practice.

### EC2. Reset with extreme values

`Reset` with a duration approaching `math.MaxInt64` or near-zero behaves predictably: the new period is the requested value. The minimum useful period is bounded by the OS scheduler quantum (typically 1 µs).

### EC3. Goroutine leak via abandoned receive

A goroutine blocked on `<-t.C` after the ticker has been collected (post-1.23) will block forever:

```go
ch := make(<-chan time.Time)
go func() {
    t := time.NewTicker(time.Second)
    ch = t.C
    // t goes out of scope here; in 1.23+ it can be GC'd
}()
v := <-ch // may block forever if the ticker was collected
```

In practice this is unusual; receive goroutines hold a reference to the channel, which keeps the ticker alive. Verify with a goroutine dump.

### EC4. Channel passed to multiple receivers

```go
t := time.NewTicker(time.Second)
go consumer(t.C)
go consumer(t.C)
```

Each tick goes to one of the two consumers, chosen non-deterministically. The other consumer does not see that tick. Useful for load distribution; surprising if you expected fan-out semantics.

### EC5. Embedded in struct

```go
type Job struct {
    *time.Ticker
}
j := Job{time.NewTicker(time.Second)}
```

The embedded pointer's `Stop` and `Reset` methods are promoted. Calling `j.Stop()` is equivalent to `j.Ticker.Stop()`. `j.C` accesses the embedded channel. Be careful with nil derefs if the embedded field is unset.

### EC6. Stop during receive

```go
go func() {
    v := <-t.C // blocked
}()
t.Stop()
```

`Stop` does not wake the blocked receive (channel is not closed). The receive remains blocked until either (a) a tick was already in the buffer slot or (b) forever. To unblock, use a select with a separate done channel.

### EC7. Reset with negative duration

`Reset(0)` and `Reset(-1)` panic with "non-positive interval for Ticker.Reset". (Pre-1.15 there was no `Reset` to call.)

### EC8. NewTicker in a goroutine that never receives

```go
go func() {
    t := time.NewTicker(time.Second)
    // t.C is never received from
}()
```

Pre-1.23: leak. The runtime keeps firing ticks; the channel buffer is full; dropped at runtime level. Goroutine is alive (running the rest of its body, if any), holding `t`.

Post-1.23: if the goroutine exits and the ticker becomes unreachable, GC collects it. If the goroutine is alive forever, the ticker is alive forever — no GC because reachable.

---

## Compatibility Matrix

| Feature | Introduced | Notes |
|---|---|---|
| `NewTicker`, `Stop`, `C` | 1.0 | original API |
| `Tick` | 1.0 | convenience function |
| `Reset` | 1.15 | did not exist before |
| Per-P timer heap | 1.14 | implementation change, no API change |
| Channel buffer 1 | 1.23 | observable via `cap(t.C)` |
| GC of unreferenced tickers | 1.23 | implicit |
| `Reset` drains pending tick | 1.23 | implementation fix |

---

## Source Pointers

For readers wanting to read the implementation:

- `src/time/tick.go` — `Ticker` type, `NewTicker`, `Stop`, `Reset`.
- `src/time/sleep.go` — `Timer`, `After`, `Sleep`, runtime stubs.
- `src/runtime/time.go` — runtime timer scheduler, heap operations, `addtimer`, `deltimer`, `runOneTimer`.
- `src/runtime/proc.go` — scheduler integration: `checkTimers`, `runqueuesteal`, etc.

Read these in order: start with `time/tick.go` to see the public API; follow into `runtime/time.go` to see how timers are scheduled; cross-reference to `runtime/proc.go` to see when the scheduler runs timers.

---

## Glossary

- **Tick**: a single delivery on `Ticker.C`.
- **Interval / period**: the duration argument `d` to `NewTicker` or `Reset`.
- **Drop**: a tick that the runtime computed but could not deliver because the channel slot was full.
- **Drift**: the accumulated difference between the expected tick time (if the runtime were perfectly punctual) and the actual delivery time.
- **Monotonic time**: a clock guaranteed not to go backwards. Used by `time.Ticker` for interval measurement.
- **Wall time**: the operating system's notion of human time. Can jump forward and backward (NTP, operator changes).
- **Stop**: turn off the ticker; no future ticks.
- **Reset**: change the period of an active ticker.

---

## References

Normative:

- Go standard library documentation: `https://pkg.go.dev/time#Ticker`
- Go release notes (for relevant versions): `https://golang.org/doc/go1.15`, `https://golang.org/doc/go1.23`
- Go memory model: `https://go.dev/ref/mem`

Source:

- `https://go.googlesource.com/go/+/refs/tags/go1.23.0/src/time/tick.go`
- `https://go.googlesource.com/go/+/refs/tags/go1.23.0/src/runtime/time.go`

Background reading:

- Russ Cox, "Timer 4-heap" design notes (proposals issue tracker).
- Ian Lance Taylor's talks on the Go runtime scheduler.
- Dmitry Vyukov's commentary on the runtime timer evolution.

---

## Summary

`time.Ticker` is a small API whose behaviour is precisely defined by a few normative documents. The key guarantees are: minimum interval, no ticks after Stop, GC-friendliness in Go 1.23+, and a single-slot channel buffer. The key non-guarantees are: exact delivery time, behaviour under runtime suspension, and stability of internal struct fields.

For most use, `defer t.Stop()` plus a `for { select { case <-ctx.Done(): ...; case <-t.C: ... } }` loop is correct and idiomatic. Edge cases (Reset semantics, monotonic vs wall clock, drop detection, wall-clock alignment) require the full understanding documented here. The professional document covers the patterns that arise in production; this document covers the specification that those patterns rest on.
