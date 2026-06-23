---
layout: default
title: Interview
parent: Wait for Empty Channel
grand_parent: Concurrency Anti-Patterns
ancestor: Go
nav_order: 6
permalink: /roadmap/programming-languages/golang/07-concurrency/15-concurrency-anti-patterns/05-wait-for-empty-channel/interview/
---

# Wait-for-Empty-Channel — Interview Questions

35 questions across four bands: junior (1-10), middle (11-20), senior (21-28), staff/principal (29-35). Each has a question, a model answer, and a rubric for evaluating candidate responses.

---

## Band 1: Junior (Questions 1-10)

### Q1. What does `len(ch)` return for a channel?

**Answer.** It returns the number of values currently in the channel's buffer that have not yet been received. For an unbuffered channel it always returns 0. For a nil channel it returns 0. The value is a snapshot at the time of the call; it may be stale immediately.

**Rubric.** Look for: snapshot semantics, unbuffered case = 0, awareness that it can be stale. Missing any of these is a junior gap.

---

### Q2. What is wrong with `for len(ch) > 0 { time.Sleep(time.Millisecond) }`?

**Answer.** Two issues. First, `len(ch)` is not a synchronisation operation; the value may not reflect concurrent sends or completions. Second, the polling loop wastes CPU. The correct pattern is to close the channel and `range` over it, or use a `sync.WaitGroup`, or a done channel.

**Rubric.** Look for: race condition, CPU waste, knowledge of the correct alternative. Bonus: can articulate the missing happens-before edge.

---

### Q3. How would you wait for N goroutines to finish?

**Answer.** Use `sync.WaitGroup`. Call `Add(1)` before each goroutine (from the parent), `defer wg.Done()` inside, and `wg.Wait()` to wait.

```go
var wg sync.WaitGroup
for i := 0; i < N; i++ {
    wg.Add(1)
    go func(i int) {
        defer wg.Done()
        work(i)
    }(i)
}
wg.Wait()
```

**Rubric.** Look for: `Add` from parent, `defer Done()`, no polling. Bonus: explain why `Add` must be in parent.

---

### Q4. What happens when you receive from a closed channel?

**Answer.** The receive returns the zero value of the element type immediately, and `ok` is false. Multiple consumers can all receive without blocking. This is the basis for the "broadcast via close" pattern.

**Rubric.** Look for: zero value, ok=false, non-blocking, broadcast property.

---

### Q5. What happens when you send on a closed channel?

**Answer.** Panic. The runtime aborts with "send on closed channel."

**Rubric.** Just "panic" is enough. Bonus: knows it is a runtime panic, not a compile error.

---

### Q6. What does `close(ch)` do?

**Answer.** Records that no more values will be sent on the channel. Subsequent sends panic. Subsequent receives return remaining buffered values, then return zero values without blocking. Closing a nil channel panics. Closing a closed channel panics.

**Rubric.** Look for: no more sends, receives drain, panics on nil and already-closed.

---

### Q7. What is the difference between `chan T` and `chan<- T`?

**Answer.** `chan T` is bidirectional (read and write). `chan<- T` is send-only. `<-chan T` is receive-only. Directional types are used in function parameters to enforce one-way usage. The compiler rejects sending on a receive-only channel or closing a receive-only channel.

**Rubric.** Look for: direction syntax, compile-time enforcement.

---

### Q8. What does `for v := range ch` do?

**Answer.** Receives values from the channel until it is closed and the buffer is empty. The loop variable `v` is the received value. The loop exits when the channel is closed and drained.

**Rubric.** Look for: closes and drains, no need for explicit length check.

---

### Q9. Why is `time.Sleep` not a synchronisation primitive?

**Answer.** `time.Sleep` only suspends the goroutine for a duration. It does not signal or wait for any event. The duration is also not exact. Using `time.Sleep` to "wait for something to happen" is a polling pattern: you check the something, sleep, check again. This is racy because the wake-up time is not synchronised with the event.

**Rubric.** Look for: no event, no signal, racy. Bonus: contrast with `<-done` which waits on an event.

---

### Q10. Show the simplest way to signal completion from one goroutine to another.

**Answer.** A done channel.

```go
done := make(chan struct{})
go func() {
    work()
    close(done)
}()
<-done
```

The `close(done)` is the signal. The `<-done` is the wait. The empty struct conveys no value; the close itself is the signal.

**Rubric.** Look for: chan struct{}, close as signal, <- as wait.

---

## Band 2: Middle (Questions 11-20)

