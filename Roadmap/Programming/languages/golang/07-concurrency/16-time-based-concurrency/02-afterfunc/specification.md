---
layout: default
title: Specification
parent: AfterFunc
grand_parent: Time-Based Concurrency
ancestor: Go
nav_order: 6
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/16-time-based-concurrency/02-afterfunc/specification/
---

# time.AfterFunc — Specification

A reference page. Bookmark it.

## Package

```go
import "time"
```

For context-driven cleanup (Go 1.21+):

```go
import "context"
```

---

## time.AfterFunc

### Signature

```go
func AfterFunc(d Duration, f func()) *Timer
```

### Description

`AfterFunc` waits for the duration `d` to elapse and then calls `f` in its own goroutine. It returns a `*Timer` that can be used to cancel the call using its `Stop` method.

### Parameters

| Parameter | Type | Description |
|---|---|---|
| `d` | `time.Duration` | Minimum duration to wait before calling `f`. Negative or zero means "fire as soon as possible." Maximum: `math.MaxInt64` nanoseconds (~292 years). |
| `f` | `func()` | The function to call. Must be non-nil. Runs in a goroutine spawned by the runtime. |

### Return value

A `*time.Timer`:

- `Timer.C` is **nil** for an `AfterFunc` timer.
- The runtime holds a reference to the timer until `f` has been called or `Stop` succeeds; the caller need not retain the pointer.

### Goroutine behaviour

The callback `f` runs in a fresh goroutine spawned by the runtime when the timer expires. The runtime does not synchronise with the caller; the caller and the callback can be running in parallel.

### Panics

If `f` is nil, the runtime will panic with a nil function call when the timer fires.

If `f` panics, the panic is **not** recovered by the runtime. The panic propagates within the callback's goroutine; if not recovered there, the program terminates.

### Time source

The duration is measured against the monotonic clock. Wall-clock adjustments (NTP, daylight savings) do not affect the firing time.

---

## (*Timer).Stop

### Signature

```go
func (t *Timer) Stop() bool
```

### Description

Stop prevents the `Timer` from firing. It returns `true` if the call stops the timer, `false` if the timer has already expired or been stopped.

### Return value

| Return | Meaning |
|---|---|
| `true` | This call removed the timer from the runtime's pending set; `f` will not be called as a result of this timer. |
| `false` | The timer had already fired (callback running or completed) or was already stopped. |

### Synchronisation

`Stop` is **non-blocking**. It does not wait for the callback to finish. If `Stop` returns `false` and the callback was in flight at the moment of the call, the callback continues running on its own goroutine.

### Reset after Stop

Calling `Reset` after `Stop` re-arms the timer. The boolean return of `Reset` reflects the timer's prior (stopped) state.

### Thread safety

`Stop` is safe for concurrent calls. The runtime serialises internally.

---

## (*Timer).Reset

### Signature

```go
func (t *Timer) Reset(d Duration) bool
```

### Description

Reset changes the timer to expire after duration `d`. It returns `true` if the timer had been active, `false` if the timer had expired or been stopped.

### Parameters

| Parameter | Type | Description |
|---|---|---|
| `d` | `time.Duration` | New duration. Measured from the time of the `Reset` call. |

### Return value

For an `AfterFunc` timer:

| Return | Meaning |
|---|---|
| `true` | Timer was active; it has been rescheduled. |
| `false` | Timer had already fired or been stopped; it has been re-armed for a new firing. |

For both cases, after `Reset` returns the timer is on the heap and will fire after `d` from now.

### Note about channel timers

For `time.NewTimer` (channel-style) timers, `Reset` historically had a "drain dance" requirement before Go 1.23. For `AfterFunc` timers, no drain is needed (and `t.C` is nil anyway).

### Reset on a stopped timer

Legal. The timer is re-armed.

### Reset on a fired (expired) timer

Legal. The timer is re-armed; the callback will fire again at the new time.

### Reset on an active timer

Legal. The timer is rescheduled.

### Reset while the callback is running

Legal. The currently-running callback continues on its goroutine; a new firing is scheduled. Two callback goroutines may be alive simultaneously if the callback runtime exceeds the new duration before the new fire.

### Thread safety

Safe for concurrent calls. Coordinate with `Stop` via your own logic if you need a specific outcome.

---

