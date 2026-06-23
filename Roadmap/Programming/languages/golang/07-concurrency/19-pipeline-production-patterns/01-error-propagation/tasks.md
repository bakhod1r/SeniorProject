---
layout: default
title: Tasks
parent: Error Propagation
grand_parent: Pipeline Production Patterns
ancestor: Go
nav_order: 8
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/19-pipeline-production-patterns/01-error-propagation/tasks/
---

# Error Propagation in Pipelines — Hands-on Tasks

> Exercises from easy to hard. Each task specifies what to build, success criteria, and a hint. Solution sketches at the end.

---

## Easy

### Task 1 — Basic errgroup pipeline

Write a function `Sum(ctx context.Context, nums []int) (int, error)` that:

- Spawns a producer goroutine that sends each number into a channel.
- Spawns a consumer goroutine that reads numbers and accumulates a total.
- Uses `errgroup` for coordination.
- Returns the total or an error.

Verify with `nums = []int{1, 2, 3, 4, 5}` returns 15.

**Hint.** Use `defer close(out)` in the producer. Use `for range` in the consumer.

---

### Task 2 — Return early on negative

Modify Task 1 so that if any number is negative, the producer returns an error wrapped with `%w` and a sentinel `ErrNegative`. The consumer should stop. The function should return 0 and the wrapped error.

Verify with `nums = []int{1, 2, -1, 4}` returns an error matching `errors.Is(err, ErrNegative)`.

**Hint.** Return the error from the producer's `g.Go` function. errgroup cancels the consumer via the context.

---

### Task 3 — Parallel HTTP fetch

Write `FetchAll(ctx context.Context, urls []string) ([]string, error)` that fetches each URL in parallel and returns the bodies in order.

- Use `errgroup` with `SetLimit(8)`.
- On first failure, all in-flight fetches are cancelled.
- Wrap errors with the URL so the caller knows which failed.

**Hint.** Use `http.NewRequestWithContext`. Results in a pre-allocated slice with goroutine writing to its index.

---

### Task 4 — Drain on cancellation

Write a pipeline where stage 1 produces 1000 items but stage 2 fails on item 500. Verify:

- The pipeline exits cleanly (no leaks).
- The error is propagated to the caller.
- Stage 1's goroutine actually exits (use `runtime.NumGoroutine` before and after).

**Hint.** `select` on `ctx.Done()` in the producer's send.

---

## Medium

### Task 5 — Per-item retry

Write a stage that processes items, each of which may transiently fail. Retry up to 3 times with exponential backoff. If all retries fail, return the error.

Use a fake `process` function that fails the first 2 times for each item, then succeeds.

**Hint.** Retry inside the goroutine; don't return from `g.Go` until retries are exhausted.

---

### Task 6 — Sentinel for skip

Write a pipeline where some items should be silently skipped (e.g., empty strings). Use a sentinel error `ErrSkip`. The middle stage returns `ErrSkip` for empty items; the next stage uses `errors.Is(err, ErrSkip)` to skip them, not fail the pipeline.

**Hint.** Don't return `ErrSkip` from `g.Go`; handle it inside the consuming stage.

---

### Task 7 — Fan-out with internal errgroup

Write a pipeline stage that consumes items from an input channel and produces results to an output channel. Internally, fan out to 4 workers. If any worker fails, the stage returns the error.

Use a nested `errgroup` inside the stage's goroutine.

**Hint.** `defer close(out)` runs after `inner.Wait()` returns.

---

### Task 8 — Aggregate errors

Write `ProcessAll(ctx context.Context, items []Item) error` that processes each item in parallel. Continue processing even if some items fail. Return all errors via `errors.Join`.

Verify with a mix of succeeding and failing items.

**Hint.** Return `nil` from each `g.Go`. Collect errors via a mutex.

---

### Task 9 — Stage attribution with typed error

Define a `*StageError{Stage string, Err error}`. Use it to wrap errors in each stage. The caller can `errors.As(err, &se)` to find which stage failed.

