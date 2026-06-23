---
layout: default
title: Tasks
parent: Backpressure
grand_parent: Production Patterns
ancestor: Go
nav_order: 8
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/18-production-patterns/01-backpressure/tasks/
---

# Backpressure — Hands-On Tasks

This page collects 18 practical exercises for building backpressure into Go programs. Each task is self-contained — you should be able to complete it in 20–60 minutes. Difficulty ranges from junior to senior.

Each task has:

- A statement.
- Acceptance criteria.
- Hints (peek only if stuck).
- A reference solution sketch.

Work through them in order; later tasks build on earlier ones.

---

## Task 1: Replace an unbounded queue (Junior)

### Statement

Given the following code with an unbounded slice queue, replace it with a bounded channel and verify the program no longer grows memory unboundedly.

```go
package main

import (
    "fmt"
    "sync"
    "time"
)

type Queue struct {
    mu    sync.Mutex
    items []int
}

func (q *Queue) Push(x int) {
    q.mu.Lock()
    q.items = append(q.items, x)
    q.mu.Unlock()
}

func (q *Queue) Pop() (int, bool) {
    q.mu.Lock()
    defer q.mu.Unlock()
    if len(q.items) == 0 {
        return 0, false
    }
    x := q.items[0]
    q.items = q.items[1:]
    return x, true
}

func main() {
    q := &Queue{}
    go func() {
        for i := 0; ; i++ {
            q.Push(i)
        }
    }()
    go func() {
        for {
            if _, ok := q.Pop(); ok {
                time.Sleep(time.Millisecond)
            }
        }
    }()
    time.Sleep(time.Second)
    q.mu.Lock()
    fmt.Println("queue size:", len(q.items))
    q.mu.Unlock()
}
```

### Acceptance criteria

- Memory stays bounded under any duration.
- Producer slows down to match consumer.
- Code reads cleanly.

### Hints

Use `make(chan int, N)` with a small N.

### Solution sketch

Replace `*Queue` with `chan int` of capacity 100. Producer sends with `ch <-`; consumer receives with `<-ch`. Memory is bounded at 100 × sizeof(int). Producer's send blocks when the channel is full — natural backpressure.

---

## Task 2: Three-way Submit (Junior)

### Statement

Write a `Pool` type that supports three submit methods:

- `Submit(j Job)` — blocks.
- `TrySubmit(j Job) bool` — returns false if full.
- `SubmitCtx(ctx, j Job) error` — blocks until accepted or context fires.

### Acceptance criteria

- All three methods compile and behave correctly.
- A test demonstrates each behaviour distinctly.

### Hints

Use one bounded channel internally. The three methods differ in their `select` usage.

### Solution sketch

```go
type Pool struct { jobs chan Job }
func (p *Pool) Submit(j Job) { p.jobs <- j }
func (p *Pool) TrySubmit(j Job) bool {
    select {
    case p.jobs <- j: return true
    default: return false
    }
}
func (p *Pool) SubmitCtx(ctx context.Context, j Job) error {
    select {
    case p.jobs <- j: return nil
    case <-ctx.Done(): return ctx.Err()
    }
}
```

---

## Task 3: HTTP Server With Admission Control (Junior)

### Statement

Build an HTTP server that:

- Accepts requests on `/`.
- Has a maximum of 50 concurrent handlers.
- Returns 503 when at capacity.
- Includes an `X-Inflight` response header with the current in-flight count.

### Acceptance criteria

- `curl -i http://localhost:8080/` shows the header.
- Load test (`hey -c 100 -n 1000 ...`) shows 503s when concurrency exceeds 50.
- Steady-state memory does not climb.

### Hints

Use a `chan struct{}` semaphore. Track in-flight count with `atomic.Int64`.

### Solution sketch

```go
var sem = make(chan struct{}, 50)
var inFlight atomic.Int64

func handler(w http.ResponseWriter, r *http.Request) {
    select {
    case sem <- struct{}{}:
        inFlight.Add(1)
        defer func() { <-sem; inFlight.Add(-1) }()
    default:
        http.Error(w, "busy", 503)
        return
    }
    w.Header().Set("X-Inflight", strconv.FormatInt(inFlight.Load(), 10))
    time.Sleep(100 * time.Millisecond)
    w.Write([]byte("ok"))
}
```