## Timer struct

```go
type Timer struct {
    C <-chan Time
    // unexported fields
}
```

For an `AfterFunc` timer, `C` is **nil**. Do not receive from it; you will block forever.

For a `NewTimer` (channel-style) timer, `C` receives a `Time` value when the timer fires. `AfterFunc` does not use this channel.

---

## context.AfterFunc (Go 1.21+)

### Signature

```go
func AfterFunc(ctx Context, f func()) (stop func() bool)
```

### Description

`AfterFunc` arranges to call `f` in its own goroutine after `ctx` is done (cancelled or its deadline is reached). If `ctx` is already done, `AfterFunc` calls `f` immediately in its own goroutine.

Multiple calls to `AfterFunc` on a context operate independently; one does not replace another.

Calling the returned `stop` function stops the association of `ctx` with `f`. It returns `true` if the call stopped `f` from being run. If `stop` returns `false`, either the context is done and `f` has been started in its own goroutine; or `f` was already stopped.

The `stop` function does not wait for `f` to complete before returning. If the caller needs to know whether `f` is completed, it must coordinate with `f` explicitly.

If `ctx` has a "AfterFunc" method (e.g., the standard context types do), `AfterFunc` will use it; the runtime tracks the registration without spawning a goroutine.

### Parameters

| Parameter | Type | Description |
|---|---|---|
| `ctx` | `context.Context` | The context whose cancellation triggers `f`. |
| `f` | `func()` | The function to run. Must be non-nil. |

### Return value

A function `stop func() bool`:

| Return | Meaning |
|---|---|
| `true` | This call unregistered `f`; it will not run. |
| `false` | `f` has been started (or was started by a previous cancel), or was already stopped. |

### Goroutine behaviour

The callback `f` runs in a goroutine spawned by the runtime when the context cancels.

### Panics

Same as `time.AfterFunc`: if `f` panics, the program terminates unless `f` recovers.

### Comparison with time.AfterFunc

`time.AfterFunc` triggers on duration. `context.AfterFunc` triggers on context cancellation. They are independent primitives.

---

## Runtime guarantees

The following are guaranteed by the runtime:

1. `AfterFunc(d, f)` returns a non-nil `*Timer`.
2. The callback `f` runs no earlier than `d` after the `AfterFunc` call (measured on the monotonic clock).
3. The callback runs in a goroutine other than the caller's.
4. The callback runs at most once per fire.
5. `Stop` is non-blocking.
6. `Reset` is non-blocking.
7. Concurrent operations on the same `*Timer` are safely serialised.
8. The runtime holds a reference to the timer for the lifetime of the firing.

The following are **not** guaranteed:

1. Exact firing time (subject to scheduler latency, GC pauses, etc.).
2. Order of firing for timers with identical `when`.
3. The callback's goroutine ID or which OS thread it runs on.
4. Any synchronisation between the caller and the callback.
5. Memory ordering between the caller's writes and the callback's reads (use a mutex or atomics).

---

## Behavioural matrix

### Stop

| Timer state | Stop returns | Callback runs? |
|---|---|---|
| Active (still in heap) | `true` | No |
| Fired (callback in flight) | `false` | Yes (cannot revoke) |
| Fired (callback complete) | `false` | Already ran |
| Previously stopped | `false` | No |
| Concurrent Stop calls | one true, others false | No |

### Reset

| Timer state | Reset returns | New firing? |
|---|---|---|
| Active | `true` | Yes (new `when`) |
| Fired | `false` | Yes (new `when`) |
| Stopped | `false` | Yes (new `when`) |

### context.AfterFunc stop

| Context state | stop returns | Callback runs? |
|---|---|---|
| Not cancelled, registration present | `true` | No |
| Cancelled, callback running or done | `false` | Yes |
| Previously stopped | `false` | No |

---

## Idioms

### Schedule and forget

```go
time.AfterFunc(d, fn)
```

### Schedule and possibly cancel

```go
t := time.AfterFunc(d, fn)
defer t.Stop()
```

### Reschedule

```go
t.Reset(newDuration)
```

### Wait for callback

```go
done := make(chan struct{})
time.AfterFunc(d, func() {
    defer close(done)
    fn()
})
<-done
```

### Idempotent with guard

