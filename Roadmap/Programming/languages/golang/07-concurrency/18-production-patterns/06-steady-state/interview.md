---
layout: default
title: Steady-State — Interview
parent: Steady-State
grand_parent: Production Patterns
ancestor: Go
nav_order: 7
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/18-production-patterns/06-steady-state/interview/
---

# Steady-State — Interview

[← Back](../)

A set of interview questions, ordered from junior through staff, that test whether a candidate has internalised steady-state thinking. Each question is followed by a model answer and notes on what a strong answer looks like.

## Table of Contents

1. [Junior questions](#junior-questions)
2. [Middle questions](#middle-questions)
3. [Senior questions](#senior-questions)
4. [Staff questions](#staff-questions)
5. [Behavioural and post-mortem questions](#behavioural-and-post-mortem-questions)

---

## Junior questions

### 1. What does "steady-state" mean for a long-running Go service?

A service is in steady-state when, under representative load, its resident memory, goroutine count, queue depth, and file descriptor count are bounded and do not grow over time. After a transient (a traffic spike, a deploy), the service returns to the same equilibrium values it had before.

**Strong answer** also mentions: "and the tail latency is stable across days, not just minutes."

### 2. What is `GOMEMLIMIT`?

`GOMEMLIMIT` is a soft memory limit introduced in Go 1.19. The runtime treats it as a target: as the heap approaches the limit, GC runs more often and the runtime returns memory to the OS more aggressively. It is not a hard cap — allocations that would push past it still succeed, but GC tries to bring usage back down.

**Strong answer** mentions that it is set via the environment variable or `runtime/debug.SetMemoryLimit`, and that the conventional value is ninety to ninety-five percent of the container's hard memory limit.

### 3. Why is an unbuffered channel bad in a hot path?

Every send on an unbuffered channel blocks the sender until a receiver is ready. In a hot path that means the producer is rate-limited by the slowest consumer, which can become a livelock under burst. Worse, in a fan-out pattern, blocked sends pile up goroutines.

**Strong answer** notes that an *unbounded* buffered channel (capacity in the thousands or millions) is also wrong — it just defers the problem until the heap explodes.

### 4. How do you stop a goroutine cleanly?

Pass a `context.Context` into it and select on `ctx.Done()`. Or close a `chan struct{}` it is listening on. Never use `runtime.Goexit` from outside, and never assume "the goroutine will exit when the function returns" if you have not given it a way to learn that the time is now.

**Strong answer** notes that "leak budgets" are about goroutines too: every spawned goroutine must have a deterministic exit condition.

### 5. What metric would you watch to detect a goroutine leak?

`runtime.NumGoroutine()` or the `/sched/goroutines:goroutines` metric from `runtime/metrics`. Plot it over time. A flat baseline with spikes that return to baseline is healthy. A monotonically rising line is a leak.

---

## Middle questions

### 6. Describe shed-on-full versus block-on-full for a bounded queue.

Shed-on-full: when the queue is full, the producer drops the new item (or returns an error). Latency stays bounded because back-pressure does not propagate upstream. Used when upstream can retry or when the workload is best-effort (telemetry, sampled logs).

Block-on-full: when the queue is full, the producer waits. Latency degrades gracefully, no work is lost. Used when the workload is mandatory and upstream can absorb the back-pressure (a synchronous RPC).

**Strong answer** mentions that a `select` with a `default` case implements shed-on-full in one line, and that long-blocking sends should always be wrapped in a `select` against the context's `Done` channel.

### 7. How do you cap the number of concurrent goroutines that handle a given workload?

Two common patterns. (a) A buffered channel acting as a semaphore: send a token in before spawning, receive when done. (b) `golang.org/x/sync/semaphore.NewWeighted(n)` plus `Acquire`/`Release`. Or use a worker pool — N permanent goroutines reading from a job channel.

**Strong answer** prefers worker pools for steady-state because they avoid the per-job goroutine creation cost and make the goroutine count predictable.

### 8. What is the role of `sql.DB.SetMaxOpenConns`?

It is a hard cap on the number of database connections the pool will open. Calls beyond the cap block until a connection is returned. Without it, the pool will open as many connections as the load requests, exceeding the database server's own connection limit and causing a thundering-herd failure.

**Strong answer** also mentions `SetConnMaxLifetime` to recycle stale connections, and notes that `sql.DBStats` exports the pool's saturation in real time.

### 9. Why drain `*http.Response.Body` even when you do not care about the contents?

If the body is not fully read and closed, the connection cannot be returned to the keep-alive pool. The transport opens a fresh TCP+TLS connection on the next call, and eventually exhausts FDs or the upstream's connection limit.

**Strong answer** quotes the canonical pattern: `io.Copy(io.Discard, resp.Body)` then `resp.Body.Close()`, both inside `defer`.

### 10. What is a "leak budget"?

An explicit acknowledgement that some growth is acceptable. For example, "this service is allowed to grow up to one hundred kilobytes per hour; that is recovered on the next deploy." A leak budget is paired with an alert: growth inside the budget is silence; growth outside is a page.

**Strong answer** notes that budgets only work when deploys happen at a known cadence (e.g., at least once a week).

---

## Senior questions

### 11. When would you lower `GOGC` below 100? When would you raise it above 100?

Lower (`GOGC=50`, `GOGC=25`) when memory is the tighter resource than CPU: in a tight container, with `GOMEMLIMIT` set, GC will run more often and the steady-state heap will be smaller. Raise (`GOGC=200`, `GOGC=500`) when CPU is the tighter resource and the workload is allocation-heavy: GC runs less often, allocations are cheaper on average, but the heap is larger.

**Strong answer** mentions that with `GOMEMLIMIT` set, `GOGC` becomes less important — the limit takes over near saturation — and that the right answer is found by benchmarking, not by reasoning from first principles.

### 12. Describe four slow-decline failure modes that a steady-state design must prevent.

1. **Memory drift.** Goroutine, map, or cache state that accumulates one entry at a time and never expires.
2. **FD exhaustion.** Files, sockets, or pipes that are opened but not closed; or kept-alive HTTP responses with un-drained bodies.
3. **Deadline drift.** Requests with no timeout, or timeouts that grow as upstream slows down.
4. **Allocator fragmentation.** Long-lived allocations of varying sizes that leave the heap unable to coalesce free regions.

**Strong answer** adds: queue creep (a queue whose drain rate is just barely below its arrival rate), and pool fragmentation (connection pools that fail to recover after an upstream failover).

### 13. How do you design an alert that catches drift but not transient spikes?

Two ingredients. (a) A long observation window (one to six hours) so transients are smoothed. (b) A linear-regression check: the slope of the metric over the window, not the absolute value. Then the alert reads "post-GC heap is growing at more than X bytes per hour, for at least Y hours."

**Strong answer** mentions that you also need a fast-track alert for sudden growth (a hard threshold over a five-minute window).

### 14. What is the most important metric for connection-pool saturation in `database/sql`?

`db.Stats().WaitCount` and `db.Stats().WaitDuration`. Both should be zero or near zero. If they are growing, callers are blocked on `Acquire` — the pool is too small or the database is too slow.

**Strong answer** mentions that `InUse` versus `Idle` is also informative: a pool that never reaches its `MaxIdleConns` is oversized; one that is always at `MaxOpenConns` and `WaitCount` is climbing is undersized.

### 15. How do you build a chaos harness for steady-state?

Three components. (a) Long-running load (one hour minimum) to expose drift. (b) Failure injection — slow upstreams, dropped connections, simulated GC pressure. (c) Invariant checks at the end: heap, goroutines, FDs, queue depth, pool stats. If any invariant has drifted past its budget, the run fails.

**Strong answer** mentions running this in CI nightly with a one-hour budget, and in a long-running staging environment for forty-eight to seventy-two hours every release.

---

## Staff questions

### 16. Walk through how you would size a worker pool that consumes from a Kafka topic.

Start from the math: target throughput equals batch size times batch rate divided by per-message processing time. Solve for the number of workers. Then add a safety factor (typically two) to absorb tail-latency processing. Then bound the upper end by downstream capacity (database, RPC).

Continue: implement the pool as a fixed-size goroutine pool reading from a per-worker partition assignment, or from a single channel that producers fan into. Add backpressure: when the channel is full, the producer pauses the Kafka consumer (don't poll). Add observability: a gauge per worker of "messages in flight" and a histogram of processing time.

Continue: tune `GOMEMLIMIT` to the container's memory minus a buffer; pick `GOGC` after running a one-hour load test and watching the post-GC heap.

**Strong answer** ends with the operational story: how it deploys, how it autoscales, how it pages.

### 17. Tell me about a time you chased down a slow leak.

Allow the candidate to drive. Listen for:

- Did they take heap snapshots at two distinct points in time and diff?
- Did they use `pprof -base`?
- Did they check goroutines, FDs, AND heap, not just one?
- Did they reason about scope (per-request, per-tenant, per-process)?
- Did they reproduce it locally, or only in production?
- What was the fix? Was it a real fix, or a hack to delay the inevitable?

### 18. Design a steady-state contract for a multi-tenant service.

Per-tenant resource isolation is the headline. Each tenant gets a semaphore with a configured weight; oversubscribed tenants block, not the whole service. Each tenant has its own queue or queue partition. Memory is bounded per tenant via cache TTLs and size caps. Metrics are tagged with the tenant ID.

**Strong answer** discusses noisy-neighbour mitigation, fair scheduling (weighted fair queueing if SLOs differ), and the "blast radius" property — that one tenant's pathology cannot starve the others.

### 19. When is a goroutine leak acceptable?

Almost never, but: a leak budget of a few goroutines per day, recovered on each deploy, is tolerable if it lets you ship simpler code. The candidate should articulate the trade-off, not simply say "never."

**Strong answer** also notes that some "leaks" are conceptual — e.g., a goroutine that lives for the lifetime of the process intentionally — and that the question is whether the goroutine's lifetime is bounded by something the operator controls.

### 20. How do you decide between `GOGC` and `GOMEMLIMIT`?

`GOMEMLIMIT` is the safety belt: it gives you a hard upper bound on memory growth as you approach it. `GOGC` is the dial: it lets you trade CPU for memory at any operating point. In a typical container, set `GOMEMLIMIT` to ninety percent of the memory limit and `GOGC` to whatever produces the best latency-versus-cost trade-off in your benchmark. They are not exclusive; they cooperate.

**Strong answer** notes that `GOMEMLIMIT=off` is a bug waiting to happen in any container, and that disabling `GOGC` is only safe in batch jobs.

---

## Behavioural and post-mortem questions

### 21. Your service has been running for forty-eight hours and the memory graph has a clear positive slope. Walk me through your debugging.

Two snapshots from `/debug/pprof/heap` thirty minutes apart, then `go tool pprof -base snap1 snap2`. Identify the top allocator that has grown disproportionately. Cross-check with `runtime.NumGoroutine` and the FD count. Look for context cancellation paths that are not being hit. Form a hypothesis, fix one thing, ship to staging, watch for another forty-eight hours.

### 22. The on-call wakes you at 3 a.m.; latency is up two-x and the pod has not crashed. What do you look at first?

Saturation, not utilisation. Queue depth, mutex wait, semaphore-acquire wait, pool `WaitCount`. CPU and memory are usually fine in a "latency creep" incident; the bottleneck is contention or back-pressure.

### 23. Your team is shipping a new feature that allocates a megabyte per request and request rate is one thousand per second. How do you reason about steady-state?

One gigabyte per second of allocation. With `GOGC=100`, GC must keep up with one gigabyte per second of churn — measurable CPU. Consider: pooling the megabyte buffer with `sync.Pool`; streaming rather than buffering; reducing allocation. Set `GOMEMLIMIT` so that worst-case it caps at a known memory headroom.

### 24. What do you do if a leak budget is exceeded by a single deploy?

Roll back, then investigate. The leak budget is meant to be predictable; an unexpected exceedance is a regression, not a tuning issue. After the rollback, take a heap diff between the old and new builds.

### 25. How do you teach steady-state to a junior engineer?

Show them three things: (a) a graph of a service in steady-state and one not in steady-state, side by side; (b) the `pprof -base` workflow; (c) the leak-budget mindset, that some growth is okay but it must be bounded and measured. Have them shadow on-call for a week. The lesson lands fastest when they see a real incident.

### 26. Describe the trade-off between a fixed-size worker pool and per-request goroutines.

Fixed pool: predictable goroutine count, no per-job spawn cost, but jobs queue behind earlier jobs (head-of-line). Per-request: every request gets its own goroutine, no queueing, but goroutine count is unbounded and per-job spawn cost adds up.

The right answer for steady-state is almost always the bounded fixed pool, paired with a queue and shed-on-full.

### 27. How would you sell steady-state work to a product manager?

Frame it as "deploy hygiene" or "tail latency" — both are visible to the product side. Steady-state engineering is what lets you ship every weekday without the on-call rotation being woken. Translate engineering effort to predictable customer experience and to engineer time saved per quarter.

### 28. Final question: what is the difference between "good steady-state" and "great steady-state"?

Good is bounded growth, alerts on drift, dashboards in place. Great is *boring*: the dashboards never deviate, the alerts never fire, the on-call rotation has nothing to do. The aspiration is not heroism; it is engineering away the need for heroism.

---

## Trick questions

These are questions designed to expose surface-level understanding.

### 29. "Setting `GOGC=off` improves performance. True or false?"

False, almost always. In a short-lived batch job, it can help. In a long-running service, it leaks memory unbounded. The candidate should ask "what is the context?"

### 30. "Increasing `MaxOpenConns` always reduces latency. True or false?"

False. Beyond a certain point, the database becomes the bottleneck. Adding more connections increases contention on the database side and may actually raise latency. The right answer is measured, not assumed.

### 31. "Bounded queues never lose data. True or false?"

Depends on the policy. With shed-on-full, yes, data is dropped. With block-on-full, no, but upstream slows down. With load-shedding, statistically some data is dropped. The candidate should articulate the trade-off.

### 32. "If `runtime.NumGoroutine()` is stable, there is no goroutine leak. True or false?"

False. The leak could be balanced by another mechanism (e.g., goroutines that complete at the same rate they spawn, plus a slow drift). A stable count is a *necessary* but not *sufficient* condition for no leak.

### 33. "All steady-state metrics should be exported to a time-series database. True or false?"

Tempting to say true. But high-cardinality metrics (anything labelled by user ID, request ID, or any unbounded value) can crash the time-series database. The right answer is "only metrics with bounded cardinality."

---

## System design questions

### 34. Design a multi-tenant API gateway that is steady-state under hostile tenants.

Sketch the architecture. Listen for:

- Per-tenant rate limit at the gateway.
- Per-tenant semaphore behind the rate limit (concurrent in-flight).
- Per-tenant connection pool to downstream (or shared pool with per-tenant accounting).
- Per-tenant metrics: requests/sec, errors/sec, latency p99.
- Saturation dashboards per tenant.
- Hostile-tenant containment: noisy neighbour cannot starve quiet neighbours.

A strong answer also discusses fairness (weighted-fair queueing if SLOs differ), and the "blast radius" property — that one tenant's pathology cannot starve the others.

### 35. Design a streaming pipeline (Kafka in, Kafka out) that is steady-state under variable input rates.

Sketch the architecture. Listen for:

- Per-stage bounded queue with backpressure.
- Worker pools sized per stage.
- Idle-time work (e.g., compaction) gated on queue depth.
- Per-message context with deadline; orphaned messages are killed at deadline.
- Kafka consumer pauses when the worker queue is near full.
- Slow-decline detection: log queue depth slope; alert if positive over hours.

### 36. Design a caching layer (Redis-backed) for a multi-region service.

Sketch the architecture. Listen for:

- Bounded local cache (LRU) in front of Redis.
- TTL on every Redis entry.
- Connection pool to Redis with sane defaults.
- Circuit breaker around Redis (if Redis is down, the service degrades, not crashes).
- Per-key admission control (avoid hot key starvation).
- Local cache invalidation on Redis-level changes (pub/sub or polling).

### 37. Design a background-job worker that survives an upstream outage.

Sketch the architecture. Listen for:

- Bounded retry buffer.
- Exponential backoff with jitter on retries.
- Circuit breaker around the upstream.
- Dead-letter queue for permanently failed jobs.
- Job timeout; orphaned jobs killed.
- Worker pool with sized capacity.

---

## Operations questions

### 38. You have just been on call for the first time. What is the first thing you check when the steady-state alert fires?

Strong answer: "Is the dashboard reachable? Is there a recent deploy? What's the trend over the last six hours?" Quick triage, then deeper diagnosis.

Weak answer: "I open pprof and start digging."

### 39. Your service has an `RLIMIT_NOFILE` of 1024. The dashboard shows 800 open FDs and rising. How urgent is this?

Quite urgent. At the current rate, the service is hours from `EMFILE`. Investigate immediately; if necessary, restart pods one at a time to buy time while you find the leak.

### 40. The chaos harness has just failed. What do you do?

Read the failure. If it's a real regression, find the commit, fix or revert. If it's a flaky test, fix the test. Never just mute it.

### 41. A team wants to ship a new service. What is your minimum steady-state checklist before sign-off?

- `GOMEMLIMIT` set.
- `pprof` enabled on a localhost listener.
- Every queue has a bound.
- Every pool has explicit sizing.
- Every long-lived goroutine has an exit condition.
- A dashboard with the standard saturation metrics.
- A runbook stub linking to the dashboard.

Weak teams ship without these. The senior engineer should require them.

---

## Programming exercise — verbal

### 42. On the whiteboard, write the smallest worker pool you would put in production.

The candidate should produce, in roughly five minutes:

```go
type Pool struct {
    jobs chan func()
    wg   sync.WaitGroup
}

func NewPool(workers, queueSize int) *Pool {
    p := &Pool{jobs: make(chan func(), queueSize)}
    for i := 0; i < workers; i++ {
        p.wg.Add(1)
        go func() {
            defer p.wg.Done()
            for j := range p.jobs {
                j()
            }
        }()
    }
    return p
}

func (p *Pool) Submit(ctx context.Context, job func()) error {
    select {
    case p.jobs <- job:
        return nil
    case <-ctx.Done():
        return ctx.Err()
    }
}

func (p *Pool) Stop() {
    close(p.jobs)
    p.wg.Wait()
}
```

Strong answer: also mentions the limitations (no metrics, no shedding, no graceful stop with deadline) and what they would add for a real production version.

### 43. On the whiteboard, write the snippet that sets `GOMEMLIMIT` from the cgroup at startup.

The candidate should produce something like:

```go
import (
    "os"
    "runtime/debug"
    "strconv"
    "strings"
)

func init() {
    if b, err := os.ReadFile("/sys/fs/cgroup/memory.max"); err == nil {
        if n, err := strconv.ParseInt(strings.TrimSpace(string(b)), 10, 64); err == nil {
            debug.SetMemoryLimit(int64(float64(n) * 0.9))
        }
    }
}
```

Strong answer: notes that cgroup v1 is at a different path, that "max" means unlimited, and that `init()` is the right place to call it (before any user allocation).

---

## A note on the meta-skill

The questions above test specific knowledge. But the meta-skill of steady-state engineering is *curiosity about long-time-scale behaviour*. A junior who asks "what does this look like after a week?" is more valuable than one who knows every tuning parameter but has never thought about time.

When interviewing, watch for the candidate who instinctively reaches for time-based questions. They will be the engineer who catches the slow leak before the OOM.

---

## Interview rubric

For each question, the grader can score on three dimensions:

### Vocabulary (1-3)

Does the candidate use the right words? "Steady-state," "saturation," "drift," "slope alert," "leak budget," "shed-on-full." Wrong vocabulary signals shallow exposure.

### Depth (1-3)

Does the candidate go beyond definitions to mechanisms? "I would alert on the slope of heap over six hours, using a Prometheus `deriv` query against the post-GC heap metric." Mechanism-level answers signal hands-on experience.

### Trade-offs (1-3)

Does the candidate articulate what is *gained* and what is *lost* by each choice? "`GOGC=200` reduces GC CPU but raises steady-state heap size; the right value depends on whether memory or CPU is the tighter resource." Trade-off awareness separates senior from junior.

A senior-level candidate scores 7-9 across all three; a staff-level candidate scores 8-9 consistently and asks clarifying questions before answering.

### Red flags

- "I would just add more memory."
- "Goroutines are free."
- "I don't worry about that; we restart pods every day."
- "I prefer to read about it rather than experience it."

These are signs that the candidate has not yet operated a long-running service. They may be a competent developer but are not yet a steady-state engineer.

### Green flags

- Asks clarifying questions about scale, lifetime, SLO.
- Reaches for measurement before reasoning.
- Talks about time, not just instantaneous state.
- Knows what they don't know.
- Has at least one war story of their own.

These signal the candidate has lived steady-state in production.

---

## Final note on interviews

The best steady-state engineers are made, not born. A candidate who has never operated a long-running service can still become excellent — they just need the experience. When you find a candidate with potential but no production experience, hire them anyway; pair them with a mentor; rotate them through on-call. Six months later they will have the experience.

The candidate to avoid is the one who has had the experience and learned the wrong lessons (overprovisioning instead of engineering, restarting instead of fixing, ignoring alerts instead of tuning them). Bad habits in production are harder to unlearn than no habits at all.
