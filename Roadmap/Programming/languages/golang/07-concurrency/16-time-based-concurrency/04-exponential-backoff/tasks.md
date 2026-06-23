---
layout: default
title: Tasks
parent: Exponential Backoff
grand_parent: Time-Based Concurrency
ancestor: Go
nav_order: 8
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/16-time-based-concurrency/04-exponential-backoff/tasks/
---

# Exponential Backoff — Hands-On Tasks

18 graded exercises. Each comes with a problem statement, a solution sketch, and "extra credit" extensions.

---

## Task 1: Implement basic exponential backoff (Junior)

### Problem

Write a function `Retry(op func() error, maxAttempts int, base time.Duration) error` that retries `op` up to `maxAttempts` times, doubling the wait each time. Return `nil` on success or the wrapped final error.

### Solution

```go
package retry

import (
    "fmt"
    "time"
)

func Retry(op func() error, maxAttempts int, base time.Duration) error {
    var lastErr error
    for attempt := 0; attempt < maxAttempts; attempt++ {
        err := op()
        if err == nil {
            return nil
        }
        lastErr = err
        if attempt < maxAttempts-1 {
            time.Sleep(base * time.Duration(1<<attempt))
        }
    }
    return fmt.Errorf("after %d attempts: %w", maxAttempts, lastErr)
}
```

### Extra credit

- Add a `maxDelay` parameter and cap the sleep.
- Add a `factor` parameter for multipliers other than 2.

---

## Task 2: Add context support (Junior/Middle)

### Problem

Modify `Retry` to accept `context.Context`. Before each attempt and during sleep, check for cancellation. If cancelled, return `ctx.Err()`.

### Solution

```go
func Retry(ctx context.Context, op func(context.Context) error, maxAttempts int, base, maxDelay time.Duration) error {
    var lastErr error
    for attempt := 0; attempt < maxAttempts; attempt++ {
        if err := ctx.Err(); err != nil {
            return err
        }
        err := op(ctx)
        if err == nil {
            return nil
        }
        lastErr = err
        if attempt < maxAttempts-1 {
            d := base * time.Duration(1<<attempt)
            if d > maxDelay || d < 0 {
                d = maxDelay
            }
            t := time.NewTimer(d)
            select {
            case <-t.C:
            case <-ctx.Done():
                t.Stop()
                return ctx.Err()
            }
        }
    }
    return fmt.Errorf("after %d attempts: %w", maxAttempts, lastErr)
}
```

### Extra credit

- Clip the sleep to the remaining deadline if context has one.
- Wrap the final error so `errors.Is(err, context.DeadlineExceeded)` works.

---

## Task 3: Implement full jitter (Middle)

### Problem

Modify your retry to use full jitter. Each delay is uniformly distributed on `[0, min(maxDelay, base * 2^attempt))`.

### Solution

```go
import "math/rand"

func nextDelay(attempt int, base, maxDelay time.Duration) time.Duration {
    cap := base * time.Duration(1<<attempt)
    if cap > maxDelay || cap < 0 {
        cap = maxDelay
    }
    if cap <= 0 {
        return 0
    }
    return time.Duration(rand.Int63n(int64(cap)))
}
```

### Extra credit

- Add equal and decorrelated jitter as alternatives.
- Make the strategy configurable.

---

## Task 4: Implement equal jitter (Middle)

### Problem

Implement equal jitter: `delay = cap/2 + U[0, cap/2]`.

### Solution

```go
func equalJitter(attempt int, base, maxDelay time.Duration) time.Duration {
    cap := base * time.Duration(1<<attempt)
    if cap > maxDelay || cap < 0 {
        cap = maxDelay
    }
    half := cap / 2
    if half <= 0 {
        return 0
    }
    return half + time.Duration(rand.Int63n(int64(half)))
}
```

### Extra credit

- Compare the average delay of full vs equal jitter empirically (run 1000 samples for each, take the mean).

---

## Task 5: Implement decorrelated jitter (Middle/Senior)

### Problem

Implement decorrelated jitter. Each delay is `U[base, prev*3]`, capped at `maxDelay`. Initialise `prev = base`.

### Solution