Write a pipeline with three stages: parse, transform, store. Each wraps errors in `*StageError` with its name.

**Hint.** Implement `Error()` and `Unwrap()` on the type.

---

### Task 10 — Context deadline

Add a `5 * time.Second` deadline to a pipeline that processes 100 items, each taking ~100ms. With workers=10, this should complete. With workers=1, it should hit the deadline.

Verify: the second case returns `errors.Is(err, context.DeadlineExceeded)`.

**Hint.** `context.WithTimeout`. `defer cancel()`.

---

## Hard

### Task 11 — Saga with compensating actions

Implement a saga with three steps and three compensators. If step 3 fails, run compensators 2 and 1 in reverse. Each compensator may also fail; collect those errors.

Use a slice of `Step{Forward, Compensate func(ctx) error}`.

**Hint.** Track which steps completed. On failure, iterate the completed list in reverse calling compensators.

---

### Task 12 — Saga with persistent state

Extend Task 11. Persist saga state to a database (or use an in-memory map for simplicity) after each step. If the process restarts mid-saga, resume from the saved state.

Verify: kill the process between steps, restart, observe completion.

**Hint.** Save state with each step. On startup, load incomplete sagas. Resume.

---

### Task 13 — Panic recovery

Write a pipeline where one stage may panic. Use `defer recover()` to convert the panic to an error returned by `g.Go`.

Verify: the panic doesn't crash the program; `g.Wait()` returns the panic-as-error; other stages exit cleanly.

**Hint.** Named return value lets `recover` set the error.

---

### Task 14 — Bulkhead per tenant

Write a pipeline processing items from N tenants. Each tenant has its own `errgroup` with `SetLimit(8)`. A failure in tenant A's pipeline does not affect tenant B's.

The top-level coordinator runs all tenants concurrently with another `errgroup`. Each tenant's failure is recorded but doesn't fail others.

**Hint.** Outer `errgroup` returns nil from `g.Go` to avoid cancellation.

---

### Task 15 — Circuit breaker

Implement a simple circuit breaker:

- Closed: requests pass.
- After 5 failures, open. Requests immediately return `ErrCircuitOpen`.
- After 30 seconds, half-open. One request passes; if succeeds, close; if fails, re-open.

Wire into a pipeline stage. Verify the breaker opens, fails fast, then recovers.

**Hint.** Atomic counters and a mutex.

---

### Task 16 — Dead-letter queue

Implement a DLQ for poison messages. After 3 retries, move the item to DLQ (an in-memory slice). The pipeline continues processing other items.

Verify: items in DLQ are recoverable; pipeline doesn't fail on poison messages.

**Hint.** DLQ is just a slice with a mutex. Caller can drain it after `g.Wait`.

---

### Task 17 — Streaming with cursor

Implement a stream consumer with cursor tracking. Process events; after each batch, persist the cursor. On restart, resume from the saved cursor.

Use channels for the stream; a fake source that produces events.

**Hint.** Persist cursor after every N events to limit data loss on crash.

---

### Task 18 — Hedged requests

Implement `HedgedFetch(ctx context.Context, urls []string) (string, error)` that fetches from multiple URLs concurrently. The first to succeed wins; others are cancelled.

If all fail, return `errors.Join` of all errors.

**Hint.** `context.WithCancel` per attempt; cancel siblings on first success.

---

### Task 19 — Streaming aggregation

Implement an `Aggregator` that:

- Reads events from an input channel.
- Buffers up to 100 events or 1 second.
- Flushes a batch to a downstream output channel.
- Errors during flush retry; if persistent, the batch goes to DLQ.

Verify with simulated input including bursts and pauses.

**Hint.** `time.NewTicker` for the 1-second flush.

---

### Task 20 — Full integration

Combine Tasks 7, 8, 11, 13, and 14 into one pipeline:

- Fan-out parsing.
- Aggregated per-item errors.
- Saga for multi-step business logic.
- Panic recovery in each stage.
- Per-tenant bulkheads.

