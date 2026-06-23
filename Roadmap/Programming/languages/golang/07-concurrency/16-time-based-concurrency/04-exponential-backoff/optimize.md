---
layout: default
title: Optimize
parent: Exponential Backoff
grand_parent: Time-Based Concurrency
ancestor: Go
nav_order: 10
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/16-time-based-concurrency/04-exponential-backoff/optimize/
---

# Exponential Backoff — Optimization Challenges

9 scenarios with code that "works but could be better". Each shows a before, an after, and a measurement (where applicable).

---

## Optimization 1: Reducing Thundering Herd

### Before

```go
// 1000 clients all use this
func Retry(op func() error, maxAttempts int, base time.Duration) error {
    for attempt := 0; attempt < maxAttempts; attempt++ {
        if err := op(); err == nil {
            return nil
        }
        if attempt < maxAttempts-1 {
            time.Sleep(base * time.Duration(1<<attempt))
        }
    }
    return errors.New("exhausted")
}
```

### Problem

When all 1000 clients fail at the same moment, they all retry at exactly `base, 3*base, 7*base, ...`. Peak retry rate at the server: 1000 simultaneous requests.

### After

```go
import "math/rand"

func Retry(op func() error, maxAttempts int, base, maxDelay time.Duration) error {
    for attempt := 0; attempt < maxAttempts; attempt++ {
        if err := op(); err == nil {
            return nil
        }
        if attempt < maxAttempts-1 {
            cap := base * time.Duration(1<<attempt)
            if cap > maxDelay {
                cap = maxDelay
            }
            // full jitter
            d := time.Duration(rand.Int63n(int64(cap)))
            time.Sleep(d)
        }
    }
    return errors.New("exhausted")
}
```

### Measurement

For 1000 clients with `base = 100ms`, full jitter:
- Before: peak 1000 simultaneous (at instant `base`).
- After: peak ~10 per ms over the `[0, base]` window.

Reduction: ~100×.

### Lesson

Full jitter prevents thundering herd. Always include it in retry code that may run at scale.

---

## Optimization 2: Sharing A Random Source

### Before

```go
func nextDelay(attempt int, base, maxDelay time.Duration) time.Duration {
    rng := rand.New(rand.NewSource(time.Now().UnixNano()))
    cap := base * time.Duration(1<<attempt)
    if cap > maxDelay { cap = maxDelay }
    return time.Duration(rng.Int63n(int64(cap)))
}
```

### Problem

Each call to `nextDelay` creates a new `*rand.Rand`, seeded with the nanosecond timestamp. Two consecutive calls in the same nanosecond produce *identical* sequences. Allocation cost per call. Concurrent goroutines may seed identically.

### After

```go
// Use the package-level rand (concurrent-safe in Go 1.20+)
func nextDelay(attempt int, base, maxDelay time.Duration) time.Duration {
    cap := base * time.Duration(1<<attempt)
    if cap > maxDelay { cap = maxDelay }
    return time.Duration(rand.Int63n(int64(cap)))
}
```

### Measurement

Benchmark on 100k calls:
- Before: ~150 ns/op (creating Rand, calling Int63n).
- After: ~30 ns/op (just Int63n).

5× faster, no concurrent-seeding hazard.

### Lesson

For jitter, the global `math/rand` is the right choice. Do not over-engineer with per-call sources.

### Extra optimisation

For extreme concurrency, use `sync.Pool`:

```go
var randPool = sync.Pool{
    New: func() any {
        return rand.New(rand.NewSource(time.Now().UnixNano()))
    },
}

func nextDelay(...) time.Duration {
    r := randPool.Get().(*rand.Rand)
    defer randPool.Put(r)
    return time.Duration(r.Int63n(int64(cap)))
}
```

This avoids the global lock entirely. For most code, not worth it.

---

## Optimization 3: Avoiding Timer Allocations

### Before

```go
for attempt := 0; attempt < maxAttempts; attempt++ {
    err := op()
    if err == nil { return nil }
    if attempt < maxAttempts-1 {
        select {
        case <-time.After(delay(attempt)):
        case <-ctx.Done():
            return ctx.Err()
        }
    }
}
```

### Problem

`time.After` allocates a `*time.Timer` per call. The timer is *not* garbage-collected until it fires. If many retries happen rapidly (e.g. tight inner-loop retry), many timers pile up.

### After

