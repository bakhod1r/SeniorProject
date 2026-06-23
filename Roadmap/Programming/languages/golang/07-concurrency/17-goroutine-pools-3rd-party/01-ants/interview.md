---
layout: default
title: Interview
parent: ants
grand_parent: Goroutine Pools (3rd-party)
ancestor: Go
nav_order: 7
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/17-goroutine-pools-3rd-party/01-ants/interview/
---

# ants — Interview Questions

[← Back](../)

A graded collection of interview questions from junior to staff level. Each has a model answer.

---

## Junior

### Q1
**What is a goroutine pool? Why would you use one?**

**A.** A goroutine pool is a bounded set of long-lived worker goroutines that pull tasks from a shared queue. You'd use one to (a) cap concurrency (so you don't spawn unbounded goroutines under load) and (b) recycle goroutines (avoiding per-task allocation cost). `ants` is the most popular implementation.

### Q2
**What is the simplest workflow for using `ants`?**

**A.**
```go
pool, _ := ants.NewPool(100)
defer pool.Release()
_ = pool.Submit(func() { /* work */ })
```

Create with `NewPool(N)`, defer `Release`, submit closures with `Submit`.

### Q3
**What does `defer pool.Release()` do?**

**A.** Schedules `Release` to be called when the enclosing function returns. `Release` shuts down the pool: signals idle workers to exit, sets the closed flag, stops the janitor. Without `defer Release`, workers leak.

### Q4
**What happens if you `Submit` to a full pool?**

**A.** In default (blocking) mode, the calling goroutine blocks inside `Submit` until a worker is free. In non-blocking mode (`WithNonblocking(true)`), `Submit` returns `ErrPoolOverload` immediately.

### Q5
**What is the difference between `Cap`, `Running`, and `Free`?**

**A.** `Cap` is the upper limit on concurrent workers. `Running` is the current number of worker goroutines (active + idle). `Free` is `Cap - Running`. None of these is "tasks in queue" — `ants` has no internal task queue beyond the workers.

### Q6
**Why is `i := i` needed in this loop?**

```go
for i := 0; i < 10; i++ {
	_ = pool.Submit(func() { fmt.Println(i) })
}
```

**A.** In Go ≤ 1.21, the loop variable `i` is shared by all iterations. Without `i := i`, all closures capture the *same* `i`, which becomes `10` by the time they run. With `i := i`, each closure captures a fresh `i`. In Go 1.22+, this was fixed at the language level.

### Q7
**How do you wait for all submitted tasks to finish?**

**A.** Use a `sync.WaitGroup`:
```go
var wg sync.WaitGroup
for _, t := range tasks {
	wg.Add(1)
	t := t
	_ = pool.Submit(func() { defer wg.Done(); t() })
}
wg.Wait()
```

`Add` before `Submit`, `defer Done` inside the task, `Wait` after.

### Q8
**What is `PoolWithFunc`?**

**A.** A specialised pool that runs the same function with different arguments. The function is supplied at construction; tasks are submitted as `interface{}` arguments via `Invoke(arg)`. Slightly faster than `Pool` because there's no per-call closure allocation.

### Q9
**What happens if a task panics?**

**A.** The pool's worker has a `defer recover()` that catches the panic. The worker continues to the next task. If a panic handler is installed (`WithPanicHandler`), it's called. Otherwise, the panic is logged via the internal logger.

### Q10
**What does `ants.NewPool(0)` return?**

**A.** `nil, ants.ErrInvalidPoolSize`. The size must be positive. `-1` is a special value meaning unlimited.

---

## Middle

### Q11
**What is the difference between `Submit` and `Invoke`?**

**A.** `Submit(func())` is on `Pool` — takes a closure. `Invoke(arg interface{})` is on `PoolWithFunc` — takes an argument; the function was set at pool construction. `Invoke` avoids per-call closure allocation.

### Q12
**What does `WithExpiryDuration` control?**

**A.** How long an idle worker is kept alive before the janitor kills it. Default 1 second. Set higher for warm-up-sensitive workers (database connections, etc.); set lower (or use `WithDisablePurge`) for memory-tight environments.

### Q13
**What is `WithMaxBlockingTasks`?**

**A.** In blocking mode, it caps how many submitter goroutines may be simultaneously blocked in `Submit`. Default 0 means unlimited. Useful to prevent submitter-goroutine explosion under sustained overload.

