---
layout: default
title: Partial Cancellation — Tasks
parent: Partial Cancellation
grand_parent: Cancellation Deep
ancestor: Go
nav_order: 8
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/20-cancellation-deep/02-partial-cancellation/tasks/
---

# Partial Cancellation — Hands-on Tasks

> Practical exercises from easy to hard. Each task says what to build, what success looks like, and a hint or expected outcome. Solutions or solution sketches are at the end.

---

## Easy

### Task 1 — Basic detach

Write a program that:
1. Creates a parent context with `WithCancel`.
2. Calls `context.WithoutCancel(parent)`.
3. Cancels the parent.
4. Prints whether the detached context's `Err()` is nil.

The expected output is `<nil>`.

**Goal.** Verify that `WithoutCancel` breaks the cancellation chain.

---

### Task 2 — Preserving values

Write a program that:
1. Adds a value to a context with `WithValue`.
2. Detaches with `WithoutCancel`.
3. Reads the value from the detached context.

The value must be preserved.

**Goal.** Verify that values cross the detach boundary.

---

### Task 3 — Detach plus timeout

Write a function that takes a parent context and runs a 100ms sleep, but is cancellable via its own 50ms timeout. The parent's cancellation must not abort the sleep.

```go
func runDetached(parent context.Context) {
    ctx, cancel := context.WithTimeout(context.WithoutCancel(parent), 50*time.Millisecond)
    defer cancel()
    select {
    case <-time.After(100 * time.Millisecond):
        fmt.Println("slept full")
    case <-ctx.Done():
        fmt.Println("aborted at", time.Now())
    }
}
```

Test that parent cancellation does not affect the timing.

**Goal.** Practice the detach-then-bound idiom.

---

### Task 4 — Detached audit

Write an HTTP handler that:
1. Sends a response immediately.
2. Spawns a detached goroutine that prints "audit: <method> <path>" after a 200ms delay.

Verify that the audit runs even if you `curl --max-time 0.1` (which disconnects fast).

**Goal.** See partial cancellation in a realistic scenario.

---

### Task 5 — Done returns nil

Write a program that:
1. Creates a detached context.
2. Asserts `detached.Done() == nil`.
3. Tries a `select { case <-detached.Done(): default: }` and verifies the default branch is taken.

**Goal.** Confirm the nil-channel behaviour.

---

## Medium

### Task 6 — Recovery wrapper

Write a helper function `safeGo(name string, fn func())` that:
1. Spawns `fn` in a goroutine.
2. Recovers from any panic and logs it with the name.

Use it for a detached operation that panics. Verify the program does not crash.

```go
safeGo("audit", func() {
    panic("oops")
})
time.Sleep(100 * time.Millisecond)
```

**Goal.** Internalise the `defer recover()` pattern.

---

### Task 7 — Detached pool

Build a minimal detached pool with:
- 5 worker goroutines.
- A bounded queue of size 20.
- A `Submit(parent, name, fn)` method.
- A `Drain(ctx)` method that closes the queue and waits for workers.

Test by submitting 100 operations and draining.

**Goal.** Build the simplest production-shape pool.

---

### Task 8 — Detached with shutdown

Extend Task 7 so that each operation also listens to a process-shutdown channel. When the channel closes, in-flight operations should abort gracefully.

**Goal.** Practice coordinating multiple lifetimes.

---

### Task 9 — Errgroup plus detached

Build a workflow that:
1. Fans out two critical fetches using `errgroup.WithContext`.
2. Runs a best-effort log in a detached goroutine.

If either fetch fails, the errgroup cancels. The detached log should still complete.

**Goal.** Practice mixed lifetime fan-out.

---

### Task 10 — Singleflight with detach

Build a key-value loader using `singleflight`. The work function should use a detached context so that one caller's cancellation does not affect others.

Verify by simulating: two callers, one cancels immediately, the other completes successfully with the value.

**Goal.** See the singleflight detach pattern.

---

## Hard

### Task 11 — Drain with budget

Build a pool whose `Drain(ctx)` method:
1. Closes the work channel.
2. Waits for all in-flight operations.
3. Returns ctx.Err() if the deadline elapses before all complete.

Test with a pool of slow operations and a tight drain deadline. Verify that `Drain` returns the deadline error correctly.

**Goal.** Practice deadline-aware drain.

---

### Task 12 — Multi-tenant pool

Extend the pool to enforce per-tenant quotas. Each operation has a tenant key (from the context). The pool refuses submissions that would exceed the tenant's quota.

Test with two tenants, one within quota, one over quota.

**Goal.** Practice quota enforcement.

---

### Task 13 — DLQ on failure

Extend the pool to write permanently failed operations to a DLQ (a channel for the exercise). Verify that operations that fail all retries end up in the DLQ.

**Goal.** Practice failure handling.

---

### Task 14 — Saga with compensation

Build a 3-step saga where each step has a Do and Compensate function. If step 3 fails, the compensations for steps 1 and 2 must run detached. Test with a mock that fails step 3.

**Goal.** Practice saga + detached compensation.

---

### Task 15 — Observability

Add metrics, logging, and tracing to your detached pool:
- Counter for submissions/completions/failures.
- Histogram for duration.
- Structured log per operation.
- OpenTelemetry span linked to parent.

Verify by submitting 10 operations and inspecting the output.

**Goal.** Practice production-grade observability.

---

## Stretch

### Task 16 — Migration

Take an existing piece of code (real or hypothetical) that uses ad-hoc `go func` detached work. Migrate it to a platform pool. Document the before/after.

