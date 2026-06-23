---
layout: default
title: Tasks
parent: When to Use a Pool
grand_parent: Goroutine Pools (3rd-party)
ancestor: Go
nav_order: 8
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/17-goroutine-pools-3rd-party/04-when-to-use/tasks/
---

# When to Use a Pool — Hands-On Tasks

18 exercises. Some are coding, some are analysis, some are design. Each builds judgment for pool decisions.

---

## Task 1: Benchmark all three libraries

Implement the same workload — process 100k tasks, each doing a 100 μs CPU burst — with raw goroutines, errgroup, ants, tunny, and workerpool. Use `go test -bench`. Report:

- Total wall time.
- CPU time used.
- Allocations per task.
- Peak heap.

Compare the numbers. Explain the differences.

**Expected outcome.** ants should win on small CPU tasks at high count due to lower per-task overhead and zero allocations. Differences shrink as per-task work grows.

---

## Task 2: Build a decision matrix

For your team's services (pick 3-5), build a decision matrix. For each service:

- What is the workload (RPS, latency, bound)?
- What pool tool is currently used?
- Is it the right tool?
- If not, what should it be?

Write up your findings. Compare with teammates' assessments.

---

## Task 3: Migrate a service from ants to errgroup

Pick a service in your codebase that uses `ants` for a fan-out without measurable benefit. Rewrite the fan-out using `errgroup.SetLimit`. Measure:

- Lines of code change.
- Throughput before/after.
- p99 latency before/after.
- Dependency count change.

If errgroup is equivalent or better, merge. If worse, document why and keep ants.

---

## Task 4: Implement a custom priority pool

Build a 100-line pool that supports two priority levels. Submit takes a priority. High-priority tasks run before low-priority. Test under a workload with both.

**Skeleton:**

```go
type PriorityPool struct {
	high chan func()
	low  chan func()
	wg   sync.WaitGroup
}

func New(workers, queueSize int) *PriorityPool {
	p := &PriorityPool{
		high: make(chan func(), queueSize),
		low:  make(chan func(), queueSize),
	}
	for i := 0; i < workers; i++ {
		p.wg.Add(1)
		go p.work()
	}
	return p
}

func (p *PriorityPool) Submit(priority int, task func()) error {
	if priority > 0 {
		select { case p.high <- task: return nil; default: return ErrFull }
	}
	select { case p.low <- task: return nil; default: return ErrFull }
}

func (p *PriorityPool) work() {
	defer p.wg.Done()
	for {
		select {
		case t, ok := <-p.high:
			if !ok { return }
			t()
		default:
			select {
			case t, ok := <-p.high:
				if !ok { return }
				t()
			case t, ok := <-p.low:
				if !ok { return }
				t()
			}
		}
	}
}
```

Verify: high-priority tasks run before low when both are pending.

---

## Task 5: Implement a sharded pool

Build a pool with N shards. Submit routes to a shard based on hash. Each shard has its own queue and workers. Compare against a single-queue pool under high producer contention.

Expected: sharded pool shows lower contention metric, higher throughput at 100+ producers.

---

## Task 6: Build a pool wrapper with metrics

Implement the `WrappedPool` from `professional.md` Appendix P1. Verify all metrics are exported correctly with a Prometheus registry. Test that the metrics update during workload.

---

## Task 7: Load-test a pool

Pick a pool in your codebase. Write a load test that submits at increasing rates: 100/sec, 500/sec, 1000/sec, 5000/sec. Plot throughput vs offered load. Find the knee.

Identify the bottleneck at the knee: CPU, memory, downstream, or pool internal lock.

---

## Task 8: Simulate a downstream slowdown

Mock a downstream call that takes 10 ms normally but 5 seconds 1% of the time (slow tail). Submit 10k tasks to a pool of K=50. Plot p50, p99, p999 latency.

Compare with K=100, K=500. Find the K that minimises p99.

Lesson: tail latency is dominated by slow tasks. Increasing K helps up to a point.

---

## Task 9: Drain test