### Q14
**What is the difference between `WithNonblocking` and `WithMaxBlockingTasks`?**

**A.** `WithNonblocking(true)` makes `Submit` *never* block — it returns `ErrPoolOverload` immediately if the pool is full. `WithMaxBlockingTasks(N)` only caps the *number* of blocked submitters in blocking mode; submitter `N+1` gets the error. They are mutually exclusive in practice: non-blocking wins if both set.

### Q15
**How would you log every panic in a pool to your monitoring system?**

**A.**
```go
ants.WithPanicHandler(func(p interface{}) {
	stack := debug.Stack()
	metrics.Panics.Inc()
	log.Errorf("pool panic: %v\n%s", p, stack)
	sentry.CaptureException(fmt.Errorf("%v", p))
})
```

Install via `WithPanicHandler`. Don't let the handler panic.

### Q16
**Does `Tune(N)` preempt running tasks?**

**A.** No. `Tune` atomically updates the cap. Existing tasks run to completion. Subsequent submits respect the new cap. If `Tune` shrinks the pool, `Running > Cap` is transiently legal.

### Q17
**How do you shut down a pool gracefully?**

**A.** Use `ReleaseTimeout(d)`. It calls `Release` then waits up to `d` for all running tasks to complete. Returns `ErrTimeout` if exceeded. Inside tasks, honour `context.Context.Done()` so they can short-circuit during shutdown.

### Q18
**What does `Reboot` do?**

**A.** Restarts a closed pool. After `Release`, the pool is in CLOSED state and rejects submits. `Reboot` returns it to OPEN state.

### Q19
**Why does `ants` not accept `context.Context` in `Submit`?**

**A.** Design choice. Adding a context parameter would complicate the hot path. Users thread context through closures themselves. Some users disagree with this choice; it is a known limitation.

### Q20
**How would you implement a context-aware submit?**

**A.**
```go
func submitCtx(ctx context.Context, p *ants.Pool, task func(context.Context)) error {
	return p.Submit(func() {
		if ctx.Err() != nil { return }
		task(ctx)
	})
}
```

Check context inside the task. For Submit-time cancellation, wrap with a goroutine + `select`.

---

## Senior

### Q21
**What is the worker stack and why is it LIFO?**

**A.** The worker stack is the collection of idle `*goWorker` waiting for tasks. It is LIFO so the most recently used worker is reused first — cache locality (its goroutine stack pages are warm) and efficient idle expiry (long-idle workers cluster at the bottom for batched purging).

### Q22
**Explain the fast path of `Submit`.**

**A.** Take the pool lock briefly. Pop an idle worker from the LIFO stack. Release the lock. Send the task on the worker's task channel. Done. No goroutine creation, no waiting. Hot path is ~100 ns per submit.

### Q23
**When does the fast path fail, and what happens next?**

**A.** Fast path fails when the worker stack is empty. Then: if `Running < Cap`, spawn a new worker (release lock, `workerCache.Get`, `goWorker.run()`, send task). If at cap and blocking, wait on `sync.Cond`. If at cap and non-blocking, return `ErrPoolOverload`.

### Q24
**How does the janitor decide what to purge?**

**A.** It periodically scans the worker stack for entries whose `lastUsed` is older than `ExpiryDuration`. Because the stack is sorted by `lastUsed`, this is a binary search. The expired workers are removed from the stack and sent a `nil` poison pill on their task channel. They exit.

### Q25
**What is `MultiPool` and when do you use it?**

**A.** A sharded `Pool` — internally an array of `*Pool` with a `LoadBalancingStrategy` that routes each `Submit`. Use it when a single `Pool`'s lock becomes a contention bottleneck (visible in `pprof` as `runtime.lock_slow` or `runtime.findrunnable`). Splits the lock across shards.

### Q26
**What are the two built-in load balancing strategies in `MultiPool`?**

**A.** `RoundRobin` (atomic counter modulo number of shards; O(1) per submit) and `LeastTasks` (scan all shards, pick the one with lowest `Running`; O(N) per submit). Custom strategies require forking.

### Q27
**Why is the worker's task channel buffered with size 1?**

**A.** So `Submit` can send a task to an idle-or-about-to-be-idle worker without blocking. If the channel were unbuffered, `Submit` would have to wait for the worker to be at `<-w.task` before sending. Size 1 lets `Submit` send and continue, while the worker may still be wrapping up the previous task.

