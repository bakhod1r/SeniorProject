---
layout: default
title: Optimize
parent: Sleep for Sync
grand_parent: Concurrency Anti-Patterns
ancestor: Go
nav_order: 9
permalink: /roadmap/programming-languages/golang/07-concurrency/15-concurrency-anti-patterns/06-sleep-for-sync/optimize/
---

# Sleep for Synchronization — Optimization Scenarios

## How To Use This File

Each scenario is a small code block that "works" but is slow, flaky, or both. The job is to replace the sleep with the right primitive so that:

- Wall-clock time drops to the minimum the actual work requires.
- Determinism becomes total (zero flakiness).
- The diff is justifiable to a reviewer.

Difficulty: `[J]` through `[P]`.

---

## Scenario 1 [J] — Cut A 200ms Test To 1ms

```go
func TestWorker(t *testing.T) {
    w := NewWorker()
    go w.Run()
    time.Sleep(100 * time.Millisecond)
    w.Submit(Task{ID: 1})
    time.Sleep(100 * time.Millisecond)
    if w.Done() != 1 {
        t.Errorf("done = %d, want 1", w.Done())
    }
}
```

### Diagnosis

Two `time.Sleep(100ms)` calls. Total wall-clock 200ms minimum. The actual work is microseconds.

### Optimisation

```go
func TestWorker(t *testing.T) {
    w := NewWorker()
    ready := make(chan struct{})
    w.OnReady(func() { close(ready) })
    done := make(chan struct{})
    w.OnDone(func() { close(done) })
    go w.Run()

    <-ready
    w.Submit(Task{ID: 1})
    select {
    case <-done:
    case <-time.After(2 * time.Second):
        t.Fatal("worker did not finish")
    }

    if w.Done() != 1 {
        t.Errorf("done = %d, want 1", w.Done())
    }
}
```

### Result

200ms → ~50µs (real-world measurement). 4000x faster, zero flake.

---

## Scenario 2 [J] — Speed Up A Batch Test

```go
func TestBatch(t *testing.T) {
    var processed int32
    for i := 0; i < 100; i++ {
        go func() {
            atomic.AddInt32(&processed, 1)
        }()
    }
    time.Sleep(500 * time.Millisecond)
    if atomic.LoadInt32(&processed) != 100 {
        t.Errorf("processed = %d, want 100", processed)
    }
}
```

### Diagnosis

500ms sleep for ~100 atomic increments. Massively over-budgeted.

### Optimisation

```go
func TestBatch(t *testing.T) {
    var processed int32
    var wg sync.WaitGroup
    wg.Add(100)
    for i := 0; i < 100; i++ {
        go func() {
            defer wg.Done()
            atomic.AddInt32(&processed, 1)
        }()
    }
    wg.Wait()
    if atomic.LoadInt32(&processed) != 100 {
        t.Errorf("processed = %d, want 100", processed)
    }
}
```

### Result

500ms → <1ms.

---

## Scenario 3 [M] — Cache Expiry Test Without Real Wait

```go
func TestCacheExpiry(t *testing.T) {
    c := NewCache(100 * time.Millisecond)
    c.Set("k", "v")
    time.Sleep(150 * time.Millisecond)
    if _, ok := c.Get("k"); ok {
        t.Fatal("should have expired")
    }
}
```

### Diagnosis

150ms wall-clock per run. With 100 such tests, the suite spends 15 seconds on cache expiry alone.

### Optimisation

```go
func TestCacheExpiry(t *testing.T) {
    synctest.Test(t, func(t *testing.T) {
        c := NewCache(100 * time.Millisecond)
        c.Set("k", "v")
        time.Sleep(150 * time.Millisecond) // virtual
        if _, ok := c.Get("k"); ok {
            t.Fatal("should have expired")
        }
    })
}
```

### Result

150ms → <1ms per test. 100 tests run in <100ms total.

---

## Scenario 4 [M] — Retry Test Cut From 7s To Microseconds

```go
func TestRetry(t *testing.T) {
    var attempts int
    op := func() error {
        attempts++
        return errors.New("fail")
    }
    err := Retry(op, 3, time.Second) // sleeps 1s, then 2s, then 4s
    if err == nil {
        t.Fatal("expected error")
    }
    if attempts != 3 {
        t.Errorf("attempts = %d", attempts)
    }
}
```

### Diagnosis

Worst case 1 + 2 + 4 = 7 seconds of real sleep. The test is a leading cause of slow CI.

### Optimisation

Inject a `Clock`:

