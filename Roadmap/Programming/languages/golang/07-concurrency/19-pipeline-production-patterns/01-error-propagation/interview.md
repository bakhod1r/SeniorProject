---
layout: default
title: Interview
parent: Error Propagation
grand_parent: Pipeline Production Patterns
ancestor: Go
nav_order: 7
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/19-pipeline-production-patterns/01-error-propagation/interview/
---

# Error Propagation in Pipelines — Interview Questions

> Questions and model answers from junior to staff level. Each has a model answer, common wrong answers, and follow-up probes.

---

## Junior

### Q1. What is `errgroup.Group` and why use it?

**Model answer.** `errgroup.Group` is a coordination primitive from `golang.org/x/sync/errgroup` that combines `sync.WaitGroup` with first-error capture and (with `WithContext`) automatic context cancellation. It is the idiomatic Go pattern for running multiple goroutines that may fail.

Compared to rolling your own with a `WaitGroup`, an error variable, and a mutex, `errgroup` is shorter, race-free, and well-tested.

**Common wrong answers.**
- "It's the same as `sync.WaitGroup`." (No — it adds error capture and cancellation.)
- "It catches panics." (No — panics still crash the program.)

**Follow-up.** *What does `errgroup.WithContext` give you beyond `Group{}`?* — The derived context is cancelled when the first error is captured. Bare `Group{}` does not cancel on error.

---

### Q2. What does this print, if anything?

```go
func main() {
    g, ctx := errgroup.WithContext(context.Background())
    g.Go(func() error {
        return errors.New("first")
    })
    g.Go(func() error {
        select {
        case <-ctx.Done():
            return ctx.Err()
        case <-time.After(time.Second):
            return errors.New("second")
        }
    })
    err := g.Wait()
    fmt.Println(err)
}
```

**Model answer.** It prints `first`. The first goroutine returns immediately. errgroup captures `first` and cancels `ctx`. The second goroutine's `select` fires on `<-ctx.Done()`, returns `context.Canceled` — but errgroup ignores it (first-error wins). `Wait` returns `first`.

**Follow-up.** *Could the order be different?* — Only if the second goroutine started before the first finished and was about to return `errors.New("second")`. Race semantics; in practice, the first error wins.

---

### Q3. Why wrap errors with `%w`?

**Model answer.** `%w` preserves the wrapped error so callers can use `errors.Is` and `errors.As` to identify it through the wrap chain. Without `%w`, the original error becomes only a string, and identification requires string matching.

