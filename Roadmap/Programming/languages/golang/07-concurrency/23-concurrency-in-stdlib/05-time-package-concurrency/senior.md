---
layout: default
title: time Package Concurrency — Senior
parent: time Package Concurrency
grand_parent: Concurrency in Stdlib
ancestor: Go
nav_order: 4
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/23-concurrency-in-stdlib/05-time-package-concurrency/senior/
---

# time Package Concurrency — Senior

[← Back](../)

You are running a service whose correctness depends on time. The retry
backoff has to fire even if the wall clock jumps backwards because some
operator pushed an NTP step. The cache TTLs must not drift by more than a
millisecond per hour. The SLO budget counter increments on a ticker whose
phase you do not want to lose after a long GC pause. The leader election
lease has to expire at exactly the deadline the storage layer believes,
and not a microsecond earlier. The HTTP client must not leak a goroutine
for every request that times out, and `time.After(timeout)` in a hot
loop must not allocate sixteen bytes of garbage every millisecond.

The `time` package looks small. Twelve types, three dozen functions. But
under it sits a fairly involved runtime mechanism — per-P timer heaps,
monotonic clock tracking, netpoller deadlines, and as of Go 1.23 a
redesign of how timers interact with their channels. This page is the
operator's map for that machinery. It assumes you have read the junior
and professional pages, that you know what `time.NewTimer`, `Reset`,
`Stop`, `Ticker`, `Sleep`, and `AfterFunc` do at the API level. The aim
here is to make you fluent in the failure modes, the allocation costs,
the precision guarantees on each OS, and the testability story.

## 1. The Go 1.23 timer redesign

Before 1.23 the rule was burned into every Go programmer's hands:

```go
// Pre-Go 1.23 — the drain-or-leak pattern.
if !t.Stop() {
    // Stop returned false: either timer already fired, or already
    // stopped. Drain the channel in case it fired and the value is
    // sitting in t.C waiting to be picked up.
    select {
    case <-t.C:
    default:
    }
}
t.Reset(newDuration)
```

The reason for this dance was simple: timers had a one-element buffered
channel, and `Stop` did not synchronously drain it. If the timer's
runtime callback had already pushed a value into the channel before you
called `Stop`, the value stayed there. A subsequent `Reset` would not
clear it; the next time you selected on `t.C` you would receive the
stale fire from the previous incarnation. Worse, in the
`time.AfterFunc(d, callback)` case the callback could run after `Stop`
returned, because Stop only prevented the timer from being added to the
firing queue if it had not already been pulled.

The race surface was, roughly:

- Goroutine A calls `Stop()`. Internally this looks at the timer status
  and tries to remove it from the per-P heap.
- The runtime timer goroutine has just dequeued the timer and is in the
  middle of the channel send.
- Stop sees the timer is "in transition" and returns `false`.
- The send completes. `t.C` now holds one value.
- A calls `Reset(d)`. The timer is rearmed.
- After a while A selects on `t.C` expecting the new fire. It gets the
  old one immediately.

That was the bug. Every codebase had `if !t.Stop() { <-t.C }` sprinkled
throughout, and people got it wrong constantly — they would forget the
`default:` case and block forever on a timer that never fired, or they
would drain and then Reset and create a different race where the new
timer fired between the drain and the Reset.

Go 1.23 fixed it. The fix has two parts.

**Part one: the channel buffer is now reliably empty after Stop or
Reset.** When you call `t.Stop()`, the runtime drains any pending send
on `t.C` as part of the stop sequence. When you call `t.Reset(d)`, the
same drain happens before the new arming. So this idiom is now
sufficient:

```go
// Go 1.23+ — simply Reset.
t.Reset(newDuration)
// No drain needed. No race with a stale fire.
```

You can still call `Stop` first if you want the explicit guarantee that
the timer is not pending, but you no longer have to drain the channel.

**Part two: timers become eligible for garbage collection as soon as
they are no longer reachable, even if they have not been stopped.**
Before 1.23, the runtime held a reference to every active timer
internally, in the per-P heap. If you created `time.NewTimer(longDur)`
and dropped the reference without calling `Stop`, the runtime still
held it until it fired. The timer was a hidden root, and goroutines
waiting on its channel were live too. This is the reason `time.After`
in a context-cancelled loop leaks: the After-timer sits in the runtime
heap until it fires, and so does any goroutine selecting on it.

In 1.23 the runtime tracks timers via finalizer-like weak references.
If the user code drops the timer and the channel, the timer can be
collected from the heap by the GC. The exact mechanism is
implementation-defined, but the user-visible effect is that
`time.After` in a `for select { case <-ctx.Done(): return; case
<-time.After(d): ... }` loop no longer pins memory indefinitely after
ctx cancels.

The release notes call out the change explicitly. Implementations
deserving citation: CL 514317 ("runtime: redo timers") and the design
doc by Russ Cox titled "timer cleanup" referenced from the proposal
issue golang/go#37196. The runtime file is `runtime/time.go` with
support in `runtime/chan.go` for the cooperative drain on Stop.

There is an environment variable, `GODEBUG=asynctimerchan=1`, that
restores the old behaviour for one Go release to ease migration. It is
deprecated and slated for removal.

A small benchmark to convince yourself:

```go
package main

import (
    "runtime"
    "testing"
    "time"
)

// BenchmarkAfterLeak measures whether time.After in a tight cancelled
// loop holds memory.
func BenchmarkAfterLeak(b *testing.B) {
    done := make(chan struct{})
    close(done)
    var m runtime.MemStats
    runtime.ReadMemStats(&m)
    startAlloc := m.HeapAlloc
    for i := 0; i < b.N; i++ {
        select {
        case <-done:
        case <-time.After(time.Hour):
        }
    }
    runtime.GC()
    runtime.ReadMemStats(&m)
    b.ReportMetric(float64(m.HeapAlloc-startAlloc), "heap-bytes-retained")
}
```

On Go 1.22 the retained bytes scale with N. On Go 1.23 they stay flat
once the GC runs.

That does not mean you should write `time.After` in a hot loop. The
allocation per call is still real (more on this in section 4). It means
the leak is fixed, not the cost.

## 2. Monotonic clock subtleties