### Q28
**What happens to a worker that panics?**

**A.** The deferred recover in `goWorker.run` catches it. The panic handler is called (or default logger). The deferred cleanup decrements `running`, returns the struct to the `sync.Pool` cache, and signals the cond. The goroutine exits. A new worker may be spawned on the next submit.

In some current versions, the worker continues to the next task (does *not* exit). This is version-dependent.

### Q29
**Why does `Release` not interrupt running tasks?**

**A.** Go has no goroutine cancellation. Killing a goroutine externally is impossible. The only way to abort a task is cooperative — the task must check a flag or context. `Release` doesn't pass such a signal; it's the user's responsibility.

### Q30
**What is `sync.Pool` used for in `ants`?**

**A.** To cache `*goWorker` (or `*goWorkerWithFunc`) structs across spawn/exit cycles. When a worker exits, its struct is returned to the cache. When a new worker is needed, the cache is checked first. Avoids ~100 bytes of allocation per worker cycle.

---

## Staff

### Q31
**Walk me through everything that happens between `Submit(task)` returning `nil` and `task` executing.**

**A.**
1. `Submit` enters with the closure.
2. Atomic check of `state` — not closed.
3. `retrieveWorker` is called.
4. Lock pool. Pop idle worker (or determine to spawn).
5. Either pop succeeds → release lock → return worker.
6. Or spawn: increment `running`, release lock, `workerCache.Get`, `goWorker.run` (starts goroutine), return worker.
7. Back in `Submit`: send task on `w.task` (channel send, possibly waking a parked receiver).
8. `Submit` returns nil.
9. Worker's `for f := range w.task` receives the task.
10. Worker executes `f()`.

The task runs sometime after step 8. The latency between step 8 and step 10 depends on scheduler timing — typically microseconds.

### Q32
**Design a multi-tenant variant of `ants` where each tenant has its own pool, with a global cap across all tenants.**

**A.**
```go
type TenantPools struct {
	mu     sync.RWMutex
	pools  map[string]*ants.Pool
	global *semaphore.Weighted
}

func New(globalCap int64) *TenantPools {
	return &TenantPools{
		pools:  make(map[string]*ants.Pool),
		global: semaphore.NewWeighted(globalCap),
	}
}

func (t *TenantPools) Submit(ctx context.Context, tenant string, task func()) error {
	if err := t.global.Acquire(ctx, 1); err != nil { return err }
	pool := t.getOrCreate(tenant)
	return pool.Submit(func() { defer t.global.Release(1); task() })
}

func (t *TenantPools) getOrCreate(tenant string) *ants.Pool {
	// double-checked locking
	t.mu.RLock()
	p, ok := t.pools[tenant]
	t.mu.RUnlock()
	if ok { return p }
	t.mu.Lock()
	defer t.mu.Unlock()
	if p, ok := t.pools[tenant]; ok { return p }
	p, _ = ants.NewPool(100, ants.WithNonblocking(true))
	t.pools[tenant] = p
	return p
}
```

Each tenant gets a pool. Global semaphore caps total concurrency. Released after task completes.

### Q33
**A user reports the service "freezes" — `Running` is at cap, `Free` is 0, no submits succeed, no tasks finish. How do you diagnose?**

**A.**
1. Get goroutine dump (`SIGQUIT` or `runtime/pprof`).
2. Filter for goroutines stuck on the same stack.
3. Likely: tasks are blocked on an external dependency (DB, HTTP, channel).
4. Identify the dependency. Check its health.
5. Either fix the dependency or add a timeout to tasks (so they can complete and free workers).
6. As immediate mitigation: `Release` and `Reboot` the pool (loses in-flight tasks).

### Q34
**Compare `ants.Pool` and `golang.org/x/sync/errgroup` with `SetLimit`. When is each appropriate?**

**A.**
- `errgroup`: spawns one goroutine per task (no reuse), provides first-error short-circuit and context propagation. Good for batch operations.
- `ants.Pool`: reuses workers, no error semantics, more configuration. Good for sustained services with many small tasks.

For a one-off batch where you want first-error and have a manageable task count: `errgroup`. For a long-lived service processing millions of tasks: `ants.Pool`. They can be combined: `errgroup` for cancellation, `ants.Pool` underneath for worker reuse.