---

## Task 4: Drop Counter (Junior)

### Statement

Modify Task 3 so that 503 responses also increment a counter. Expose the counter via `/metrics` in plain text.

### Acceptance criteria

- After a load test, `/metrics` shows a positive `rejected_total`.
- Successful requests do not increment it.

### Hints

`atomic.Uint64` for the counter; `expvar` or a simple handler for `/metrics`.

### Solution sketch

```go
var rejected atomic.Uint64

// in 503 branch:
rejected.Add(1)

http.HandleFunc("/metrics", func(w http.ResponseWriter, r *http.Request) {
    fmt.Fprintf(w, "rejected_total %d\n", rejected.Load())
})
```

---

## Task 5: Send With Timeout (Junior)

### Statement

Write a function `SendWithTimeout(ch chan<- int, x int, d time.Duration) error` that:

- Sends `x` on `ch`.
- Returns `nil` if the send succeeds within `d`.
- Returns an error if not.

### Acceptance criteria

- Test for both branches.
- No goroutine leak when timeout fires.

### Hints

Use a derived context.

### Solution sketch

```go
func SendWithTimeout(ch chan<- int, x int, d time.Duration) error {
    ctx, cancel := context.WithTimeout(context.Background(), d)
    defer cancel()
    select {
    case ch <- x:
        return nil
    case <-ctx.Done():
        return ctx.Err()
    }
}
```

---

## Task 6: Drop-Oldest Latest-N Buffer (Middle)

### Statement

Build a buffer that always keeps the latest N items. New writes never block; old items are overwritten when full.

### Acceptance criteria

- `Push(x)` is non-blocking.
- After M > N pushes, the buffer contains items M-N+1 through M.
- Concurrent safe.

### Hints

Use a channel of capacity N. On full, pop one and retry.

### Solution sketch

```go
type LatestN struct { ch chan int }
func NewLatestN(n int) *LatestN { return &LatestN{ch: make(chan int, n)} }
func (l *LatestN) Push(x int) {
    for {
        select {
        case l.ch <- x: return
        default:
            select {
            case <-l.ch:
            default:
            }
        }
    }
}
```

---

## Task 7: Bounded Pipeline (Middle)

### Statement

Build a three-stage pipeline:

- Source: generates integers 0 to ∞.
- Square: squares each.
- Sink: prints (or stores) results.

Each stage has a bounded buffer of 4. The pipeline must respond to `context.Context` cancellation.

### Acceptance criteria

- Pipeline runs until context is cancelled, then all goroutines exit.
- Memory stays bounded.
- No goroutines leaked (test with `runtime.NumGoroutine` before and after).

### Hints

Each stage is a goroutine returning a `<-chan int`. Use `select` with `ctx.Done()` on every blocking operation.

### Solution sketch

```go
func source(ctx context.Context) <-chan int {
    out := make(chan int, 4)
    go func() {
        defer close(out)
        for i := 0; ; i++ {
            select {
            case out <- i:
            case <-ctx.Done(): return
            }
        }
    }()
    return out
}
func square(ctx context.Context, in <-chan int) <-chan int {
    out := make(chan int, 4)
    go func() {
        defer close(out)
        for x := range in {
            select {
            case out <- x*x:
            case <-ctx.Done(): return
            }
        }
    }()
    return out
}
```

---

## Task 8: Per-Tenant Queues (Middle)

### Statement

Build a service that accepts work tagged with a `Tenant` string. Each tenant has a private queue of capacity 16. A shared pool of 4 workers processes from all queues round-robin.

### Acceptance criteria

- One tenant flooding does not block others.
- Each tenant's drop counter is independent.

### Hints

Map of `string -> chan Job`. A dispatcher goroutine per tenant feeds the shared work channel.

### Solution sketch

See middle.md "Per-Tenant Queues" section.

---

## Task 9: Watermark-Based Shedding (Middle)