Write a test that:

1. Submits 1000 tasks to a pool of K=10.
2. After 100 tasks complete, sends SIGTERM (or simulates the equivalent).
3. Drains with a 5-second timeout.
4. Asserts at least 100 tasks completed; counts unfinished.

Verify that the drain timeout actually limits wait time.

---

## Task 10: Decision document for a new service

You are designing a new service: receives webhook callbacks from a payment provider, validates, writes to DB.

Volume: 500/sec average, 5000/sec at settlement runs.
DB: 50-connection pool.

Write a one-page design doc covering:
- Pool choice.
- K rationale.
- Backpressure shape.
- Failure modes.
- Metrics list.
- Alerts list.

Use the template from `professional.md` Appendix P22.

---

## Task 11: Compare tunny vs errgroup for warm state

Build a "fake PDF renderer" that:

- On construction: sleeps 200ms (simulating font cache load).
- On Process: sleeps 50ms (simulating render).

Run 100 renders with:
- errgroup.SetLimit(4): each task creates its own renderer.
- tunny.NewCallback(4): renderers are per-worker.

Compare total wall time. Verify tunny wins by ~4x.

---

## Task 12: Build a fan-out / fan-in pipeline

A 3-stage pipeline:
- Stage 1: read JSON files.
- Stage 2: transform.
- Stage 3: write to a sink.

Use errgroup at each stage with different K. Connect stages via bounded channels.

Verify: cancellation via ctx flows through all stages.

---

## Task 13: Implement a pool admission controller

Wrap a pool with an admission controller: before Submit, check per-tenant quota. Reject (with metric) if over quota.

```go
type AdmissionPool struct {
	pool      *ants.Pool
	quotas    map[Tenant]*rate.Limiter
}

func (p *AdmissionPool) Submit(tenant Tenant, task func()) error {
	if !p.quotas[tenant].Allow() {
		return ErrOverQuota
	}
	return p.pool.Submit(task)
}
```

Test under load with two tenants, one noisy, one quiet. Verify the quiet tenant's throughput is not affected.

---

## Task 14: Implement panic recovery for errgroup

Write a helper that wraps an errgroup task with panic recovery:

```go
func wrap(f func() error) func() error {
	return func() (err error) {
		defer func() {
			if r := recover(); r != nil {
				err = fmt.Errorf("panic: %v\n%s", r, debug.Stack())
			}
		}()
		return f()
	}
}

g.Go(wrap(func() error { return work(ctx, x) }))
```

Test with a task that panics. Verify the errgroup continues, panic converted to error.

---

## Task 15: Profile a pool

Pick a service with a pool. Run it under a load test. Collect:

- CPU profile (30 seconds).
- Goroutine profile.
- Heap profile.
- Mutex profile.

Open each in `go tool pprof`. Identify:

- Where the pool spends CPU.
- How many goroutines exist (and their states).
- Heap allocations attributable to pool tasks.
- Mutex contention in pool internals.

Write a one-paragraph report on findings.

---

## Task 16: Migrate raw goroutines to a bounded approach

Find code that uses raw `go f()` for fan-out without a bound. Compute the worst-case goroutine count at peak. If it could OOM, migrate to errgroup.SetLimit with appropriate K.

Document the change rationale.

---

## Task 17: Implement a per-tier pool

For a SaaS service, implement:

- Pool tiers: Premium (K=100), Standard (K=50), Free (K=10).
- Submit routes to the right pool based on tenant tier.
- Metrics per pool.

Verify: under load, premium tenants get >Standard throughput, > Free.

---

## Task 18: End-to-end exercise

Take any moderate-sized Go service (real or hypothetical). Do all of:

1. Inventory: list every concurrency primitive (raw, errgroup, semaphore, pool).
2. Assess: for each, is it the right tool for its workload?
3. Plan: migrate at least one to a better tool (or simplify).
4. Implement: write the migration PR with benchmark.
5. Document: ADR for the change.
6. Operate: add metrics, alerts, runbook entry.

