---
layout: default
title: Interview
parent: Exponential Backoff
grand_parent: Time-Based Concurrency
ancestor: Go
nav_order: 7
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/16-time-based-concurrency/04-exponential-backoff/interview/
---

# Exponential Backoff — Interview Questions

35 questions and answers across difficulty levels. Use as a study guide.

---

## Junior-Level Questions

### Q1. What is exponential backoff?

A retry policy where the wait between retries grows geometrically. Each retry waits `base * 2^attempt` (or `base * factor^attempt` for some `factor`). The idea is to handle short blips quickly with small initial waits, while giving the failing system more time to recover with longer subsequent waits.

### Q2. Why not just retry immediately?

Immediate retries hammer the failing system, often preventing recovery. They also amplify load — many clients all retrying at once produce a synchronised spike that can overload the service. Backoff gives the system breathing room.

### Q3. Write the simplest exponential backoff in Go.

```go
const maxAttempts = 5
const base = 100 * time.Millisecond
var lastErr error
for attempt := 0; attempt < maxAttempts; attempt++ {
    err := op()
    if err == nil { return nil }
    lastErr = err
    if attempt < maxAttempts-1 {
        time.Sleep(base * time.Duration(1<<attempt))
    }
}
return fmt.Errorf("after %d attempts: %w", maxAttempts, lastErr)
```

### Q4. Why must you cap the delay?

Without a cap, the delay grows to absurd values: 100ms base × 2^20 = ~29 hours. No reasonable system can wait that long. A cap (e.g. 5 seconds) prevents runaway delays.

### Q5. Why must you cap the number of attempts?

Without a cap, the loop may never return if the failure is permanent. You leak goroutines, file descriptors, and CPU. The user's request hangs forever.

### Q6. What is the difference between retryable and non-retryable errors?

Retryable: transient errors that may go away (network blips, 5xx, 429). Non-retryable: permanent errors that won't change (4xx other than 429, validation errors). Retrying non-retryable errors wastes budget.

### Q7. What does "idempotent" mean?

An operation is idempotent if doing it twice has the same effect as doing it once. `GET` and `PUT` are typically idempotent; `POST /charge` typically is not. You can only safely retry idempotent operations.

### Q8. What happens with `time.Sleep(-1 * time.Second)`?

It returns immediately. `time.Sleep` does not block for negative durations. This is why integer overflow (`1 << 63` becoming negative) can break retry loops.

### Q9. Why is `1 << attempt` dangerous?

For `attempt >= 64`, the shift wraps around. For `attempt = 63`, `1 << 63` is `MinInt64` (a large negative number). Multiplying by `base` produces a negative `time.Duration`. `time.Sleep` returns immediately, and your loop spins.

### Q10. How do you wait before each retry but not after the last one?

Guard the sleep with `if attempt < maxAttempts-1`. Otherwise you sleep uselessly before returning "gave up".

---

## Middle-Level Questions

### Q11. What is jitter and why do you need it?

Jitter is random variation added to the backoff delay. Without it, many clients failing simultaneously will all retry at the same instants — a thundering herd. Jitter spreads retries across time, smoothing the load on the recovering service.

### Q12. Name the three jitter strategies.

- **Full jitter:** `delay = U[0, cap]`.
- **Equal jitter:** `delay = cap/2 + U[0, cap/2]`.
- **Decorrelated jitter:** `delay = U[base, prev*3]`, capped at `maxDelay`.

### Q13. Which strategy does AWS recommend, and why?

Full jitter. Simulations showed it gives the shortest total time-to-completion and the most uniform load distribution.

### Q14. Write `sleepCtx(ctx, d)` from memory.

