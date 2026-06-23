---
layout: default
title: Tasks
parent: Wait for Empty Channel
grand_parent: Concurrency Anti-Patterns
ancestor: Go
nav_order: 7
permalink: /roadmap/programming-languages/golang/07-concurrency/15-concurrency-anti-patterns/05-wait-for-empty-channel/tasks/
---

# Wait-for-Empty-Channel — Hands-on Tasks

Eighteen tasks of increasing difficulty. Each task includes a starting prompt, success criteria, and hints. Work them in order; later tasks assume the skills from earlier ones.

Set up a fresh `tasks/` directory in your scratch workspace. Each task gets its own subdirectory.

---

## Task 1: Spot the Anti-Pattern (Warm-up)

**Prompt.** Given the code below, identify the anti-pattern, explain the race, and refactor.

```go
package main

import (
    "fmt"
    "time"
)

func main() {
    ch := make(chan int, 10)
    for i := 0; i < 10; i++ {
        go func(i int) {
            ch <- i * i
        }(i)
    }
    for len(ch) > 0 {
        time.Sleep(time.Millisecond)
        fmt.Println(<-ch)
    }
}
```

**Success criteria.**

- Explain the race in two sentences.
- Provide a refactored version that uses `sync.WaitGroup` and `range`.
- Test that the refactor prints all 10 values.

**Hints.** WaitGroup tracks producers; close-after-wait pattern.

---

## Task 2: Refactor a Worker Pool

**Prompt.** Refactor this worker pool to remove the polling.

```go
type Pool struct {
    jobs chan Job
}

func (p *Pool) Start(workers int) {
    for i := 0; i < workers; i++ {
        go func() {
            for {
                if len(p.jobs) == 0 {
                    return
                }
                j := <-p.jobs
                process(j)
            }
        }()
    }
}

func (p *Pool) Wait() {
    for len(p.jobs) > 0 {
        time.Sleep(time.Millisecond)
    }
}
```

**Success criteria.**

- Worker uses `for j := range p.jobs` instead of polling.
- `Wait` uses `sync.WaitGroup`.
- Pool's `Close` closes `jobs` to signal workers.
- Tests pass under `-race -count=100`.

**Hints.** Add a `WaitGroup` field; `Add(1)` per worker; `defer wg.Done()` inside.

---

## Task 3: Build a Drain Helper

**Prompt.** Implement a function `Drain(ch <-chan T) []T` that reads all values from a channel until it is closed and returns them.

**Success criteria.**

- The function does not poll `len(ch)`.
- It works for any channel type (use generics).
- Tests verify it returns exactly the values sent.
- Tests verify it blocks until the channel is closed.

**Hints.** A simple `for range` loop appending to a slice.

```go
func Drain[T any](ch <-chan T) []T {
    var out []T
    for v := range ch {
        out = append(out, v)
    }
    return out
}
```

---

## Task 4: Bounded Wait with Context

**Prompt.** Implement a function `WaitWithContext(ctx context.Context, wg *sync.WaitGroup) error` that returns nil when the WaitGroup is zero or the context's error if it cancels first.

**Success criteria.**

- No polling.
- Returns ctx.Err() on cancellation.
- Returns nil on WaitGroup completion.
- Tests cover both paths.

**Hints.** A separate goroutine watches the WaitGroup and closes a done channel. The main goroutine selects.

---

## Task 5: Audit a Codebase

**Prompt.** Pick any open-source Go project (or your own). Run:

```bash
grep -nR "for len(" --include="*.go" .
grep -nR "if len(.*ch.*)" --include="*.go" .
```

Identify three candidate instances of the polling pattern. For each:

- Determine if it is the anti-pattern or a legitimate use.
- If anti-pattern, design a refactor.
- If legitimate (e.g., metric gauge), explain why.

**Success criteria.**

- Write a short report with file:line references, classification, and rationale.
- Submit the report as a markdown document.

**Hints.** Look in older codebases for higher hit rates. Newer projects with active maintenance have fewer.

---

## Task 6: Refactor a Polling-Based Shutdown

**Prompt.** This service polls during shutdown. Refactor it.