This is the full senior-to-professional loop on one piece of code.

---

## Task Difficulty Map

| Task | Difficulty | Time |
|------|------------|------|
| 1    | Easy       | 2h   |
| 2    | Medium     | 4h   |
| 3    | Medium     | 6h   |
| 4    | Hard       | 4h   |
| 5    | Hard       | 6h   |
| 6    | Easy       | 2h   |
| 7    | Medium     | 4h   |
| 8    | Medium     | 4h   |
| 9    | Easy       | 2h   |
| 10   | Medium     | 4h   |
| 11   | Easy       | 2h   |
| 12   | Medium     | 6h   |
| 13   | Medium     | 4h   |
| 14   | Easy       | 1h   |
| 15   | Medium     | 4h   |
| 16   | Easy       | 2h   |
| 17   | Medium     | 4h   |
| 18   | Hard       | 12h  |

Total: ~75 hours. Don't do all at once. Spread over a few months.

---

## What Each Task Teaches

Task 1: Benchmarking discipline. Numbers > opinions.
Task 2: Critical assessment. Question existing choices.
Task 3: Refactoring with measurement. The most valuable code change is removing.
Task 4: Pool design. Understand what a pool actually is.
Task 5: Performance optimization. Sharding for less contention.
Task 6: Instrumentation. The professional baseline.
Task 7: Empirical sizing. Knee of the curve.
Task 8: Tail latency thinking. p99 vs p50.
Task 9: Lifecycle handling. Drain on shutdown.
Task 10: Design documentation. The professional artifact.
Task 11: Worker-state thinking. When tunny wins.
Task 12: Pipeline design. Multiple stages, multiple bounds.
Task 13: Multi-tenant fairness. Admission control.
Task 14: Panic recovery. Robust error handling.
Task 15: Profiling. Real-world diagnosis.
Task 16: Migration. Reducing risk in legacy code.
Task 17: Tier-based isolation. Product feature design.
Task 18: End-to-end. The professional loop.

---

---

## Task 19 (Bonus): Build a "self-tuning" pool