```go
t := time.NewTimer(0)
defer t.Stop()
if !t.Stop() { <-t.C } // drain initial

for attempt := 0; attempt < maxAttempts; attempt++ {
    err := op()
    if err == nil { return nil }
    if attempt < maxAttempts-1 {
        t.Reset(delay(attempt))
        select {
        case <-t.C:
        case <-ctx.Done():
            return ctx.Err()
        }
    }
}
```

### Measurement

For 1000 retry sequences with 5 attempts each:
- Before: 5000 `*time.Timer` allocations (live until expiry).
- After: 1000 (one per sequence, reused).

5× fewer allocations.

### Lesson

In hot retry loops, reuse a single timer with `Reset`. The pattern is standard but requires care with `Stop` and channel drain.

---

## Optimization 4: Reducing Metric Cardinality

### Before

```go
attempts = promauto.NewCounterVec(
    prometheus.CounterOpts{Name: "retry_attempts_total"},
    []string{"client", "url"}, // url has IDs
)

// ...
attempts.WithLabelValues("stripe", req.URL.String()).Inc()
```

### Problem

`req.URL.String()` contains user-specific IDs (e.g. `/users/42`). With many users, the label space explodes. Prometheus runs out of memory.

### After

```go
attempts = promauto.NewCounterVec(
    prometheus.CounterOpts{Name: "retry_attempts_total"},
    []string{"client", "op"}, // op is a method name
)

// ...
opName := "GetUser" // or extracted from route pattern
attempts.WithLabelValues("stripe", opName).Inc()
```

### Measurement

For 1M unique URLs:
- Before: 1M time series. Prometheus memory: GBs.
- After: ~10 time series (one per op). Negligible memory.

### Lesson

Labels must be bounded. Use route patterns or operation names, not URLs with IDs.

---

## Optimization 5: Batching Multiple Retries

### Before

Each goroutine has its own retry loop:

```go
for _, item := range items {
    go func(it Item) {
        Retry(func() error {
            return saveItem(it)
        }, 5, 100*time.Millisecond)
    }(item)
}
```

### Problem

1000 items, 1000 concurrent retries. Each consumes a goroutine and possibly a connection. Bulk operations would be more efficient.

### After

```go
// Batch the items into a single retryable operation
err := Retry(func() error {
    return saveItemsBulk(items)
}, 5, 100*time.Millisecond)
```

### Measurement

For 1000 items:
- Before: 1000 retries, 1000 connections, ~10 seconds tail.
- After: 1 retry, 1 connection, ~1 second total.

10× faster, dramatically less load.

### Lesson

Where the dependency supports bulk operations, prefer them. Per-item retries inside the bulk handle individual failures.

---

## Optimization 6: Avoiding Per-Call Context Allocations

### Before

```go
for attempt := 0; attempt < maxAttempts; attempt++ {
    ctx2, cancel := context.WithTimeout(ctx, perAttemptTimeout)
    err := op(ctx2)
    cancel()
    if err == nil { return nil }
    // ...
}
```

### Problem

Each `context.WithTimeout` allocates a `*timerCtx` and registers a timer. Per attempt, an extra allocation.

### After

For some cases, the per-attempt timeout can be replaced with a single total deadline:

```go
ctx, cancel := context.WithTimeout(ctx, totalTimeout)
defer cancel()
for attempt := 0; attempt < maxAttempts; attempt++ {
    err := op(ctx)
    // ...
}
```

Note: this is a *different* policy (total instead of per-attempt). Choose based on requirements.

### Measurement

For 5-attempt retries:
- Before: 5 context allocations per retry.
- After: 1.

### Lesson

Context allocation has cost. Hoist where the semantics allow.

---

## Optimization 7: Skipping Sleeps When Deadline Is Near

### Before

```go
for attempt := 0; attempt < maxAttempts; attempt++ {
    err := op(ctx)
    if err == nil { return nil }
    if attempt < maxAttempts-1 {
        d := nextDelay(attempt)
        select {
        case <-time.After(d):
        case <-ctx.Done():
            return ctx.Err()
        }
    }
}
```

### Problem

If the deadline is at `now + 200ms` and the next delay is 1s, we sleep 200ms then immediately exit with `DeadlineExceeded`. The 200ms sleep is mostly wasted; we could have tried one more time.

### After

