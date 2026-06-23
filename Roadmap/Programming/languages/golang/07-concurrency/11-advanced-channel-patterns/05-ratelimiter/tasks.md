# Rate Limiter — Tasks

A graded sequence of exercises. Start with the easy block; you should be comfortable through "middle" before moving on. The senior block expects experience with HTTP middleware and Redis.

Each task lists: prompt, hints, acceptance criteria, and a stretch goal.

---

## Easy (Junior)

### Task 1: Pace a `for` loop

Write a program that prints the numbers 1 through 10, one number every 250 ms, using a `time.NewTicker`. Make sure to stop the ticker.

**Acceptance:**
- Output: 1, 2, ..., 10 with ~250 ms between each.
- No goroutine leak — verify with `runtime.NumGoroutine()` before and after.
- `defer t.Stop()` is present.

**Stretch:** Make the interval configurable from a CLI flag.

### Task 2: Channel-based token bucket

Implement a `TokenBucket` type backed by a buffered channel and a `time.NewTicker`. API: `New(rate, burst int)`, `Allow() bool`, `Close()`.

**Acceptance:**
- The bucket is pre-filled with `burst` tokens.
- After `burst` immediate calls to `Allow`, the next call returns `false` until the ticker refills.
- `Close()` stops the refill goroutine.

**Stretch:** Add a `Wait(ctx)` that blocks until a token is available or `ctx` fires.

### Task 3: Use `x/time/rate` to throttle a worker

Write a worker that processes a slice of 100 integers. The processing must respect a rate limit of 5 ops/s with burst 3, using `rate.NewLimiter` and `Wait`.

**Acceptance:**
- The first 3 items process immediately (burst).
- Remaining 97 items pace at ~200 ms apart.
- Total elapsed: roughly `97 × 200ms = 19.4s`, plus startup.

**Stretch:** Add a context with a 5-second timeout; gracefully stop and report how many items were processed.

### Task 4: Find the `time.Tick` leak

Given the following code, find and fix the leak:

```go
func process(messages <-chan string) {
    for msg := range messages {
        for range time.Tick(time.Second) {
            log.Println(msg)
            break
        }
    }
}
```

**Acceptance:**
- Identify why `time.Tick` leaks here.
- Rewrite using `time.NewTicker` with `Stop`.
- Better: replace the whole inner loop with `time.Sleep(time.Second)`.

### Task 5: Build a "polite scraper"

Write a function that takes a slice of URLs and fetches each one via `http.Get`, throttled to at most 2 req/s. Print the status code of each response.

**Acceptance:**
- No more than 2 GETs per second.
- Errors are logged but do not stop the loop.
- Burst of 1 — no parallel fetches.

**Stretch:** Add a `--rate` and `--burst` flag.

---

## Medium (Middle)

### Task 6: HTTP middleware

Build an HTTP middleware `RateLimit(r, b)` that returns `func(http.Handler) http.Handler`. Limits each *IP* to `r` req/s, burst `b`. On reject, write `429` with a `Retry-After: 1` header.

**Acceptance:**
- A `map[string]*rate.Limiter` keyed by IP.
- A mutex protecting the map.
- `Retry-After` header on rejection.
- Bonus: emit metrics (allow/deny counters).

**Stretch:** Use `X-Forwarded-For` (first value) when present and the request is behind a trusted proxy. Document the security concern.

### Task 7: Per-IP map with eviction

Extend Task 6's middleware: idle limiters (no traffic for 10 minutes) should be evicted. A background goroutine runs the sweep every minute.

**Acceptance:**
- An `entry` struct holds `*rate.Limiter` and a `seen time.Time` (atomic).
- Sweep deletes entries older than the threshold.
- Memory usage stable under continuous fresh-IP traffic.

**Stretch:** Replace with `hashicorp/golang-lru/v2` and compare memory under load.

### Task 8: Leaky-bucket queue

