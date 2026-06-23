---
layout: default
title: Professional
parent: ants
grand_parent: Goroutine Pools (3rd-party)
ancestor: Go
nav_order: 5
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/17-goroutine-pools-3rd-party/01-ants/professional/
---

# ants — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Capacity Planning](#capacity-planning)
5. [Multi-Tenant Pools](#multi-tenant-pools)
6. [Observability](#observability)
7. [Error & Panic Reporting](#error--panic-reporting)
8. [Integration with errgroup](#integration-with-errgroup)
9. [Integration with context](#integration-with-context)
10. [Graceful Shutdown](#graceful-shutdown)
11. [Load Shedding & Backpressure](#load-shedding--backpressure)
12. [Rate Limiting in Front of the Pool](#rate-limiting-in-front-of-the-pool)
13. [Tracing & Distributed Context](#tracing--distributed-context)
14. [Resilience Patterns](#resilience-patterns)
15. [Real-World Case Studies](#real-world-case-studies)
16. [Production Deployment Checklist](#production-deployment-checklist)
17. [Testing Strategies](#testing-strategies)
18. [SLOs & Pool Metrics](#slos--pool-metrics)
19. [Cost & Efficiency](#cost--efficiency)
20. [Migration Stories](#migration-stories)
21. [Common Mistakes at Scale](#common-mistakes-at-scale)
22. [Anti-Patterns](#anti-patterns)
23. [Self-Assessment Checklist](#self-assessment-checklist)
24. [Summary](#summary)
25. [Further Reading](#further-reading)
26. [Related Topics](#related-topics)

---

## Introduction

> Focus: "I know how `ants` works. Now I need to ship it. How do I size pools in production, observe them, integrate them with `errgroup`, shut them down cleanly, and survive when things go wrong?"

You've made it through the API (`junior.md`), the configuration (`middle.md`), and the internals (`senior.md`). The remaining gap is the messiest one: real production. Real production cares about things the docs don't cover:

- A pool size that worked in load test doesn't work under real customer traffic.
- A panic in production is a P1 page, not a stderr line.
- Graceful shutdown must drain a pool, but also: respect service mesh deregistration, signal Kubernetes readiness, complete in-flight tasks, and not exceed the kubelet's grace period.
- Multi-tenant systems need fair sharing. One bad customer must not starve all others.
- Observability is non-negotiable. If you can't see the pool from Grafana, you can't operate it.

This file covers the operational reality. The examples are skeletons of real services. The numbers are realistic. The trade-offs are the ones you'll actually face.

By the end you will:

- Know how to size a pool for a specific workload, with measurement.
- Be able to design a multi-tenant pool topology with isolation.
- Know what metrics to export and what alerts to set.
- Know how to integrate `ants` with `errgroup`, `context`, and OpenTelemetry.
- Know how to perform a graceful shutdown that survives Kubernetes.
- Be able to handle load shedding, rate limiting, and circuit breaking.
- Know the production deployment checklist by heart.
- Recognise the antipatterns that get caught only at scale.

This is the longest file in the subsection. Some sections are long-form; others are concise checklists. Use it as a reference.

---

## Prerequisites

- Comfortable with everything in `junior.md`, `middle.md`, `senior.md`.
- Familiar with production Go services — HTTP servers, gRPC, database access, monitoring.
- Familiar with Kubernetes pod lifecycle (signals, grace period, readiness probes).
- Familiar with observability stacks (Prometheus, Grafana, OpenTelemetry).
- Familiar with `context.Context`, `errgroup`, `signal.Notify`.
- Familiar with Go's pprof and runtime diagnostics.

If any of these is shaky, fix that first. The patterns here assume you can read Go code and Kubernetes manifests with fluency.

---

## Glossary

| Term | Definition |
|------|-----------|
| **SLO** | Service Level Objective. A measurable target (e.g., "p99 latency under 200 ms 99.9% of the time"). |
| **Burst capacity** | The pool's ability to handle short-lived spikes above steady-state load. |
| **Utilisation** | `Running / Cap`. Healthy: 50-80%. Above 90% sustained means tight capacity. |
| **Saturation** | The state where `Free == 0` for sustained periods. Submitters block (or are rejected). |
| **Backpressure** | The mechanism by which the system slows down producers when the consumer is overloaded. `ants`'s default blocking mode is intrinsic backpressure. |
| **Load shedding** | Deliberately rejecting load to preserve service quality for accepted requests. `WithNonblocking(true)` enables this. |
| **Bulkhead** | An isolation pattern — separate pools for separate workloads or tenants. A failure in one bulkhead doesn't cascade. |
| **Circuit breaker** | A pattern that opens (fast-fails) when error rate is high, then half-opens to test recovery. |
| **Multi-tenant** | A service shared by many customers, each isolated from the others. |
| **Drain** | The process of completing in-flight work without accepting new work. `ReleaseTimeout` is `ants`'s drain mechanism. |
| **Grace period** | The time a process has between SIGTERM and SIGKILL, typically 30s in Kubernetes. |

---

## Capacity Planning

The first job of running `ants` in production: pick the right `Cap`. Get this wrong and nothing else matters.

### Step 1 — Identify the bottleneck

A pool caps concurrency. Concurrency is bounded by the *slowest* downstream you depend on. Examples:

- HTTP client calling a backend with a 100-concurrent-request limit → cap ≤ 100.
- Database with 50 connections in its pool → cap ≤ 50.
- CPU-bound work → cap ≈ `GOMAXPROCS`.
- Memory-bound work → cap = `available_memory / per_task_memory`.

Pick the most restrictive limit. Pool cap should be at or below that.

### Step 2 — Calculate the throughput formula

`Throughput = Cap / AverageTaskDuration`.

If you target 1000 tasks/sec and task duration is 50 ms:

```
Cap = 1000 * 0.05 = 50
```

50-worker pool is the theoretical minimum. Real life adds jitter.

### Step 3 — Add headroom

For burst absorption and jitter: 1.5x to 2x the minimum.

```
Cap = 50 * 1.5 = 75
```

Headroom isn't waste — it's insurance against tail latency spikes from slow tasks.

### Step 4 — Validate with load test

Run a load test at your target rate. Observe:

- `Running` should hover around `Cap * utilisation_target`.
- `Free` should stay positive most of the time.
- p99 latency should meet SLO.

If `Running == Cap` constantly and latency exceeds SLO, the pool is too small. If `Running` is always ≪ `Cap`, the pool is over-sized.

### Step 5 — Set autoscaling triggers

For Kubernetes HPA, scale pods (not pool cap) on CPU or queue depth. Pool cap stays fixed per pod. The number of pods scales.

For pool-level autoscaling (rare): poll `Free` and call `Tune` based on the ratio. We've covered this in `middle.md`.

### Example — Capacity planning for an email service

Service receives email send requests. Each request triggers a SendGrid API call. SendGrid allows 600 req/min per key (10 req/sec).

- Bottleneck: SendGrid rate limit → cap ≤ 10 concurrent at theoretical max throughput.
- Average call duration: 200 ms.
- Throughput at cap 10: `10 / 0.2 = 50 ops/sec`. Above SendGrid's 10/sec — wait, we're capped by their rate, not our cap.
- Re-evaluate: max throughput = 10 ops/sec.
- Required cap = `10 * 0.2 = 2` to saturate the rate limit.
- Plus headroom for slow calls: cap 4-8.

So: `NewPool(8)` with a separate rate limiter at 10 req/sec.

### Example — Capacity planning for a CPU-bound batch job

Service processes 100 GB of CSVs daily. Each row needs a CPU-bound transformation.

- Bottleneck: CPU cores. Container has 4 cores.
- `GOMAXPROCS = 4`.
- Cap = 4. Higher wastes memory and increases contention.

So: `NewPool(4)` with single pod. Or multiple pods, each with `NewPool(4)`, scaled horizontally.

### Example — Capacity planning for a chat broadcast service

Service fans out a message to N online users via WebSocket. Per-user send takes ~5 ms.

- Bottleneck: WebSocket library's `Write` performance.
- Burst size: up to 100k recipients per message.
- p99 latency target: 200 ms total.

For 100k users at 5 ms each, sequentially: 500 seconds. We need concurrency.

If cap = 200, throughput = 200 / 0.005 = 40000 sends/sec. 100k users / 40000 = 2.5 seconds. Above SLO.

If cap = 2000, throughput = 400000 sends/sec. 100k / 400000 = 0.25 sec. Within SLO.

So: `NewPool(2000)`. Memory cost: ~4 MB stack. Acceptable.

But watch FD limits — 2000 simultaneous Writes means 2000 sockets. Tune your OS.

---

## Multi-Tenant Pools

If your service serves many customers, one customer's bad behaviour should not affect others. This is the **bulkhead** pattern.

### Pattern 1 — One pool per tenant

```go
type Service struct {
	mu    sync.RWMutex
	pools map[string]*ants.Pool
}

func (s *Service) Submit(tenant string, task func()) error {
	s.mu.RLock()
	p, ok := s.pools[tenant]
	s.mu.RUnlock()
	if !ok {
		s.mu.Lock()
		p, ok = s.pools[tenant]
		if !ok {
			p, _ = ants.NewPool(50, ants.WithNonblocking(true))
			s.pools[tenant] = p
		}
		s.mu.Unlock()
	}
	return p.Submit(task)
}
```

Pros: complete isolation. One slow tenant doesn't slow others.

Cons: many pools = many janitors. Per-tenant memory overhead.

For thousands of tenants, this is expensive. Use Pattern 2.

### Pattern 2 — Tiered pools

Group tenants into tiers (free, paid, enterprise). One pool per tier.

```go
type Service struct {
	free       *ants.Pool
	paid       *ants.Pool
	enterprise *ants.Pool
}

func (s *Service) Submit(tier Tier, task func()) error {
	switch tier {
	case Enterprise: return s.enterprise.Submit(task)
	case Paid:       return s.paid.Submit(task)
	default:         return s.free.Submit(task)
	}
}
```

Pros: fewer pools. Fair tier allocation.

Cons: not fair *within* a tier — a single free user can saturate the free pool.

For fair-within-tier, add a per-tenant rate limiter (`golang.org/x/time/rate`).

### Pattern 3 — Sharded pools

Use `MultiPool` with custom load balancing that hashes by tenant:

```go
type TenantStrategy struct{}

func (TenantStrategy) Pick(pools []*ants.Pool, hint interface{}) int {
	tenant, _ := hint.(string)
	h := fnv.New32a()
	h.Write([]byte(tenant))
	return int(h.Sum32()) % len(pools)
}
```

Each tenant always lands on the same shard. Tenants share shards but in a deterministic way.

Pros: O(1) tenant-to-pool mapping. Easy.

Cons: not strictly isolated — tenants on the same shard share fate.

### Pattern 4 — Dynamic pool reclamation

For long-tail tenants, pools should be reclaimed when idle:

```go
func (s *Service) janitor() {
	t := time.NewTicker(5 * time.Minute)
	for range t.C {
		s.mu.Lock()
		for tenant, p := range s.pools {
			if p.Running() == 0 && time.Since(lastUsed[tenant]) > 30*time.Minute {
				go p.ReleaseTimeout(10 * time.Second)
				delete(s.pools, tenant)
			}
		}
		s.mu.Unlock()
	}
}
```

Reclaim pools for inactive tenants. Saves memory in long-tail scenarios.

### When to use which

- Few high-value tenants → one pool per tenant.
- Many tenants in a few tiers → tiered pools.
- Very many tenants, all small → sharded pools.
- Long tail of inactive tenants → dynamic reclamation.

---

## Observability

If you cannot graph it, you cannot operate it. `ants` doesn't ship metrics — you wire them up.

### Metrics to export

For each pool in your service:

- `pool_cap` (gauge) — current cap. Spike means `Tune` happened.
- `pool_running` (gauge) — current running. Track utilisation.
- `pool_free` (gauge) — current free slots.
- `pool_waiting` (gauge) — blocked submitters. Spike means saturation.
- `pool_submit_total{result}` (counter) — labelled by `ok` / `overload` / `closed`.
- `pool_panic_total` (counter) — panic count.
- `pool_task_duration_seconds` (histogram) — per-task duration. Optional but useful.

### Prometheus example

```go
import (
	"github.com/prometheus/client_golang/prometheus"
)

var (
	poolCap = prometheus.NewGaugeVec(prometheus.GaugeOpts{
		Name: "ants_pool_cap",
		Help: "Pool capacity.",
	}, []string{"name"})

	poolRunning = prometheus.NewGaugeVec(prometheus.GaugeOpts{
		Name: "ants_pool_running",
		Help: "Workers currently running tasks.",
	}, []string{"name"})

	poolFree = prometheus.NewGaugeVec(prometheus.GaugeOpts{
		Name: "ants_pool_free",
		Help: "Workers free.",
	}, []string{"name"})

	poolWaiting = prometheus.NewGaugeVec(prometheus.GaugeOpts{
		Name: "ants_pool_waiting",
		Help: "Blocked submitters.",
	}, []string{"name"})

	poolSubmitTotal = prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "ants_pool_submit_total",
		Help: "Total submits.",
	}, []string{"name", "result"})

	poolPanicTotal = prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "ants_pool_panic_total",
		Help: "Total panics in pool tasks.",
	}, []string{"name"})
)

func init() {
	prometheus.MustRegister(poolCap, poolRunning, poolFree, poolWaiting, poolSubmitTotal, poolPanicTotal)
}
```

### Polling loop

```go
func (s *Service) startMetricsLoop(ctx context.Context) {
	t := time.NewTicker(5 * time.Second)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done(): return
		case <-t.C:
			poolCap.WithLabelValues("notify").Set(float64(s.pool.Cap()))
			poolRunning.WithLabelValues("notify").Set(float64(s.pool.Running()))
			poolFree.WithLabelValues("notify").Set(float64(s.pool.Free()))
			poolWaiting.WithLabelValues("notify").Set(float64(s.pool.Waiting()))
		}
	}
}
```

### Wrapper for submit metrics

```go
func (s *Service) Submit(task func()) error {
	err := s.pool.Submit(task)
	switch {
	case err == nil:
		poolSubmitTotal.WithLabelValues("notify", "ok").Inc()
	case errors.Is(err, ants.ErrPoolOverload):
		poolSubmitTotal.WithLabelValues("notify", "overload").Inc()
	case errors.Is(err, ants.ErrPoolClosed):
		poolSubmitTotal.WithLabelValues("notify", "closed").Inc()
	}
	return err
}
```

### Panic handler metric

```go
func panicHandler(p interface{}) {
	poolPanicTotal.WithLabelValues("notify").Inc()
	log.Errorf("pool panic: %v\n%s", p, debug.Stack())
}
```

### Grafana dashboard sketch

For each pool:

- **Utilisation:** `pool_running / pool_cap` as a percentage. Alert if >90% for 5 min.
- **Saturation:** `pool_waiting`. Alert if >0 sustained.
- **Submit rate:** `rate(pool_submit_total[1m])`. Alert if drops to zero unexpectedly.
- **Overload rate:** `rate(pool_submit_total{result="overload"}[1m])`. Alert if non-zero.
- **Panic rate:** `rate(pool_panic_total[5m])`. Alert if >0.

### Alerts

- **PoolSaturated:** `pool_running == pool_cap` for >5 min.
- **PoolWaiting:** `pool_waiting > 0` for >2 min.
- **PoolOverloaded:** `rate(pool_submit_total{result="overload"}[5m]) > 0`.
- **PoolPanic:** `increase(pool_panic_total[5m]) > 0`.

Each alert has a clear meaning and runbook.

---

## Error & Panic Reporting

Panics in production are events to be detected, logged, deduplicated, and alerted on.

### Capturing panics

In the panic handler:

```go
func panicHandler(p interface{}) {
	stack := debug.Stack()

	// Increment metric.
	poolPanicTotal.WithLabelValues("notify").Inc()

	// Capture to Sentry / Honeybadger / etc.
	sentry.CaptureException(fmt.Errorf("pool panic: %v", p))

	// Log with structured logging.
	log.WithFields(log.Fields{
		"event": "pool.panic",
		"value": fmt.Sprintf("%v", p),
		"stack": string(stack),
	}).Error("pool panic")
}
```

### Deduplication

Panics with the same stack are usually the same bug. Use Sentry's fingerprinting or your error tracker's grouping.

### Severity

- **One-off panic:** Likely a transient input bug. Log, count, move on.
- **Sustained panic rate:** Real bug. Page on-call.

Set thresholds:

```
panic_rate > 1/sec for 5 min -> page
panic_rate > 0.1/sec for 30 min -> ticket
```

### Don't crash on panic

The pool's recover prevents crashes. Don't undo that by calling `os.Exit` in the handler — except for truly unrecoverable conditions like OOM.

---

## Integration with errgroup

`errgroup` provides first-error short-circuit and context cancellation. `ants` provides worker reuse. They compose well.

### Pattern 1 — errgroup over ants

```go
g, ctx := errgroup.WithContext(parent)
for _, item := range items {
	item := item
	g.Go(func() error {
		done := make(chan error, 1)
		err := pool.Submit(func() {
			done <- process(ctx, item)
		})
		if err != nil { return err }
		return <-done
	})
}
return g.Wait()
```

Each `g.Go` spawns a goroutine that submits to the pool and waits for the result via a channel. The `errgroup` provides cancellation.

Trade-offs:
- Pro: errgroup semantics (cancel-all-on-error).
- Pro: bounded by errgroup's `SetLimit` if you want it.
- Con: one extra goroutine per task (the `g.Go` wrapper).

For high task rate, the extra goroutine adds 10-50% overhead. For lower rate, irrelevant.

### Pattern 2 — errgroup as concurrency cap, ants as worker farm

```go
g, ctx := errgroup.WithContext(parent)
g.SetLimit(50) // cap submitters
for _, item := range items {
	item := item
	g.Go(func() error {
		// errgroup limits to 50 concurrent g.Go bodies
		errCh := make(chan error, 1)
		err := pool.Submit(func() {
			errCh <- process(ctx, item)
		})
		if err != nil { return err }
		return <-errCh
	})
}
return g.Wait()
```

`errgroup.SetLimit(50)` ensures at most 50 producers wait on the pool. The pool handles the actual work. Useful when you don't want unbounded submitter goroutines.

### Pattern 3 — Direct submit with collected errors

```go
errs := make([]error, len(items))
var wg sync.WaitGroup
for i, item := range items {
	i, item := i, item
	wg.Add(1)
	_ = pool.Submit(func() {
		defer wg.Done()
		errs[i] = process(ctx, item)
	})
}
wg.Wait()
return errors.Join(errs...)
```

No `errgroup`, no extra goroutine per task. Trade-off: no early-cancel on first error. All tasks run to completion.

### When to choose which

- Need first-error cancellation: errgroup (pattern 1 or 2).
- Need all errors: direct (pattern 3).
- Performance-critical with low task count: errgroup pattern 1.
- Performance-critical with high task count: direct pattern 3 or non-errgroup with manual cancel.

---

## Integration with context

`ants.Pool` does not accept `context.Context`. You add it.

### Pattern 1 — Context in the task

```go
_ = pool.Submit(func() {
	if ctx.Err() != nil { return }
	process(ctx, work)
})
```

Task checks context on entry. If already cancelled, return immediately.

### Pattern 2 — Context wrapper

```go
type ContextPool struct {
	p *ants.Pool
}

func (c *ContextPool) Submit(ctx context.Context, task func(context.Context)) error {
	return c.p.Submit(func() {
		if ctx.Err() != nil { return }
		task(ctx)
	})
}
```

Caller passes context naturally.

### Pattern 3 — Deadline-aware submit

```go
func submitWithDeadline(ctx context.Context, p *ants.Pool, task func(context.Context)) error {
	// Check if context is already done before submitting.
	if err := ctx.Err(); err != nil { return err }
	return p.Submit(func() {
		// Inside, also derive a tighter context if needed.
		taskCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
		defer cancel()
		task(taskCtx)
	})
}
```

### Pattern 4 — Cancel chain

```go
// Service-level cancel.
sigs := make(chan os.Signal, 1)
signal.Notify(sigs, syscall.SIGTERM)
go func() {
	<-sigs
	serviceCancel()
}()

// Request-level cancel derived from service.
ctx, cancel := context.WithTimeout(s.serviceCtx, 10*time.Second)
defer cancel()
return pool.Submit(func() {
	if ctx.Err() != nil { return }
	doWork(ctx)
})
```

The task's context is chained from service-level (SIGTERM cancels) to request-level (timeout cancels). Either cancels the task.

### Anti-pattern — Background context inside tasks

```go
_ = pool.Submit(func() {
	doWork(context.Background()) // ignores all cancellation
})
```

Tasks should not start with `context.Background()`. Pass it in from outside.

---

## Graceful Shutdown

Shutting down a service that uses `ants` correctly is harder than it looks.

### The goal

When the service receives SIGTERM:

1. Stop accepting new requests (HTTP server stops listening).
2. Drain in-flight requests (their tasks complete or time out).
3. Release pools.
4. Exit cleanly.

All within the Kubernetes grace period (default 30 seconds).

### Naive shutdown

```go
sigs := make(chan os.Signal, 1)
signal.Notify(sigs, syscall.SIGTERM)
<-sigs
pool.Release()
os.Exit(0)
```

Problems:

- `Release` returns immediately; in-flight tasks may still run.
- `os.Exit(0)` doesn't run deferred functions.
- HTTP server may have requests in flight.

### Better shutdown

```go
sigs := make(chan os.Signal, 1)
signal.Notify(sigs, syscall.SIGTERM, syscall.SIGINT)
<-sigs

// 1. Stop accepting new traffic (drain HTTP).
shutdownCtx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
defer cancel()
if err := httpServer.Shutdown(shutdownCtx); err != nil {
	log.Printf("http shutdown: %v", err)
}

// 2. Cancel service-level context to stop in-flight tasks.
serviceCancel()

// 3. Drain pool.
if err := pool.ReleaseTimeout(20 * time.Second); err != nil {
	log.Printf("pool release: %v", err)
}

log.Println("shutdown complete")
```

Order matters:

1. HTTP first — no new requests.
2. Service context cancel — in-flight requests are notified.
3. Pool drain — wait for tasks to complete.

Total budget: 25 + 20 = 45 seconds, exceeds 30-second grace. Tighten:

```go
shutdownCtx, _ := context.WithTimeout(context.Background(), 15*time.Second)
httpServer.Shutdown(shutdownCtx)
pool.ReleaseTimeout(10 * time.Second)
```

Or run them in parallel:

```go
var wg sync.WaitGroup
wg.Add(2)
go func() { defer wg.Done(); httpServer.Shutdown(ctx) }()
go func() { defer wg.Done(); pool.ReleaseTimeout(20*time.Second) }()
wg.Wait()
```

### Kubernetes considerations

- **Preserve readiness:** Before SIGTERM, k8s removes the pod from service endpoints. Use a `preStop` hook to drain even before the signal.
- **Grace period:** `terminationGracePeriodSeconds: 30`. If you need more, increase.
- **PostStart / preStop:** Use `preStop` to mark unready, sleep a few seconds for the iptables update, then send SIGTERM.

### preStop hook example

```yaml
lifecycle:
  preStop:
    exec:
      command: ["sh", "-c", "sleep 5"]
```

Five seconds for the iptables update to propagate. Then your process sees SIGTERM and shuts down.

### Health checks during shutdown

After SIGTERM, return 503 from health check:

```go
var shuttingDown atomic.Bool

http.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
	if shuttingDown.Load() {
		http.Error(w, "shutting down", http.StatusServiceUnavailable)
		return
	}
	w.WriteHeader(200)
})

// On SIGTERM:
shuttingDown.Store(true)
```

This way, the load balancer marks the pod unhealthy quickly.

---

## Load Shedding & Backpressure

When demand exceeds capacity, you must shed load — refuse some requests to preserve quality for the rest.

### Mechanism 1 — Pool non-blocking + 503

```go
err := pool.Submit(task)
if errors.Is(err, ants.ErrPoolOverload) {
	w.WriteHeader(http.StatusServiceUnavailable)
	return
}
```

Direct: pool full → request rejected. Client retries with backoff.

### Mechanism 2 — Token bucket in front

```go
limiter := rate.NewLimiter(100, 50) // 100 ops/sec, burst 50

if !limiter.Allow() {
	w.WriteHeader(http.StatusTooManyRequests)
	return
}
err := pool.Submit(task)
```

Rate limiter before the pool. Predictable rate regardless of pool state.

### Mechanism 3 — Adaptive concurrency

```go
// Monitor pool latency. If p99 latency exceeds threshold, reduce admission rate.
if observedP99 > threshold {
	limiter.SetLimit(rate.Limit(limiter.Limit() * 0.8))
}
```

Self-tuning. Complex to get right; reach for libraries like `aws-go-sdk`'s `service` package or `Netflix's concurrency-limits` port.

### Mechanism 4 — Priority shedding

Shed low-priority work first:

```go
if pool.Free() == 0 && priority == Low {
	return ErrTooBusy
}
err := pool.Submit(task)
```

Or use separate pools per priority.

### Mechanism 5 — Queue-aware shedding

If you have a separate queue in front of the pool:

```go
if queueDepth > threshold {
	return ErrTooBusy
}
```

The queue depth is your signal.

### Don't let producers retry blindly

If the pool is shedding, callers should:

- Wait before retrying (exponential backoff).
- Honour `Retry-After` header.
- Eventually give up.

Without backoff, retries create a thundering herd that makes shedding worse.

---

## Rate Limiting in Front of the Pool

`ants` caps concurrency, not rate. For rate limiting, add another layer.

### Token bucket

```go
import "golang.org/x/time/rate"

limiter := rate.NewLimiter(rate.Limit(100), 200) // 100 ops/sec, burst 200

if err := limiter.Wait(ctx); err != nil {
	return err
}
_ = pool.Submit(task)
```

`limiter.Wait` blocks until a token is available (or context cancels). Pairs with blocking pool.

### Sliding window

For per-customer rate limits, use a sliding window counter (Redis with `INCR` + expiry). Check before submit.

### Combining rate and concurrency

Two layers:

- **Rate limiter** (token bucket) enforces ops/sec.
- **Pool** (`ants`) enforces concurrency.

Sized together: `rate * avg_duration ≈ concurrency`. If rate is 100 ops/sec and tasks take 0.5 s, concurrency converges to ~50.

Don't size the pool for less than `rate * avg_duration` — the limiter will be the bottleneck and the pool will be underutilised. Don't size for much more — wasted capacity.

---

## Tracing & Distributed Context

Production services use distributed tracing (OpenTelemetry). The trace context must propagate through `ants`.

### Pattern — Tracing through Submit

```go
func submitTraced(ctx context.Context, p *ants.Pool, name string, task func(context.Context)) error {
	tracer := otel.Tracer("notify-service")
	return p.Submit(func() {
		ctx, span := tracer.Start(ctx, name)
		defer span.End()
		task(ctx)
	})
}
```

The trace ID propagates from `ctx` to the task. The span starts when the worker picks up the task (not when `Submit` is called).

### Span attributes

```go
span.SetAttributes(
	attribute.String("pool.name", "notify"),
	attribute.Int("pool.cap", p.Cap()),
	attribute.Int("pool.running", p.Running()),
)
```

These help correlate slow tasks with pool saturation.

### Tracing the wait

If your task waits in `Submit` (blocking mode), you can capture that:

```go
ctx, submitSpan := tracer.Start(ctx, "pool.submit.wait")
err := p.Submit(func() { ... })
submitSpan.End()
```

If `submitSpan` duration is large, pool is saturated.

### Async vs sync semantics

`Submit` is async — the task runs on a worker, possibly later. Your trace shows:

```
parent_span (HTTP request)
  ├── child_span (Submit returns immediately)
  └── child_span (worker runs task — possibly milliseconds later)
```

The async child span is detached from the parent's wall-clock duration. Some tracing systems handle this; others don't. Test your stack.

### Linking spans

OpenTelemetry has "Span Links" for async work. Use them to correlate the submitter and the task:

```go
link := trace.LinkFromContext(ctx)
go func() {
	ctx2, span := tracer.Start(context.Background(), "task", trace.WithLinks(link))
	defer span.End()
}()
```

---

## Resilience Patterns

Beyond capacity and shutdown, resilience patterns protect against partial failures.

### Pattern 1 — Bulkhead

Already covered (multi-tenant pools). One bulkhead per dependency or per tenant.

### Pattern 2 — Circuit breaker

```go
type CircuitBreaker struct {
	failures   int64
	threshold  int64
	resetAfter time.Duration
	openUntil  atomic.Value // time.Time
}

func (cb *CircuitBreaker) Call(f func() error) error {
	if until := cb.openUntil.Load(); until != nil {
		if t := until.(time.Time); time.Now().Before(t) {
			return errors.New("circuit open")
		}
	}
	err := f()
	if err != nil {
		if atomic.AddInt64(&cb.failures, 1) > cb.threshold {
			cb.openUntil.Store(time.Now().Add(cb.resetAfter))
			atomic.StoreInt64(&cb.failures, 0)
		}
	} else {
		atomic.StoreInt64(&cb.failures, 0)
	}
	return err
}
```

Wrap `Submit` (or the task itself) with the breaker. After N failures, the circuit opens and rejects calls for `resetAfter` duration.

For real production, use `sony/gobreaker` or similar — it handles half-open state, sliding windows, etc.

### Pattern 3 — Timeout

Every task should have a timeout. Without one, a stuck task occupies a worker forever.

```go
func runWithTimeout(ctx context.Context, d time.Duration, fn func(context.Context) error) error {
	ctx, cancel := context.WithTimeout(ctx, d)
	defer cancel()
	return fn(ctx)
}
```

Use inside the task:

```go
_ = pool.Submit(func() {
	if err := runWithTimeout(ctx, 5*time.Second, doWork); err != nil {
		log.Warn(err)
	}
})
```

### Pattern 4 — Retry with backoff

```go
import "github.com/cenkalti/backoff/v4"

err := backoff.Retry(func() error {
	return submitAndWait(ctx, pool, task)
}, backoff.WithMaxRetries(backoff.NewExponentialBackOff(), 3))
```

Retry transient errors (`ErrPoolOverload`, network timeouts). Don't retry permanent errors (`ErrPoolClosed`, validation errors).

### Pattern 5 — Hedging

For latency-sensitive reads, submit duplicate requests and use the first to respond:

```go
result := make(chan int, 2)
_ = pool.Submit(func() { result <- backendA(req) })
_ = pool.Submit(func() { result <- backendB(req) })
return <-result // first wins
```

Doubles pool consumption. Use only for critical reads.

### Pattern 6 — Fallback

If primary fails, try secondary:

```go
err := pool.Submit(func() { primary() })
if err != nil {
	err = pool.Submit(func() { fallback() })
}
```

Or fall back inline if pool is overloaded:

```go
if err := pool.Submit(task); err != nil {
	task() // run on caller
}
```

Inline fallback removes the pool's protection. Use sparingly.

---

## Real-World Case Studies

### Case Study 1 — Notification Service at a SaaS

Service: send push notifications, emails, SMS.

Architecture:
- API endpoints accept requests.
- Each notification type has its own pool.
- Push: cap 1000 (matches APNS HTTP/2 concurrency).
- Email: cap 100 (matches SES rate limit).
- SMS: cap 50 (matches Twilio).
- Each pool has `WithNonblocking(true)` and overflow to Redis queue.

Lessons learned:
- Initial sizing was too small. Doubled after first month of load.
- `WithExpiryDuration(5*time.Minute)` to keep workers warm — connection setup cost was high.
- Panic handler integrated with Sentry. Caught early bugs in Twilio response parsing.

### Case Study 2 — Image Processing at a Media Company

Service: thumbnail generation, format conversion.

Architecture:
- Single pool, cap = `2 * GOMAXPROCS` for image transforms.
- CPU-bound, memory-heavy.
- `WithDisablePurge(true)` — workers always busy.
- Tasks read from S3, transform, write back.

Lessons learned:
- Pool size much larger than `GOMAXPROCS` (2x) because tasks have I/O wait. Pure-CPU would have been 1x.
- Memory cap (per task: 200 MB) forced careful sizing. 4 GB container = max 20 concurrent. Cap = 16 with headroom.
- `WithPanicHandler` saved during a bad image causing libvips to panic.

### Case Study 3 — Event Stream Processor

Service: consume Kafka events, transform, write to BigQuery.

Architecture:
- `MultiPool` of 8 sub-pools, cap 100 each.
- `LeastTasks` strategy.
- Each task: transform one event, batch into BQ stream.

Lessons learned:
- Single `Pool` was lock-contended. `MultiPool` reduced contention dramatically.
- BQ streaming has its own rate limits. Pool cap matched to total quota / 8 shards.
- Graceful shutdown: cancel Kafka consumer first, drain pool, then commit offsets.

### Case Study 4 — WebSocket Hub

Service: broadcast messages to thousands of WebSocket clients.

Architecture:
- One pool per channel/room.
- Cap per pool = max recipients per room.
- Inside each pool: one task per recipient.

Lessons learned:
- Many small pools was costly (each has a janitor). Switched to one large pool with per-room rate limiting.
- `PoolWithFunc` for the hot path. Argument: pointer to message + recipient ID.
- Custom panic handler logged the message ID for replay.

### Case Study 5 — Database Migration Runner

Service: run thousands of small migrations in parallel.

Architecture:
- Pool cap = DB connection pool size - safety margin.
- `WithNonblocking(false)` (default) — slow but reliable.
- Tasks idempotent.

Lessons learned:
- DB connection exhaustion was the killer. Pool cap was too high initially.
- `Tune` down during heavy reads from the app to prioritise user traffic.
- Tasks logged progress to a separate table for visibility.

---

## Production Deployment Checklist

Before shipping `ants` to production:

### Code

- [ ] `defer pool.Release()` (or `ReleaseTimeout`) on every `NewPool`.
- [ ] `Submit` errors always handled (logged or propagated).
- [ ] `WithPanicHandler` installed.
- [ ] Tasks accept and honour `context.Context`.
- [ ] Closures capture loop variables correctly.

### Configuration

- [ ] Pool capacity is config-driven (not hard-coded).
- [ ] Default capacity has been load-tested.
- [ ] Tier-based pools for multi-tenant.
- [ ] Non-blocking + overflow strategy chosen.

### Observability

- [ ] Metrics exported for `Running`, `Free`, `Waiting`, `Cap`.
- [ ] Submit success/failure counters.
- [ ] Panic counter.
- [ ] Dashboards in Grafana.
- [ ] Alerts on saturation and panic rate.

### Resilience

- [ ] Tasks have per-task timeout.
- [ ] Downstream calls have circuit breakers.
- [ ] Retries with backoff for transient errors.
- [ ] Load shedding on overload.

### Shutdown

- [ ] Signal handler installed.
- [ ] HTTP server drained before pool.
- [ ] `ReleaseTimeout` with grace period.
- [ ] preStop hook in k8s manifest.
- [ ] Readiness probe returns 503 during shutdown.

### Testing

- [ ] Unit tests for tasks.
- [ ] Load tests against pool.
- [ ] Chaos tests: panic injection, pool release mid-flight.
- [ ] Profiling under load.

### Operations

- [ ] Runbook for "pool saturated" alert.
- [ ] Runbook for "panic detected" alert.
- [ ] Documentation of pool sizes and rationale.
- [ ] On-call escalation path.

If you can tick all of these, you're production-ready.

---

## Testing Strategies

### Unit tests for tasks

The task is just a function. Test it directly, without the pool:

```go
func TestProcessTask(t *testing.T) {
	err := processTask(ctx, input)
	require.NoError(t, err)
	// assert side effects
}
```

The pool itself is `ants`'s responsibility. Don't test their library.

### Integration tests for the wiring

Test that your service correctly uses the pool:

```go
func TestServiceSubmitsToPool(t *testing.T) {
	svc := NewService(2)
	defer svc.Close(5 * time.Second)

	var processed int64
	for i := 0; i < 100; i++ {
		svc.Submit(func() { atomic.AddInt64(&processed, 1) })
	}
	require.Eventually(t, func() bool {
		return atomic.LoadInt64(&processed) == 100
	}, 10*time.Second, 10*time.Millisecond)
}
```

### Load tests

Use a tool like `hey`, `vegeta`, or write a custom generator:

```go
func TestPoolUnderLoad(t *testing.T) {
	svc := NewService(50)
	defer svc.Close(30 * time.Second)

	start := time.Now()
	var wg sync.WaitGroup
	for i := 0; i < 10000; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			svc.Submit(realisticTask)
		}()
	}
	wg.Wait()
	t.Logf("10000 ops in %v", time.Since(start))
}
```

### Chaos tests

Inject failures during operation:

```go
func TestChaosPanic(t *testing.T) {
	svc := NewService(10)
	defer svc.Close(5 * time.Second)

	// Submit panicking tasks
	for i := 0; i < 100; i++ {
		svc.Submit(func() { panic("test") })
	}

	// Service should still accept normal tasks
	var ok int64
	svc.Submit(func() { atomic.AddInt64(&ok, 1) })
	require.Eventually(t, func() bool {
		return atomic.LoadInt64(&ok) == 1
	}, time.Second, 10*time.Millisecond)
}
```

### Benchmark

```go
func BenchmarkSubmit(b *testing.B) {
	pool, _ := ants.NewPool(50)
	defer pool.Release()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = pool.Submit(func() {})
	}
}
```

Run regularly to catch regressions.

---

## SLOs & Pool Metrics

If your service has SLOs, the pool is a key signal.

### SLO: latency

Target: p99 latency < 200 ms.

Pool's contribution:
- Time spent blocked in `Submit` if pool is full.
- Time spent on the worker (task execution).

Mitigation:
- Size pool so `Waiting` is rarely > 0.
- Optimise task duration.

### SLO: availability

Target: 99.9% of submits succeed.

Pool's contribution:
- `ErrPoolOverload` reduces availability.
- `ErrPoolClosed` during shutdowns reduces availability.

Mitigation:
- Headroom in cap.
- Graceful shutdown that completes within grace period.

### SLO: throughput

Target: 1000 ops/sec sustained.

Pool's contribution:
- `Cap / AvgDuration` is the upper bound.

Mitigation:
- Increase cap or decrease task duration.

### Error budget

If you have 99.9% availability SLO, that's 0.1% errors = 0.001 error rate. Over 1M ops, 1000 errors. Spend wisely:
- Some during shutdowns.
- Some on legitimate overload.
- Some on bugs.

Track error budget burn via Prometheus.

---

## Cost & Efficiency

### CPU cost

Pool overhead per submit: ~100 ns. At 1M submits/sec: ~10% of a core. Worth it for the benefits.

### Memory cost

Per worker: 2 KB minimum, grown to task's needs. Cap 1000 → ~2-50 MB stack. Plus per-pool struct ~5 KB.

### GC pressure

Closures allocate. At high submit rate, GC pressure grows. `PoolWithFunc` mitigates.

### Container sizing

Allocate memory for:
- Heap (your data).
- Stack (per goroutine).
- Pool internal (~80 KB per pool).
- Runtime (~30 MB baseline).

A 256 MB container with 1000 workers needs ~50 MB for stacks alone. Plan accordingly.

### Bin packing

Multiple services per pod is risky — pool memory adds up. Prefer single-service pods unless you've measured the joint footprint.

---

## Migration Stories

Teams migrating to `ants` typically come from:

### From naked goroutines

```go
for _, x := range items {
	go func(x int) {
		work(x)
	}(x)
}
```

To:

```go
for _, x := range items {
	x := x
	_ = pool.Submit(func() {
		work(x)
	})
}
```

Migration is straightforward. Wins: bounded concurrency, recovery, observability.

### From `golang.org/x/sync/errgroup`

```go
g, _ := errgroup.WithContext(ctx)
g.SetLimit(50)
for _, x := range items {
	x := x
	g.Go(func() error { return work(x) })
}
return g.Wait()
```

To:

```go
g, _ := errgroup.WithContext(ctx)
g.SetLimit(50)
for _, x := range items {
	x := x
	g.Go(func() error {
		errCh := make(chan error, 1)
		_ = pool.Submit(func() { errCh <- work(x) })
		return <-errCh
	})
}
return g.Wait()
```

More boilerplate but worker reuse. Win only at high task rate. Often, plain errgroup is fine.

### From hand-rolled channel-based pools

Often the hand-rolled pool grows into a mess of options that mimic `ants`. Migrating to `ants` reduces code and gives you community-tested behaviour.

### From other libraries (tunny, workerpool)

Similar shape, different APIs. Usually a 1-2 day migration including tests.

---

## Common Mistakes at Scale

Mistakes that only show up at production scale.

### Mistake 1 — Insufficient stress testing

Local tests pass. Production fails. Always stress-test at 2-3x expected load.

### Mistake 2 — Forgetting downstream limits

Your pool cap is 1000 but downstream allows 100. You'll get hammered with rate-limit errors. Cap at the downstream's limit.

### Mistake 3 — Shared pool across services

Service A's slow tasks starve Service B. Always isolate.

### Mistake 4 — Misunderstanding "concurrent" vs "parallel"

A pool of 1000 doesn't mean 1000 things actually happening at once on the CPU. CPU parallelism is bounded by `GOMAXPROCS`. The other 996 are interleaved.

### Mistake 5 — No backpressure to callers

Your service has unlimited blocking submitters. Callers don't know to back off. They retry harder, your pool gets worse. Use non-blocking mode and return 503.

### Mistake 6 — Pool size = container CPU

For I/O work, this is way too small. For CPU work, this is right but rarely the bottleneck.

### Mistake 7 — Ignoring `Waiting`

You watch `Running` and `Free` but not `Waiting`. Latency complaints arrive because submitters are queued — pool is full but you don't know.

### Mistake 8 — Single pool for multi-tenant

One bad tenant DoSes everyone. Use per-tenant pools or rate limiters.

### Mistake 9 — Pool never `Release`d

Service restarts hourly, each instance leaks its pool. Memory creeps. Always defer release.

### Mistake 10 — Tune in production without testing

Live tuning is dangerous. Always test in staging. `Tune` is atomic but the *effect* (workers spawning/dying) takes time.

---

## Anti-Patterns

A consolidated list of anti-patterns at the professional level.

### Anti 1 — Pool per request

Each request creates a new pool. Pool creation overhead dominates. Use a shared, long-lived pool.

### Anti 2 — Pool for serialisation

Pool of cap 1 to "serialise tasks." That's a mutex. Use a mutex.

### Anti 3 — Pool inside a tight CPU loop

Adding a pool inside a CPU-bound loop slows it down. Pools are for I/O concurrency or coarse-grained CPU parallelism.

### Anti 4 — Pool for everything

One global pool for HTTP, DB, file I/O, image processing. Each contends with others. Split per workload.

### Anti 5 — Ignoring shutdown signals

Service runs until SIGKILL. In-flight tasks lost. Pool leaks. Always have a signal handler.

### Anti 6 — No metrics

You can't see the pool. You can't operate it. Always export metrics.

### Anti 7 — Hard-coded cap

Cap baked into source. Can't tune without redeploy. Make it config-driven.

### Anti 8 — Premature optimisation

Reaching for `PoolWithFunc` or `MultiPool` before measuring. Default `Pool` is fast enough for almost everyone.

### Anti 9 — Naked panic recovery

```go
ants.WithPanicHandler(func(p interface{}) {})
```

Empty handler. Hides bugs. Always at least log.

### Anti 10 — Releasing without draining

```go
pool.Release()
return
```

In-flight tasks may not complete. Use `ReleaseTimeout`.

---

## Self-Assessment Checklist

You are professional-level when you can:

- [ ] Size a pool for a new workload, defending the chosen cap.
- [ ] Design a multi-tenant pool topology for your service.
- [ ] Wire up Prometheus metrics for every pool.
- [ ] Configure alerts that catch saturation, overload, and panics.
- [ ] Implement graceful shutdown that survives Kubernetes.
- [ ] Combine `ants` with `errgroup` and `context`.
- [ ] Identify the right load-shedding strategy for a given service.
- [ ] Plumb tracing through `Submit`.
- [ ] Stress-test a pool under realistic conditions.
- [ ] Read a service's pool config and predict its behaviour.
- [ ] Write a runbook for "pool saturated" alert.
- [ ] Defend the decision to use `ants` vs alternatives in a design review.

---

## Summary

Production `ants` is more than a library; it's a discipline:

- **Capacity** is sized to the downstream, validated with load tests, made config-driven.
- **Tenancy** is isolated via bulkheads — per-customer pools, tiered pools, or sharded pools.
- **Observability** is non-negotiable — metrics, dashboards, alerts.
- **Shutdown** is orchestrated — HTTP drain, context cancel, pool drain, all within grace period.
- **Resilience** is layered — circuit breakers, timeouts, retries, fallbacks.
- **Costs** are accounted — CPU, memory, GC.

The library does the heavy lifting of worker reuse and concurrency capping. The hard work — knowing the right cap, integrating with everything else, surviving production — is yours.

If you've made it through all four levels (junior, middle, senior, professional), you can deploy `ants` with confidence. The remaining files (`specification.md`, `interview.md`, `tasks.md`, `find-bug.md`, `optimize.md`) are references and exercises.

---

## Further Reading

- The Tencent `gnet` source (uses `ants`).
- "Site Reliability Engineering" by Google — chapters on overload and shedding.
- "Release It!" by Michael Nygard — stability patterns.
- The `golang.org/x/sync` package docs — `errgroup`, `semaphore`, `singleflight`.
- Brendan Gregg's blog on systems performance — relevant for load testing and profiling.
- OpenTelemetry Go documentation — for tracing.

## Related Topics

- `12-graceful-shutdown` — signal handling, draining, k8s lifecycle.
- `13-runtime-scheduler` — GMP and how it interacts with pools.
- `18-errgroup` — first-error semantics and concurrency cap.
- `19-semaphore` — a lighter alternative for bounded concurrency.
- `20-singleflight` — request coalescing.
- `25-observability` — metrics, traces, logs.
- `30-production-go` — broader production patterns.

---

## Extended Section: Designing a Pool-Backed Service

To bring everything together, let's design a service from scratch.

### Specification

A "Webhook Dispatch" service. Receive webhook events from internal systems; deliver them to customers' HTTP endpoints. Customers configure URL, retry policy, secret for signing. Volume: ~10k events/sec across all customers.

### Capacity sizing

Each delivery is an outbound HTTP POST. Average duration: 200 ms (mostly network).

To handle 10k events/sec at 200 ms each: `concurrency = 10000 * 0.2 = 2000`.

Add 50% headroom: cap = 3000. But we need to consider:
- File descriptor limits (default 1024 on Linux, need to raise).
- Memory: ~3000 workers × ~10 KB stack = 30 MB. Fine.
- Each task uses an HTTP client connection; need to size `Transport.MaxIdleConnsPerHost`.

Decision: pool cap 3000, `ulimit -n` 65535, transport tuned.

### Tenancy

Customers can be free, paid, or enterprise. Free customers should not slurp all capacity.

Decision: three pools.
- Free: cap 500, `WithNonblocking(true)`.
- Paid: cap 1500, blocking with `WithMaxBlockingTasks(1000)`.
- Enterprise: cap 1000, blocking with no max.

Overflow from free → Redis queue with hourly retry. Paid overflow → return 503 to the caller.

### Code skeleton

```go
package webhook

import (
	"context"
	"errors"
	"log"
	"net/http"
	"runtime/debug"
	"sync/atomic"
	"time"

	"github.com/panjf2000/ants/v2"
	"github.com/prometheus/client_golang/prometheus"
)

type Tier int

const (
	Free Tier = iota
	Paid
	Enterprise
)

type Service struct {
	freePool       *ants.Pool
	paidPool       *ants.Pool
	enterprisePool *ants.Pool

	client *http.Client
	ctx    context.Context
	cancel context.CancelFunc

	overflowQueue OverflowQueue

	// Metrics
	submits    *prometheus.CounterVec
	durations  *prometheus.HistogramVec
	pool stats *prometheus.GaugeVec
}

func New(ctx context.Context, q OverflowQueue) (*Service, error) {
	sCtx, cancel := context.WithCancel(ctx)
	s := &Service{
		ctx:           sCtx,
		cancel:        cancel,
		overflowQueue: q,
		client: &http.Client{
			Timeout: 30 * time.Second,
			Transport: &http.Transport{
				MaxIdleConns:        3000,
				MaxIdleConnsPerHost: 100,
				IdleConnTimeout:     90 * time.Second,
			},
		},
	}

	var err error
	s.freePool, err = ants.NewPool(500,
		ants.WithExpiryDuration(60*time.Second),
		ants.WithNonblocking(true),
		ants.WithPanicHandler(s.panicHandler("free")),
	)
	if err != nil { return nil, err }

	s.paidPool, err = ants.NewPool(1500,
		ants.WithExpiryDuration(60*time.Second),
		ants.WithMaxBlockingTasks(1000),
		ants.WithPanicHandler(s.panicHandler("paid")),
	)
	if err != nil { return nil, err }

	s.enterprisePool, err = ants.NewPool(1000,
		ants.WithExpiryDuration(60*time.Second),
		ants.WithPanicHandler(s.panicHandler("enterprise")),
	)
	if err != nil { return nil, err }

	s.startMetricsLoop()
	return s, nil
}

func (s *Service) panicHandler(tier string) func(interface{}) {
	return func(p interface{}) {
		log.Printf("[%s] panic: %v\n%s", tier, p, debug.Stack())
		// metrics.Panics.WithLabelValues(tier).Inc()
	}
}

func (s *Service) Dispatch(tier Tier, event Event) error {
	pool := s.poolForTier(tier)
	err := pool.Submit(func() {
		s.deliver(s.ctx, event)
	})
	if err != nil {
		if errors.Is(err, ants.ErrPoolOverload) {
			if tier == Free {
				return s.overflowQueue.Push(event)
			}
			return errors.New("service unavailable")
		}
		return err
	}
	return nil
}

func (s *Service) poolForTier(t Tier) *ants.Pool {
	switch t {
	case Enterprise: return s.enterprisePool
	case Paid:       return s.paidPool
	default:         return s.freePool
	}
}

func (s *Service) deliver(ctx context.Context, event Event) {
	if ctx.Err() != nil { return }
	req, err := http.NewRequestWithContext(ctx, "POST", event.URL, event.Body)
	if err != nil { return }
	resp, err := s.client.Do(req)
	if err != nil { return }
	resp.Body.Close()
}

func (s *Service) startMetricsLoop() { /* ... */ }

func (s *Service) Close(timeout time.Duration) error {
	s.cancel()
	deadline := time.Now().Add(timeout)
	for _, p := range []*ants.Pool{s.enterprisePool, s.paidPool, s.freePool} {
		left := time.Until(deadline)
		if left <= 0 { break }
		_ = p.ReleaseTimeout(left)
	}
	return nil
}

type Event struct {
	URL  string
	Body interface{ /* ... */ }
}

type OverflowQueue interface {
	Push(Event) error
}
```

### Wiring with HTTP server

```go
func main() {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	svc, _ := webhook.New(ctx, redisOverflowQueue)

	server := &http.Server{
		Addr: ":8080",
		Handler: webhookHandler(svc),
	}

	sigs := make(chan os.Signal, 1)
	signal.Notify(sigs, syscall.SIGTERM, syscall.SIGINT)

	go func() {
		<-sigs
		log.Println("shutdown initiated")
		shutdownCtx, _ := context.WithTimeout(context.Background(), 25*time.Second)
		_ = server.Shutdown(shutdownCtx)
		cancel()
		_ = svc.Close(20 * time.Second)
	}()

	if err := server.ListenAndServe(); err != http.ErrServerClosed {
		log.Fatal(err)
	}
}
```

### Operational details

- **Metrics endpoint** at `/metrics` for Prometheus.
- **Readiness endpoint** at `/ready` returns 503 during shutdown.
- **Logging** structured (zap or zerolog).
- **Tracing** spans on Dispatch and inside delivery.

### Why three pools?

The bulkhead pattern. Free tenants causing high pool pressure don't affect paid or enterprise.

### Why these caps?

Sized to expected steady-state load. Total 3000 across pools means the service can sustain 15k ops/sec (3000 / 0.2 avg). Headroom for 5x peaks.

### What if free is always saturated?

That's their experience problem. Overflow to Redis is the SLA-conforming behaviour. Internally, you may upsell or rate-limit at the API layer.

---

## Extended Section: Common Operational Scenarios

### Scenario 1 — Service is suddenly slow

Symptom: p99 latency jumps from 50 ms to 5 s.

Pool to inspect: see `Waiting` metric. If > 0 and growing, pool is saturated.

Action:
1. Check downstream: is the service we call slow?
2. Check `Running`: is it at cap?
3. If both yes: downstream is slowed, pool can't keep up.
4. Mitigation: tune pool down (forces more rejections), or fix downstream.

### Scenario 2 — Pod can't start

Symptom: new deployment crashes immediately.

Pool relevance: capacity from config. Check value.

Action:
1. Read pool config from environment / config map.
2. Verify cap is positive.
3. Verify `ulimit -n` is high enough for expected FDs.

### Scenario 3 — Memory growth

Symptom: pod OOM-killed after a few hours.

Pool relevance: stack growth, task closures retaining refs.

Action:
1. Heap profile: `go tool pprof http://pod:6060/debug/pprof/heap`.
2. Look for retained references in task closures.
3. Look for slow-growing pool struct (unlikely but possible).
4. Look for blocked submitter goroutines (`runtime.NumGoroutine`).

### Scenario 4 — Pool seems to "freeze"

Symptom: `Running` stays high, `Free` stays low, no progress.

Pool relevance: workers stuck.

Action:
1. Goroutine dump (`SIGQUIT` or `runtime/pprof`).
2. Find workers' stacks. Are they all parked at the same line?
3. Likely a downstream deadlock, slow query, or blocking I/O.
4. Add timeouts inside tasks.

### Scenario 5 — Frequent panic alerts

Symptom: `pool_panic_total` rate > 0.

Pool relevance: tasks panicking.

Action:
1. Check panic handler logs for the panic value.
2. Find the bug in the task.
3. Fix.

Don't disable the panic handler. The pool's resilience is by design — your job is to fix the bug.

### Scenario 6 — Submit failures during deploy

Symptom: `ErrPoolClosed` errors spike during deployments.

Pool relevance: graceful shutdown.

Action:
1. Verify SIGTERM is sent before SIGKILL.
2. Verify HTTP server is drained before pool is released.
3. Increase grace period if needed.

### Scenario 7 — Throughput drop after upgrade

Symptom: `rate(pool_submit_total{result="ok"}[1m])` drops after deploying new version.

Pool relevance: regression in task duration or pool overhead.

Action:
1. Compare task duration before and after.
2. Check for added allocations.
3. If pool overhead changed, profile pool internals.

### Scenario 8 — Multi-tenant noisy neighbour

Symptom: one customer's slowness affects all.

Pool relevance: shared pool, no isolation.

Action:
1. Verify tenants are routed to separate pools.
2. If shared, plan migration to bulkheaded pools.
3. As stopgap: rate-limit the noisy tenant at the API layer.

### Scenario 9 — Tune cap up but nothing changes

Symptom: after `Tune(2*cap)`, throughput stays the same.

Pool relevance: pool wasn't the bottleneck.

Action:
1. Look at `Running` after tune. Did it grow to fill new cap?
2. If no: downstream or producer is the bottleneck, not the pool.
3. Find the real bottleneck (profile, traces, logs).

### Scenario 10 — Pool's CPU profile shows mostly `runtime.lock`

Symptom: pprof CPU is 60% in `sync.(*Mutex).Lock` inside `ants.Submit`.

Pool relevance: lock contention.

Action:
1. Migrate from `Pool` to `MultiPool` with 4-8 shards.
2. Or batch submits (one task processes 10 items).

---

## Extended Section: Building a Pool Wrapper

Production teams typically wrap `ants.Pool` in a service-specific abstraction. This section shows what a good wrapper looks like.

### Goals of the wrapper

- Hide pool details from callers.
- Inject metrics automatically.
- Standardise panic handling.
- Make tests easy.
- Provide context-aware Submit.

### The wrapper

```go
package poolwrap

import (
	"context"
	"errors"
	"log"
	"runtime/debug"
	"time"

	"github.com/panjf2000/ants/v2"
	"github.com/prometheus/client_golang/prometheus"
)

type Pool struct {
	name   string
	pool   *ants.Pool
	hooks  Hooks
	ctx    context.Context
	cancel context.CancelFunc
}

type Hooks struct {
	OnSubmit     func(name string, err error)
	OnTaskStart  func(name string)
	OnTaskEnd    func(name string, panicked bool, duration time.Duration)
	OnPanic      func(name string, p interface{})
}

type Config struct {
	Name        string
	Cap         int
	Expiry      time.Duration
	NonBlocking bool
	MaxBlocking int
	Hooks       Hooks
}

func New(ctx context.Context, cfg Config) (*Pool, error) {
	pCtx, cancel := context.WithCancel(ctx)
	p := &Pool{
		name:   cfg.Name,
		hooks:  cfg.Hooks,
		ctx:    pCtx,
		cancel: cancel,
	}

	pool, err := ants.NewPool(cfg.Cap,
		ants.WithExpiryDuration(cfg.Expiry),
		ants.WithNonblocking(cfg.NonBlocking),
		ants.WithMaxBlockingTasks(cfg.MaxBlocking),
		ants.WithPanicHandler(func(panicVal interface{}) {
			if p.hooks.OnPanic != nil {
				p.hooks.OnPanic(p.name, panicVal)
			} else {
				log.Printf("[%s] panic: %v\n%s", p.name, panicVal, debug.Stack())
			}
		}),
	)
	if err != nil { cancel(); return nil, err }
	p.pool = pool
	return p, nil
}

func (p *Pool) Submit(ctx context.Context, task func(context.Context)) error {
	if err := ctx.Err(); err != nil {
		if p.hooks.OnSubmit != nil { p.hooks.OnSubmit(p.name, err) }
		return err
	}
	err := p.pool.Submit(func() {
		start := time.Now()
		if p.hooks.OnTaskStart != nil { p.hooks.OnTaskStart(p.name) }
		defer func() {
			if p.hooks.OnTaskEnd != nil {
				p.hooks.OnTaskEnd(p.name, recover() != nil, time.Since(start))
			}
		}()
		if ctx.Err() != nil { return }
		task(ctx)
	})
	if p.hooks.OnSubmit != nil { p.hooks.OnSubmit(p.name, err) }
	return err
}

func (p *Pool) Stats() (running, free, cap, waiting int) {
	return p.pool.Running(), p.pool.Free(), p.pool.Cap(), p.pool.Waiting()
}

func (p *Pool) Close(timeout time.Duration) error {
	p.cancel()
	return p.pool.ReleaseTimeout(timeout)
}

// PrometheusHooks builds Hooks that emit Prometheus metrics.
func PrometheusHooks(submits *prometheus.CounterVec,
	durations *prometheus.HistogramVec,
	panics *prometheus.CounterVec) Hooks {
	return Hooks{
		OnSubmit: func(name string, err error) {
			result := "ok"
			if errors.Is(err, ants.ErrPoolOverload) {
				result = "overload"
			} else if errors.Is(err, ants.ErrPoolClosed) {
				result = "closed"
			} else if err != nil {
				result = "error"
			}
			submits.WithLabelValues(name, result).Inc()
		},
		OnTaskEnd: func(name string, panicked bool, d time.Duration) {
			durations.WithLabelValues(name).Observe(d.Seconds())
		},
		OnPanic: func(name string, p interface{}) {
			panics.WithLabelValues(name).Inc()
			log.Printf("[%s] panic: %v\n%s", name, p, debug.Stack())
		},
	}
}
```

### Using the wrapper

```go
hooks := poolwrap.PrometheusHooks(submits, durations, panics)
pool, _ := poolwrap.New(ctx, poolwrap.Config{
	Name:    "notify",
	Cap:     500,
	Expiry:  60 * time.Second,
	Hooks:   hooks,
})
defer pool.Close(30 * time.Second)

err := pool.Submit(ctx, func(ctx context.Context) {
	send(ctx)
})
```

Benefits:
- One place for all pool configuration.
- Metrics automatic.
- Panic logging consistent.
- Test-friendly (`Hooks` can be stubs).

---

## Extended Section: Pool Sizing — A Worked Example

A realistic capacity planning exercise.

### The service

Asynchronous email service. Each request triggers an email send.

### Data

From production:
- Steady-state rate: 50 req/sec.
- Peak (Black Friday): 500 req/sec for 30 minutes.
- Average send duration: 300 ms (SendGrid).
- p99 send duration: 1500 ms.
- SendGrid concurrent limit: 100 per account; you have 5 accounts.

### Calculation

**Steady-state cap:**
- 50 req/sec × 0.3 sec = 15 concurrent. Plus headroom: 30.

**Peak cap:**
- 500 req/sec × 0.3 sec = 150 concurrent. Plus p99 jitter: 250.

**Downstream cap:**
- 5 accounts × 100 = 500 total concurrent allowed.

**Memory cap:**
- 500 workers × 8 KB stack = 4 MB. Plus per-worker HTTP client = ~50 KB? Say 30 MB total. Fine.

**Decision:** cap 250, non-blocking with overflow to Redis. During peak, expect some overflow.

### Validating

Load test at 500 req/sec for 30 minutes:
- `Running` peaks at 250.
- `Waiting` is 0 (non-blocking).
- Overflow rate: ~50 req/sec routed to Redis.

Acceptable: real-time delivery for 90% of peak; queue for 10%.

### Trade-off considered

Could increase cap to 500 (matches downstream limit), eliminating overflow. Cost: 2x memory. Decided not worth it for 30-min/year peak.

### Tracking

Dashboard with:
- `pool_running` (steady-state should be ~15, peak ~250).
- `pool_submit_total{result="overload"}` rate (should be 0 outside peak).
- `email_send_duration` histogram p50/p95/p99.

Alert if non-zero overload outside peak.

---

## Extended Section: Graceful Shutdown Deep Dive

A correct shutdown is the difference between a clean deploy and a 503-spewing one.

### The sequence

1. **External notice.** Load balancer / service mesh marks pod unready (k8s removes from Endpoints).
2. **Drain delay.** Pod sleeps a few seconds (in preStop) so iptables update propagates.
3. **SIGTERM.** Kubernetes signals the pod.
4. **Stop accepting.** HTTP server stops accepting new requests.
5. **Drain in-flight.** Server waits for in-flight requests to complete.
6. **Cancel context.** Service-level context cancels. In-flight tasks see cancellation.
7. **Drain pool.** `ReleaseTimeout` waits for pool tasks.
8. **Exit cleanly.** Program returns from main.

If 1-8 doesn't fit in `terminationGracePeriodSeconds`, you'll be SIGKILL'd. Then in-flight tasks may be cut off mid-write.

### Timing budget

Default grace = 30 sec. Spend:
- preStop: 5 sec.
- HTTP drain: 15 sec.
- Pool drain: 10 sec.

Total: 30 sec. Tight. If HTTP drain reliably finishes in 10 sec, leave 20 for pool.

### Forcing tasks to abort

Tasks should check context. If you have long-running CPU work, sprinkle `ctx.Err()` checks:

```go
for i := 0; i < N; i++ {
	if ctx.Err() != nil { return ctx.Err() }
	process(items[i])
}
```

Otherwise, the task ignores cancellation and the pool can't drain.

### Forcing pool to abort

If `ReleaseTimeout` times out, the pool is *closed* but tasks are still running. Your `main` continues, then `os.Exit(0)` (or `return` from main) kills everything. Any I/O the tasks were doing is interrupted by the kernel.

This is acceptable for batch jobs (re-run them). It is unacceptable for stateful writes (database writes). For stateful work:

- Make tasks idempotent.
- Use transactions; uncommitted changes are rolled back.
- Use a journal: write intent first, then commit; on restart, replay.

### Pre-stop hooks

```yaml
spec:
  terminationGracePeriodSeconds: 60
  containers:
  - name: app
    lifecycle:
      preStop:
        exec:
          command: ["sh", "-c", "sleep 10"]
```

Sleep 10 sec before SIGTERM. Total grace = 60 - 10 = 50 sec for the app.

### Health checks

```yaml
readinessProbe:
  httpGet:
    path: /ready
    port: 8080
  failureThreshold: 1
  periodSeconds: 5
```

Quick failure: if `/ready` returns non-200, pod is removed from service immediately.

In Go:

```go
var shuttingDown atomic.Bool

http.HandleFunc("/ready", func(w http.ResponseWriter, r *http.Request) {
	if shuttingDown.Load() {
		http.Error(w, "shutting down", http.StatusServiceUnavailable)
		return
	}
	w.WriteHeader(http.StatusOK)
})

// On SIGTERM:
shuttingDown.Store(true)
```

### End-to-end example

```go
package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/panjf2000/ants/v2"
)

func main() {
	pool, _ := ants.NewPool(100,
		ants.WithPanicHandler(func(p interface{}) { log.Printf("panic: %v", p) }),
	)

	var shuttingDown atomic.Bool

	mux := http.NewServeMux()
	mux.HandleFunc("/ready", func(w http.ResponseWriter, r *http.Request) {
		if shuttingDown.Load() {
			http.Error(w, "shutting down", http.StatusServiceUnavailable)
			return
		}
		w.WriteHeader(http.StatusOK)
	})
	mux.HandleFunc("/work", func(w http.ResponseWriter, r *http.Request) {
		err := pool.Submit(func() { time.Sleep(500 * time.Millisecond) })
		if errors.Is(err, ants.ErrPoolClosed) {
			http.Error(w, "shutting down", http.StatusServiceUnavailable)
			return
		}
		w.WriteHeader(http.StatusOK)
	})

	server := &http.Server{Addr: ":8080", Handler: mux}

	sigs := make(chan os.Signal, 1)
	signal.Notify(sigs, syscall.SIGTERM, syscall.SIGINT)

	go func() {
		<-sigs
		log.Println("shutdown signal received")
		shuttingDown.Store(true)

		// Give load balancer time to deregister.
		time.Sleep(5 * time.Second)

		// Stop accepting new HTTP requests.
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		if err := server.Shutdown(ctx); err != nil {
			log.Printf("http shutdown: %v", err)
		}

		// Drain pool.
		if err := pool.ReleaseTimeout(10 * time.Second); err != nil {
			log.Printf("pool release: %v", err)
		}

		log.Println("shutdown complete")
	}()

	if err := server.ListenAndServe(); err != http.ErrServerClosed {
		log.Fatal(err)
	}
	log.Println("server exited")
}
```

This is the template. Adapt to your service's needs.

---

## Extended Section: Multi-Pool Architectures

When one pool isn't enough, you compose them.

### Architecture 1 — Pipeline pools

Three stages, each a pool. Tasks flow A → B → C.

```go
stageA, _ := ants.NewPool(100)
stageB, _ := ants.NewPool(50)
stageC, _ := ants.NewPool(20)

func Process(item Item) {
	_ = stageA.Submit(func() {
		a := transformA(item)
		_ = stageB.Submit(func() {
			b := transformB(a)
			_ = stageC.Submit(func() {
				transformC(b)
			})
		})
	})
}
```

Pool sizes reflect each stage's bottleneck. C is the slowest, so it has the smallest cap (or the largest, depending on direction of bottleneck).

Watch out for cyclic submit deadlocks if stages cross-submit.

### Architecture 2 — Per-priority pools

Three priorities, each a pool.

```go
urgent, _ := ants.NewPool(100)
normal, _ := ants.NewPool(500)
bulk, _ := ants.NewPool(2000)

func Submit(prio Priority, task func()) error {
	switch prio {
	case Urgent: return urgent.Submit(task)
	case Normal: return normal.Submit(task)
	case Bulk:   return bulk.Submit(task)
	}
}
```

Urgent has the smallest cap (low queue depth) but highest priority. Bulk has the largest cap (high throughput) but lowest priority.

### Architecture 3 — Per-customer pools

Already covered (multi-tenant).

### Architecture 4 — Per-region pools

If you call multiple regions:

```go
useast, _ := ants.NewPool(100)
uswest, _ := ants.NewPool(100)
euwest, _ := ants.NewPool(50)
```

Sized per region's capacity. Region failure doesn't cascade.

### Architecture 5 — Pool of pools

A `MultiPool` is exactly this. Or build your own routing:

```go
type RouterPool struct {
	pools []*ants.Pool
	pick  func(task Task) int
}

func (r *RouterPool) Submit(task Task) error {
	return r.pools[r.pick(task)].Submit(func() { task.Run() })
}
```

Custom routing — affinity, hashing, custom heuristic.

### Architecture 6 — Hot and cold pools

A small "hot" pool for synchronous-feeling work, a large "cold" pool for slow tasks.

```go
hot, _ := ants.NewPool(20, ants.WithNonblocking(true))
cold, _ := ants.NewPool(2000)

func Submit(task Task) error {
	if task.Hot() {
		err := hot.Submit(task.Run)
		if errors.Is(err, ants.ErrPoolOverload) {
			return cold.Submit(task.Run)
		}
		return err
	}
	return cold.Submit(task.Run)
}
```

Hot tasks try the hot pool first; on overload, fall back to cold.

---

## Extended Section: SLA-Driven Sizing

A more formal approach to sizing.

### Define SLA

Examples:
- "99% of submits succeed (no overload) under steady load."
- "p99 latency from submit to task start is < 50 ms."
- "Pool drain on shutdown completes in < 20 sec."

### Translate to pool config

For "99% succeed":
- Cap must absorb 99th percentile of arrival rate × task duration.
- Use queueing theory: M/M/c queue analysis (`erlang-c` formula).

For "p99 submit-to-start < 50 ms":
- Submit queue depth must stay ≤ 50 ms × throughput.
- Cap such that `Waiting` rarely exceeds threshold.

For "drain in < 20 sec":
- Average task duration × queue depth at shutdown < 20 sec.
- This constrains both cap and `MaxBlockingTasks`.

### Erlang-C example

If arrival rate = 1000 events/sec, average service rate per worker = 5 events/sec (task takes 200 ms), and target wait probability < 1%:

Use Erlang-C calculator → required workers ≈ 220.

In `ants`: `NewPool(220)`. Margin: 250.

Most teams don't do this rigorously — they over-provision and observe. Erlang-C is for capacity planning at scale.

---

## Extended Section: Comparing Approaches — Build vs. Buy

When considering `ants` vs alternatives:

### Build your own?

```go
// In 30 lines:
type Pool struct { tasks chan func() }
func New(n int) *Pool {
	p := &Pool{tasks: make(chan func())}
	for i := 0; i < n; i++ {
		go func() { for t := range p.tasks { t() } }()
	}
	return p
}
func (p *Pool) Submit(t func()) { p.tasks <- t }
func (p *Pool) Close() { close(p.tasks) }
```

You gain: no dependency, simple, fits in head.
You lose: panic handling, expiry, options, MultiPool, observability hooks.

For a one-off batch job, your 30 lines may be enough. For a long-running service, use `ants`.

### Use `errgroup`?

```go
g, _ := errgroup.WithContext(ctx)
g.SetLimit(50)
for _, x := range items { x := x; g.Go(func() error { return f(x) }) }
return g.Wait()
```

Gains: error semantics, context propagation.
Losses: per-task goroutine, no worker reuse, no continuous service.

For batch operations: errgroup. For continuous services: ants.

### Use `semaphore`?

```go
sem := semaphore.NewWeighted(50)
for _, x := range items { x := x; sem.Acquire(ctx, 1); go func() { defer sem.Release(1); f(x) }() }
```

Similar to errgroup but no error semantics. Same trade-offs.

### Decision matrix

| Need | Use |
|------|-----|
| Long-lived service, sustained high rate | `ants.Pool` |
| Long-lived service, same function, very high rate | `ants.PoolWithFunc` |
| Long-lived service, lock-contention concern | `ants.MultiPool` |
| Batch with first-error short-circuit | `errgroup` |
| Just cap concurrency for a batch | `semaphore` |
| One-off, no dependencies | Hand-rolled |

---

## Extended Section: Reading Production Logs

When you investigate a pool issue, you start with logs.

### Log lines to look for

- `pool panic: ...` — panic handler fired. Investigate.
- `ErrPoolOverload` returned — pool saturated.
- `ErrPoolClosed` returned — submit during shutdown.
- `ReleaseTimeout: ...` — pool didn't drain in time.

### Log correlation

Tag each log line with:
- Pool name.
- Tenant ID.
- Request ID (from trace context).

Then in your log aggregator, filter:

```
service=notify AND log_line="pool panic" AND timestamp>1h
```

### Log volume

A busy pool can flood logs. Sample:

```go
var logSampler = rate.NewLimiter(1, 5) // 1 per sec, burst 5
if logSampler.Allow() {
	log.Printf("panic: %v", p)
}
```

Or use a structured logger with sampling built in.

### Don't log every submit

A million submits/sec = a million log lines/sec. Useless. Log only:
- Errors.
- Periodic stats.
- Anomalies.

---

## Extended Section: Pool in CI

How to test pool behaviour in CI.

### Smoke test

```go
func TestPoolSmoke(t *testing.T) {
	pool, err := ants.NewPool(10)
	require.NoError(t, err)
	defer pool.Release()

	var n int64
	for i := 0; i < 100; i++ {
		_ = pool.Submit(func() { atomic.AddInt64(&n, 1) })
	}
	require.Eventually(t, func() bool {
		return atomic.LoadInt64(&n) == 100
	}, time.Second, 10*time.Millisecond)
}
```

Run on every PR. Catches obvious bugs.

### Race detector

```bash
go test -race ./...
```

Run regularly. The pool is internally race-free; your *usage* might not be.

### Goroutine leak detection

Use `go.uber.org/goleak` to ensure tests don't leak goroutines:

```go
import "go.uber.org/goleak"

func TestMain(m *testing.M) {
	goleak.VerifyTestMain(m)
}
```

After every test, goleak checks for unexpected goroutines. If you forgot `pool.Release()`, you see it.

### Benchmark in CI

Track regressions. `go test -bench=. -benchmem ./...` per commit. Alert on >10% throughput drop.

---

## Extended Section: Capacity Modelling Exercise

Pick a service you know. Walk through the sizing.

### Step 1 — Identify the workload

What does the pool do? Be specific. "Process incoming HTTP requests" is too vague. "Make outbound HTTP POST to X with a JSON body" is right.

### Step 2 — Measure task duration

Run the task 100 times in a benchmark. Measure mean and p99. Note the variance.

### Step 3 — Estimate arrival rate

From production logs or metrics. Steady state and peak.

### Step 4 — Identify the bottleneck

CPU? I/O? Database? Memory? Whatever is most constrained.

### Step 5 — Compute the minimum cap

`Cap_min = ArrivalRate * AvgDuration` (Little's Law).

### Step 6 — Apply downstream constraints

`Cap_actual = min(Cap_min * 1.5, DownstreamLimit)`.

### Step 7 — Validate

Load test. Observe metrics. Adjust.

### Step 8 — Document

Comment in code: "Cap = 250 because peak rate is 1000 req/sec, avg duration 200 ms, with 25% headroom. Downstream allows 500 concurrent so we're safe."

The comment is gold. Future readers (including you) thank you.

---

## Extended Section: Pool & Service Mesh

If your service runs in a service mesh (Istio, Linkerd), the mesh interacts with the pool.

### Mesh shaping

The mesh may limit per-pod concurrent requests. Your pool's effective cap is `min(pool_cap, mesh_limit)`.

### Mesh timeout

The mesh imposes a request timeout. If your task exceeds it, the mesh kills the connection — the task continues but its work is lost.

### Mesh retry

The mesh may retry failed requests. Your pool sees duplicate requests. Make tasks idempotent.

### Mesh observability

The mesh provides latency, error rate, throughput metrics. These complement your pool metrics. Together they triangulate the bottleneck.

---

## Extended Section: Pool & Database

Most pools end up calling a database. The pool and DB connection pool interact.

### DB connection pool

Each `*sql.DB` is a connection pool with `SetMaxOpenConns`, `SetMaxIdleConns`, `SetConnMaxLifetime`.

### Sizing relationship

If your pool cap is N and each task uses one DB connection, you need ≥ N DB connections. Otherwise, tasks queue inside the DB driver.

Sequential bottleneck: the smaller of pool cap and DB pool cap.

### Don't double-cap

If you set both `NewPool(100)` and `db.SetMaxOpenConns(50)`, your effective cap is 50. Pool capacity above 50 is wasted.

### DB connection limits at the DB

Most DBs have global connection limits (PostgreSQL `max_connections`, default 100). Sum across all clients. If 10 pods × 50 connections = 500, your DB rejects.

Reduce per-pod DB pool size. Or use PgBouncer (transaction pooling).

### Long-running transactions

If a task holds a DB transaction for 30 sec, it holds the connection for 30 sec. Pool slot also held. Two pools wait for one resource — slow.

Mitigation: short transactions, idempotent tasks, retry-friendly logic.

---

## Extended Section: Pool & Cache

A pool may interact with a cache (Redis, Memcached).

### Cache stampede

Many tasks miss cache simultaneously, hammer the backend. Use `singleflight` to coalesce:

```go
import "golang.org/x/sync/singleflight"

var sf singleflight.Group

_ = pool.Submit(func() {
	val, err, _ := sf.Do(key, func() (interface{}, error) {
		return loadFromBackend(key)
	})
	_ = val; _ = err
})
```

`singleflight.Do` ensures only one in-flight call per key.

### Cache filling and pool size

If your pool fills the cache on cold start, sized for filling speed:

`Cap = (CacheItems * AvgLoadTime) / FillBudget`.

For 1M cache items, 50 ms each, 60-sec fill budget: `Cap = 1M * 0.05 / 60 = 833`. Pool of 1000.

### Cache evictions

Pool tasks may also write to cache. Eviction strategy interacts with pool size — too many writers can saturate cache memory.

---

## Final Self-Assessment

You should be able to:

- Design a service architecture using `ants` for a given workload.
- Size pools based on measurement, not guesswork.
- Wire up observability end-to-end.
- Implement graceful shutdown that survives k8s.
- Reason about multi-tenant isolation.
- Compose `ants` with `errgroup`, `context`, tracing.
- Identify and fix common production issues.
- Defend pool decisions in design review.
- Read a service's pool config and spot smells.
- Migrate from naive goroutines to `ants` cleanly.

If all of these are second-nature, you've reached professional mastery.

---

## Closing

`ants` is a small library that, when used well, makes Go services more robust and predictable under load. The library does the worker-pool basics well. The hard work — production fit, integration, operations — is yours.

The remaining files in this subsection are reference material: `specification.md` for the API surface, `interview.md` for Q&A practice, `tasks.md` for hands-on coding, `find-bug.md` for debugging exercises, `optimize.md` for performance scenarios. Pick what you need.

---

## Appendix — Operating a Pool over 1 Year

A year-in-the-life sketch.

### Month 1 — Deploy

You ship the service with `NewPool(100)` and basic options. Initial traffic is light. Metrics show `Running < 20` most of the time. You congratulate yourself.

### Month 2 — Traffic grows

Customer onboarding spikes traffic. `Running` reaches 80. p99 latency creeps up. You add an alert at `Running > 70` for 5 min.

### Month 3 — Real saturation

A marketing campaign drives 2x traffic. Pool is at cap for an hour. `Waiting` grows. p99 jumps to 5s. Customers complain.

Action: tune cap to 250. Latency returns to baseline.

### Month 4 — First panic

A bad event triggers a panic in your task. Sentry alerts you. The pool's recover prevents service crash. You fix the bug. Add a regression test.

### Month 5 — Multi-tenant inception

A noisy customer's traffic spikes 10x. Your service slows for everyone. You realise you need bulkheads.

Action: split into free / paid / enterprise pools. Migration takes a sprint. Tests pass. Production stable.

### Month 6 — Memory leak hunt

Pod memory grows slowly. OOM-killed every 12 hours. You suspect the pool.

Investigation: heap profile shows task closures retaining a per-request struct that holds a reference to a large response buffer. Fix: zero the response buffer in the closure or use `sync.Pool` for buffers.

### Month 7 — Tune in production

Add `Tune` based on time-of-day. Larger cap during business hours, smaller at night. Saves cost.

### Month 8 — Pool optimisation

`pprof` shows `runtime.lock_slow` at 15%. Migrate to `MultiPool` with 4 shards. Lock contention drops. Throughput up 20%.

### Month 9 — Black Friday

Traffic 5x normal. Bulkheads hold. Some overflow to Redis (planned). Enterprise customers unaffected. Free customers see slight delay. SRE happy.

### Month 10 — Library upgrade

Upgrade `ants/v2.7` to `v2.9`. Benchmarks show 5% throughput improvement. Deploy. Watch for regressions. None observed.

### Month 11 — Documentation

Write internal docs for the pool architecture. Explain the cap rationale, the bulkhead design, the metrics, the alerts, the runbook.

### Month 12 — Retro

Year-end review:
- Two panics (both fixed).
- Three saturation events (cap bumps).
- Two cost-saving tunings.
- One library upgrade.
- Zero outages caused by the pool.

Plan for next year: add adaptive concurrency, explore generics-aware `PoolWithFunc` in newer ants.

---

## Appendix — Pool Anti-Patterns at Scale

Beyond the basic anti-patterns, these emerge only at scale.

### Anti-A — Unbounded growth pools

A pool whose cap grows monotonically over time (autoscaler that only grows, never shrinks). Eventually exhausts memory.

Fix: include shrink logic. Or pool size from config, not dynamic.

### Anti-B — Pool per goroutine

A goroutine that creates its own pool, submits a task, releases. The pool overhead per submission dominates.

Fix: share one pool.

### Anti-C — Many tiny pools

Hundreds of pools each with cap 5. Each pool has a janitor. Janitors dominate CPU.

Fix: fewer pools with larger caps, or `MultiPool`.

### Anti-D — Pool the size of `int.Max`

`NewPool(math.MaxInt32)` "to be safe." Pool no longer bounds anything. Memory unbounded.

Fix: realistic cap based on measurement.

### Anti-E — Synchronous Submit + Wait

Submitting and immediately waiting for the task. Equivalent to running inline.

Fix: only submit if the work is truly fire-and-forget or batchable.

### Anti-F — Ignoring backpressure

Producer just keeps submitting. Pool blocks. Submitter goroutine count grows. Memory growth.

Fix: cap blocked submitters with `WithMaxBlockingTasks` or use non-blocking mode.

### Anti-G — `Tune` from inside tasks

Tasks change pool size based on their own behaviour. Self-referential mess.

Fix: tune from a controller goroutine, not from work goroutines.

### Anti-H — Custom panic handler that allocates

Heavy panic handler allocates on the stack of a panicking task. Slows recovery. May exacerbate OOM.

Fix: minimal allocation in handler. Defer heavy work to a goroutine (with care).

### Anti-I — Pool inside a hot path

`for { p, _ := ants.NewPool(10); p.Submit(...); p.Release() }`. Pool churn.

Fix: hoist the pool out of the loop.

### Anti-J — Pool leak via captured handler

A closure passed to `WithPanicHandler` captures a large struct. That struct is referenced by the pool forever.

Fix: top-level functions for handlers. Or carefully scope captured values.

---

## Appendix — A Tour of Pool-Adjacent Libraries

Other libraries that fit alongside `ants`.

### `golang.org/x/sync/errgroup`

First-error short-circuit. Already covered.

### `golang.org/x/sync/semaphore`

Counting semaphore. Bounded concurrency without worker reuse.

### `golang.org/x/sync/singleflight`

Coalesce duplicate concurrent calls. Pairs with pool tasks that may dedupe.

### `golang.org/x/time/rate`

Token bucket rate limiter. Use in front of the pool.

### `sony/gobreaker`

Circuit breaker. Wrap pool calls or tasks.

### `cenkalti/backoff`

Exponential backoff for retries. Use inside tasks or around `Submit`.

### `uber-go/automaxprocs`

Auto-set `GOMAXPROCS` in containers. Helps pool sizing for CPU-bound work.

### `go.uber.org/zap` / `rs/zerolog`

Structured logging. Use for pool panic handler output.

### `prometheus/client_golang`

Metrics. Already covered.

### `open-telemetry/opentelemetry-go`

Tracing. Already covered.

A typical service uses 3-5 of these alongside `ants`.

---

## Appendix — On-Call Runbook for a Pool-Based Service

A real on-call runbook.

### Alert: PoolSaturated (Running == Cap for >5 min)

**Symptom:** Pool is at max concurrent.

**Steps:**
1. Check `Waiting` — if growing, latency degrading.
2. Check `Submit` overload rate — if > 0, dropping load.
3. Check downstream latency — is downstream slow?
4. If yes: address downstream (page their on-call).
5. If no: tune up the pool: `kubectl exec -- <update config>` or restart with bigger cap.

**Resolution:** `Running` drops below cap, `Waiting` drops to 0.

### Alert: PoolPanic (panic rate > 0 for 5 min)

**Symptom:** Tasks are panicking.

**Steps:**
1. Inspect logs for `pool panic:` lines.
2. Look at the panic value and stack trace.
3. Identify the bug.
4. Create a ticket; assign to dev team.
5. If panic rate is high (>10/sec), consider rollback.

**Resolution:** Panic rate drops to 0 after deploy of fix.

### Alert: PoolOverloadHigh (overload rate > 1/sec for 10 min)

**Symptom:** Pool is rejecting load.

**Steps:**
1. Check downstream — is it slower than usual?
2. Check `pool_running` — is it at cap?
3. Check arrival rate — is traffic spiking?
4. If transient spike: wait, monitor.
5. If sustained: scale up (add pods or tune cap).
6. If downstream slow: page downstream team.

**Resolution:** Overload rate returns to 0.

### Alert: PoolStuck (Running > 0 but no Submit progress for 5 min)

**Symptom:** Workers seem stuck.

**Steps:**
1. Get goroutine dump: `kubectl exec -- curl http://localhost:6060/debug/pprof/goroutine?debug=2`.
2. Look at workers' stacks. Where are they parked?
3. Likely culprits: DB query without timeout, HTTP call without timeout, channel deadlock.
4. Add timeouts; redeploy.

**Resolution:** Tasks make progress; pool drains.

### Alert: PoolDrainFailed (ReleaseTimeout returned error during shutdown)

**Symptom:** Pool didn't drain in time during deploy.

**Steps:**
1. Review pod's shutdown logs.
2. Check `terminationGracePeriodSeconds`.
3. Check if tasks are honouring `ctx.Done()`.
4. Bump grace period or fix task cancellation.

**Resolution:** Subsequent deploys drain cleanly.

---

## Appendix — Pool & Production Go Configuration

Beyond pool config, production Go has knobs.

### GOMAXPROCS

Set explicitly for containers. `uber-go/automaxprocs` does this automatically based on container CPU limit.

```go
import _ "go.uber.org/automaxprocs"
```

### GOGC

GC pacing. Default 100 (let heap double before next GC). For pool-heavy services, sometimes increasing to 200-300 reduces GC overhead.

```go
debug.SetGCPercent(200)
```

Measure before changing.

### GOMEMLIMIT (Go 1.19+)

Set the soft memory limit. Go's GC will work harder to stay under it.

```go
debug.SetMemoryLimit(int64(2 << 30)) // 2 GB
```

For containers: set to container's memory limit minus headroom.

### Goroutine count cap

`runtime/debug.SetMaxStack` caps single goroutine stack. Doesn't cap goroutine count directly.

### Goroutine dump

`SIGQUIT` (Ctrl-\ or `kill -3`) dumps all stacks. Useful for debugging.

```bash
kubectl exec -- kill -3 1
```

(PID 1 inside container.)

---

## Appendix — Pool & GC Tuning

A pool-heavy service may stress the GC.

### What allocates in a pool

- `Submit(closure)` — the closure escapes to heap.
- The task's body — anything `new(T)` or `make(...)`.
- `Invoke(arg)` — the argument may be on the heap.

### Reducing allocations

- Use `PoolWithFunc` to avoid per-submit closures.
- Use `sync.Pool` for tasks' transient objects.
- Pre-allocate buffers, reuse.

### GC pause budgets

If your service has a p99 latency budget of 100 ms, GC pauses must be < 10 ms.

In Go 1.19+, the GC is concurrent and pauses are typically < 1 ms. But heap size matters: a 10 GB heap may have larger pauses.

Mitigations:
- Smaller heap (less data in memory).
- `GOMEMLIMIT` to force GC earlier.
- Profile for unnecessary allocations.

---

## Appendix — Multi-Pool Performance Comparison

Imaginary benchmark, illustrative numbers:

| Configuration | Throughput (ops/sec) | p99 submit latency | Memory |
|---------------|----------------------|--------------------|--------|
| Plain `go f()` | 5M | < 1 µs | high |
| `errgroup` (no limit) | 4M | < 1 µs | high |
| `errgroup` (limit 1000) | 3M | 10 µs | low |
| `semaphore` (1000) | 3M | 15 µs | low |
| `ants.Pool(1000)` | 8M | 100 ns | low |
| `ants.PoolWithFunc(1000)` | 11M | 80 ns | very low |
| `ants.MultiPool(4 x 250)` | 14M | 70 ns | low |

(Numbers are made up. Run real benchmarks.)

The pattern: `ants` is faster than the alternatives for sustained throughput, with lower memory. `MultiPool` adds further speed at high contention.

---

## Appendix — Cost of Wrong Pool Size

Some illustrative consequences.

### Too small

- Throughput capped.
- Latency grows.
- Customers see slowness.
- SLO violations.

### Too large

- Memory waste.
- Container OOM risk.
- More goroutines = more scheduler overhead.
- More open FDs = OS-level issues.
- More downstream connections than intended = downstream slowness.

The right size is sized to the workload, validated by load test, documented in code.

---

## Appendix — Architectural Patterns Beyond Pool

A pool is one piece of a larger architecture.

### Pattern — Worker queue with persistence

If tasks must not be lost (e.g., financial), use a persistent queue (Kafka, Redis Streams, SQS) in front of the pool. Tasks are read from the queue, processed by pool workers, acked on success.

### Pattern — Saga / orchestrator

Long-running multi-step workflows. The pool is one of many — orchestrator coordinates.

### Pattern — Event sourcing

Events appended to a log. Consumers (each backed by a pool) process events idempotently.

### Pattern — CQRS

Commands (write) handled by one pool, queries (read) by another. Caps sized differently.

In all of these, `ants` is the execution layer; the architecture is the topology.

---

## Appendix — Pool & Functional Programming Style

Some teams prefer a more declarative style:

```go
func Map(pool *ants.Pool, items []Item, f func(Item) Result) []Result {
	results := make([]Result, len(items))
	var wg sync.WaitGroup
	for i, item := range items {
		i, item := i, item
		wg.Add(1)
		_ = pool.Submit(func() {
			defer wg.Done()
			results[i] = f(item)
		})
	}
	wg.Wait()
	return results
}
```

Or generic in Go 1.18+:

```go
func Map[T, R any](pool *ants.Pool, items []T, f func(T) R) []R {
	results := make([]R, len(items))
	var wg sync.WaitGroup
	for i, item := range items {
		i, item := i, item
		wg.Add(1)
		_ = pool.Submit(func() {
			defer wg.Done()
			results[i] = f(item)
		})
	}
	wg.Wait()
	return results
}
```

Useful for batch operations. Less useful for streaming.

---

## Appendix — Final Tips for Production

1. **Document pool decisions.** Capacity, options, rationale.
2. **Monitor every pool.** Metrics and alerts.
3. **Test under realistic load.** Synthetic benchmarks lie.
4. **Plan for failure.** What happens when downstream fails? When the pool is full?
5. **Practice shutdowns.** Run chaos tests that kill the pod and verify clean draining.
6. **Update regularly.** `ants` releases bug fixes and perf improvements.
7. **Profile in production.** `pprof` over HTTP, sampled CPU and heap.
8. **Tune from data.** Never tune by guess.
9. **Share knowledge.** Pool architecture should not be in one person's head.
10. **Keep it simple.** Reach for `MultiPool` and `PoolWithFunc` only when needed.

---

## Appendix — Glossary Beyond Pool

Terms you'll see alongside `ants` in production discussions.

- **APM:** Application Performance Monitoring (Datadog, New Relic).
- **SLI:** Service Level Indicator. The measurement (e.g., latency, error rate).
- **Error budget:** Allowable error rate (1 - SLO).
- **Bulkhead:** Isolation pattern.
- **Backpressure:** Producer slowdown signal.
- **Idempotent:** Same result regardless of how many times executed.
- **Eventually consistent:** Will converge to correct state given enough time.
- **Tail latency:** p99, p99.9 — the slowest few percent.
- **Saturation:** All resources fully used.
- **Tenant:** A customer or logical group in a multi-tenant system.

---

## Appendix — A Letter to Your Future Self

Future self, when you're investigating a pool issue:

1. **Don't trust your memory.** Read the code. Read the config. Read the metrics.
2. **Trust the metrics over hunches.** If `Waiting` is 0, the pool is not saturated.
3. **Check the obvious first.** Pool released? Cap reasonable? Tasks have timeouts?
4. **Look at the downstream.** Most pool problems are really downstream problems.
5. **Don't tune in panic.** Tune in measure-and-deploy cycles.
6. **Page the right people.** If downstream is slow, page their team. If pool is misconfigured, page yours.
7. **Document the fix.** Next time, you'll remember faster.
8. **Add a test.** Every bug is a test that should have existed.

Production is humbling. The pool is a small piece; the system is large.

---

## Appendix — Conclusion

`ants` in production: a small library doing a big job. The library is well-designed. The hard work is yours: sizing, monitoring, integrating, shutting down, surviving failures.

If you've read all of `junior.md`, `middle.md`, `senior.md`, `professional.md` — and especially if you've done the exercises — you have a complete view of `ants`. The remaining files in the subsection are for reference and practice.

Onward to `specification.md` for the precise API surface.

---

## Extended Section: Detailed Case Study — Building a Real-Time Analytics Pipeline

A walk-through of a real-time analytics pipeline at imaginary scale, using `ants` heavily.

### Background

A SaaS analytics platform ingests 100k events/sec across all customers. Each event is enriched (lookup user, geocode IP, parse user-agent), then written to ClickHouse for query.

### Architecture

```
Kafka -> Consumer goroutines -> Pool (enrich) -> Pool (batch & write)
                                                    -> ClickHouse
```

Two pools:
- `enrichPool` (cap 500): per-event enrichment (Redis + geoip).
- `writePool` (cap 50): batched write to ClickHouse.

### Why split

Different latency profiles:
- Enrich: 5-20 ms per event (Redis call + geoip lookup).
- Write: 50-200 ms per batch (1000 events per batch).

Different concurrency limits:
- Redis allows 5000 concurrent connections; enrich pool of 500 is safely below.
- ClickHouse allows 200 concurrent inserts; write pool of 50 stays well below.

### Implementation sketch

```go
package pipeline

import (
	"context"
	"sync"
	"time"

	"github.com/panjf2000/ants/v2"
)

type Event struct {
	Raw       []byte
	Enriched  EnrichedEvent
}

type EnrichedEvent struct { /* ... */ }

type Pipeline struct {
	enrichPool *ants.Pool
	writePool  *ants.Pool

	batchMu      sync.Mutex
	pendingBatch []EnrichedEvent

	flushInterval time.Duration
	maxBatchSize  int

	out chan EnrichedEvent
}

func New() *Pipeline {
	enrich, _ := ants.NewPool(500,
		ants.WithPanicHandler(panicHandler),
	)
	write, _ := ants.NewPool(50,
		ants.WithPanicHandler(panicHandler),
	)
	p := &Pipeline{
		enrichPool: enrich,
		writePool: write,
		flushInterval: 1 * time.Second,
		maxBatchSize: 1000,
		out: make(chan EnrichedEvent, 10000),
	}
	go p.batcher()
	return p
}

func (p *Pipeline) Submit(raw []byte) error {
	return p.enrichPool.Submit(func() {
		ev := EnrichedEvent{ /* enrich raw */ }
		p.out <- ev
	})
}

func (p *Pipeline) batcher() {
	t := time.NewTicker(p.flushInterval)
	defer t.Stop()
	for {
		select {
		case ev := <-p.out:
			p.batchMu.Lock()
			p.pendingBatch = append(p.pendingBatch, ev)
			if len(p.pendingBatch) >= p.maxBatchSize {
				batch := p.pendingBatch
				p.pendingBatch = nil
				p.batchMu.Unlock()
				p.submitBatch(batch)
			} else {
				p.batchMu.Unlock()
			}
		case <-t.C:
			p.batchMu.Lock()
			if len(p.pendingBatch) > 0 {
				batch := p.pendingBatch
				p.pendingBatch = nil
				p.batchMu.Unlock()
				p.submitBatch(batch)
			} else {
				p.batchMu.Unlock()
			}
		}
	}
}

func (p *Pipeline) submitBatch(batch []EnrichedEvent) {
	_ = p.writePool.Submit(func() {
		writeToClickHouse(batch)
	})
}

func panicHandler(p interface{}) { /* ... */ }

func writeToClickHouse(batch []EnrichedEvent) { _ = batch }
```

### Properties

- 100k events/sec arrive.
- Enrich pool 500 with 10 ms avg → 50k events/sec capacity per pool. Hmm, that's under.
- Solution: scale horizontally (5 pods × 50k/sec each).
- OR: increase enrich pool to 1000. But Redis... it can handle 5000 connections, so we have room.

Decision: 5 pods, each with `enrichPool=500`, `writePool=50`. Total 5x500 = 2500 Redis connections; 5x50 = 250 ClickHouse connections. Both within limits.

### Per-pod throughput

- enrich: 500 / 0.01 = 50k events/sec.
- write: 50 / 0.1 = 500 batches/sec × 1000 events/batch = 500k events/sec. Massive overcapacity, but writes are cheaper per-event so this is fine.

### Bottleneck check

Per pod, bottleneck is enrich pool. 50k events/sec at 5 pods = 250k events/sec — covers 100k easily.

### Backpressure

`out` channel has buffer 10000. If batcher falls behind, channel fills. Enrich pool's submitters block on send. Enrich pool fills. New `Submit` blocks. Kafka consumer pauses (reads slower). Lag grows.

We monitor Kafka lag. If sustained, scale up.

### Lessons learned

- Splitting pools by stage is clean and lets each have appropriate sizing.
- Batching is the killer optimisation for write-amplifying tasks.
- The buffered channel between stages absorbs jitter.
- Sized for steady-state; rely on scaling for peaks.

---

## Extended Section: Pool Health Indicators

A list of indicators to watch.

### Indicator 1 — Utilisation

`Running / Cap`. Plot as percentage.

Healthy: 30-70%.
Concerning: > 80%.
Critical: > 90% sustained.

### Indicator 2 — Saturation rate

Time spent at `Running == Cap` per minute.

Healthy: < 10 sec/min.
Concerning: > 30 sec/min.

### Indicator 3 — Submit success rate

`ok / (ok + overload + closed)`.

Healthy: > 99.9%.
Concerning: < 99%.

### Indicator 4 — Submit latency

Time from `Submit` call to return.

Healthy: < 1 ms (mostly fast path).
Concerning: > 10 ms (blocking).

### Indicator 5 — Task duration

p50 and p99.

Should be stable. Spike means downstream issue.

### Indicator 6 — Panic rate

Panics per minute.

Healthy: 0.
Any non-zero is investigable.

### Indicator 7 — Goroutine count

`runtime.NumGoroutine()`.

Should be: pool workers + blocked submitters + your other goroutines.

Growing trend without explanation: leak.

### Indicator 8 — Memory

Heap size, growth rate.

Healthy: stable.
Concerning: monotonic growth.

### Indicator 9 — CPU

Process CPU usage.

Should be: tasks' CPU + pool overhead (small).

Spike without throughput change: contention or GC.

### Indicator 10 — Network

Outbound connections. File descriptors.

Should be: ~cap connections at peak.

Approaching FD limit: scale or reduce cap.

---

## Extended Section: Common Saturation Recoveries

When the pool saturates, your service degrades. Recovery strategies.

### Recovery 1 — Wait it out

If the saturation is transient (1-2 min), let it pass. Submit latency grows briefly. Then traffic eases.

Acceptable for non-critical workloads.

### Recovery 2 — Scale up pods

Add more pods. Each new pod has its own pool. Total cap scales.

Limitations: pod startup time (30-60 s); downstream may not scale with you.

### Recovery 3 — Tune up cap

`Tune(2 * cap)`. Immediate effect.

Limitations: must not exceed downstream cap; memory cost.

### Recovery 4 — Shed load

If non-blocking and overflow handler exists, let load shed.

Limitations: customer SLA may be violated; queue grows.

### Recovery 5 — Bypass pool for hot path

Detect saturation; route critical traffic to a faster path (e.g., a small dedicated pool).

Limitations: complexity.

### Recovery 6 — Drop low-priority

If pool is multi-priority, drop low-priority tasks first.

Limitations: requires priority classification at submit time.

### Recovery 7 — Cancel in-flight

Aggressively cancel tasks that are over their deadline. Frees workers.

Limitations: needs context propagation; some tasks not cancellable.

### Recovery 8 — Restart pool

`Release` + `NewPool`. Tasks lost. Workers reset.

Limitations: drastic; some tasks lost.

---

## Extended Section: Real-World Pool Configurations

A catalogue of imaginary-but-realistic configurations.

### Config A — High-throughput ingestion

```go
pool, _ := ants.NewPool(2000,
	ants.WithExpiryDuration(120 * time.Second),
	ants.WithPanicHandler(reportPanic),
)
```

Long expiry to keep workers warm. No non-blocking — accept backpressure on producer.

### Config B — Latency-sensitive HTTP handler

```go
pool, _ := ants.NewPool(100,
	ants.WithExpiryDuration(30 * time.Second),
	ants.WithNonblocking(true),
	ants.WithPanicHandler(reportPanic),
)
```

Smaller cap. Non-blocking — return 503 if saturated.

### Config C — Batch job

```go
pool, _ := ants.NewPool(50,
	ants.WithExpiryDuration(1 * time.Second),
	ants.WithPanicHandler(reportPanic),
)
defer pool.Release()
```

Default expiry. Blocking — no rush, but submitters block.

### Config D — Notification fanout

```go
pool, _ := ants.NewPoolWithFunc(500, func(arg interface{}) {
	send(arg.(*Notification))
},
	ants.WithExpiryDuration(60 * time.Second),
	ants.WithNonblocking(true),
	ants.WithPanicHandler(reportPanic),
)
```

`PoolWithFunc` for hot loop. Non-blocking with queue overflow.

### Config E — CPU-bound transform

```go
pool, _ := ants.NewPool(runtime.GOMAXPROCS(0),
	ants.WithExpiryDuration(5 * time.Second),
	ants.WithDisablePurge(false),
	ants.WithPanicHandler(reportPanic),
)
```

Sized to CPU. No need for many.

### Config F — Multi-tenant

```go
type TenantPools struct {
	free       *ants.Pool
	paid       *ants.Pool
	enterprise *ants.Pool
}

func NewTenantPools() *TenantPools {
	free, _ := ants.NewPool(200, ants.WithNonblocking(true), ants.WithPanicHandler(reportPanic))
	paid, _ := ants.NewPool(500, ants.WithMaxBlockingTasks(1000), ants.WithPanicHandler(reportPanic))
	ent, _ := ants.NewPool(300, ants.WithPanicHandler(reportPanic))
	return &TenantPools{free, paid, ent}
}
```

Three caps, different policies.

### Config G — Sharded

```go
mp, _ := ants.NewMultiPool(4, 250, ants.RoundRobin,
	ants.WithExpiryDuration(60 * time.Second),
	ants.WithPanicHandler(reportPanic),
)
```

`MultiPool` for lock-contention relief.

### Config H — Specialty

```go
pool, _ := ants.NewPool(10,
	ants.WithDisablePurge(true),
	ants.WithPanicHandler(reportPanic),
)
```

Tiny pool, workers stay forever. For specialised stateful workloads (DB connection pool of 10).

Each configuration encodes a different trade-off. Pick the one that fits your workload.

---

## Extended Section: Pool Operational Wisdom

Random tips accumulated from running pools in production.

- **Sized by the bottleneck, not the apparent need.** A pool of 1000 doesn't help if your DB is the bottleneck at 50 connections.
- **Configure once, tune when measured.** Don't change configs without a reason.
- **Document every config decision.** "Cap = 250 because..." in a comment.
- **Monitor, don't trust.** Metrics tell the truth; intuition is wrong.
- **Don't share pools across responsibilities.** Bulkheads matter.
- **Test under failure.** Inject panics, downtime, slowness in CI.
- **Plan for shutdown.** Half your bugs are during shutdown.
- **Watch for leaks.** Pools leak goroutines if not released; tasks leak if they hang.
- **Profile when in doubt.** `pprof` over HTTP is your friend.
- **Read your library version's changelog.** Bug fixes matter.

---

## Extended Section: Pool Failure Modes

A taxonomy of how pools fail.

### Failure 1 — Saturation

`Running == Cap`. Submitters block or fail.

Causes: too small cap, downstream slowness, traffic spike.

Symptoms: latency, errors, dropped tasks.

Fixes: tune up, scale out, shed load, fix downstream.

### Failure 2 — Leak

Pools leak goroutines when not released, or tasks leak when they hang.

Causes: missing `defer Release`, tasks blocking on dead channels, infinite loops in tasks.

Symptoms: growing goroutine count, growing memory.

Fixes: always defer release, add timeouts to tasks, audit channel uses.

### Failure 3 — Misconfiguration

Cap = 0 or absurdly large. Expiry = 0. Missing panic handler.

Causes: human error.

Symptoms: panics, no progress, surprise behaviour.

Fixes: validate config at startup, document defaults.

### Failure 4 — Deadlock

Tasks waiting on each other within the same pool.

Causes: cross-task locks, cyclic submits, nested pool calls.

Symptoms: zero progress, full pool, no errors.

Fixes: never lock across submit boundaries, audit dependencies.

### Failure 5 — Cascading

One pool's failure spreads to others.

Causes: shared resources (DB, cache), no bulkheads.

Symptoms: multiple pools degrade simultaneously.

Fixes: isolate via bulkheads, separate pools per dependency.

### Failure 6 — Shutdown failure

Pool doesn't drain in time.

Causes: tasks ignoring context, too-tight grace period.

Symptoms: 503s during deploy, customer-visible failures.

Fixes: plumb context, increase grace period, do the drain.

### Failure 7 — Memory bloat

Pool memory grows unboundedly.

Causes: workers' stacks grown by big tasks, retained closure references, never-expiring workers.

Symptoms: OOM-killed pods.

Fixes: shorter expiry, smaller workers, audit closures.

### Failure 8 — CPU starvation

Pool tasks starve other goroutines.

Causes: tasks are tight CPU loops, no yields.

Symptoms: other parts of program (HTTP handlers, monitoring) lag.

Fixes: split workloads into separate pools, add `runtime.Gosched` if needed.

### Failure 9 — Panic flood

Every task panics, but pool recovers each one. Service technically still works.

Causes: bad input, environmental issue.

Symptoms: panic counter exploding, downstream effects but no crashes.

Fixes: fix the root cause; the pool's resilience masked the symptom.

### Failure 10 — Wrong tool

Pool used where a mutex or semaphore would suffice.

Causes: over-engineering.

Symptoms: code complexity, no measurable benefit.

Fixes: simplify; remove pool if not needed.

---

## Extended Section: Pool in Code Review

What to look for in a code review of pool-using code.

### Review 1 — Is the pool defined where?

Package-level globals are dangerous. Service struct fields are good.

### Review 2 — Is release deferred?

If not, why? Special case (long-lived service)? Document it.

### Review 3 — Are options set?

`NewPool(N)` alone is suspect in production code. At minimum, `WithPanicHandler`.

### Review 4 — Are tasks small and focused?

A task that's 200 lines is too big. Refactor.

### Review 5 — Do tasks accept context?

If not, why? Cancellation matters.

### Review 6 — Are errors handled?

`_ = pool.Submit(t)` is acceptable in well-understood cases. In a service, log or propagate.

### Review 7 — Is the size justified?

A comment explaining the cap rationale should exist somewhere.

### Review 8 — Is there a test?

At least a smoke test that the pool wiring works.

### Review 9 — Is there observability?

Metrics, logging, tracing. If not, ask why.

### Review 10 — Are there bulkheads?

Multi-tenant service with one pool? Question it.

---

## Extended Section: Pool & Open-Source Projects

Open-source projects in Go that use `ants`:

- **gnet** (panjf2000/gnet) — high-perf networking framework. Uses `ants` internally for event handlers.
- **vmihailenco/taskq** — task queue library with `ants` as backend.
- Various microservices in the Chinese tech ecosystem (Tencent, Alibaba, Bytedance).

Reading their code shows real-world `ants` usage.

---

## Extended Section: When to Replace `ants`

Sometimes you outgrow `ants`. Signs:

- You need per-task SLA tracking and `ants` doesn't expose enough hooks.
- You need cross-language coordination and Go-only library doesn't fit.
- You need durable queues and `ants` is in-memory only.
- Your workload doesn't fit pool semantics (e.g., long streams, not discrete tasks).

Replacements:

- For durable: a real message queue (Kafka, RabbitMQ).
- For long streams: a streaming framework (Beam, Flink).
- For very high concurrency: custom thread-per-core architecture.

`ants` is excellent for what it does — in-process bounded concurrency for short tasks. Beyond that, look elsewhere.

---

## Extended Section: Personal Recommendations

After years of using `ants`:

1. **Use it.** Don't reinvent the wheel.
2. **Wrap it.** Always wrap it in a service-specific abstraction.
3. **Measure.** Pool sizes are not guesses.
4. **Bulkhead.** Multi-tenant services need isolation.
5. **Drain.** Graceful shutdown is the hardest part.
6. **Document.** Every config has a reason; write it down.
7. **Test.** Realistic load tests prevent disasters.
8. **Update.** Track new versions; benchmark before adopting.
9. **Don't over-tune.** Most defaults are right.
10. **Keep learning.** The pool is a small piece; the system is vast.

---

## Extended Section: Pool & SRE Practices

Site reliability engineering perspective on pools.

### SLI (Service Level Indicator)

Pool metrics are SLIs. Saturation, error rate, latency.

### SLO (Service Level Objective)

Targets for SLIs. E.g., "99.9% of submits succeed within 10 ms."

### Error budget

If SLO is 99.9%, error budget is 0.1%. Spend it on shutdowns, peak overflows, bug deploys.

### Incident response

Pool incidents:
- **Saturation** → on-call investigates; runbook applies.
- **Panic flood** → page; bug investigation.
- **Leak** → after-hours investigation; not user-facing immediately.

### Post-mortems

When a pool incident happens, write a post-mortem:
- Timeline.
- Root cause.
- Resolution.
- Prevention.

---

## Final Closing

Pool engineering is a mature discipline. `ants` is a mature library. Together with the practices in this file, you have everything to ship production Go services that scale.

Beyond this, the journey is yours: a thousand decisions, each small, each consequential. Make them with care, document them well, and pass the knowledge forward.

---

## Bonus Appendix — Pool Operations Walkthrough

Putting the year-in-the-life into a series of practical walkthroughs.

### Walkthrough 1 — Initial deployment

You're shipping a new service. Pool size?

1. Read the spec. What's the expected throughput?
2. Run a single-task benchmark. What's the per-task duration?
3. Apply Little's Law: `Cap = Throughput * Duration`.
4. Add 1.5x headroom.
5. Cap at downstream limit if smaller.
6. Set options: panic handler, expiry, blocking mode.
7. Deploy to staging.
8. Load test.
9. Measure: `Running`, `Free`, `Waiting`, p99.
10. Adjust if needed.
11. Deploy to production.
12. Watch metrics for a week.

### Walkthrough 2 — Saturation incident

Pager fires: "Pool saturated."

1. Check Grafana: `pool_running == pool_cap` for 10 min.
2. Check `Waiting`: 200 blocked submitters.
3. Check downstream latency: jumped from 50 ms to 500 ms.
4. Downstream team confirms slowness.
5. They identify a DB query plan regression.
6. They roll back. Latency recovers.
7. Your pool drains. Alert clears.
8. Post-mortem: should you have alerted earlier? Should the pool have larger cap?
9. Adjust thresholds.

### Walkthrough 3 — Panic flood

Pager: "PoolPanic high."

1. Check Sentry: same panic value, hundreds of times.
2. Stack: `strconv.Atoi: invalid syntax`.
3. Trace one occurrence: incoming event has unexpected format.
4. Identify bad source: a new partner sending unvalidated data.
5. Add validation in the task before the parse.
6. Hotfix deploy.
7. Panic rate drops to 0.

### Walkthrough 4 — Slow deploy

Deploy takes 5 minutes. SREs notice.

1. Check pod terminationGracePeriod: 60 sec, fine.
2. Check pool drain time: 2 min — exceeds grace.
3. Tasks aren't honouring `ctx.Done()`.
4. Audit: 80% of tasks are fine; 20% have a synchronous downstream call without context.
5. Fix: pass context through.
6. Drain time drops to 15 sec.
7. Deploys back to normal speed.

### Walkthrough 5 — Memory creep

Monitoring shows memory growing 10 MB/hour.

1. Take heap profile every hour for a day.
2. Diff profiles. Look for what's growing.
3. Find: a `map[string]*Result` in a task closure that's never cleaned.
4. Refactor: use a `sync.Map` with TTL.
5. Memory stable.

### Walkthrough 6 — Customer complaint

A specific customer reports 5-sec latency.

1. Find their requests in trace.
2. Trace shows: 4 sec in `Submit`.
3. Confirms pool saturation specific to their tier.
4. They're on the free tier; free pool is overloaded.
5. Two options: upgrade them, or scale free pool.
6. Choose to scale free pool from 200 to 500.
7. Their latency returns to normal.

### Walkthrough 7 — Cost review

CFO asks: "Why is this service expensive?"

1. Container has 4 GB memory; using 3.5 GB.
2. Pool workers + stacks ~500 MB.
3. Task allocations ~1.5 GB.
4. Caches ~1.5 GB.
5. Most cost is caches. Identify: caching too aggressively. Reduce TTL.
6. Memory drops to 2 GB.
7. Down-size container to 3 GB.
8. Pool unaffected.

### Walkthrough 8 — Library upgrade

Dependabot opens PR: ants v2.7 → v2.9.

1. Read changelog. Note bug fixes.
2. Run unit + integration tests. Pass.
3. Run benchmarks. 5% improvement.
4. Deploy to staging.
5. Watch metrics for 24 hours. No regressions.
6. Deploy to production.
7. Monitor. Stable.

### Walkthrough 9 — Architecture change

Product wants to add WebSocket support to the existing HTTP service.

1. WebSocket has different concurrency: many long-lived connections vs many short requests.
2. Existing pool is for HTTP-like tasks; bad fit for WebSocket.
3. Add a new pool: `wsPool` with `WithDisablePurge(true)` (connections last forever).
4. Wire up. Test. Deploy.
5. Original pool unaffected.

### Walkthrough 10 — Decommissioning

Service is being retired.

1. Notify customers.
2. Gradually reduce traffic via API gateway.
3. Pool sees less work; `Running` trends to 0.
4. Final shutdown: SIGTERM, drain (no work), exit.
5. Pod removed.

Each walkthrough is a slice of real operational work. The pool is involved in all of them.

---

## Bonus Appendix — Pool Education for Your Team

If you're tasked with bringing your team up to speed on `ants`:

### Week 1 — Junior

Read `junior.md`. Build the URL prefetcher from scratch. Discuss in code review.

### Week 2 — Middle

Read `middle.md`. Add functional options to the prefetcher. Build the notification service walkthrough. Discuss.

### Week 3 — Senior

Read `senior.md`. Read the `ants` source. Build a small custom pool. Compare with `ants`. Discuss.

### Week 4 — Professional

Read `professional.md`. Refactor a production service to use `ants`. Add metrics, alerts, runbook. Discuss.

After 4 weeks, the team can ship and operate `ants`-backed services.

---

## Bonus Appendix — Hiring for Pool-Aware Engineering

What to ask in interviews.

### Junior-level

- What is a goroutine pool?
- When would you use one?
- Show me how you'd cap concurrency.

### Mid-level

- How does `Submit` differ from `go f()`?
- Why might you choose non-blocking mode?
- How do you handle panics in pool tasks?

### Senior-level

- Walk through `Submit` internally.
- What is the worker LIFO stack and why LIFO?
- When would you use `MultiPool`?

### Staff-level

- Design a pool-backed service for X workload.
- How would you size, monitor, drain it?
- What would you do differently a year from now?

Each level of question reveals depth (or lack thereof).

---

## Bonus Appendix — The Future of `ants`

Speculation on where the library might evolve.

- More generics support. The argument-typed `PoolWithFunc` should be fully type-safe with generics.
- Better observability hooks. Built-in metrics interface.
- Context-aware `Submit`. Long-standing feature request.
- Pluggable worker queues without forking.
- Better integration with Go's runtime hints (`P`, NUMA).

These may or may not happen. The library's maintainers prioritise stability and performance over feature creep.

---

## Bonus Appendix — Pool Misuse War Stories

A few real (anonymised) stories from the trenches.

### Story 1 — The accidental DoS

A startup deployed a new feature: send a push notification on every event. Pool of 100. Each push took 200 ms. Steady rate: 1000 events/sec.

`Cap_required = 1000 * 0.2 = 200`. They had 100.

Pool saturated. Submit blocked. Producer was the HTTP handler. HTTP requests timed out. Customers experienced 503s. The feature ran for a week before someone noticed.

Lesson: size by calculation, not guess.

### Story 2 — The forgetful release

A backend service created a pool per request (anti-pattern). Forgot `defer Release`. Each request leaked a pool of 100 workers.

After a few thousand requests, 100k goroutines existed. Memory ballooned. Pod OOM-killed.

Lesson: pools are long-lived; create once, share.

### Story 3 — The captured loop variable

A worker that processed user IDs:

```go
for _, user := range users {
	_ = pool.Submit(func() { process(user) }) // Go 1.20
}
```

All workers processed the *last* user. Multiple times. Original users were never processed.

In Go 1.22+, this is fixed at the language level. But the developer was on 1.20.

Lesson: always shadow loop variables.

### Story 4 — The unrecovered panic handler

```go
ants.WithPanicHandler(func(p interface{}) {
	resp, _ := http.Get(reportURL) // panics on nil resp
	resp.Body.Close()
})
```

The handler panicked. The outer recover didn't catch it (in older versions). The worker died. Eventually all workers died. Pool went idle.

Lesson: handler must not panic.

### Story 5 — The synchronous async

A team thought "let's add ants for performance." They wrapped every HTTP handler in `pool.Submit` and then *waited* for it:

```go
done := make(chan struct{})
_ = pool.Submit(func() { handle(req); close(done) })
<-done
```

This added overhead without any benefit. Pure waste. Slowed everything down 5%.

Lesson: pool helps if you submit and forget; synchronous wait kills the value.

---

## Bonus Appendix — Engineering Reflection

Pools are a small but important abstraction. They embody a few key engineering ideas:

- **Resource bounding.** Every system needs limits. Pools enforce them.
- **Recycling.** Recycling expensive objects (goroutines, here) is a perennial optimisation.
- **Backpressure.** When demand exceeds supply, the system must slow producers or shed load. Pools do this naturally.
- **Observability.** What you can't measure, you can't operate.
- **Idempotency.** Pool tasks may fail or be retried. Make them safe.
- **Composition.** Pools combine with other primitives (errgroup, context, semaphore) to build robust systems.

These are not pool-specific lessons. They are systems-engineering lessons. Pools are a useful concrete example.

---

## Bonus Appendix — Pool Design Pitfalls

Designing your own pool? Watch for:

- **Single shared channel for all workers.** Becomes a bottleneck.
- **Unbounded pending queue.** Memory grows.
- **No expiry.** Memory grows.
- **No graceful drain.** Tasks lost on shutdown.
- **No panic recovery.** One panic kills a worker; eventually pool dies.
- **No metrics interface.** Black box.
- **No tunability.** Can't adjust at runtime.

`ants` avoids all of these. So would any production-grade pool. If you find yourself reinventing it, just use `ants`.

---

## Bonus Appendix — When ants is Not the Right Choice

Don't use `ants` when:

- You have a handful (<100) of long-running tasks. Plain `go` is fine.
- You need cross-process coordination. Need a real queue.
- You need durable tasks. Need a queue with persistence.
- You need workflow orchestration. Use Temporal or Cadence.
- You need stream processing. Use Flink or Beam.

`ants` is for in-process, bounded, ephemeral concurrency. Outside that, the wrong tool.

---

## Bonus Appendix — Pool Pre-Mortem

Before shipping, ask: "What could go wrong?"

- Cap too small → saturation.
- Cap too large → memory waste.
- Forgot release → leak.
- Missing panic handler → bug visibility low.
- Tasks ignore context → bad shutdowns.
- No metrics → can't operate.
- No alerts → won't know when it fails.
- Single pool → cascading failures.

Write each down. Address each. Then ship.

---

## Truly Final Closing

I've covered:

- Capacity planning.
- Multi-tenancy.
- Observability.
- Error and panic reporting.
- Integration with errgroup and context.
- Graceful shutdown.
- Load shedding and backpressure.
- Rate limiting.
- Tracing.
- Resilience patterns.
- Real-world case studies.
- Production checklist.
- Testing strategies.
- SLOs.
- Costs.
- Migration stories.
- Common mistakes at scale.
- Anti-patterns.
- Operational scenarios and runbooks.
- Code review guidance.
- A whole year in the life of an operator.

If this file is your reference when you ship `ants` in production, the goal is met. Move on to the reference files for API surface and exercises.

---

## Appendix — Pool Patterns I've Seen in the Wild

A grab-bag of useful patterns from real codebases.

### Pattern — Fluent submission

```go
type Submission struct {
	pool *ants.Pool
	tags map[string]string
	ctx  context.Context
}

func (s *Submission) Tag(k, v string) *Submission { s.tags[k] = v; return s }
func (s *Submission) WithContext(ctx context.Context) *Submission { s.ctx = ctx; return s }
func (s *Submission) Run(f func(context.Context)) error {
	return s.pool.Submit(func() { f(s.ctx) })
}

// Usage:
err := pool.New().Tag("user", uid).WithContext(ctx).Run(handler)
```

Adds context and tagging in a fluent API. Tags pipe into metrics.

### Pattern — Submit interceptors

```go
type Interceptor func(next func()) func()

func WithLogging(name string) Interceptor {
	return func(next func()) func() {
		return func() {
			log.Printf("task %s start", name)
			next()
			log.Printf("task %s end", name)
		}
	}
}

func WithTimeout(d time.Duration) Interceptor { /* ... */ }

func Chain(task func(), is ...Interceptor) func() {
	for _, i := range is {
		task = i(task)
	}
	return task
}

pool.Submit(Chain(realTask, WithLogging("foo"), WithTimeout(5*time.Second)))
```

Composable middleware around tasks. Useful for cross-cutting concerns.

### Pattern — Pool of pools (manual)

```go
type Multiplex struct {
	pools []*ants.Pool
	pick  func() *ants.Pool
}

func (m *Multiplex) Submit(t func()) error {
	return m.pick().Submit(t)
}
```

If `ants.MultiPool` doesn't fit your routing strategy.

### Pattern — Lazy pool

```go
type LazyPool struct {
	once sync.Once
	pool *ants.Pool
}

func (l *LazyPool) Submit(t func()) error {
	l.once.Do(func() { l.pool, _ = ants.NewPool(100) })
	return l.pool.Submit(t)
}
```

Pool not created until first use. Useful for occasionally-used services.

### Pattern — Pool with health check

```go
type Pool struct {
	p *ants.Pool
}

func (p *Pool) Healthy() bool {
	return !p.p.IsClosed() && p.p.Free() > p.p.Cap()/10
}
```

Reports unhealthy if pool has < 10% slack.

### Pattern — Background drain

```go
func (s *Service) Background() {
	go func() {
		for {
			time.Sleep(1 * time.Minute)
			if s.pool.Running() == 0 && s.pool.Cap() > 10 {
				s.pool.Tune(10) // shrink
			}
		}
	}()
}
```

Shrink pool when idle. Saves memory.

### Pattern — Submit and forget

```go
func (s *Service) FireAndForget(t func()) {
	if err := s.pool.Submit(t); err != nil {
		log.Printf("submit failed (fire-and-forget): %v", err)
	}
}
```

Convenience wrapper for "I don't care if it runs."

### Pattern — Strict admission

```go
func (s *Service) StrictSubmit(t func()) error {
	if s.pool.Free() <= 0 {
		return errors.New("at capacity")
	}
	return s.pool.Submit(t)
}
```

Reject before even trying. Faster fail than `WithNonblocking`.

### Pattern — Periodic stats logging

```go
func (s *Service) logStats() {
	t := time.NewTicker(30 * time.Second)
	for range t.C {
		log.Printf("pool stats: cap=%d running=%d free=%d waiting=%d",
			s.pool.Cap(), s.pool.Running(), s.pool.Free(), s.pool.Waiting())
	}
}
```

Even without Prometheus, periodic logs help.

### Pattern — Pool-aware load shedder

```go
func (s *Service) Submit(t func()) error {
	saturation := float64(s.pool.Running()) / float64(s.pool.Cap())
	if saturation > 0.9 && !isPriority(t) {
		return ErrShedding
	}
	return s.pool.Submit(t)
}
```

Shed non-priority load above 90% saturation.

---

## Appendix — One-Line Wisdom

A collection of one-line truths about `ants`:

- The pool caps; the producer queues; the workers serve.
- Recycled workers are warmer than spawned workers.
- A panic in a task is caught; a panic in the handler may not be.
- `Release` does not wait; `ReleaseTimeout` does.
- `Submit` blocks unless told otherwise.
- The fast path is a slice pop and a channel send.
- The slow path is a cond wait.
- The pool is one piece; the system is many.
- Measure twice, tune once.
- Document the cap rationale or lose it.
- Many small pools cost more than one large pool plus routing.
- Tasks are functions; functions can do anything; pools can do nothing about that.
- An unbounded `Submit` queue is just a goroutine leak.
- `Tune` is atomic but its effect is not.
- One pool per workload, not one pool per app.

Stick these on a sticky note.

---

## Appendix — Visual Architecture

Imagine your production service:

```
+---------------+
| Load balancer |
+-------+-------+
        |
        v
+---------------+
|  HTTP server  |  (incoming requests)
+-------+-------+
        |
        v
+---------------+
| Handler logic |  (validate, parse)
+-------+-------+
        |
        v
+---------------+
| ants.Pool     |  (cap N, bounded concurrency)
+-------+-------+
        |
        v
+---------------+
| Worker        |  (executes task)
+-------+-------+
        |
        v
+---------------+    +---------------+
|   Database    |    |  External API |
+---------------+    +---------------+
```

The pool sits between the handler and the downstream. It bounds concurrency to protect downstream and to keep the service responsive.

---

## Appendix — Pool Monitoring Templates

Drop-in templates for common monitoring setups.

### Grafana panel — Utilisation

```promql
ants_pool_running{service="myservice"} / ants_pool_cap{service="myservice"}
```

Display: percentage, 0-100%.

### Grafana panel — Submit rate

```promql
sum by (result) (rate(ants_pool_submit_total{service="myservice"}[1m]))
```

Display: stacked area chart.

### Grafana panel — p99 task duration

```promql
histogram_quantile(0.99, sum by (le) (rate(ants_pool_task_duration_seconds_bucket{service="myservice"}[5m])))
```

Display: line, 0-N seconds.

### Alert — Saturation

```yaml
- alert: PoolSaturated
  expr: ants_pool_running{service="myservice"} / ants_pool_cap{service="myservice"} > 0.9
  for: 5m
  labels:
    severity: warning
  annotations:
    summary: "Pool saturated for 5 min"
    runbook: "https://wiki.example.com/pool-saturated"
```

### Alert — Panic

```yaml
- alert: PoolPanic
  expr: increase(ants_pool_panic_total{service="myservice"}[5m]) > 0
  labels:
    severity: critical
  annotations:
    summary: "Pool panic detected"
```

### Alert — Overload

```yaml
- alert: PoolOverload
  expr: rate(ants_pool_submit_total{service="myservice",result="overload"}[5m]) > 0
  for: 10m
  labels:
    severity: warning
```

Standardise these across your fleet.

---

## Appendix — More Code Examples

### Example — Pool inside an HTTP middleware

```go
func PoolMiddleware(pool *ants.Pool) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			err := pool.Submit(func() {
				next.ServeHTTP(w, r)
			})
			if err != nil {
				http.Error(w, "service unavailable", http.StatusServiceUnavailable)
			}
		})
	}
}
```

But: this doesn't wait for `next.ServeHTTP` to complete. The HTTP framework may close the response writer before the task runs. Bad pattern; use only for genuinely async middlewares (logging, metrics).

### Example — Pool with metrics decorator

```go
type MetricPool struct {
	*ants.Pool
	name string
}

func (m *MetricPool) Submit(t func()) error {
	start := time.Now()
	err := m.Pool.Submit(t)
	metrics.SubmitLatency.WithLabelValues(m.name).Observe(time.Since(start).Seconds())
	return err
}
```

Wraps `Submit` with timing. Trivial to add.

### Example — Pool with rate limit

```go
type LimitedPool struct {
	pool    *ants.Pool
	limiter *rate.Limiter
}

func (l *LimitedPool) Submit(ctx context.Context, t func()) error {
	if err := l.limiter.Wait(ctx); err != nil { return err }
	return l.pool.Submit(t)
}
```

Wait for token, then submit. Combines rate + concurrency.

### Example — Pool with circuit breaker

```go
type ResilientPool struct {
	pool    *ants.Pool
	breaker *gobreaker.CircuitBreaker
}

func (r *ResilientPool) Submit(t func() error) error {
	_, err := r.breaker.Execute(func() (interface{}, error) {
		done := make(chan error, 1)
		if err := r.pool.Submit(func() { done <- t() }); err != nil {
			return nil, err
		}
		return nil, <-done
	})
	return err
}
```

Circuit breaker around the submit-and-wait. Failures open the circuit.

---

## Appendix — Pool & DevOps

DevOps perspective on shipping pools.

### CI

- Lint for missing `defer Release`.
- Test for goroutine leaks.
- Benchmark pool overhead.
- Run `go test -race`.

### CD

- Canary deploys; watch pool metrics.
- Smoke tests post-deploy.
- Roll back if metrics regress.

### Infrastructure as code

```hcl
resource "kubernetes_deployment" "myservice" {
  spec {
    template {
      spec {
        termination_grace_period_seconds = 60
        container {
          name = "myservice"
          env {
            name  = "POOL_CAP"
            value = "500"
          }
          lifecycle {
            pre_stop {
              exec {
                command = ["sh", "-c", "sleep 10"]
              }
            }
          }
        }
      }
    }
  }
}
```

Pool capacity from environment. preStop hook gives time to drain.

### Secrets management

If your pool's tasks need secrets (API keys), pull them at startup, not per task. Reduces secret-management load.

### Multi-region deploys

Each region has its own pool. Per-region sizing. Watch for region-specific saturation.

---

## Appendix — Pool Engineering Maturity Levels

Where are you on the maturity scale?

### Level 0 — Unaware

Uses `go f()` for everything. No bounds. Eventually crashes.

### Level 1 — Aware

Knows pools exist. Uses `ants.NewPool(N)` with default options.

### Level 2 — Configurable

Sets `WithPanicHandler`, `WithExpiryDuration`. Uses non-blocking when appropriate.

### Level 3 — Observable

Exports metrics. Sets alerts. Reads dashboards.

### Level 4 — Architectural

Designs bulkheads. Uses `MultiPool` when justified. Sizes by measurement.

### Level 5 — Operational

Runs runbooks. Conducts post-mortems. Tunes for cost and latency.

### Level 6 — Leadership

Teaches the team. Establishes standards. Reviews code thoughtfully.

Each level builds on the previous. Most engineers reach Level 3-4. Level 5-6 is senior/staff territory.

---

## Appendix — Last Word

In production, `ants` is a small library doing a big job. Knowing the API is just the start; integrating it well into a service is the work.

This entire file is one long argument: pools are not magic. They are tools. With the right tools, used thoughtfully, you build services that don't fall over. With the wrong tools, used carelessly, you build services that do.

Use `ants` thoughtfully.

End.

---

## Appendix — Cross-Reference to Other Files

Each topic in this file may have a deeper treatment elsewhere:

- Sizing: see `tasks.md` for hands-on sizing exercises.
- Internals: see `senior.md`.
- API specifics: see `specification.md`.
- Bug-finding: see `find-bug.md`.
- Optimisation: see `optimize.md`.
- Interview questions: see `interview.md`.

Each cross-reference is a chance to deepen one aspect.

---

## Appendix — Glossary Recap

The complete glossary, consolidated:

- **Pool:** a bounded set of long-lived worker goroutines.
- **Cap:** max workers.
- **Running:** current workers.
- **Free:** Cap - Running.
- **Waiting:** blocked submitters.
- **Submit:** hand a task to the pool.
- **Invoke:** for `PoolWithFunc`, hand an argument.
- **Release:** shutdown, ignoring in-flight.
- **ReleaseTimeout:** shutdown with drain deadline.
- **Tune:** change cap.
- **Worker:** a single long-lived goroutine.
- **Janitor / Purger:** background goroutine that removes idle workers.
- **PoolWithFunc:** specialised single-function pool.
- **MultiPool:** sharded pool for lock-contention relief.
- **MGRR:** Multi-Goroutine pool Round Robin (strategy interface).
- **Option:** functional configuration value.
- **PanicHandler:** function called on task panic.
- **Bulkhead:** isolation pattern using separate pools.
- **Backpressure:** producer-side slowdown signal.
- **Saturation:** Running == Cap state.
- **Overflow:** rejected submit.
- **Drain:** wait for in-flight to complete.
- **SLA / SLO / SLI:** service level agreement / objective / indicator.
- **Error budget:** 1 - SLO. Allowable failure.

---

## Appendix — Quick Reference Card

For your monitor's edge:

```
ants Production Quick Reference

CREATE:
  pool, _ := ants.NewPool(N, WithPanicHandler(h), WithExpiryDuration(60s))
  defer pool.ReleaseTimeout(30s)

SIZE:
  Cap = Throughput * AvgDuration * 1.5

MONITOR:
  Running, Free, Cap, Waiting
  pool_submit_total{result=ok|overload|closed}
  pool_panic_total

ALERT:
  Running/Cap > 0.9 for 5m -> warning
  Waiting > 0 for 2m -> warning
  overload rate > 0 -> warning
  panic rate > 0 -> critical

SHUTDOWN:
  preStop sleep 5s
  server.Shutdown(ctx)
  cancel()
  pool.ReleaseTimeout(20s)

OPTIONS PRO TIP:
  WithPanicHandler -> always
  WithNonblocking  -> if admission control
  WithMaxBlockingTasks -> if blocking + bounded
  WithExpiryDuration -> if bursty
  WithDisablePurge -> if always busy
```

Print, laminate, post.

---

## Appendix — One Final Story

A team I worked with shipped `ants` in production for the first time. They hit every problem in this file over six months:

1. Forgotten release → leaked goroutines.
2. Missing panic handler → silent failures.
3. No metrics → flying blind.
4. Wrong size → saturation.
5. Cascading failure → no bulkheads.
6. Bad shutdown → 503 storms during deploy.

Each fix took a few days. Each was painful. Each could have been prevented by reading something like this file.

The eventual outcome: a robust, observable service. But we did it the hard way.

You don't have to. Read, plan, ship carefully.

---

## End of Professional

That ends this file. You are ready to deploy `ants` in production.

The next file, `specification.md`, is the precise API reference. Use it for lookups. The remaining files are exercises (`tasks.md`, `find-bug.md`, `optimize.md`) and Q&A (`interview.md`).

Onward.

---