### Q11. Explain the happens-before relationship between channel send and receive.

**Answer.** The Go memory model states that a send on a channel is synchronized before the completion of the corresponding receive. This means: every write a goroutine performs before sending is visible to the receiver after the receive. The send and the matching receive form a synchronisation pair.

**Rubric.** Look for: memory model citation, mutual visibility of writes, "synchronized before."

---

### Q12. Explain the happens-before relationship for channel close.

**Answer.** The closing of a channel is synchronized before a receive that returns because the channel is closed. So all writes the closer performs before `close(ch)` are visible to anyone whose `<-ch` returns due to the close.

**Rubric.** Look for: edge from close to drain-receive, allows broadcast.

---

### Q13. Why doesn't the race detector catch the wait-for-empty-channel anti-pattern?

**Answer.** The race detector instruments memory accesses. The polling pattern reads `len(ch)`, which goes through the channel's internal mutex — a well-formed lock that the detector treats as correct. There is no data race on shared memory; the race is a logic race. Detectors do not catch logic races.

**Rubric.** Look for: distinction between data race and logic race, channel's internal locking.

---

### Q14. Refactor this code to remove the polling.

```go
jobs := make(chan int, 100)
for i := 0; i < 50; i++ {
    go func(i int) {
        jobs <- compute(i)
    }(i)
}
for len(jobs) > 0 {
    fmt.Println(<-jobs)
}
```

**Answer.**

```go
jobs := make(chan int)
var wg sync.WaitGroup
wg.Add(50)
for i := 0; i < 50; i++ {
    go func(i int) {
        defer wg.Done()
        jobs <- compute(i)
    }(i)
}
go func() {
    wg.Wait()
    close(jobs)
}()
for v := range jobs {
    fmt.Println(v)
}
```

WaitGroup tracks producers; close-after-wait converts to a closed channel; range drains.

**Rubric.** Look for: WaitGroup, close-after-wait pattern, range. Penalise: keeping `len(ch)` in any form.

---

### Q15. When would you use `errgroup` over `sync.WaitGroup`?

**Answer.** When you want first-error propagation and context cancellation. `errgroup.WithContext` returns a context that cancels on the first error from any goroutine. `Wait()` returns the first error. `WaitGroup` has neither.

**Rubric.** Look for: first error, context cancellation, both as a single package.

---

### Q16. What is the difference between `<-ctx.Done()` and a manually closed done channel?

**Answer.** Functionally they are similar: both are channels that close as a signal. `context.Done()` is built into the standard `context.Context` type and supports cancellation cascades (parent cancels children) and deadlines (auto-cancel after timeout). A manual done channel is simpler but lacks the structural features.

For composition with deadlines or hierarchical cancellation, use context. For a single ad-hoc completion signal, a manual done channel is fine.

**Rubric.** Look for: cascade, deadlines, simplicity trade-off.

---

### Q17. Explain the "close after wait" pattern.

**Answer.** When multiple producers write to a channel that consumers will range over, no single producer can close the channel without risking sends from others. The pattern:

```go
var wg sync.WaitGroup
for _, p := range producers {
    wg.Add(1)
    go func(p Producer) {
        defer wg.Done()
        for v := range p.Output() {
            ch <- v
        }
    }(p)
}
go func() {
    wg.Wait()
    close(ch)
}()
for v := range ch {
    consume(v)
}
```

A coordinator goroutine waits for all producers to finish, then closes the channel. Consumers range over it normally.

**Rubric.** Look for: separate goroutine for close, WaitGroup tracks producers.

---

### Q18. What is the canonical pattern for a worker pool with bounded concurrency in Go?

**Answer.**

```go
g, ctx := errgroup.WithContext(ctx)
sem := semaphore.NewWeighted(int64(maxConcurrency))
for _, item := range items {
    item := item
    if err := sem.Acquire(ctx, 1); err != nil {
        break
    }
    g.Go(func() error {
        defer sem.Release(1)
        return process(ctx, item)
    })
}
return g.Wait()
```

Errgroup for error propagation; semaphore for concurrency limit.

**Rubric.** Look for: errgroup + semaphore, context flow, no `len` polling.

---

### Q19. How would you cancel a long-running goroutine?

**Answer.** Pass a `context.Context` and have the goroutine select on `ctx.Done()`:

```go
go func(ctx context.Context) {
    for {
        select {
        case <-ctx.Done():
            return
        case item := <-input:
            handle(item)
        }
    }
}(ctx)

// To cancel:
cancel()
```

