---
layout: default
title: Specification
parent: Exponential Backoff
grand_parent: Time-Based Concurrency
ancestor: Go
nav_order: 6
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/16-time-based-concurrency/04-exponential-backoff/specification/
---

# Exponential Backoff — Specification

## Table of Contents
1. [Overview](#overview)
2. [Notation](#notation)
3. [Schedule Formulas](#schedule-formulas)
4. [Jitter Variants](#jitter-variants)
5. [Cap and Limit Semantics](#cap-and-limit-semantics)
6. [Context Integration](#context-integration)
7. [Library API Reference](#library-api-reference)
8. [Standard-Library Primitives](#standard-library-primitives)
9. [Random Source Selection](#random-source-selection)
10. [Timer Semantics](#timer-semantics)
11. [Error Classification](#error-classification)
12. [Retry-After Header](#retry-after-header)
13. [gRPC Service Config Schema](#grpc-service-config-schema)
14. [HTTP Status Code Retryability Table](#http-status-code-retryability-table)
15. [Defaults Reference](#defaults-reference)
16. [Glossary](#glossary)

---

## Overview

This file is a reference for the precise formulas, APIs, and protocol details related to exponential backoff in Go. It is not a tutorial; it is a lookup table. Use it when you need a specific formula or API signature.

## Notation

Throughout this document:

- `n` — attempt number (0-indexed unless noted).
- `B` — base delay.
- `C` — max-delay cap.
- `M` — max-attempts cap.
- `T` — total-elapsed-time cap (deadline).
- `U[a, b]` — uniform random distribution on `[a, b]`.
- `delay(n)` — the wait before the (n+1)-th attempt.
- `prev` — the delay used in the previous retry (for decorrelated jitter).

## Schedule Formulas

### Exponential (no jitter)

```
delay(n) = min(C, B * 2^n)
```

For factor F:
```
delay(n) = min(C, B * F^n)
```

### Total elapsed (sum of delays from attempt 0 through k-1)

```
total(k) = B * (2^k - 1)   when uncapped
```

### Truncated exponential (capped)

```
delay(n) = min(C, B * 2^n)
```

After attempt `log2(C/B)`, the delay plateaus at `C`.

## Jitter Variants

### Full Jitter

```
delay(n) = U[0, min(C, B * 2^n)]
```

Expected value: `min(C, B * 2^n) / 2`.

Implementation in Go:

```go
cap := B * time.Duration(1<<n)
if cap > C || cap < 0 { cap = C }
delay := time.Duration(rand.Int63n(int64(cap)))
```

### Equal Jitter

```
temp = min(C, B * 2^n)
delay(n) = temp/2 + U[0, temp/2]
```

Equivalent: `delay = U[temp/2, temp]`.

Expected value: `3 * temp / 4`.

```go
cap := B * time.Duration(1<<n)
if cap > C || cap < 0 { cap = C }
half := cap / 2
delay := half + time.Duration(rand.Int63n(int64(half)))
```

### Decorrelated Jitter

```
delay(n) = min(C, U[B, 3 * prev])
prev(0) = B
```

Implementation requires stateful tracking of `prev`.

```go
upper := prev * 3
if upper > C || upper < 0 { upper = C }
span := upper - B
delay := B + time.Duration(rand.Int63n(int64(span)))
prev = delay
```

### Symmetric Randomisation (cenkalti style)

```
delay(n) = U[interval(n) * (1 - r), interval(n) * (1 + r)]
```

Where `r` is the randomisation factor (default 0.5) and `interval(n) = B * F^n`.

For `r = 0.5`: delay is in `[0.5 * interval, 1.5 * interval]`.

## Cap and Limit Semantics

### Max-delay cap (C)

The maximum value any single delay can take. Applied *after* the exponential calculation, *before* jitter (in our formulas):

```
cap_for_attempt = min(C, B * 2^n)
delay = jitter(cap_for_attempt)
```

### Max-attempts cap (M)

The maximum number of total attempts (including the first). After `M-1` failed retries, the operation gives up.

```
total_attempts = first_attempt + retries
total_attempts <= M
```

### Max-elapsed-time cap (T)

The maximum cumulative wall-clock time. After `T`, even with retries remaining, the operation gives up.

```
elapsed(now) <= T
```

In `cenkalti/backoff`, this is `MaxElapsedTime`. Default 15 minutes.

### Context deadline

The absolute deadline carried in `context.Context`. Overrides all other caps; if context is cancelled or deadline exceeded, the operation gives up immediately.

## Context Integration

### Cancellation check

Before each attempt and during sleep, check:

```go
if err := ctx.Err(); err != nil {
    return err
}
```

### Deadline check

Before sleeping, optionally check:

```go
deadline, ok := ctx.Deadline()
if ok && time.Until(deadline) < requestedSleep {
    requestedSleep = time.Until(deadline)
}
```

### Cancellable sleep

```go
func sleepCtx(ctx context.Context, d time.Duration) error {
    if d <= 0 {
        return nil
    }
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

## Library API Reference

### `cenkalti/backoff/v4`

```go
type Operation func() error
type Notify func(error, time.Duration)

func Retry(o Operation, b BackOff) error
func RetryNotify(o Operation, b BackOff, n Notify) error
func RetryNotifyWithTimer(o Operation, b BackOff, n Notify, t Timer) error

type BackOff interface {
    NextBackOff() time.Duration
    Reset()
}

const Stop time.Duration = -1

type ExponentialBackOff struct {
    InitialInterval     time.Duration  // default 500ms
    RandomizationFactor float64        // default 0.5
    Multiplier          float64        // default 1.5
    MaxInterval         time.Duration  // default 60s
    MaxElapsedTime      time.Duration  // default 15min
    Stop                time.Duration  // default Stop
    Clock               Clock
}

func NewExponentialBackOff(opts ...ExponentialBackOffOpts) *ExponentialBackOff
func WithMaxRetries(b BackOff, max uint64) BackOff
func WithContext(b BackOff, ctx context.Context) BackOffContext
func Permanent(err error) error
```

### `hashicorp/go-retryablehttp`

```go
type Client struct {
    HTTPClient   *http.Client
    Logger       Logger
    RetryWaitMin time.Duration  // default 1s
    RetryWaitMax time.Duration  // default 30s
    RetryMax     int             // default 4
    RequestLogHook  RequestLogHook
    ResponseLogHook ResponseLogHook
    CheckRetry      CheckRetry
    Backoff         Backoff
    ErrorHandler    ErrorHandler
}

func NewClient() *Client
func (c *Client) Get(url string) (*http.Response, error)
func (c *Client) Post(url string, body io.Reader) (*http.Response, error)
func (c *Client) Do(req *Request) (*http.Response, error)

type CheckRetry func(ctx context.Context, resp *http.Response, err error) (bool, error)
type Backoff func(min, max time.Duration, attemptNum int, resp *http.Response) time.Duration
```

### `sony/gobreaker`

```go
type State int
const (
    StateClosed State = iota
    StateHalfOpen
    StateOpen
)

type Settings struct {
    Name          string
    MaxRequests   uint32
    Interval      time.Duration
    Timeout       time.Duration
    ReadyToTrip   func(Counts) bool
    OnStateChange func(name string, from State, to State)
    IsSuccessful  func(err error) bool
}

type Counts struct {
    Requests              uint32
    TotalSuccesses        uint32
    TotalFailures         uint32
    ConsecutiveSuccesses  uint32
    ConsecutiveFailures   uint32
}

type CircuitBreaker struct { /* opaque */ }

func NewCircuitBreaker(st Settings) *CircuitBreaker
func (cb *CircuitBreaker) Execute(req func() (interface{}, error)) (interface{}, error)
func (cb *CircuitBreaker) State() State
func (cb *CircuitBreaker) Counts() Counts
func (cb *CircuitBreaker) Name() string

var ErrTooManyRequests = errors.New("too many requests")
var ErrOpenState       = errors.New("circuit breaker is open")
```

### `golang.org/x/time/rate`

```go
type Limit float64
const Inf = Limit(math.MaxFloat64)

type Limiter struct { /* opaque */ }

func NewLimiter(r Limit, b int) *Limiter
func (lim *Limiter) Allow() bool
func (lim *Limiter) AllowN(now time.Time, n int) bool
func (lim *Limiter) Wait(ctx context.Context) error
func (lim *Limiter) WaitN(ctx context.Context, n int) error
func (lim *Limiter) Reserve() *Reservation
func (lim *Limiter) ReserveN(now time.Time, n int) *Reservation
func (lim *Limiter) Tokens() float64
func (lim *Limiter) Burst() int
func (lim *Limiter) Limit() Limit
func (lim *Limiter) SetBurst(b int)
func (lim *Limiter) SetLimit(newLimit Limit)
```

## Standard-Library Primitives

### `time.Duration`

```go
type Duration int64 // nanoseconds
```

Common durations:

```go
const (
    Nanosecond  Duration = 1
    Microsecond          = 1000 * Nanosecond
    Millisecond          = 1000 * Microsecond
    Second               = 1000 * Millisecond
    Minute               = 60 * Second
    Hour                 = 60 * Minute
)
```

Multiplication: `5 * time.Second` is `5 * Second = 5_000_000_000` nanoseconds.

### `time.Sleep`

```go
func Sleep(d Duration)
```

Blocks the calling goroutine for at least `d`. Not cancellable.

### `time.Timer`

```go
type Timer struct {
    C <-chan Time
}

func NewTimer(d Duration) *Timer
func (t *Timer) Stop() bool
func (t *Timer) Reset(d Duration) bool
```

Properties:
- `t.C` fires once after `d`.
- `t.Stop()` returns false if already fired.
- `t.Reset(d)` is for reuse; must drain channel first if Stop returned false.

### `time.After`

```go
func After(d Duration) <-chan Time
```

Returns a channel that fires after `d`. Convenient but leaks timers in loops.

### `time.NewTicker`

```go
type Ticker struct {
    C <-chan Time
}

func NewTicker(d Duration) *Ticker
func (t *Ticker) Stop()
```

Fires periodically every `d`. For periodic backoff (rare).

## Random Source Selection

### Choosing between math/rand and crypto/rand

| Property | math/rand | crypto/rand |
|----------|-----------|-------------|
| Speed | ~10ns per call | ~1µs per call |
| Determinism | reproducible with seed | non-reproducible |
| Cryptographic strength | no | yes |
| Concurrent safety (top-level functions, Go 1.20+) | yes | yes |
| Concurrent safety (per-instance) | no | yes (rand.Reader) |

For jitter: use `math/rand`.

### Seeding (math/rand, pre-Go 1.20)

```go
rand.Seed(time.Now().UnixNano())
```

In Go 1.20+, this is auto-seeded and `rand.Seed` is deprecated.

### Per-goroutine source

```go
src := rand.NewSource(seed)
r := rand.New(src)
delay := r.Int63n(int64(cap))
```

Not concurrent-safe. Wrap with `sync.Mutex` or use `sync.Pool`.

### Math/rand/v2 (Go 1.22+)

```go
import "math/rand/v2"

delay := rand.Int64N(int64(cap))
```

Concurrent-safe top-level functions. Recommended for new code.

### Generating a random duration

```go
// Uniform on [0, cap)
delay := time.Duration(rand.Int63n(int64(cap)))

// Uniform on [a, b)
delay := a + time.Duration(rand.Int63n(int64(b-a)))
```

`Int63n` panics on `n <= 0`. Always guard.

## Timer Semantics

### `time.NewTimer` vs `time.After`

| Aspect | `time.NewTimer` | `time.After` |
|--------|-----------------|--------------|
| Returns | `*time.Timer` | `<-chan time.Time` |
| Stoppable | yes | no |
| Leaks in loops | no (with Stop) | yes |
| Use in retry | preferred | avoid |

### Idiomatic cancellable sleep

```go
func sleepCtx(ctx context.Context, d time.Duration) error {
    if d <= 0 {
        return nil
    }
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

### Reusing a timer

```go
t := time.NewTimer(0)
defer t.Stop()
if !t.Stop() {
    <-t.C // drain
}
for /* loop */ {
    t.Reset(nextDelay)
    select {
    case <-t.C:
    case <-ctx.Done():
        return ctx.Err()
    }
}
```

Saves allocation per iteration.

## Error Classification

### Retryable conditions

| Source | Examples |
|--------|----------|
| Network | `dial tcp: i/o timeout`, `connection refused`, `connection reset` |
| HTTP | 408, 425, 429, 500, 502, 503, 504 |
| gRPC | UNAVAILABLE, DEADLINE_EXCEEDED, RESOURCE_EXHAUSTED |
| Database | connection lost, deadlock detected |

### Non-retryable conditions

| Source | Examples |
|--------|----------|
| HTTP | 400, 401, 403, 404, 405, 409, 410, 422 |
| gRPC | INVALID_ARGUMENT, NOT_FOUND, ALREADY_EXISTS, PERMISSION_DENIED, FAILED_PRECONDITION |
| Parsing | malformed JSON, validation errors |
| Auth | invalid credentials |

### Idiomatic predicate

```go
func isRetryable(err error) bool {
    if err == nil { return false }
    var netErr net.Error
    if errors.As(err, &netErr) { return true }
    return false
}

func isRetryableHTTPStatus(code int) bool {
    return code == 408 || code == 425 || code == 429 ||
           (code >= 500 && code <= 599)
}
```

## Retry-After Header

### Format

Two valid formats:

```
Retry-After: 120
Retry-After: Wed, 21 Oct 2026 07:28:00 GMT
```

### Parsing

```go
func parseRetryAfter(h string) (time.Duration, bool) {
    if h == "" { return 0, false }
    if s, err := strconv.Atoi(h); err == nil {
        return time.Duration(s) * time.Second, true
    }
    if t, err := http.ParseTime(h); err == nil {
        return time.Until(t), true
    }
    return 0, false
}
```

### Usage

When honouring `Retry-After`:

```go
if d, ok := parseRetryAfter(resp.Header.Get("Retry-After")); ok {
    // optionally clip to deadline
    if deadline, hasDeadline := ctx.Deadline(); hasDeadline {
        if d > time.Until(deadline) {
            return ctx.Err()
        }
    }
    // optionally add jitter
    d += time.Duration(rand.Int63n(int64(d) / 10))
    return sleepCtx(ctx, d)
}
```

## gRPC Service Config Schema

### Retry policy

```json
{
  "methodConfig": [
    {
      "name": [{"service": "<svc>", "method": "<method>"}],
      "timeout": "<duration>",
      "retryPolicy": {
        "maxAttempts": <int>,
        "initialBackoff": "<duration>",
        "maxBackoff": "<duration>",
        "backoffMultiplier": <float>,
        "retryableStatusCodes": ["<code>", ...]
      }
    }
  ]
}
```

### Throttling

```json
{
  "retryThrottling": {
    "maxTokens": <int>,
    "tokenRatio": <float>
  }
}
```

`maxTokens` is the bucket size. `tokenRatio` is how many tokens each successful call adds (failed retries cost 1 token).

### Hedging policy

```json
{
  "methodConfig": [
    {
      "name": [{"service": "<svc>"}],
      "hedgingPolicy": {
        "maxAttempts": <int>,
        "hedgingDelay": "<duration>",
        "nonFatalStatusCodes": ["<code>", ...]
      }
    }
  ]
}
```

Mutually exclusive with `retryPolicy`.

### Loading

```go
const cfg = `{...}`

conn, err := grpc.NewClient(target,
    grpc.WithDefaultServiceConfig(cfg),
    grpc.WithTransportCredentials(creds),
)
```

## HTTP Status Code Retryability Table

| Code | Name | Retryable? | Notes |
|------|------|------------|-------|
| 200-299 | 2xx Success | n/a | success |
| 300-399 | 3xx Redirect | n/a | follow redirect; not retry |
| 400 | Bad Request | no | malformed input |
| 401 | Unauthorized | no (unless re-auth) | |
| 402 | Payment Required | no | |
| 403 | Forbidden | no | |
| 404 | Not Found | no | |
| 405 | Method Not Allowed | no | |
| 406 | Not Acceptable | no | |
| 408 | Request Timeout | yes | |
| 409 | Conflict | sometimes | retry after re-read |
| 410 | Gone | no | |
| 413 | Payload Too Large | no | |
| 414 | URI Too Long | no | |
| 415 | Unsupported Media Type | no | |
| 422 | Unprocessable Entity | no | |
| 425 | Too Early | yes | |
| 429 | Too Many Requests | yes | honour Retry-After |
| 500 | Internal Server Error | yes | |
| 501 | Not Implemented | no | |
| 502 | Bad Gateway | yes | |
| 503 | Service Unavailable | yes | honour Retry-After |
| 504 | Gateway Timeout | yes | |
| 505 | HTTP Version Not Supported | no | |

## Defaults Reference

### Recommended defaults

```
MaxAttempts:     3-5
Base:           100-200ms
MaxDelay:       5s
MaxElapsedTime: 30s
Strategy:       FullJitter
Budget rate:    0.1 * normal RPS
Budget burst:   2 * rate
Breaker:        50% failures over 20 requests
Idempotency TTL: 24 hours
```

### Cenkalti/backoff defaults

```go
DefaultInitialInterval     = 500 * time.Millisecond
DefaultRandomizationFactor = 0.5
DefaultMultiplier          = 1.5
DefaultMaxInterval         = 60 * time.Second
DefaultMaxElapsedTime      = 15 * time.Minute
```

### Hashicorp/go-retryablehttp defaults

```go
RetryWaitMin = 1 * time.Second
RetryWaitMax = 30 * time.Second
RetryMax     = 4
```

### gRPC defaults

```
No retry by default.
Retry throttling: maxTokens=10, tokenRatio=0.1 (if enabled).
```

### Stripe API recommended

```
maxAttempts: 3
initialDelay: 500ms
maxDelay: 4s
backoffMultiplier: 2
```

(From Stripe's published guidance.)

### AWS SDK v2 defaults

```
MaxAttempts: 3
MaxBackoff:  20s
Full jitter, retry token bucket.
```

## Glossary

| Term | Definition |
|------|-----------|
| **Attempt** | One execution of the operation. |
| **Retry** | A repeated attempt after a failure. |
| **Backoff** | The delay-policy between retries. |
| **Base delay** | Delay before the first retry. |
| **Cap** | Maximum delay. |
| **Jitter** | Random variation added to delay. |
| **Full jitter** | `U[0, cap]`. |
| **Equal jitter** | `cap/2 + U[0, cap/2]`. |
| **Decorrelated jitter** | `U[base, prev*3]`. |
| **Permanent error** | Should not be retried. |
| **Transient error** | Should be retried. |
| **Thundering herd** | Synchronised retries overwhelming a service. |
| **Retry budget** | System-wide retry rate cap. |
| **Idempotency key** | Client-generated unique ID for deduplication. |
| **Circuit breaker** | Fail-fast pattern for known-bad dependencies. |
| **Bulkhead** | Per-dependency concurrency limit. |
| **Hedging** | Speculative duplicate requests. |
| **Deadline propagation** | Forwarding the deadline to downstream calls. |
| **Token bucket** | Rate-limiting algorithm: tokens replenish at a rate. |

---

## Summary Table

| Parameter | Range | Recommended |
|-----------|-------|-------------|
| `MaxAttempts` | 2-10 | 3-5 |
| `Base` | 10ms-1s | 100ms |
| `MaxDelay` | 1s-1min | 5s |
| `Total deadline` | 1s-1h | 5-30s |
| `Factor` | 1.5-3 | 2 |
| `Strategy` | none/full/equal/decorr | full |
| `Budget rate` | 1-50% RPS | 10% |
| `Budget burst` | 1-5x rate | 2x |
| `Breaker threshold` | 30-70% | 50% |
| `Breaker window` | 30s-5min | 60s |
| `Breaker timeout` | 10s-2min | 30s |
| `Idempotency TTL` | 1h-7d | 24h |

These are starting points. Tune from data.