```go
if deadline, ok := ctx.Deadline(); ok {
    remaining := time.Until(deadline)
    if remaining < d {
        d = remaining // sleep only until deadline
    }
    // optionally: skip retry entirely if remaining < expected_op_latency
    if remaining < estimatedOpLatency {
        break // no point retrying
    }
}
```

### Measurement

In an edge-case where the next sleep exceeds the remaining deadline:
- Before: full sleep, then context-cancelled.
- After: short sleep, attempt the operation, possibly succeed.

Helps the happy-path success rate near deadline boundaries.

### Lesson

Deadline-aware sleep avoids wasted time and gives the operation a chance.

---

## Optimization 8: Cache Hot Paths To Avoid Retries

### Before

```go
func GetUser(ctx context.Context, id string) (*User, error) {
    return Retry(ctx, func(ctx context.Context) error {
        return c.DB.GetUser(ctx, id)
    }, 5, 100*time.Millisecond, 5*time.Second)
}
```

### Problem

Every call hits the database. During incidents, retries amplify DB load.

### After

```go
func GetUser(ctx context.Context, id string) (*User, error) {
    if cached, ok := c.cache.Get(id); ok {
        return cached.(*User), nil
    }
    var u *User
    err := Retry(ctx, func(ctx context.Context) error {
        var err error
        u, err = c.DB.GetUser(ctx, id)
        return err
    }, 5, 100*time.Millisecond, 5*time.Second)
    if err == nil {
        c.cache.Set(id, u, 5*time.Minute)
    }
    return u, err
}
```

### Measurement

With 90% cache hit rate:
- Before: 100% DB calls, retries on 5% = 5% retry traffic.
- After: 10% DB calls, retries on 5% of those = 0.5% retry traffic.

10× less DB load, 10× less retry pressure.

### Lesson

Caching reduces both base load and retry load. For read-heavy paths, cache is the first optimization.

---

## Optimization 9: Adaptive Retry Throttling

### Before

```go
budget := rate.NewLimiter(100, 200) // fixed 10% of normal traffic
```

### Problem

A fixed budget cannot react to changing conditions. Quiet times waste budget; busy times have insufficient. Outages may exhaust the budget for legitimate uses.

### After

Use an adaptive throttling approach. Track recent success rate; if it drops, shrink retries probabilistically.

```go
type AdaptiveBudget struct {
    successes atomic.Int64
    requests  atomic.Int64
    K         float64 // tuning constant, e.g. 2.0
}

func (a *AdaptiveBudget) Record(success bool) {
    a.requests.Add(1)
    if success { a.successes.Add(1) }
}

func (a *AdaptiveBudget) Allow() bool {
    req := float64(a.requests.Load())
    suc := float64(a.successes.Load())
    if req == 0 {
        return true
    }
    rejectProb := (req - a.K*suc) / (req + 1)
    if rejectProb <= 0 {
        return true
    }
    return rand.Float64() > rejectProb
}
```

This implements Google's adaptive throttling formula.

### Measurement

Compared to fixed budget:
- During normal traffic: similar behaviour.
- During outage: faster reduction in retries, faster recovery for the dependency.

### Lesson

Adaptive throttling can outperform fixed budgets under varying conditions. Worth the complexity for high-stakes services.

---

## Summary Table

| Optimization | Before | After | Impact |
|--------------|--------|-------|--------|
| Add jitter | synchronised retries | spread retries | 100× peak reduction |
| Share rand source | per-call rand.New | global rand | 5× speedup |
| Reuse timer | time.After | time.NewTimer + Reset | 5× fewer allocations |
| Bound metric cardinality | URL labels | op labels | GBs of memory |
| Batch operations | per-item retry | bulk retry | 10× speedup |
| Hoist context | per-attempt timeout | total deadline | 5× fewer allocations |
| Deadline-aware sleep | sleep past deadline | clip to deadline | better tail success |
| Cache hot paths | always retry DB | cache 90% | 10× less DB load |
| Adaptive throttling | fixed budget | adaptive | better incident response |

---

## Final Words

Optimization in retry code is mostly about *avoiding waste*: wasted allocations, wasted sleeps, wasted load on dependencies. The first ~80% of optimization comes from getting the policy right (jitter, budget, context). The last 20% is the micro-optimizations in this file.

Measure before optimizing. The wrong optimization can hurt more than the right policy choice. Use `pprof`, `benchstat`, and production metrics to validate that your changes actually improve things.