### Statement

Build a pool that:

- Has a queue of capacity 32.
- Starts shedding (returning false from Submit) when len(queue) > 24.
- Stops shedding when len(queue) < 12.

### Acceptance criteria

- Under sustained load, the queue oscillates between 12 and 24.
- Test verifies both transitions.

### Hints

`atomic.Bool` for the shedding flag.

### Solution sketch

```go
type WatermarkPool struct {
    jobs chan Job
    shed atomic.Bool
}
func (p *WatermarkPool) Submit(j Job) bool {
    n := len(p.jobs)
    if p.shed.Load() && n <= 12 { p.shed.Store(false) }
    if !p.shed.Load() && n >= 24 { p.shed.Store(true) }
    if p.shed.Load() { return false }
    select {
    case p.jobs <- j: return true
    default: return false
    }
}
```

---

## Task 10: Graceful Shutdown (Middle)

### Statement

Add a `Close(ctx)` method to the Pool from Task 2 that:

- Stops accepting new submits.
- Lets in-flight work finish.
- Returns when all workers exit OR ctx fires (whichever first).

### Acceptance criteria

- Tests: submit 10 jobs, call Close, verify all complete.
- Tests: submit 100 long jobs, call Close with 100ms ctx, verify it returns within ~100ms with an error.

### Hints

Use `atomic.Bool` for the closed flag, `sync.WaitGroup` for worker tracking.

### Solution sketch

See middle.md "Worker Pools That Mean It" section.

---

## Task 11: Adaptive Concurrency (Senior)

### Statement

Implement an AIMD-style adaptive concurrency limiter.

- Start with limit 10.
- Grow by 1 every 20 successes.
- Shrink to limit/2 on each failure.
- Floor at 1, ceiling at 100.

Expose `Acquire() bool` and `Release(success bool)`.

### Acceptance criteria

- Test: 100 successes raises limit by ~5.
- Test: 1 failure halves limit.
- Test: concurrent calls do not panic or race (run with `-race`).

### Hints

`sync.Mutex` around limit changes. Counter for successes.

### Solution sketch

See senior.md "Adaptive Concurrency: AIMD" section.

---

## Task 12: Token Bucket (Senior)

### Statement

Implement a token bucket rate limiter without using `golang.org/x/time/rate`.

- Configurable rate and capacity.
- `Allow() bool` — non-blocking check.
- `Wait(ctx) error` — block until token available or ctx fires.

### Acceptance criteria

- Test: over 1 second at rate=10, ~10 tokens are issued.
- Test: bursts up to capacity are allowed.
- Test: `Wait` respects ctx cancellation.

### Hints

Track tokens as float; refill based on elapsed time since last call.

### Solution sketch

See senior.md "Token Buckets and Leaky Buckets" section.

---

## Task 13: Hedged Reads (Senior)

### Statement

Implement a function that runs the same idempotent function on N replicas, waits `delay` between starts, returns the first successful result, and cancels the others.

### Acceptance criteria

- All goroutines exit after the function returns.
- Test: when one replica is slow, the function still returns quickly via a hedge.

### Hints

`context.WithCancel` for the outer cancellation. A buffered channel for results.

### Solution sketch

See senior.md "Hedged Requests and Speculative Execution" section.

---

## Task 14: Circuit Breaker (Senior)

### Statement

Build a circuit breaker with three states: closed, open, half-open.

- Closed: requests pass through; failures counted.
- After N failures in window: open. Requests fail immediately.
- After timeout: half-open. One test request allowed.
  - If it succeeds: close.
  - If it fails: re-open.

### Acceptance criteria

- Test each state transition.
- Concurrent-safe.

### Hints

`sync.Mutex` or `atomic.Int32` for state. `time.AfterFunc` for half-open transition.

### Solution sketch

```go
const (
    closed = iota
    open
    halfOpen
)
type Breaker struct {
    mu       sync.Mutex
    state    int
    failures int
    threshold int
    timeout  time.Duration
    openedAt time.Time
}
func (b *Breaker) Allow() bool { /* ... */ }
func (b *Breaker) Record(ok bool) { /* ... */ }
```

