---
layout: default
title: time Package Concurrency — Middle
parent: time Package Concurrency
grand_parent: Concurrency in Stdlib
ancestor: Go
nav_order: 3
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/23-concurrency-in-stdlib/05-time-package-concurrency/middle/
---

# time Package Concurrency — Middle

[← Back](../)

If you arrived here from the Basic page, you know how to call `time.NewTimer`,
`time.NewTicker`, `time.After`, `time.AfterFunc`. You probably also know that
`time.After` allocates, that `time.Tick` is a leak hazard, and that you should
`defer ticker.Stop()`. The Middle page is the level where we stop treating the
`time` package as a black box and start walking the actual source files.

We will read:

- `src/time/time.go`
- `src/time/sleep.go`
- `src/time/tick.go`
- `src/runtime/time.go`
- a few helper functions in `src/runtime/proc.go` and `src/runtime/netpoll.go`

The reason this matters: every Go program that touches a deadline, a timeout,
an HTTP `ReadTimeout`, a `context.WithDeadline`, a `select { ... case <-time.After(d): }`,
a backoff retry — every one of them ends up in the runtime's per-P timer heap.
If you don't have a mental model of that heap and its state machine, you will
write code that allocates 50,000 timers per second, hold goroutines in
`Waiting` state for hours after they should have died, or worse, see a single
slow timer callback freeze the whole P for a millisecond.

The version we target is Go 1.23 with sidenotes on what was different in
1.13/1.14 (global heap → per-P heaps) and 1.22 (Timer/Ticker GC rules) and what
shipped in 1.23 (the `Reset`/`Stop` semantics overhaul). Source line numbers
drift between releases, so when we cite `runtime/time.go:413` treat it as a
landmark — the function is there even if the line number moved by a dozen.

---

## 1. `time.Time` — wall, ext, loc

Open `src/time/time.go`. The first non-trivial type is `Time`:

```go
// A Time represents an instant in time with nanosecond precision.
//
// Programs using times should typically store and pass them as values,
// not pointers. That is, time variables and struct fields should be of
// type time.Time, not *time.Time.
type Time struct {
    // wall and ext encode the wall time seconds, wall time nanoseconds,
    // and optional monotonic clock reading in nanoseconds.
    //
    // From high to low bit position, wall encodes a 1-bit flag (hasMonotonic),
    // a 33-bit seconds field, and a 30-bit wall time nanoseconds field.
    // The nanoseconds field is in the range [0, 999999999].
    // If the hasMonotonic bit is 0, then the 33-bit field must be zero
    // and the full signed 64-bit wall seconds since Jan 1, year 1 is stored in ext.
    // If the hasMonotonic bit is 1, then the 33-bit field holds a 33-bit
    // unsigned wall seconds since Jan 1, year 1885, and ext holds a
    // signed 64-bit monotonic clock reading, nanoseconds since process start.
    wall uint64
    ext  int64

    // loc specifies the Location that should be used to
    // determine the minute, hour, month, day, and year
    // that correspond to this Time.
    // The nil location means UTC.
    // All UTC times are represented with loc==nil, never loc==&utcLoc.
    loc *Location
}
```

This is one of the densest 24 bytes in the standard library, and reading it
slowly pays off.

### 1.1 Wall encoding

`wall` is 64 bits laid out:

```
bit 63             : hasMonotonic flag
bits 62..30        : 33-bit unsigned seconds since Jan 1, 1885 (if hasMonotonic)
                     OR all zero (if not hasMonotonic, with seconds in ext)
bits 29..0         : 30-bit nanoseconds within the current second [0, 1e9)
```

Why 1885? Because 1885 + 2^33 / (365.25 * 24 * 3600) ≈ 1885 + 272 ≈ 2157. The
window covers roughly 1885–2157, which is enough for any practical wall clock
that also carries a monotonic reading. Times outside that window (very old
historical dates, very far future) fall back to "no monotonic" mode where the
full seconds count lives in `ext`.

### 1.2 Monotonic vs wall

Every `time.Now()` reading carries two clocks:

- **Wall clock** — seconds + nanoseconds since the Unix epoch. Can jump
  forward or backward due to NTP, manual clock changes, leap seconds, suspend.
- **Monotonic clock** — nanoseconds since some arbitrary process-relevant
  origin (boot, process start, depending on platform). Strictly non-decreasing.

Most time arithmetic you actually want — "did 5 seconds elapse?" — must use
the monotonic clock. The trick `time.Time` plays is that a single value can
carry *both* and the package routes the right one to the right operation.

Look at `time.Since`:

```go
// Since returns the time elapsed since t.
// It is shorthand for time.Now().Sub(t).
func Since(t Time) Duration {
    if t.wall&hasMonotonic != 0 {
        return subMono(runtimeNano()-startNano, t.ext)
    }
    return Now().Sub(t)
}
```

If `t` carries a monotonic reading (`hasMonotonic` bit set), `Since` does a
direct subtraction of monotonic nanoseconds — no wall clock involved, immune
to NTP. If `t` was stripped of its monotonic bit (e.g. round-tripped through
JSON, or `t.Round(0)` was called), it falls back to wall subtraction.

### 1.3 `Round(0)` strips monotonic

```go
// Round returns the result of rounding t to the nearest multiple of d
// (since the zero time).
// Round returns a copy of t stripped of any monotonic clock reading
// but otherwise unchanged.
func (t Time) Round(d Duration) Time {
    t.stripMono()
    ...
}
```

Calling `t.Round(0)` is the documented way to drop the monotonic part. This
matters when serializing — JSON `MarshalJSON` and `gob` don't carry monotonic,
so the value you read back is wall-only. If you then `Sub` it from a fresh
`time.Now()`, you are doing wall-clock subtraction. Set a system clock back
and you can get negative durations.

### 1.4 `loc *Location`

The `Location` pointer is shared. `time.UTC` is a sentinel — but the actual
field stored is `nil` to mean UTC, so a `Time{}` zero value is "Jan 1, year 1,
00:00:00 UTC" with no monotonic reading. The `Location` itself contains the
zone abbreviation table, transitions, and the tzdata bytes. Multiple `Time`
values share the same `*Location`, so the cost is one pointer per value plus a
shared zone database.

---

## 2. `time.Now()` — vDSO, monotonic, linkname

`Now` is the entry point everything else builds on. Its body in
`src/time/time.go`:

```go
// Now returns the current local time.
func Now() Time {
    mono := runtimeNano() - startNano
    sec, nsec, mono := now_monotonic(mono) // pseudocode; actual implementation in runtime
    if mono == 0 {
        return Time{uint64(nsec), sec + unixToInternal, Local}
    }
    sec -= unixToInternal
    return Time{hasMonotonic | uint64(sec)<<nsecShift | uint64(nsec), mono, Local}
}
```

In the actual source you will find:

```go
func Now() Time {
    mono := runtimeNano() - startNano
    sec, nsec := now()
    mono += startNano
    sec += unixToInternal - minWall
    if uint64(sec)>>33 != 0 {
        // Wall seconds out of range; fall back to ext-only.
        return Time{uint64(nsec), sec + minWall, Local}
    }
    return Time{hasMonotonic | uint64(sec)<<nsecShift | uint64(nsec), mono, Local}
}
```

Two `//go:linkname` directives bring functions in from the runtime:

```go
// Provided by package runtime.
func now() (sec int64, nsec int32, mono int64)

//go:linkname runtimeNano runtime.nanotime
func runtimeNano() int64

var startNano int64 = runtimeNano() - 1
```