**Goal.** Practice the migration workflow.

---

### Task 17 — Backpressure

Build a system where the detached pool overflows to a durable queue (a file-backed queue, for the exercise). Verify that submission overflow writes to the queue and a separate worker drains it.

**Goal.** Practice the in-memory plus durable hybrid pattern.

---

### Task 18 — Linter

Build a small `go vet` plugin that flags `go func() { ... ctx ... }()` patterns in handler functions where `ctx` is not a detached context. (Use `golang.org/x/tools/go/analysis` if you want.)

**Goal.** Practice tooling around partial cancellation.

---

## Solutions / Sketches

### Solution sketch: Task 1

```go
package main

import (
    "context"
    "fmt"
)

func main() {
    parent, cancel := context.WithCancel(context.Background())
    detached := context.WithoutCancel(parent)
    cancel()
    fmt.Println("parent:", parent.Err())
    fmt.Println("detached:", detached.Err())
}
```

Output:
```
parent: context canceled
detached: <nil>
```

---

### Solution sketch: Task 7

```go
type Pool struct {
    work chan func()
    wg   sync.WaitGroup
}

func NewPool(workers int) *Pool {
    p := &Pool{work: make(chan func(), 20)}
    for i := 0; i < workers; i++ {
        p.wg.Add(1)
        go func() {
            defer p.wg.Done()
            for f := range p.work {
                f()
            }
        }()
    }
    return p
}

func (p *Pool) Submit(parent context.Context, name string, fn func(context.Context) error) error {
    wrapped := func() {
        ctx := context.WithoutCancel(parent)
        ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
        defer cancel()
        defer func() { recover() }()
        _ = fn(ctx)
    }
    select {
    case p.work <- wrapped:
        return nil
    default:
        return errors.New("queue full")
    }
}

func (p *Pool) Drain(ctx context.Context) error {
    close(p.work)
    done := make(chan struct{})
    go func() { p.wg.Wait(); close(done) }()
    select {
    case <-done:
        return nil
    case <-ctx.Done():
        return ctx.Err()
    }
}
```

---

### Solution sketch: Task 9

```go
g, gctx := errgroup.WithContext(parent)
g.Go(func() error { return fetchA(gctx) })
g.Go(func() error { return fetchB(gctx) })

detached := context.WithoutCancel(parent)
go bestEffortLog(detached)

err := g.Wait()
```

The detached goroutine is not part of the errgroup. If A or B fails, the errgroup cancels its context. The detached log is unaffected.

---

### Solution sketch: Task 10

```go
v, err, _ := sf.Do(key, func() (any, error) {
    ctx := context.WithoutCancel(parent)
    ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
    defer cancel()
    return load(ctx, key)
})
```

The work function detaches from any caller's context. One caller's cancellation does not affect the load.

---

### Solution sketch: Task 11

```go
func (p *Pool) Drain(ctx context.Context) error {
    close(p.work)
    done := make(chan struct{})
    go func() { p.wg.Wait(); close(done) }()
    select {
    case <-done:
        return nil
    case <-ctx.Done():
        return ctx.Err()
    }
}
```

Two-channel select: complete drain or deadline. Whichever fires first wins.

---

## Final Notes

Work through the easy and medium tasks at minimum. The hard tasks are valuable but take longer.

Reading code and writing code are different skills. Even if you have read the junior/middle/senior files end-to-end, building the pool yourself is what makes the patterns stick.

---

## Bonus Tasks

### Task 19 — Stop hook

Modify your pool so that submitting work returns a "stop" function. Calling stop before the work runs cancels its registration. Calling stop after the work runs is a no-op.

Test by submitting 10 operations, stopping 5 of them before they run, and verifying that only 5 complete.

**Goal.** Practice cancellable detached submissions.

---

### Task 20 — Inflight tracking

Add an `Inflight()` method to your pool that returns the current list of in-flight operations with their start times. Verify by checking the list during a slow operation.

**Goal.** Practice admin/observability APIs.

---

### Task 21 — Reset state on idle

If your pool's queue is empty for 60 seconds, log a "pool idle" message. If a submission arrives after idle, log "pool resuming." Useful for capacity planning.

**Goal.** Practice timer-driven state transitions.

---

### Task 22 — Per-operation retry policy

Allow each submission to specify its own retry count and backoff. Test with operations that have different policies.

**Goal.** Practice per-operation configuration.

---

### Task 23 — Cause inspection

After draining the pool, log the `Cause` of each failed operation. Verify that operations failed via deadline have `DeadlineExceeded` as the cause and operations failed via explicit cancel have `Canceled`.

**Goal.** Practice `context.Cause` usage.

---

### Task 24 — Bridging two pools

Build a system with two pools: a high-priority pool (10 workers) and a low-priority pool (50 workers). Critical operations go to the high-priority pool; routine ones to the low-priority. Test fairness.

**Goal.** Practice multi-tier scheduling.

---

### Task 25 — Visualisation

Build a small admin web page that shows the current state of the pool: queue depth, in-flight count, recent failures. Useful for debugging during incidents.

**Goal.** Practice operational tooling.

---

## Closing

Twenty-five tasks. Start with the easy ones; work up at your own pace. After task 15 you have a production-shape pool. After task 25 you have an admin-ready system.

The goal is not to do them all in a week. The goal is to do them well, one at a time, over a month or two. Internalising the patterns takes time and repetition.

Pick the next task that feels just-out-of-reach. Do it. Move on.