```go
func sleepCtx(ctx context.Context, d time.Duration) error {
    if d <= 0 { return nil }
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

### Q15. Why is `time.After` bad in a loop?

It creates a `time.Timer` each call that is not garbage-collected until it fires. In a tight loop, you accumulate timers. Use `time.NewTimer` with `defer Stop()`.

### Q16. What is a retry budget?

A system-wide cap on retry traffic, independent of per-call attempt limits. Typically 10% of normal RPS. Implemented with a `rate.Limiter`. Protects dependencies from amplification during incidents.

### Q17. What is the difference between `Limiter.Allow()` and `Limiter.Wait(ctx)`?

`Allow()` returns true/false immediately. `Wait(ctx)` blocks until a token is available or `ctx` is done. For retry budgets, `Allow()` is common (deny rather than queue).

### Q18. Is `math/rand` safe for concurrent use?

The top-level functions (`rand.Int63n`) are safe in Go 1.20+. A `*rand.Rand` (from `rand.New`) is *not* safe; you must lock or use `sync.Pool`.

### Q19. Why prefer `math/rand` over `crypto/rand` for jitter?

`math/rand` is ~50× faster. Jitter does not require cryptographic randomness; an attacker predicting your jitter has bigger concerns. Reserve `crypto/rand` for security-sensitive operations.

### Q20. How do you make a retry loop respect a parent deadline?

Use `context.WithTimeout` and clip sleeps to the remaining time:

```go
if deadline, ok := ctx.Deadline(); ok {
    remaining := time.Until(deadline)
    if delay > remaining {
        delay = remaining
    }
}
```

---

## Senior-Level Questions

### Q21. What is a thundering herd?

A surge of synchronised retry traffic when many clients all fail and retry at the same instants. Exponential backoff alone does not prevent it — only jitter does. Without jitter, the synchronised retries can crash a recovering service.

### Q22. What is a retry storm?

The multi-tier version of thundering herd. When service A retries B, which retries C, which retries D — failures at D get amplified by the product of all retry counts. A 3-tier × 3-retry stack can produce 27 calls per user request to D.

### Q23. How do you avoid retry storms?

Retry only at the edge. Internal services do not retry; they propagate the deadline and return errors. Combined with deadline propagation, total retries are bounded to the edge layer.

### Q24. What is deadline propagation?

Passing the parent's deadline through to downstream calls. gRPC does this automatically via metadata. HTTP requires a custom header (`X-Deadline`). Each hop computes its own context with the same deadline.

### Q25. Why does deadline propagation matter for retries?

Without it, downstream services keep working on requests after the user has given up — wasting capacity. With it, downstream services short-circuit when the deadline is close.

### Q26. What is an idempotency key?

A client-generated unique ID (typically UUID) included in the request. The server records keys with their cached response. On retry with the same key, the server returns the cached response instead of re-processing. Enables safe retry of non-idempotent operations.

### Q27. How do you handle two concurrent requests with the same idempotency key?

Use a distributed lock keyed on the idempotency key. The first request claims the lock; the second sees the lock and either waits, fails with 409 Conflict, or polls for the cached response.

### Q28. What is hedging?

Sending duplicate requests to multiple replicas before the original times out. Take the first response, cancel the rest. Reduces tail latency for slow replicas. Requires idempotency.

### Q29. When would you choose hedging over retry?

When latency is the primary concern and the operation is idempotent. Hedging fires the second request *before* timeout, capturing slow-replica improvements. Retry waits for failure.

### Q30. How do you combine retry and circuit breaker?

Place the breaker check inside the retry but treat `ErrOpenState` as permanent so the retrier stops. Alternatively, wrap the entire retrier in the breaker's `Execute` so the breaker sees one event per retry sequence.

```go
err := retrier.Do(ctx, func(ctx context.Context) error {
    _, err := breaker.Execute(func() (interface{}, error) {
        return nil, op(ctx)
    })
    if errors.Is(err, gobreaker.ErrOpenState) {
        return retry.MarkPermanent(err)
    }
    return err
})
```

---

## Professional-Level Questions

### Q31. Describe Google's adaptive throttling algorithm.

Each client tracks its own ratio of accepted requests to total requests. The rejection probability is `max(0, (requests - K * accepts) / (requests + 1))` with `K = 2`. When the client is seeing many rejections, it probabilistically drops some of its own requests before sending. This achieves coordinated backoff without inter-client communication.

### Q32. How does gRPC's retry throttling work?

A per-channel token bucket. Each successful call adds `tokenRatio` tokens (default 0.1); each failed retry costs 1 token. When tokens drop below half of `maxTokens`, retries are denied. Protects against retry storms.

### Q33. How would you implement a kill switch to disable retries at runtime?

Maintain a runtime-config-loaded boolean. Check it in the retry loop:

```go
if retriesDisabled.Load() {
    return op(ctx) // no retry
}
return retrier.Do(ctx, op)
```

The config source (etcd, Consul, feature flag service) can flip the boolean without redeploying. Document the procedure in the runbook.

### Q34. What metrics do you emit for a retry helper?

- `retry_attempts_total{client, op, outcome}` counter.
- `retry_attempt_at_success` histogram.
- `retry_budget_denied_total` counter.
- `circuit_breaker_state{name}` gauge.
- `retry_duration_seconds` histogram.

### Q35. How do you tune retry policy for a new dependency?

1. Start with defaults: 3 attempts, 100ms base, 5s cap, full jitter.
2. Measure: retry rate, attempt-at-success, latency p99.
3. If retry rate > 5%, the dependency is flaky; reduce retries to stop amplifying.
4. If success rate at attempt 3 is high, consider raising max attempts.
5. If tail latency is dominated by retries, reduce max attempts or shrink cap.
6. Add a budget once base policy is tuned.
7. Add a circuit breaker for fail-fast on persistent failures.

Iterate with real data. Defaults are a starting point.

### Q36. What does the `RandomizationFactor` in cenkalti/backoff do?

It applies symmetric jitter: each delay is uniformly distributed on `[interval * (1-r), interval * (1+r)]`. With `r = 0.5` (default), the delay is in `[0.5 * interval, 1.5 * interval]`. This is closer to "equal jitter" than "full jitter".

### Q37. Why might you set `MaxElapsedTime = 0` in cenkalti/backoff?

To disable the library's built-in total-time cap and control termination via `context.Context`. The pattern: `backoff.WithContext(b, ctx)` propagates context cancellation; you set `MaxElapsedTime = 0` so the only termination signals are the context and `MaxRetries`.

### Q38. Explain "retry budget" vs "retry quota" vs "rate limit".

- **Retry budget:** caps retries per unit time (often as fraction of total traffic). Token bucket.
- **Retry quota:** caps total retries (perhaps per call or per session). Counter.
- **Rate limit:** caps total request rate (including non-retries). Token bucket on all traffic.

A production system often has all three at different layers.

### Q39. How do retries interact with database transactions?

If retry is *inside* a transaction, retries hold locks for long, blocking other clients. If retry is *outside* a transaction, the transaction begins fresh on each retry — appropriate for serialisation-failure retries. Generally: retries belong outside transactions.

### Q40. What is the worst-case latency of a retry policy with `MaxAttempts = 5`, `Base = 100ms`, `MaxDelay = 5s`, full jitter, plus per-call timeout of 1s?

- Per-call worst case: 1s × 5 = 5s.
- Sleep worst case (no jitter): `100ms + 200ms + 400ms + 800ms = 1.5s`. With full jitter, expected half that.
- Total wall clock worst case: 5s + 1.5s = 6.5s.

For the typical case (full jitter), worst case is `5 × 1s + 0.75s = 5.75s`. Set a total deadline accordingly.

---

## Behavioural / Architecture Questions

### Q41. Describe an incident where retries made things worse.

(Sample answer.) "At a previous company, our payments service had retries with 5 attempts and no budget. During a 30-minute partial outage at our payment processor, every client retried. Effective load was 5× normal. The processor stayed broken longer than the original issue would have lasted because our retry traffic was preventing recovery. We added a 10% retry budget and the next outage was contained."

### Q42. How would you convince a team to add retry budgets?

Show data from past incidents. Specifically: "Last outage, we saw 5× retry amplification for 30 minutes. A budget would have capped this at 1.1× and the outage would have been 5 minutes instead of 30." Engineers respond to numbers more than abstract risk.

### Q43. When would you advise against retries?

For non-idempotent operations without idempotency keys. For operations that are quick and cheap to surface as errors (the user can re-click). For monitoring/alerting paths where latency is critical and a retry would mask the alert. For paths inside transactions.

### Q44. How would you test that your retry policy actually helps?

Chaos testing: inject failures at the dependency. Compare metrics with retry enabled vs disabled. Specifically: success rate, p99 latency, total dependency load. If retries improve success rate without overloading the dependency, they help.

### Q45. What is the single most important thing about retries?

Discipline. Retries that are not measured, not bounded, and not coordinated will eventually cause an incident. The discipline of caps, budgets, observability, and runbooks is what distinguishes professional retry code from amateur retry code.

---

## Coding Questions

### Q46. Code review this snippet — what is wrong?

```go
for {
    err := callIt()
    if err == nil { return nil }
    log.Printf("failed: %v", err)
    time.Sleep(1 * time.Second)
}
```

Bugs:
1. Infinite loop. No `maxAttempts`.
2. Constant backoff (no exponential).
3. No context cancellation.
4. No transient/permanent distinction.
5. Logs every retry at info level — floods logs during outages.
6. Function never returns on persistent failure.

### Q47. Write a retry helper with context.

```go
func Retry(ctx context.Context, op func() error, maxAttempts int, base, cap time.Duration) error {
    var lastErr error
    for attempt := 0; attempt < maxAttempts; attempt++ {
        if err := ctx.Err(); err != nil {
            return err
        }
        err := op()
        if err == nil {
            return nil
        }
        lastErr = err
        if attempt < maxAttempts-1 {
            d := base * time.Duration(1<<attempt)
            if d > cap || d < 0 {
                d = cap
            }
            // jitter
            d = time.Duration(rand.Int63n(int64(d)))
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

### Q48. Implement full, equal, and decorrelated jitter.

```go
func fullJitter(base, cap time.Duration, attempt int) time.Duration {
    c := base * time.Duration(1<<attempt)
    if c > cap || c < 0 { c = cap }
    return time.Duration(rand.Int63n(int64(c)))
}

func equalJitter(base, cap time.Duration, attempt int) time.Duration {
    c := base * time.Duration(1<<attempt)
    if c > cap || c < 0 { c = cap }
    half := c / 2
    return half + time.Duration(rand.Int63n(int64(half)))
}

type Decorrelated struct {
    Base, Cap, Prev time.Duration
}

func (d *Decorrelated) Next() time.Duration {
    if d.Prev == 0 { d.Prev = d.Base }
    upper := d.Prev * 3
    if upper > d.Cap || upper < 0 { upper = d.Cap }
    span := upper - d.Base
    if span <= 0 { return d.Base }
    delay := d.Base + time.Duration(rand.Int63n(int64(span)))
    d.Prev = delay
    return delay
}
```

### Q49. Compute the worst-case sleep time for `MaxAttempts=5, base=100ms, cap=5s, no jitter`.

Delays: `100ms, 200ms, 400ms, 800ms` (no sleep after last attempt, only after attempts 0-3).
Total: `100 + 200 + 400 + 800 = 1500ms = 1.5s`.

### Q50. With full jitter (same parameters), what is the expected total sleep?

Each delay is `U[0, cap_n]`. Expected value of each is half the no-jitter value.
Expected total: `1.5s / 2 = 0.75s`.

### Q51. Implement `parseRetryAfter`.

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

### Q52. Implement a `Permanent` error wrapper.

```go
type Permanent struct{ Err error }

func (p *Permanent) Error() string { return p.Err.Error() }
func (p *Permanent) Unwrap() error { return p.Err }

func MarkPermanent(err error) error { return &Permanent{Err: err} }

func IsPermanent(err error) bool {
    var p *Permanent
    return errors.As(err, &p)
}
```

### Q53. Implement a retry budget using `golang.org/x/time/rate`.

```go
budget := rate.NewLimiter(rate.Limit(100), 200)

for attempt := 0; attempt < maxAttempts; attempt++ {
    err := op()
    if err == nil { return nil }
    if attempt < maxAttempts-1 {
        if !budget.Allow() {
            return fmt.Errorf("budget exhausted: %w", err)
        }
        time.Sleep(delay)
    }
}
```

### Q54. Wrap `http.Client` with retry.

```go
type RetryingClient struct {
    HTTP *http.Client
}

func (c *RetryingClient) Get(ctx context.Context, url string) ([]byte, error) {
    var body []byte
    err := Retry(ctx, func() error {
        req, _ := http.NewRequestWithContext(ctx, "GET", url, nil)
        resp, err := c.HTTP.Do(req)
        if err != nil { return err }
        defer resp.Body.Close()
        if resp.StatusCode >= 500 || resp.StatusCode == 429 {
            return fmt.Errorf("status %d", resp.StatusCode)
        }
        if resp.StatusCode >= 400 {
            return MarkPermanent(fmt.Errorf("status %d", resp.StatusCode))
        }
        body, err = io.ReadAll(resp.Body)
        return err
    }, 5, 100*time.Millisecond, 5*time.Second)
    return body, err
}
```

### Q55. Write a test for a retry helper.

```go
func TestRetrySucceedsThirdAttempt(t *testing.T) {
    var calls int
    op := func() error {
        calls++
        if calls < 3 { return errors.New("transient") }
        return nil
    }
    err := Retry(context.Background(), op, 5, 1*time.Millisecond, 10*time.Millisecond)
    if err != nil { t.Fatalf("unexpected: %v", err) }
    if calls != 3 { t.Errorf("expected 3 calls, got %d", calls) }
}
```

---

## Tricky Edge-Case Questions

### Q56. What happens if `base * 2^attempt` overflows?

The shift wraps. With `int64` and `attempt = 63`, `1 << 63` is `MinInt64` — a negative duration. `time.Sleep(negative)` returns immediately. Your loop spins. Always cap `attempt` or guard with `if d < 0`.

### Q57. Suppose your retry has `maxAttempts = 5` but `MaxElapsedTime` is reached at attempt 3. What happens?

The library checks elapsed time first. `NextBackOff` returns `Stop`. The loop terminates after attempt 3 (with the final error). `maxAttempts` is *not* reached.

### Q58. What if `rand.Int63n(0)` is called?

It panics. Always check `if cap <= 0 { return 0 }` before calling.

### Q59. What if the response body is not read before retry?

The underlying connection is not returned to the pool until the body is consumed. Next retry may have to establish a new connection, paying TLS handshake cost. Always `defer resp.Body.Close()` and read the body even on retryable status codes.

### Q60. What if the request body is `io.Reader` and you retry?

The reader is consumed on the first attempt. The retry sends an empty body. Read the body into `[]byte` before the retry loop and create a fresh `bytes.NewReader` per attempt. Or use `hashicorp/go-retryablehttp`, which handles this.

### Q61. What if the dependency takes longer than the per-call timeout but eventually succeeds?

The first attempt times out; the retry fires; the dependency is now slow for the retry too. Result: every attempt times out. Retries do not help. Diagnose: is the per-call timeout too short for the dependency's p99?

### Q62. Two concurrent retries from the same client with idempotency key. What happens?

Without coordination, both may make it to the server. The server's idempotency-key handler must use a lock (`SETNX`) to claim the key. The second request sees the lock and either waits or returns 409.

### Q63. What if `ctx.Done()` fires *during* `op(ctx)` (not during sleep)?

`op` should respect `ctx` and return early with `ctx.Err()`. If it does, the loop sees the error and returns. If `op` ignores `ctx`, the loop waits for `op` to finish, then sees `ctx.Err()` next iteration. The point: every I/O in `op` must accept `ctx`.

### Q64. Can you retry a streaming gRPC?

Not safely via the built-in retry. A streaming RPC has client-side state (messages sent so far). Retry would re-send from the start; if the server is non-idempotent, you produce duplicates. Application-level retry with sequence numbers is required.

### Q65. What if the breaker opens after the retry has already made attempt 1 and is about to sleep?

You should check the breaker before each attempt. If the breaker opens mid-loop, the next attempt's check sees `ErrOpenState` and terminates the retry. The previous sleep is wasted but the loop is now bounded.

---

## Numerical / Quantitative Questions

### Q66. If `base = 100ms`, `MaxAttempts = 6`, no jitter, what is the total sleep across all retries (no cap)?

`100ms * (1 + 2 + 4 + 8 + 16) = 100ms * 31 = 3100ms = 3.1s`.

(Five sleeps because the last attempt does not sleep after it.)

### Q67. If `base = 50ms`, `cap = 1s`, `MaxAttempts = 10`, no jitter, what is the total sleep?

Capped sequence: `50, 100, 200, 400, 800, 1000, 1000, 1000, 1000 ms` (nine sleeps).
Sum: `50+100+200+400+800+1000*4 = 5550 ms = 5.55s`.

### Q68. With 1000 clients all retrying with no jitter, `base = 100ms`, how many simultaneous calls hit the server at `t = 700ms`?

Retries at `t = 100, 300, 700, 1500 ms` (cumulative). At `t = 700ms`, 1000 clients all retry. Peak: 1000 simultaneous calls.

### Q69. With full jitter, what is the peak (in 1ms window) at `t = 350ms` for attempt 2 (cap 400ms)?

Clients sample `U[0, 400ms]` for the third-attempt delay. The PDF is 1/400ms over the window. In a 1ms window: `1000 * 1/400 = 2.5` retries.

Compare to no-jitter: 1000 simultaneous. Full jitter reduces peak by ~400×.

### Q70. With `MaxAttempts = 3`, success probability 90% per attempt, what is the overall success probability?

`1 - (1 - 0.9)^3 = 1 - 0.001 = 0.999`. 99.9%.

### Q71. With `MaxAttempts = 3`, success probability 50% per attempt, what is overall?

`1 - 0.5^3 = 1 - 0.125 = 0.875`. 87.5%.

### Q72. If retry rate is 10% and each retry has 50% chance of success, what is the overall load amplification?

Load = first attempt + retries.

Of 100 calls: 90 succeed first, 10 retry.
Of 10 retries: 5 succeed, 5 retry.
Of 5 retries: 2.5 succeed, 2.5 retry (give up).
Total calls: 100 + 10 + 5 + 2.5 = 117.5.

Amplification: 1.175×. About 18% extra load.

### Q73. With 3-tier system, 3 retries each, 50% failure rate, what is the amplification?

Per tier: `1 + 0.5 + 0.25 + 0.125 = 1.875`.
3 tiers: `1.875^3 ≈ 6.6×`.

### Q74. If your retry budget is 100 RPS and your normal traffic is 1000 RPS, what fraction can retry?

10%. If everyone retries, only 100 of the 1000 retries are permitted.

### Q75. With 1000 RPS, 10% retries, 5 attempts max, what is the worst-case load during a complete dependency outage?

Per second:
- 1000 first attempts.
- Up to 1000 × 4 = 4000 retries (but capped by budget = 100/s).

Without budget: ~5000 RPS (5× amplification).
With budget: 1000 + 100 = 1100 RPS (1.1× amplification).

---

## Conceptual Questions

### Q76. Why do many engineers add retries without budgets?

Because the immediate benefit (transient failures masked) is visible, but the long-term risk (retry storm) is not. Budgets are operational rather than functional; they don't help on the happy path. The discipline to add them comes from postmortem experience.

### Q77. What is the "kill switch" pattern?

A runtime configuration that disables retries. During incidents where retries amplify load, flip the switch to stop the amplification. Implementation: load from feature flag service, etcd, or env var; check before each retry.

### Q78. Why are postmortems so important for retry policy?

Retries rarely fail until they fail catastrophically. Postmortems are when you discover what your policy actually does in production. Patterns like "we needed a budget" emerge from incidents.

### Q79. When is exactly-once delivery possible?

Strictly, never in a distributed system without consensus. Practically: at-least-once + idempotency = effectively-once. Many systems claim "exactly-once"; they mean this.

### Q80. What is the relationship between retry policy and SLO?

The SLO defines acceptable end-user experience (e.g. p99 < 1s). Retry policy contributes to both success rate and latency. Tuning: more retries → better success rate, worse latency. Find the balance that meets SLO.

