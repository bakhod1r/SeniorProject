---
layout: default
title: Partial Cancellation — Interview
parent: Partial Cancellation
grand_parent: Cancellation Deep
ancestor: Go
nav_order: 7
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/20-cancellation-deep/02-partial-cancellation/interview/
---

# Partial Cancellation — Interview Questions

> Practice questions ranging from junior to staff-level. Each has a model answer, common wrong answers, and follow-up probes.

---

## Junior

### Q1. What is `context.WithoutCancel`?

**Model answer.** A function added in Go 1.21 that returns a context which inherits all values from its parent but is not cancelled when the parent is. Its `Done()` returns nil and `Err()` returns nil. It is used for detaching work that must outlive the originating request, such as audit logging.

**Common wrong answers.**
- "It cancels its parent." (No — it does not propagate cancellation in either direction.)
- "It creates a new root context." (No — it preserves the parent's values.)
- "It is the same as `context.Background()`." (No — `Background` has no values.)

**Follow-up.** *What version of Go added it?* Go 1.21.

---

### Q2. Why would you use `context.WithoutCancel` in a handler?

**Model answer.** When you spawn a background goroutine after the response has been sent, and the goroutine must complete even if the client disconnects. Classic examples are audit logging, metric emission, and span export. Using the request context directly would cause the goroutine to be cancelled when the client closes the connection, aborting the work mid-flight.

**Common wrong answers.**
- "To avoid context errors." (Not the right motivation.)
- "To make the handler faster." (Detaching does not speed up the handler unless the work was synchronous; that is a separate change.)

**Follow-up.** *What is the alternative?* — `context.Background()`, but it loses the trace ID, user ID, and other request values.

---

### Q3. What does `<-ctx.Done()` do on a detached context?

**Model answer.** Blocks forever. The detached context's `Done()` returns `nil`. A receive on a nil channel blocks forever. This is the intended behaviour — the detached context is never cancelled, so any code waiting for cancellation should wait indefinitely (or never bother waiting in the first place).

**Common wrong answers.**
- "Returns immediately." (No.)
- "Panics." (No — receiving on a nil channel is valid Go.)

---

### Q4. Show me a basic detached audit pattern.

**Model answer.**

```go
func handler(w http.ResponseWriter, r *http.Request) {
    // ... main work ...
    fmt.Fprintln(w, "ok")
    detached := context.WithoutCancel(r.Context())
    ctx, cancel := context.WithTimeout(detached, 5*time.Second)
    go func() {
        defer cancel()
        defer func() { if rec := recover(); rec != nil { log.Println(rec) } }()
        if err := auditWrite(ctx, event); err != nil {
            log.Printf("audit: %v", err)
        }
    }()
}
```

**Common omissions.**
- Forgetting the timeout.
- Forgetting `defer recover()`.
- Using `context.Background()` instead of `WithoutCancel`.

**Follow-up.** *Why the timeout?* — to prevent the goroutine from running forever if the downstream hangs.

---

## Middle

### Q5. How does `context.WithoutCancel` interact with `errgroup.WithContext`?

**Model answer.** `errgroup.WithContext(parent)` creates a `cancelCtx` whose cancellation propagates to all goroutines submitted via `g.Go`. A detached context bypasses this — if you pass a detached context to `g.Go`, the goroutine does not respect the errgroup's cancellation. More commonly, you detach *outside* the errgroup to run best-effort siblings that should not be cancelled by errgroup failures.

**Follow-up.** *Give an example.*

```go
g, ctx := errgroup.WithContext(parent)
g.Go(func() error { return fetchA(ctx) })
g.Go(func() error { return fetchB(ctx) })

detached := context.WithoutCancel(parent)
go bestEffortLog(detached) // not part of the errgroup

err := g.Wait()
```

---

### Q6. What happens to `singleflight.Do` if the first caller cancels?

**Model answer.** The work function in `singleflight` uses the *first caller's* context. If the first caller cancels, the work is cancelled — and all other callers waiting for the result see the cancellation error too. This is sometimes surprising. The fix is to use a detached context inside the work function:

```go
sf.Do(key, func() (any, error) {
    ctx := context.WithoutCancel(parent)
    ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
    defer cancel()
    return load(ctx, key)
})
```

Now no caller's cancellation affects the work.

---

### Q7. Should you detach inside HTTP middleware?

**Model answer.** No. Middleware that detaches the request context for the entire handler means every downstream call ignores client disconnect. The server wastes resources on requests the client has given up on. Detach only at the spawning point of a specific detached operation, not at the middleware level.

**Follow-up.** *Why is this an anti-pattern?* — Cancellation is the mechanism by which Go services back off from abandoned work. Disabling it system-wide eliminates that mechanism.

---

### Q8. How do you wait for detached goroutines at shutdown?

**Model answer.** Track them with a `sync.WaitGroup` (or a higher-level supervisor). At shutdown, wait on the wait group with a deadline:

```go
done := make(chan struct{})
go func() { wg.Wait(); close(done) }()
select {
case <-done:
    return nil
case <-shutdownCtx.Done():
    return shutdownCtx.Err()
}
```

The supervisor pattern centralises this for many detached goroutines.

---

## Senior

### Q9. Walk me through your detached pool design.

**Model answer.** A production-grade detached pool:

- Bounded worker pool (fixed number of worker goroutines).
- Bounded queue (channel with finite buffer).
- Per-operation timeout layered on a detached context.
- Panic recovery via `defer recover()`.
- Graceful drain with a deadline.
- Submission rejection during drain.
- Metrics: submissions, completions, failures, panics, queue depth.
- Logging with trace IDs.
- Trace spans linked to parents.
- Optional DLQ for terminal failures.

Each handler calls `pool.Submit(ctx, "name", fn)`. The platform handles everything else.

**Follow-up.** *What is the trade-off between in-memory pool and durable queue?* — In-memory is fast and simple but loses work on process crash. Durable queue (Kafka, SQS) ensures no loss but adds operational complexity.

---

### Q10. When do you escalate from detached pool to durable queue?

**Model answer.** When loss of the operation has business consequence. Audit rows for compliance, payment confirmations, regulatory events. These cannot tolerate "lost on process crash." Detached pools are fine for best-effort work like metrics, notifications, cache refreshes.

The decision factors:
- Criticality of the operation.
- Tolerance for loss on crash.
- Required durability.
- Operational overhead of the queue.

---

### Q11. How do you coordinate detached drain with Kubernetes terminationGracePeriodSeconds?

**Model answer.** The drain budget must be less than `terminationGracePeriodSeconds`. The drain has its own budget (say, 30 seconds); the grace period must be longer (say, 45 seconds) to allow HTTP server shutdown plus drain plus other cleanup. If detached operations can take longer than the drain budget, either reduce their timeouts or escalate to a durable queue.

**Follow-up.** *What if I have detached operations with a 60-second timeout but my grace period is 30 seconds?* — Either reduce the timeout, increase the grace period, or use a durable queue for those operations.

---

### Q12. What is the role of `Cause` in partial cancellation?

**Model answer.** `Cause` lets a cancellation carry a descriptive error beyond the generic `Canceled` or `DeadlineExceeded`. With `WithCancelCause`, callers can set a specific reason; `Cause(ctx)` retrieves it.

`Cause` does not propagate across `WithoutCancel`. The detach boundary explicitly returns nil for the `cancelCtxKey` lookup, so `Cause(detached)` is nil even if the parent had a cause. This is by design — the cause is part of the cancellation signal, which `WithoutCancel` discards.

---

## Staff

### Q13. Walk me through how `propagateCancel` works internally.

**Model answer.** `propagateCancel` is called when a new cancelCtx is created. Its job is to register the new child so that the parent's cancellation propagates to it.

Steps:
1. Store the parent reference on the new cancelCtx.
2. Check `parent.Done()`. If nil, the parent is never cancelled — return without registering.
3. Check if the parent is already cancelled. If so, cancel the child immediately.
4. Find the nearest cancelCtx ancestor via `parentCancelCtx`. If found, add the child to its children map (under mutex).
5. If the parent implements `afterFuncer`, use its `AfterFunc` method.
6. Otherwise, spawn a watcher goroutine that selects on `parent.Done()` and `child.Done()`.

For `WithCancel(WithoutCancel(parent))`, step 2 triggers: the detached context's `Done()` is nil, so the new cancelCtx is not registered with anyone. It becomes its own cancellation root.

---

### Q14. How does the value walk handle `withoutCancelCtx`?

**Model answer.** The package-level `value` function iterates through the context chain. For `withoutCancelCtx`, the iteration has a special case:

```go
case withoutCancelCtx:
    if key == &cancelCtxKey {
        return nil
    }
    c = ctx.c
```

For the `cancelCtxKey` sentinel, the walk returns nil instead of continuing. This breaks `Cause` propagation. For any other key, the walk continues to the parent, preserving value lookups.

---

### Q15. Design a custom Context type that participates in partial cancellation correctly.

**Model answer.** A custom context that wraps a parent, adds typed accessors, and supports detaching:

```go
type ServiceContext struct {
    context.Context
    Logger  *log.Logger
    Metrics *Metrics
}

func WithService(parent context.Context, l *log.Logger, m *Metrics) context.Context {
    return context.WithValue(
        context.WithValue(parent, loggerKey{}, l),
        metricsKey{}, m)
}
```

Using `WithValue` ensures that `WithoutCancel(serviceCtx)` preserves the logger and metrics. Direct struct-embedding would break type assertions; the WithValue pattern is safer.

**Follow-up.** *Why not embed directly?* — Type assertions like `if sc, ok := ctx.(ServiceContext); ok` would fail on a detached context (which is a `withoutCancelCtx`, not a `ServiceContext`).

---

### Q16. How would you migrate a codebase from ad-hoc `go func` detached work to a platform layer?

**Model answer.**

1. Audit: identify all `go func` call sites that detach.
2. Classify them by purpose (audit, metric, webhook, etc.).
3. Build a platform package with the standard pool, recovery, timeout, drain, observability.
4. Migrate one feature at a time, behind feature flags.
5. Validate behavior with metrics and tracing.
6. Add a linter to flag new ad-hoc detached work.
7. Eventually, deprecate and remove the old helpers.

Timeline: 4-8 weeks depending on size. The platform pays for itself within the first quarter.

---

### Q17. What is the relationship between `WithoutCancel`, `AfterFunc`, and structured concurrency?

**Model answer.** Structured concurrency (e.g., Loom, Kotlin's coroutines, the Go proposal for `Task`) says every concurrent operation belongs to a scope, and the scope handles its lifecycle. `WithoutCancel` is the explicit escape hatch — it says "this work escapes the parent scope." `AfterFunc` is a callback registration mechanism — orthogonal to scoping.

In a structured-concurrency model, `WithoutCancel` is the loud, visible exception. By default everything is scoped; `WithoutCancel` is the only way to break scope.

---

## Closing

These questions cover the depth of partial cancellation. A candidate who can answer junior questions clearly is probably ready. A candidate who can answer senior questions with examples has production experience. A candidate who can answer staff questions has read the source.

Adjust the questions to the seniority you are hiring for. Look for clear reasoning, not memorised answers.

---

## Additional Junior Questions

### Q18. What does `context.WithoutCancel(nil)` do?

**Model answer.** Panics with "cannot create context from nil parent". All context derivation functions panic on nil parents.

---

### Q19. Are detached contexts safe to share across goroutines?

**Model answer.** Yes. Contexts are immutable; sharing them is safe. The same applies to detached contexts. Multiple goroutines can hold the same detached context and use it concurrently with no synchronisation.

---

### Q20. What is the simplest way to bound a detached operation?

**Model answer.** Layer a timeout on top of the detached context:

```go
detached := context.WithoutCancel(parent)
ctx, cancel := context.WithTimeout(detached, 5*time.Second)
defer cancel()
work(ctx)
```

The timeout fires after 5 seconds regardless of what the parent does.

---

### Q21. Does `WithoutCancel` allocate memory?

**Model answer.** Yes, but very little — about 16 bytes for the wrapper struct. The cost is negligible compared to spawning a goroutine.

---

## Additional Middle Questions

### Q22. How do you preserve OpenTelemetry trace context across the detach boundary?

**Model answer.** `WithoutCancel` preserves all values including the OpenTelemetry trace context (which is stored as a context value by the SDK). The detached goroutine can call `trace.SpanFromContext(detached)` to get the parent span and start a new span as its child. The trace continues correctly.

The only caveat: if the parent span has been ended (`span.End()` was called), the new span is still exported correctly but the trace's lifetime accounting may be slightly off. Most tracing UIs handle this gracefully.

---

### Q23. What happens if I call `AfterFunc(detached, f)`?

**Model answer.** `f` never runs. `AfterFunc` registers a callback to fire when the context is cancelled. The detached context is never cancelled, so the callback never fires. The registration is effectively leaked unless `stop()` is called.

To fix: layer cancellation on the detached context first:

```go
ctx, cancel := context.WithCancel(context.WithoutCancel(parent))
defer cancel()
context.AfterFunc(ctx, f) // fires when cancel() is called
```

---

### Q24. How do you detach work that must die at process shutdown?

**Model answer.** Combine `WithoutCancel(requestCtx)` with watching the process context:

```go
detached := context.WithoutCancel(requestCtx)
go func() {
    select {
    case <-processCtx.Done():
        return // shutting down
    case <-time.After(workDuration):
        // do the work
    }
}()
```

Or, more cleanly, manage this through a supervisor that owns the process context and submits detached work to it.

---

### Q25. Can detached work be cancelled later?

**Model answer.** Not by the parent, but yes if you layer cancellation:

```go
detached := context.WithoutCancel(parent)
ctx, cancel := context.WithCancel(detached)
go work(ctx)
// later:
cancel() // cancels ctx, not detached or parent
```

The `cancel` function gives you a way to cancel the work explicitly.

---

## Additional Senior Questions

### Q26. Design a saga pattern using partial cancellation.

**Model answer.**

```go
type Step interface {
    Do(ctx context.Context) error
    Compensate(ctx context.Context) error
}

func RunSaga(parent context.Context, pool *Pool, steps []Step) error {
    var completed []Step
    for _, s := range steps {
        if err := s.Do(parent); err != nil {
            for _, prev := range completed {
                p := prev
                pool.Submit(parent, "compensate", func(c context.Context) error {
                    return p.Compensate(c)
                })
            }
            return err
        }
        completed = append(completed, s)
    }
    return nil
}
```

The main saga uses parent context (cancellable). Compensations are detached (must run regardless of caller cancellation). The pool ensures bounded resource use and observability.

---

### Q27. What metrics would you instrument on a detached pool?

**Model answer.**

- Counter: `submissions_total{name}` — total submissions per operation name.
- Counter: `completions_total{name, status}` — completions broken down by status.
- Counter: `panics_total{name}` — panics per operation.
- Gauge: `inflight{name}` — currently in-flight operations.
- Gauge: `queue_depth` — current queue depth.
- Histogram: `duration_seconds{name}` — operation duration distribution.
- Counter: `submission_failures_total{reason}` — failed submissions (queue full, draining, tenant quota).

Together these answer: how much detached work is happening, how long it takes, how often it fails.

---

### Q28. Walk me through a partial-cancellation-related production incident you have debugged.

**Model answer.** (Candidate-specific; look for structured root-cause analysis.) A good story includes:
- The symptom (e.g., audit rows missing).
- The investigation (logs, metrics, code review).
- The root cause (e.g., missing `WithoutCancel`).
- The fix and verification.
- The follow-up (tests, lints, docs to prevent recurrence).

Look for the candidate's debugging methodology, not the specific bug.

---

### Q29. How do you load-test a service with detached work?

**Model answer.** Synthetic load against the HTTP endpoint. Measure:
- Request latency p50/p99.
- Detached pool queue depth.
- Detached completion rate vs submission rate.
- Memory usage growth.
- Goroutine count.

Compare against capacity: at expected p99 load, the queue should stay below 80% utilisation. If not, scale the pool or escalate to a queue.

Tools: `hey`, `wrk`, `vegeta`, or a custom load generator.

---

### Q30. What is the simplest way to test that detached cleanup actually runs?

**Model answer.**

```go
func TestDetachedRuns(t *testing.T) {
    var ran atomic.Bool
    parent, cancel := context.WithCancel(context.Background())
    detached := context.WithoutCancel(parent)
    done := make(chan struct{})
    go func() {
        defer close(done)
        time.Sleep(50 * time.Millisecond)
        if detached.Err() == nil {
            ran.Store(true)
        }
    }()
    cancel()
    <-done
    if !ran.Load() {
        t.Fatal("detached did not run after parent cancel")
    }
}
```

The test verifies that after cancelling the parent, the detached goroutine still sees a non-cancelled context.

---

## Additional Staff Questions

### Q31. What design alternatives did the Go team consider before settling on `WithoutCancel`?

**Model answer.** Per issue #40221:
- A `Detach(ctx)` helper that copies values into a new background context (rejected: must enumerate keys).
- A flag on `WithCancel` like `WithCancelIgnoreParent` (rejected: complicates the existing API).
- The chosen approach: a new function that returns a custom struct.

The chosen approach is the cleanest: minimal API surface, no breaking change, clean semantics.

---

### Q32. How does the Go runtime track timers for detached contexts?

**Model answer.** Each `WithTimeout` allocates a `time.Timer`. Timers are tracked in a per-P (per-processor) heap by the runtime. The runtime fires timers in order of expiration. For a service with many concurrent detached operations, the timer heap can grow but is efficiently managed (O(log n) add/remove).

The cost of one timer is ~96 bytes. The cost of firing is one heap operation plus the goroutine the callback runs in.

For services with millions of concurrent timers, the heap becomes a bottleneck — but this is rare and usually indicates a design issue (such as not bounding the number of detached operations).

---

### Q33. How would you redesign the partial-cancellation API from scratch?

**Model answer.** (Candidate-specific; look for thoughtful trade-offs.) Possible directions:
- Make detached the default for "fire and forget" patterns; require explicit cancellation registration.
- Add a unified `Submit` API in the standard library.
- Combine `WithoutCancel` with `AfterFunc` for "detached but cancellable from elsewhere."

A good answer recognises the trade-offs and the value of minimal API surface.

---

### Q34. How does partial cancellation interact with Go's structured concurrency proposal?

**Model answer.** The proposal (issue #62488) introduces a `TaskGroup` or similar primitive that scopes goroutines. Goroutines spawned within the scope are tracked; the scope's lifetime is the goroutines' lifetime.

Partial cancellation is the explicit escape hatch from a scope. A `WithoutCancel` derivation means "this goroutine is no longer part of any scope." The structured proposal likely adds a way to make this explicit and visible.

Until the proposal lands, `WithoutCancel` is the closest tool. Best practice: detached work goes through a platform layer that tracks it for shutdown, effectively reintroducing scope at the application level.

---

### Q35. What is the memory cost of one detached operation in steady state?

**Model answer.** Approximately:

- Context wrapper: 16 bytes.
- Timeout cancelCtx + timerCtx: ~200 bytes.
- Timer struct: ~96 bytes.
- Goroutine stack (when running): 2 KB minimum, may grow.
- Captured closure: depends.
- Queue slot: ~8 bytes per slot.

Total per operation: ~2.5 KB while running. For 1000 concurrent operations: 2.5 MB. Modest.

---

## Behavioural / Open-Ended

### Q36. Tell me about a time you advocated for using partial cancellation in your team.

**Model answer.** (Candidate-specific.) Look for:
- Recognition of a real problem.
- Clear technical reasoning.
- Effective communication with stakeholders.
- Measurable impact.

---

### Q37. How would you teach `context.WithoutCancel` to a junior engineer?

**Model answer.** Start with a concrete bug: an audit row that disappears when the client disconnects fast. Show the code, show the symptom, show the fix. Then explain the semantics. Then practice with three more examples.

Avoid leading with the theory. Lead with the problem.

---

### Q38. What would you do if your team had no `WithoutCancel` usage at all in a busy service?

**Model answer.** Investigate why. Common reasons:
- The service is synchronous; everything blocks the caller.
- The team has not encountered the specific bug yet.
- The team uses durable queues for everything.

If the service has invisible side-effects that the user does not wait for, those are candidates for detaching. Audit one, demonstrate the bug, propose the fix.

If the team genuinely does not need it, that is also fine. Not every service has the right shape for detached work.

---

## Behavioural Probes

For senior+ candidates, ask:

- "How would you convince a sceptical colleague that detached cleanup needs `WithoutCancel`?"
- "What is the difference between 'best-effort' and 'fire-and-forget'?"
- "When have you decided *not* to use partial cancellation?"
- "What is the boundary between detached pool and durable queue, in your experience?"

These probe judgement, not knowledge.

---

## Final Notes

A candidate who can answer 25/38 well is strong. 30/38 indicates depth. 35+ indicates mastery.

Adjust expectations to the role. A junior position requires the junior questions. A staff position requires the staff questions.

Look for clarity, structure, and curiosity. Not perfection.