The select makes cancellation event-driven. The goroutine exits promptly.

**Rubric.** Look for: context, select on Done, prompt exit.

---

### Q20. How do you test a refactored polling loop?

**Answer.** Combine several techniques:

- `go test -race` to enable the race detector.
- `-count=200` to run many iterations to expose probabilistic races.
- `goleak` to detect leaked goroutines.
- Property-based tests (e.g., `testing/quick`) to vary inputs.
- Stress tests with many concurrent goroutines.

```bash
go test -race -count=200 -timeout=5m ./...
```

**Rubric.** Look for: -race, -count, goleak, willingness to stress test.

---

## Band 3: Senior (Questions 21-28)

### Q21. Design an API for a worker pool that makes the wait-for-empty-channel anti-pattern syntactically impossible.

**Answer.** Hide the channel; expose methods. Have constructors return a started pool. Provide `Submit`, `Close`, and `Wait` methods. Do not expose the input channel.

```go
type Pool[T any] struct { /* opaque */ }

func New[T any](ctx context.Context, workers int, handler func(context.Context, T) error) *Pool[T]
func (p *Pool[T]) Submit(ctx context.Context, job T) error
func (p *Pool[T]) Close() error
```

Callers never see a channel they could poll. The pool internally uses WaitGroup or errgroup. The polling pattern has no surface.

**Rubric.** Look for: hidden channel, generic, context-aware methods, single Close that joins.

---

### Q22. You inherit a 500K-line codebase with the polling pattern in many places. Outline a six-month migration.

**Answer.** Phased plan:

1. Months 1: discovery and tooling. Audit instances; build lints; build dashboards; write runbooks.
2. Month 2: training. Team learns the patterns. Pair-refactor a few simple instances.
3. Months 3-4: refactor hot path. One service per week. Feature flags. Gradual rollout. Stress tests under `-race -count=200`.
4. Month 5: refactor cold path. Batched.
5. Month 6: cleanup. Remove flags. Tighten lints to block. Document. Schedule annual audit.

Continuous: PR reviews, leadership updates, postmortem-driven refinement.

**Rubric.** Look for: phasing, tooling, training, feature flags, leadership comms. Bonus: realistic effort estimate.

---

### Q23. Walk through a production incident where this anti-pattern caused data loss.

**Answer.** Composite walkthrough: handler queues a job and polls for queue empty. Under load, handler A sees queue empty while handler B's job is still in flight. Handler A returns 200; B's job fails downstream and the reconciliation flags it the next day. The fix: per-request completion channels.

The lessons: per-request waits avoid cross-request races; tests under load expose the issue; alerts on reconciliation gaps surface the impact.

**Rubric.** Look for: clear race description, per-request fix, lessons for prevention.

---

### Q24. Design the graceful shutdown for a Go service running on Kubernetes.

**Answer.**

1. PreStop hook: hit `/admin/drain` endpoint, sleep 15s for LB to notice.
2. SIGTERM handler in code: convert to context cancellation via `signal.NotifyContext`.
3. Shutdown sequence:
   - Mark readiness false (already done by PreStop).
   - Call `http.Server.Shutdown(ctx)` with bounded deadline.
   - Wait for worker pools to finish via `errgroup.Wait()`.
   - Close downstream resources (DB, cache).
   - Exit.
4. `terminationGracePeriodSeconds` set to 30 (default) with 25s deadline on Shutdown to leave a 5s margin.

**Rubric.** Look for: full sequence, readiness-first, library Shutdown, bounded deadline, no polling.

---

### Q25. Compare `sync.Cond`, channels, and `sync.WaitGroup` for "wait for a predicate over shared state."

**Answer.**

- `sync.Cond`: explicit predicate wait. Hold the lock, call `Wait()` in a loop checking the predicate. Wake-ups via `Signal`/`Broadcast`.
- Channels: convert the state change to an event. The waiter ranges or selects.
- `WaitGroup`: only waits for "N goroutines finished," not arbitrary predicates.

For arbitrary predicates `sync.Cond` is the textbook answer, but channels usually win in Go because they compose with `select`. `WaitGroup` is wrong unless the predicate is "N goroutines done."

**Rubric.** Look for: knows all three, picks Cond for predicates, channels for events, WaitGroup for count.

---

### Q26. Explain backpressure in a Go pipeline and how it differs from polling.

**Answer.** Backpressure is the feedback from a slow consumer to a fast producer that slows production. In Go, channels provide backpressure naturally: if the buffer is full, sends block. If consumers are slow, producers wait.

