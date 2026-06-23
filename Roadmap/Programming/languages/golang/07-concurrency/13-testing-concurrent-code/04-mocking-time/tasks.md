# Mocking Time — Tasks

A graded set of exercises. Tackle them in order. Each task includes the goal, a starter sketch where appropriate, and the acceptance criteria.

## Table of Contents
1. [Task 1: First Clock Interface](#task-1-first-clock-interface)
2. [Task 2: TTL Cache With Fake Time](#task-2-ttl-cache-with-fake-time)
3. [Task 3: Background Sweeper Test](#task-3-background-sweeper-test)
4. [Task 4: Token Bucket Limiter](#task-4-token-bucket-limiter)
5. [Task 5: Retry With Exponential Backoff](#task-5-retry-with-exponential-backoff)
6. [Task 6: Cron-Style Scheduler](#task-6-cron-style-scheduler)
7. [Task 7: Heartbeat-Based Lease](#task-7-heartbeat-based-lease)
8. [Task 8: `synctest` Rewrite](#task-8-synctest-rewrite)
9. [Task 9: Per-Goroutine Skew](#task-9-per-goroutine-skew)
10. [Task 10: Eliminate `time.Sleep` From a Real Test](#task-10-eliminate-timesleep-from-a-real-test)
11. [Stretch Tasks](#stretch-tasks)

---

## Task 1: First Clock Interface

**Goal.** Define a minimal `Clock` interface and a real implementation.

**Requirements.**

- Methods: `Now() time.Time`, `Sleep(d time.Duration)`, `After(d time.Duration) <-chan time.Time`.
- A `realClock` type that delegates to the standard `time` package.
- A `clockwork.Clock` satisfaction check via a compile-time assertion.

**Starter.**

```go
package clock

import "time"

type Clock interface {
    Now() time.Time
    Sleep(d time.Duration)
    After(d time.Duration) <-chan time.Time
}

type realClock struct{}

func New() Clock { return realClock{} }

func (realClock) Now() time.Time                         { return time.Now() }
func (realClock) Sleep(d time.Duration)                  { time.Sleep(d) }
func (realClock) After(d time.Duration) <-chan time.Time { return time.After(d) }
```

**Acceptance.** `go vet` passes. A trivial test using the real clock prints a non-zero time.

---

## Task 2: TTL Cache With Fake Time

**Goal.** A `map[string]string` cache with a configurable TTL, testable in zero wall time.

**Requirements.**

- `New(clock Clock, ttl time.Duration) *Cache`.
- `Set(k, v)` records the entry with `expireAt = clock.Now().Add(ttl)`.
- `Get(k)` returns the value if not expired, otherwise deletes the entry and returns false.
- A `clockwork`-based test that asserts:
  - Right after `Set`, `Get` returns the value.
  - After `Advance(ttl - 1)`, `Get` still returns.
  - After `Advance(ttl + 1)`, `Get` returns false.

**Acceptance.** Test runs in under 5 ms.

---

## Task 3: Background Sweeper Test

**Goal.** Add a goroutine that ticks every `sweep` interval and evicts expired entries.

**Requirements.**

- `New(clock Clock, ttl, sweep time.Duration)` spawns the goroutine.
- A `Close()` method stops the goroutine.
- Test asserts that after one sweep interval an expired entry is gone *even without a `Get` call*.

**Hints.**

- Use `clock.NewTicker(sweep)`.
- After each `Advance`, call `BlockUntil(1)` to let the ticker re-arm.

**Acceptance.** Test passes 100 times in a row under `go test -count=100`.

---

## Task 4: Token Bucket Limiter

**Goal.** A rate limiter with `rate` tokens/second, burst `b`, refilling lazily, tested with fake time.

**API.**

```go
type Limiter struct { /* ... */ }
func New(clock Clock, rate, burst float64) *Limiter
func (l *Limiter) Allow() bool
```

**Tests.**

- Burst consumption: 5 immediate `Allow()` calls return true; sixth returns false.
- Refill after 1s of fake time: one `Allow()` succeeds.
- Cap at burst: advance 1 hour, only `burst` calls succeed before refusal.
- Fractional refill: rate=2, burst=1, after 500 ms one call succeeds.

**Acceptance.** All four tests run in under 1 ms each.

---

## Task 5: Retry With Exponential Backoff

**Goal.** Retry an operation with delays `base, base*2, base*4, ..., max`.

**API.**

```go
type Strategy struct {
    Clock    Clock
    Base, Max time.Duration
    Attempts int
}
func (s Strategy) Do(ctx context.Context, op func() error) error
```

**Tests.**

- Success on first attempt: no waits, no `After` calls.
- Success on third attempt: exactly two `After` calls.
- All attempts fail: returns the last error.
- Context cancel: returns `ctx.Err()` promptly.

**Acceptance.** A 10-attempt retry with `Base=100ms, Max=1s` test completes in under 1 ms.

---

## Task 6: Cron-Style Scheduler

**Goal.** A scheduler that runs a job every `every` duration.

**API.**

```go
type Scheduler struct{ /* ... */ }
func New(clock Clock) *Scheduler
func (s *Scheduler) Add(name string, every time.Duration, fn func(context.Context) error)
func (s *Scheduler) Run(ctx context.Context) error
```

**Tests.**

- After `Advance(every)`, job fires once.
- After `Advance(3*every)`, job fires three times.
- Multiple jobs with different periods fire correctly.
- Cancelling ctx returns promptly.

**Hints.** A single `for { select { ticker, ctx } }` per job, or one driver goroutine picking the next earliest job.

**Acceptance.** Tests deterministic across 100 runs.

---

## Task 7: Heartbeat-Based Lease

**Goal.** Model a lease that must be renewed every `renewInterval` to stay valid for `leaseDuration`.

**API.**

```go
type Lease struct{ /* ... */ }
func NewLease(clock Clock, leaseDuration time.Duration) *Lease
func (l *Lease) Renew()
func (l *Lease) Valid() bool

type Loop struct{ /* ... */ }
func NewLoop(clock Clock, lease *Lease, renewInterval time.Duration) *Loop
func (l *Loop) Run(ctx context.Context, renew func() error) error
```

**Tests.**

- Renewal extends validity by `leaseDuration`.
- Missing a renewal (renew returns error) for longer than `leaseDuration` returns from `Run`.
- `Run` cancellation returns ctx.Err.
- Fake clock advances exactly across the boundary; assertion is `Valid() == false at +1ns`.

**Acceptance.** Deterministic; uses `BlockUntil` correctly.

---

## Task 8: `synctest` Rewrite

**Goal.** Take Task 4 (Token Bucket) and rewrite it without injecting a `Clock`. Use `testing/synctest`.

**Requirements.**

- Go build tag `//go:build go1.24`.
- Production code uses `time.Now`, `time.NewTicker`, etc., directly.
- Test wraps everything in `synctest.Run`.
- Time advances via `time.Sleep(d)` *inside* the bubble; no `Advance` calls.

**Acceptance.** Equivalent semantic coverage to Task 4, same speed.

---

## Task 9: Per-Goroutine Skew

**Goal.** Build a tiny distributed-clock model with two fake clocks 10 seconds apart and test that a hybrid logical clock keeps timestamps strictly increasing.

**Requirements.**

- Two `clockwork.FakeClock` instances, one constructed at `time.Unix(1000, 0)` and one at `time.Unix(990, 0)`.
- A simplified HLC type with `Now()` and `Update(remote Timestamp)`.
- A test that:
  - Node A produces `ts1 = a.Now()`.
  - Node B receives `ts1` and produces `ts2 = b.Update(ts1)`.
  - Assertion: `ts2 > ts1` lexicographically.

**Stretch.** Add a third node; test transitive monotonicity.

---

## Task 10: Eliminate `time.Sleep` From a Real Test

**Goal.** Find a real flaky test in a small open-source Go project (or a project of yours) that uses `time.Sleep`. Refactor it.

**Process.**

1. Identify the production code that drives the timer.
2. Add a `Clock` parameter to the relevant constructor (or use `synctest`).
3. Replace `time.Sleep` in the test with `Advance` (or move the test inside `synctest.Run`).
4. Run the refactored test `100` times to confirm stability.

**Acceptance.** Open a PR with before/after timing. Typical result: a test that took 2 seconds takes 2 milliseconds and stops flaking.

---

## Stretch Tasks

### S1. Implement `BlockUntilContext` from scratch

Write a fake clock with `BlockUntilContext(ctx, n)` that cancels cleanly. Verify under heavy goroutine load that no goroutines leak.

### S2. Visualise a fake-clock trace

Add an `Events()` method to your fake clock that records every `After`/`Advance`/`AfterFunc` call with timestamps. After a test, dump the trace as a Mermaid diagram.

### S3. Compare libraries with a benchmark

Write a benchmark that arms 10,000 timers and advances time to fire them. Compare `clockwork`, `benbjohnson/clock`, and `synctest`. Report the results in a table.

### S4. Mock distributed clock skew with NTP-like correction

Model a node whose clock drifts by some amount per second, then periodically corrects via "NTP." Use fake time to advance both the drift and the correction.

### S5. Eliminate every `time.Now` in your project

Grep your project for `time.Now` and `time.Tick` outside `main` and the clock package. Migrate each to use the injected `Clock`. Add a CI check (`go vet` extension or `staticcheck` rule) that prevents regressions.

### S6. Build a `Clock`-aware `context.WithDeadline`

Implement a helper `clockcontext.WithDeadline(ctx, clock, t)` that returns a context whose deadline is on the given clock. Test it under fake time.

### S7. Build a fake clock that fires sleepers in *deterministic order*

`clockwork.Advance` fires in registration order filtered by deadline; what if two sleepers have the exact same deadline? Implement a fake clock that sorts by `(deadline, registration index)` and verify determinism across runs.

### S8. Mock NTP step-back

Implement a test where `clock.Advance(-time.Hour)` jumps time backwards, and verify your TTL cache does not produce negative durations or panic.

### S9. Library wrapper

Wrap `clockwork.Clock` in your project's own internal `Clock` interface so future migration to `synctest` or another library does not require rewriting every constructor.

### S10. Document your patterns

Write a one-page internal doc describing the project's clock pattern, the `testclock` helper, and the lint rules. New contributors should be able to write a fake-clock test by reading only that page.

---

## How to grade yourself

- **Done:** Tasks 1–4 finished in a clean repo, every test under 10 ms, zero `time.Sleep` in any test.
- **Solid junior:** Tasks 1–6 finished.
- **Mid:** Tasks 1–8 finished. You can pick between `clockwork` and `synctest` based on the situation.
- **Senior:** Tasks 1–9 finished. You have done at least one Stretch task and have an opinion about library choice.
- **Professional:** Done all of the above and have introduced the pattern into a non-trivial codebase. Task 10 done with at least one real PR merged.