### Q35
**Why does `ants` use `sync.Cond` rather than channels for blocking submitters?**

**A.** `sync.Cond` pairs naturally with the existing mutex protecting the worker stack, has slightly lower per-wake overhead than channels (no select cost), and avoids per-submitter channel allocations. Channels would require either a shared channel (contention) or one per submitter (allocations). `sync.Cond` is the right tool for "wait for a condition under a mutex."

### Q36
**Design a pool that supports task priorities.**

**A.**
Approach 1: multiple `ants.Pool`s.

```go
type PriorityPool struct {
	high, mid, low *ants.Pool
}

func (p *PriorityPool) Submit(prio int, task func()) error {
	switch prio {
	case 1: return p.high.Submit(task)
	case 2: return p.mid.Submit(task)
	default: return p.low.Submit(task)
	}
}
```

Simple, isolation per priority.

Approach 2: fork `ants` and replace the cond wait queue with a priority queue. Higher complexity but priorities span all submitters.

For most cases, Approach 1 is right.

### Q37
**What's the performance cost of `WithPanicHandler` in the steady state?**

**A.** Zero on the happy path. The handler is only called inside `recover()`. If no panic, the handler is not invoked. The cost is in the panic case, which should be rare.

If the handler does heavy work (Sentry call, full stack trace), each panic is expensive. But this is per panic, not per task.

### Q38
**You have a `MultiPool` with 4 sub-pools and `LeastTasks` strategy. Each sub-pool has cap 100. A submitter submits 1000 tasks. What is the distribution?**

**A.** `LeastTasks` picks the shard with lowest `Running` each time. So:

- First 4 submits go to all 4 (round-robin-like).
- Subsequent submits go to whoever has fewest running.
- Result: very evenly distributed. Each shard has ~250 tasks.

Compare to `RoundRobin`: exactly 250 per shard (modulo concurrency).

The difference shows up under uneven task durations — `LeastTasks` balances dynamically.

### Q39
**Why might `Tune` not have the expected effect?**

**A.** Several reasons:
- Pool already had `Running` higher than new cap; existing tasks continue.
- Other producers are submitting concurrently; cap effect is per-submit, not global.
- Caller didn't observe the change because of caching (atomic guarantees the write but reads may be stale).
- Submitters that already passed admission control don't get re-checked.

Generally, `Tune` is asymptotically correct but not instantaneous.

### Q40
**How would you implement a "Submit with retry on overload" wrapper?**

**A.**
```go
func submitWithRetry(ctx context.Context, p *ants.Pool, task func(), maxRetries int) error {
	backoff := 1 * time.Millisecond
	for attempt := 0; attempt <= maxRetries; attempt++ {
		err := p.Submit(task)
		if err == nil { return nil }
		if errors.Is(err, ants.ErrPoolClosed) { return err }
		if !errors.Is(err, ants.ErrPoolOverload) { return err }
		select {
		case <-ctx.Done(): return ctx.Err()
		case <-time.After(backoff):
			backoff = min(backoff*2, 100*time.Millisecond)
		}
	}
	return ants.ErrPoolOverload
}
```

Exponential backoff with cap. Honour context. Distinguish closed (unrecoverable) from overload (transient).

---

## Tricky

### TQ1
**You write `_ = pool.Submit(func() { defer pool.Release(); doWork() })`. What happens?**

**A.** Deadlock potential. `Release` signals all idle workers and sets the closed flag. It does *not* kill the running worker — but the worker calling `Release` is one of the workers. The behaviour depends on whether `Release` blocks waiting for the purger goroutine to exit. In some versions, the worker hangs because the purger's exit signal can't be observed. In others, `Release` completes (idempotently) but the worker continues. Either way, this is buggy code.

### TQ2
**A pool of cap 1 is mathematically equivalent to what other primitive?**

**A.** A mutex (in spirit). Tasks run strictly one at a time, in the order they're accepted. The pool serialises rather than parallelises. Real code should use a mutex; `ants.NewPool(1)` is wasteful overkill.

### TQ3
**Show me a `Submit` call that compiles but is almost certainly wrong.**

**A.**
```go
_ = pool.Submit(doWork()) // calls doWork now, submits its return
```

Calls `doWork` synchronously, then tries to submit the result. If `doWork` returns `func()`, it compiles; if it returns anything else, it doesn't.