A small but realistic production pipeline.

**Hint.** Build incrementally. Test each layer.

---

## Solution Sketches

### Task 1 sketch

```go
func Sum(ctx context.Context, nums []int) (int, error) {
    g, ctx := errgroup.WithContext(ctx)
    out := make(chan int)
    g.Go(func() error {
        defer close(out)
        for _, n := range nums {
            select {
            case <-ctx.Done(): return ctx.Err()
            case out <- n:
            }
        }
        return nil
    })
    var total int
    g.Go(func() error {
        for v := range out {
            total += v
        }
        return nil
    })
    if err := g.Wait(); err != nil { return 0, err }
    return total, nil
}
```

### Task 5 sketch

```go
func processWithRetry(ctx context.Context, it Item, maxAttempts int) error {
    var lastErr error
    for attempt := 0; attempt < maxAttempts; attempt++ {
        err := process(ctx, it)
        if err == nil { return nil }
        if !isTransient(err) { return err }
        lastErr = err
        wait := time.Duration(1<<attempt) * 100 * time.Millisecond
        select {
        case <-ctx.Done(): return ctx.Err()
        case <-time.After(wait):
        }
    }
    return fmt.Errorf("after %d attempts: %w", maxAttempts, lastErr)
}
```

### Task 11 sketch

```go
type Step struct {
    Forward    func(ctx context.Context) error
    Compensate func(ctx context.Context) error
}

func RunSaga(ctx context.Context, steps []Step) error {
    var completed []int
    for i, s := range steps {
        if err := s.Forward(ctx); err != nil {
            // rollback
            var compErrs []error
            for j := len(completed) - 1; j >= 0; j-- {
                if cerr := steps[completed[j]].Compensate(ctx); cerr != nil {
                    compErrs = append(compErrs, cerr)
                }
            }
            if len(compErrs) > 0 {
                return fmt.Errorf("saga failed: %w; rollback errors: %w",
                    err, errors.Join(compErrs...))
            }
            return fmt.Errorf("saga rolled back: %w", err)
        }
        completed = append(completed, i)
    }
    return nil
}
```

### Task 13 sketch

```go
g.Go(func() (err error) {
    defer func() {
        if r := recover(); r != nil {
            err = fmt.Errorf("panic: %v", r)
        }
    }()
    return riskyStage(ctx)
})
```

### Task 15 sketch

```go
type Breaker struct {
    mu       sync.Mutex
    failures int
    state    int // 0=closed, 1=open, 2=half-open
    openAt   time.Time
}

const (
    StateClosed = iota
    StateOpen
    StateHalfOpen
)

var ErrCircuitOpen = errors.New("circuit open")

func (b *Breaker) Call(ctx context.Context, fn func() error) error {
    b.mu.Lock()
    if b.state == StateOpen {
        if time.Since(b.openAt) > 30*time.Second {
            b.state = StateHalfOpen
        } else {
            b.mu.Unlock()
            return ErrCircuitOpen
        }
    }
    b.mu.Unlock()

    err := fn()
    b.mu.Lock()
    defer b.mu.Unlock()
    if err != nil {
        b.failures++
        if b.failures >= 5 {
            b.state = StateOpen
            b.openAt = time.Now()
        }
    } else {
        b.failures = 0
        b.state = StateClosed
    }
    return err
}
```

---

## Verification Tips

- Run with `-race`: `go test -race ./...`. Pipelines with hidden races fail.
- Run with deadline: cancel after 1 second; verify exit. Pipelines without cancellation honour fail.
- Run with `runtime.NumGoroutine()` checks: leak detection.
- Stress test: run 1000 times in a tight loop. Flaky behavior surfaces.

---

## Final Note

Pipeline correctness is hard. Each of these tasks isolates one concept. Master each before combining. The integration task (Task 20) tests whether you can compose without losing correctness.

These exercises mirror real production needs. The skills you build here transfer directly.

Good luck.

---

## Bonus Tasks

### Bonus 1 — Convert string-matched to typed errors

