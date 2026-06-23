# Worker Pools — Interview Questions

A staged sequence from junior to staff. Each question lists what the interviewer is testing for and a model answer. Use as study material; don't memorise — practice explaining out loud.

## Table of Contents
1. [Junior Questions](#junior-questions)
2. [Mid-Level Questions](#mid-level-questions)
3. [Senior Questions](#senior-questions)
4. [Staff / Architecture Questions](#staff-architecture-questions)
5. [Live Coding Prompts](#live-coding-prompts)
6. [System Design Prompts](#system-design-prompts)

---

## Junior Questions

### Q1 — What is a worker pool?

**Tests:** Vocabulary, basic understanding.

A worker pool is a fixed number of goroutines that consume jobs from a shared channel. It bounds concurrency, applies backpressure when workers are busy, and is the standard Go pattern for "do these N tasks in parallel without spawning a goroutine per task."

### Q2 — Why not just spawn one goroutine per task?

**Tests:** Awareness of resource limits.

For 100k+ tasks, one-goroutine-per-task exhausts memory (each goroutine has at least ~2 KiB of stack), saturates downstream services, depletes file/socket handles, and removes any natural backpressure. A pool of N caps these resources at N regardless of input size.

### Q3 — Who closes the jobs channel?

**Tests:** Channel ownership rules.

The producer — the goroutine that sends jobs onto the channel. Always exactly one closer. Never close from a worker (a receiver). Use `defer close(jobs)` so it closes even if the producer returns early.

### Q4 — Who closes the results channel?

**Tests:** Multi-sender close discipline.

A "closer" goroutine that calls `close(results)` after `wg.Wait()` returns. The pattern:

```go
go func() {
    wg.Wait()
    close(results)
}()
```

Workers must not close `results` themselves — there are multiple senders, and only one close is allowed.

### Q5 — Why `wg.Add(1)` before `go func()` and not inside?

**Tests:** Memory model awareness.

`wg.Wait()` may observe a zero counter and return before the goroutine starts. The Go documentation explicitly says: calls to `Add` with a positive delta when the counter is zero must happen before any `Wait`.

### Q6 — What does `for j := range jobs` do when the channel is closed?

**Tests:** Channel state model.

It exits *after* the channel is closed *and* drained — i.e., all buffered values have been received. So a closed channel with 5 buffered jobs still delivers all 5 before the loop ends.

### Q7 — How do I know when all workers have finished?

**Tests:** WaitGroup usage.

Use `sync.WaitGroup`. Each worker calls `defer wg.Done()` at the top. After closing `jobs`, the orchestrator calls `wg.Wait()`, which returns when every worker has signalled completion.

### Q8 — What happens if I forget `close(jobs)`?

**Tests:** Liveness understanding.

Workers stay in `for j := range jobs` forever, blocked on receive. `wg.Wait()` blocks forever. The pool hangs. Detected by goroutine count not decreasing.

### Q9 — How big should the pool be?

**Tests:** Reasoning about constraints.

For CPU-bound work, `runtime.GOMAXPROCS(0)` (which usually equals `NumCPU`). For I/O-bound work, the smallest of: downstream concurrency limit, target throughput × per-job latency (Little's Law), and memory budget. Default I/O pool size is often 50–100.

### Q10 — Can workers process jobs in order?

**Tests:** Understanding of concurrent execution.

No. Workers run concurrently and finish in arbitrary order. To preserve order, attach an index to each job and write results into an indexed slice (`results[j.Index] = ...`).

---

## Mid-Level Questions

### Q11 — How do you cancel a worker pool?

**Tests:** Context usage.

Pass a `context.Context` to every worker. Each worker uses `select` to receive from either the jobs channel or `ctx.Done()`:

```go
select {
case <-ctx.Done():
    return
case j, ok := <-jobs:
    if !ok { return }
    // process
}
```

Calling `cancel()` from outside fires `ctx.Done()` and workers exit on the next iteration.

### Q12 — How does errgroup compare to a hand-rolled pool?

**Tests:** Knowledge of standard tools.

`errgroup.Group` is a built-in fail-fast group. `errgroup.WithContext` creates a context that's cancelled the moment any goroutine returns an error. `g.SetLimit(N)` provides bounded concurrency. It's idiomatic for "spawn N tasks, return the first error." A hand-rolled pool is preferred when you need long-running workers, streaming results, or per-job retry logic.

### Q13 — What is backpressure?

**Tests:** Understanding of flow control.

Backpressure is the natural slowdown of producers when consumers can't keep up. In a pool, when all workers are busy, producers block on `jobs <- j`. The producer's blocking *is* the backpressure signal. Buffered channels delay backpressure; they don't eliminate it.

### Q14 — Difference between a worker pool and a semaphore?

**Tests:** Pattern recognition.

A worker pool spawns N long-lived goroutines that consume from a channel. A semaphore (a buffered channel of capacity N) acquires-and-releases per task; you spawn one goroutine per task but bound concurrency. Pool is better when you have many small tasks; semaphore is simpler when tasks are heterogeneous and have per-task setup.

### Q15 — How do you handle errors in workers?

**Tests:** Error model awareness.

Three options: (1) embed in `Result.Err` and let the consumer handle each; (2) use `errgroup` for fail-fast on first error; (3) collect errors with `errors.Join` or `multierr` and return after all complete. Choice depends on whether partial success is acceptable.

### Q16 — Per-job timeout — how?

**Tests:** Context derivation.

Inside the worker, derive a per-job context: `jobCtx, cancel := context.WithTimeout(ctx, 5*time.Second)`. Pass `jobCtx` to `process`. `defer cancel()`. The job aborts if the timeout fires *and* `process` respects context (HTTP, DB, etc. do; raw computation does not).

### Q17 — What's the issue with closing the results channel from a worker?

**Tests:** Multi-sender discipline.

Multiple workers send on `results`. Closing it from worker A causes worker B's next send to panic ("send on closed channel"). Only one goroutine — the one that knows all senders are done — can close: that's the closer goroutine after `wg.Wait()`.

### Q18 — How do you ensure no goroutine leaks?

**Tests:** Lifecycle understanding.

Three rules: (1) every `wg.Add(1)` has a matching `wg.Done()` on every code path (use defer); (2) every channel has exactly one closer; (3) every goroutine respects `ctx.Done()`. Verify with `runtime.NumGoroutine()` before and after the pool's lifecycle in tests.

### Q19 — Buffered or unbuffered jobs channel?

**Tests:** Buffer choice rationale.

Unbuffered: strict backpressure, simpler reasoning, slower for bursty producers. Buffered with capacity = N: smooths short bursts, slightly higher memory. Buffered with large capacity: hides bottlenecks, larger memory, may delay shutdown. Default: buffer of N for jobs, N for results. Tune with measurement.

### Q20 — How do you implement reject-on-full?

**Tests:** Backpressure strategy choice.

Use `select` with `default`:

```go
select {
case jobs <- j:
default:
    return errPoolFull
}
```

The `default` case fires immediately if the channel is full. The caller decides whether to retry, drop, or fail.

---

## Senior Questions

### Q21 — Apply Little's Law to size a pool.

**Tests:** Capacity planning.

`L = λW`. Inflight = throughput × latency. If you want 1000 req/s at 200 ms per request, you need 200 inflight. With single-threaded workers, that's N=200. Add 30% headroom; size based on P99 latency, not P50.

### Q22 — When does Little's Law fail?

**Tests:** Awareness of model limits.

Under high utilisation (>80%) the queue grows non-linearly — plan for ~70%. Heavy-tailed latency distributions break P50 sizing — use P99. Coordinated arrivals (cron, retries) cause bursts that multiply expected N. Fundamentally, Little's Law assumes steady state; transient sizing requires headroom.

### Q23 — Static vs dynamic pool sizing — when?

**Tests:** Judgement.

Static: load is predictable, simpler to reason about, easier to monitor. Default choice. Dynamic: load varies by 10x or more (hourly batches, flash sales). Use spawn-on-demand with a semaphore + idle timeout, or a watermark-based controller. Most pools should *not* be dynamic.

### Q24 — Explain bulkheading.

**Tests:** Failure containment.

A bulkhead is a separate pool per failure domain (per tenant, per priority, per downstream). If one tenant or downstream fails, only its pool fills; others continue. Trade-off: more pools = more code and metrics; smaller pools may underutilise resources during burst on a single tenant.

### Q25 — How do you instrument a pool?

**Tests:** Observability sense.

Mandatory metrics: total jobs, inflight, queue depth, duration histogram, rejected count. Tie metrics to SLOs: P99 of duration must match latency SLO; rejection rate is the visible backpressure indicator. Add tracing spans per job. Log structured per-job outcomes for debugging.

### Q26 — Walk me through diagnosing a pool that hangs.

**Tests:** Debugging methodology.

(1) `runtime.NumGoroutine()` — abnormally high? Leak. (2) `pprof goroutine` profile — see where workers are blocked. Common: `chan send` on results (consumer dead), `chan recv` on jobs (producer didn't close). (3) Check ctx propagation — workers might be ignoring cancellation. (4) Verify `wg.Wait()` is called and `Add`/`Done` are matched.

### Q27 — When would you choose `x/sync/semaphore` over a channel?

**Tests:** Knowledge of stdlib alternatives.

`x/sync/semaphore` supports weighted acquire (tasks of different costs) and ctx-aware Acquire that returns an error on cancellation. A channel semaphore can't do either cleanly. Use it when jobs have variable cost (memory, CPU weight) or when you want clean cancellation during acquire.

### Q28 — How does sync.Pool integrate with worker pools?

**Tests:** Allocation reduction.

`sync.Pool` reuses heap allocations. Inside a worker that allocates a buffer per job, `Get` from the pool, use, and `Put` back. Three rules: copy out before Put, reset before Put (`buf[:0]`), don't put huge buffers (they consume memory). Worth it only when allocation profiling shows GC pressure from the worker.

### Q29 — Describe a graceful shutdown sequence.

**Tests:** Lifecycle correctness.

(1) Stop accepting new submissions (HTTP server stops listening). (2) `close(jobs)`. (3) Workers finish in-flight jobs, observe range exit, defer Done runs. (4) `wg.Wait()` returns in the closer. (5) `close(results)`. (6) Consumer drains. (7) Service exits. Add a deadline: if drain exceeds it, `cancel(ctx)` to force exit.

### Q30 — Explain why dynamic pool resizing can thrash.

**Tests:** Control system intuition.

Without hysteresis, the same threshold for grow and shrink causes the pool to bounce. Burst arrives → grow. Burst ends → shrink. New burst → grow again. Each grow/shrink has cost (goroutine creation, state warmup). Use different thresholds (grow at 80% queue depth, shrink at 20%) and minimum dwell times.

---

## Staff / Architecture Questions

### Q31 — Design a worker pool for a multi-tenant SaaS image processor.

**Tests:** Architecture thinking.

Per-tenant bulkhead with rate limits per SLA tier. Pool size tied to NumCPU for CPU-bound resize step. Separate pools for I/O stages (download, upload). Bounded queue with reject-on-full + 429 response. Per-job timeout 30s. Metrics per tenant. Auto-scale instances based on queue depth p95 across the fleet, not pool size.

### Q32 — How do you prevent retry storms in a pool feeding a flaky downstream?

**Tests:** Distributed systems awareness.

Circuit breaker per downstream. Exponential backoff with jitter on retry. Token bucket limiter to bound retry rate. Dead-letter queue for jobs that exceed retry budget. Adaptive concurrency control (AIMD) so the pool itself shrinks when downstream errors rise.

### Q33 — Pool of 100 workers calling a downstream limited to 50 concurrent. What's wrong?

**Tests:** Capacity reasoning.

Half the workers are always rate-limited or queued at the downstream. Right size is 50, plus a small reject buffer. Or: pool of 100 with a `x/sync/semaphore.NewWeighted(50)` inside. Or: rate limiter sized to downstream's actual capacity. Don't oversize — wasted goroutines are pure cost.

### Q34 — Trade-offs of pipeline (multiple pools) vs single pool with branching logic?

**Tests:** Architecture choice.

Pipeline: each stage independently sized for its bottleneck, easier to reason about backpressure per stage, more channel coordination overhead. Single pool with branching: simpler code, harder to size correctly when stages have very different costs. Use pipeline when stages differ by 5x or more in latency or resource use.

### Q35 — How do you migrate a service from per-request goroutines to a pool without downtime?

**Tests:** Migration strategy.

Feature-flag the path. Roll out to 1% → 10% → 50% → 100% with monitoring. New error mode: rejection (429). Document API contract change. Keep old path runnable during rollout for instant rollback. Compare key metrics (latency, error rate, resource use) between paths.

### Q36 — What's wrong with `ants.NewPool(0)` or any pool of size 0?

**Tests:** Defensive coding.

Pool of size 0 has no workers. Submit hangs forever (jobs channel fills) or returns an error immediately. Either way, the service is broken. Validate config: `if cfg.Size < 1 { return errInvalidSize }`. Also reject negative sizes from misconfigured environment variables.

### Q37 — Two pools share a DB connection pool of 20. How big should each be?

**Tests:** Resource sharing.

Total worker-to-conn ratio should be ≤ 1:1 in steady state to avoid waiting on conn acquisition. So pool A + pool B ≤ 20. Allocate by SLA: critical pool gets 16, batch gets 4. If acquisition latency is itself an issue, oversize the conn pool by 50%.

### Q38 — Does a worker holding a DB connection across multiple jobs make sense?

**Tests:** Connection pool interaction.

Yes for short-batch workers (transaction over multiple inserts). No for general-purpose workers (you serialise unrelated jobs through one connection). Default: acquire-and-release per job from a connection pool. Hold across jobs only when correctness or batching demands it.

### Q39 — Pool emits no metrics. How do you debug a P99 latency spike?

**Tests:** Operational realism.

You can't, properly. First action: add metrics — duration histogram, queue depth, inflight gauge. While you wait for deploy: pprof goroutine profile to see where workers are stuck, pprof CPU profile to see hot paths, GC traces (`GODEBUG=gctrace=1`) to rule out GC pauses. Then the metrics tell you next time.

### Q40 — Design a worker pool that survives a poison pill (a job that panics).

**Tests:** Robustness.

`recover` in the worker. Log the panic with job ID and stack trace. Increment a `pool_panics_total` counter. Optionally: a poison-pill detector — if the same job ID panics K times, send to dead-letter queue. Optionally: restart the worker after recover so the pool keeps its size.

---

## Live Coding Prompts

### Live-1 — Implement a basic worker pool

> "Write a function `Process(inputs []int, n int) []int` that processes inputs in parallel using a pool of n workers, where each worker squares its input. Order doesn't matter."

Expected solution: 30-line junior pattern.

### Live-2 — Add cancellation to your pool

> "Make the same pool cancellable via a context."

Expected: select on ctx.Done in worker; producer respects ctx.

### Live-3 — Convert to errgroup

> "Now use errgroup with a concurrency limit of 8 instead of a hand-rolled pool. Return the first error."

### Live-4 — Implement a bounded reject pool

> "Now Submit(ctx, j) should return ErrPoolFull if the queue is full instead of blocking."

### Live-5 — Detect a leak

> "Here's a pool. Find the goroutine leak."

```go
func bad(jobs []int) {
    ch := make(chan int)
    go func() {
        for _, j := range jobs {
            ch <- j
        }
    }()
    for v := range ch {
        fmt.Println(v)
    }
}
```

(Bug: the producer goroutine never closes ch. The `range` never ends. The producer goroutine itself returns after the loop, but the consumer hangs forever.)

### Live-6 — Fix a race

> "Here's a pool that increments a shared counter. Find the race."

```go
var counter int
for _, j := range jobs {
    go func(j Job) {
        process(j)
        counter++
    }(j)
}
```

(Race: counter accessed from N goroutines without synchronisation. Fix: `atomic.Int64`.)

---

## System Design Prompts

### Design-1 — Image upload service

> "Design a service that accepts image uploads via HTTP, generates 3 thumbnail sizes, stores them in S3, and emits a webhook on completion."

Components: HTTP intake + admission control, queue (Kafka or in-memory bounded), worker pool sized to NumCPU for resize, S3 upload pool sized to network capacity, webhook pool sized to subscriber count. Discuss bulkheading by tenant, retry policy, and SLOs.

### Design-2 — Batch ETL pipeline

> "Design a daily ETL: read 10 GB of CSV from S3, transform, write to Postgres."

Pipeline of pools: S3 reader (8 workers, network bound), parser (NumCPU workers), validator (NumCPU workers), DB writer (matched to DB conn pool). Backpressure via bounded channels between stages. Discuss restart-on-failure (idempotent writes).

### Design-3 — Webhook fanout

> "Design a service that, on each event, POSTs to up to 10k subscribers."

Per-subscriber rate limit. Pool of 64 senders. Retry queue with exponential backoff. Dead-letter queue. Bulkhead per subscriber tier. Discuss circuit breaker per subscriber to prevent one slow URL from starving others.

### Design-4 — Multi-tenant rate-limited API

> "Each tenant has a quota. Build the rate limiter."

Per-tenant token bucket. Per-tenant pool with bounded queue. Cross-tenant fairness via separate pools. Discuss "noisy neighbour" — tenant A bursts; tenant B unaffected because separate pool. Reject (429) on per-tenant overload.

---

These questions cover the full ladder. Practice answering each in 1–3 minutes. The best answers cite trade-offs, not just mechanics.