Implement a `LeakyBucket` type: `New(capacity, ratePerSecond int)`, `Submit(fn func()) error`. `Submit` returns an error if the queue is full. The bucket runs `fn`s at the configured rate.

**Acceptance:**
- Output rate is exactly `ratePerSecond` regardless of `Submit` pattern.
- Overflow returns an error; no caller blocks.
- `Close()` drains the queue or aborts cleanly — your choice, but document it.

**Stretch:** Add a `SubmitWait(ctx, fn)` that blocks until space is available.

### Task 9: Sliding-window-counter

Implement `SlidingCounter` with `New(limit int, window time.Duration)`, `Allow() bool`. Use the prev/curr two-window approximation.

**Acceptance:**
- Thread-safe.
- After `limit` admissions in the current window, returns `false`.
- After a long idle (> 2 × window), both windows reset.
- Verify with a test that sends `limit + 1` requests in 1 ms, observes one rejection.

**Stretch:** Add a `Snapshot()` returning `(prev, curr, weight, estimate)` for diagnostics.

### Task 10: gRPC interceptor

Write a unary gRPC interceptor that rate-limits per `peer.FromContext` IP at 10 req/s burst 5. Reject with `codes.ResourceExhausted` and a message containing "rate limit".

**Acceptance:**
- Uses `grpc.UnaryServerInterceptor`.
- Returns the right gRPC status code.
- Per-IP map with eviction.
- Includes a unit test using `bufconn`.

**Stretch:** Convert to per-method limiting using `info.FullMethod`.

### Task 11: Reservation-based handler

Convert an HTTP handler to use `lim.Reserve()` instead of `Allow`. If the delay exceeds 100 ms, reject with `429`. If the delay is shorter, sleep and proceed.

**Acceptance:**
- `Reserve()` and `Delay()` used correctly.
- `Cancel()` called when rejecting.
- Tests cover both branches.

**Stretch:** Add a histogram for the delay (`prometheus.HistogramVec`) and check the p99 in a load test.

### Task 12: Adaptive limiter

Implement an AIMD limiter:
- `OnSuccess()` increases rate by +1 (capped at `maxRate`).
- `OnFailure()` halves the rate (floored at `minRate`).
- `Allow()` consults the underlying `rate.Limiter`.

**Acceptance:**
- Rate adjusts dynamically.
- Logged on every change.
- Unit test simulates 1000 successes + 1 failure and asserts the rate trajectory.

**Stretch:** Replace AIMD with gradient-based: measure latency, adjust based on the gradient. Compare in a load test.

---

## Hard (Senior)

### Task 13: Redis fixed-window limiter

Implement a distributed limiter using `go-redis/v9` and a Lua script. API: `Allow(ctx, key, limit, windowSec int)`. Use `INCR` + conditional `EXPIRE`.

**Acceptance:**
- Single Lua script, no race conditions.
- Returns `true`/`false` and an error.
- Integration test against a real Redis (skip if unavailable).
- Boundary problem acknowledged in a comment.

**Stretch:** Replace with `redis_rate` and compare semantics.

### Task 14: Hierarchical limiter

Build a `Multi` limiter composed of: per-IP local, per-tenant Redis, global Redis. A request must pass all layers. Order layers cheap-first. On any failure, return the corresponding `Retry-After`.

**Acceptance:**
- Local layers checked before Redis.
- Each layer's reject contributes to the final `Retry-After` (max across layers).
- Tests cover each layer independently.

**Stretch:** Add a "fall back to local" policy when Redis fails. Verify that fallback is generous enough to keep the service alive but tight enough to protect the database.

### Task 15: Distributed leaky-bucket

Implement the Lua leaky-bucket from `senior.md` (`HMGET` + `HMSET` + `PEXPIRE`). Wrap in a Go function. Test for correctness against a known input.

**Acceptance:**
- Single Lua script.
- Bucket level decreases over time correctly.
- Overflow returns 0.
- Self-expiring key (set `PEXPIRE` proportional to drain time).

