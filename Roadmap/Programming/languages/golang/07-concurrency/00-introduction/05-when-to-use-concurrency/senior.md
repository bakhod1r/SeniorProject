# When to Use Concurrency — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Concurrency Decisions at the Architecture Level](#concurrency-decisions-at-the-architecture-level)
3. [Deadline-Driven Design](#deadline-driven-design)
4. [Concurrency for Throughput vs Latency](#concurrency-for-throughput-vs-latency)
5. [Failure Isolation and Concurrency](#failure-isolation-and-concurrency)
6. [Multi-Tenant Concerns](#multi-tenant-concerns)
7. [Latency Budgets and Tail Tolerance](#latency-budgets-and-tail-tolerance)
8. [Cost of Concurrency in Money](#cost-of-concurrency-in-money)
9. [Cultural Aspects: Concurrency in Code Review](#cultural-aspects-concurrency-in-code-review)
10. [Migrating Between Concurrency Models](#migrating-between-concurrency-models)
11. [Self-Assessment](#self-assessment)
12. [Summary](#summary)

---

## Introduction

The senior view treats concurrency as a decision at the system-design level. Not "should this function spawn a goroutine," but "how should this service be structured to meet its latency, throughput, cost, and reliability goals?" The decisions interlock: a choice to make a service "asynchronous" propagates through error handling, observability, capacity planning, deployment.

This file collects opinions and trade-offs. None are universal; all matter when scaling beyond the toy.

After this you will:

- Make concurrency decisions tied to system-level goals (deadline, throughput, cost).
- Apply concurrency to failure isolation and tail-latency reduction.
- Communicate concurrency trade-offs to non-Go engineers.
- Lead concurrency-related migrations safely.

---

## Concurrency Decisions at the Architecture Level

Concurrency interacts with every other architectural decision:

### Synchronous vs asynchronous API

If your service offers a synchronous API (request → response), each request's latency matters. Concurrency *within* a request reduces latency by parallelising sub-operations.

If your service is asynchronous (submit-job → poll-status), the latency target is different (job-completion-time). Concurrency *across* jobs increases throughput.

Mixing the two creates complexity. A "sync API that under the hood is async" leads to callback patterns, polling, or long-polling — each with its own concurrency story.

### Stateful vs stateless

A stateless service can be parallelised cheaply: spin up more instances. Concurrency within each instance is straightforward (per-request goroutines).

A stateful service (a database, a session cache) cannot scale by adding instances unless state is sharded or replicated. Concurrency within the instance is constrained by the state's structure.

### Synchronous vs eventually consistent

If you need strong consistency, you usually have a single decision point (a leader, a quorum). Concurrency around that point is serial-by-nature.

If eventually consistent, concurrency proliferates: many writers, many readers, all loosely coupled.

### Microservices vs monolith

Microservices distribute concurrency: each service does its own concurrent work; the orchestration service fans out to them and gathers results.

A monolith concentrates concurrency: all the goroutines live in one process. Easier to reason about but harder to scale.

Both shapes have valid use cases.

---

## Deadline-Driven Design

When latency targets are strict (e.g., 99th percentile < 100 ms), concurrency is shaped by the deadline.

### The 100 ms budget

If a request has 100 ms total budget:

- Network round-trip from client: ~10 ms.
- Server-side processing: ~80 ms.
- Network round-trip back: ~10 ms.

Of the 80 ms server time:

- Parsing: 5 ms.
- Auth: 5 ms.
- Business logic: 30 ms.
- DB calls: 40 ms.

If three DB calls happen sequentially at ~15 ms each, total = 45 ms — over budget. Parallelising them brings it to ~15 ms, total 55 ms — under budget. Concurrency just barely saves the SLO.

### Hedged requests

For latency-sensitive read paths:

- Send to replica A immediately.
- After 20 ms, if A has not responded, send the same request to replica B.
- Take whichever responds first; cancel the loser.

Costs 1.5–2x the request volume but cuts tail latency dramatically. Worth it when 99th-percentile matters more than capacity.

### Speculative execution

Run multiple plans concurrently; take whichever finishes first.

```go
ctx, cancel := context.WithCancel(ctx)
defer cancel()

planAResult := make(chan Result, 1)
planBResult := make(chan Result, 1)

go func() { planAResult <- planA(ctx) }()
go func() { planBResult <- planB(ctx) }()

select {
case r := <-planAResult:
    cancel() // stop plan B
    return r
case r := <-planBResult:
    cancel() // stop plan A
    return r
}
```

Useful when plans have different cost/latency trade-offs.

### Latency-aware fan-out

Sometimes fanning out to 10 services has a 99th-percentile near the slowest's 99th. Strategies:

- **Quorum.** Return when K of N respond. Tolerates some slow responses.
- **Mandatory + optional.** K services are required; others are best-effort. Mandatory has tight deadlines; optional has loose.
- **Tier-based.** Fast services first (cache); slow services as fallback.

---

## Concurrency for Throughput vs Latency

The same concurrency technique can serve different goals. Be explicit about which.

### Throughput: more work per unit time

- Per-request goroutines (framework handles).
- Worker pools for queue draining.
- Pipeline parallelism.

Optimise for: max requests/sec, max items/sec.

Bottleneck: usually downstream capacity (DB, API).

### Latency: less time per request

- Parallel sub-operations within a request.
- Hedged requests.
- Speculative execution.
- Cancellation of slow sub-operations.

Optimise for: p50 / p99 latency.

Bottleneck: usually the slowest of N parallel operations.

### The trade-off

Adding concurrency for throughput can hurt latency (more queueing, more contention). Adding concurrency for latency can hurt throughput (more CPU on duplicate work for hedging).

Set explicit goals. "Reduce p99 from 200 ms to 100 ms" or "increase throughput from 1k to 5k rps." Optimise toward the goal; verify the other does not regress.

---

## Failure Isolation and Concurrency

Concurrency can both improve and worsen failure isolation.

### Improves: bulkheads

A service that handles different types of requests in different goroutine pools isolates one type's overload from another. Example: read traffic and write traffic in separate pools, each with its own quota.

```go
readPool := makePool(8)
writePool := makePool(4)
```

A spike in writes does not consume read capacity.

### Improves: independent goroutines

A worker that panics or hangs does not (necessarily) take down others. With recover at each goroutine boundary, one failure is local.

### Worsens: shared state

Goroutines sharing a mutex can all hang if the mutex is held too long. One slow goroutine blocks all others.

### Worsens: cascading failures

A goroutine timing out on a downstream propagates through `errgroup.WithContext` to cancel siblings. If those siblings were doing important other work, you lose more than you wanted.

### Designing for isolation

- **Separate pools for separate concerns.**
- **Recover at every goroutine boundary** that may panic on untrusted input.
- **Use independent contexts** for unrelated work.
- **Set deadlines** so failures bound their own duration.
- **Monitor each pool separately** (queue depth, goroutine count).

---

## Multi-Tenant Concerns

A service handling multiple tenants (customers, users) faces noisy-neighbour problems.

### Per-tenant concurrency limits

Cap concurrency per tenant so one cannot exhaust shared resources.

```go
tenantLimiter := map[string]*semaphore.Weighted{}
```

Or use an external rate limiter (`rate.Limiter`) per tenant.

### Per-tenant pools

For strict isolation, give each tenant its own pool. Expensive (memory per pool), but ensures no tenant impacts another.

### Adaptive fairness

If a tenant's traffic spikes, throttle them while letting others through. Implement with weighted-fair queueing.

This is operational engineering more than Go concurrency. Go gives you the primitives; the design is yours.

---

## Latency Budgets and Tail Tolerance

For high-percentile latency:

### Understand the curve

For each operation in a request, what is its p50, p99, p99.9?

- Cache hit: p50 ~ 100 µs, p99 ~ 500 µs, p99.9 ~ 5 ms.
- Local DB query: p50 ~ 2 ms, p99 ~ 20 ms, p99.9 ~ 200 ms.
- Remote API: p50 ~ 50 ms, p99 ~ 500 ms, p99.9 ~ 5 s.

If you call all three sequentially, your p99.9 is at least p99.9 of the slowest = 5 s.

### Parallel fan-out amplifies tails

Calling 10 backends in parallel and waiting for all: your p99 is approximately `1 - (1 - p)^10` where p is each one's per-call probability of being slow.

If each backend's p99 is 1% slow, the aggregate is `1 - 0.99^10 ≈ 9.6%`. Your p99 is now where the *individual* p90 was. Bad.

### Hedged or quorum reads

- Hedged: cancel the slow one as soon as the fast one returns.
- Quorum: succeed when K < N have responded; cancel the rest.

Both reduce tail at the cost of duplicate work.

### Backpressure shapes the tail

A queue that grows under load grows latency. Bound the queue; shed load when it fills.

```go
select {
case queue <- req:
default:
    return errors.New("overloaded") // 503
}
```

Shedding load is a tail-tolerance technique. Slow responses turn into failed responses, which are faster to handle (the client retries, gets routed elsewhere, etc.).

---

## Cost of Concurrency in Money

In production:

- **Compute cost.** More concurrent work = more CPU. More CPU = more cores = more $.
- **Memory cost.** Each goroutine has a stack; each goroutine in flight uses memory.
- **Network cost.** Fan-out to N services = N egress requests = more $.
- **Downstream cost.** If you scatter-gather to 5 backends, each adds load to that backend. Their capacity costs $.
- **Engineering cost.** Concurrent code is harder to write, test, debug, maintain.

The "right" amount of concurrency optimises for total cost (engineering + runtime + downstream). A sequential service with 200 ms latency may be cheaper than a concurrent one with 50 ms latency if the latency was acceptable and the concurrency added significant ongoing engineering burden.

Engineering judgement: do not over-optimise for ms when seconds are acceptable; do not optimise for $ when latency is critical to business outcomes.

---

## Cultural Aspects: Concurrency in Code Review

Senior engineers shape team culture around concurrency:

### "Why goroutines?"

When reviewing a PR with new goroutines, ask:
- What problem does this solve?
- What is the expected speedup / throughput gain?
- How is it bounded?
- How does it shut down?
- How is it observed (metrics, traces)?

If the author cannot answer, the goroutine is suspect.

### Default sequential

Establish a team norm: concurrency is opt-in, not default. Each `go` statement justifies itself.

### Concurrency as expertise

New engineers should not be left to figure out concurrency alone. Pair-program, code review, document patterns.

### Post-mortems

Concurrency-related incidents (goroutine leaks, race conditions, deadlocks) are learning opportunities. Document, share with team, update guidelines.

---

## Migrating Between Concurrency Models

Sometimes you decide a section of code uses the wrong concurrency model. Migration is risky.

### Sequential → concurrent

Add concurrency:
1. Identify the parallel opportunity (I/O, CPU split).
2. Implement behind a feature flag.
3. Benchmark to verify speedup.
4. Roll out gradually, watch metrics.
5. Roll back if metrics regress.

### Concurrent → sequential

Remove concurrency:
1. Verify the concurrency does not actually help (profile-driven).
2. Implement the sequential version behind a flag.
3. Benchmark to verify performance is acceptable.
4. Roll out gradually.
5. Once stable, remove the old code.

### Channel-based → mutex-based (or vice versa)

Refactor synchronisation:
1. Map out the current synchronisation (which channels, which mutexes).
2. Plan the new shape.
3. Implement in parallel (both versions coexist for a window).
4. Switch.
5. Remove old code.

### Worker pool → per-request goroutine

If you find your worker pool is actually serial (bottlenecked downstream), you may simplify to per-request goroutines. Less code, similar throughput.

### Mistakes to avoid

- **Big-bang migrations.** Rewrite all at once. Hard to roll back, hard to bisect failures.
- **No metrics.** Migrating without before/after metrics means you do not know if you improved or regressed.
- **Skipping the race detector.** Big refactors invite new races. Run with `-race` and stress tests.

---

## Self-Assessment

- [ ] I have made a concurrency decision based on system-level goals (latency, throughput, cost).
- [ ] I have designed for failure isolation using concurrency primitives (pools, bulkheads).
- [ ] I have applied hedged requests or quorum reads to reduce tail latency.
- [ ] I have rejected a proposed concurrency change because of measurement.
- [ ] I have led a migration between concurrency models with explicit rollback plans.
- [ ] I have set per-tenant concurrency limits in a multi-tenant service.
- [ ] I shape team culture around "default sequential, justify concurrency."
- [ ] I have written post-mortems for concurrency-related incidents.
- [ ] I have explicitly traded $ for ms or ms for $.
- [ ] I can defend a concurrency design choice to a non-Go-savvy stakeholder.

---

## Summary

At senior level, concurrency is a property of system design, not just code. Decisions ripple through latency budgets, throughput goals, failure isolation, multi-tenant fairness, and operational costs.

Use concurrency to meet deadlines (parallel sub-operations, hedged requests, speculative execution). Use it to improve throughput (worker pools, pipelines). Use it for failure isolation (bulkheads). Avoid it when measurement does not justify the complexity.

Lead by example in code review: every goroutine justifies itself. Build a team culture of "default sequential." Migrate carefully when needed, with rollback plans and metrics.

The professional file digs into quantitative analysis: numerical models for tail latency, capacity planning, profiling-driven decisions.