---

## Task 15: Pool With Metrics (Senior)

### Statement

Add Prometheus-style metrics to your worker pool from Task 10:

- `pool_submitted_total{result="accepted|rejected|dropped"}` counter.
- `pool_queue_depth` gauge.
- `pool_in_flight` gauge.
- `pool_submit_wait_seconds` histogram.

### Acceptance criteria

- Metrics endpoint serves them in Prometheus exposition format.
- Values change correctly during a load test.

### Hints

Use `github.com/prometheus/client_golang/prometheus`. Wrap the pool to record metrics around each submit.

---

## Task 16: Bulkhead Pool (Senior)

### Statement

Build a pool that supports multiple "classes" of work, each with its own concurrency limit. A class's overload does not affect others.

```go
pool := NewBulkhead(map[string]int{
    "critical": 16,
    "normal": 8,
    "batch": 2,
})
pool.Submit("critical", job)
```

### Acceptance criteria

- Per-class metrics.
- Test: filling "batch" does not block "critical".

### Hints

Map of class to semaphore. One worker pool per class, OR a shared pool with per-class semaphores.

---

## Task 17: Distributed Rate Limiter With Redis (Senior)

### Statement

Implement a distributed token bucket using Redis. Multiple processes call `Allow(key)`; the aggregate rate is globally bounded.

### Acceptance criteria

- Concurrent processes share the budget.
- Atomic check-and-decrement on Redis.
- Falls back gracefully if Redis is unreachable (you decide: fail-open or fail-closed; document).

### Hints

Lua script for atomicity. `EXPIRE` on the key.

### Solution sketch

See professional.md "Multi-Tier Global Rate Limits" and "Building a Concurrency-Limits-Style Library" sections.

---

## Task 18: End-to-End Backpressure Demo (Senior)

### Statement

Build a small demo that ties everything together:

- An HTTP server with admission control.
- A worker pool with adaptive concurrency.
- A circuit breaker on outbound calls to a (fake) downstream.
- Metrics endpoint with all relevant signals.
- Graceful shutdown on SIGINT.

Load-test it; observe behaviour under: (a) normal load, (b) 10× spike, (c) downstream slowdown.

### Acceptance criteria

- All three scenarios produce expected metric patterns.
- No leaks; graceful shutdown works.
- Memory stays bounded throughout.

### Hints

This is integration of tasks 3, 10, 11, 14, 15.

---

## Bonus Tasks (Stretch)

### Task 19: Vegas Limiter

Implement a Vegas-style limiter (latency-based) instead of AIMD. Compare behaviour under load.

### Task 20: SLO-Driven Limiter

Implement a limiter that targets a specific p99 latency SLO. It should increase concurrency when p99 is well under SLO and decrease when p99 exceeds it.

### Task 21: Coordinated Omission-Free Load Test

Write a load tester that generates requests at a *constant rate* regardless of response time. Compare its histogram to a naive synchronous load tester.

---

## Self-Evaluation

After completing these tasks, you should be able to:

- Replace any unbounded queue you encounter.
- Build a production-grade worker pool from scratch in under an hour.
- Write a backpressure-aware HTTP service.
- Choose between different load-shedding policies.
- Implement AIMD/Vegas adaptive concurrency.
- Build a token bucket from scratch.
- Reason about cross-service backpressure.
- Design a small distributed system with end-to-end backpressure.

If any of these feel uncertain, revisit the corresponding tasks and the relevant level pages.

---

## Reflection Prompts

- Which task was hardest? Why?
- Which task taught you something you did not know?
- Which backpressure pattern do you find yourself reaching for most often?
- Has a real project of yours suffered from missing backpressure? What would you change now?
- If you had to teach backpressure to a colleague, which task would you give them first?

Discussing these prompts with peers cements the learning. Solo reflection helps too.

---

## A Final Note

These tasks are scaffolds. The real test is applying these patterns to your own production code. Find one service in your codebase that lacks backpressure; add it. Measure before and after. The pattern is the lesson; the production application is the proof.