```go
type Decorrelated struct {
    Base     time.Duration
    MaxDelay time.Duration
    prev     time.Duration
}

func (d *Decorrelated) Next() time.Duration {
    if d.prev == 0 {
        d.prev = d.Base
    }
    upper := d.prev * 3
    if upper > d.MaxDelay || upper < 0 {
        upper = d.MaxDelay
    }
    span := upper - d.Base
    if span <= 0 {
        d.prev = d.Base
        return d.Base
    }
    delay := d.Base + time.Duration(rand.Int63n(int64(span)))
    d.prev = delay
    return delay
}
```

### Extra credit

- Add a `Reset()` method that returns to the initial state.
- Make the multiplier (3) configurable.

---

## Task 6: Retry an HTTP GET (Middle)

### Problem

Write a function `GetWithRetry(ctx, url) ([]byte, error)` that retries the GET with exponential backoff and full jitter. Retry on 5xx and 429. Surface 4xx (except 429) immediately.

### Solution

```go
func GetWithRetry(ctx context.Context, url string) ([]byte, error) {
    var body []byte
    err := Retry(ctx, func(ctx context.Context) error {
        req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
        if err != nil {
            return MarkPermanent(err)
        }
        resp, err := http.DefaultClient.Do(req)
        if err != nil {
            return err
        }
        defer resp.Body.Close()
        if resp.StatusCode == 429 || (resp.StatusCode >= 500 && resp.StatusCode <= 599) {
            return fmt.Errorf("status %d", resp.StatusCode)
        }
        if resp.StatusCode >= 400 {
            return MarkPermanent(fmt.Errorf("status %d", resp.StatusCode))
        }
        b, err := io.ReadAll(resp.Body)
        if err != nil {
            return err
        }
        body = b
        return nil
    }, 5, 100*time.Millisecond, 5*time.Second)
    return body, err
}
```

### Extra credit

- Honour `Retry-After` header.
- Parse it for both seconds and HTTP-date formats.

---

## Task 7: Implement Permanent error wrapper (Middle)

### Problem

Add a `Permanent` error type. Wrapping an error with `MarkPermanent(err)` should cause the retry loop to surface immediately without retrying.

### Solution

```go
type Permanent struct{ Err error }

func (p *Permanent) Error() string { return p.Err.Error() }
func (p *Permanent) Unwrap() error { return p.Err }

func MarkPermanent(err error) error { return &Permanent{Err: err} }

// In Retry:
var perm *Permanent
if errors.As(err, &perm) {
    return perm.Err
}
```

### Extra credit

- Add a `Retryable` wrapper for the opposite (force retry even if classifier says no).
- Detect cycles (`Permanent(Permanent(err))`).

---

## Task 8: Add a retry budget (Senior)

### Problem

Add a retry budget using `golang.org/x/time/rate.Limiter`. If the budget is empty when a retry is about to fire, surface a special error `ErrBudgetExhausted`.

### Solution

```go
import "golang.org/x/time/rate"

var ErrBudgetExhausted = errors.New("retry budget exhausted")

func RetryWithBudget(ctx context.Context, op func(context.Context) error, maxAttempts int, base, maxDelay time.Duration, budget *rate.Limiter) error {
    var lastErr error
    for attempt := 0; attempt < maxAttempts; attempt++ {
        if err := ctx.Err(); err != nil {
            return err
        }
        err := op(ctx)
        if err == nil {
            return nil
        }
        lastErr = err
        if attempt < maxAttempts-1 {
            if !budget.Allow() {
                return fmt.Errorf("%w: %v", ErrBudgetExhausted, lastErr)
            }
            d := fullJitter(attempt, base, maxDelay)
            // sleep with context...
        }
    }
    return fmt.Errorf("after %d attempts: %w", maxAttempts, lastErr)
}
```

### Extra credit

- Allow per-operation budgets keyed on a string label.
- Emit a metric on budget denial.

---

## Task 9: Integrate a circuit breaker (Senior)

### Problem

Use `github.com/sony/gobreaker` to wrap each retry attempt. If the breaker is open, surface immediately without retrying.

### Solution

```go
import "github.com/sony/gobreaker"

func RetryWithBreaker(ctx context.Context, op func(context.Context) error, breaker *gobreaker.CircuitBreaker, maxAttempts int, base, maxDelay time.Duration) error {
    var lastErr error
    for attempt := 0; attempt < maxAttempts; attempt++ {
        if err := ctx.Err(); err != nil {
            return err
        }
        _, err := breaker.Execute(func() (interface{}, error) {
            return nil, op(ctx)
        })
        if err == nil {
            return nil
        }
        if errors.Is(err, gobreaker.ErrOpenState) {
            return err
        }
        lastErr = err
        if attempt < maxAttempts-1 {
            d := fullJitter(attempt, base, maxDelay)
            // sleep with context...
        }
    }
    return fmt.Errorf("after %d attempts: %w", maxAttempts, lastErr)
}
```