This is the *opposite* of polling. Polling says "I will check until the queue has room"; backpressure says "the send blocks until the consumer is ready." The first wastes CPU; the second is event-driven.

For tunable backpressure use `select` with a `time.After` or `ctx.Done()` to drop or cancel on excessive wait.

**Rubric.** Look for: blocking channel sends as backpressure, contrast with polling, knows `select` for tunability.

---

### Q27. Design a metric collection system that uses `len(ch)` correctly.

**Answer.** Expose `len(ch)` as a gauge. Read it periodically from a metrics goroutine:

```go
go func() {
    ticker := time.NewTicker(time.Second)
    defer ticker.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case <-ticker.C:
            metrics.Gauge("queue.depth").Set(float64(len(jobs)))
        }
    }
}()
```

This is legitimate because the program's correctness does not depend on the gauge value. The gauge is informational. If `len(jobs)` returns 0 when it is actually 1, the gauge has a small inaccuracy but the system functions correctly.

Contrast with the anti-pattern: there, `len(jobs)` drives control flow. The 0/1 ambiguity causes wrong behaviour.

**Rubric.** Look for: distinction between informational vs synchronising use, ticker-based read, no control flow.

---

### Q28. A coworker insists on using `for len(ch) > 0` because "it works on our laptops." How do you respond?

**Answer.** Calmly. Explain:

1. The race is real, not theoretical. The Go memory model permits the read to lag behind the send. On weak-memory CPUs (arm64) it sometimes does.
2. Under load, the race window opens more often. Production has more concurrency than your laptop.
3. The fix is mechanical and cheap. WaitGroup is three lines.
4. The cost of the bug is real: data loss, slow shutdown, CPU waste, latency tails.
5. Show production examples from your codebase or public postmortems.

If they still insist, ask for a test that exercises the race window (`-race -count=10000` under load). They will not be able to produce one that proves correctness because correctness cannot be proven empirically for a race.

**Rubric.** Look for: technical clarity, calm tone, evidence-driven argument, no condescension.

---

## Band 4: Staff / Principal (Questions 29-35)

### Q29. You are designing a new Go service from scratch. How do you ensure the wait-for-empty-channel anti-pattern never appears?

**Answer.** A layered approach:

1. **API design**: hide channels behind methods. Expose `Submit`, `Close`, `Wait` rather than `<-chan T`.
2. **Codebase conventions**: every long-running goroutine has a documented owner and exit; every channel has a documented closer.
3. **Lints**: add a custom `go/analysis` pass that flags `for len(channel)` patterns. Wire into CI.
4. **Tests**: require `-race -count=N` in CI for concurrent code; `goleak` to catch leaks.
5. **Code review**: a structured concurrency checklist for PRs.
6. **Training**: onboarding includes hands-on refactoring exercises.
7. **Observability**: dashboards for in-flight work, shutdown duration, queue depth, baseline CPU. Alerts on regressions.
8. **Postmortems**: any incident touching concurrency analyses synchronisation primitives, not just the surface bug.

Each layer catches what others miss. Together they make the anti-pattern statistically absent.

**Rubric.** Look for: multiple layers, both technical and cultural, integrated. Bonus: specific tooling and review process.

---

### Q30. Critique this proposal: "Let's add a `WaitForEmpty()` method to our channel-based queue."

**Answer.** Strongly oppose. The method name suggests it is safe; the implementation has to either poll (anti-pattern) or wait for an event. If the queue can wait on an event, expose that event directly (a done channel or `Wait()`). If it cannot, the method should not exist; it would be a lie.

Better: the queue exposes `Close()` that drains and joins workers, or `Done()` that returns a channel closed on drain completion. These are honest names with correct semantics.

The proposal as stated would encourage callers to poll-pattern thinking and give them a false-positive primitive. Reject.

**Rubric.** Look for: principled rejection, alternative naming, no false-positive primitives.

---

### Q31. Lead an investigation: an HTTP server is shutting down too slowly under load. Outline your debugging plan.

**Answer.**

1. **Hypothesis**: the polling pattern or unbounded in-flight requests.
2. **Observe**: capture goroutine dump from a stuck pod (`kill -ABRT 1`); look at stack frames.
3. **Identify**: goroutines blocked in `time.Sleep`, `runtime.chanlen`, or in `runtime.gopark` without obvious reason are suspect.
4. **Profile**: capture a CPU profile during shutdown.
5. **Read code**: trace the shutdown path; find `len(ch)` or `for { ... time.Sleep }` patterns.
6. **Hypothesise fix**: replace polling with proper primitive.
7. **Reproduce locally**: write a stress test that simulates production load and shutdown.
8. **Test**: refactor, run stress test, confirm shutdown time drops.
9. **Roll out**: behind feature flag, canary, observe.