**Common wrong answers.**
- "It makes errors longer." (Length isn't the point.)
- "It's faster." (Performance is similar to `%v`.)

**Follow-up.** *What's the difference between `%w` and `%v`?* — `%w` preserves the chain; `%v` formats as string. Use `%w` when callers might want to match the underlying error.

---

### Q4. What's wrong with this pipeline?

```go
func run(ctx context.Context, items []Item) error {
    out := make(chan Item)
    go func() {
        for _, it := range items {
            out <- it
        }
    }()
    for v := range out {
        process(v)
    }
    return nil
}
```

**Model answer.** Multiple issues:
1. No `close(out)` — the `for range` never exits.
2. No cancellation — the producer ignores `ctx.Done()`.
3. No error handling — `process(v)` may fail; we ignore.
4. No `WaitGroup` — if `process` panics, the goroutine is lost.

The fix uses `errgroup`, `defer close(out)`, and `select` on `ctx.Done()`.

---

### Q5. When does `g.Wait()` return?

**Model answer.** When every goroutine spawned via `g.Go` has returned. It returns the first non-nil error (or nil if all succeeded).

**Follow-up.** *What if a goroutine never returns?* — `Wait` blocks forever. This is why every blocking operation in a stage must honor `ctx.Done()`.

---

### Q6. Write a three-stage pipeline that doubles numbers.

**Model answer.**

```go
func run(ctx context.Context, nums []int) ([]int, error) {
    g, ctx := errgroup.WithContext(ctx)
    in := make(chan int)
    doubled := make(chan int)

    g.Go(func() error {
        defer close(in)
        for _, n := range nums {
            select {
            case <-ctx.Done(): return ctx.Err()
            case in <- n:
            }
        }
        return nil
    })

    g.Go(func() error {
        defer close(doubled)
        for n := range in {
            select {
            case <-ctx.Done(): return ctx.Err()
            case doubled <- n * 2:
            }
        }
        return nil
    })

    var result []int
    g.Go(func() error {
        for v := range doubled {
            result = append(result, v)
        }
        return nil
    })

    if err := g.Wait(); err != nil { return nil, err }
    return result, nil
}
```

Key points: `errgroup.WithContext`, `defer close(out)` per sender, `select` on `ctx.Done()` for every send, return wrapped error, read result after `Wait`.

---

## Middle

### Q7. Compare sentinel errors and error types.

**Model answer.**
- **Sentinel**: package-level error value (`var ErrNotFound = errors.New("not found")`). Caller matches with `errors.Is`. Best for atomic, named failure conditions without associated data.
- **Error type**: a struct implementing the `error` interface. Caller extracts with `errors.As`. Best for failures that carry data (field name, status code, resource ID).

Both can coexist. Use sentinels for "did X happen?" and types for "X happened with these details."

**Follow-up.** *Can a type and a sentinel match the same error?* — Yes. A custom type can implement an `Is(target error) bool` method matching a sentinel.

---

### Q8. What does `g.SetLimit(n)` do? When is it useful?

**Model answer.** `SetLimit` caps the number of concurrent goroutines in the group at `n`. Subsequent `g.Go` calls block until a slot frees. `TryGo` is a non-blocking variant.

Use cases: bound fan-out parallelism to avoid resource exhaustion (DB connections, API rate limits, memory).

**Common wrong answers.**
- "It limits memory." (Indirectly, but it's a goroutine count cap.)
- "Goroutines past the limit are discarded." (No — they wait.)

**Follow-up.** *What happens if `SetLimit` is called after `Go`?* — Panics.

---

### Q9. How do you retry a transient error inside a pipeline?

**Model answer.** Retry *inside* the stage's goroutine, not by returning from `g.Go`. Returning would trigger errgroup's first-error cancellation. The retry pattern:

```go
g.Go(func() error {
    for attempt := 0; attempt < maxAttempts; attempt++ {
        err := op(ctx)
        if err == nil { return nil }
        if !isTransient(err) { return err }
        select {
        case <-ctx.Done(): return ctx.Err()
        case <-time.After(backoff(attempt)):
        }
    }
    return fmt.Errorf("retries exhausted")
})
```

Backoff with jitter to avoid thundering herd. Budget to avoid runaway retries.

---

### Q10. What's the difference between fan-out and fan-in? How do you implement each error-aware?

**Model answer.**
- **Fan-out**: one producer, N consumers. Each consumer is independent. Errors handled per consumer; errgroup captures the first failure.
- **Fan-in**: N producers, one consumer. Multiple sources merged into one channel.

For fan-out, a nested errgroup inside the producer stage manages the N workers. For fan-in, a coordinator waits for all producers (via `WaitGroup` or another errgroup) and closes the merged channel when all producers are done.

**Follow-up.** *Who closes the merged channel in fan-in?* — A dedicated coordinator goroutine, after all producers signal completion. Never the producers themselves (multiple closes panic).

---

### Q11. How does `errgroup.WithContext` interact with the parent context?

**Model answer.** The derived context inherits cancellation from the parent. When the parent is cancelled, the derived is cancelled too. Additionally, the derived is cancelled when the first `g.Go` function returns a non-nil error.

So the derived context is cancelled by either: parent cancellation OR group's first error.

`g.Wait` does not cancel parent. The relationship is one-way: parent → derived.

---

### Q12. Find the bug.

```go
g, ctx := errgroup.WithContext(ctx)
for _, item := range items {
    g.Go(func() error {
        return process(ctx, item)
    })
}
return g.Wait()
```

**Model answer.** The loop variable `item` is captured by reference in pre-Go 1.22 code. All goroutines see the *same* `item` — the final value of the loop. Result: most/all goroutines process the same item.

**Fix.** Shadow the variable:

```go
for _, item := range items {
    item := item // per-iteration copy
    g.Go(func() error {
        return process(ctx, item)
    })
}
```

In Go 1.22+, per-iteration scoping is the default. But explicit shadowing is safer for compatibility.

---

### Q13. Why does this leak goroutines?

```go
func fetch(ctx context.Context) ([]Result, error) {
    g, ctx := errgroup.WithContext(ctx)
    results := make([]Result, len(urls))
    for i, u := range urls {
        i, u := i, u
        g.Go(func() error {
            r, err := slow(u) // ignores ctx
            if err != nil { return err }
            results[i] = r
            return nil
        })
    }
    return results, g.Wait()
}
```

**Model answer.** `slow(u)` ignores the context. When one URL fails, errgroup cancels `ctx`, but the other `slow` calls don't notice and keep running. `g.Wait` blocks until they all return. The pipeline is stuck.

**Fix.** Make `slow` context-aware:

```go
r, err := slow(ctx, u)
```

Or, if you can't change `slow`, you have a serious leak issue. Pass timeouts explicitly.

---

## Senior

### Q14. How do you aggregate all errors instead of capturing only the first?

**Model answer.** Have each `g.Go` return `nil` (so errgroup doesn't cancel), collecting errors locally via a mutex. After `Wait`, combine with `errors.Join`:

```go
var (
    errs []error
    mu   sync.Mutex
)
g, ctx := errgroup.WithContext(ctx)
for _, it := range items {
    it := it
    g.Go(func() error {
        if err := process(ctx, it); err != nil {
            mu.Lock()
            errs = append(errs, err)
            mu.Unlock()
        }
        return nil
    })
}
_ = g.Wait()
return errors.Join(errs...)
```

**Follow-up.** *What's the trade-off?* — No fast-fail. Every item is attempted. Useful for batch processing where every item should be reported.

---

### Q15. Explain compensating actions in a saga.

**Model answer.** A saga is a multi-step process where each step has a paired compensator. On forward step failure, compensators run in reverse for steps that already succeeded. This "undoes" partial work.

Properties of a good compensator:
- Idempotent: running twice has the same effect as once.
- Handles partial state: if the forward step partially succeeded, compensator handles both cases.
- Independent of context: doesn't require ephemeral state from the forward call.

Compensators run in reverse order because later steps depend on earlier ones.

**Follow-up.** *What if a compensator fails?* — Log and continue with other compensators. Best-effort cleanup. Persist saga state so operators can intervene if needed.

---

### Q16. How do you recover panics in `g.Go` functions?

**Model answer.** Each goroutine's body wraps in a `defer recover()`:

```go
g.Go(func() (err error) {
    defer func() {
        if r := recover(); r != nil {
            buf := make([]byte, 1<<16)
            n := runtime.Stack(buf, false)
            err = fmt.Errorf("panic: %v\n%s", r, buf[:n])
        }
    }()
    return work(ctx)
})
```

Named return (`err error`) lets the deferred recover set it. Capture the stack for debugging.

**Common wrong answers.**
- "`errgroup` catches panics." (No.)
- "`recover` at the top of main works." (No — recover only catches in the same goroutine.)

**Follow-up.** *When should you not recover?* — When the panic indicates a programmer bug (nil deref, out of range). Recovery hides the bug. Reserve recovery for "we know stages can panic on bad input, and we want to convert to error."

---

### Q17. Design an error API for a public package.

**Model answer.** Three levels:

1. **Sentinels** for atomic conditions:

```go
var (
    ErrNotFound      = errors.New("not found")
    ErrAlreadyExists = errors.New("already exists")
)
```

2. **Typed errors** for failures with data:

```go
type ValidationError struct {
    Field   string
    Message string
}

func (e *ValidationError) Error() string { ... }
func (e *ValidationError) Unwrap() error { return nil } // optional
```

3. **Opaque wrapped errors** for everything else:

```go
return fmt.Errorf("internal: %w", err)
```

Document the sentinels and types in package doc. Wrap with `%w` at every boundary. Callers use `errors.Is` / `errors.As`.

---

### Q18. How do you trace errors across services?

**Model answer.** Use distributed tracing (OpenTelemetry). Each request gets a trace ID. Each service starts a span; errors are recorded on the span:

```go
ctx, span := tracer.Start(ctx, "operation")
defer span.End()

err := work(ctx)
if err != nil {
    span.RecordError(err)
    span.SetStatus(codes.Error, err.Error())
}
```

In the tracing UI, you see the request's path through services, time per service, and the error attribution.

For cross-service propagation, embed trace context in headers (W3C trace-context standard).

---

### Q19. What's the memory model guarantee that makes errgroup safe?

**Model answer.** `g.Wait()` calls `sync.WaitGroup.Wait()`. The memory model says: each `wg.Done` happens-before `wg.Wait`'s return.

Inside `g.Go`, when a goroutine returns, `wg.Done` runs (via `defer`). If the goroutine wrote to shared state (or wrote to `g.err` via `sync.Once`), those writes happen-before `Done`, which happens-before `Wait`'s return.

So reading state after `Wait` is safe — the writes are visible.

**Follow-up.** *What about reads inside the goroutines?* — Concurrent reads/writes between goroutines are races unless explicitly synchronised (atomic, mutex, channel). `g.Wait` doesn't help during the run, only after.

---

### Q20. Compare first-error and aggregation policies. When use each?

**Model answer.**

| Aspect | First-error | Aggregation |
|--------|-----------|-------------|
| Cancellation | Fast (siblings cancelled on first failure) | None (every item processed) |
| Visibility | Just one error | All errors |
| Use case | User-facing operations, atomic batches | Batch jobs, validation, reports |
| Latency | Lower on failure | Higher (waits for all) |
| Complexity | Simpler | Slightly more code |

For interactive user requests: first-error. For "tell me everything wrong with this CSV": aggregation. For "process every row and report failures": aggregation. For "process this transaction atomically": first-error.

---

## Staff / Architecture

### Q21. Walk me through designing a payments pipeline.

**Model answer.** (Long answer.) Key design points:

1. **Architecture**: per-region pipelines for compliance and latency.
2. **Stages**: validate, route to processor, charge, record, notify.
3. **Error vocabulary**: sentinels for known conditions (`ErrInsufficientFunds`, `ErrProcessorDown`); typed errors for processor-specific data.
4. **Idempotency**: per-transaction key; server dedupes.
5. **Retries**: only for transient errors, with backoff and jitter, bounded budget.
6. **Bulkheads**: per-processor worker pool to isolate failures.
7. **Circuit breakers**: per-processor, open at 50% failure rate.
8. **Saga**: for refunds (charge, allocate inventory) — Temporal workflow.
9. **Observability**: per-processor metrics, structured logs without PCI data, distributed traces.
10. **Operations**: runbooks per error category, knobs for pause/resume, replay for re-processing.

Trade-offs: explicit. Cost: significant. Why? Because payment failures cost more than redundant infrastructure.

---

### Q22. How do you migrate a saga schema?

**Model answer.** Two main approaches:

1. **Drain before deploy**: pause new saga creation; wait for in-flight to complete; deploy new code; resume. Simple but downtime.

2. **Backward compatibility**: new code reads both old and new schema. Deploy. Eventually deprecate the old format after grace period.

For long-running sagas (hours+), backward compat is essential. For short sagas (minutes), drain may work.

Persist a schema version with each saga record. Branch code on version. Migrate explicitly.

---

### Q23. How do you observe a pipeline at scale?

**Model answer.** Three pillars: metrics, logs, traces.

- **Metrics** (Prometheus, etc.): high-cardinality, low-volume. Counters per error kind, latency histograms per stage.
- **Logs** (structured, sampled): per-error, full chain. Trace IDs for correlation.
- **Traces** (OpenTelemetry): per-request span trees. Sample 100% of errors, 1% of normal.

Dashboard the critical signals: throughput, error rate, p99 latency, queue depth, circuit breaker state, DLQ size, in-flight sagas.

Alerts tied to SLOs, not raw metrics. Page on SLO burn rate, not on individual metric spikes.

---

### Q24. Why is unlimited retry dangerous?

**Model answer.** Three reasons:

1. **Resource exhaustion**: each retry uses CPU, memory, network. With unlimited retries, one failing dependency can consume all worker capacity.
2. **Cascade amplification**: a brief dependency outage causes everyone to retry. The next attempt sees N times normal load. Dependency stays down longer.
3. **Latency tail**: a slow operation kept retrying produces unbounded tail latency. User experience degrades.

Mitigations: budgets per pipeline run, per-call deadlines, circuit breakers, exponential backoff with jitter.

---

### Q25. How do you handle the "exactly-once" requirement?

**Model answer.** True exactly-once is impossible across an unreliable network (two-generals problem). Approximate via:

1. **At-least-once delivery** from the queue.
2. **Dedup table** keyed by idempotency token. Check before processing; insert atomically with the operation.
3. **Idempotent operations**: re-running has the same effect (use `ON CONFLICT DO NOTHING` etc.).

This achieves "effectively once": even if the operation is invoked multiple times, the observable effect is one operation.

Trade-offs: dedup table overhead, retention policy needed.

---

### Q26. How do you choose between in-process saga vs Temporal?

**Model answer.** Decision factors:

- **Complexity**: simple 3-step sagas → in-process. 10+ step workflows with signals → Temporal.
- **Duration**: minutes → in-process. Hours/days → Temporal.
- **Cross-service**: single service → in-process. Multi-service → Temporal.
- **Operational burden**: Temporal requires running the engine (or paying for managed). In-process uses existing DB.
- **Team expertise**: Temporal has a learning curve. In-process is just Go.

Default to in-process for simplicity. Migrate to Temporal when the complexity justifies the operational cost.

---

### Q27. Tell me about a pipeline failure you debugged.

**Model answer.** (Highly personal; here's a template.)

> Pipeline processing user uploads. One morning, queue depth started rising. By noon, processing latency went from 5 seconds to 5 minutes. No deploys.
>
> First check: dashboards. Saw queue depth growth, p99 latency growth, but error rate unchanged. So workers weren't failing — they were slow.
>
> Looked at per-stage latency. One stage (image resize) was dominant. Profiled the running process via pprof. Found a CPU hotspot in image library — recent file types triggered a slow path.
>
> Confirmed: a marketing campaign drove new file types. Each was hitting the slow path. Capacity hadn't kept up.
>
> Mitigation: scaled workers temporarily. Long-term: optimised the slow path or rejected unsupported types.
>
> Postmortem action items: monitor per-file-type latency; add capacity buffer; document file-type assumptions.

The key skills: dashboard fluency, profiling, hypothesis testing, postmortem culture.

---

### Q28. How do you design for graceful shutdown?

**Model answer.** On SIGTERM:

1. Stop accepting new work (close ingress, set readiness probe to fail).
2. Wait for in-flight work to complete (bounded time).
3. Persist state (saga checkpoints, cursor positions).
4. Exit cleanly.

```go
func (s *Service) Shutdown(ctx context.Context) error {
    s.acceptNew.Store(false)
    select {
    case <-s.idle:
        return nil
    case <-ctx.Done():
        return ctx.Err()
    }
}
```

Kubernetes gives 30 seconds by default. Plan for it. Use the time to land in-flight work, not start new.

Long-running sagas: persist state and exit. On restart, resume.

---

### Q29. How do you bound blast radius?

**Model answer.** Multiple isolation layers:

1. **Per-tenant resources**: separate worker pools, rate limits.
2. **Per-resource semaphores**: bound concurrent access to dependencies.
3. **Circuit breakers**: fail fast when dependencies are down.
4. **Bulkheads**: separate processes or pods for critical components.
5. **Region isolation**: per-region pipelines, no implicit cross-region dependencies.
6. **Canary deploys**: roll out to 1%, then 10%, observing each step.

Each layer limits how far one failure can spread. Combined, they let the system degrade gracefully instead of catastrophically.

---

### Q30. What's the most important lesson from your pipeline experience?

**Model answer.** (Personal; common ones.)

> The biggest win is making failure paths first-class. Most pipelines I've debugged failed not because the happy path was wrong, but because failure paths were untested. Spending equal effort on retry logic, cancellation propagation, error wrapping, and DLQ handling pays off over years.
>
> The second is observability discipline. A pipeline you can't see is one you can't operate. Investing in structured logs, metrics, traces, and dashboards is essential, not optional.
>
> The third is operational empathy. The engineer on call at 3 AM is often not the one who wrote the code. Runbooks, alerts, and knobs matter as much as code quality.

Be specific in your own answer. Reference real systems you've worked on.

---

## Closing notes

Interviews vary. Some focus on coding, some on design, some on debugging. Prepare for all three:

- **Coding**: implement an errgroup pipeline from scratch in 20 minutes.
- **Design**: architect a multi-stage pipeline for a given problem.
- **Debugging**: given symptoms, propose investigation steps.

For each, be concrete. Reference real APIs (`errgroup.Group`, `errors.Is`, `context.Context`). Use Go syntax fluently. Cite trade-offs explicitly.

Good answers are technical, specific, and self-aware about limitations.

---

## Sample 30-Minute Coding Question

> Implement `ParallelMap(ctx, items, fn)` that calls `fn(ctx, item)` for each item in parallel, returns the results in order, and fails on the first error.

```go
func ParallelMap[I, O any](ctx context.Context, items []I, fn func(context.Context, I) (O, error)) ([]O, error) {
    g, ctx := errgroup.WithContext(ctx)
    g.SetLimit(runtime.NumCPU())
    results := make([]O, len(items))
    for i, item := range items {
        i, item := i, item
        g.Go(func() error {
            r, err := fn(ctx, item)
            if err != nil { return fmt.Errorf("item %d: %w", i, err) }
            results[i] = r
            return nil
        })
    }
    if err := g.Wait(); err != nil { return nil, err }
    return results, nil
}
```

Discussion points:
- Why `errgroup.WithContext`? First-error + cancellation.
- Why `SetLimit`? Bounded parallelism.
- Why slice index? Result-slot pattern; lock-free.
- Why `%w`? Preserves error chain for caller to identify.
- Why generics? Type safety without sacrificing flexibility.

Be ready to explain each choice and discuss alternatives.

---

End of interview prep.