```go
func TestRetry(t *testing.T) {
    clk := clockwork.NewFakeClock()
    r := NewRetrier(clk, 3, time.Second, time.Minute)
    var attempts int
    err := r.Do(func() error {
        attempts++
        return errors.New("fail")
    })
    clk.BlockUntil(1)
    clk.Advance(time.Second)
    clk.BlockUntil(1)
    clk.Advance(2 * time.Second)
    if err == nil { t.Fatal("expected error") }
    if attempts != 3 { t.Errorf("attempts = %d", attempts) }
}
```

Or use `synctest`:

```go
func TestRetry(t *testing.T) {
    synctest.Test(t, func(t *testing.T) {
        var attempts int
        err := Retry(func() error {
            attempts++
            return errors.New("fail")
        }, 3, time.Second)
        if err == nil { t.Fatal("expected error") }
        if attempts != 3 { t.Errorf("attempts = %d", attempts) }
    })
}
```

### Result

7s → <1ms.

---

## Scenario 5 [M] — Stop Spinning On A Channel

```go
for {
    select {
    case x := <-input:
        process(x)
    default:
        time.Sleep(time.Microsecond)
    }
}
```

### Diagnosis

The `default` branch makes the select non-blocking, then sleeps 1µs. The CPU is hot-spinning. Even with the 1µs sleep, CPU usage is high and latency on incoming items is bounded by the sleep cycle.

### Optimisation

Just block on the receive:

```go
for x := range input {
    process(x)
}
```

Or with a cancellation:

```go
for {
    select {
    case x := <-input:
        process(x)
    case <-ctx.Done():
        return
    }
}
```

### Result

CPU usage drops from ~100% per goroutine to near zero. Latency drops because the goroutine wakes the instant an item arrives.

---

## Scenario 6 [S] — Eliminate Per-Iteration Timer Allocation

```go
for {
    select {
    case <-time.After(time.Minute):
        check()
    case <-ctx.Done():
        return
    }
}
```

### Diagnosis

`time.After` allocates a new timer per iteration. In long-running services, the allocations add up; pre-Go 1.23 they may even leak briefly.

### Optimisation

```go
t := time.NewTicker(time.Minute)
defer t.Stop()
for {
    select {
    case <-t.C:
        check()
    case <-ctx.Done():
        return
    }
}
```

### Result

Allocations per iteration drop from 1 to 0. Heap pressure on long-running services drops. The ticker is also cleaner conceptually.

---

## Scenario 7 [S] — Replace Sleep-Based Throttle With A Real Rate Limiter

```go
for _, req := range requests {
    do(req)
    time.Sleep(100 * time.Millisecond) // 10 RPS throttle
}
```

### Diagnosis

The author wants to throttle to 10 RPS. The sleep is *between* calls but each `do(req)` takes some time `d`, so the effective rate is `1 / (0.1 + d)`. The achieved rate is less than 10 RPS by an unknown amount.

### Optimisation

Use `golang.org/x/time/rate`:

```go
limiter := rate.NewLimiter(rate.Limit(10), 1) // 10 RPS, burst 1
for _, req := range requests {
    if err := limiter.Wait(ctx); err != nil {
        return err
    }
    do(req)
}
```

### Result

Achieves true 10 RPS, accounting for `d`. Cancellable via context. Testable with a fake clock or `synctest`. Replaces hand-rolled timing.

---

## Scenario 8 [S] — Hedge A Tail-Sensitive Request

```go
func GetUserName(ctx context.Context, id string) (string, error) {
    // single attempt; p99 is 500ms even though p50 is 20ms
    return userService.Get(ctx, id)
}
```

### Diagnosis

A single attempt; tail latency dominates user experience. Even though typical calls are fast, p99 is slow because of straggler replicas.

### Optimisation

Add hedging:

```go
func GetUserName(ctx context.Context, id string) (string, error) {
    ctxA, cancelA := context.WithCancel(ctx)
    defer cancelA()
    ctxB, cancelB := context.WithCancel(ctx)
    defer cancelB()

    type result struct {
        name string
        err  error
    }
    results := make(chan result, 2)

    go func() {
        n, e := userService.Get(ctxA, id)
        results <- result{n, e}
    }()

    select {
    case r := <-results:
        cancelB()
        return r.name, r.err
    case <-time.After(50 * time.Millisecond):
    }

    go func() {
        n, e := userService.Get(ctxB, id)
        results <- result{n, e}
    }()

    r := <-results
    return r.name, r.err
}
```

### Result

p99 latency drops from 500ms to ~50ms + p50 = ~70ms. Resource cost: a few percent extra requests (only the slow ones get hedged).

The `time.After(50 * time.Millisecond)` here is acceptable: the 50ms is the SLO boundary at which the original request is deemed slow, a semantically meaningful duration.

---