`runtime.nanotime` is the monotonic clock. On Linux/amd64 it goes through the
vDSO (virtual dynamic shared object) — a memory-mapped page provided by the
kernel that lets userspace read `CLOCK_MONOTONIC` without a syscall. On a
modern box that's around 15–25 ns per call. On systems without vDSO (some
container sandboxes, some BSDs), `nanotime` is a real syscall and costs
hundreds of nanoseconds.

`runtime.now` in `src/runtime/timestub.go` (or the platform-specific
`time_<os>.go`) returns wall seconds, wall nanoseconds, and monotonic
nanoseconds together — one trip into the runtime, one vDSO read on Linux.

### 2.1 Why `startNano - 1`

`startNano` is initialized to `runtime.nanotime() - 1`. The "-1" prevents the
monotonic reading stored in a `time.Time` from ever being zero, which is the
sentinel value used to mean "no monotonic reading present." A `Time{}` zero
value has `ext == 0`, which is interpreted as no-monotonic when paired with
`hasMonotonic == 0`. Subtracting 1 ensures any real monotonic reading is at
least 1, never colliding with the sentinel.

### 2.2 Cost of `time.Now()`

Run:

```go
func BenchmarkNow(b *testing.B) {
    for i := 0; i < b.N; i++ {
        _ = time.Now()
    }
}
```

Typical results on Linux/amd64:

```
BenchmarkNow-8        40000000        29.7 ns/op        0 B/op        0 allocs/op
```

Zero allocations — `Time` is a value, not a pointer. ~30 ns per call. If you
call `time.Now()` in a hot loop millions of times per second the CPU cost
shows up. Some HFT-style codebases cache nanosecond timestamps in a per-CPU
variable; for normal code, `time.Now()` is essentially free.

---

## 3. `time.Sleep(d Duration)` — `gopark` with a deadline

In `src/time/sleep.go`:

```go
// Sleep pauses the current goroutine for at least the duration d.
// A negative or zero duration causes Sleep to return immediately.
func Sleep(d Duration)
```

The body is implemented in the runtime; the time package just has the
declaration. The implementation lives in `src/runtime/time.go`:

```go
// timeSleep puts the current goroutine to sleep for at least ns nanoseconds.
//
//go:linkname timeSleep time.Sleep
func timeSleep(ns int64) {
    if ns <= 0 {
        return
    }

    gp := getg()
    t := gp.timer
    if t == nil {
        t = new(timer)
        gp.timer = t
    }
    t.f = goroutineReady
    t.arg = gp
    t.nextwhen = nanotime() + ns
    if t.nextwhen < 0 { // check for overflow
        t.nextwhen = maxWhen
    }
    gopark(resetForSleep, unsafe.Pointer(t), waitReasonSleep, traceBlockSleep, 1)
}
```

Walk this:

1. `gp := getg()` — current goroutine.
2. `t := gp.timer` — each `g` has a cached `*timer` field for reuse across
   sleeps. First call allocates; subsequent calls reuse.
3. `t.f = goroutineReady` — the function to call when the timer fires.
4. `t.arg = gp` — the goroutine to wake.
5. `t.nextwhen = nanotime() + ns` — absolute deadline on the monotonic clock.
6. `gopark(...)` — park the goroutine. The first argument is a function the
   runtime will call from `m0`/scheduler context to actually start the timer.

The `resetForSleep` callback is:

```go
func resetForSleep(gp *g, ut unsafe.Pointer) bool {
    t := (*timer)(ut)
    resetTimer(t, t.nextwhen)
    return true
}
```

It calls `resetTimer`, which inserts the timer into the current P's heap.

When the deadline arrives, `runtime.runtimer` (described below) finds this
timer at the heap root, removes it, and calls `goroutineReady(t.arg)`. That
function calls `goready(gp, 0)` which schedules `gp` back into runnable state.

### 3.1 "At least" the duration

The docstring says "pauses ... for at least the duration d." Not exactly. The
guarantee is one-sided: you will not wake before `nanotime() + ns`, but you
may wake later. How much later depends on:

- How quickly the per-P timer heap's earliest timer is checked. The scheduler
  checks on every `findRunnable` call and `sysmon` polls timers every 10ms in
  the worst case.
- Whether another goroutine on the same P is hogging the CPU. Go is
  cooperative-preemptive; up to Go 1.14 a long compute loop could delay
  timer firing by 10ms+. Async preemption since 1.14 reduces this.
- OS scheduler latency. If all your Ms are runnable and the OS hasn't given
  you a CPU back, your goroutine waits.

For sleeps under ~50 microseconds you should not use `time.Sleep`. The
scheduler overhead and `notetsleepg` minimum latency means a 1us sleep often
becomes 50us+ in practice. Use a spin loop or `runtime.Gosched`.

---

## 4. `time.NewTimer(d)` — `*Timer` + `chan Time` + `startTimer`