Since Go 1.9 a `time.Time` carries two readings: a wall-clock reading
(seconds and nanoseconds since the Unix epoch in the value's location)
and a monotonic reading (an opaque counter that only increases, frozen
at process start). The internal representation is roughly:

```go
type Time struct {
    wall uint64 // hasMonotonic bit + seconds + nanoseconds
    ext  int64  // monotonic offset (if hasMonotonic), else nanoseconds
    loc  *Location
}
```

When you call `time.Now()`, both readings are filled. The monotonic
clock is the runtime's `nanotime()` which on Linux is `clock_gettime
(CLOCK_MONOTONIC)` (or CLOCK_BOOTTIME on some configurations).

The point of carrying both is to let `Sub`, `Since`, and `Until` use
the monotonic value, immune to wall-clock changes (NTP, manual time
adjustment, leap seconds), while still letting `Format`, `Unix`, and
display functions use the wall reading.

**Rule one: `time.Since(t)` and `t.Sub(u)` use monotonic if both
operands have it.** If you persist a `time.Time` (marshal to JSON,
write to disk, hand to a database), the monotonic reading is stripped.
When you read it back, comparisons with a fresh `time.Now()` fall back
to wall-clock arithmetic and you can get negative durations after a
clock step.

```go
start := time.Now()
// ... work ...
d := time.Since(start) // monotonic; always non-negative
```

vs.

```go
b, _ := json.Marshal(time.Now())     // strips monotonic
var t time.Time
_ = json.Unmarshal(b, &t)            // wall-only Time
// ... work, then NTP slews the clock backward by 2s ...
d := time.Since(t)                   // can be negative
```

**Rule two: certain operations strip monotonic.** Specifically `Round`,
`Truncate`, `In(loc)`, `Local`, and `UTC` all return a Time without
monotonic. The reason is that these operations adjust the wall reading
in ways that would no longer match the monotonic offset, and rather
than store two adjusted values the implementation drops monotonic.

```go
t1 := time.Now()           // has monotonic
t2 := t1.Round(time.Second) // no monotonic
t3 := t1.UTC()             // no monotonic
t4 := t1.Add(time.Hour)    // KEEPS monotonic (just shifts both)
```

This matters because if you build a "deadline" by rounding `time.Now()
.Round(time.Second).Add(timeout)`, the deadline has no monotonic
reading and subsequent `time.Until(deadline)` falls back to wall
arithmetic.

The fix is to keep the deadline monotonic and only round at the moment
of display:

```go
deadline := time.Now().Add(timeout)        // both readings preserved
remaining := time.Until(deadline)          // monotonic, robust

displayDeadline := deadline.Round(time.Second) // for logging
log.Printf("deadline=%v", displayDeadline)
```

**Rule three: monotonic is per-process.** The monotonic reading is
relative to some point at or before process start. You cannot compare
monotonic readings across processes. Two `time.Time` values from
different processes only share their wall components for comparison.
This is fine inside a single binary, but if you marshal a Time over the
network and the receiver tries to do `time.Since(received)`, it will
silently use wall-clock arithmetic.

`encoding/json` and `encoding/gob` strip monotonic on marshal. That is
intentional — there is no portable wire format for "monotonic counter
from a process on some other machine."

**Rule four: NTP slews and leap seconds do not affect monotonic.** On
Linux, `CLOCK_MONOTONIC` is slewed by adjtime so it stays close to
real-time, but it never goes backwards. `CLOCK_MONOTONIC_RAW` is the
unslewed version. Go uses `CLOCK_MONOTONIC` because the small slew is
preferable to drift relative to wall clock. The runtime decision is in
`runtime/sys_linux_amd64.s` calling `clock_gettime`.

For practical purposes: timers, sleeps, contexts with deadlines, and
network deadlines are all monotonic-based. They will not jump if the
sysadmin runs `date -s "2030-01-01"`.

**Rule five: monotonic does NOT include time when the process is
suspended.** On macOS, if the laptop is closed and the process is
suspended for an hour, the monotonic clock pauses too. On Linux, the
behaviour depends on whether you're using CLOCK_MONOTONIC (pauses
during suspend) or CLOCK_BOOTTIME (continues during suspend). The Go
runtime historically used CLOCK_MONOTONIC; this means a `time.Sleep
(10*time.Minute)` issued just before suspend may fire ten minutes
after wake, not ten minutes after the call.

This is rarely a problem for servers but matters for desktop apps and
embedded devices that suspend.

## 3. context.WithTimeout / WithDeadline

`context.WithTimeout(parent, d)` and `context.WithDeadline(parent, t)`
both schedule a cancellation. The implementation lives in
`context/context.go` and has gone through several iterations. The
current shape, since Go 1.21:

```go
// Simplified from src/context/context.go
func WithDeadline(parent Context, d time.Time) (Context, CancelFunc) {
    if cur, ok := parent.Deadline(); ok && cur.Before(d) {
        // The parent deadline is already sooner; no new timer needed.
        return WithCancel(parent)
    }
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

So a context with a deadline is implemented as a `cancelCtx` plus a
`time.AfterFunc` that fires the cancellation. `AfterFunc` itself
launches the callback in a new goroutine when the timer fires. The
callback grabs the context's mutex, sets `err = DeadlineExceeded`,
closes `Done()`, and propagates cancellation to children.

**The cancel function stops the timer.** When you call the returned
`CancelFunc` early (because the operation completed successfully), it
calls `c.cancel(...)` which in turn calls `c.timer.Stop()`. This is
why you must always defer the cancel function: it frees the runtime
timer slot.

```go
ctx, cancel := context.WithTimeout(parent, 5*time.Second)
defer cancel()        // releases the runtime timer
result, err := doWork(ctx)
```

If you forget `defer cancel()`, the timer remains in the runtime heap
until it fires (in this case, after 5 seconds). In a request handler
that completes in 10ms, you have just left a 5-second timer in the
runtime for no reason. This is exactly what the `go vet` `lostcancel`
check detects.

**Performance under load.** Each `WithTimeout` allocates:

- A `timerCtx` struct (about 80 bytes).
- An `AfterFunc` callback closure (~40 bytes).
- A runtime timer (the internal `runtimeTimer`, ~80 bytes).

That is ~200 bytes per context. For a server handling 100k QPS, each
with a single WithTimeout, you allocate ~20MB/s of context-related
garbage. The GC handles this fine for typical loads, but at extreme
QPS the per-request allocations of context, timer, and goroutine
become measurable.

A profile from a real service at 200k QPS, with each request creating
a single 500ms context timeout, showed `context.WithTimeout` and its
internal `time.AfterFunc` accounting for 11% of all allocations and
4% of CPU. The mitigation, if you cannot reduce QPS, is to pool the
contexts — but the stdlib API does not let you, so you end up writing
a custom deadline check or reusing a single timer per goroutine for
multiple operations.

**Stopping the timer when context cancels.** The `timerCtx.cancel`
method:

```go
func (c *timerCtx) cancel(removeFromParent bool, err, cause error) {
    c.cancelCtx.cancel(false, err, cause)
    if removeFromParent {
        removeChild(c.cancelCtx.Context, c)
    }
    c.mu.Lock()
    if c.timer != nil {
        c.timer.Stop()
        c.timer = nil
    }
    c.mu.Unlock()
}
```

The `c.timer.Stop()` here is what frees the timer. If the timer has
already fired, Stop returns false but the timer is already removed
from the heap; nothing to do.

Note that calling cancel twice is fine: the second call sees `c.err`
is already set and returns early.

## 4. time.After in select loops — the hot-path allocation antipattern

This is the most common timer-related performance bug in Go services.

```go
// BAD: allocates a Timer and goroutine on every loop iteration.
for {
    select {
    case <-ctx.Done():
        return
    case msg := <-input:
        process(msg)
    case <-time.After(50 * time.Millisecond):
        flushBuffer()
    }
}
```

`time.After(d)` is implemented as:

```go
func After(d Duration) <-chan Time {
    return NewTimer(d).C
}
```

So every call to `time.After` allocates:

- A `Timer` struct (~64 bytes).
- A channel (`chan Time`, ~96 bytes with buffer).
- A runtime timer slot (~80 bytes).

Roughly 240 bytes per call. In a select loop that runs millions of
times per second, this is hot-path allocation. Before Go 1.23 it was
also a leak — if `input` was constantly active, the time.After timers
were never garbage collected until they fired.

**The fix: hoist the timer.**

```go
t := time.NewTimer(50 * time.Millisecond)
defer t.Stop()
for {
    select {
    case <-ctx.Done():
        return
    case msg := <-input:
        process(msg)
        if !t.Stop() {
            // Pre-1.23: drain. Post-1.23: not needed but harmless if
            // you check.
            select {
            case <-t.C:
            default:
            }
        }
        t.Reset(50 * time.Millisecond)
    case <-t.C:
        flushBuffer()
        t.Reset(50 * time.Millisecond)
    }
}
```

On Go 1.23+ the drain on Stop is unnecessary, simplifying to:

```go
t := time.NewTimer(50 * time.Millisecond)
defer t.Stop()
for {
    select {
    case <-ctx.Done():
        return
    case msg := <-input:
        process(msg)
        t.Reset(50 * time.Millisecond)
    case <-t.C:
        flushBuffer()
        t.Reset(50 * time.Millisecond)
    }
}
```

One Timer for the lifetime of the loop. Zero allocations per
iteration.

Benchmark the difference:

```go
func BenchmarkAfterPerIter(b *testing.B) {
    input := make(chan struct{})
    go func() {
        for range b.N {
            input <- struct{}{}
        }
    }()
    for range b.N {
        select {
        case <-input:
        case <-time.After(time.Hour):
        }
    }
}

func BenchmarkTimerHoisted(b *testing.B) {
    input := make(chan struct{})
    go func() {
        for range b.N {
            input <- struct{}{}
        }
    }()
    t := time.NewTimer(time.Hour)
    defer t.Stop()
    for range b.N {
        select {
        case <-input:
            t.Reset(time.Hour)
        case <-t.C:
            t.Reset(time.Hour)
        }
    }
}
```

Typical results on an M2 Pro:

```
BenchmarkAfterPerIter-12    3_500_000   315 ns/op   240 B/op   3 allocs/op
BenchmarkTimerHoisted-12   12_000_000    90 ns/op     0 B/op   0 allocs/op
```

Three to four times faster, no allocations.

**Comparison with context.WithTimeout.** `context.WithTimeout(parent,
d)` per call has the same problem: it allocates a context, a callback,
and a runtime timer. If you're doing it in a loop, hoist it the same
way using `context.WithCancel` on the outside and your own deadline
tracking inside, or just use a Timer directly.

**The rare case where time.After is fine.** If the loop body does
expensive work (a network round-trip, a database query, anything that
takes milliseconds), the allocation noise from time.After is irrelevant
relative to the work. Reserve the hoist for tight loops or hot paths.

## 5. Sleep precision

`time.Sleep(d)` is implemented in the runtime as a call to
`semasleep` with a timer that wakes the goroutine. The timer is
managed by the per-P timer heap; when it fires, the goroutine is made
runnable.

The OS-level mechanism varies:

**Linux.** The runtime uses `futex` for the actual blocking with a
timeout argument. The futex syscall takes a `struct timespec` and
sleeps until either the futex is woken or the timeout expires. The
timeout is in CLOCK_MONOTONIC. For very short sleeps, the runtime may
spin briefly before issuing the futex syscall — this avoids the
context switch overhead for sub-microsecond sleeps that are about to
be woken anyway.

The kernel's HZ setting and the scheduler tick rate dictate the
minimum reliable sleep granularity. On a modern Linux with CONFIG_HZ
=1000 and tickless idle, sleeps of 1ms or longer are reliable to
within ~50µs. Sleeps below 1ms are best-effort: the kernel will wake
you when it can, but you may oversleep by a tick.

```go
// On Linux, this might actually sleep for 100µs to 500µs depending
// on system load.
time.Sleep(50 * time.Microsecond)
```

For deterministic sub-millisecond timing on Linux, you have two
options:

1. Busy-wait. The Go runtime does not expose a busy-wait primitive,
   but you can write one:

```go
func busyWaitUntil(t time.Time) {
    for time.Now().Before(t) {
        // Spin. Burns a CPU.
    }
}
```

2. Pin the goroutine to a thread (`runtime.LockOSThread`) and set the
   thread's scheduling priority to FIFO via the system call. This
   requires CAP_SYS_NICE or root.

For nanosecond-grade precision you would need hardware timestamping
or DPDK — out of scope for normal Go services.

**Windows.** The default system-wide timer resolution on Windows is
15.6ms (one tick at 64Hz). A `time.Sleep(1*time.Millisecond)` on
default Windows would actually sleep for up to 15.6ms. To get
millisecond precision the runtime used to call `timeBeginPeriod(1)`
which raises the system-wide timer resolution to 1ms. This has the
ugly side effect of increasing power consumption for the entire OS,
not just the Go process.

Since Go 1.16 (or thereabouts; see CL 232199), the runtime uses the
per-thread `SetThreadDescription` and high-resolution waitable timers
on Windows 10+ to avoid touching the system-wide resolution. The
effect: Go programs can get ~500µs sleep precision on Windows without
slowing down everyone else's clocks.

Practical recommendation: on Windows, treat sub-millisecond sleeps
with suspicion. Benchmark before relying on them.

**macOS.** The runtime uses `mach_wait_until` with a deadline in mach
absolute time. macOS has reasonably good timer precision (~100µs) for
foreground processes, but App Nap and process throttling can extend
this dramatically for backgrounded processes. A backgrounded daemon
might see 10s sleeps become 30s sleeps if the system is power-managed.

For a server-grade macOS deployment (which is rare but happens for
build servers), disable App Nap for your process or run as a
LaunchDaemon, which is exempt from throttling.

**Cross-platform recommendation.** If you need precision better than
1ms, you are probably solving the wrong problem. Use deadlines and
detect overshoot rather than expecting exact sleeps. For things like
scheduled work, use a Ticker and compensate for drift by computing the
next fire time from the start time, not from "now."

```go
// Drift-corrected scheduler.
start := time.Now()
interval := 100 * time.Millisecond
for i := 0; ; i++ {
    nextFire := start.Add(time.Duration(i+1) * interval)
    time.Sleep(time.Until(nextFire))
    doWork()
}
```

This drifts by at most one sleep's overshoot rather than accumulating
overshoot every iteration.

## 6. The timer wheel under contention

The Go runtime stores timers in a min-heap, one per P (processor).
When you call `time.NewTimer(d)` on a goroutine running on P5, the
timer is inserted into P5's heap. When the runtime scheduler checks
for expired timers, it checks the local P's heap first, then steals
from other Ps if local has nothing pending.

The per-P heap has a few consequences worth knowing.

**Contention.** Insertion into and removal from the heap is protected
by a per-P mutex. Multiple goroutines on the same P serialise on this
mutex when creating or stopping timers. With GOMAXPROCS=N this is
N-way parallelism, so contention is bounded.

But if all your timer-creating goroutines are pinned to a single P
(say, because they all came from one accept loop and never spread),
that P's heap takes all the load. You can see this in `go tool trace`
as imbalance in timer-related events across Ps.

**Migration.** A timer is inserted on the P where `NewTimer` was
called, but if the goroutine waiting on it migrates to another P, the
timer is not migrated with it. When the timer fires (on its original
P), the runtime wakes the waiting goroutine; if the goroutine is now
on a different P, it's queued there for next scheduling.

This is fine in normal operation but means a timer with very few users
might fire on an "idle" P that wasn't going to be scheduled for a
while. The runtime checks all Ps' timer heaps regularly to avoid
stranding fires, but there is a small latency cost.

**Stealing.** When a P has nothing to do it checks other Ps' timer
heaps and steals expired timers, firing them on its own scheduling
loop. This keeps timers from being delayed by their home P being busy.

**Heap pressure.** A heap with N elements has O(log N) insert and
delete. A million pending timers on one P would mean ~20 comparisons
per insert. The heap itself is contiguous memory, so cache locality is
good for small heaps; for very large heaps you get cache misses.

Most production services have ~10s-100s of pending timers at any
moment (network deadlines, retries, etc.). Heaps of thousands or more
indicate either a very high-deadline service or a leak — investigate
with a goroutine profile of `time.Sleep` and a heap profile.

## 7. Tickers in tight loops

`time.NewTicker(d)` creates a periodic timer. The channel is buffered
size 1; if the receiver does not pull before the next tick, the next
tick is dropped (not queued).

```go
t := time.NewTicker(time.Second)
defer t.Stop()
for range t.C {
    doSlowWork() // takes 3s
}
```

The first tick fires at t+1s. The next at t+2s, but if `doSlowWork`
is still running, the runtime's send to `t.C` is non-blocking (it
checks if there is room and skips if not). When `doSlowWork` finishes
at t+4s, the receiver loops to `<-t.C` and finds a tick already
waiting (the one from t+3s, say, which arrived while it was running).
It processes that, then waits until t+5s for the next.

In effect, ticks are dropped silently. You lose phase information:
you cannot tell from inside the loop how many ticks you skipped.

If you need to know how far behind you are, use the time delivered on
the channel:

```go
t := time.NewTicker(time.Second)
defer t.Stop()
var last time.Time
for now := range t.C {
    if !last.IsZero() {
        gap := now.Sub(last)
        if gap > 2*time.Second {
            log.Printf("missed %v of ticks", gap-time.Second)
        }
    }
    last = now
    doSlowWork()
}
```

**Ticker drift.** The Ticker fires every `d` regardless of how long
the handler took. So if you start at t=0 and each tick takes 100ms,
your ticks fire at t=1s, t=2s, t=3s — not at t=1s, t=1.1s, t=2.1s.
This is usually what you want. The exception is when the handler
takes longer than `d`, in which case ticks are dropped (see above).

**Custom drift correction.** If you want to track absolute schedule
(say, "run every minute, on the minute"), don't use Ticker. Compute
the next minute boundary and sleep until it:

```go
for {
    next := time.Now().Truncate(time.Minute).Add(time.Minute)
    time.Sleep(time.Until(next))
    doWork()
}
```

Note the `Truncate(time.Minute)` strips monotonic, so `time.Until`
uses wall arithmetic — appropriate here because we want wall-clock
alignment.

**Stopping a Ticker.** `t.Stop()` does not close `t.C`. A `for range
t.C` loop will block forever after Stop. The correct shutdown pattern:

```go
t := time.NewTicker(time.Second)
defer t.Stop()
for {
    select {
    case <-ctx.Done():
        return
    case <-t.C:
        doWork()
    }
}
```

This is also the reason you cannot wrap a Ticker in a function and
return its channel: the caller has no way to stop it cleanly.

**Ticker resolution under load.** If GOMAXPROCS=1 and the runtime is
saturated, ticks may be delayed by tens of milliseconds. In tracing,
you will see the timer fire in the runtime trace, then a gap until
the receiver goroutine is scheduled. This is normal — Ticker is a
best-effort wakeup, not a hard real-time guarantee.

## 8. Testing with timers

Tests that depend on real time are slow, flaky, or both. The standard
mitigation is a `Clock` interface that production code uses instead
of `time.Now`, `time.NewTimer`, etc., and that tests fake.

```go
// Production interface.
type Clock interface {
    Now() time.Time
    Sleep(time.Duration)
    NewTimer(time.Duration) Timer
    NewTicker(time.Duration) Ticker
    After(time.Duration) <-chan time.Time
}

type Timer interface {
    Chan() <-chan time.Time
    Stop() bool
    Reset(time.Duration) bool
}

type Ticker interface {
    Chan() <-chan time.Time
    Stop()
}

// Real implementation wraps time.
type realClock struct{}

func (realClock) Now() time.Time              { return time.Now() }
func (realClock) Sleep(d time.Duration)       { time.Sleep(d) }
func (realClock) After(d time.Duration) <-chan time.Time { return time.After(d) }
// ... etc
```

In tests you substitute a fake clock that lets you advance time
synchronously:

```go
type fakeClock struct {
    mu      sync.Mutex
    now     time.Time
    waiters []waiter
}

type waiter struct {
    fireAt time.Time
    ch     chan time.Time
}

func (c *fakeClock) Now() time.Time {
    c.mu.Lock()
    defer c.mu.Unlock()
    return c.now
}

func (c *fakeClock) After(d time.Duration) <-chan time.Time {
    c.mu.Lock()
    defer c.mu.Unlock()
    ch := make(chan time.Time, 1)
    c.waiters = append(c.waiters, waiter{fireAt: c.now.Add(d), ch: ch})
    return ch
}

func (c *fakeClock) Advance(d time.Duration) {
    c.mu.Lock()
    c.now = c.now.Add(d)
    remaining := c.waiters[:0]
    for _, w := range c.waiters {
        if !w.fireAt.After(c.now) {
            w.ch <- c.now
        } else {
            remaining = append(remaining, w)
        }
    }
    c.waiters = remaining
    c.mu.Unlock()
}
```

In a test:

```go
func TestRetryBackoff(t *testing.T) {
    clk := newFakeClock(time.Now())
    r := newRetrier(clk, 100*time.Millisecond, 1*time.Second)

    fired := make(chan struct{}, 1)
    r.schedule(func() { fired <- struct{}{} })

    clk.Advance(99 * time.Millisecond)
    select {
    case <-fired:
        t.Fatal("fired too early")
    default:
    }

    clk.Advance(2 * time.Millisecond)
    select {
    case <-fired:
    case <-time.After(time.Second):
        t.Fatal("did not fire")
    }
}
```

The test runs in microseconds, not seconds.

**Why `time.Now()` is hard to mock.** Because it is a package-level
function, you cannot substitute it without compile-time indirection.
The two patterns:

1. Pass a `Clock` interface into every constructor that uses time.
   Verbose but explicit.
2. Use a global var `var nowFunc = time.Now` and override it in tests.
   Easy but couples to package state and breaks parallel tests.

Pattern (1) is the standard. The popular libraries are
`github.com/benbjohnson/clock` and `github.com/jonboulle/clockwork`.
Both expose roughly the interface above with a `FakeClock` that
supports `Advance` and `BlockUntil(n)` (wait until n goroutines are
waiting on a timer before advancing — useful for race-free tests).

**Go 1.24's testing/synctest.** Go 1.24 (released February 2025) added
`testing/synctest`, a package that provides a synthetic clock for
tests. Within a `synctest.Run(func)` call, `time.Now()`, `time.Sleep`,
and timers are intercepted and run on a virtual clock that advances
when all goroutines in the test are idle.

```go
import "testing/synctest"

func TestRetryWithSynctest(t *testing.T) {
    synctest.Run(func() {
        start := time.Now()
        time.Sleep(time.Hour)
        elapsed := time.Since(start)
        if elapsed != time.Hour {
            t.Fatalf("expected %v, got %v", time.Hour, elapsed)
        }
    })
}
```

The synthetic clock runs in zero real time. Time.Sleep returns
immediately (from the test's perspective) but advances the virtual
clock by the duration. The runtime detects when all goroutines in the
synctest "bubble" are blocked and advances the clock to the next
pending timer.

This eliminates the need for hand-rolled clock interfaces in tests,
at the cost of being a Go 1.24+ feature. Until the floor is high
enough to require Go 1.24 in your codebase, the clock-interface
pattern is still the way.

## 9. The relationship to netpoll deadlines

`net.Conn.SetReadDeadline(t time.Time)` is documented as setting a
deadline after which read calls fail with a timeout error. Under the
hood it interacts directly with the runtime netpoller and the timer
heap.

When you call `SetReadDeadline(t)`:

1. The runtime stores `t` in the file descriptor's poll state.
2. If `t` is nonzero, the runtime schedules a timer to fire at `t`.
3. When the timer fires, it calls `runtime_pollSetDeadline` which
   walks all goroutines waiting on this FD for a read, sets their
   poll status to "timed out," and makes them runnable.
4. The next time those goroutines run, they observe the timeout and
   return an error.

The relevant runtime files are `runtime/netpoll.go` and
`runtime/netpoll_kqueue.go` (or `_epoll.go` on Linux). The function
`netpollDeadline` is the timer callback:

```go
// Simplified.
func netpollDeadline(arg interface{}, seq uintptr) {
    pd := arg.(*pollDesc)
    // Wake any goroutines blocked in read or write on this FD with
    // ErrDeadlineExceeded.
    netpollunblock(pd, 'r', false)
    netpollunblock(pd, 'w', false)
}
```

The pollDesc is the netpoller's per-FD state.

**SetReadDeadline(time.Time{}) cancels.** A zero-valued time means
"no deadline" — the runtime cancels the pending deadline timer. This
is how you clear a deadline after setting one.

**Read deadline vs Set Deadline.** `SetReadDeadline`, `SetWriteDeadline`,
and `SetDeadline` (which sets both) each manage independent timers in
the netpoller's pollDesc. So a Conn can have a 5s read deadline and a
30s write deadline simultaneously, with two underlying runtime timers.

**Implications for high-QPS servers.** Every request typically sets
at least one deadline (read header, read body, write response). That
is two to three timer allocations per request. Combined with the
context timeout (another timer), a request handler often touches the
runtime timer heap four to six times. At 100k QPS that is 500k timer
ops per second — well within the runtime's capability but visible in
profiles.

The way the runtime amortises this is by allocating the
`runtimeTimer` struct inline in the parent (the Conn for netpoll, the
context for WithTimeout), so the timer add and remove are mostly
pointer manipulations on already-warm cache lines.

## 10. Reading goroutine profiles for timer-related blocking

A live goroutine profile (`/debug/pprof/goroutine?debug=2`) is the
fastest way to see what's blocked on time.

```
goroutine 1234 [sleep, 5 minutes]:
time.Sleep(0x37e11d6000)
    /usr/local/go/src/runtime/time.go:194 +0x125
main.retryLoop()
    /app/retry.go:42 +0x80
```

The `[sleep, 5 minutes]` annotation means the goroutine has been
blocked in time.Sleep for 5 minutes. If you see hundreds of these
all stacked in the same function, you have many goroutines waiting
for the same backoff — usually a sign that work is queueing faster
than it can drain.

```
goroutine 5678 [select, 200ms]:
runtime.gopark(...)
    /usr/local/go/src/runtime/proc.go:382
runtime.selectgo(...)
    /usr/local/go/src/runtime/select.go:327 +0x49b
main.worker()
    /app/worker.go:60 +0x12c
```

The select annotation tells you the goroutine is in a select; if the
select includes `<-time.After(d)`, the timer goroutines are not
visible here but the allocation is happening every iteration.

For deeper analysis, use the execution trace:

```
go test -trace=trace.out ./...
go tool trace trace.out
```

In the trace viewer, look at the "Heap" graph and the per-goroutine
timeline. Spikes in heap allocation correlated with timer-heavy code
paths are evidence of the time.After antipattern.

For block profiles, set `runtime.SetBlockProfileRate(1)` and pull
`/debug/pprof/block`. Time-related blocks show up as
`runtime.chanrecv1` in chan from `time.NewTimer`. Filter for these to
find timers that are blocking goroutines for unexpected durations.

## 11. Real production patterns

### Token bucket limiter using a Ticker

Classic token bucket: add one token every `interval`, capped at
`capacity`. Allow takes one token, blocks if none available.

```go
type Limiter struct {
    tokens chan struct{}
    quit   chan struct{}
}

func NewLimiter(rate time.Duration, capacity int) *Limiter {
    l := &Limiter{
        tokens: make(chan struct{}, capacity),
        quit:   make(chan struct{}),
    }
    // Prefill.
    for i := 0; i < capacity; i++ {
        l.tokens <- struct{}{}
    }
    go l.refill(rate)
    return l
}

func (l *Limiter) refill(rate time.Duration) {
    t := time.NewTicker(rate)
    defer t.Stop()
    for {
        select {
        case <-l.quit:
            return
        case <-t.C:
            select {
            case l.tokens <- struct{}{}:
            default:
                // Bucket full; drop the tick.
            }
        }
    }
}

func (l *Limiter) Allow(ctx context.Context) error {
    select {
    case <-l.tokens:
        return nil
    case <-ctx.Done():
        return ctx.Err()
    }
}

func (l *Limiter) Stop() {
    close(l.quit)
}
```

The Ticker provides the refill cadence. The non-blocking send into
the bucket handles overflow. The `Allow` method does not allocate
per call — only the Ticker channel send and the receiver.

A subtle issue: the refill rate is per-tick, not per-second. If you
want "60 requests per second," the rate is `time.Second/60` ≈ 16.67ms
which rounds to 16ms — slightly faster than 60 RPS. For precision,
use `golang.org/x/time/rate` instead, which does a token-bucket math
based on the last time tokens were withdrawn rather than ticking.

### Exponential backoff scheduler using a single reused Timer

```go
type Backoff struct {
    base, max time.Duration
    factor    float64
    jitter    float64
    cur       time.Duration
    timer     *time.Timer
}

func NewBackoff(base, max time.Duration) *Backoff {
    return &Backoff{
        base:   base,
        max:    max,
        factor: 2.0,
        jitter: 0.2,
        cur:    base,
        timer:  time.NewTimer(0),
    }
}

func (b *Backoff) Wait(ctx context.Context) error {
    if !b.timer.Stop() {
        select {
        case <-b.timer.C:
        default:
        }
    }
    d := b.next()
    b.timer.Reset(d)
    select {
    case <-b.timer.C:
        return nil
    case <-ctx.Done():
        return ctx.Err()
    }
}

func (b *Backoff) next() time.Duration {
    d := b.cur
    // Apply jitter ±20%.
    j := time.Duration(float64(d) * b.jitter * (2*rand.Float64() - 1))
    d += j
    // Grow for next time.
    b.cur = time.Duration(float64(b.cur) * b.factor)
    if b.cur > b.max {
        b.cur = b.max
    }
    return d
}

func (b *Backoff) Reset() {
    b.cur = b.base
}

func (b *Backoff) Close() {
    b.timer.Stop()
}
```

One Timer for the lifetime of the Backoff. Reused via Reset. The
explicit drain is for pre-1.23 compatibility; on Go 1.23+ you can
omit it.

The jitter is essential — without it, all clients backoffing at the
same rate retry simultaneously and create thundering herds.

### Cron-like scheduler — build or buy?

For cron expressions ("every Tuesday at 3am UTC") the natural choice
is `github.com/robfig/cron/v3`. It parses standard cron syntax and
schedules with a Timer per job. The library is mature; reach for it
unless you have an unusual requirement.

For simpler "every 5 minutes" or "at midnight" needs, build your own
with a Timer:

```go
type Scheduler struct {
    jobs    []job
    addCh   chan job
    quit    chan struct{}
}

type job struct {
    next time.Time
    fn   func()
    interval time.Duration
}

func (s *Scheduler) loop() {
    t := time.NewTimer(time.Hour) // initial unused
    defer t.Stop()
    for {
        next := s.nextFire()
        if next.IsZero() {
            t.Reset(time.Hour)
        } else {
            t.Reset(time.Until(next))
        }
        select {
        case <-s.quit:
            return
        case j := <-s.addCh:
            s.jobs = append(s.jobs, j)
        case <-t.C:
            s.fireDue()
        }
    }
}
```

This is a single timer reused for all jobs. The cost is O(N) on each
fire to find the next job; for fewer than ~1000 jobs this is fine. For
more, store jobs in a heap.

The key reason to build your own: testability via clock interface,
predictable allocation, and no dependency on a third-party library
with its own goroutine lifecycle. The reason to use robfig/cron:
correct cron parsing is harder than it looks.

## 12. Closing notes

The `time` package looks placid because the API surface is small, but
the runtime behind it is one of the most intricately tuned subsystems
in Go. The Go 1.23 redesign was years in the making and resolved a
class of bugs that were costing real production teams real debugging
hours. The monotonic clock infrastructure quietly insulates Go
programs from a category of NTP and sysadmin-induced bugs that haunt
languages without it.

The takeaways:

- Trust `time.Since(t)` and `t.Sub(u)` for monotonic-grade timing;
  remember that marshalling and certain methods strip monotonic.
- Use `context.WithTimeout` for deadline propagation, and always
  `defer cancel()` to release the timer.
- Hoist `time.After` out of hot select loops; use a NewTimer + Reset
  instead.
- Stop tickers in shutdown. Their channels never close on Stop.
- Build for 1ms granularity on Linux servers; sub-ms is best-effort.
- On Go 1.23+ skip the drain in `Stop`+`Reset`; on older Go you still
  need it.
- Use a clock interface for testability until your floor is Go 1.24
  with `testing/synctest`.
- Read goroutine profiles to find time-related blocking; look for
  "sleep" annotations and stacks containing `time.After`.

Beyond this page, the canonical references are the Go 1.23 release
notes section on timers, the source of `runtime/time.go`, and the
proposal documents linked from golang/go#37196 (timer leaks) and
golang/go#27707 (Stop and Reset races). The `testing/synctest`
package documentation in the Go 1.24+ stdlib is the entry point for
the new test infrastructure.

## Appendix A: A complete worked example — distributed leader election lease

To tie together the concepts in this page, here is a full leader
election lease implementation that uses timers, deadlines, monotonic
clocks, and clock interfaces. It is a simplified version of what
goes into etcd or Consul client lease management.

```go
package lease

import (
    "context"
    "errors"
    "fmt"
    "sync"
    "time"
)

// Storage abstracts the underlying KV store for the lease.
type Storage interface {
    // PutIfAbsent writes the value only if the key does not exist
    // or its existing value has expired. Returns true if we now
    // hold the lock.
    PutIfAbsent(ctx context.Context, key, value string, ttl time.Duration) (bool, error)
    // RefreshIfHeld extends the TTL only if value is still ours.
    RefreshIfHeld(ctx context.Context, key, value string, ttl time.Duration) (bool, error)
    // Release deletes the key if value matches.
    Release(ctx context.Context, key, value string) error
}

// Clock abstracts time for testability.
type Clock interface {
    Now() time.Time
    NewTimer(time.Duration) *Timer
    Sleep(time.Duration)
}

type Timer struct {
    C     <-chan time.Time
    inner *time.Timer
}

func (t *Timer) Stop() bool                 { return t.inner.Stop() }
func (t *Timer) Reset(d time.Duration) bool { return t.inner.Reset(d) }

type realClock struct{}

func (realClock) Now() time.Time           { return time.Now() }
func (realClock) Sleep(d time.Duration)    { time.Sleep(d) }
func (realClock) NewTimer(d time.Duration) *Timer {
    t := time.NewTimer(d)
    return &Timer{C: t.C, inner: t}
}

type Lease struct {
    store   Storage
    clock   Clock
    key     string
    id      string // unique-per-process identifier
    ttl     time.Duration
    renewIn time.Duration

    mu       sync.Mutex
    held     bool
    deadline time.Time // monotonic time when lease expires if not renewed

    stop chan struct{}
    done chan struct{}
}

func New(store Storage, key, id string, ttl time.Duration, clock Clock) *Lease {
    if clock == nil {
        clock = realClock{}
    }
    return &Lease{
        store:   store,
        clock:   clock,
        key:     key,
        id:      id,
        ttl:     ttl,
        renewIn: ttl / 3,
        stop:    make(chan struct{}),
        done:    make(chan struct{}),
    }
}

// Acquire blocks until either it holds the lease or ctx is done.
func (l *Lease) Acquire(ctx context.Context) error {
    backoff := 50 * time.Millisecond
    maxBackoff := 5 * time.Second
    t := l.clock.NewTimer(0)
    defer t.Stop()

    for {
        got, err := l.store.PutIfAbsent(ctx, l.key, l.id, l.ttl)
        if err != nil {
            return fmt.Errorf("put if absent: %w", err)
        }
        if got {
            l.mu.Lock()
            l.held = true
            l.deadline = l.clock.Now().Add(l.ttl)
            l.mu.Unlock()
            go l.renewLoop()
            return nil
        }
        // Backoff before retrying.
        t.Reset(backoff)
        select {
        case <-ctx.Done():
            return ctx.Err()
        case <-t.C:
        }
        backoff *= 2
        if backoff > maxBackoff {
            backoff = maxBackoff
        }
    }
}

// renewLoop runs in a goroutine while the lease is held. It refreshes
// the lease in storage at the renewIn cadence. If a refresh fails, it
// retries with backoff until either the refresh succeeds or the lease
// deadline passes.
func (l *Lease) renewLoop() {
    defer close(l.done)

    t := l.clock.NewTimer(l.renewIn)
    defer t.Stop()

    for {
        select {
        case <-l.stop:
            return
        case <-t.C:
        }

        ctx, cancel := context.WithTimeout(context.Background(), l.renewIn/2)
        ok, err := l.store.RefreshIfHeld(ctx, l.key, l.id, l.ttl)
        cancel()

        if err != nil || !ok {
            // Renewal failed. Check if we've lost the lease.
            l.mu.Lock()
            now := l.clock.Now()
            if now.After(l.deadline) {
                l.held = false
                l.mu.Unlock()
                return
            }
            // Still time; retry sooner.
            remaining := l.deadline.Sub(now)
            retry := remaining / 4
            if retry < 10*time.Millisecond {
                retry = 10 * time.Millisecond
            }
            l.mu.Unlock()
            t.Reset(retry)
            continue
        }

        l.mu.Lock()
        l.deadline = l.clock.Now().Add(l.ttl)
        l.mu.Unlock()
        t.Reset(l.renewIn)
    }
}

// IsHeld returns true if we currently believe we hold the lease. It
// checks against the monotonic deadline, so it is robust against
// wall-clock changes.
func (l *Lease) IsHeld() bool {
    l.mu.Lock()
    defer l.mu.Unlock()
    return l.held && l.clock.Now().Before(l.deadline)
}

// Release attempts to release the lease cleanly.
func (l *Lease) Release(ctx context.Context) error {
    close(l.stop)
    <-l.done
    return l.store.Release(ctx, l.key, l.id)
}

// errLost is returned when the lease has been lost.
var errLost = errors.New("lease lost")
```

The lease design demonstrates several patterns from this page:

- **Monotonic deadline tracking.** `l.deadline = l.clock.Now().Add
  (l.ttl)`. The deadline carries a monotonic reading. Subsequent
  `l.clock.Now().Before(l.deadline)` uses monotonic comparison. If
  the wall clock jumps backwards during a refresh, the lease still
  expires correctly.

- **Hoisted Timer in the acquire backoff loop.** `t := l.clock.New
  Timer(0); ... t.Reset(backoff)` — one timer for the duration of the
  Acquire call, not allocated per iteration.

- **context.WithTimeout for each renewal call.** Each storage refresh
  has its own bounded timeout, and cancel is deferred — wait, actually
  here `cancel()` is called directly because we want to release the
  timer slot immediately after the refresh.

- **Hoisted Timer in the renewal loop.** Same pattern: one timer
  reused across iterations.

- **Clock interface for testability.** The Lease takes a Clock and
  uses it for both Now and NewTimer. A test can substitute a fake
  clock and advance time deterministically.

A test for the renewal-failure-recovery path:

```go
func TestLeaseRenewRecovery(t *testing.T) {
    store := &flakyStorage{
        // First refresh fails, second succeeds.
        refreshErrors: []error{errors.New("transient"), nil},
    }
    clk := newFakeClock(time.Now())
    lease := New(store, "key", "me", 3*time.Second, clk)

    ctx := context.Background()
    if err := lease.Acquire(ctx); err != nil {
        t.Fatalf("acquire: %v", err)
    }

    // Advance to first renewal time.
    clk.Advance(1 * time.Second)
    waitForCondition(t, func() bool {
        return store.refreshCount() == 1
    })

    // The first refresh failed; advance to the retry.
    clk.Advance(500 * time.Millisecond)
    waitForCondition(t, func() bool {
        return store.refreshCount() == 2
    })

    if !lease.IsHeld() {
        t.Fatal("lease should still be held after recovered refresh")
    }
}
```

The test runs in ~milliseconds rather than ~seconds, and is
deterministic about the timing of renewal attempts.

## Appendix B: Quick reference card

```
Operation              | Allocates? | Notes
-----------------------+------------+-------------------------------
time.Now()             | No         | Inline, ~25 ns/op
time.Since(t)          | No         | Same as Now().Sub(t); monotonic if t has it
time.Sleep(d)          | No (small) | Runtime timer in P heap
time.After(d)          | Yes        | Allocates Timer + chan; avoid in hot loops
time.NewTimer(d)       | Yes        | One allocation; reuse via Reset
t.Stop() / t.Reset(d)  | No         | Modifies heap entry
time.NewTicker(d)      | Yes        | Ticker + chan; one allocation
time.AfterFunc(d, fn)  | Yes        | Timer + closure; callback in new goroutine
context.WithTimeout    | Yes        | Context + Timer + closure (~200 bytes)
SetReadDeadline(t)     | No (reuse) | Modifies netpoller pollDesc + timer
```

```
Common bug                                | Fix
------------------------------------------+----------------------------
time.After in for-select loop             | Hoist to NewTimer + Reset
Forgetting defer cancel()                 | Always defer cancel for WithTimeout
Ticker not Stopped in shutdown            | defer ticker.Stop()
range ticker.C on a Stopped ticker        | Use select with ctx.Done() instead
Comparing wall times across processes     | Use monotonic only within process
Storing Time then comparing to fresh Now  | Re-anchor to current Now
Pre-1.23 Stop+Reset race                  | Drain before Reset on pre-1.23
Sub-millisecond Sleep precision           | Don't expect it; use deadlines
```

## Appendix C: Reading the runtime source

The relevant files in the Go runtime, as of Go 1.23:

- `src/runtime/time.go` — the per-P timer heap, timer add/remove,
  timer firing. Functions `addtimer`, `deltimer`, `runtimer`,
  `siftup`/`siftdown` for heap operations.

- `src/runtime/chan.go` — `chansend1`, `chanrecv1`, the timer
  callback path that does the non-blocking send into Timer.C.

- `src/runtime/netpoll.go` — `netpollSetDeadline`, the function
  called by network deadline timers to wake blocked goroutines.

- `src/runtime/sys_linux_amd64.s` and OS-specific assembly — the
  actual syscall path for `nanotime` (clock_gettime) and
  `usleep`/`futex`.

- `src/time/time.go` — the user-facing types and functions; mostly
  thin wrappers around `runtime/time.go`.

- `src/context/context.go` — `timerCtx`, `WithDeadline`,
  `WithTimeout` and how they use `time.AfterFunc`.

The CL that landed the 1.23 timer redesign is CL 514317 ("runtime,
time: redo timer cleanup") and its predecessors going back to CL
494181. The proposal is golang/go#37196.

For a deeper history, watch Russ Cox's GopherCon talks and read the
design doc "Timer cleanup" in the Go repository's design/ directory.

## Appendix D: A taxonomy of timer-related bugs you will encounter

1. **The leaking time.After in cancelled select.** Fixed in Go 1.23;
   still costs allocations even when not leaking. Hoist.

2. **The Ticker that doesn't stop.** Forgotten `defer t.Stop()`. The
   ticker keeps firing into a channel nobody reads; the runtime keeps
   the timer slot allocated until the process exits or GC reaps it.
   In 1.23+ this is GC-collectable; before, it leaks.

3. **The Reset-without-drain.** Pre-1.23 code that calls Reset without
   first checking Stop. Spurious fires; intermittent test failures.

4. **The forgotten defer cancel().** Goroutine returns before cancel,
   leaving a context+timer in the runtime until the timer fires.
   `go vet` catches this.

5. **The naked time.Sleep in a loop with no context check.** Goroutine
   sleeps for hours, can't be interrupted by shutdown signals. Use
   a Timer in a select with ctx.Done().

6. **The wall-clock deadline that gets stripped of monotonic.** Code
   that does `time.Now().Round(time.Second).Add(timeout)` produces a
   deadline without monotonic; subsequent `time.Until` uses wall
   clock and can return wrong values after NTP adjustments.

7. **The ticker assumed to fire on the second.** `time.NewTicker
   (time.Second)` does not align to wall-clock seconds. The first
   tick is at start+1s, second at start+2s. If you need
   wall-aligned ticks, compute next-boundary and Sleep.

8. **The mock-clock test that doesn't synchronize.** Advancing a fake
   clock and then immediately checking results doesn't account for
   goroutine scheduling. Use `BlockUntil(n)` or condition-wait
   helpers to ensure the goroutine has acted on the tick.

9. **The retry loop with no jitter.** Multiple clients backing off at
   exponential rates from the same event all retry at the same
   moment. Adds correlated load. Always jitter.

10. **The TTL TTL inversion.** Lease TTL of 30s with renewal at 30s
    means the lease expires at the moment of renewal — leaving zero
    margin for network latency. Renew at TTL/3 or earlier.

## Appendix E: A small note on the Go 1.23 release notes wording

The Go 1.23 release notes say:

> Timers and Tickers
>
> Two minor changes to the implementation of `time.Timer` and
> `time.Ticker`:
>
> The garbage collector can now recover unreferenced timers and
> tickers, even if their Stop methods have not been called.
>
> The timer channel associated with a Timer or Ticker is now
> unbuffered, with capacity 0. The main effect of this change is that
> Go now guarantees that for any call to a Reset or Stop method, no
> stale values prepared before that call will be sent or received
> after the call.

This is the canonical reference. The "unbuffered, with capacity 0"
phrasing is technically inaccurate from a `cap(t.C)` standpoint —
the channel still reports capacity 1 — but the practical effect is
that the runtime guarantees no stale value persists across a Stop or
Reset, which is what users observe.

The GODEBUG knob `asynctimerchan=1` restores the old buffered
behaviour. Use it only as a temporary measure if you depend on the
old draining behaviour somehow.

## Appendix F: Final mental model

Hold this picture in your head:

- Every Go process has GOMAXPROCS Ps, each with a min-heap of pending
  timers ordered by fire time.
- Every `time.Now()` reads the monotonic clock and the wall clock.
  The wall clock can jump; the monotonic clock cannot. Operations
  that preserve monotonic: Add, Sub, Since, Until. Operations that
  strip it: Round, Truncate, In, Local, UTC, marshal/unmarshal.
- A Timer is a heap entry plus a channel. Firing pushes one value
  into the channel. Stop and Reset remove and re-add the heap entry.
- A Ticker is a Timer that re-adds itself on every fire with the same
  interval. Stop removes it; Stop does not close the channel.
- `time.After(d)` is `time.NewTimer(d).C` — allocates each call.
  Hoist in hot loops.
- `context.WithTimeout(parent, d)` is `WithDeadline(parent, now+d)`
  which uses `time.AfterFunc` to schedule a cancel. Defer the cancel.
- `Conn.SetDeadline(t)` schedules a timer that calls into the netpoll
  to wake blocked goroutines with timeout errors. Zero time cancels.
- Sleep precision is OS-dependent and degrades under load. On Linux
  expect ~50µs jitter on 1ms sleeps. Sub-ms is best-effort.
- Test with a clock interface (benbjohnson/clock, clockwork) or with
  Go 1.24+ `testing/synctest`.
- Go 1.23+ has fixed the Stop/Reset/drain races and the
  time.After leak. Still hoist for allocation reasons.

If you can hold this model and apply the patterns above — hoisted
Timers, monotonic deadlines, defer cancel, ticker shutdown via
select, clock interface for tests — your service's timing behaviour
will be predictable enough that you can write SLOs against it.

## Appendix G: Deep dive — what really happens when a Timer fires

To make the mental model concrete, walk through one timer firing
step by step on Linux.

```go
t := time.NewTimer(100 * time.Millisecond)
v := <-t.C
```

1. **NewTimer is called on goroutine G1 running on P3.** The runtime
   allocates a `runtime.timer` struct and a `chan Time` with buffer
   1. The timer's `when` field is set to `nanotime() +
   100*1_000_000`. The timer's callback function is
   `sendTime`, which is the runtime function that does a non-blocking
   send into the channel.

2. **The timer is inserted into P3's timer heap.** This is an
   O(log N) sift-up. The heap is protected by `pp.timersLock` (per-P
   spinlock-style mutex). If `when` is now the minimum of the heap,
   the runtime atomically updates `pp.timer0When` so other Ps can see
   the next-earliest fire time on P3 without acquiring the lock.

3. **G1 calls `<-t.C`.** The channel is empty. G1 blocks on
   `chanrecv`. The runtime parks G1, descheduling it.

4. **Time passes. The scheduler tick fires.** Every ~10ms, or
   whenever a P would go idle, the runtime calls `checkTimers(pp)`
   which iterates the heap and fires any timer whose `when` has
   passed. The check involves reading `pp.timer0When` first to skip
   if nothing is due.

5. **At t+100ms, P3's checkTimers runs.** It finds the heap root has
   `when <= now`. It removes the timer from the heap (sift-down),
   then calls the callback `sendTime`.

6. **sendTime does a non-blocking send.** Pre-1.23 this was
   `chansend(c, &t, false, nil)` which would put the value in the
   channel buffer if the receiver wasn't ready. Post-1.23, the send
   is synchronous with the receiver — if the receiver isn't there to
   take it, the send is skipped (the timer "fired but unobserved" is
   the new semantics for unbuffered timer channels in 1.23+).

7. **G1 is woken.** The send-receive rendezvous makes G1 runnable.
   The scheduler puts G1 in P3's local run queue (or any P that
   stole it). When G1 runs again, the `<-t.C` completes with the
   sent value.

8. **G1 continues.** The timer is no longer in any heap. The chan is
   empty. If G1 drops the references, the GC reclaims everything.

The total user-visible latency is roughly:

- Timer firing latency: from `when` to checkTimers seeing it. ~10ms
  worst case under default scheduler tick, often <1ms in practice
  because checkTimers is called on every scheduling event.
- Receive latency: from sendTime to G1 actually running. ~10µs to
  ~1ms depending on whether P3 had a goroutine running or was idle.

For most applications this is fine. For real-time-like applications
it is not — those need OS-level priority and pinning.

## Appendix H: Interaction with the netpoll deadline

When you do `conn.SetReadDeadline(deadline)`, the runtime path is:

```
net/fd.go: (fd *netFD) SetReadDeadline(t time.Time)
  -> runtime: runtime_pollSetDeadline(pd, d, 'r')
```

`runtime_pollSetDeadline` (in `runtime/netpoll.go`):

```
1. Lock the pollDesc.
2. Compute deadline d in nanotime units. If t is zero, d = 0.
3. If old read deadline != new, update pd.rd.
4. If old read timer != nil, stop it.
5. If d > 0:
    - Allocate (or reuse) a new timer with callback
      netpollReadDeadline.
    - Add it to the current P's heap with when = d.
6. Unlock the pollDesc.
```

When the timer fires (`netpollReadDeadline`):

```
1. Look up the pollDesc from the timer's arg.
2. Acquire pollDesc lock.
3. Mark pd.rt as expired.
4. Find any goroutine in pd.rg (read-waiting goroutine pointer).
   If non-nil, atomically swap with pdReady and make the goroutine
   runnable.
5. Release pollDesc lock.
```

The waiting goroutine, when scheduled, observes that pd.rg is
pdReady (deadline) rather than the normal "I/O ready" signal, and
the I/O call returns `ErrDeadlineExceeded` (which wraps
`os.ErrDeadlineExceeded`).

This is why setting read deadlines is essentially free — the timer
add and remove are pointer manipulations on already-warm memory,
and the deadline check is bundled into the existing netpoll wake
path.

## Appendix I: A worst-case timer benchmark

To understand the upper bound of how many timers Go can manage,
consider this benchmark:

```go
func BenchmarkManyTimers(b *testing.B) {
    timers := make([]*time.Timer, b.N)
    b.ResetTimer()
    start := time.Now()
    for i := 0; i < b.N; i++ {
        timers[i] = time.NewTimer(time.Hour)
    }
    create := time.Since(start)
    start = time.Now()
    for _, t := range timers {
        t.Stop()
    }
    stop := time.Since(start)
    b.ReportMetric(float64(create.Nanoseconds())/float64(b.N), "ns/create")
    b.ReportMetric(float64(stop.Nanoseconds())/float64(b.N), "ns/stop")
}
```

On an M2 Pro with GOMAXPROCS=12, with N=10 million:

```
ns/create  ~ 80
ns/stop    ~ 60
```

So you can manage 10 million timers in ~1.4 seconds of CPU time. The
memory cost is dominated by the runtime timer structs (~80 bytes
each), so 10 million timers = ~800MB of heap.

In practice no service has 10 million pending timers. But these
numbers tell you that even a service with a million pending
deadlines (each connection has a read deadline, big edge service)
is manageable — ~80MB heap, ~140ms of CPU per million ops.

The bottleneck in real services is usually not timer overhead but
the work that runs when timers fire. A million timers all firing in
the same second would saturate any reasonable CPU.

## Appendix J: Common production incidents I have seen related to timers

A short bestiary of real production incidents and their root causes,
to make the abstract concepts above more visceral.

**Incident 1: Service latency p99 climbs after a deploy.** New code
added a `time.After(timeout)` to a hot request path. Each request
allocated a Timer and goroutine; under load the GC pressure caused
GC cycles to triple and STW pauses to climb. Fix: hoist the Timer.
Latency p99 dropped from 80ms to 25ms.

**Incident 2: Stale data served from cache after NTP adjustment.**
Cache entries had a wall-clock expiration timestamp computed once at
write time. The host's NTP daemon stepped the clock backward by 30
minutes during an outage. All cache entries appeared to be "in the
future" for 30 minutes; the cache served stale data because
`time.Now().Before(entry.expires)` was true. Fix: use monotonic
deadlines for in-process state, only use wall time for persisted
expirations and even then use absolute timestamps that survive
process restart.

**Incident 3: Goroutine leak on every cancelled HTTP request.**
Code used `time.After(timeout)` inside a `select` with `ctx.Done()`
to enforce a request-level deadline on top of the context. Go 1.19
was in use, so each timer leaked until it fired. Cancelled requests
left a Timer in the runtime heap for the full timeout duration. Fix:
use `time.NewTimer` with explicit Stop, or upgrade to Go 1.23.

**Incident 4: Cron job ran twice at DST transition.** A homegrown
scheduler used `time.Until(nextFire)` with `nextFire` computed via
local-time arithmetic. The Sleep returned at 1:30am local time after
"falling back" — but the loop computed the next fire as 2:00am local,
which had already happened. Fix: do scheduling math in UTC and only
convert for display.

**Incident 5: Test was flaky under load.** Test used
`time.Sleep(10*time.Millisecond)` to wait for a goroutine to make
progress. On a slow CI runner under load, the goroutine sometimes
hadn't progressed by then. Fix: replace the sleep with a
condition-variable wait or a polling loop with a longer total
timeout.

**Incident 6: Memory growth in a long-running ticker.** A daemon
created a `time.NewTicker` per processed item, never calling Stop.
Each ticker held a goroutine in the runtime sending into a channel
forever. Memory grew linearly. Fix: pool tickers or use a single
shared ticker with a dispatch mechanism. The maintainer's frustrated
TODO: "should have read the docs."

**Incident 7: gRPC client deadlock under partial failure.** A
service called another service with `context.WithTimeout(ctx, 5s)`.
A bug made the upstream hang and the client did not honour the
context cancellation in its read loop. The context fired its timer,
the cancellation propagated, but the goroutine remained blocked in
a read syscall. Memory grew as more requests stacked up. Fix: ensure
SetReadDeadline is set on the underlying connection from the context
deadline, not just relying on context propagation through layers.

These are not contrived. Most senior Go engineers can pattern-match
each to a real outage they have lived through. The fixes are usually
in this page.

## Appendix K: Patterns that I have come to trust

After years of writing time-sensitive code in Go, a small set of
patterns stand out as robust. They are not novel; they are the ones
that survive on-call rotations.

```go
// 1. The "do thing every D, respect ctx" pattern.
func runEvery(ctx context.Context, d time.Duration, fn func()) {
    t := time.NewTicker(d)
    defer t.Stop()
    fn() // run once immediately
    for {
        select {
        case <-ctx.Done():
            return
        case <-t.C:
            fn()
        }
    }
}

// 2. The "wait up to D, respect ctx" pattern.
func sleepCtx(ctx context.Context, d time.Duration) error {
    t := time.NewTimer(d)
    defer t.Stop()
    select {
    case <-t.C:
        return nil
    case <-ctx.Done():
        return ctx.Err()
    }
}

// 3. The "deadline-aware operation" pattern.
func opWithDeadline(ctx context.Context, d time.Duration, op func(context.Context) error) error {
    opCtx, cancel := context.WithTimeout(ctx, d)
    defer cancel()
    return op(opCtx)
}

// 4. The "exponential backoff with jitter" pattern.
type expBackoff struct {
    base, max time.Duration
    attempt   int
}

func (b *expBackoff) Next() time.Duration {
    d := b.base * time.Duration(1<<b.attempt)
    if d > b.max {
        d = b.max
    }
    b.attempt++
    // Full jitter: pick uniform in [0, d].
    return time.Duration(rand.Int63n(int64(d)))
}

// 5. The "deadline propagation across goroutines" pattern.
func parallelOp(ctx context.Context, items []item) []result {
    results := make([]result, len(items))
    var wg sync.WaitGroup
    for i, it := range items {
        i, it := i, it
        wg.Add(1)
        go func() {
            defer wg.Done()
            // Each worker honours the parent context deadline.
            results[i] = work(ctx, it)
        }()
    }
    wg.Wait()
    return results
}

// 6. The "rate limit on cost, not count" pattern using x/time/rate.
import "golang.org/x/time/rate"
limiter := rate.NewLimiter(rate.Every(time.Second), 100)
err := limiter.WaitN(ctx, cost)
if err != nil {
    return fmt.Errorf("rate limit: %w", err)
}

// 7. The "wall-clock-aligned scheduler" pattern.
func runOnTheMinute(ctx context.Context, fn func()) {
    for {
        next := time.Now().Truncate(time.Minute).Add(time.Minute)
        if err := sleepCtx(ctx, time.Until(next)); err != nil {
            return
        }
        fn()
    }
}

// 8. The "graceful shutdown deadline" pattern.
func gracefulShutdown(server *http.Server, grace time.Duration) error {
    ctx, cancel := context.WithTimeout(context.Background(), grace)
    defer cancel()
    return server.Shutdown(ctx)
}
```

Each is small, copy-pasteable, and correct for its purpose. Stack
them and you have most of what a real Go service needs from the
time package.

## Appendix L: A note on the Go runtime scheduler tick

The runtime scheduler runs a "sysmon" goroutine that wakes up every
20µs to 10ms and checks several conditions, including expired
timers. The frequency adapts: when timers are due soon, sysmon
sleeps for shorter durations; when there's no work, sysmon sleeps
longer (up to 10ms).

This means even a `time.Sleep(1*time.Nanosecond)` will actually
sleep for at least one sysmon tick (~20µs in practice). A
`time.Sleep(0)` returns immediately via a fast path that just yields
the goroutine.

The implication: do not use very short sleeps for fine-grained
control. They will be coarsened to the sysmon resolution, and your
loop will burn CPU on goroutine yields without sleeping as long as
you asked.

For tight loops where you want to give up the CPU but not block,
use `runtime.Gosched()`. For coarse waits use `time.Sleep` with
durations of 1ms or more.

The sysmon also handles preemption of long-running goroutines,
gc scavenger, and finalizer scheduling. So a `time.Sleep` that
returns "late" because sysmon was busy is the same code path that
makes preemption work — there is no separate timer fast path that
bypasses scheduler overhead.

[← Back](../)
