---
layout: default
title: Steady-State — Tasks
parent: Steady-State
grand_parent: Production Patterns
ancestor: Go
nav_order: 8
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/18-production-patterns/06-steady-state/tasks/
---

# Steady-State — Tasks

[← Back](../)

These are hands-on exercises. Each one forces you to engineer one specific steady-state property into real code. Work in a scratch repository; commit each task as a separate branch so you can compare your work to the next attempt.

## Table of Contents

1. [Task 1 — Bounded worker pool](#task-1--bounded-worker-pool)
2. [Task 2 — Shed-on-full versus block-on-full](#task-2--shed-on-full-versus-block-on-full)
3. [Task 3 — `GOMEMLIMIT` from cgroup](#task-3--gomemlimit-from-cgroup)
4. [Task 4 — `runtime/metrics` exporter](#task-4--runtimemetrics-exporter)
5. [Task 5 — Per-tenant semaphore](#task-5--per-tenant-semaphore)
6. [Task 6 — Connection pool baseline](#task-6--connection-pool-baseline)
7. [Task 7 — Leak detector for CI](#task-7--leak-detector-for-ci)
8. [Task 8 — Slow-decline harness](#task-8--slow-decline-harness)
9. [Task 9 — Saturation dashboard](#task-9--saturation-dashboard)
10. [Task 10 — FD budget enforcer](#task-10--fd-budget-enforcer)
11. [Task 11 — Idle-time background work](#task-11--idle-time-background-work)
12. [Task 12 — `GOGC` benchmark sweep](#task-12--gogc-benchmark-sweep)

---

## Task 1 — Bounded worker pool

**Goal.** Implement a worker pool with a fixed goroutine count and a bounded job queue. The pool must:

- Accept jobs through `Submit(job) error`, returning an error when the queue is full.
- Spawn exactly N workers at start, never more.
- Stop cleanly on `Stop(ctx)`, waiting for in-flight jobs up to `ctx.Done()`.

Skeleton:

```go
type Pool struct {
    jobs    chan func()
    wg      sync.WaitGroup
    workers int
}

func NewPool(workers, queueSize int) *Pool { /* ... */ }

func (p *Pool) Submit(job func()) error { /* ... */ }

func (p *Pool) Stop(ctx context.Context) error { /* ... */ }
```

**Acceptance criteria.**

- A unit test submits 10 000 jobs while the worker count is set to 4 and the queue size is 8. Confirm `runtime.NumGoroutine()` never exceeds `4 + main + GC + reasonable overhead`.
- A second test fills the queue, attempts one more `Submit`, and asserts that the call returned `ErrQueueFull` rather than blocking.
- A third test calls `Stop` while five jobs are in flight; verify all five completed.

**Stretch.** Add a `Metrics()` method returning current queue depth, in-flight count, and total processed.

---

## Task 2 — Shed-on-full versus block-on-full

**Goal.** Refactor Task 1 so the pool supports both shedding and blocking, chosen per `Submit` call.

```go
type SubmitOption int

const (
    Shed SubmitOption = iota
    Block
    BlockWithTimeout
)

func (p *Pool) SubmitWith(job func(), opt SubmitOption, timeout time.Duration) error
```

**Acceptance criteria.**

- With `Shed`, the call returns immediately with `ErrQueueFull` if the queue is full.
- With `Block`, the call waits until a slot opens or the pool is stopped.
- With `BlockWithTimeout`, the call waits up to `timeout` and then returns `ErrTimeout`.

Write a benchmark that submits at twice the worker capacity for thirty seconds using each option; observe the difference in tail latency and dropped count.

---

## Task 3 — `GOMEMLIMIT` from cgroup

**Goal.** At program startup, read the cgroup memory limit (v1 or v2) and call `debug.SetMemoryLimit` with ninety percent of that value.

```go
func setMemoryLimitFromCgroup() (int64, error) {
    // try v2 path first
    if b, err := os.ReadFile("/sys/fs/cgroup/memory.max"); err == nil { /* ... */ }
    // fall back to v1
    if b, err := os.ReadFile("/sys/fs/cgroup/memory/memory.limit_in_bytes"); err == nil { /* ... */ }
    return 0, errors.New("no cgroup memory limit found")
}
```

**Acceptance criteria.**

- The function handles both `max` (meaning unlimited) and a numeric value.
- It logs the limit and the value passed to `SetMemoryLimit`.
- When run outside a container, it logs "no cgroup memory limit found" and does not set the limit.

**Stretch.** Add a fallback to `/proc/meminfo` when no cgroup is present: cap at, say, ninety percent of `MemTotal`.

---

## Task 4 — `runtime/metrics` exporter

**Goal.** Write an exporter that reads a curated set of `runtime/metrics` values every fifteen seconds and writes them to stdout in line-protocol form (`name=value`).

The curated set must include:

- `/memory/classes/heap/objects:bytes`
- `/memory/classes/heap/free:bytes`
- `/memory/classes/heap/released:bytes`
- `/sched/goroutines:goroutines`
- `/gc/cycles/total:gc-cycles`
- `/gc/pauses:seconds` (mean, p99 of histogram)
- `/sync/mutex/wait/total:seconds` (delta per sample)

**Acceptance criteria.**

- The exporter is a `func Start(ctx context.Context, w io.Writer)`.
- It stops cleanly when the context is cancelled.
- It computes histogram quantiles (`Float64Histogram.Buckets` and `Counts`).
- It tracks deltas for cumulative counters so each line is "rate per fifteen seconds."

---

## Task 5 — Per-tenant semaphore

**Goal.** Build a tenant scheduler that gives each tenant a weighted semaphore. Calls from tenant T must acquire the tenant's semaphore before doing work; calls beyond the weight wait or are rejected.

```go
type TenantScheduler struct { /* ... */ }

func NewTenantScheduler(perTenant int64) *TenantScheduler

func (s *TenantScheduler) Do(ctx context.Context, tenantID string, fn func()) error
```

**Acceptance criteria.**

- Each tenant's concurrent in-flight count never exceeds `perTenant`.
- One tenant exceeding its budget does not block other tenants.
- The semaphore for an unseen tenant is created lazily and cleaned up when idle for a configurable timeout (otherwise the map grows without bound — a steady-state bug in disguise).

**Stretch.** Add per-tenant weights from a configuration map; reconfigure at runtime via `SetWeight(tenantID, weight)`.

---

## Task 6 — Connection pool baseline

**Goal.** Configure a `database/sql` pool and an `http.Transport` pool for a service that issues fifty queries per second to a database and twenty outbound HTTP calls per second to two upstreams.

**Acceptance criteria.**

- The `sql.DB` is configured with `SetMaxOpenConns`, `SetMaxIdleConns`, `SetConnMaxLifetime`, `SetConnMaxIdleTime` to values you can justify.
- The `http.Transport` is configured with `MaxIdleConns`, `MaxIdleConnsPerHost`, `MaxConnsPerHost`, `IdleConnTimeout`.
- A test program runs the workload for ten minutes; `db.Stats().WaitCount` stays at zero and `runtime.NumGoroutine` stays flat.

**Deliverable.** Your numbers and a one-paragraph rationale for each one.

---

## Task 7 — Leak detector for CI

**Goal.** Write a Go test helper that runs a function repeatedly and asserts that goroutine count, heap, and open FD count have not grown beyond a configured budget.

```go
func AssertNoLeak(t *testing.T, fn func(), opts LeakOpts)

type LeakOpts struct {
    Iterations         int
    GoroutineBudget    int   // max delta
    HeapBytesBudget    int64 // max delta in post-GC heap
    FDBudget           int   // max delta in open FDs
}
```

**Acceptance criteria.**

- It calls `fn` `Iterations` times.
- Between every iteration it runs `runtime.GC()` and waits for goroutines that should have exited to do so (a short, bounded poll).
- It reads goroutines from `runtime.NumGoroutine`, heap from `runtime/metrics`, FDs from `/proc/self/fd`.
- It reports the worst delta and fails the test if any budget is exceeded.

**Stretch.** Add a `Verbose` flag that dumps the goroutine profile on failure.

---

## Task 8 — Slow-decline harness

**Goal.** Build a one-hour load-test harness that runs your service under simulated traffic, injects slow upstreams every five minutes, and at the end asserts that steady-state invariants still hold.

**Acceptance criteria.**

- The harness is a single binary or `go test -run TestSlowDecline -timeout=2h`.
- It samples runtime metrics every minute.
- At the end, it fits a linear regression through post-GC heap and goroutine count.
- It fails if the slope is positive beyond a configured budget.
- It prints a CSV of all samples for offline inspection.

**Stretch.** Run the harness in CI as a nightly job; gate releases on its success.

---

## Task 9 — Saturation dashboard

**Goal.** Design a dashboard (Grafana, Datadog, or any other) that surfaces the five most informative steady-state metrics for an arbitrary Go service:

1. Post-GC heap size.
2. Goroutine count.
3. Queue depth (or `WaitCount` for connection pools).
4. GC CPU fraction.
5. Open file descriptors.

**Acceptance criteria.**

- Each panel has a sensible y-axis (no log scale needed for healthy values).
- Each panel has a threshold line at the alert level.
- The dashboard fits on one screen with no scrolling.

**Stretch.** Add a "drift" sub-dashboard with linear-regression slopes for each metric over the last six hours.

---

## Task 10 — FD budget enforcer

**Goal.** Write a periodic check that compares the current FD count against a configured budget and panics (or alerts) if exceeded. This is a runtime safety net, complementing the alert in Task 9.

```go
func StartFDWatch(ctx context.Context, budget int, onExceed func(current int))
```

**Acceptance criteria.**

- It samples every thirty seconds.
- It reads from `/proc/self/fd` on Linux; gracefully no-ops on macOS or Windows (or fakes a count via `runtime.Stack`).
- `onExceed` is called once per breach, not once per sample.

**Stretch.** Dump the goroutine profile and the most-recently-opened FD via `lsof` (a real lsof shell-out, since pure Go cannot read `/proc/self/fd` link targets on all kernels).

---

## Task 11 — Idle-time background work

**Goal.** Implement a scheduler that runs background tasks only when CPU is idle (low load average) and pauses them when load rises.

```go
type IdleScheduler struct { /* ... */ }

func (s *IdleScheduler) Run(ctx context.Context, task func() error, interval time.Duration)
```

**Acceptance criteria.**

- The scheduler samples a load signal — perhaps `/proc/loadavg` on Linux, or the runtime's `runtime/metrics` scheduling latency.
- When the signal is above a threshold, it skips the next interval.
- When the signal is low, it runs the task.
- The pace is configurable and the scheduler stops on context cancel.

**Stretch.** Replace the load signal with a queue-depth signal: run background work only when the main queue is below a watermark.

---

## Task 12 — `GOGC` benchmark sweep

**Goal.** Pick an allocation-heavy benchmark (encoding/json, regexp, or your own) and sweep `GOGC` across `25, 50, 100, 200, 500, off`, measuring (a) throughput, (b) p99 latency, (c) average post-GC heap size.

**Acceptance criteria.**

- A bash or Go-test driver that loops through values, runs `benchstat`, and prints a table.
- A short markdown report (a paragraph each) of what the trade-offs look like for that workload.
- A recommendation: which value would you ship?

**Stretch.** Repeat with `GOMEMLIMIT` set to half the natural steady-state heap, and observe the new trade-off curve.

---

## Task 13 — Backpressure-driven readiness

**Goal.** Implement a Kubernetes-style readiness handler that flips to "not ready" when the worker pool's queue depth exceeds eighty percent of capacity, and back to "ready" when it drops below sixty percent.

```go
type Readiness struct {
    pool *Pool
    isReady atomic.Bool
}

func (r *Readiness) Loop(ctx context.Context)
func (r *Readiness) Handler() http.HandlerFunc
```

**Acceptance criteria.**

- A test that submits enough work to fill the queue past 80%; verify the handler returns 503.
- After draining below 60%, verify the handler returns 200.
- Hysteresis between 60% and 80% prevents flapping.

**Stretch.** Wire it into a real `http.Server` with `/readyz` and `/healthz`, plus a separate listener for admin endpoints.

---

## Task 14 — Memory limit from cgroup

**Goal.** Write a startup helper that reads cgroup v1 and v2 memory limits and calls `debug.SetMemoryLimit` at ninety percent of the value.

```go
package memlimit

func SetFromCgroup() (int64, error)
```

**Acceptance criteria.**

- Handles cgroup v2 path `/sys/fs/cgroup/memory.max`.
- Handles cgroup v1 path `/sys/fs/cgroup/memory/memory.limit_in_bytes`.
- Returns gracefully when no cgroup is found (running outside a container).
- Logs the limit and the value used.
- Unit-test friendly: takes a filesystem abstraction so tests can simulate cgroup paths.

**Stretch.** Re-read the cgroup every minute and adjust if the limit changes (Kubernetes vertical pod autoscaler scenarios).

---

## Task 15 — Per-tenant rate limiter

**Goal.** Per-tenant token bucket rate limiter, scoped by tenant ID. Idle tenants are garbage-collected after a TTL.

```go
type Limiter struct { /* ... */ }

func NewLimiter(ratePerSec, burst int, idleTTL time.Duration) *Limiter
func (l *Limiter) Allow(tenantID string) bool
```

**Acceptance criteria.**

- Each tenant's effective rate matches the configured `ratePerSec`.
- Idle tenants are evicted after `idleTTL`.
- Concurrent `Allow` calls from many tenants do not contend on a single mutex.
- A benchmark shows at least one hundred thousand `Allow` operations per second under contention.

**Stretch.** Add per-tenant burst overrides; runtime reconfiguration without restart.

---

## Task 16 — Graceful shutdown harness

**Goal.** A test that verifies your service can shut down gracefully within a configurable deadline, with in-flight work completing or being abandoned cleanly.

**Acceptance criteria.**

- Spin up the service.
- Submit fifty long-running jobs.
- Trigger shutdown.
- Assert that within thirty seconds, the service has exited and no goroutines are leaked.
- Assert that no panic occurred during shutdown.

**Stretch.** Run the harness in a chaos mode where some jobs deliberately exceed the shutdown deadline; assert that abandoned jobs increment a metric.

---

## Task 17 — Auto-scaling control loop

**Goal.** Build a control loop that increases worker count when queue depth is high and decreases it when queue depth is low.

```go
type AutoScaler struct {
    Pool   *Pool
    Min    int
    Max    int
    Window time.Duration
}

func (a *AutoScaler) Run(ctx context.Context)
```

**Acceptance criteria.**

- Worker count never goes below `Min` or above `Max`.
- Scale-up is faster than scale-down (avoid thrashing).
- The control loop samples at least every five seconds.
- The control variable (worker count) only changes when the signal (queue depth) has been above or below threshold for at least two samples.

**Stretch.** Implement a PI controller (proportional + integral) with explicit gain tuning.

---

## Task 18 — Allocation hotspot reduction

**Goal.** Pick a benchmark from your codebase that allocates heavily per call. Reduce its allocations by at least fifty percent using `sync.Pool`, slice preallocation, and `strconv.Append` patterns.

**Acceptance criteria.**

- `go test -bench=. -benchmem` before and after; the after column shows at least 50% fewer `allocs/op`.
- The benchmark output uses `benchstat` to confirm statistical significance.
- The functionality is unchanged (a separate functional test still passes).

**Stretch.** Run the same workload in a one-hour load test; measure post-GC heap size and average GC pause; report the production-level impact.

---

## Final exercise

Combine Tasks 1, 2, 5, 6, and 8 into a single service that:

- Has a bounded worker pool.
- Sheds when overloaded.
- Isolates tenants.
- Connects to a database with a tuned pool.
- Passes a one-hour slow-decline harness with no steady-state drift.

If you can do that, you can ship steady-state code.

---

## Bonus — Capstone project

Spend one full week designing and building a "credit-card transaction service" that:

- Accepts transactions via HTTP.
- Validates each transaction (signature check, fraud rules).
- Writes to a Postgres database.
- Calls an external "merchant clearing" upstream.
- Publishes events to a Kafka topic.

For each of those steps, apply every steady-state pattern from this section:

- Bounded queue between HTTP intake and validation.
- Per-tenant semaphore for fraud rules.
- Sized DB pool and HTTP transport.
- Kafka producer with bounded buffer.
- Graceful shutdown that drains in-flight transactions.
- `GOMEMLIMIT` from cgroup.
- Per-resource metrics on a dashboard.
- Chaos harness that injects upstream failure.
- Runbooks for each alert.

At the end of the week, demo the service to a colleague: hit it with a load test, kill a pod mid-flight, slow an upstream, then show the dashboards. If everything looks boring on the dashboards, you have built a steady-state service.

---

## Reflection prompts

After working through the tasks, sit with these questions for fifteen minutes each. Honest answers reveal where the gaps in your steady-state thinking still are.

### Prompt 1 — Where do I trust the defaults?

List every place in your last project where you relied on a Go library's default behaviour. `http.DefaultClient`, `http.DefaultTransport`, `sql.Open` without `SetMaxOpenConns`, channel without `make` capacity. For each, ask: "is the default safe for my workload?"

### Prompt 2 — Which alert would I most miss?

Imagine your service's monitoring system loses one alert at random. Which alert's loss would worry you most? That alert is the most critical safety net. Ensure it has redundancy: a dashboard pin, a runbook, a second alert in a different system.

### Prompt 3 — How long can my service run unattended?

Without any human intervention (no deploys, no manual restarts), how long can your service run before it crosses some limit? Twenty-four hours? A week? A month? Forever? The answer reveals the service's true steady-state.

### Prompt 4 — What is my service's slowest leak?

Take a quiet hour. Pull the heap, goroutine, and FD numbers from production for the last seven days. Fit a line. What is the slope? Multiply by a year. Are you alarmed?

### Prompt 5 — If a junior engineer broke production tomorrow, what would they have done?

The likeliest scenarios: added a `make(chan T, 1000000)`, forgot a `defer Close`, spawned a per-request goroutine. What guardrails would have prevented them? Lints? Code review checklist? Library wrapper that hides the dangerous primitive?

---

## A final pep talk

If you finish all the tasks and the reflection prompts, you have done as much steady-state work in a few weeks as some engineers do in years. The discipline is teachable; you have taught yourself.

The next step is to apply it in production. Find a service. Audit it against the patterns. Fix one thing. Then another. Watch the dashboards. Notice the difference.

Boring dashboards are the prize. The journey is real; the destination is a service that does not page anyone on Saturday night.