```go
var fired atomic.Bool
t := time.AfterFunc(d, func() {
    if fired.CompareAndSwap(false, true) {
        fn()
    }
})
if t.Stop() {
    fired.Store(true)
}
```

### Context-driven cleanup

```go
stop := context.AfterFunc(ctx, cleanup)
defer stop()
```

### Context + duration

```go
t := time.AfterFunc(d, fn)
context.AfterFunc(ctx, func() { t.Stop() })
```

---

## Edge cases

### Zero duration

```go
time.AfterFunc(0, fn)
```

Fires as soon as possible. The runtime treats `when = now`. There is still a goroutine spawn; for "right now in a goroutine," `go fn()` is more direct.

### Negative duration

```go
time.AfterFunc(-time.Second, fn)
```

Fires as soon as possible. The runtime treats negative as already-expired.

### Very large duration

```go
time.AfterFunc(100*365*24*time.Hour, fn)
```

Legal. The timer sits on the heap; the closure is alive. Don't do this; persist intent and reschedule on demand.

### Nil callback

```go
time.AfterFunc(d, nil)
```

The wrapper tries to call nil; panics at fire time.

### Reset with negative duration

```go
t.Reset(-time.Second)
```

Fires as soon as possible.

### t.C != nil for AfterFunc

Never. `C` is always nil for AfterFunc timers.

---

## Version history (relevant excerpts)

| Version | Change |
|---|---|
| Go 1.0 | `time.AfterFunc`, `Stop`, `Reset` released. |
| Go 1.10 | Timers use monotonic clock; wall-clock adjustments do not perturb. |
| Go 1.14 | Async preemption; callbacks can be preempted. |
| Go 1.21 | `context.AfterFunc` introduced. |
| Go 1.23 | Reset no longer requires drain dance for channel timers; internal simplification. |
| Go 1.24 | `testing/synctest` for time-deterministic tests. |

---

## Implementation references

- `runtime/time.go` — runtime side.
- `time/sleep.go` — package side.

---

## Companion functions

| Function | Purpose |
|---|---|
| `time.Sleep(d)` | Block the current goroutine for `d`. |
| `time.After(d)` | Returns `<-chan Time` that receives one value after `d`. |
| `time.NewTimer(d)` | Returns a `*Timer` whose `C` receives at expiration. |
| `time.NewTicker(d)` | Returns a `*Ticker` that fires every `d`. |
| `time.AfterFunc(d, f)` | Schedule `f` to run after `d`. |
| `context.AfterFunc(ctx, f)` | Run `f` when `ctx` cancels. |
| `context.WithTimeout(parent, d)` | Returns ctx + cancel; ctx done after `d`. |
| `context.WithDeadline(parent, t)` | Returns ctx + cancel; ctx done at time `t`. |

---

## Performance characteristics

Approximate, on a modern x86_64 CPU at GOMAXPROCS=8.

| Operation | Cost |
|---|---|
| `time.AfterFunc(d, f)` | ~600 ns + closure alloc |
| `t.Stop()` | ~200 ns |
| `t.Reset(d)` | ~250 ns |
| Heap insert at n=10K | ~120 ns |
| Heap insert at n=1M | ~350 ns |
| Goroutine spawn at fire | ~300 ns |

Memory per timer: ~150 bytes + closure size.

---

## Common usage patterns

### Pattern: timeout

```go
ctx, cancel := context.WithTimeout(ctx, d)
defer cancel()
```

Internally uses `time.AfterFunc`. The standard timeout idiom.

### Pattern: deferred cleanup

```go
stop := context.AfterFunc(ctx, cleanup)
defer stop()
```

### Pattern: delayed retry

```go
time.AfterFunc(backoff, func() { tryAgain() })
```

### Pattern: deadline race

```go
ch := make(chan result, 1)
t := time.AfterFunc(d, func() {
    ch <- result{err: ErrDeadline}
})
defer t.Stop()
go func() { ch <- doWork() }()
return <-ch
```

### Pattern: idle timer

```go
t := time.AfterFunc(idle, onIdle)
// on activity: t.Reset(idle)
```

### Pattern: watchdog

```go
t := time.AfterFunc(timeout, onTimeout)
// periodically: t.Reset(timeout)
```

### Pattern: debouncer

