---
layout: default
title: Interview — Drain Pattern
parent: Drain Pattern
grand_parent: Production Patterns
ancestor: Go
nav_order: 7
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/18-production-patterns/05-drain-pattern/interview/
---

# Drain Pattern — Interview Questions

## Table of Contents
1. [Junior Questions](#junior-questions)
2. [Middle Questions](#middle-questions)
3. [Senior Questions](#senior-questions)
4. [Staff / Principal Questions](#staff-principal-questions)
5. [Whiteboard Tasks](#whiteboard-tasks)
6. [Behavioral Drain Questions](#behavioral-drain-questions)

---

## Junior Questions

### Q1. What is graceful shutdown? Why is it needed?

**A.** Graceful shutdown is the process of stopping a program in a controlled way: stop accepting new work, finish in-flight work, close downstream resources, then exit. It is needed to avoid losing data in flight (half-sent HTTP responses, uncommitted Kafka offsets, open database transactions) and to keep customers happy during deploys.

### Q2. What is the difference between `SIGTERM` and `SIGKILL`?

**A.** `SIGTERM` is a polite "please stop" signal that programs can catch and handle. `SIGKILL` is an uncatchable signal that immediately terminates the process. Kubernetes sends `SIGTERM` first, waits the grace period, then sends `SIGKILL` if the process is still running.

### Q3. How do you catch `SIGTERM` in Go?

**A.** Use `signal.NotifyContext`:

```go
ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
defer cancel()
<-ctx.Done()
// drain
```

### Q4. What does `http.Server.Shutdown` do?

**A.** It closes the listener (no new connections), closes idle keep-alive connections, then waits for active requests to finish. It returns nil on success or the context error if the deadline expires.

### Q5. What is `sync.WaitGroup` used for in drain?

**A.** Tracks in-flight goroutines. `Add(1)` before each spawn, `defer Done()` in the goroutine, `Wait()` to block until all are done. During drain, wrap `Wait` in a goroutine that closes a channel, then `select` against a deadline.

### Q6. Why do you need a deadline on drain?

**A.** A hung worker could keep the drain waiting forever. The deadline bounds the wait so the orchestrator's grace period is respected. If the deadline fires, you force-cancel remaining work and exit.

### Q7. What is wrong with `os.Exit(0)`?

**A.** `os.Exit` terminates immediately without running deferred functions, without notifying goroutines, without draining. It is the opposite of graceful shutdown. Only `main` should call it (or not — returning from `main` is cleaner).

### Q8. What is a goroutine leak?

**A.** A goroutine that was started but never exits. It holds memory and resources indefinitely. Common cause: a goroutine in a `for { select { case <-ch: } }` where `ch` never closes and there is no context check.

---

## Middle Questions

### Q9. How would you drain a worker pool?

**A.** Three steps: (1) close the input channel so no more work enters, (2) wait for in-flight workers to finish via WaitGroup, (3) bound the wait with a context deadline. Sketch:

```go
func (p *Pool) Drain(ctx context.Context) error {
	close(p.queue)
	done := make(chan struct{})
	go func() { p.wg.Wait(); close(done) }()
	select {
	case <-done: return nil
	case <-ctx.Done(): return ctx.Err()
	}
}
```

### Q10. What is the order of operations in a graceful shutdown for a service with HTTP, workers, and a database?

**A.**

1. Flip readiness to 503.
2. Sleep ~2 seconds for LB propagation.
3. `srv.Shutdown(drainCtx)` for HTTP (no new requests, finish in-flight).
4. Drain worker pool (wait for queue + workers).
5. Flush any async producers.
6. `db.Close()`.
7. Return from main.

### Q11. Why is the readiness flip important?

**A.** The load balancer may still send requests for a moment after `SIGTERM`. Flipping readiness to 503 tells the LB to stop routing new traffic. Without this, drain happens against a stream of incoming requests.

### Q12. What is the difference between `errgroup` and `sync.WaitGroup`?

**A.** `WaitGroup` only counts goroutines. `errgroup.Group` adds error propagation (first error returned by `Wait`) and context cancellation (returning an error cancels the group's context, so other goroutines see it as a drain signal).

### Q13. How do you ensure a drain function is idempotent?

**A.** Use `sync.Once` or `atomic.CompareAndSwap`:

```go
var once sync.Once
func (s *Service) Drain(ctx context.Context) error {
	var err error
	once.Do(func() { err = s.drain(ctx) })
	return err
}
```

### Q14. What is wrong with deriving the drain context from a cancelled root context?

**A.** A `context.WithTimeout(cancelledCtx, 25*time.Second)` is already cancelled (the parent is). The drain has zero time. Always derive from `context.Background()` for the drain budget.

### Q15. How do you drain a long-running HTTP request mid-shutdown?

**A.** The handler should check `r.Context().Done()` and exit cleanly if cancelled. `Server.Shutdown` cancels request contexts when its own deadline expires. For long-poll endpoints, design the response so clients can retry (204, structured "please retry" body).

### Q16. How do you test a drain?

**A.** At minimum five tests: (1) empty system drains fast, (2) in-flight work completes, (3) hung worker hits deadline, (4) submit after drain rejects, (5) double drain is safe. Run with `-race`.

---

## Senior Questions

### Q17. Design drain for a service with HTTP, workers, Kafka consumer, Kafka producer, and Postgres. Walk me through the order and reasoning.

**A.**

1. Readiness flip (LB stops new traffic).
2. Propagation sleep (LB catches up).
3. `srv.Shutdown(drainCtx)` (no new HTTP).
4. Kafka consumer: stop fetch, drain in-flight messages, commit final offsets.
5. Worker pool drain (workers finish).
6. Producer flush (buffered messages out).
7. Producer close.
8. Consumer close.
9. Postgres close.

Reasoning: drain from outside-in. The consumer must commit before disconnecting; the producer must flush before closing; the database closes last because everyone uses it.

### Q18. How do you allocate the drain budget across components?

**A.** Measure each component's P99 drain time. Allocate budget = P99 + safety margin (1.5x). Sum the budgets. Compare to grace period. If sum > grace, optimise or parallelise drains.

For a typical service: HTTP 5s, workers 12s, producer flush 3s, DB close 2s = 22s. Total grace 30s, drain budget 25s, fits with margin.

### Q19. What is cooperative rebalance in Kafka and how does it affect drain?

**A.** Cooperative rebalance (KIP-429) lets only the partitions moving between consumers pause, not all partitions. Drain becomes per-partition: each revoked partition gets its own drain. Other partitions continue uninterrupted. Less disruption; better drain latency.

### Q20. How do you detect a stuck drain in production?

**A.** Metric: `drain_duration_seconds` histogram. Alert when P99 approaches grace period. Also a counter `drain_force_cancelled_total` — any non-zero is a signal. Goroutine count delta also helps (drain that doesn't fully release goroutines is a leak).

### Q21. Drain a `database/sql` pool. What can go wrong?

**A.** `db.Close()` blocks until all in-use connections return. If workers hold connections and don't release them (hung query, leak), Close hangs forever. Mitigations: (1) bound queries with `statement_timeout`, (2) drain workers before calling Close, (3) drop max idle and lifetime to release connections faster.

### Q22. How does drain interact with leader election?

**A.** A leader must release leadership before drain. Otherwise, the cluster waits for lease expiry. Sequence: (1) resign leadership, (2) let a new leader be elected, (3) drain own work. Resign first so other nodes can take leader-only actions.

### Q23. How do you drain a service holding many WebSocket connections?

**A.** Maintain a registry of active connections. On drain: send a close frame ("server going away") to each, wait for clients to disconnect (with a short deadline), force-close remaining. Then `Server.Shutdown` is fast because no active hijacked connections remain.

### Q24. What is the right number of seconds for the readiness propagation sleep?

**A.** Slightly longer than the LB's health-check interval. Typical LBs poll every 1-5 seconds. A 2-second sleep covers most. Configurable per environment.

---

## Staff / Principal Questions

### Q25. How would you build a drain framework for a 50-service organisation?

**A.** Outline:

- Define a `Drainable` interface across the org.
- Provide a `Supervisor` library that wires signal handling, lifecycle, errgroup, metrics, and tracing.
- Provide a service template repo with drain pre-wired.
- Mandate drain tests in CI.
- Add a quarterly drain audit cadence.
- Track fleet-wide drain metrics in a shared dashboard.
- Mentor engineers via code review and pair programming.

### Q26. How does drain affect SLO error budgets?

**A.** A drain that returns 5xx counts against availability SLO. Compute: drain failure rate × deploys × pod-time. For 99.95% SLO and frequent deploys, drain quality must be high (failure rate < 0.01%). Track drain contribution to error budget; act when it exceeds threshold.

### Q27. Walk me through a drain incident postmortem you have led.

**A.** *(Describe a specific incident.)* Format: timeline, root cause, contributing factors, immediate mitigations, long-term fixes, lessons. Example: "A drain budget of 25s was less than the downstream HTTP client timeout of 60s. Result: stuck request hung drain. Fix: lower client timeout; bound `wg.Wait()` with deadline; add CI rule to flag timeout > drain budget."

### Q28. How do you decide between drain and hard stop?

**A.** Drain when: work has side effects, retries aren't free, customer-facing requests in flight, exactly-once semantics. Hard stop when: read-only proxy, idempotent retries, short-lived CLI, detected corruption. The default for stateful services is drain.

### Q29. Drain across services: how do you coordinate?

**A.** Each service drains locally. The cluster (orchestrator) coordinates. Cross-service drain is rarely needed — drained pods stop accepting traffic; downstream sees a closed connection and routes to other pods. The LB / mesh handles routing during the transition.

### Q30. What is the cost of drain to your business and how do you justify the investment?

**A.** Cost: drain time × pods × deploys = engineering wait. ROI: cleaner deploys → more frequent deploys → faster iteration. Plus avoided incidents (each drain bug saved is ~$10k in support and engineering). The investment pays back in 1-2 quarters at typical engineering rates.

---

## Whiteboard Tasks

### Task 1. Implement drain for a worker pool. 10 minutes.

Live-code a worker pool with `Start(ctx, n)`, `Submit(job)`, `Drain(ctx)` methods. Include `closed atomic.Bool`, mutex around the close, `WaitGroup`. Be ready to discuss the race between Submit and Drain.

### Task 2. Wire a `main` function with drain. 10 minutes.

From scratch, write `main` with `signal.NotifyContext`, start an HTTP server, drain on signal with 25-second deadline.

### Task 3. Write a drain test. 10 minutes.

Write a test that asserts the drain returns within 200ms on an empty pool and within 5ms after an in-flight job completes. Run with `-race` mentally.

### Task 4. Find the drain bug. 10 minutes.

Interviewer presents a snippet. Candidate identifies the bug (missing close, missing deadline, wrong context). See find-bug.md for examples.

### Task 5. Design drain for a Kafka consumer service. 30 minutes.

End-to-end: signal handling, rebalance hooks, in-flight tracking, offset commits, deadline budgets, telemetry. Discuss trade-offs.

---

## Behavioral Drain Questions

### Q31. Tell me about a time you debugged a drain issue.

**A.** *(Personal story.)* Look for: clear problem statement, methodical investigation, root cause identification, fix that addresses the root cause (not just the symptom), and follow-up actions (test, monitor, mentor).

### Q32. How do you mentor a junior engineer on drain?

**A.** *(Personal approach.)* Look for: explaining the why before the what, pair programming a small example, code-reviewing their first drain implementation, sharing the cheat sheet, encouraging questions.

### Q33. Drain code is boring. How do you stay motivated?

**A.** Reframe: drain is infrastructure for reliability. Every clean deploy is a small win for the team and customers. The compound effect across years is meaningful. Plus: drain is one of the highest-leverage things you can build.

### Q34. Have you ever shipped drain code that broke production?

**A.** Honesty here. Senior engineers have. The answer should include: how the bug manifested, how it was diagnosed, how it was fixed, what was learned. The point is the learning, not the failure.

### Q35. How do you advocate for drain investment when the team is focused on features?

**A.** Frame in terms the team cares about: deploy frequency, customer trust, on-call burden. Show data (5xx rates during deploys, drain incident history). Propose a small initial investment (a sprint for drain audit and metric setup). Demonstrate the ROI.

---

## Closing Notes

These questions span entry-level through staff. A strong candidate at the appropriate level should answer the corresponding questions confidently and provide specific examples.

For interviewers: use the whiteboard tasks for hands-on signal; use the behavioral questions for cultural fit; use the conceptual questions for breadth.

For candidates: practice live-coding the patterns. Drain code is small but has subtleties; do not freeze on the second `select` block or the wait-group-in-a-goroutine trick. Build muscle memory.

The questions above can be combined: a senior interview might cover Q9-Q24 plus Task 1 plus Q27 plus Q31. A staff interview swaps in Q25-Q30 and Task 5.

Drain is a tractable topic. With practice, every Go engineer should answer the junior questions; every senior should answer the senior questions. The bar rises with the role.

---

## Tips For Interviewers

- Ask candidates to walk through their own production drain code, not toy examples.
- Probe on incidents: "what would you change about that code in hindsight?"
- Use real failure modes (hung worker, double close) to test composure.
- Look for: bounded waits, fresh contexts, idempotent calls, testable units.

## Tips For Candidates

- Bring an example from your own work.
- Cite specific timeouts and budgets you've used.
- Discuss trade-offs explicitly.
- Be ready to whiteboard the worker pool drain from memory.
- Know the difference between `Server.Shutdown` and `Server.Close`.

Good luck.

---

## Bonus Questions And Answers

### Q36. What happens if I call `close()` on a channel that has buffered items?

**A.** Buffered items can still be received. Receivers continue to get values until the channel is empty, then `ok=false` on subsequent receives. `close()` does not discard buffered values; it only signals "no more values coming."

### Q37. What happens if I send on a closed channel?

**A.** A runtime panic: "send on closed channel." The sender must ensure the channel is open before sending. This is why drain code gates sends with a `draining` atomic flag.

### Q38. How do you wait for a `WaitGroup` with a deadline?

**A.** Wrap `wg.Wait()` in a goroutine that closes a `done` channel, then `select` on `done` and `ctx.Done()`:

```go
done := make(chan struct{})
go func() { wg.Wait(); close(done) }()
select {
case <-done: // clean
case <-ctx.Done(): // deadline
}
```

### Q39. Can I reuse a `WaitGroup` after `Wait` returns?

**A.** Yes, but only if no `Add` calls happen concurrently with a `Wait`. The safe pattern is: `Add` all upfront, then `Wait`. Reusing across drain iterations requires care.

### Q40. What is `signal.NotifyContext` and how does it differ from `signal.Notify`?

**A.** `Notify` sends signals to a channel; you must read it. `NotifyContext` returns a context that is cancelled when any of the listed signals arrives. Available since Go 1.16. Idiomatic for "convert signal to context cancel."

### Q41. Why is the cancel function returned by `NotifyContext` important?

**A.** Calling cancel detaches the internal signal handler. Without it, the handler remains registered for the lifetime of the context (effectively forever in main). Always `defer cancel()`.

### Q42. How do you drain when you cannot modify the goroutine code (third-party library)?

**A.** Wrap the call:

```go
done := make(chan error, 1)
go func() { done <- thirdParty.Do() }()
select {
case err := <-done:
	return err
case <-ctx.Done():
	return ctx.Err()
}
```

The goroutine may leak — that is the trade-off. Bound it with the OS reclaiming memory on process exit.

### Q43. How do you drain a `select` loop with many cases?

**A.** Add a `<-ctx.Done()` case:

```go
for {
	select {
	case <-ctx.Done():
		return
	case a := <-chanA:
		// ...
	case b := <-chanB:
		// ...
	}
}
```

The `ctx.Done()` case wins when cancelled, exiting the loop.

### Q44. How do you drain a `time.Ticker`?

**A.** `Stop()` the ticker; let the goroutine reading from it see the next tick (which may already be queued) and then exit on the context cancel.

```go
t := time.NewTicker(time.Second)
defer t.Stop()
for {
	select {
	case <-ctx.Done():
		return
	case <-t.C:
		work()
	}
}
```

### Q45. When should I use a buffered vs unbuffered channel for drain signalling?

**A.** Use buffered (size 1) for signals from `signal.Notify` — the runtime does not block, but signals could be dropped if the channel is full. Use unbuffered for synchronisation where both sides must rendezvous.

### Q46. What is the difference between `cancel()` and `close(ch)` for drain?

**A.** `cancel()` cancels a context — any goroutine selecting on `<-ctx.Done()` sees it. `close(ch)` closes a channel — any goroutine ranging or receiving from `ch` sees end-of-stream. Drain often uses both: close to say "no more values," cancel to say "stop working."

### Q47. How do you handle a panic in a worker during drain?

**A.** `recover` in the worker:

```go
defer func() {
	if r := recover(); r != nil {
		log.Printf("worker panic: %v", r)
	}
}()
```

This is the "panic firewall." Especially important during drain, where you want the orderly shutdown to continue.

### Q48. How do you drain across many goroutines that produce results to a single output channel?

**A.** Track senders with a WaitGroup. Close the output channel from a goroutine that waits on the WaitGroup:

```go
var wg sync.WaitGroup
out := make(chan int)
for i := 0; i < 10; i++ {
	wg.Add(1)
	go func() {
		defer wg.Done()
		// send to out
	}()
}
go func() { wg.Wait(); close(out) }()
// consumer ranges over out; sees close when all senders done
```

### Q49. How do you implement a per-tenant drain in a multi-tenant service?

**A.** Each tenant has its own queue and wait group. Drain runs each tenant's drain in parallel:

```go
var eg errgroup.Group
for _, t := range tenants {
	t := t
	eg.Go(func() error { return t.Drain(ctx) })
}
_ = eg.Wait()
```

Per-tenant drain failures don't stop others.

### Q50. How do you migrate state during drain to another pod?

**A.** Persist state to durable storage (database, distributed cache) at drain start. The replacement pod reads it. For real-time migration (rare), use a streaming protocol with handoff. Most services prefer persistence — simpler, more reliable.

---

## A Long Q&A With A Senior Candidate

**Interviewer:** Tell me about drain in your last service.

**Candidate:** "It was a payment processing service. HTTP API in front, Kafka consumer for async work, Postgres for state. Drain on `SIGTERM` followed the standard pattern: readiness flip, 2s sleep, HTTP shutdown, consumer drain with offset commit, Postgres close. Total drain time P99 was about 4 seconds. Budget was 25 seconds out of a 30-second grace period."

**Interviewer:** What was the trickiest part?

**Candidate:** "The Kafka consumer drain. We use exactly-once semantics, so each batch was a transaction: read messages, write to Postgres, produce events, commit Kafka offset, commit Postgres. On drain, an in-flight transaction had to either commit or abort cleanly. We chose to commit if the producer had already sent the events; abort otherwise. The state machine for transaction status during drain took a couple of iterations to get right."

**Interviewer:** Did you have any drain incidents?

**Candidate:** "One. Early on, a downstream HTTP client had a 60-second timeout. Drain budget was 25 seconds. A stuck downstream caused drain to time out. We lost a few in-flight payments — re-processed on the next consumer, no money lost, but duplicate events emitted. After the incident, we added a CI rule that any HTTP client with a timeout greater than 20 seconds fails the build."

**Interviewer:** How did you test drain?

**Candidate:** "Unit tests for each component's `Drain` method: empty, in-flight, hung, double-call, leak. Integration test that started the binary, drove load via `vegeta`, sent `SIGTERM`, asserted clean exit and zero 5xx. The integration test ran in CI on every PR. We also did monthly chaos drills: random `kill -TERM` during sustained load, verify metrics."

**Interviewer:** What metrics did you track?

**Candidate:** "Drain duration histogram, drain force-cancelled counter, in-flight at drain start gauge. We alerted on P99 drain duration > 80% of grace period and on any non-zero force-cancelled count. The dashboards showed drain duration over time, broken down by version, so we could spot regressions."

**Interviewer:** Anything you'd do differently?

**Candidate:** "We invested in drain quality from the start of that service. For my next service, I'd build the drain framework as a shared library across the org — we did it per-service, which led to subtle inconsistencies. A shared library with a `Drainable` interface and a `Supervisor` type would have saved weeks of work."

**Interviewer:** Good. That covers what I wanted to ask.

---

## A Long Q&A With A Junior Candidate

**Interviewer:** Have you worked with graceful shutdown in Go?

**Candidate:** "A little. I added it to my last project after seeing the Go blog post. We had an HTTP server; I added `signal.NotifyContext` and `srv.Shutdown` with a 10-second timeout."

**Interviewer:** What does `Shutdown` actually do?

**Candidate:** "It... stops the server gracefully?"

**Interviewer:** Be specific.

**Candidate:** "I think it closes the listener so no new connections come in, and then waits for the in-flight requests to finish. If the context expires, it gives up."

**Interviewer:** Right. What does it return?

**Candidate:** "Nil on success, or the context error if it times out."

**Interviewer:** What signal does Kubernetes send?

**Candidate:** "SIGTERM. Then SIGKILL after 30 seconds if you didn't exit."

**Interviewer:** Why is the 30 seconds important?

**Candidate:** "Because that's the upper bound on how long you can take to drain. If you exceed it, you get killed and any in-flight work is lost."

**Interviewer:** Good. Now, can you write the smallest drainable Go program?

**Candidate:** *(Writes signal.NotifyContext + Server with Shutdown + 10-second timeout.)*

**Interviewer:** Let me see... you have `srv.Shutdown(ctx)`. What if ctx is already cancelled when you call this?

**Candidate:** "Hmm. It would return immediately with the context error?"

**Interviewer:** Right. So how do you get a fresh deadline for the drain?

**Candidate:** "I would... wrap... `context.WithTimeout(context.Background(), 25*time.Second)` instead?"

**Interviewer:** Good. You'd want background, not the cancelled root context. This is the most common drain bug — derived context from cancelled parent. Good that you spotted it.

**Candidate:** "Thanks."

**Interviewer:** Let's move on.

---

## Common Trap Questions

### Trap 1: "How do you safely close a channel from multiple goroutines?"

**A.** You don't — closing from multiple goroutines is a race. Have a single owner that closes once via `sync.Once` or atomic CAS.

### Trap 2: "What's faster, `WaitGroup` or atomic counter?"

**A.** Atomic counter is slightly faster but requires you to poll. `WaitGroup.Wait()` is a blocking wait — no polling needed. Different tools.

### Trap 3: "Why might `Server.Shutdown` not return for a long time?"

**A.** Hijacked connections (WebSocket, gRPC streaming) are not tracked by `Shutdown`. Long handlers also keep it waiting. The deadline bounds it.

### Trap 4: "What's wrong with this code?"

```go
go func() {
	for msg := range ch {
		process(msg)
	}
}()
// ...
close(ch)
```

**A.** Nothing inherently wrong — but the goroutine has no way to be cancelled mid-`process`. If `process` is long, you cannot interrupt it. Add a `<-ctx.Done` case for cancellation.

### Trap 5: "Is `os.Exit(0)` equivalent to `return` from main?"

**A.** No. `os.Exit` skips deferred functions. `return` runs them. Always prefer `return`.

---

## Final Thoughts

These questions cover the breadth of drain in Go. A candidate who answers most of them well at their level is well-prepared for production work.

If you are interviewing, use a mix. If you are preparing, work through them. Either way, the goal is competence with the patterns and judgement to apply them.

Drain is a teachable skill. Anyone who reads the junior, middle, and senior pages of this section, then practises the tasks, can answer these questions confidently.

Go practise.

---

## Rapid-Fire Round

A quick check on understanding. One sentence answers expected.

- **Q.** What signal triggers drain in Kubernetes? **A.** SIGTERM.
- **Q.** What's the default grace period in Kubernetes? **A.** 30 seconds.
- **Q.** What is the maximum drain budget for a 30-second grace? **A.** ~25 seconds, leaving margin.
- **Q.** Idiomatic Go function for signal-to-context conversion? **A.** `signal.NotifyContext`.
- **Q.** Method that gracefully shuts down `http.Server`? **A.** `Shutdown(ctx)`.
- **Q.** Method that hard-stops `http.Server`? **A.** `Close()`.
- **Q.** Method for graceful gRPC shutdown? **A.** `GracefulStop()`.
- **Q.** What does closing a channel signal? **A.** "No more values."
- **Q.** What does cancelling a context signal? **A.** "Stop what you are doing."
- **Q.** Both can be used in `select`. Which one to use for drain? **A.** Both — close for end-of-input, cancel for force-stop.
- **Q.** What's the cost of `wg.Add(1) + defer wg.Done()` per call? **A.** ~20-50 ns.
- **Q.** Drain-aware library API shape? **A.** `Drain(ctx context.Context) error`.

---

## Pair-Programming Exercises

For more in-depth interview rounds:

1. Pair-write a drainable worker pool, including tests.
2. Audit a 500-line Go service for drain bugs.
3. Refactor a service that uses `os.Exit` to use proper drain.
4. Add metrics and traces to an existing drain implementation.
5. Diagnose a stuck drain from a goroutine dump.

Each exercise takes 30-60 minutes and reveals real ability.

---

## Final Final Notes

The interview pages and tasks pages overlap; some questions become tasks and vice versa. That is by design — the practice for an interview is the practice for the job.

Drain is interviewable. Drain is teachable. Drain is hireable.

Good luck on both sides of the table.