Given the following code:

```go
if err != nil && strings.Contains(err.Error(), "not found") {
    // handle not-found
}
```

Refactor to use `errors.Is(err, ErrNotFound)` with a proper sentinel. Identify where the wrap chain needs to be preserved.

### Bonus 2 — Find the goroutine leak

Given a pipeline that "works" but `runtime.NumGoroutine()` grows on each run, find the leak. Common causes:

- Missing `defer close(out)`.
- Producer ignores `ctx.Done()`.
- `g.Wait` never called.
- Goroutine spawned but not tracked.

### Bonus 3 — Stress test with random failures

Take any pipeline you've written. Add a `FaultInjector` that randomly fails 1% of operations. Run 1000 iterations. Verify:

- The pipeline never hangs.
- Errors are reported, never swallowed.
- No race detector warnings.

### Bonus 4 — Build a tiny errgroup from scratch

Implement `MiniGroup` with `Go`, `Wait`, and `WithContext` semantics. Compare to the real `errgroup`. Note differences.

### Bonus 5 — Test cancellation timing

Build a pipeline and verify that `Wait` returns within 100 ms of `cancel()` being called. If it takes longer, you have a non-cooperative stage.

---

## Discussion Topics

After completing the tasks, discuss with a peer:

1. Why do all production pipelines use `errgroup.WithContext` instead of bare `errgroup.Group{}`?
2. When would you NOT use first-error-wins?
3. How do you decide between `sync.Mutex` and `atomic` for aggregation?
4. What's the difference between a goroutine leak and a deadlock?
5. When does panic recovery improve robustness vs hide bugs?
6. How do you communicate that a compensator is idempotent in code?
7. What does it mean for an error to "cross a stage boundary"?
8. Why does `g.SetLimit` block `Go` calls instead of returning an error?
9. When should you nest errgroups vs flatten?
10. How do you test that a pipeline drains cleanly on cancellation?

These are open-ended. Answers vary by context.

---

## Common Mistakes to Avoid

When working through the tasks, watch for:

- Forgetting `defer close(out)` in producers.
- Forgetting `select` on `ctx.Done()` in sends.
- Capturing loop variables by reference (pre-Go 1.22).
- Returning before `g.Wait()`.
- Sharing state across goroutines without sync.
- Using `==` to compare wrapped errors.
- Recovery without logging.
- `SetLimit` after `Go`.

Each of these is a common bug. Practice catches them.

---

## Self-Evaluation Rubric

For each task you complete, ask:

- [ ] Does it pass `go test -race`?
- [ ] Does it exit promptly on cancellation (< 100 ms)?
- [ ] Are errors wrapped with `%w` at boundaries?
- [ ] Are sentinels defined at package level and documented?
- [ ] Does each channel have exactly one closer?
- [ ] Are all blocking ops cancellable?
- [ ] Are tests checking both happy path and failure?

If you can answer yes to all, the task is complete to senior standard.

---

## When Stuck

If a task isn't working:

1. **Re-read the relevant level file.** The patterns are explained there.
2. **Print state.** Log when goroutines start, finish, and what error they return.
3. **Use `runtime.NumGoroutine()`.** Before and after; see if leaks.
4. **Run with `-race`.** Hidden races may be the cause.
5. **Simplify.** Reduce to the smallest case that exhibits the bug.
6. **Ask.** A peer's fresh eyes often spot what you can't.

Concurrency bugs are notoriously hard. Don't be discouraged. Every senior engineer has spent hours on a bug that turned out to be a missing `<-ctx.Done()` case.

---

## Closing

These exercises mirror real production needs. After completing them, you should be able to:

- Write an error-propagating pipeline from blank file in 10 minutes.
- Spot common bugs in code review.
- Reason about edge cases (cancellation timing, partial failure, retries).
- Architect saga-based flows.
- Test failure paths comprehensively.

That is the working knowledge of pipeline error propagation in Go.

Keep practising. The next pipeline you write at work will be better than this one.