```go
type Debouncer struct { ... }
func (d *Debouncer) Trigger() {
    d.mu.Lock()
    defer d.mu.Unlock()
    if d.t != nil { d.t.Stop() }
    d.t = time.AfterFunc(d.delay, d.fn)
}
```

---

## Anti-patterns

| Pattern | Why it's wrong | Use instead |
|---|---|---|
| `<-t.C` for AfterFunc | C is nil | Channel of your own |
| `time.After` in a tight loop | Allocates per call | `time.NewTimer` + Reset |
| `go func() { time.Sleep(d); f() }()` | Parks a goroutine | `time.AfterFunc` |
| No panic recovery in callback | Process crash | `defer recover()` |
| Capture large request | Pins memory | Capture only ID |
| No cap on retry | Infinite | Cap retries |

---

## Glossary

| Term | Definition |
|---|---|
| `Timer` | The `time.Timer` struct. |
| `runtimeTimer` | The runtime's internal timer entry, embedded in `Timer`. |
| `C` | The channel field of `Timer`. Nil for AfterFunc. |
| `Stop` | Cancel before firing. |
| `Reset` | Reschedule. |
| Callback | The function `f` passed to AfterFunc. |
| Fire | When the runtime invokes the callback. |
| Heap | The runtime's min-heap of pending timer entries. |
| P (logical processor) | Go runtime unit; each P has its own timer heap. |
| Monotonic time | The clock used internally; only goes forward. |
| `goFunc` | The wrapper for AfterFunc that does `go f()`. |

---

## Cross-references

- `01-timers-and-tickers` — Overview of time-based primitives.
- `03-tickers` — `time.Ticker`.
- `04-context-with-deadline` — `context.WithDeadline`.
- `07-concurrency/01-goroutines` — Goroutines.
- `07-concurrency/02-channels` — Channels and `time.After`.

---

## Quick reference card

```
time.AfterFunc(d, f) *Timer    schedule f in a new goroutine after d
*Timer.Stop() bool             try to cancel; true iff prevented fire
*Timer.Reset(d) bool           reschedule; return mirrors prior state
*Timer.C                       nil for AfterFunc (do not read)

context.AfterFunc(ctx, f) stop schedule f in new goroutine on ctx cancel
stop() bool                    try to unregister; true iff prevented run

Rules
- Callback runs in a new goroutine; sync your shared state.
- Stop returning false != callback finished.
- Panics in callback crash the program; defer recover().
- Closure capture pins memory.
- Use Reset, not Stop + new AfterFunc, when callback is the same.
- For ctx-driven cleanup, prefer context.AfterFunc.
- Test with mocked clock.
```

## Appendix: detailed semantics tables

### Stop semantics (verbose)

The semantics of `Stop` depend on the timer's underlying state. Below, we use the simplified post-Go-1.23 view.

| Pre-call state | Stop result | Post-call state | Callback runs? |
|---|---|---|---|
| Active, when > now | true | Stopped | No |
| Active, when ≤ now (just expired, not yet popped) | true (race-y) | Stopped | No |
| Popped, callback not yet running | false | Fired-pending | Yes |
| Callback running | false | Fired-running | Yes (continues) |
| Callback finished | false | Fired-done | Already ran |
| Stopped (previous Stop) | false | Stopped | No (already prevented) |
| Re-armed via Reset (timer is Active again) | true | Stopped | No (this firing prevented) |

### Reset semantics (verbose)

| Pre-call state | Reset result | Post-call state | Callback runs? |
|---|---|---|---|
| Active | true | Active (new when) | Yes, at new when |
| Popped, callback not yet running | false (timer was inactive at this instant) | Active (new when) | Yes (old) + Yes (new) |
| Callback running | false | Active (new when) | Yes (continues old) + Yes (new) |
| Callback finished | false | Active (new when) | Yes (new) |
| Stopped | false | Active (new when) | Yes (new) |

The "Yes (old) + Yes (new)" cases are the ones to watch — they mean the callback may run twice. Guard with flags if you cannot tolerate this.

### context.AfterFunc stop semantics (verbose)

| Pre-call state | stop result | Callback runs? |
|---|---|---|
| Context not cancelled, registration present | true | No |
| Context cancelled, callback queued | false (race) | Yes |
| Context cancelled, callback running | false | Yes (continues) |
| Context cancelled, callback finished | false | Already ran |
| stop previously called | false | No |

