# Livelock — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [Designing Systems That Cannot Livelock](#designing-systems-that-cannot-livelock)
3. [Capacity Planning and Headroom](#capacity-planning-and-headroom)
4. [Service Mesh and Cross-Service Back-Off Policy](#service-mesh-and-cross-service-back-off-policy)
5. [Incident Response for Livelock](#incident-response-for-livelock)
6. [Postmortem Patterns](#postmortem-patterns)
7. [Organisational Hygiene](#organisational-hygiene)
8. [Summary](#summary)

---

## Introduction

The professional level treats livelock as an organisational risk, not just a code bug. You can:

- Architect systems that are livelock-free by construction.
- Specify retry and back-off policies as cross-cutting concerns enforced at infrastructure layers.
- Run a livelock incident: detect, diagnose, mitigate, recover.
- Write a postmortem that drives durable change.
- Build engineering culture that catches livelock before it ships.

This document is shorter than the others because the work at this level is judgement, not knowledge.

---

## Designing Systems That Cannot Livelock

### Principle 1: Build with progress in mind

When designing a coordination protocol, write down the *progress condition* before writing the code. "Within `T` seconds of a request, the request either completes or returns a definite error." If you cannot state the condition, you cannot guarantee liveness.

### Principle 2: Avoid mutual back-off

Two services that back off on conflict should not back off *the same way* on the same event. If two services use `cenkalti/backoff` with identical defaults, they synchronise. Either:

- Use different parameters per service.
- Include service identity in the jitter seed.
- Designate one party as authoritative — the other yields without back-off.

### Principle 3: Prefer pessimism at scale

Optimistic concurrency wins at low contention; it loses at high contention. If your workload's contention point is uncertain, design for the worse case — use pessimistic locking, queueing, or partitioning.

### Principle 4: Bound everything

Every retry, every wait, every lock acquisition must have a bound. Unbounded loops are unbounded outages.

### Principle 5: Build observability for progress

Throughput counters are the first-class signal for livelock. They should be:

- Per-request-type, not just global.
- Visible in dashboards (not just logs).
- Alertable with thresholds derived from baseline.
- Reset on rolling windows so old peaks do not mask current valleys.

### Principle 6: Test the worst case

Capacity tests should include:

- Maximum sustainable concurrency.
- Burst load at 5–10x sustained.
- Coordinated retry storms (simulate a downstream failure).
- Cross-service congestion (saturate a downstream and watch upstreams).

A system that has not been load-tested at 5x sustained capacity has not been tested for livelock.

---

## Capacity Planning and Headroom

Livelock often appears at the edge of capacity. A system at 60% utilisation is safe; at 95% the same system livelocks. The transition is sharp.

### The capacity headroom rule

Maintain at least 30% headroom in normal operation. This:

- Buffers against traffic spikes.
- Gives retry storms room to dissipate.
- Provides reaction time for autoscaling.

### Saturation = livelock probability

When utilisation approaches 100%, livelock probability rises non-linearly. Plot success-rate against utilisation and you will often see a cliff. Operate to the left of the cliff.

### The "queue grows, latency grows, retries grow" feedback

When the queue grows, latency grows; when latency grows, clients time out and retry; retries grow the queue. This is the retry-storm feedback loop. Cures:

- **Server-side load shedding.** Drop requests when CPU > threshold. A dropped request is a fast error; a queued request is slow death.
- **Client back-off respecting headers.** Servers send `Retry-After: 5`; clients wait at least that long *with jitter*.
- **Circuit breakers.** Open the circuit on persistent failures; do not retry into a dying service.

### Per-tenant quotas

Multi-tenant services should isolate one tenant's livelock from another's. A noisy tenant should not livelock the shared service. Mechanisms:

- Per-tenant concurrency limits (`semaphore.Weighted`).
- Per-tenant rate limits.
- Per-tenant priority queues — best-effort for one tenant does not delay paid tier of another.

---

## Service Mesh and Cross-Service Back-Off Policy

In a microservices architecture, retry policy is a *cross-cutting concern*. Implementing it per-service leads to:

- Inconsistent defaults.
- Retry storms that nobody owns.
- Difficult auditing.

A service mesh (Istio, Linkerd) lets you specify retry, timeout, and back-off at the mesh layer. This has several advantages:

- One policy for all services in a domain.
- Centralised observability.
- Per-route customisation.

### Mesh retry pitfalls

- **Retry budget.** Without a budget, retries can amplify by N at each hop in a long chain — one origin retry becomes N², N³ retries. Use mesh-level retry budgets (Istio's `retryBudget`).
- **Retry only on idempotent operations.** GETs are safe; POSTs may not be. Configure retry by HTTP method.
- **Honor server `Retry-After`.** The mesh should respect server hints, not override them.
- **Bound mesh and client retries together.** Some teams configure both client retry and mesh retry, multiplying total attempts.

### Without a mesh

Use a single shared HTTP client library that enforces policy. Wrap `net/http.Client` in a custom `RoundTripper` that:

- Adds exponential back-off with decorrelated jitter.
- Respects `Retry-After`.
- Honours a context deadline.
- Bounds total retries to (e.g.) 3.
- Logs retry counts to metrics.

```go
type RetryRoundTripper struct {
    Base    http.RoundTripper
    Retries int
}

func (r *RetryRoundTripper) RoundTrip(req *http.Request) (*http.Response, error) {
    for attempt := 0; attempt < r.Retries; attempt++ {
        resp, err := r.Base.RoundTrip(req)
        if !shouldRetry(resp, err) {
            return resp, err
        }
        backoff := computeBackoff(attempt, resp)
        select {
        case <-time.After(backoff):
        case <-req.Context().Done():
            return nil, req.Context().Err()
        }
    }
    return r.Base.RoundTrip(req)
}
```

Centralise this; do not let each service implement its own.

---

## Incident Response for Livelock

### Detection

A livelock incident usually presents as:

- **Latency p99 climbs sharply.** The hot loop drags everyone else.
- **Throughput drops.** Successful operations per second falls.
- **CPU plateaus near 100%** on one or more cores.
- **Goroutine count is stable** (not a leak).
- **No panic, no obvious error.**

The combination is distinctive. A system in panic logs panics; a system with a leak grows memory; a system in livelock just sits there hot.

### Triage

1. **Capture `pprof` and goroutine dump immediately.** Live captures, before the symptom passes. The goroutine dump shows the dance partners' stacks.
2. **Capture metrics for the last 30 minutes.** Plot success-rate, attempt-rate, latency, CPU, goroutine count.
3. **Identify the loop.** From the profile, find the function that dominates CPU. From the goroutine dump, count how many are in that function.
4. **Identify the resource.** From the loop, find the shared resource — atomic, mutex, channel, network endpoint.

### Mitigation

Short-term, in order of preference:

1. **Add load shedding.** Reject requests at the edge. The hot loop reduces in proportion.
2. **Reduce concurrency.** Cut goroutine count, thread pool, connection pool. Less symmetry, less livelock.
3. **Add jitter to retry intervals.** A configuration change, not a deploy.
4. **Restart.** A clean restart resets all state. Use only if other mitigations cannot land in time.

### Recovery

1. **Verify metrics return to baseline.** Success-rate up, CPU down, latency down.
2. **Verify there is no continuing damage.** Logs free of suspicious "retry" or "conflict" repetition.
3. **Communicate.** External status page, internal Slack, customer notifications.
4. **Begin postmortem.** Even if the mitigation works, file the postmortem.

### Resolution

The mitigation is not the fix. The fix is a code change that prevents recurrence. Resolution requires:

- A test that reproduces the livelock.
- A patch that makes the test pass.
- A deploy through canary and staged rollout.
- A monitor that alerts if the pattern recurs.

---

## Postmortem Patterns

A livelock postmortem should answer:

### What happened

A factual timeline. "At 14:23 UTC, latency p99 for `/checkout` rose from 200 ms to 8 s. At 14:25 CPU on `checkout-svc` hit 98%. At 14:30 we drained 30% of pods to reduce concurrency. By 14:35 metrics returned to baseline."

### Why

The technical root cause, expressed as the chain of mechanism:

- "On `/checkout`, two goroutines use optimistic concurrency to update the inventory row."
- "Under burst load (1500 RPS, 20x normal), conflict rate rose."
- "Each goroutine retried with `time.Sleep(10*time.Millisecond)` — no jitter."
- "All retrying goroutines synchronised on the 10 ms tick, creating a periodic re-collision pattern."
- "Success rate collapsed to under 1%."

### Why this was not caught

A blameless analysis of process failure:

- "Our load test ran at 500 RPS, well below the burst level."
- "The retry pattern was not flagged in code review because reviewers do not check for missing jitter."
- "We have no monitor for `attempts/success ratio`."

### What we change

Action items with owners and dates:

- "Add jitter to the inventory retry path (owner: X, due: Y)."
- "Add `attempts_total` and `success_total` counters to all retry loops; alert if ratio > 10 (owner: X, due: Y)."
- "Expand load tests to include 10x burst scenarios (owner: X, due: Y)."
- "Add a lint rule that flags `time.Sleep` immediately followed by `continue` in a retry loop (owner: X, due: Y)."

### What we learned

Two-paragraph reflection. What does this incident teach about our coding standards, our review practices, our load testing? The goal is durable culture change.

---

## Organisational Hygiene

Livelock is harder to prevent at scale than at the individual level. Build the following into your engineering practice:

### Code review checklist

For any retry loop, reviewers should ask:

- Is there a maximum retry count?
- Is back-off exponential?
- Is back-off jittered?
- Does the loop honour `context.Context`?
- Is there a success/failure metric?
- Is the loop tested under contention?

A short checklist in your PR template catches most issues.

### Lint and static analysis

Some patterns are mechanically detectable:

- `time.Sleep(...)` followed by `continue` in a `for` loop without a `rand` call nearby.
- `CompareAndSwap` in a `for` loop with no attempt counter.
- `TryLock` in a `for` loop without jitter.

Write custom `analysis.Analyzer` plugins or use `golangci-lint` custom rules.

### Library standards

Maintain an internal library for retry. Make it the *only* retry implementation services should use. Update it once, fix everywhere. The library should include:

- `Retry(ctx, fn, opts...)` API.
- Decorrelated jitter by default.
- Mandatory context.
- Built-in metrics.
- Built-in tracing spans for each retry.

### Training

A 30-minute internal talk on livelock for every engineer joining the platform team. Show the polite-people demo, show a real CAS-loop livelock running, show the cure. Repeat once a year.

### Game days

Quarterly game days that simulate a livelock-prone failure: a downstream slowdown, a retry storm. Practice detection, triage, mitigation. The first time you debug a livelock should not be in production.

### Post-incident review hygiene

Postmortems should be:

- Blameless.
- Published internally within one week.
- Read by anyone touching the affected service.
- Tracked: action items have owners and deadlines, with monthly review.

---

## Summary

At the professional level, livelock is a *system property* you design around, not a *bug* you fix. The patterns:

- Bound every loop, jitter every back-off, observe every success rate.
- Centralise retry policy in libraries and service-mesh configuration.
- Capacity-plan with 30% headroom; livelock lives at the saturation cliff.
- Practice incident response on game days, not first time in production.
- Write postmortems that drive durable change.

The technical work is largely the same as at senior level. The differences are scope, ownership, and discipline. A senior engineer can debug a livelock; a professional engineer designs a system where the next livelock is detected, mitigated, and fixed by code, observability, and process that already exist.

Continue to `specification.md` for the precise formal definitions and `interview.md` for high-stakes interview prep.