### TQ4
**You have `pool.Cap() == 100` and `pool.Running() == 200`. How?**

**A.** You just called `Tune(100)` while 200 workers were running. The cap is updated atomically; the running count takes time to catch up. Transiently legal.

### TQ5
**Why is `pool.Submit(nil)` dangerous?**

**A.** The worker receives `nil` and tries to call it. Panic. The pool's recover catches it. The panic handler is called. The task is silently dropped. Always pass a non-nil function.

### TQ6
**You set `WithNonblocking(true)` and `WithMaxBlockingTasks(1000)`. What happens?**

**A.** `MaxBlockingTasks` is ignored. Non-blocking means there are no blocked submitters; the queue size is zero. `MaxBlockingTasks` only applies in blocking mode.

### TQ7
**A pool has `WithDisablePurge(true)` and `WithExpiryDuration(1 * time.Second)`. Which wins?**

**A.** `DisablePurge` wins. The janitor is not started. `ExpiryDuration` is irrelevant — no worker is ever killed by idle expiry.

### TQ8
**`Submit` returned nil 30 seconds ago, but the task never ran. How?**

**A.** Possibilities:
- The pool was `Release`d. Then `Submit` should return `ErrPoolClosed`, not nil. Unless there's a race where it slipped through.
- The pool is at cap with all workers stuck. The task is in a worker's channel buffer but the worker is on a previous, never-completing task.
- The task is in the channel but the worker exited (race during `Release`).

Investigate with goroutine dump.

### TQ9
**Why does the package have `ants.Submit` as a package-level function?**

**A.** Convenience — uses a default global pool. Useful for quick scripts. Not recommended for production code (no isolation, default cap is unlimited, no panic handler).

### TQ10
**The `_ = pool.Submit(...)` pattern hides errors. When is this OK?**

**A.** When you know:
- Pool is unlimited or not at cap.
- Pool is not closed.
- You don't care if task drops.

For production, almost never. Always check.

---

## Conceptual

### CQ1
**Why doesn't Go have a built-in goroutine pool?**

**A.** Go's philosophy: goroutines are cheap, so spawn one per logical unit of work. The runtime handles scheduling. Pools are an optimisation for specific workloads, not a default need. Standard library includes `errgroup` and `semaphore` for bounded concurrency without worker reuse.

### CQ2
**What's the difference between bounded concurrency and a pool?**

**A.** Bounded concurrency caps how many things run at once. A pool also reuses goroutines. You can have bounded concurrency without pooling (semaphore + plain `go`). You can have pooling without bounding (size = ∞). `ants` does both.

### CQ3
**Are pools always faster than `go f()`?**

**A.** No. For one-off tasks, `go f()` is faster (no pool overhead). Pools win at sustained high task rates where worker reuse amortises setup cost. Always benchmark.

### CQ4
**Why does `ants` cap workers, not tasks?**

**A.** Capping workers caps concurrency. Capping tasks (a queue) is an orthogonal concern. `ants` deliberately leaves task queuing to the user (callers are the queue, or build a separate queue in front).

### CQ5
**How does `ants` interact with `GOMAXPROCS`?**

**A.** Workers are goroutines, multiplexed onto `GOMAXPROCS` threads by Go's scheduler. A pool of 1000 doesn't mean 1000 CPU-cores doing work — only `GOMAXPROCS` are running goroutines at any instant. For CPU-bound work, cap pool at `GOMAXPROCS`. For I/O-bound, cap can be much higher (workers block on I/O, scheduler runs others).

---

## Code Reading

### CR1
**Read this code. What's wrong?**

```go
pool, _ := ants.NewPool(10)
for i := 0; i < 100; i++ {
	pool.Submit(func() {
		time.Sleep(time.Millisecond)
		fmt.Println(i)
	})
}
time.Sleep(time.Second)
```

**A.** Three issues:
1. Missing `defer pool.Release()`.
2. Captured loop variable: prints `100` (mostly) in Go ≤ 1.21.
3. `time.Sleep(time.Second)` is not a real wait — tasks may not finish. Use `WaitGroup`.

### CR2
**Read this code. What's wrong?**

```go
pool, _ := ants.NewPool(10, ants.WithNonblocking(true))
defer pool.Release()
var wg sync.WaitGroup
for i := 0; i < 100; i++ {
	wg.Add(1)
	i := i
	pool.Submit(func() {
		defer wg.Done()
		process(i)
	})
}
wg.Wait()
```