```go
// NewTimer creates a new Timer that will send the current time on its channel
// after at least duration d.
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

Things to notice:

- **Allocations**: one for the `*Timer` struct, one for the `chan Time` (a
  buffered channel of capacity 1 — its `hchan` is ~96 bytes plus the element
  buffer). So roughly two heap allocations per `NewTimer` call. Cheap if
  amortized, expensive in a hot loop.

- **`runtimeTimer`** is a `time` package mirror of the runtime's internal
  `timer` struct. Field layout must match exactly because the runtime casts
  through `unsafe`.

- **`when(d)`** computes the absolute deadline:

  ```go
  func when(d Duration) int64 {
      if d <= 0 {
          return runtimeNano()
      }
      t := runtimeNano() + int64(d)
      if t < 0 { // overflow
          // The "maxWhen" sentinel — far enough in the future to never fire.
          t = 1<<63 - 1
      }
      return t
  }
  ```

- **`sendTime`** is the firing callback:

  ```go
  func sendTime(c any, seq uintptr) {
      // Non-blocking send of current time on c.
      // c cannot be nil since startTimer rejected nil.
      select {
      case c.(chan Time) <- Now():
      default:
      }
  }
  ```

  Note the non-blocking send. If nobody is reading the channel and its
  buffer is full, the send is dropped. That's correct for `time.After`-style
  usage where you only care about the next tick; it's a footgun for tickers
  that you stopped reading from.

- **`startTimer(&t.r)`** is a linkname into the runtime:

  ```go
  // Implemented in runtime.
  func startTimer(*runtimeTimer)
  func stopTimer(*runtimeTimer) bool
  func resetTimer(*runtimeTimer, int64) bool
  func modTimer(*runtimeTimer, int64, int64, func(any, uintptr), any, uintptr)
  ```

  These four functions are the entire surface area `time` uses against the
  runtime for timer management.

---

## 5. `(*Timer).Stop()`, `(*Timer).Reset(d)`, and the Go 1.23 reset

```go
// Stop prevents the Timer from firing.
// It returns true if the call stops the timer, false if the timer has
// already expired or been stopped.
func (t *Timer) Stop() bool {
    if t.r.f == nil {
        panic("time: Stop called on uninitialized Timer")
    }
    return stopTimer(&t.r)
}
```

`stopTimer` returns true if the timer was still pending (and we successfully
removed it before firing), false if it had already fired or had already been
stopped.

### 5.1 Pre-Go 1.23 Reset semantics

```go
// Reset changes the timer to expire after duration d.
// It returns true if the timer had been active, false if the timer had
// expired or been stopped.
//
// For a Timer created with NewTimer, Reset should be invoked only on
// stopped or expired timers with drained channels. For example, assuming
// the program has not received from t.C already:
//
//   if !t.Stop() {
//       <-t.C
//   }
//   t.Reset(d)
//
// This should not be done concurrent to other receives from the Timer's channel.
```

The documented dance: `Stop`, drain if needed, `Reset`. The reason: a Timer's
channel has buffer 1. If the timer fired between your `Stop` call and your
`Reset` call, a value sits in the channel. If you `Reset` without draining,
your next receive returns the *stale* time, not the new one.

This was a classic race source. Consider:

```go
t := time.NewTimer(d)
for {
    select {
    case <-t.C:
        // do work
    case <-someEvent:
        if !t.Stop() {
            <-t.C // can deadlock if t.C was already drained
        }
        t.Reset(d)
    }
}
```

If the goroutine racing with the Timer's fire happens to lose, you can hit
the documented panic-or-block path. Many bugs around this were filed.

### 5.2 Go 1.23 Reset semantics

Go 1.23 changed the rules:

> As of Go 1.23, the channel of a Timer or Ticker is unbuffered (capacity 0),
> so that `Stop` plus `Reset` no longer requires draining the channel.
> Additionally, Timers and Tickers are no longer recycled — once you stop
> them, the runtime garbage-collects them as soon as no goroutine holds a
> reference, even if the channel was never received from.

Concretely, after 1.23:

```go
// Stop semantics: stops without needing to drain.
t := time.NewTimer(d)
if !t.Stop() {
    // No drain needed. Channel is unbuffered; if a send was in
    // progress, the new model handles it.
}
t.Reset(d)
```

And the GC change matters: previously, a Timer whose `C` you never read but
whose `Stop` you never called would be kept alive by the runtime's timer
heap until it fired. After 1.23, if the Timer becomes unreachable from user
code, it can be removed from the heap and collected.

The implementation lives in commits around `runtime/time.go` adding new
timer states and a finalizer-like cleanup. We won't reproduce the whole diff
here, but the key point for code review: **on Go 1.23+ you can stop caring
about the drain-after-Stop dance**, on earlier versions you must still do it.

### 5.3 `Stop` interaction with `AfterFunc`

For a Timer created with `AfterFunc`:

```go
t := time.AfterFunc(d, fn)
stopped := t.Stop()
```

`stopped == true` means `fn` definitely will not run (we removed the timer
before the runtime got to it). `stopped == false` means *either* `fn` already
ran *or* it's running concurrently right now. You cannot tell the difference
without your own synchronization (a `sync.Once`, an atomic flag in `fn`).

---

## 6. `time.After(d)` — the hot-loop allocator

```go
// After waits for the duration to elapse and then sends the current time
// on the returned channel.
// It is equivalent to NewTimer(d).C.
//
// The underlying Timer is not recovered by the garbage collector until the
// timer fires. If efficiency is a concern, use NewTimer instead and call
// Timer.Stop if the timer is no longer needed.
func After(d Duration) <-chan Time {
    return NewTimer(d).C
}
```

It's a one-liner. The problem is what disappears: the returned `<-chan Time`
gives you no handle on the Timer. You cannot Stop it. The Timer lives in the
runtime heap until it fires.

The pre-1.23 GC problem made this worse: each `time.After(d)` call in a hot
select loop allocated a Timer that stayed alive for `d`. If you had:

```go
for {
    select {
    case msg := <-ch:
        handle(msg)
    case <-time.After(1 * time.Second):
        return
    }
}
```

every iteration that received from `ch` allocated a fresh 1-second Timer that
then sat in the runtime heap for a full second. At 100,000 msgs/sec on `ch`,
you accumulate 100,000 dead-walking timers in the heap, all scheduled to fire
within a 1-second window. Heap operations become O(log n) where n is the
backlog. GC sees the channels and Timers in the live set. Memory grows.

The idiom for pre-1.23 code:

```go
t := time.NewTimer(1 * time.Second)
defer t.Stop()
for {
    if !t.Stop() {
        select { case <-t.C: default: } // drain
    }
    t.Reset(1 * time.Second)
    select {
    case msg := <-ch:
        handle(msg)
    case <-t.C:
        return
    }
}
```

Ugly but correct. On Go 1.23+, `time.After` is much closer to safe — the
unused Timer can be collected — but the channel allocation per call still
costs you. Use `NewTimer` + `Reset` for hot loops regardless.

---

## 7. `time.AfterFunc(d, f)` — function-firing Timer

```go
// AfterFunc waits for the duration to elapse and then calls f
// in its own goroutine. It returns a Timer that can
// be used to cancel the call using its Stop method.
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