Throughout: communicate progress to stakeholders, capture findings for postmortem.

**Rubric.** Look for: structured plan, multiple diagnostic angles, stress test, comms.

---

### Q32. You are the principal engineer setting the standard for concurrency in a 50-engineer team. What policies do you write?

**Answer.**

Policy 1: Every PR touching concurrency includes a "concurrency" section in the description: goroutines spawned, channels created, waits used, cancellation flow.

Policy 2: Every long-running goroutine has a documented owner; every channel has a documented closer. Lints enforce.

Policy 3: Every test for concurrent code runs under `-race -count=100`. CI enforces.

Policy 4: Every service has a graceful shutdown that completes within 25 seconds. Monitored.

Policy 5: Every quarter, each service has a concurrency audit using the team's checklist.

Policy 6: New hires complete a 2-week onboarding that includes pair-refactoring of legacy concurrency code.

Policy 7: Any anti-pattern incident triggers a postmortem with action items.

Policy 8: Internal documentation of concurrency patterns is maintained as a living wiki.

Policies are visible, enforced, and revised annually.

**Rubric.** Look for: enforceable policies, not just aspirations, with specific metrics and audits.

---

### Q33. The product team wants a real-time dashboard showing "items remaining in the queue." How do you implement it without introducing the anti-pattern in the consumers?

**Answer.** The dashboard reads a metric, not the queue itself.

```go
go func() {
    ticker := time.NewTicker(500 * time.Millisecond)
    defer ticker.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case <-ticker.C:
            metrics.Gauge("queue.depth").Set(float64(len(jobs)))
        }
    }
}()
```

The dashboard backend reads the gauge. The consumers use `range` or `select` and never look at `len`. The boundary is clean.

This is the canonical example of "metrics are observability, not synchronisation." The polling for the gauge does not infect the workers' logic.

**Rubric.** Look for: metric gauge separation, single goroutine reads len, no flow control on len.

---

### Q34. A junior engineer's PR introduces the wait-for-empty-channel anti-pattern. Write the code review comment.

**Answer.**

```
Suggest replacing this polling loop with synchronisation:

```go
for len(jobs) > 0 {
    time.Sleep(time.Millisecond)
}
```

with:

```go
wg.Wait()
```

The polling is racy: `len(jobs)` can return 0 while a worker is mid-process. The race lets the caller return before work finishes, dropping the result.

A WaitGroup-based version:

```go
var wg sync.WaitGroup
for ... {
    wg.Add(1)
    go func() {
        defer wg.Done()
        ch <- compute()
    }()
}
wg.Wait()
```

Reference: see middle.md "Correct Pattern Catalogue: WaitGroup" in our concurrency docs.

Happy to pair on the refactor if helpful.
```

**Rubric.** Look for: specific code suggestion, explains why, references internal docs, offers help, constructive tone.

---

### Q35. Explain to a non-engineer leader why a six-month concurrency cleanup is worth $400K in engineering time.

**Answer.**

"We have a recurring bug in our concurrency code that causes:

- 4 incidents per quarter, each costing 20 engineer-hours of investigation and customer apology.
- $150K/year in cloud spend from inefficient CPU usage.
- 50 ms of latency tail that breaches our SLO 5 days a quarter.
- One customer almost churned last quarter; estimated $1.2M ARR risk.

The cleanup costs $400K in engineering time but saves $150K/year forever in cloud spend, plus 80 hours of engineer time per quarter in avoided incidents, plus the SLO compliance, plus the customer retention.

Net: payback in under 18 months on the cloud savings alone, before counting the customer and incident reduction. We can present the dashboard and incident reports if helpful."

The pitch leads with cost, supports with data, names the risk, frames as investment.

**Rubric.** Look for: dollar amounts, payback period, multiple value streams, no jargon. Bonus: anticipates leadership questions.

---

## Closing

These 35 questions cover the band from junior to staff/principal. Each tests not just knowledge but also articulation. In real interviews, follow-up questions probe depth. Use these as the structured baseline.

Candidates who can answer Q1-10 are junior-ready. Those who handle 11-20 are mid-level. Those comfortable with 21-28 are senior. Those who navigate 29-35 with clarity are staff or principal candidates.