```go
type Service struct {
    stop atomic.Int32
    jobs chan Job
}

func (s *Service) Run() {
    for {
        if s.stop.Load() == 1 {
            for len(s.jobs) > 0 {
                time.Sleep(time.Millisecond)
                <-s.jobs
            }
            return
        }
        select {
        case j := <-s.jobs:
            handle(j)
        default:
            time.Sleep(time.Millisecond)
        }
    }
}

func (s *Service) Stop() {
    s.stop.Store(1)
    for len(s.jobs) > 0 {
        time.Sleep(10 * time.Millisecond)
    }
}
```

**Success criteria.**

- Use `context.Context` for shutdown signaling.
- Use `sync.WaitGroup` for join.
- Workers loop with `select` on `ctx.Done()` and `s.jobs`.
- `Stop()` cancels the context, closes `s.jobs`, and waits for the WaitGroup.
- Tests pass under `-race`.

**Hints.** Use `errgroup` if you want error propagation as well.

---

## Task 7: Build a Settled-After-Quiet Helper

**Prompt.** Implement `WaitSettled(ctx context.Context, events <-chan struct{}, settle time.Duration) error` that returns when no event has arrived for `settle` duration.

**Success criteria.**

- Returns nil when settled.
- Returns ctx.Err() if ctx cancels.
- No polling; use `time.Timer` with `Reset`.

**Hints.**

```go
timer := time.NewTimer(settle)
for {
    select {
    case <-ctx.Done():
        return ctx.Err()
    case <-events:
        if !timer.Stop() {
            <-timer.C
        }
        timer.Reset(settle)
    case <-timer.C:
        return nil
    }
}
```

---

## Task 8: Implement a Countdown Latch

**Prompt.** Build a `Latch` type that starts at N and decrements via `CountDown()`. `Wait()` returns a channel that closes when the count reaches zero.

**Success criteria.**

- API: `New(n int) *Latch`, `CountDown()`, `Wait() <-chan struct{}`.
- Thread-safe.
- Once the latch reaches zero, future `CountDown` calls have no effect.
- Tests cover basic countdown, multiple waiters, and concurrent count-downs.

**Hints.** Use `atomic.Int32` and `sync.Once`.

---

## Task 9: Implement a Generic Worker Pool

**Prompt.** Build a worker pool with the API:

```go
type Pool[T any] struct { /* opaque */ }

func New[T any](ctx context.Context, workers int, handler func(context.Context, T) error) *Pool[T]
func (p *Pool[T]) Submit(ctx context.Context, item T) error
func (p *Pool[T]) Close() error
```

**Success criteria.**

- Constructor starts workers.
- `Submit` respects both the caller's context and the pool's context.
- `Close` closes the input channel, waits for workers, returns first error.
- No polling.
- Tests pass under `-race -count=100`.
- `goleak.VerifyTestMain` confirms no leaks.

**Hints.** Use `errgroup` internally.

---

## Task 10: Build a Cancellable Bounded Queue

**Prompt.** Build a generic queue with:

```go
type Queue[T any] struct { /* opaque */ }

func New[T any](capacity int) *Queue[T]
func (q *Queue[T]) Push(ctx context.Context, item T) error
func (q *Queue[T]) Pop(ctx context.Context) (T, error)
func (q *Queue[T]) Close()
func (q *Queue[T]) Drain() <-chan T
```

**Success criteria.**

- `Push` and `Pop` respect context.
- `Close` is idempotent.
- `Drain` returns the underlying channel for range iteration.
- After Close, Push returns an error.
- Tests pass under `-race`.

**Hints.** Use `sync.Once` for idempotent close.

---

## Task 11: Add Observability

**Prompt.** Take the worker pool from Task 9. Add:

- A gauge for in-flight count.
- A counter for processed messages.
- A counter for errors.
- A histogram for processing duration.

**Success criteria.**

- Use the `prometheus/client_golang` package.
- Metrics update with each operation.
- A `/metrics` endpoint exposes them.
- Tests verify metrics are emitted correctly.

**Hints.** Atomics for in-flight gauge; track time with `time.Since`.

---

## Task 12: Build a Graceful HTTP Server

**Prompt.** Build an HTTP server that:

- Listens on `:8080`.
- Has a `/work` endpoint that submits to a worker pool.
- Has a `/ready` and `/health` endpoint for Kubernetes.
- Handles SIGTERM and shuts down gracefully within 25 seconds.

**Success criteria.**

- All endpoints work.
- SIGTERM triggers a clean shutdown that drains in-flight work.
- No polling.
- Test with `kill -TERM <pid>` and confirm clean exit.

**Hints.** Use `signal.NotifyContext` and `http.Server.Shutdown`.