**A.** Ignored Submit error. With non-blocking, some submits will fail with `ErrPoolOverload`. The `wg.Add(1)` ran but `wg.Done()` never will (because the task wasn't accepted). `wg.Wait()` hangs forever.

Fix:
```go
if err := pool.Submit(...); err != nil {
	wg.Done() // compensate for the Add
}
```

### CR3
**Read this code. What's wrong?**

```go
pool, _ := ants.NewPool(10)
defer pool.Release()
pool.Submit(func() {
	defer pool.Release()
	work()
})
```

**A.** `pool.Release()` is called inside a task. Possible deadlock: `Release` signals idle workers and waits for the janitor; the calling worker is one of the workers. May hang or behave unpredictably. Don't release from inside a task.

### CR4
**Read this code. What's wrong?**

```go
func main() {
	pool, _ := ants.NewPool(100)
	defer pool.Release()

	resp := make(chan int)
	for i := 0; i < 1000; i++ {
		_ = pool.Submit(func() {
			resp <- 1
		})
	}
	for i := 0; i < 1000; i++ {
		<-resp
	}
}
```

**A.** `resp` is unbuffered. Workers block on `resp <- 1` if no receiver is ready. Pool's 100 workers all block writing to `resp`, but `main` reads them one at a time. So at most 100 workers in flight; if pool is bigger than channel buffer, they queue up. Buffered channel `resp := make(chan int, 1000)` fixes blocking. Or: `main` reads concurrently while submitters submit.

### CR5
**Read this code. What does it print?**

```go
pool, _ := ants.NewPool(2)
defer pool.Release()
var wg sync.WaitGroup
for i := 1; i <= 5; i++ {
	wg.Add(1)
	i := i
	_ = pool.Submit(func() {
		defer wg.Done()
		fmt.Println(i)
		time.Sleep(100 * time.Millisecond)
	})
}
wg.Wait()
```

**A.** Prints `1 2 3 4 5` in some order (each line on its own). Pool of 2 means 2 run at a time. With 5 tasks of 100 ms each, total time ~300 ms.

Order is not guaranteed. Could be `1 2 3 4 5` or `2 1 4 3 5` or any permutation that respects the 2-at-a-time constraint.

---

## Performance

### P1
**You see `ants.(*Pool).Submit` at 15% of CPU in pprof. The pool is busy. Is this a problem?**

**A.** Depends on workload. If you're doing 10M submits/sec with trivial tasks, 15% in `Submit` is fine — submit is your hottest loop. If your tasks should dominate (each is 1 ms), 15% means high contention or many tiny submits. Investigate.

### P2
**You upgrade Go from 1.20 to 1.22. Pool throughput drops 5%. What might be the cause?**

**A.** Possibilities:
- GC changes between versions.
- Scheduler changes.
- Loop variable semantics changed; your captured-variable code that was buggy now produces different results that may be slower.
- Compiler optimisations shifted; some functions inline or escape differently.

Diff your benchmarks. Compare pprof. Roll back if regression is unacceptable.

### P3
**`PoolWithFunc` is faster than `Pool` for your workload. By how much would you expect?**

**A.** For trivial tasks (just an atomic increment), 10-30% throughput improvement and noticeable allocation reduction. For non-trivial tasks (>10 µs each), the difference disappears in the noise.

### P4
**How would you measure pool overhead?**

**A.** Two benchmarks:
1. Workload through pool.
2. Same workload inline (no pool).

Difference is the pool overhead. Typically <5% for non-trivial tasks.

### P5
**Your pool's `runtime.lock_slow` is high in pprof. What do you try?**

**A.** Migrate from `Pool` to `MultiPool` with 4-8 shards. The lock is split, contention drops. Validate with a follow-up benchmark.

---

## Design

### D1
**Design a service that ingests 100k events/sec, enriches each, writes to ClickHouse. Use `ants`.**

**A.** Two pools:
- `enrich` (cap 1000): per-event enrichment.
- `write` (cap 50): batched writes.

Tasks: enrich writes to a buffered channel; a batcher goroutine reads, batches 1000, submits to `write`. Write task does the BQ/CH insert.

Scaling: horizontal. Each pod handles ~20k events/sec. 5 pods for 100k.

Detail in `professional.md` extended case study.

### D2
**Design a multi-tenant API gateway that uses `ants` for backend calls.**

**A.** One pool per tenant (or per tier if too many tenants). Each pool sized to that tenant's downstream tolerance.

```go
type Gateway struct {
	tenantPools map[string]*ants.Pool
	mu          sync.RWMutex
}

func (g *Gateway) Call(tenant string, req Request) (Response, error) {
	pool := g.poolFor(tenant)
	// ...
}
```

Add per-tenant rate limiter for fair sharing within a tier.

### D3
**Your service uses `ants` and is being k8s-pod-autoscaled. The HPA scales on CPU. What's the relationship between HPA, pool, and `GOMAXPROCS`?**

**A.** Each pod has its own pool. HPA scales pods. `GOMAXPROCS` per pod = container CPU limit (use `automaxprocs`). Pool cap is config-driven, sized per pod.

Total cluster concurrency = `numPods * poolCap`. HPA adjusts `numPods`. Pool cap is fixed per pod.

If pool is consistently saturated, HPA adds pods; pool stays at the same cap.

### D4
**You want to add tracing to every pooled task. Design.**

**A.** Wrap `Submit`:

```go
func submitTraced(ctx context.Context, p *ants.Pool, name string, task func(context.Context)) error {
	return p.Submit(func() {
		ctx, span := tracer.Start(ctx, name)
		defer span.End()
		task(ctx)
	})
}
```

Span starts when worker picks up task. Worker can be milliseconds after submit if pool is saturated.

For "submit-to-start" latency, also wrap with `tracer.Start(ctx, "submit-wait")` before `p.Submit`.

### D5
**Your service has a `/health` endpoint. Pool health is part of it. Design.**

**A.** Healthy = pool not closed, has some free capacity.

```go
http.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
	if pool.IsClosed() {
		w.WriteHeader(503)
		return
	}
	if pool.Free() == 0 {
		w.WriteHeader(503)
		return
	}
	w.WriteHeader(200)
})
```

LB removes the pod from rotation if unhealthy.

---

## Trivia

### T1
**Who maintains `ants`?**

**A.** Andy Pan (`panjf2000`). The library has community contributors but Andy is the primary maintainer.

### T2
**What is the license?**

**A.** BSD-2-Clause. Permissive; you can use in commercial software.

### T3
**Roughly how many lines of code is `ants`?**

**A.** ~1500 lines for the v2 package (excluding tests). Tests add a few thousand more.

### T4
**What's the meaning of "ants"?**

**A.** Andy Pan's chosen name. Suggested: like real ants, each goroutine is small but a colony does big work.

### T5
**Is `ants` used by any well-known projects?**

**A.** Yes — `panjf2000/gnet` (network framework), several Tencent/Bytedance backends, and many open-source Go projects. The README lists known users.

---

## Final

### F1
**If you had to recommend `ants` or `errgroup` for a colleague's new project, what's your decision tree?**

**A.**
- Long-lived service with sustained high task rate → `ants`.
- One-off batch with first-error short-circuit → `errgroup`.
- Both → combine: `errgroup` for cancellation/errors, `ants` for worker reuse.
- Just need bounded concurrency for batch with no error semantics → `semaphore`.

### F2
**You're code-reviewing a PR that introduces `ants`. What do you check first?**

**A.** First: `defer pool.Release()` (or `ReleaseTimeout`). Without it, every other concern is moot.

Then: panic handler, error handling, context propagation, cap rationale, observability.

### F3
**You're tutoring a junior. What single thing must they learn first about `ants`?**

**A.** "Always defer `Release` right after `NewPool`." Most other mistakes are recoverable; missing `Release` always leaks.

### F4
**If you could change one thing about `ants`'s API, what would it be?**

**A.** Add `context.Context` to `Submit`. The library's deliberate omission means every user reimplements context-aware submit slightly differently. Standardising this would reduce subtle bugs.

(Counterargument: would complicate the hot path. The maintainers chose stability over feature; reasonable.)

### F5
**Why does this section exist?**

**A.** Interview practice. Reading is one thing; explaining out loud is another. The questions push you to articulate concepts you may have understood passively. Practice with a colleague.

---

## End

These 50+ questions cover the breadth of `ants` understanding from junior to staff. In a real interview, you might be asked 3-5 of these depending on the seniority of the role. Practice answering each in 2-3 minutes.

---

