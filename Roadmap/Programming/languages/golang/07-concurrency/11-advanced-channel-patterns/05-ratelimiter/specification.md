# Rate Limiter — Specification

## Table of Contents
1. [Scope](#scope)
2. [Terminology](#terminology)
3. [Behavioural Contracts](#behavioural-contracts)
4. [Standard Library APIs](#standard-library-apis)
5. [Algorithm Definitions](#algorithm-definitions)
6. [Concurrency and Memory Model](#concurrency-and-memory-model)
7. [Error Contracts](#error-contracts)
8. [Compatibility Notes](#compatibility-notes)

---

## Scope

This file documents the formal contracts of the Go rate-limiting tools used throughout the `05-ratelimiter` subsection:

- `golang.org/x/time/rate` (the standard token-bucket implementation).
- `time.Ticker` and `time.Tick` (the primitives used in channel-based limiters).
- The four canonical algorithms (token bucket, leaky bucket, fixed window, sliding window) defined precisely.
- The contract a "rate limiter" type in Go is expected to satisfy.

Where the Go standard library's documentation is normative, this file paraphrases for context and notes corner cases.

---

## Terminology

| Term | Definition |
|------|-----------|
| **Rate `r`** | Target frequency of admissions per unit time. Type `rate.Limit` (a `float64`). Units: events per second. |
| **Burst `b`** | Maximum number of admissions allowed back-to-back without enforced pacing. Type `int`, must be ≥ 0. |
| **Token** | A unit of admission permission. One token = one admitted operation. |
| **Bucket** | The pool that holds tokens. Capacity = `burst`. Refills at rate `r` up to capacity. |
| **TAT** | Theoretical arrival time, used by GCRA. The instant the next admission *would* occur if rate were perfectly enforced. |
| **Limit unlimited** | `rate.Inf`, the sentinel for "no rate cap". Bucket always full. |
| **Limit zero** | `rate.Limit(0)`, the sentinel for "never admit anything except from initial burst". The bucket never refills. |
| **Reservation** | A delayed admission booked via `Reserve()`. Consumes a token at the time of reservation; can be cancelled if not yet "acted on". |
| **Window** | A time interval over which a fixed-window or sliding-window limiter counts admissions. |

---

## Behavioural Contracts

### Single-instance contract

For a limiter `L` configured with rate `r` and burst `b`:

1. **Long-run rate:** Over any time window `[t1, t2]` with `t2 - t1 >> 1/r`, the number of admissions `n` satisfies `n ≤ r × (t2 - t1) + b`.
2. **Burst:** Starting from a bucket at capacity, the next `b` calls to `Allow()` (within `< 1/r` of each other) all return `true`.
3. **Steady state:** If callers consume at rate ≥ `r`, the admission rate converges to exactly `r`.
4. **Idleness:** If no calls occur for `Δt` seconds with `Δt > b/r`, the next `b` calls return `true` regardless of `Δt`. The bucket caps at `b`.

### Concurrency contract

For all standard implementations (`rate.Limiter`, channel-based limiters described in junior/middle):

- All public methods are safe for concurrent use.
- No `sync.Mutex` is exposed; callers may not assume any particular locking discipline.
- Calls from multiple goroutines respect total rate `r` and burst `b` (i.e., aggregating across goroutines).

### Wait contract

`L.Wait(ctx)` returns:

- `nil` once a token has been consumed.
- `ctx.Err()` if the context fires before a token is available.
- A non-nil error if the configured request weight exceeds burst (cannot ever be satisfied).

`Wait` does not return early after partial waiting; it either returns `nil` after the full delay or returns the error.

### Reservation contract

`L.Reserve()` returns `*Reservation` with:

- `OK() bool` — `false` if the reservation cannot be satisfied (weight > burst).
- `Delay() time.Duration` — the time the caller should wait before acting.
- `Cancel()` — refunds the token if called before the reservation's effective time.
- `CancelAt(t time.Time)` — refunds based on a specific reference time.

After `Cancel`, the token is returned to the bucket *if and only if* the action was not yet "consumed" — i.e., if `Cancel` is called before the reservation's effective time minus a small grace.

---

## Standard Library APIs

### `golang.org/x/time/rate`

```go
type Limit float64

const Inf Limit = math.MaxFloat64

func Every(interval time.Duration) Limit
// rate.Every(d) = 1 / d.Seconds(). Inverse construction of a Limit.

type Limiter struct{ /* unexported */ }

func NewLimiter(r Limit, b int) *Limiter
// Allocates and returns a new Limiter. Panics if b < 0.
// r may be 0, positive, or Inf.

func (lim *Limiter) Allow() bool
// Shorthand for AllowN(time.Now(), 1).

func (lim *Limiter) AllowN(now time.Time, n int) bool
// Reports whether n events may happen at time now.
// Does not block. If true, consumes n tokens.

func (lim *Limiter) Wait(ctx context.Context) error
// Shorthand for WaitN(ctx, 1).

func (lim *Limiter) WaitN(ctx context.Context, n int) error
// Blocks until n tokens are available or ctx is done.
// Returns an error if n > burst.

func (lim *Limiter) Reserve() *Reservation
// Shorthand for ReserveN(time.Now(), 1).

func (lim *Limiter) ReserveN(now time.Time, n int) *Reservation
// Returns a Reservation. Always reserves the tokens; caller decides
// whether to wait or to cancel.

func (lim *Limiter) Limit() Limit
// Returns the configured rate.

func (lim *Limiter) Burst() int
// Returns the configured burst.

func (lim *Limiter) SetLimit(newLimit Limit)
func (lim *Limiter) SetBurst(newBurst int)
// Atomic reconfiguration. New value applies to subsequent calls.

func (lim *Limiter) Tokens() float64
// Returns the current token count. Useful for diagnostics, not control.

type Reservation struct{ /* unexported */ }

func (r *Reservation) OK() bool
// True if the reservation will be satisfied.

func (r *Reservation) Delay() time.Duration
func (r *Reservation) DelayFrom(now time.Time) time.Duration
// Time to wait before acting on the reservation.

func (r *Reservation) Cancel()
func (r *Reservation) CancelAt(now time.Time)
// Refund tokens to the bucket if not yet acted on.
```

### `time` package

```go
type Ticker struct {
    C <-chan Time
    /* unexported fields */
}

func NewTicker(d Duration) *Ticker
// Returns a new Ticker firing every d. Caller MUST call Stop()
// to release resources.
// Panics if d <= 0.

func (t *Ticker) Stop()
// Stops the ticker. After Stop, no more ticks are sent on C.
// The channel is NOT closed (this is intentional).

func (t *Ticker) Reset(d Duration)
// Stops a ticker and resets its period to d. Added in Go 1.15.

func Tick(d Duration) <-chan Time
// Convenience wrapper around NewTicker. Underlying Ticker
// CANNOT be stopped or garbage-collected.
// Use only when the ticker lives for the program's lifetime.
```

---

## Algorithm Definitions

### Token bucket

State: `(tokens float64, last time.Time)`.

Refill on each access:
```
elapsed = now - last
tokens  = min(burst, tokens + elapsed * rate)
last    = now
```

Admission: `tokens >= 1` allows; consume one token.

Long-run rate: exactly `rate`. Short-run peak: up to `burst` consecutively.

### Leaky bucket (queue form)

State: a FIFO queue of pending requests, capacity `burst`. A "leak" process drains at rate `r`.

Admission:
- If queue length < burst: enqueue (admit when leak reaches it).
- If queue length == burst: reject.

Latency: variable, up to `burst / r`.
Output rate: exactly `r`, regardless of input pattern.

### Fixed window

State: `(count int, windowStart time.Time)`, window duration `w`.

On admission attempt at time `now`:
```
if now - windowStart >= w {
    windowStart = now (or now.Truncate(w))
    count = 0
}
if count >= limit { reject }
count++; admit
```

Boundary problem: up to `2 × limit` admissions possible in a span of `w` straddling a boundary.

### Sliding-window log

State: a list of admission timestamps within the last `w` time units.

On admission attempt at time `now`:
```
drop timestamps older than now - w
if len(list) >= limit { reject }
list.append(now); admit
```

Exact, but O(limit) memory and O(log limit) per access.

### Sliding-window counter

State: `(prevCount int, currCount int, currStart time.Time)`, window `w`.

On admission attempt at time `now`:
```
elapsed = now - currStart
if elapsed >= w {
    prevCount = (elapsed >= 2*w) ? 0 : currCount
    currCount = 0
    currStart = now.Truncate(w)
    elapsed = now - currStart
}
weight = (w - elapsed) / w
estimate = prevCount * weight + currCount
if estimate >= limit { reject }
currCount++; admit
```

Approximation error bounded by within-window variance; typically < 1%.

### GCRA

State: `(tat time.Time)`, emission interval `T = 1/r`, tolerance `τ = b × T`.

On admission attempt at time `now`:
```
if tat < now { tat = now }
if tat - now > τ { reject }
tat = tat + T; admit
```

Dual of leaky bucket. One field. No boundary problem.

---

## Concurrency and Memory Model

### `rate.Limiter`

- All methods take an internal `sync.Mutex`. Concurrent calls are serialised on this mutex.
- `Tokens()` reads state under the lock; the value is a snapshot.
- `SetLimit` and `SetBurst` take the lock and update atomically. Subsequent calls observe the new values.
- The struct contains no atomics outside the mutex; do not access fields via reflection.

### `time.Ticker`

- The channel `C` is buffered with capacity 1. If a tick is delivered while the previous tick is still buffered, the new tick is dropped silently.
- `Stop` is safe to call multiple times.
- Reading from `C` after `Stop` may receive a tick that was already enqueued, then blocks forever.

### Channel-based limiters

- Channel ops are atomic; concurrent senders/receivers are safe.
- The refill goroutine and the consumer goroutines coordinate purely via the channel.
- Closing the limiter requires closing a `quit` channel and joining the refiller; or, simpler, leaking it on program shutdown.

---

## Error Contracts

### `rate.Limiter.Wait`

Returns:
- `nil` on success.
- `ctx.Err()` if context is done first.
- An error containing `"rate: Wait(n=N) exceeds limiter's burst B"` if `n > burst`.

### `rate.Limiter.WaitN`

Same as `Wait` with the additional constraint that `n > burst` always errors immediately.

### `rate.Limiter.Reserve`

Never returns nil. May return a reservation with `OK() == false` if `n > burst`. Always check `OK()`.

### `time.NewTicker`

Panics on `d <= 0`. Otherwise infallible.

### `time.Tick`

Returns `nil` if `d <= 0`. (Does not panic — different from `NewTicker`.) Caller must guard against `nil` channel.

---

## Compatibility Notes

- **`golang.org/x/time/rate`** is part of the `golang.org/x/...` namespace — versioned independently of the standard library. Breaking changes are rare but possible. Pin via `go.mod`.
- **`time.NewTicker.Reset`** was added in Go 1.15. Older code re-creates the ticker.
- **`testing/synctest`** is experimental in Go 1.24, stabilised target Go 1.25+. Tests using it must use the appropriate build tag.
- **`rate.Limit` is a `float64`.** Fractional rates are valid (`rate.Limit(0.5)` = once per 2 s). Negative rates panic in `NewLimiter`.
- **GCRA-based libraries** (`redis_rate`, `mennanov/limiters`) use their own state shapes and are not interchangeable with `rate.Limiter` byte-for-byte. Migrating between them requires re-seeding state.

---

This specification is the authoritative reference for the contracts assumed by all other files in this section. Implementations may vary in performance, observability, and ergonomics — but they must respect these contracts to interoperate.
