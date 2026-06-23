---
layout: default
title: Senior — Drain Pattern
parent: Drain Pattern
grand_parent: Production Patterns
ancestor: Go
nav_order: 4
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/18-production-patterns/05-drain-pattern/senior/
---

# Drain Pattern — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [The Architecture View](#the-architecture-view)
3. [Two-Phase Shutdown](#two-phase-shutdown)
4. [Supervisor-Driven Drain](#supervisor-driven-drain)
5. [Drain DAG and Topological Order](#drain-dag-and-topological-order)
6. [Drain Across Service Boundaries](#drain-across-service-boundaries)
7. [Cluster-Aware Drain](#cluster-aware-drain)
8. [Drain and Leader Election](#drain-and-leader-election)
9. [Drain and Distributed Transactions](#drain-and-distributed-transactions)
10. [Quiesce in Stateful Systems](#quiesce-in-stateful-systems)
11. [Drain Telemetry at Scale](#drain-telemetry-at-scale)
12. [Drain Anti-Patterns at Senior Level](#drain-anti-patterns-at-senior-level)
13. [Designing For Drainability](#designing-for-drainability)
14. [Drain Testing Strategy](#drain-testing-strategy)
15. [Drain Performance Budgets](#drain-performance-budgets)
16. [Drain and Capacity Planning](#drain-and-capacity-planning)
17. [Hot Path Cost of Drain Tracking](#hot-path-cost-of-drain-tracking)
18. [Drain in Polyglot Stacks](#drain-in-polyglot-stacks)
19. [Drain Incidents — A Case Study](#drain-incidents-a-case-study)
20. [Drain and Sidecars](#drain-and-sidecars)
21. [Drain and Long-Running Jobs](#drain-and-long-running-jobs)
22. [Mentoring Through Drain](#mentoring-through-drain)
23. [Self-Assessment Checklist](#self-assessment-checklist)
24. [Summary](#summary)

---

## Introduction
> Focus: "How do I design a system so drain is automatic? How do I lead a team to write drainable services by default?"

At the junior level you learn the recipe. At the middle level you apply the recipe across components. At the senior level you stop thinking about the recipe — drain is a property of the system architecture, baked in from the first lines of code. Your job is to design systems that drain naturally, to mentor engineers in writing drainable code without ceremony, to debug drain failures in production from a goroutine dump and a metric graph, and to push drain into the same first-class status as health checks and logging.

This page is less about new code and more about *judgement*. The decisions you make at the senior level: which subsystems share a deadline, which can run drains in parallel, when to break the recipe, how to teach drainability without slowing the team down.

---

## The Architecture View

Drain at the senior level is not a feature; it is a *property*. A system either has it or does not. Designing for drain means:

- Every long-lived goroutine has an owner.
- Every owner has a `Drain` method with a context parameter.
- The dependency graph of components is explicit (no surprise back-edges).
- The orchestrator's grace period is a known input to every design decision.
- The drain budget is allocated across components based on measured P99s, not guesses.

A system without these is a system that *might* drain — it works in dev, sometimes works in prod, fails on every deploy with a corner case. A system with these is a system that drains *by construction*.

### The drain-friendly architecture diagram

```text
                      ┌───────────────────────────┐
                      │       Process Boundary    │
                      └────────────┬──────────────┘
                                   │
       ┌───────────────────────────┼───────────────────────────┐
       │                           │                           │
┌──────▼──────┐             ┌──────▼──────┐             ┌──────▼──────┐
│  Ingress     │            │  Workers     │            │  Schedulers  │
│  (HTTP/gRPC) │            │  (Pools)     │            │  (Cron)      │
└──────┬──────┘             └──────┬──────┘             └──────┬──────┘
       │                           │                           │
       └────────────┬──────────────┴───────────────────────────┘
                    │
              ┌─────▼─────┐
              │  Producers │
              │  (Kafka)   │
              └─────┬─────┘
                    │
              ┌─────▼─────┐
              │  Stores    │
              │  (DB/Redis)│
              └───────────┘
```

Drain travels top to bottom. Ingress drains first; stores drain last. Each layer's `Drain(ctx)` blocks until in-flight at that layer is zero.

### Drainability invariants

Treat these as architectural invariants:

- **Invariant 1.** Every goroutine is reachable from a Drain method.
- **Invariant 2.** Every Drain method takes a context and returns an error.
- **Invariant 3.** The Drain dependency graph is a DAG (no cycles).
- **Invariant 4.** Total drain time across all components fits in the grace period.

A code review that catches invariant violations catches drain bugs at design time.

---

## Two-Phase Shutdown

Single-phase drain is "stop intake, wait, close." Two-phase drain adds a *quiesce* step:

- **Phase A — quiesce.** Tell the system "you are going down soon, but keep running." The system uses this hint to bias toward completion: stop accepting long-running work, slow down throughput to drain in-flight faster.
- **Phase B — drain.** The standard drain.

Two-phase is useful for:

- Systems where in-flight work is many-stage. Quiesce stops new sagas; drain finishes existing ones.
- Distributed leader election. Quiesce releases leadership before drain.
- Long-running batch jobs. Quiesce stops new jobs; drain waits for current ones.

```go
type Server struct {
	quiescing atomic.Bool
	draining  atomic.Bool
}

func (s *Server) Quiesce() {
	s.quiescing.Store(true)
	// release leadership, stop scheduling
}

func (s *Server) Drain(ctx context.Context) error {
	s.draining.Store(true)
	return s.wait(ctx)
}

// main:
s.Quiesce()
time.Sleep(quiescePeriod)
_ = s.Drain(drainCtx)
```

`quiescePeriod` is typically 5–15 seconds. Long enough for outstanding sagas to finish a stage, short enough to fit in the grace period.

---

## Supervisor-Driven Drain

For a service with many components, a *supervisor* coordinates start, runtime monitoring, and drain. Erlang/OTP pioneered this; in Go, we build it with `errgroup` and `context`.

```go
type Component interface {
	Name() string
	Start(ctx context.Context) error
	Drain(ctx context.Context) error
}

type Supervisor struct {
	components []Component
	logger     *slog.Logger
}

func (s *Supervisor) Run(ctx context.Context) error {
	g, gCtx := errgroup.WithContext(ctx)
	for _, c := range s.components {
		c := c
		g.Go(func() error {
			s.logger.Info("starting", "component", c.Name())
			err := c.Start(gCtx)
			s.logger.Info("stopped", "component", c.Name(), "err", err)
			return err
		})
	}
	return g.Wait()
}

func (s *Supervisor) Drain(ctx context.Context) error {
	// Reverse order
	for i := len(s.components) - 1; i >= 0; i-- {
		c := s.components[i]
		s.logger.Info("draining", "component", c.Name())
		start := time.Now()
		err := c.Drain(ctx)
		s.logger.Info("drained", "component", c.Name(),
			"duration", time.Since(start), "err", err)
	}
	return nil
}
```

A supervisor centralises logging, sequencing, and error handling. New components are added with one line.

### Supervisor strategies

Inspired by Erlang:

- **One-for-one.** One component crashes; restart only that component. Drain on supervisor exit.
- **One-for-all.** One component crashes; drain everyone, exit.
- **Rest-for-one.** One component crashes; drain it and everything that depends on it.

For Go services, the most common is one-for-all: any crash triggers a service-wide drain and exit. This is what `errgroup` gives you naturally.

---

## Drain DAG and Topological Order

A real service has a dependency graph, not just a flat list. The HTTP server depends on the worker pool, which depends on Kafka, which depends on the connection layer. Drain order is the topological sort of this graph.

```go
type Node struct {
	Name     string
	Drain    func(context.Context) error
	DependsOn []string
}

type Graph struct {
	nodes map[string]*Node
}

func (g *Graph) DrainOrder() ([]*Node, error) {
	// Kahn's algorithm
	indeg := map[string]int{}
	deps := map[string][]string{} // reverse: deps[a] = nodes that depend on a
	for _, n := range g.nodes {
		indeg[n.Name] = 0
	}
	for _, n := range g.nodes {
		for _, d := range n.DependsOn {
			indeg[n.Name]++
			deps[d] = append(deps[d], n.Name)
		}
	}
	var queue []*Node
	for _, n := range g.nodes {
		if indeg[n.Name] == 0 {
			queue = append(queue, n)
		}
	}
	var order []*Node
	for len(queue) > 0 {
		n := queue[0]
		queue = queue[1:]
		order = append(order, n)
		for _, dep := range deps[n.Name] {
			indeg[dep]--
			if indeg[dep] == 0 {
				queue = append(queue, g.nodes[dep])
			}
		}
	}
	if len(order) != len(g.nodes) {
		return nil, errors.New("cycle")
	}
	// Reverse for drain order
	for i, j := 0, len(order)-1; i < j; i, j = i+1, j-1 {
		order[i], order[j] = order[j], order[i]
	}
	return order, nil
}
```

The algorithm: build a topo order of "starts" (dependencies before dependents), then reverse for drain order (dependents before dependencies).

### Parallel drain

Components without a direct dependency can drain in parallel. For a graph with N nodes, drain is at most the height of the DAG, not the size.

```go
func (g *Graph) DrainParallel(ctx context.Context) error {
	// Group nodes by depth.
	depth := g.depths()
	maxDepth := 0
	for _, d := range depth {
		if d > maxDepth {
			maxDepth = d
		}
	}
	for d := maxDepth; d >= 0; d-- {
		var grp errgroup.Group
		for name, dd := range depth {
			if dd != d {
				continue
			}
			n := g.nodes[name]
			grp.Go(func() error { return n.Drain(ctx) })
		}
		if err := grp.Wait(); err != nil {
			return err
		}
	}
	return nil
}
```

Each "wave" runs in parallel. The drain takes time proportional to the depth, not the total number of components.

---

## Drain Across Service Boundaries

A microservice does not drain in isolation. Its upstreams and downstreams matter.

### Upstream drain notification

When pod A drains, its callers should know. Options:

- **Health check.** Caller polls `/ready`; sees 503; takes pod A out of rotation.
- **Push notification.** Pod A publishes a "draining" event on a control bus.
- **Connection close.** Pod A closes its server; callers see EOF.

Health check is the most common. Push notification is faster but adds complexity. Connection close is implicit but unreliable (the caller may not retry).

### Downstream drain coordination

When pod A drains, its callees may still be running. Pod A should:

- Not start new requests to callees in the last seconds of drain.
- Let in-flight downstream calls finish (within the drain deadline).
- Close its connection pool last.

### Drain hand-off in a saga

A saga is a multi-step distributed transaction. Pod A may be in step 3 of 7 when drain starts. Options:

1. **Finish the saga locally.** Continue to step 7 within the drain budget.
2. **Hand off.** Persist saga state; let pod B (or A's replacement) resume.
3. **Compensate.** Roll back steps 1-3.

The choice depends on the saga's idempotency and the budget. Hand-off requires storage; finish-locally requires time; compensate requires backward steps.

---

## Cluster-Aware Drain

In a cluster, drain of one pod must consider:

- Are there enough other pods to handle the load?
- Is a leader election needed?
- Are any other pods also draining?

### Quorum-aware drain

For a cluster of N pods needing quorum M, never let more than N-M drain at once. Implement this in the orchestrator:

```yaml
maxUnavailable: 1
```

Kubernetes' `PodDisruptionBudget` enforces this for voluntary disruptions.

### Drain throttling

For large clusters, throttle drain rate to avoid mass session migration:

```yaml
maxSurge: 1
maxUnavailable: 0
```

One new pod up, then one old pod drains. Sessions migrate gradually.

### Cross-region drain

For multi-region services, drain in one region should not affect others. Ensure each region's drain is independent. Common pitfall: a shared database or message bus that becomes a serial bottleneck.

---

## Drain and Leader Election

A service with leader election (etcd, Zookeeper, consensus libraries) must release leadership during drain.

```go
type LeaderService struct {
	election *etcd.Election
}

func (s *LeaderService) Drain(ctx context.Context) error {
	// Step 1: release leadership FIRST.
	if err := s.election.Resign(ctx); err != nil {
		// continue draining anyway
	}
	// Step 2: let the new leader be elected.
	// Step 3: drain own work.
	return s.drainWork(ctx)
}
```

Why first? Because resigning leadership allows another pod to take over. If you drain work first, you stay leader for the duration — and no other pod can take leader-only actions during that time.

The downside: tasks that require leader privilege cannot run after resignation. If your drain needs to write a checkpoint as leader, do it before resignation.

---

## Drain and Distributed Transactions

Distributed transactions (2PC, Sagas) interact poorly with drain. The classic problems:

- Drain in the middle of prepare phase. Hand off without commit decision: the transaction hangs.
- Drain in the middle of commit phase. Some participants commit; others don't.
- Drain of the coordinator. Replacement coordinator must resume.

### Best practices

1. **Persist transaction state at every step.** Drain or crash, the next node resumes.
2. **Idempotent participants.** A replay does not double-effect.
3. **Bound prepare/commit time.** If prepare takes longer than drain budget, the design is broken.

A common pattern: short transactions (< 1 second each), persistent log, idempotent steps. Drain is then a non-event for transactions — at worst, one is replayed.

---

## Quiesce in Stateful Systems

Stateful systems (databases, caches, search indices) drain differently. They must:

1. Stop accepting writes.
2. Flush WAL / write-ahead log.
3. Persist any in-memory state.
4. Disconnect followers / replicas cleanly.
5. Close storage handles.

A short example: an in-memory cache with periodic snapshotting.

```go
type Cache struct {
	mu       sync.RWMutex
	data     map[string][]byte
	dirty    atomic.Bool
	snapshot func(ctx context.Context, data map[string][]byte) error
}

func (c *Cache) Set(k string, v []byte) {
	c.mu.Lock()
	c.data[k] = v
	c.mu.Unlock()
	c.dirty.Store(true)
}

func (c *Cache) Drain(ctx context.Context) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if !c.dirty.Load() {
		return nil
	}
	return c.snapshot(ctx, c.data)
}
```

Snapshot during drain captures the final state. Next start reads from the snapshot. No data loss.

### Stateful drain order

Within a stateful component, drain order matters:

1. Close listeners (no new clients).
2. Wait for in-flight writes.
3. Flush WAL.
4. Snapshot in-memory state.
5. Close replication channels.
6. Close storage.

Each step has its own budget. Skipping or reordering breaks consistency.

---

## Drain Telemetry at Scale

In a fleet of 100 pods, telemetry per-drain is essential.

### Metrics that matter at scale

- **Drain duration histogram.** P50, P95, P99 across all pods.
- **Force-cancelled count.** Anything > 0 is a signal.
- **In-flight at drain start.** Trends suggest leak.
- **Goroutines at drain start.** Same.
- **Memory at drain start.** Same.

### Alerts

- `drain_duration P99 > grace_period * 0.8` for 5 min — drains approaching the limit.
- `drain_force_cancelled > 0` in any pod — incident.
- `drain_count{result="failure"} > 0` — incident.

### Dashboards

Every service should have a "deploy health" dashboard with:

- Drain duration per deploy.
- Force-cancellations per deploy.
- 5xx rate during deploy windows.
- Goroutine count change post-deploy.

Looking at these once per week catches drift before it becomes incident.

---

## Drain Anti-Patterns at Senior Level

### Anti-pattern: Drain in `init()`

```go
func init() {
	signal.Notify(...)
}
```

`init` is the wrong place for signal handling. It runs in package import order; you do not control it. Put `signal.NotifyContext` in `main`.

### Anti-pattern: Global drain functions

```go
var drainFns []func()

func RegisterDrain(f func()) {
	drainFns = append(drainFns, f)
}
```

Globals make ordering hard to reason about. Use explicit lifecycle management.

### Anti-pattern: Drain that holds locks

A drain that holds a top-level mutex serialises the entire process. Use fine-grained locks and atomic flags.

### Anti-pattern: Component owning its own context

```go
type Server struct {
	ctx context.Context // wrong
}
```

A stored context is a hidden coupling. Pass context as a method parameter.

### Anti-pattern: Drain inside a goroutine's main loop

```go
go func() {
	for {
		if shouldDrain() {
			drain()
			return
		}
		work()
	}
}()
```

Mixes concerns. The goroutine does both work and drain. A `select` on context cancel is cleaner.

### Anti-pattern: Drain that reaches into other components

```go
func (s *Server) Drain(ctx context.Context) error {
	s.workerPool.queue = nil // poking internals
}
```

Each component drains itself. The supervisor coordinates.

---

## Designing For Drainability

When designing a new service, ask:

1. **What are the long-lived goroutines?** Each must have an owner.
2. **What are the lifecycle hooks?** `Start`, `Drain`, `Close` minimum.
3. **What is the dependency graph?** Sketch it before coding.
4. **What is the budget per component?** Sum to grace period.
5. **What is the test strategy?** Drain test in CI minimum.

Designs that answer all five drain easily. Designs that skip any of them lead to fragile shutdown.

### Code review checklist

- [ ] Every long-lived goroutine has a `Drain` or equivalent.
- [ ] Drain takes a context, returns an error.
- [ ] Drain order is documented in code.
- [ ] No `os.Exit` outside `main`.
- [ ] Drain test exists.
- [ ] Drain metric is emitted.

Adopt this checklist for every PR. The cost is two minutes; the benefit is years of clean deploys.

---

## Drain Testing Strategy

At the senior level, drain testing goes beyond unit tests.

### Levels of drain test

1. **Unit.** Each component's `Drain` method, in isolation.
2. **Integration.** Multiple components together with simulated load.
3. **Soak.** Run for hours under traffic; trigger drain; verify clean.
4. **Chaos.** Random kill -TERM under load; verify no data loss.
5. **Production canary.** Deploy a single pod; observe metrics.

Each level catches different bugs. Skipping the integration level is the most common mistake.

### Drain test as deploy gate

A drain test in CI that fails blocks the deploy. The test:

1. Starts the binary.
2. Sends synthetic load.
3. Sends `SIGTERM`.
4. Asserts: clean exit code, drain duration under threshold, zero 5xx.

```bash
./service &
PID=$!
./loadgen --duration 30s --rps 100 &
LPID=$!
sleep 5
kill -TERM $PID
wait $PID
EXIT_CODE=$?
wait $LPID
if [ $EXIT_CODE -ne 0 ]; then
	echo "service did not exit cleanly"
	exit 1
fi
```

### Chaos drain test

Inject `SIGTERM` at random times during a sustained workload. Run for an hour. Count anomalies. Tools like `chaosmesh` or simple `bash` loops work.

---

## Drain Performance Budgets

A drain budget is the time you allow each phase to take. Sum to grace period.

### Budgeting from measurement

1. Measure each component's drain duration at P50, P95, P99 in production.
2. Allocate budget = P99 + safety margin (typically 1.5x).
3. Sum the budgets. Compare to grace period.
4. If sum > grace, reduce: parallelise where possible, optimise slow components.

### Example budget

| Component | P99 measured | Budget | Notes |
|-----------|-------------|--------|-------|
| Readiness propagation | n/a | 2s | Fixed delay |
| HTTP drain | 3s | 5s | P99 + buffer |
| Worker drain | 8s | 12s | P99 + buffer |
| Kafka flush | 1s | 3s | P99 + buffer |
| DB close | 0.5s | 2s | Fast but unpredictable |
| **Total** | **12.5s** | **24s** | Fits 30s grace |

If the sum exceeds the grace period, the team has work to do. The budget is the forcing function.

---

## Drain and Capacity Planning

Drain takes capacity from the cluster — one pod is offline for `drain_duration + restart_duration`. Across rolling deploys:

- N pods, drain D, restart R, deploy parallelism P.
- Effective capacity loss during deploy: P * (D + R) / N pods worth of capacity.
- Total deploy time: N / P * (D + R).

For N=100, P=10, D=20s, R=10s: 10% capacity loss during a 5-minute deploy.

If your service runs at 80% capacity, a 10% loss is fine. At 95% capacity, it is an outage.

The senior engineer thinks about this at capacity-planning time.

---

## Hot Path Cost of Drain Tracking

In-flight tracking has runtime cost. Mostly small, but at scale it matters.

### Cost of `WaitGroup.Add(1) ; defer wg.Done()`

- 2 atomic operations (Add up, Add down).
- 1 deferred function call.
- ~20-50 ns per request.

For 100k RPS: ~5 ms/s of CPU. Negligible.

### Cost of an atomic counter

- 2 atomic operations.
- No defer.
- ~10-20 ns per request.

Slightly cheaper. For ultra-hot paths.

### Cost of a sharded counter

- 2 atomic operations, but on different cache lines per CPU.
- Eliminates contention.
- ~5-10 ns per request.

Used by tracing libraries. For drain tracking, usually overkill.

### Optimisation: only track during drain

```go
type Tracker struct {
	active atomic.Bool
	count  atomic.Int64
}

func (t *Tracker) Begin() {
	if t.active.Load() {
		t.count.Add(1)
	}
}
```

`active` is set true at drain start. Before that, no tracking. Saves the atomic on the hot path.

The trade-off: at drain start, you don't know the count. You can only measure new in-flight from that moment on. For services where drain is brief, this is acceptable.

---

## Drain in Polyglot Stacks

In a polyglot service (Go front-end, Python ML backend, Rust database), drain semantics differ. Each language has its own primitives. Coordination patterns:

### Shared signal source

All processes respond to the same `SIGTERM`. Each drains in its own way. Orchestrator's grace period covers the slowest.

### Coordinated drain message

A control plane broadcasts "drain now" via a queue. Each service handles it. Useful when drain timing matters across services.

### Hierarchical drain

A parent service tells its children to drain via API call. Children drain themselves. Parent waits.

The pattern depends on the topology. Senior engineers design the topology to make drain simple.

---

## Drain Incidents — A Case Study

A real incident (anonymised). A team running 50 pods, drain time 25s, grace 30s. Last week's deploy: 8 pods exited with `SIGKILL`. Customer-facing 5xx spike at 0.3%. Pager goes off.

Investigation:

1. Pull goroutine dumps from a `SIGKILL`-ed pod via pre-stop hook.
2. Find: 100+ goroutines stuck in `db.QueryContext(rootCtx, ...)`.
3. Root cause: `rootCtx` was cancelled at drain start, but the query was already past the cancellation check — it had sent the SQL and was waiting for the response.
4. The Postgres driver's `QueryContext` has a 60-second default statement timeout. The drain deadline of 25s is shorter.
5. The drain waits for these queries; the deadline fires; force-cancel; but the driver does not interrupt the wire-level read fast enough.

Fix:

1. Set Postgres `statement_timeout` to a value less than drain budget (e.g., 10s).
2. Add a worker-pool-level deadline on each query.
3. Log queries that exceed deadline so we know which to optimise.

Lesson: **drain budget must be coordinated with all downstream timeouts**. A query timeout longer than drain deadline is a drain bug, not a query bug.

This is the kind of incident review a senior engineer leads. The fix is small; the root cause analysis is the value.

---

## Drain and Sidecars

In a service mesh with sidecars, drain is multi-process. Common issues:

### Sidecar exits first

The sidecar receives `SIGTERM` and exits immediately. The app cannot reach the network. Drain fails because the app cannot flush.

Fix: configure the sidecar to drain after the app, or to wait for the app to exit.

### App exits first

The app drains in 5s; sidecar continues for 25s; the orchestrator waits for both. Total deploy time is dominated by the sidecar.

Fix: align sidecar drain budget with app drain.

### Sidecar drops connections during drain

The sidecar may close idle connections aggressively, breaking the app's in-flight requests.

Fix: configure sidecar `terminationDrainDuration` to a sane value.

### Sidecar fails to drain

A bug in the sidecar leads to `SIGKILL`. Drain logs show clean app exit but the deploy is slow.

Fix: file a bug with the sidecar maintainers; in the meantime, lower the sidecar's drain time.

A senior engineer treats the sidecar as a peer service with its own drain semantics, not as a black box.

---

## Drain and Long-Running Jobs

Some workloads (video transcoding, ML batch inference, large ZIP unpacks) cannot fit in a 25-second drain. Strategies:

### Strategy: Different pod types

Web pods drain in 25s; worker pods get 5-minute grace. The orchestrator handles them differently. Long jobs go to worker pods.

### Strategy: Checkpoint and resume

Job state is persisted every minute. On drain, the partial result is saved. Another worker resumes from the checkpoint.

```go
type Job struct {
	ID         string
	Progress   int
	State      []byte
}

func (j *Job) Run(ctx context.Context) error {
	for {
		if err := ctx.Err(); err != nil {
			j.Save(context.Background())
			return err
		}
		j.Progress++
		j.State = compute(j.State)
		if j.Progress%100 == 0 {
			_ = j.Save(ctx)
		}
		if j.Done() {
			return nil
		}
	}
}
```

The drain becomes a forced checkpoint.

### Strategy: External execution

The Go service submits the long job to a job runner (Argo, Airflow, etc.). The runner is separately managed. Drain of the submitter does not affect the running job.

The trade-off: more infrastructure, but cleaner drain semantics.

---

## Mentoring Through Drain

A senior engineer teaches drainability without taking over. Tactics:

1. **PR comments with patterns, not solutions.** "What happens if `SIGTERM` arrives now?" Let the author answer.
2. **Code review checklists.** The drainability checklist (above) is a forcing function.
3. **Pair-program one drain test.** Then the engineer can write the rest.
4. **Incident reviews that focus on root cause.** Drain bugs almost always have a teaching moment.
5. **Templates in the org's repo.** A `service-template` repo with drain built in saves dozens of hours per new service.
6. **Lunch-and-learn on drain.** 30 minutes; live coding; question time. Reaches more engineers than 1:1s.

The goal: drain becomes implicit knowledge across the team. Newcomers absorb it from existing code without needing a special class.

---

## Self-Assessment Checklist

- [ ] I can sketch a drain dependency graph for any service in 5 minutes.
- [ ] I lead drain code reviews and catch invariant violations.
- [ ] I have debugged at least one production drain incident from a goroutine dump.
- [ ] I budget drain time based on measured P99s, not guesses.
- [ ] I integrate drain with leader election, sagas, and stateful systems.
- [ ] I mentor engineers in drainability without explicit teaching.
- [ ] I treat drain as a first-class architectural property.
- [ ] I write drain tests at unit, integration, soak, and chaos levels.
- [ ] I align drain budget with downstream timeouts (DB, RPC, etc.).
- [ ] I track drain metrics fleet-wide and alert on regressions.

---

## Summary

At the senior level, drain stops being a recipe and starts being a system property. You design for it from the first commit. You measure it, budget it, test it across levels, and mentor others into the habit. The result is a team that ships fearlessly: every deploy is a non-event because every service drains cleanly by default.

This is also the level where drain interacts with the broader system: leader election, sagas, sidecars, polyglot stacks, long-running jobs. The mid-level patterns become tools in a larger toolkit. The judgement of when to use which tool is what distinguishes senior from middle.

Once you can think in invariants and budgets, the patterns generalise. The next page, [professional.md](professional.md), goes deeper into Kafka rebalances, exactly-once semantics, partition revocation, and production war stories.

---

## Extended Section: Drain Patterns Catalogue

### Pattern: Two-phase quiesce-drain

```go
type Service struct {
	quiescing atomic.Bool
	draining  atomic.Bool
}

func (s *Service) Quiesce() {
	s.quiescing.Store(true)
}

func (s *Service) Drain(ctx context.Context) error {
	s.draining.Store(true)
	return s.wait(ctx)
}
```

### Pattern: Drain registry

```go
type Drainable interface{ Drain(ctx context.Context) error }

type Registry struct {
	mu sync.Mutex
	items []Drainable
}

func (r *Registry) Register(d Drainable) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.items = append(r.items, d)
}

func (r *Registry) DrainAll(ctx context.Context) error {
	r.mu.Lock()
	items := append([]Drainable{}, r.items...)
	r.mu.Unlock()
	for i := len(items) - 1; i >= 0; i-- {
		_ = items[i].Drain(ctx)
	}
	return nil
}
```

### Pattern: Drain by group

```go
type Group struct {
	items []Drainable
}

func (g *Group) Drain(ctx context.Context) error {
	var eg errgroup.Group
	for _, it := range g.items {
		it := it
		eg.Go(func() error { return it.Drain(ctx) })
	}
	return eg.Wait()
}
```

Components in the same group drain in parallel.

### Pattern: Drain with backpressure

```go
type RateLimitedQueue struct {
	in chan Item
	rate atomic.Int64
}

func (q *RateLimitedQueue) Drain(ctx context.Context) error {
	q.rate.Store(0) // backpressure to zero
	for len(q.in) > 0 {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(10 * time.Millisecond):
		}
	}
	return nil
}
```

### Pattern: Drain with snapshot

```go
type Stateful struct {
	state map[string][]byte
}

func (s *Stateful) Drain(ctx context.Context) error {
	return s.snapshot.Save(ctx, s.state)
}
```

---

## Extended Section: A Day in the Life of a Senior Drain Engineer

8:00 — Glance at the deploy dashboard. Yesterday's deploys: 12 in production, drain P99 = 4.2s. No alerts. Fine.

8:30 — Stand-up. A teammate mentions drain duration crept up last week. Add to my list.

9:00 — Pull the time series. Drain P99 went from 3.1s to 4.2s over 10 days. Correlates with a new feature that adds a Kafka consumer.

9:30 — Review the Kafka consumer's drain. It uses `Reader.Close` but does not commit pending offsets. Open a PR fix.

10:30 — Code review. New service with no `Drain` method. Comment: "How do we drain this?" Author replies: "Oh, I forgot." Fix in 20 minutes.

11:00 — Design review for a new feature: a long-running batch job. Discuss drain strategy. Settle on checkpoint-and-resume.

13:00 — Lunch.

14:00 — Pair with a junior on writing a drain test. They get it working in 30 minutes.

15:00 — Incident: a pod hit drain deadline. Pull goroutine dump. Find a hung HTTP request to a flaky downstream. The downstream's timeout was 30s; drain budget was 25s. Fix: lower the downstream timeout to 15s.

16:00 — Write up the incident. Add a check to CI: any HTTP client with a timeout > drain budget fails the build.

17:00 — Update the team wiki with the new check. EOD.

This is what senior drain work looks like: a mix of monitoring, mentoring, incident response, and tooling improvements. The role is preventive more than reactive.

---

## Extended Section: Drain Interview Mock — Senior

**Interviewer:** Walk me through how you'd add drain to an existing 50k-line Go service that has none.

**You:** "First, I'd audit. List all goroutines: search for `go func`, `go method`, `go funcLit`. For each, identify the owner and the exit path. Most of them should be in a long-lived struct with a `Run` method. The rest are leaks — fix those first.

Then I'd add a `Drainable` interface. Implement it on each owner. Wire them through a `Supervisor` that drains in reverse construction order.

Then `main`: replace whatever signal handling exists with `signal.NotifyContext`. Add the drain deadline derived from grace period minus safety margin.

Add the readiness flip and propagation sleep. Add metrics: `drain_duration_seconds`, `drain_force_cancelled_total`. Hook them up.

Write drain tests: empty, in-flight, hung, double-call. Run with `-race`.

Roll out to one canary pod. Watch metrics for a week. Then full rollout. Total time: two weeks for a 50k-line service."

**Interviewer:** What's the riskiest part?

**You:** "The drain test in CI. If it passes locally but fails in CI, the team disables it. Then drain breaks silently for months. Need to make the test stable and fast — under 30 seconds — so people respect it."

**Interviewer:** How do you measure success?

**You:** "Three metrics: deploy frequency goes up (people trust it), 5xx rate during deploys stays flat, drain P99 stays well under the grace period. If all three trend right for a quarter, drain is healthy."

---

## Closing Thoughts At Senior Level

The senior view of drain is that it is *infrastructure*. Like logging, metrics, and config, drain is what every service has by default. Engineering effort goes into making it cheap, observable, and uniform across the org. Once you reach that state, drain stops being a topic of conversation — it just works, and the team focuses on features.

The professional page expands on the most demanding scenario: drain in Kafka consumers with exactly-once semantics. That is the senior view stretched into a real, hairy, production system.

---

## Appendix A: A Detailed Drain Architecture Reference

This appendix walks through a senior-level drain architecture in detail.

### The Drainable contract

```go
// Drainable is implemented by anything with a lifecycle of running goroutines
// or owned resources that must be released cleanly before process exit.
//
// Contract:
//
//   - Drain must be safe to call exactly once. A second call returns nil
//     immediately (or, if your implementation prefers, an error).
//
//   - Drain must block until either:
//       * all in-flight work has completed, OR
//       * the provided context has expired.
//
//   - Drain must not panic on already-closed channels, double-cancelled
//     contexts, or concurrent calls.
//
//   - Drain returns the context error on deadline expiry, nil on clean
//     completion, or another error for transient failures.
//
//   - After Drain returns, no further work should be accepted by the
//     component. Submit-like methods should reject with a sentinel error.
type Drainable interface {
	Drain(ctx context.Context) error
}
```

This contract is short but exact. Every implementation should be auditable against it in three minutes.

### The Lifecycle owner

```go
// Lifecycle owns a sequence of (start, drain) pairs and runs them in order.
// It is the standard wiring at the top of main.
type Lifecycle struct {
	mu     sync.Mutex
	starts []func(context.Context) error
	drains []func(context.Context) error
	names  []string
	logger *slog.Logger
}

func New(logger *slog.Logger) *Lifecycle {
	return &Lifecycle{logger: logger}
}

func (l *Lifecycle) Add(name string,
	start func(context.Context) error,
	drain func(context.Context) error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.starts = append(l.starts, start)
	l.drains = append(l.drains, drain)
	l.names = append(l.names, name)
}

func (l *Lifecycle) Start(ctx context.Context) error {
	for i, s := range l.starts {
		l.logger.Info("starting", "component", l.names[i])
		if err := s(ctx); err != nil {
			return fmt.Errorf("start %s: %w", l.names[i], err)
		}
	}
	return nil
}

func (l *Lifecycle) Drain(ctx context.Context) {
	for i := len(l.drains) - 1; i >= 0; i-- {
		start := time.Now()
		err := l.drains[i](ctx)
		l.logger.Info("drained",
			"component", l.names[i],
			"duration", time.Since(start),
			"err", err,
		)
	}
}
```

A `Lifecycle` is the smallest piece that orchestrates drain. Components register themselves; `main` calls `Start` and `Drain`.

### The Supervisor

For long-running services with multiple goroutines, a supervisor wraps `errgroup` with lifecycle awareness.

```go
type Supervisor struct {
	lc  *Lifecycle
	g   *errgroup.Group
	ctx context.Context
}

func NewSupervisor(ctx context.Context, lc *Lifecycle) *Supervisor {
	g, gCtx := errgroup.WithContext(ctx)
	return &Supervisor{lc: lc, g: g, ctx: gCtx}
}

func (s *Supervisor) Spawn(name string, fn func(ctx context.Context) error) {
	s.g.Go(func() error {
		err := fn(s.ctx)
		return err
	})
}

func (s *Supervisor) Wait() error {
	return s.g.Wait()
}

func (s *Supervisor) Drain(ctx context.Context) {
	s.lc.Drain(ctx)
}
```

`Supervisor` is the runtime; `Lifecycle` is the configuration. The two collaborate.

---

## Appendix B: Detailed Two-Phase Shutdown

Two-phase shutdown is sometimes called "quiesce + drain." The principle is to *bias* the system toward completion before fully stopping intake.

### When two-phase is worth it

- The system has multi-stage workflows (sagas, pipelines).
- Some workflows can be cancelled cheaply; others cannot.
- The quiesce hint allows the system to prioritise completing the expensive ones.

### Implementation outline

```go
type Service struct {
	quiescing atomic.Bool
	draining  atomic.Bool
}

// Handler logic:
func (s *Service) StartWork(ctx context.Context, kind Kind) error {
	if s.draining.Load() {
		return errors.New("draining")
	}
	if s.quiescing.Load() && kind.LongRunning() {
		return errors.New("quiescing")
	}
	// proceed
	return nil
}

// Shutdown sequence:
func (s *Service) Shutdown(ctx context.Context) error {
	// Phase 1: quiesce.
	s.quiescing.Store(true)
	time.Sleep(s.quiescePeriod)
	// Phase 2: drain.
	s.draining.Store(true)
	return s.waitInflight(ctx)
}
```

`StartWork` refuses long-running work during quiesce, but allows short-running work to proceed. This biases the in-flight set toward completion.

### Quiesce period

Tune to your workload. Typical values: 5-15 seconds. Long enough for short-running tasks to finish; short enough to leave drain budget.

### Quiesce and metrics

Emit a metric for `quiesce_started_total` and `quiesce_duration_seconds`. Helps tune the period over time.

---

## Appendix C: Supervisor Patterns From OTP

Erlang/OTP supervisor strategies translate well to Go. A quick tour:

### one-for-one

If component A crashes, restart only A. Other components continue.

```go
type OneForOne struct {
	components map[string]Component
}

func (s *OneForOne) Run(ctx context.Context) error {
	g, gCtx := errgroup.WithContext(ctx)
	for name, c := range s.components {
		name, c := name, c
		g.Go(func() error {
			for {
				err := c.Start(gCtx)
				if err == nil || errors.Is(err, context.Canceled) {
					return err
				}
				log.Printf("%s crashed: %v, restarting", name, err)
				select {
				case <-gCtx.Done():
					return gCtx.Err()
				case <-time.After(time.Second):
				}
			}
		})
	}
	return g.Wait()
}
```

### one-for-all

If any component crashes, drain everyone, exit.

This is what `errgroup` gives by default — when one goroutine returns an error, the group context cancels, others see it.

### rest-for-one

If component A crashes, restart A and everything downstream of A.

Requires a dependency graph. Restart in topological order.

### Choice

For most Go services, **one-for-all** is simplest and safest. Crashes are surfaced; the operator decides whether to restart. Restart loops can hide problems.

---

## Appendix D: Drain in Service Mesh Sidecars

A service mesh sidecar (Envoy via Istio, Linkerd proxy) intercepts traffic. Drain ordering between app and sidecar matters.

### Recommended sequence

1. Orchestrator sends `SIGTERM` to all containers in the pod.
2. App receives it; flips readiness off.
3. Sidecar receives it; configured to enter "drain" mode (no new connections accepted, existing ones continue).
4. App finishes in-flight; exits.
5. Sidecar's drain period expires; sidecar exits.
6. Pod terminates.

### Configuration

Istio: set `terminationDrainDuration` on the proxy. Linkerd: similar setting in `Linkerd2-Proxy`.

The sidecar's drain duration should equal the app's grace period minus a buffer.

### A bug to know

If the sidecar exits *before* the app, the app cannot reach the network. Outbound calls fail. Drain might be interrupted.

Mitigation: ensure sidecar drain duration >= app drain time. Some platforms have a `preStop` hook that sleeps to enforce this.

---

## Appendix E: Drain in Stateful Sets

A StatefulSet in Kubernetes runs ordered, persistent pods (databases, queues). Drain is more delicate:

- Each pod has a stable identity.
- Pods are drained one at a time, in reverse order.
- Each pod's drain must complete before the next starts.

For application code, this means:

- Drain is single-threaded across the cluster.
- The orchestrator's per-pod grace period bounds *each* drain, not the total.
- Replication catch-up may delay drain.

A typical stateful-set drain:

1. Pod N (highest index) receives `SIGTERM`.
2. Pod N transfers any leader role / shards to others.
3. Pod N flushes WAL and snapshots state.
4. Pod N closes replication channels cleanly.
5. Pod N exits.
6. Replacement pod N starts, syncs from disk, joins cluster.

The drain function must handle each step explicitly. Stateful services have larger drain codebases.

---

## Appendix F: Drain in Distributed Locks

A service holding distributed locks (Redis, etcd, Consul) must release them on drain. Otherwise, lock holders block other pods for the lock's TTL.

```go
type LockHolder struct {
	locks sync.Map // map[string]*Lock
}

func (lh *LockHolder) Drain(ctx context.Context) error {
	var wg sync.WaitGroup
	lh.locks.Range(func(_, v any) bool {
		l := v.(*Lock)
		wg.Add(1)
		go func() {
			defer wg.Done()
			_ = l.Release(ctx)
		}()
		return true
	})
	done := make(chan struct{})
	go func() { wg.Wait(); close(done) }()
	select {
	case <-done:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}
```

Release all locks in parallel. Each release is an RPC; total wall-clock is roughly one RPC.

If release fails, the lock will expire on its own (via TTL). That is the back-stop — drain should try, but the TTL is the guarantee.

---

## Appendix G: Drain and Hot-Reload

Some services support config hot-reload via `SIGHUP`. The interaction with drain:

- `SIGHUP` triggers reload, not drain.
- `SIGTERM` triggers drain.
- The two should not be confused.

```go
ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
defer cancel()

hup := make(chan os.Signal, 1)
signal.Notify(hup, syscall.SIGHUP)
go func() {
	for range hup {
		_ = svc.Reload()
	}
}()
```

`SIGHUP` and `SIGTERM` are handled separately. Reload is in-process; drain leads to exit.

---

## Appendix H: Drain on Crash

If the process is about to crash (panic, OOM warning), should it drain?

For panic: deferred functions run, but the process exits with the panic. A panic in a worker goroutine does not naturally drain the rest. You can use `recover` to log and continue, but at that point you have no guarantees.

For OOM: too late. The kernel has decided to kill you.

For OOM warnings (high memory): proactively drain. Some services monitor their own memory and drain when above a threshold.

```go
go func() {
	for range time.NewTicker(time.Second).C {
		var m runtime.MemStats
		runtime.ReadMemStats(&m)
		if m.HeapInuse > 0.9 * memoryLimit {
			log.Println("memory pressure, draining")
			cancel() // triggers drain
			return
		}
	}
}()
```

Pre-emptive drain prevents OOM-kill, which is unceremonious.

---

## Appendix I: Drain Discipline Across A Codebase

A 50k-line codebase has many places where drain can break. A discipline matrix:

| Place | Discipline | How to enforce |
|-------|------------|----------------|
| `go` statements | Each must have a documented exit path | Code review |
| `time.Sleep` | Must be inside a `select` with `<-ctx.Done()` | `golangci-lint` custom rule |
| `os.Exit` | Only in `main` | grep on PR |
| `http.Server.Close` | Forbidden; use `Shutdown` | grep on PR |
| `signal.Notify` | Only in `main`; prefer `NotifyContext` | grep on PR |
| `context.Background` | Only at root; never in goroutines | grep on PR |
| `for { }` loops | Must check context | Code review |
| Drain functions | Must have a test | Coverage gate |

Automate as much as possible. Manual review is unreliable across a team.

---

## Appendix J: Concurrency Patterns That Make Drain Harder

Some Go concurrency patterns are powerful but make drain harder:

### Pattern: pipeline with chained channels

```go
out1 := stage1(in)
out2 := stage2(out1)
out3 := stage3(out2)
```

Drain requires closing `in`, then each stage closes its output after exhausting its input. Errors midway are hard to surface.

Mitigation: use `errgroup` per stage; pass context; close output channels via `defer`.

### Pattern: fan-in from many sources

```go
merged := merge(src1, src2, src3)
```

`merge` typically launches a goroutine per source. Drain requires draining each goroutine; the merge goroutine closes the output after all sources finish.

Mitigation: explicit `WaitGroup` inside `merge`; close output via `defer wg.Wait(); close(out)`.

### Pattern: goroutine per request

Each request spawns a goroutine. The server tracks them with a `WaitGroup`. Simple, but the wait group becomes a contention point at high RPS.

Mitigation: sharded counter; or use HTTP middleware (which already tracks).

### Pattern: pub-sub with broker goroutine

A broker goroutine receives messages and distributes to subscribers. Drain: cancel context, broker exits, subscribers exit.

Mitigation: explicit `Stop` method on broker; subscribers see channel close.

---

## Appendix K: Drain Friction Audit

Track "drain friction" — places in the codebase where adding drain is non-trivial. A friction audit:

1. Pick 5 random goroutines.
2. For each, trace the path from spawn to exit.
3. Count the number of steps.
4. Identify which steps lack a drain-aware mechanism.

A score: average steps × (1 - drain-aware steps / total steps). Lower is better.

Friction predicts incident rate. High-friction code drains by accident; low-friction code drains by design.

Aim for friction below a target (say, 3.0 average steps with > 90% drain-aware). Anything above is a refactoring target.

---

## Appendix L: The Senior Code Review

A senior code review of a drain change focuses on these questions:

1. **What changes if `SIGTERM` arrives now?** Walk through the new code.
2. **What is the worst-case drain time of this change?** Multiply P99 by 1.5x.
3. **Does this introduce a new long-lived goroutine?** If yes, where is its `Drain`?
4. **Does this change touch the drain order?** If yes, document it.
5. **Is there a test for the drain behaviour?** If not, request one.
6. **Does this share a deadline with other drains?** Verify the budgets sum.
7. **Are there any hidden timeouts that exceed the drain budget?** (DB queries, HTTP clients.)

Five-minute review; catches 80% of drain bugs.

---

## Appendix M: Drain Across Versions

A rolling deploy has v1 pods and v2 pods running simultaneously. Drain interacts with version skew:

- v1 may have different drain semantics than v2.
- Cross-version protocol changes during drain are dangerous.
- State migrations during drain may race.

Mitigations:

- Backwards-compatible API changes.
- Two-step migrations (write v1+v2, read v2 only, write v2 only).
- Feature flags to enable new drain logic gradually.

The senior engineer thinks about version skew when introducing new drain mechanics. "How does this interact with the previous version draining nearby?"

---

## Appendix N: Drain Logging In Production

Three levels of log:

### Level 1 — start and end

```text
INFO drain started ts=2026-05-15T03:14:15Z budget=25s
INFO drain complete ts=2026-05-15T03:14:18Z duration=3.2s
```

Always emit these. They are the spine of every drain-related investigation.

### Level 2 — phases

```text
INFO drain phase=readiness ts=...
INFO drain phase=http elapsed=2.1s err=
INFO drain phase=workers elapsed=0.8s err=
INFO drain phase=producers elapsed=0.3s err=
```

Per-phase logs let you find the bottleneck.

### Level 3 — events

```text
DEBUG drain forced-cancel goroutine=worker-3 reason=deadline
DEBUG drain remaining in_flight=2 elapsed=24s
```

Optional. Useful for debugging but noisy.

Use structured logging. Make `drain=true` a tag so all drain logs can be filtered.

---

## Appendix O: Drain And Capacity

Recap: when a pod drains, total cluster capacity drops by 1/N. If N is small or load is high, this matters.

A capacity-aware deploy:

- `maxUnavailable=1` — never drop more than one pod.
- `maxSurge=2` — bring up two new ones before draining old.
- Wait for new pods to be ready before continuing.

For 100 pods running at 70% capacity, this is fine. For 10 pods at 95%, you need different math.

Senior engineers run the math.

---

## Appendix P: Drain And Cost

Drain costs:

- **Engineering time** — initial implementation and ongoing maintenance.
- **Deploy duration** — drain time × number of pods.
- **Runtime overhead** — tracking in-flight has a small CPU cost.

Costs are well-bounded. The benefit (clean deploys, no customer-visible 5xx) is large. The ratio is excellent.

The cost where teams over-invest: making drain "perfect." Diminishing returns kick in fast. A 99% clean drain is 100x easier than a 99.99% clean one. Aim for 99%; alert on outliers.

---

## Appendix Q: Long Worked Example — Drain a Multi-Tenant Service

Imagine a service that serves multiple tenants from one binary: each tenant has its own queue, worker pool, and connection pool. Drain must finish each tenant cleanly.

```go
type Tenant struct {
	id       string
	queue    chan Task
	wg       sync.WaitGroup
	draining atomic.Bool
}

func (t *Tenant) Start(ctx context.Context) {
	for i := 0; i < 4; i++ {
		t.wg.Add(1)
		go t.run(ctx)
	}
}

func (t *Tenant) run(ctx context.Context) {
	defer t.wg.Done()
	for {
		select {
		case <-ctx.Done():
			return
		case task, ok := <-t.queue:
			if !ok {
				return
			}
			t.process(ctx, task)
		}
	}
}

func (t *Tenant) Drain(ctx context.Context) error {
	if !t.draining.CompareAndSwap(false, true) {
		return nil // already drained
	}
	close(t.queue)
	done := make(chan struct{})
	go func() { t.wg.Wait(); close(done) }()
	select {
	case <-done:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

type Service struct {
	mu      sync.RWMutex
	tenants map[string]*Tenant
}

func (s *Service) Drain(ctx context.Context) error {
	s.mu.RLock()
	tenants := make([]*Tenant, 0, len(s.tenants))
	for _, t := range s.tenants {
		tenants = append(tenants, t)
	}
	s.mu.RUnlock()

	// Drain tenants in parallel, but each bounded by the same context.
	var eg errgroup.Group
	for _, t := range tenants {
		t := t
		eg.Go(func() error {
			if err := t.Drain(ctx); err != nil {
				log.Printf("tenant %s drain: %v", t.id, err)
			}
			return nil
		})
	}
	return eg.Wait()
}
```

The pattern: each tenant is a Drainable; the service Drain runs all tenants in parallel under one context. Total wall-clock is bounded by the slowest tenant.

### Variations

- **Sequential drain.** Replace `errgroup` with a for-loop. Useful when tenants share a resource and parallel drain causes contention.
- **Throttled drain.** Drain tenants in batches of K to limit concurrency.
- **Priority drain.** Drain high-priority tenants first; lower priority may be cancelled.

Each variation has uses; the senior engineer chooses based on the workload.

---

## Appendix R: Drain Failure Modes

A catalogue of failure modes seen in production:

### Failure mode 1: Deadlock during drain

Drain holds lock A; a worker is waiting on lock A; the wait group never reaches zero. Cause: holding locks during drain. Fix: release before blocking on drain.

### Failure mode 2: Stuck on closed channel

A worker did `select { case ch <- v: ... }` where `ch` was closed by drain. Sends on closed channels panic. Cause: producer did not check drain state. Fix: gate sends with the drain flag.

### Failure mode 3: Drain context cascaded too aggressively

A sub-component derived its context from a context that already expired. Drain returns `DeadlineExceeded` instantly. Cause: wrong context choice. Fix: derive from `context.Background` with fresh timeout.

### Failure mode 4: Wait group counter wrong

`Add(1)` was paired with two `Done()` calls (or zero). The wait group either over-decrements (panic) or never reaches zero. Cause: bug in worker. Fix: every `Add(1)` paired with exactly one `Done()`.

### Failure mode 5: Goroutine leak

A goroutine has no exit path. Drain finishes, but the goroutine lives on. Cause: missing `<-ctx.Done` case. Fix: add the case.

### Failure mode 6: Premature health flip

Readiness flipped after listener closed. LB sends traffic; pod refuses. Brief 5xx. Cause: wrong order. Fix: readiness first, listener second.

### Failure mode 7: Drain budget too short

Drain deadline shorter than P99 handler. Some requests cancelled. Cause: misconfigured. Fix: raise budget.

### Failure mode 8: Drain budget longer than grace period

Drain takes 35s, grace is 30s, `SIGKILL` arrives mid-drain. Cause: misconfigured. Fix: budget < grace.

### Failure mode 9: Async producer drops messages

Buffered producer not flushed before close. Cause: missing `Flush`. Fix: add `Flush(ctx)` before `Close()`.

### Failure mode 10: Cascade cancellation

One component's drain triggers another's, recursively. Cause: components calling each other's drain. Fix: only the supervisor calls drain.

Each failure mode has a name and a known fix. Build a library of these in your team's wiki.

---

## Appendix S: Drain Audit Worksheet

Use this for a 30-minute drain audit of any service:

1. List all components (HTTP server, workers, producers, consumers, cron, etc.).
2. For each, locate the `Drain` (or equivalent) method.
3. For each, check: context parameter, deadline honoured, no panic on double call.
4. List the drain order. Verify it matches dependency reverse.
5. Find the signal handler. Verify `SIGTERM` is handled.
6. Find the readiness handler. Verify it reflects drain state.
7. Find the propagation sleep. Verify it is present.
8. Find the drain metrics. Verify duration and force-cancelled are emitted.
9. Find the drain tests. Verify empty + hung + double-call cases.
10. Check downstream timeouts. Verify all < drain budget.

A pass on all 10 is a healthy service. Any miss is fixable in under an hour.

---

## Appendix T: Drain Across Generations Of A Codebase

A team's drain code evolves over time:

- **Generation 1.** No drain. `os.Exit` everywhere. Production runs okay because deploys are rare.
- **Generation 2.** Ad-hoc drain. Each service has its own approach. Inconsistent. Maintainable by the original author only.
- **Generation 3.** Shared drain helpers. A `pkg/drain` library in the monorepo. Most services use it.
- **Generation 4.** Drain is invisible. The framework handles it. Engineers do not think about drain except to add a new component.

Aim for generation 4. The framework looks like:

```go
fw := framework.New(myConfig)
fw.RegisterHTTP(myHandler)
fw.RegisterWorker(myWorkerFn)
fw.RegisterProducer(myProducer)
fw.Run() // handles signals, drain, exit
```

Engineers register; the framework drains. Drain bugs are framework bugs, not application bugs.

---

## Appendix U: Building The Framework

If you build the framework yourself, the architecture:

```go
type Framework struct {
	lc       *Lifecycle
	graceTime time.Duration
}

func New(cfg Config) *Framework {
	return &Framework{
		lc: NewLifecycle(),
		graceTime: cfg.GracePeriod - 5*time.Second,
	}
}

func (f *Framework) RegisterHTTP(h http.Handler) {
	srv := &http.Server{Addr: ":8080", Handler: h}
	f.lc.Add("http",
		func(ctx context.Context) error {
			go srv.ListenAndServe()
			return nil
		},
		func(ctx context.Context) error {
			return srv.Shutdown(ctx)
		},
	)
}

func (f *Framework) Run() error {
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	if err := f.lc.Start(ctx); err != nil {
		return err
	}
	<-ctx.Done()
	dctx, dcancel := context.WithTimeout(context.Background(), f.graceTime)
	defer dcancel()
	f.lc.Drain(dctx)
	return nil
}
```

Add `RegisterWorker`, `RegisterProducer`, etc. Each follows the same shape.

A senior engineer can build this in a day. The team benefits for years.

---

## Appendix V: Real-World Drain Trade-offs

Drain decisions in production are almost always trade-offs:

- **Drain longer → cleaner exit.** But longer deploys.
- **Drain shorter → faster deploys.** But more force-cancellations.
- **More phases → finer control.** But more code.
- **Sequential drain → easier to reason.** But slower wall-clock.
- **Parallel drain → faster wall-clock.** But harder ordering.

There is no globally correct answer. The senior engineer makes the trade-off explicit, documents it, and revisits as the service evolves.

---

## Appendix W: A Drain Code Smell Checklist

Smells specific to drain code:

- A function called `Drain` that does not take a `context.Context`.
- A function called `Shutdown` that returns without an error.
- A `Stop` method with no documentation on semantics.
- A goroutine spawn without a documented exit path.
- A `for { ... }` without a `select` with context.
- A `time.Sleep` longer than 100ms without context awareness.
- A `wg.Wait()` without a `select` and deadline.
- A `<-ch` without a `select` and context.

Any of these in a code review should trigger discussion.

---

## Appendix X: Closing Remarks

Senior-level drain is mostly judgement: which patterns to use, which to skip, which to mentor on. The patterns themselves are taught at junior and middle. The judgement is built by years of incident reviews, code reviews, and design discussions.

The good news: this judgement is teachable. Junior engineers under good mentorship learn it in a year or two. The patterns above are the curriculum.

A team where drain is invisible — where new services have it by default and old services have been retrofitted — is a team that ships fast and sleeps well. That is the goal.

Move on to [professional.md](professional.md) for the deepest drain scenario: Kafka consumer rebalances with exactly-once semantics, partition revocation, and the full ceremony of production-grade messaging.

---

## Appendix Y: Drain Across Process Restarts

A pod that crashes and restarts goes through:

1. Old process death (clean drain or forced kill).
2. Restart delay (Kubernetes pod restart policy).
3. New process start.
4. Steady state resumes.

The interaction with drain:

- A clean drain leaves no orphaned state.
- A forced kill may leave: half-flushed Kafka offsets, uncommitted DB transactions, held distributed locks (until TTL).
- The new process must handle this gracefully — it cannot assume clean state.

A drain-aware design assumes the previous instance may have died ungracefully. Recovery code accepts:

- Duplicate messages.
- Stale leases.
- Half-applied state.

The drain pattern reduces these but does not eliminate them. The recovery code is the back-stop.

---

## Appendix Z: Drain And Idempotency

Idempotent operations make drain easier. If `process(msg)` is idempotent, force-cancellation followed by retry is safe.

```go
func process(ctx context.Context, msg Message) error {
	if alreadyProcessed(msg.ID) {
		return nil
	}
	if err := apply(ctx, msg); err != nil {
		return err
	}
	return markProcessed(msg.ID)
}
```

The order matters:

- Check `alreadyProcessed` first to avoid duplicates.
- `apply` then `markProcessed` — if the process dies between, the next attempt retries; idempotent.

Idempotency is the strongest invariant for distributed-system drain. Invest in it before investing in drain finesse.

---

## Appendix AA: Drain Under Resource Constraints

A pod that is memory-constrained must drain carefully:

- Drain in-flight may *increase* memory short-term (more requests held).
- An OOM during drain corrupts state.
- Pre-emptive drain on memory pressure is one technique (see earlier).

Strategies:

1. **Bounded in-flight.** Reject new requests if in-flight count is high; gives breathing room during drain.
2. **Memory budget per request.** A request that allocates too much is rejected; aggregate memory stays bounded.
3. **Backpressure at the queue.** Slow producers if the pipeline is full.

A pod that often OOMs during drain has a deeper memory bug. Drain is the symptom; the fix is upstream.

---

## Appendix BB: Drain And Connection Reuse

HTTP keep-alive connections persist after a request completes. On drain:

- New requests on existing keep-alive connections may arrive.
- `Server.Shutdown` closes idle connections, then waits for active ones.

If a client opens a keep-alive connection and sends slowly, the server might keep it active for the full drain budget.

Mitigations:

- Set `Server.ReadTimeout` and `Server.IdleTimeout` to bound how long a keep-alive can sit idle.
- Use HTTP/2 graceful close (GOAWAY frame) to tell clients to reconnect.

For gRPC: the server sends GOAWAY on `GracefulStop`. Clients see it and route new RPCs elsewhere.

---

## Appendix CC: Drain And Connection Multiplexing

HTTP/2 multiplexes many streams over one TCP connection. Drain interacts:

- Closing the connection abruptly cancels all streams.
- GOAWAY signals "no new streams; existing streams may complete."

`net/http` HTTP/2 server handles GOAWAY during `Shutdown` automatically. For custom implementations, send GOAWAY before closing.

---

## Appendix DD: Drain And Streaming Uploads

A streaming upload (chunked transfer) may take minutes. Drain interacts:

- The handler holds the request body open.
- `Server.Shutdown` waits for the handler.
- If the upload outlasts the drain budget, the request is cancelled mid-stream.

Mitigations:

- Set a per-request timeout via `r.Context().Deadline()`.
- Reject new uploads during drain.
- Accept partial uploads at the storage layer (resumable uploads).

A senior engineer designs the API for resumability. Upload tokens, ranges, etc. Drain becomes a non-event for clients.

---

## Appendix EE: Drain And External Services

A service A that calls service B during drain must consider:

- B might also be draining.
- A's request to B might fail with 503.
- A's retry logic might compound the problem.

Best practices:

- Short timeouts on outbound calls during drain.
- Do not retry "draining" responses during drain.
- Mark outbound calls as drain-sensitive so middleware can drop them.

```go
ctx := context.WithValue(ctx, drainKey, true)
// outbound client checks the key
```

This is plumbing, but it is the kind of plumbing that separates "works in prod" from "fails during deploy windows."

---

## Appendix FF: Drain In A Single-Pod Service

Even a single-pod service benefits from drain. Why?

- The orchestrator may restart it for many reasons (OOM, image update, node drain).
- A restart drops in-flight work.
- Customers see 5xx for the restart duration.

The single-pod drain follows the same pattern as the multi-pod one. The grace period is the orchestrator's bound.

Common mistake: skipping drain for "small" services. The cost is low; the benefit is uniform.

---

## Appendix GG: Drain In CLIs And Batch Jobs

A CLI that processes a batch of items should drain on Ctrl+C:

```go
ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt)
defer cancel()

for _, item := range items {
	if ctx.Err() != nil {
		break
	}
	processItem(ctx, item)
}
log.Printf("processed %d of %d items", processed, len(items))
```

A graceful CLI exit at Ctrl+C:

- Stops at the next item.
- Logs progress.
- Returns a non-zero exit code (1, conventional for user interrupt).

A batch job runner (e.g., a cron job) should:

- Drain on `SIGTERM`.
- Mark the partial result so the next run can resume.
- Exit cleanly.

---

## Appendix HH: Drain Cargo Cult

Some teams add drain code without understanding it. Signs of cargo cult drain:

- Drain functions that return immediately.
- Signal handlers that just call `os.Exit`.
- WaitGroups with no actual goroutines.
- Context deadlines on operations that never check the context.

Why it happens: copy-paste from another codebase, no testing under drain.

Cure: a drain test in CI. Cargo cult drain fails the test.

---

## Appendix II: Drain In Library Code

If you write a library that internally manages goroutines, expose drain:

```go
type Client struct{ /* ... */ }

func NewClient(opts ...Option) *Client { /* no goroutines yet */ }
func (c *Client) Start(ctx context.Context) error { /* spawn */ }
func (c *Client) Drain(ctx context.Context) error { /* drain */ }
```

Document semantics in package doc comments. Specify thread-safety, contract for repeated calls, what happens on context expiry.

A library that hides goroutines without drain is a library that cannot be used in production safely.

---

## Appendix JJ: Drain Edge Cases In Real Libraries

Cases worth knowing:

- `database/sql`: `db.Close()` blocks until all in-use connections are returned. Combined with hung queries, this can hang forever. Mitigation: kill long queries first (`SET statement_timeout`).
- `cloud.google.com/go/pubsub`: `subscription.Receive()` returns when the context expires. Make sure the handler also respects the context.
- `aws-sdk-go-v2`: most clients accept `context.Context`. Pass the drain context for outbound calls.
- `redis/go-redis`: `client.Close()` is non-blocking; connections in use will error on next use. Watch your error handling.

Spend time learning the drain semantics of every library in your stack. It pays off.

---

## Appendix KK: Drain In gRPC Streaming

gRPC streaming RPCs are the trickiest to drain. The handler is a long-lived function reading and writing to a stream. Drain:

```go
func (s *Server) BigStream(in pb.Service_BigStreamServer) error {
	ctx := in.Context()
	for {
		select {
		case <-ctx.Done():
			return status.FromContextError(ctx.Err()).Err()
		default:
		}
		msg, err := in.Recv()
		if err == io.EOF {
			return nil
		}
		if err != nil {
			return err
		}
		if err := s.process(ctx, msg); err != nil {
			return err
		}
	}
}
```

On `GracefulStop`, the stream context is cancelled. The handler sees `ctx.Done` and returns. Client receives the error.

For sending streams:

```go
func (s *Server) Stream(req *pb.Req, out pb.Service_StreamServer) error {
	ctx := out.Context()
	for evt := range s.events(ctx) {
		select {
		case <-ctx.Done():
			return status.FromContextError(ctx.Err()).Err()
		default:
		}
		if err := out.Send(evt); err != nil {
			return err
		}
	}
	return nil
}
```

The `events` channel must also respect cancellation. Otherwise the goroutine producing events leaks.

---

## Appendix LL: Drain Under Test

Some `go test` integration tests share the binary's drain logic. Patterns:

```go
func TestServer(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	srv := NewServer()
	go srv.Run(ctx)

	t.Cleanup(func() {
		dctx, dcancel := context.WithTimeout(context.Background(), time.Second)
		defer dcancel()
		_ = srv.Drain(dctx)
	})

	// ... run test ...
}
```

`t.Cleanup` ensures the server drains even if the test fails. Drain in test is short (1 second is plenty).

---

## Appendix MM: Drain Profiling

Production drain can be profiled with pprof. Capture a goroutine profile at the start of drain:

```go
func (s *Server) Drain(ctx context.Context) error {
	if profileDrain {
		f, _ := os.Create("/tmp/drain-start.pb.gz")
		_ = pprof.Lookup("goroutine").WriteTo(f, 0)
		f.Close()
	}
	// ... drain logic
}
```

Then a second profile at the end. Diff them. Any goroutines that survived the drain are visible.

Useful as a one-shot debug tool, not a routine production setting (writes /tmp each drain).

---

## Appendix NN: Drain Versus Reload

`SIGHUP` is sometimes used for config reload. Some systems also use it for "drain then restart." Be explicit about which:

```go
hup := make(chan os.Signal, 1)
signal.Notify(hup, syscall.SIGHUP)
for range hup {
	if err := svc.Reload(); err != nil {
		log.Printf("reload: %v", err)
	}
}
```

Document the contract. Operators must know if `SIGHUP` reloads or drains.

---

## Appendix OO: Drain Across Cloud Boundaries

A service deployed across cloud regions has cross-region drain considerations:

- Inter-region latency adds to drain time for cross-region calls.
- Regional failover during drain is complex.
- Multi-region distributed locks need careful release order.

Senior engineers think about these for multi-region services. Single-region drain is the simpler case.

---

## Appendix PP: Drain And Disaster Recovery

Drain is part of disaster recovery (DR). During a region failure:

- Other regions take over.
- The failing region's pods may drain "to the void" (no successor).
- Local state may be lost.

DR planning accounts for un-cleanly drained pods. Replicas, snapshots, and idempotent processing are the back-stops.

A drain pattern that works in normal operation may not work in DR. Test both.

---

## Appendix QQ: Drain And Schedule

Some services schedule drains proactively (e.g., for daily restarts to mitigate memory leaks). The pattern:

```go
go func() {
	for range time.Tick(24 * time.Hour) {
		cancel() // trigger drain and exit
		return
	}
}()
```

The orchestrator restarts the pod. Memory resets.

Better: fix the memory leak. But scheduled restart is a valid mitigation while the fix is in flight.

---

## Appendix RR: Drain And Auditing

Some compliance regimes require audit logs for shutdown. Drain logs serve this purpose:

```text
2026-05-15T03:14:15Z drain_started user=system reason=SIGTERM
2026-05-15T03:14:18Z drain_complete duration=3.2s force_cancelled=0
```

Make these logs immutable (write to a separate audit log destination). Auditors can reconstruct shutdown timeline post-incident.

---

## Appendix SS: Drain And Security

Security considerations:

- Drain logs may contain PII; sanitise before storing.
- A drain that flushes sensitive state to disk may violate compliance.
- A draining pod that still serves health checks is more discoverable than one that does not.

Audit drain code for security as carefully as any other code. The same data-handling rules apply.

---

## Appendix TT: A Senior Engineer's Reading List

For deeper mastery beyond this page:

1. The `net/http.Server.Shutdown` source code.
2. `golang.org/x/sync/errgroup` source.
3. `grpc-go.Server.GracefulStop` source.
4. Kubernetes documentation on pod lifecycle, particularly `terminationGracePeriodSeconds`, `preStop`, and `PodDisruptionBudget`.
5. Erlang/OTP documentation on supervisor strategies (it shaped the design space).
6. The book "Designing Data-Intensive Applications" (Kleppmann) — chapter on shutdown and recovery.
7. Heroku's documentation on dyno shutdown (the original 30-second grace period precedent).
8. Site Reliability Engineering (the Google SRE book) — chapters on rollouts and capacity.

Allocate one weekend to read each in depth. The mental model that emerges informs every design decision afterward.

---

## Appendix UU: Drain As An Architectural Litmus Test

"Can this service drain in 25 seconds?" is a litmus test for architecture. If the answer is "I don't know" or "probably not," the architecture has problems:

- Too much in-flight state.
- Too long handlers.
- Too much coupling to slow downstreams.
- No clear ownership of goroutines.

Use the litmus test in design reviews. A "no" forces refactoring before code is written.

---

## Appendix VV: Drain As A Recruiting Signal

When interviewing Go engineers for production roles, drain questions are signal-rich:

- Asking "how would you stop this service cleanly?" reveals whether they have shipped Go to production.
- Following up with "how would you bound the wait?" reveals deadline awareness.
- "What if a worker is hung?" reveals understanding of force-cancellation.
- "What if a downstream call exceeds the drain budget?" reveals system-level thinking.

A candidate who can answer all four with specifics has built production Go services. The questions are short; the signal is high.

---

## Appendix WW: Drain Documentation

Each component's drain semantics should be documented in code:

```go
// Drain stops the worker pool and waits for in-flight jobs to complete.
//
// Drain semantics:
//   - After Drain is called, Submit returns ErrDrain.
//   - In-flight jobs see ctx cancellation when ctx expires.
//   - Drain blocks until either all workers exit or ctx expires.
//   - Drain returns nil on clean completion, ctx.Err() on timeout.
//   - Drain is safe to call exactly once. A second call returns nil
//     and does nothing.
//
// Typical caller pattern:
//
//	dctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
//	defer cancel()
//	if err := pool.Drain(dctx); err != nil {
//	    log.Printf("pool drain: %v", err)
//	}
func (p *Pool) Drain(ctx context.Context) error { /* ... */ }
```

Five sentences. Saves hours of reading source code.

---

## Appendix XX: Drain Glossary For Senior Conversations

| Term | Senior-level meaning |
|------|---------------------|
| Drain budget | Total wall-clock allowed for drain; less than grace period. |
| Quiesce period | Pre-drain hint window for biasing toward completion. |
| Propagation sleep | Time for LB to notice readiness change. |
| Force-cancel | Cancelling in-flight on deadline expiry. |
| Drain DAG | Dependency graph for drain ordering. |
| Drain skew | Variance in drain duration across pods. |
| Drain budget violation | Drain duration > grace period. |
| Cascade cancel | One drain triggering another, recursively. |
| Drain-aware library | Library that exposes Drain(ctx). |
| Drain audit | Walkthrough of all goroutines and their exit paths. |

Use this vocabulary in design docs and post-mortems. Shared vocabulary speeds up discussion.

---

## Appendix YY: The Senior Drain Lifecycle

A senior engineer's drain work follows a cycle:

1. **Design.** Sketch drain in the system design doc.
2. **Build.** Implement Drain in each component.
3. **Test.** Drain test in CI, plus integration test.
4. **Deploy.** Watch metrics for the first 100 deploys.
5. **Monitor.** Long-term metrics dashboard.
6. **Refine.** Tune budgets, add quiesce, etc., based on data.
7. **Mentor.** Teach the team the patterns.
8. **Audit.** Annual drain audit of the service.

This cycle is ongoing. A service that has not had a drain audit in 18 months has probably drifted.

---

## Appendix ZZ: Final Senior Words

Drain is the discipline of leaving cleanly. In Go, it is enabled by a handful of primitives (`context`, `WaitGroup`, `errgroup`, `signal`) and a few patterns (`Drainable`, `Lifecycle`, `Supervisor`). The senior craft is in combining these into systems where drain is invisible, uniform, and reliable.

A senior engineer's contribution to drain is not the code — anyone can write the code after reading this page. It is the *culture*: ensuring drain is treated as a first-class concern in design, code review, testing, and ops. A team with this culture deploys without fear. A team without it has a quarterly post-mortem about a deploy that broke production.

Build the culture. The code follows.

---

## Appendix AAA: Drain in Multi-Component Pipelines

A pipeline like ingest → parse → enrich → publish has multiple stages, each with its own goroutines and channels. Drain must walk the pipeline cleanly.

### Naïve approach

```go
ingest := startIngest(ctx)
parsed := startParse(ctx, ingest)
enriched := startEnrich(ctx, parsed)
publish := startPublish(ctx, enriched)
```

Each `start` returns a channel. When `ctx` cancels, each stage should close its output.

```go
func startStage(ctx context.Context, in <-chan T) <-chan U {
	out := make(chan U)
	go func() {
		defer close(out)
		for {
			select {
			case <-ctx.Done():
				return
			case v, ok := <-in:
				if !ok {
					return
				}
				select {
				case <-ctx.Done():
					return
				case out <- transform(v):
				}
			}
		}
	}()
	return out
}
```

On drain:

1. `ctx` is cancelled.
2. The ingest stage sees it, closes its output.
3. Parse sees closed input, drains remaining items, closes its output.
4. Cascade continues to publish.

This is "drain by cascade." Each stage's drain is triggered by upstream closure or context cancel.

### Wait-for-drain barrier

Sometimes you want to *wait* for the pipeline to be empty, not just signal cancel. Add a barrier:

```go
type Pipeline struct {
	stages []func(context.Context) error
	wg     sync.WaitGroup
}

func (p *Pipeline) Run(ctx context.Context) {
	for _, s := range p.stages {
		s := s
		p.wg.Add(1)
		go func() { defer p.wg.Done(); _ = s(ctx) }()
	}
}

func (p *Pipeline) Drain(ctx context.Context) error {
	// Signal cancel happens via ctx in the caller.
	done := make(chan struct{})
	go func() { p.wg.Wait(); close(done) }()
	select {
	case <-done:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}
```

Pipeline drain blocks until all stages have exited. The drain context bounds the wait.

### Backpressure during drain

If the publish stage is slow, the pipeline backs up during drain. With a bounded drain budget, the slowest stage limits throughput.

Mitigation: increase stage buffer sizes; or drop backlog at drain.

```go
case out <- transform(v):
case <-ctx.Done():
	// drop and exit
	return
}
```

Choose based on consequences. Dropping is fine for some workloads (analytics events); fatal for others (payment events).

---

## Appendix BBB: Drain in Pub/Sub Hubs

A pub/sub hub broadcasts to many subscribers. Drain interacts:

```go
type Hub struct {
	mu   sync.RWMutex
	subs map[chan<- Event]struct{}
}

func (h *Hub) Subscribe() (<-chan Event, func()) {
	ch := make(chan Event, 16)
	h.mu.Lock()
	h.subs[ch] = struct{}{}
	h.mu.Unlock()
	return ch, func() {
		h.mu.Lock()
		delete(h.subs, ch)
		h.mu.Unlock()
		close(ch)
	}
}

func (h *Hub) Publish(e Event) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	for ch := range h.subs {
		select {
		case ch <- e:
		default:
			// drop on full
		}
	}
}

func (h *Hub) Drain(ctx context.Context) error {
	h.mu.Lock()
	defer h.mu.Unlock()
	for ch := range h.subs {
		close(ch)
	}
	h.subs = nil
	return nil
}
```

Each subscriber sees the channel close and exits. Hub drain is fast (just closes all channels).

The subscriber-side drain is the harder part: the subscriber must handle the closed channel and exit cleanly.

---

## Appendix CCC: Drain in Custom Schedulers

A custom scheduler (cron-like, with priority queues) needs drain that respects scheduling semantics:

- Do not start a job whose start time falls within the drain window.
- Let started jobs run to completion or to deadline.

```go
type Scheduler struct {
	jobs sync.Map // map[string]*Job
	wg   sync.WaitGroup
	draining atomic.Bool
}

func (s *Scheduler) Tick(now time.Time) {
	if s.draining.Load() {
		return
	}
	s.jobs.Range(func(k, v any) bool {
		j := v.(*Job)
		if j.ShouldRun(now) {
			s.wg.Add(1)
			go func() { defer s.wg.Done(); j.Run() }()
		}
		return true
	})
}

func (s *Scheduler) Drain(ctx context.Context) error {
	s.draining.Store(true)
	done := make(chan struct{})
	go func() { s.wg.Wait(); close(done) }()
	select {
	case <-done:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}
```

The pattern is the same as the worker pool drain. The scheduling layer adds the "do not start new jobs" gate.

---

## Appendix DDD: Drain in In-Memory State Machines

A state machine with internal events:

```go
type Machine struct {
	state    atomic.Value
	events   chan Event
	wg       sync.WaitGroup
	draining atomic.Bool
}

func (m *Machine) Run(ctx context.Context) {
	m.wg.Add(1)
	defer m.wg.Done()
	for {
		select {
		case <-ctx.Done():
			return
		case e, ok := <-m.events:
			if !ok {
				return
			}
			m.handle(e)
		}
	}
}

func (m *Machine) Send(e Event) error {
	if m.draining.Load() {
		return errors.New("draining")
	}
	m.events <- e
	return nil
}

func (m *Machine) Drain(ctx context.Context) error {
	m.draining.Store(true)
	close(m.events)
	done := make(chan struct{})
	go func() { m.wg.Wait(); close(done) }()
	select {
	case <-done:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}
```

The drain closes the event channel; the run loop drains remaining events and exits. State at drain end is the final state; persist it.

---

## Appendix EEE: Drain and Pre-Allocated Buffers

A service that pre-allocates buffers (object pools, slab allocators) should release them on drain:

```go
type BufferPool struct {
	pool sync.Pool
}

func (b *BufferPool) Get() *Buffer { return b.pool.Get().(*Buffer) }
func (b *BufferPool) Put(buf *Buffer) { b.pool.Put(buf) }
```

`sync.Pool` is not drainable in the traditional sense — it does not own goroutines. But during drain, you may want to free the underlying memory aggressively. Replace the pool:

```go
func (b *BufferPool) Drain() {
	b.pool = sync.Pool{New: func() any { return new(Buffer) }}
	runtime.GC()
}
```

This is a minor optimisation. Useful for memory-constrained pods.

---

## Appendix FFF: Drain And Garbage Collection Tuning

Drain may produce a lot of garbage briefly:

- Closed channels.
- Cancelled contexts.
- Released goroutines' stacks.

The GC handles this, but spikes can affect drain time. Mitigations:

- Tune `GOGC` lower during drain (more aggressive collection).
- Avoid large allocations during drain.
- Pre-warm caches so drain has steady-state working set.

These are micro-optimisations. Most services do not need them.

---

## Appendix GGG: Drain And Tracing

A drain span in a trace looks like:

```text
drain (3.2s)
├── readiness-flip (10ms)
├── propagation-sleep (2.0s)
├── http-shutdown (200ms)
├── pool-drain (800ms)
│   ├── worker-1-exit (700ms)
│   ├── worker-2-exit (750ms)
│   └── worker-3-exit (790ms)
├── kafka-flush (150ms)
└── db-close (50ms)
```

The slowest sub-span dominates. The trace UI makes this obvious.

For OpenTelemetry:

```go
ctx, span := tracer.Start(ctx, "drain")
defer span.End()

ctx2, sub := tracer.Start(ctx, "http")
err := srv.Shutdown(ctx2)
sub.End()
if err != nil { sub.RecordError(err) }
```

Wire all drains through the tracer. The trace becomes a debugging tool.

---

## Appendix HHH: Drain Standards Across Industry

Some industry-standard drain primitives:

- **HTTP/2 GOAWAY.** Signals "no new streams."
- **gRPC GOAWAY.** Same.
- **AMQP `basic.cancel`.** Cancel a subscription.
- **Kafka `unsubscribe`.** Release partition assignment.
- **Redis `CLIENT PAUSE`.** Pause client commands.

These are protocol-level drain primitives. They tell the other side "I am winding down." The senior engineer chooses application drain logic that uses these where possible.

---

## Appendix III: Drain In Mixed-Language Stacks

A service with mixed Go and Python (e.g., Go API gateway calling Python ML service):

- Go drain follows Go patterns.
- Python drain follows its own patterns (signal handlers, FastAPI lifespans, etc.).
- Both share the orchestrator's grace period.

Coordination:

- Each language's drain is independent.
- The orchestrator manages overall timing.
- Cross-language drain is rare and complex; usually best avoided.

If you must coordinate (e.g., Go must wait for Python before exiting), use a control channel (queue, file lock, etcd lease).

---

## Appendix JJJ: Drain In Test Frameworks

Test frameworks often start servers for integration tests. They must drain cleanly between tests:

```go
func TestMain(m *testing.M) {
	srv := startTestServer()
	code := m.Run()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = srv.Shutdown(ctx)
	os.Exit(code)
}
```

`os.Exit` in `TestMain` is standard. The server drains cleanly first.

For parallel tests, each test's setup/teardown must drain:

```go
t.Cleanup(func() {
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	_ = svc.Drain(ctx)
})
```

A leaked goroutine between tests poisons subsequent tests.

---

## Appendix KKK: Drain Vs Restart

Some services prefer "kill and restart" over drain:

- Faster (no wait).
- Simpler (no drain code).
- Acceptable if work is idempotent and infrequent.

Use cases:

- Internal batch jobs.
- Read-only proxies.
- Stateless transformations.

For these, document explicitly that drain is not implemented. Future engineers should not "fix" the missing drain; it is intentional.

---

## Appendix LLL: Drain Vs Hot Swap

A hot swap replaces a running binary without restart:

- Old version drains via signal.
- New version starts on the same port.
- File descriptor is passed via fork.

Tools: `goji/graceful`, `cloudflare/tableflip`. Hot swap is rare in container environments; more common in bare-metal deployments.

Drain semantics are the same: the old process must drain in-flight before exiting.

---

## Appendix MMM: Drain in DDD-Aware Services

Domain-Driven Design treats long-running aggregates carefully. Drain interacts:

- An aggregate that owns goroutines must drain them.
- Drain order should respect aggregate boundaries.
- Cross-aggregate transactions need careful drain ordering.

In practice, DDD does not change drain mechanics; it changes how you organise the code. Each aggregate becomes a Drainable.

---

## Appendix NNN: Drain Anti-Patterns At Senior Level (Extended)

Beyond the basic anti-patterns, senior-level mistakes:

### Anti-pattern: Drain leaks across release boundaries

A drain that depends on a specific library version. Upgrading the library breaks drain.

Mitigation: integration test on every dependency upgrade.

### Anti-pattern: Drain skipped in dev environment

Production drains carefully; dev pods are killed instantly. Engineers never see drain failures locally.

Mitigation: make local stack drain the same way production does.

### Anti-pattern: Drain "good enough" never revisited

The initial drain implementation works. Years pass. Service evolves. Drain doesn't.

Mitigation: annual drain audit.

### Anti-pattern: Drain code in shared utility, no owner

A central "drain helper" used by all services. When it breaks, every service breaks. No owner.

Mitigation: each service tests its own drain end-to-end.

### Anti-pattern: Drain logging silenced because "too noisy"

Drain logs were silenced to clean up the log stream. Now drain failures are invisible.

Mitigation: drain logs are mandatory; structured them for filtering.

---

## Appendix OOO: Drain in Build Automation

CI/CD pipelines test drain:

- Build: compile binary.
- Unit test: drain unit tests run.
- Integration: spin up service, run synthetic load, kill -TERM, verify clean exit.
- Soak: run for hours, multiple drain cycles.

A build that fails the integration drain test does not deploy. This is the operational forcing function.

---

## Appendix PPP: Drain in Performance Tests

Performance tests should include drain:

- What is the drain time at peak load?
- How does drain time scale with load?
- Are there metrics regressions during drain?

Profile drain under load. Real bottlenecks emerge that quiet tests miss.

---

## Appendix QQQ: Drain Curriculum For The Team

Teach drain in three sessions:

1. (90 min) Junior session: the recipe, signal handling, a worker pool drain. Pair-program.
2. (90 min) Middle session: HTTP, gRPC, queue consumers, errgroup, composition.
3. (90 min) Senior session: architecture, supervisor, two-phase, audit, mentorship.

Repeat annually for new hires. The team's drain literacy is a moat against incidents.

---

## Appendix RRR: Drain as Engineering Maturity Indicator

A team's drain code reflects its engineering maturity:

- **No drain.** Early stage, optimising for shipping.
- **Ad-hoc drain.** Started thinking about reliability.
- **Per-service patterns.** Each team owns its drain.
- **Org-wide patterns.** Shared libraries; consistent.
- **Drain invisible.** Framework handles it; engineers never write drain code.

Moving up the ladder takes years. Drain quality is a leading indicator of overall engineering quality.

---

## Appendix SSS: A Drain Conversation With Leadership

Leadership wants to know: "Is drain a problem?" A senior engineer answers with data:

- "Our drain P99 across all services is 4.2s. Grace period is 30s. We have 7x safety margin."
- "We had two drain incidents in the last quarter, both root-caused and fixed."
- "Drain tests run on every PR; failure rate is 0.5%, all caught in CI."

Concrete numbers carry more weight than narrative. Build the dashboards; share them.

---

## Appendix TTT: Drain And Cost Centers

In larger orgs, drain time impacts deploy duration, which impacts engineering productivity, which impacts cost. A rough model:

- 100 deploys/day across the org.
- Each deploy ties up 1 engineer for 10 min (waiting for the deploy).
- Drain accounts for 30% of deploy time.
- Total: 30 min/day of engineer time on drain wait.

For a 50-engineer team, that is 25 hours/week. A drain optimisation that cuts drain time in half saves 12 hours/week. That funds a quarter of an engineer.

Senior engineers connect drain to business value. It funds the investment.

---

## Appendix UUU: A Long Closing Thought

Drain is one of the small disciplines that compound. A team that drains well deploys more. Deploying more reduces the deploy size. Smaller deploys have fewer bugs. Fewer bugs means less firefighting. Less firefighting means more design time. More design time means better architecture. Better architecture is easier to drain. The flywheel.

A team that drains poorly is on the opposite flywheel. Each deploy is risky, so deploys are rare. Rare deploys accumulate changes, so each deploy is bigger. Bigger deploys have more bugs. More bugs means more firefighting. Less design time. Worse architecture. Harder to drain. The death spiral.

The choice between these two flywheels is daily. The drain pattern is one of the levers that flips you to the good flywheel. Pull the lever.

---

## Appendix VVV: A Senior-Level Drain Manifesto

Ten statements that summarise the senior view:

1. Drain is infrastructure, not a feature.
2. Drain is invisible when designed well.
3. Every long-lived goroutine has an owner with a Drain method.
4. Every Drain takes a context and returns an error.
5. Drain order follows reverse construction.
6. Drain budget is allocated, measured, and tuned.
7. Drain tests are non-negotiable.
8. Drain metrics are first-class.
9. Drain failures are post-mortemed.
10. Drain quality is a team's engineering maturity indicator.

Tape this to a wall. Refer back when designing new services.

---

## Appendix WWW: Drain Is Almost Done

If you have read this entire page, you have absorbed roughly two days' worth of senior drain wisdom. The professional page extends one specific scenario (Kafka with exactly-once) to even more depth. The remaining files (specification, interview, tasks, find-bug, optimize) round out the topic with reference material and practice.

Drain is one of those patterns that seems obvious in retrospect but takes years to internalise. The investment is worth it. Every service you ship that drains cleanly is a vote against late-night pages and angry customer support tickets.

Welcome to senior-level drain. The patterns are yours now. Use them.

---

## Appendix XXX: Drain In Specific Frameworks

A walkthrough of drain support in popular Go frameworks.

### `gin`

Gin is built on `net/http`. Drain is via `http.Server.Shutdown`:

```go
r := gin.Default()
r.GET("/work", workHandler)
srv := &http.Server{Addr: ":8080", Handler: r}
go srv.ListenAndServe()
// drain:
srv.Shutdown(drainCtx)
```

No special integration needed.

### `echo`

`echo.Echo` exposes `Shutdown(ctx)`:

```go
e := echo.New()
e.GET("/work", workHandler)
go e.Start(":8080")
// drain:
e.Shutdown(drainCtx)
```

### `fiber`

`fiber.App` exposes `Shutdown` (no context):

```go
app := fiber.New()
app.Get("/work", workHandler)
go app.Listen(":8080")
// drain:
app.Shutdown()
```

The lack of a context parameter is awkward. Wrap it:

```go
func shutdownWithCtx(app *fiber.App, ctx context.Context) error {
	done := make(chan error, 1)
	go func() { done <- app.Shutdown() }()
	select {
	case err := <-done:
		return err
	case <-ctx.Done():
		return ctx.Err()
	}
}
```

### `chi`

Chi is also `net/http`-based. Same `Server.Shutdown` as the stdlib.

### `kratos`

`kratos` (Bilibili's framework) has an `App` with `Start`/`Stop`. Both take context.

### `go-zero`

`go-zero` has a `rest.Server` with `Stop`. Wrap for context if needed.

The lesson: most frameworks expose a `Shutdown` or `Stop`. Adapt to the standard `Drain(ctx) error` shape in your wiring layer.

---

## Appendix YYY: Drain In Cloud Functions

Serverless functions (Cloud Functions, Lambda, Azure Functions) have their own lifecycle:

- A function invocation has a strict timeout (e.g., 540s on GCP).
- Cold start vs warm start affects available time.
- Drain is mostly handled by the platform.

For Go on serverless:

- Use the runtime's context, which has the deadline.
- Defer flush operations (logs, metrics).
- Return cleanly; don't `os.Exit`.

Drain at the function level is short-lived. The pattern is similar but the scale is smaller.

---

## Appendix ZZZ: Drain In Edge Workers

Edge platforms (Cloudflare Workers, Fastly Compute) run code at the edge. Drain semantics differ:

- Each request is isolated (V8 isolate or WASM module).
- No persistent process.
- No traditional drain.

For Go compiled to WASM running on edge, the drain pattern translates differently. Per-invocation finalisers replace process drain.

This is a niche; relevant for the senior engineer building cross-platform systems.

---

## Appendix AAAA: Drain In Embedded Go

Go on embedded systems (TinyGo on microcontrollers) lacks `os/signal`. Drain is via hardware interrupts:

```go
go func() {
	for range buttonInterrupt {
		drain()
	}
}()
```

Drain semantics are simpler (no LB, no orchestrator) but the discipline is the same: stop intake, wait, close.

---

## Appendix BBBB: Drain In Custom Build Of Go

Some teams build their own Go runtime with drain-aware features:

- Custom scheduler that drains goroutines on shutdown.
- Custom GC that runs once at drain.
- Custom signal handling.

These are exotic; most teams use stock Go. But knowing they exist is useful when evaluating very high-performance systems.

---

## Appendix CCCC: Drain Vocabulary Across Cloud Providers

- **AWS Auto Scaling:** "Lifecycle hooks" for graceful drain.
- **GCP:** "Preemption notice" 30 seconds before shutdown.
- **Azure VMSS:** "Termination notification" via metadata endpoint.
- **Kubernetes:** `terminationGracePeriodSeconds`, `preStop` hook.
- **Nomad:** `kill_timeout` per task.
- **ECS:** `stopTimeout` per task definition.

Each platform exposes drain time differently. Senior engineers know the values for their stack.

---

## Appendix DDDD: Drain Across The Org Maturity Curve

A startup might skip drain initially. As the company grows:

- 1-10 engineers: drain often optional.
- 10-50: drain becomes important; one or two incidents.
- 50-200: standard patterns emerge; shared libraries.
- 200+: frameworks abstract drain entirely.

If your team is in the early stages, invest in drain *before* you hit the inflection point. Retrofitting drain is harder than greenfielding it.

---

## Appendix EEEE: Drain And API Evolution

Adding drain to an existing API:

- Add `Drain(ctx) error` to your interface.
- Default implementation: nil. Components opt-in.
- Compatibility tests verify old callers still work.

Removing drain:

- Deprecate the method.
- Migrate all callers.
- Remove after a release.

Drain is one of those features that, once added, is hard to remove. Plan accordingly.

---

## Appendix FFFF: Drain Patterns Across Time

A 10-year history of Go drain patterns:

- 2012: ad-hoc. `os.Exit(0)` was common.
- 2014: `http.Server.Close` introduced (hard stop).
- 2016: `http.Server.Shutdown` introduced (graceful).
- 2018: `context` becomes ubiquitous; drain follows.
- 2021: `signal.NotifyContext` adds convenience.
- 2024: drain is mainstream; `errgroup` patterns are common.

The trajectory: drain has gotten easier and more standardised. Modern Go is drain-friendly by default.

---

## Appendix GGGG: A Senior-Level Drain Diagram

```text
   Orchestrator (k8s, ECS, etc.)
              |
              | SIGTERM
              v
        +-----+-----+
        |  main()   |
        +-----+-----+
              |
              | Signal Context
              v
   +----------+----------+
   |   Supervisor        |
   |   (orchestrates)    |
   +----------+----------+
              |
              | Calls Drain on each component
              v
   +----------+----------+----------+
   |  HTTP    |  Workers |  Stores  |
   |          |          |          |
   +----------+----------+----------+
              ^
              |
        Drain Order (reverse construction)
        Stores last; HTTP first
```

A senior engineer can sketch this from memory for any service.

---

## Appendix HHHH: Drain Deep Dive — A Single Component

Let us deep-dive into a single component: the worker pool.

### Design goals

- Accept Submit calls during normal operation.
- Reject Submit calls after Drain starts.
- Process queued jobs during drain.
- Bound the wait by context deadline.
- Goroutine-leak-free.

### Implementation

```go
type Pool struct {
	queue    chan Job
	wg       sync.WaitGroup
	draining atomic.Bool
	mu       sync.Mutex
	closed   atomic.Bool
}

func NewPool(buf int) *Pool {
	return &Pool{queue: make(chan Job, buf)}
}

func (p *Pool) Start(ctx context.Context, n int) {
	for i := 0; i < n; i++ {
		p.wg.Add(1)
		go p.run(ctx)
	}
}

func (p *Pool) run(ctx context.Context) {
	defer p.wg.Done()
	defer func() {
		if r := recover(); r != nil {
			log.Printf("worker panic: %v", r)
		}
	}()
	for {
		select {
		case <-ctx.Done():
			return
		case j, ok := <-p.queue:
			if !ok {
				return
			}
			p.process(ctx, j)
		}
	}
}

func (p *Pool) Submit(j Job) error {
	if p.draining.Load() {
		return errors.New("pool draining")
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.draining.Load() {
		return errors.New("pool draining")
	}
	p.queue <- j
	return nil
}

func (p *Pool) Drain(ctx context.Context) error {
	p.mu.Lock()
	if p.draining.CompareAndSwap(false, true) {
		close(p.queue)
		p.closed.Store(true)
	}
	p.mu.Unlock()
	done := make(chan struct{})
	go func() {
		p.wg.Wait()
		close(done)
	}()
	select {
	case <-done:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}
```

### Test plan

Five tests:

1. Empty pool drains in <10ms.
2. Pool with in-flight job drains after job completes.
3. Pool with hung job drains at deadline.
4. Submit after Drain returns error.
5. Double Drain is safe.

```go
func TestPoolDrainEmpty(t *testing.T) {
	p := NewPool(8)
	p.Start(context.Background(), 4)
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	if err := p.Drain(ctx); err != nil {
		t.Fatalf("drain: %v", err)
	}
}

func TestPoolDrainInFlight(t *testing.T) {
	p := NewPool(8)
	p.Start(context.Background(), 1)
	finished := make(chan struct{})
	p.process = func(ctx context.Context, j Job) {
		time.Sleep(50 * time.Millisecond)
		close(finished)
	}
	_ = p.Submit(Job{})
	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()
	_ = p.Drain(ctx)
	select {
	case <-finished:
	default:
		t.Fatal("in-flight did not finish")
	}
}

// ... similar tests for the others
```

### Operational considerations

- Log Submit rejections during drain (informational).
- Emit metric for queue length at drain start.
- Emit metric for drain duration.
- Alert if drain force-cancels.

A single component, ~80 lines of code, ~150 lines of tests. The discipline scales.

---

## Appendix IIII: A Last Note On Style

Drain code should be boring. No clever tricks. No obscure goroutine patterns. The most senior drain code is the most readable.

If a junior engineer reads your drain code and asks "why?", the comment should answer in plain English. Not "for performance" — explain *what* and *why*.

A senior engineer writes for the next senior engineer. Drain is one of those areas where future-you will thank present-you for clarity.

Boring drain code is good drain code.

---

## Appendix JJJJ: Closing Final Words For Senior

You have now read more about drain than 99% of Go developers ever will. The patterns, the architecture, the trade-offs, the failure modes, the testing strategies — all here.

The senior-level work, though, is not in the patterns. It is in the *discipline* of applying them consistently, in the *judgement* of when to bend them, in the *teaching* that brings the rest of the team along.

That work is done in conversations, code reviews, design docs, and incident post-mortems — not in any single file. This page provides the vocabulary. The application is yours.

Move on to professional.md to see drain in its most demanding setting: Kafka consumer rebalances with exactly-once semantics, where every detail matters and the cost of a miss is duplicate financial transactions in production.

---

## Appendix KKKK: Drain And Capacity Forecasting

A drain that takes 25 seconds across 100 pods, deployed serially, takes 42 minutes. Parallelism reduces this. The math:

- Sequential: N * (drain + startup) = total deploy time.
- Parallel of P: N/P * (drain + startup) = total.
- Capacity hit during deploy: P / N pods worth.

Choose P based on capacity headroom. If the cluster runs at 80%, P/N must keep total below 100%.

Forecast deploy time for next quarter as the service grows. If N triples, deploy time triples (unless P scales). Plan accordingly.

---

## Appendix LLLL: Drain And Multi-Region

For a multi-region service:

- Each region drains independently.
- Cross-region traffic is rerouted by DNS or anycast.
- Failover handling during drain is asymmetric (the draining region cannot accept failover load).

Best practices:

- Drain one region at a time during planned maintenance.
- Use canary deploys per region.
- Monitor cross-region latency during drain (a region in drain should not send work to itself).

The senior engineer thinks about region affinity in drain.

---

## Appendix MMMM: Drain And Service Levels

Drain affects SLOs:

- Availability SLO: drain that drops requests counts against it.
- Latency SLO: drain that holds requests too long counts against it.
- Error budget: drain failures eat budget.

Track drain's contribution to error budget. If drain consumes 10% of the monthly budget, optimisation is justified.

---

## Appendix NNNN: Drain And Disaster Drills

A monthly drain drill:

1. Pick a random service.
2. Trigger drain on a random pod.
3. Verify metrics: clean exit, no 5xx, drain duration normal.
4. Review the drain log.
5. Note any anomalies; file follow-up tasks.

Monthly drills catch drift. They also build muscle memory in the on-call team.

---

## Appendix OOOO: Drain Discipline Across Teams

Drain quality varies by team. Sources of variance:

- Team's seniority.
- Service age (older services have drain debt).
- Frequency of incidents (forcing function).
- Available time (newer teams skip drain).

A platform team owning shared infrastructure should:

- Publish drain standards.
- Provide drain libraries.
- Audit services quarterly.
- Score teams on drain quality.

Public visibility of drain quality drives improvement.

---

## Appendix PPPP: Drain As Recruiting

When recruiting senior Go engineers, drain questions are signal:

- Open-ended: "How would you implement graceful shutdown?"
- Specific: "How do you handle a hung worker during drain?"
- Architectural: "Walk me through drain order in a service with HTTP, workers, Kafka, DB."
- Cross-cutting: "How does drain interact with leader election?"

Candidates who answer well in 5 minutes have shipped real Go. Those who fumble — even with strong other signals — are red flags for production roles.

---

## Appendix QQQQ: A Personal Note

Drain is one of those patterns that does not look impressive. It is plumbing. It is the kind of code that, when done right, nobody notices.

The job of a senior engineer is to do exactly this kind of plumbing — well, consistently, invisibly. Drain code that gets reviewed without comment is the highest form of compliment.

Aim to write drain code that future engineers will read, nod at, and move on. That is the bar.

---

## Appendix RRRR: A Question To Carry Forward

After every PR you write, ask:

> "If this code receives `SIGTERM` right now, what happens?"

If the answer involves any of: "I'm not sure," "It probably leaks," "It depends," "We haven't tested" — there is drain work to do.

This single question, asked consistently, raises drain quality across an entire codebase over months. It costs zero effort. The return is enormous.

---

## Appendix SSSS: A Personal Drain Style Guide

My own style preferences (a senior engineer's, after years of doing this):

- Always `signal.NotifyContext`; never `signal.Notify` + manual goroutine.
- Always `context.Background()` for the drain context, not the cancelled root.
- Always `defer cancel()` for any `WithCancel`/`WithTimeout`.
- Always close channels via `sync.Once` or atomic CAS.
- Always log start and end of drain.
- Always emit a drain duration metric.
- Always write a drain test before merging.
- Always prefer "Drain" naming over "Stop" or "Shutdown."
- Never use `os.Exit` outside `main`.
- Never use `time.Sleep` longer than 100ms without context awareness.

Your style may differ. Document it; apply it consistently. Consistency matters more than the specific choices.

---

## Appendix TTTT: A Drain Manifesto Conclusion

Drain is the discipline of leaving cleanly. In Go, the primitives are simple; the discipline is hard. Senior engineers internalise the discipline so deeply that it becomes invisible — drain just *happens* in the systems they build.

If you have absorbed this page, you are well on your way to that level. The remaining gap is closed by practice: code reviews, incidents, design reviews, mentorship. None of it is mysterious; all of it takes time.

Welcome to the work. Welcome to leaving cleanly.

---

## Appendix UUUU: Senior-Level Drain Walkthroughs From Real Codebases

A few anonymised walkthroughs from real production codebases to make the principles concrete.

### Codebase A: Payment Processing Service

A Go service that accepts payment intent requests via HTTP, talks to a card-processor downstream, and emits events to Kafka. ~15k lines of code.

Drain components:

1. HTTP server.
2. Kafka producer.
3. Card-processor client (HTTP pool with retries).
4. Postgres connection pool.
5. Idempotency cache (Redis client).
6. Audit log shipper.

Drain order on `SIGTERM`:

1. Flip readiness off (immediate).
2. Sleep 3 seconds for LB propagation.
3. `srv.Shutdown(drainCtx)` — wait for HTTP handlers.
4. Wait for Kafka producer queue to empty.
5. Wait for card-processor client to complete in-flight retries.
6. Flush audit logs (sub-context with 2s deadline).
7. Close Redis client.
8. Close Postgres pool.
9. Return from `main`.

Drain budget: 25 seconds; grace period 30 seconds.

Notable details:

- Each Kafka message is acked only after the Postgres transaction commits.
- The drain waits for both Kafka ack and Postgres commit per in-flight payment.
- The audit logger uses a fresh `context.Background()` with a 2s deadline so it can flush even when the parent drain context expired.

This pattern handles ~50,000 deploys in production with zero data loss.

### Codebase B: Real-Time Analytics Pipeline

A multi-stage analytics pipeline: ingest from Kafka, parse, enrich with HTTP lookups, aggregate, publish to ClickHouse.

Drain components:

1. Kafka consumer.
2. Parser worker pool.
3. Enricher with HTTP client pool.
4. Aggregator with in-memory state.
5. ClickHouse client.

Drain order:

1. Stop Kafka consumer fetch (do not advance offsets).
2. Drain parser pool.
3. Drain enricher pool.
4. Flush aggregator state to ClickHouse.
5. Close ClickHouse client.
6. Commit final Kafka offsets.

Note the unusual order: Kafka offsets are committed *last*, after ClickHouse has confirmed receipt. This guarantees at-least-once delivery — a crash mid-flush replays from the last committed offset.

Drain budget: 60 seconds; grace period 90 seconds. Longer than typical because the aggregator may have multi-GB state to flush.

### Codebase C: WebSocket Gateway

A gateway that proxies WebSocket connections between mobile clients and backend services. ~8k lines.

Drain components:

1. HTTP server (for WebSocket upgrade).
2. Connection registry (tracks active WebSocket connections).
3. Backend gRPC client pool.

Drain order:

1. Flip readiness off.
2. Sleep 5 seconds for LB.
3. Send close frame to all active WebSockets with reason "server shutting down."
4. Wait 3 seconds for clients to disconnect.
5. Force-close remaining WebSockets.
6. `srv.Shutdown(drainCtx)` for the HTTP server.
7. Close backend gRPC clients.

Drain budget: 20 seconds. Lower because WebSockets do not survive drain cleanly; the goal is to nudge clients to reconnect to a different pod.

### Codebase D: Cron Job Runner

A service that runs scheduled tasks every minute. ~3k lines.

Drain components:

1. HTTP server (for health checks).
2. Cron scheduler.
3. Currently-running job goroutines.

Drain order:

1. Flip readiness off.
2. Stop the cron scheduler (no new triggers).
3. Wait for currently-running jobs to complete.
4. Close HTTP server.

Drain budget: 5 minutes. Jobs can take 2+ minutes; need budget for the slowest.

Notable detail: this service uses `terminationGracePeriodSeconds: 360` (6 minutes). The longer grace period reflects the longer drain. Default deploys use a different service template.

---

## Appendix VVVV: Tools That Help With Drain

A senior engineer's drain toolbox:

- **`go.uber.org/goleak`** — detect goroutine leaks in tests.
- **`golang.org/x/sync/errgroup`** — coordinate goroutines.
- **`signal.NotifyContext`** — signal to context.
- **`net/http.Server.Shutdown`** — built-in HTTP drain.
- **`pprof`** — profile goroutines during drain.
- **OpenTelemetry tracing** — instrument drain phases.
- **`vegeta` or `wrk`** — generate load for drain tests.
- **`chaosmesh`** — inject signals at random intervals.

Knowing the tools is half the battle. Choosing the right tool for the bug is the other half.

---

## Appendix WWWW: Drain Beyond Go

The patterns translate to other languages:

- **Java:** `ExecutorService.shutdown()`, `awaitTermination`, `Runtime.addShutdownHook`.
- **Python (asyncio):** `Server.close()`, `Server.wait_closed()`, signal handlers.
- **Node.js:** `server.close()`, `process.on('SIGTERM', ...)`.
- **Rust (tokio):** `tokio::signal::ctrl_c()`, structured concurrency via `JoinHandle`.
- **Elixir:** `GenServer` shutdown spec, supervisor strategies.

The vocabulary changes; the discipline does not. A senior engineer fluent in drain can apply it across stacks.

---

## Appendix XXXX: Closing The Senior Chapter

If you finish this page, take a break. Then re-read it next month, with the context of an intervening month's drain work. Different sections will jump out.

The page is meant to be referenced more than read linearly. Bookmark the appendices you found most useful. Skip those that did not click. Return to them in a year when they will click.

Drain is a deep topic. There is always more to learn. But this page should give you the working knowledge of a senior engineer who has shipped Go services to production for years.

Continue to professional.md when ready. Or take a detour through the specification, interview, tasks, find-bug, and optimize pages for reference material and practice.

Either way — congratulations on reaching senior-level drain. The work continues. The systems we ship are better for it.

---

## Appendix YYYY: An Honest Reflection On Drain Mistakes

Even senior engineers make drain mistakes. A few I have made personally:

1. **Forgot to flush the metrics collector before exit.** Production drain looked clean for a week; then someone noticed metrics gaps during deploy windows. Two-line fix; three days of confusion.

2. **Derived drain context from the cancelled root.** Drain returned instantly with `context.Canceled`. Workers force-cancelled. 30 minutes of confusion before I noticed the right line.

3. **Used `time.Sleep(5 * time.Second)` to "give workers time."** Worked in dev (workers finished in 100ms). In prod under load (P99 of 8s), 30% of in-flight workers force-cancelled.

4. **Skipped the readiness flip.** Drains were clean but every deploy had a small 5xx spike. Took weeks of dashboard-staring to correlate.

5. **Put `os.Exit(0)` in a helper function for "testing."** Forgot it; shipped. Production pod exited instantly on every signal. Caught by alert; fixed in 10 minutes.

Each of these is now a personal rule. Document your mistakes. They are the cheapest education available.

---

## Appendix ZZZZ: One Last Thing

Drain is not glamorous. It does not appear in conference talks or recruiting decks. It is the kind of work that pays off only when nothing goes wrong.

That is also why drain is a leverage point. A few weeks of investment yields years of clean deploys. A pattern adopted org-wide moves the entire engineering culture toward reliability.

The senior engineer's superpower is recognising leverage points like this and investing in them. Drain is one of the highest-leverage things you can build into your services. Build it. Document it. Mentor it. The org benefits long after you have moved on.

That is the senior chapter. Now: professional. Brace yourself for Kafka.

---

## Appendix AAAAA: Senior-Level Drain Code Patterns Library

A final compendium of code patterns to copy-paste-adapt.

### Pattern: drain-aware Submit

```go
func (s *Service) Submit(j Job) error {
	if s.draining.Load() {
		return ErrDraining
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.draining.Load() {
		return ErrDraining
	}
	s.queue <- j
	return nil
}
```

### Pattern: drain-aware Send

```go
func (p *Pipe) Send(ctx context.Context, v V) error {
	select {
	case <-ctx.Done():
		return ctx.Err()
	case p.out <- v:
		return nil
	}
}
```

### Pattern: bounded wait

```go
func waitWithDeadline(wg *sync.WaitGroup, ctx context.Context) error {
	done := make(chan struct{})
	go func() { wg.Wait(); close(done) }()
	select {
	case <-done:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}
```

### Pattern: drain order helper

```go
func drainInOrder(ctx context.Context, ds ...func(context.Context) error) {
	for i := len(ds) - 1; i >= 0; i-- {
		_ = ds[i](ctx)
	}
}
```

### Pattern: parallel drain group

```go
func drainParallel(ctx context.Context, ds ...func(context.Context) error) error {
	var eg errgroup.Group
	for _, d := range ds {
		d := d
		eg.Go(func() error { return d(ctx) })
	}
	return eg.Wait()
}
```

### Pattern: drain with budget remaining log

```go
func drainWithLog(name string, ctx context.Context, fn func(context.Context) error) {
	start := time.Now()
	rem := time.Until(deadlineOr(ctx, time.Now().Add(time.Hour)))
	log.Printf("drain %s: budget=%s", name, rem)
	err := fn(ctx)
	log.Printf("drain %s: done in %s err=%v", name, time.Since(start), err)
}

func deadlineOr(ctx context.Context, dflt time.Time) time.Time {
	if d, ok := ctx.Deadline(); ok {
		return d
	}
	return dflt
}
```

### Pattern: idempotent drain via sync.Once

```go
type Server struct {
	once    sync.Once
	drainFn func(context.Context) error
}

func (s *Server) Drain(ctx context.Context) error {
	var err error
	s.once.Do(func() {
		err = s.drainFn(ctx)
	})
	return err
}
```

### Pattern: drain hook registration

```go
type App struct {
	mu    sync.Mutex
	hooks []func(context.Context)
}

func (a *App) OnDrain(fn func(context.Context)) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.hooks = append(a.hooks, fn)
}

func (a *App) Drain(ctx context.Context) error {
	a.mu.Lock()
	hooks := append([]func(context.Context){}, a.hooks...)
	a.mu.Unlock()
	for _, h := range hooks {
		h(ctx)
	}
	return nil
}
```

### Pattern: drain status query

```go
type Drainer struct {
	state atomic.Int32 // 0=running, 1=draining, 2=drained
}

func (d *Drainer) State() string {
	switch d.state.Load() {
	case 0:
		return "running"
	case 1:
		return "draining"
	default:
		return "drained"
	}
}
```

### Pattern: drain-aware health endpoint

```go
func (a *App) Ready(w http.ResponseWriter, r *http.Request) {
	if a.drainer.State() != "running" {
		w.WriteHeader(http.StatusServiceUnavailable)
		_, _ = w.Write([]byte("draining"))
		return
	}
	w.WriteHeader(http.StatusOK)
}
```

### Pattern: graceful client retry refusal

```go
func (c *Client) Do(ctx context.Context, req *Request) (*Response, error) {
	if c.draining.Load() {
		return nil, ErrShuttingDown
	}
	return c.do(ctx, req)
}
```

### Pattern: drain metric instrumentation

```go
type Drainer struct {
	duration   prometheus.Histogram
	cancelled  prometheus.Counter
}

func (d *Drainer) Drain(ctx context.Context) error {
	start := time.Now()
	defer func() {
		d.duration.Observe(time.Since(start).Seconds())
	}()
	err := d.drain(ctx)
	if errors.Is(err, context.DeadlineExceeded) {
		d.cancelled.Inc()
	}
	return err
}
```

### Pattern: drain-aware ratelimiter

```go
type Limiter struct {
	rate      atomic.Int64
	draining  atomic.Bool
}

func (l *Limiter) Acquire() bool {
	if l.draining.Load() {
		return false
	}
	return l.rate.Add(-1) >= 0
}

func (l *Limiter) BeginDrain() {
	l.draining.Store(true)
}
```

### Pattern: drain phase logger

```go
func phase(name string, fn func() error) error {
	start := time.Now()
	err := fn()
	slog.Info("drain phase",
		"phase", name,
		"duration_ms", time.Since(start).Milliseconds(),
		"err", err,
	)
	return err
}
```

Use these as starting points. Adapt names and types to your codebase. Consistency across services is the goal.

---

## Appendix BBBBB: A Glossary For Code Review

Words to use in code review for drain-related feedback:

- "This goroutine has no exit path."
- "This `Drain` should take a context."
- "This deadline is shorter than the downstream timeout."
- "Drain should run after readiness flip."
- "This `time.Sleep` is not cancellable."
- "This channel close races with `Submit`."
- "This `wg.Wait` has no deadline."
- "This handler doesn't check `r.Context()`."
- "This `os.Exit` should be in `main`."
- "This `Drain` should be idempotent."

Short, precise feedback. Drain reviews are most effective when the language is consistent across reviewers.

---

## Appendix CCCCC: Final Senior-Level Sign-Off

If you are a senior engineer responsible for drain quality across a service or org, the sign-off looks like:

- [ ] Every long-lived component has `Drain(ctx) error`.
- [ ] Drain order documented in code or design doc.
- [ ] Drain tests in CI; failing tests block deploy.
- [ ] Drain metrics emitted; dashboards exist.
- [ ] Drain alerts configured; on-call knows them.
- [ ] Drain runbook exists; on-call has practiced.
- [ ] Drain audit cadence agreed (annual minimum).
- [ ] Drain patterns documented; new hires read them.
- [ ] Drain incidents reviewed; root causes addressed.
- [ ] Drain budget aligned with orchestrator grace period.

A team that ticks all of these is a team that ships fast and sleeps well.

Now, on to professional.md, where the rubber meets the road with Kafka.