func goFunc(arg any, seq uintptr) {
    go arg.(func())()
}
```

`goFunc` spawns a fresh goroutine for `f` each time the Timer fires. That
implies:

1. Even a cheap `f` costs you a goroutine startup (~1us, ~2KB stack).
2. `f` runs concurrently with the goroutine that called `Stop`. If you want
   to know whether `f` ran, the only safe approach is to make `f` itself
   record that.
3. `f` does not block the runtime's timer routine. The timer routine just
   does `go f()` and continues. This matters: a slow `f` does *not* delay
   subsequent timer firings on the same P. But it *does* consume a runtime
   goroutine slot.

`Reset` on an AfterFunc Timer is safe — it doesn't have a channel, so no
draining issues. The semantics are: if the timer hadn't fired yet, reschedule
it; if it had fired, schedule a fresh firing.

A pattern with AfterFunc that's worth knowing — single-shot watchdog:

```go
func WithTimeout(parent context.Context, d time.Duration, fn func() error) error {
    done := make(chan error, 1)
    timer := time.AfterFunc(d, func() {
        done <- context.DeadlineExceeded
    })
    defer timer.Stop()
    go func() { done <- fn() }()
    return <-done
}
```

(The standard library's `context.WithTimeout` uses essentially this pattern
under the hood, with extra propagation rules.)

---

## 8. `time.NewTicker(d)` — re-arming Timer

```go
// NewTicker returns a new Ticker containing a channel that will send
// the current time on the channel after each tick. The period of the
// ticks is specified by the duration argument.
// The ticker will adjust the time interval or drop ticks to make up for
// slow receivers.
// The duration d must be greater than zero; if not, NewTicker will panic.
// Stop the ticker to release associated resources.
func NewTicker(d Duration) *Ticker {
    if d <= 0 {
        panic(errors.New("non-positive interval for NewTicker"))
    }
    c := make(chan Time, 1)
    t := &Ticker{
        C: c,
        r: runtimeTimer{
            when:   when(d),
            period: int64(d),
            f:      sendTime,
            arg:    c,
        },
    }
    startTimer(&t.r)
    return t
}
```

The new field is `period`. When the runtime fires a timer with `period != 0`,
it does *not* remove it from the heap; instead it advances `when += period`
and sifts it back into position. That's the "re-arming" behavior. From the
runtime's view, a Ticker is a single timer; from the user's view, it
delivers an unbounded stream.

The "drop ticks to make up for slow receivers" line in the comment matters.
`sendTime` does a non-blocking send. If the receiver is busy and the
channel's buffer is full (capacity 1), the tick is dropped. The next tick
fires `period` later regardless. You can't tell from the channel how many
ticks you missed.

### 8.1 Ticker drift

A common worry: does a Ticker drift over time? Look at the firing logic.
When the runtime fires a periodic timer, it computes:

```go
delta := t.period
t.when += delta
```

So `when` is incremented by exactly `period` regardless of how late the
actual firing was. That means the next firing is scheduled relative to the
ideal time, not the actual fire time. Over many ticks, the average period is
exactly `d`. Individual ticks may be late, but they don't accumulate drift.

What *can* happen: if the runtime fell behind by more than one period (rare,
usually means GC pause or scheduler starvation), it skips ahead:

```go
if t.when < now {
    // We're behind. Catch up by computing how many periods to skip.
    delta := now - t.when
    t.when += (delta/t.period + 1) * t.period
}
```

The skipped ticks are simply lost. From your goroutine's perspective, your
select-case received fewer ticks than you expected if you count by wall
time, but the next tick will be in the right place modulo period.

---

## 9. `(*Ticker).Stop()` — the famous leak

```go
// Stop turns off a ticker. After Stop, no more ticks will be sent.
// Stop does not close the channel, to prevent a read from the channel
// succeeding incorrectly.
func (t *Ticker) Stop() {
    stopTimer(&t.r)
}
```

Note "Stop does not close the channel." If you write:

```go
ticker := time.NewTicker(1 * time.Second)
go func() {
    for t := range ticker.C {
        handle(t)
    }
}()
```

then `ticker.Stop()` will *not* terminate that goroutine. The `for t := range
ticker.C` waits forever for the next send, which never comes. You leak the
goroutine.

The correct pattern:

```go
ticker := time.NewTicker(1 * time.Second)
done := make(chan struct{})
go func() {
    for {
        select {
        case t := <-ticker.C:
            handle(t)
        case <-done:
            ticker.Stop()
            return
        }
    }
}()
// later:
close(done)
```

Or, equivalently, use a context.

### 9.1 Why not close the channel?

The comment says "to prevent a read from the channel succeeding incorrectly."
A closed channel reads zero values forever. If we closed `t.C`, every
subsequent receive would return `Time{}` immediately, and code like
`select { case <-ticker.C: doX(); ... }` would spin-loop calling `doX`.
Better to never close and force users to write explicit termination logic.

---

## 10. `time.Tick(d)` — the deliberate footgun

```go
// Tick is a convenience wrapper for NewTicker providing access to the ticking
// channel only. While Tick is useful for clients that have no need to shut
// down the Ticker, be aware that without a way to shut it down the
// underlying Ticker cannot be recovered by the garbage collector; it "leaks".
// Unlike NewTicker, Tick will return nil if d <= 0.
func Tick(d Duration) <-chan Time {
    if d <= 0 {
        return nil
    }
    return NewTicker(d).C
}
```

The function exists and is documented as leaky. Returns the channel without
the Ticker handle, so the user cannot call `Stop`. The Ticker stays in the
runtime heap forever. If you call `time.Tick` once per long-lived service
instance, fine. If you call it inside a request handler, you have a leak
that scales with traffic.

The reason to ever use it: top-level program patterns like:

```go
func main() {
    for now := range time.Tick(1 * time.Hour) {
        runHourlyCleanup(now)
    }
}
```

The Ticker outlives the program; never needs Stop. For any code that might
be called more than once, prefer `NewTicker` and `defer Stop()`.

---

## 11. Per-P timer heap

Now we cross into `src/runtime/time.go`. Open `src/runtime/runtime2.go` and
find the `p` struct (the runtime representation of a `GOMAXPROCS` slot):

```go
type p struct {
    ...
    // The when field of the first entry on the timer heap.
    // This is 0 if the timer heap is empty.
    timer0When atomic.Int64

    // The earliest known nextwhen field of a timer with
    // timerModifiedEarlier status. Because the timer may have been
    // modified again, there need not be any timer with this value.
    // This is 0 if there are no timerModifiedEarlier timers.
    timerModifiedEarliest atomic.Int64

    // Per-P timer heap.
    timers []*timer

    // Number of timers in P's heap.
    numTimers atomic.Uint32

    // Number of timerDeleted timers in P's heap.
    deletedTimers atomic.Uint32

    // Race context used while executing timer functions.
    timerRaceCtx uintptr
    ...
}
```

A `timer` is:

```go
type timer struct {
    pp puintptr // p that holds this timer; nil if no p has it yet

    when     int64    // when timer fires, in monotonic ns
    period   int64    // 0 = one-shot; >0 = period of repeating timer
    f        func(any, uintptr) // function to call
    arg      any      // argument to f
    seq      uintptr  // sequence for sendTime equality
    nextwhen int64    // when to fire on next reset
    status   atomic.Uint32 // timerXxxx state
}
```

Several things to note:

- **No global lock**. Each P has its own heap. Operations on a timer go
  through atomic CAS on `status`, plus possibly a lock on the owning P (for
  heap modifications).

- **A timer remembers which P owns it** via `pp`. When a goroutine moves to
  a different P, the timers it created stay with the original P; they fire
  there, and the firing function (`sendTime`, `goFunc`, etc.) handles
  cross-P delivery (channel send, goroutine spawn).

- **`numTimers` and `deletedTimers` are atomic counters**. The runtime
  periodically compacts the heap if `deletedTimers / numTimers` gets above a
  threshold (roughly 1/4 of the heap is deleted entries).

### 11.1 Layout of the heap

Standard 4-ary min-heap rooted at index 0, ordered by `when`. The
4-ary (not binary) variant trades slightly more comparisons during siftdown
for half the depth, which reduces cache misses. Look at `siftupTimer` and
`siftdownTimer` in `runtime/time.go`:

```go
func siftupTimer(t []*timer, i int) int {
    if i >= len(t) {
        badTimer()
    }
    when := t[i].when
    if when <= 0 {
        badTimer()
    }
    tmp := t[i]
    for i > 0 {
        p := (i - 1) / 4 // parent
        if when >= t[p].when {
            break
        }
        t[i] = t[p]
        i = p
    }
    if tmp != t[i] {
        t[i] = tmp
    }
    return i
}
```

Divide by 4 to find the parent. Children of node i are at 4i+1, 4i+2, 4i+3,
4i+4.

```go
func siftdownTimer(t []*timer, i int) {
    n := len(t)
    if i >= n {
        badTimer()
    }
    when := t[i].when
    if when <= 0 {
        badTimer()
    }
    tmp := t[i]
    for {
        c := i*4 + 1 // first child
        c3 := c + 2  // third child
        if c >= n {
            break
        }
        w := t[c].when
        if c+1 < n && t[c+1].when < w {
            w = t[c+1].when
            c++
        }
        if c3 < n {
            w3 := t[c3].when
            if c3+1 < n && t[c3+1].when < w3 {
                w3 = t[c3+1].when
                c3++
            }
            if w3 < w {
                w = w3
                c = c3
            }
        }
        if w >= when {
            break
        }
        t[i] = t[c]
        i = c
    }
    if tmp != t[i] {
        t[i] = tmp
    }
}
```

Standard heap restoration with 4-way fanout.

---

## 12. Timer status state machine

The full set of states in `src/runtime/time.go`:

```go
const (
    // timerNoStatus - timer has no status set yet
    timerNoStatus = iota

    // timerWaiting - timer is in P's heap, waiting to fire
    timerWaiting

    // timerRunning - timer is being run, possibly running its f
    timerRunning

    // timerDeleted - timer is in heap but marked for removal
    timerDeleted

    // timerRemoving - timer is being removed from heap
    timerRemoving

    // timerRemoved - timer has been removed from heap
    timerRemoved

    // timerModifying - timer is being modified
    timerModifying

    // timerModifiedEarlier - timer modified to an earlier time, in heap at old position
    timerModifiedEarlier

    // timerModifiedLater - timer modified to a later time, in heap at old position
    timerModifiedLater

    // timerMoving - timer is being moved between heaps (P shutdown)
    timerMoving
)
```

Why so many states? Because we want lock-free fast paths.

When a Timer's owner calls `Reset` from a different P than the timer's home P,
we don't want to take the home P's heap lock. Instead:

1. CAS `status` from `timerWaiting` to `timerModifying`.
2. Write the new `nextwhen` into the timer.
3. CAS `status` to either `timerModifiedEarlier` or `timerModifiedLater`.

The timer is still in the heap at its old position. Next time the owning P
runs `cleantimers` or `adjusttimers`, it will see the `timerModified*` status
and re-sift the timer into position.

For `timerModifiedEarlier`, the runtime also updates the `pp.timerModifiedEarliest`
field with an atomic min: this is the wake-up hint that lets the scheduler
know to potentially wake earlier than `timer0When` suggests.

### 12.1 State transitions diagram

A simplified transition map:

```
timerNoStatus ─addtimer→ timerWaiting

