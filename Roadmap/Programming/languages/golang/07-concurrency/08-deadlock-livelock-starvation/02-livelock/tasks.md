# Livelock — Practice Tasks

A graduated set of exercises. Each task includes setup, requirements, hints, and a stretch goal. Solutions are not given; the point is the doing.

## Table of Contents
1. [Task 1: Reproduce a CAS-Loop Livelock](#task-1-reproduce-a-cas-loop-livelock)
2. [Task 2: Plot Throughput vs Goroutines](#task-2-plot-throughput-vs-goroutines)
3. [Task 3: Replace CAS Loop with atomic.Add](#task-3-replace-cas-loop-with-atomicadd)
4. [Task 4: Build a Sharded Counter](#task-4-build-a-sharded-counter)
5. [Task 5: Reproduce the Polite-Mutex Livelock](#task-5-reproduce-the-polite-mutex-livelock)
6. [Task 6: Add Jitter Three Ways](#task-6-add-jitter-three-ways)
7. [Task 7: Implement Decorrelated Jitter](#task-7-implement-decorrelated-jitter)
8. [Task 8: Use cenkalti/backoff End-to-End](#task-8-use-cenkaltibackoff-end-to-end)
9. [Task 9: A Throughput Probe](#task-9-a-throughput-probe)
10. [Task 10: Singleflight for Cache Fill](#task-10-singleflight-for-cache-fill)
11. [Task 11: AIMD Concurrency Limit](#task-11-aimd-concurrency-limit)
12. [Task 12: Simulate Raft Election Livelock](#task-12-simulate-raft-election-livelock)
13. [Task 13: Wallet Transfer with Two Locks](#task-13-wallet-transfer-with-two-locks)
14. [Task 14: A Snapshot Loop That Livelocks](#task-14-a-snapshot-loop-that-livelocks)
15. [Task 15: Capstone — Resilient Retry Library](#task-15-capstone-resilient-retry-library)

---

## Task 1: Reproduce a CAS-Loop Livelock

### Goal

Write a program that spawns N goroutines, each performing M CAS-based increments on a shared `atomic.Int64`. Measure aggregate throughput as you vary N from 1 to 10000.

### Requirements

- Use only `sync/atomic` for the counter.
- Use `sync.WaitGroup` to wait for all goroutines.
- Print successes-per-second and CPU time per success.
- Run with `time go run main.go` and report user CPU time.

### Hints

- Set `M = 1000` and vary `N` over `[1, 10, 100, 1000, 10000]`.
- Use `time.Now()` before and after to measure wall time.
- Use `runtime.NumCPU()` to know how many cores you have.

### Stretch

- Add a `pprof` HTTP server (`net/http/pprof`) and capture a CPU profile during the N=10000 run. Identify the hot function.

---

## Task 2: Plot Throughput vs Goroutines

### Goal

Generate a CSV from Task 1 and plot it. Confirm visually that adding goroutines does not increase throughput.

### Requirements

- CSV columns: `goroutines, success_per_second, cpu_seconds`.
- Use `gonum.org/v1/plot` or output the CSV and use Excel / Python.
- The curve should be roughly flat or downward — that is the livelock signature.

### Hints

- Average over 3 runs per N to reduce noise.
- Run on a quiet machine.

### Stretch

- Repeat with `GOMAXPROCS = 1, 2, 4, 8` and overlay the curves. Note how `GOMAXPROCS = 1` may actually have *higher* per-goroutine throughput because there is no cache-line ping-pong.

---

## Task 3: Replace CAS Loop with atomic.Add

### Goal

Take the code from Task 1. Replace the inner CAS loop with a single `counter.Add(1)`. Compare throughput.

### Requirements

- Single-line code change in the inner loop.
- Same N, M values.
- Plot the new curve over the old one.

### Hints

- `counter.Add(1)` is a single atomic instruction; throughput should scale much better.
- Confirm with a CPU profile: the `atomic.AddInt64` should dominate, but the *attempts/success ratio is 1:1* — no waste.

### Stretch

- Implement a generic `Counter[T]` using Go generics. Make it accept any integer type.

---

## Task 4: Build a Sharded Counter

### Goal

Build a `ShardedCounter` with a configurable number of shards. Compare its throughput to `atomic.Int64.Add` and to a CAS loop, at N = 1, 10, 100, 1000, 10000 goroutines.

### Requirements

- Use a fixed shard count (start with 64).
- Add cache-line padding between shards.
- Provide `Inc()` and `Sum()` methods.
- Distribute goroutines across shards by hashing `goroutine_id` or by using `rand.Intn`.

### Hints

- Cache line size: `64` bytes on x86, `128` on ARM. Use `64` for portability.
- Padded struct: `type s struct { v atomic.Int64; _ [56]byte }` — note the 56 = 64 - 8.
- For Go 1.21+, you can use `sync/atomic.Int64` directly without `unsafe`.

### Stretch

- Profile with `perf c2c` (Linux) and see whether false sharing has truly been eliminated.
- Parameterise shard count; benchmark `8, 16, 32, 64, 128, 256` and find the sweet spot for your hardware.

---

## Task 5: Reproduce the Polite-Mutex Livelock

### Goal

Write a program with two goroutines, each acquiring two mutexes in opposite orders using `TryLock` with a constant sleep on failure. Observe (or measure) the livelock.

### Requirements

- Goroutine A: try `a` then `b`.
- Goroutine B: try `b` then `a`.
- On failure: `Unlock` what you have, `time.Sleep(1*time.Millisecond)`, retry.
- Each goroutine should do 1000 successful work units.
- Measure wall time.

### Hints

- Without jitter, expect very slow or oscillating progress.
- Add a `pprof` HTTP server; capture a profile mid-run.

### Stretch

- Add jitter to the sleep (`time.Duration(rand.Int63n(1_000_000))`) and observe the speedup.
- Plot wall time as a function of jitter range.

---

## Task 6: Add Jitter Three Ways

### Goal

Implement three jitter strategies on top of the same exponential back-off skeleton:

1. Full jitter — `sleep = rand(0, base)`.
2. Equal jitter — `sleep = base/2 + rand(0, base/2)`.
3. Decorrelated jitter — `sleep = rand(base, prev*3)`.

### Requirements

- A function `Backoff(strategy, attempt, prev)` that returns the sleep duration.
- A retry function that uses the chosen strategy.
- A test that runs N concurrent retries and reports the variance in retry timestamps.

### Hints

- Use `math/rand/v2` (Go 1.22+) for per-call randomness without global mutex contention.
- Variance should be lowest for constant back-off, highest for decorrelated jitter.

### Stretch

- Compute the synchronisation index — a metric that quantifies how often retries happen within a 1 ms window. Plot against strategy.

---

## Task 7: Implement Decorrelated Jitter

### Goal

A standalone implementation of decorrelated jitter conforming to the AWS Architecture Blog description.

### Requirements

- Function signature: `decorrelatedJitter(base, cap, prev time.Duration) time.Duration`.
- Result is uniformly random in `[base, prev * 3]`, capped at `cap`.
- A unit test with seeded `rand.Source` that verifies the distribution.

### Hints

- The Java reference: `temp = Math.min(cap, base * Math.pow(2, attempt)); sleep = temp/2 + random(0, temp/2)` — that is equal jitter. For decorrelated: `sleep = min(cap, random(base, prev*3))`.
- Property test: 10000 samples should have mean roughly `(base + prev*3) / 2`.

### Stretch

- Build a graphical chart showing the trajectory of `prev` over 50 attempts. Compare with full jitter.

---

## Task 8: Use cenkalti/backoff End-to-End

### Goal

Build a retrying HTTP client using `github.com/cenkalti/backoff/v4`.

### Requirements

- A function `Get(ctx, url) (*http.Response, error)`.
- Retry on network errors and 5xx responses.
- Do NOT retry on 4xx responses (use `backoff.Permanent`).
- Honour the `ctx` deadline.
- Cap total retries at 5.
- Use `MaxElapsedTime = 30 * time.Second`.
- Use `RandomizationFactor = 0.5`.

### Hints

- Wrap your operation in a closure that captures `ctx`.
- Inspect response body before retrying; you may need to drain and reset.
- Use `backoff.RetryNotify` to log each retry.

### Stretch

- Add Prometheus metrics for retry count and total elapsed time per call.
- Add OpenTelemetry tracing spans for each retry attempt.

---

## Task 9: A Throughput Probe

### Goal

A reusable goroutine that monitors `attempts` and `successes` and emits a warning when the ratio falls below a threshold.

### Requirements

- A `Probe` struct with `Attempt()` and `Success()` methods (both call `atomic.Add`).
- A background goroutine that, every second, computes the ratio and writes a log line.
- If the ratio is below 0.1 (i.e., success rate < 10%) for three consecutive intervals, emit `WARN`.
- The probe should be `context.Context`-aware.

### Hints

- `Attempt` and `Success` are atomic.Int64 counters with `.Swap(0)` per interval to compute rate.
- Use `time.NewTicker(time.Second)`.

### Stretch

- Integrate with `expvar` so the probe state is visible at `/debug/vars`.
- Add a `Severity` callback so consumers can react (e.g., send to Sentry, page on-call).

---

## Task 10: Singleflight for Cache Fill

### Goal

Implement a cache with `singleflight` coalescing for the "cache miss → backend fetch" path.

### Requirements

- A `Cache` struct with `Get(key) (Value, error)` method.
- On miss, call `backend.Fetch(key)`.
- Coalesce simultaneous misses for the same key using `singleflight.Group`.
- Store the result for 1 minute.
- Spawn 100 goroutines all querying the same key; verify the backend is called only once.

### Hints

- `singleflight.Group.Do(key, fn)` — returns whether the call was "shared."
- For TTL, use a `time.AfterFunc` per entry, or a periodic sweep.

### Stretch

- Add a `Forget(key)` method that invalidates the entry immediately.
- Handle the case where the backend fetch fails — should the next caller retry, or also fail?

---

## Task 11: AIMD Concurrency Limit

### Goal

Implement a concurrency limiter that adjusts itself using AIMD.

### Requirements

- Struct `AIMD` with `Acquire(ctx) error` and `Release(success bool)` methods.
- On `Release(true)`: increase `permits` by 1.
- On `Release(false)`: halve `permits` (minimum 1).
- `Acquire` blocks until a permit is available or `ctx` expires.

### Hints

- Use a buffered channel of `struct{}` as the permit token store.
- Resizing a channel is not supported in Go; use a counter + condition variable, or recreate the channel atomically.
- An alternative is `semaphore.Weighted` with manually adjusted weight.

### Stretch

- Add metrics for current permit count.
- Add a test that simulates downstream failure and verifies permits decay multiplicatively.

---

## Task 12: Simulate Raft Election Livelock

### Goal

A toy 3-node cluster where each node starts an election when it has not heard a heartbeat.

### Requirements

- Each node has an `electionTimeout` that triggers candidacy.
- With timeout = fixed (e.g., 150 ms), all three nodes time out together and split the vote.
- Observe that the cluster never elects a leader.
- Then add randomised timeout (`150 + rand.Intn(150) ms`) and observe quick convergence.

### Hints

- Goroutines for nodes; channels for messages.
- A test harness that runs 100 trials and reports the median time-to-leader.
- Without jitter, median should be infinity (or very large); with jitter, it should be under one second.

### Stretch

- Implement the full Raft election protocol from the paper. Pre-vote optimisation is optional.

---

## Task 13: Wallet Transfer with Two Locks

### Goal

A wallet-to-wallet transfer that locks both accounts safely.

### Requirements

- `Account` struct with `ID int`, `Balance int`, `mu sync.Mutex`.
- `Transfer(from, to *Account, amount int) error`.
- Must not deadlock and must not livelock.
- Use lock ordering by `ID`.

### Hints

- The signature: `if from.ID < to.ID { from.mu.Lock(); to.mu.Lock() } else { to.mu.Lock(); from.mu.Lock() }`.
- Always `defer Unlock`.

### Stretch

- Add a test that runs 1000 transfers in random directions between 10 accounts. Verify the total balance is conserved and no deadlock or livelock occurs.
- Compare performance against an optimistic implementation using `atomic.Int64` balances and a CAS loop.

---

## Task 14: A Snapshot Loop That Livelocks

### Goal

Demonstrate the snapshot-consistency livelock.

### Requirements

- A struct with two fields, both `atomic.Int64`.
- A "writer" goroutine that increments both fields atomically (using a generation counter or version).
- A "reader" that tries to read both fields *consistently*: read v1, read field1, read field2, read v2 — if v1 == v2, accept. If not, retry.
- Under heavy writing, the reader may never see a consistent snapshot.

### Hints

- The writer should be fast — many updates per second.
- The reader should `time.Sleep` between reads if you cannot tune the writer slowdown.
- Add jitter to the reader's retry; observe whether it helps.

### Stretch

- Implement an MVCC-style fix: writers create new immutable structs and atomically swap pointers. Readers see a frozen snapshot.

---

## Task 15: Capstone — Resilient Retry Library

### Goal

Build a small library (`retry`) that wraps everything from previous tasks.

### Requirements

- `retry.Do(ctx, fn, options...) error`.
- Options:
  - `WithMaxAttempts(n int)`.
  - `WithExponentialBackoff(base, cap, factor time.Duration)`.
  - `WithJitter(strategy Strategy)`.
  - `WithRetryIf(predicate func(err) bool)`.
  - `WithOnRetry(callback func(attempt int, err error))`.
- Goroutine-safe.
- 100% test coverage.

### Hints

- Use the functional-options pattern.
- Use `math/rand/v2` for goroutine-safe randomness.
- Honour context cancellation immediately (not at next attempt).

### Stretch

- Add `WithCircuitBreaker` — after N consecutive failures, refuse further retries for a cool-off period.
- Add `WithTracer(t opentelemetry.Tracer)` integration.
- Publish to `pkg.go.dev`.

---

## Submission and Self-Review

For each task, ask:

1. Does it have bounded retries?
2. Does it have jitter?
3. Does it honour `context.Context`?
4. Is throughput measured, not just iterations?
5. Could it deadlock as well as livelock?

Pass all five for each task and you have completed the practical livelock unit.
