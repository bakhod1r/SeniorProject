---
layout: default
title: Interview
parent: When to Use a Pool
grand_parent: Goroutine Pools (3rd-party)
ancestor: Go
nav_order: 7
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/17-goroutine-pools-3rd-party/04-when-to-use/interview/
---

# When to Use a Pool — Interview Questions

35 questions on choosing the right pool, sizing it, and operating it. Grouped by level.

---

## Junior Level (Q1–Q10)

### Q1: What is a goroutine pool, and why might you use one?

**Answer.** A goroutine pool is a set of long-lived worker goroutines that pull tasks from a queue. It is used to:

1. Bound concurrency (limit how many tasks run at once).
2. Reuse workers across tasks (amortise spawn cost at very high rates).
3. Get features the standard library doesn't have (panic handler, dynamic resize, non-blocking submit).

Most workloads do not need a pool. The standard `errgroup.SetLimit` covers the common case (bounded concurrency with errors and cancellation). Pools earn their place at high spawn rates, with worker state, or for specific features.

### Q2: What's the difference between `errgroup.SetLimit(K)` and a third-party pool?

**Answer.** `errgroup.SetLimit(K)` bounds concurrency by spawning at most K goroutines at a time. Each `g.Go(...)` call spawns a fresh goroutine when below the limit, blocks when at it. A pool reuses workers; the same goroutine serves many tasks. errgroup also propagates errors and integrates with ctx; pools generally don't (without manual wiring).

For most workloads, errgroup is the right choice — fewer lines, no dependency, idiomatic. Pool wins at very high spawn rates or when worker state matters.

### Q3: When should you NOT use a pool?

**Answer.**
- When the workload is bounded by the problem (small fixed N).
- When you have errors and cancellation needs (errgroup is better).
- When tasks have unequal weight (semaphore is better).
- When you're new to concurrency (start with raw goroutines, then errgroup).
- When you can't measure a benefit over the simpler alternative.

The cardinal rule: do not adopt a pool without measurement.

### Q4: How do you bound concurrency in Go using only the standard library?

**Answer.** Several ways:

1. `errgroup.SetLimit(K)` from `golang.org/x/sync` — the standard answer.
2. `semaphore.Weighted` from `golang.org/x/sync` — when tasks have unequal weight.
3. Buffered channel as a token semaphore — older idiom, still works.

Example with channel:

```go
sem := make(chan struct{}, K)
for _, x := range xs {
	x := x
	sem <- struct{}{}
	go func() {
		defer func() { <-sem }()
		work(x)
	}()
}
```

### Q5: Why is `errgroup.SetLimit` usually preferred over a token channel?

**Answer.** It's fewer lines, integrates with ctx, propagates the first error, and is the idiomatic Go solution. Token channels were the pattern before errgroup added SetLimit; today they're rarely necessary.

### Q6: What is a "captured loop variable" bug, and how does it relate to pools?

**Answer.** In Go ≤ 1.21, loop variables are reused across iterations. A goroutine spawned inside a `for` loop sees the *current* value, not the value at spawn time:

```go
for i := 0; i < 5; i++ {
	go func() { fmt.Println(i) }()  // prints 5, 5, 5, 5, 5 in Go ≤1.21
}
```

In Go 1.22+, each iteration gets a fresh variable. For older versions, shadow:

```go
for i := 0; i < 5; i++ {
	i := i  // shadow
	go func() { fmt.Println(i) }()
}
```

This applies to any goroutine spawn — raw, errgroup, or pool. Forget it and your pool tasks see wrong values.

### Q7: What is the minimal information you need to choose a pool size K?

**Answer.** The binding constraint:

- CPU-bound: K = NumCPU.
- I/O-bound: K = target_throughput × per_task_latency (Little's Law).
- Memory-bound: K = budget / per_task_footprint.
- Downstream-bound: K = downstream's concurrency limit (divided by replica count).

Pick the smallest K that satisfies all binding constraints. Add 20% headroom.

### Q8: What does `errgroup.SetLimit(0)` do?

**Answer.** It blocks every subsequent `g.Go` call forever — no goroutines allowed. This is almost always a bug; usually K is meant to be a positive number. Confirm K is sourced correctly.

### Q9: Why do some teams use `ants` everywhere?

**Answer.** Sometimes for good reason (high spawn rate, panic handler needed, dynamic resize). Sometimes for cargo cult ("pools are good"). The professional engineer asks: was the choice measured? If no measurement, the choice is unjustified.

### Q10: What's the simplest concurrency pattern in Go?

**Answer.** Raw goroutines + WaitGroup:

```go
var wg sync.WaitGroup
for _, x := range xs {
	x := x
	wg.Add(1)
	go func() {
		defer wg.Done()
		work(x)
	}()
}
wg.Wait()
```

When you have a small fixed N, this is right. No pool, no errgroup, no library. Just goroutines.

---

## Middle Level (Q11–Q20)

### Q11: When would you use `semaphore.Weighted` instead of `errgroup.SetLimit`?

**Answer.** Three situations:

1. **Unequal task weights**: some tasks "cost" more than others. Semaphore counts weight.
2. **Cross-function bound**: many independent callers share a single bound. Semaphore lives in package scope.
3. **No fan-out shape**: you have one-off operations that need bounding but aren't a fan-out.

Errgroup wins when you have a clear fan-out with equal weights and need error propagation.

### Q12: Compare `ants`, `tunny`, and `workerpool` in one sentence each.

**Answer.**
- `ants`: high-throughput fire-and-forget pool with rich options (panic handler, dynamic resize, non-blocking).
- `tunny`: pool where each worker has its own state via a constructor; best for warm-state workloads.
- `workerpool`: minimal FIFO pool with a tiny API; easy to audit.

### Q13: When does `tunny` beat `errgroup`?

**Answer.** When each task benefits from per-worker state that is expensive to construct. Example: a PDF renderer where loading the font cache takes 200ms. With errgroup, each task pays the warmup. With tunny, K workers each load the cache once at startup; thousands of tasks reuse the warm state.

### Q14: What is Little's Law, and how do you use it for pool sizing?

**Answer.** `L = λ × W`: average concurrent items L equals arrival rate λ times average residence time W.

For pools: K = target_throughput × per_task_latency. To achieve 1000 req/sec at 200ms each, K = 1000 × 0.2 = 200.

Adjust for bursts: K = burst_throughput × per_task_latency.

### Q15: What's the difference between blocking and non-blocking pool submit?

**Answer.** When the pool is at capacity:

- **Blocking submit**: the caller blocks until a slot opens. Backpressure to caller. Latency suffers; throughput preserved.
- **Non-blocking submit**: returns an error (e.g., `ErrPoolOverload`). Caller decides — retry, fallback, or drop. Latency preserved; throughput may suffer (drops).

Choose based on what's worse for your service.

### Q16: Why is `MaxBlockingTasks=0` (unbounded queue) dangerous?

**Answer.** When the producer is faster than the pool can drain, the queue grows. With no cap, memory grows unboundedly. Eventually OOM.

Always cap the queue (e.g., `WithMaxBlockingTasks(5000)`) or use non-blocking submit.

### Q17: What metrics would you require for a new pool to go to production?

**Answer.**
- `pool_running` (gauge): current in-flight.
- `pool_capacity` (gauge): max.
- `pool_waiting` (gauge): submitters blocked.
- `pool_submitted_total` (counter).
- `pool_completed_total` (counter).
- `pool_dropped_total` (counter).
- `pool_panicked_total` (counter).
- `pool_task_duration_seconds` (histogram).
- `pool_submit_duration_seconds` (histogram, time waiting in Submit).

These ten cover saturation, panic, drops, and latency. Without them, you can't operate the pool.

### Q18: Why might `errgroup` be slower than `ants` at high task rates?

**Answer.** errgroup spawns a fresh goroutine for each `Go` call. At 100k+ submissions/sec, the goroutine creation cost (~1-2μs each) becomes measurable in the profile. ants reuses workers; the same goroutine serves many tasks. At extreme rates, ants saves ~3-8% CPU.

Below ~10k/sec, the difference is invisible.

### Q19: When would you have multiple pools in one service?

**Answer.** When different workloads have different constraints:

- One pool for CPU-bound work (K = NumCPU).
- One pool for I/O-bound work (K = throughput × latency).
- One pool per downstream (K = downstream limit).
- One pool per tenant tier (for isolation).

Multiple pools allow correct sizing per workload and prevent one workload from starving another.

### Q20: How do you choose between `ants.NewPool` and `ants.NewPoolWithFunc`?

**Answer.**
- `NewPool` accepts a function for each Submit. Submit takes `func()`. Allocates a closure per task.
- `NewPoolWithFunc` is constructed with a fixed function; Submit takes a payload (`any`). No per-task closure.

`NewPoolWithFunc` is faster (fewer allocs) but the worker function is fixed at construction. Use when all your tasks have the same logic with varying input.

---

## Senior Level (Q21–Q30)

### Q21: Trace through `ants.Submit` at the source level. What locks are taken?

**Answer.** `ants.Submit` calls `retrieveWorker`:

1. Lock the pool's mutex.
2. Try to pop an idle worker from the queue. If found, unlock and return.
3. If pool not at capacity, unlock, spawn a new worker.
4. If non-blocking and at capacity, unlock, return ErrPoolOverload.
5. Else, wait on a cond variable. Unlock for the wait.

The single mutex is the contention point at high producer count. ants's `WithLoopQueue` (lock-free ring buffer) bypasses the mutex for the common case.

### Q22: How do per-task allocations affect GC under load?

**Answer.** Each task with a captured closure may allocate ~64-200 bytes for the closure. At 1M tasks/sec, that's 200 MB/sec of allocations — significant GC pressure. GC pauses grow; p99 latency suffers.

Mitigations:
- Use `ants.PoolWithFunc` (no per-task closure).
- Batch tasks (fewer, larger).
- Reduce captures (avoid capturing context that doesn't need to be captured).
- Tune GOGC higher.

### Q23: What is "LIFO worker selection" in ants, and when does it cause problems?

**Answer.** ants's default worker queue is a stack — when an idle worker is needed, the *most recently idle* one is picked. LIFO maximises cache locality (recent workers have hot caches).

Problems:
- Under sustained low load, older workers sit idle and may expire. If they have warm state, expiry loses the state.
- Under multi-tenant traffic, one tenant's task can repeatedly use the same worker, starving others (though this isn't quite the right concern at the worker level).

ants's `WithLoopQueue` option switches to FIFO, which is fairer.

### Q24: Walk through diagnosing a saturated pool in production.

**Answer.**
1. Open the pool dashboard. Is `pool_running / pool_capacity` near 1?
2. Check submit rate. Is incoming traffic elevated?
3. Check task duration p99. Are tasks slower than usual?
4. If tasks are slow: check downstream. Is the downstream slow or down?
5. If downstream is fine: K is too low for current traffic.
6. Mitigation: temporarily raise K, scale out replicas, or shed load upstream.
7. Long-term: revisit capacity plan, right-size K.

### Q25: When would you choose `pond` over `ants`?

**Answer.** pond has:
- Sharded queues (lower contention at high producer count).
- Task groups (group-level Wait and result handling).
- Built-in Prometheus metrics.
- Multiple strategies (Eager, Lazy spawn).

ants has more years of production use and is more popular. pond is newer but addresses some of ants's pain points.

Choose pond if you need its features and accept slightly less battle-testing. Choose ants for defaults and maturity.

### Q26: How does pool sizing differ in Kubernetes?

**Answer.**
- `runtime.NumCPU()` returns the host's CPU count, not the container's quota. Use `automaxprocs` or set GOMAXPROCS explicitly to match the container quota.
- CPU and memory limits enforce hard caps. Pool sized for "node" capacity will throttle in a constrained container.
- Cluster-wide K = K_per_pod × replicas. Coordinate with HPA.
- For shared downstreams, per-pod K should match the downstream's per-tenant or per-replica allocation.

### Q27: What's the relationship between Go's scheduler and a goroutine pool?

**Answer.** The scheduler (GMP) multiplexes goroutines onto OS threads. A pool of K worker goroutines is just K goroutines from the scheduler's view — they get scheduled like any others.

The pool's value is *coordination* (queue, dispatch, lifecycle), not *scheduling*. The scheduler handles per-goroutine execution.

Pool design decisions (LIFO vs FIFO) affect which goroutines become runnable; the scheduler decides when they actually run.

### Q28: How do you handle a pool deadlock in production?

**Answer.**
1. Identify the deadlock: running count stuck at K, queue growing, no completions.
2. Open `/debug/pprof/goroutine?debug=2`. Look at pool workers — what are they blocked on?
3. If on a downstream call: the downstream is hung. Investigate.
4. If on an internal lock: a task is holding a lock indefinitely. Investigate.
5. Mitigation: restart pod (releases the deadlock at the cost of dropping in-flight tasks).
6. Long-term: per-task timeout via ctx, lock-ordering convention, defensive timeouts.

### Q29: Should you panic-recover in errgroup tasks?

**Answer.** Yes, if you want to survive a task panic. errgroup itself doesn't recover; an un-recovered panic crashes the program.

Wrap each task:

```go
g.Go(func() (err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("panic: %v", r)
		}
	}()
	return work(ctx, x)
})
```

This is verbose. Some teams write a helper or switch to a pool with built-in panic handler (ants, pond).

### Q30: What's "scheduler fairness" in a pool, and why does it matter?

**Answer.** Scheduler fairness is whether tasks are executed in submission order (FIFO) or some other order (LIFO, priority, sharded). It matters when:

- Multi-tenant: one tenant's flood shouldn't starve another's single task.
- Latency-sensitive: predictable wait time means FIFO.
- Cache-warmth: LIFO maximises cache hits.

Most pool libraries are FIFO or sharded-FIFO. ants is LIFO by default (cache-friendly); the loop-queue mode is FIFO.

---

## Professional Level (Q31–Q35)

### Q31: How do you decide whether to adopt a new pool library?

**Answer.** Run an assessment:

1. **Maintenance**: active, recent commits, responsive maintainer.
2. **Code quality**: tests, benchmarks, race-detector passing.
3. **Community**: real production users, stack overflow presence.
4. **License**: compatible (MIT, Apache 2.0, BSD).
5. **Lock-in**: how hard to migrate away.
6. **Fit**: does it solve a problem your current tool doesn't?

If most pass, run a benchmark in your workload. If the benchmark shows measurable benefit, adopt with sign-off.

### Q32: What does "SLA-driven pool design" mean?

**Answer.** It means: the pool's configuration follows from the service's SLA.

- Tight latency SLA → drop on overload (preserve latency).
- Tight error rate SLA → block on overload (preserve completion).
- High availability SLA → panic handler, circuit breaker, bulkhead.
- High throughput SLA → worker reuse, batch tasks.

Different SLAs lead to different choices. Always derive the pool from the SLA, not the other way around.

### Q33: How do you operate a pool across multiple replicas with a shared downstream?

**Answer.** Coordinate the downstream's total concurrency budget across replicas:

- Static: K_per_pod = downstream_limit / replicas. Coordinate at deploy time.
- Distributed rate limiter: a central system (e.g., Redis-backed token bucket) ensures total concurrency stays below limit, regardless of replica count.
- Service mesh: configure at the sidecar layer (Envoy). The mesh enforces the limit across all instances.
- Accept transient over-limit: scaling events temporarily exceed the limit; document the trade-off.

### Q34: A junior on your team adds `ants` to a small CLI tool. Walk through how you'd respond.

**Answer.** Politely ask:

1. "What's the workload? How many tasks, how often?"
2. "Did you benchmark `errgroup.SetLimit` vs `ants`? What did you see?"
3. "Are we paying for the dependency? What does ants give us that errgroup doesn't?"

If the answer is "<100 tasks, one-shot, no benchmark, no specific reason," propose `errgroup`. Show the diff: fewer lines, no dependency, idiomatic.

This is a teaching moment, not a fight. Frame it as cost-aware engineering.

### Q35: You inherit a service with 5 pools, all using `ants` with `K=1000`. None has metrics. The service occasionally drops messages. What do you do?

**Answer.** A step-by-step plan:

1. **Inventory**: list each pool, its purpose, its K rationale (if any).
2. **Instrument**: add the 10 standard metrics to each pool. Without metrics, you can't reason about behaviour.
3. **Investigate drops**: find when drops happen. Correlate with pool saturation, downstream latency, traffic spikes.
4. **Right-size**: for each pool, compute the correct K based on the bottleneck. Reduce K where over-sized; raise where under-sized.
5. **Consider simplification**: are some pools doing what errgroup could do? Migrate to remove dependency.
6. **Document**: write up the pool's design, alerts, runbook.
7. **Continuously monitor**: weekly review for at least the first month.

The first thing is *visibility*. You cannot fix what you cannot see.

---

---

## Additional Questions (Q36–Q50)

### Q36: What is "warm state" and why does it matter for pool choice?

**Answer.** Warm state is data a worker carries between tasks — a compiled regex, a connection, a font cache, a JIT-compiled function. It's "warm" because it has been initialised; using it is fast. Constructing it is slow (often milliseconds).

If your tasks benefit from warm state, you want workers to persist (so state is reused). `tunny` is built for this: each worker is constructed via a callback, holding its own state. With `ants` or `errgroup`, each task pays the warmup cost.

### Q37: What's wrong with the code `_ = pool.Submit(task)`?

**Answer.** It ignores the error return. `Submit` can fail (pool closed, pool overloaded). Silently ignoring means dropped work without your knowledge. Always check:

```go
if err := pool.Submit(task); err != nil {
	// handle: log, fallback, alarm
}
```

### Q38: How do you handle the case where a downstream goes down for 30 seconds?

**Answer.** Multiple layers:

1. **Per-task timeout**: ensure each task can't hang forever.
2. **Circuit breaker**: stop calling the downstream after N failures.
3. **Backpressure**: pool saturates, upstream queues back up, eventually clients see 503.
4. **Recovery**: when downstream recovers, the circuit breaker half-opens, retries succeed.

The pool alone doesn't handle this. The system around the pool (timeouts + breaker + retry) does.

### Q39: Compare per-handler errgroup vs shared pool for a multi-handler service.

**Answer.**
- **Per-handler errgroup**: each request creates its own group. Lifecycle matches request lifecycle. Errors and ctx flow naturally. K is per-request bound (not cross-request).

- **Shared pool**: one long-lived pool serves all handlers. K is global. One handler's spike affects others. Lifecycle is process-long.

For most APIs, per-handler errgroup is right. Shared pool is right when:
- You want a cluster-wide bound on some shared resource.
- You're amortising spawn cost across many requests.

### Q40: How do you avoid pool resource leaks across tests?

**Answer.**
- Each test that creates a pool should `defer pool.Release()`.
- Use `t.Cleanup(func() { pool.Release() })` for test-local pools.
- Avoid global pools in tests; if unavoidable, drain between tests.
- Run tests with `-race` to catch leaked goroutines.
- Use a goroutine-leak detector (`go.uber.org/goleak`).

### Q41: What happens if you call `g.Go` inside another `g.Go`?

**Answer.** It works, but be careful about deadlock. If the outer Go is at the SetLimit, the inner Go blocks waiting for a slot. If the only way to free a slot is to complete the outer Go, you deadlock.

Mitigation: don't recursively submit to the same errgroup. Use a separate errgroup or pool for nested fan-out.

### Q42: What is the difference between `pool.Submit` and `pool.SubmitWait`?

**Answer.** (workerpool-specific.)

- `Submit(task)`: enqueues the task, returns immediately. The task runs asynchronously.
- `SubmitWait(task)`: enqueues the task, blocks until the task starts (or completes, depending on library). Synchronous-feeling.

Use `SubmitWait` when you need synchronous semantics for one task. Use `Submit` for fire-and-forget.

### Q43: When is `SetLimit(1)` the right answer?

**Answer.** When you need *serialised* execution with a queue. Example: writing to a non-thread-safe library. One worker, FIFO queue, predictable order.

Alternative: a `chan` plus one consumer goroutine. Often clearer.

`SetLimit(1)` is rarely the right answer; usually a code smell. If you find yourself there, ask: does this work need to be serial? If yes, is errgroup the right tool, or just a single goroutine?

### Q44: What's the impact of GOMAXPROCS on pool sizing?

**Answer.** GOMAXPROCS is the max number of OS threads running Go code simultaneously. For CPU-bound work, GOMAXPROCS is the effective parallelism ceiling.

For CPU-bound K: K should be ≤ GOMAXPROCS (often equal).

For I/O-bound K: K can be much greater than GOMAXPROCS — most workers are parked on I/O, not running Go code.

In containers, GOMAXPROCS may not match the container's CPU quota. Set explicitly via env or use `automaxprocs`.

### Q45: How do you design a pool to gracefully handle a graceful shutdown?

**Answer.**
1. On SIGTERM, stop accepting new tasks (set a flag in your wrapper).
2. Stop the upstream feeding the pool (close consumer, drain channels).
3. Wait for in-flight tasks to complete with a timeout: `pool.ReleaseTimeout(30 * time.Second)`.
4. If timeout exceeded, abandon remaining tasks (log a warning, count as a metric).
5. Release the pool.
6. Exit.

This pattern minimises data loss during deploys.

### Q46: What's the tradeoff in `WithExpiryDuration` for ants?

**Answer.** Short expiry (e.g., 1s default):
- Pros: idle workers go away, freeing memory.
- Cons: under traffic that bursts after idle periods, workers must re-spawn, adding latency to the first tasks of each burst.

Long expiry (e.g., 1 hour):
- Pros: workers stay warm for sporadic bursts.
- Cons: memory held for long idle periods.

Disable expiry (`WithDisablePurge`):
- Pros: never re-spawn.
- Cons: workers persist forever; memory not released even at long idle.

Choose based on your traffic pattern. For steady traffic: any setting fine. For sporadic bursts: longer or disabled expiry.

### Q47: How does pool design interact with tail latency?

**Answer.** Pool can introduce tail latency from:

1. Queue wait when saturated.
2. Worker startup (cold start when idle workers expired).
3. Single slow task blocking a worker.
4. Lock contention on the pool's internal queue.

Mitigations:
- Size K with headroom (saturation rare).
- Disable idle expiry (no cold starts).
- Per-task timeout (slow task bounded).
- Sharded/loop-queue (less contention).

Each mitigation has a tradeoff (memory, complexity). Choose based on which tail driver dominates.

### Q48: Walk through choosing between blocking and non-blocking submit for a webhook receiver.

**Answer.**
A webhook receiver gets HTTP POST requests from a third party. The third party retries on 5xx, but not unboundedly.

Blocking submit:
- Pool full → request blocks at Submit.
- Eventually request handler's deadline expires → return 500.
- Third party retries.
- Pros: no lost data (third party retries).
- Cons: latency spikes during overload; third party may eventually give up.

Non-blocking submit:
- Pool full → Submit returns ErrPoolOverload.
- Handler returns 503 immediately.
- Third party retries.
- Pros: fast feedback; latency stays low.
- Cons: third party retry might also fail (still drop).

Choose non-blocking. Fast feedback is better than slow timeout. Both eventually rely on third party retries.

### Q49: What's a "pool inside a pool" anti-pattern, and when is it OK?

**Answer.** Anti-pattern: nesting pools without thought. Outer pool of 10, inner pool of 50. What does that mean? Hard to reason about.

OK when: outer and inner pools enforce different bounds. Outer = parallel batches. Inner = parallel items per batch. Each has a clear meaning.

```go
batchPool, _ := ants.NewPool(10)  // 10 batches in parallel
for _, batch := range batches {
	batch := batch
	batchPool.Submit(func() {
		itemPool, _ := ants.NewPool(50)  // 50 items in this batch in parallel
		defer itemPool.Release()
		for _, item := range batch.Items {
			item := item
			itemPool.Submit(func() { process(item) })
		}
	})
}
```

Wait — creating itemPool per batch is wasteful. Better: shared itemPool.

```go
batchPool, _ := ants.NewPool(10)
itemPool, _ := ants.NewPool(50)
defer batchPool.Release()
defer itemPool.Release()
```

Outer pool: bounds parallel batches. Inner pool: bounds parallel items across all batches.

### Q50: What's the most important rule for pool engineering?

**Answer.** Measure before deciding.

Without measurement:
- You can't know if a pool helps.
- You can't justify the dependency.
- You can't tune K.
- You can't detect when the pool is the bottleneck.

With measurement:
- You know which tool is best.
- You can defend the choice in review.
- You tune K to the actual workload.
- You spot drift over time.

Every other rule is a corollary of "measure first."

---

End of `interview.md`.