Wrap an ants pool with a control loop that adjusts K based on utilization. Implement hysteresis (don't flap).

```go
type AutoTunedPool struct {
	pool    *ants.Pool
	minK    int
	maxK    int
	step    int
}

func (p *AutoTunedPool) tune() {
	for range time.Tick(10 * time.Second) {
		util := float64(p.pool.Running()) / float64(p.pool.Cap())
		switch {
		case util > 0.85 && p.pool.Cap() < p.maxK:
			p.pool.Tune(p.pool.Cap() + p.step)
		case util < 0.40 && p.pool.Cap() > p.minK:
			p.pool.Tune(p.pool.Cap() - p.step)
		}
	}
}
```

Test under varying load: ramp from 100/sec to 5000/sec back to 100/sec. Plot K vs time.

Verify:
- K rises during high load.
- K falls during low load.
- K stays stable when load is steady.

If K oscillates rapidly, add more hysteresis (longer averaging window, larger threshold gap).

---

## Task 20 (Bonus): Write an integration test for backpressure

For your service, write a test that:

1. Starts the service with K=10.
2. Submits 100 tasks rapidly.
3. Verifies the producer is blocked (or returns 503, depending on policy).
4. Lets tasks complete.
5. Verifies all 100 eventually complete.

This proves backpressure works as designed.

---

## Task 21 (Bonus): Implement a queue depth alert simulation

Write a test that simulates the conditions for a "queue depth high" alert. Submit tasks fast enough that queue grows. Check the alert metric fires after the expected duration.

```go
func TestQueueDepthAlert(t *testing.T) {
	pool, _ := ants.NewPool(2)
	defer pool.Release()

	for i := 0; i < 100; i++ {
		pool.Submit(func() {
			time.Sleep(100 * time.Millisecond)
		})
	}

	// Queue should be growing
	time.Sleep(50 * time.Millisecond)
	if pool.Waiting() < 50 {
		t.Errorf("expected queue depth >50, got %d", pool.Waiting())
	}
}
```

---

## Task 22 (Bonus): Reproduce the "K=0" bug

A common production bug: K is sourced from env var, missing env var → K=0 → pool refuses all submissions.

Reproduce with a deliberate test. Validate at construction.

```go
func validateK(k int) error {
	if k <= 0 { return fmt.Errorf("invalid K: %d (must be > 0)", k) }
	return nil
}
```

Add this check to your team's standard wrapper.

---

## Task 23 (Bonus): Cross-team coordination

Pretend you operate three services that share a downstream with a 200-concurrency limit. Each service has 4 replicas.

Compute K per replica for each service such that the cluster total stays under 200.

If services have different priorities (one is critical, two are batch), redistribute.

Document your allocation in a per-downstream config:

```yaml
downstream: payments-api
limit: 200
allocations:
  service-a:  100  # 50%, critical
  service-b:  60   # 30%, normal
  service-c:  40   # 20%, batch
```

Each service reads this config; K = allocation / replicas.

---

## Task 24 (Bonus): Write a pool linter

Use Go's AST package to scan a codebase for pool-related anti-patterns:

- `errgroup.WithContext` without subsequent `SetLimit`.
- `ants.NewPool` without `defer Release()`.
- `pool.Submit(...)` where the return error is ignored.

Build a CLI tool that prints findings.

```go
// pool-lint: scans Go files for pool anti-patterns
package main

// ... AST walking similar to Appendix P39
```

Use the linter in CI for new code.

---

## Task 25 (Bonus): Performance regression test

Write a benchmark that fails CI if the pool's Submit cost regresses by >20%:

```go
func BenchmarkPoolSubmit(b *testing.B) {
	pool, _ := ants.NewPool(100)
	defer pool.Release()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		pool.Submit(func() {})
	}
}
```

Run baseline. Save the result. CI runs the benchmark on each PR; compares to baseline. Fails if >20% slower.

Catches accidental performance regressions.

---

## Final Mini-Project: Full Service With Pool

Build a real (or stub) service from scratch:

1. HTTP API: `POST /process`.
2. Each request creates K sub-tasks (where K is part of request).
3. Tasks are CPU-bound (e.g., compute SHA-512 of random data).
4. Service uses ants pool sized for NumCPU.
5. Service exports all standard pool metrics.
6. Service handles SIGTERM gracefully.
7. Service has tests (unit + integration).
8. Service has a Dockerfile.
9. Service has Prometheus rules + Grafana dashboard.
10. Service has a runbook.

This is one week of focused work. End result: a portfolio-quality demonstration of pool engineering.

---

## Task Completion Tracking

Make a checklist:

- [ ] Task 1 — benchmark
- [ ] Task 2 — decision matrix
- [ ] Task 3 — ants → errgroup migration
- [ ] Task 4 — priority pool
- [ ] Task 5 — sharded pool
- [ ] Task 6 — wrapper with metrics
- [ ] Task 7 — load test
- [ ] Task 8 — downstream slowdown simulation
- [ ] Task 9 — drain test
- [ ] Task 10 — design doc
- [ ] Task 11 — tunny vs errgroup
- [ ] Task 12 — pipeline
- [ ] Task 13 — admission controller
- [ ] Task 14 — panic recovery
- [ ] Task 15 — profile
- [ ] Task 16 — migrate raw goroutines
- [ ] Task 17 — per-tier pool
- [ ] Task 18 — end-to-end
- [ ] Task 19 (bonus) — self-tuning
- [ ] Task 20 (bonus) — backpressure test
- [ ] Task 21 (bonus) — queue depth alert
- [ ] Task 22 (bonus) — K=0 bug
- [ ] Task 23 (bonus) — cross-team
- [ ] Task 24 (bonus) — linter
- [ ] Task 25 (bonus) — perf regression
- [ ] Final mini-project

Pick the ones most relevant to your team's needs. Skip the rest.

---

End of `tasks.md`.

