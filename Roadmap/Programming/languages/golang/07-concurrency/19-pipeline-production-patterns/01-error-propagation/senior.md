---
layout: default
title: Senior
parent: Error Propagation
grand_parent: Pipeline Production Patterns
ancestor: Go
nav_order: 4
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/19-pipeline-production-patterns/01-error-propagation/senior/
---

# Error Propagation in Pipelines — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Error Aggregation Strategies](#error-aggregation-strategies)
4. [errors.Join Deep Dive](#errorsjoin-deep-dive)
5. [Multi-Stage Failure Rollback](#multi-stage-failure-rollback)
6. [Compensating Actions](#compensating-actions)
7. [Saga Patterns in Go Pipelines](#saga-patterns-in-go-pipelines)
8. [Panic Recovery in Stages](#panic-recovery-in-stages)
9. [Memory Model Details](#memory-model-details)
10. [Lock-Free Aggregation](#lock-free-aggregation)
11. [Structured Concurrency in Depth](#structured-concurrency-in-depth)
12. [Error Routing Architectures](#error-routing-architectures)
13. [First Error vs All Errors Trade-Off](#first-error-vs-all-errors-trade-off)
14. [Dead-Letter Queues](#dead-letter-queues)
15. [Bulkheads](#bulkheads)
16. [Circuit Breakers in Pipelines](#circuit-breakers-in-pipelines)
17. [Observability and Tracing](#observability-and-tracing)
18. [Senior-Level Code Examples](#senior-level-code-examples)
19. [Architecture Patterns](#architecture-patterns)
20. [Clean Code at Scale](#clean-code-at-scale)
21. [Product Considerations](#product-considerations)
22. [Best Practices](#best-practices)
23. [Edge Cases](#edge-cases)
24. [Common Mistakes](#common-mistakes)
25. [Tricky Points](#tricky-points)
26. [Test Strategies](#test-strategies)
27. [Tricky Questions](#tricky-questions)
28. [Cheat Sheet](#cheat-sheet)
29. [Self-Assessment](#self-assessment)
30. [Summary](#summary)
31. [Further Reading](#further-reading)

---

## Introduction
> Focus: "I need to design error handling for a system, not a function. Multiple stages with side effects. Partial failure recovery. Aggregated errors. Tracing across stages."

At junior level you learned mechanics. At middle level, design. At senior level, *architecture*. A pipeline embedded in a production service has additional concerns: partial-failure recovery (some stages succeeded, the next must not orphan the work), aggregated reporting (every failed item, not just one), bulkheads (failure in one part shouldn't cascade), and observability (you must be able to debug it in production at 3 AM).

This file covers:

- Aggregating errors with `errors.Join` and beyond
- Multi-stage rollback when downstream fails after upstream succeeded
- Compensating actions and the saga pattern
- Panic recovery as a deliberate part of pipeline design
- The Go memory model as it applies to errgroup
- Lock-free aggregation patterns
- Structured concurrency as a design philosophy
- Bulkheads, circuit breakers, dead-letter queues
- Distributed tracing across pipeline stages

This is the territory where you stop using libraries and start *designing* libraries.

---

## Prerequisites

- Junior and middle files in this series.
- Comfort with `sync/atomic`, the Go memory model, and `sync.Mutex`/`sync.RWMutex`.
- Understanding of `context.Context` plumbing and cancellation semantics.
- Familiarity with database transactions and ACID properties.
- Exposure to distributed system concepts: idempotency, sagas, dead-letter queues.
- Experience reading production goroutine dumps.

---

## Error Aggregation Strategies

First-error-wins is the default for `errgroup`. But many scenarios demand aggregation.

### When to aggregate

- **Batch processing**: report every failed item.
- **Validation**: tell the user every field that's invalid, not just one.
- **Multi-source fetch**: report every source that failed.
- **Schema migrations**: list every check that failed.
- **Audit logs**: every failure recorded for postmortem.

### Three aggregation patterns

#### Pattern A: errors.Join (Go 1.20+)

```go
func processAll(ctx context.Context, items []Item) error {
    var (
        errs []error
        mu   sync.Mutex
    )
    g, ctx := errgroup.WithContext(ctx)
    g.SetLimit(16)

    for _, it := range items {
        it := it
        g.Go(func() error {
            if err := process(ctx, it); err != nil {
                mu.Lock()
                errs = append(errs, fmt.Errorf("%s: %w", it.ID, err))
                mu.Unlock()
            }
            return nil // do NOT propagate; we collect locally
        })
    }
    _ = g.Wait()
    return errors.Join(errs...)
}
```

The goroutine returns nil so errgroup doesn't cancel siblings. Errors are collected via a mutex. `errors.Join` produces a single error that wraps all of them. Callers can iterate via `errors.Unwrap` or check membership via `errors.Is`.

#### Pattern B: Result slice with per-item error

```go
type Result struct {
    Item Item
    Err  error
}

func processAll(ctx context.Context, items []Item) []Result {
    results := make([]Result, len(items))
    var g errgroup.Group
    g.SetLimit(16)
    for i, it := range items {
        i, it := i, it
        g.Go(func() error {
            err := process(ctx, it)
            results[i] = Result{Item: it, Err: err}
            return nil
        })
    }
    _ = g.Wait()
    return results
}
```

No combined error. Caller iterates results, decides per-item action. Useful when callers want fine-grained control.

#### Pattern C: Multi-error struct

```go
type MultiError struct {
    PerItem map[string]error
}

func (m *MultiError) Error() string {
    var parts []string
    for k, v := range m.PerItem {
        parts = append(parts, fmt.Sprintf("%s: %v", k, v))
    }
    return strings.Join(parts, "; ")
}

func (m *MultiError) Unwrap() []error {
    out := make([]error, 0, len(m.PerItem))
    for _, v := range m.PerItem {
        out = append(out, v)
    }
    return out
}
```

Custom typed multi-error. Callers can `errors.As` to a `*MultiError`, then inspect `PerItem` map. Most expressive but most boilerplate.

### Choosing between them

- **`errors.Join`**: simplest, idiomatic in 1.20+. Default for new code.
- **Result slice**: when item identity matters and callers process per-item.
- **Custom multi-error**: when callers need structured access and aggregation logic.

Don't mix in one pipeline. Pick one, document it.

---

## errors.Join Deep Dive

`errors.Join` was added in Go 1.20. It creates an error that wraps multiple errors.

### Signature

```go
func Join(errs ...error) error
```

- Returns nil if all `errs` are nil.
- Otherwise returns an error whose `Error()` is the concatenation of each error's message (newline-separated) and whose `Unwrap()` returns `[]error{errs...}` (excluding nils).

### Example

```go
e1 := errors.New("one")
e2 := errors.New("two")
err := errors.Join(e1, e2)

fmt.Println(err)
// Output:
// one
// two

errors.Is(err, e1) // true
errors.Is(err, e2) // true
```

### Implementation sketch

```go
type joinError struct{ errs []error }

func (e *joinError) Error() string {
    var b strings.Builder
    for i, err := range e.errs {
        if i > 0 { b.WriteByte('\n') }
        b.WriteString(err.Error())
    }
    return b.String()
}

func (e *joinError) Unwrap() []error { return e.errs }

func Join(errs ...error) error {
    n := 0
    for _, e := range errs { if e != nil { n++ } }
    if n == 0 { return nil }
    je := &joinError{errs: make([]error, 0, n)}
    for _, e := range errs { if e != nil { je.errs = append(je.errs, e) } }
    return je
}
```

About 20 lines. Worth understanding so you know what you're getting.

### Custom format vs Join's format

`errors.Join`'s message is just newline-separated. Often you want richer formatting:

```go
type Aggregate struct {
    Stage string
    Errs  []error
}

func (a *Aggregate) Error() string {
    return fmt.Sprintf("%s: %d errors: %s",
        a.Stage, len(a.Errs), formatList(a.Errs))
}
func (a *Aggregate) Unwrap() []error { return a.Errs }
```

This gives a structured prefix and a count. `errors.Is`/`errors.As` still walk the children.

### errors.Is with multi-unwrap

`errors.Is` (in Go 1.20+) handles multi-unwrap correctly. For an error returned by `errors.Join(e1, e2)`:

- `errors.Is(joined, e1)` → walks to `e1`, returns true.
- `errors.Is(joined, e2)` → walks to `e2`, returns true.

`errors.As` similarly checks each branch.

For nested multi-unwraps, the walk is a depth-first traversal. Cycles are not handled — if you construct a cycle, `errors.Is` loops forever. Don't construct cycles.

### Performance

Joining N errors allocates one wrapper plus the slice. `Error()` walks all N. `Is`/`As` walks until match or exhaustion. All O(N).

If N is large (1000+), the formatted message is huge. Truncate at the boundary:

```go
const maxErrs = 20
if len(errs) > maxErrs {
    errs = append(errs[:maxErrs], fmt.Errorf("(%d more)", len(errs)-maxErrs))
}
return errors.Join(errs...)
```

---

## Multi-Stage Failure Rollback

Pipelines often have side effects: writing to a DB, calling an API, sending a message. If a downstream stage fails after upstream stages succeeded, those side effects must be undone.

### The problem

```
A: insert row in users
B: call external API to provision account
C: send welcome email
```

If C fails, A's row should be deleted and B's account deprovisioned. Otherwise you have a half-created user.

### Strategy 1: Two-phase

Stage 1 stages all work without committing. Stage 2 commits. If stage 1 fails on any item, no commits happen.

```go
type Tx interface {
    Stage(ctx context.Context, item Item) error
    Commit(ctx context.Context) error
    Rollback() error
}

func process(ctx context.Context, items []Item, tx Tx) error {
    defer tx.Rollback() // no-op if commit succeeded

    g, ctx := errgroup.WithContext(ctx)
    for _, it := range items {
        it := it
        g.Go(func() error {
            return tx.Stage(ctx, it)
        })
    }
    if err := g.Wait(); err != nil { return err }
    return tx.Commit(ctx)
}
```

Works for DB transactions but not for external APIs that lack two-phase.

### Strategy 2: Compensating actions

Each forward step has a corresponding rollback step. On failure, run rollbacks in reverse order:

```go
type Step struct {
    Forward    func(ctx context.Context) error
    Compensate func(ctx context.Context) error
}

func runSteps(ctx context.Context, steps []Step) error {
    var completed []Step
    for _, s := range steps {
        if err := s.Forward(ctx); err != nil {
            // rollback in reverse
            rollback(ctx, completed)
            return fmt.Errorf("step failed: %w", err)
        }
        completed = append(completed, s)
    }
    return nil
}

func rollback(ctx context.Context, steps []Step) {
    for i := len(steps) - 1; i >= 0; i-- {
        if err := steps[i].Compensate(ctx); err != nil {
            log.Error("rollback step failed", "err", err)
            // continue trying others
        }
    }
}
```

### Strategy 3: Saga with persistent state

For long-running multi-step processes, persist state. If the process crashes mid-rollback, restart it from saved state.

We expand on sagas next.

---

## Compensating Actions

A compensating action *undoes* a previously successful step. Designing them well is half the battle.

### Properties of a good compensator

- **Idempotent**: running it twice has the same effect as once.
- **Robust against partial state**: if forward step partially succeeded (e.g., row inserted but trigger not run), compensator handles both cases.
- **Independent of context**: doesn't require state from the forward call that might be lost on crash.

### Example: account provisioning

Forward: `provisionAccount(userID)` calls API, returns accountID.
Compensator: `deprovisionAccount(accountID)`.

If forward succeeded, accountID is known. Compensator just needs accountID — no other state.

If forward partially succeeded (API call timed out, account may or may not exist), compensator must handle both "account exists" and "account does not exist." Idempotent: `if exists, delete; else, no-op`.

### Example: email send

Forward: `sendEmail(to, body)`.
Compensator: `... ?`

You can't unsend an email. Some compensators are impossible. Options:

- Send a follow-up "ignore the previous message" email.
- Mark the email as "test" in your own DB, so the user knows.
- Accept that this step is non-compensatable and design accordingly (e.g., make it the last step so nothing can fail after it).

### Compensation ordering

Reverse order: last forward step undone first.

```go
forward: A B C D
compensate: D C B A
```

Why reverse? Because dependencies are forward. D depends on C's output; D's compensator must run before C's, or C's resources are gone.

### Compensation under concurrent failure

If two steps fail simultaneously, do you run both compensators? Or only the failing step's? Best practice: only run compensators for *succeeded* steps. The failing step didn't produce side effects (assuming it returned without success), so it has nothing to compensate.

If the failing step partially succeeded (network timeout after API call), you do need its compensator. Detect this via "best-effort cleanup":

```go
func (s *Step) ForwardWithCleanup(ctx context.Context) (didStart bool, err error) {
    didStart = false
    // before doing anything that has side effects
    err = s.precheck(ctx)
    if err != nil { return false, err }
    didStart = true // we're about to do work that may partially succeed
    err = s.do(ctx)
    return didStart, err
}
```

Caller:

```go
didStart, err := step.ForwardWithCleanup(ctx)
if err != nil {
    if didStart {
        // run compensator
    }
    return err
}
```

---

## Saga Patterns in Go Pipelines

A *saga* is a long-running transaction implemented as a sequence of forward steps with corresponding compensating actions.

### Two flavors

#### Orchestration

A central coordinator drives each step:

```go
type Orchestrator struct {
    steps []Step
}

func (o *Orchestrator) Run(ctx context.Context) error {
    var completed []Step
    defer func() {
        for i := len(completed) - 1; i >= 0; i-- {
            completed[i].Compensate(ctx)
        }
    }()

    for _, s := range o.steps {
        if err := s.Forward(ctx); err != nil {
            return err
        }
        completed = append(completed, s)
    }
    completed = nil // success; defer is a no-op
    return nil
}
```

Simple. Easy to debug. Single point of control. Doesn't scale to long-running (days, weeks) sagas without persistence.

#### Choreography

Each step emits an event; the next step listens and runs. Compensations are also event-driven. More flexible but harder to reason about.

In a Go pipeline, orchestration is the norm. Choreography is for cross-service workflows (often using a message broker).

### Persistent saga state

If your saga must survive a crash, persist state at each step:

```go
type SagaState struct {
    ID            string
    Step          int
    Completed     []string
    LastForward   string
    LastError     string
}

func (s *SagaState) Save(ctx context.Context, db *sql.DB) error {
    _, err := db.ExecContext(ctx, "INSERT INTO sagas ... ON CONFLICT (id) DO UPDATE ...", s)
    return err
}
```

On restart, load all incomplete sagas and resume:

```go
sagas, _ := loadIncompleteSagas(ctx, db)
for _, s := range sagas {
    go resumeSaga(ctx, s)
}
```

The resume logic: if we're rolling back, continue rollback. If forward, continue forward. Each step is idempotent so re-running is safe.

This is the architecture for systems like AWS Step Functions, Cadence, Temporal. You can implement a lightweight version in your own service.

---

## Panic Recovery in Stages

A panic in a `g.Go` function crashes the program. In production this is usually catastrophic. Recovery is a deliberate design choice.

### When to recover

- Stages that process untrusted input (user data, external API responses).
- Stages that use third-party libraries with unknown panic behaviour.
- Long-running workers where uptime matters.

### When NOT to recover

- Genuine programmer errors (nil dereference, index out of range). Recovery hides bugs.
- Critical invariant violations. Better to crash and restart than continue in a corrupt state.

### Recovery pattern

```go
func safeStage(ctx context.Context, fn func(context.Context) error) (err error) {
    defer func() {
        if r := recover(); r != nil {
            buf := make([]byte, 1<<16)
            n := runtime.Stack(buf, false)
            err = fmt.Errorf("panic in stage: %v\n%s", r, buf[:n])
        }
    }()
    return fn(ctx)
}

g.Go(func() error { return safeStage(ctx, parseStage) })
```

Notes:

- **Named return** so deferred recover can set it.
- **Capture stack** with `runtime.Stack` for debugging.
- **Wrap in error** so the pipeline's error flow continues normally.

### Distinguishing panics from errors

Sometimes useful at the caller:

```go
type PanicError struct {
    Value any
    Stack []byte
}

func (e *PanicError) Error() string { return fmt.Sprintf("panic: %v", e.Value) }

func safeStage(ctx context.Context, fn func(context.Context) error) (err error) {
    defer func() {
        if r := recover(); r != nil {
            buf := make([]byte, 1<<16)
            n := runtime.Stack(buf, false)
            err = &PanicError{Value: r, Stack: buf[:n]}
        }
    }()
    return fn(ctx)
}

// caller
var pe *PanicError
if errors.As(err, &pe) {
    log.Error("panic recovered", "stack", string(pe.Stack))
}
```

The `*PanicError` lets callers distinguish recovered panics from regular errors and act differently (alert, page on-call, etc.).

### Recovery and partial state

If a panic happened mid-write, your data may be inconsistent. Recovery converts the panic to an error but doesn't undo the partial write. Use compensating actions (sagas) for that.

### Don't recover at every level

Recover at the goroutine boundary, not inside every helper. Otherwise:

```go
func helper() {
    defer recover() // useless? hides real bugs?
}
```

The deeply nested `recover` swallows the panic. The function above thinks everything is fine. The bug is hidden. Recover only at well-defined boundaries.

---

## Memory Model Details

The Go memory model defines when one goroutine's reads see another's writes. Errgroup interacts with it precisely.

### Happens-before relationships

The memory model says: in `g.Go(f)`, the call to `Go` happens before `f` starts. So state set up *before* `Go` is visible *inside* `f`.

After `g.Wait()` returns, every operation inside every spawned `f` has completed *and* happened-before the return. So state written inside any `f` is visible to the caller.

This is why:

```go
results := make([]Result, n)
for i := 0; i < n; i++ {
    i := i
    g.Go(func() error {
        results[i] = compute(i)
        return nil
    })
}
g.Wait()
// results is fully populated; reads are safe.
```

Works without explicit synchronisation. The `Wait` provides the necessary happens-before.

### What about reads inside g.Go?

```go
shared := 0
g.Go(func() error { shared = 1; return nil })
g.Go(func() error { fmt.Println(shared); return nil })
g.Wait()
```

The two goroutines race. No happens-before between them. Race detector flags this. Use atomics or a mutex.

### sync.Once internals

`errgroup` uses `sync.Once` to capture the first error. `sync.Once.Do(f)` is implemented via an atomic counter and a mutex. Its guarantee: writes inside `f` happen-before any subsequent return from `Do` *for any caller*.

So in errgroup:

```go
g.errOnce.Do(func() {
    g.err = err
    if g.cancel != nil { g.cancel() }
})
```

After this returns to any caller, `g.err` and `g.cancel` are observably set. `Wait` reads `g.err` after `wg.Wait()`, which synchronises with all `Done` calls, which include the `errOnce.Do` execution by the failing goroutine.

The chain: failing goroutine writes err -> Once synchronises -> Done -> wg.Wait -> read err. All correct.

### Why mutex around aggregation works

```go
var mu sync.Mutex
var errs []error

g.Go(func() error {
    if err := work(); err != nil {
        mu.Lock()
        errs = append(errs, err)
        mu.Unlock()
    }
    return nil
})
g.Wait()
// Read errs here; safe due to wg.Wait synchronising with every Done,
// and mu.Unlock inside Done's window.
```

The mutex ensures writes don't race. `g.Wait()` ensures the final state is visible.

### When you DON'T need a mutex

If each goroutine writes to a unique slot (slice index), no synchronisation between goroutines is needed. They write to disjoint memory. `g.Wait` provides the final visibility.

```go
results := make([]int, n)
for i := 0; i < n; i++ {
    i := i
    g.Go(func() error { results[i] = compute(i); return nil })
}
g.Wait()
// safe to read all of results
```

This is the "result slot" pattern. Fast and lock-free.

---

## Lock-Free Aggregation

When you want to aggregate without mutex contention.

### Atomic counters

For numerical aggregation:

```go
var total atomic.Int64
g.Go(func() error {
    n, err := work()
    if err != nil { return err }
    total.Add(n)
    return nil
})
```

`atomic.Int64` is faster than mutex for simple updates. Use for counters, sums, etc.

### Per-goroutine buffers

Each goroutine writes to its own buffer; aggregate after.

```go
buffers := make([][]Result, n)
for i := 0; i < n; i++ {
    i := i
    g.Go(func() error {
        buf := buffers[i]
        for it := range items[i] {
            buf = append(buf, compute(it))
        }
        buffers[i] = buf
        return nil
    })
}
g.Wait()

// Merge after
var all []Result
for _, buf := range buffers {
    all = append(all, buf...)
}
```

No locking during the hot path. Merge is sequential but fast.

### Channels for streaming aggregation

```go
results := make(chan Result, runtime.NumCPU())
go func() {
    g.Wait()
    close(results)
}()

for _, item := range items {
    item := item
    g.Go(func() error {
        r, err := compute(item)
        if err != nil { return err }
        results <- r
        return nil
    })
}

var all []Result
for r := range results {
    all = append(all, r)
}
```

Channels serialize through the channel's internal lock; for very high throughput, prefer slot patterns.

### sync.Map for keyed aggregation

For per-key aggregation:

```go
var counts sync.Map

g.Go(func() error {
    for v := range in {
        key := compute(v)
        val, _ := counts.LoadOrStore(key, &atomic.Int64{})
        val.(*atomic.Int64).Add(1)
    }
    return nil
})
```

`sync.Map` is optimised for "write once, read many" workloads. For "write many, read once," a plain map with a mutex is often faster.

---

## Structured Concurrency in Depth

The principle: every goroutine has a defined lifetime bounded by its parent's lifetime. Tony Hoare proposed it in CSP; modern languages (Kotlin, Swift) implement it natively. Go doesn't, but you can implement it with discipline.

### Three rules

1. **Every goroutine is spawned via a tracked mechanism** (errgroup, WaitGroup, channel-based).
2. **The parent does not return until all spawned children have returned.**
3. **Cancellation propagates downward.**

`errgroup.WithContext` implements all three.

### Anti-pattern: orphan goroutines

```go
go updateMetrics()
```

`updateMetrics` runs forever. The function that started it has returned. Who cancels it? Often nobody. This is unstructured.

### Refactor to structured

```go
func service(ctx context.Context) error {
    g, ctx := errgroup.WithContext(ctx)
    g.Go(func() error { return updateMetrics(ctx) })
    g.Go(func() error { return handleRequests(ctx) })
    return g.Wait()
}
```

Both goroutines are now bounded by `service`'s lifetime. When `ctx` is cancelled, both stop. `service` returns when both stop.

### Nested groups

```go
g.Go(func() error {
    inner, ctx := errgroup.WithContext(ctx)
    inner.Go(...)
    inner.Go(...)
    return inner.Wait()
})
```

Inner's children are bounded by the inner goroutine's lifetime, which is bounded by outer. Trees of bounded lifetimes.

### Benefits

- No leaks.
- Clear ownership.
- Cancellation is well-defined.
- Easy to reason about: lifetime trees are straightforward.

### Cost

- More boilerplate.
- "Just go func()" is sometimes more concise.
- Worth it for any non-trivial service.

---

## Error Routing Architectures

In a complex service, errors flow through multiple layers. Designing this routing is its own art.

### Layer 1: stage-internal handling

Sentinel errors that the stage knows how to handle:

```go
for v := range in {
    if err := tryProcess(v); err != nil {
        switch {
        case errors.Is(err, ErrSkip):
            metrics.SkipCount.Inc()
            continue
        case errors.Is(err, ErrPoison):
            deadLetter(v)
            continue
        default:
            return fmt.Errorf("process: %w", err)
        }
    }
}
```

Local errors don't bubble. The stage decides.

### Layer 2: stage-boundary wrapping

Errors that escape the stage are wrapped:

```go
return fmt.Errorf("parse-stage: %w", err)
```

Or attributed via a typed error:

```go
return &StageError{Stage: "parse", Err: err}
```

### Layer 3: pipeline-level routing

The pipeline runner classifies and routes:

```go
err := pipeline.Run(ctx)
switch {
case err == nil:
    return Success()
case errors.Is(err, context.Canceled):
    return Cancelled()
case errors.Is(err, context.DeadlineExceeded):
    return Timeout()
case errors.Is(err, ErrTransient):
    return Retry()
default:
    return Failure(err)
}
```

### Layer 4: service-level reporting

The service surfaces errors to callers:

- HTTP handler: map to status code.
- gRPC: map to status code with details.
- CLI: print user-friendly message; log full chain.
- Background worker: increment metrics, log, requeue.

Each layer has its job. Errors flow up; metadata accumulates; the final form is appropriate for the audience.

### Don't skip layers

Tempting to handle errors "at the top" and skip stage-internal handling. Don't:

- Loses context.
- Forces top-level to know about every stage.
- Couples layers.

Each layer should handle what it knows; pass up what it doesn't.

---

## First Error vs All Errors Trade-Off

When designing a pipeline's error policy, decide explicitly:

### Use first-error-wins when

- The caller is a human user expecting one clear message.
- Subsequent failures are likely consequences of the first.
- Latency matters: fail fast saves work.
- Atomicity matters: any failure invalidates the whole.

### Use aggregation when

- Each item is independent.
- Callers want a full report.
- Latency is less important than completeness.
- Partial results have value.

### Hybrid

A pipeline might:

1. Fail fast on **structural** errors (DB unavailable, config wrong).
2. Aggregate on **per-item** errors (this row invalid, that one valid).

In code:

```go
func run(ctx context.Context, items []Item) error {
    if err := preflight(); err != nil {
        return fmt.Errorf("preflight: %w", err)
    }
    var perItem []error
    var mu sync.Mutex

    g, ctx := errgroup.WithContext(ctx)
    g.SetLimit(16)
    for _, it := range items {
        it := it
        g.Go(func() error {
            err := process(ctx, it)
            if err != nil {
                if errors.Is(err, ErrCritical) {
                    return err // first-error path
                }
                mu.Lock()
                perItem = append(perItem, err)
                mu.Unlock()
            }
            return nil
        })
    }
    if err := g.Wait(); err != nil {
        return err
    }
    if len(perItem) > 0 {
        return errors.Join(perItem...)
    }
    return nil
}
```

Critical errors bubble up immediately; per-item errors aggregate. Best of both.

---

## Dead-Letter Queues

A dead-letter queue (DLQ) holds items that repeatedly fail. They're not lost but not blocking the pipeline.

### Pattern

```go
type DLQ interface {
    Put(ctx context.Context, item Item, reason error) error
}

func processWithDLQ(ctx context.Context, item Item, dlq DLQ, maxAttempts int) error {
    var lastErr error
    for attempt := 0; attempt < maxAttempts; attempt++ {
        err := process(ctx, item)
        if err == nil { return nil }
        if errors.Is(err, ErrPoison) {
            return dlq.Put(ctx, item, err)
        }
        lastErr = err
        time.Sleep(backoff(attempt))
    }
    return dlq.Put(ctx, item, fmt.Errorf("max attempts: %w", lastErr))
}
```

After max attempts, item moves to DLQ. Pipeline continues. Operators inspect DLQ later.

### Implementation

- Database table: `dead_letter_queue (id, payload, error, attempts, last_attempt)`.
- Message queue (Kafka, RabbitMQ) with a separate DLQ topic.
- Cloud-native (AWS SQS, GCP Pub/Sub) — built-in DLQ support.

### When to use

- Async pipelines where items can be retried later.
- Async workers processing user-submitted content.
- Background ETL where some items are bad.

Not appropriate for synchronous request-response.

---

## Bulkheads

A bulkhead isolates failures to a portion of the system. Like watertight compartments on a ship.

### Pattern: per-tenant isolation

```go
type TenantPipeline struct {
    tenantID string
    limiter  *rate.Limiter
    workers  *errgroup.Group
}

func (tp *TenantPipeline) Submit(ctx context.Context, item Item) error {
    if !tp.limiter.Allow() {
        return ErrTenantThrottled
    }
    tp.workers.Go(func() error { return tp.process(ctx, item) })
    return nil
}
```

Each tenant gets its own limiter and worker pool. If tenant A's pipeline backs up, tenant B is unaffected.

### Pattern: per-resource semaphore

```go
dbSem := semaphore.NewWeighted(20)
apiSem := semaphore.NewWeighted(5)
```

Resources have bounded contention. If the API is slow, only 5 goroutines are blocked on it, not all.

### Pattern: separate goroutine pools

```go
fastPool, _ := errgroup.WithContext(ctx)
fastPool.SetLimit(100)
slowPool, _ := errgroup.WithContext(ctx)
slowPool.SetLimit(10)

if isFast(item) {
    fastPool.Go(...)
} else {
    slowPool.Go(...)
}
```

Slow items don't starve fast ones.

---

## Circuit Breakers in Pipelines

A circuit breaker stops requests to a failing dependency, letting it recover.

### States

- **Closed**: normal operation; requests flow.
- **Open**: failures exceeded threshold; requests fail fast.
- **Half-open**: after cooldown, try one request to see if recovered.

### Implementation

Use `github.com/sony/gobreaker` or roll your own:

```go
type Breaker struct {
    mu        sync.Mutex
    failures  int
    threshold int
    state     int
    openUntil time.Time
}

func (b *Breaker) Call(ctx context.Context, fn func() error) error {
    b.mu.Lock()
    if b.state == StateOpen && time.Now().Before(b.openUntil) {
        b.mu.Unlock()
        return ErrCircuitOpen
    }
    b.mu.Unlock()

    err := fn()
    b.mu.Lock()
    defer b.mu.Unlock()
    if err != nil {
        b.failures++
        if b.failures >= b.threshold {
            b.state = StateOpen
            b.openUntil = time.Now().Add(30 * time.Second)
        }
    } else {
        b.failures = 0
        b.state = StateClosed
    }
    return err
}
```

In a pipeline:

```go
g.Go(func() error {
    return breaker.Call(ctx, func() error { return apiCall(ctx, item) })
})
```

When the API is down, the breaker opens; subsequent goroutines fail fast without hammering the API. After 30 seconds, one is admitted to test recovery.

---

## Observability and Tracing

Production pipelines need to be debuggable.

### Structured logging

```go
log.Error("stage failed",
    "stage", "parse",
    "item", item.ID,
    "err", err)
```

Every error log includes the stage, item ID, and full error. Searchable, filterable.

### Metrics

- `pipeline.duration` (histogram, labelled by status).
- `pipeline.errors.count` (counter, labelled by stage, error type).
- `stage.duration` (histogram, labelled by stage).
- `pipeline.in_flight` (gauge).
- `pipeline.retries.count` (counter).

### Tracing

Distributed tracing (OpenTelemetry) propagates a trace ID through context. Each stage spans:

```go
func parseStage(ctx context.Context, in <-chan []byte, out chan<- Record) error {
    for b := range in {
        ctx, span := tracer.Start(ctx, "parse")
        r, err := parse(b)
        if err != nil { span.RecordError(err) }
        span.End()
        if err != nil { return err }
        out <- r
    }
    return nil
}
```

In a tracing UI you see the pipeline run as a tree: total time, per-stage time, per-item span. Indispensable for diagnosing slow stages or contention.

### Don't log inside hot loops

`log.Info` per item, at 100k items/sec, generates 100k log lines. Sample:

```go
if rand.Intn(1000) == 0 {
    log.Info("processed", "item", item.ID)
}
```

Or log only on error:

```go
if err != nil { log.Error("failed", "err", err) }
```

---

## Senior-Level Code Examples

### Example: ETL with aggregation and rollback

```go
type Importer struct {
    db        *sql.DB
    workers   int
    dlq       DLQ
}

func (im *Importer) Import(ctx context.Context, items []Item) error {
    var (
        succeeded []string
        succMu    sync.Mutex
        errs      []error
        errMu     sync.Mutex
    )

    g, ctx := errgroup.WithContext(ctx)
    g.SetLimit(im.workers)

    for _, it := range items {
        it := it
        g.Go(func() error {
            err := im.importOne(ctx, it)
            if err == nil {
                succMu.Lock()
                succeeded = append(succeeded, it.ID)
                succMu.Unlock()
                return nil
            }
            if errors.Is(err, ErrCritical) {
                return err
            }
            if errors.Is(err, ErrPoison) {
                _ = im.dlq.Put(ctx, it, err)
                return nil
            }
            errMu.Lock()
            errs = append(errs, fmt.Errorf("%s: %w", it.ID, err))
            errMu.Unlock()
            return nil
        })
    }

    if err := g.Wait(); err != nil {
        // Critical failure: rollback succeeded items.
        im.rollback(context.Background(), succeeded)
        return err
    }

    if len(errs) > 0 {
        return errors.Join(errs...)
    }
    return nil
}

func (im *Importer) rollback(ctx context.Context, ids []string) {
    g, ctx := errgroup.WithContext(ctx)
    g.SetLimit(im.workers)
    for _, id := range ids {
        id := id
        g.Go(func() error {
            _, err := im.db.ExecContext(ctx, "DELETE FROM imports WHERE id = $1", id)
            if err != nil {
                log.Error("rollback failed", "id", id, "err", err)
            }
            return nil
        })
    }
    _ = g.Wait()
}
```

Three error categories:

1. **Critical** (DB down, etc.): fail-fast, rollback succeeded items.
2. **Poison** (bad data): DLQ, continue.
3. **Per-item** (transient, retryable later): aggregate, return at end.

This is the shape of a production importer.

### Example: Saga with persistence

```go
type Saga struct {
    ID    string
    Steps []Step
    State *SagaState
    DB    *sql.DB
}

func (s *Saga) Run(ctx context.Context) error {
    for i := s.State.NextStep; i < len(s.Steps); i++ {
        s.State.NextStep = i
        s.persist(ctx)

        if err := s.Steps[i].Forward(ctx); err != nil {
            s.State.Error = err.Error()
            s.persist(ctx)
            return s.rollback(ctx, i)
        }
    }
    s.State.NextStep = len(s.Steps)
    s.persist(ctx)
    return nil
}

func (s *Saga) rollback(ctx context.Context, failedStep int) error {
    for i := failedStep - 1; i >= 0; i-- {
        s.State.RollbackStep = i
        s.persist(ctx)
        if err := s.Steps[i].Compensate(ctx); err != nil {
            log.Error("compensation failed", "step", i, "err", err)
            // continue; can't help it
        }
    }
    return errors.New("saga rolled back: " + s.State.Error)
}

func (s *Saga) persist(ctx context.Context) {
    _, _ = s.DB.ExecContext(ctx,
        "INSERT INTO sagas (id, state) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET state = $2",
        s.ID, s.State)
}
```

State persisted between steps. On crash, reload state, resume.

### Example: panic-safe pipeline

```go
func runSafely(ctx context.Context, fn func(context.Context) error) (err error) {
    defer func() {
        if r := recover(); r != nil {
            buf := make([]byte, 1<<16)
            n := runtime.Stack(buf, false)
            err = &PanicError{Value: r, Stack: buf[:n]}
            log.Error("panic", "value", r, "stack", string(buf[:n]))
        }
    }()
    return fn(ctx)
}

func runPipeline(ctx context.Context) error {
    g, ctx := errgroup.WithContext(ctx)
    g.Go(func() error { return runSafely(ctx, stage1) })
    g.Go(func() error { return runSafely(ctx, stage2) })
    g.Go(func() error { return runSafely(ctx, stage3) })
    return g.Wait()
}
```

Every stage is wrapped. A panic becomes an error. The pipeline behaves predictably.

---

## Architecture Patterns

### Microservice pipeline

Each stage is a separate service connected by a message broker. Errors propagate via DLQ topics. Sagas via event sourcing.

Pros: scalability, isolation. Cons: complexity, latency.

### Modular monolith pipeline

Stages are Go packages in one binary. Errgroup-based wiring. Errors via the standard pipeline patterns.

Pros: simplicity, low latency. Cons: scaling per-stage requires whole-binary scaling.

### Stream processing

Apache Kafka + a Go consumer. Each consumer processes a stream of events. Errors via DLQ topic. Compensations via event sourcing.

Pros: durability, replay. Cons: operational overhead.

### Choosing

For most internal pipelines, the modular monolith with errgroup is sufficient. Reach for distributed architectures when scale or durability requires it.

---

## Clean Code at Scale

At scale, "clean" means:

1. **One package per pipeline.** All stages, errors, types, tests in one package.
2. **Public surface is minimal.** Most types unexported. Just `Run(ctx, ...)`, errors, and config.
3. **Configuration through structs**, not function arguments.
4. **Tests exhaustively cover error paths.** Not just happy.
5. **Metrics and logs in every stage**, via cross-cutting wrappers.
6. **No mutable global state.** Even loggers are injected.
7. **Documentation per stage** explains its contract.

A senior-quality pipeline package looks like a library: stable API, comprehensive tests, clear docs.

---

## Product Considerations

- **Cost of failure**: a failed import affects N customers; design accordingly.
- **Recovery time**: if cancelled, how long to resume? Persistent sagas help.
- **Observability budget**: tracing every item is expensive; sample 1%.
- **Tenancy**: shared infrastructure needs bulkheads.
- **Compliance**: error logs may contain PII; redact before logging.

---

## Best Practices

1. Default to first-error; consider aggregation when partial results matter.
2. Use `errors.Join` for aggregation (1.20+).
3. Design compensating actions for every step with side effects.
4. Persist saga state for long-running workflows.
5. Recover panics at goroutine boundaries.
6. Lock-free aggregation where possible (slot pattern).
7. Bulkheads per tenant/resource.
8. Circuit breakers for external dependencies.
9. DLQ for poisoned items.
10. Structured logs + metrics + tracing for every pipeline.

---

## Edge Cases

### Cancellation during rollback

If the parent context is cancelled mid-rollback, rollback may not complete. Workaround: use a separate, longer-lived context for rollback:

```go
func (s *Saga) rollback(parentCtx context.Context, ...) error {
    ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
    defer cancel()
    // use ctx for rollback steps
}
```

Rollback persists; parent's cancellation doesn't abort cleanup.

### Compensator failure during rollback

What if a compensator fails? Best-effort: log and continue. Pipeline ends with rollback partially complete. Operators must finish manually.

For critical systems, persist rollback state. On restart, resume rollback.

### Errors.Join with 1000 items

Memory: 1000 errors + a slice. Manageable. But `Error()` produces a 1000-line string. Truncate before serialising.

### Multi-error errors.Is performance

`errors.Is` walks both single and multi unwraps. For deeply nested or wide multi-errors, it's O(N) total. In practice, fast.

---

## Common Mistakes

1. Aggregating with `errors.Join` and then returning `g.Wait()`'s error too — double-report.
2. Recovering panics without logging the stack trace.
3. Compensating in forward order instead of reverse.
4. Forgetting to persist saga state after each step.
5. Using shared `errgroup` across requests — single-use violations.
6. Circuit breaker without timeout — open forever.
7. DLQ without consumer — items accumulate forever.

---

## Tricky Points

- `errors.Join(nil)` returns nil. Useful: harmless to call with all nil.
- `errors.Is` against a joined error walks all branches.
- `recover` only catches panics in the same goroutine.
- `runtime.Stack` is expensive; avoid in tight loops.
- `sync.Once` cannot be reset; for re-runs, use a new one.
- `errgroup` is single-use; for re-runs, create a new group.

---

## Test Strategies

### Property-based: cancellation always terminates

```go
func TestPipelineAlwaysTerminates(t *testing.T) {
    f := func(seed int64) bool {
        ctx, cancel := context.WithCancel(context.Background())
        rng := rand.New(rand.NewSource(seed))
        go func() {
            time.Sleep(time.Duration(rng.Intn(100)) * time.Millisecond)
            cancel()
        }()
        done := make(chan struct{})
        go func() {
            _ = Run(ctx, randomItems(rng))
            close(done)
        }()
        select {
        case <-done:
            return true
        case <-time.After(time.Second):
            return false
        }
    }
    if err := quick.Check(f, nil); err != nil { t.Fatal(err) }
}
```

### Fault injection

```go
type FaultyDB struct {
    real    *sql.DB
    failOn  string
}

func (f *FaultyDB) Insert(ctx context.Context, r Record) error {
    if r.ID == f.failOn {
        return fmt.Errorf("simulated: %w", ErrTransient)
    }
    return f.real.Insert(ctx, r)
}
```

Inject failures at specific items to test retry and aggregation paths.

### Race detection

```bash
go test -race ./...
```

Always. Any race in production pipeline is a bug.

---

## Tricky Questions

**Q. Two stages fail with different `*StageError`s. Does `errors.As` work?**

`errgroup.Wait` returns whichever error was captured first. The other is dropped. `errors.As` on the returned error works on it. If you want both, aggregate.

**Q. What's the cost of `recover` in every goroutine?**

About 100 ns per call. Negligible unless you have a tight inner loop spawning goroutines.

**Q. Can I implement a saga without persistence for short pipelines?**

Yes. In-memory rollback list works fine for sub-second pipelines. Persistence is needed only for pipelines that span process restarts.

**Q. When does `errgroup.WithContext` cancel its derived context?**

When (a) the parent is cancelled, or (b) any `g.Go` function returns a non-nil error (via `errOnce`). Both cases trigger `cancel()` on the derived context.

**Q. How do I propagate trace context through a Go pipeline?**

Pass `context.Context` through every stage. The tracer reads the trace ID from context. Each stage starts a span as a child.

---

## Cheat Sheet

```go
// Aggregation
errs := []error{}
mu := sync.Mutex{}
g, ctx := errgroup.WithContext(ctx)
g.SetLimit(N)
for _, x := range xs {
    x := x
    g.Go(func() error {
        if err := do(x); err != nil {
            mu.Lock(); errs = append(errs, err); mu.Unlock()
        }
        return nil
    })
}
_ = g.Wait()
return errors.Join(errs...)

// Compensating action
defer func() {
    if err != nil { compensate() }
}()

// Panic recovery
defer func() {
    if r := recover(); r != nil { err = fmt.Errorf("panic: %v", r) }
}()

// Saga step
type Step struct {
    Forward    func(ctx) error
    Compensate func(ctx) error
}
```

---

## Self-Assessment

- [ ] I can implement error aggregation with `errors.Join` and reason about its memory model.
- [ ] I can design compensating actions for a pipeline with side effects.
- [ ] I can implement a saga with persistent state.
- [ ] I can recover panics at goroutine boundaries.
- [ ] I can choose between first-error and aggregation based on requirements.
- [ ] I can integrate bulkheads, circuit breakers, and DLQs into a pipeline.
- [ ] I can read a goroutine dump from production and identify the leak.

---

## Summary

At senior level, error propagation is a system-design topic. Aggregation, rollback, sagas, panic recovery, observability — all are deliberate choices that shape your service's resilience and debuggability. `errgroup` remains the foundation, but production pipelines layer on bulkheads, circuit breakers, DLQs, and persistent state.

The architectural test of a pipeline: when something fails at 3 AM, can the on-call engineer diagnose and respond in under an hour? If yes, your error design is good. If no, revisit.

Next: `professional.md` covers distributed pipelines across services, cost models of structured concurrency, and design tradeoffs at the staff level.

---

## Further Reading

- "Saga Pattern" — microservices.io.
- "Patterns of Distributed Systems" — Unmesh Joshi.
- "Site Reliability Engineering" — Google.
- "Designing Data-Intensive Applications" — Martin Kleppmann (chapters on fault tolerance).
- Temporal/Cadence documentation on durable execution.
- OpenTelemetry Go SDK docs for tracing.
- `github.com/sony/gobreaker` for circuit breaker.
- `github.com/cenkalti/backoff` for exponential backoff with jitter.
- Go Memory Model spec: `go.dev/ref/mem`.

---

## Bonus: Reading List

For week-by-week deep study:

- Week 1: Re-read Go memory model spec. Implement errgroup from scratch.
- Week 2: Implement a saga library. Test with simulated failures.
- Week 3: Implement bulkhead + circuit breaker. Profile under load.
- Week 4: Read "Designing Data-Intensive Applications" chapters 7-9.
- Week 5: Read Temporal's design docs. Implement a tiny temporal-like state machine.
- Week 6: Audit a production pipeline at your company. Note every error path.

By the end you'll be designing pipelines, not just writing them.

---

## Extended Section: Building a Production Saga Coordinator

We've sketched sagas. Let's build a complete one — a coordinator that can run multi-step workflows with persistent state, idempotent steps, and proper compensation. This is the kind of code that powers order-processing systems, multi-step provisioning, and any workflow that crosses transactional boundaries.

### Requirements

- Each step is a forward operation paired with a compensator.
- State is persisted after each step so we can resume after crashes.
- Steps must be idempotent — retrying a partially completed step is safe.
- On any step failure, compensators run in reverse for all completed steps.
- A failed compensator doesn't stop other compensators from running.
- The coordinator emits structured events for observability.

### Data model

```go
type SagaStatus string

const (
    StatusPending     SagaStatus = "pending"
    StatusRunning     SagaStatus = "running"
    StatusCompleted   SagaStatus = "completed"
    StatusFailed      SagaStatus = "failed"
    StatusRolledBack  SagaStatus = "rolled_back"
    StatusRollingBack SagaStatus = "rolling_back"
)

type SagaRecord struct {
    ID             string
    DefinitionID   string
    Status         SagaStatus
    CurrentStep    int
    LastError      string
    StartedAt      time.Time
    UpdatedAt      time.Time
    CompletedSteps []string
}
```

### Step interface

```go
type Step interface {
    Name() string
    Forward(ctx context.Context, payload []byte) error
    Compensate(ctx context.Context, payload []byte) error
}
```

The payload is serialised state. Each step receives the saga's input data and can read/write it for inter-step communication (via the persistent record).

### Coordinator

```go
type Coordinator struct {
    store    SagaStore
    steps    []Step
    metrics  Metrics
    logger   Logger
}

func (c *Coordinator) Run(ctx context.Context, sagaID string, payload []byte) error {
    rec, err := c.store.Load(ctx, sagaID)
    if err != nil { return fmt.Errorf("load saga: %w", err) }

    if rec == nil {
        rec = &SagaRecord{
            ID: sagaID,
            DefinitionID: c.definitionID,
            Status: StatusPending,
            StartedAt: time.Now(),
        }
        if err := c.store.Save(ctx, rec); err != nil { return fmt.Errorf("init: %w", err) }
    }

    switch rec.Status {
    case StatusCompleted:
        return nil // already done; idempotent
    case StatusFailed, StatusRolledBack:
        return fmt.Errorf("saga %s already failed: %s", sagaID, rec.LastError)
    case StatusRollingBack:
        return c.continueRollback(ctx, rec, payload)
    }

    return c.forward(ctx, rec, payload)
}

func (c *Coordinator) forward(ctx context.Context, rec *SagaRecord, payload []byte) error {
    rec.Status = StatusRunning
    for i := rec.CurrentStep; i < len(c.steps); i++ {
        step := c.steps[i]
        rec.CurrentStep = i
        if err := c.store.Save(ctx, rec); err != nil {
            return fmt.Errorf("persist before step %d: %w", i, err)
        }

        c.logger.Info("saga forward step start", "saga", rec.ID, "step", step.Name())
        start := time.Now()
        err := step.Forward(ctx, payload)
        c.metrics.RecordStep(step.Name(), time.Since(start), err)

        if err == nil {
            rec.CompletedSteps = append(rec.CompletedSteps, step.Name())
            continue
        }

        c.logger.Error("saga step failed", "saga", rec.ID, "step", step.Name(), "err", err)
        rec.LastError = err.Error()
        rec.Status = StatusRollingBack
        if err := c.store.Save(ctx, rec); err != nil {
            return fmt.Errorf("persist before rollback: %w", err)
        }

        return c.rollback(ctx, rec, payload)
    }

    rec.Status = StatusCompleted
    return c.store.Save(ctx, rec)
}

func (c *Coordinator) continueRollback(ctx context.Context, rec *SagaRecord, payload []byte) error {
    return c.rollback(ctx, rec, payload)
}

func (c *Coordinator) rollback(ctx context.Context, rec *SagaRecord, payload []byte) error {
    // Rollback uses a fresh context with longer deadline.
    rollbackCtx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
    defer cancel()

    // Compensate in reverse order.
    var compensationErrs []error
    for i := len(rec.CompletedSteps) - 1; i >= 0; i-- {
        name := rec.CompletedSteps[i]
        step := c.findStep(name)
        if step == nil {
            compensationErrs = append(compensationErrs, fmt.Errorf("unknown step: %s", name))
            continue
        }

        c.logger.Info("saga compensate start", "saga", rec.ID, "step", name)
        start := time.Now()
        err := step.Compensate(rollbackCtx, payload)
        c.metrics.RecordCompensation(name, time.Since(start), err)

        if err != nil {
            c.logger.Error("compensation failed", "saga", rec.ID, "step", name, "err", err)
            compensationErrs = append(compensationErrs, fmt.Errorf("compensate %s: %w", name, err))
            // continue; try to compensate the rest
        }

        rec.CompletedSteps = rec.CompletedSteps[:i]
        rec.CurrentStep = i
        c.store.Save(rollbackCtx, rec)
    }

    rec.Status = StatusRolledBack
    rec.UpdatedAt = time.Now()
    if err := c.store.Save(rollbackCtx, rec); err != nil {
        compensationErrs = append(compensationErrs, fmt.Errorf("final save: %w", err))
    }

    if len(compensationErrs) > 0 {
        return fmt.Errorf("saga failed and rollback had %d errors: %w",
            len(compensationErrs), errors.Join(compensationErrs...))
    }
    return fmt.Errorf("saga rolled back: %s", rec.LastError)
}

func (c *Coordinator) findStep(name string) Step {
    for _, s := range c.steps {
        if s.Name() == name { return s }
    }
    return nil
}
```

### What this coordinator gives you

1. **Crash recovery**: state in DB lets us resume after process restart.
2. **Idempotency**: each step is identified by name; running twice is safe if step implementation is idempotent.
3. **Compensation correctness**: reverse order, all errors collected, all run.
4. **Observability**: structured logs and metrics at every step.
5. **Separate rollback context**: cancellation of forward doesn't kill compensation.

### Caveats

- **Concurrent execution of same saga**: if two replicas try to run the same saga, we need a lock (DB advisory lock, Redis lock). Otherwise compensations race with forward steps.
- **Long-running steps**: if a step takes hours, save partial progress.
- **Non-idempotent compensators**: if compensator can't be retried, mark the saga "needs manual intervention" instead of looping forever.

### When to use this vs Temporal

If your saga is simple (3-5 steps, single service), a coordinator like this is fine. For complex workflows across many services, with retries, signals, and child workflows, use Temporal or Cadence. They solve real problems but add operational complexity.

---

## Extended Section: Error Aggregation Patterns at Scale

When processing millions of items and aggregating errors, naive patterns degrade.

### Pattern: Capped error buffer

```go
type ErrorBuffer struct {
    mu    sync.Mutex
    errs  []error
    cap   int
    overflowCount atomic.Int64
}

func (b *ErrorBuffer) Add(err error) {
    b.mu.Lock()
    defer b.mu.Unlock()
    if len(b.errs) < b.cap {
        b.errs = append(b.errs, err)
    } else {
        b.overflowCount.Add(1)
    }
}

func (b *ErrorBuffer) Result() error {
    b.mu.Lock()
    defer b.mu.Unlock()
    if len(b.errs) == 0 && b.overflowCount.Load() == 0 {
        return nil
    }
    errs := append([]error{}, b.errs...)
    if n := b.overflowCount.Load(); n > 0 {
        errs = append(errs, fmt.Errorf("(%d more errors elided)", n))
    }
    return errors.Join(errs...)
}
```

Bounded memory regardless of error count. Useful when error volume can spike.

### Pattern: Categorised aggregation

Group errors by category:

```go
type Categorized struct {
    mu       sync.Mutex
    byKind   map[string][]error
}

func (c *Categorized) Add(kind string, err error) {
    c.mu.Lock()
    defer c.mu.Unlock()
    c.byKind[kind] = append(c.byKind[kind], err)
}

func (c *Categorized) Summary() string {
    c.mu.Lock()
    defer c.mu.Unlock()
    var parts []string
    for kind, errs := range c.byKind {
        parts = append(parts, fmt.Sprintf("%s: %d", kind, len(errs)))
    }
    return strings.Join(parts, ", ")
}
```

The caller learns "transient: 12, validation: 3, db: 1" at a glance.

### Pattern: Sample errors

For very high volume, sample:

```go
type Sample struct {
    mu      sync.Mutex
    seen    int64
    sampled []error
    cap     int
}

func (s *Sample) Add(err error) {
    n := atomic.AddInt64(&s.seen, 1)
    s.mu.Lock()
    defer s.mu.Unlock()
    if len(s.sampled) < s.cap {
        s.sampled = append(s.sampled, err)
    } else {
        // Reservoir sampling
        j := rand.Int63n(n)
        if j < int64(s.cap) {
            s.sampled[j] = err
        }
    }
}
```

Reservoir sampling: every error has equal probability of being in the final sample. Memory bounded; representative.

---

## Extended Section: Distributed Pipeline Failure Modes

Pipelines that cross service boundaries have additional failure modes.

### Network partition

A stage calls a remote service; the network drops mid-call. The remote may or may not have processed the request. From the caller's view, it's a timeout.

Mitigation: idempotency keys + retry with backoff. The remote service deduplicates based on the key, so retries are safe.

### Asymmetric failure

The remote thinks the request succeeded; the caller thinks it failed (due to a slow response that arrived after timeout). Compensator must handle this — usually by querying the remote for the operation's status using the idempotency key.

### Cascading failure

Service A fails; service B retries A; B's retries overload A more; A fails harder. Circuit breakers prevent this.

### Stale state

A long-running pipeline's first stage read data at time T0. By T10, the data has changed. The pipeline operates on stale data.

Mitigation: include a version/etag in pipeline state; verify at write time.

### Cross-service compensation

Compensating a remote service requires it to support the compensation API. If it doesn't, you can't reliably roll back. Design APIs for compensability from day one.

---

## Extended Section: Memory Model Edge Cases

The Go memory model is precise. Some pipeline-relevant nuances:

### Channel send/receive

A send on a channel happens-before the corresponding receive completes. So:

```go
go func() { x = 1; ch <- 0 }()
<-ch
fmt.Println(x) // sees 1
```

The send synchronises the write to `x` with the read after the receive. This is why channel-based aggregation is correct.

### Atomic operations

`atomic.Store` happens-before `atomic.Load` of the same address. So:

```go
go func() { val = compute(); atomic.StoreInt32(&ready, 1) }()
for atomic.LoadInt32(&ready) == 0 { /* spin */ }
fmt.Println(val) // sees compute's result
```

Atomics give cross-goroutine happens-before. The spin-loop is a busy-wait; in real code, use a channel or `sync.WaitGroup`.

### sync.WaitGroup

`wg.Done` happens-before `wg.Wait` returns. So any writes before `Done` are visible after `Wait`. This is the mechanism by which `g.Wait` lets you read state safely.

### sync.Mutex

`mu.Unlock()` happens-before the next `mu.Lock()`. So writes inside a critical section are visible to the next holder of the lock.

### Why this matters for errgroup

Every `g.Wait` ends with `wg.Wait`, which synchronises with every `wg.Done`. Each `wg.Done` happens after the goroutine's `f()` returns. So writes inside `f` happen-before `Wait` returns. No mutex needed for the final read — except for writes that race *between* goroutines.

### Common bug

```go
total := 0
for _, n := range nums {
    n := n
    g.Go(func() error { total += n; return nil }) // RACE
}
g.Wait()
```

`total += n` reads then writes `total` — two goroutines doing this race. The race detector catches it. Fix with atomic or mutex:

```go
var total atomic.Int64
for _, n := range nums {
    n := n
    g.Go(func() error { total.Add(int64(n)); return nil })
}
g.Wait()
fmt.Println(total.Load())
```

Or per-goroutine slot:

```go
sums := make([]int, len(nums))
for i, n := range nums {
    i, n := i, n
    g.Go(func() error { sums[i] = n; return nil })
}
g.Wait()
total := 0
for _, s := range sums { total += s }
```

The slot approach is often fastest.

---

## Extended Section: Designing Error Hierarchies

Production systems benefit from a thoughtful error hierarchy.

### Three-level hierarchy

```go
// Top-level kinds
var (
    ErrClient   = errors.New("client error")
    ErrServer   = errors.New("server error")
    ErrTransient = errors.New("transient")
)

// Middle: specific conditions
var (
    ErrValidation = fmt.Errorf("%w: validation", ErrClient)
    ErrAuth       = fmt.Errorf("%w: auth", ErrClient)
    ErrInternal   = fmt.Errorf("%w: internal", ErrServer)
)

// Leaf: detailed errors
return fmt.Errorf("%w: missing required field: name", ErrValidation)
```

Callers can match at any level:

```go
errors.Is(err, ErrValidation) // specific
errors.Is(err, ErrClient)     // broad
errors.Is(err, ErrTransient)  // for retry logic
```

### When NOT to do this

If your service has a small, fixed error vocabulary, a flat list of sentinels is simpler. Hierarchy adds value only when you have 20+ errors that group naturally.

### Mapping to status codes

```go
func statusOf(err error) int {
    switch {
    case errors.Is(err, ErrAuth):
        return 401
    case errors.Is(err, ErrValidation):
        return 400
    case errors.Is(err, ErrNotFound):
        return 404
    case errors.Is(err, ErrTransient):
        return 503
    case errors.Is(err, ErrServer):
        return 500
    default:
        return 500
    }
}
```

The hierarchy makes this clean. Each `errors.Is` matches the highest-priority category.

---

## Extended Section: Pipeline Health Monitoring

A production pipeline needs operational signals.

### Liveness probe

Does the pipeline accept input?

```go
func (p *Pipeline) Liveness() bool {
    return atomic.LoadInt32(&p.running) == 1
}
```

If not, restart the service.

### Readiness probe

Can the pipeline process new requests?

```go
func (p *Pipeline) Readiness() bool {
    if !p.Liveness() { return false }
    if p.queueDepth() > p.maxQueue { return false }
    if p.circuitBreaker.State() == StateOpen { return false }
    return true
}
```

If not ready, load balancer routes elsewhere.

### Metrics dashboard

- Throughput: items/second per stage.
- Error rate: errors/total per stage.
- Latency: p50, p95, p99 per stage.
- Queue depth between stages.
- Active goroutines: detect leaks.
- DLQ size: detect runaway poison.
- Saga in-flight: detect hung sagas.
- Compensation rate: detect failure clusters.

### Alerts

- Error rate spike: >5x baseline for 5 minutes.
- Queue depth growth: increasing for 10 minutes.
- Pipeline stall: no completions for 5 minutes.
- DLQ growth: >100/min.

Calibrate to your service's normal behaviour. Over-alerting causes alert fatigue.

---

## Closing the Loop: From Junior to Senior

To recap the progression:

- **Junior**: errgroup mechanics, channels, ctx, %w wrapping.
- **Middle**: error design, fan-out, retry, bounded parallelism, nested groups.
- **Senior**: aggregation, sagas, panics, memory model, distributed concerns.

Each level adds layers, but the fundamentals don't change. Junior-level discipline (`defer close`, `select` on ctx, `%w` wrap) is still required at senior. Senior-level patterns (sagas, aggregation) sit on top of junior-level scaffolding.

If you skip junior because you "already know goroutines," you'll write fragile senior-level code that compiles and tests pass but breaks in production. Master the basics. Then everything else is composition.

---

## Final Note

Error propagation in pipelines is a deep topic because it interacts with concurrency, distributed systems, transactions, observability, and product design simultaneously. There is no "one true way" — only patterns that fit certain situations better than others. Your job as a senior engineer is to choose the right one for each situation and to explain *why* in code review.

The exam: a code reviewer points at a `g.Go(func() error { ... })` block and asks "why this design?" Your answer should reference the requirements (atomicity, throughput, observability), the failure modes (transient vs permanent, cascading vs isolated), and the trade-offs (latency vs completeness, simplicity vs flexibility). If you can explain those, you're operating at senior level.

---

## Case Studies: Real-World Pipeline Failures

Three case studies of pipeline failures in production. Names changed.

### Case 1: The 3 AM page that never came

A nightly batch import. 10 million rows. Always finishes by 6 AM. One night, no completion alert by 9 AM. The on-call wakes up, finds the pipeline stuck.

Goroutine dump: every worker blocked on `chan recv` from a channel that nobody was writing to. The producer had returned 4 hours earlier, but didn't close the channel — a missing `defer close`. Workers waited forever.

The fix: add `defer close(out)`. The bug had existed for months but only triggered when the producer returned early due to a corner case in the input. Most nights, the producer ran to completion and then `return nil` happened to coincide with workers having consumed everything — no detectable issue.

Lesson: `defer close` runs on every exit path, including the corner case you didn't think of. Always.

### Case 2: The retries that took down the service

A service had a pipeline that retried API calls on failure. The remote API was rate-limited at 100 RPS. Normal traffic: 50 RPS. One day, the remote API briefly returned 503s for 30 seconds.

Every in-flight request retried. New requests piled up. After the brief outage, the service had 5000 queued requests, each retrying every 100 ms. The remote was back up but immediately overwhelmed by 50,000 RPS of retries. It went back down. The cycle repeated.

The fix: add a circuit breaker. When the remote returns 503s, open the breaker, fail fast for 30 seconds. Don't retry through the breaker.

Lesson: retries amplify failures. Combine them with bulkheads and breakers.

### Case 3: The compensator that wasn't idempotent

A saga in a payment system: charge card, allocate inventory, create order, send email. The "create order" step persisted to two tables in different schemas (legacy). If the second insert failed, the saga rolled back. The compensator deleted from the first table.

But the compensator wasn't idempotent. If it ran twice (because the saga was retried after a crash mid-rollback), it tried to delete a row that was already gone — returned an error — and the saga was marked "rollback failed: row not found."

Operators had to manually mark sagas resolved. Hundreds accumulated.

The fix: the compensator now uses `DELETE WHERE id = $1` which is idempotent (deletes 0 rows if already gone, no error). The saga succeeded on retry.

Lesson: every compensator must be idempotent. Test by running it twice.

---

## Extended Section: Coordinating With Message Queues

When your pipeline is fed by a message queue (Kafka, RabbitMQ, SQS), error propagation interacts with queue semantics.

### At-least-once delivery

Most queues guarantee at-least-once: a message may be delivered more than once. Your pipeline must be idempotent for repeated messages.

```go
func consume(ctx context.Context, ch <-chan Message) error {
    for msg := range ch {
        if err := process(ctx, msg); err != nil {
            // Don't ack; queue will redeliver.
            msg.Nack()
            continue
        }
        msg.Ack()
    }
    return nil
}
```

If `process` fails, nack tells the queue to redeliver. If `process` succeeded but the program crashed before ack, redelivery happens — and `process` runs again. Idempotency is essential.

### Exactly-once via deduplication

To approximate exactly-once: maintain a "processed_messages" table with message IDs. Before processing, check; after processing, insert.

```go
func process(ctx context.Context, msg Message) error {
    tx, err := db.BeginTx(ctx, nil)
    if err != nil { return err }
    defer tx.Rollback()

    var exists bool
    if err := tx.QueryRowContext(ctx,
        "SELECT EXISTS(SELECT 1 FROM processed WHERE id = $1)", msg.ID).Scan(&exists); err != nil {
        return err
    }
    if exists { return nil } // already processed

    if err := doWork(ctx, tx, msg); err != nil { return err }

    _, err = tx.ExecContext(ctx, "INSERT INTO processed (id) VALUES ($1)", msg.ID)
    if err != nil { return err }
    return tx.Commit()
}
```

The transaction ensures the dedup record and the work commit atomically. If anything fails, transaction rolls back; redelivery is safe.

### DLQ from the queue

Most queues support a DLQ topic. After N failed deliveries, the queue moves the message to the DLQ:

```yaml
queue:
  name: events
  max_retries: 5
  dlq: events-dlq
```

Operators inspect the DLQ. Often, fixes involve patching the consumer code and replaying the DLQ messages.

### Manual nack with delay

Some queues let you nack with a delay:

```go
msg.NackWithDelay(30 * time.Second)
```

For transient failures, redelivering immediately just retries the same failure. A 30-second delay gives the dependency time to recover.

### Backpressure

If your pipeline is slow, messages accumulate in the queue. The queue may have its own limits (memory, retention). Monitor queue depth as a leading indicator.

To apply backpressure: prefetch limit. Tell the queue "give me at most N unacked messages":

```go
qchannel.Qos(10, 0, false) // RabbitMQ: 10 messages at a time
```

This caps in-flight work and lets the queue absorb the rest.

---

## Extended Section: Error Propagation in Streaming Pipelines

Streaming pipelines have no "end." They run forever, processing events as they arrive. Error semantics differ.

### Per-event error handling

In a stream, a single bad event shouldn't stop the pipeline:

```go
for ev := range stream {
    if err := process(ev); err != nil {
        log.Error("event failed", "id", ev.ID, "err", err)
        metrics.Counter("stream.errors").Inc()
        // continue
    }
}
```

Errors are observed, logged, and the next event is processed. The pipeline is durable.

### Catastrophic failure

Some failures *should* stop the pipeline: DB completely down, config corrupt, panics. Distinguish:

```go
for ev := range stream {
    err := process(ev)
    if err == nil { continue }

    if errors.Is(err, ErrFatal) {
        return fmt.Errorf("fatal: %w", err) // pipeline shuts down
    }
    log.Error("event failed", "err", err)
}
```

Define `ErrFatal` carefully. Most failures aren't fatal.

### Position tracking

In a stream, you must remember "where am I?" so on restart you don't re-process from the beginning:

```go
type Cursor struct {
    Offset int64
    UpdatedAt time.Time
}

func process(ev Event) error {
    if err := doWork(ev); err != nil { return err }
    return cursor.Save(ev.Offset)
}
```

If processing succeeds but cursor save fails, on restart we re-process. Idempotency needed.

### Backpressure in streams

If the stream produces faster than you process, options:

- Buffer with bounded capacity; drop excess.
- Sample (process every Nth event).
- Scale out: more consumer instances.
- Apply backpressure to producer (rarely possible for external streams).

Pipeline design decides which.

### Lambdas vs goroutines for stream processing

In serverless (AWS Lambda, Cloud Functions), each event is a separate invocation. No long-lived goroutines. Error semantics are simpler but state management is harder.

In Go with goroutines, you have a long-lived process. State is in memory. Failures lose state unless persisted.

Trade-off: simplicity vs efficiency.

---

## Extended Section: Cross-Stage Tracing

Distributed tracing makes pipelines debuggable.

### OpenTelemetry primer

```go
import "go.opentelemetry.io/otel"

tracer := otel.Tracer("pipeline")

func stage(ctx context.Context, in <-chan Job) error {
    for job := range in {
        ctx, span := tracer.Start(ctx, "stage.process",
            trace.WithAttributes(attribute.String("job.id", job.ID)))
        err := process(ctx, job)
        if err != nil {
            span.RecordError(err)
            span.SetStatus(codes.Error, err.Error())
        }
        span.End()
        if err != nil { return err }
    }
    return nil
}
```

Each item gets its own span. The span tree shows the item's journey through stages.

### Propagating across channels

`context.Context` flows through stages. But what if the channel only carries the item, not the context?

```go
type Wrapped[T any] struct {
    Ctx  context.Context
    Item T
}

func parseStage(in <-chan Wrapped[[]byte], out chan<- Wrapped[Record]) error {
    for w := range in {
        ctx, span := tracer.Start(w.Ctx, "parse")
        r, err := parse(w.Item)
        span.End()
        if err != nil { return err }
        out <- Wrapped[Record]{Ctx: ctx, Item: r}
    }
    return nil
}
```

The context (including trace ID) travels with the item. Each stage adds a child span. The trace shows the item's full path.

Caveat: contexts shouldn't be stored in structs (Go style says so). But for tracing in pipelines, it's a pragmatic exception. Document it.

### Alternative: extract baggage

Instead of carrying full context, carry trace ID as baggage:

```go
type Job struct {
    ID      string
    TraceID string
    SpanID  string
    Payload []byte
}
```

Each stage starts a span from the trace/span IDs. No context smuggling.

### Sampling

Tracing every item is expensive. Sample:

```go
sampler := trace.TraceIDRatioBased(0.01) // 1%
```

1% of items get traced; the rest don't. Storage cost manageable; representative sample available for debugging.

### Reading a pipeline trace

In Jaeger or Tempo, a pipeline trace looks like a Gantt chart:

```
[ingest         ]
  [parse        ]
   [enrich      ]
    [store      ]
                 [next item]
```

You see exactly where time is spent. Where retries happened. Which stage is the bottleneck. Indispensable.

---

## Extended Section: Failure Injection

Don't just hope error paths work — test them.

### Manual injection

In tests:

```go
type FaultyStorer struct {
    real  Storer
    failOn map[string]error
}

func (f *FaultyStorer) Store(ctx context.Context, r Record) error {
    if err, ok := f.failOn[r.ID]; ok {
        return err
    }
    return f.real.Store(ctx, r)
}
```

Wire `FaultyStorer` into the pipeline. Test that failures propagate, compensations run, etc.

### Chaos engineering

In production-like environments, inject failures randomly:

- Network: drop X% of packets between services.
- CPU: pin a worker at 100% CPU.
- Latency: add 500ms to one in 1000 requests.
- Errors: make a random 1% of API calls fail.

Tools: Chaos Mesh, Litmus, Gremlin. Or roll your own:

```go
type ChaosWrapper struct {
    real    APIClient
    rng     *rand.Rand
    errRate float64
}

func (c *ChaosWrapper) Call(ctx context.Context, req Request) (Response, error) {
    if c.rng.Float64() < c.errRate {
        return Response{}, errors.New("chaos: simulated failure")
    }
    return c.real.Call(ctx, req)
}
```

Enabled in staging. Find the bugs before users do.

### Game days

Once a quarter, run a planned outage: take down a dependency for an hour. Watch how the pipeline reacts. Did the circuit breaker open? Did retries back off? Did DLQ fill up cleanly?

These exercises surface gaps in your design that you can't discover by reading code.

---

## Extended Section: Performance Engineering

Some heuristics for tuning pipeline performance.

### Profile first

```bash
go test -bench . -cpuprofile cpu.prof
go tool pprof cpu.prof
```

Or in a running service:

```go
import _ "net/http/pprof"
go func() { http.ListenAndServe("localhost:6060", nil) }()
```

Then `go tool pprof http://localhost:6060/debug/pprof/profile`. See where CPU is spent.

### Common bottlenecks

- **Mutex contention**: pprof shows `runtime.lock`/`semrelease`. Mitigate with sharded locks or atomic operations.
- **Channel contention**: high time in `chansend`/`chanrecv`. Increase buffer or use multiple channels.
- **Allocation**: high `runtime.mallocgc`. Pre-allocate slices, use `sync.Pool` for temporary objects.
- **GC pressure**: tune `GOGC`, reduce allocations.
- **System calls**: too many small `read`/`write`. Batch.

### Goroutine count

`runtime.NumGoroutine()` periodically. If growing unbounded, you have a leak. Heap profile shows where the goroutines were started:

```bash
go tool pprof http://localhost:6060/debug/pprof/goroutine
```

### Latency tuning

If p99 latency is bad but average is fine, you have outliers. Look for:

- Tail latency from one slow dependency.
- GC pauses (rare in Go but possible with large heaps).
- Cache misses (CPU profile shows high stalled cycles).
- Contention (pprof block profile).

### Throughput tuning

If throughput is bottlenecked, look for:

- Underutilised CPUs (need more goroutines).
- Saturated CPUs (need fewer, or faster work).
- I/O-bound stages (more parallelism helps).
- Lock contention (sharding helps).

### Avoid premature optimisation

Most pipelines are correct-but-slow before they're slow-and-wrong. Get correctness first.

---

## Extended Section: API Design for Pipelines

When publishing a pipeline as a library or service interface:

### Stable public API

```go
package pipeline

type Config struct {
    Workers int
    RateLimit int
}

func New(cfg Config) *Pipeline
func (p *Pipeline) Run(ctx context.Context, input []Item) (*Result, error)
type Result struct {
    Successful []Item
    Failed     []FailedItem
    Duration   time.Duration
}
type FailedItem struct {
    Item Item
    Err  error
}
```

Minimal surface. `Run` is the only verb. Result is a value type. Errors are exported sentinels and types.

### Versioning

Sentinels and types are part of the API. Renaming breaks callers. Adding new ones is non-breaking *unless* a caller's switch had a default.

Use semver. Bumps mean: patch for bug fixes, minor for new errors/options, major for renames.

### Options pattern

```go
type Option func(*Config)

func WithWorkers(n int) Option { ... }

func New(opts ...Option) *Pipeline {
    cfg := defaultConfig()
    for _, o := range opts { o(&cfg) }
    return &Pipeline{cfg: cfg}
}
```

Lets callers customise without growing your signature.

### Documentation

Every exported symbol has a doc comment. Errors documented in package doc. Examples in `example_test.go`.

```go
// Run executes the pipeline.
//
// Returns a non-nil error if any item fails. Use errors.Is to identify:
//   - ErrInvalid: an item failed validation
//   - ErrTransient: an item failed transiently; retry may succeed
//   - context.Canceled: caller cancelled
//
// The Result.Successful list contains items that processed successfully,
// even if other items failed.
func (p *Pipeline) Run(ctx context.Context, items []Item) (*Result, error)
```

Callers should be able to use the package without reading the source.

---

## Extended Section: Cross-Language Concerns

If your pipeline interacts with non-Go services, errors interact with their conventions.

### gRPC

gRPC has its own error model: status codes (OK, INVALID_ARGUMENT, NOT_FOUND, etc.) plus details. Map:

```go
func toGRPC(err error) error {
    switch {
    case errors.Is(err, ErrNotFound):
        return status.Error(codes.NotFound, err.Error())
    case errors.Is(err, ErrValidation):
        return status.Error(codes.InvalidArgument, err.Error())
    case errors.Is(err, context.DeadlineExceeded):
        return status.Error(codes.DeadlineExceeded, err.Error())
    default:
        return status.Error(codes.Internal, err.Error())
    }
}
```

Don't leak internal error chains to gRPC — security risk. Sanitize.

### HTTP

```go
func toHTTP(err error, w http.ResponseWriter) {
    switch {
    case errors.Is(err, ErrNotFound):
        http.Error(w, "Not Found", http.StatusNotFound)
    case errors.Is(err, ErrValidation):
        http.Error(w, "Bad Request", http.StatusBadRequest)
    default:
        log.Error("internal", "err", err)
        http.Error(w, "Internal Server Error", http.StatusInternalServerError)
    }
}
```

User sees a sanitised message; logs have the full chain.

### Cross-service Go-to-Go

Even between two Go services, errors don't travel as Go errors over the wire. You serialise them as strings or structured data and reconstruct at the other end. Sentinels and types must be redefined per-service.

Standard approach: send error code + message:

```go
type APIError struct {
    Code    string `json:"code"`
    Message string `json:"message"`
}
```

Receiver maps code back to sentinel:

```go
func fromAPI(ae *APIError) error {
    switch ae.Code {
    case "NOT_FOUND":
        return fmt.Errorf("%s: %w", ae.Message, ErrNotFound)
    default:
        return errors.New(ae.Message)
    }
}
```

Tedious but necessary. The error contract crosses the wire as data, not as Go types.

---

## Extended Section: Performance Tuning Stories

A few illustrative numbers from real systems.

### errgroup overhead

`errgroup.WithContext` allocates ~200 bytes. `g.Go` adds ~50 bytes. `g.Wait` is essentially free.

For a pipeline with three stages, total overhead is sub-microsecond. Don't worry about it.

### Goroutine creation cost

A fresh goroutine costs ~1.5 µs of CPU. Spawning 100k goroutines is 150 ms. With `SetLimit(N)`, you spawn N goroutines and reuse — overhead is amortised.

### Channel send/receive

Unbuffered channel send/receive: ~50 ns each. Buffered with available capacity: ~20 ns. Buffered when blocked: ~100 ns due to scheduling.

For pipelines processing 1M items/sec, channels are about 20% of CPU. Use them; don't agonise.

### Mutex vs atomic vs channel

- Atomic.Add: ~5 ns.
- Mutex Lock/Unlock (uncontended): ~30 ns.
- Channel send/recv: ~50 ns.
- Mutex Lock/Unlock (contended, microbenchmark): ~500 ns to 50 µs.

Use atomic for simple counters. Mutex for short critical sections. Channels for handoff or signalling.

### Memory model fence cost

Atomic operations include implicit memory fences. On x86, this is essentially free; on ARM, more expensive. Not usually pipeline-relevant.

---

## Extended Section: Maintaining a Pipeline Over Time

Pipelines evolve. Stages get added, changed, removed. How to do this safely.

### Adding a stage

Append it after existing stages. Test in isolation. Roll out with feature flag to enable for a subset of traffic. Monitor.

### Removing a stage

Mark it as a no-op first. Roll out. Wait. Once you're confident no traffic depends on it, remove the code.

### Changing a stage

Hard. Best approach: add a new stage with new behaviour; have both run in parallel briefly; switch traffic; remove the old.

### Changing the error API

Adding a new sentinel: non-breaking (unless callers have exhaustive switches).
Removing a sentinel: breaking. Deprecate first, give callers time.
Adding fields to a typed error: non-breaking (new field is zero-valued for old callers).
Renaming: always breaking.

Document the error API like any public API.

### Refactoring

When stages get too long:

1. Extract helpers (private functions called by the stage).
2. Split into two stages with a channel between.
3. Move logic into a separate package.

Refactor incrementally. Every commit should leave the pipeline working.

---

## Extended Section: Anti-Patterns at Senior Level

Senior-level anti-patterns are subtler than junior ones.

### Anti-pattern: Premature sagas

Not every pipeline needs a saga. If side effects are within a single DB, use a transaction. Sagas add complexity; reserve for cross-service or non-transactional side effects.

### Anti-pattern: Aggregation when first-error suffices

"Let's aggregate all errors" sounds thorough, but if callers only act on the first one, the aggregation is wasted code. Match design to use case.

### Anti-pattern: Manual coordination instead of errgroup

```go
errCh := make(chan error, 5)
for i := 0; i < 5; i++ {
    go func() { errCh <- work() }()
}
var firstErr error
for i := 0; i < 5; i++ {
    if err := <-errCh; firstErr == nil && err != nil {
        firstErr = err
    }
}
return firstErr
```

Reimplements errgroup, badly (no cancellation, no SetLimit). Use the library.

### Anti-pattern: Recovery that hides bugs

```go
defer func() {
    if r := recover(); r != nil {
        log.Println("recovered:", r)
    }
}()
```

The function continues as if nothing happened. The bug is silenced. Recovery should convert panic to error and return it.

### Anti-pattern: Cross-cutting via globals

```go
var globalRetryBudget = NewBudget()
```

Now everyone shares one budget. Tests can't isolate. Two pipelines interfere. Inject dependencies; avoid globals.

---

## Extended Section: Code Review Checklist

When reviewing pipeline code:

- [ ] `errgroup.WithContext` used (not bare `errgroup.Group{}`).
- [ ] Every output channel is closed by exactly one goroutine.
- [ ] Every send is `select`'d against `ctx.Done()`.
- [ ] `db.Query`/`http.Do`/etc. receive `ctx`.
- [ ] Errors wrapped with `%w` at every boundary.
- [ ] `errors.Is`/`errors.As` used, not `==`.
- [ ] Sentinels and typed errors documented.
- [ ] `defer` for resource cleanup.
- [ ] No bare `go` in `g.Go` functions.
- [ ] `SetLimit` if fan-out can be large.
- [ ] Retry with backoff and jitter.
- [ ] Compensating actions for stages with side effects.
- [ ] Panic recovery at goroutine boundaries.
- [ ] Tests cover happy path, cancellation, retry, partial failure.
- [ ] Metrics and logs for every error.

This is a senior-level review. Each item is a known bug class.

---

## Extended Section: When to Build vs Buy

Many pipeline patterns are available as libraries or services:

- **Workflow engines**: Temporal, Cadence, AWS Step Functions. Use when sagas are complex or cross-service.
- **Message queues**: Kafka, RabbitMQ, SQS. Use for async durable processing.
- **Stream processors**: Flink, Kafka Streams. Use for high-volume event processing.
- **Task queues**: Asynq, Sidekiq, Celery. Use for background job processing.

For most internal pipelines, plain Go + errgroup is fine. Reach for these tools when:

- Pipelines exceed a few hours.
- State must survive crashes.
- Workflows cross services.
- Operational burden of custom code outweighs library complexity.

A common arc: start with errgroup. Outgrow it. Move to a workflow engine. The transition is the hard part — design for it.

---

## Final Senior-Level Wisdom

A few principles after years of building pipelines:

1. **Make failure a first-class citizen of the design**, not an afterthought.
2. **Idempotency is non-negotiable** for anything with side effects.
3. **Observe everything**: metrics, logs, traces. You can't debug what you can't see.
4. **Test failure paths exhaustively**. Happy-path tests are necessary but insufficient.
5. **Bound everything**: parallelism, retries, queue depth. Unbounded systems blow up.
6. **Simple beats clever**. A 10-line errgroup pipeline you can debug at 3 AM beats a 100-line bespoke coordinator.
7. **Document the error API**. Future you will thank present you.

The day you stop adding features and start adding tests is the day your pipeline becomes production-ready.

---

## Worked Example: Full Pipeline With Every Senior Concept

A unified example tying everything together. The task: a payment processing pipeline that validates, charges, allocates inventory, ships, and notifies. Each step has a compensator. The whole flow is wrapped in a saga. Errors are aggregated. Panics are recovered. Everything is observable.

```go
package payment

import (
    "context"
    "errors"
    "fmt"
    "runtime"
    "sync"
    "time"

    "golang.org/x/sync/errgroup"
)

// Errors as a package-level vocabulary.
var (
    ErrInvalidOrder   = errors.New("invalid order")
    ErrPaymentDeclined = errors.New("payment declined")
    ErrInventoryShort = errors.New("inventory short")
    ErrShippingDown   = errors.New("shipping system down")
    ErrTransient      = errors.New("transient")
    ErrPermanent      = errors.New("permanent")
)

// Typed error for stage attribution.
type StageError struct {
    Stage string
    Err   error
}

func (e *StageError) Error() string { return e.Stage + ": " + e.Err.Error() }
func (e *StageError) Unwrap() error { return e.Err }

// Order is the input.
type Order struct {
    ID       string
    UserID   string
    Items    []LineItem
    Total    int64
}

type LineItem struct {
    SKU      string
    Quantity int
}

// Result is the output.
type Result struct {
    OrderID    string
    Status     string
    PaymentID  string
    ShipmentID string
}

// Dependencies are injected.
type Deps struct {
    Validator  Validator
    Payments   PaymentClient
    Inventory  InventoryClient
    Shipping   ShippingClient
    Notifier   NotifierClient
    Store      SagaStore
    Logger     Logger
    Metrics    Metrics
}

// Pipeline processes an order through the pipeline with full saga semantics.
type Pipeline struct {
    deps Deps
}

func New(deps Deps) *Pipeline {
    return &Pipeline{deps: deps}
}

// Process runs the pipeline for one order.
func (p *Pipeline) Process(ctx context.Context, order Order) (*Result, error) {
    // Wrap entire process in panic recovery.
    var result *Result
    var processErr error
    func() {
        defer func() {
            if r := recover(); r != nil {
                buf := make([]byte, 1<<16)
                n := runtime.Stack(buf, false)
                processErr = fmt.Errorf("panic: %v\n%s", r, buf[:n])
                p.deps.Logger.Error("pipeline panic", "order", order.ID, "panic", r)
            }
        }()
        result, processErr = p.processInternal(ctx, order)
    }()
    return result, processErr
}

func (p *Pipeline) processInternal(ctx context.Context, order Order) (*Result, error) {
    p.deps.Metrics.OrderStarted(order.ID)
    defer p.deps.Metrics.OrderFinished(order.ID)

    saga := &Saga{
        ID:    order.ID,
        Store: p.deps.Store,
        Logger: p.deps.Logger,
        Steps: []Step{
            {
                Name: "validate",
                Forward: func(ctx context.Context) error {
                    return p.validate(ctx, order)
                },
                Compensate: func(ctx context.Context) error { return nil }, // no-op
            },
            {
                Name: "charge",
                Forward: func(ctx context.Context) error {
                    paymentID, err := p.chargeWithRetry(ctx, order, 3)
                    if err != nil { return err }
                    saga.Set("paymentID", paymentID)
                    return nil
                },
                Compensate: func(ctx context.Context) error {
                    paymentID, ok := saga.Get("paymentID").(string)
                    if !ok || paymentID == "" { return nil }
                    return p.deps.Payments.Refund(ctx, paymentID)
                },
            },
            {
                Name: "allocate",
                Forward: func(ctx context.Context) error {
                    return p.allocateAllItems(ctx, order)
                },
                Compensate: func(ctx context.Context) error {
                    return p.releaseAllItems(ctx, order)
                },
            },
            {
                Name: "ship",
                Forward: func(ctx context.Context) error {
                    shipmentID, err := p.shipWithRetry(ctx, order, 3)
                    if err != nil { return err }
                    saga.Set("shipmentID", shipmentID)
                    return nil
                },
                Compensate: func(ctx context.Context) error {
                    shipmentID, ok := saga.Get("shipmentID").(string)
                    if !ok || shipmentID == "" { return nil }
                    return p.deps.Shipping.Cancel(ctx, shipmentID)
                },
            },
            {
                Name: "notify",
                Forward: func(ctx context.Context) error {
                    return p.deps.Notifier.Send(ctx, order.UserID, "Order shipped: "+order.ID)
                },
                Compensate: func(ctx context.Context) error { return nil }, // cannot unsend email
            },
        },
    }

    if err := saga.Run(ctx); err != nil {
        return nil, fmt.Errorf("saga: %w", err)
    }

    return &Result{
        OrderID:    order.ID,
        Status:     "shipped",
        PaymentID:  saga.Get("paymentID").(string),
        ShipmentID: saga.Get("shipmentID").(string),
    }, nil
}

func (p *Pipeline) validate(ctx context.Context, order Order) error {
    if err := p.deps.Validator.Validate(ctx, order); err != nil {
        return fmt.Errorf("%w: %v", ErrInvalidOrder, err)
    }
    return nil
}

func (p *Pipeline) chargeWithRetry(ctx context.Context, order Order, maxAttempts int) (string, error) {
    var lastErr error
    for attempt := 0; attempt < maxAttempts; attempt++ {
        pid, err := p.deps.Payments.Charge(ctx, order.UserID, order.Total, "order-"+order.ID)
        if err == nil { return pid, nil }
        if errors.Is(err, ErrPaymentDeclined) {
            return "", err // permanent; don't retry
        }
        lastErr = err
        wait := time.Duration(1<<attempt) * 200 * time.Millisecond
        select {
        case <-ctx.Done(): return "", ctx.Err()
        case <-time.After(wait):
        }
    }
    return "", fmt.Errorf("charge after %d attempts: %w", maxAttempts, lastErr)
}

func (p *Pipeline) allocateAllItems(ctx context.Context, order Order) error {
    g, ctx := errgroup.WithContext(ctx)
    g.SetLimit(runtime.NumCPU())
    var failures []error
    var mu sync.Mutex

    for _, item := range order.Items {
        item := item
        g.Go(func() error {
            err := p.deps.Inventory.Allocate(ctx, item.SKU, item.Quantity)
            if err != nil {
                mu.Lock()
                failures = append(failures, fmt.Errorf("allocate %s: %w", item.SKU, err))
                mu.Unlock()
                return nil // collect, don't fail-fast
            }
            return nil
        })
    }
    _ = g.Wait()
    if len(failures) > 0 {
        return fmt.Errorf("%w: %w", ErrInventoryShort, errors.Join(failures...))
    }
    return nil
}

func (p *Pipeline) releaseAllItems(ctx context.Context, order Order) error {
    var errs []error
    for _, item := range order.Items {
        if err := p.deps.Inventory.Release(ctx, item.SKU, item.Quantity); err != nil {
            errs = append(errs, fmt.Errorf("release %s: %w", item.SKU, err))
        }
    }
    return errors.Join(errs...)
}

func (p *Pipeline) shipWithRetry(ctx context.Context, order Order, maxAttempts int) (string, error) {
    var lastErr error
    for attempt := 0; attempt < maxAttempts; attempt++ {
        sid, err := p.deps.Shipping.Create(ctx, order)
        if err == nil { return sid, nil }
        if !errors.Is(err, ErrTransient) {
            return "", fmt.Errorf("ship: %w", err)
        }
        lastErr = err
        wait := time.Duration(1<<attempt) * 500 * time.Millisecond
        select {
        case <-ctx.Done(): return "", ctx.Err()
        case <-time.After(wait):
        }
    }
    return "", fmt.Errorf("ship after %d attempts: %w", maxAttempts, lastErr)
}
```

The saga implementation (sketched, complete saga code from earlier section):

```go
type Step struct {
    Name       string
    Forward    func(ctx context.Context) error
    Compensate func(ctx context.Context) error
}

type Saga struct {
    ID     string
    Store  SagaStore
    Logger Logger
    Steps  []Step
    state  map[string]any
    mu     sync.Mutex
}

func (s *Saga) Set(k string, v any) {
    s.mu.Lock()
    defer s.mu.Unlock()
    if s.state == nil { s.state = map[string]any{} }
    s.state[k] = v
}

func (s *Saga) Get(k string) any {
    s.mu.Lock()
    defer s.mu.Unlock()
    return s.state[k]
}

func (s *Saga) Run(ctx context.Context) error {
    var completed []int
    for i, step := range s.Steps {
        s.Logger.Info("saga step", "id", s.ID, "step", step.Name)
        if err := step.Forward(ctx); err != nil {
            s.Logger.Error("saga step failed", "id", s.ID, "step", step.Name, "err", err)
            // rollback
            rollbackCtx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
            defer cancel()
            var compErrs []error
            for j := len(completed) - 1; j >= 0; j-- {
                cstep := s.Steps[completed[j]]
                if cerr := cstep.Compensate(rollbackCtx); cerr != nil {
                    compErrs = append(compErrs, fmt.Errorf("compensate %s: %w", cstep.Name, cerr))
                }
            }
            if len(compErrs) > 0 {
                return fmt.Errorf("saga failed (%w) and rollback errors: %w",
                    err, errors.Join(compErrs...))
            }
            return fmt.Errorf("saga rolled back: %w", err)
        }
        completed = append(completed, i)
    }
    return nil
}
```

This is a senior-quality pipeline. Every concept covered earlier is in here: errgroup, sentinels, typed errors, retry, aggregation, sagas, compensating actions, panic recovery, observability hooks. About 250 lines of production code; the rest is dependencies and types.

Read it three times. Understand each piece. Then try to write it from memory. That exercise will solidify everything.

---

## Recap of Patterns by Phase

| Phase | Key patterns | Tools |
|-------|------------|-------|
| Setup | Dependency injection, options | Struct + functional options |
| Validation | Sentinel errors | `errors.New`, `errors.Is` |
| Parallel work | Errgroup + SetLimit | `golang.org/x/sync/errgroup` |
| Retry | Backoff + jitter + budget | `time.After`, `rand` |
| Aggregation | `errors.Join` + mutex | `sync.Mutex` |
| Side effects | Sagas + compensators | Custom saga lib or Temporal |
| Safety | Panic recovery | `defer recover` |
| Observability | Logs + metrics + tracing | structured logging, OpenTelemetry |

A pipeline using all these is dense but readable, and recovers gracefully from a wide range of failures.

---

## Looking Ahead

At professional level we'll cover:

- Pipelines in distributed systems (cross-service error propagation).
- Cost models of structured concurrency (when is the overhead worth it?).
- Idempotency budgets and exactly-once approximations.
- Designing error contracts for cross-team services.
- Backpressure and flow control beyond pipelines.

For now, internalise what's here. Senior-level pipeline design is the foundation for distributed-system design. Get it right at this scale before scaling further.

---

## Deep Dive: Diagnosing a Stuck Pipeline in Production

A scenario: at 2:14 AM, alerts fire. The pipeline has stopped producing output. The queue depth is growing. You SSH in.

### Step 1: Verify the process is alive

```bash
ps aux | grep mypipeline
```

If the process is dead, restart and investigate logs.

### Step 2: Check goroutine count

```bash
curl http://localhost:6060/debug/pprof/goroutine?debug=1 | head -50
```

A normal pipeline has dozens of goroutines. If you see thousands, it's leaking. If you see 5 (when it should be 30), workers are exiting.

### Step 3: Read the goroutine dump

```bash
curl http://localhost:6060/debug/pprof/goroutine?debug=2 > goroutines.txt
```

Search for groups of goroutines stuck in the same state:

```bash
grep -A 5 "chan send" goroutines.txt | head -100
grep -A 5 "chan receive" goroutines.txt | head -100
```

Look for:

- Many goroutines blocked on `chan send`: a consumer stopped reading.
- Many on `chan receive`: a producer stopped writing or didn't close.
- A goroutine blocked on `sync.Cond.Wait`: a notification never fired.
- A goroutine blocked on `runtime.gopark` with no clear reason: deadlock.

### Step 4: Check metrics

```bash
curl http://localhost:6060/metrics | grep pipeline
```

Look for:

- `pipeline_active_stages` not zero but `pipeline_completions` flat.
- Error rate spiking.
- Specific stage taking far longer than usual.

### Step 5: Inspect external dependencies

The pipeline may be waiting on a downed dependency:

```bash
nc -zv db-host 5432
nc -zv api-host 443
```

If a dependency is unreachable, the pipeline is doing the right thing by waiting (assuming `ctx` has a deadline).

### Step 6: Force a goroutine dump for postmortem

```bash
kill -QUIT $PID > goroutines.txt
```

(Assuming the process has a SIGQUIT handler that dumps stacks. If not, use pprof.)

Save for later analysis.

### Step 7: Decide: rollback or wait

- If a dependency is recovering, give it time.
- If the pipeline is leaking and unrecoverable, restart.
- If you can't tell, capture diagnostics, wait, escalate.

This procedure scales. Practice it in staging so you're not learning at 2 AM.

---

## Deep Dive: Backfill Pipelines

A common production task: backfill data when a schema changes or a bug requires reprocessing.

### Characteristics

- Single-run (not continuous).
- Large dataset (millions of items).
- May take hours.
- Must be resumable on crash.
- Must not impact live traffic.

### Pattern: Checkpointed backfill

```go
type Backfill struct {
    ID         string
    Cursor     int64
    Total      int64
    Started    time.Time
    Last       time.Time
    Status     string // running, paused, completed, failed
    LastError  string
}

func (b *Backfill) Run(ctx context.Context, batchSize int, processor func([]Row) error) error {
    for {
        if err := ctx.Err(); err != nil { return err }

        rows, err := loadBatch(ctx, b.Cursor, batchSize)
        if err != nil { return fmt.Errorf("load: %w", err) }
        if len(rows) == 0 { break }

        if err := processor(rows); err != nil {
            b.LastError = err.Error()
            saveBackfill(ctx, b)
            return err
        }

        b.Cursor = rows[len(rows)-1].ID
        b.Last = time.Now()
        if err := saveBackfill(ctx, b); err != nil {
            return fmt.Errorf("save cursor: %w", err)
        }

        // throttle to not impact live traffic
        time.Sleep(10 * time.Millisecond)
    }
    b.Status = "completed"
    return saveBackfill(ctx, b)
}
```

Each batch processed, cursor saved. On crash, reload `b` and resume.

### Pattern: Parallel backfill

```go
func runParallel(ctx context.Context, b *Backfill, workers int, processor func([]Row) error) error {
    g, ctx := errgroup.WithContext(ctx)
    g.SetLimit(workers)

    cursorCh := make(chan int64, workers*2)
    g.Go(func() error {
        defer close(cursorCh)
        for {
            select {
            case <-ctx.Done(): return ctx.Err()
            case cursorCh <- nextCursor():
            }
        }
    })

    for i := 0; i < workers; i++ {
        g.Go(func() error {
            for cursor := range cursorCh {
                rows, err := loadBatchAt(ctx, cursor)
                if err != nil { return err }
                if err := processor(rows); err != nil { return err }
            }
            return nil
        })
    }
    return g.Wait()
}
```

Workers pull cursors independently. Each cursor is a batch range. Coordination via the cursor channel.

For checkpointing, you need to track which ranges have been processed. A bitmap or "completed_ranges" table works.

### Pattern: Throttled backfill

```go
limiter := rate.NewLimiter(rate.Limit(100), 100) // 100 RPS to backend

for _, row := range rows {
    if err := limiter.Wait(ctx); err != nil { return err }
    if err := processOne(row); err != nil { return err }
}
```

Throttling ensures the backfill doesn't impact live traffic. Tune based on capacity.

---

## Deep Dive: Pipeline Templates

Once you've written 3-4 pipelines, you'll notice patterns. Codify them.

### Template: ETL

```
extract (read source) -> transform (validate/enrich) -> load (write destination)
```

The standard ETL. Use errgroup, fan-out in transform if CPU-bound, bounded parallelism in load.

### Template: Fetch-and-store

```
list (enumerate sources) -> fetch (parallel HTTP) -> store (DB)
```

Common for crawlers and integrations. Fetch is the heavy stage; bounded parallelism is essential.

### Template: Stream processor

```
consume (queue) -> transform -> route (multiple destinations)
```

Stateful or stateless. For stateful, persist state per consumer group.

### Template: Saga

```
step1 -> step2 -> ... -> stepN, each with compensator
```

For multi-step processes with side effects.

### Template: Fan-out delivery

```
event -> N subscribers, each receiving and processing independently
```

Webhook fan-out, notification systems. Per-subscriber retry, DLQ on permanent failure.

Each template has a known shape and known error patterns. Recognising the template is the first step in design.

---

## Deep Dive: When Pipelines Don't Fit

Not every problem is a pipeline. Some signs you're forcing the wrong shape:

- **The data has no natural flow direction.** If items can be processed in any order with no dependencies, you don't need a pipeline — you need a worker pool.
- **Stages are too uneven.** If stage 2 takes 100x longer than stage 1, you have a bottleneck and the pipeline shape doesn't help — you need to scale stage 2 differently.
- **Stages share state.** Pipelines work best when each stage is stateless and data flows through. Shared mutable state breaks the model.
- **Error handling needs cross-stage coordination.** "On step 3 failure, rerun step 2" is not pipeline-shaped; it's a state machine.

Use the right tool. A pipeline isn't always it.

---

## Deep Dive: Cross-Cutting Concerns

In senior-level pipeline design, cross-cutting concerns recur:

### Authentication and authorization

A pipeline acting on behalf of a user must propagate that identity. Context value:

```go
type userKey struct{}

func WithUser(ctx context.Context, user User) context.Context {
    return context.WithValue(ctx, userKey{}, user)
}

func UserFrom(ctx context.Context) (User, bool) {
    u, ok := ctx.Value(userKey{}).(User)
    return u, ok
}
```

Stages that perform sensitive ops check authorization:

```go
if u, ok := UserFrom(ctx); !ok || !u.HasPermission("write") {
    return ErrForbidden
}
```

### Tenancy

Multi-tenant pipelines must isolate. Pass tenant ID via context, use it for routing, rate limiting, bulkheads.

### Quotas

Per-tenant or per-pipeline quotas:

```go
if !quota.TryConsume(tenant, 1) {
    return ErrQuotaExceeded
}
```

### Auditing

Every action logged with structured context:

```go
audit.Log("payment.charged", map[string]any{
    "user": userID,
    "amount": amount,
    "saga": sagaID,
})
```

Auditing is *not* the same as logging. Audit logs go to an append-only store. Used for compliance and incident response.

### PII handling

Avoid PII in logs. If it must be there, redact:

```go
log.Info("user processed", "user_id", hash(userID))
```

Encryption at rest for stored errors. TLS in transit.

---

## Deep Dive: The Pipeline as a Service

Some pipelines become services with public APIs. Considerations:

### Rate limiting at ingress

Don't accept more work than you can handle. Reject excess at the door:

```go
if !ingressLimiter.Allow() {
    return ErrRateLimited
}
```

Communicates backpressure to clients.

### Request validation

Validate inputs before queuing. Don't fill the queue with garbage:

```go
if err := req.Validate(); err != nil {
    return fmt.Errorf("invalid request: %w", err)
}
```

### Idempotency keys

Public APIs benefit from explicit idempotency:

```go
type Request struct {
    IdempotencyKey string
    Payload        []byte
}
```

Clients can safely retry. Server dedupes.

### Webhooks for completion

For long pipelines, don't make clients poll. Webhook back:

```go
func (p *Pipeline) ProcessAsync(ctx context.Context, req Request, webhook string) error {
    go func() {
        result := p.Process(ctx, req)
        notify(webhook, result)
    }()
    return nil
}
```

Standard cloud service pattern. Avoid goroutine leaks: use a tracked worker pool or job queue, not bare `go`.

### Versioning

Public APIs evolve. Version them:

```
POST /v1/pipeline/run
POST /v2/pipeline/run
```

Keep v1 working while v2 rolls out. Deprecate eventually.

---

## Deep Dive: Lessons From Production Outages

Five outages worth remembering.

### Outage 1: The cascading queue

A queue consumer pipeline had a bug: a poison message caused the consumer to crash. Kubernetes restarted it. It picked up the same poison message. Crashed. Restarted. Crashed.

Fix: catch the panic, DLQ the message, continue.

Lesson: panics in stream consumers are normally rare but catastrophic. Always recover.

### Outage 2: The retry storm

A pipeline retried every transient failure 10 times with no jitter. A brief upstream blip caused all in-flight items to enter retry. The next attempt window saw 10,000 requests. Upstream went down harder.

Fix: add jitter. Add circuit breaker.

Lesson: synchronised retries amplify failures.

### Outage 3: The cancellation that never came

A pipeline's stages didn't honor `ctx.Done()`. On shutdown, they kept running. New deploys had stale state from old runs.

Fix: audit every blocking call. Use linters.

Lesson: cancellation is everyone's job.

### Outage 4: The unbounded queue

A pipeline accepted work into an unbounded queue. Faster ingress, slower processing. Queue grew. Memory grew. OOM killed the process.

Fix: bound the queue. Reject when full.

Lesson: every queue has bounds, even when implicit.

### Outage 5: The lost error

A pipeline aggregated errors into a slice but returned only the first one to the metrics system. A new failure mode emerged but was masked by the dominant existing failure mode.

Fix: emit metrics per error category, not just per overall outcome.

Lesson: observability granularity matters.

---

## Closing Note

This file is long because the topic is. Production pipelines are concurrent systems with side effects, error propagation, observability, and a finite operational budget. Every detail matters. Skipping any of them is a hidden bug.

If you've read this far, you have the foundation. The rest is practice. Build pipelines. Audit them. Watch them fail. Fix the failures. Iterate.

Senior engineers are made by the bugs they've debugged at 3 AM.

---

## Appendix: A Long Quiz

Test yourself on these. No looking.

1. A pipeline uses `errgroup.WithContext`. Stage A returns an error wrapping `ErrInvalid`. Stage B is mid-`select` on `out <- v` and `<-ctx.Done()`. What happens?

2. You call `g.Wait()` and get `context.Canceled`. The parent context was not cancelled. What probably happened inside the pipeline?

3. A typed error `*StageError` implements `Unwrap`. The error has been wrapped three times. Does `errors.As(err, &se)` find it?

4. Two goroutines panic simultaneously. The second's panic message is logged by your `recover` wrapper. Is the first's panic also logged?

5. `g.SetLimit(2)` is called after `g.Go`. What happens?

6. You return `nil` from every `g.Go` despite per-item failures. How do you signal failure to the caller?

7. A compensator's first attempt fails. The saga retries. The compensator succeeds. Is the data in a consistent state?

8. A stage writes to `result[i]` where each `i` is unique. After `g.Wait`, you read `result`. Is this safe? Why?

9. A pipeline's "fast" stage outpaces the "slow" stage. The channel between them is unbuffered. What happens to the fast stage?

10. You use `errors.Join` to combine 1000 errors. The caller calls `errors.Is(joined, ErrSpecific)`. How many comparisons does `errors.Is` perform?

11. A panic in a `defer` inside a goroutine. The outer `recover` catches it. What's the state of the original return value?

12. The pipeline's context has a 10-second deadline. A stage's `db.Query` takes 15 seconds. What error does the pipeline return?

13. You set up tracing via context. A stage starts a span. The stage returns; the span is `End()`ed. The pipeline continues. Is the span recorded?

14. A circuit breaker is open. A goroutine calls `breaker.Call`. What's the goroutine's experience?

15. Two pipelines share a `*errgroup.Group`. One calls `Wait`. What happens?

Answers:

1. errgroup captures stage A's error, cancels derived ctx, stage B's `select` fires the `ctx.Done()` branch, B returns `ctx.Err()`, ignored. `g.Wait` returns A's wrapped `ErrInvalid`.
2. A stage's `select` on `<-ctx.Done()` fired faster than the "real" error was captured by `errOnce`. Race condition; uncommon. Or, a deeper helper caught and returned `ctx.Err()` instead of propagating the real failure.
3. Yes. `errors.As` walks the chain through every wrap.
4. The first's panic crashed the program. The recover only runs in the panicking goroutine. The second's recover runs because the second goroutine survived (barely) — but in practice the program is terminating; depending on timing, you may see neither, one, or both.
5. Panics. `SetLimit` must be called before any `Go`.
6. Return an aggregated error from the orchestrator function. Or return a `Result` struct with per-item errors and a separate top-level error indicating "some items failed."
7. Yes, if the compensator is idempotent. The second invocation should be safe regardless of the first's partial success.
8. Yes. Each goroutine writes to a unique slot — no concurrent writes to the same memory. `g.Wait` provides happens-before for the read.
9. Blocks on each send. Slow stage's pace becomes overall throughput. Backpressure.
10. Up to 1000. `errors.Is` walks every branch of the multi-unwrap.
11. If the function had `defer recover` as a named return setter, the panic in the `defer` is hidden but the variable was already set. Depends on order.
12. `context.DeadlineExceeded` wrapped through the chain.
13. Yes. The span ends with its accumulated data. The tracing SDK exports it asynchronously.
14. Receives `ErrCircuitOpen` immediately, no actual call made.
15. Allowed but odd. One pipeline's `Wait` waits for *all* goroutines from both. Then the group is consumed; the other pipeline can't `Wait` again. Don't share groups.

---

## Appendix: Glossary at Senior Level

A few terms used in this file:

- **Saga**: a long-running transaction composed of forward steps and compensating actions.
- **Compensator**: an operation that undoes a previously completed step.
- **Idempotency**: the property that an operation has the same effect on repeat as on first call.
- **DLQ**: dead-letter queue, where unprocessable items go.
- **Bulkhead**: an isolation mechanism so failure in one part doesn't affect others.
- **Circuit breaker**: a mechanism to fail fast when a dependency is failing.
- **Backpressure**: a mechanism to slow producers to match consumers.
- **At-least-once**: delivery guarantee where messages may arrive >=1 time.
- **Exactly-once**: an idealised guarantee where messages arrive exactly once. Approximated by at-least-once + dedup.
- **Saga orchestration vs choreography**: central coordinator vs event-driven.
- **Reservoir sampling**: a sampling technique with bounded memory regardless of stream size.

Knowing these terms lets you communicate with other senior engineers and read the literature.

---

## Appendix: Required Reading

For the senior-level Go engineer working on pipelines:

- "Patterns of Distributed Systems" — Unmesh Joshi (sagas, leader election, replication).
- "Designing Data-Intensive Applications" — Martin Kleppmann (consistency, fault tolerance).
- "Release It!" — Michael Nygard (stability patterns, circuit breakers, bulkheads).
- "Site Reliability Engineering" — Google (SLOs, error budgets, incident response).
- Go Memory Model spec: `go.dev/ref/mem`.
- `golang.org/x/sync/errgroup` source.
- Temporal documentation (for workflow concepts, even if you don't use Temporal).

These are the books and docs that senior Go engineers reference. Get familiar with them.

---

## Appendix: A Final Code Snippet

The simplest senior-quality pipeline that demonstrates all the patterns:

```go
func Run(ctx context.Context, items []Item, deps Deps) (*Result, error) {
    defer func() {
        if r := recover(); r != nil {
            deps.Logger.Error("panic", "value", r)
        }
    }()

    g, ctx := errgroup.WithContext(ctx)
    g.SetLimit(deps.Workers)

    var (
        results = make([]ItemResult, len(items))
        errs    []error
        mu      sync.Mutex
    )

    for i, it := range items {
        i, it := i, it
        g.Go(func() error {
            r, err := processWithRetry(ctx, it, deps, 3)
            results[i] = ItemResult{Item: it, Result: r, Err: err}
            if err != nil && !errors.Is(err, ErrSkip) {
                mu.Lock()
                errs = append(errs, fmt.Errorf("%s: %w", it.ID, err))
                mu.Unlock()
            }
            return nil
        })
    }

    if err := g.Wait(); err != nil {
        return &Result{Items: results}, err
    }
    if len(errs) > 0 {
        return &Result{Items: results}, errors.Join(errs...)
    }
    return &Result{Items: results}, nil
}
```

20 lines. Recovers panics. Bounded parallelism. Per-item retry. Aggregation. Sentinel for skip. Caller gets both successful and failed items.

This is the shape to aim for. Everything else is decoration.

---

That's senior level. Read `professional.md` next for distributed-system perspectives.