---

## Task 13: Detect the Anti-Pattern in CI

**Prompt.** Write a `go/analysis` pass that detects `for len(ch) > 0 { ... }` patterns where `ch` is a channel.

**Success criteria.**

- The pass identifies the pattern.
- It does not flag legitimate uses (e.g., reading a length for metrics).
- Integrate into a Makefile target: `make lint`.
- Tests cover both positive and negative cases.

**Hints.** Walk the AST. Check the type of the argument to `len`. Flag `for` statements with that as the condition.

---

## Task 14: Refactor a Pipeline

**Prompt.** Refactor this 3-stage pipeline to remove polling.

```go
func pipeline(input []int) []int {
    stage1 := make(chan int, len(input))
    stage2 := make(chan int, len(input))
    stage3 := make(chan int, len(input))

    for _, x := range input {
        stage1 <- x
    }

    go func() {
        for len(stage1) > 0 {
            v := <-stage1
            stage2 <- v + 1
        }
    }()

    go func() {
        for len(stage2) > 0 {
            v := <-stage2
            stage3 <- v * 2
        }
    }()

    var result []int
    for len(stage3) > 0 {
        result = append(result, <-stage3)
    }
    return result
}
```

**Success criteria.**

- Each stage uses range; no polling.
- Each stage closes its output channel when its input closes.
- The result has the same length as input.
- Tests pass under `-race -count=100`.

**Hints.** The producer of `stage1` should close it; each subsequent stage closes its output in a `defer`.

---

## Task 15: Build a Fan-Out / Fan-In

**Prompt.** Implement:

```go
func FanOut[T any](ctx context.Context, in <-chan T, workers int, fn func(T) T) <-chan T
```

That fans `in` out to `workers` goroutines running `fn`, then fans back into a single output channel.

**Success criteria.**

- The output channel closes when `in` is exhausted and all workers finish.
- No polling.
- Order is not preserved (parallelism).
- Tests verify all values pass through `fn`.

**Hints.** Use WaitGroup to wait for all workers; close after wait.

---

## Task 16: Write a Stress Test

**Prompt.** Take any of your refactored code from earlier tasks. Write a stress test that:

- Submits 100,000 jobs concurrently from 100 goroutines.
- Verifies all jobs are processed.
- Runs under `-race -count=10`.
- Completes within 30 seconds.

**Success criteria.**

- The test passes reliably.
- No leaked goroutines (verify with `goleak`).
- CPU usage is reasonable (the polling-free version should not peg cores).

**Hints.** Generate input slowly enough to not overflow buffers; use buffered channels of appropriate size.

---

## Task 17: Build an Observability Dashboard

**Prompt.** Take the worker pool from Task 11. Add:

- A Grafana dashboard JSON with panels for:
  - In-flight gauge over time.
  - Processed rate.
  - Error rate.
  - P99 processing duration.
  - Queue depth (if buffered).
- A README explaining each panel and the relevant SLO.

**Success criteria.**

- The dashboard imports cleanly into Grafana.
- All panels show meaningful data when the worker pool runs.
- README describes the alert conditions for each panel.

**Hints.** Use Prometheus queries with `rate()` and `histogram_quantile`.

---

## Task 18: Audit Shutdown Logic

**Prompt.** Audit the shutdown logic of any production-grade Go service you have access to (your own, open-source, or a sample). For each:

- Does it use `signal.NotifyContext` or equivalent?
- Does it call `http.Server.Shutdown` (or similar) with a deadline?
- Does it wait for worker pools to drain?
- Are there any polling loops in the shutdown path?
- Is the shutdown bounded by a known deadline less than `terminationGracePeriodSeconds`?

**Success criteria.**

- A written audit report covering at least 3 services.
- Each service has a "pass/fail" verdict on each criterion.
- For each fail, propose a specific fix.

**Hints.** Look in `main.go` and any `Shutdown` or `Close` methods. Trace the order of operations.

---

## Closing

These 18 tasks cover the spectrum from "spot the pattern" to "audit a production codebase." Working them in order builds the muscle memory.

Recommended pace: 2-4 tasks per week. After completing all 18, you should be able to:

- Recognise the anti-pattern instantly.
- Refactor any instance with confidence.
- Build polling-free utilities from scratch.
- Audit a codebase for the pattern.
- Set up tooling that prevents regression.

The discipline transfers. The same techniques apply to other concurrency anti-patterns.
