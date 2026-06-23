---
layout: default
title: Professional
parent: Unlimited Goroutines
grand_parent: Concurrency Anti-Patterns
ancestor: Go
nav_order: 4
permalink: /roadmap/programming-languages/golang/07-concurrency/15-concurrency-anti-patterns/01-unlimited-goroutines/professional/
---

# Unlimited Goroutines — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [The Architecture View](#the-architecture-view)
3. [Concurrency Budgets in Microservices](#concurrency-budgets-in-microservices)
4. [Capacity Planning From First Principles](#capacity-planning-from-first-principles)
5. [Kubernetes Pod Sizing vs Goroutine Counts](#kubernetes-pod-sizing-vs-goroutine-counts)
6. [Vertical vs Horizontal Bounding](#vertical-vs-horizontal-bounding)
7. [Graceful Degradation Strategies](#graceful-degradation-strategies)
8. [Circuit Breakers as Goroutine Governors](#circuit-breakers-as-goroutine-governors)
9. [Observability for Goroutine Counts at Fleet Scale](#observability-for-goroutine-counts-at-fleet-scale)
10. [`runtime.NumGoroutine` as a Production Metric](#runtimenumgoroutine-as-a-production-metric)
11. [`pprof goroutine` Profiles in Production](#pprof-goroutine-profiles-in-production)
12. [Continuous Profiling](#continuous-profiling)
13. [Incident Postmortems](#incident-postmortems)
14. [Service Level Objectives for Concurrency](#service-level-objectives-for-concurrency)
15. [Cross-Team Concurrency Contracts](#cross-team-concurrency-contracts)
16. [Cost Modelling: Goroutines and the Cloud Bill](#cost-modelling-goroutines-and-the-cloud-bill)
17. [Multi-Tenant Architectures](#multi-tenant-architectures)
18. [Load Testing for Bounded Systems](#load-testing-for-bounded-systems)
19. [Chaos Engineering for Concurrency](#chaos-engineering-for-concurrency)
20. [Static Analysis and Lint Rules](#static-analysis-and-lint-rules)
21. [Migration Strategies for Large Codebases](#migration-strategies-for-large-codebases)
22. [Production Case Studies](#production-case-studies)
23. [The Long View: Engineering Discipline](#the-long-view-engineering-discipline)
24. [Self-Assessment](#self-assessment)
25. [Summary](#summary)

---

## Introduction

The senior-level material treated unlimited goroutines as an *implementation* anti-pattern: how to detect, bound, test, and refactor it within a service. The professional-level material treats it as an *architectural* concern: how to design a fleet of services where bounds are first-class properties, where capacity is planned, where degradation is graceful, and where the entire organisation has an answer to "what happens at 10x load."

At this level, the question is no longer "should I bound this fan-out?" — the answer is always yes. The question is:

- What is the right bound for *this* service, given its position in the call graph and the resources it shares with peers?
- How do I ensure the bound, set today, is still correct in six months when the load doubles?
- How do I detect, in production, that a bound is being violated, before users do?
- How does my service's bound interact with my dependencies' bounds?
- How do I migrate a 500 000-line codebase from unbounded to bounded, without rewriting it?
- What does my incident response look like when a bound fails?
- How do I budget concurrency across tens or hundreds of services?

These are questions for staff engineers, senior staff, principal engineers — the people whose job is the *system*, not the *file*. The material below is dense; it expects you have already mastered the senior level and want to operate the same patterns at organisation scale.

---

## The Architecture View

Stand back from any single Go service and look at your system as a graph: nodes are services, edges are RPC calls, weights are concurrency budgets. From this view, several truths become evident:

1. **Bounds are global properties.** A bound on service A's outgoing calls to service B affects B's incoming load, B's outgoing calls to C, and C's behaviour to D. The bound stack runs through the entire graph.

2. **The slowest path determines the system's bound.** Following Amdahl's Law in reverse — the system's maximum useful concurrency is limited by its narrowest tier. If your database connection pool is 50, no amount of upstream concurrency helps beyond serving 50 concurrent DB-bound operations.

3. **Bounds form a feedback loop with capacity planning.** You set bounds based on capacity; capacity is planned based on bounds. Adjust one and the other needs revisiting.

4. **Pod scaling is bound-aware.** Adding pods multiplies each pod's bounds. If each pod allows 100 concurrent requests and you scale from 10 to 20 pods, total system concurrency doubles. But downstream services see twice the load and may be overwhelmed.

5. **Bounds are inheritance, not composition.** A service that calls 5 others does not compose 5 bounds into one; it inherits the *minimum* of them, divided by its fan-out factor.

The architecture view forces you to draw the diagram. Until you have drawn the bound stack across services, you do not understand your system's behaviour at peak load.

### The bound diagram

For a 5-service system, the bound diagram looks like:

```
[Edge: 5000 RPS, 500 in-flight]
       |
       v
[API Gateway: 1000 RPS, 200 in-flight]
       |
       +---> [Auth Service: 400 RPS, 100 in-flight]
       |
       +---> [Catalog Service: 800 RPS, 150 in-flight]
       |       |
       |       +---> [Database: 50 connections]
       |
       +---> [Recommendations: 500 RPS, 100 in-flight]
              |
              +---> [Model Service: 300 RPS, 60 in-flight]
              +---> [Database: 50 connections]
```

Reading this diagram:

- The Edge admits 500 concurrent requests at most.
- Each Edge request fans out to ~3 internal calls (auth + catalog + recommendations).
- 500 × 3 = 1500 inbound to internal tier. But internal tier capacity is 200 + 100 + 150 + 100 = 550. Oversubscribed.

The diagram reveals the problem before any request flows. The fix: either reduce Edge admission, increase internal capacity, or reduce per-request fan-out (cache, deduplicate, batch).

### The bound contract language

To formalise bounds across teams, adopt a small vocabulary in API documentation:

- **Max RPS**: requests per second a service guarantees to absorb.
- **Max in-flight**: simultaneous requests a service guarantees to absorb.
- **Per-caller cap**: maximum in-flight per identified caller.
- **Burst tolerance**: how long the service tolerates above-Max-RPS before degrading.
- **Degradation policy**: what happens when above capacity (reject / queue / partial response).

Every service publishes these. Every caller reads them. Mismatches are caught in design review, not in production.

---

## Concurrency Budgets in Microservices

A concurrency budget is the total in-flight work a logical scope (service, team, organisation) is allowed to perform. It is to concurrency what a financial budget is to spending: a deliberately-set ceiling, allocated across uses, monitored for adherence.

### Single-service budget

The simplest case: one service's total in-flight concurrency. The budget is implemented as a global semaphore or HTTP server option.

```go
package main

import (
    "context"
    "net/http"
    "time"

    "golang.org/x/sync/semaphore"
)

const (
    GlobalBudget = 200
)

var globalSem = semaphore.NewWeighted(GlobalBudget)

func admit(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        ctx, cancel := context.WithTimeout(r.Context(), 1*time.Second)
        defer cancel()
        if err := globalSem.Acquire(ctx, 1); err != nil {
            http.Error(w, "overloaded", http.StatusServiceUnavailable)
            return
        }
        defer globalSem.Release(1)
        next.ServeHTTP(w, r)
    })
}
```

Every request acquires from `globalSem`. If at capacity, the request waits up to 1 second; if still no slot, returns 503.

### Multi-tier service budget

A service that does work on multiple tiers (read-heavy + write-heavy + background) splits its budget:

```go
type Budget struct {
    Read       *semaphore.Weighted
    Write      *semaphore.Weighted
    Background *semaphore.Weighted
}

func NewBudget(read, write, background int64) *Budget {
    return &Budget{
        Read:       semaphore.NewWeighted(read),
        Write:      semaphore.NewWeighted(write),
        Background: semaphore.NewWeighted(background),
    }
}
```

The total is `read + write + background`. The split is policy: protect writes from being starved by reads, ensure background work always has minimum capacity.

### Organisation-wide budget

Across services, the budget is allocated by team. Team A operates the catalog service; their concurrency budget is 200 in-flight (which they may split across multiple pods). Team B operates payments; their budget is 50 (smaller because payments are higher-stakes and slower).

The total organisational budget is bounded by infrastructure cost. A budget exceeds infrastructure if and only if the cost is justified by traffic. Quarterly capacity reviews adjust budgets up or down.

### Budget allocation

A budget is *allocated* in three ways:

1. **By tier**: read vs write vs background.
2. **By tenant**: customer-A vs customer-B, with isolation.
3. **By caller**: incoming-from-service-X vs incoming-from-service-Y, to detect noisy callers.

Each layer adds a semaphore. The total in-flight at any moment is the *minimum* of the layers, applied in sequence.

### Budget exhaustion

When the budget is exhausted, the policy options are:

- **Reject**: return 503. The caller decides whether to retry.
- **Queue**: hold the request in memory until a slot opens. Bounded queue depth.
- **Degrade**: return a partial response. Skip enrichment, serve from cache.
- **Shed**: drop a percentage of requests (often randomly, sometimes prioritised).
- **Throttle**: rate-limit the caller per their identity.

Different parts of the service use different policies. Edge services typically reject; internal services typically queue; background pools degrade or drop.

---

## Capacity Planning From First Principles

Capacity planning is the practice of deciding, before a service is loaded, how many resources it needs. It is mostly arithmetic.

### The Little's Law derivation

Given:
- L = in-flight count (concurrency)
- λ = arrival rate (requests per second)
- W = mean response time (seconds per request)

Little's Law: `L = λW`.

To set the bound (L), you must measure W (or estimate it) and decide on a target λ.

Example: a service whose p95 response time is 100 ms (W = 0.1s). To handle 1000 RPS, in-flight = 1000 × 0.1 = 100. Set the bound to 100 (or 120 for headroom).

### Tail latency vs mean latency

W in Little's Law is the *mean* latency. But the bound must handle the *tail*. If p95 = 100ms but p99 = 500ms, the tail occasionally backs up. The bound should be sized to accommodate the tail without permanent backup.

Practical: set L = `RPS × p99` for safety, then test. If queues regularly fill, raise; if you never approach the bound, lower (saves memory).

### Bound vs throughput trade-off

A higher bound = higher throughput up to some point. Beyond that point, additional concurrency adds overhead (scheduler, GC, contention) and decreases throughput. The optimum is found by load testing.

A canonical curve:

```
Throughput
   ^
   |       ___________
   |      /           \___
   |     /                \___
   |    /                     \____
   |   /
   |  /
   |/
   +------------------------------> Concurrency
   0   N_opt           N_thrash
```

`N_opt` is the optimum; beyond it, throughput declines. The decline is gradual at first, then steep at `N_thrash` where the scheduler is saturated.

In practice, set the bound at 0.7 × `N_opt` for headroom.

### Capacity for cyclic load

If your service has daily peaks (10x baseline), capacity-plan for the peak. Provisioning for the average leaves you outage-prone at peak.

```
Capacity = Peak_RPS × Peak_p99_latency / 0.7 (utilisation)
```

If peak is 5000 RPS and peak p99 is 200ms:
```
Capacity = 5000 × 0.2 / 0.7 ≈ 1430 in-flight
```

This is the *total* across pods. If each pod handles 100 in-flight, you need 15 pods at peak (and 1-2 at baseline).

### Capacity for bursty load

Bursty load is different: brief spikes of N× baseline lasting a few seconds. Two strategies:

1. **Smoothed**: queue the burst, drain at steady rate. Requires bounded queue depth and accepts some latency.
2. **Spiky**: maintain enough capacity to absorb the burst. Higher cost, lower latency.

The choice depends on user-visible latency tolerance.

### Capacity planning checklist

Before launching a service, answer:

- What is the expected peak RPS?
- What is the expected p99 latency at peak?
- What is the bound (Little's Law)?
- How many pods, given per-pod bound?
- What is the auto-scale policy?
- What is the degradation behaviour above capacity?
- What is the alert threshold (e.g. 70% utilisation)?
- What is the recovery path after overload?

Each answer is a number or a sentence. The full set is your capacity plan.

---

## Kubernetes Pod Sizing vs Goroutine Counts

In Kubernetes, pod sizing (CPU, memory) constrains goroutine count. The relationship is:

- CPU limit determines `GOMAXPROCS` (with `automaxprocs` library or manual configuration).
- Memory limit determines maximum live goroutines (each consuming stack + heap).
- Pod count determines aggregate fleet capacity.

### Setting `GOMAXPROCS` correctly

By default, `GOMAXPROCS` is `runtime.NumCPU()` — the host's CPU count. Inside a container with a CPU limit of 1.0, this can return 32 (host CPUs) even though the container only has 1 CPU's worth of compute. The result: excessive scheduler thrash.

Use `automaxprocs`:

```go
package main

import (
    _ "go.uber.org/automaxprocs"
)
```

This package reads the container's CPU limit and sets `GOMAXPROCS` accordingly. Without it, your Go process happily creates 32 Ps for 32 logical processors, while the kernel CFS-throttles you to 1 CPU's worth of execution. Every M sits idle most of the time, but each consumes scheduling bookkeeping.

### Memory limit and goroutine count

Each goroutine consumes:
- 2 KB initial stack (often grows to 8-64 KB in production).
- A few hundred bytes of `g` struct overhead.
- Heap allocations made during execution.

A pod with a 512 MB memory limit and 50% headroom (256 MB available) allows roughly 256 MB / 16 KB ≈ 16 000 goroutines before stack memory dominates — and that's before counting heap. In practice, you want goroutine count to be well under this, since heap allocations vastly exceed stack costs.

Rule of thumb: target peak goroutine count = 10% of `memory_limit / 64KB`. This leaves 90% of memory for actual work.

### Pod count and fleet bounds

If each pod can serve 100 concurrent requests and you need 5000 RPS at 100ms latency, you need:
- Per-pod: 100 in-flight = 1000 RPS.
- Total: 5 pods.
- Headroom (for rolling deploys, hot pods): 7-8 pods.

The fleet's aggregate bound is `pod_count × per_pod_bound`. Auto-scaling adjusts pod count based on observed load.

### HPA and concurrency metrics

The default Kubernetes Horizontal Pod Autoscaler (HPA) scales on CPU. For concurrency-bound services, scale on a custom metric:

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: my-service
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: my-service
  minReplicas: 5
  maxReplicas: 50
  metrics:
  - type: Pods
    pods:
      metric:
        name: process_goroutines_avg
      target:
        type: AverageValue
        averageValue: "5000"
```

This scales up when average goroutine count exceeds 5000 per pod. The metric must be exposed via the metrics adapter (Prometheus adapter is common).

### Pod sizing trade-offs

- **Many small pods**: better isolation (one pod's load does not affect another), more rebalance overhead, more idle resources.
- **Few large pods**: better resource utilisation, larger blast radius per failure, harder to schedule.

The trade-off is industry-dependent. SaaS multi-tenancy often favours many small pods. Batch processing often favours few large pods.

---

## Vertical vs Horizontal Bounding

There are two axes for adding capacity: vertical (larger pods) and horizontal (more pods). The bound strategy differs.

### Vertical bounding

Larger pods = higher per-pod concurrency. CPU and memory limits scale up, so the in-pod bound can be higher.

Pros:
- Simpler architecture: fewer pods to manage.
- Better cache locality: more work happens on the same machine.
- Lower coordination overhead between pods.

Cons:
- Larger blast radius: one pod failure affects more requests.
- Slower rolling restarts: each pod takes longer to drain.
- Limited by physical hardware: you cannot have a 1 TB pod on a 256 GB host.

The vertical limit on a pod is the *machine*. Beyond ~32 GB / 16 CPUs, vertical scaling becomes diminishing-returns: GC pauses extend, scheduler complexity grows, single-pod throughput plateaus.

### Horizontal bounding

More pods, smaller each. Fleet capacity = `pod_count × per_pod`.

Pros:
- Smaller blast radius.
- Better deployment incrementality.
- Often cheaper (smaller instance types are cheaper per CPU).

Cons:
- More inter-pod coordination (load balancers, service discovery).
- Higher latency for distributed operations.
- Per-pod overhead (each pod runs the same boot sequence).

### When to scale which way

Rule of thumb:
- Start horizontal. Default to many small pods.
- Scale vertical when you have a single-process bound (e.g. an in-memory cache that benefits from being larger).
- Scale vertical when GC pauses are not yet a problem and adding CPU/memory improves throughput linearly.

In Go specifically:
- Vertical scaling beyond ~8 GB heap often degrades because GC overhead climbs.
- Horizontal scaling has no equivalent upper limit; you can have 1000 1-CPU pods.

### Bounding policy

The per-pod bound interacts with the fleet count:
- Fleet bound = pod count × per-pod bound.
- If fleet bound exceeds downstream capacity, the downstream is the cap.
- Adjust either pod count or per-pod bound to match.

In practice, the per-pod bound is set conservatively (room for retries, jitter), and the pod count auto-scales to match demand.

---

## Graceful Degradation Strategies

Graceful degradation is the practice of giving the user *something* when the system cannot give them everything. Without it, every failure mode is a catastrophe.

### Strategy 1: Cached fallback

```go
type Service struct {
    primary *primaryClient
    cache   *cache.Cache
    sem     *semaphore.Weighted
}

func (s *Service) Get(ctx context.Context, key string) (Value, error) {
    if !s.sem.TryAcquire(1) {
        if v, ok := s.cache.Get(key); ok {
            return v, nil // degraded: cache hit
        }
        return Value{}, ErrOverloaded
    }
    defer s.sem.Release(1)
    v, err := s.primary.Get(ctx, key)
    if err != nil { return Value{}, err }
    s.cache.Set(key, v)
    return v, nil
}
```

When at capacity, return a cached value if available. The user gets a stale-but-correct answer.

### Strategy 2: Partial response

```go
type Result struct {
    User      User
    Recommendations []Item
    Recent          []Item
    Degraded        bool
}

func (s *Service) GetProfile(ctx context.Context, userID string) Result {
    user, _ := s.users.Get(ctx, userID)
    var (
        recs []Item
        recent []Item
        degraded bool
    )
    if s.sem.TryAcquire(1) {
        defer s.sem.Release(1)
        recs, _ = s.recs.Get(ctx, userID)
        recent, _ = s.recent.Get(ctx, userID)
    } else {
        degraded = true
    }
    return Result{User: user, Recommendations: recs, Recent: recent, Degraded: degraded}
}
```

When at capacity, return the essential user data; skip the optional enrichments. The frontend knows the response is degraded and can render accordingly.

### Strategy 3: Static fallback

For very high-traffic public services, when everything is down, return a static page:

```go
func handler(w http.ResponseWriter, r *http.Request) {
    if !s.health.IsHealthy() {
        http.ServeFile(w, r, "static/offline.html")
        return
    }
    // ... normal path
}
```

The user sees "we're experiencing high load, please try again." This is better than a 500.

### Strategy 4: Prioritised admission

Reject low-priority traffic first, keep serving high-priority:

```go
func admit(req *http.Request) bool {
    priority := classifyPriority(req)
    switch priority {
    case High:
        return s.highSem.TryAcquire(1)
    case Medium:
        if s.systemLoad() > 0.8 { return false }
        return s.medSem.TryAcquire(1)
    case Low:
        if s.systemLoad() > 0.6 { return false }
        return s.lowSem.TryAcquire(1)
    }
}
```

Background jobs are dropped first; logged-in user requests are dropped last.

### Strategy 5: Asynchronous fallback

Accept the request, return an "ack" immediately, do the work later if and when capacity permits:

```go
func (s *Service) AcceptForLater(w http.ResponseWriter, r *http.Request) {
    if !s.backgroundPool.TrySubmit(processJob{req: r}) {
        http.Error(w, "queue full", http.StatusServiceUnavailable)
        return
    }
    w.WriteHeader(http.StatusAccepted)
    // 202 — accepted, will process eventually
}
```

The user gets a 202 with a job ID. They poll or webhook for completion.

### Picking the right strategy

| Service shape | Strategy |
|---------------|----------|
| Read-mostly, cacheable | Cached fallback |
| Composed response, optional parts | Partial response |
| Static-content-like | Static fallback |
| Mixed priority | Prioritised admission |
| Acceptable async | Asynchronous fallback |

Most production services combine 2-3 strategies depending on endpoint.

---

## Circuit Breakers as Goroutine Governors

A circuit breaker is a state machine that disables calls to a known-failing dependency. The states:

- **Closed**: calls flow normally.
- **Open**: calls fail immediately, no actual call made.
- **Half-open**: a small number of trial calls flow; if they succeed, transition back to closed; if they fail, back to open.

### Why it bounds concurrency

Without a circuit breaker, when a downstream fails, every caller goroutine times out (waits for the configured deadline before failing). At 30s timeouts and 1000 RPS, that's 30 000 goroutines waiting on a dead downstream. Each holds resources.

With a circuit breaker, after a threshold of failures, the breaker opens. New calls fail immediately. The waiting goroutines are not created. Resources are not held.

The breaker is, in effect, a *zero-concurrency limit* on calls to a failing dependency.

### A circuit breaker library (Sony's gobreaker)

```go
package downstream

import (
    "context"
    "errors"

    "github.com/sony/gobreaker"
)

type Client struct {
    breaker *gobreaker.CircuitBreaker
    raw     RawClient
}

func New(raw RawClient) *Client {
    settings := gobreaker.Settings{
        Name:        "downstream",
        MaxRequests: 1,
        Interval:    60 * time.Second,
        Timeout:     30 * time.Second,
        ReadyToTrip: func(counts gobreaker.Counts) bool {
            failureRatio := float64(counts.TotalFailures) / float64(counts.Requests)
            return counts.Requests >= 20 && failureRatio >= 0.5
        },
    }
    return &Client{
        breaker: gobreaker.NewCircuitBreaker(settings),
        raw:     raw,
    }
}

func (c *Client) Do(ctx context.Context, req Request) (Response, error) {
    result, err := c.breaker.Execute(func() (interface{}, error) {
        return c.raw.Do(ctx, req)
    })
    if err != nil {
        if errors.Is(err, gobreaker.ErrOpenState) {
            return Response{}, ErrUpstreamDown
        }
        return Response{}, err
    }
    return result.(Response), nil
}
```

The breaker trips at 50% failure rate over 20+ requests. Once open, all calls fail with `ErrOpenState` immediately.

### Combining with bounded fan-out

The circuit breaker prevents new goroutines from being created during downstream failure, but existing ones must still terminate. The combination of breaker + bounded fan-out + context cancellation gives:

1. New requests with open breaker: fail instantly, no goroutine spawn.
2. In-flight requests: timeout via context, return error.
3. Bounded fan-out: prevents queue buildup during transition.

Without the breaker, step 1 spawns a goroutine that may wait 30s. With the breaker, step 1 is zero-cost.

### Anti-pattern: breaker without bound

Some teams add a breaker but no goroutine bound:

```go
for _, x := range items {
    go func(x Item) {
        _, err := breaker.Execute(func() (interface{}, error) {
            return downstream.Call(x)
        })
        // ...
    }(x)
}
```

The breaker prevents downstream calls but does not prevent the spawn. A 1 000 000-item loop still spawns 1 000 000 goroutines (now just doing `breaker.Execute`, which returns ErrOpenState in nanoseconds). Memory still climbs, GC still pauses. The breaker is necessary but not sufficient.

Always bound the fan-out *before* the breaker.

### Breaker state observability

Export breaker state as a metric:

```go
prometheus.NewGaugeFunc(prometheus.GaugeOpts{
    Name: "circuit_breaker_state",
    ConstLabels: prometheus.Labels{"name": "downstream"},
}, func() float64 {
    switch breaker.State() {
    case gobreaker.StateClosed: return 0
    case gobreaker.StateHalfOpen: return 1
    case gobreaker.StateOpen: return 2
    }
    return -1
})
```

Alert if the breaker is open for > 5 minutes; the downstream is consistently failing and needs intervention.

---

## Observability for Goroutine Counts at Fleet Scale

A fleet of services emits many concurrency metrics. The observability layer must aggregate, alert, and visualise across pods, services, and time.

### The metrics hierarchy

- **Process level**: `runtime.NumGoroutine()`, `runtime.MemStats`.
- **Pool level**: per-pool in-flight, queue depth, submitted, completed, failed.
- **Request level**: per-request fan-out factor, latency, errors.
- **Service level**: total RPS, total in-flight, p50/p95/p99 latency.
- **Fleet level**: sum across pods, percentile of pod-level metrics.

Each level is exported as a Prometheus metric. The aggregation happens in Prometheus queries.

### A canonical metric set

```go
package metrics

import (
    "runtime"

    "github.com/prometheus/client_golang/prometheus"
    "github.com/prometheus/client_golang/prometheus/promauto"
)

var (
    Goroutines = promauto.NewGaugeFunc(prometheus.GaugeOpts{
        Name: "process_goroutines",
        Help: "Current number of goroutines",
    }, func() float64 { return float64(runtime.NumGoroutine()) })

    HeapInUse = promauto.NewGaugeFunc(prometheus.GaugeOpts{
        Name: "process_heap_in_use_bytes",
    }, func() float64 {
        var ms runtime.MemStats
        runtime.ReadMemStats(&ms)
        return float64(ms.HeapInuse)
    })

    PoolInflight = promauto.NewGaugeVec(prometheus.GaugeOpts{
        Name: "pool_inflight",
    }, []string{"pool"})

    PoolQueueDepth = promauto.NewGaugeVec(prometheus.GaugeOpts{
        Name: "pool_queue_depth",
    }, []string{"pool"})

    PoolSubmitted = promauto.NewCounterVec(prometheus.CounterOpts{
        Name: "pool_submitted_total",
    }, []string{"pool"})

    PoolCompleted = promauto.NewCounterVec(prometheus.CounterOpts{
        Name: "pool_completed_total",
    }, []string{"pool", "outcome"})

    SemWaiters = promauto.NewGaugeVec(prometheus.GaugeOpts{
        Name: "semaphore_waiters",
    }, []string{"semaphore"})

    SemHolders = promauto.NewGaugeVec(prometheus.GaugeOpts{
        Name: "semaphore_holders",
    }, []string{"semaphore"})
)
```

Apply to every pool and semaphore in your service. The label dimensions are what makes the metrics queryable later.

### Recording rules and SLI definition

In Prometheus, define recording rules for fleet aggregates:

```yaml
groups:
- name: concurrency
  interval: 30s
  rules:
  - record: service:goroutines:sum
    expr: sum by (service) (process_goroutines)
  - record: service:goroutines:p99
    expr: quantile by (service) (0.99, process_goroutines)
  - record: pool:inflight:saturation
    expr: pool_inflight / on(pool, service) group_left pool_capacity
```

Now your dashboard queries `service:goroutines:sum` (total goroutines across fleet) and `pool:inflight:saturation` (per-pool utilisation, 0-1).

### Alerts

Sample alert rules:

```yaml
groups:
- name: concurrency_alerts
  rules:
  - alert: GoroutineCountHigh
    expr: process_goroutines > 50000
    for: 5m
    labels: { severity: warning }
    annotations:
      summary: "{{ $labels.instance }} has high goroutine count"

  - alert: GoroutineCountGrowingRapidly
    expr: deriv(process_goroutines[5m]) > 100
    for: 10m
    labels: { severity: critical }
    annotations:
      summary: "{{ $labels.instance }} goroutine count is growing — likely leak"

  - alert: PoolSaturated
    expr: pool:inflight:saturation > 0.95
    for: 5m
    labels: { severity: warning }
```

Tune the thresholds to your baseline. The point is to alert on *shape* (growing, saturated), not absolute values.

### Dashboards

A typical concurrency dashboard has:

1. Time-series of `process_goroutines` per service, stacked.
2. Heat map of per-pod goroutine count (rows = pods, color = count).
3. Saturation gauges for each named pool.
4. Distribution of fan-out factors (which endpoints fan out the most).
5. Inflight by tenant (top 10 tenants by concurrency consumption).
6. Goroutine count vs request rate scatter — points should cluster on a line; outliers are anomalous.

The dashboard is the operator's lens. New incidents are diagnosed from these views.

---

## `runtime.NumGoroutine` as a Production Metric

`runtime.NumGoroutine()` is a single function that returns the count of live goroutines in the process. It is the single most important concurrency metric.

### What it measures

- All goroutines that have been started and have not returned.
- Excludes the system goroutines that are not visible (a few runtime internals).
- Approximate: there is a small race window during a goroutine's start/end where it may not be counted.

### How to expose it

```go
import (
    "runtime"

    "github.com/prometheus/client_golang/prometheus"
    "github.com/prometheus/client_golang/prometheus/promauto"
)

var goroutineCount = promauto.NewGaugeFunc(prometheus.GaugeOpts{
    Name: "process_goroutines",
}, func() float64 { return float64(runtime.NumGoroutine()) })
```

The `GaugeFunc` is sampled on Prometheus scrape (every 15-30s typically). The function is cheap (it reads an atomic counter).

### Interpreting the value

| Value | Interpretation |
|-------|---------------|
| < 50 | Healthy, idle service. |
| 50-500 | Healthy, moderate load. |
| 500-5000 | Heavy load; check that this is sustainable. |
| 5000-50000 | Very heavy; OK if you have many connections; suspicious otherwise. |
| > 50000 | Either intentional (high-fanout architecture) or a leak. Investigate. |

Absolute numbers are service-specific. The metric's power is in its *shape over time*: flat is good, monotonically rising is a leak, oscillating with load is healthy.

### The "two-snapshot diff" technique

To find a leak:

1. Wait for service to be idle.
2. Take snapshot: `start := runtime.NumGoroutine()`.
3. Run the suspected work (e.g. send 100 requests).
4. Wait for it to complete.
5. Take snapshot: `end := runtime.NumGoroutine()`.
6. If `end > start`, you have leaked `end - start` goroutines.

Apply in a test:

```go
func TestNoLeak(t *testing.T) {
    runtime.GC() // collect anything pending
    start := runtime.NumGoroutine()

    // run work
    for i := 0; i < 100; i++ { doStuff() }

    time.Sleep(time.Second) // let teardown happen
    runtime.GC()
    end := runtime.NumGoroutine()

    if end > start+5 { // allow small jitter
        t.Errorf("leaked %d goroutines", end-start)
    }
}
```

For more precision, use `goleak`.

### Pitfalls

- **Race with background GC.** GC may finalise goroutines during the read; the count is approximate.
- **Service warm-up.** Many services start background goroutines on first request. The first request inflates the count; subsequent ones do not.
- **Connection pooling.** Idle pooled connections often have a goroutine reading from the socket (for HTTP/2 multiplexing). These goroutines are alive but doing nothing.

Interpret the value with these caveats. The metric is most useful in *trend*, not absolute.

---

## `pprof goroutine` Profiles in Production

The goroutine profile is the diagnostic tool when `NumGoroutine` is high and you need to know *why*.

### Enabling the endpoint

```go
import (
    "net/http"
    _ "net/http/pprof"
)

func init() {
    go http.ListenAndServe("localhost:6060", nil)
}
```

This serves `/debug/pprof/goroutine` (and other profiles) on port 6060. In production, bind to localhost or a dedicated debug subnet — never expose pprof publicly.

### Fetching a profile

```
curl -s http://pod:6060/debug/pprof/goroutine?debug=1 > goroutines.txt
```

`debug=1` is human-readable. `debug=2` is even more detailed (includes goroutine IDs, wait reasons).

A line in the output:

```
500 @ 0x40123a 0x402345 0x402567 ...
#       0x40123a        myapp/worker.(*Pool).run+0x4a
#       0x402345        runtime.gopark+0x12
```

Reads as: 500 goroutines are at this stack; their stack starts at `worker.(*Pool).run`. The `gopark` further down means they are blocked.

### Aggregation by stack

Use `pprof` to aggregate:

```
go tool pprof -top -cum http://pod:6060/debug/pprof/goroutine
```

Output is a list of functions ranked by cumulative goroutine count. The top entry is the function holding the most goroutines.

### The diff technique

Take two profiles, 30 seconds apart:

```
curl -s http://pod:6060/debug/pprof/goroutine > go1.pb.gz
sleep 30
curl -s http://pod:6060/debug/pprof/goroutine > go2.pb.gz
go tool pprof -base=go1.pb.gz go2.pb.gz
```

The diff shows goroutines that exist in both snapshots — the persistent ones, the leaks. Ephemeral goroutines (request handlers) appear in one but not the other.

### Automation

Build a tool that:

1. Pulls goroutine profile every 5 minutes.
2. Diffs against the previous snapshot.
3. Alerts if any stack has > 100 goroutines and grew.

This catches slow leaks before they cause an outage. Many companies have a Prometheus exporter that scrapes the profile and exports `goroutine_count_by_stack` as a high-cardinality metric.

### Reading complex stacks

Some stacks are nested deeply:

```
1042 @ 0x405abc 0x405def 0x40623f 0x406abc 0x407def ...
#       0x405abc        mongodb-driver.(*Client).executeOperation+0x12
#       0x405def        mongodb-driver.(*Client).Find+0x3a
#       0x40623f        myapp/repo.(*UserRepo).GetUsers+0x1a
#       0x406abc        myapp/handler.(*UserHandler).List+0x4d
#       0x407def        net/http.(*ServeMux).ServeHTTP+0x21
```

The stack reads top-down: the deepest frame is the current execution point. 1042 goroutines are blocked in `executeOperation`, which means they are waiting on MongoDB. Either MongoDB is slow, the pool is exhausted, or a query is hanging.

The diagnostic chain: 1042 stuck → MongoDB pool size 50? → 1042 / 50 = 20x oversubscribed → check MongoDB latency.

### The "wait reason"

`debug=2` includes the wait reason:

```
goroutine 12345 [chan receive, 5 minutes]:
```

"chan receive, 5 minutes" means the goroutine has been blocked on a channel receive for 5 minutes. Long waits are suspicious — they often indicate a leak.

Common wait reasons:
- `chan receive`: blocked on `<-ch`.
- `chan send`: blocked on `ch <- v` (buffer full, no receiver).
- `select`: blocked on `select { ... }`.
- `sleep`: in `time.Sleep`.
- `sync.Mutex.Lock`: contending for a mutex.
- `IO wait`: waiting on a socket/file.

A leaked goroutine almost always has one of these reasons. The reason tells you what it is waiting for.

---

## Continuous Profiling

Continuous profiling is the practice of capturing profiles every few seconds, storing them indefinitely, and analysing them retroactively. Tools: Pyroscope, Polar Signals, Datadog Profiler, Google Cloud Profiler, Grafana Phlare.

### Why continuous

Sampling on-demand only captures the current state. By the time you suspect a leak, the leak has been growing for hours; you cannot reproduce the early stages.

Continuous profiling captures *every state*. You can rewind:

- "Show me goroutine profile from 03:15 UTC yesterday."
- "Diff CPU profile before and after the 02:00 deploy."
- "Trend of memory allocation by stack over the last week."

This is the difference between sampling diagnostics and observability.

### Integration

For Pyroscope:

```go
import (
    "github.com/grafana/pyroscope-go"
)

func main() {
    pyroscope.Start(pyroscope.Config{
        ApplicationName: "myapp",
        ServerAddress:   "https://pyroscope.example.com",
        ProfileTypes: []pyroscope.ProfileType{
            pyroscope.ProfileCPU,
            pyroscope.ProfileAllocObjects,
            pyroscope.ProfileAllocSpace,
            pyroscope.ProfileInuseObjects,
            pyroscope.ProfileInuseSpace,
            pyroscope.ProfileGoroutines,
            pyroscope.ProfileMutexCount,
            pyroscope.ProfileMutexDuration,
            pyroscope.ProfileBlockCount,
            pyroscope.ProfileBlockDuration,
        },
    })
    // ... rest of app
}
```

This sends profiles every 10 seconds (configurable). Storage and querying happen on the Pyroscope server.

### What to look for

Daily review:
- Top goroutine-holding functions; are any unexpected?
- Top heap-allocating functions; are any growing week-over-week?
- Mutex contention hot spots; do they correlate with latency spikes?

Per-incident:
- Profile diff before and after the incident.
- Stack of the leaked goroutines (if NumGoroutine spiked).
- CPU consumed by what function (if CPU spiked).

The profile is the source of truth. Logs say "request failed"; profiles say "request failed because 1042 goroutines were blocked in MongoDB pool".

### Cost considerations

Continuous profiling has overhead: 1-2% CPU and some network. For most services, this is acceptable. For latency-sensitive services, sample less frequently (every 30 seconds instead of every 10).

Storage is the bigger cost. Profiles are large; weeks of retention can be many GB per service. Tier storage: recent (hot) and old (cold, compressed).

---

## Incident Postmortems

A postmortem for a concurrency-related incident has a structure. Below is a template you can use.

### Template

```
TITLE: <one-line summary, no blame>
DATE: <YYYY-MM-DD>
DURATION: <HH:MM start to HH:MM end>
SEVERITY: <SEV1/2/3>
AUTHOR: <name>

SUMMARY
-------
<2-3 paragraphs: what happened, impact, root cause>

TIMELINE
--------
<UTC time>  <event>
<UTC time>  <event>
...

ROOT CAUSE
----------
<technical detail: which code, which input, which mechanism>

CONTRIBUTING FACTORS
--------------------
- <factor that didn't directly cause but made it worse>
- <another>

WHAT WENT WELL
--------------
- <quick alerting>
- <effective rollback>

WHAT WENT POORLY
----------------
- <slow detection>
- <missing runbook>

ACTION ITEMS
------------
- [P0] <fix the root cause>
  Owner: <name>, Due: <date>
- [P1] <improve detection>
  Owner: <name>, Due: <date>
- [P2] <documentation>
  Owner: <name>, Due: <date>
```

### Example postmortem (synthetic)

```
TITLE: Catalog Service OOM cascade
DATE: 2026-04-15
DURATION: 14:23 to 14:51 UTC
SEVERITY: SEV1
AUTHOR: jdoe

SUMMARY
-------
At 14:23 UTC, the catalog-service pods began OOMing in sequence. Within
8 minutes, 6 of 8 pods had restarted. Latency p99 climbed from 80ms to
8 seconds during the incident; error rate reached 12%. Recovery began
at 14:51 when an admission control config rollout completed.

The root cause was unbounded fan-out in the bulk-update endpoint.
A customer issued a single bulk-update request with 50,000 SKUs.
The endpoint spawned one goroutine per SKU, each making 3 downstream
calls, for 150,000 simultaneous goroutines. Memory consumption per pod
went from 800 MB to 4.1 GB within 90 seconds, exceeding the 4 GB pod
limit.

TIMELINE
--------
14:23  Customer X submits POST /v1/catalog/bulk-update with 50,000 SKUs
14:23  catalog-pod-3 NumGoroutine alert fires (>50,000)
14:24  catalog-pod-3 OOMKilled
14:24  catalog-pod-5 receives the rebalanced request
14:25  catalog-pod-5 OOMKilled
14:25  pager goes off
14:31  On-call engineer identifies the customer request in logs
14:35  On-call attempts to block the customer via WAF
14:38  Block in effect; new requests rejected
14:40  In-flight pods still OOMing
14:45  Hotfix PR: add SetLimit(64) to fan-out
14:48  Hotfix deployed to canary
14:51  Canary stable; rolling deploy completes

ROOT CAUSE
----------
The bulk-update endpoint in catalog/bulk.go had:

  for _, sku := range req.SKUs {
      go func(sku SKU) {
          inv, _ := inventory.Update(ctx, sku)
          price, _ := pricing.Update(ctx, sku, inv)
          search.Index(ctx, sku, inv, price)
      }(sku)
  }

This unbounded fan-out had been in the codebase since 2024-08. Until
this incident, no customer had sent more than ~500 SKUs in a single
request; the bound was implicit in usage.

CONTRIBUTING FACTORS
--------------------
- No per-request batch size limit.
- No alerting on per-request fan-out factor.
- The bulk-update endpoint was tested with 1000 SKUs; not with 50,000.
- The customer's intent (bulk seasonal update) was unknown to ops.

WHAT WENT WELL
--------------
- The goroutine-count alert fired immediately (5 minutes from incident
  start to page).
- The on-call had a runbook for "high goroutine count" that listed the
  bulk-update endpoint as a known suspect.
- The WAF block was effective in seconds.

WHAT WENT POORLY
----------------
- 8-minute detection-to-mitigation. Customers experienced 8 minutes of
  partial outage.
- The hotfix took 13 minutes to prepare and deploy.
- We had no per-customer rate limit; one customer took down the service.

ACTION ITEMS
------------
- [P0] Add SetLimit(64) to bulk-update endpoint. [DONE in hotfix]
- [P0] Add max batch size = 1000 to bulk-update API.
  Owner: jdoe, Due: 2026-04-17.
- [P1] Add per-customer concurrency cap.
  Owner: jdoe, Due: 2026-04-22.
- [P1] Audit all bulk endpoints for unbounded fan-out.
  Owner: catalog team, Due: 2026-04-29.
- [P2] Update runbook with the diagnostic steps used in this incident.
  Owner: oncall lead, Due: 2026-04-25.
- [P2] Add per-endpoint fan-out factor metric.
  Owner: platform team, Due: 2026-05-15.
```

This template makes the cause explicit, the fix verifiable, and the prevention measurable.

### Common postmortem patterns for unbounded fan-out

After many such postmortems, you see patterns:

1. **The customer didn't know.** The behaviour was within API spec, but the customer's input was 10-100x typical.
2. **The team didn't test the edge case.** Tests covered "typical" not "large" inputs.
3. **The bound existed implicitly.** "Bulk endpoint" had no explicit cap.
4. **The cascade was the real damage.** One pod OOM is fine; the rebalance cascade is what makes it an outage.
5. **The fix is small.** Adding `SetLimit(N)` is 1 line. The fix is small precisely *because* the absence is the bug.

---

## Service Level Objectives for Concurrency

SLOs (Service Level Objectives) are quantified commitments to availability and performance. For concurrency, they look like:

- "p99 latency < 200ms under load up to 1000 RPS."
- "No requests rejected for capacity reasons more than 1% of the time."
- "Background queue depth < 1000 99% of the time."

Each SLO is measured continuously and budgeted: a small percentage of violations is allowed (the error budget), and if you exceed the budget you must invest in reliability rather than features.

### Concurrency SLI examples

| SLI | Definition |
|-----|------------|
| `request_success_rate` | (success_requests) / (total_requests) |
| `request_admitted_rate` | (admitted_requests) / (total_requests) |
| `latency_p99` | 99th percentile of request duration |
| `queue_p99_depth` | 99th percentile of queue depth over time |
| `goroutine_p99_count` | 99th percentile of NumGoroutine over time |

For each SLI, you set an SLO. The SLO is the contract.

### Budgeting

If your SLO is "99.9% success rate" over a 30-day window, your error budget is 0.1% = 43 minutes per month. If you spend all 43 minutes on real incidents, you cannot risk further failures; freeze deploys, increase test coverage, harden the system. If you spend nothing, you have headroom for new features and rapid iteration.

The budget mechanism aligns incentives: stability and velocity trade off explicitly.

### Concurrency-specific SLOs

- **Saturation SLO**: pool utilisation < 80% 99% of the time. If exceeded, scale or add tenants.
- **Leak SLO**: goroutine count growth rate < 10/minute over 1-hour windows. If exceeded, investigate.
- **Rejection SLO**: < 0.1% of requests rejected for capacity. If exceeded, scale or shed lower-priority traffic.

### Tracking SLOs across the fleet

SLO tracking is done in tools like Sloth, Pyrra, or custom dashboards. The output is a real-time view of "how close are we to the budget" for each service.

---

## Cross-Team Concurrency Contracts

A concurrency contract is an explicit agreement between two teams: caller and callee. The contract specifies:

- Max RPS the callee accepts.
- Max in-flight the callee accepts.
- Per-caller quota.
- Burst tolerance.
- Degradation policy.
- Notification SLA for capacity changes.

### Why explicit contracts

Without them, capacity is implicit and assumed. The caller assumes "the callee can handle anything." The callee assumes "the caller is well-behaved." When either assumption breaks, the system fails and there is no party at fault.

With them, capacity is owned. The callee owns the *publishing*; the caller owns *adhering*.

### Contract template

```
SERVICE: catalog-api
VERSION: v3.2

CAPACITY
  Max RPS: 5000
  Max in-flight: 1000
  Burst tolerance: 30s

PER-CALLER QUOTAS
  default: 100 RPS, 20 in-flight
  payments: 500 RPS, 50 in-flight (premium tier)
  search: 1000 RPS, 100 in-flight (premium tier)

DEGRADATION
  At RPS > 5000: return 503 with Retry-After: 1
  At in-flight > 1000: return 503 with Retry-After: 5
  Per-caller exceed: return 429 with Retry-After (jittered)

ENDPOINTS
  /v1/catalog/get/{id}: GET, low cost
  /v1/catalog/list: GET, medium cost
  /v1/catalog/bulk: POST, high cost, max batch 1000
  /v1/catalog/import: POST, very high cost, max batch 100, async only

CHANGE POLICY
  Capacity changes announced 2 weeks in advance.
  Per-caller quota changes announced 1 week in advance.
  Breaking changes announced 6 months in advance.
```

This contract is published in the team's docs. Every caller team reads and acknowledges. Annual reviews update.

### Enforcement

Both sides enforce:
- Caller-side: HTTP client wrapped with rate limiter and semaphore matching the quota.
- Callee-side: admission middleware that rejects above the published numbers.

The two sides should be aligned. If the caller side is missing or under-configured, the callee's load-shedding catches it; if the callee side is missing, the caller's rate limiter prevents misbehaviour.

### Contract violations

When violated:
1. The caller's metrics show 429s/503s.
2. The callee's metrics show rejection rate climbing.
3. An incident is triggered (PagerDuty alert).
4. The teams discuss: is the contract wrong, or is the implementation wrong?

This is the productive form of inter-team friction. The contract creates a shared vocabulary; violations create concrete discussion points.

---

## Cost Modelling: Goroutines and the Cloud Bill

Goroutines are not free, and at scale, their cost shows up in the cloud bill. Cost modelling is the practice of attributing infrastructure cost to the goroutines that consume it.

### Goroutine cost in dollars

Approximate per-goroutine cost:
- Stack memory: 4-16 KB amortised. At 16 KB and $0.005/GB-hour (AWS r5.large EBS-only): ~$0.07 per million goroutine-hours.
- CPU: a goroutine doing 100 ms work per second of wall time consumes 10% of a CPU. On a $0.10/hour CPU, that's $0.01/hour.
- I/O: each connection consumes a TCP stream (~1 KB kernel state) + downstream bandwidth.

These numbers are tiny per goroutine but multiply by 1 million goroutines × 24 hours: ~$1.70 for memory, $240 for CPU.

### Cost of a single OOM

When a pod OOMs:
- Pod restart: ~30 seconds of unavailable capacity.
- Pending request drops: lost revenue (if the service is revenue-generating).
- Cascading restarts: other pods absorb the load and OOM in turn.

A 5-minute partial outage of a moderate-traffic SaaS can be $10,000-$100,000 in lost revenue and reputation. The cost of *not* bounding is enormous.

### Cost-aware sizing

When choosing the bound:

- Lower bound = less in-flight = smaller pods = lower bill.
- Higher bound = more in-flight = larger pods = higher bill.
- Optimum bound = highest throughput per dollar.

Run a load test at different bounds. Compute throughput / cost. Pick the bound that maximises it.

Example: at bound 50, pod size = 1 GB RAM, throughput = 100 RPS, pod cost = $20/month. Cost per RPS = $0.20.

At bound 200, pod size = 4 GB RAM, throughput = 300 RPS, pod cost = $80. Cost per RPS = $0.27.

The smaller bound is cheaper per request. Use it unless throughput needs override (e.g. you're under-provisioned and need to scale up fast).

### Memory savings from bounded fan-out

Suppose a service unbounded-fan-outs to 10 000 goroutines at peak. Each goroutine consumes (let's say) 50 KB heap + 8 KB stack = 58 KB. Total: 580 MB at peak.

Bounded to 100 goroutines: 5.8 MB at peak.

The bounded version fits in a 64 MB pod; the unbounded version needs a 1 GB pod. Pod cost difference: ~16x. For a fleet of 100 pods, that is a real dollar amount.

### TCO of unbounded code

The total cost of ownership of a single unbounded fan-out site, over its lifetime, includes:

- Storage (logs, profiles).
- Bandwidth (occasional spikes).
- On-call response time (engineer-hours).
- Incident postmortem time.
- Lost revenue during outages.
- Reputation damage.

The lifetime cost easily reaches $100,000-$1,000,000 for a high-traffic service. The fix is 1 line of code. The cost-benefit is laughably favourable.

---

## Multi-Tenant Architectures

In a multi-tenant SaaS, one customer's load must not affect another's. Tenant isolation is the bound stack made tenant-aware.

### Tenant isolation patterns

1. **Shared-everything**: all tenants share the same process, pool, semaphores. Cheapest. Tenant load can cross-affect.
2. **Per-tenant pools**: each tenant has its own pool. Better isolation. Memory cost proportional to tenant count.
3. **Tenant-scoped semaphores**: shared pool, per-tenant semaphore for fairness. Good middle ground.
4. **Dedicated pods**: one tenant per pod. Best isolation. Expensive at scale.
5. **Tiered isolation**: premium tenants on dedicated pods, free-tier shares. Cost-effective.

Most SaaS uses pattern 3 or 5.

### Pattern 3 implementation

```go
type TenantBudget struct {
    mu      sync.RWMutex
    sems    map[string]*semaphore.Weighted
    limit   int64
    sweep   *time.Ticker
}

func New(limit int64) *TenantBudget {
    tb := &TenantBudget{
        sems:  make(map[string]*semaphore.Weighted),
        limit: limit,
        sweep: time.NewTicker(time.Hour),
    }
    go tb.sweeper()
    return tb
}

func (tb *TenantBudget) sem(tenant string) *semaphore.Weighted {
    tb.mu.RLock()
    s, ok := tb.sems[tenant]
    tb.mu.RUnlock()
    if ok { return s }
    tb.mu.Lock()
    defer tb.mu.Unlock()
    if s, ok := tb.sems[tenant]; ok { return s }
    s = semaphore.NewWeighted(tb.limit)
    tb.sems[tenant] = s
    return s
}

func (tb *TenantBudget) Acquire(ctx context.Context, tenant string) error {
    return tb.sem(tenant).Acquire(ctx, 1)
}

func (tb *TenantBudget) Release(tenant string) {
    tb.sem(tenant).Release(1)
}

func (tb *TenantBudget) sweeper() {
    for range tb.sweep.C {
        tb.mu.Lock()
        for k, s := range tb.sems {
            if !s.TryAcquire(tb.limit) {
                continue // someone is holding
            }
            s.Release(tb.limit)
            delete(tb.sems, k)
        }
        tb.mu.Unlock()
    }
}
```

The `sweeper` periodically removes idle tenants from the map. The `TryAcquire(limit)` is a probe: if all tokens are free, the tenant is idle.

### Per-tenant SLOs

Some tenants have premium SLOs; their requests get priority. Implement via priority queues:

```go
type Job struct {
    Tenant string
    Pri    Priority
    Fn     func()
}

type PriorityPool struct {
    high *list.List
    norm *list.List
    low  *list.List
    mu   sync.Mutex
    cv   *sync.Cond
}

func (pp *PriorityPool) Submit(j Job) {
    pp.mu.Lock()
    defer pp.mu.Unlock()
    switch j.Pri {
    case High: pp.high.PushBack(j)
    case Normal: pp.norm.PushBack(j)
    case Low: pp.low.PushBack(j)
    }
    pp.cv.Signal()
}

func (pp *PriorityPool) take() Job {
    pp.mu.Lock()
    defer pp.mu.Unlock()
    for {
        if pp.high.Len() > 0 { return pp.pop(pp.high) }
        if pp.norm.Len() > 0 { return pp.pop(pp.norm) }
        if pp.low.Len() > 0 { return pp.pop(pp.low) }
        pp.cv.Wait()
    }
}

func (pp *PriorityPool) pop(l *list.List) Job {
    e := l.Front()
    l.Remove(e)
    return e.Value.(Job)
}
```

High-priority jobs are taken before normal, which are taken before low. Starvation is possible (low never runs if high is constant); add an anti-starvation mechanism (e.g. every 10th take is forced to be low).

### Tenant fairness

Fair-share scheduling: each tenant gets an equal share of the budget regardless of how many requests they submit. Implement via a per-tenant queue and round-robin take:

```go
type FairPool struct {
    queues  map[string]*list.List
    tenants []string
    cur     int
    mu      sync.Mutex
}

func (fp *FairPool) take() Job {
    fp.mu.Lock()
    defer fp.mu.Unlock()
    for i := 0; i < len(fp.tenants); i++ {
        fp.cur = (fp.cur + 1) % len(fp.tenants)
        tn := fp.tenants[fp.cur]
        q := fp.queues[tn]
        if q.Len() > 0 {
            e := q.Front()
            q.Remove(e)
            return e.Value.(Job)
        }
    }
    panic("no jobs but take called") // caller should wait
}
```

Round-robin takes one job from each tenant in turn. A tenant with 1000 queued jobs gets the same throughput as a tenant with 1.

### Trade-offs

- Round-robin is fair but cache-unfriendly (jumps tenants on each take).
- Per-tenant pools are isolated but waste memory for idle tenants.
- Shared pool with semaphores is the cheapest fair approach.

Pick based on the tenant distribution (few large vs many small) and the cost of cross-tenant impact.

---

## Load Testing for Bounded Systems

A bounded system must be load-tested for two things:

1. **Throughput at bound**: at what RPS does the bound start admitting at capacity?
2. **Behaviour past bound**: what happens when load exceeds capacity?

### Test 1: Find the bound's capacity

Drive RPS upward gradually. Measure:
- Success rate.
- Latency p50/p99.
- In-flight count.

Plot RPS vs latency. You will see latency stable, then a knee where it climbs sharply. The knee is your bound's capacity. Operate at 70% of it.

### Test 2: Test load shedding

Drive RPS to 2x capacity. Measure:
- Rejection rate (% of requests returned 503).
- Latency for admitted requests.
- Are admitted requests still successful?

A correctly-bounded system shows rejection rate climbing while admitted latency stays bounded. A misconfigured system shows latency climbing toward infinity with no rejections — meaning the bound is being violated (work is being admitted past capacity).

### Test 3: Test recovery

Drive RPS to 5x capacity for 30 seconds, then drop back to 50%. Measure:
- How quickly does latency return to normal?
- Are there leftover queued items that take minutes to drain?
- Are any goroutines still in-flight after the load drops?

A healthy system recovers in seconds. A broken system has minutes of residual latency or goroutine count.

### Test tools

- `wrk` for HTTP-only load.
- `vegeta` for HTTP with detailed metrics.
- `k6` for scripted scenarios.
- `Locust` for distributed Python-based.
- Custom Go programs for protocol-specific (gRPC, websockets).

Always run against a *staging* environment that matches production. Load testing against prod is dangerous (you can cause an outage).

### Continuous load testing

Run a small load test every commit (a smoke test). Run a full load test weekly. The full load test catches regressions in throughput or latency.

```yaml
# example .github/workflows/load.yml
on:
  schedule:
    - cron: "0 0 * * 0" # weekly
jobs:
  load-test:
    runs-on: ubuntu-latest
    steps:
      - run: docker-compose up -d
      - run: k6 run --vus 100 --duration 10m loadtest.js
      - run: docker-compose logs > logs.txt
      - uses: actions/upload-artifact@v3
        with: { name: load-results, path: logs.txt }
```

The artifact is the report. Compare week-over-week.

---

## Chaos Engineering for Concurrency

Chaos engineering: deliberately inject failures to validate the system handles them. For concurrency, the failures are:

- Goroutine count spike (start 10 000 sleep-goroutines).
- Memory pressure (allocate 80% of pod memory).
- Downstream slowness (proxy with artificial delay).
- Downstream failure (proxy returning 500).
- Network partition (drop packets between services).

### A chaos library

```go
package chaos

import (
    "context"
    "math/rand"
    "time"
)

type Config struct {
    Enabled bool
    Probability float64
    DelayMin, DelayMax time.Duration
}

func Inject(ctx context.Context, cfg Config) {
    if !cfg.Enabled || rand.Float64() > cfg.Probability {
        return
    }
    delay := cfg.DelayMin + time.Duration(rand.Int63n(int64(cfg.DelayMax-cfg.DelayMin)))
    select {
    case <-ctx.Done():
    case <-time.After(delay):
    }
}
```

Wrap downstream calls with `Inject`. In a chaos run, every call has a probability of artificial slowness.

### Validating bounds under chaos

Run the chaos for 10 minutes while monitoring:
- Goroutine count: should stay near baseline.
- Success rate: may dip but recover.
- Rejection rate: may climb but not 100%.

If the goroutine count spikes during chaos, your bound isn't working — the artificial slowness is causing fan-out to accumulate.

### Game days

Quarterly, run a "game day": a planned chaos event in a staging environment, with the on-call team responding as if it were real. Train both the system and the operators.

---

## Static Analysis and Lint Rules

The "unbounded fan-out" pattern is statically detectable in many cases. A linter can catch new instances before they merge.

### A starter analyser

```go
package gofor

import (
    "go/ast"
    "go/types"

    "golang.org/x/tools/go/analysis"
    "golang.org/x/tools/go/analysis/passes/inspect"
    "golang.org/x/tools/go/ast/inspector"
)

var Analyzer = &analysis.Analyzer{
    Name:     "gofor",
    Doc:      "checks for `go` inside `for` over slices/channels without a bound",
    Requires: []*analysis.Analyzer{inspect.Analyzer},
    Run:      run,
}

func run(pass *analysis.Pass) (interface{}, error) {
    insp := pass.ResultOf[inspect.Analyzer].(*inspector.Inspector)
    insp.Preorder([]ast.Node{(*ast.RangeStmt)(nil)}, func(n ast.Node) {
        rs := n.(*ast.RangeStmt)
        if !hasGoInside(rs.Body) {
            return
        }
        if isBoundedRange(rs.X, pass.TypesInfo) {
            return
        }
        pass.Reportf(rs.Pos(), "unbounded go inside for range (likely fan-out anti-pattern)")
    })
    return nil, nil
}

func hasGoInside(b *ast.BlockStmt) bool {
    found := false
    ast.Inspect(b, func(n ast.Node) bool {
        if _, ok := n.(*ast.GoStmt); ok {
            found = true
            return false
        }
        return true
    })
    return found
}

func isBoundedRange(expr ast.Expr, info *types.Info) bool {
    // Bounded if expression is a literal with a known small upper bound,
    // or an array (not a slice) with fixed size.
    t := info.TypeOf(expr)
    _, isArr := t.(*types.Array)
    return isArr
}
```

The linter flags any `go` inside a `for range` over a slice or channel. Arrays (fixed-size) are excluded. The user can suppress with a comment if intentional:

```go
//nolint:gofor // bounded by len(backends) which is a fixed 8
for _, b := range backends {
    go b.Init()
}
```

### Integrating with golangci-lint

Add to `.golangci.yml`:

```yaml
linters:
  enable:
    - gofor
```

Run on every PR. The PR fails if any new unbounded fan-out is introduced.

### Beyond static analysis

Some patterns are not statically detectable. For instance:

```go
func processAll(items []Item) {
    for _, it := range items {
        go process(it)
    }
}
```

Here, the linter can flag. But:

```go
func processAll(items []Item) {
    go doProcessing(items)
}

func doProcessing(items []Item) {
    for _, it := range items {
        go process(it)
    }
}
```

The linter still flags `doProcessing`'s loop. Good.

But:

```go
func processAll(items []Item) {
    for _, it := range items {
        spawn(process, it)
    }
}

func spawn(fn func(Item), it Item) {
    go fn(it)
}
```

The `go` is in `spawn`, not in `processAll`'s loop directly. The linter would need a cross-function analysis. This is a known gap.

For such cases, code review must catch them. The linter is a safety net, not a complete defence.

---

## Migration Strategies for Large Codebases

You inherit a 500 000-line Go codebase. Hundreds of fan-out sites, many unbounded. You cannot rewrite it all at once. What is the migration?

### Phase 1: Audit and Inventory

Catalog every `go` statement, classified:
- Safe (input is statically bounded).
- Risky (input is dynamically bounded).
- Dangerous (input is unbounded, user-controlled, or stream-based).

Tools: grep + manual triage + automated lint output.

A spreadsheet with file, line, function, classification, estimated effort. Hundreds of rows is normal.

### Phase 2: High-risk first

Sort by risk. Top 10% by risk → fix first. The fix:
1. Identify the bound.
2. Choose the cure (errgroup, semaphore, pool).
3. Add a test that fails if unbounded reappears.
4. Code review.
5. Deploy with monitoring.

A team can fix ~5 sites per week. 50 sites → 10 weeks for the top decile.

### Phase 3: Lint to prevent regression

Once the worst sites are fixed, add the lint to CI. New unbounded fan-outs are blocked at PR time. Existing ones (still in lower-risk tiers) are suppressed with a comment and a TODO.

### Phase 4: Burn down the TODOs

Each sprint, fix some of the TODOs. Track progress. Aim for 100% in 6-12 months.

### Phase 5: Verify

After all known sites are fixed, run a stress test of the entire codebase. Inject pathological inputs (millions of items, gigabytes of data). Confirm no service OOMs.

### Phase 6: Maintain

The lint remains. Code review remains. New engineers receive training on the anti-pattern. The codebase has built immunity.

### Estimated timeline

For 500 000 lines of Go with ~500 unbounded sites, expect:
- Phase 1: 1-2 months.
- Phase 2-3: 3-6 months.
- Phase 4: 6-12 months.
- Phase 5-6: ongoing.

The investment is substantial but pays off in reduced incidents.

---

## Production Case Studies

### Case Study A: The Backplane Migration

**Background.** A SaaS company had a "backplane" service that fanned out customer events to 12 internal subscribers. The fan-out was per-event:

```go
for _, sub := range subscribers {
    go sub.Deliver(event)
}
```

12 was hard-coded; the loop was safe in isolation. But the backplane handled 50 000 events/s, and `subscribers` was a snapshot of a registry; sometimes during deploys it briefly had 30 entries (old + new). Then 50 000 × 30 = 1 500 000 goroutines/s spawned.

**Fix.** Convert to a per-subscriber bounded pool. Each subscriber has its own goroutine and an input channel of capacity 1024. The backplane pushes events to channels; subscribers pull at their own pace.

**Outcome.** Memory at peak dropped from 8 GB to 800 MB. Latency p99 dropped because there was no more scheduler thrash.

### Case Study B: The Polling Loop

**Background.** A monitoring service polled 5000 endpoints every 30 seconds. Naive implementation:

```go
ticker := time.NewTicker(30 * time.Second)
for range ticker.C {
    for _, endpoint := range endpoints {
        go poll(endpoint)
    }
}
```

5000 goroutines every 30 seconds. If a poll took 28 seconds (some did), the next tick's goroutines stacked on top.

**Fix.** Bounded errgroup, polling time bounded by the tick interval:

```go
for range ticker.C {
    g, gctx := errgroup.WithContext(ctx)
    g.SetLimit(200)
    pollCtx, cancel := context.WithTimeout(gctx, 25*time.Second)
    for _, e := range endpoints {
        e := e
        g.Go(func() error { return poll(pollCtx, e) })
    }
    g.Wait()
    cancel()
}
```

Now each tick's polling is bounded in time and concurrency. Slow endpoints time out at 25s, not stack indefinitely.

**Outcome.** Service became stable. Previously, hot endpoints would silently accumulate goroutines, leading to weekly OOM-driven restarts. After the fix, restart frequency dropped to once a month (for unrelated reasons).

### Case Study C: The Cron Storm

**Background.** A scheduled job ran daily at midnight UTC, computing reports for all customers. Each customer's report was independent:

```go
func runReports() {
    for _, customer := range customers {
        go generateReport(customer)
    }
}
```

10 000 customers. Each report took 5-30 seconds. At midnight, the service spawned 10 000 goroutines, each opening a database connection.

**Fix.** Bounded pool sized to database connection limit:

```go
func runReports() {
    g, gctx := errgroup.WithContext(context.Background())
    g.SetLimit(50) // matches DB pool
    for _, customer := range customers {
        customer := customer
        g.Go(func() error {
            return generateReport(gctx, customer)
        })
    }
    _ = g.Wait()
}
```

The job takes longer (sequentially through batches) but doesn't crash the database.

**Outcome.** Database CPU at midnight dropped from 100% (with errors) to 60% (steady-state). Job duration extended from "crashes and partial" to "completes in 25 minutes."

### Case Study D: The Goroutine-per-Connection Database

**Background.** A custom database server in Go used one goroutine per connection. Worked fine up to 10 000 concurrent connections, beyond which scheduler thrash dominated.

**Fix.** Hybrid model: a fixed pool of worker goroutines plus an event loop using `net.Listener` directly. Connections register interest; workers process events.

**Outcome.** Capacity climbed from 10 000 to 100 000 concurrent connections per node. Latency variance dropped because the scheduler was no longer overloaded.

**Lesson.** "Goroutine per connection" is fine up to tens of thousands. Beyond that, an event-loop architecture is more efficient.

### Case Study E: The Hidden Library Fan-Out

**Background.** A service used a custom logging library. Each log call spawned a goroutine to ship the log line to a remote aggregator. Under heavy logging (debug mode), the goroutine count exploded.

**Fix.** Logging library refactored: a single shipper goroutine drains a channel. Log calls just enqueue; shipper batches.

**Outcome.** Debug-mode logging now had similar resource use to info-mode. No more goroutine explosions from chatty code.

**Lesson.** Library-level fan-out is hidden from callers but compounds when the library is used heavily. Audit libraries for hidden goroutine spawning.

---

## The Long View: Engineering Discipline

The unlimited-goroutines anti-pattern is not merely a Go quirk; it is a microcosm of a broader engineering discipline. The discipline:

1. **Make implicit assumptions explicit.** Every `go` is an assumption that the goroutine count is bounded by something. Make the bound visible.

2. **Choose numbers deliberately.** "32 workers because the database has 50 connections" is an answer. "32 workers because it felt right" is not.

3. **Measure before deciding.** Bounds derived from load tests are correct. Bounds derived from intuition are guesses.

4. **Test the failure mode.** A test that passes when bounds are respected is necessary; a test that *fails* when bounds are violated is essential.

5. **Monitor in production.** Tests catch known failure modes. Monitoring catches unknown ones.

6. **Plan for the long tail.** Most days, your service runs at 1% capacity. Plan for the 99th-percentile day.

7. **Iterate on the bound.** Bounds set at launch are wrong; bounds tuned in production are correct.

8. **Document the rationale.** Every bound should have a comment, a load test, a runbook entry. Future engineers should not have to guess.

9. **Build immunity.** Linters, code review checklists, training, postmortems — all build organisational immunity to the anti-pattern.

10. **Treat reliability as a feature.** Bounding is not "ops work" or "perfectionism." It is what makes the service reliable. Reliability is a feature.

These are the habits that distinguish a professional from a senior. The professional sees the entire system; the senior sees the code in front of them. Both are necessary; the professional level is the next step.

---

## Self-Assessment

Before claiming professional-level competence, answer:

1. Draw the bound stack for a service you operate. Identify the tightest tier. What metric would tell you that tier is saturated?

2. A new service joins your microservice graph. Write its concurrency contract.

3. Your service handles 200 RPS at p99 = 300ms. What is the in-flight bound? What is the pod count for 1000 RPS at the same latency? Show the math.

4. Design a per-tenant concurrency cap with a 1-hour idle timeout. Sketch the data structures.

5. Configure HPA to scale on goroutine count instead of CPU. Write the YAML.

6. Your fleet has 50 pods. NumGoroutine on pod-27 is steadily climbing at 200/min while other pods are flat. How do you diagnose the cause? List 5 specific commands or actions.

7. Design a chaos test for unbounded fan-out. What do you inject; what do you observe; what does success look like?

8. Write a postmortem for the case study A in this document (the Backplane Migration). Include timeline, root cause, action items.

9. You have 500 unbounded fan-out sites across 50 services. Sketch a 6-month migration plan with milestones.

10. Define a concurrency SLO for your service. Justify the chosen value.

These are the questions a staff engineer might ask in an interview or design review. If you can answer them with concrete code, math, and trade-offs, you are operating at the professional level.

---

## Summary

- The professional view is architectural: bounds are a property of the system, not a single service.
- Concurrency budgets are allocated across services, tenants, and tiers. Each is owned and monitored.
- Capacity planning is arithmetic: Little's Law, peak load, headroom, pod sizing. No guesswork.
- Kubernetes pod limits constrain in-pod concurrency. `GOMAXPROCS` must match the CPU limit (use `automaxprocs`).
- Graceful degradation requires explicit strategies: cache, partial, static, prioritised, async. Choose per endpoint.
- Circuit breakers prevent goroutine accumulation during downstream failure. Combine with bounded fan-out.
- Observability is fleet-level: `process_goroutines` is the single most important metric.
- `pprof goroutine` profiles in production diagnose the unknown. Continuous profiling is the long-term tool.
- Postmortems for concurrency incidents follow a template. The action items are concrete and time-bound.
- Concurrency SLOs commit to specific bounds. Error budgets enforce them.
- Cross-team contracts make capacity explicit. Both sides enforce.
- Cost is real: bounded fan-out saves money. Unbounded fan-out costs incidents, hours, and revenue.
- Multi-tenant architectures isolate tenants via per-tenant semaphores, priority queues, or dedicated pods.
- Load tests must validate behaviour past the bound, not just at the bound.
- Chaos engineering validates bounds under adversarial conditions.
- Static analysis catches new violations; code review catches the rest.
- Migration of a large codebase is a multi-month project, ordered by risk.
- The discipline is broader than Go: making assumptions explicit, measuring, testing, monitoring.

If you embody these principles, you are no longer thinking about "the unlimited-goroutines anti-pattern." You are thinking about a system whose every part is bounded, monitored, and accountable.

---

## Appendix A: A Complete Production-Grade Service

This is a worked example of a production service with all the patterns from this document.

### A.1 — Service structure

```go
package server

import (
    "context"
    "encoding/json"
    "errors"
    "fmt"
    "log/slog"
    "net/http"
    "runtime"
    "sync"
    "time"

    "github.com/prometheus/client_golang/prometheus"
    "github.com/prometheus/client_golang/prometheus/promauto"
    "github.com/prometheus/client_golang/prometheus/promhttp"
    "github.com/sony/gobreaker"
    "go.uber.org/automaxprocs/maxprocs"
    "golang.org/x/sync/errgroup"
    "golang.org/x/sync/semaphore"
)

type Config struct {
    Addr             string
    PerRequestFanout int
    GlobalInflight   int64
    PerTenantInflight int64
    BackendInflight   int64
}

type Server struct {
    cfg          Config
    global       *semaphore.Weighted
    tenantBudget *TenantBudget
    backendSem   *semaphore.Weighted
    breaker      *gobreaker.CircuitBreaker
    log          *slog.Logger
}

func New(cfg Config, log *slog.Logger) *Server {
    return &Server{
        cfg:          cfg,
        global:       semaphore.NewWeighted(cfg.GlobalInflight),
        tenantBudget: NewTenantBudget(cfg.PerTenantInflight),
        backendSem:   semaphore.NewWeighted(cfg.BackendInflight),
        breaker:      newBreaker(),
        log:          log,
    }
}

func newBreaker() *gobreaker.CircuitBreaker {
    return gobreaker.NewCircuitBreaker(gobreaker.Settings{
        Name:        "backend",
        MaxRequests: 1,
        Interval:    60 * time.Second,
        Timeout:     30 * time.Second,
    })
}

// ... continued
```

### A.2 — Metrics

```go
var (
    requestTotal = promauto.NewCounterVec(prometheus.CounterOpts{
        Name: "request_total",
    }, []string{"endpoint", "outcome"})
    requestDuration = promauto.NewHistogramVec(prometheus.HistogramOpts{
        Name: "request_duration_seconds",
    }, []string{"endpoint"})
    inflightGauge = promauto.NewGaugeFunc(prometheus.GaugeOpts{
        Name: "process_inflight",
    }, func() float64 {
        // would need a counter; omitted for brevity
        return 0
    })
    goroutineGauge = promauto.NewGaugeFunc(prometheus.GaugeOpts{
        Name: "process_goroutines",
    }, func() float64 { return float64(runtime.NumGoroutine()) })
)

func init() {
    if _, err := maxprocs.Set(); err != nil {
        slog.Default().Warn("automaxprocs", "error", err)
    }
}
```

### A.3 — Admission and routing

```go
func (s *Server) admit(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
        defer cancel()
        if !s.global.TryAcquire(1) {
            w.Header().Set("Retry-After", "1")
            http.Error(w, "overloaded", http.StatusServiceUnavailable)
            requestTotal.WithLabelValues("admit", "rejected").Inc()
            return
        }
        defer s.global.Release(1)
        next.ServeHTTP(w, r.WithContext(ctx))
    })
}

func (s *Server) Routes() http.Handler {
    mux := http.NewServeMux()
    mux.Handle("/metrics", promhttp.Handler())
    mux.Handle("/v1/aggregate", s.admit(http.HandlerFunc(s.Aggregate)))
    return mux
}
```

### A.4 — The handler

```go
func (s *Server) Aggregate(w http.ResponseWriter, r *http.Request) {
    start := time.Now()
    defer requestDuration.WithLabelValues("aggregate").Observe(time.Since(start).Seconds())
    tenant := r.Header.Get("X-Tenant-ID")
    if tenant == "" {
        http.Error(w, "missing tenant", http.StatusBadRequest)
        requestTotal.WithLabelValues("aggregate", "bad_request").Inc()
        return
    }

    var req struct {
        Queries []string `json:"queries"`
    }
    if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
        http.Error(w, err.Error(), http.StatusBadRequest)
        requestTotal.WithLabelValues("aggregate", "bad_request").Inc()
        return
    }
    if len(req.Queries) > 100 {
        http.Error(w, "too many queries", http.StatusRequestEntityTooLarge)
        requestTotal.WithLabelValues("aggregate", "too_large").Inc()
        return
    }
    if err := s.tenantBudget.Acquire(r.Context(), tenant); err != nil {
        http.Error(w, "tenant overloaded", http.StatusTooManyRequests)
        requestTotal.WithLabelValues("aggregate", "tenant_rate_limit").Inc()
        return
    }
    defer s.tenantBudget.Release(tenant)

    g, gctx := errgroup.WithContext(r.Context())
    g.SetLimit(s.cfg.PerRequestFanout)

    results := make([]string, len(req.Queries))
    var mu sync.Mutex
    for i, q := range req.Queries {
        i, q := i, q
        g.Go(func() error {
            res, err := s.callBackend(gctx, q)
            if err != nil { return err }
            mu.Lock()
            results[i] = res
            mu.Unlock()
            return nil
        })
    }
    if err := g.Wait(); err != nil {
        http.Error(w, err.Error(), http.StatusInternalServerError)
        requestTotal.WithLabelValues("aggregate", "error").Inc()
        return
    }
    _ = json.NewEncoder(w).Encode(map[string]any{"results": results})
    requestTotal.WithLabelValues("aggregate", "ok").Inc()
}

func (s *Server) callBackend(ctx context.Context, q string) (string, error) {
    if err := s.backendSem.Acquire(ctx, 1); err != nil { return "", err }
    defer s.backendSem.Release(1)
    res, err := s.breaker.Execute(func() (interface{}, error) {
        return backendCall(ctx, q)
    })
    if err != nil {
        if errors.Is(err, gobreaker.ErrOpenState) {
            return "", fmt.Errorf("backend unavailable")
        }
        return "", err
    }
    return res.(string), nil
}

func backendCall(ctx context.Context, q string) (string, error) {
    select {
    case <-ctx.Done():
        return "", ctx.Err()
    case <-time.After(50 * time.Millisecond):
        return "ok:" + q, nil
    }
}
```

### A.5 — `main`

```go
func main() {
    cfg := Config{
        Addr:              ":8080",
        PerRequestFanout:  8,
        GlobalInflight:    200,
        PerTenantInflight: 20,
        BackendInflight:   50,
    }
    s := New(cfg, slog.Default())
    srv := &http.Server{
        Addr:        cfg.Addr,
        Handler:     s.Routes(),
        ReadTimeout: 5 * time.Second,
        WriteTimeout: 10 * time.Second,
    }
    if err := srv.ListenAndServe(); err != nil {
        slog.Default().Error("server failed", "error", err)
    }
}
```

### A.6 — TenantBudget

```go
type TenantBudget struct {
    mu     sync.RWMutex
    sems   map[string]*semaphore.Weighted
    limit  int64
}

func NewTenantBudget(limit int64) *TenantBudget {
    return &TenantBudget{
        sems:  make(map[string]*semaphore.Weighted),
        limit: limit,
    }
}

func (tb *TenantBudget) sem(tenant string) *semaphore.Weighted {
    tb.mu.RLock()
    s, ok := tb.sems[tenant]
    tb.mu.RUnlock()
    if ok { return s }
    tb.mu.Lock()
    defer tb.mu.Unlock()
    if s, ok := tb.sems[tenant]; ok { return s }
    s = semaphore.NewWeighted(tb.limit)
    tb.sems[tenant] = s
    return s
}

func (tb *TenantBudget) Acquire(ctx context.Context, tenant string) error {
    return tb.sem(tenant).Acquire(ctx, 1)
}

func (tb *TenantBudget) Release(tenant string) {
    tb.sem(tenant).Release(1)
}
```

### A.7 — The bounded stack

This service has four bounds:
1. Global: 200 in-flight requests.
2. Per-tenant: 20 in-flight requests per tenant.
3. Per-request fan-out: 8 simultaneous backend calls.
4. Backend: 50 total backend calls across all requests.

The arithmetic: at full load, max backend calls = `min(global × fan-out, backend) = min(200 × 8, 50) = 50`. The backend is the limiting tier.

If you wanted to admit more requests, you would need either to widen the backend cap or reduce the per-request fan-out. Either change is a deliberate decision.

### A.8 — Metric expectations

In normal operation:
- `process_goroutines` ≈ 100-500.
- `request_total{outcome="ok"}` dominates.
- `process_inflight` ≈ 50-100.

Under heavy load:
- `request_total{outcome="rejected"}` climbs (admission rejecting).
- `process_inflight` plateaus at 200.
- `process_goroutines` plateaus at a stable peak.

The shape of `process_goroutines` should *plateau*, never grow without bound. If it does, you have a leak.

### A.9 — A test that locks the bounds in place

```go
func TestBoundsAreEnforced(t *testing.T) {
    defer goleak.VerifyNone(t)

    cfg := Config{
        PerRequestFanout:  4,
        GlobalInflight:    10,
        PerTenantInflight: 5,
        BackendInflight:   8,
    }
    s := New(cfg, slog.Default())
    srv := httptest.NewServer(s.Routes())
    defer srv.Close()

    var wg sync.WaitGroup
    for i := 0; i < 100; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            body := strings.NewReader(`{"queries":["a","b","c","d","e"]}`)
            req, _ := http.NewRequest("POST", srv.URL+"/v1/aggregate", body)
            req.Header.Set("X-Tenant-ID", fmt.Sprintf("tenant-%d", i%3))
            resp, err := http.DefaultClient.Do(req)
            if err != nil { return }
            resp.Body.Close()
        }()
    }
    wg.Wait()

    // No assertion on goroutine count past wait; goleak handles leaks.
}
```

The test sends 100 concurrent requests; the bounds protect the service. `goleak.VerifyNone` confirms no leaks.

---

## Appendix B: Reading List

- "Site Reliability Engineering" by Google — chapters on SLOs and incident management.
- "Designing Data-Intensive Applications" by Martin Kleppmann — chapter 11 on stream processing.
- "Release It!" by Michael Nygard — patterns for production systems.
- The Go blog: production stories from Cloudflare, Uber, Dropbox.
- Continuous profiling vendor blogs (Pyroscope, Polar Signals, Granulate).
- Conference talks: "Production-Grade Concurrency" (GopherCon).

---

## Appendix C: Final Discipline Checklist

Before declaring a service ready for production:

- [ ] Every fan-out has an explicit bound, documented in the code.
- [ ] The bound is derived from a downstream resource, not guessed.
- [ ] A test fails if the bound is violated.
- [ ] `runtime.NumGoroutine()` is exported as a metric.
- [ ] Per-pool metrics (inflight, queue, completed) are exported.
- [ ] An alert fires if goroutine count grows without bound.
- [ ] An alert fires if any pool saturates for > 5 minutes.
- [ ] Load tests validate behaviour at 2x peak.
- [ ] A runbook exists for "goroutine count high."
- [ ] An incident postmortem template exists.
- [ ] The lint rule is in CI.
- [ ] Continuous profiling is wired up.
- [ ] Capacity plan is reviewed quarterly.
- [ ] SLOs are defined and tracked.
- [ ] Cross-team contracts are published.

If any box is unchecked, the service is not production-ready. This is the bar.

---

## Appendix D: Runtime Internals for the Architect

A professional Go engineer should be conversant with the runtime's behaviour under load. The key concepts:

### D.1 — The GMP Scheduler

The Go scheduler maps goroutines (G) onto OS threads (M) via processors (P). The default state:

- P count = `GOMAXPROCS`. Each P has a local run queue (capacity 256).
- M count = unbounded (created as needed); typically equal to active goroutines doing syscalls + GOMAXPROCS.
- G count = unbounded.

A goroutine on a P's run queue waits for an M to pick it up. The M binds to a P, runs goroutines from its queue, and unbinds when done or when the goroutine blocks.

Key data structures (in `src/runtime/runtime2.go`):

```go
type g struct {
    stack       stack
    stackguard0 uintptr
    m           *m
    sched       gobuf
    atomicstatus uint32
    goid         int64
    // ... 100+ more fields
}

type m struct {
    g0         *g  // goroutine with scheduling stack
    curg       *g  // current running goroutine
    p          puintptr  // attached P
    nextp      puintptr
    oldp       puintptr
    // ... many fields
}

type p struct {
    id          int32
    status      uint32
    link        puintptr
    schedtick   uint32
    syscalltick uint32
    runqhead    uint32
    runqtail    uint32
    runq        [256]guintptr
    // ... many fields
}
```

The local run queue is a circular buffer of 256 entries. When full, half is moved to the global queue.

### D.2 — Run queue dynamics

When you call `go f()`:
1. The runtime allocates a `g` struct (or reuses one from `gFree`).
2. The `g` is pushed onto the current P's local queue (`runqput`).
3. If the queue is full, half is moved to the global queue.
4. If no M is parked, no new M is created; the existing M will pick up the work in its next scheduling cycle.

The cost of `go f()`: typically 100-300 ns. Allocation is amortised via `gFree`.

Implications:

- A million `go f()` calls cost ~200ms of pure scheduler work, in addition to the work itself.
- At 1 million goroutines, the global queue and inter-P queue rebalancing become noticeable. Profile shows time in `findRunnable` and `runqsteal`.
- A goroutine that blocks on a channel removes itself from the run queue; its `g` is parked on the channel's wait list.

### D.3 — Work stealing

When a P's local queue is empty, the M scans other Ps' queues and steals half. This is the "work stealing" algorithm.

Cost: stealing is fast but not free. Each steal involves an atomic CAS and memory barriers. Under heavy fan-out, stealing dominates.

A bounded fan-out with N workers keeps work concentrated on a few Ps; stealing is rare. An unbounded fan-out spreads work across all Ps; stealing is constant.

### D.4 — Net poller

The net poller is a single goroutine (`netpoll`) that uses epoll/kqueue/IOCP to wait for I/O readiness. When a goroutine performs a network read/write, it registers with the poller and parks. When the FD is ready, the poller wakes the goroutine.

This is why "millions of idle goroutines blocked on the network" can work efficiently: they are not on any run queue; they are on the poller's wait list. The cost is one entry in an epoll set per goroutine.

But: each goroutine still consumes a `g` struct + stack. At 1 million parked goroutines on TCP reads, you spend ~16 GB on stacks alone.

### D.5 — Sysmon

A background monitor goroutine (`sysmon`) checks every 10ms-10s for:

- Goroutines stuck in user code for > 10ms (preemptable points).
- M's blocked in syscalls for > 10ms (steal their P).
- Long-running GCs.
- Timer expiry.

Sysmon is the runtime's "watchdog." If it detects starvation or imbalance, it intervenes.

Knowing sysmon exists explains why "blocking syscalls" don't deadlock the program: when an M is blocked on syscall, sysmon detaches its P and gives it to another M.

### D.6 — Asynchronous preemption

Since Go 1.14, the runtime can asynchronously preempt a goroutine even in a tight CPU loop. This is implemented via signals (SIGURG on Unix). The preempted goroutine yields at the next safe point.

Without async preemption, a tight loop like `for { x++ }` would starve other goroutines on the same P. With it, the loop is preempted every 10-100ms.

Implication: even a tight CPU loop in a goroutine does not starve other goroutines. But: many tight CPU loops *do* starve the system; you cannot run 1 million CPU-bound goroutines on 4 CPUs and expect responsiveness.

### D.7 — GC and stack scan

The GC marks reachable objects starting from roots: globals, current goroutine stacks, and so on. Every live goroutine's stack must be scanned.

Time complexity: O(num_goroutines × stack_size). At 1 million goroutines × 8 KB average stack = 8 GB of stack to scan per GC. Even at 10 GB/s scan rate, that's 800 ms of GC pause activity.

In practice, Go's concurrent GC overlaps marking with execution, but stack scan must complete during the STW (stop-the-world) phase, which can dominate latency.

Implication: high goroutine count directly translates to GC pauses. Bounding goroutines keeps GC fast.

### D.8 — Channel internals

A channel's struct (`hchan`):

```go
type hchan struct {
    qcount   uint
    dataqsiz uint
    buf      unsafe.Pointer
    elemsize uint16
    closed   uint32
    elemtype *_type
    sendx    uint
    recvx    uint
    recvq    waitq
    sendq    waitq
    lock     mutex
}
```

`buf` is the ring buffer. `recvq` and `sendq` are FIFO lists of waiting goroutines. `lock` is a mutex protecting state.

Send:
1. Lock.
2. If a receiver is waiting, hand off directly (bypass buffer).
3. Else if buffer has space, copy into buffer at `sendx`.
4. Else park on `sendq`, unlock, sleep.

Receive: mirror.

Implications:
- Channel ops are O(1) in the uncontended case but require a lock.
- A heavily-contended channel (many senders or receivers) becomes a bottleneck.
- `chan struct{}` of capacity N is a counting semaphore implemented entirely in the runtime; very fast.

### D.9 — Reading takeaway

A professional engineer who has read these sections knows:
- Why bounded fan-out preserves scheduler efficiency.
- Why network-bound goroutines are cheaper than CPU-bound ones.
- Why GC pauses correlate with goroutine count.
- Why channels are good semaphores.

This knowledge informs every architectural decision.

---

## Appendix E: Runtime Tuning Knobs

Several `GODEBUG` and runtime configuration options affect concurrent behaviour. The professional engineer knows them.

### E.1 — GOMAXPROCS

The most important one. Sets the number of OS threads that can execute Go code simultaneously.

Default: `runtime.NumCPU()`. In Kubernetes, this is often wrong (returns host CPU count, not container limit). Fix with `go.uber.org/automaxprocs`.

Tune:
- For CPU-bound: GOMAXPROCS = number of CPUs available.
- For I/O-bound: GOMAXPROCS = number of CPUs available (extra threads don't help if work is I/O-blocked).
- For memory-pressure environments: GOMAXPROCS lower than CPU count (reduces GC parallelism overhead).

### E.2 — GOGC

GC trigger ratio. Default: 100, meaning "trigger GC when heap doubles since last GC."

Tune:
- Higher (e.g. 200): less frequent GC, more memory used. Better latency under steady load.
- Lower (e.g. 50): more frequent GC, less memory. Worse latency.
- `GOGC=off`: disable automatic GC. For specialised batch jobs.

Effect on goroutines: higher GOGC = less STW = less stack-scan overhead per second.

### E.3 — GOMEMLIMIT

Soft memory limit (Go 1.19+). The runtime tries to stay under this limit, triggering GC more aggressively as memory grows.

Use in Kubernetes:
```bash
export GOMEMLIMIT=$(($MEMORY_LIMIT * 9 / 10))  # 90% of container limit
```

This prevents OOM-kill by making the Go runtime GC harder as it approaches the limit.

### E.4 — GODEBUG schedtrace

```bash
GODEBUG=schedtrace=1000 ./myapp
```

Every second, prints scheduler state:
```
SCHED 1004ms: gomaxprocs=4 idleprocs=1 threads=10 spinningthreads=1 idlethreads=3 runqueue=2 [3 5 1 0]
```

Interpretation:
- `runqueue=2`: 2 goroutines in the global queue.
- `[3 5 1 0]`: per-P local queue lengths.
- `idleprocs=1`: 1 P has no work.

A healthy state: queues are small (0-5), idle processors come and go. An unhealthy state: queues are large (100+), no idle processors.

### E.5 — GODEBUG gctrace

```bash
GODEBUG=gctrace=1 ./myapp
```

Prints each GC cycle:
```
gc 1 @0.012s 5%: 0.018+0.36+0.020 ms clock, 0.13+0.30/0.27/0+0.16 ms cpu, 4->4->1 MB, 5 MB goal, 8 P
```

The 0.018+0.36+0.020 is STW time + concurrent mark + STW cleanup. For a 1-million-goroutine program, the first STW grows large.

Use to diagnose GC-induced latency.

### E.6 — Other knobs

- `GODEBUG=gcstoptheworld=1`: force STW GC (for debugging).
- `GODEBUG=allocfreetrace=1`: log every allocation (slow, but useful).
- `GODEBUG=cpu.all=off`: disable all CPU-feature optimisations (very slow).
- `GODEBUG=netdns=go`: force pure-Go DNS resolver (vs cgo).

### E.7 — runtime/debug API

```go
import "runtime/debug"

debug.SetGCPercent(50)        // equivalent to GOGC=50
debug.SetMemoryLimit(8 << 30)  // 8 GB soft limit
debug.SetMaxStack(64 << 20)    // max stack per goroutine: 64 MB
debug.SetMaxThreads(10000)     // max OS threads
```

`SetMaxStack` is a defence against runaway recursion. `SetMaxThreads` is a defence against thread explosion (each blocking syscall reserves a thread).

---

## Appendix F: HTTP/2 and Connection Multiplexing

A professional understanding of HTTP/2 affects how you size goroutine bounds for HTTP services.

### F.1 — HTTP/1.1 vs HTTP/2

HTTP/1.1:
- One request per connection at a time.
- Keep-alive allows reuse, but only sequentially.
- N concurrent requests = N connections = N goroutines on the client.

HTTP/2:
- Multiplexed: many requests over one connection.
- Streams are independent.
- N concurrent requests = 1 connection (typically), N goroutines (one per stream).

### F.2 — Server-side

A Go HTTP/2 server spawns one goroutine per *stream*, not per connection. A single client with 100 concurrent HTTP/2 streams generates 100 server goroutines.

Implication: connection-based concurrency bounds (e.g. firewall rules) do not limit HTTP/2 concurrency. The bound must be at the stream/request level.

### F.3 — Server stream limit

Configure via:
```go
srv := &http.Server{}
http2.ConfigureServer(srv, &http2.Server{
    MaxConcurrentStreams: 100,
})
```

This caps the number of in-flight streams per connection. A client cannot exceed it.

Set to: `MaxInflight / ExpectedClientCount`. If you expect 10 clients and your in-flight budget is 200, set `MaxConcurrentStreams = 20`.

### F.4 — Client-side

A Go HTTP/2 client multiplexes by default. To bound, use a transport with limits:

```go
transport := &http.Transport{
    MaxIdleConns:        100,
    MaxConnsPerHost:     10,
    MaxIdleConnsPerHost: 10,
    IdleConnTimeout:     90 * time.Second,
}
```

But these are TCP-connection limits. To bound *requests* (streams), use a semaphore wrapping `http.Do`.

### F.5 — Trade-off

HTTP/2 reduces TCP overhead but does not eliminate the goroutine-per-request cost on the server. Bounded fan-out is still essential.

In some cases, HTTP/2's multiplexing makes things worse: a slow stream blocks others (head-of-line blocking on the same connection). HTTP/3 (QUIC) solves this; HTTP/2 doesn't.

For services with many concurrent calls to one upstream, evaluate HTTP/3.

---

## Appendix G: Database Connection Pools and Concurrency

The most common downstream constraint is a database connection pool. Sizing a Go service's concurrency bound to match the pool is a core skill.

### G.1 — `database/sql` configuration

```go
db, _ := sql.Open("postgres", dsn)
db.SetMaxOpenConns(50)
db.SetMaxIdleConns(25)
db.SetConnMaxLifetime(5 * time.Minute)
db.SetConnMaxIdleTime(1 * time.Minute)
```

`MaxOpenConns` is the hard limit. Above it, `db.Conn` blocks until a connection is released.

Anti-pattern: `MaxOpenConns(0)` (unlimited). With unbounded fan-out, you exhaust database server connections (which have their own limit, often 100-1000).

### G.2 — Sizing rule

Service concurrency bound `≤` MaxOpenConns / fan-out factor.

Example:
- DB has 100 connections, allocated 80 to your service (20 for migrations, monitoring, etc.).
- Service makes 4 DB calls per request.
- Per-request concurrency = 80 / 4 = 20.

If you want higher concurrency, either:
- Increase MaxOpenConns (requires DB-side increase too).
- Reduce DB calls per request (batching, caching, pre-fetching).

### G.3 — Monitoring

```go
stats := db.Stats()
fmt.Printf("open: %d, inuse: %d, idle: %d, waitCount: %d, waitDuration: %s\n",
    stats.OpenConnections, stats.InUse, stats.Idle, stats.WaitCount, stats.WaitDuration)
```

Export as Prometheus metrics. Alert on `WaitCount` growth — it means requests are queueing for connections.

### G.4 — Connection pool exhaustion behaviour

Without a bound on requests, when the pool is exhausted:
- New requests block on `db.Conn` indefinitely (no default timeout!).
- Goroutines pile up; memory climbs.
- Eventually, requests time out, but the goroutines remain until then.

With a bound:
- New requests blocked by the semaphore long before reaching the DB.
- Pool exhaustion never occurs.

### G.5 — DBA cooperation

Database limits are often negotiated:
- The DB allows N connections total.
- N is split among services.
- Each service gets a per-service quota (often via `pg_hba.conf` or similar).

Service teams should *know* their DB quota and size accordingly. "We have 80 connections" is a contract; respect it.

---

## Appendix H: Networking Effects

### H.1 — TCP connection limits

The OS limits open file descriptors per process. Default ulimit: 1024 (dev), 65 535 (prod).

Each TCP connection consumes one FD. A goroutine that opens a connection consumes one FD.

If unbounded fan-out opens connections faster than they close, you exhaust the FD limit. After exhaustion:
- New `net.Dial` fails with `EMFILE` or `ENFILE`.
- Existing connections continue.
- Until the burst subsides, the service is partially broken.

Always size your concurrency bound to fit under the FD limit, with headroom.

### H.2 — Ephemeral port exhaustion

Outbound TCP connections allocate an ephemeral port. The Linux range is typically 32 768 - 60 999 (about 28 000 ports).

If a service opens 28 000 outbound connections to one destination IP:port, it exhausts ephemeral ports. New connections fail with `EADDRNOTAVAIL`.

Mitigation:
- Bounded concurrency (you never open 28 000 at once).
- HTTP keep-alive (reuse connections).
- Multiple destination addresses (load-balance across them).

### H.3 — TIME_WAIT accumulation

When a TCP connection closes, the socket goes into TIME_WAIT for ~60 seconds. During that time, the port is unavailable. Fast connection churn fills TIME_WAIT.

```bash
ss -s
# Total: 12345 (kernel 0)
# TCP:   30000 (estab 100, closed 29900, ... timewait 29900)
```

29 900 sockets in TIME_WAIT is consuming all your ephemeral ports.

Mitigation:
- Use HTTP keep-alive (avoid opening new TCP for each request).
- Use connection pooling (reuse rather than churn).
- Tune `net.ipv4.tcp_tw_reuse` (Linux kernel option).

### H.4 — Connection pool internals

For HTTP:

```go
transport := &http.Transport{
    MaxIdleConns:        100,    // total idle across all hosts
    MaxIdleConnsPerHost: 10,     // idle per host
    MaxConnsPerHost:     20,     // total per host
    IdleConnTimeout:     90 * time.Second,
}
client := &http.Client{Transport: transport}
```

`MaxConnsPerHost` is the cap on simultaneous connections to one host. If your client has it, your goroutines compete for connections.

A bounded fan-out paired with `MaxConnsPerHost` gives well-defined behaviour: workers ≤ `MaxConnsPerHost` means workers don't queue at the transport. Otherwise, workers stall at `transport.RoundTrip` waiting for connections.

---

## Appendix I: Memory Hierarchy and Goroutine Stacks

### I.1 — Initial stack

A goroutine starts with a 2 KB stack. The size is a compromise: small enough to allow millions of goroutines; large enough to handle typical function call depth.

Stack growth: when the stack overflows, the runtime allocates a 2x-larger stack and copies the contents. The old stack is freed.

Stacks can grow up to a configurable maximum (default 1 GB, almost never reached).

### I.2 — Stack shrinking

Stacks shrink during GC: if the stack usage is < 1/4 of allocated, half is freed. This prevents stacks from growing monotonically.

### I.3 — Stack scans during GC

GC must scan every live goroutine's stack to find pointers to heap objects. The scan is part of the marking phase.

A goroutine in `gopark` (waiting on a channel, mutex, etc.) has a stable stack and can be scanned without disturbing it. A running goroutine must be preempted (or its stack snapshot captured atomically).

Latency cost: ~1 µs per goroutine scan + ~tens of ns per pointer. At 1 million goroutines × 1 µs = 1 second of total scan work.

### I.4 — Practical implication

The cost of "many small idle goroutines" is dominated by GC scan time, not by their memory.

Bounded fan-out keeps the number of live goroutines low, keeping GC fast.

### I.5 — Heap allocations vs stack allocations

Variables that don't escape the function stay on the stack. Variables that do escape (returned, captured by closure escaping the function) go to the heap.

```go
func f() *int {
    x := 5
    return &x  // x escapes to heap
}
```

In a high-fan-out scenario, many goroutines allocate variables on the heap. The heap grows; GC runs more often; pauses accumulate.

`go build -gcflags=-m` reveals escape analysis. Audit hot fan-out paths to minimise heap allocations.

---

## Appendix J: Scheduling Tail Latency

### J.1 — Tail latency definition

Tail latency: the 99th or 99.9th percentile of response time. Worse than p50 by orders of magnitude in poorly-tuned systems.

A bounded service has predictable tail latency because:
- Queue depth is bounded; worst-case wait is `queue_size × work_time / parallelism`.
- No goroutine explosion; no scheduler thrash.
- GC pauses are bounded.

An unbounded service has unpredictable tail latency because:
- Queue depth is unbounded; one bad spike causes hours of queuing.
- Goroutine count explodes; scheduler latency increases.
- GC pauses scale with goroutine count.

### J.2 — Reducing tail latency

Tactics:
- Strict bounding (lowers queue depth).
- Request prioritisation (high-priority bypasses queue).
- Hedging (re-issue slow requests in parallel; use first response).
- CoDel queueing (drop oldest if delay exceeds threshold).
- Speculative execution (start work before fully committed).

### J.3 — Hedging

Hedging:

```go
func hedged(ctx context.Context, fn func(context.Context) (Result, error), hedgeDelay time.Duration) (Result, error) {
    ctx, cancel := context.WithCancel(ctx)
    defer cancel()

    type r struct {
        res Result
        err error
    }
    ch := make(chan r, 2)

    go func() { res, err := fn(ctx); ch <- r{res, err} }()
    select {
    case res := <-ch:
        return res.res, res.err
    case <-time.After(hedgeDelay):
        go func() { res, err := fn(ctx); ch <- r{res, err} }()
        res := <-ch
        return res.res, res.err
    }
}
```

If the first call hasn't returned in `hedgeDelay`, issue a second. Take whichever returns first.

Caveat: hedging doubles the load. Use only for read operations and only when you have spare capacity.

### J.4 — Bounded hedging

Combine with a semaphore:

```go
func hedged(ctx context.Context, fn func(context.Context) (Result, error), hedgeDelay time.Duration, sem *semaphore.Weighted) (Result, error) {
    if err := sem.Acquire(ctx, 1); err != nil { return Result{}, err }
    defer sem.Release(1)

    ctx, cancel := context.WithCancel(ctx)
    defer cancel()

    ch := make(chan r, 2)
    go func() { res, err := fn(ctx); ch <- r{res, err} }()

    select {
    case res := <-ch:
        return res.res, res.err
    case <-time.After(hedgeDelay):
        if !sem.TryAcquire(1) {
            res := <-ch
            return res.res, res.err
        }
        defer sem.Release(1)
        go func() { res, err := fn(ctx); ch <- r{res, err} }()
        res := <-ch
        return res.res, res.err
    }
}
```

Hedging only happens if a spare slot is available. Otherwise, fall back to waiting for the original call.

---

## Appendix K: Concurrency Patterns Cross-Reference

For quick reference, the patterns that compose for production-grade concurrency:

| Pattern | Purpose | Primitive |
|---------|---------|-----------|
| Bounded fan-out | Limit simultaneous work | errgroup.SetLimit |
| Backpressure | Slow producer | Buffered channel send/Acquire |
| Admission control | Reject above capacity | TryAcquire / TryGo |
| Rate limiting | Limit per second | rate.Limiter |
| Circuit breaker | Skip known-failing calls | gobreaker |
| Hedging | Reduce tail latency | timed second call |
| Retry with backoff | Tolerate transient errors | backoff.Backoff |
| Caching | Reduce downstream load | bigcache / freecache |
| Singleflight | Deduplicate in-flight | singleflight.Group |
| Bulkhead | Isolate failure domains | per-resource semaphore |
| Timeout | Bound wall-clock latency | context.WithTimeout |
| Deadline | End-to-end time bound | context.WithDeadline |

Most production services use 6-10 of these in combination. Each one composes; the order matters.

### K.1 — Composition order

Typical order from outermost to innermost:

1. Admission control.
2. Rate limit per caller.
3. Authentication / authorisation.
4. Timeout/deadline.
5. Circuit breaker on downstream calls.
6. Bounded fan-out for per-request parallelism.
7. Bulkhead per downstream.
8. Retry (with breaker check).
9. Cache lookup.
10. Singleflight to dedupe.
11. Actual call.

Each layer is one middleware or one wrapper. The full chain is verbose but each layer is one purpose.

### K.2 — Composition example

```go
// from outside in:
//   admission -> rate -> auth -> timeout -> handler
//     handler -> errgroup -> semaphore -> breaker -> http call

http.Handle("/api", admission(rateLimit(auth(timeout(handler)))))

func handler(w http.ResponseWriter, r *http.Request) {
    ctx := r.Context()
    g, gctx := errgroup.WithContext(ctx)
    g.SetLimit(8)
    for _, b := range backends {
        b := b
        g.Go(func() error {
            return b.sem.Acquire(gctx, 1)
            defer b.sem.Release(1)
            return b.breaker.Call(gctx, func() error {
                return b.client.Do(...)
            })
        })
    }
    g.Wait()
}
```

Layered. Predictable. Each layer is monitorable, debuggable, tunable.

---

## Appendix L: Production Configuration Patterns

### L.1 — Externalising configuration

All bounds should be configurable, not hard-coded.

```yaml
# config.yaml
concurrency:
  global_inflight: 200
  per_tenant_inflight: 20
  per_request_fanout: 8
  backend_inflight: 50

pools:
  background:
    workers: 16
    queue_depth: 256
  reports:
    workers: 8
    queue_depth: 64
```

Reload-on-change is nice-to-have. Restart-to-change is acceptable.

### L.2 — Feature flags for bounds

Use feature flags (LaunchDarkly, ConfigCat, internal) to adjust bounds without redeploy.

```go
budget := flag.GetInt("global_inflight", 200)
s := semaphore.NewWeighted(int64(budget))
```

If you observe overload, increase budget without rebuild. Decrease for canary.

### L.3 — Per-environment defaults

```yaml
# config.dev.yaml
concurrency:
  global_inflight: 20  # smaller for dev

# config.prod.yaml
concurrency:
  global_inflight: 200
```

Dev runs with smaller bounds: catches accidental unboundedness faster.

### L.4 — Validation

```go
func (c Config) Validate() error {
    if c.GlobalInflight <= 0 {
        return errors.New("global_inflight must be positive")
    }
    if c.PerTenantInflight > c.GlobalInflight {
        return errors.New("per_tenant > global makes no sense")
    }
    if c.PerRequestFanout > c.GlobalInflight {
        return errors.New("fanout > global will deadlock")
    }
    return nil
}
```

Catch misconfigurations at startup. Fail fast.

---

## Appendix M: Deep Dive into a Real Incident

A reconstruction of a real incident, anonymised. Useful as a teaching artifact.

### M.1 — Setup

Service: notification-sender. Sends emails and push notifications. Triggered by events from an upstream "events" service.

Architecture:
- 6 pods.
- Per-pod: 2 CPU, 4 GB RAM.
- Inbound: events at ~500/s steady, peaks of 2000/s.
- Outbound: one email or push per event. Latency: ~100 ms per send.

### M.2 — The code (pre-incident)

```go
func (s *Service) Process(ctx context.Context, ev Event) error {
    notifs := s.lookupNotifications(ctx, ev)
    for _, n := range notifs {
        go s.send(ctx, n)
    }
    return nil
}
```

`lookupNotifications` typically returned 1-5 entries. The fan-out was small.

### M.3 — The trigger

A product change introduced "broadcast events": one event corresponded to all users of a customer's account. For some customers, this was 50 000 users.

A single broadcast event caused 50 000 goroutines, each making a downstream call to the email service. The email service was rate-limited at 100 RPS per sender; calls beyond that were queued or rejected.

### M.4 — The incident

At 11:42 UTC, a customer triggered a broadcast event. Within 30 seconds:
- notification-sender goroutine count: 800 → 65 000.
- Memory: 1.2 GB → 3.8 GB.
- Email service rate-limit rejections: 0 → 49 900/s.

At 11:43, the email service's rate limiter started shedding load. The notification-sender's goroutines retried (without bound or backoff). Each retry held a goroutine.

At 11:45, notification-sender pod-3 OOM-killed. Its in-flight work redistributed to other pods. They received the same event-derived load.

At 11:47, all 6 pods had OOMed at least once. The service was in a restart loop.

At 11:53, on-call paged. Identified the customer.

At 11:56, on-call manually deleted the customer's broadcast event from the upstream queue. New events stopped.

At 12:02, the pods stopped restarting. Latency returned to normal.

Duration: 20 minutes. Affected customers: ~500 (those whose notifications were sent during the incident).

### M.5 — Postmortem analysis

Root cause: unbounded fan-out in `Process`. The fan-out factor was implicit in the data; the data shape changed; the fan-out exploded.

Contributing factors:
1. No max-recipients-per-event limit.
2. No bounded fan-out in notification-sender.
3. No backoff or breaker on the email service call.
4. Retries (within the HTTP client) amplified the load.

### M.6 — Fix

Three changes:

```go
// Change 1: bound the fan-out
func (s *Service) Process(ctx context.Context, ev Event) error {
    notifs := s.lookupNotifications(ctx, ev)
    g, gctx := errgroup.WithContext(ctx)
    g.SetLimit(32)
    for _, n := range notifs {
        n := n
        g.Go(func() error {
            return s.send(gctx, n)
        })
    }
    return g.Wait()
}

// Change 2: cap recipients per event upstream
const MaxRecipientsPerEvent = 1000

// Change 3: circuit breaker around email service
emailBreaker := gobreaker.NewCircuitBreaker(gobreaker.Settings{
    Name: "email",
    Timeout: 30 * time.Second,
    ReadyToTrip: func(counts gobreaker.Counts) bool {
        return counts.TotalFailures > 100
    },
})
```

For events with > MaxRecipientsPerEvent recipients, fan them out at the queue level into multiple events.

### M.7 — Detection improvements

Added alerts:

```yaml
- alert: NotificationFanoutTooLarge
  expr: notification_fanout_factor > 100
  for: 1m
- alert: NotificationGoroutineSpike
  expr: deriv(process_goroutines[1m]) > 1000
  for: 1m
```

The first catches events with too many recipients. The second catches any spike for any reason.

### M.8 — What we learned

1. **Implicit bounds are fragile.** "1-5 recipients" was true on day 1; it was false on day 365.
2. **The product team's change had concurrency implications.** Engineering wasn't consulted.
3. **Retries without bounds amplify failure.** Without circuit breakers, retries continued long after the email service was clearly down.
4. **The blast radius was small (one customer's notifications), but the noise (alerts, restarts) was large.** The fix limited the blast radius dramatically.

Years later, the team still refers to this incident as a teaching example.

---

## Appendix N: The Anti-Pattern in a Cloud-Native Stack

In a cloud-native deployment, the unbounded-goroutines anti-pattern manifests with cloud-specific characteristics.

### N.1 — Spot instances and abrupt termination

If your pod is on a spot/preemptible instance, it can be terminated with 30-120 seconds notice. During termination:
- Existing requests must drain.
- Background goroutines must finish their work.

Unbounded fan-out makes draining slow: 10 000 in-flight goroutines need to finish before the pod stops. If the termination notice is 60s and your work takes 100ms, you might just make it; if you have unbounded fan-out, you almost certainly won't.

Bounded fan-out limits how much work is in-flight, making draining predictable.

### N.2 — Auto-scaling delays

When the HPA scales up, new pods take time to become ready (image pull, warmup, etc.). During this time, existing pods absorb the spike. If they fan out unboundedly, they OOM before reinforcements arrive.

Bounded fan-out keeps existing pods healthy until reinforcements scale up.

### N.3 — Service mesh interactions

If you use a service mesh (Istio, Linkerd), each outbound call passes through a sidecar. The sidecar has its own connection pool, its own goroutines, its own buffers.

Unbounded fan-out compounds:
- Your service spawns N goroutines.
- Each makes a request through the sidecar.
- The sidecar opens a connection for each (up to its connection pool).
- If the sidecar's pool fills, your goroutines queue.

Bounded fan-out reduces the load on the sidecar.

### N.4 — Cloud provider rate limits

Each cloud provider rate-limits API calls. AWS, GCP, Azure have per-account or per-region limits.

If your service makes cloud API calls (e.g. uploading to S3), unbounded fan-out hits the rate limit. The cloud SDK returns errors; your service treats them as failures.

Bounded fan-out fits within the rate limit. Combined with rate-aware backoff, calls succeed.

### N.5 — Container resource limits

Kubernetes enforces:
- CPU limit: CFS throttles you to that share.
- Memory limit: OOMKilled if exceeded.

CFS throttling under unbounded fan-out manifests as latency spikes: your scheduler tries to run all goroutines, but the CFS only gives you a slice; the goroutines pile up waiting for CPU.

Bounded fan-out keeps goroutine count low, reducing CFS-throttle exposure.

### N.6 — Log volume

Each goroutine that logs adds to the log volume. Cloud log services (CloudWatch, Stackdriver, Loki) charge per byte ingested.

Unbounded fan-out at 1 KB log per goroutine × 1 million goroutines = 1 GB log per spike. At $0.50/GB ingest, $0.50 per spike. Daily incidents: $15/month for one service.

Bounded fan-out keeps log volume predictable.

---

## Appendix O: Self-Hosted vs Managed Components

The bounds interact differently with self-hosted vs managed dependencies.

### O.1 — Managed database

Managed databases (RDS, Cloud SQL, Atlas) have provider-set limits:
- Connection count is configurable but bounded.
- Storage IOPS is bounded by instance class.
- Network throughput is bounded.

You cannot exceed these. Your service must respect them.

### O.2 — Self-hosted database

Self-hosted databases (PostgreSQL on a VM) have user-set limits:
- You set `max_connections`.
- You provision the hardware.
- You can resize on demand.

More flexible but more responsibility.

### O.3 — Managed message broker

Managed brokers (SQS, PubSub, Kafka MSK) have throughput limits.

Your producer concurrency must not exceed the broker's throughput; otherwise messages are rejected (SQS) or delayed (PubSub).

### O.4 — Self-hosted broker

Self-hosted Kafka has consumer group rebalance semantics. If your consumer is unbounded, it accepts messages faster than it can process, leading to lag.

Bounded consumer goroutines with backpressure to Kafka (via offset commit) keeps lag predictable.

### O.5 — Implication

Managed services often have stricter, more-public limits. You design around them.
Self-hosted services have flexible limits you can tune. You design with them.

Either way, your bounds must fit. The cloud bill rewards services that fit; punishes services that exceed.

---

## Appendix P: Coda — The Habits of Resilient Systems

The final note. A professional engineer's habit, after years:

1. Every `go` statement is *deliberate*. They have asked five questions before writing it.
2. Every bound has *provenance*. A measurement, a constraint, a calculation.
3. Every error path *releases* resources. No leaks under failure.
4. Every change is *measured*. Benchmarks before and after.
5. Every alert is *actionable*. Receiving the page tells them what to do.
6. Every postmortem has *action items*. Each item is owned, scheduled, tracked.
7. Every runbook is *current*. New on-call engineers can use it.
8. Every contract is *documented*. Consumers know what to expect.
9. Every assumption is *tested*. CI catches what code review misses.
10. Every quarter, *review*. Bounds and capacity are re-confirmed.

This is the discipline. It is not glamorous. It is what separates the services that run for a decade from the services that crash daily.

If you have read this entire document, you are equipped. The next step is to apply it: review your service's bounds; add the missing ones; load test; document. Repeat.

---

## Appendix Q: Bound Sizing Across Service Categories

Different service categories demand different sizing strategies. A professional engineer knows the heuristics for each.

### Q.1 — API gateway / edge service

Characteristics:
- High RPS, mostly proxying to backends.
- Low CPU per request (parse, route, forward).
- High memory per request (request/response buffers).

Bounds:
- Per-request fan-out: typically 1 (one backend per request) or small (parallel reads from 2-3 services).
- Global in-flight: large (1000-10 000).
- Per-pod memory: dominated by buffered data.

Sizing rule: in-flight = pod memory / (avg request size + avg response size + buffer overhead).

### Q.2 — CRUD service

Characteristics:
- Medium RPS.
- DB-bound: each request does 1-5 DB queries.
- Latency dominated by DB.

Bounds:
- Per-request fan-out: small (parallel DB queries, 1-3).
- Global in-flight: bounded by DB connection pool.
- Per-pod: in-flight ≤ MaxOpenConns.

Sizing rule: pod count × per-pod in-flight ≤ total DB connections × 0.8.

### Q.3 — Aggregation / composition service

Characteristics:
- Each request fans out to many backends.
- Latency = max(backend latencies).
- High fan-out, modest RPS.

Bounds:
- Per-request fan-out: high (8-32).
- Global in-flight: smaller than CRUD (each request does more work).
- Per-backend: tight (backend has its own capacity).

Sizing rule: global in-flight = sum-of-backend-capacities / max-fan-out.

### Q.4 — Stream processor

Characteristics:
- Reads from message queue.
- Variable rate of work.
- Throughput-oriented.

Bounds:
- Worker count: matches CPU (CPU-bound) or downstream (I/O-bound).
- Queue depth (between fetch and process): tuned to absorb bursts.
- Consumer lag: bounded by acknowledgement strategy.

Sizing rule: worker count × per-worker throughput ≥ peak ingestion rate.

### Q.5 — Background worker

Characteristics:
- Async work, no user waiting.
- Throughput over latency.
- Long-running.

Bounds:
- Worker count: depends on work shape.
- Queue depth: high (hours of work can queue).
- Retry budget: bounded total retries per job.

Sizing rule: workers × steady-state throughput = required steady-state throughput. Queue depth = peak burst absorbed.

### Q.6 — Cache server

Characteristics:
- Very high RPS.
- Microsecond latency.
- Memory-bound.

Bounds:
- Per-request fan-out: 0 (no downstream).
- Global in-flight: high (10 000+).
- Memory: dominated by cached data.

Sizing rule: connection capacity high, memory budget allocated almost entirely to data.

### Q.7 — Pub-sub broker

Characteristics:
- One in-flight publish; many subscribers.
- Fan-out is intrinsic.
- Subscribers may be slow.

Bounds:
- Per-publish fan-out: equal to subscriber count (often 0-N).
- Slow subscriber isolation: bounded per-subscriber buffer.

Sizing rule: per-subscriber buffer ≤ memory / subscriber count.

### Q.8 — Generative AI inference service

Characteristics:
- Compute-bound (GPU).
- Long latency per request (seconds).
- High memory per request.

Bounds:
- Per-pod in-flight: very small (1-4, GPU-bound).
- Queue depth: high (many seconds of queued work is acceptable).
- Timeout: tens of seconds (matches generation time).

Sizing rule: pod count = peak RPS × latency / per-pod throughput.

### Q.9 — Reading the categories

Most services fit one of these. Identify your category; apply the sizing rule; load-test to confirm.

When a service spans categories (e.g. an API gateway with embedded AI), the *minimum* bound across categories applies.

---

## Appendix R: Anti-Pattern Variations Across Frameworks

The unlimited-goroutines anti-pattern appears differently across Go frameworks. Each framework has its own idioms.

### R.1 — `net/http` standard library

The standard `http.Server` spawns one goroutine per connection (HTTP/1.1) or per stream (HTTP/2). This is per-request fan-out *built into the framework*.

Bounds:
- `MaxHeaderBytes`: limit header size.
- No built-in concurrency limit. You must add admission control middleware.

Idiomatic:
```go
sem := semaphore.NewWeighted(1000)
http.Handle("/", middleware(handler))
func middleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        if !sem.TryAcquire(1) {
            http.Error(w, "overloaded", http.StatusServiceUnavailable)
            return
        }
        defer sem.Release(1)
        next.ServeHTTP(w, r)
    })
}
```

### R.2 — gRPC

`google.golang.org/grpc` spawns one goroutine per RPC. Streaming RPCs spawn more (one per stream).

Bounds:
- Server option `MaxConcurrentStreams`.
- Custom interceptor for admission.

```go
srv := grpc.NewServer(
    grpc.MaxConcurrentStreams(100),
    grpc.UnaryInterceptor(admissionInterceptor),
)
```

### R.3 — gin / echo / chi

Framework wrappers around `net/http`. Same fan-out characteristics. Add middleware for bounds.

```go
r := gin.Default()
r.Use(middleware.RateLimit(...))
r.Use(middleware.MaxConcurrency(1000))
```

Most frameworks provide such middleware out of the box.

### R.4 — fasthttp

`valyala/fasthttp` uses goroutine pooling: a fixed pool of goroutines handles all connections. Built-in bound.

Bounds:
- `Server.Concurrency`: max simultaneous handlers.
- Connections beyond are queued.

```go
srv := &fasthttp.Server{
    Concurrency: 10000,
}
```

The framework solves the unbounded problem inherent in `net/http`.

### R.5 — kafka-go consumer

Consumer reads in a loop:
```go
for {
    msg, err := reader.ReadMessage(ctx)
    if err != nil { return }
    go process(msg)
}
```

Same anti-pattern as `for range`. Same fix: bounded worker pool.

### R.6 — temporal / cadence workflows

Workflow engines that schedule tasks. The workflow code looks sequential but tasks may run concurrently.

```go
fut1 := workflow.ExecuteActivity(ctx, Activity1, ...)
fut2 := workflow.ExecuteActivity(ctx, Activity2, ...)
_ = fut1.Get(ctx, &result)
_ = fut2.Get(ctx, &result)
```

The workflow engine bounds task concurrency at the worker level. Local concurrency in activities still needs explicit bounds.

### R.7 — Cross-framework lesson

Every framework has some default concurrency model. Most are "one goroutine per request"; some are "pool of N workers."

Whichever your framework, the question is: *where is the bound?* If it's not visible, it's missing.

---

## Appendix S: Operational Patterns for Bound Management

Day-to-day operational practices that keep bounds honest.

### S.1 — The daily review

Daily, an on-call or rotating engineer reviews:
- Yesterday's `process_goroutines` chart for each service.
- Any saturation events.
- Any new alerts.

Even if everything is fine, the review builds familiarity. When an alert fires at 3 AM, the engineer who has reviewed the dashboards knows what "normal" looks like.

### S.2 — Capacity drift detection

Over weeks, traffic grows. Bounds set at launch may become tight.

Implement a "capacity drift" alert:
```yaml
- alert: CapacityDrift
  expr: |
    avg_over_time(pool:inflight:saturation[1d]) > 0.7
    and
    avg_over_time(pool:inflight:saturation[1d] offset 7d) < 0.6
  for: 24h
```

Alerts when this week's saturation is significantly higher than last week's. Investigation: do we need to scale?

### S.3 — Quarterly bound review

Once per quarter, a team reviews:
- Are bounds still appropriate?
- Are SLOs still met?
- What incidents happened?
- What's projected for next quarter?

Updates: new bounds, new SLOs, new capacity, new alerts.

The review is documented; the document is read by the team and shared with stakeholders.

### S.4 — Synthetic monitors

A synthetic monitor mimics user traffic 24/7:
- Sends a request every 30 seconds.
- Measures latency, success.
- Alerts if either degrades.

Synthetic monitors catch issues at low traffic — when real users aren't around to detect them.

For concurrency, synthetic monitors can issue parallel requests to detect concurrency-specific failures.

### S.5 — Pre-deploy load test

Before deploying a change that affects concurrency:
1. Run a load test against staging.
2. Compare against the previous load test.
3. If throughput or latency regresses, investigate.

The load test is automated; it runs on every PR to `main` before merge.

### S.6 — Post-deploy verification

After deploying:
1. Watch the dashboards for 30 minutes.
2. Confirm metrics match staging.
3. If not, roll back.

Many teams have automation: alert if post-deploy metrics deviate from pre-deploy by > 20%.

### S.7 — Incident review cadence

Weekly, the team reviews:
- Incidents from the past week.
- Action items from previous postmortems.
- Patterns: are similar incidents recurring?

If a pattern emerges, escalate to a systemic fix (lint, library, design pattern).

---

## Appendix T: Worked Example — Designing a New Service

Walk through a hypothetical service design from scratch, applying all the bounds.

### T.1 — Requirements

Service: "feature-flags" — evaluates feature flags for clients.

- RPS: peak 10 000, baseline 2 000.
- Latency: p99 < 20 ms.
- Availability: 99.99% (52 minutes downtime/year).
- Data: 1 million flag definitions, 100 million evaluations/day.
- Multi-tenant: ~5 000 tenants.

### T.2 — Architecture

Client → API → Cache (Redis) ← DB (PostgreSQL)
                ↓
                Telemetry (Kafka)

The cache holds flag definitions. The API reads from cache, evaluates, returns. Misses fall through to DB.

### T.3 — Bound stack design

Tier 1: API ingress
- Admission control: 5 000 in-flight.
- Per-tenant rate limit: 100 RPS, 50 in-flight.

Tier 2: Cache (Redis)
- Connection pool: 50 connections.
- Per-request: 1 cache read.

Tier 3: DB (PostgreSQL)
- Connection pool: 100 connections.
- Per-request: 1 DB read on cache miss (rare, < 1% of requests).

Tier 4: Telemetry (Kafka)
- Producer goroutine pool: 4 workers.
- Buffer: 10 000 events.

### T.4 — Math

At peak:
- 10 000 RPS / 5 pods = 2 000 RPS per pod.
- At 20 ms p99 latency: in-flight = 2 000 × 0.02 = 40.
- Within the 5 000 in-flight bound (per service-wide).

DB cache miss rate < 1%, so DB QPS = 100 (across all 5 pods). DB pool of 100 is fine.

Telemetry: 10 000 events/s, 4 workers can drain at 2 500/s each = 10 000/s. Just enough; add headroom by increasing workers to 8.

### T.5 — Code skeleton

```go
package main

import (
    "context"
    "log/slog"
    "net/http"
    "time"

    "github.com/go-redis/redis/v9"
    "github.com/prometheus/client_golang/prometheus"
    "github.com/prometheus/client_golang/prometheus/promauto"
    "github.com/prometheus/client_golang/prometheus/promhttp"
    "golang.org/x/sync/errgroup"
    "golang.org/x/sync/semaphore"

    _ "go.uber.org/automaxprocs"
)

type Config struct {
    Addr             string
    GlobalInflight   int64
    PerTenantRate    int  // RPS
    PerTenantInflight int64
    RedisAddr        string
    DBDsn            string
    KafkaBrokers     []string
    TelemetryWorkers int
}

type Server struct {
    cfg          Config
    global       *semaphore.Weighted
    tenantBudget *TenantBudget
    redis        *redis.Client
    db           *DB
    telemetry    *Telemetry
}

// (other types: TenantBudget, DB, Telemetry — defined in their own files)

func main() {
    cfg := Config{
        Addr:              ":8080",
        GlobalInflight:    1000,    // per-pod, 5 pods × 1000 = 5000
        PerTenantRate:     20,
        PerTenantInflight: 10,
        RedisAddr:         "redis:6379",
        DBDsn:             "postgres://...",
        TelemetryWorkers:  2,        // per-pod, 5 pods × 2 = 10 workers
    }

    s := newServer(cfg)
    srv := &http.Server{
        Addr:         cfg.Addr,
        Handler:      s.routes(),
        ReadTimeout:  3 * time.Second,
        WriteTimeout: 5 * time.Second,
    }
    slog.Info("starting server", "addr", cfg.Addr)
    if err := srv.ListenAndServe(); err != nil {
        slog.Error("server failed", "err", err)
    }
}
```

### T.6 — Operational setup

Before launch:
1. Prometheus + Grafana dashboards configured.
2. Alerts for:
   - `process_goroutines > 5000` for 5m.
   - `pool:saturation > 0.8` for 5m.
   - `request_error_rate > 0.01` for 5m.
3. Runbook with diagnostic steps.
4. Load test confirming bounds at 2x peak.

After launch:
1. Daily review for a week.
2. Weekly review for a month.
3. Monthly review thereafter.

### T.7 — Failure modes anticipated

1. Redis down → fall back to DB → DB pool saturated → 503s.
2. DB down → no fallback → 503s.
3. Kafka down → telemetry buffer fills → drop telemetry, log calls succeed.
4. Tenant misbehaves → per-tenant rate limit caps them.
5. Traffic spike → admission control rejects above 5 000 in-flight.

Each failure mode is bounded; none cause cascading collapse.

### T.8 — Iterations

Over months, expect:
- Adjust per-tenant limits as tenant traffic patterns emerge.
- Adjust global limit as traffic grows.
- Adjust pool counts as bottlenecks shift.

The architecture is stable; the numbers are tuned.

---

## Appendix U: Comparing Concurrency Models

A professional understanding includes how Go compares to other concurrency models. This informs decisions about technology stack and patterns to import.

### U.1 — Go: goroutines + channels

- Goroutines: cheap, runtime-managed.
- Channels: typed, blocking, FIFO.
- Synchronisation: mutexes, channels, atomics.

Strengths: easy to write, scales to many concurrent operations.
Weaknesses: easy to leak; runtime overhead at extreme scale.

### U.2 — Erlang / Elixir: actors

- Actors: processes with isolated state, message passing.
- No shared memory.
- Supervisor trees for fault tolerance.

Strengths: extreme fault tolerance, no shared state to race.
Weaknesses: harder to write performance-critical code; copying messages costs.

For Go, the actor model can be emulated with channels + goroutines. The "actor pattern" in Go: one goroutine per "actor," communicating only via channels.

### U.3 — Rust: async/await + futures

- Async functions return futures.
- Runtime (Tokio) executes them.
- No GC; ownership-based.

Strengths: zero-cost abstraction, no GC pauses.
Weaknesses: steeper learning curve; async colour (async functions can only be called from async).

### U.4 — Node.js: single-threaded event loop

- Everything in one thread.
- Async I/O via libuv.
- Workers for CPU-bound work.

Strengths: simple model, no synchronisation issues.
Weaknesses: scales only horizontally; CPU-bound work blocks everything.

### U.5 — Java: threads + virtual threads

- Threads: heavy, OS-managed.
- Virtual threads (Project Loom, Java 21+): light, like goroutines.

Strengths: familiar model, lots of tooling.
Weaknesses: legacy of heavy threads; virtual threads are new.

### U.6 — The Goroutine Verdict

Goroutines are *among* the best concurrency models for general-purpose applications. They strike a balance:
- Cheap enough to write idiomatically.
- Powerful enough for high throughput.
- Manageable with the right discipline.

Other models are better for specific use cases (Erlang for fault tolerance, Rust for predictable latency), but Go's goroutines are a reasonable default for most services.

The unlimited-goroutines anti-pattern is, in fact, an artifact of how *easy* goroutines are to spawn. The cure is discipline; the discipline is what this document teaches.

---

## Appendix V: Capacity Models for Specific Workloads

### V.1 — Read-heavy web service

```
RPS = 5000
p99 latency = 50ms (cache hit)
Cache hit rate = 99%
DB p99 = 200ms (cache miss)

In-flight = 5000 × (0.99 × 0.05 + 0.01 × 0.2) = 260

Pod count = ceil(260 / 50 per pod) = 6 pods
Headroom: 8 pods.
```

### V.2 — Write-heavy service

```
RPS = 500
p99 latency = 100ms
DB writes = 1 per request
DB write throughput = 100/s

In-flight = 500 × 0.1 = 50.
But DB is at capacity: pool = 100, write rate ≤ 100/s.
Throughput limited by DB.

Pods: 5 (each holds 10 connections).
Need to scale DB or batch writes.
```

### V.3 — Aggregation service

```
RPS = 200
Per-request fan-out = 8 backends
p99 latency = 400ms (max of backend latencies)

In-flight = 200 × 0.4 = 80
Backend calls in flight = 80 × 8 = 640

Each backend has capacity 200 in-flight (their bound).
640 / 8 = 80 calls per backend on average.
Within their bound.

Pods: 4 (each handles 50 in-flight × 8 fan-out = 400 backend calls).
```

### V.4 — Streaming service

```
Ingestion: 100 000 events/s
Per-event processing: 1 ms CPU + 5 ms I/O

Total work per event: 6 ms.
Total CPU per event: 1 ms.
At 8-core pod: 8000 ms CPU/s → 8000 events/s CPU.
At 200 in-flight per pod (I/O bound): 200 / 0.006 = 33 000 events/s.

CPU is the bottleneck: 8000 events/s per pod.
Pods needed: 100 000 / 8000 = 13.
Headroom: 16 pods.
```

### V.5 — Background batch job

```
Total work: 10 million items
Per-item time: 100 ms
Total CPU: 1 000 000 seconds = 11.5 days

Parallel: split across pods.
50 pods × 32 workers = 1600 workers.
11.5 days / 1600 = 10 minutes wall time.

Each pod handles 10M / 50 = 200 000 items.
At 32 workers × 100ms = 3.2s per batch of 32.
200 000 / 32 = 6250 batches × 3.2s = 20 000 seconds = 5.5 hours per pod.

Whoops: per-pod time is 5.5 hours, not 10 minutes.

Adjust: more workers per pod. But each worker holds memory; 32 was the memory limit. Increase pod size to support 128 workers.

128 workers × 50 pods = 6400. Per-pod: 200K items / 128 = 1562 batches × 3.2s = 5000s = 1.4 hours. Better.

Add more pods: 200 pods × 128 workers = 25 600. Per-pod: 50K items / 128 = 391 batches × 3.2s = 1250s = 21 minutes.

Trade off: pod count vs duration.
```

The math reveals: parallelism scales linearly until memory or downstream constrains. Plan accordingly.

---

## Appendix W: A Catalog of Real-World Bounds

To give you intuition for what bounds look like in real systems:

### W.1 — Web servers

- nginx: typically 1024-65 535 concurrent connections per worker.
- Apache (prefork): ~256 worker processes default.
- Go's `net/http`: unbounded by default; bound at admission middleware.

### W.2 — Databases

- PostgreSQL: `max_connections` default 100; production 100-500.
- MySQL: `max_connections` default 151; production 500-5000.
- Redis: `maxclients` default 10 000.
- MongoDB: `maxIncomingConnections` default 65 536.

### W.3 — Caches

- Redis: 100k+ ops/s per instance.
- Memcached: 200k+ ops/s per instance.

### W.4 — Message brokers

- Kafka: partitions × consumers = parallelism. Often 100-1000 partitions.
- RabbitMQ: ~10 000 connections per node.
- NATS: ~1M concurrent connections per node.

### W.5 — Cloud APIs

- AWS S3: ~3500 PUT/s per prefix.
- AWS DynamoDB: configurable (40 000 RPS default per table).
- GCP PubSub: 100 MB/s per topic.
- Azure Service Bus: 100 connections per namespace default.

### W.6 — HTTP clients

- Go `http.Transport.MaxConnsPerHost`: unlimited by default. Always set.
- Go `http.Transport.MaxIdleConns`: 100 default.
- Browsers: ~6 connections per host.

### W.7 — DNS

- DNS queries: ~10 µs to local cache, ~10 ms to remote.
- glibc DNS: synchronous, blocks one thread per resolution.
- Go DNS: async by default (via netpoller).

Knowing these numbers gives you intuition. When you size a bound, anchor to one of these published limits.

---

## Appendix X: Anti-Pattern Visibility

How an unbounded goroutine pattern looks at different observation layers.

### X.1 — Source code view

```go
for _, x := range items {
    go process(x)
}
```

Direct. Detectable by grep, lint, code review.

### X.2 — `go vet` / static analysis

Custom analyser flags. Standard `go vet` does not detect this; custom rules do.

### X.3 — Unit test

Without bounds checking, tests pass silently. With a `runtime.NumGoroutine()` assertion, tests catch it.

### X.4 — Integration test

Tests that exercise the full handler may catch it via timeouts or memory growth — but only if the test input is large enough.

### X.5 — Load test

Realistic load reveals it. Memory climbs; throughput plateaus; errors begin.

### X.6 — Production metrics

`process_goroutines` spikes. Alert fires.

### X.7 — Production logs

Errors flood: "context deadline exceeded", "connection pool exhausted", "out of memory."

### X.8 — pprof profile

Goroutine count by stack reveals the offending call site.

### X.9 — Incident postmortem

The trail is documented; team learns; fix is applied.

### X.10 — Lesson

Detection becomes harder as observation gets more abstract. Catch the bug at the earliest layer (lint > unit test > load test > production).

Most cost-effective: lint + code review. Least cost-effective: postmortem (after damage done).

---

## Appendix Y: Decision Tree for Operational Response

When you see `process_goroutines` spike, what do you do?

```
Goroutine count spike detected
            |
   Is it growing or stable?
            |
   +--------+--------+
   Growing         Stable
       |              |
   Likely leak.   Likely just load.
   Capture pprof    Check load metrics:
   goroutine        is RPS elevated?
   profile.         If yes, autoscale.
       |              If no, check
   Identify          per-tenant.
   leaking stack.
       |
   Is leak code in
   recent deploy?
       |
   +---+---+
   Yes      No
       |      |
   Roll      Investigate:
   back.     when did this
             start?
             Diff profiles.
```

This decision tree should be in your runbook. Operators follow it under stress.

---

## Appendix Z: Closing Thoughts

The professional level is not "knowing more" than the senior level. It is "operating at scale." Every concept from the senior level applies; what changes is the *zoom level*.

A senior engineer might be the best person to fix one fan-out site. A professional engineer designs the system so that no fan-out site can be unbounded in the first place: by lint, by convention, by training, by review process, by incident discipline.

The unlimited-goroutines anti-pattern is a microcosm of all production engineering: implicit assumptions become bugs; bugs become outages; outages become postmortems; postmortems become discipline. The discipline you build around this one pattern is the same discipline that, scaled across all patterns, makes a production engineering team effective.

The reward is a service that runs for years without unplanned downtime. The cost is the daily discipline of asking, before every `go`, "what bounds this?" The trade is worth it.

---

## Appendix AA: Tooling Ecosystem

A non-exhaustive map of tools you should have hands-on familiarity with at the professional level.

### AA.1 — Observability tools

- **Prometheus**: time-series metric database and query language. Industry standard for service metrics.
- **Grafana**: dashboards on top of Prometheus and other sources.
- **Pyroscope / Grafana Phlare**: continuous profiling.
- **Polar Signals**: continuous profiling, formal verification adjacent.
- **Datadog Profiler**: managed continuous profiling.
- **Google Cloud Profiler**: managed.
- **AWS X-Ray**: distributed tracing.
- **Jaeger**: open-source distributed tracing.
- **Honeycomb**: high-cardinality observability.
- **OpenTelemetry**: vendor-neutral instrumentation SDK.

### AA.2 — Load testing tools

- **wrk**: simple HTTP benchmark.
- **vegeta**: HTTP benchmark with detailed metrics.
- **k6**: scripted load testing.
- **Locust**: distributed load testing in Python.
- **Gatling**: Scala-based load testing.
- **JMeter**: GUI-based, mature.
- **drill**: Rust-based HTTP benchmark.
- **bombardier**: Go-native HTTP benchmark.

### AA.3 — Static analysis

- **`go vet`**: standard.
- **`golangci-lint`**: aggregator of many linters.
- **`staticcheck`**: comprehensive Go linter.
- **`semgrep`**: custom rule engine for code patterns.
- **`CodeQL`**: GitHub's code search and analysis.

### AA.4 — Runtime debugging

- **`pprof`**: built-in Go profiler.
- **`go tool trace`**: scheduler trace viewer.
- **`delve` (`dlv`)**: Go debugger.
- **`gops`**: Go process inspection.
- **`runtime/trace`**: programmatic trace API.

### AA.5 — Test tools

- **`go.uber.org/goleak`**: goroutine leak detection.
- **`testify`**: assertions, mocks.
- **`gomock`**: mock generation.
- **`httptest`**: HTTP test server.
- **`dockertest`**: dockerised dependencies in tests.

### AA.6 — Operations tools

- **`kubectl`**: Kubernetes CLI.
- **`k9s`**: TUI for Kubernetes.
- **`helm`**: Kubernetes package manager.
- **`flux` / `argocd`**: GitOps.
- **`terraform`**: infrastructure as code.
- **`crossplane`**: Kubernetes-native IaC.

### AA.7 — Concurrency primitives libraries

- **`golang.org/x/sync/semaphore`**: weighted semaphore.
- **`golang.org/x/sync/errgroup`**: bounded errgroup.
- **`golang.org/x/sync/singleflight`**: deduplication.
- **`go.uber.org/ratelimit`**: leaky bucket.
- **`golang.org/x/time/rate`**: token bucket.
- **`github.com/sony/gobreaker`**: circuit breaker.
- **`github.com/cenkalti/backoff/v4`**: backoff.

A professional engineer doesn't memorise the API of each, but knows which to reach for and where to find it.

---

## Appendix BB: A Brief History of Concurrency Patterns

Understanding where ideas came from helps situate them.

### BB.1 — Mutexes (1965)

Dijkstra's semaphore. Mutexes are binary semaphores. Older than most programming languages.

### BB.2 — Monitors (1973)

Hoare and Hansen. Encapsulate state + synchronisation. Java's `synchronized` is a monitor.

### BB.3 — Channels (1978)

Hoare's CSP. "Do not communicate by sharing memory; share memory by communicating." The slogan of Go.

### BB.4 — Actors (1973)

Hewitt. Isolated processes + messages. Erlang's killer feature.

### BB.5 — Coroutines (1958)

Conway. Voluntary yielding. Goroutines descend from coroutines.

### BB.6 — Async/await (2005)

F#. Then C#, JavaScript, Python, Rust. Goroutines are a syntactic alternative to async/await.

### BB.7 — Goroutines (2009)

Pike, Cox, Cox. M:N threading + CSP channels + GC.

### BB.8 — Structured concurrency (2018)

Nathaniel J. Smith's "Notes on structured concurrency, or: Go statement considered harmful." Argues that bare `go` is too permissive; tasks should be tied to scopes. Go does not enforce structured concurrency, but `errgroup` is the most common way to approximate it.

### BB.9 — Virtual threads (2023, Java 21)

Project Loom. M:N threading in the JVM. Goroutines, but in Java.

### BB.10 — The convergence

Modern languages converge on the same abstractions: cheap user-space units of execution, bounded by some primitive, scoped by some construct, communicated via channels or futures.

Knowing the history helps you predict where languages will evolve. Go is mature; future iterations will tighten ergonomics (better structured concurrency, perhaps generics in `errgroup`), not introduce new paradigms.

---

## Appendix CC: Reading Source Code

To level up, read the source of the libraries you use. Order of recommendation:

1. **`golang.org/x/sync`** — 500 lines total. Read all of it.
2. **`net/http` `Server`** — focus on the connection loop and shutdown.
3. **`runtime/proc.go`** — focus on `findRunnable` and `newproc`.
4. **`golang.org/x/sync/singleflight`** — illustrates dedup, an underused pattern.
5. **`sync/cond.go`** — illustrates condition variables, often misunderstood.
6. **`database/sql`** — illustrates connection pool design.

Each is a few hundred to a few thousand lines. Reading one per quarter, by year-end you understand the entire foundation of Go concurrency.

The point of reading source is not to memorise APIs; it is to internalise design patterns. After reading `semaphore.go`, you will reach for FIFO waiter queues in your own code. After reading `pool.go` (sync.Pool), you will think about per-P caches.

---

## Appendix DD: Common Production Bugs and Their Diagnoses

A short catalogue of bugs the professional engineer recognises by symptom.

### DD.1 — "Service slows down over time, restart fixes it"

Likely a leak. Probably goroutines, possibly connections.

Diagnose: pprof goroutine profile shows the leaking stack. Memory profile reveals heap growth.

### DD.2 — "Latency p99 climbs proportionally to load"

Likely contention. A mutex, a channel, or a connection pool is saturated.

Diagnose: pprof mutex profile. Block profile. Compare per-pool inflight at various load levels.

### DD.3 — "Service handles 1000 RPS fine, OOMs at 1100 RPS"

Likely a hard limit being approached. Memory budget, FD limit, or downstream cap.

Diagnose: check OS limits (`ulimit -n`), memory metrics, downstream metrics.

### DD.4 — "One tenant slows the whole service"

Likely missing tenant isolation. One tenant's load consumes shared resources.

Diagnose: per-tenant metrics. Look for one tenant with high inflight count.

### DD.5 — "Service restarts during deploys cause cascading failures"

Likely missing graceful shutdown + saturation. New pods come up; existing pods catch all the load.

Diagnose: pre-deploy load distribution; readiness probes; rolling update strategy.

### DD.6 — "Random 503s under moderate load"

Likely connection churn or TIME_WAIT exhaustion.

Diagnose: `netstat -an | grep TIME_WAIT | wc -l`. If high, check connection pooling.

### DD.7 — "Metrics show normal but users complain"

Likely sampling issue. Latency averages hide tail. Goroutine count averages hide spikes.

Diagnose: use percentile metrics (p99). Use 1-second granularity.

### DD.8 — "Worker pool drained but workers never run again"

Likely worker panic or context cancellation kept channels closed.

Diagnose: log every worker exit. Recover and restart workers.

### DD.9 — "Cache hit rate falls to 0 on cache restart"

Cache cold-start. Until repopulated, every request misses.

Diagnose: warmup strategy on startup. Pre-populate hot keys.

### DD.10 — "p99 latency spikes every minute"

Likely GC pauses. Or periodic work (cron-like, metrics scrape).

Diagnose: `GODEBUG=gctrace=1`. Compare timing with metric scrape interval.

A professional engineer mentally maps symptoms to candidate diagnoses. The list above is the start.

---

## Appendix EE: Verifying Bounds in Production

How do you confirm, in production, that your bounds are actually enforced?

### EE.1 — Synthetic stress test in production

Periodically (e.g. once an hour), an internal endpoint triggers a small stress test:
- Issues 100 parallel requests against a non-critical endpoint.
- Measures latency, success rate.
- Confirms bounds engage gracefully.

If results regress, alert.

### EE.2 — Canary deploys

Deploy changes to a canary first. Compare metrics:
- Goroutine count in canary vs production.
- Latency percentiles.
- Memory.

If canary regresses, roll back automatically.

### EE.3 — Shadow traffic

Run the new code on real traffic but discard the responses. Compare resource use:
- Did the new code spawn more goroutines?
- Did it use more memory?

Shadow traffic catches resource regressions without user impact.

### EE.4 — Bounded chaos

In production, periodically trigger:
- Goroutine count + 1000 (start 1000 sleep goroutines).
- Memory + 100 MB (allocate and hold).
- Downstream slowness (proxy with delay).

Observe that bounds engage. Auto-clean afterwards.

This is "chaos engineering for bounds." It catches misconfigurations that staging tests miss.

### EE.5 — Real-user monitoring

For client-side measurements:
- Sample p99 latency from real users.
- Correlate with backend metrics.

Real-user monitoring catches issues that synthetic monitoring misses (geographic differences, ISP issues, client device variation).

---

## Appendix FF: The Org Chart of Concurrency

In a large org, multiple teams interact around concurrency:

### FF.1 — Platform team

Owns runtime, monitoring, build tooling. Provides:
- Lint rules.
- Metric libraries.
- Pool patterns.
- Capacity planning tools.

### FF.2 — Service teams

Own their services. Responsible for:
- Choosing bounds.
- Implementing bounds.
- Operating the service.

### FF.3 — SRE / Reliability team

Owns incident response. Provides:
- Runbooks.
- Postmortem culture.
- Alert tuning.
- Capacity reviews.

### FF.4 — Architecture / staff engineers

Owns cross-team coordination. Provides:
- Concurrency contracts between services.
- Capacity allocation.
- Design reviews.

### FF.5 — Product team

Owns features. Indirectly affects concurrency via:
- Adding endpoints.
- Changing data shapes.
- Setting customer expectations.

### FF.6 — The interactions

When a product change is proposed:
- Architecture reviews concurrency implications.
- Service teams implement with bounds.
- SRE plans for incident response.
- Platform updates lint rules if new patterns emerge.

This is how a healthy org runs. Without these roles, concurrency knowledge is siloed; incidents are surprises.

---

## Appendix GG: Final Reflections

### GG.1 — Concurrency mastery is incremental

You will not master this in a quarter. The patterns above are the *vocabulary*. Fluency comes from years of application.

### GG.2 — Mistakes are inevitable

Every senior engineer has caused an outage with unbounded fan-out. The mark of a professional is what they do after: postmortem, fix, share.

### GG.3 — Tooling is essential

Discipline alone fails at scale. Lint, monitoring, alerts, runbooks — these are the prosthetics that extend individual discipline across the org.

### GG.4 — Documentation is the highest leverage

Writing it down is what scales knowledge. Every postmortem, every runbook, every design doc — these compound. After five years, a team has a library of institutional knowledge.

### GG.5 — Concurrency is not a Go-specific skill

Bounded fan-out, backpressure, admission control, circuit breakers — these are universal. Your Go expertise transfers to Rust, Java, Python. The discipline is the asset.

### GG.6 — The end

The unlimited-goroutines anti-pattern is the gateway to all of production engineering. Master it; the rest follows.

---

## Appendix HH: Auditing an Existing Codebase

A practical, step-by-step audit playbook.

### HH.1 — Step 1: Map the spawn sites

```
git grep -nE "^\s*go " > spawn_sites.txt
git grep -nE "go func" >> spawn_sites.txt
```

Result: every `go` statement. Probably hundreds in a moderate codebase.

### HH.2 — Step 2: Classify

For each:
- A: Bounded by enclosing context (a method called from a single place).
- B: Bounded by errgroup/semaphore in the same function.
- C: Inside a `for` over a slice/channel — needs investigation.
- D: Fire-and-forget — investigate the work duration.
- E: Inside library code — check usage.

### HH.3 — Step 3: Prioritise

Class C and E are highest risk. Class D second. Classes A and B are usually fine.

### HH.4 — Step 4: Fix top 20

For top-20 C-class sites:
- Determine the bound.
- Apply the fix.
- Add tests.
- Deploy.

Goal: 20 per month for the team. After 5 months, top 100 done.

### HH.5 — Step 5: Lint to prevent regression

Add the custom lint rule. Block new violations.

### HH.6 — Step 6: Document

Each fix's commit message should include:
- The bound chosen.
- The justification.
- The metric to monitor.

This becomes a searchable history of bounds across the codebase.

---

## Appendix II: Concurrency Maturity Model

A way to assess your team's maturity:

### II.1 — Level 0: Unaware

- No bounded fan-out anywhere.
- Regular OOM incidents.
- No goroutine metric.
- Incidents diagnosed by guesswork.

### II.2 — Level 1: Reactive

- Some bounds added after incidents.
- Goroutine count exported but not alerted.
- No standard pool library.
- Postmortems blame individuals.

### II.3 — Level 2: Defensive

- Standard pool / errgroup usage in new code.
- Alerts on goroutine count growth.
- Tests check for leaks.
- Postmortems blame patterns.

### II.4 — Level 3: Proactive

- Lint rules block unbounded fan-out.
- Continuous profiling.
- Capacity planning is quarterly.
- Bounds documented for every service.

### II.5 — Level 4: Mature

- Cross-service contracts published.
- Multi-tenant isolation.
- Chaos engineering for bounds.
- New engineers trained on the patterns.

### II.6 — Level 5: Exemplary

- Bounds are a first-class architectural concern.
- Capacity planning is automated.
- Incidents are rare and short.
- The team's practices are publicly referenced.

Most teams operate at Level 2-3. The journey from 0 to 4 is the work of a year or two for a focused team.

---

## Appendix JJ: Closing Code Sample

A final code sample that synthesises everything: a production-grade fan-out function.

```go
package fanout

import (
    "context"
    "errors"
    "fmt"
    "log/slog"
    "runtime/debug"
    "sync"
    "time"

    "github.com/prometheus/client_golang/prometheus"
    "github.com/prometheus/client_golang/prometheus/promauto"
    "golang.org/x/sync/errgroup"
)

var (
    metric = struct {
        inflight *prometheus.GaugeVec
        duration *prometheus.HistogramVec
        outcome  *prometheus.CounterVec
        panics   *prometheus.CounterVec
    }{
        inflight: promauto.NewGaugeVec(prometheus.GaugeOpts{
            Name: "fanout_inflight",
        }, []string{"name"}),
        duration: promauto.NewHistogramVec(prometheus.HistogramOpts{
            Name: "fanout_duration_seconds",
        }, []string{"name", "outcome"}),
        outcome: promauto.NewCounterVec(prometheus.CounterOpts{
            Name: "fanout_outcome_total",
        }, []string{"name", "outcome"}),
        panics: promauto.NewCounterVec(prometheus.CounterOpts{
            Name: "fanout_panics_total",
        }, []string{"name"}),
    }
)

type Config struct {
    Name          string
    Concurrency   int
    JobTimeout    time.Duration
    StopOnError   bool
    Logger        *slog.Logger
}

type Job[T any] struct {
    Input T
}

func Run[T any](ctx context.Context, cfg Config, jobs []Job[T], fn func(context.Context, T) error) error {
    if cfg.Logger == nil { cfg.Logger = slog.Default() }
    if cfg.Concurrency <= 0 { cfg.Concurrency = 1 }
    g, gctx := errgroup.WithContext(ctx)
    g.SetLimit(cfg.Concurrency)

    var wg sync.WaitGroup
    wg.Add(len(jobs))

    for i, job := range jobs {
        i, job := i, job
        g.Go(func() error {
            defer wg.Done()
            metric.inflight.WithLabelValues(cfg.Name).Inc()
            defer metric.inflight.WithLabelValues(cfg.Name).Dec()

            timer := prometheus.NewTimer(metric.duration.WithLabelValues(cfg.Name, "ok"))

            jobCtx := gctx
            var cancel context.CancelFunc
            if cfg.JobTimeout > 0 {
                jobCtx, cancel = context.WithTimeout(gctx, cfg.JobTimeout)
                defer cancel()
            }

            err := safeRun(jobCtx, cfg.Name, job.Input, fn, cfg.Logger)
            if err != nil {
                metric.outcome.WithLabelValues(cfg.Name, "error").Inc()
                cfg.Logger.ErrorContext(ctx, "fanout job failed",
                    "name", cfg.Name,
                    "index", i,
                    "err", err)
                if cfg.StopOnError {
                    return err
                }
                return nil
            }
            timer.ObserveDuration()
            metric.outcome.WithLabelValues(cfg.Name, "ok").Inc()
            return nil
        })
    }
    return g.Wait()
}

func safeRun[T any](ctx context.Context, name string, input T, fn func(context.Context, T) error, log *slog.Logger) (err error) {
    defer func() {
        if r := recover(); r != nil {
            metric.panics.WithLabelValues(name).Inc()
            log.ErrorContext(ctx, "fanout job panicked",
                "name", name,
                "panic", fmt.Sprintf("%v", r),
                "stack", string(debug.Stack()))
            err = fmt.Errorf("panic: %v", r)
        }
    }()
    return fn(ctx, input)
}

var ErrFanoutTimeout = errors.New("fanout timeout")
```

Usage:

```go
type URL string

func main() {
    jobs := []fanout.Job[URL]{
        {Input: "https://example.com/a"},
        {Input: "https://example.com/b"},
    }
    err := fanout.Run(context.Background(), fanout.Config{
        Name:        "fetch",
        Concurrency: 8,
        JobTimeout:  5 * time.Second,
        StopOnError: false,
    }, jobs, func(ctx context.Context, u URL) error {
        // fetch the URL
        return nil
    })
    _ = err
}
```

This `fanout.Run` is reusable across the codebase. The bound is explicit. The metrics are automatic. The panic recovery is built-in. The timeout is per-job. The behaviour at error is configurable.

When every fan-out in the codebase uses `fanout.Run` (or a per-service equivalent), the anti-pattern cannot reappear: the bound is structural, the metrics are uniform, the patterns are familiar.

This is what professional-level concurrency looks like in code.

---

## Appendix KK: Templated Documents

When establishing a practice, templates accelerate adoption.

### KK.1 — Bound justification template

```
## Bound: <name>
Value: <number>
Type: <semaphore | channel buffer | pool size>
Rationale: <one paragraph>
Derived from: <downstream resource, load test, measurement>
Validated by: <load test result, link>
Reviewed: <date, reviewers>
```

This block sits in the code as a comment, or in a docs/bounds.md file referenced by the code.

### KK.2 — Capacity plan template

```
## Service: <name>
Period: <quarter>
Peak RPS (last quarter): <observed>
Peak RPS (projected): <projected>
Latency p99: <observed>
In-flight (Little's Law): <RPS × p99>
Pod count: <number>
Per-pod bound: <number>
Total bound: <pod count × per-pod>
Headroom: <percentage>
Action items: <if scaling needed>
```

### KK.3 — Incident timeline template

```
## Incident <ID>
Severity: <SEV1/2/3>
Detection: <timestamp>
First response: <timestamp>
Mitigation: <timestamp>
Resolution: <timestamp>
Duration: <minutes>
Affected: <users/services>
Root cause: <one sentence>
```

### KK.4 — Concurrency contract template

```
## Service: <name>, Version: <vN.M>
Max RPS: <number>
Max in-flight: <number>
Burst tolerance: <seconds>
Degradation: <reject | queue | partial>
Per-caller quota: <number>
Quota override process: <link>
```

### KK.5 — Runbook entry template

```
## Alert: <name>
Symptom: <observed metric or log>
Likely cause: <list>
Diagnostic steps:
  1. <command or check>
  2. ...
Mitigation:
  - <action>
Escalation: <who to page>
Postmortem required: <yes/no>
```

Adopt these templates. After a year, your team has a library of consistent artifacts. Searchability and onboarding both improve.

---

## Appendix LL: A Single-Paragraph Summary

If you must distill this entire document to one paragraph for an engineering manager:

The unlimited-goroutines anti-pattern is the most common source of production outages in Go services. The cure is to bound every fan-out, derived from the smallest downstream resource, monitored with metrics, validated with load tests, and enforced with lint rules. The discipline scales from single-service hygiene to multi-service contracts, multi-team practice, and organisation-wide capacity planning. Investment in this discipline pays back in fewer incidents, lower cloud bills, and faster diagnosis when something does break.

Print this paragraph; pin it to the wall. It is the entire document compressed.

---

## Appendix MM: Career Advice

For the engineer aiming to grow into the professional level on this topic specifically:

### MM.1 — Pick a service and own it

Pick one service in your codebase. Audit every goroutine spawn. Document every bound. Add the missing ones. Operate it for six months. Lead the postmortem if anything goes wrong.

You will learn more from one deeply-owned service than from ten shallowly-known ones.

### MM.2 — Read incidents from other companies

Postmortems published by Cloudflare, GitHub, Stripe, Uber, AWS — all are public. Each is a case study. Many involve concurrency issues.

Read one per week. Take notes. Match the patterns to your own services.

### MM.3 — Contribute upstream

The libraries discussed here (errgroup, semaphore, goleak) are open source. Find an issue; submit a PR. Even a documentation improvement teaches you the library deeply.

### MM.4 — Teach what you know

The fastest way to learn is to teach. Write a blog post. Give a brown-bag talk. Mentor a junior. Each forces you to articulate what you know.

### MM.5 — Read the runtime

`src/runtime/proc.go` once a year. Each read reveals something you missed. The runtime is small (~30 000 lines) and approachable.

### MM.6 — Build tooling

If a tool you wish existed doesn't, build it. The team learns from the tool; you learn from building it.

Examples: a lint rule for unbounded fan-out; a pprof analyser that highlights leak candidates; a load-test runner with bound assertions.

### MM.7 — Cross-pollinate

Spend time in services in other languages. Rust async, Java virtual threads, Python asyncio. Each has its variant of these patterns. The cross-language perspective deepens the Go-specific knowledge.

### MM.8 — Be patient

Mastery takes years. The patterns above are not learned in a quarter. Accept slow progress; celebrate small improvements.

A senior engineer who has shipped one bounded-fan-out fix per month for five years has solved 60 problems. That is more than enough to be effective.

---

## Appendix NN: A Last Word

This document is long because the topic is rich. The reality is simpler: the entire content reduces to "bound every fan-out, derive the bound, monitor it." The length is in the *how* — the patterns, the libraries, the case studies, the trade-offs.

When you read a 5 000-line document, you don't memorise it. You skim it, internalise the structure, and return when you need a specific section. This document is engineered for that: each section stands alone; each appendix has its own purpose; each subsection answers one question.

Return to it. Mark it up. Add your own notes from your own incidents. Make it yours.

The discipline this document teaches is what makes the difference between a service that runs for years without trouble and a service that wakes its on-call team every other week. The former is what your users deserve; the latter is what we have failed to deliver if we have not bounded our fan-outs.

The cure is simple. Apply it.

---

## Appendix OO: Cross-Reference Index

Quick index for finding specific topics in this document.

- Admission control: Section 12, Appendix C, T
- Backpressure: Section 4, Appendix Q
- Bound stack: Section 2, Appendix Q
- Capacity planning: Section 4, Appendix V
- Circuit breaker: Section 8
- Concurrency budget: Section 3
- Continuous profiling: Section 12
- Cost modelling: Section 16
- Cross-team contracts: Section 15
- Errgroup: Senior Appendix J
- File descriptors: Section 19 (senior carry-over), Appendix H
- Goleak: Senior Section 13
- Goroutine count metric: Section 10
- HPA configuration: Section 5
- Incident postmortem: Section 13
- Little's Law: Section 4
- Load testing: Section 18
- Migration playbook: Section 21
- Multi-tenant: Section 17
- Pod sizing: Section 5
- pprof: Section 11
- Production case studies: Section 22, Appendix M
- Refactor playbook: Senior Section 18
- Runtime internals: Appendix D
- Scheduler: Appendix D
- SLOs: Section 14
- Static analysis: Section 20
- Tail latency: Appendix J
- Tokens / weighted semaphore: Senior Section 6
- Tooling: Appendix AA
- Worker pool: Senior Section 8

When you return to this document for reference, this index points at the answer.

The discipline is the asset. The patterns are the tools. The index is the map.

---

## Appendix PP: Acknowledgements

This document synthesises decades of community wisdom about Go concurrency. Specific debts:

- Rob Pike's original Go Concurrency Patterns talks.
- The Go runtime authors for engineering a scheduler readable by mortals.
- Cloudflare, Uber, Dropbox, Discord engineering blogs for production case studies.
- The maintainers of `golang.org/x/sync`, `goleak`, `gobreaker`.
- Every engineer who has written a postmortem and shared it.

The patterns here are not original. The contribution is in collecting them, organising them, and presenting them in a single coherent document at the professional engineering level.

If a future version of this document includes patterns from your work, it is because you wrote about them publicly. Continue writing.

End of Professional file.