**Stretch:** Benchmark against `redis_rate`. Compare ops/sec.

### Task 16: Limiter cardinality dashboard

Add metrics for: total limiters held in memory, rate of evictions, hottest 10 keys (by allow + deny). Expose via Prometheus. Build a Grafana dashboard.

**Acceptance:**
- Metrics emitted under reasonable label cardinality.
- Top-N keys computed without unbounded memory (heap of size 10).
- Dashboard JSON saved alongside the code.

**Stretch:** Alert when cardinality > N or eviction rate > M/s.

### Task 17: GCRA in pure Go

Implement GCRA from scratch (in-memory, no Redis). API matches `rate.Limiter`: `NewGCRA(r, b)`, `Allow()`, `Wait(ctx)`, `Reserve()`. Benchmark against `x/time/rate`.

**Acceptance:**
- Three lines of state-update logic.
- Concurrency-safe.
- Benchmark within 2× of `rate.Limiter` performance.
- Documented as a learning exercise; not a replacement for `rate.Limiter`.

**Stretch:** Add `SetLimit`/`SetBurst` like `rate.Limiter`.

### Task 18: Synctest deterministic tests

Rewrite the tests for Task 8 and Task 9 to use `testing/synctest` (Go 1.24+) for deterministic timing.

**Acceptance:**
- Tests use `synctest.Run`.
- Assertions on exact elapsed time (within micro-seconds).
- CI runs them with `-tags go1.24` or appropriate build constraint.

**Stretch:** Convert all timing-sensitive tests in your codebase to `synctest`. Document the migration.

---

## Diabolical (Professional)

### Task 19: Fail-mode harness

Build a test harness that simulates Redis failures (slow, partial outage, full outage) and exercises a limiter's fallback policy. Compare:
- Fail open.
- Fail closed.
- Fall back to local.
- Circuit-break to local.

Measure: allow rate, deny rate, time to recovery, errors surfaced.

**Acceptance:**
- A mock Redis client with controllable latency / failure injection.
- Each policy implemented and tested.
- Report comparing the four under three failure scenarios.

**Stretch:** Recommend one policy with justification, based on your data.

### Task 20: Multi-region rate limiter

Design (no code required) a rate limiter that:
- Enforces a global SLA across three regions (US, EU, APAC).
- Tolerates a region outage (degraded but functional).
- Has predictable latency (no global synchronous round-trip per request).

**Output:** A 1-page architecture doc with diagrams, trade-offs, and operational concerns. Mention CRDTs, eventual consistency, regional sub-budgets.

**Stretch:** Implement a prototype that approximates global limit using local rate × (1/N regions) and a slow sync.

### Task 21: Capacity planning exercise

Given:
- Database peak: 8,000 q/s
- Acceptable rejection rate: 2%
- 500 active tenants
- Traffic distribution: top 5% of tenants drive 60% of traffic

Pick rate/burst for: global, per-tenant tiers (free/standard/enterprise), per-IP. Justify each number. Defend against:
- A tenant spike doubling their normal traffic.
- A botnet hitting 100 IPs per second per tenant.
- A retry storm after a brief outage.

**Output:** A configuration file + 2-page rationale.

---

## Solutions

Solutions for Tasks 1–12 are provided in a separate `solutions/` directory (or check the `find-bug.md` and `optimize.md` files for related fragments). Tasks 13–21 are design exercises with no canonical solution; multiple approaches are valid.

When you complete a task:
1. Run `go test -race ./...`.
2. Run `go vet ./...`.
3. Profile under load (`go test -bench .`).
4. Verify with a `runtime.NumGoroutine()` check that you have no leaks.
5. Commit with a message naming the task: `Task 6: HTTP rate-limit middleware with per-IP map`.

The goal of this section is not to memorise APIs — it is to internalise the algorithms and operational concerns. By the end of Task 18 you should be able to architect a rate limiter for a production service of any scale.