### Extra credit

- Avoid breaker thrash: only record one breaker event per retry sequence.
- Add metrics on breaker state changes.

---

## Task 10: Simulate retry strategies (Senior)

### Problem

Write a program that simulates 1000 clients retrying against a server that recovers at `t = 5s`. Compare full, equal, decorrelated, and no-jitter strategies. Report total time-to-completion and total retries.

### Solution

```go
package main

import (
    "fmt"
    "math/rand"
    "time"
)

func simulate(strategy string, clients int, base, cap time.Duration, recovery time.Duration, maxAttempts int) (completionTime time.Duration, totalRetries int) {
    for c := 0; c < clients; c++ {
        var t time.Duration
        var prev time.Duration
        for attempt := 0; attempt < maxAttempts; attempt++ {
            totalRetries++
            if t >= recovery {
                if t > completionTime {
                    completionTime = t
                }
                break
            }
            var d time.Duration
            switch strategy {
            case "none":
                d = base * time.Duration(1<<attempt)
            case "full":
                cc := base * time.Duration(1<<attempt)
                if cc > cap { cc = cap }
                d = time.Duration(rand.Int63n(int64(cc)))
            case "equal":
                cc := base * time.Duration(1<<attempt)
                if cc > cap { cc = cap }
                d = cc/2 + time.Duration(rand.Int63n(int64(cc/2)))
            case "decorr":
                if prev == 0 { prev = base }
                upper := prev * 3
                if upper > cap { upper = cap }
                span := upper - base
                if span <= 0 {
                    d = base
                } else {
                    d = base + time.Duration(rand.Int63n(int64(span)))
                }
                prev = d
            }
            if d > cap { d = cap }
            t += d
        }
    }
    return
}

func main() {
    for _, s := range []string{"none", "full", "equal", "decorr"} {
        ct, tr := simulate(s, 1000, 100*time.Millisecond, 5*time.Second, 5*time.Second, 50)
        fmt.Printf("%-7s completion=%v retries=%d\n", s, ct, tr)
    }
}
```

### Extra credit

- Plot the distribution of retry arrivals over time for each strategy.
- Simulate with variable recovery times.

---

## Task 11: Hedged HTTP request (Senior)

### Problem

Write a function `HedgedGet(ctx, urls, hedgeDelay) ([]byte, error)` that sends a GET to the first URL, and if no response in `hedgeDelay`, sends to the second URL too. Return the first successful response.

### Solution

```go
func HedgedGet(ctx context.Context, urls []string, hedgeDelay time.Duration) ([]byte, error) {
    type result struct {
        body []byte
        err  error
    }
    out := make(chan result, len(urls))
    ctx, cancel := context.WithCancel(ctx)
    defer cancel()
    
    for i, url := range urls {
        go func(i int, url string) {
            if i > 0 {
                t := time.NewTimer(hedgeDelay * time.Duration(i))
                select {
                case <-t.C:
                case <-ctx.Done():
                    t.Stop()
                    return
                }
            }
            req, _ := http.NewRequestWithContext(ctx, "GET", url, nil)
            resp, err := http.DefaultClient.Do(req)
            if err != nil {
                select {
                case out <- result{nil, err}:
                case <-ctx.Done():
                }
                return
            }
            defer resp.Body.Close()
            body, err := io.ReadAll(resp.Body)
            select {
            case out <- result{body, err}:
            case <-ctx.Done():
            }
        }(i, url)
    }
    
    var lastErr error
    for i := 0; i < len(urls); i++ {
        select {
        case r := <-out:
            if r.err == nil {
                return r.body, nil
            }
            lastErr = r.err
        case <-ctx.Done():
            return nil, ctx.Err()
        }
    }
    return nil, lastErr
}
```

### Extra credit

- Add a hedging budget.
- Add metrics: hedged requests count, hedge wins.

---

## Task 12: Implement idempotency-key handler (Senior)

### Problem

Server-side: write an HTTP handler that processes a request with `Idempotency-Key` header. On first request, do the work and cache the response. On subsequent requests with the same key, return the cached response without redoing the work. Use Redis.

