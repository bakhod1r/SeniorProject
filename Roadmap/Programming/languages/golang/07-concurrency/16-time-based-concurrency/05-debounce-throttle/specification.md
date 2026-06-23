---
layout: default
title: Specification
parent: Debounce and Throttle
grand_parent: Time-Based Concurrency
ancestor: Go
nav_order: 6
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/16-time-based-concurrency/05-debounce-throttle/specification/
---

# Debounce and Throttle — Specification

## Table of Contents
1. [Introduction](#introduction)
2. [Formal Definitions](#formal-definitions)
3. [Debounce — Mathematical Model](#debounce--mathematical-model)
4. [Throttle — Mathematical Model](#throttle--mathematical-model)
5. [Token-Bucket Algorithm](#token-bucket-algorithm)
6. [Leaky-Bucket Algorithm](#leaky-bucket-algorithm)
7. [`golang.org/x/time/rate` Package Surface](#golangorgxtimerate-package-surface)
8. [`rate.Limit` Type and Constructors](#ratelimit-type-and-constructors)
9. [`rate.Limiter` Type](#ratelimiter-type)
10. [`Allow`, `AllowN`](#allow-allown)
11. [`Wait`, `WaitN`](#wait-waitn)
12. [`Reserve`, `ReserveN`](#reserve-reserven)
13. [Internal State Machine](#internal-state-machine)
14. [`time.AfterFunc` and `time.Timer.Reset` Semantics](#timeafterfunc-and-timetimerreset-semantics)
15. [`time.Ticker` Semantics](#timeticker-semantics)
16. [Memory Model Implications](#memory-model-implications)
17. [Numerical Limits and Edge Cases](#numerical-limits-and-edge-cases)
18. [Standard Patterns and Their Complexity](#standard-patterns-and-their-complexity)
19. [Comparison Table — Debounce vs Throttle](#comparison-table--debounce-vs-throttle)
20. [Compatibility and Version History](#compatibility-and-version-history)
21. [References](#references)

---

## Introduction

Debounce and throttle are two operators on an event stream. Both reduce a high-frequency input to a lower-frequency output, but they do so under different rules and produce observably different sequences. This document is the reference for those rules: the formal definitions, the algorithms behind production-grade implementations (in particular the token bucket inside `golang.org/x/time/rate`), and the public APIs that Go programs reach for.

The normative sources are:

- **`pkg.go.dev/time`** — `time.Timer`, `time.Ticker`, `time.AfterFunc`, and `time.Now`.
- **`pkg.go.dev/golang.org/x/time/rate`** — the canonical token-bucket implementation in the Go ecosystem.
- **`go.dev/ref/mem`** — the memory model that governs visibility of clock reads and timer fires across goroutines.

Several behaviours of debounce and throttle are *implementation choices* rather than standardised behaviour: leading vs trailing edge, drop vs queue vs block on overflow, monotonic vs wall-clock measurement. This file calls those choices out as they arise.

---

## Formal Definitions

Let `E = (e_1, e_2, e_3, ...)` be an event stream with associated arrival timestamps `t_1 <= t_2 <= t_3 <= ...`. A *concurrency operator* transforms `E` into an output stream `O = (o_1, o_2, ...)` of fire times `f_1 < f_2 < ...`.

### Debounce

A **debouncer** with wait duration `w > 0` produces an output event at time `f_k` if and only if:

```
f_k = t_j + w
where t_j is the latest input event such that no input arrives in (t_j, t_j + w]
```

In words: a debouncer fires `w` time units after the *last* event of a quiet-period-terminated burst. If a new event arrives during the wait, the timer resets. The number of output events equals the number of *bursts*, not the number of input events.

Variants:

- **Trailing-edge debouncer (default).** Fires at `t_j + w`. The payload is the last event's value.
- **Leading-edge debouncer.** Fires at `t_j` *if* `t_j - t_{j-1} > w` (or `j = 1`). Subsequent events in the burst are ignored.
- **Leading + trailing debouncer.** Fires twice: once at burst start, once at burst end. Suppresses internal events.
- **Max-wait variant.** Forces a fire after `W >= w` time even if events keep arriving — bounds latency for an event that keeps the burst alive forever.

### Throttle

A **throttler** with rate `r` events per second and burst capacity `b` permits the output stream to satisfy:

```
For all intervals [a, b] of length L:
  |{ f_k : a <= f_k <= b }| <= r * L + b
```

That is, over any window of length `L`, the number of fired events does not exceed `r * L + b`. The constant `b` allows short bursts above the steady rate.

This is the formal property guaranteed by the **token bucket**: the bucket fills at rate `r` tokens per second, holds at most `b` tokens, and an output event requires (and consumes) one token. The leaky bucket guarantees the same envelope with a different internal mechanism.

---

## Debounce — Mathematical Model

A trailing-edge debouncer can be modelled as a finite-state machine with two states (`Idle`, `Pending`) and a timer:

```
state := Idle
timer := nil

on event(e):
    if state == Idle:
        state := Pending
        timer := after(w, fire)
    else:
        timer.Reset(w)
    pending_value := e

on timer fires:
    emit(pending_value)
    state := Idle

on cancel:
    timer.Stop()
    state := Idle
```

The wait `w` is the *idle deadline*. Reset semantics matter: `time.Timer.Reset` must follow `Stop` plus drain to be safe (see [`time.AfterFunc` and `time.Timer.Reset` Semantics](#timeafterfunc-and-timetimerreset-semantics)).

### Output rate bound

A trailing debouncer with wait `w` produces at most `1/w` events per second in the *worst case* (a burst followed by exactly `w` of silence, then another burst, etc.). It produces *zero* events if input never goes quiet for `w`. This is the latency–throughput trade-off: small `w` means fast response, large `w` means fewer fires.

### Max-wait extension

To bound latency when the input never goes quiet, a max-wait `W` is added:

```
on event(e):
    if state == Idle:
        state := Pending
        idle_deadline := now + w
        max_deadline := now + W
        timer := after(min(w, W), fire)
    else:
        idle_deadline := now + w
        timer := after(min(idle_deadline, max_deadline) - now, fire)
    pending_value := e
```

This is sometimes called a *debounce with max-wait* or simply a *throttle*-flavoured debouncer in front-end frameworks.

---

## Throttle — Mathematical Model

A throttler is parameterised by a rate `r` and a burst `b`. Several disciplines exist:

| Discipline | Behaviour on overflow |
|---|---|
| **Drop** | Reject the event. The caller learns it was rejected. |
| **Queue** | Hold the event until a slot opens. The caller waits or proceeds. |
| **Block** | Make the calling goroutine sleep until allowed. Equivalent to *Queue* with a queue of one. |
| **Sample** | Keep at most one event per slot; drop the rest. Like *Drop* but emits the latest value seen. |

The token-bucket algorithm naturally supports all four:

- `Allow()` — Drop semantics; returns `false` when no token is available.
- `Wait(ctx)` — Block semantics; sleeps until a token frees up or the context cancels.
- `Reserve()` — Queue semantics; returns a reservation describing how long to wait.

### Output rate bound (steady state)

For input `t_1, t_2, ..., t_n` arriving uniformly at rate `R > r`, a token-bucket throttler emits at rate exactly `r` (after the initial burst is consumed). The buffer length under a queue discipline grows linearly with `(R - r) * t` until something else bounds it.

### Latency

Under the *Block* discipline, the per-event latency under steady overload is `(R - r) / r * (t - t_0)`, which is unbounded over time. Always pair with a context deadline or an upper bound on queue length.

---

## Token-Bucket Algorithm

The classical token bucket has four operational rules:

1. The bucket holds at most `b` tokens.
2. Tokens are added at rate `r` per second, up to capacity `b`. (Capacity is hard.)
3. An event requires one token and removes it from the bucket.
4. If no token is available, the event is *not permitted* (drop) or *waits* until a token arrives (queue/block).

### Discrete-time formulation

Let `T(t)` denote the token count at time `t`. The dynamics are:

```
T(t + dt) = min(b, T(t) + r * dt - consumed(t, t+dt))
```

where `consumed(t, t+dt)` is the number of events fired in the interval. The `min` enforces the cap; consumption is non-negative.

### Lazy implementation (used by `rate.Limiter`)

Rather than maintaining a timer that adds tokens periodically, `rate.Limiter` computes the bucket lazily:

```
on Allow() called at time now:
    elapsed := now - last_update
    tokens := min(b, tokens + elapsed * r)
    last_update := now
    if tokens >= 1:
        tokens -= 1
        return true
    return false
```

The lazy form has two virtues: it does no work between calls, and it produces exactly the same envelope as the eager form. The cost is one `time.Now()` per call.

### Reservation form

`Reserve` produces a `Reservation` describing how long the caller must wait for one token. The mathematical idea:

```
needed := 1
shortfall := max(0, needed - tokens)
wait := shortfall / r
tokens -= needed         // can go negative
last_update := now
```

After `Reserve`, the bucket may be negative; tokens will accumulate before the next reservation can succeed. A `Cancel` on the reservation refunds the token (subject to a small adjustment for time that has passed).

### Burst envelope

A token bucket with rate `r` and burst `b` guarantees that, over any time interval `L`, no more than `r * L + b` events are emitted. The `+ b` term captures the burst capacity — at most `b` events can pile out at once.

---

## Leaky-Bucket Algorithm

The leaky bucket is the dual: events are added to a fixed-size queue at any rate, and they leak out at exactly rate `r`. The queue length is bounded by `b`.

```
on event:
    if len(queue) < b:
        queue.append(event)
    else:
        drop

every 1/r seconds:
    if len(queue) > 0:
        emit(queue.pop_front())
```

Output is *smooth* (every `1/r` seconds, exactly), whereas the token bucket allows bursts up to `b` at once. The two algorithms have the same long-run rate bound but different short-window behaviour. Most rate limiters in Go use the token bucket because callers prefer to fire `b` events back-to-back when capacity is available.

---

## `golang.org/x/time/rate` Package Surface

The package is part of the `golang.org/x/time` extension repository, maintained by the Go team. Imported as:

```go
import "golang.org/x/time/rate"
```

The public surface as of the current release:

```go
type Limit float64
const Inf Limit = math.MaxFloat64
func Every(interval time.Duration) Limit
func (l Limit) String() string

type Limiter struct { /* unexported */ }
func NewLimiter(r Limit, b int) *Limiter

func (lim *Limiter) Limit() Limit
func (lim *Limiter) Burst() int
func (lim *Limiter) Tokens() float64
func (lim *Limiter) TokensAt(t time.Time) float64

func (lim *Limiter) SetLimit(newLimit Limit)
func (lim *Limiter) SetLimitAt(t time.Time, newLimit Limit)
func (lim *Limiter) SetBurst(newBurst int)
func (lim *Limiter) SetBurstAt(t time.Time, newBurst int)

func (lim *Limiter) Allow() bool
func (lim *Limiter) AllowN(t time.Time, n int) bool

func (lim *Limiter) Wait(ctx context.Context) error
func (lim *Limiter) WaitN(ctx context.Context, n int) error

func (lim *Limiter) Reserve() *Reservation
func (lim *Limiter) ReserveN(t time.Time, n int) *Reservation

type Reservation struct { /* unexported */ }
func (r *Reservation) OK() bool
func (r *Reservation) Delay() time.Duration
func (r *Reservation) DelayFrom(t time.Time) time.Duration
func (r *Reservation) Cancel()
func (r *Reservation) CancelAt(t time.Time)

type Sometimes struct {
    First    int
    Every    int
    Interval time.Duration
    // unexported fields
}
func (s *Sometimes) Do(f func())
```

All `Limiter` methods are safe for concurrent use. Locks are held only for the duration of a token-count update — never across a `time.Now` call to user code.

---

## `rate.Limit` Type and Constructors

`rate.Limit` is a `float64` measured in **events per second**. The package's documentation:

> Limit defines the maximum frequency of some events. Limit is represented as number of events per second. A zero Limit allows no events.

### Special values

- `rate.Inf` — effectively infinite rate. The limiter never blocks; every `Allow` returns `true`. Useful as a "rate limiting disabled" sentinel.
- `0` (literal zero) — allows zero events per second. Every `Allow` returns `false`. Useful for "currently paused".

### `Every(d time.Duration) Limit`

> Every converts a minimum time interval between events to a Limit.

```go
rate.Every(100 * time.Millisecond) // 10 events/second
rate.Every(1 * time.Second)        // 1 event/second
rate.Every(0)                      // rate.Inf
```

Internally `Every(d) = 1 / d.Seconds()` for `d > 0`. Negative `d` panics in the package's caller (use a positive duration).

### Choosing units

The rate is *events per second*, not per minute or per hour. Two events per minute is `rate.Every(30 * time.Second)` or equivalently `rate.Limit(1.0 / 30.0)`. Keep the units in the type by preferring `Every` over the float literal where the source value is a duration.

---

## `rate.Limiter` Type

`rate.Limiter` is the canonical token bucket. The constructor:

```go
func NewLimiter(r Limit, b int) *Limiter
```

> NewLimiter returns a new Limiter that allows events up to rate r and permits bursts of at most b tokens.

### Invariants

- `r` is a `Limit` (events/second); negative is allowed but pathological.
- `b >= 0`. A burst of zero with `r > 0` means tokens are added but the cap is zero, so no token is ever *held* — `Allow` will almost always return `false` (the limiter could only allow at the precise instant a token is added, then the cap clips it to zero). Avoid `b = 0`.
- The limiter starts *full* — `b` tokens already in the bucket. This is sometimes surprising; the first `b` calls succeed regardless of rate.

### Reading state

```go
lim.Limit() Limit      // current rate
lim.Burst() int        // current capacity
lim.Tokens() float64   // current token count (estimate at time.Now)
```

`Tokens()` is an *estimate* — the value is computed lazily, so a concurrent caller may observe a slightly different reading. The number is for diagnostics; do not branch on it for correctness.

### Mutating state

```go
lim.SetLimit(newLimit Limit)
lim.SetBurst(newBurst int)
```

Both are safe under concurrent use and take effect *as if* the change had occurred at `time.Now`. The `*At` variants let tests inject a specific instant.

---

## `Allow`, `AllowN`

```go
func (lim *Limiter) Allow() bool
func (lim *Limiter) AllowN(t time.Time, n int) bool
```

> Allow reports whether an event may happen now.
> AllowN reports whether n events may happen at time t.

Behaviour:

- Returns `true` and consumes the tokens if `n` tokens are available.
- Returns `false` and consumes nothing if fewer than `n` tokens are available.
- Never blocks. Always returns immediately.

This is the *drop* discipline. Typical usage:

```go
if !lim.Allow() {
    http.Error(w, "rate limited", http.StatusTooManyRequests)
    return
}
process()
```

`AllowN` is for events that "weigh" more than one — for example, a write of `n` bytes counted against a bytes-per-second limit.

### Edge cases

- `AllowN(t, 0)` returns `true` and does nothing.
- `AllowN(t, n)` where `n > burst` returns `false` regardless of token state (the bucket cannot hold `n` tokens, so the request can never be satisfied — the package fails fast).
- `t` in the past returns `false`. The package's source has a check: if `t.Before(lim.last)`, the call is treated as `t == lim.last`. (This avoids time travel under monotonic-clock anomalies.)

---

## `Wait`, `WaitN`

```go
func (lim *Limiter) Wait(ctx context.Context) error
func (lim *Limiter) WaitN(ctx context.Context, n int) error
```

> Wait is shorthand for WaitN(ctx, 1).
> WaitN blocks until lim permits n events to happen. It returns an error if n exceeds the Limiter's burst size, the Context is canceled, or the expected wait time exceeds the Context's Deadline.

Behaviour:

- Computes the time at which `n` tokens will be available, sleeps that long, and returns `nil`.
- If `ctx` is cancelled before the wait completes, the reservation is cancelled (tokens refunded) and the function returns `ctx.Err()`.
- If `n > burst`, returns an error immediately (`"rate: Wait(n=%d) exceeds limiter's burst %d"`).
- If the wait would exceed `ctx.Deadline()`, returns an error immediately without sleeping.

The block discipline. Typical usage:

```go
ctx, cancel := context.WithTimeout(parent, 5*time.Second)
defer cancel()
if err := lim.Wait(ctx); err != nil {
    return err
}
process()
```

### Why the deadline check matters

Without it, a caller with a 100-ms deadline might enter `Wait` for two seconds, consume a token, sleep, only to have the deadline fire. The token would still be consumed — wasted. The package's preflight saves both the caller and other goroutines from that waste.

---

## `Reserve`, `ReserveN`

```go
func (lim *Limiter) Reserve() *Reservation
func (lim *Limiter) ReserveN(t time.Time, n int) *Reservation
```

> Reserve is shorthand for ReserveN(time.Now(), 1).
> ReserveN returns a Reservation that indicates how long the caller must wait before n events happen. The Limiter takes this Reservation into account when allowing future events.

A `Reservation` carries:

- `r.OK()` — `true` if the reservation can be honoured (i.e., `n <= burst`).
- `r.Delay()` — duration the caller should wait before acting.
- `r.Cancel()` — release the reservation, refunding tokens (subject to time elapsed).

Typical pattern:

```go
r := lim.Reserve()
if !r.OK() {
    return errors.New("limiter cannot satisfy")
}
time.Sleep(r.Delay())
process()
```

Or, more usefully, integrate with a `select`:

```go
r := lim.Reserve()
if !r.OK() {
    return errors.New("limiter cannot satisfy")
}
select {
case <-time.After(r.Delay()):
    process()
case <-ctx.Done():
    r.Cancel()
    return ctx.Err()
}
```

### Why `Reserve` exists

`Allow` cannot wait, and `Wait` cannot integrate cleanly with other channels (it hides the sleep). `Reserve` exposes the delay so the caller can use a `select` to drop, queue, or block by choice.

### Reservation cancellation semantics

When you call `r.Cancel()` *before* the reservation's deadline:

```
tokens += n  // refund
// minus any tokens that would have accumulated during the elapsed time
// (the bucket goes back to where it would have been had we never reserved)
```

After the deadline, `Cancel` is a no-op — the reservation is considered consumed.

This makes `Reserve` cancellation-safe under context termination: cancel-and-refund correctly accounts for time that elapsed.

---

## Internal State Machine

`rate.Limiter` internally stores:

```go
type Limiter struct {
    mu     sync.Mutex
    limit  Limit       // current rate
    burst  int         // current capacity
    tokens float64     // current token count (lazy)
    last   time.Time   // last time tokens was updated
    lastEvent time.Time // last time an event was reserved or allowed
}
```

The lazy update on every method call:

```go
func (lim *Limiter) advance(t time.Time) (newT time.Time, newTokens float64) {
    last := lim.last
    if t.Before(last) {
        last = t
    }
    elapsed := t.Sub(last)
    delta := lim.limit.tokensFromDuration(elapsed)
    tokens := lim.tokens + delta
    if burst := float64(lim.burst); tokens > burst {
        tokens = burst
    }
    return t, tokens
}
```

Two important properties:

1. **Monotonic clamp.** If `t` is in the past relative to `last`, the call is clamped to `last`. This prevents the bucket from "going back in time" if a caller passes an old timestamp.
2. **Burst clamp.** Tokens never exceed `burst`. Long idle periods do not grow the bucket beyond `b`.

The bucket can go *below zero* during reservations — that represents a deferred consumption. `Allow` and `Wait` never leave tokens negative; only `Reserve` does, and the deficit is paid down at rate `r`.

---

## `time.AfterFunc` and `time.Timer.Reset` Semantics

A debouncer's most-used primitive is `time.AfterFunc`. The documentation:

> AfterFunc waits for the duration to elapse and then calls f in its own goroutine. It returns a Timer that can be used to cancel the call using its Stop method.
> Reset changes the timer to expire after duration d. It returns true if the timer had been active, false if the timer had expired or been stopped.

### Pre-Go 1.23: drain-then-reset

Before Go 1.23, the only safe `Reset` pattern was:

```go
if !timer.Stop() {
    <-timer.C   // drain
}
timer.Reset(d)
```

The drain is mandatory because `Stop` returning `false` could mean the timer either fired (channel has a value) or was already stopped (channel is empty). For `AfterFunc` timers (which have no `C` channel), the drain step is omitted.

### Go 1.23+: simpler Reset

Go 1.23 changed `time.Timer` so that calling `Stop` or `Reset` *guarantees* the channel is drained. The new safe pattern:

```go
timer.Stop()       // returns whether timer was active
timer.Reset(d)     // safe regardless
```

The old code remains correct; the new code is simpler.

### Concurrent fires

`AfterFunc` invokes `f` in its own goroutine. Concurrent calls to `Stop`/`Reset` and the fire are race-free at the `time` package level — but `f` itself runs concurrently with the caller. A debouncer must serialise its state under a mutex if `f` touches it.

---

## `time.Ticker` Semantics

```go
type Ticker struct {
    C <-chan Time
    // contains filtered or unexported fields
}

func NewTicker(d Duration) *Ticker
func (t *Ticker) Stop()
func (t *Ticker) Reset(d Duration)
```

Behaviour:

- `C` receives the current time at every tick. Capacity is 1.
- If the receiver is slow, ticks are *dropped*, not buffered. The channel never holds more than one tick.
- `Stop` does not close `C`. After `Stop`, no further ticks arrive, but any tick already in the channel remains.
- `Reset` changes the tick period without restarting the ticker.

Implications for throttle:

- `for range tick.C { ... }` is the simplest throttle, but loop bodies that take longer than `d` will skip ticks. The throttle becomes "no more often than `d`", not "exactly every `d`".
- `time.Ticker` with `d` close to the timer resolution (millisecond or less on most OSes) is inaccurate. For sub-millisecond rates, use `time.Now()`-driven loops instead.

### Comparison to `time.After`

`time.After(d)` allocates a new `Timer` each call. Inside a loop, this leaks until expiry. `time.NewTicker` allocates once and is reused. Always prefer `Ticker` for repeated waits.

---

## Memory Model Implications

From `go.dev/ref/mem`:

> The completion of any read of a variable v happens before the completion of any subsequent read or write of v in the same goroutine.

Cross-goroutine, the relevant rules for debounce and throttle:

1. **Timer fire happens-after Reset/Stop.** A timer that fires synchronises with the goroutine that started it, but *only* through the channel send. A subsequent `Reset` in another goroutine has no happens-before relationship with the timer's `f` unless an explicit synchronisation (mutex, channel) bridges them.
2. **`time.Now()` is not a synchronisation primitive.** Two goroutines reading `time.Now()` may see non-monotonic values relative to each other, even on systems where each goroutine sees a monotonic clock individually. Always use a real synchronisation primitive when ordering matters.
3. **`rate.Limiter` is safe for concurrent use.** Its internal mutex establishes happens-before between callers.

A debouncer that fires `f` from `AfterFunc` and is `Reset` from a different goroutine must hold a mutex over its state. The mutex provides both correctness (state stays consistent) and visibility (changes are seen).

---

## Numerical Limits and Edge Cases

| Quantity | Limit | Notes |
|---|---|---|
| `rate.Limit` representable rate | `[0, math.MaxFloat64]` | `rate.Inf` is `MaxFloat64`. |
| `rate.Limiter.burst` | `[0, math.MaxInt]` | Effectively unbounded. `0` is degenerate. |
| `time.Duration` resolution | 1 ns | But OS timer resolution is ~1 ms on most platforms. |
| Token count | `[-inf, burst]` | Can be negative under outstanding reservations. |
| `time.Now()` resolution | Per OS | Linux: ~1 ns (CLOCK_MONOTONIC). macOS: ~1 us. Windows: ~16 ms unless overridden. |

### Subtleties

- **Negative `Limit`.** Permitted by the type but pathological. The bucket fills at a negative rate, meaning tokens are *consumed* over time. Avoid.
- **`Inf` vs huge finite rate.** With `rate.Inf`, the package short-circuits — every `Allow` returns `true` without touching the token count. A very large finite `Limit` (`1e9`) still computes tokens but they cap at `burst` instantly. Use `Inf` for "no limit".
- **Wallclock vs monotonic.** Since Go 1.9, `time.Now()` carries both readings. `rate.Limiter` uses monotonic clock subtraction internally, so adjustments to the wallclock (NTP step, manual change) do not break the limiter.

---

## Standard Patterns and Their Complexity

| Pattern | Allocation per event | Complexity | Goroutines |
|---|---|---|---|
| `lim.Allow()` (drop) | 0 | O(1) | 0 |
| `lim.Wait(ctx)` (block) | 1 timer + 1 channel | O(1) | 0 (sleeps in place) |
| `lim.Reserve()` (queue) | 1 reservation | O(1) | 0 |
| Trailing debouncer with `AfterFunc` | 1 timer per burst | O(1) per event under mutex | 0 (fire reuses runtime goroutine) |
| Trailing debouncer with goroutine | 1 goroutine per debouncer | O(1) per event | 1 |
| Naive `time.After`-based throttle in loop | 1 timer per iteration | O(1) per event | 0 |
| `time.NewTicker`-based throttle in loop | 1 ticker amortised | O(1) per event | 0 |
| Per-actor throttle (map of limiters) | 1 limiter per actor | O(log N) lookup or O(1) hash | 0 |

`rate.Limiter` is allocation-free under `Allow`/`AllowN`. `Wait` allocates only if it needs to sleep. `Reserve` allocates a `Reservation` struct (16 bytes on most platforms).

---

## Comparison Table — Debounce vs Throttle

| Property | Debounce | Throttle |
|---|---|---|
| Question it answers | "Has the input stopped?" | "Am I emitting too fast?" |
| Output rate (worst case) | At most `1/w` events/second | At most `r * L + b` over any `L` |
| Output rate (no input) | 0 | 0 |
| Output rate (constant input) | Possibly 0 (never silent) | Exactly `r` (steady state) |
| Latency from event to fire | Up to `w` | 0 (drop), `1/r` typical (queue) |
| Best-suited input | Bursty (search keystrokes, resize) | Uniform high-rate (API calls, logs) |
| Primitive | `time.AfterFunc` + Reset | `time.Ticker` or `rate.Limiter` |
| Output payload | The *last* event of the burst | Each *permitted* event |
| Number of output events | One per burst | One per token consumed |
| State | Pending timer | Bucket (tokens, last update) |

---

## Compatibility and Version History

| Component | Version | Change |
|---|---|---|
| `time.Timer.Reset` | Go 1.0 | Introduced. |
| `time.AfterFunc` | Go 1.0 | Introduced. |
| `time.Now` monotonic component | Go 1.9 | Wall-clock and monotonic readings combined. |
| `golang.org/x/time/rate` | Initial commit 2015 | Token-bucket limiter. |
| `rate.Limiter.SetBurst` | Added later (2017) | Pair with `SetLimit` for dynamic adjustment. |
| `rate.Limiter.TokensAt` | Added later (2019) | Diagnostic without time travel. |
| `rate.Sometimes` | Added 2022 | Conditional throttled call. |
| `time.Timer` channel drain on Stop | Go 1.23 | Reset becomes simpler; older code still safe. |
| Garbage-collectable unreferenced timers | Go 1.23 | A `*Timer` that goes out of scope no longer pins runtime memory. |

The Go 1 compatibility promise covers `time`. The `golang.org/x/time/rate` package is *not* part of the standard library and is governed by the `golang.org/x` looser compatibility rules — but in practice the API has been stable since 2015.

---

## References

- **`time` package** — <https://pkg.go.dev/time>
- **`time.Timer.Reset` semantics** — <https://pkg.go.dev/time#Timer.Reset>
- **`time.Ticker`** — <https://pkg.go.dev/time#Ticker>
- **`golang.org/x/time/rate` package** — <https://pkg.go.dev/golang.org/x/time/rate>
- **`rate.Limiter`** — <https://pkg.go.dev/golang.org/x/time/rate#Limiter>
- **`rate.Sometimes`** — <https://pkg.go.dev/golang.org/x/time/rate#Sometimes>
- **The Go Memory Model** — <https://go.dev/ref/mem>
- **Go 1.23 release notes — `time` package** — <https://go.dev/doc/go1.23#timereleasetime>
- **Token-bucket algorithm (Wikipedia)** — <https://en.wikipedia.org/wiki/Token_bucket>
- **Leaky-bucket algorithm (Wikipedia)** — <https://en.wikipedia.org/wiki/Leaky_bucket>
- **RFC 2698 — Two Rate Three Color Marker** (related rate-limiting algorithm) — <https://datatracker.ietf.org/doc/html/rfc2698>
- **John Graham-Cumming — How to throttle a Go function** (Cloudflare engineering blog) — <https://blog.cloudflare.com/>
- **Bryan Boreham — Rate limiting with Go** (Weaveworks) — <https://www.weave.works/blog/>
- **Source: `golang.org/x/time/rate/rate.go`** — <https://cs.opensource.google/go/x/time/+/master:rate/rate.go>
