---
layout: default
title: Middle
parent: Error Propagation
grand_parent: Pipeline Production Patterns
ancestor: Go
nav_order: 3
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/19-pipeline-production-patterns/01-error-propagation/middle/
---

# Error Propagation in Pipelines — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Sentinel Errors as Design](#sentinel-errors-as-design)
4. [errors.Is and errors.As in Depth](#errorsis-and-errorsas-in-depth)
5. [Fan-out Error Coordination](#fan-out-error-coordination)
6. [SetLimit and Bounded Parallelism](#setlimit-and-bounded-parallelism)
7. [Draining Patterns](#draining-patterns)
8. [Goroutine Lifetime Management](#goroutine-lifetime-management)
9. [Per-Item Retry Inside a Stage](#per-item-retry-inside-a-stage)
10. [Parent Context Interaction](#parent-context-interaction)
11. [Cancellation vs Failure](#cancellation-vs-failure)
12. [Nested Pipelines](#nested-pipelines)
13. [Mid-Level Code Examples](#mid-level-code-examples)
14. [Coding Patterns](#coding-patterns)
15. [Clean Code](#clean-code)
16. [Product Use](#product-use)
17. [Error Handling Strategy](#error-handling-strategy)
18. [Performance Considerations](#performance-considerations)
19. [Best Practices](#best-practices)
20. [Edge Cases](#edge-cases)
21. [Common Mistakes](#common-mistakes)
22. [Misconceptions](#misconceptions)
23. [Tricky Points](#tricky-points)
24. [Test](#test)
25. [Tricky Questions](#tricky-questions)
26. [Cheat Sheet](#cheat-sheet)
27. [Self-Assessment](#self-assessment)
28. [Summary](#summary)
29. [Further Reading](#further-reading)

---

## Introduction
> Focus: "I know `errgroup`. Now I need to design errors as part of the API — name them, type them, and route them — and I need fan-out with bounded parallelism, retries, and clean shutdown."

At junior level you learned the mechanics: `errgroup.WithContext`, `defer close(out)`, `select` on `ctx.Done()`, `%w` wrapping. This file pivots from mechanics to *design*. Real pipelines are not three-stage toys. They are five-to-ten stages with fan-out, retries, and a public error vocabulary that callers depend on.

By the end of this file you will:

- Choose between sentinel errors, error types, and opaque errors for a stage's public API
- Use `errors.Is`/`errors.As` with confidence, including custom `Is`/`As` methods
- Coordinate fan-out within a single stage where N workers consume one input channel
- Use `g.SetLimit` and `g.TryGo` to bound parallelism
- Implement clean draining when a consumer exits early
- Reason about goroutine lifetime — every spawned goroutine has a defined termination
- Implement per-item retry inside a stage with backoff and a budget
- Handle parent vs derived context cancellation distinctly
- Build nested pipelines that propagate errors up multiple layers

---

## Prerequisites

- Junior file in this series.
- Comfort with `errgroup.Group`, `g.Go`, `g.Wait`, `g.SetLimit`.
- Solid grasp of `context.Context`: `WithCancel`, `WithTimeout`, `WithDeadline`, `WithValue`.
- Comfortable writing custom error types with `Error()` and `Unwrap()`.
- Knowledge of `sync.Mutex`, `sync.RWMutex`, `sync.WaitGroup`, `sync/atomic`.

---

## Sentinel Errors as Design

A **sentinel error** is a package-level error value used as an identity marker. The standard library has many: `io.EOF`, `sql.ErrNoRows`, `context.Canceled`, `os.ErrNotExist`. They are the simplest typed-error API: "this *specific* failure happened."

### When to use

- The failure is a well-known, atomic condition.
- The caller will branch on it (different recovery for not-found vs network-down).
- The caller does not need data about the failure, just its identity.

### Naming convention

```go
var (
    ErrNotFound      = errors.New("not found")
    ErrAlreadyExists = errors.New("already exists")
    ErrInvalid       = errors.New("invalid")
)
```

The package prefix conveys ownership. `pkg.ErrNotFound`. Lowercase first word, no trailing punctuation, no "error:" prefix (`errors.New` adds no prefix itself).

### Sentinels and wrapping

Sentinels are designed to be wrapped:

```go
func (s *Store) Get(id int) (Item, error) {
    var it Item
    err := s.db.QueryRow("SELECT ... WHERE id = ?", id).Scan(...)
    if err == sql.ErrNoRows {
        return Item{}, fmt.Errorf("store.Get(%d): %w", id, ErrNotFound)
    }
    if err != nil {
        return Item{}, fmt.Errorf("store.Get(%d): %w", id, err)
    }
    return it, nil
}
```

Callers:

```go
it, err := store.Get(42)
switch {
case errors.Is(err, ErrNotFound):
    return defaultItem(), nil
case err != nil:
    return Item{}, fmt.Errorf("handler: %w", err)
}
```

The sentinel is the contract. The wrapping adds context.

### Sentinels in pipelines

Pipelines often have stage-specific sentinels for known recoverable conditions:

```go
var (
    ErrSkip       = errors.New("skip this item")
    ErrPoisonMsg  = errors.New("poison message, drop")
    ErrRateLimit  = errors.New("rate limit, retry later")
)
```

A stage returns `ErrSkip` to mean "don't fail the pipeline, but don't propagate this item." The next stage's loop handles it:

```go
for v := range in {
    result, err := process(v)
    switch {
    case errors.Is(err, ErrSkip):
        continue
    case errors.Is(err, ErrPoisonMsg):
        deadLetter(v)
        continue
    case err != nil:
        return fmt.Errorf("process: %w", err)
    }
    select {
    case <-ctx.Done(): return ctx.Err()
    case out <- result:
    }
}
```

This is the controlled-sentinel pattern. Sentinels become a vocabulary of expected outcomes that don't break the pipeline.

### Avoid sentinel explosion

Don't create a sentinel for every error. If you find yourself with 20 sentinels, you probably want a typed error with an `enum`-like field:

```go
type Kind int
const (
    KindNotFound Kind = iota
    KindAlreadyExists
    KindInvalid
)

type StoreError struct {
    Kind Kind
    Err  error
}

func (e *StoreError) Error() string { ... }
func (e *StoreError) Unwrap() error { return e.Err }
```

Discussed below under typed errors.

---

## errors.Is and errors.As in Depth

These are the two functions you'll use most. Let's look at their semantics and edge cases.

### `errors.Is(err, target) bool`

Pseudocode of the implementation:

```go
func Is(err, target error) bool {
    if target == nil { return err == target }
    isComparable := reflectlite.TypeOf(target).Comparable()
    for {
        if isComparable && err == target { return true }
        if x, ok := err.(interface{ Is(error) bool }); ok && x.Is(target) {
            return true
        }
        err = Unwrap(err)
        if err == nil { return false }
    }
}
```

Two ways to match:

1. **Direct equality** with `==`. Used for sentinels.
2. **Custom `Is(target error) bool` method** on a wrapper or custom type. Useful when you want a type to match a known sentinel.

A common use of method 2: making a typed error satisfy `errors.Is(ctx.Err(), context.Canceled)`:

```go
type Cancelled struct { Reason string }
func (c *Cancelled) Error() string { return c.Reason }
func (c *Cancelled) Is(target error) bool {
    return target == context.Canceled
}
```

Now `errors.Is(&Cancelled{Reason: "user"}, context.Canceled)` returns true.

### `errors.As(err, target) bool`

Walks the chain looking for an error assignable to `*target`. Pseudocode:

```go
func As(err error, target any) bool {
    if err == nil { return false }
    val := reflectlite.ValueOf(target)
    if val.Kind() != reflectlite.Ptr || val.IsNil() {
        panic("errors: target must be a non-nil pointer")
    }
    targetType := val.Elem().Type()
    if targetType.Kind() != reflectlite.Interface && !targetType.Implements(errorType) {
        panic("errors: *target must be interface or implement error")
    }
    for err != nil {
        if reflectlite.TypeOf(err).AssignableTo(targetType) {
            val.Elem().Set(reflectlite.ValueOf(err))
            return true
        }
        if x, ok := err.(interface{ As(any) bool }); ok && x.As(target) {
            return true
        }
        err = Unwrap(err)
    }
    return false
}
```

Used to extract structured information:

```go
type PathError struct { Op, Path string; Err error }
func (p *PathError) Error() string { return p.Op + " " + p.Path + ": " + p.Err.Error() }
func (p *PathError) Unwrap() error { return p.Err }

var pe *PathError
if errors.As(err, &pe) {
    fmt.Println("operation:", pe.Op, "path:", pe.Path)
}
```

`errors.As` traverses through wrappers. So even if your `*PathError` is wrapped by three `fmt.Errorf` layers, `errors.As` finds it.

### Don't use `==` outside of `errors.Is`

`if err == io.EOF` is *almost always* wrong in modern Go. If anyone between you and the source wraps the error, your `==` fails. Use `errors.Is(err, io.EOF)`. The only exception: you just received the error and you know it has not been wrapped (rare; only safe at the very innermost layer).

### Walking the chain manually

Sometimes useful:

```go
for e := err; e != nil; e = errors.Unwrap(e) {
    fmt.Println("layer:", e)
}
```

Or with the new multi-unwrap interface (1.20+):

```go
type multiUnwrapper interface { Unwrap() []error }
```

`errors.Join` returns an error implementing this. To walk, use a recursive function or `errors.Is`/`errors.As` (which handle both single and multi-unwrap correctly).

---

## Fan-out Error Coordination

A common pipeline shape: a stage has *one input channel* but *N parallel workers*. Each worker reads from the same channel, processes, writes to a shared output. This is fan-out within a stage.

### Naive fan-out

```go
const N = 4
g.Go(func() error {
    defer close(out)
    var wg sync.WaitGroup
    for i := 0; i < N; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for v := range in {
                result := process(v)
                out <- result
            }
        }()
    }
    wg.Wait()
    return nil
})
```

Problems:

- No error handling inside workers. If `process` fails, the goroutine continues.
- No cancellation in `out <- result`.
- One workers' early exit doesn't stop the others.

### Fan-out with nested errgroup

```go
const N = 4
g.Go(func() error {
    defer close(out)
    inner, ctx := errgroup.WithContext(ctx)
    for i := 0; i < N; i++ {
        inner.Go(func() error {
            for v := range in {
                result, err := process(ctx, v)
                if err != nil {
                    return fmt.Errorf("worker: %w", err)
                }
                select {
                case <-ctx.Done(): return ctx.Err()
                case out <- result:
                }
            }
            return nil
        })
    }
    return inner.Wait()
})
```

Now any worker's failure cancels its siblings *and* propagates up to the outer group. The outer group then cancels the upstream producer too. Clean.

### Why two errgroups instead of one

You could in principle launch all N workers directly with the outer group's `g.Go`. But:

- Closing `out` becomes ambiguous: which of the N workers closes it?
- You lose the encapsulation of "this stage has its own internal concurrency."

With the nested group, `inner.Wait()` returns when all N workers exit, then `defer close(out)` runs once. The stage looks like a single unit to the outer group.

### Pattern: collector inside fan-out

If each worker computes a result that needs aggregating (sum, count), use a result channel:

```go
g.Go(func() error {
    inner, ctx := errgroup.WithContext(ctx)
    results := make(chan int, N)
    for i := 0; i < N; i++ {
        inner.Go(func() error {
            for v := range in {
                r, err := process(ctx, v)
                if err != nil { return err }
                select {
                case <-ctx.Done(): return ctx.Err()
                case results <- r:
                }
            }
            return nil
        })
    }
    go func() { inner.Wait(); close(results) }()
    total := 0
    for r := range results {
        total += r
    }
    return inner.Wait() // already-finished group returns its captured error
})
```

Note the auxiliary goroutine that waits for `inner` then closes `results`. Without it, `for r := range results` blocks forever. This is a "channel close coordinator" — a pattern you'll see often.

---

## SetLimit and Bounded Parallelism

`g.SetLimit(n)` caps the number of active goroutines in the group at `n`. Subsequent `g.Go` calls block until a slot is free. Useful when:

- Fan-out width should be bounded by CPU or remote-service capacity.
- You're processing a huge slice and don't want millions of simultaneous goroutines.

```go
g, ctx := errgroup.WithContext(ctx)
g.SetLimit(runtime.NumCPU())
for _, item := range items {
    item := item
    g.Go(func() error {
        return process(ctx, item)
    })
}
return g.Wait()
```

Each `g.Go` waits if `n` workers are already running. When one returns, the next is admitted.

### SetLimit and cancellation

`SetLimit` does not provide a non-blocking spawn. If you've called `Go` and it's waiting for a slot, it ignores `ctx.Done()`. The blocked `Go` returns only when a slot frees. For non-blocking spawn:

```go
if !g.TryGo(func() error { return process(ctx, item) }) {
    // capacity full; back off, retry, or skip
}
```

`TryGo` returns false if at capacity, without blocking.

### Choosing the limit

Common defaults:

- **CPU-bound work**: `runtime.NumCPU()` or `runtime.NumCPU() * 2`.
- **I/O-bound work**: higher, like `32` or `64`, limited by remote service rate limits.
- **DB queries**: match the connection pool size.
- **HTTP fetches**: limited by the host's robots.txt or your contract.

Measure. The "right" number is the one that maxes throughput without saturating the bottleneck resource.

### SetLimit vs custom semaphore

Before `SetLimit` (added 2022), people used `semaphore.Weighted` from `golang.org/x/sync/semaphore`:

```go
sem := semaphore.NewWeighted(int64(N))
for _, item := range items {
    item := item
    if err := sem.Acquire(ctx, 1); err != nil { return err }
    g.Go(func() error {
        defer sem.Release(1)
        return process(ctx, item)
    })
}
```

`SetLimit` does the same thing, simpler. Use `SetLimit` for new code unless you need the weighted semantics (`Acquire(ctx, 3)` to take 3 slots at once).

---

## Draining Patterns

When a consumer exits early (due to an error or cancellation), what happens to the upstream producer that's still sending? If the producer's send is wrapped in `select { case <-ctx.Done(): ...; case out <- v: }`, it exits via the context branch and life is good. But if not, it blocks forever.

### Active draining

Sometimes you need to *actively* drain a channel to let the producer finish:

```go
// Producer keeps writing until we close ctx or fully drain.
defer func() {
    cancel()
    for range in {
        // discard
    }
}()
```

This is rare in production; better to fix the producer to honour `ctx.Done()`.

### Producer-side correctness

Always:

```go
for _, v := range items {
    select {
    case <-ctx.Done():
        return ctx.Err()
    case out <- v:
    }
}
```

The producer cooperates. The consumer doesn't have to drain. This is the cleaner architecture.

### Closing on early exit

If the producer exits with an error, it must still close its output channel so the consumer's `for range` exits:

```go
g.Go(func() error {
    defer close(out)
    for _, v := range items {
        select {
        case <-ctx.Done(): return ctx.Err()
        case out <- v:
        }
    }
    return nil
})
```

The `defer close(out)` runs no matter how the goroutine exits — clean, error, or cancellation.

### Consumer-side correctness

The consumer should range until close:

```go
for v := range in {
    if err := process(v); err != nil { return err }
}
return nil
```

No explicit drain needed. The `for range` consumes everything up to close, then exits.

### What about leftover work?

If the consumer returns early on error, *and* the producer respects `ctx.Done()`, *and* close is deferred, everything terminates. The "leftover" items the producer might have produced are simply not produced — the producer exited before sending them. The downstream sees a closed channel.

This is the elegance of the pattern: errors trigger context cancellation, which causes producers to exit, which causes downstream channels to close, which causes consumers to exit. All without explicit drains.

---

## Goroutine Lifetime Management

A goroutine has *three* lifetime questions:

1. **Birth**: who spawned it, with what arguments?
2. **Termination conditions**: what exit paths exist?
3. **Cleanup**: what resources does it release?

Junior-level code answers #1 well. Middle-level code answers all three.

### Termination conditions checklist

For each goroutine, ask:

- Does it have a `defer` for every resource it holds (`Close`, `Unlock`, `close(ch)`)?
- Does every blocking operation have a cancellation branch?
- Is there at least one path where the goroutine exits cleanly?
- Is there at least one path for cancellation?
- Is there at least one path for internal errors?
- Are these paths mutually exclusive (the goroutine doesn't accidentally take two)?

### Diagram: lifetime of a stage

```
spawned by g.Go
    |
    +--> read from in
    |     |
    |     +--> ctx cancelled?
    |     |     yes -> return ctx.Err() (defer close(out))
    |     |     no  -> v = received
    |     +--> in closed?
    |           yes -> return nil (defer close(out))
    |           no  -> proceed
    |
    +--> process(v)
    |     +--> error? yes -> return wrapped err (defer close(out))
    |
    +--> send to out
          +--> ctx cancelled? yes -> return ctx.Err() (defer close(out))
          +--> sent OK -> loop
```

Every diamond is a decision; every leaf is a clean exit. If you can draw this for each stage, your pipeline is sound.

### Spawning goroutines you don't track

Anti-pattern:

```go
g.Go(func() error {
    go logProgress(ctx) // spawned, but not tracked by g
    return doWork(ctx)
})
```

`logProgress` is now a "free" goroutine. It may outlive the group. It may leak. Better:

```go
g.Go(func() error {
    logCh := make(chan struct{})
    go func() {
        defer close(logCh)
        logProgress(ctx)
    }()
    err := doWork(ctx)
    <-logCh // wait for logger
    return err
})
```

Or use a nested `errgroup`. Any goroutine you start, you must wait for.

### The "fire and forget" anti-pattern

```go
go cleanupAsync()
```

This is acceptable *only* if `cleanupAsync` is guaranteed to exit on its own without external coordination. In a service that runs for years, "guaranteed to exit" is a high bar — better to schedule it via a worker pool, a timer, or some other tracked mechanism.

---

## Per-Item Retry Inside a Stage

Real pipelines have transient failures: network blips, rate limits, lock contention. Per-item retry inside a stage avoids killing the pipeline for ephemeral problems.

### Basic retry with backoff

```go
func processWithRetry(ctx context.Context, v Item, maxAttempts int) error {
    var lastErr error
    for attempt := 0; attempt < maxAttempts; attempt++ {
        err := process(ctx, v)
        if err == nil {
            return nil
        }
        if !isTransient(err) {
            return err // permanent failure, no retry
        }
        lastErr = err
        backoff := time.Duration(1<<attempt) * 100 * time.Millisecond
        select {
        case <-ctx.Done():
            return ctx.Err()
        case <-time.After(backoff):
        }
    }
    return fmt.Errorf("after %d attempts: %w", maxAttempts, lastErr)
}
```

Key points:

- Exponential backoff: `1<<attempt` for delay.
- Cancellation respected in the sleep.
- Distinguish transient from permanent errors with `isTransient` (typically checks for network errors, 503s, etc.).
- Wrap the final error with attempt count for observability.

### Jitter

Without jitter, retries from many concurrent goroutines synchronise and "thundering-herd" the failed service. Add randomness:

```go
backoff := time.Duration(1<<attempt) * 100 * time.Millisecond
jitter := time.Duration(rand.Int63n(int64(backoff / 2)))
backoff += jitter
```

Or use a library like `github.com/cenkalti/backoff` that handles this.

### Retry budget

Limit total retries per pipeline run, not per item:

```go
type RetryBudget struct {
    total int64
    used  atomic.Int64
}

func (b *RetryBudget) Try() bool {
    return b.used.Add(1) <= b.total
}
```

In the worker:

```go
if !budget.Try() {
    return fmt.Errorf("retry budget exhausted: %w", lastErr)
}
```

This prevents one flaky item from consuming all retries for the run.

### Idempotency considerations

Retrying makes sense only if the operation is idempotent — calling it twice doesn't double-execute side effects. For non-idempotent operations (charging a credit card), retries need an idempotency key sent with each attempt.

---

## Parent Context Interaction

`errgroup.WithContext(parent)` returns a child context. When the *parent* is cancelled:

- The child context's `Done()` channel closes.
- Every stage that's `select`-ing on `<-ctx.Done()` sees it.
- The first stage to return a non-nil error captures it via `sync.Once`.
- That error is *whatever* the stage returned — usually `ctx.Err() == context.Canceled`.

So `g.Wait()` returns `context.Canceled` (assuming nobody else failed). The caller should check:

```go
err := g.Wait()
switch {
case err == nil:
    return nil
case errors.Is(parent.Err(), context.Canceled):
    return parent.Err() // explicitly: cancelled by parent
case errors.Is(parent.Err(), context.DeadlineExceeded):
    return parent.Err()
default:
    return err
}
```

### `ctx.Err()` vs `g.Wait()` error

These can differ. Consider:

- Stage 1 fails with `ErrBadInput` at t=1.
- errgroup captures `ErrBadInput`, cancels its derived context.
- Stage 2, on `<-derivedCtx.Done()`, returns `context.Canceled`.
- errgroup ignores stage 2's error (first-wins).
- `g.Wait()` returns `ErrBadInput`.

But the *parent* context was never cancelled. `parent.Err() == nil`. The derived context's `Err()` is `context.Canceled` — but that's the *derived* one, controlled by errgroup, not your concern.

The rule: distinguish "we cancelled because we failed internally" (`g.Wait()` returns a non-cancel error) from "parent cancelled us externally" (`parent.Err() != nil`).

### Deadline plumbing

If you want a deadline on the whole pipeline:

```go
ctx, cancel := context.WithTimeout(parent, 30*time.Second)
defer cancel()
g, ctx := errgroup.WithContext(ctx)
// ... pipeline ...
return g.Wait()
```

`g.Wait()` will return `context.DeadlineExceeded` (wrapped from a stage that hit the deadline) if the pipeline takes too long. Often distinguished:

```go
err := g.Wait()
if errors.Is(err, context.DeadlineExceeded) {
    return fmt.Errorf("pipeline timeout: %w", err)
}
```

### Per-stage deadlines

Sometimes you want a short per-stage deadline, separate from the pipeline-wide deadline:

```go
g.Go(func() error {
    sctx, cancel := context.WithTimeout(ctx, 5*time.Second)
    defer cancel()
    return stage(sctx)
})
```

Here `sctx` is cancelled either by the parent (`ctx`) or by its own 5-second timeout. The stage returns whichever fired first.

---

## Cancellation vs Failure

These are *different* in error vocabulary. A handler should treat them differently:

```go
err := pipeline.Run(ctx)
switch {
case err == nil:
    return Success()
case errors.Is(err, context.Canceled):
    // user cancelled, not a service failure
    log.Info("cancelled")
    return Cancelled()
case errors.Is(err, context.DeadlineExceeded):
    // timeout, may be retryable
    log.Warn("timeout", "err", err)
    return Timeout()
case errors.Is(err, pipeline.ErrTransient):
    // transient internal failure
    return Retry()
default:
    // permanent failure
    log.Error("failure", "err", err)
    return Failure()
}
```

### Detecting "cancelled because we failed"

If your pipeline returned `context.Canceled`, was it because:

(a) the parent context was cancelled by the caller, or
(b) errgroup cancelled its derived context after capturing some other error?

In the latter case, you'd expect `g.Wait()` to return the original error, not `context.Canceled`. So if you see `context.Canceled` at the top, it's almost always (a). To be sure:

```go
err := g.Wait()
if errors.Is(err, context.Canceled) && parent.Err() == nil {
    // weird — derived was cancelled but parent isn't. Likely a stage
    // returned ctx.Err() before its peer's "real" error reached errOnce.
    // Rare race; you may want to inspect logs.
}
```

In practice this race is uncommon because the "real" error and `ctx.Err()` from siblings race against `sync.Once`, and the real one usually wins because the failing stage `return`s it before context propagation reaches siblings.

---

## Nested Pipelines

A pipeline can have a pipeline inside it. Common in real services:

```go
func TopLevel(ctx context.Context, jobs []Job) error {
    g, ctx := errgroup.WithContext(ctx)
    for _, j := range jobs {
        j := j
        g.Go(func() error {
            return processJob(ctx, j) // each job runs its own internal pipeline
        })
    }
    return g.Wait()
}

func processJob(ctx context.Context, j Job) error {
    g, ctx := errgroup.WithContext(ctx)
    // Inner stages...
    return g.Wait()
}
```

### Cancellation cascade

- Parent cancelled -> top-level ctx cancelled -> every `processJob` sees cancellation.
- One job fails -> top-level group captures error -> top-level ctx cancelled -> *other* jobs see cancellation.
- One job's internal stage fails -> its inner group captures error -> its inner ctx cancelled -> its other stages see cancellation -> `processJob` returns error -> top-level captures.

Each layer is well-defined. Nested errgroups compose cleanly.

### Where to wrap

Wrap at every layer boundary:

```go
func processJob(ctx context.Context, j Job) error {
    g, ctx := errgroup.WithContext(ctx)
    // ...
    if err := g.Wait(); err != nil {
        return fmt.Errorf("job %s: %w", j.ID, err)
    }
    return nil
}
```

Now the top-level error chain looks like: `job abc123: parse row 42: bad row: ...`.

### Bounded nesting

Don't go three layers deep without a strong reason. Two layers (top-level fan-out + per-item internal pipeline) is common; three is unusual; four is usually a smell.

---

## Mid-Level Code Examples

### Example: Fan-out with bounded parallelism and per-item retry

```go
func DownloadAll(ctx context.Context, urls []string, dir string) error {
    g, ctx := errgroup.WithContext(ctx)
    g.SetLimit(8)

    for _, u := range urls {
        u := u
        g.Go(func() error {
            return downloadWithRetry(ctx, u, dir, 3)
        })
    }
    return g.Wait()
}

func downloadWithRetry(ctx context.Context, url, dir string, maxAttempts int) error {
    var lastErr error
    for attempt := 0; attempt < maxAttempts; attempt++ {
        err := downloadOnce(ctx, url, dir)
        if err == nil {
            return nil
        }
        if !isTransient(err) {
            return fmt.Errorf("download %s: %w", url, err)
        }
        lastErr = err

        wait := time.Duration(1<<attempt) * 200 * time.Millisecond
        select {
        case <-ctx.Done():
            return ctx.Err()
        case <-time.After(wait):
        }
    }
    return fmt.Errorf("download %s after %d attempts: %w", url, maxAttempts, lastErr)
}

func isTransient(err error) bool {
    if errors.Is(err, context.DeadlineExceeded) {
        return true // could be a network-level timeout
    }
    var netErr *net.OpError
    if errors.As(err, &netErr) {
        return true
    }
    return false
}
```

### Example: Stage with internal fan-out and aggregate

```go
func transformAll(ctx context.Context, in <-chan Job, out chan<- Result) error {
    defer close(out)
    inner, ctx := errgroup.WithContext(ctx)
    const workers = 4
    for i := 0; i < workers; i++ {
        inner.Go(func() error {
            for j := range in {
                r, err := transform(ctx, j)
                if err != nil {
                    return fmt.Errorf("transform: %w", err)
                }
                select {
                case <-ctx.Done(): return ctx.Err()
                case out <- r:
                }
            }
            return nil
        })
    }
    return inner.Wait()
}
```

This stage looks like one goroutine to the outer pipeline but internally has 4 workers. Notice `defer close(out)` runs after `inner.Wait()` returns, ensuring all 4 workers have stopped writing.

### Example: Typed error with stage attribution

```go
type StageError struct {
    Stage string
    Err   error
}

func (e *StageError) Error() string {
    return e.Stage + ": " + e.Err.Error()
}
func (e *StageError) Unwrap() error { return e.Err }

func parseStage(ctx context.Context, in <-chan []byte, out chan<- Record) error {
    defer close(out)
    for b := range in {
        var r Record
        if err := json.Unmarshal(b, &r); err != nil {
            return &StageError{Stage: "parse", Err: err}
        }
        select {
        case <-ctx.Done(): return ctx.Err()
        case out <- r:
        }
    }
    return nil
}
```

Caller:

```go
var se *StageError
if errors.As(err, &se) {
    metrics.Counter("pipeline.failures", "stage", se.Stage).Inc()
}
```

The stage attribution survives wrapping. The caller can branch on stage without parsing strings.

### Example: Aggregating partial errors per item (preview of senior level)

```go
type ItemResult struct {
    Item   Item
    Err    error
}

func processAll(ctx context.Context, items []Item) ([]ItemResult, error) {
    g, ctx := errgroup.WithContext(ctx)
    g.SetLimit(16)

    results := make([]ItemResult, len(items))
    for i, it := range items {
        i, it := i, it
        g.Go(func() error {
            err := process(ctx, it)
            results[i] = ItemResult{Item: it, Err: err}
            return nil // do NOT propagate; we want all items processed
        })
    }
    if err := g.Wait(); err != nil {
        return results, err
    }
    return results, nil
}
```

Note: by returning `nil` from each `g.Go`, we sidestep first-error-wins and capture per-item results. The caller can then decide what to do (fail if any errored, return partial results, etc.).

---

## Coding Patterns

### Pattern: Stage as a typed function

```go
type Stage[I, O any] func(ctx context.Context, in <-chan I, out chan<- O) error
```

Standardise the signature. Stages become composable. The outer pipeline wires them up.

### Pattern: Group as private state

```go
type Pipeline struct {
    g     *errgroup.Group
    ctx   context.Context
}

func New(ctx context.Context) *Pipeline {
    g, ctx := errgroup.WithContext(ctx)
    return &Pipeline{g: g, ctx: ctx}
}

func (p *Pipeline) AddStage(fn func() error) {
    p.g.Go(fn)
}

func (p *Pipeline) Wait() error {
    return p.g.Wait()
}
```

Useful when you want to expose pipeline-building without leaking errgroup details.

### Pattern: Stage builder with retry

```go
func WithRetry(stage func(ctx context.Context) error, attempts int) func() error {
    return func() error {
        for i := 0; i < attempts; i++ {
            err := stage(ctx)
            if err == nil || !isTransient(err) { return err }
        }
        return errors.New("retries exhausted")
    }
}

g.Go(WithRetry(parseStage, 3))
```

### Pattern: Per-stage timeout

```go
g.Go(func() error {
    sctx, cancel := context.WithTimeout(ctx, 30*time.Second)
    defer cancel()
    return stage(sctx)
})
```

---

## Clean Code

Middle-level pipelines are easier to read when:

1. Each stage is a named function: `parseStage`, `enrichStage`, `storeStage`. Not inline closures.
2. Channels are created in the calling function (the pipeline orchestrator), not inside stages.
3. The orchestrator has < 30 lines of body. Most logic is in stages.
4. Public errors (sentinels and types) are defined in one block at package top.
5. `errors.Is` / `errors.As` calls are at module boundaries, not scattered.
6. Resource cleanup uses `defer`; never bare manual cleanup that can be skipped.
7. `time.Sleep` is never used for synchronisation; only `time.After` inside a `select`.
8. Tests cover both success and at least one failure path per stage.

---

## Product Use

### When to invest in error design

If your pipeline runs once and is thrown away — don't bother with typed errors. Just return strings.

If your pipeline is core infrastructure (queue worker, batch importer, ETL job) — design errors as part of the public API. Future callers depend on:

- Knowing which sentinel errors exist (`ErrNotFound`, `ErrRateLimit`).
- Being able to extract structured data from typed errors.
- Stage attribution for metrics.

### Observability

Every pipeline run should emit:

- A counter incremented on success/failure.
- A latency histogram.
- A structured log per failure, with the full error chain.
- A counter per known error type/sentinel, so dashboards can show "rate of ErrRateLimit" separately.

This requires the error API to be self-describing. Sentinels and typed errors give you that.

### Backpressure as a product concern

If your pipeline ingests faster than it processes (queue grows), errors are not the bottleneck — capacity is. But errors interact: retries can balloon work, transient failures cascade. Monitor queue depth alongside error rates.

---

## Error Handling Strategy

A coherent strategy at middle level:

1. **Define your error vocabulary** at the package level. List sentinels and typed errors. Document them.
2. **Wrap at boundaries**, not inside. Each function wraps once on the way out if it has new context to add.
3. **Match at boundaries**, not in the middle. Use `errors.Is`/`errors.As` where decisions are made (HTTP handler, retry loop), not in deep helpers.
4. **Reserve sentinels for expected conditions.** Use unique types for failures the caller might want to inspect deeply.
5. **Never convert error to string and back.** It's lossy.
6. **Distinguish operational from programmer errors.** Operational: network down, file not found, retry maybe. Programmer: nil pointer, out of range. Panic for the latter.

---

## Performance Considerations

### Allocation cost of fmt.Errorf

`fmt.Errorf("foo: %w", err)` allocates a wrapper. For pipelines processing millions of items per second, this adds up. Mitigation:

- Pre-allocate sentinel errors (`var ErrSkip = errors.New("skip")`) and return them directly when possible.
- For hot paths, wrap *outside* the loop:

```go
for _, it := range items {
    if err := process(it); err != nil {
        return fmt.Errorf("process: %w", err) // wraps once outside the hot path? No, this is still inside. But you only wrap on errors, not on every item.
    }
}
```

Wrapping is per-error, not per-item. If errors are rare (the normal case), allocation is negligible.

### Goroutine spawn cost

Each `g.Go` is a goroutine; ~1.5 µs to start. For 10k items, that's 15 ms of overhead just for spawning. With `SetLimit(N)`, you spawn N goroutines and reuse them, sidestepping the overhead.

### Channel contention

A buffered channel with one writer and one reader is essentially free. With multiple writers (fan-in), each `send` may contend on the channel's internal lock. For very high throughput (>1M ops/sec), measure with the `-race`-off binary; consider sharding into multiple channels.

### Lock-free patterns

For aggregating results across N workers without a mutex, write to distinct slots in a pre-allocated slice:

```go
results := make([]Result, len(items))
for i, it := range items {
    i, it := i, it
    g.Go(func() error {
        r, err := process(it)
        if err != nil { return err }
        results[i] = r // each i is unique; no race
        return nil
    })
}
```

This is the "result slot" pattern. Provided each goroutine writes to a unique index, no synchronisation is needed beyond `g.Wait`'s happens-before.

---

## Best Practices

1. Always use `errgroup.WithContext`; never bare `errgroup.Group{}`.
2. `SetLimit` whenever fan-out can be large (>32).
3. Define sentinels at package level; document them in the package doc.
4. Wrap errors with `%w` at every stage boundary.
5. `errors.Is` / `errors.As` at module boundaries.
6. Every blocking op is `select`ed against `<-ctx.Done()`.
7. Every output channel is closed by exactly one goroutine.
8. Every goroutine is `defer`ed to clean up resources.
9. Retries inside stages, not outside; with budget and backoff.
10. Distinguish cancellation from failure at the caller.

---

## Edge Cases

### Edge case: cancellation during retry sleep

```go
case <-time.After(backoff):
```

If `ctx` is cancelled during the sleep, this case won't fire — but the goroutine is stuck waiting for `time.After`. Fix:

```go
select {
case <-ctx.Done(): return ctx.Err()
case <-time.After(backoff):
}
```

Always include the cancellation case. `time.After` keeps a timer in the runtime — if not used, it leaks until the deadline. (Modern Go GC handles this; older Go versions don't.)

### Edge case: `SetLimit` after `Go`

`SetLimit` after `Go` panics. Always call `SetLimit` before any `Go`.

### Edge case: zero limit

`SetLimit(0)` is allowed and means "no parallelism — Go calls run serially when blocked." Rarely useful.

### Edge case: error from cancelled stage

If a stage returns `context.Canceled` *and* a real error from a sibling, errgroup captures whichever was returned first. Usually the real error wins; in rare timing edge cases, you may see `context.Canceled`. The pipeline-level fix: ensure stages return their *real* error before returning `ctx.Err()`.

### Edge case: multiple errors of the same kind

If 5 workers all fail with `ErrRateLimit`, errgroup captures one. You don't know the rate. Mitigation: aggregate per-item (senior level) or count separately with an atomic counter.

---

## Common Mistakes

1. **Not wrapping in `processJob` boundary.** Errors get to the top with no context.
2. **`SetLimit` too aggressive.** Limit set to 2 when CPUs are 16: pipeline is artificially slow.
3. **`SetLimit` too loose.** Limit set to 1000 for HTTP fetches: target service rate-limits or crashes.
4. **Mixing `g.Go` and bare `go`.** Some goroutines tracked, others not. Leak risk.
5. **Capturing the wrong `ctx`.** In nested errgroups, the inner ctx is needed inside, the outer outside. Confusing scopes lead to bugs.
6. **Returning before `Wait`.** Producer fails fast, but `Wait` is what gives you happens-before. Reading shared state before `Wait` is a race.

---

## Misconceptions

> "`errgroup` automatically retries."

It does not. Retries are your responsibility inside the goroutine.

> "Sentinel errors are global mutable state."

They are global *immutable* values. Comparing with `errors.Is` is fine. The error message is immutable. There's no mutability concern.

> "`errors.Is` walks the chain only once."

It walks until match or end. For a chain of depth k, worst case is O(k). For chains with cycles (which you should avoid), it would infinite loop, but practical chains never have cycles.

> "`SetLimit` makes the pipeline atomic."

No. `SetLimit` caps parallelism. It does not make work transactional.

---

## Tricky Points

- **`SetLimit` blocks `Go`.** If you spawn from a tight loop expecting non-blocking, `Go` will block. Use `TryGo` for non-blocking.
- **`Wait` after `Go` calls.** All `Go` calls must complete (i.e., the `Go` function must return) before `Wait` can finish. If you have producers issuing `Go` calls asynchronously, you may need a coordinator.
- **`g.Wait` returns nil if no `Go` was called.** A pipeline with no stages is "successful." Trivial but worth noting.
- **Sentinel `errors.New(s)` always returns a *new* allocation.** Two `errors.New("x")` are *not* `==`. This is why sentinels are package-level vars, not inline.
- **Error chains can branch (Go 1.20+).** A multi-`%w` error's `Unwrap` returns `[]error`. Walk with care.

---

## Test

```go
func TestRetryRespectsCancellation(t *testing.T) {
    ctx, cancel := context.WithCancel(context.Background())
    start := time.Now()
    go func() { time.Sleep(50 * time.Millisecond); cancel() }()

    err := downloadWithRetry(ctx, "http://invalid", "/tmp", 5)
    if !errors.Is(err, context.Canceled) {
        t.Fatalf("expected cancellation, got %v", err)
    }
    if elapsed := time.Since(start); elapsed > 500*time.Millisecond {
        t.Fatalf("did not cancel promptly: took %v", elapsed)
    }
}

func TestSetLimitCapsConcurrency(t *testing.T) {
    g, _ := errgroup.WithContext(context.Background())
    g.SetLimit(2)
    var active atomic.Int64
    var maxObserved atomic.Int64
    for i := 0; i < 10; i++ {
        g.Go(func() error {
            n := active.Add(1)
            defer active.Add(-1)
            for {
                m := maxObserved.Load()
                if n <= m || maxObserved.CompareAndSwap(m, n) { break }
            }
            time.Sleep(20 * time.Millisecond)
            return nil
        })
    }
    g.Wait()
    if maxObserved.Load() > 2 {
        t.Fatalf("limit breached: %d", maxObserved.Load())
    }
}
```

---

## Tricky Questions

**Q. If I call `g.Go` 100 times with `SetLimit(4)`, are 100 goroutines created?**

No, at most 4 at a time. `Go` blocks until a slot frees. (Or use `TryGo` for non-blocking.)

**Q. Does `errgroup.WithContext` cancel the parent context?**

No. It cancels its *derived* context. The parent is untouched. Cancellation flows down, not up.

**Q. If two workers panic at the same time, do both crash the program?**

The first panic crashes; the program is terminating before the second's stack unwinds. With recover, you'd see both, but typically you see one.

**Q. Can I `g.SetLimit` after `g.Go`?**

No. Panics. Set the limit before any `Go`.

**Q. What if I `g.Go` from inside another `g.Go`?**

Allowed. The inner `Go` adds to the same group. But: if the outer is mid-`Wait`, the inner may not get scheduled before `Wait` returns. Pattern: nested errgroups for this.

---

## Cheat Sheet

```go
import "golang.org/x/sync/errgroup"

g, ctx := errgroup.WithContext(parent)
g.SetLimit(runtime.NumCPU())

for _, item := range items {
    item := item
    g.Go(func() error {
        return processWithRetry(ctx, item, 3)
    })
}
if err := g.Wait(); err != nil {
    return fmt.Errorf("pipeline: %w", err)
}
```

Sentinel:

```go
var ErrNotFound = errors.New("not found")
return fmt.Errorf("lookup %d: %w", id, ErrNotFound)
errors.Is(err, ErrNotFound)
```

Typed error:

```go
type StageError struct { Stage string; Err error }
func (e *StageError) Error() string { return e.Stage + ": " + e.Err.Error() }
func (e *StageError) Unwrap() error { return e.Err }

var se *StageError
errors.As(err, &se)
```

---

## Self-Assessment

- [ ] I can choose between sentinel and typed errors for a given API.
- [ ] I can write a fan-out stage with bounded parallelism.
- [ ] I can write per-item retry with backoff and a budget.
- [ ] I distinguish parent cancellation from internal failure.
- [ ] I use `errors.Is` and `errors.As` correctly with wrapped chains.
- [ ] I know when to use `SetLimit` vs `TryGo`.
- [ ] I can spot a missing `ctx.Done()` branch in a code review.

---

## Summary

At middle level, error propagation graduates from "use errgroup correctly" to "design errors as part of the API." Sentinels and typed errors form a vocabulary. Fan-out with bounded parallelism and per-item retry handles realistic load. Nested pipelines compose cleanly via `errgroup.WithContext` at every layer.

Next at senior level: aggregating all errors instead of first-error-wins, compensating rollback when upstream stages succeed but downstream fails, panic recovery, and the memory-model details.

---

## Deep Dive: Error Vocabulary Design

A pipeline package's error API is a contract. Done well, callers can write robust code. Done poorly, callers either ignore errors or do brittle string matching.

### Three-tier classification

Most pipelines benefit from a three-tier vocabulary:

1. **Sentinels for "known and named" outcomes.** `ErrNotFound`, `ErrRateLimit`, `ErrPoisonMessage`.
2. **Typed errors for "known with data."** `*ValidationError{Field, Reason}`, `*StageError{Stage, Err}`.
3. **Opaque wrapped errors for "everything else."** A `fmt.Errorf("step X: %w", err)` with no specific identity.

The caller's decision tree:

```
got error
  -> errors.Is for sentinels
  -> errors.As for typed
  -> else: log and bubble up
```

### Documenting errors

In the package doc comment, list the sentinels:

```go
// Package importer reads CSVs and inserts records.
//
// The following errors are returned by Import:
//
//   - ErrBadRow: a row has the wrong number of columns or a malformed field.
//   - ErrDuplicate: an ID was seen twice.
//   - ErrUnderage: the user is below the minimum age.
//
// Any other error returned wraps an underlying error from the database or filesystem.
```

This is the API contract. Callers can branch on these. Anything else is undocumented and may change.

### Versioning errors

Sentinels are part of your API. Renaming or removing one is a breaking change. Adding new sentinels is non-breaking *unless* a caller has a `default` branch they intended to be exhaustive.

For typed errors, adding a new field is backward-compatible. Removing or renaming is breaking. Treat your error types like any other public struct.

### When NOT to add a sentinel

- The failure is unique to this call site and unlikely to be checked.
- The caller will just bubble it up.
- The information is better captured in a typed error with a field.

Adding too many sentinels clutters the API and tempts callers to write fragile `switch err` statements.

---

## Deep Dive: Bounded Parallelism Strategies

`SetLimit` is the simplest, but there are more sophisticated patterns.

### Fixed limit per pipeline run

```go
g.SetLimit(runtime.NumCPU())
```

Good default. Works when CPU is the bottleneck and items are roughly equal work.

### Per-resource semaphore

```go
dbSem := semaphore.NewWeighted(int64(dbPoolSize))
apiSem := semaphore.NewWeighted(32)

g.Go(func() error {
    if err := dbSem.Acquire(ctx, 1); err != nil { return err }
    defer dbSem.Release(1)
    // do DB work
    if err := apiSem.Acquire(ctx, 1); err != nil { return err }
    defer apiSem.Release(1)
    // do API work
    return nil
})
```

Useful when one stage uses multiple bounded resources.

### Dynamic limit based on observation

If you measure that your DB latency is rising, scale back parallelism:

```go
var limit atomic.Int64
limit.Store(8)

go func() {
    ticker := time.NewTicker(5 * time.Second)
    defer ticker.Stop()
    for range ticker.C {
        latency := observeDBLatency()
        if latency > slowThreshold {
            limit.Add(-1)
        } else if latency < fastThreshold && limit.Load() < maxLimit {
            limit.Add(1)
        }
    }
}()
```

Combined with a token-bucket admission control, this implements adaptive concurrency. Powerful but easy to over-engineer.

### Rate-limited stage

For external APIs with rate limits, use `golang.org/x/time/rate`:

```go
limiter := rate.NewLimiter(rate.Limit(10), 5) // 10 RPS, burst of 5

g.Go(func() error {
    for item := range in {
        if err := limiter.Wait(ctx); err != nil { return err }
        if err := callAPI(ctx, item); err != nil { return err }
    }
    return nil
})
```

`limiter.Wait` blocks until a token is available (or ctx is cancelled). This is rate-based throttling, distinct from concurrency limits.

---

## Deep Dive: Draining and Shutdown

A clean shutdown is one where every goroutine exits, every resource is freed, and the caller knows whether the work completed.

### The "drain to close" pattern

When a consumer exits early due to error:

```go
func consumer(ctx context.Context, in <-chan Job) error {
    defer func() {
        // Drain remaining items so producer can finish and exit.
        // The producer should already exit on ctx.Done(), but in case
        // it doesn't honor ctx, we drain.
        go func() { for range in {} }()
    }()

    for j := range in {
        if err := process(ctx, j); err != nil {
            return fmt.Errorf("process: %w", err)
        }
    }
    return nil
}
```

Caveat: this leaks the drain goroutine if the producer never closes. Better to ensure the producer always exits on ctx.

### The "close on success" anti-pattern

Don't try to encode success/failure in channel state:

```go
// BAD
out := make(chan Result)
var success bool
go func() {
    if doWork() { success = true; close(out) }
    // on failure, don't close
}()
```

`success` race. Channel state ambiguous. Use the explicit error return + always close pattern.

### Graceful shutdown with deadline

When the caller cancels, give stages a brief window to drain in-flight work:

```go
func Run(ctx context.Context) error {
    g, gctx := errgroup.WithContext(ctx)

    g.Go(...)
    g.Go(...)

    done := make(chan error, 1)
    go func() { done <- g.Wait() }()

    select {
    case err := <-done:
        return err
    case <-ctx.Done():
        // give grace period
        select {
        case err := <-done:
            return err
        case <-time.After(5 * time.Second):
            log.Warn("forced shutdown, pipeline did not drain")
            return ctx.Err()
        }
    }
    _ = gctx
}
```

This is the "graceful then forced" pattern. The pipeline gets 5 seconds to land cleanly after cancellation; if it doesn't, the caller moves on.

---

## Deep Dive: Idempotency in Retries

A retried operation must produce the same outcome as if it ran once. Otherwise retries cause duplicate side effects.

### Idempotency keys

For each item, generate a key that the downstream service uses to deduplicate:

```go
type Job struct {
    IdempotencyKey string
    Payload        []byte
}

func send(ctx context.Context, j Job) error {
    req, _ := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(j.Payload))
    req.Header.Set("Idempotency-Key", j.IdempotencyKey)
    resp, err := http.DefaultClient.Do(req)
    ...
}
```

The server's contract: requests with the same idempotency key produce the same result, even if invoked twice. Many APIs (Stripe, Square) support this.

### Database writes

Use `INSERT ON CONFLICT` (PostgreSQL) or `INSERT IGNORE` (MySQL) to make inserts idempotent:

```sql
INSERT INTO events (id, payload) VALUES ($1, $2)
ON CONFLICT (id) DO NOTHING
```

The `id` should be deterministic for the same logical event, so retries find the row already inserted.

### When idempotency is impossible

For non-idempotent operations (sending an email, charging a card without an idempotency key), retries are dangerous. Options:

- Move state tracking to your own DB: "did I send this email?" Check before retry.
- Use a saga pattern: explicit compensating action on failure (senior level).
- Don't retry. Surface the error.

---

## Deep Dive: Sentinel Errors Across Packages

What if a sentinel needs to be shared between two packages, both of which produce it?

### Bad: duplicate sentinels

```go
// package store
var ErrNotFound = errors.New("not found")

// package cache
var ErrNotFound = errors.New("not found") // different instance!
```

`errors.Is(store.ErrNotFound, cache.ErrNotFound)` is false. Two different memory locations.

### Good: shared sentinel in a third package

```go
// package errs
var ErrNotFound = errors.New("not found")

// package store
return fmt.Errorf("store: %w", errs.ErrNotFound)

// package cache
return fmt.Errorf("cache: %w", errs.ErrNotFound)
```

Callers compare against `errs.ErrNotFound`. Both packages agree.

### Good: cross-package matching via `Is` method

```go
// package store
type NotFoundError struct { ID int }
func (e *NotFoundError) Error() string { return "not found" }
func (e *NotFoundError) Is(target error) bool {
    return target == store.ErrNotFound
}
```

Now even from another package, `errors.Is(err, store.ErrNotFound)` matches *all* `*NotFoundError` instances.

---

## Deep Dive: Custom Error Methods

A custom error type can implement several optional methods:

```go
type MyError struct { ... }

func (e *MyError) Error() string { ... }       // required (error interface)
func (e *MyError) Unwrap() error { ... }       // for chain walking
func (e *MyError) Unwrap() []error { ... }     // for multi-wrap (1.20+)
func (e *MyError) Is(target error) bool { ... }    // for errors.Is semantic match
func (e *MyError) As(target any) bool { ... }      // for errors.As semantic match
```

`Is` and `As` are *optional*. Without them, `errors.Is` falls back to `==` and `errors.As` falls back to assignability. With them, you can express any semantic match logic.

### Example: HTTP error with status-based matching

```go
type HTTPError struct {
    Status int
    Body   []byte
}

func (e *HTTPError) Error() string { return fmt.Sprintf("HTTP %d", e.Status) }

func (e *HTTPError) Is(target error) bool {
    if t, ok := target.(*HTTPError); ok {
        return e.Status == t.Status
    }
    return false
}
```

Now `errors.Is(err, &HTTPError{Status: 404})` matches any 404 error, regardless of body. Powerful pattern for category matching.

---

## Deep Dive: Pipelines as Library APIs

If you're publishing a pipeline as a library others use, additional considerations:

### Don't expose `*errgroup.Group`

Wrap it in your own type. This lets you change implementation without breaking callers.

### Provide a `Wait`-style API

```go
type Pipeline struct { ... }

func (p *Pipeline) Run(ctx context.Context) error { ... }
```

Don't make callers manage `g.Go` and `g.Wait` themselves.

### Optional callbacks for observability

```go
type Options struct {
    OnStageStart func(stage string)
    OnStageEnd   func(stage string, err error)
}
```

Callers plug in metrics, logging, tracing without modifying your code.

### Document concurrency level

```go
// Run executes the pipeline.
// Internally uses up to runtime.NumCPU() goroutines for stage X.
// The provided context is honored throughout; cancellation aborts.
func (p *Pipeline) Run(ctx context.Context) error
```

---

## Deep Dive: Memory Model Notes

`g.Wait()` synchronises. Specifically, the writes performed inside any `g.Go` function happen-before the return of `g.Wait`. So:

```go
var sum int
for _, n := range nums {
    n := n
    g.Go(func() error {
        sum += n // RACE! concurrent writes
        return nil
    })
}
g.Wait()
fmt.Println(sum) // <- here, all writes are visible, but writes raced
```

The race is *between* goroutines, not between any goroutine and the caller. To fix:

```go
var sum int64
for _, n := range nums {
    n := n
    g.Go(func() error {
        atomic.AddInt64(&sum, int64(n))
        return nil
    })
}
g.Wait()
fmt.Println(sum)
```

Or use the result-slot pattern: each goroutine writes to a unique index.

### `sync.Once` semantics

`errgroup` uses `sync.Once` internally to capture the first error. `sync.Once.Do(f)` guarantees:

- `f` runs exactly once across all callers.
- Subsequent `Do` calls block until the first completes.
- Writes inside `f` happen-before any subsequent return from `Do`.

This is why reading `g.err` after `g.Wait` is safe — `Wait` synchronises with every `Done`, and the `Once` inside `Go` synchronises writes to `err`.

---

## Deep Dive: Testing Error Paths

Testing the happy path is easy. Testing error paths systematically:

```go
func TestPipelineFailsOnBadInput(t *testing.T) {
    err := Run(context.Background(), []Item{{ID: -1}})
    if !errors.Is(err, ErrInvalid) {
        t.Fatalf("expected ErrInvalid, got %v", err)
    }
}

func TestPipelineCancellation(t *testing.T) {
    ctx, cancel := context.WithCancel(context.Background())
    go func() { time.Sleep(10 * time.Millisecond); cancel() }()
    err := Run(ctx, manyItems())
    if !errors.Is(err, context.Canceled) {
        t.Fatalf("expected cancellation, got %v", err)
    }
}

func TestPipelineRetries(t *testing.T) {
    var attempts atomic.Int64
    flakyFn := func(ctx context.Context) error {
        if attempts.Add(1) < 3 { return errTransient }
        return nil
    }
    err := runWithRetry(flakyFn, 5)
    if err != nil {
        t.Fatalf("expected eventual success, got %v", err)
    }
    if attempts.Load() != 3 {
        t.Fatalf("expected 3 attempts, got %d", attempts.Load())
    }
}
```

Test the cancellation path with a deliberately slow stage that respects cancellation. Test the retry path with a counter that simulates transient failure.

### Property: timely cancellation

A subtle but important test: after cancellation, the pipeline must terminate within a bounded time. If a stage doesn't respect cancellation, this test fails:

```go
func TestPipelineCancelsWithinDeadline(t *testing.T) {
    ctx, cancel := context.WithCancel(context.Background())
    defer cancel()

    start := time.Now()
    done := make(chan error, 1)
    go func() { done <- Run(ctx, manyItems()) }()

    time.Sleep(50 * time.Millisecond)
    cancel()

    select {
    case <-done:
        if elapsed := time.Since(start); elapsed > 500*time.Millisecond {
            t.Fatalf("did not cancel promptly: %v", elapsed)
        }
    case <-time.After(time.Second):
        t.Fatal("pipeline did not exit after cancellation")
    }
}
```

If your stages all honour `ctx.Done()`, this passes in milliseconds. If any stage blocks on a non-cancellable operation, this test catches it.

---

## Long Worked Example: ETL Pipeline

A complete realistic ETL pipeline showing every middle-level concept.

```go
package etl

import (
    "context"
    "database/sql"
    "encoding/json"
    "errors"
    "fmt"
    "io"
    "net/http"
    "runtime"
    "time"

    "golang.org/x/sync/errgroup"
    "golang.org/x/time/rate"
)

var (
    ErrSkip      = errors.New("skip")
    ErrTransient = errors.New("transient")
    ErrPermanent = errors.New("permanent")
)

type StageError struct {
    Stage string
    Err   error
}

func (e *StageError) Error() string { return e.Stage + ": " + e.Err.Error() }
func (e *StageError) Unwrap() error { return e.Err }

type Record struct {
    ID   string `json:"id"`
    Name string `json:"name"`
    Data string `json:"data"`
}

type Config struct {
    SourceURL    string
    DB           *sql.DB
    APIRateLimit int
    Workers      int
    MaxRetries   int
}

func Run(ctx context.Context, cfg Config) error {
    if cfg.Workers == 0 {
        cfg.Workers = runtime.NumCPU()
    }
    if cfg.APIRateLimit == 0 {
        cfg.APIRateLimit = 10
    }

    g, ctx := errgroup.WithContext(ctx)

    raw := make(chan []byte, cfg.Workers)
    parsed := make(chan Record, cfg.Workers)
    enriched := make(chan Record, cfg.Workers)

    // Stage 1: ingest
    g.Go(func() error {
        defer close(raw)
        if err := ingest(ctx, cfg.SourceURL, raw); err != nil {
            return &StageError{Stage: "ingest", Err: err}
        }
        return nil
    })

    // Stage 2: parse (fan-out)
    g.Go(func() error {
        defer close(parsed)
        inner, ctx := errgroup.WithContext(ctx)
        for i := 0; i < cfg.Workers; i++ {
            inner.Go(func() error {
                for b := range raw {
                    r, err := parse(b)
                    if errors.Is(err, ErrSkip) {
                        continue
                    }
                    if err != nil {
                        return &StageError{Stage: "parse", Err: err}
                    }
                    select {
                    case <-ctx.Done(): return ctx.Err()
                    case parsed <- r:
                    }
                }
                return nil
            })
        }
        return inner.Wait()
    })

    // Stage 3: enrich (rate-limited)
    g.Go(func() error {
        defer close(enriched)
        limiter := rate.NewLimiter(rate.Limit(cfg.APIRateLimit), cfg.APIRateLimit/2+1)
        for r := range parsed {
            if err := limiter.Wait(ctx); err != nil { return err }
            er, err := enrichWithRetry(ctx, r, cfg.MaxRetries)
            if err != nil {
                return &StageError{Stage: "enrich", Err: err}
            }
            select {
            case <-ctx.Done(): return ctx.Err()
            case enriched <- er:
            }
        }
        return nil
    })

    // Stage 4: store
    g.Go(func() error {
        for r := range enriched {
            if err := store(ctx, cfg.DB, r); err != nil {
                return &StageError{Stage: "store", Err: err}
            }
        }
        return nil
    })

    return g.Wait()
}

func ingest(ctx context.Context, url string, out chan<- []byte) error {
    req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
    if err != nil { return err }
    resp, err := http.DefaultClient.Do(req)
    if err != nil { return err }
    defer resp.Body.Close()

    dec := json.NewDecoder(resp.Body)
    for dec.More() {
        var raw json.RawMessage
        if err := dec.Decode(&raw); err != nil {
            if err == io.EOF { return nil }
            return fmt.Errorf("decode: %w", err)
        }
        select {
        case <-ctx.Done(): return ctx.Err()
        case out <- raw:
        }
    }
    return nil
}

func parse(b []byte) (Record, error) {
    var r Record
    if err := json.Unmarshal(b, &r); err != nil {
        return Record{}, fmt.Errorf("unmarshal: %w", err)
    }
    if r.ID == "" {
        return Record{}, ErrSkip
    }
    return r, nil
}

func enrichWithRetry(ctx context.Context, r Record, maxAttempts int) (Record, error) {
    var lastErr error
    for i := 0; i < maxAttempts; i++ {
        er, err := enrichOnce(ctx, r)
        if err == nil { return er, nil }
        if errors.Is(err, ErrPermanent) {
            return Record{}, err
        }
        lastErr = err
        wait := time.Duration(1<<i) * 100 * time.Millisecond
        select {
        case <-ctx.Done(): return Record{}, ctx.Err()
        case <-time.After(wait):
        }
    }
    return Record{}, fmt.Errorf("after %d attempts: %w", maxAttempts, lastErr)
}

func enrichOnce(ctx context.Context, r Record) (Record, error) {
    // Imagine an API call here.
    return r, nil
}

func store(ctx context.Context, db *sql.DB, r Record) error {
    _, err := db.ExecContext(ctx,
        "INSERT INTO records (id, name, data) VALUES ($1, $2, $3) ON CONFLICT (id) DO UPDATE SET data = $3",
        r.ID, r.Name, r.Data)
    if err != nil {
        return fmt.Errorf("insert %s: %w", r.ID, err)
    }
    return nil
}
```

This pipeline demonstrates:

- `errgroup.WithContext` at top level.
- Fan-out inside stage 2 via nested errgroup.
- Rate-limited stage with `golang.org/x/time/rate`.
- Per-item retry with backoff in stage 3.
- Sentinel `ErrSkip` for non-fatal skip.
- `*StageError` typed error for stage attribution.
- Idempotent DB insert via `ON CONFLICT`.
- Context-aware blocking everywhere.

Read it twice. It is the shape of a production ETL pipeline in Go.

---

## Case Study: When errgroup Is Not Enough

A real story illustrates the limits. A team built a content ingestion pipeline using `errgroup`. For months it worked. Then they added a new stage that consumed a third-party API with an unusual quirk: on rate-limit, it returned 200 OK with an error body, not 429.

The pipeline's parse stage now sometimes "succeeded" but produced wrong data. The errgroup never failed — there was no error to propagate. Downstream stores started failing because the data was malformed.

Lessons:

1. **The pipeline's correctness assumes stages are honest.** A stage that swallows errors silently breaks the whole system.
2. **Validate at boundaries.** Even after parsing, run a sanity check before passing data downstream.
3. **Metrics on error rate matter as much as `g.Wait()`.** If errors per item drift from 1% to 10%, something is wrong even if the pipeline "succeeds."

The fix:

```go
func parse(b []byte) (Record, error) {
    var r Record
    if err := json.Unmarshal(b, &r); err != nil { return Record{}, err }
    if err := r.Validate(); err != nil {
        return Record{}, fmt.Errorf("parse: %w", err)
    }
    return r, nil
}
```

Move validation into parse. Now bogus "rate-limited responses" that decode to non-record JSON fail parse explicitly.

---

## Case Study: The "Cancelled Too Early" Bug

A team had a pipeline that fetched data from 100 sources in parallel. The first failure cancelled everyone. They added retry inside each fetch goroutine. Now the first transient failure cancelled all 100 sources after a single attempt — defeating the retry.

The bug: returning the *first* attempt's error from `g.Go` triggers errgroup's cancel. The retry never ran.

The fix: only return `err` from `g.Go` when retries are exhausted:

```go
g.Go(func() error {
    for attempt := 0; attempt < 5; attempt++ {
        if err := fetch(ctx, url); err == nil { return nil }
        time.Sleep(backoff(attempt))
    }
    return fmt.Errorf("fetch %s: retries exhausted", url)
})
```

Retries are *inside* the goroutine; errgroup only sees the final outcome.

---

## Case Study: The Forgotten Drain

A team had a pipeline where stage 3 sometimes exited early on a sentinel error (which was treated as success). Stage 2, mid-`out <- v`, blocked. Pipeline never terminated.

Root cause: stage 3's early `return nil` did not drain `out` (the channel it was reading from). Stage 2 produces, has no reader, blocks. Stage 2's `select` on `ctx.Done()` never fired because `ctx` was never cancelled (no error to trigger cancellation).

Fix:

```go
// Stage 3
for v := range in {
    if shouldSkip(v) { continue } // not return!
    if err := process(v); err != nil { return err }
}
return nil
```

Or: cancel explicitly when stage 3 wants to abort:

```go
ctx, cancel := context.WithCancel(parentCtx)
g, ctx := errgroup.WithContext(ctx)
defer cancel()

g.Go(func() error {
    ...
    if specialCondition { cancel(); return nil }
    ...
})
```

This manual cancel coexists with errgroup's. Calling cancel signals all stages; errgroup's `Wait` still returns nil (no error was returned by `g.Go`).

---

## Anti-Pattern Catalogue (Middle Level)

### Anti-pattern: error-handling inside the select case

```go
select {
case <-ctx.Done():
    log.Println("cancelled")
    cleanup()
    return ctx.Err()
case v := <-in:
    ...
}
```

The `log.Println` and `cleanup` block the select handler. If `cleanup` itself does I/O, you're holding select hostage. Move cleanup to `defer` and the case is just `return ctx.Err()`.

### Anti-pattern: shared variable + mutex inside the hot path

```go
var mu sync.Mutex
var errs []error
for v := range in {
    if err := process(v); err != nil {
        mu.Lock()
        errs = append(errs, err)
        mu.Unlock()
    }
}
```

Inside a stage's tight loop, `mu.Lock` is a serialisation point. Better: use a typed-error return that bubbles up, or aggregate after the loop, not inside.

### Anti-pattern: per-item goroutine inside a stage

```go
for v := range in {
    go process(v) // spawns N untracked goroutines
}
```

Each item gets a new goroutine. They're not tracked. Errors are lost. Use a nested errgroup or fan-out workers.

### Anti-pattern: catching ctx.Err and replacing it

```go
if err := op(); err != nil {
    if errors.Is(err, context.Canceled) {
        return errors.New("operation cancelled") // loses identity
    }
}
```

Now `errors.Is(returnedErr, context.Canceled)` is false. Always preserve cancellation identity. Wrap, don't replace:

```go
if errors.Is(err, context.Canceled) {
    return fmt.Errorf("op: %w", err)
}
```

### Anti-pattern: SetLimit per goroutine, not per group

```go
for _, item := range items {
    g.SetLimit(N) // wrong place
    g.Go(...)
}
```

`SetLimit` must be called before any `Go`. Calling it after panics. Hoist it.

---

## More Practical Patterns

### Pattern: pipeline factory

For services that run the same pipeline shape repeatedly, factor it:

```go
type Pipeline struct {
    workers   int
    rateLimit int
    db        *sql.DB
}

func NewPipeline(workers, rateLimit int, db *sql.DB) *Pipeline {
    return &Pipeline{workers, rateLimit, db}
}

func (p *Pipeline) Run(ctx context.Context, source string) error {
    g, ctx := errgroup.WithContext(ctx)
    // ... assemble stages using p's fields ...
    return g.Wait()
}
```

Now `srv.pipeline.Run(ctx, src)` runs the standard pipeline. No re-implementing per call.

### Pattern: option functional config

```go
type Option func(*Pipeline)

func WithWorkers(n int) Option { return func(p *Pipeline) { p.workers = n } }
func WithRateLimit(n int) Option { return func(p *Pipeline) { p.rateLimit = n } }

func NewPipeline(opts ...Option) *Pipeline {
    p := &Pipeline{workers: runtime.NumCPU(), rateLimit: 10}
    for _, o := range opts { o(p) }
    return p
}
```

Standard Go pattern. Lets callers customise without growing your signature.

### Pattern: deferred cleanup

Each stage's resources cleaned up via `defer`:

```go
g.Go(func() error {
    f, err := os.Open(path)
    if err != nil { return fmt.Errorf("open: %w", err) }
    defer f.Close()

    rows, err := db.Query(...)
    if err != nil { return fmt.Errorf("query: %w", err) }
    defer rows.Close()

    // process
    return nil
})
```

The two `defer`s run in LIFO order: `rows.Close()` first, then `f.Close()`. Each runs regardless of how the function exits.

### Pattern: error capture for observability

```go
type instrumentedStage struct {
    name string
    fn   func(context.Context) error
}

func (s *instrumentedStage) Run(ctx context.Context) error {
    start := time.Now()
    err := s.fn(ctx)
    metrics.Histogram("stage.duration", time.Since(start), "stage", s.name)
    if err != nil {
        metrics.Counter("stage.errors", "stage", s.name).Inc()
    }
    return err
}

g.Go(stage1.Run)
g.Go(stage2.Run)
```

The stage's logic is independent of instrumentation; the wrapper handles metrics.

---

## Mini-Glossary

| Term | Meaning |
|------|---------|
| Drain | Read remaining channel values to unblock a stuck producer. |
| Idempotency key | A token that uniquely identifies an operation, so a retry doesn't double-execute it. |
| Saga | A long-running transaction composed of forward steps and compensating actions. |
| Compensating action | An operation that undoes a previously successful step. |
| Multi-error | An error wrapping multiple errors (`errors.Join`). |
| Bounded parallelism | Capping the number of concurrent goroutines. |
| TryGo | Non-blocking spawn that returns false if at capacity. |
| Token bucket | A rate-limiting algorithm — fixed tokens per second, burst capacity. |
| Backpressure | The mechanism by which slow consumers slow down fast producers. |
| Fan-out | One producer, N consumers. |
| Fan-in | N producers, one consumer. |

---

## Long Walkthrough: Building a Per-Tenant Importer

Imagine a multi-tenant SaaS where each tenant has its own data to import. You want isolation: one tenant's failure must not affect others. You also want shared resources: a single DB connection pool, a single rate limiter for external APIs.

```go
package importer

import (
    "context"
    "fmt"
    "sync"

    "golang.org/x/sync/errgroup"
    "golang.org/x/time/rate"
)

type Tenant struct {
    ID     string
    Source string
}

type ImportResult struct {
    TenantID string
    Rows     int
    Err      error
}

type Importer struct {
    apiLimiter *rate.Limiter
    db         *sql.DB
    workers    int
}

func New(apiRPS int, db *sql.DB, workers int) *Importer {
    return &Importer{
        apiLimiter: rate.NewLimiter(rate.Limit(apiRPS), apiRPS),
        db:         db,
        workers:    workers,
    }
}

func (im *Importer) ImportAll(ctx context.Context, tenants []Tenant) ([]ImportResult, error) {
    g, ctx := errgroup.WithContext(ctx)
    g.SetLimit(im.workers)
    results := make([]ImportResult, len(tenants))
    var mu sync.Mutex
    _ = mu

    for i, t := range tenants {
        i, t := i, t
        g.Go(func() error {
            rows, err := im.importOne(ctx, t)
            results[i] = ImportResult{TenantID: t.ID, Rows: rows, Err: err}
            return nil // explicit: per-tenant errors do NOT cancel siblings
        })
    }
    // We ignore g.Wait's error because we return per-item results.
    _ = g.Wait()

    // Determine overall status.
    var failed []string
    for _, r := range results {
        if r.Err != nil { failed = append(failed, r.TenantID) }
    }
    if len(failed) > 0 {
        return results, fmt.Errorf("import failed for %d tenants: %v", len(failed), failed)
    }
    return results, nil
}

func (im *Importer) importOne(ctx context.Context, t Tenant) (int, error) {
    // Each tenant runs its own internal pipeline with isolation.
    g, ctx := errgroup.WithContext(ctx)

    raw := make(chan []byte, 16)
    parsed := make(chan Record, 16)

    g.Go(func() error {
        defer close(raw)
        return im.fetchTenant(ctx, t, raw)
    })

    g.Go(func() error {
        defer close(parsed)
        for b := range raw {
            r, err := parse(b)
            if err != nil { return fmt.Errorf("parse: %w", err) }
            select {
            case <-ctx.Done(): return ctx.Err()
            case parsed <- r:
            }
        }
        return nil
    })

    var inserted int
    g.Go(func() error {
        for r := range parsed {
            if err := im.apiLimiter.Wait(ctx); err != nil { return err }
            if err := im.db.ExecContext(ctx, "INSERT ...", r).Err(); err != nil {
                return fmt.Errorf("insert %s: %w", r.ID, err)
            }
            inserted++
        }
        return nil
    })

    err := g.Wait()
    return inserted, err
}
```

What's important here:

1. **Outer errgroup** processes tenants with `SetLimit(workers)`. Critically, per-goroutine returns `nil` so one tenant's failure does NOT cancel others.
2. **Inner errgroup** per tenant uses first-error semantics. Within a tenant, fail-fast is appropriate.
3. **Shared limiter** is used inside each tenant's pipeline. Rate limit is global, not per-tenant.
4. **Per-tenant results** are aggregated in a slice. The overall return value is a list of results plus a summary error if any tenant failed.

This is the *typed* two-layer pattern: outer aggregation, inner fail-fast. Very common in multi-tenant or multi-batch systems.

---

## Five Pipeline Shapes

A taxonomy of common pipeline shapes and which error patterns suit each.

### Shape 1: Linear

```
A -> B -> C
```

Error pattern: first-error-wins with errgroup. Standard.

### Shape 2: Linear with fan-out

```
A -> [B1, B2, B3] -> C
```

(A produces, three Bs consume in parallel, C aggregates.) Error pattern: nested errgroup inside the fan-out stage. Cancellation propagates from any Bn to A and C.

### Shape 3: Linear with fan-in

```
A1 -> 
A2 -> ] -> B -> C
A3 -> 
```

Multiple producers fanning into one consumer. Error pattern: each producer has its own goroutine in the same errgroup. Channel close must be coordinated: a separate goroutine waits for all producers (via WaitGroup) and closes the shared channel.

### Shape 4: Diamond

```
       -> B1 -> 
A -> < -> B2 -> > -> C
       -> B3 -> 
```

A's output is broadcast to all Bs (via tee). Bs are independent. C waits for all. Error pattern: any B's failure cancels A and the others (errgroup). C's failure cancels A and Bs.

### Shape 5: Per-item subpipeline

```
A -> (each item starts its own pipeline) -> aggregate
```

One outer errgroup over items, one inner errgroup per item. Two layers. Choose first-error-wins or per-item aggregation at the outer layer based on requirements.

---

## Production Checklist (Middle Level)

Before deploying a pipeline to production:

- [ ] All channels have exactly one closer.
- [ ] All sends are select'd against `ctx.Done()`.
- [ ] All `db.Query`, `http.Do`, etc. receive `ctx`.
- [ ] `errgroup.WithContext` (not bare Group{}).
- [ ] `SetLimit` if fan-out can be large.
- [ ] Per-item retry with backoff for transient failures.
- [ ] Idempotency for non-idempotent operations.
- [ ] Sentinel and typed errors documented.
- [ ] Errors wrapped with `%w` at every boundary.
- [ ] Metrics: success/failure counter, stage duration, error rate per stage.
- [ ] Logs: each failure logged with full error chain.
- [ ] Tests: happy path, single failure, cancellation, retry, partial failure.
- [ ] Cancellation test verifies pipeline exits within bounded time.
- [ ] No `time.Sleep` for synchronisation; only inside select.
- [ ] No bare `go` spawns inside `g.Go` functions.
- [ ] Resources have `defer` cleanup.
- [ ] Public sentinels listed in package doc.

If any of these are missing, the pipeline has a known weakness.

---

## Further Reading

- `golang.org/x/sync/errgroup` source.
- `golang.org/x/sync/semaphore` (alternative parallelism cap).
- `golang.org/x/time/rate` for rate limiting.
- "Go Concurrency Patterns: Context" — Sameer Ajmani.
- "Working with Errors in Go 1.13" — The Go Blog.
- `github.com/cenkalti/backoff` — exponential backoff library.
- *Concurrency in Go* by Katherine Cox-Buday, chapter 5.
- Bryan Mills, "Rethinking Classical Concurrency Patterns" (GopherCon 2018).
- The Go Blog: "Errors are values" — Rob Pike.

---

## Bonus: Comparative Table — Error Strategies

| Strategy | Best for | Pros | Cons |
|----------|----------|------|------|
| First-error-wins (default errgroup) | User-facing operations | Simple, fast shutdown | Loses secondary errors |
| Aggregation (errors.Join) | Batch jobs, validation | All errors visible | More complex caller logic |
| Per-item results (slice + nil return) | Multi-tenant | Independent failure domains | Manual aggregation |
| Retry inside stage | Transient failures | Self-healing | Adds latency |
| Compensating action (saga) | Multi-stage side effects | Maintains consistency | Significant complexity |
| Dead-letter queue | Async pipelines, queues | Failed items not lost | Operational overhead |

The right choice depends on the product. Don't mix strategies in one pipeline without intent.

---

## Bonus: When to Use Each Wrap Style

| Style | Example | Use case |
|-------|---------|----------|
| `fmt.Errorf("ctx: %w", err)` | `parse: %w` | Add context, preserve chain |
| `fmt.Errorf("a: %w; b: %w", e1, e2)` (1.20+) | Multi-error wrap | Two errors in one message |
| `errors.Join(e1, e2)` | List of errors | Aggregating multiple unrelated errors |
| `&StageError{Stage, Err}` | Typed wrap | Need to extract structure later |
| `fmt.Errorf("%s: %v", op, err)` | Format-only | When the inner error should not be matchable |
| Just return `err` | No new context | Layer adds nothing |

The last is important: if your wrap doesn't add information, don't wrap. `return err` is fine.

---

## Bonus: Comparing errgroup to Other Languages

| Language | Equivalent | Differences |
|----------|-----------|-------------|
| Rust | `tokio::join!`, `try_join!` | Compile-time safe; futures. |
| Python | `asyncio.gather` | Async/await; cancellation via `CancelledError`. |
| Kotlin | `coroutineScope { ... launch { } }` | Structured concurrency built into the language. |
| Java | `CompletableFuture.allOf` | Verbose API; no built-in cancellation propagation. |
| JS | `Promise.all`, `Promise.allSettled` | `allSettled` is the aggregation equivalent. |

Go's errgroup is one of the most ergonomic — small API, clear semantics. Its design influenced others (notably Kotlin's structured concurrency, finalised in 2019).

---

## Exploring SetLimit Behavior

The `SetLimit` method on errgroup deserves a closer look because subtle misuse causes real bugs.

### The contract

- Called before any `g.Go` invocation, or it panics.
- Limit of 0 means unlimited (a no-op).
- Limit of N caps the number of *concurrent* goroutines at N.
- `g.Go` blocks if N goroutines are already running.

### Internal implementation

A simplified version:

```go
type Group struct {
    sem chan token // capacity = N
    // ...
}

func (g *Group) SetLimit(n int) {
    if n < 0 { g.sem = nil; return }
    if len(g.sem) != 0 { panic("errgroup: modify limit while group has active goroutines") }
    g.sem = make(chan token, n)
}

func (g *Group) Go(f func() error) {
    if g.sem != nil { g.sem <- token{} }
    g.wg.Add(1)
    go func() {
        defer g.done()
        if err := f(); err != nil {
            g.errOnce.Do(func() { g.err = err; if g.cancel != nil { g.cancel(err) } })
        }
    }()
}

func (g *Group) done() {
    if g.sem != nil { <-g.sem }
    g.wg.Done()
}
```

The `sem` channel is a counting semaphore. Sending takes a slot, receiving frees it.

### Subtle behavior: blocking on Go

If you call `g.Go` from many sources and the limit is small, `Go` blocks. Importantly, *while blocked, the calling goroutine does nothing*. If you have:

```go
for _, item := range items {
    g.Go(func() error { /* item work */ })  // blocks when N goroutines busy
}
return g.Wait()
```

The `for` loop pauses at each `Go` call when at capacity. This is fine *unless* the caller goroutine needs to also do something — e.g., reading from a channel — while waiting. Then you need a separate spawner goroutine:

```go
go func() {
    for _, item := range items {
        item := item
        g.Go(func() error { /* item work */ })
    }
    // signal "done spawning"
}()
```

Note: you'd then need a separate mechanism for `Wait` to know all `Go` calls have been made. Usually accomplished by waiting on the spawner first, then calling `Wait`.

### TryGo

Non-blocking variant. Returns true if spawned, false if at capacity:

```go
if !g.TryGo(func() error { return work() }) {
    // back off, retry later, or skip
}
```

Useful for "best-effort" parallelism where you don't want to block the orchestrator.

---

## A Caveat About errgroup and Panics

`errgroup` does not recover panics. If a `g.Go` function panics, the goroutine crashes the program. `g.Wait` is not even reached.

Mitigation:

```go
g.Go(func() (err error) {
    defer func() {
        if r := recover(); r != nil {
            err = fmt.Errorf("panic in stage: %v", r)
        }
    }()
    return stage(ctx)
})
```

This converts panic to error. Now the pipeline behaves predictably. We'll discuss this in depth at senior level — panic recovery is its own design topic.

Two notes:

1. *Use named return*: `(err error)`. This allows the deferred recover to set the return value.
2. *Recover only at goroutine boundaries*. Don't sprinkle `recover` inside helper functions.

---

## Discussion: Performance vs Correctness

Real-world pipelines often involve trade-offs:

- **More buffering**: smoother throughput, but more memory and slower failure detection.
- **More parallelism**: higher throughput, but more memory and more contention.
- **More retries**: better success rate, but worse worst-case latency.
- **More logging**: better observability, but slower stages and noisier output.

There is no universal answer. Measure your real workload, decide based on data. The standard advice:

1. Get correctness first. Use `errgroup`, wrap errors, cancel on failure.
2. Profile. Don't optimise speculatively.
3. Tune one knob at a time.
4. Re-measure.

If you're optimising before you have working tests for the error paths, you're inviting bugs.

---

## Style Note: Inline Closures vs Named Stages

You'll see both styles:

```go
// Inline
g.Go(func() error {
    defer close(out)
    for v := range in {
        if err := processOne(v); err != nil { return err }
        out <- v
    }
    return nil
})

// Named
g.Go(func() error { return runStage(ctx, in, out) })

func runStage(ctx context.Context, in <-chan T, out chan<- T) error {
    defer close(out)
    for v := range in {
        ...
    }
    return nil
}
```

Inline is concise for short stages (<20 lines). Named is essential for testing (you can unit-test `runStage` without spinning up an errgroup) and for documentation. The general rule: anonymous closure for one-liners, named function for anything substantial.

---

## Common Real-World Pipelines

A short tour of pipeline shapes you'll encounter:

- **Log shipper**: tail logs -> filter -> batch -> send to remote.
- **Notification dispatcher**: receive events -> determine recipients -> deliver per-channel.
- **Image processor**: receive upload -> validate -> transcode N sizes -> store -> notify.
- **Search indexer**: poll for changes -> fetch documents -> tokenise -> index.
- **Data sync**: read source -> diff -> apply changes -> verify.
- **Backup runner**: enumerate -> snapshot -> compress -> upload -> verify.

Each maps to one of the five shapes above. Each has its error pattern: fail-fast for user-initiated, aggregation for batch, dead-letter for queue-based.

---

## Refactoring Toward Cleaner Pipelines

If you inherit a tangled pipeline, refactor toward:

1. **Named stages.** Extract closures into top-level functions.
2. **One channel per data type.** No multiplexed channels carrying different things.
3. **One sender per channel.** Use fan-in stages if needed.
4. **`errgroup.WithContext` at every layer.** Even if you had manual coordination.
5. **Explicit `defer close(out)` everywhere.**
6. **`%w` everywhere errors flow.**
7. **Tests that exercise both happy and error paths.**

Refactor incrementally. Each step should leave the code compiling and passing tests. Don't attempt a "big bang" rewrite.

---

## Summary of Mid-Level Skills

After this file, you should be able to:

- Design an error API with sentinels and types.
- Use `errors.Is` and `errors.As` with custom methods.
- Build fan-out within a stage with bounded parallelism.
- Implement retry with backoff and jitter.
- Distinguish parent cancellation from internal failure.
- Recognise and refactor the common anti-patterns.
- Audit a pipeline against the production checklist.
- Read and write the standard ETL pipeline shape.

You're now ready for `senior.md`, which covers aggregating all errors, compensating rollback, and the memory model in depth.

---

## Appendix: A Mental Model for Concurrent Errors

Picture a city's emergency response. Multiple ambulances dispatched to multiple incidents. One ambulance discovers a fire — much worse than a fender-bender. Dispatch radio: "stand down, all units, regroup at base." Every unit stops, returns. One report goes to the chief: "fire."

This is errgroup. Ambulances are goroutines. Dispatch's radio is `cancel()`. The chief is `g.Wait()`. The fire is the first error.

Variations:

- *Aggregation*: dispatch wants every report from every unit, even after the fire is reported. (`errors.Join`)
- *Compensating action*: one ambulance had loaded a patient. Before returning, they hand the patient to another unit. (Saga)
- *Retry*: one unit's vehicle stalled. Tries again in 30 seconds. (Backoff)
- *Rate limit*: only N ambulances can refuel at the gas station at once. (Semaphore)
- *Idempotency*: each incident has a unique number. Dispatching twice for the same incident is a no-op. (Idempotency keys)

The metaphor isn't perfect, but it captures the choreography: many actors, shared state, partial information, cancellation, recovery. Pipeline design is dispatch design.

---

## Appendix: Six Code Smells

Even if a pipeline compiles and tests pass, these smells suggest hidden bugs:

1. **No `WithContext`**: `errgroup.Group{}` used without `WithContext`. Missing cancellation.
2. **Multiple `Wait()` calls**: groups are single-use; multiple Waits suggest confused control flow.
3. **`go func()` inside `g.Go`**: untracked goroutines; leak risk.
4. **`time.Sleep` outside a select**: blocks cancellation; almost always wrong.
5. **`errors.New(err.Error())`**: destructively re-creates errors; loses chain.
6. **No sentinel errors but lots of string matching**: `strings.Contains(err.Error(), "not found")`. Define a sentinel.

Each is fixable. Each is common. Each is worth flagging in code review.