### Solution

```go
import "github.com/redis/go-redis/v9"

type Handler struct {
    Redis *redis.Client
    Op    func(ctx context.Context, body []byte) ([]byte, error)
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
    ctx := r.Context()
    key := r.Header.Get("Idempotency-Key")
    if key == "" {
        http.Error(w, "missing key", http.StatusBadRequest)
        return
    }
    
    cached, err := h.Redis.Get(ctx, "idem:"+key).Bytes()
    if err == nil {
        w.Write(cached)
        return
    }
    
    locked, err := h.Redis.SetNX(ctx, "idem:"+key+":lock", "1", 60*time.Second).Result()
    if err != nil {
        http.Error(w, err.Error(), 500)
        return
    }
    if !locked {
        http.Error(w, "in progress", http.StatusConflict)
        return
    }
    defer h.Redis.Del(ctx, "idem:"+key+":lock")
    
    body, _ := io.ReadAll(r.Body)
    result, err := h.Op(ctx, body)
    if err != nil {
        http.Error(w, err.Error(), 500)
        return
    }
    h.Redis.Set(ctx, "idem:"+key, result, 24*time.Hour)
    w.Write(result)
}
```

### Extra credit

- Detect key reuse with different bodies; return 409.
- Use a proper lock library for distributed correctness.

---

## Task 13: Build a kill switch (Senior)

### Problem

Add a global kill switch that disables retries. Implement via env var or atomic boolean. Check before each retry.

### Solution

```go
var retriesDisabled atomic.Bool

func init() {
    if os.Getenv("RETRIES_DISABLED") == "true" {
        retriesDisabled.Store(true)
    }
}

func RetryIfEnabled(ctx context.Context, op func(context.Context) error, maxAttempts int) error {
    if retriesDisabled.Load() {
        return op(ctx)
    }
    return Retry(ctx, op, maxAttempts, /* ... */)
}

// HTTP endpoint to toggle:
func handleKillSwitch(w http.ResponseWriter, r *http.Request) {
    if r.URL.Query().Get("disabled") == "true" {
        retriesDisabled.Store(true)
        w.Write([]byte("retries disabled"))
    } else {
        retriesDisabled.Store(false)
        w.Write([]byte("retries enabled"))
    }
}
```

### Extra credit

- Make it per-dependency (kill switch for stripe only, not internal services).
- Integrate with feature-flag service.

---

## Task 14: Add Prometheus metrics (Professional)

### Problem

Instrument the retry helper with Prometheus counters and histograms. Emit: total attempts, attempt-at-success histogram, budget denial count.

### Solution

```go
import "github.com/prometheus/client_golang/prometheus/promauto"

var (
    attempts = promauto.NewCounterVec(
        prometheus.CounterOpts{Name: "retry_attempts_total"},
        []string{"outcome"},
    )
    attemptAtSuccess = promauto.NewHistogram(prometheus.HistogramOpts{
        Name:    "retry_attempt_at_success",
        Buckets: []float64{1, 2, 3, 5, 10},
    })
    budgetDenied = promauto.NewCounter(prometheus.CounterOpts{
        Name: "retry_budget_denied_total",
    })
)

func RetryWithMetrics(...) error {
    for attempt := 0; attempt < maxAttempts; attempt++ {
        err := op(ctx)
        if err == nil {
            attempts.WithLabelValues("success").Inc()
            attemptAtSuccess.Observe(float64(attempt + 1))
            return nil
        }
        attempts.WithLabelValues("failure").Inc()
        // ...
        if !budget.Allow() {
            budgetDenied.Inc()
            // ...
        }
    }
    attempts.WithLabelValues("giveup").Inc()
    return /* ... */
}
```

### Extra credit

- Add per-operation labels.
- Build a dashboard.

---

## Task 15: Add OpenTelemetry spans (Professional)

### Problem

Wrap the retry helper so that each attempt produces a child span under a parent "retry.Do" span. Each attempt's error should be recorded on its span.

### Solution

```go
import "go.opentelemetry.io/otel"

var tracer = otel.Tracer("retry")

func RetryWithTracing(ctx context.Context, op func(context.Context) error, /* ... */) error {
    ctx, parent := tracer.Start(ctx, "retry.Do")
    defer parent.End()
    
    for attempt := 0; attempt < maxAttempts; attempt++ {
        attemptCtx, attemptSpan := tracer.Start(ctx, fmt.Sprintf("attempt.%d", attempt+1))
        err := op(attemptCtx)
        if err != nil {
            attemptSpan.RecordError(err)
        }
        attemptSpan.End()
        if err == nil {
            parent.SetAttributes(attribute.Int("success_attempt", attempt + 1))
            return nil
        }
        // ... retry logic ...
    }
    return /* ... */
}
```