timerWaiting ─runtimer→ timerRunning ─done→ timerRemoved   (one-shot)
timerWaiting ─runtimer→ timerRunning ─done→ timerWaiting   (periodic)

timerWaiting ─deltimer→ timerDeleted
timerDeleted ─cleantimers→ timerRemoving → timerRemoved

timerWaiting ─modtimer→ timerModifying → timerModifiedEarlier
                                       → timerModifiedLater
timerModifiedEarlier ─adjusttimers→ timerWaiting (heap repaired)
timerModifiedLater   ─adjusttimers→ timerWaiting (heap repaired)

timerWaiting ─moveTimers→ timerMoving → timerWaiting (on new P)
```

Real source has more edge cases (interaction with `timerRunning` during
modification, etc.) — read `func deltimer(t *timer) bool` and
`func modtimer(t *timer, when, period int64, f func(any, uintptr), arg any, seq uintptr) bool`
for the gory details.

---

## 13. Why per-P heaps — the Go 1.14 change

Before Go 1.14, the runtime had a *global* timer heap with a global lock.
That mattered because every `time.After`, every HTTP timeout, every
`context.WithDeadline` poked at that lock. Under high concurrency, lock
contention on timer operations would saturate.

The Go 1.14 release notes:

> The runtime now uses a per-P timer heap, reducing lock contention for
> applications that use many timers.

Implementation sketch:

- `runtime.startTimer` calls `addtimer(t)` which acquires the *current* P's
  timer lock and inserts into that P's heap. The timer is bound to the P
  that started it.
- The scheduler (`findRunnable`) on each P checks its own heap. If the next
  timer is due, fire it locally.
- Cross-P operations (modtimer called from a different goroutine that
  happens to be running on a different P) use the lock-free
  `timerModifying` state machine described above.

The benefit is dramatic. Look at a microbenchmark like
`BenchmarkStartStop1000` in `runtime/time_test.go` — pre-1.14 throughput was
limited by the global lock; post-1.14 it scales nearly linearly with
GOMAXPROCS.

The cost: more code complexity, the state machine above, the
`pp.timerModifiedEarliest` hint, and the `adjusttimers`/`cleantimers`
periodic maintenance. The runtime has to balance "how often to call
`adjusttimers`" against the cost of stale `timerModified*` entries delaying
correct firing.

---

## 14. `addtimer`, `deltimer`, `modtimer`, `cleantimers`

The four core operations:

### 14.1 `addtimer`

```go
// addtimer adds a timer to the current P.
// This should only be called with a newly created timer.
// That avoids the risk of changing the when field of a timer in some P's heap,
// which could cause the heap to become unsorted.
func addtimer(t *timer) {
    if t.when <= 0 {
        throw("addtimer called with non-positive when")
    }
    if t.when >= maxWhen {
        t.when = maxWhen
    }
    if t.status.Load() != timerNoStatus {
        throw("addtimer called with initialized timer")
    }
    t.status.Store(timerWaiting)

    when := t.when

    pp := getg().m.p.ptr()
    lock(&pp.timersLock)
    cleantimers(pp)
    doaddtimer(pp, t)
    unlock(&pp.timersLock)

    wakeNetPoller(when)
}
```

Notice the call to `wakeNetPoller(when)`. The netpoller might be sleeping in
an `epoll_wait(timeout)` with a longer timeout than our new timer's
deadline. We need to wake it up so it can re-arm with a shorter timeout.

### 14.2 `deltimer`

```go
// deltimer deletes the timer t. It may be on some other P, so we can't
// actually remove it from the timers heap. We can only mark it as deleted.
// It will be removed in due course by the P whose heap it is on.
// Reports whether the timer was removed before it was run.
func deltimer(t *timer) bool {
    for {
        switch s := t.status.Load(); s {
        case timerWaiting, timerModifiedLater:
            // Prevent preemption while the timer is in timerModifying.
            // This could lead to a self-deadlock. See #38070.
            mp := acquirem()
            if t.status.CompareAndSwap(s, timerModifying) {
                tpp := t.pp.ptr()
                if !t.status.CompareAndSwap(timerModifying, timerDeleted) {
                    badTimer()
                }
                releasem(mp)
                tpp.deletedTimers.Add(1)
                return true
            }
            releasem(mp)
        case timerModifiedEarlier:
            ...
        case timerDeleted, timerRemoving, timerRemoved:
            return false
        case timerRunning, timerMoving:
            // The timer is being run. Wait until it's done.
            osyield()
        case timerNoStatus:
            return false
        default:
            badTimer()
        }
    }
}
```

Cross-P delete is the canonical lock-free CAS loop:

1. Read status.
2. Decide what to do based on status.
3. CAS to the next state.
4. If CAS fails, loop and retry.

The `acquirem`/`releasem` prevents preemption while we're in the brief
`timerModifying` state. If the goroutine got preempted there, another P
trying to operate on the same timer would spin forever waiting for
`timerModifying` to leave.

### 14.3 `modtimer`

`modtimer` covers both `Reset` (same f and arg, new when) and the more
general "change everything" case used internally. It's a longer function;
the key path is the same CAS loop pattern as `deltimer`: read status,
acquire M (prevent preemption), CAS to `timerModifying`, mutate fields,
CAS to the right post-state (`timerWaiting` if newly added,
`timerModifiedEarlier`/`timerModifiedLater` if already in heap), release M.

If the new `when` is earlier than the existing one, the post-state is
`timerModifiedEarlier` and the function calls `wakeNetPoller(when)` so
any sleeping M can re-arm. If later, `timerModifiedLater` — no wakeup
needed since the existing deadline is sooner anyway.

This is a great example of lock-free state-machine code with retries.

### 14.4 `cleantimers`

```go
// cleantimers cleans up the head of the timer queue. This speeds up
// programs that create and delete timers; leaving them in the heap
// slows down adjusttimers. We don't need to do this if there are
// no timers in deleted state. Reports whether no timer problems were
// found. The caller must have locked the timers for pp.
func cleantimers(pp *p) {
    gp := getg()
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
                badTimer()
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
                badTimer()
            }
        default:
            // Head of timers does not need adjustment.
            return
        }
    }
}
```

`cleantimers` opportunistically processes the heap head: if it's a deleted
or modified timer, fix it up. The function bounds its work — once it finds
a clean head, it stops. The heavier function `adjusttimers` walks the whole
heap and is called less frequently.

---

## 15. `runtime.runtimer` — the firing function

```go
// runtimer examines the first timer in timers. If it is ready based on now,
// it runs the timer and removes or updates it.
// Returns 0 if it ran a timer, -1 if there are no more timers, or the time
// when the first timer should run.
// The caller must have locked the timers for pp.
func runtimer(pp *p, now int64) int64 {
    for {
        t := pp.timers[0]
        if t.pp.ptr() != pp {
            throw("runtimer: bad p")
        }
        switch s := t.status.Load(); s {
        case timerWaiting:
            if t.when > now {
                // Not ready to run.
                return t.when
            }
            if !t.status.CompareAndSwap(s, timerRunning) {
                continue
            }
            runOneTimer(pp, t, now)
            return 0

        case timerDeleted:
            if !t.status.CompareAndSwap(s, timerRemoving) {
                continue
            }
            dodeltimer0(pp)
            if !t.status.CompareAndSwap(timerRemoving, timerRemoved) {
                badTimer()
            }
            pp.deletedTimers.Add(-1)
            if len(pp.timers) == 0 {
                return -1
            }

        case timerModifiedEarlier, timerModifiedLater:
            if !t.status.CompareAndSwap(s, timerMoving) {
                continue
            }
            t.when = t.nextwhen
            dodeltimer0(pp)
            doaddtimer(pp, t)
            if !t.status.CompareAndSwap(timerMoving, timerWaiting) {
                badTimer()
            }

        case timerModifying:
            osyield()

        case timerNoStatus, timerRemoved:
            badTimer()
        case timerRunning, timerRemoving, timerMoving:
            badTimer()
        default:
            badTimer()
        }
    }
}
```

And `runOneTimer`:

```go
func runOneTimer(pp *p, t *timer, now int64) {
    if t.period > 0 {
        // Leave timer in the heap; update when, sift down.
        delta := t.when - now
        t.when += t.period * (1 + -delta/t.period)
        siftdownTimer(pp.timers, 0)
        if !t.status.CompareAndSwap(timerRunning, timerWaiting) {
            badTimer()
        }
        updateTimer0When(pp)
    } else {
        // One-shot. Remove from heap, mark as removed.
        dodeltimer0(pp)
        if !t.status.CompareAndSwap(timerRunning, timerRemoved) {
            badTimer()
        }
    }

    // Run the timer's function. Unlock first since f might block.
    f := t.f
    arg := t.arg
    seq := t.seq
    unlock(&pp.timersLock)
    if raceenabled {
        ...
    }
    f(arg, seq)
    lock(&pp.timersLock)
}
```

Two important details:

1. **Periodic timers**: `t.when += t.period * (1 + -delta/t.period)` handles
   the catch-up case. If we're 5 periods behind, we advance 5 periods and
   skip those firings. We don't fire 5 times.

2. **Lock release around `f(...)`**: The `timersLock` is dropped before
   running `f`. That's mandatory — `f` may be `sendTime`, which does a
   non-blocking send to a channel; the send is non-blocking so it can't
   deadlock, but if `f` were `goFunc` calling user code that grabs locks,
   holding `timersLock` would create lock-order issues.

The function caller is `checkTimers` in `runtime/proc.go`:

```go
// checkTimers runs any timers for the P that are ready.
// If now is not 0 it is the current time.
// It returns the passed time or the current time if now was passed as 0.
// and the time when the next timer should run or 0 if there is no next timer,
// and reports whether any timers were run but not removed because they
// don't need to be re-run.
func checkTimers(pp *p, now int64) (rnow, pollUntil int64, ran bool) {
    if int64(pp.timer0When.Load()) == 0 && int64(pp.timerModifiedEarliest.Load()) == 0 {
        return now, 0, false
    }

    if now == 0 {
        now = nanotime()
    }

    // ... lock and run timers ...

    lock(&pp.timersLock)

    if len(pp.timers) > 0 {
        adjusttimers(pp, now)
        for len(pp.timers) > 0 {
            if tw := runtimer(pp, now); tw != 0 {
                if tw > 0 {
                    pollUntil = tw
                }
                break
            }
            ran = true
        }
    }

    // ... compact heap if too many deletes ...

    unlock(&pp.timersLock)
    return now, pollUntil, ran
}
```

`checkTimers` is called from `findRunnable` (the scheduler's main loop) every
time it looks for work. It is also called from `sysmon`, the monitor thread
that runs without a P attached, to ensure timers fire even when no P is
actively running.

---

## 16. Firing — channel send vs goroutine spawn

Two callbacks dominate:

### 16.1 `sendTime` (Timer, Ticker)

```go
func sendTime(c any, seq uintptr) {
    // Non-blocking send. If buffer full, drop.
    select {
    case c.(chan Time) <- Now():
    default:
    }
}
```

The non-blocking semantics are essential. The runtime can't afford to block
in `runOneTimer` — that would freeze the timer heap. If a receiver is slow,
we drop the tick. For `time.After`-style one-shot use this is fine; the
channel has buffer 1 and there's only one send, so it always succeeds.
For Tickers it means slow consumers see ticks dropped.

### 16.2 `goFunc` (AfterFunc)

```go
func goFunc(arg any, seq uintptr) {
    go arg.(func())()
}
```

Spawns a goroutine. The runtime returns immediately. The user code runs on
its own G, with the standard scheduler treatment.

Note that `go f()` itself isn't free — it allocates a `g` (~5KB amortized
with stack reuse), a stack, and enqueues onto the local run queue. For
high-frequency AfterFunc usage on hot paths you may want to pool goroutines
yourself and use AfterFunc to signal a worker via a channel.

---

## 17. Sleeping the M — `notetsleepg` + `pollUntil`

When all goroutines on a P are blocked and there's no work, the M (OS
thread) goes to sleep. How long? It needs to wake up by the next timer's
fire time. The mechanism:

In `runtime/proc.go`, `findRunnable` ends with something like:

```go
// We have nothing to do. If we're holding the P (after a thread-blocking syscall),
// release it. Then go to sleep.
pollUntil := nextTimerDeadline(pp)
mPark(pollUntil)
```

`mPark` calls into `notetsleepg` (or `notesleep` for blocking) with a
deadline. The actual sleep uses `futex` on Linux (or `WaitForSingleObject`
on Windows, etc.).

There's a coupling with the netpoller. The runtime wants to wake on either:

- A timer expiring (`pollUntil` deadline).
- A network event (epoll/kqueue/IOCP delivers a wakeup).

The netpoller is consulted by `findRunnable` with the deadline:

```go
list := netpoll(deadline)
```

`netpoll(deadline)` calls `epoll_wait` with a timeout of `deadline - now`.
When `epoll_wait` returns (either due to event or timeout), the function
returns any ready Gs. The scheduler then re-runs `checkTimers` and either
fires the expired timer or returns to user code.

If a timer is added concurrently from another P (`addtimer` calls
`wakeNetPoller(when)`), the netpoller's sleeping M needs to wake to
re-arm. `wakeNetPoller` writes a byte to the netpoll pipe (Linux) or
posts an IOCP completion (Windows), causing `epoll_wait` to return early.

---

## 18. `for range time.Tick` antipattern

```go
// BAD: leaks the ticker if the loop ever exits.
func processWithTicker(stop <-chan struct{}) {
    for now := range time.Tick(time.Second) {
        if shouldStop() {
            return
        }
        doWork(now)
    }
}
```

Several problems:

1. `time.Tick` returns a channel with no handle. Cannot Stop. The Ticker
   sits in the runtime heap re-arming itself forever.
2. The loop has no `select` with `stop`. Only way out is the `if`
   inside, which means you wait up to one full period before noticing.
3. If the goroutine exits via `return`, the Ticker keeps firing into a
   channel that nobody is reading. `sendTime`'s non-blocking send means
   no goroutine leak from the runtime side — but the *Ticker* itself
   leaks forever.

The correct version:

```go
func processWithTicker(stop <-chan struct{}) {
    ticker := time.NewTicker(time.Second)
    defer ticker.Stop()
    for {
        select {
        case now := <-ticker.C:
            doWork(now)
        case <-stop:
            return
        }
    }
}
```

`defer ticker.Stop()` ensures the runtime heap entry is removed on
function exit.

### 18.1 Detection

`go vet` does not catch this; it requires data flow analysis it doesn't
do. You catch it through:

- Code review (look for `time.Tick` outside of `main`-level loops).
- A linter rule (some custom analyzers exist).
- Profiling: a service that leaks tickers will eventually show many
  timers in `runtime.timers` (visible via `runtime.NumGoroutine` if
  AfterFunc, or via runtime heap inspection).

---

## 19. Reading the source — landmarks

If you open `src/runtime/time.go` and try to read it cover to cover, you
will drown. Better strategy: target specific functions in order of
importance.

### 19.1 Recommended reading order

1. **`type timer struct`** (~line 100) — the data structure.
2. **`addtimer`** (~line 250) — how a new timer enters the system.
3. **`runtimer`** (~line 700) — how timers fire.
4. **`runOneTimer`** (~line 750) — how period and callback interact.
5. **`deltimer`** (~line 350) — how cancellation works lock-free.
6. **`modtimer`** (~line 450) — how Reset works lock-free.
7. **`cleantimers`** (~line 600) — heap maintenance.
8. **`adjusttimers`** (~line 650) — periodic heap repair.
9. **`siftupTimer` / `siftdownTimer`** (~line 900) — the 4-ary heap.
10. **`checkTimers`** in `proc.go` — the scheduler integration.
11. **`netpoll(deadline)`** in `netpoll.go` — the deadline plumbing.

### 19.2 Where line numbers come from

The numbers above are approximate for Go 1.23's `runtime/time.go`. They
will drift release to release. Use `git grep` on the actual repo:

```
cd $(go env GOROOT)/src/runtime
git grep -n 'func runtimer'
git grep -n 'func addtimer'
git grep -n 'func deltimer'
```

You can also use `go doc` for the user-facing functions:

```
go doc time.NewTimer
go doc time.NewTicker
go doc time.AfterFunc
```

### 19.3 Testing

The runtime's own tests are in `src/runtime/time_test.go`. They include
benchmarks like `BenchmarkStartStop1000` that exercise the start/stop
pattern at scale, and `BenchmarkAdjustTimers` that exercises the heap
maintenance path. If you ever change anything in `runtime/time.go` (and
you should not, unless you're a runtime maintainer), these are the
tests to run.

For your own code, the testing package's `synctest` (experimental in
recent Go versions, stabilized in 1.24+) provides controllable time for
unit tests — you can advance "fake time" deterministically and avoid
real sleeps in tests. Before `synctest`, you'd write your code with an
injected clock interface and use a fake clock in tests.

---

## 20. Worked example — measuring timer-heap behavior

Let's write a small program that exercises the timer system and observe
the runtime stats.

```go
package main

