---
layout: default
title: Cancellation Propagation — Middle
parent: Cancellation Propagation
grand_parent: Pipeline Production Patterns
ancestor: Go
nav_order: 3
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/19-pipeline-production-patterns/02-cancellation-propagation/middle/
---

# Cancellation Propagation — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Recap of Junior-Level Mechanics](#recap-of-junior-level-mechanics)
4. [Multi-Stage Pipelines: Threading the Context](#multi-stage-pipelines-threading-the-context)
5. [Cancel-on-Error with `errgroup`](#cancel-on-error-with-errgroup)
6. [Deadline Propagation](#deadline-propagation)
7. [Upstream and Downstream Cancellation in Detail](#upstream-and-downstream-cancellation-in-detail)
8. [Fan-Out with Coordinated Cancellation](#fan-out-with-coordinated-cancellation)
9. [Fan-In with Drain Semantics](#fan-in-with-drain-semantics)
10. [Context Trees in Real Applications](#context-trees-in-real-applications)
11. [`context.AfterFunc` and `WithCancelCause`](#contextafterfunc-and-withcancelcause)
12. [Cancellable I/O](#cancellable-io)
13. [Cancellation in Worker Pools](#cancellation-in-worker-pools)
14. [Pipeline Lifecycle Diagram](#pipeline-lifecycle-diagram)
15. [Patterns and Anti-Patterns](#patterns-and-anti-patterns)
16. [Testing Cancellation](#testing-cancellation)
17. [Performance Considerations](#performance-considerations)
18. [Common Mistakes at the Middle Level](#common-mistakes-at-the-middle-level)
19. [Tricky Questions](#tricky-questions)
20. [Cheat Sheet](#cheat-sheet)
21. [Summary](#summary)
22. [Further Reading](#further-reading)

---

## Introduction

At the junior level you learned how a single stage uses `select` and `ctx.Done()` to exit cleanly. Middle-level pipelines have multiple stages, fan-out workers, error propagation that triggers cancellation, deadlines that travel through the system, and shutdown protocols that drain in-flight work before terminating. The mechanics are the same — close a channel, propagate the close — but the wiring is more intricate.

This file covers:

- How to thread one `context.Context` through five or fifty stages without losing the cancellation path.
- How `errgroup` combines wait-for-all with cancel-on-error in a single primitive.
- How deadlines flow from the request boundary all the way to the deepest goroutine, including when child stages narrow the deadline further.
- The difference between upstream cancellation (source decides to stop) and downstream cancellation (sink decides to stop), and how the same primitive handles both.
- Fan-out cancellation: how N parallel workers all exit when one of them, or the controller, decides to stop.
- Fan-in cancellation: how a merge stage drains its inputs to allow upstream stages to exit.
- How to design a cancellation-aware worker pool that bounds concurrency, handles errors, and shuts down cleanly.
- Practical testing patterns to verify that no goroutine leaks under cancellation.

By the end of this file you should be able to design a pipeline whose every goroutine has a documented exit path, every block point has a `select` on cancellation, and every shutdown completes within a known time bound.

---

## Prerequisites

- The junior-level material on `context.Context`, done channels, and the cancellable stage template.
- Comfort with `select`, `for v := range ch`, `defer close(out)`, and `sync.WaitGroup`.
- Familiarity with closures and how loop variables interact with goroutine captures.
- Awareness that channels can be closed once and that closing broadcasts to all receivers.

A working knowledge of `golang.org/x/sync/errgroup` is helpful but not required — it is introduced here.

---

## Recap of Junior-Level Mechanics

Before diving in, the foundations in one box:

- `context.Context` carries a `Done()` channel that closes on cancellation, an `Err()` that reports why, and a `Deadline()` for time-based bounds.
- Every stage is a goroutine that owns its output channel; it closes the output in `defer` when it returns.
- Every blocking channel operation is wrapped in a `select` whose other case is `<-ctx.Done()`.
- `defer cancel()` is mandatory wherever `WithCancel`/`WithTimeout`/`WithDeadline` is called.
- A `range` over a channel exits when the channel closes. A stage that sees `ctx.Done()` returns, which fires `defer close(out)`, which makes the next stage's `range` exit.

These rules do not change at the middle level. What changes is the scale and the number of moving parts.

---

## Reframing: cancellation as a first-class part of pipeline design

At junior level cancellation feels like an extra concern bolted onto a pipeline. At middle level it should be the first thing you design. The right mental shift: a pipeline is a graph of stages connected by channels *and* by a shared cancellation signal. The channels carry data; the cancellation signal carries authority. Both flow through the system; without both, the pipeline is incomplete.

When you sketch a new pipeline on a whiteboard, draw two arrows between every pair of stages: a thick arrow for data and a thin arrow for `ctx.Done()`. The thin arrow does not literally connect stages — it is a shared channel that all stages select on — but visualising it makes the design explicit.

Three questions to ask while designing:

1. **Where does cancellation originate?** A signal handler? A deadline? An error from a stage? A user action? Often more than one.
2. **Who has authority to call `cancel`?** The orchestrator? Each stage? An external watcher? Authority should be narrow and explicit.
3. **What is the worst-case latency from cancel to fully stopped?** The sum over all stages of their per-item work plus their select latency.

If you can answer these three before writing code, the implementation falls out naturally. If you cannot, the pipeline will have at least one cancellation bug.

---

## Multi-Stage Pipelines: Threading the Context

A five-stage pipeline looks deceptively simple in the type signature:

```go
out5 := stage5(ctx, stage4(ctx, stage3(ctx, stage2(ctx, stage1(ctx)))))
```

The single `ctx` flows into every stage. Every stage runs as a goroutine. All five goroutines select on the same `ctx.Done()`. When cancel fires, every one of them exits on its next iteration. The chain unwinds naturally: stage1 closes its output, stage2's range ends, stage2 closes its output, and so on.

### A concrete example

```go
package main

import (
    "context"
    "fmt"
    "strings"
    "time"
)

func gen(ctx context.Context, lines []string) <-chan string {
    out := make(chan string)
    go func() {
        defer close(out)
        for _, l := range lines {
            select {
            case out <- l:
            case <-ctx.Done():
                return
            }
        }
    }()
    return out
}

func split(ctx context.Context, in <-chan string) <-chan string {
    out := make(chan string)
    go func() {
        defer close(out)
        for line := range in {
            for _, w := range strings.Fields(line) {
                select {
                case out <- w:
                case <-ctx.Done():
                    return
                }
            }
        }
    }()
    return out
}

func lower(ctx context.Context, in <-chan string) <-chan string {
    out := make(chan string)
    go func() {
        defer close(out)
        for w := range in {
            select {
            case out <- strings.ToLower(w):
            case <-ctx.Done():
                return
            }
        }
    }()
    return out
}

func unique(ctx context.Context, in <-chan string) <-chan string {
    out := make(chan string)
    go func() {
        defer close(out)
        seen := map[string]struct{}{}
        for w := range in {
            if _, ok := seen[w]; ok {
                continue
            }
            seen[w] = struct{}{}
            select {
            case out <- w:
            case <-ctx.Done():
                return
            }
        }
    }()
    return out
}

func print(ctx context.Context, in <-chan string) {
    for w := range in {
        select {
        case <-ctx.Done():
            return
        default:
        }
        fmt.Println(w)
    }
}

func main() {
    ctx, cancel := context.WithTimeout(context.Background(), 250*time.Millisecond)
    defer cancel()

    lines := []string{
        "The quick brown fox",
        "jumps over the lazy dog",
        "the quick brown fox",
    }

    print(ctx, unique(ctx, lower(ctx, split(ctx, gen(ctx, lines)))))
    fmt.Println("done:", ctx.Err())
}
```

Five stages: `gen`, `split`, `lower`, `unique`, `print`. The same `ctx` flows through all of them. If the 250 ms deadline fires before the pipeline completes, every stage exits on its next select; the pipeline drains and `main` prints the deadline error.

### Why the same context for every stage works

`ctx.Done()` is a single channel. When `cancel` fires, it closes once. Every goroutine that selects on it gets the same notification at the same time. There is no need to "fork" or "split" the context per stage; the broadcast is already broadcast. The context is the wire; the stages are the listeners.

If you do want to give a stage a tighter deadline than the rest, derive a child:

```go
func splitWithLimit(parent context.Context, in <-chan string) <-chan string {
    ctx, cancel := context.WithTimeout(parent, 50*time.Millisecond)
    defer cancel() // wait, this won't work — see below
    // ...
}
```

The trouble: the stage's goroutine outlives the function call. `defer cancel()` fires when the *function* returns, not when the *goroutine* returns. To make the per-stage deadline work, the cancel must live inside the goroutine and fire when the goroutine returns:

```go
func splitWithLimit(parent context.Context, in <-chan string) <-chan string {
    out := make(chan string)
    go func() {
        ctx, cancel := context.WithTimeout(parent, 50*time.Millisecond)
        defer cancel()
        defer close(out)
        // ... loop with ctx ...
    }()
    return out
}
```

The pattern: context creation lives where it can be cancelled at the right time. For pipeline-level cancellation, that is the orchestrator. For per-stage deadlines, it is inside each stage's goroutine.

---

## The "context per scope" design rule

When designing a multi-stage pipeline, choose the scope of each context deliberately. The rule of thumb:

- **One root context** at the top of the request or job. This is the source of authority for the entire operation.
- **One pipeline context** derived from the root, owned by the orchestrator. This is what every stage in the pipeline observes.
- **One per-stage context** *only when* a stage needs its own deadline or its own cancel reason. Otherwise, every stage shares the pipeline context.
- **One per-operation context** for each external call (DB, HTTP, RPC) with a tight timeout, derived from the pipeline context.

The picture:

```
   request context (deadline: 5s)
     └── pipeline context (errgroup)
           ├── stage 1
           ├── stage 2
           │     └── db query context (timeout: 200ms)
           └── stage 3
                 └── http call context (timeout: 500ms)
```

Every node is a context. Cancellation at any node cancels everything below. Deadlines are inherited and narrowed but not extended.

The trap: nesting more than necessary. Each derived context allocates memory and may add a goroutine watcher. A pipeline with 50 stages each deriving their own context for no reason is wasteful. Derive only when you need.

The other trap: nesting too little. A stage with a 5-minute work step inside a 5-second request context will be cancelled mid-step — that is fine, that is the contract. But if the stage's external call uses a separate background context, the call continues past the request deadline, defeating the purpose. Always derive call contexts from the pipeline context.

---

## Cancel-on-Error with `errgroup`

The single biggest middle-level upgrade: `golang.org/x/sync/errgroup`. It bundles three things:

1. A `WaitGroup`-like join.
2. A context that cancels when any goroutine returns a non-nil error.
3. A return of the first error.

### Basic usage

```go
import "golang.org/x/sync/errgroup"

g, ctx := errgroup.WithContext(parentCtx)
g.Go(func() error {
    return stageA(ctx)
})
g.Go(func() error {
    return stageB(ctx)
})
if err := g.Wait(); err != nil {
    return err
}
```

What this does:

1. `WithContext` creates a child context and stores a `cancel`.
2. Each `g.Go(f)` spawns a goroutine running `f`.
3. The first `f` to return a non-nil error triggers `cancel`, which closes `ctx.Done()`.
4. Every other goroutine running with `ctx` sees the cancel and exits.
5. `g.Wait()` blocks until every spawned goroutine returns, then returns the first error.

This is the answer to "how do I cancel my siblings when I fail?" and "how do I wait for all of them?" in one. It is the workhorse of every real Go pipeline.

### Replacing manual `WaitGroup + cancel` with `errgroup`

Before:

```go
ctx, cancel := context.WithCancel(parent)
defer cancel()
var wg sync.WaitGroup
var firstErr error
var errOnce sync.Once
wg.Add(2)
go func() {
    defer wg.Done()
    if err := stageA(ctx); err != nil {
        errOnce.Do(func() {
            firstErr = err
            cancel()
        })
    }
}()
go func() {
    defer wg.Done()
    if err := stageB(ctx); err != nil {
        errOnce.Do(func() {
            firstErr = err
            cancel()
        })
    }
}()
wg.Wait()
return firstErr
```

After:

```go
g, ctx := errgroup.WithContext(parent)
g.Go(func() error { return stageA(ctx) })
g.Go(func() error { return stageB(ctx) })
return g.Wait()
```

The same semantics, an order of magnitude less code, and harder to misuse.

### Combining `errgroup` with a worker pool

A common pattern: bounded concurrency over a stream of items, with cancellation on the first error.

```go
g, ctx := errgroup.WithContext(parent)
sem := make(chan struct{}, 10) // limit to 10 concurrent
for _, item := range items {
    item := item
    select {
    case sem <- struct{}{}:
    case <-ctx.Done():
        break
    }
    g.Go(func() error {
        defer func() { <-sem }()
        return process(ctx, item)
    })
}
if err := g.Wait(); err != nil {
    return err
}
```

A semaphore (buffered channel) caps concurrency; `errgroup` cancels and joins.

### `errgroup.SetLimit` (Go 1.20+)

The standard library now offers a built-in concurrency limit:

```go
g, ctx := errgroup.WithContext(parent)
g.SetLimit(10)
for _, item := range items {
    item := item
    g.Go(func() error {
        return process(ctx, item)
    })
}
return g.Wait()
```

`SetLimit(n)` makes `g.Go` block until fewer than `n` goroutines are running. No manual semaphore needed.

### `errgroup` and panics

If a function passed to `g.Go` panics, the panic propagates up through the goroutine and crashes the process by default. `errgroup` does not recover for you. If your work can panic, wrap it:

```go
g.Go(func() (err error) {
    defer func() {
        if r := recover(); r != nil {
            err = fmt.Errorf("panic: %v", r)
        }
    }()
    return risky(ctx)
})
```

The recovered panic becomes the returned error; the rest of the group cancels via the normal cancel-on-error mechanism.

---

## `errgroup` internals worth knowing

A short look at how `errgroup.Group` works. The relevant fields:

```go
type Group struct {
    cancel  func(error)
    wg      sync.WaitGroup
    sem     chan token
    errOnce sync.Once
    err     error
}
```

- `cancel` is the cancel function from `WithContext`.
- `wg` is the wait group for the spawned goroutines.
- `sem` is the optional semaphore from `SetLimit`.
- `errOnce` ensures only the first error is stored and `cancel` is called once.
- `err` is the captured first error.

When you call `g.Go(f)`:

1. If `sem != nil`, the call acquires a token (possibly blocking).
2. `g.wg.Add(1)` increments the wait group.
3. A goroutine is spawned that runs `f()`.
4. On return, if `f` returned an error, `errOnce.Do` captures it and calls `g.cancel`.
5. The semaphore token is released; `g.wg.Done()` decrements.

When you call `g.Wait()`:

1. `g.wg.Wait()` blocks until every spawned goroutine has returned.
2. The captured cancel is called with the error (so any external observers see cancellation).
3. The stored error is returned.

Key properties:

- The cancel is called *as soon as the first error is captured*, not at `Wait`. Siblings get the cancellation signal immediately.
- `Wait` always cancels, even if no error occurred (covered by `Wait`'s call to `g.cancel(g.err)` — passing `nil` is fine).
- Only the first error is reported. Subsequent errors are discarded.

The implication for design: if you need all errors, do not rely on `errgroup`. Collect them in a slice via a channel:

```go
errCh := make(chan error, len(items))
var wg sync.WaitGroup
for _, item := range items {
    item := item
    wg.Add(1)
    go func() {
        defer wg.Done()
        if err := process(ctx, item); err != nil {
            errCh <- err
        }
    }()
}
wg.Wait()
close(errCh)
var errs []error
for e := range errCh {
    errs = append(errs, e)
}
return errors.Join(errs...) // Go 1.20+
```

Verbose, but you get every error. `errors.Join` aggregates them into a single multi-error.

---

## Deadline Propagation

A request arrives with a deadline. That deadline must reach every operation the pipeline performs — every database query, every HTTP call, every internal stage. Deadline propagation is the discipline of carrying the deadline forward without losing it.

### The natural propagation path

```go
func handler(w http.ResponseWriter, r *http.Request) {
    ctx := r.Context() // may already have a deadline from upstream
    if err := work(ctx); err != nil { ... }
}

func work(ctx context.Context) error {
    return db.QueryContext(ctx, "SELECT ...")
}
```

The deadline travels through `ctx` automatically. Each function passes `ctx` to its callees; the callees check `ctx.Deadline()` and `ctx.Done()` as needed.

### Narrowing a deadline

A child operation should not exceed a slice of the parent deadline. To enforce:

```go
func work(parent context.Context) error {
    ctx, cancel := context.WithTimeout(parent, 100*time.Millisecond)
    defer cancel()
    return innerCall(ctx)
}
```

If `parent` has 500 ms remaining and this child has 100 ms, the child cancels at 100 ms — whichever deadline fires first. `WithTimeout` does not extend the parent; it cannot. The parent always wins.

### Why narrowing matters

Suppose a request has 1 second total. The pipeline does three sequential steps. Each step should not take more than, say, 300 ms; otherwise the request budget is blown by step 1 alone. Narrowing the per-step deadline enforces the budget:

```go
for _, step := range steps {
    stepCtx, cancel := context.WithTimeout(ctx, 300*time.Millisecond)
    if err := step(stepCtx); err != nil {
        cancel()
        return err
    }
    cancel()
}
```

Or simpler with `errgroup`:

```go
g, ctx := errgroup.WithContext(parent)
for _, step := range steps {
    step := step
    g.Go(func() error {
        c, cancel := context.WithTimeout(ctx, 300*time.Millisecond)
        defer cancel()
        return step(c)
    })
}
return g.Wait()
```

### Detecting "no deadline" in a context

`ctx.Deadline()` returns `(time.Time, bool)`. If the second value is false, there is no deadline. You can choose to enforce one:

```go
deadline, ok := ctx.Deadline()
if !ok {
    // no upstream deadline; install our own
    var cancel context.CancelFunc
    ctx, cancel = context.WithTimeout(ctx, 30*time.Second)
    defer cancel()
} else if time.Until(deadline) < 100*time.Millisecond {
    // not enough budget to do useful work; fail fast
    return errors.New("not enough time budget")
}
```

The second branch is the defensive read: if you arrive with less than 100 ms left, do not even start. This prevents partial work that will be cancelled mid-way.

### Deadlines that survive RPC boundaries

When the pipeline calls out to a remote service over gRPC, the gRPC client serialises the deadline in metadata. The remote server reconstructs a context with the same deadline. Cancellation also propagates: cancelling the client context closes the stream, the server sees it and cancels its own context.

HTTP/1.1 has no native deadline header, but the client's `http.Request` with a context will close the TCP connection on cancel, which the server's `r.Context()` sees as cancellation. This works for the most common case: a client that gives up on a request before the server is done.

For HTTP/2 the same TCP-level signalling applies, plus the framing supports stream RST that the server can detect explicitly.

---

## Deadline budgets and the "deadline accounting" pattern

A request that arrives with a 1-second deadline cannot afford to spend the full second on one step if it has three steps. Deadline accounting is the practice of dividing the budget among the steps and enforcing the per-step limit.

### Static allocation

The simplest scheme: assign a fixed budget to each step.

```go
func handle(parent context.Context) error {
    if err := stepA(withTimeout(parent, 200*time.Millisecond)); err != nil {
        return err
    }
    if err := stepB(withTimeout(parent, 300*time.Millisecond)); err != nil {
        return err
    }
    return stepC(withTimeout(parent, 500*time.Millisecond))
}

func withTimeout(parent context.Context, d time.Duration) context.Context {
    ctx, _ := context.WithTimeout(parent, d)
    // (Cancel deliberately discarded for brevity in this snippet —
    //  real code uses `ctx, cancel := ...; defer cancel()`.)
    return ctx
}
```

Total budget: up to 1 second. Each step has its own ceiling. If step A is slow, it cancels at 200 ms regardless of how much parent budget is left.

### Dynamic allocation

Sometimes you want to share unused budget. After step A finishes early, give the remainder to step B and C.

```go
func handle(parent context.Context) error {
    parentDeadline, ok := parent.Deadline()
    if !ok {
        return errors.New("no deadline")
    }
    if err := step(parent, "A"); err != nil {
        return err
    }
    if time.Now().After(parentDeadline) {
        return context.DeadlineExceeded
    }
    if err := step(parent, "B"); err != nil {
        return err
    }
    return step(parent, "C")
}
```

Here each step uses the parent's full remaining budget. The early-check after each step prevents wasted work. This is the "best-effort" style; steps that finish early benefit the next steps.

### Hybrid

A common production pattern: cap each step at a fraction of the parent budget.

```go
func budget(parent context.Context, fraction float64) (context.Context, context.CancelFunc) {
    deadline, ok := parent.Deadline()
    if !ok {
        return parent, func() {}
    }
    remaining := time.Until(deadline)
    return context.WithTimeout(parent, time.Duration(float64(remaining)*fraction))
}
```

`budget(parent, 0.5)` gives the next step half of the remaining parent budget. After three steps each taking 0.5 of the remainder, you've used 7/8 of the original. This protects against any single step monopolising the budget.

### When to skip deadlines entirely

Internal background tasks that should run "as long as it takes" often have no deadline. The cancellation primitive is still useful — they should stop on shutdown — but no timer. Use `context.WithCancel(parent)` without a timeout.

---

## Upstream and Downstream Cancellation in Detail

Junior-level material introduced the two directions. The mechanism is the same channel close, but the design implications differ.

### Downstream cancellation

The consumer at the end of the pipeline decides to stop. Examples:

- The HTTP client disconnected; `r.Context()` is cancelled.
- The user pressed `Ctrl-C`; `signal.NotifyContext` fires.
- A separate timer hit a deadline.

The cancel is at the bottom of the chain; the signal travels back up the wire. Upstream stages see `ctx.Done()` and exit, freeing the resources they held.

Downstream cancellation is the "normal" case. It is the model the standard library is built around: the caller cancels, the callee sees it.

### Upstream cancellation

A stage at the top of the pipeline decides to stop. Examples:

- The source database connection broke; the source stage cancels.
- The fan-out controller saw N errors and decides to bail.
- A configuration reload triggered the pipeline owner to cancel.

The cancel is at the top; downstream stages see `ctx.Done()` and exit. The remaining values in the channels are either drained by downstream or dropped on cancel.

Upstream cancellation also flows through `ctx`. The difference is policy: who has the authority to call `cancel`? In simple pipelines, only the orchestrator holds the cancel function. In richer pipelines, stages may hold a cancel and trigger it on error.

### Diagonal: middle stage cancels

A middle stage encounters an error and wants to cancel the rest:

```go
func middle(ctx context.Context, cancel context.CancelFunc, in <-chan int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for v := range in {
            if v < 0 {
                cancel() // upstream and downstream both stop
                return
            }
            select {
            case out <- v * 2:
            case <-ctx.Done():
                return
            }
        }
    }()
    return out
}
```

By calling `cancel()`, the middle stage triggers cancellation that flows to both producers (upstream) and consumers (downstream). The single `ctx.Done()` is observed by all of them.

This is why a context model is more flexible than a one-directional done channel: any participant can trigger cancellation, and the same wire delivers the message in either direction.

---

## Authority and trust: who is allowed to cancel?

In small pipelines, the orchestrator (the function that built the pipeline) is the only one who calls `cancel`. In larger pipelines, multiple participants may have authority. Three patterns:

### Orchestrator-only authority

```go
ctx, cancel := context.WithCancel(parent)
defer cancel()
go stage(ctx, ...) // stage does not see cancel
```

Stages do not receive the cancel function; they only observe `ctx.Done()`. This is the strictest model: cancellation is centralised. If a stage encounters an error, it must signal up through its return value or an error channel; the orchestrator decides whether to cancel.

### Shared authority

```go
ctx, cancel := context.WithCancel(parent)
defer cancel()
go stage(ctx, cancel, ...) // stage can trigger cancel
```

Stages receive the cancel and may trigger it on internal errors. This is the `errgroup` model implicitly: every `g.Go` function effectively holds the cancel because returning a non-nil error invokes it.

Shared authority is convenient but it expands the trust surface. Any stage can shut down the whole pipeline; bugs in any stage can lead to spurious cancellations. Document carefully who is allowed to cancel and on what conditions.

### Hierarchical authority

```go
ctx, cancel := context.WithCancel(parent)
defer cancel()

subCtx, subCancel := context.WithCancel(ctx)
defer subCancel()
go subStage(subCtx, subCancel, ...) // can only cancel the sub-tree
```

The sub-stage cancels its own sub-context but cannot affect siblings or the parent. This is the structured-concurrency pattern; explored in depth at senior level.

The choice of authority model is an architectural decision. For most middle-level pipelines, `errgroup`'s implicit shared authority (every goroutine can return an error, which cancels) is the right balance.

---

## Fan-Out with Coordinated Cancellation

Fan-out: one producer feeds N workers, each processing items in parallel. The output may merge back (fan-in) or remain N separate streams. Cancellation must reach every worker.

### Bounded fan-out with `errgroup` and `SetLimit`

```go
func processAll(ctx context.Context, items []Item) error {
    g, ctx := errgroup.WithContext(ctx)
    g.SetLimit(8)
    for _, item := range items {
        item := item
        g.Go(func() error {
            return process(ctx, item)
        })
    }
    return g.Wait()
}
```

Eight workers maximum. Each runs `process(ctx, item)`. If any returns an error, `errgroup` cancels `ctx`; remaining workers see `ctx.Done()` and exit (assuming `process` respects context, which it must).

### Fan-out from a channel source

```go
func fanOut(ctx context.Context, in <-chan Item, workers int) error {
    g, ctx := errgroup.WithContext(ctx)
    for i := 0; i < workers; i++ {
        g.Go(func() error {
            for item := range in {
                if err := process(ctx, item); err != nil {
                    return err
                }
                if ctx.Err() != nil {
                    return ctx.Err()
                }
            }
            return nil
        })
    }
    return g.Wait()
}
```

The shared input channel `in` feeds all workers. Each worker ranges over `in`; when `in` closes (upstream is done), each worker's range exits and the worker returns. On error or cancel, the `ctx.Err()` check inside the loop catches the cancellation.

Note: `for item := range in` does not natively check `ctx.Done()`. If `in` never closes and we cancel, workers may block on the next receive. The cure is to make the receive itself a `select`:

```go
for {
    select {
    case <-ctx.Done():
        return ctx.Err()
    case item, ok := <-in:
        if !ok {
            return nil
        }
        if err := process(ctx, item); err != nil {
            return err
        }
    }
}
```

This is the canonical worker loop. Always.

### What happens to the source on cancel

If the source is a separate goroutine producing into `in`, it must also respect `ctx`. The same template:

```go
func source(ctx context.Context, items []Item) <-chan Item {
    out := make(chan Item)
    go func() {
        defer close(out)
        for _, item := range items {
            select {
            case out <- item:
            case <-ctx.Done():
                return
            }
        }
    }()
    return out
}
```

On cancel, the source returns, closes `out`, and the worker ranges exit.

---

## Fan-out with results

When fan-out workers produce results, you need a single result channel and a coordinated closer.

```go
func fanOutWithResults(ctx context.Context, items []Item, workers int) ([]Result, error) {
    g, ctx := errgroup.WithContext(ctx)
    in := make(chan Item)
    out := make(chan Result)

    // feeder
    g.Go(func() error {
        defer close(in)
        for _, item := range items {
            select {
            case in <- item:
            case <-ctx.Done():
                return ctx.Err()
            }
        }
        return nil
    })

    // workers
    var wg sync.WaitGroup
    wg.Add(workers)
    for i := 0; i < workers; i++ {
        g.Go(func() error {
            defer wg.Done()
            for item := range in {
                r, err := process(ctx, item)
                if err != nil {
                    return err
                }
                select {
                case out <- r:
                case <-ctx.Done():
                    return ctx.Err()
                }
            }
            return nil
        })
    }

    // closer
    go func() {
        wg.Wait()
        close(out)
    }()

    // collector
    var results []Result
    for r := range out {
        results = append(results, r)
    }
    if err := g.Wait(); err != nil {
        return nil, err
    }
    return results, nil
}

func process(ctx context.Context, i Item) (Result, error) { return Result{}, nil }

type Item struct{}
type Result struct{}
```

Trace:

1. The feeder pushes items into `in` until it is done or cancelled, then closes `in`.
2. Workers range `in`, process, push results into `out`.
3. The closer waits for all workers (via `wg`) and closes `out`.
4. The collector ranges over `out` and accumulates results.
5. After the range exits, `g.Wait` returns the first error (or nil).

On cancellation, every stage's `select` picks `<-ctx.Done()` and returns. The feeder closes `in`; workers' ranges end; the closer closes `out`; the collector's range ends. Clean cascade.

The two wait groups (`g.wg` from errgroup, plus the manual `wg` for closing `out`) coexist. The manual `wg` is only for ordering the close; the `errgroup` `g.wg` is for the overall error join.

---

## Fan-In with Drain Semantics

Fan-in: N producers feed into a single output channel. The standard pattern:

```go
func merge(ctx context.Context, ins ...<-chan int) <-chan int {
    out := make(chan int)
    var wg sync.WaitGroup
    wg.Add(len(ins))
    for _, in := range ins {
        go func(in <-chan int) {
            defer wg.Done()
            for v := range in {
                select {
                case out <- v:
                case <-ctx.Done():
                    return
                }
            }
        }(in)
    }
    go func() {
        wg.Wait()
        close(out)
    }()
    return out
}
```

Each input has a forwarder goroutine. They all write into `out`. A separate closer waits for all of them and closes `out`.

### Why the closer is separate

Multiple goroutines cannot safely close the same channel — the second `close` panics. The convention is: any goroutine that writes to a shared channel does *not* close it; one designated closer (or a `WaitGroup`-coordinated closer) does.

### What does cancel mean for fan-in?

When `cancel` fires:

1. Every forwarder's `select` may pick `<-ctx.Done()` instead of the send. The forwarder returns.
2. `defer wg.Done()` runs for each forwarder.
3. The closer's `wg.Wait()` unblocks.
4. `close(out)` runs.
5. Downstream ranges over `out` exit.

The forwarders may have values in their input that are not delivered. That is the price of cancellation — drop the in-flight work. If you need to deliver every item, you need a different protocol (covered at senior level).

### A fan-in that drops cancelled inputs cleanly

```go
func mergeCancellable(ctx context.Context, ins ...<-chan int) <-chan int {
    out := make(chan int)
    var wg sync.WaitGroup
    wg.Add(len(ins))
    for _, in := range ins {
        go func(in <-chan int) {
            defer wg.Done()
            for {
                select {
                case <-ctx.Done():
                    return
                case v, ok := <-in:
                    if !ok {
                        return
                    }
                    select {
                    case out <- v:
                    case <-ctx.Done():
                        return
                    }
                }
            }
        }(in)
    }
    go func() {
        wg.Wait()
        close(out)
    }()
    return out
}
```

The full template, with both the receive and the send guarded. This is what production fan-in code looks like.

---

## Context Trees in Real Applications

A real application has a context tree. The root is `context.Background()` at the top of `main`. Below it:

- A signal-cancellable context for the whole process.
- A per-request context for each HTTP/gRPC handler.
- Per-stage contexts within each pipeline.
- Per-operation contexts for database queries with their own timeouts.

```
Background
  └── signal-cancel (SIGTERM, SIGINT)
       └── http-request-1 (deadline from header)
       │     ├── pipeline (errgroup)
       │     │     ├── stage A
       │     │     └── stage B
       │     │           └── db.QueryContext (timeout 100ms)
       │     └── http-call-to-backend
       └── http-request-2
             └── ...
```

Cancelling at any node cancels everything below. A `SIGTERM` cancels every request. A request deadline cancels its pipeline. A stage error cancels its siblings.

### Owning the cancel function

The function that creates a node also owns the cancel function. By convention, the owner calls `defer cancel()`. Passing the cancel to a callee is allowed but should be explicit and documented — it transfers ownership of the cancel.

### Long-lived background contexts

Some pipelines outlive any single request — background workers, reconciliation loops, scheduled tasks. They use a long-lived context, often the signal-cancel context, so they stop on shutdown:

```go
func runWorker(ctx context.Context) {
    for {
        select {
        case <-ctx.Done():
            return
        case <-time.After(time.Minute):
            doScheduledWork(ctx)
        }
    }
}
```

The worker exits cleanly on `SIGTERM` because `ctx` is the signal-cancellable context from `main`.

---

## `context.AfterFunc` and `WithCancelCause`

Go 1.21 added two useful helpers.

### `context.AfterFunc`

Registers a callback that runs when a context is cancelled.

```go
stop := context.AfterFunc(ctx, func() {
    metrics.IncCancellations()
    log.Println("pipeline cancelled")
})
defer stop()
```

`AfterFunc` runs the callback in a goroutine when `ctx` is cancelled. `stop()` unregisters the callback (and returns true if it was unregistered before it fired). This is cleaner than spawning a watcher goroutine yourself.

Use it for side effects on cancellation: metrics, logs, releasing external resources. Do *not* use it for the main shutdown logic — that should be in the stages that use `ctx`.

### `context.WithCancelCause`

Cancels with a custom error reason.

```go
ctx, cancel := context.WithCancelCause(parent)
defer cancel(nil)

// when an error occurs:
cancel(fmt.Errorf("upstream failed: %w", err))

// elsewhere:
if err := context.Cause(ctx); err != nil {
    return fmt.Errorf("pipeline aborted: %w", err)
}
```

`ctx.Err()` still returns `context.Canceled`, but `context.Cause(ctx)` returns the original error. This is the cleanest way to surface "why we cancelled" through a pipeline.

`errgroup` does not yet integrate with `WithCancelCause` (as of Go 1.22), but you can compose the two:

```go
ctx, cancelCause := context.WithCancelCause(parent)
defer cancelCause(nil)

g, gctx := errgroup.WithContext(ctx)
g.Go(func() error {
    if err := work(gctx); err != nil {
        cancelCause(err) // remember why
        return err
    }
    return nil
})
err := g.Wait()
if err != nil {
    return fmt.Errorf("cause: %w", context.Cause(ctx))
}
return nil
```

Verbose, but the error reason survives the cancellation cascade.

---

## Cancellation in pipelines that read from streams

A common shape: the source reads from an `io.Reader`, a network connection, or a database cursor. Cancellation of the read is harder than cancellation of a `select`.

### Reading from `io.Reader` with cancellation

The naive code:

```go
buf := make([]byte, 4096)
for {
    n, err := r.Read(buf)
    if err != nil {
        return err
    }
    process(buf[:n])
}
```

`r.Read` blocks until data arrives or the underlying source errors. It does not check `ctx.Done()`. If the source is a network connection, you can call `conn.SetReadDeadline(time.Now())` from a watcher goroutine to interrupt the read.

```go
go func() {
    <-ctx.Done()
    conn.SetReadDeadline(time.Now())
}()
for {
    n, err := conn.Read(buf)
    if err != nil {
        if errors.Is(err, os.ErrDeadlineExceeded) {
            return ctx.Err()
        }
        return err
    }
    process(buf[:n])
}
```

The watcher goroutine sets the deadline to the past, causing the next `Read` to return `os.ErrDeadlineExceeded`. The caller maps that to the context error and returns.

For pipes and files that do not support deadlines, you cannot interrupt a blocked `Read`. The least-bad option is to close the underlying file from the watcher:

```go
go func() {
    <-ctx.Done()
    f.Close()
}()
```

`f.Close` makes the next read return an error. The pipeline sees the error and exits. The downside: the file is closed even if you wanted to reuse it. Treat this as a forceful cancellation, not graceful.

### Reading from a database cursor

`sql.Rows` is cancellable if the parent query used `QueryContext`. Once the context cancels, the driver aborts the query and the next `rows.Next()` returns false; `rows.Err()` returns the cancellation reason.

```go
rows, err := db.QueryContext(ctx, query)
if err != nil {
    return err
}
defer rows.Close()
for rows.Next() {
    var v int
    if err := rows.Scan(&v); err != nil {
        return err
    }
    process(v)
}
return rows.Err()
```

`rows.Err()` returns `nil` on clean completion, `context.Canceled` or `context.DeadlineExceeded` on cancellation, or a driver error.

### Reading from an HTTP response body

```go
req, _ := http.NewRequestWithContext(ctx, "GET", url, nil)
resp, err := http.DefaultClient.Do(req)
if err != nil {
    return err
}
defer resp.Body.Close()
buf := make([]byte, 4096)
for {
    n, err := resp.Body.Read(buf)
    if err != nil {
        if err == io.EOF {
            return nil
        }
        return err
    }
    process(buf[:n])
}
```

If `ctx` cancels mid-stream, `resp.Body.Read` returns `context.Canceled` (or wraps it). The transport closes the underlying connection.

The pattern: always create the request with `NewRequestWithContext`, never with the bare `NewRequest`. The latter has no cancellation hook.

### Reading from a streaming gRPC call

gRPC server streams are inherently cancellable. The context passed in is closed when the client cancels or the deadline fires. Inside the server handler:

```go
func (s *server) Stream(req *pb.Req, stream pb.Service_StreamServer) error {
    ctx := stream.Context()
    for {
        select {
        case <-ctx.Done():
            return ctx.Err()
        case event := <-source:
            if err := stream.Send(event); err != nil {
                return err
            }
        }
    }
}
```

The `Send` itself returns an error if the client cancelled; the explicit `<-ctx.Done()` is an extra safety net.

---

## Cancellable I/O

A pipeline that calls out to I/O — database, HTTP, file, gRPC — must use the context-aware variant of every call. Otherwise cancellation only stops the pipeline's *control flow*; the I/O calls themselves continue.

### Database

```go
rows, err := db.QueryContext(ctx, query, args...)
```

If `ctx` cancels mid-query, the driver issues a cancel to the database (Postgres: `PQcancel`; MySQL: kill query) and returns `context.Canceled`. Always use `QueryContext`, `ExecContext`, `BeginTx` (which accepts a context).

### HTTP

```go
req, _ := http.NewRequestWithContext(ctx, "GET", url, nil)
resp, err := http.DefaultClient.Do(req)
```

If `ctx` cancels mid-request, the transport closes the connection. The response body's `Read` returns `context.Canceled`.

### gRPC

```go
resp, err := client.Method(ctx, req)
```

If `ctx` cancels, the framework sends a `RST_STREAM` and the server's `ctx` also cancels. Symmetric cancellation across the wire.

### File I/O

`os.File` does not accept a context directly. To make file reads cancellable, you have two options:

1. Use `io.Reader` with a `select`-wrapped `Read` (as shown in the junior file). The underlying read still completes; only the calling goroutine sees the cancel. The OS may eventually close the FD when the parent process exits or when you call `f.Close()`.
2. Use `os/exec.CommandContext` (for child processes) which kills the child on cancel.

In general, file I/O is the weak link in cancellable pipelines. Be aware of it.

### Network connections

`net.Dialer.DialContext` accepts a context; `net.Conn.SetDeadline` accepts a time. The latter is useful for retro-fitting cancellation: a watcher goroutine watches `ctx.Done()` and calls `conn.SetReadDeadline(time.Now())` to force an I/O error.

```go
go func() {
    <-ctx.Done()
    conn.SetReadDeadline(time.Now())
}()
```

The next `conn.Read` returns immediately with a timeout error. The watcher exits; the read function returns; the caller sees cancellation.

---

## Cancellation in Worker Pools

A worker pool: N long-lived workers pull from a job channel, process, and may emit results.

### Template

```go
type Pool struct {
    jobs    chan Job
    results chan Result
    ctx     context.Context
    cancel  context.CancelFunc
    wg      sync.WaitGroup
}

func NewPool(parent context.Context, workers int, buf int) *Pool {
    ctx, cancel := context.WithCancel(parent)
    p := &Pool{
        jobs:    make(chan Job, buf),
        results: make(chan Result, buf),
        ctx:     ctx,
        cancel:  cancel,
    }
    p.wg.Add(workers)
    for i := 0; i < workers; i++ {
        go p.worker()
    }
    go func() {
        p.wg.Wait()
        close(p.results)
    }()
    return p
}

func (p *Pool) worker() {
    defer p.wg.Done()
    for {
        select {
        case <-p.ctx.Done():
            return
        case j, ok := <-p.jobs:
            if !ok {
                return
            }
            r := process(p.ctx, j)
            select {
            case p.results <- r:
            case <-p.ctx.Done():
                return
            }
        }
    }
}

func (p *Pool) Submit(j Job) error {
    select {
    case p.jobs <- j:
        return nil
    case <-p.ctx.Done():
        return p.ctx.Err()
    }
}

func (p *Pool) Close() {
    close(p.jobs)
    p.cancel()
}

func (p *Pool) Results() <-chan Result {
    return p.results
}

type Job struct{}
type Result struct{}

func process(ctx context.Context, j Job) Result { return Result{} }
```

Walking through the cancellation paths:

- `Submit` is cancellable: if the pool is shutting down, it returns an error rather than blocking on the jobs channel.
- Each worker selects on `ctx.Done()` and on the jobs channel; on cancel, it returns.
- The producer (whoever calls `Submit`) is responsible for not submitting after `Close`.
- `Close` cancels the context (so workers stop accepting new jobs) and closes the jobs channel (so workers exit their loop).
- The closer goroutine waits for all workers and closes `results`.

This is the minimal pattern. Real pools add metrics, retries, timeouts, and back-pressure.

### Graceful close vs forceful close

`Close` as written stops the pool. But what about in-flight jobs? The workers may be in `process(p.ctx, j)` when `cancel` fires. If `process` respects context, it returns mid-work. If not, it runs to completion and then the worker sees the cancel.

For graceful shutdown — finish current jobs but accept no new ones — split the two signals:

```go
func (p *Pool) Drain() {
    close(p.jobs) // stop accepting new
    p.wg.Wait()   // wait for workers to finish in-flight
    p.cancel()    // tidy up
}

func (p *Pool) Stop() {
    p.cancel()    // cancel everything immediately
    close(p.jobs) // close jobs so workers exit
    p.wg.Wait()
}
```

`Drain` is graceful; `Stop` is forceful. The choice depends on the SLA. Most servers expose both.

---

## Graceful shutdown protocols

A long-running server has multiple kinds of work in flight when shutdown begins:

- HTTP handlers serving requests.
- Background workers processing queues.
- Periodic tasks (metrics, reconciliation, cleanup).
- Outbound connections to dependencies.

A graceful shutdown stops accepting new work, finishes (or politely cancels) in-flight work, releases resources, and exits within a budget. The components:

### Stage 1: stop accepting new work

Close listening sockets, stop queue consumers, set a "draining" flag on the HTTP server. The server stops accepting new connections; existing connections continue.

```go
srv := &http.Server{...}
go srv.ListenAndServe()
// ... on shutdown:
shutdownCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
defer cancel()
srv.Shutdown(shutdownCtx)
```

`http.Server.Shutdown` does exactly this: stops the listener, waits for in-flight handlers to return, optionally cancels them on `shutdownCtx.Done()`.

### Stage 2: cancel in-flight work that respects context

The root context cancels; every handler that uses `r.Context()` exits. Pipeline stages see `ctx.Done()` and exit. Workers see `ctx.Done()` and exit.

```go
rootCtx, rootCancel := signal.NotifyContext(context.Background(), os.Interrupt)
defer rootCancel()
// ... pipeline uses rootCtx ...
```

The single cancellation cascades to every consumer of the root context.

### Stage 3: wait with a deadline

Some work may not respect cancellation (legacy code, third-party libraries). For these, you cannot do anything except wait with a deadline.

```go
done := make(chan struct{})
go func() {
    cleanup()
    close(done)
}()
select {
case <-done:
case <-time.After(10 * time.Second):
    log.Println("cleanup timed out")
}
```

After the deadline, abandon the work and proceed to exit. Better to lose some work than to hang the shutdown.

### Stage 4: process exit

After all the cancellations and joins, `main` returns. The OS reaps the process.

### Example: a server with a worker pool

```go
func main() {
    rootCtx, rootCancel := signal.NotifyContext(context.Background(),
        os.Interrupt, syscall.SIGTERM)
    defer rootCancel()

    pool := NewPool(rootCtx, 16, 256)

    srv := &http.Server{
        Addr:    ":8080",
        Handler: handlerWith(pool),
        BaseContext: func(net.Listener) context.Context {
            return rootCtx
        },
    }

    go func() {
        if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
            log.Println("server:", err)
        }
    }()

    <-rootCtx.Done()
    log.Println("shutdown initiated")

    shutdownCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
    defer cancel()

    // Stop accepting new HTTP requests
    if err := srv.Shutdown(shutdownCtx); err != nil {
        log.Println("server shutdown:", err)
    }

    // Drain the worker pool
    pool.Drain()

    log.Println("shutdown complete")
}

func handlerWith(p *Pool) http.Handler { return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}) }
```

The flow:

1. `SIGTERM` arrives; `rootCtx` cancels.
2. `main` proceeds to shutdown.
3. `srv.Shutdown` stops the listener and waits for in-flight handlers (which also see `rootCtx` via `BaseContext`).
4. `pool.Drain` waits for in-flight jobs to finish, then cancels remaining workers.
5. `main` returns.

If any of these steps takes too long, the 30-second shutdown deadline forces an exit. The process dies, and Kubernetes or systemd kills it harder if it does not exit by then.

This shape — signal-cancellable root, BaseContext propagation, Shutdown with deadline, then pool drain — is the standard production server in Go.

---

## Pipeline Lifecycle Diagram

```
            +----------------+
            | parent context | (from main, request, scheduler)
            +-------+--------+
                    |
                    v
             +---------------+
             | pipeline ctx  |  (WithCancel or errgroup)
             +------+--------+
                    |
       +------------+------------+
       |            |            |
       v            v            v
   stage 1      stage 2      stage 3
   (goroutine)  (goroutine)  (goroutine)
       |            |            |
       +--- ctx.Done() --- shared close ---
                    |
              cancel triggered
              (deadline, error,
               signal, manual)
```

The pipeline ctx is what every stage sees. Cancellation at any reachable node propagates down. The orchestrator owns the cancel function. `errgroup` is the most common orchestrator.

---

## Patterns and Anti-Patterns

### Pattern: cancel-then-drain

```go
cancel()
for range out {
}
wg.Wait()
```

After cancelling, drain the output channel to unblock senders, then wait for workers to actually return. Three lines that complete the shutdown protocol.

### Pattern: per-stage error context

Each stage gets a `errgroup` sub-context. On its own internal error, it triggers its sub-cancel; siblings outside the sub-group keep running.

```go
g, ctx := errgroup.WithContext(parent)
g.Go(func() error {
    sub, subCtx := errgroup.WithContext(ctx)
    // ... internal fan-out using subCtx ...
    return sub.Wait()
})
g.Go(func() error {
    return otherWork(ctx)
})
return g.Wait()
```

Sub-cancellation isolated to the inner errgroup.

### Anti-pattern: cancel inside the goroutine without `defer`

```go
go func() {
    if err := work(ctx); err != nil {
        cancel()
        // forgot to return
    }
    // continues to use ctx, but ctx is now cancelled
}()
```

The goroutine cancels and then continues. The subsequent code sees a cancelled context, possibly causing confusing errors. The fix: `return` immediately after `cancel()` or restructure.

### Anti-pattern: ignoring the deadline

```go
deadline, _ := ctx.Deadline()
_ = deadline // unused
heavyWork(ctx) // does not check ctx.Err() inside
```

The pipeline accepts the deadline but the inner work never checks it. The deadline is decorative. Always pass `ctx` down and poll inside heavy loops.

### Anti-pattern: cancel in a `defer` that does not run

```go
ctx, cancel := context.WithCancel(parent)
// no defer cancel
go work(ctx) // goroutine outlives the function
// function returns; ctx is never cancelled
```

The function returns, the cancel function is garbage-collected, but the timer/observer of `ctx` may not be cleaned up. Always `defer cancel()` even if the work outlives the function — restructure so the cancel is owned by the right scope.

### Pattern: cancellation as a precondition

```go
if err := ctx.Err(); err != nil {
    return err
}
expensive(ctx)
```

A cheap early-check before kicking off expensive work. If already cancelled, fail fast.

### Pattern: distinguishing "cancel" from "deadline" in the return

```go
err := g.Wait()
switch {
case errors.Is(err, context.DeadlineExceeded):
    return errors.New("timeout")
case errors.Is(err, context.Canceled):
    return errors.New("cancelled")
default:
    return err
}
```

The caller may want different behaviour for "we ran out of time" vs "someone explicitly cancelled."

---

## Cancellation observability

In production, you want to know:

- How often pipelines cancel before completing.
- How long the cancellation latency is.
- Which stage is the slowest to exit.
- Whether any goroutines leak.

Instrumentation:

### Counter for cancellations

```go
var (
    cancelTotal     = expvar.NewInt("pipeline_cancel_total")
    completeTotal   = expvar.NewInt("pipeline_complete_total")
)

defer func() {
    if ctx.Err() != nil {
        cancelTotal.Add(1)
    } else {
        completeTotal.Add(1)
    }
}()
```

A simple counter. If the ratio of cancels to completes climbs, something is going wrong upstream.

### Histogram for cancellation latency

```go
start := time.Now()
<-ctx.Done()
cancelLatency.Observe(time.Since(start).Seconds())
```

The histogram captures the time from "cancel was triggered" to "the watcher saw it." Useful for detecting stalled stages.

### Counting live goroutines

```go
goroutineGauge.Set(float64(runtime.NumGoroutine()))
```

Expose this as a Prometheus gauge or expvar. If it drifts upward over hours, you have a leak.

### Tracing the cancellation cause

`context.WithCancelCause` lets you attach an error reason. Pass it to logs and traces:

```go
ctx, cancel := context.WithCancelCause(parent)
defer cancel(nil)
// ...
cancel(errors.New("backend returned 503"))

// in the cleanup:
if cause := context.Cause(ctx); cause != nil {
    log.Println("pipeline cancelled because:", cause)
    span.RecordError(cause)
}
```

The reason follows the cancellation through the system. Debugging "why did the pipeline cancel?" becomes a log search instead of a code archaeology session.

### Goroutine dumps

For runtime debugging, dump all goroutines:

```go
import "runtime/pprof"
pprof.Lookup("goroutine").WriteTo(os.Stderr, 2)
```

The output shows every goroutine's stack and what it is waiting on. If many goroutines are stuck in `chan receive`, you may have a missed cancellation.

In production, expose `/debug/pprof/goroutine` via `net/http/pprof` so you can grab dumps without redeploying.

---

## Testing Cancellation

### Test 1: pipeline exits on cancel

```go
func TestPipelineCancels(t *testing.T) {
    ctx, cancel := context.WithCancel(context.Background())
    out := buildPipeline(ctx)
    go func() {
        time.Sleep(10 * time.Millisecond)
        cancel()
    }()
    count := 0
    for range out {
        count++
    }
    if ctx.Err() != context.Canceled {
        t.Fatalf("want Canceled, got %v", ctx.Err())
    }
    if count == 0 {
        t.Error("expected some output before cancel")
    }
}
```

The pipeline produces a few values, then cancellation fires, then the range exits. Verify `ctx.Err()`.

### Test 2: pipeline does not leak goroutines

```go
func TestNoLeak(t *testing.T) {
    before := runtime.NumGoroutine()
    for i := 0; i < 10; i++ {
        ctx, cancel := context.WithCancel(context.Background())
        out := buildPipeline(ctx)
        cancel()
        for range out {
        }
    }
    runtime.GC()
    time.Sleep(10 * time.Millisecond)
    after := runtime.NumGoroutine()
    if after > before+2 {
        t.Errorf("leaked goroutines: %d -> %d", before, after)
    }
}
```

Run 10 pipelines, cancel each, then check goroutine count. A small tolerance (`+2`) accounts for runtime variability.

For more thorough leak detection, use `go.uber.org/goleak`:

```go
import "go.uber.org/goleak"

func TestMain(m *testing.M) {
    goleak.VerifyTestMain(m)
}
```

The package automatically reports any goroutine still running at the end of the test.

### Test 3: deadline propagates

```go
func TestDeadlineFires(t *testing.T) {
    ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
    defer cancel()
    err := runPipeline(ctx)
    if !errors.Is(err, context.DeadlineExceeded) {
        t.Fatalf("want DeadlineExceeded, got %v", err)
    }
}
```

### Test 4: errgroup cancels siblings on error

```go
func TestErrgroupCancels(t *testing.T) {
    g, ctx := errgroup.WithContext(context.Background())
    g.Go(func() error {
        return errors.New("boom")
    })
    g.Go(func() error {
        <-ctx.Done()
        return ctx.Err()
    })
    err := g.Wait()
    if err.Error() != "boom" {
        t.Fatalf("want boom, got %v", err)
    }
}
```

The first goroutine returns an error; the second observes the cancel and returns `ctx.Err()`. `g.Wait()` returns the *first* non-nil error, which is "boom."

---

## A case study: a streaming aggregator

Let me work through a more complex example: a service that streams events from a Kafka-like source, deduplicates them, aggregates them by window, and writes the windows to a database. Cancellation must work at every stage.

```go
type Event struct {
    ID    string
    Value int
    At    time.Time
}

type Window struct {
    Start time.Time
    Sum   int
}

func runAggregator(ctx context.Context, src EventSource, sink Sink) error {
    g, ctx := errgroup.WithContext(ctx)

    raw := source(g, ctx, src)
    dedup := dedupe(g, ctx, raw)
    wins := window(g, ctx, dedup, time.Second)
    persist(g, ctx, wins, sink)

    return g.Wait()
}

func source(g *errgroup.Group, ctx context.Context, src EventSource) <-chan Event {
    out := make(chan Event, 256)
    g.Go(func() error {
        defer close(out)
        for {
            select {
            case <-ctx.Done():
                return ctx.Err()
            default:
            }
            ev, err := src.Next(ctx)
            if err != nil {
                if errors.Is(err, io.EOF) {
                    return nil
                }
                return err
            }
            select {
            case out <- ev:
            case <-ctx.Done():
                return ctx.Err()
            }
        }
    })
    return out
}

func dedupe(g *errgroup.Group, ctx context.Context, in <-chan Event) <-chan Event {
    out := make(chan Event, 256)
    g.Go(func() error {
        defer close(out)
        seen := make(map[string]struct{}, 1024)
        for ev := range in {
            if _, ok := seen[ev.ID]; ok {
                continue
            }
            seen[ev.ID] = struct{}{}
            select {
            case out <- ev:
            case <-ctx.Done():
                return ctx.Err()
            }
        }
        return nil
    })
    return out
}

func window(g *errgroup.Group, ctx context.Context, in <-chan Event, size time.Duration) <-chan Window {
    out := make(chan Window, 16)
    g.Go(func() error {
        defer close(out)
        ticker := time.NewTicker(size)
        defer ticker.Stop()
        var current Window
        flush := func() bool {
            if current.Sum == 0 {
                return true
            }
            select {
            case out <- current:
                current = Window{Start: time.Now()}
                return true
            case <-ctx.Done():
                return false
            }
        }
        for {
            select {
            case <-ctx.Done():
                return ctx.Err()
            case ev, ok := <-in:
                if !ok {
                    flush()
                    return nil
                }
                if current.Start.IsZero() {
                    current.Start = ev.At
                }
                current.Sum += ev.Value
            case <-ticker.C:
                if !flush() {
                    return ctx.Err()
                }
            }
        }
    })
    return out
}

func persist(g *errgroup.Group, ctx context.Context, in <-chan Window, sink Sink) {
    g.Go(func() error {
        for w := range in {
            if err := sink.Write(ctx, w); err != nil {
                return err
            }
        }
        return ctx.Err()
    })
}

type EventSource interface {
    Next(ctx context.Context) (Event, error)
}

type Sink interface {
    Write(ctx context.Context, w Window) error
}
```

Cancellation analysis:

- The source loop checks `ctx.Done()` at the top, then `src.Next(ctx)` (which itself respects `ctx`), then the send into `out` is `select`-guarded.
- Dedupe's receive uses `range`; it stops naturally when source closes `out`. The send into its output is `select`-guarded.
- Window has three cases: cancel, input, tick. Each handled. The flush function is also cancel-safe.
- Persist uses `sink.Write(ctx, w)` which propagates cancellation to the database driver. The `range` over `in` stops when window closes its output.
- `errgroup` ties them all together: if any returns an error, the rest see `ctx.Done()` and exit.

Total goroutines: 4 (one per stage). Total cancellation paths: every block point. Total leaked goroutines on shutdown: 0.

This is what middle-level pipeline code looks like in production. It is verbose, but every line is doing work that prevents a leak.

---

## Performance Considerations

- **One context per pipeline**, not one per stage, unless a stage needs its own deadline or its own cancel reason.
- **`SetLimit` (Go 1.20+)** replaces manual semaphores; same performance, less code.
- **`context.AfterFunc` vs a watcher goroutine**: `AfterFunc` is roughly equivalent in cost (one goroutine on cancel) but the cleanup is automatic.
- **`select` on a closed channel is constant-time**; do not micro-optimise by caching `ctx.Done()` unless profiling shows the call is hot.
- **Channel close is O(receivers wake-up)** in the runtime. Closing a done channel with 10 000 receivers wakes 10 000 goroutines in serial; for very large fan-out, consider batching the wake.

A real-world data point: in a pipeline with 16 stages and 1000 items, the overhead of `ctx.Done()` selects is below 1 microsecond per item. Cancellation latency from `cancel()` to all stages exited is sub-millisecond for tight stages, dominated by the slowest per-item work for heavy stages.

---

## A second case study: long-poll handler with cancellation

A long-poll endpoint holds a request open until an event arrives or a deadline fires. Cancellation propagation is critical:

- If the client disconnects, the server must release the handler immediately.
- If the deadline fires, the server should respond with "no events" rather than blocking forever.
- If the server is shutting down, all long-poll handlers should cancel and respond.

```go
func longPoll(w http.ResponseWriter, r *http.Request) {
    ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
    defer cancel()

    select {
    case ev := <-eventStream(ctx):
        json.NewEncoder(w).Encode(ev)
    case <-ctx.Done():
        if errors.Is(ctx.Err(), context.DeadlineExceeded) {
            w.WriteHeader(http.StatusNoContent)
            return
        }
        // client disconnected; nothing to do
    }
}

func eventStream(ctx context.Context) <-chan Event {
    out := make(chan Event, 1)
    go func() {
        defer close(out)
        ev, err := waitForEvent(ctx)
        if err != nil {
            return
        }
        select {
        case out <- ev:
        case <-ctx.Done():
        }
    }()
    return out
}

func waitForEvent(ctx context.Context) (Event, error) {
    // ... subscribe to event source, return when event arrives or ctx cancels ...
    return Event{}, nil
}
```

What we get:

- `r.Context()` cancels on client disconnect.
- `WithTimeout` adds a 30-second cap; either disconnect or timeout wins.
- `defer cancel()` ensures the timer is cleaned up.
- The `eventStream` goroutine respects `ctx` and exits when cancellation fires.
- The send into `out` is `select`-guarded; if the handler returned before the event arrived, the send fails silently (no leak).
- The buffer of 1 prevents the goroutine from blocking on send if the handler is still waiting in the `select`.

Without these protections, every client disconnect would leak the `eventStream` goroutine. Multiply by 10 000 concurrent long-polls and the leak is fatal.

---

## Common Mistakes at the Middle Level

| Mistake | Fix |
|---|---|
| Using `errgroup` but not `g.Wait()` on every code path | Always `return g.Wait()` or assign and check. Defer not enough — the deferred return value is the assigned variable. |
| Capturing the wrong context in `g.Go(func() error { ... })` | Capture the `ctx` returned by `errgroup.WithContext`, not the parent. The errgroup's context is the one that cancels on error. |
| Forgetting `item := item` in a loop before `g.Go` | Captured loop variable bug; in Go 1.22+ this is fixed for `for ... range`, but explicit re-binding still works on older versions. |
| `defer cancel()` at the function level instead of the goroutine level | If the goroutine outlives the function, defer fires too early. Move cancel inside the goroutine. |
| Cancelling without draining | Producers stay wedged on the last send. Always cancel-then-drain. |
| Mixing `done` channel and `context` in the same pipeline | Pick one. Inconsistency is a source of subtle bugs. |
| Ignoring `ctx.Err()` after `range` ends | A clean range end could be normal or cancellation; check explicitly if it matters. |
| Wrapping every channel op manually when `errgroup` would suffice | Use `errgroup` for fan-out and `errgroup.SetLimit` for bounded concurrency. |

---

## Designing for predictable shutdown latency

In production systems with strict shutdown SLAs (e.g. Kubernetes preStop hooks give you 30 seconds before SIGKILL), you must design for predictable cancellation latency. The components:

### Bound per-item work

If a stage processes 1 item per second, cancellation latency is up to 1 second per stage. Either reduce per-item work or insert `ctx.Err()` checks inside.

### Bound channel buffers

A 1000-element buffer in front of a slow consumer means up to 1000 items of work in flight. On cancel, this work is wasted but the buffer also delays detection — the producer keeps producing until the buffer fills and the consumer is still draining. Smaller buffers mean tighter coupling and shorter latency.

### Avoid unbounded queueing

Workers that accumulate state in memory (a map, a slice) cannot release it until they exit. If shutdown waits for them to flush state, the flush time is in the critical path. Either flush periodically (so the in-flight state is bounded) or accept the flush as a known shutdown cost.

### Use deadlines on external calls

If a stage waits 30 seconds on a database query, your shutdown waits 30 seconds. Tight per-call deadlines (`context.WithTimeout`) keep external calls from dominating shutdown.

### Test your shutdown

The only way to know shutdown latency is to measure it. Run a load test, send SIGTERM, time how long it takes to exit cleanly. Repeat under various conditions (idle, saturated, with errors). Adjust until predictable.

A useful goal: shutdown completes within 10 seconds even under peak load. This leaves plenty of room before the orchestrator's kill timer fires.

---

## Tricky Questions

**Q.** What is the order of cancellation when `g.Wait()` returns?

**A.** `Wait` returns after every goroutine has returned. The cancellation order is: the first error triggers `cancel`, every other goroutine sees `ctx.Done()` and exits asynchronously. `Wait` joins them all. The cancellation cascades to children of the errgroup's context too — any `WithCancel(ctx)` derived from it cancels as well.

---

**Q.** If you cancel a context, then derive a new context from it, what happens?

**A.** The new context is born cancelled. Its `Done()` returns a closed channel; `Err()` returns the parent's err (`Canceled` or `DeadlineExceeded`). Any goroutine using it exits immediately.

---

**Q.** Does `errgroup` recover from panics?

**A.** No. A panic in a `g.Go` function propagates up and terminates the process unless the function itself recovers. To panics-safe a group, wrap each function in `defer recover()` and convert to an error.

---

**Q.** Can two `errgroup`s share a context?

**A.** Yes. `errgroup.WithContext(parent)` creates a child; you can pass that child to another `errgroup.WithContext` and derive again. Cancellation cascades down the tree. This is how you isolate sub-pipelines that can fail independently.

---

**Q.** Why does `errgroup` cancel on the *first* error but `Wait` returns that first error too?

**A.** Design choice. `errgroup` stores the first non-nil error under a `sync.Once`-style guard. Subsequent errors are discarded. The cancellation is the side effect of capturing the first error. If you need all errors, accumulate them yourself via a `chan error` and a slice.

---

**Q.** What happens if you call `cancel(err)` on a `WithCancelCause` context twice?

**A.** Only the first call has effect; the second is a no-op. The error reported by `context.Cause` is the one from the first call.

---

**Q.** How does `context` propagation work across goroutines but not across processes?

**A.** The cancellation primitive is a channel close, which is in-process. Across a process boundary (RPC), the deadline is serialised in metadata and the cancellation is signalled by closing the stream. The other process reconstructs a fresh `Context` from the metadata.

---

**Q.** Is `context.Context` safe for concurrent use?

**A.** Yes. All methods (`Done`, `Err`, `Deadline`, `Value`) are safe to call from multiple goroutines simultaneously. So is the cancel function returned by `WithCancel`.

---

## Idempotent vs. one-shot cancellation

Cancellation in Go is *idempotent*: calling `cancel()` more than once is a no-op. This is a deliberate design choice. The implications:

- Multiple goroutines can call `cancel` without coordination.
- A `defer cancel()` is safe even if the function explicitly cancelled earlier.
- Combining sources of cancellation (timer + signal + error) is trivial.

Contrast with "one-shot" cancellation (such as `sync.Once`), where the first call has effect and the second is ignored — same external behaviour, but the Go context API exposes a function that is meaningful to call from many places.

For one-shot semantics within an errgroup, the `errOnce` field captures the first error and ignores the rest. So while cancel is idempotent, error capture is one-shot. The pair makes for clean code: errors are recorded once but cancellation is broadcast cheaply.

---

## Patterns library: shapes you will reuse

This is a catalogue of well-tested shapes for cancellation propagation in pipelines. Use these as starting points.

### Shape 1: Single producer, single consumer, errgroup

```go
g, ctx := errgroup.WithContext(parent)
ch := make(chan T, 16)
g.Go(func() error {
    defer close(ch)
    return produce(ctx, ch)
})
g.Go(func() error {
    return consume(ctx, ch)
})
return g.Wait()
```

The minimum production pipeline. Two goroutines, one errgroup, one shared channel.

### Shape 2: Multi-stage with errgroup

```go
g, ctx := errgroup.WithContext(parent)
ch1 := make(chan T, 16)
ch2 := make(chan U, 16)
g.Go(func() error {
    defer close(ch1)
    return stage1(ctx, ch1)
})
g.Go(func() error {
    defer close(ch2)
    return stage2(ctx, ch1, ch2)
})
g.Go(func() error {
    return stage3(ctx, ch2)
})
return g.Wait()
```

Each stage owns its output channel via `defer close`. Errgroup orchestrates.

### Shape 3: Fan-out with bounded concurrency

```go
g, ctx := errgroup.WithContext(parent)
g.SetLimit(8)
for _, item := range items {
    item := item
    g.Go(func() error {
        return process(ctx, item)
    })
}
return g.Wait()
```

`SetLimit(8)` blocks `g.Go` until fewer than 8 goroutines are running.

### Shape 4: Worker pool reading from a channel

```go
g, ctx := errgroup.WithContext(parent)
items := source(ctx)
for i := 0; i < workers; i++ {
    g.Go(func() error {
        for {
            select {
            case <-ctx.Done():
                return ctx.Err()
            case item, ok := <-items:
                if !ok {
                    return nil
                }
                if err := process(ctx, item); err != nil {
                    return err
                }
            }
        }
    })
}
return g.Wait()
```

N workers read from a shared channel. Source closes the channel when exhausted; workers exit.

### Shape 5: Fan-out fan-in with results

```go
g, ctx := errgroup.WithContext(parent)
g.SetLimit(8)
items := source(ctx)
results := make(chan Result, 256)

var wg sync.WaitGroup
for i := 0; i < 8; i++ {
    wg.Add(1)
    g.Go(func() error {
        defer wg.Done()
        for {
            select {
            case <-ctx.Done():
                return ctx.Err()
            case item, ok := <-items:
                if !ok {
                    return nil
                }
                r, err := process(ctx, item)
                if err != nil {
                    return err
                }
                select {
                case results <- r:
                case <-ctx.Done():
                    return ctx.Err()
                }
            }
        }
    })
}

go func() {
    wg.Wait()
    close(results)
}()

var out []Result
for r := range results {
    out = append(out, r)
}
if err := g.Wait(); err != nil {
    return nil, err
}
return out, nil
```

The full fan-out-fan-in shape. Workers process and emit; a closer waits for all workers and closes the results channel; the main goroutine collects.

### Shape 6: Streaming pipeline with backpressure

```go
g, ctx := errgroup.WithContext(parent)
// Small buffer = tight back-pressure
ch := make(chan T, 1)
g.Go(func() error {
    defer close(ch)
    return produce(ctx, ch)
})
g.Go(func() error {
    return consume(ctx, ch)
})
return g.Wait()
```

A small buffer (or 0) means the producer cannot get ahead of the consumer. Useful when memory is constrained or when the producer is expensive and you do not want it racing ahead.

### Shape 7: Periodic background worker

```go
g, ctx := errgroup.WithContext(parent)
g.Go(func() error {
    ticker := time.NewTicker(time.Minute)
    defer ticker.Stop()
    for {
        select {
        case <-ctx.Done():
            return ctx.Err()
        case <-ticker.C:
            if err := work(ctx); err != nil {
                return err
            }
        }
    }
})
return g.Wait()
```

A scheduled task that respects cancellation and stops on shutdown.

### Shape 8: Concurrent first-result

Race N concurrent operations; take the first to succeed; cancel the rest.

```go
ctx, cancel := context.WithCancel(parent)
defer cancel()
results := make(chan Result, len(endpoints))
for _, ep := range endpoints {
    ep := ep
    go func() {
        r, err := query(ctx, ep)
        if err != nil {
            return
        }
        select {
        case results <- r:
        case <-ctx.Done():
        }
    }()
}
select {
case r := <-results:
    cancel() // tell the rest to stop
    return r, nil
case <-ctx.Done():
    return Result{}, ctx.Err()
}
```

The first successful result wins; `cancel` stops the others. Note: this leaks goroutines until they observe `ctx.Done()`; in practice they exit promptly because their `query` returns on cancel.

---

## Cheat Sheet

```go
// Multi-stage with shared context
out := stage3(ctx, stage2(ctx, stage1(ctx)))

// errgroup with cancel-on-error
g, ctx := errgroup.WithContext(parent)
g.Go(func() error { return stageA(ctx) })
g.Go(func() error { return stageB(ctx) })
err := g.Wait()

// Bounded concurrency
g.SetLimit(8)
for _, item := range items {
    item := item
    g.Go(func() error { return process(ctx, item) })
}

// Per-stage deadline (inside the goroutine)
go func() {
    ctx, cancel := context.WithTimeout(parent, 100*time.Millisecond)
    defer cancel()
    defer close(out)
    // ... loop ...
}()

// Cancel-with-cause
ctx, cancel := context.WithCancelCause(parent)
defer cancel(nil)
cancel(myError) // later
err := context.Cause(ctx)

// AfterFunc for side-effects
stop := context.AfterFunc(ctx, func() { metrics.Inc() })
defer stop()

// Fan-in with drain
func merge(ctx context.Context, ins ...<-chan T) <-chan T { ... }

// Worker loop template
for {
    select {
    case <-ctx.Done():
        return ctx.Err()
    case item, ok := <-in:
        if !ok {
            return nil
        }
        if err := work(ctx, item); err != nil {
            return err
        }
    }
}

// Cancel-then-drain
cancel()
for range out { }
wg.Wait()
```

---

## Common pitfalls in `errgroup`-driven pipelines

A bestiary of subtle bugs.

### Pitfall 1: Forgetting `item := item` in older Go

```go
for _, item := range items {
    g.Go(func() error {
        return process(ctx, item) // captures item by reference in Go < 1.22
    })
}
```

In Go 1.22+ this works correctly; in older Go all goroutines see the final iteration's `item`. The fix: `item := item` before `g.Go`.

### Pitfall 2: Using `parent` instead of the errgroup's `ctx`

```go
g, ctx := errgroup.WithContext(parent)
g.Go(func() error {
    return work(parent) // <-- WRONG, uses parent, not ctx
})
```

The function uses the parent context, which does *not* cancel on errgroup errors. The error semantics are broken: sibling failures do not cancel this goroutine. Always use the `ctx` returned by `WithContext`.

### Pitfall 3: Sharing `g.Wait()` across goroutines

```go
g.Go(func() error {
    return g.Wait() // <-- DEADLOCK
})
```

A goroutine in the group calls `Wait`. But `Wait` waits for that very goroutine to finish — deadlock. Never call `Wait` from within a `g.Go` function.

### Pitfall 4: Mixing `Wait` with subsequent `Go`

```go
g.Go(taskA)
g.Wait()
g.Go(taskB) // taskB will run, but Wait already returned
```

After `Wait`, the group can still be used, but the next call to `Wait` would return the result of taskB (or whatever ran after the first `Wait`). This pattern is almost always wrong; create a fresh group for the new work.

### Pitfall 5: `errgroup` plus shared state

```go
var counter int
for _, item := range items {
    item := item
    g.Go(func() error {
        counter++ // race
        return process(ctx, item)
    })
}
```

`counter++` runs concurrently from N goroutines. Data race. Fix: `atomic.AddInt64` or a mutex. `errgroup` does not protect shared state.

### Pitfall 6: Capturing `cancel` from the wrong scope

```go
ctx, cancel := context.WithCancel(parent)
go func() {
    defer cancel() // this cancels the parent context for everyone
    work(ctx)
}()
```

The cancel is from the outer scope. When the goroutine returns, it cancels — affecting any other consumer of `ctx`. This is usually fine for orchestrator-owned cancels but can surprise you when `ctx` is shared.

---

## A note on `runtime.Goexit` and cancellation

`runtime.Goexit()` terminates the calling goroutine without panicking. It does not signal cancellation to anyone else; it merely makes the current goroutine return through its deferred calls. In a pipeline, calling `Goexit` from a stage skips the normal return paths. Avoid it in production code; it makes the control flow opaque. The standard cancellation mechanisms (context, done channel) are clearer.

The one place `Goexit` is unavoidable: deep inside the testing package (`t.FailNow` calls `Goexit`). Tests that hit a fatal assertion exit the test goroutine, leaving any other goroutines they spawned alive — which is why `goleak` and `t.Cleanup` are important.

---

## Mixing manual done channels with `context`

Sometimes you inherit code that uses a manual done channel and you want to integrate it with `context`. Two bridge patterns:

### Done channel from a context

```go
done := ctx.Done()
// pass `done` to legacy code that wants `<-chan struct{}`
```

This works because `ctx.Done()` returns exactly `<-chan struct{}`. No adapter needed.

### Context from a done channel

```go
ctx, cancel := context.WithCancel(parent)
go func() {
    <-done
    cancel()
}()
```

A watcher goroutine waits on the done channel and cancels the context when it closes. Once the cancellation has fired, the watcher exits. This is a small, well-defined adapter.

Both patterns let you migrate legacy code one piece at a time. Eventually you converge on `context` for the public surface and `chan struct{}` only for internal signal-only channels.

---

## Reading the source: `errgroup.Group`

A quick walk through `errgroup`'s actual source clarifies the patterns:

```go
type Group struct {
    cancel func(error)
    wg     sync.WaitGroup
    sem    chan token
    errOnce sync.Once
    err     error
}

func WithContext(ctx context.Context) (*Group, context.Context) {
    ctx, cancel := withCancelCause(ctx)
    return &Group{cancel: cancel}, ctx
}

func (g *Group) Wait() error {
    g.wg.Wait()
    if g.cancel != nil {
        g.cancel(g.err)
    }
    return g.err
}

func (g *Group) Go(f func() error) {
    if g.sem != nil {
        g.sem <- token{}
    }
    g.wg.Add(1)
    go func() {
        defer g.done()
        if err := f(); err != nil {
            g.errOnce.Do(func() {
                g.err = err
                if g.cancel != nil {
                    g.cancel(g.err)
                }
            })
        }
    }()
}

func (g *Group) done() {
    if g.sem != nil {
        <-g.sem
    }
    g.wg.Done()
}

func (g *Group) SetLimit(n int) {
    if n < 0 {
        g.sem = nil
        return
    }
    if len(g.sem) != 0 {
        panic("errgroup: modify limit while goroutines in the group are still active")
    }
    g.sem = make(chan token, n)
}
```

What you learn:

- The semaphore is a buffered channel; `g.Go` blocks on send to it when full.
- The cancel is the cancel function from `withCancelCause`, so cancellation is "with cause" — `context.Cause(ctx)` returns the captured error.
- `errOnce` ensures the first error wins.
- `Wait` finalises by calling `cancel(g.err)` — ensuring observers see cancellation even if it was triggered by `Wait`'s own join completing.

The source is short, well-tested, and easy to read. If you understand it, you understand the bulk of cancellation patterns in real Go code.

---

## A practical middle-level checklist

When reviewing a pipeline for cancellation correctness, run through this list:

1. Does every function take `ctx context.Context` as its first parameter?
2. Is every blocking channel operation inside a `select` with `<-ctx.Done()`?
3. Is every output channel closed in a `defer` from the owning goroutine?
4. Is every `WithCancel`/`WithTimeout`/`WithDeadline` paired with `defer cancel()`?
5. Are deadlines propagated to external calls (`db.QueryContext`, `http.NewRequestWithContext`, etc.)?
6. Does the orchestrator drain output channels after cancelling?
7. Is there a test that verifies `runtime.NumGoroutine()` returns to baseline after cancellation?
8. Are panics recovered at goroutine boundaries?
9. Is the cancellation cause (`context.WithCancelCause`) recorded for debugging?
10. Does shutdown have a known time budget and is it tested?

If all ten are satisfied, the pipeline is production-ready from a cancellation standpoint. If any fails, the pipeline has a latent bug.

---

## Worked example: building a webhook fan-out

Let me walk through the design of a service that receives webhook events and fans them out to N downstream destinations, with each destination potentially failing or being slow.

### Requirements

- One webhook arrives at a time (HTTP POST).
- Each webhook must be delivered to N destinations.
- Each destination has its own deadline (200 ms).
- If a destination fails, retry up to 3 times.
- Total fan-out has a deadline (1 second).
- The service responds to the webhook caller only after all destinations have been attempted.
- The service must shut down gracefully on `SIGTERM`.

### Design

```go
type Webhook struct {
    ID      string
    Payload []byte
}

type Destination struct {
    Name string
    URL  string
}

func fanout(ctx context.Context, w Webhook, dests []Destination) []error {
    g, ctx := errgroup.WithContext(ctx)

    // Total fan-out deadline
    ctx, cancel := context.WithTimeout(ctx, time.Second)
    defer cancel()

    errs := make([]error, len(dests))
    for i, dest := range dests {
        i, dest := i, dest
        g.Go(func() error {
            err := deliver(ctx, dest, w)
            errs[i] = err
            return nil // do not propagate per-destination failure; aggregate them
        })
    }
    _ = g.Wait()
    return errs
}

func deliver(parent context.Context, dest Destination, w Webhook) error {
    backoff := 50 * time.Millisecond
    for attempt := 0; attempt < 3; attempt++ {
        // Per-attempt deadline
        ctx, cancel := context.WithTimeout(parent, 200*time.Millisecond)
        err := postOnce(ctx, dest.URL, w.Payload)
        cancel()
        if err == nil {
            return nil
        }
        if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
            // Check the parent: if it cancelled, propagate; if only the per-attempt timed out, retry
            if parent.Err() != nil {
                return parent.Err()
            }
        }
        select {
        case <-parent.Done():
            return parent.Err()
        case <-time.After(backoff):
        }
        backoff *= 2
    }
    return errors.New("max attempts exceeded")
}

func postOnce(ctx context.Context, url string, payload []byte) error {
    req, _ := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(payload))
    resp, err := http.DefaultClient.Do(req)
    if err != nil {
        return err
    }
    defer resp.Body.Close()
    if resp.StatusCode >= 500 {
        return fmt.Errorf("status %d", resp.StatusCode)
    }
    return nil
}
```

### Cancellation analysis

- The fan-out has its own deadline of 1 second; either the request context's deadline or this 1-second cap fires first.
- Each destination has 3 attempts with 200 ms per-attempt deadlines. The total budget per destination is bounded.
- The retry sleep is `select`-guarded so it respects parent cancellation.
- The HTTP call uses `NewRequestWithContext`, so the call cancels mid-flight.
- We deliberately return `nil` from `g.Go` and aggregate errors in a slice, because we want every destination to be attempted independently. `errgroup`'s normal cancel-on-error semantics would stop attempting destinations after one failed, which is not what we want.

### What does cancellation look like in this service?

- Webhook arrives, handler starts the fan-out with `r.Context()`.
- If the caller disconnects, `r.Context()` cancels. The fan-out's child context cancels. Every in-flight `deliver` sees it, the HTTP call cancels, the retry loop's sleep exits, and `deliver` returns.
- `g.Wait` joins; the handler returns to the caller (whose connection is gone).
- `errs` records the cancellation reasons, but no one reads them. That is fine.

### Shutdown

- `SIGTERM` cancels `rootCtx`.
- `srv.Shutdown` stops accepting new webhooks.
- In-flight handlers see their `r.Context()` cancel (because `BaseContext` returns `rootCtx`).
- Each handler's fan-out cancels; deliveries abort; handlers return.
- `Shutdown` returns; `main` exits.

Total shutdown latency: at most 1 second (the fan-out deadline) per in-flight request, parallelised. With 30 seconds of shutdown budget, the process exits well within bounds.

---

## Summary

Middle-level cancellation is about scaling the same primitive — a closed channel — to multi-stage pipelines, fan-out workers, and cancel-on-error semantics. `errgroup.Group` is the single most important tool; it bundles the wait-for-all and cancel-on-error patterns into three lines of code.

Deadlines propagate naturally through the context tree, narrowing as needed when a sub-operation has tighter bounds. Upstream and downstream cancellation use the same `ctx.Done()` channel; the difference is policy, not mechanism. Fan-in stages need explicit drains so producers can exit. Worker pools split graceful drain from forceful stop.

The key habits to internalise: one context per pipeline, `errgroup` for orchestration, deadlines on every external call, drain before exit, and tests that verify no goroutine leaks under cancellation. At senior level the discussion shifts to architecture: structured concurrency, supervisor trees, and incident lessons.

---

## Cancellation across goroutine generations

In long-lived applications you may have nested pipelines where one pipeline spawns child pipelines. Cancellation must reach across generations.

### Parent pipeline spawns child pipeline

```go
func parent(ctx context.Context) error {
    g, ctx := errgroup.WithContext(ctx)
    g.Go(func() error {
        return child(ctx) // child uses the same errgroup ctx
    })
    return g.Wait()
}

func child(parent context.Context) error {
    g, ctx := errgroup.WithContext(parent)
    g.Go(func() error { return childWork(ctx) })
    return g.Wait()
}
```

The child's errgroup derives from the parent's errgroup's context. If the parent cancels (because a sibling errgroup goroutine returned an error), `parent` propagates to the child's `ctx`, child's stages exit, child's `Wait` returns, child returns to parent's `g.Go`.

If the child errors, its `Wait` returns the error, the goroutine in the parent's group returns that error, the parent's errgroup cancels, siblings stop.

Two-way propagation through nested errgroups. No extra plumbing needed.

### Spawning fire-and-forget goroutines

Sometimes a stage spawns a "fire-and-forget" goroutine that should outlive the stage but die on overall cancellation. Pass the ambient long-lived context:

```go
func handler(ctx context.Context, longLived context.Context, j Job) {
    process(ctx, j)
    go func() {
        // notification that should not block the handler's response
        notify(longLived, j)
    }()
}
```

The notification runs on a context tied to the application lifetime, not the request. It outlives the request but dies on `SIGTERM`.

This pattern is sometimes called "promotion" — escalating from a short-lived to a long-lived scope. Use with care; it is a common source of leaks if the long-lived context is missing.

### Detached cancellation

`context.WithoutCancel` (Go 1.21+) returns a context that does *not* propagate cancellation from the parent. Use when you specifically need a sub-operation to outlive the parent (e.g. logging the failure of a request after the request context cancelled):

```go
func handler(ctx context.Context) {
    if err := work(ctx); err != nil {
        logCtx := context.WithoutCancel(ctx)
        go logFailure(logCtx, err)
    }
}
```

`logFailure` runs in the background even after `ctx` cancels. The logger uses `logCtx` which is not cancellable. This is the principled escape hatch — readers see immediately that this work is detached.

---

## A note on shutdown ordering

When multiple components shut down concurrently, ordering matters. Some examples:

### Ordering rule: drain producers before stopping consumers

If the consumer stops first, producers wedge on the next send. Always drain (or cancel) producers first, then wait for them to exit, then close their outputs.

In errgroup-driven pipelines, this is automatic: the first error cancels everyone, and `Wait` joins them all. Manual pipelines must arrange the order.

### Ordering rule: shut down HTTP listener before worker pool

If the listener stays open, new requests arrive that submit jobs into a pool that is being drained. Either the new requests fail (because submit sees `ctx.Done()`) or they block (because the pool is full and no one is consuming). Close the listener first, then drain the pool.

```go
srv.Shutdown(shutdownCtx) // stop accepting new
pool.Drain()              // finish in-flight
```

### Ordering rule: close database last

If the database is closed while handlers are still running, they error out on the next query. Close the DB only after all handlers and workers have returned.

```go
srv.Shutdown(shutdownCtx)
pool.Drain()
db.Close()
```

The standard ordering: outside-in. Stop accepting work from outside, drain work in flight, release internal resources, exit.

---

## Cancellation in retry loops

A retry loop with backoff must check cancellation between attempts:

```go
func withRetry(ctx context.Context, fn func(context.Context) error) error {
    backoff := time.Second
    for attempt := 0; attempt < 5; attempt++ {
        err := fn(ctx)
        if err == nil {
            return nil
        }
        if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
            return err
        }
        select {
        case <-ctx.Done():
            return ctx.Err()
        case <-time.After(backoff):
        }
        backoff *= 2
    }
    return errors.New("max attempts exceeded")
}
```

Two cancellation checks: explicit detection of context errors from the inner call, and the `select` during the backoff sleep. Without the sleep `select`, a long backoff would ignore cancellation for the duration.

Note that `time.After(backoff)` leaks the timer until it fires. For high-throughput retries, use `time.NewTimer` with explicit `Stop` to avoid timer accumulation.

---

## Cancellation in publish-subscribe patterns

A pub-sub system has one publisher and many subscribers. Cancellation must reach every subscriber.

```go
type Broker struct {
    mu          sync.Mutex
    subscribers []chan Event
}

func (b *Broker) Subscribe(ctx context.Context) <-chan Event {
    ch := make(chan Event, 16)
    b.mu.Lock()
    b.subscribers = append(b.subscribers, ch)
    b.mu.Unlock()

    go func() {
        <-ctx.Done()
        b.mu.Lock()
        defer b.mu.Unlock()
        for i, s := range b.subscribers {
            if s == ch {
                b.subscribers = append(b.subscribers[:i], b.subscribers[i+1:]...)
                close(ch)
                return
            }
        }
    }()
    return ch
}

func (b *Broker) Publish(ev Event) {
    b.mu.Lock()
    defer b.mu.Unlock()
    for _, s := range b.subscribers {
        select {
        case s <- ev:
        default:
            // subscriber is slow; drop the event
        }
    }
}
```

Each subscriber has a watcher goroutine that observes `ctx.Done()` and unsubscribes. The publisher uses `select` with `default` to avoid blocking on slow subscribers; this is the "drop on overflow" policy.

Other policies exist:

- Block until the slow subscriber catches up (back-pressure).
- Buffer per-subscriber and drop the oldest event.
- Disconnect the subscriber that cannot keep up.

Each policy interacts with cancellation differently. Block-until-catches-up combined with a cancelled subscriber would deadlock; the `select` must include `<-ctx.Done()`.

---

## Reasoning about goroutine ownership

A subtle but important middle-level concept: every goroutine has an *owner*. The owner is the code responsible for:

- Starting it (calling `go`).
- Cancelling it (via shared context or done channel).
- Waiting for it to exit (via `WaitGroup`, channel, or errgroup).

If you spawn a goroutine and do not document its owner, you have created an orphan. Orphans become leaks when nobody cleans them up.

A useful exercise during code review: for every `go` keyword, ask "who owns this?" The answer should be a function or a struct that has explicit responsibility. "It exits when its channel closes" is fine if the channel close is owned somewhere. "It runs until the program exits" is acceptable for true background tasks, but only if cancellation is wired to shutdown.

The `errgroup` pattern formalises ownership: every `g.Go` is owned by the errgroup, which is owned by the function that called `WithContext`. Walk up the chain and you find a single owner.

---

## Further Reading

- `golang.org/x/sync/errgroup` docs: <https://pkg.go.dev/golang.org/x/sync/errgroup>
- `context.AfterFunc`: <https://pkg.go.dev/context#AfterFunc>
- `context.WithCancelCause`: <https://pkg.go.dev/context#WithCancelCause>
- `go.uber.org/goleak`: <https://pkg.go.dev/go.uber.org/goleak>
- The Go Blog — *Pipelines and cancellation*: <https://go.dev/blog/pipelines>
- *Concurrency in Go* by Katherine Cox-Buday, Chapter 4.

---