### Extra credit

- Add attributes for retry policy parameters.
- Add tracing across an HTTP call.

---

## Task 16: Integrate cenkalti/backoff (Professional)

### Problem

Migrate your custom retry to `github.com/cenkalti/backoff/v4`. Configure with full-jitter-like behaviour using `RandomizationFactor = 1.0`, and add context support.

### Solution

```go
import "github.com/cenkalti/backoff/v4"

func RetryWithBackoff(ctx context.Context, op func() error) error {
    b := backoff.NewExponentialBackOff()
    b.InitialInterval = 100 * time.Millisecond
    b.MaxInterval = 5 * time.Second
    b.MaxElapsedTime = 30 * time.Second
    b.RandomizationFactor = 1.0
    bWithCtx := backoff.WithContext(b, ctx)
    return backoff.RetryNotify(op, bWithCtx, func(err error, d time.Duration) {
        // log/metric
    })
}
```

### Extra credit

- Combine with `WithMaxRetries`.
- Use `Permanent` to short-circuit non-retryable errors.

---

## Task 17: Honour Retry-After header (Professional)

### Problem

When the server returns 429 or 503 with a `Retry-After` header, use the header's value (with optional jitter) instead of your computed backoff.

### Solution

```go
func ParseRetryAfter(h string) (time.Duration, bool) {
    if h == "" { return 0, false }
    if s, err := strconv.Atoi(h); err == nil {
        return time.Duration(s) * time.Second, true
    }
    if t, err := http.ParseTime(h); err == nil {
        return time.Until(t), true
    }
    return 0, false
}

// In retry loop:
if d, ok := ParseRetryAfter(resp.Header.Get("Retry-After")); ok {
    // add some jitter
    d += time.Duration(rand.Int63n(int64(d) / 10))
    // clip to deadline
    if deadline, hasDeadline := ctx.Deadline(); hasDeadline {
        if d > time.Until(deadline) {
            return ctx.Err()
        }
    }
    sleep = d
} else {
    sleep = fullJitter(...)
}
```

### Extra credit

- Cap max value (don't sleep > 1 hour even if header says so).
- Test both seconds and HTTP-date formats.

---

## Task 18: End-to-end resilient HTTP client (Professional)

### Problem

Build a resilient HTTP client that combines retry, full jitter, context, retry budget, circuit breaker, Prometheus metrics, and OpenTelemetry tracing. Use it to call a flaky test server.

### Solution sketch

The full code is the end-to-end example in `professional.md`. Build:

1. `Client` struct with `*http.Client`, `*backoff.BackOff`, `*rate.Limiter`, `*gobreaker.CircuitBreaker`.
2. `Get(ctx, url) ([]byte, error)` method.
3. Inside: tracing span, then retry loop, then breaker, then HTTP call.
4. Emit metrics throughout.

### Extra credit

- Test with a `httptest.NewServer` that returns 503 randomly.
- Tune parameters and observe via metrics.
- Inject a kill switch.

---

## Final Project: Build a full retry SDK

Combine all the above into a single library:

- Package: `retry`.
- API: `New(opts ...Option) *Retrier`; `r.Do(ctx, op) error`.
- Options: `WithMaxAttempts`, `WithBase`, `WithMaxDelay`, `WithJitter`, `WithBudget`, `WithBreaker`, `WithMetrics`.
- Tests: 100% coverage of branches.
- Docs: README, examples, godoc.

This is a 1-2 day project for a senior engineer. It is also a great portfolio piece.

---

## Solutions checklist

You have completed the tasks when you can:

- [ ] Write Tasks 1-7 (junior/middle) from memory.
- [ ] Implement all three jitter strategies in 10 minutes.
- [ ] Integrate retry with budget, breaker, and context.
- [ ] Test your helper with chaos (random failures).
- [ ] Emit Prometheus metrics with proper labels.
- [ ] Add OpenTelemetry tracing.
- [ ] Honour `Retry-After`.
- [ ] Build a kill switch.

If all checked: you are production-ready on retries.