import (
    "fmt"
    "runtime"
    "runtime/metrics"
    "sync"
    "time"
)

func main() {
    const N = 100_000
    var wg sync.WaitGroup

    samples := []metrics.Sample{
        {Name: "/sched/goroutines:goroutines"},
        {Name: "/memory/classes/heap/objects:bytes"},
    }

    snapshot := func(tag string) {
        metrics.Read(samples)
        var mstat runtime.MemStats
        runtime.ReadMemStats(&mstat)
        fmt.Printf("[%s] goroutines=%d heap=%d MB allocs=%d\n",
            tag, samples[0].Value.Uint64(),
            samples[1].Value.Uint64()/(1<<20),
            mstat.Mallocs)
    }

    snapshot("before")

    wg.Add(N)
    for i := 0; i < N; i++ {
        go func(i int) {
            defer wg.Done()
            t := time.NewTimer(50 * time.Millisecond)
            <-t.C
        }(i)
    }
    snapshot("during")
    wg.Wait()
    snapshot("after")
}
```

Run this. You'll observe:

- `before`: ~1 goroutine, small heap.
- `during`: ~100,000 goroutines, heap up by ~100,000 * (sizeof Timer +
  sizeof hchan + sizeof g) bytes. Multi-MB.
- `after`: back to ~1 goroutine, heap back down (after GC).

If you replace `time.NewTimer(50 * time.Millisecond)` with
`time.After(50 * time.Millisecond)`, the behavior is identical at this
scale because each Timer is one-shot and fires within the goroutine's
lifetime. The hot-loop allocation problem of `time.After` only shows up
when you call it many times *in the same goroutine* (each call leaves
a Timer in the heap).

### 20.1 Hot-loop allocation experiment

```go
func leakAfter(ctx context.Context, ch <-chan int) {
    for {
        select {
        case <-ctx.Done():
            return
        case <-ch:
            // hot path
        case <-time.After(1 * time.Hour):
            // never fires in practice
            return
        }
    }
}
```

If `ch` receives 1,000 messages per second, each iteration creates a fresh
`time.After(1 * time.Hour)`. After 10 seconds, you have 10,000 Timers in
the heap, all scheduled to fire one hour from various points. Memory grows
roughly linearly until either GC reclaims them (pre-1.23: not until they
fire) or your process is killed.

The fix:

```go
func goodAfter(ctx context.Context, ch <-chan int) {
    t := time.NewTimer(1 * time.Hour)
    defer t.Stop()
    for {
        if !t.Stop() {
            select { case <-t.C: default: }
        }
        t.Reset(1 * time.Hour)
        select {
        case <-ctx.Done():
            return
        case <-ch:
            // hot path
        case <-t.C:
            return
        }
    }
}
```

On Go 1.23+, the drain-after-Stop is unnecessary; the loop simplifies. But
the principle stands: one Timer reused, not N Timers allocated.

---

## 21. Interaction with `select`

`select` over timer channels is the most common usage. A key fact: each
`case <-ch:` in a select is independent — the select doesn't know that
the channel is a timer's `C`. It treats it as any channel receive.

This has consequences:

### 21.1 Timer fires before select even runs

```go
t := time.NewTimer(0)
runtime.Gosched()
select {
case <-t.C:
    fmt.Println("fired") // prints
case <-time.After(time.Hour):
    fmt.Println("hour") // does not print
}
```

The 0-duration timer fires almost immediately. By the time `select` runs,
`t.C` is ready. The select picks it. The `time.After` Timer was just
allocated — and now leaks until it fires an hour later (pre-1.23) or until
GC sees no references (Go 1.23+).

### 21.2 Multiple ready cases

If both `t.C` and another channel are ready when select runs, Go picks one
*pseudo-randomly*. You cannot rely on timer cases being prioritized.

```go
ch := make(chan int, 1)
ch <- 1
t := time.NewTimer(0)
time.Sleep(time.Microsecond)
select {
case <-t.C:
    fmt.Println("timer")
case <-ch:
    fmt.Println("ch")
}
// Either "timer" or "ch" can print.
```

For deterministic priority, restructure with a polled non-blocking select:

```go
select {
case x := <-ch:
    handle(x)
default:
    select {
    case x := <-ch:
        handle(x)
    case <-t.C:
        timeout()
    }
}
```

Two-stage. First a non-blocking peek; if not ready, fall through to a
blocking select. The first stage ensures `ch` is always taken when ready.

---

## 22. `context.WithDeadline` / `WithTimeout` under the hood

```go
// Skeleton of context.WithDeadline.
func WithDeadline(parent Context, d time.Time) (Context, CancelFunc) {
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

Every `context.WithTimeout` allocates an `AfterFunc` Timer that fires
`c.cancel`. When you `defer cancel()` and `cancel()` runs, it calls
`c.timer.Stop()`. If `cancel()` doesn't run, the Timer fires at the
deadline, cancellation propagates, and the Timer is then removed from the
heap by the runtime (one-shot).

If you never call `cancel` and the deadline is far in the future, the
Timer holds the context alive until it fires. The familiar advice "always
defer cancel" is partly about this — even if the deadline will cancel
the context eventually, the Timer is wasting heap space until then.

### 22.1 `time.AfterFunc` from many contexts

A common shape: HTTP handler calls `context.WithTimeout(r.Context(), 5*time.Second)`,
defers cancel, does work, returns. Per request, one AfterFunc Timer enters
the heap and (almost always) is stopped on return.

At 10,000 req/s, that's 10,000 timer additions per second + 10,000 removals.
Each operation is roughly O(log N) on the heap. The per-P heap design keeps
N small per P, so log N is small. Empirically this is fine — the Go
standard library `net/http` server has been doing this for years at high
scale.

---

## 23. `net.Conn` deadlines

```go
type Conn interface {
    ...
    SetDeadline(t time.Time) error
    SetReadDeadline(t time.Time) error
    SetWriteDeadline(t time.Time) error
}
```

How do these interact with the timer system? Answer: they don't, directly.
`net.Conn` deadlines are implemented at the netpoll level: each FD has
read/write deadline fields in `internal/poll.FD`, and the netpoller's
`runtime_pollSetDeadline` arms a runtime timer that, when it fires,
*marks the FD as expired* and wakes any goroutine blocked in
`epoll_wait`/equivalent. The blocked goroutine then sees the expiration
flag and returns a timeout error.

Under the hood, `runtime_pollSetDeadline` uses the same `runtime.timer`
machinery — but the firing callback is the netpoller-specific
`netpollDeadline`, not `sendTime`. So when you read `runtime/time.go`,
you'll see deadlines pass through the same heap and state machine.
There is *not* a separate "network deadline" timer system.

```go
// runtime/netpoll.go
func netpollDeadline(arg any, seq uintptr) {
    pd := arg.(*pollDesc)
    netpolldeadlineimpl(pd, seq, true, true)
}
func netpollReadDeadline(arg any, seq uintptr) {
    pd := arg.(*pollDesc)
    netpolldeadlineimpl(pd, seq, true, false)
}
func netpollWriteDeadline(arg any, seq uintptr) {
    pd := arg.(*pollDesc)
    netpolldeadlineimpl(pd, seq, false, true)
}
```

The `seq` field on the timer matters here: if the user reset the deadline
(arming a new timer with a new seq), an old firing should not affect the
current goroutine. The seq mismatch lets `netpolldeadlineimpl` no-op stale
firings.

---

## 24. Time in tests — `synctest`

Go 1.24 stabilized `testing/synctest` (after experimental availability in
1.23). It provides controllable time for tests:

```go
import "testing/synctest"

func TestRetryBackoff(t *testing.T) {
    synctest.Run(func() {
        start := time.Now()
        err := retryWithBackoff(operation, 3, 100*time.Millisecond)
        elapsed := time.Since(start)
        if elapsed < 300*time.Millisecond || elapsed > 700*time.Millisecond {
            t.Errorf("unexpected elapsed: %v", elapsed)
        }
    })
}
```

Inside `synctest.Run`, `time.Now`, `time.Sleep`, `time.NewTimer`, etc., use
a synthetic clock that advances *only when all goroutines in the bubble
are blocked*. So a test of "sleep 100ms and check" runs instantly instead
of really sleeping.

This means the runtime's timer machinery has hooks for synctest — internally,
when running inside a synctest bubble, timers are routed to a different
firing path that advances the synthetic clock. From the user's perspective,
the API is identical.

Before `synctest`, you'd inject a `Clock` interface yourself:

```go
type Clock interface {
    Now() time.Time
    NewTimer(d time.Duration) Timer
    Sleep(d time.Duration)
}
```

with a real implementation backed by the `time` package and a fake
implementation for tests. The `synctest` package removes that boilerplate.

---

## 25. The `time.Duration` type itself

```go
// A Duration represents the elapsed time between two instants
// as an int64 nanosecond count. The representation limits the
// largest representable duration to approximately 290 years.
type Duration int64
```

`int64` nanoseconds. The constant `time.Hour` is `60 * 60 * 1e9`. Doing
arithmetic like `10 * time.Second` works because both sides are
`Duration`/`int64` and the compiler picks the right multiplication.

Edge cases:

- **Overflow**: `time.Duration(math.MaxInt64) + 1 == math.MinInt64`. Adding
  a large deadline to `time.Now()` can overflow if you're not careful.
  The runtime's `when` function clamps to `maxWhen`.

- **Negative**: `time.NewTimer(-1)` fires immediately (when ≤ 0 ⇒
  when := runtimeNano()).

- **String formatting**: `time.Duration.String()` prints "1h30m45s" style.
  It allocates. Don't put it in a hot logging path without thinking.

The `time.Duration` constants (`Nanosecond`, `Microsecond`, `Millisecond`,
`Second`, `Minute`, `Hour`) are pre-computed `int64` values. No allocation,
just constant folding.

---

## 26. Summary — what to remember

The user-visible types `time.Timer`, `time.Ticker`, and the convenience
wrappers `time.After`, `time.Tick`, `time.AfterFunc`, `time.Sleep` are all
backed by the same runtime machinery:

- A per-P 4-ary min-heap of `*timer` structs ordered by absolute deadline
  on the monotonic clock.
- A lock-free state machine on each timer's `status` field allowing
  cross-P modification without taking the owning P's heap lock.
- A firing function (`sendTime`, `goFunc`, `goroutineReady`,
  `netpollDeadline`, etc.) that runs from the timer routine on the owning P.
- Integration with the scheduler's `findRunnable` and `sysmon`, plus the
  netpoller, so that an M sleeping on `epoll_wait` is woken when the next
  timer is due.

Things to keep in mind in everyday code:

1. **Always Stop tickers you don't intend to outlive the program.**
2. **Avoid `time.After` in hot select loops.** Use `NewTimer` + `Reset`.
3. **Avoid `time.Tick` outside of `main`-level forever loops.** It cannot
   be stopped.
4. **For Go ≤ 1.22, drain the channel after Stop before Reset.** For Go 1.23+,
   the new semantics make this unnecessary.
5. **`AfterFunc`'s `f` runs in its own goroutine.** It can race with `Stop`.
6. **`time.Now()` is cheap (~30 ns).** `time.Sleep` minimum latency is in
   the tens of microseconds in practice. Don't try to micro-sleep.
7. **Monotonic readings are stripped by `Round(0)`, JSON, gob.** Use the
   `time.Time` you got back directly when measuring intervals.
8. **A timer's home P is wherever it was created.** Modifications can
   come from anywhere via the lock-free state machine.

If you want to keep going, the [Advanced](../advanced/) page covers the
runtime-internal contracts (`go:linkname` boundaries with the `time`
package, the `runtime.timer.pp` retargeting on P shutdown, and the
specific changes that came with Go 1.23's timer overhaul), plus patterns
for high-throughput timer use (timing wheels, batched expirations, pooled Timers).

---

[← Back](../)