## Scenario 9 [P] — Eliminate Synchronised Cache Refreshes

```go
func (c *Cache) RefreshLoop() {
    for {
        next := time.Now().Truncate(time.Hour).Add(time.Hour)
        time.Sleep(time.Until(next))
        c.refresh()
    }
}
```

### Diagnosis

All replicas refresh at the same wall-clock instant (top of the hour). Upstream is hit with N simultaneous requests, where N is the replica count.

Two problems to fix:

1. Sync instant → thundering herd.
2. Wall-clock based → DST/NTP issues.

### Optimisation

```go
func (c *Cache) RefreshLoop(ctx context.Context) {
    for {
        // refresh every hour ± 5 minutes of jitter
        jitter := time.Duration(rand.Int63n(int64(10 * time.Minute))) - 5*time.Minute
        d := time.Hour + jitter
        timer := time.NewTimer(d)
        select {
        case <-ctx.Done():
            timer.Stop()
            return
        case <-timer.C:
            c.refresh()
        }
    }
}
```

### Result

Refreshes spread over a 10-minute window. With 100 replicas, that is ~10 refreshes per minute instead of 100 in one second. Upstream load is smooth.

Also uses monotonic time (`time.NewTimer` uses runtime monotonic clock internally) and is cancellable.

---

## Scenario 10 [P] — Speed Up An Entire Test Suite With Synctest Adoption

### Context

A repository has 500 tests, each averaging 150ms because they contain a `time.Sleep` for cache expiry or retry timing. Suite runs in 75 seconds.

### Diagnosis

The same pattern is repeated across hundreds of tests. The author's options:

1. Refactor each test individually to use `Clock`. Linear effort but high coverage.
2. Adopt `synctest` and convert tests in bulk.

### Optimisation

Bulk-convert using a sed-like script (or `gopls`-based codemod):

For each test file, wrap the function body in `synctest.Test`:

```go
func TestThing(t *testing.T) {
    synctest.Test(t, func(t *testing.T) {
        // ... original body ...
    })
}
```

Tests that fail post-conversion (due to bubble incompatibility) get individual attention.

### Result

Tests with virtual-time sleeps run in microseconds. Suite drops from 75 seconds to ~5 seconds. Individual investigations:

- Tests that fail due to real network I/O get refactored to use mocks.
- Tests that fail due to OS-level I/O get isolated.
- A small number of tests resist conversion and stay slow — track them separately.

### Long-term

- Lint rule: `time.Sleep` in `_test.go` is forbidden except inside `synctest.Test` bubbles.
- Dashboard: count of non-bubble sleeps, trending to zero.

---

## How To Approach New Scenarios

When you find a sleep-based test in real code, follow this routine:

1. **Identify the event the sleep is waiting for.** Be specific: "the goroutine has called `Done`", "the cache entry has expired", "the retry has completed 3 attempts".
2. **Pick the primitive.** Refer to the middle.md playbook table.
3. **Refactor the test.** Add the safety timeout but eliminate the synchronisation sleep.
4. **Measure**. Run the test 1000 times under `-race` and varying GOMAXPROCS. Ensure zero failures.
5. **Measure wall time**. Compare before/after. The improvement is usually 100-10000x.

### When optimisation does not help

A few cases where removing the sleep does *not* speed things up:

- Tests bound by real I/O (databases, network) — they spend most of their time outside the sleep.
- Tests that use `synctest` cannot speed up the bubble's setup work (only the time-bound parts).
- Tests that use `assert.Eventually` with a small step are already nearly optimal.

In those cases, the speedup is small but the determinism improvement is huge.

### When optimisation reveals real bugs

Removing sleeps often surfaces hidden bugs:

- Production code that was relying on the sleep to "wake up" some other goroutine. The wake never happens deterministically; you discover a missing notification.
- Memory races that were masked because the sleep usually let the producer finish first. Now the race fires under `-race`.
- Goroutine leaks that were waiting "just long enough" for the sleep to extend the test, but leaked beyond. Now `goleak` catches them.

These are good. The optimisation has paid for itself many times over by exposing real defects.

---

## Summary

Optimisations against sleep-for-sync follow a pattern:

- Replace the sleep with a deterministic primitive.
- Add a safety timeout if the new primitive could hang.
- Run under `-race -count=N` to verify zero flakiness.
- Measure wall-time savings.

The wall-time wins are often 100-10000x. The flakiness wins are always to zero. The exposed bugs are bonus material.

Whichever scenarios you tackle, the underlying recipe is always:

> Wait for the *event* you actually care about, not for a duration that approximates when the event might happen.

Once that recipe is internalised, every sleep-based test in your career writes itself into a faster, deterministic version.