---

## Appendix: A formal contract

To compile your understanding into a contract:

**`time.AfterFunc(d, f)`:**

- Pre: `d` is a valid Duration; `f` is non-nil.
- Post: returns a non-nil `*Timer`. The runtime arranges to run `f` in a new goroutine no earlier than `d` after the call (measured by monotonic clock).
- Side effects: heap allocation of `Timer` and `runtimeTimer`. Possible netpoller wake.

**`t.Stop()`:**

- Pre: `t` is non-nil.
- Post: if return is true, the timer is no longer on the heap; the callback will not be invoked as a result of this timer firing. If return is false, either the callback has been or is being invoked, or the timer was already stopped.
- Non-blocking; does not wait for the callback.

**`t.Reset(d)`:**

- Pre: `t` is non-nil; `d` is a valid Duration.
- Post: the timer is on the heap with `when = now + d`. Returns whether the timer was active before the call.
- May cause the callback to run multiple times if a fire is already in flight.

**`context.AfterFunc(ctx, f)`:**

- Pre: `ctx` is non-nil; `f` is non-nil.
- Post: returns a `stop` function. When `ctx` is done, the runtime will invoke `f` in a new goroutine, unless `stop` is called first.
- Side effects: registration on the context.

**`stop()`:**

- Post: if return is true, `f` is unregistered and will not be invoked. If false, `f` has been or is being invoked, or stop was already called.
- Non-blocking.

---

## Appendix: An interpretation of the formal contract

You can think of `AfterFunc` as defining a state machine:

```
        AfterFunc(d, f)
              |
              v
           [Active]
          /        \
   t.Stop          (when arrives)
       |              |
       v              v
   [Stopped]      [Firing]
       |              |
       | Reset(d)     | f() in new goroutine
       v              v
   [Active]       [Running]
                     |
                     | f returns
                     v
                  [Done]
                     |
                     | Reset(d)
                     v
                  [Active]
```

`Stop` is a transition from Active to Stopped. It is a no-op from any other state (return false).

`Reset` is a transition from any state to Active.

The boolean returns of `Stop` and `Reset` mirror whether the prior state was Active.

---

## Appendix: a complete usage matrix

For every combination of operations:

| First op | Second op | Result |
|---|---|---|
| AfterFunc | Stop (before fire) | Stop=true, no fire |
| AfterFunc | Stop (after fire) | Stop=false, callback ran |
| AfterFunc | Reset (before fire) | Reset=true, new fire scheduled |
| AfterFunc | Reset (after fire) | Reset=false, new fire scheduled, callback may run twice if races |
| AfterFunc | Stop, Reset | Reset re-arms; will fire at new time |
| AfterFunc | Reset, Stop | Stop=true if before new fire |
| AfterFunc | Stop, Stop | first=true (or false if raced), second=false |
| AfterFunc | Reset, Reset | each re-arms; last wins |
| AfterFunc | Stop, AfterFunc(same f) | two independent timers |
| AfterFunc | fire (natural), Stop | Stop=false, no effect |
| AfterFunc | fire (natural), Reset | re-arms; may fire again |

For `context.AfterFunc`:

| First op | Second op | Result |
|---|---|---|
| AfterFunc | stop (before cancel) | stop=true, no run |
| AfterFunc | stop (after cancel) | stop=false, callback ran |
| AfterFunc | cancel, stop | stop=false |
| AfterFunc | stop, cancel | callback does not run |
| AfterFunc | stop, stop | first=true (or false if raced), second=false |
| Already-cancelled ctx + AfterFunc | callback runs immediately | -- |

---

## Appendix: complete summary

`time.AfterFunc` schedules a callback to run in a new goroutine after a duration. It returns a `*Timer` that allows cancellation (`Stop`) and rescheduling (`Reset`). The callback's `C` channel is nil — do not read it. The callback runs on a fresh goroutine; synchronisation is the caller's responsibility. Panics in the callback are not recovered by the runtime. The callback's closure pins captured memory until the callback finishes.

`context.AfterFunc` (Go 1.21+) is the context-cancellation analog. It schedules a callback to run when the context cancels, returning a `stop` function for unregistration.

For both, `Stop`/`stop` returning `false` does **not** mean the callback has finished — it may be in flight.

End of specification.

