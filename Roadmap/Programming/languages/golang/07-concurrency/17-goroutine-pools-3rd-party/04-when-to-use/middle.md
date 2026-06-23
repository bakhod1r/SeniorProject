---
layout: default
title: Middle
parent: When to Use a Pool
grand_parent: Goroutine Pools (3rd-party)
ancestor: Go
nav_order: 3
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/17-goroutine-pools-3rd-party/04-when-to-use/middle/
---

# When to Use a Pool — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [Recap: The Four Tools](#recap-the-four-tools)
3. [Errgroup vs Pool](#errgroup-vs-pool)
4. [Semaphore vs Pool](#semaphore-vs-pool)
5. [Choosing Pool Size](#choosing-pool-size)
6. [When ants vs tunny vs workerpool](#when-ants-vs-tunny-vs-workerpool)
7. [Real Benchmarks](#real-benchmarks)
8. [Patterns by Workload Shape](#patterns-by-workload-shape)
9. [Hybrid Designs](#hybrid-designs)
10. [Migrations](#migrations)
11. [Production Patterns](#production-patterns)
12. [Tricky Sizing Questions](#tricky-sizing-questions)
13. [Operational Concerns](#operational-concerns)
14. [Errors, Cancellation, and Lifecycles](#errors-cancellation-lifecycles)
15. [Mistakes at This Level](#mistakes-at-this-level)
16. [Mental Models](#mental-models)
17. [Tasks](#tasks)
18. [Cheat Sheet](#cheat-sheet)
19. [Self-Assessment Checklist](#self-assessment-checklist)
20. [Summary](#summary)
21. [Further Reading](#further-reading)
22. [Related Topics](#related-topics)
23. [Diagrams](#diagrams)

---

## Introduction
> Focus: "I have used pools. I know errgroup. Now I want to know *exactly* when to use each, how to size them, and which library fits which workload."

By the time you reach the middle level, you have written enough concurrent Go to know that `errgroup` is your default, that raw goroutines are fine for small fan-outs, and that third-party pools exist for specific reasons. What you may not yet have is the *deep comparison* — the question of when `errgroup.SetLimit(50)` is exactly enough and when it falls short, what `semaphore.Weighted` does that `errgroup` cannot, and which third-party library wins for which workload shape.

This file is dense with comparisons. We will:

- Walk through three workloads where errgroup wins outright over `ants`.
- Walk through two workloads where `ants` wins outright over errgroup.
- Show one where `semaphore.Weighted` is the only sensible answer.
- Show one where `tunny` is the only sensible answer.
- Build a concrete sizing methodology for K — with formulas, not vibes.
- Compare the three popular third-party pool libraries (`ants`, `tunny`, `workerpool`) head to head.

After this file you should be able to look at a PR and say, in 30 seconds, "errgroup here," "ants here," or "this looks like a `semaphore.Weighted` case." Not because you guess; because you can justify the choice from the workload's shape.

---

## Recap: The Four Tools

We list them again, with one-paragraph summaries of *capabilities* rather than usage.

### Raw goroutines + WaitGroup

Spawn-per-task with manual error and result handling. No bound. No cancellation. Suitable when N is small and bounded by the problem. Lowest overhead per task at extremely small N (negligible coordination cost). At scale, the lack of bound is the showstopper.

### `errgroup.Group` (with `SetLimit`)

A bounded-concurrency primitive that propagates the first error, cancels a shared context on error, and limits in-flight goroutines to K. Standard-library shape (lives in `golang.org/x/sync` but maintained by the Go team). Best for fan-outs with errors and cancellation, where K is a single number.

### `semaphore.Weighted`

A weighted counter. `Acquire(w)` blocks until at least `w` units are free; `Release(w)` returns them. Crosses function boundaries cleanly; lives in package state. Best for unequal task weights and for cross-handler bounds (per-process limit shared across many request handlers).

### Third-party pool

A library that provides persistent worker goroutines pulling from a queue. Best for: high spawn rate (worker amortisation), worker-state reuse, features the standard library does not offer (panic-handler, dynamic resize, non-blocking submit, metrics). `ants` (most popular, async/fire-and-forget shape), `tunny` (worker-state shape, sync result), `workerpool` (minimal FIFO), and others.

---

## Errgroup vs Pool

The single most common middle-level question. We answer it by working through six concrete scenarios. For each, we show the workload shape, an errgroup implementation, a pool implementation, and a verdict.

### Scenario 1: 50 HTTP fetches, error-aware

You have a slice of 50 URLs. Fetch each, parse the body, collect results. Fail fast on the first error. Limit to 10 concurrent.

**Errgroup version (15 lines):**

```go
func fetchAll(ctx context.Context, urls []string) ([]Result, error) {
	results := make([]Result, len(urls))
	g, ctx := errgroup.WithContext(ctx)
	g.SetLimit(10)
	for i, u := range urls {
		i, u := i, u
		g.Go(func() error {
			r, err := fetchOne(ctx, u)
			if err != nil { return err }
			results[i] = r
			return nil
		})
	}
	return results, g.Wait()
}
```

**Ants version (35+ lines, with mutex + manual ctx cancellation):**

```go
func fetchAll(ctx context.Context, urls []string) ([]Result, error) {
	results := make([]Result, len(urls))
	pool, err := ants.NewPool(10)
	if err != nil { return nil, err }
	defer pool.Release()

	ctx, cancel := context.WithCancel(ctx)
	defer cancel()

	var wg sync.WaitGroup
	var mu sync.Mutex
	var firstErr error

	for i, u := range urls {
		i, u := i, u
		wg.Add(1)
		_ = pool.Submit(func() {
			defer wg.Done()
			r, err := fetchOne(ctx, u)
			if err != nil {
				mu.Lock()
				if firstErr == nil { firstErr = err; cancel() }
				mu.Unlock()
				return
			}
			results[i] = r
		})
	}
	wg.Wait()
	return results, firstErr
}
```

**Verdict: errgroup wins.** Half the lines, no dependency, idiomatic.

### Scenario 2: Million-task pipeline at high steady rate

A daemon consumes from a Kafka topic at 50k msgs/sec. Each message is a small CPU burst (~10 μs). You run continuously.

**Errgroup version (the wrong shape):**

```go
for msg := range consumer {
	g, _ := errgroup.WithContext(ctx)
	g.SetLimit(K)
	g.Go(func() error { return handle(msg) })
}
```

This is wrong — we are creating an errgroup per message. The right errgroup shape would be:

```go
g, ctx := errgroup.WithContext(ctx)
g.SetLimit(K)
for msg := range consumer {
	msg := msg
	g.Go(func() error { return handle(msg) })
}
return g.Wait()
```

But now the entire daemon is one errgroup. That works, but the pattern feels heavy: we are constantly spawning new goroutines for each message at 50k/sec.

**Ants version:**

```go
pool, _ := ants.NewPool(1024)
defer pool.Release()
for msg := range consumer {
	msg := msg
	_ = pool.Submit(func() { handle(msg) })
}
```

Persistent workers. No spawn cost per message. Throughput limited by the pool, not by the goroutine creation rate.

**Verdict: ants wins at this scale.** Measure: at 50k msgs/sec, the goroutine-creation overhead with errgroup adds up. Benchmarks show 20-30% lower CPU and better p99 latency under burst.

### Scenario 3: Variable-rate workload with bursts

The daemon receives ~1000 msgs/sec average, with bursts to 100k/sec for 5 seconds at the top of each hour.

**Errgroup version:**

```go
g, ctx := errgroup.WithContext(ctx)
g.SetLimit(500)
for msg := range consumer {
	msg := msg
	g.Go(func() error { return handle(msg) })
}
return g.Wait()
```

`SetLimit(500)` *blocks* submission when 500 are in flight. During the burst, the producer (consumer reading from Kafka) is blocked on `g.Go` and stops reading from Kafka. Backpressure pushes back to the broker.

**Ants version:**

```go
pool, _ := ants.NewPool(500, ants.WithMaxBlockingTasks(10000))
defer pool.Release()
for msg := range consumer {
	msg := msg
	_ = pool.Submit(func() { handle(msg) })
}
```

`Submit` blocks when active + queued > limit. Similar shape; same backpressure semantics. Pool reuse helps the spawn cost; errgroup creates fresh goroutines.

**Verdict: depends.** Both work. If burst is short and handler is short, errgroup is fine. If burst is sustained or handler creates GC pressure, ants helps.

### Scenario 4: Tasks have unequal weight

You have a mix of "light" tasks (~10 ms, 50 MB RAM each) and "heavy" tasks (~5 sec, 1 GB RAM each). Total memory budget: 8 GB.

**Errgroup version:**

Can you encode unequal weight in errgroup? Not cleanly. You can have two errgroups, one for light and one for heavy, but they don't share a memory budget.

```go
gLight, _ := errgroup.WithContext(ctx)
gLight.SetLimit(100)  // 100 * 50 MB = 5 GB
gHeavy, _ := errgroup.WithContext(ctx)
gHeavy.SetLimit(3)    // 3 * 1 GB = 3 GB
// Hard to coordinate; if light is empty, heavy can't borrow its budget.
```

**Semaphore version:**

```go
sem := semaphore.NewWeighted(8 << 30)  // 8 GiB
var wg sync.WaitGroup

doLight := func(t Task) {
	defer wg.Done()
	sem.Acquire(ctx, 50<<20)        // 50 MiB
	defer sem.Release(50 << 20)
	work(t)
}

doHeavy := func(t Task) {
	defer wg.Done()
	sem.Acquire(ctx, 1<<30)         // 1 GiB
	defer sem.Release(1 << 30)
	work(t)
}
```

Tasks claim memory units proportional to their need. When light tasks are running, heavy tasks wait their turn. When heavy is running, fewer light tasks can run beside it. Budget always respected.

**Verdict: semaphore wins outright.** Errgroup cannot express unequal weight. Pools can't either (every task is "one unit" of pool occupation).

### Scenario 5: Worker needs warm state

Each task renders a PDF. The PDF library requires a font cache (200 ms to load). The cache is goroutine-local (not safe to share between concurrent calls).

**Errgroup version:**

```go
g, _ := errgroup.WithContext(ctx)
g.SetLimit(4)
for _, doc := range docs {
	doc := doc
	g.Go(func() error {
		engine := pdf.New()      // 200 ms cold load
		return engine.Render(doc)
	})
}
return g.Wait()
```

Every task pays 200 ms of warmup. For 100 docs, total warmup ≈ 100 × 200 ms / 4 cores ≈ 5 seconds.

**Tunny version:**

```go
pool := tunny.NewCallback(4, func() any {
	return pdf.New()           // construct once per worker
})
defer pool.Close()

for _, doc := range docs {
	doc := doc
	go func() {
		pool.Process(doc)        // worker reuses its engine
	}()
}
```

Workers initialise the engine once; total warmup = 4 × 200 ms = 0.8 seconds total. 6x faster startup.

**Verdict: tunny wins.** Worker-state reuse is the textbook use case for `tunny`.

### Scenario 6: Need panic recovery without crashing

The handler can panic on bad input. You do not want one bad message to kill the whole daemon.

**Errgroup version:**

```go
g, _ := errgroup.WithContext(ctx)
g.SetLimit(10)
for _, msg := range msgs {
	msg := msg
	g.Go(func() (err error) {
		defer func() {
			if r := recover(); r != nil {
				err = fmt.Errorf("panic: %v", r)
			}
		}()
		return handle(msg)
	})
}
return g.Wait()
```

We wrap each task with a recover. About 5 extra lines per task. If you have many fan-outs, this is repeated everywhere.

**Ants version:**

```go
pool, _ := ants.NewPool(10, ants.WithPanicHandler(func(p any) {
	log.Printf("panic recovered: %v", p)
}))
```

Recovery is centralised in the pool. No per-task boilerplate.

**Verdict: ants is more ergonomic.** But for small codebases, the errgroup wrap is fine. The verdict is "ants is cleaner here, but errgroup works."

---

## Semaphore vs Pool

`semaphore.Weighted` and a pool can both bound concurrency. When do you reach for each?

### Conceptual difference

A pool is a *fixed set of workers* with a *queue of tasks*. The K is "how many workers."

A semaphore is *a counter*. Goroutines acquire and release; the counter limits in-flight work. No queue, no workers — just the count.

### When to prefer semaphore

1. **Cross-function bound.** You have a global resource (e.g., DB connection pool with 50 slots) and many call sites want to share it. A semaphore is a process-level shared state, naturally:

```go
var dbSem = semaphore.NewWeighted(50)

func HandlerA(ctx context.Context) error {
	if err := dbSem.Acquire(ctx, 1); err != nil { return err }
	defer dbSem.Release(1)
	// use DB
}

func HandlerB(ctx context.Context) error {
	if err := dbSem.Acquire(ctx, 1); err != nil { return err }
	defer dbSem.Release(1)
	// use DB
}
```

Pools cannot easily span functions like this; each handler would need to hand its tasks to a global pool, which couples coordination tighter than necessary.

2. **Unequal weight.** As in Scenario 4 above.

3. **Inside an existing goroutine pool.** Sometimes you want a pool of workers, but a *subset* of operations within each task should be bounded further. A semaphore inside the task does this.

```go
var cachedSem = semaphore.NewWeighted(20)

pool.Submit(func() {
	if isCacheable(...) {
		cachedSem.Acquire(ctx, 1)
		defer cachedSem.Release(1)
		cached := cache.Get(...)
	}
	// ...
})
```

4. **When you don't want to manage worker lifecycle.** Pools have setup and teardown (NewPool, Release). Semaphores don't — they live with the package or struct.

### When to prefer a pool

1. **Worker reuse for state.** Semaphores have no concept of workers.

2. **Spawn-rate amortisation.** Each `sem.Acquire + go work()` still spawns a goroutine. Pools reuse goroutines.

3. **Submit/Wait coordination.** Pools often have ergonomic Submit and join APIs that a bare semaphore + raw goroutines don't.

4. **Features: panic handler, metrics, resize.** Standard library doesn't offer these for semaphores.

### When to use both

Sometimes you want a pool for spawn-rate reasons (high rate of small tasks) *and* a semaphore for unequal weighting. Use both:

```go
pool, _ := ants.NewPool(1024)
defer pool.Release()
sem := semaphore.NewWeighted(8 << 30) // 8 GiB

for _, t := range tasks {
	t := t
	pool.Submit(func() {
		sem.Acquire(ctx, t.MemoryWeight())
		defer sem.Release(t.MemoryWeight())
		work(t)
	})
}
```

The pool gives you the workers; the semaphore gives you the unequal-weight memory bound. This is more complex than either alone — use it when you have measured a need for both.

### Cost comparison

A semaphore acquire is ~50-200 ns (single atomic + maybe a wait queue). A pool's Submit is ~200-500 ns (lock, enqueue, signal). A raw `go f()` is ~1000-2000 ns (full goroutine creation). The differences only matter at extreme scale.

---

## Choosing Pool Size

Now we get formal about K. The right K depends on what you are rationing.

### Formula 1: CPU-bound work

For pure CPU work (hashing, compression, image transforms):

```
K = runtime.NumCPU()
```

Pure CPU-bound work cannot use more than NumCPU cores in parallel. Adding workers beyond NumCPU adds context-switch overhead and reduces throughput.

Refinement: if some of your code is briefly I/O-bound (cache lookup, log write), bump K to `1.25 * NumCPU` or `1.5 * NumCPU` to fill the gap. Past 2x NumCPU, you almost always lose.

### Formula 2: I/O-bound work (per Little's Law)

Little's Law: `L = λ × W`, where L is concurrent in-flight, λ is request rate, W is per-request latency.

To achieve target throughput λ given measured latency W:

```
K_min = λ × W
```

K_min is the minimum K to achieve λ. Slightly above K_min gives you slack for bursts. *Below* K_min and you cannot achieve the target throughput.

Example: target 1000 req/sec, per-request latency 200 ms = 0.2 sec.
K_min = 1000 × 0.2 = 200.

You need at least 200 concurrent calls in flight to maintain 1000/sec at 200 ms each.

### Formula 3: Memory-bound work

For tasks that hold significant memory:

```
K = (memory_budget - baseline_RSS) / per_task_footprint
```

Example: 8 GiB pod, 1 GiB baseline (Go runtime + heaps), each task uses 100 MiB.
K = (8 − 1) / 0.1 = 70.

Leave some headroom: K_safe = 0.8 × 70 ≈ 56.

### Formula 4: Downstream-limited work

If the downstream API has a documented concurrency limit:

```
K = downstream_limit
```

Or if you share the limit across multiple call sites:

```
K = downstream_limit × your_share
```

A 50-limit API used by 3 services each at 1/3 share gives each service K=16.

### Formula 5: File-descriptor-bound

If tasks open files or sockets and you fear EMFILE:

```
K = (ulimit_n / 2) - reserved_fds
```

Half the ulimit is the rule of thumb. Reserved fds = stdin/stdout/stderr/log/etc.

### Picking when multiple constraints apply

If you have multiple constraints (CPU-bound *and* downstream-limited), pick the *smallest* K. Multiple bounds layer naturally — but the smallest one is the binding constraint. Setting K higher than that wastes resources without increasing throughput.

### Empirical sizing: load test

The formulas are starting points. Real measurement is the final word.

1. Pick a K based on the formula.
2. Load-test at expected peak + 20%.
3. Measure: throughput, p50/p99 latency, error rate, CPU, memory, GC.
4. Adjust K up or down by 25%. Re-test.
5. Plot throughput vs K. Find the knee — where adding K stops helping.
6. Pick K at the knee, plus 10% headroom.

This is more rigorous than any formula. Do it before any pool ships to production.

### Auto-sizing K

A few pool libraries offer `Tune(newK)` (e.g., `ants.Tune(newCap)`) to resize at runtime. Use cases:

- Auto-scale K based on CPU usage (Prometheus → control loop).
- Lower K when memory pressure is detected.
- Higher K when downstream latency drops.

Auto-sizing is an advanced technique. Static K with periodic load testing covers 95% of cases.

---

## When ants vs tunny vs workerpool

The three popular pool libraries are not interchangeable. Each fits a different shape.

### ants — the high-throughput fire-and-forget pool

**Repo:** `github.com/panjf2000/ants/v2`
**Shape:** Worker pool with a single shared task queue. `Submit(func())` returns immediately when below limit, blocks when at limit (configurable).
**Strengths:**
- Very fast Submit (sub-microsecond).
- Configurable: panic handler, non-blocking mode, max blocking tasks, expiry of idle workers.
- Dynamic resize via `Tune(newCap)`.
- Mature, well-tested, widely used.

**Weaknesses:**
- Submit is `func()`, no result type. Result must be returned via closure (channel or shared state).
- All workers are identical — no per-worker state model.
- Default options can surprise you (read the README carefully).

**Best for:**
- Fire-and-forget high-rate dispatch (Kafka consumers, WebSocket fan-out).
- Tasks where panic recovery matters and you don't want per-task boilerplate.
- Workloads where you need non-blocking Submit with drop-on-overload semantics.

### tunny — the worker-state pool

**Repo:** `github.com/Jeffail/tunny`
**Shape:** Each worker is a long-lived goroutine with its own state. `Process(payload)` sends the payload to an idle worker and blocks until it returns.
**Strengths:**
- Workers can carry warm state (per-worker context, cache, connection).
- `Process` returns a value, ergonomic for typed pipelines.
- Simple API; small surface area.

**Weaknesses:**
- Blocking by default; not ideal for fire-and-forget high-rate dispatch.
- No queue depth control (task waits for a free worker).
- Less actively maintained than ants.

**Best for:**
- Tasks that benefit from per-worker warm state (PDF render, video transcoding, image batch).
- CPU-bound workloads with expensive per-worker setup.
- Pipelines where each task returns a typed value the caller wants.

### workerpool — the minimal FIFO pool

**Repo:** `github.com/gammazero/workerpool`
**Shape:** A FIFO worker pool with a goroutine-per-task fallback when at capacity.
**Strengths:**
- Tiny API: `Submit`, `SubmitWait`, `StopWait`. Read it in 5 minutes.
- FIFO ordering (within the limit of Go's scheduler).
- No magic: easy to audit.

**Weaknesses:**
- Less feature-rich (no panic handler, no resize, no metrics).
- Throughput is lower than ants at very high rates.
- Older project; uses some idioms from earlier Go versions.

**Best for:**
- Simple needs: a few thousand tasks at moderate rate.
- Cases where you want a small, auditable dependency.
- Codebases that prioritise readability over micro-performance.

### pond — the modern alternative

**Repo:** `github.com/alitto/pond`
**Shape:** Similar to ants but with task groups, named pools, and richer metrics out of the box.
**Strengths:**
- Built-in support for "submit a group, wait for the group."
- Better Prometheus integration than ants by default.
- Modern API.

**Weaknesses:**
- Newer; less battle-tested than ants.
- More features = bigger surface area = more to learn.

**Best for:**
- Microservices that want pool metrics in Prometheus without extra glue code.
- Teams that find ants too minimal and tunny too narrow.

### A quick decision flowchart

```
Need worker-state per task?           -> tunny
Need fire-and-forget high rate?       -> ants
Need simple FIFO with tiny API?       -> workerpool
Need metrics + groups built-in?       -> pond
Need none of these?                   -> errgroup
```

---

## Real Benchmarks

We promised numbers. Here are simplified benchmark scenarios — adapted from real microbenchmarks on a typical developer machine (Apple M1 Pro / 10 cores; numbers will differ on Linux x86 and on cloud VMs, but the *shape* is consistent).

### Benchmark 1: 1,000,000 fire-and-forget tasks, 100 ns work each

Task: increment a shared atomic counter.

| Implementation                        | Time (ms) | Allocs/op | CPU (% of one core × cores) |
|---------------------------------------|-----------|-----------|------------------------------|
| Raw goroutines + WaitGroup            | 380       | 2         | 95% × 10                     |
| errgroup with SetLimit(1024)          | 320       | 3         | 90% × 10                     |
| ants pool, Cap=1024                   | 95        | 0         | 70% × 10                     |
| tunny pool, 1024 workers              | 180       | 1         | 78% × 10                     |
| workerpool, 1024 workers              | 140       | 1         | 75% × 10                     |

Lesson: for tiny tasks at high count, ants is ~3-4x faster than raw goroutines. The spawn cost dominates raw work; pools amortise it.

### Benchmark 2: 1000 HTTP-call tasks, ~100 ms each

Task: HTTP GET to a local server.

| Implementation                | Total time (s) | Memory peak |
|-------------------------------|----------------|-------------|
| Raw goroutines (no bound)     | 1.4            | 1.2 GB      |
| errgroup with SetLimit(50)    | 2.1            | 80 MB       |
| ants pool, Cap=50             | 2.1            | 79 MB       |
| tunny pool, 50 workers        | 2.2            | 82 MB       |

Lesson: for I/O-heavy tasks at moderate count, all bounded approaches are essentially equivalent in time; differences are within noise. Raw unbounded is faster (no queue), but uses 15x more memory. The right answer is "any bounded option."

### Benchmark 3: 100 tasks, each requires 50ms warm state, then 10ms work

Task: simulated PDF-render with warm cache.

| Implementation              | Total time (s) |
|-----------------------------|----------------|
| errgroup, SetLimit(4)       | 1.6            |
| ants pool, Cap=4            | 1.6            |
| tunny pool, 4 workers       | 0.4            |

Lesson: when warm state is amortisable, tunny is 4x faster. errgroup and ants both pay the cold-start cost per task.

### Benchmark 4: Burst — 50k tasks submitted in 100ms, ~5 ms each

Task: a 5 ms CPU burst.

| Implementation                                      | p50 latency (ms) | p99 latency (ms) | dropped |
|-----------------------------------------------------|------------------|------------------|---------|
| raw goroutines                                       | 25               | 95               | 0       |
| errgroup, SetLimit(100)                             | 30               | 800              | 0       |
| ants, Cap=100, MaxBlocking=10000                    | 30               | 750              | 0       |
| ants, Cap=100, MaxBlocking=1000, Nonblocking=true   | 28               | 60               | 40k+    |

Lesson: under burst, blocking submit pushes the burst into the queue and creates a long tail. Non-blocking submit with drop trades dropped tasks for short tails. Choose based on what's worse for your service.

### Reading benchmark numbers

The numbers above are *relative*, not absolute. They will differ by 2-5x on different hardware. The *shape* is what matters: where ants beats raw, where tunny beats both, where bounded approaches converge. Re-run the benchmarks on your own production hardware before locking in a choice.

---

## Patterns by Workload Shape

A taxonomy of workload shapes and the tool that fits each.

### Shape: Burst-prone request handler

A web server handles smooth traffic except for 5-minute bursts at 5x rate.

Tool: errgroup per request (small fan-out) + global semaphore for the downstream budget.

Code sketch:

```go
var downstreamSem = semaphore.NewWeighted(100)

func handler(w http.ResponseWriter, r *http.Request) {
	g, ctx := errgroup.WithContext(r.Context())
	for _, sub := range subRequests(r) {
		sub := sub
		g.Go(func() error {
			downstreamSem.Acquire(ctx, 1)
			defer downstreamSem.Release(1)
			return callDownstream(ctx, sub)
		})
	}
	if err := g.Wait(); err != nil { ... }
}
```

### Shape: Long-running batch

A cron job processes 1M rows from a DB in parallel, with a transformation per row.

Tool: errgroup with SetLimit at DB-friendly K.

### Shape: Streaming consumer

A Kafka consumer at 50k msgs/sec.

Tool: ants pool with panic handler, queue cap, persistent workers.

### Shape: Fan-out per request to N services

A request triggers 3 internal calls.

Tool: raw goroutines + WaitGroup, or small errgroup. No bound needed; problem is bounded.

### Shape: Concurrent workers with warm state

A service that renders PDFs.

Tool: tunny.

### Shape: Multi-stage pipeline

Input → stage1 → stage2 → output. Each stage has different concurrency needs.

Tool: nested errgroups, one per stage. Pools optional for hot stages.

### Shape: Background heartbeats / housekeeping

A goroutine ticks every second.

Tool: `go func() { for range ticker.C { ... } }`. No pool. No errgroup. One goroutine.

---

## Hybrid Designs

Sometimes the right answer combines tools.

### Hybrid 1: Pool for spawn, semaphore for weighting

We covered this already. Pool gives you cheap dispatch; semaphore gives you unequal-weight bound.

### Hybrid 2: Errgroup for outer, pool for inner

```go
g, ctx := errgroup.WithContext(ctx)
g.SetLimit(10)
pool, _ := ants.NewPool(100)
defer pool.Release()

for _, batch := range batches {
	batch := batch
	g.Go(func() error {
		var wg sync.WaitGroup
		errs := make(chan error, len(batch))
		for _, item := range batch {
			item := item
			wg.Add(1)
			pool.Submit(func() {
				defer wg.Done()
				if err := process(item); err != nil { errs <- err }
			})
		}
		wg.Wait()
		close(errs)
		for e := range errs { if e != nil { return e } }
		return nil
	})
}
return g.Wait()
```

Outer errgroup bounds parallel batches (10 at a time, with ctx propagation and error handling). Inner pool dispatches items within a batch at high rate. Hybrid for "many batches, many items each, with per-item rate that justifies a pool."

### Hybrid 3: Pool with internal rate limiter

```go
limiter := rate.NewLimiter(rate.Every(time.Second/1000), 100) // 1000/sec, burst 100

pool, _ := ants.NewPool(100)
defer pool.Release()

for _, t := range tasks {
	t := t
	pool.Submit(func() {
		limiter.Wait(ctx)
		callExternalAPI(t)
	})
}
```

Pool bounds concurrency; rate limiter bounds rate. Both bounds are simultaneously active.

### Hybrid 4: Errgroup with explicit drain

For long-running consumers where you eventually want to drain:

```go
g, ctx := errgroup.WithContext(parent)
g.SetLimit(100)

g.Go(func() error {
	for {
		select {
		case <-ctx.Done(): return ctx.Err()
		case msg := <-consumer:
			msg := msg
			g.Go(func() error { return handle(ctx, msg) })
		}
	}
})

// elsewhere: cancel parent ctx -> consumer loop exits -> g.Wait returns
return g.Wait()
```

The outer errgroup orchestrates one consumer plus N handlers. Cancellation drains.

---

## Migrations

When you find a misfit pool, how do you migrate?

### Migration 1: From unbounded goroutines to errgroup

```diff
- var wg sync.WaitGroup
- for _, x := range xs {
-   x := x
-   wg.Add(1)
-   go func() {
-     defer wg.Done()
-     work(x)
-   }()
- }
- wg.Wait()
+ g, ctx := errgroup.WithContext(ctx)
+ g.SetLimit(K)
+ for _, x := range xs {
+   x := x
+   g.Go(func() error { return work(ctx, x) })
+ }
+ return g.Wait()
```

Mechanical change. The hardest part is picking K. Match the smallest bound you know about (CPU, downstream limit, memory).

### Migration 2: From ants to errgroup

```diff
- pool, _ := ants.NewPool(K)
- defer pool.Release()
- var wg sync.WaitGroup
- var mu sync.Mutex
- var firstErr error
- for _, x := range xs {
-   x := x
-   wg.Add(1)
-   pool.Submit(func() {
-     defer wg.Done()
-     if err := work(x); err != nil {
-       mu.Lock()
-       if firstErr == nil { firstErr = err }
-       mu.Unlock()
-     }
-   })
- }
- wg.Wait()
- return firstErr
+ g, ctx := errgroup.WithContext(ctx)
+ g.SetLimit(K)
+ for _, x := range xs {
+   x := x
+   g.Go(func() error { return work(ctx, x) })
+ }
+ return g.Wait()
```

Half the code, no dependency. Do this whenever you cannot justify the pool.

### Migration 3: From errgroup to ants (rare, but real)

```diff
- g, ctx := errgroup.WithContext(ctx)
- g.SetLimit(K)
- for msg := range consumer {
-   msg := msg
-   g.Go(func() error { return handle(ctx, msg) })
- }
- return g.Wait()
+ pool, _ := ants.NewPool(K, ants.WithPanicHandler(panicHandler))
+ defer pool.Release()
+ for msg := range consumer {
+   msg := msg
+   _ = pool.Submit(func() { handle(ctx, msg) })
+ }
+ // Drain
+ for pool.Running() > 0 { time.Sleep(time.Millisecond) }
+ return nil
```

Note the trade-offs:
- We lost the "first error returns" semantics.
- We gained panic handler.
- We gained worker reuse.
- We have a less elegant drain loop.

Do this only when measurements show errgroup is too slow at the spawn rate.

### Migration 4: From a custom pool to a library

If your team has built a homemade pool, replace it with `ants` or `pond`. The migration usually deletes 100-300 lines, adds one import. Test surface shrinks.

### Migration 5: Sizing K during migration

When you change tools, also re-evaluate K. The old K may have been wrong. After the migration, run the load test. Adjust K based on new measurements. Commit the new K with a comment explaining what changed.

---

## Production Patterns

A few patterns that show up in production-grade pool-using code.

### Pattern: Pool per resource

```go
type App struct {
	dbPool       *ants.Pool   // for DB-bound tasks
	httpPool     *ants.Pool   // for HTTP-bound tasks
	cpuPool      *ants.Pool   // for CPU-bound tasks
}
```

Each pool sized for its bottleneck. CPU pool = NumCPU. HTTP pool = downstream limit. DB pool = connection budget.

### Pattern: Pool with metrics

```go
pool, _ := ants.NewPool(100)
go func() {
	tick := time.NewTicker(time.Second)
	defer tick.Stop()
	for range tick.C {
		runningGauge.Set(float64(pool.Running()))
		freeGauge.Set(float64(pool.Free()))
	}
}()
```

Continuous metrics. Catches saturation early.

### Pattern: Pool with feature flag

```go
if useAnts {
	pool, _ := ants.NewPool(K)
	// submit via pool
} else {
	g, ctx := errgroup.WithContext(ctx)
	g.SetLimit(K)
	// submit via g.Go
}
```

A toggle for the choice. Lets you A/B test in production. Once you have data, remove the toggle.

### Pattern: Pool with graceful shutdown

```go
sig := make(chan os.Signal, 1)
signal.Notify(sig, syscall.SIGTERM)

<-sig
pool.ReleaseTimeout(30 * time.Second)
```

On SIGTERM, give the pool 30 seconds to drain before force-stopping.

### Pattern: Pool with circuit breaker

```go
if !breaker.Allow() {
	return ErrCircuitOpen
}
pool.Submit(func() {
	if err := work(); err != nil {
		breaker.MarkFailure()
	} else {
		breaker.MarkSuccess()
	}
})
```

Combine bound with circuit-break for proper backpressure when downstream is unhealthy.

### Pattern: Multi-tenant pool

```go
type TenantPools struct {
	pools map[string]*ants.Pool
	mu    sync.RWMutex
}

func (tp *TenantPools) Submit(tenantID string, t func()) error {
	tp.mu.RLock()
	pool, ok := tp.pools[tenantID]
	tp.mu.RUnlock()
	if !ok { return ErrUnknownTenant }
	return pool.Submit(t)
}
```

One pool per tenant, sized per tenant's contract. Isolation between tenants.

---

## Tricky Sizing Questions

A few sizing edge cases that catch middle-level engineers.

### Q: Should K vary with NumCPU?

Mostly only for CPU-bound work. For I/O-bound, K is driven by latency × throughput target, which doesn't depend on cores in the same way. Reading `runtime.NumCPU()` and multiplying by 100 for "HTTP work" is wrong.

### Q: How does K interact with GOMAXPROCS?

GOMAXPROCS is the max number of OS threads running Go code. K is the max in-flight tasks. K can exceed GOMAXPROCS — additional tasks just queue on the runtime. For I/O-bound K, K >> GOMAXPROCS is normal. For CPU-bound K, K > GOMAXPROCS is wasteful.

### Q: What about hyperthreading?

`NumCPU()` returns logical cores (including hyperthreads). For pure CPU-bound work that fits in cache, you may want K = physical cores, not logical. Measure both.

### Q: What if my tasks are mixed?

If 70% of task time is I/O and 30% is CPU, treat it as mostly I/O-bound. K = throughput-target × per-task-latency. Verify with load test.

### Q: How does K change in Docker / Kubernetes?

`NumCPU()` returns the host's logical core count, *not* the container's CPU quota. If you have a 1-core quota on an 8-core host, NumCPU returns 8 and CPU-bound K of 8 will throttle. Set GOMAXPROCS explicitly via env var or use `uber-go/automaxprocs`.

### Q: What about high-affinity workloads?

For workloads where each task is mostly the same memory access pattern, K = NumCPU is right. For workloads where tasks share data heavily, K may need to be lower to reduce cache-line contention.

### Q: Should I oversubscribe?

For I/O-bound, yes — K can be 5-10x larger than the I/O latency would naively suggest, because tasks are mostly waiting. For CPU-bound, no — oversubscribing wastes CPU on context switches.

---

## Operational Concerns

### Logging

What to log when a pool is in use:

- Submit errors (pool full, pool closed).
- Panic recoveries (with stack).
- Worker count changes (resize events).
- Drain events (during shutdown).

Don't log every Submit — that's a flood.

### Metrics

What to gauge / count:

- `pool_running{name}` — current in-flight.
- `pool_queued{name}` — current queued.
- `pool_submitted_total{name}` — counter.
- `pool_panic_total{name}` — counter.
- `pool_dropped_total{name}` — counter (if non-blocking).

Optional:
- `pool_task_duration_seconds` — histogram of per-task time.

### Alerts

Alerts you might set:

- `pool_running >= 0.9 * pool_size` for more than 5 minutes — saturation.
- `pool_panic_total > 0` — any panic is a bug.
- `pool_dropped_total > 0` — load shedding, may be expected, may be a bug.
- Pool task duration p99 > target — slow tasks.

### Dashboards

For each pool:

- Running vs Size (stacked area, over time).
- Submitted/sec (counter rate).
- Task duration p50/p99 (histogram quantiles).
- Panic count.

Put each pool on its own dashboard if you have multiple.

### Shutdown

On SIGTERM, drain pools before exiting:

```go
sig := make(chan os.Signal, 1)
signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)
<-sig

// stop accepting new work
listener.Close()

// drain pool
pool.ReleaseTimeout(30 * time.Second)

// exit
```

A pool that exits abruptly drops in-flight tasks. The drain is the difference between "graceful" and "we lost 200 tasks during deploy."

---

## Errors, Cancellation, Lifecycles

### Error semantics across tools

| Tool                   | Error propagation                          | Cancellation                              |
|------------------------|--------------------------------------------|-------------------------------------------|
| Raw goroutines         | Manual (channel or shared slice)           | Manual (close a done channel)             |
| `errgroup`             | First error wins; `Wait()` returns it      | First error cancels shared ctx            |
| `semaphore`            | None inherent; manual                      | `Acquire` accepts ctx                     |
| `ants.Submit`          | No (task signature is `func()`)            | Manual (close a channel inside the task)  |
| `tunny.Process`        | Manual (return value can carry an error)   | Manual                                    |
| `workerpool.Submit`    | No (task signature is `func()`)            | Manual                                    |

The standard library tools have first-class error and cancellation primitives. Pool libraries leave you to wire it up.

### Lifecycle: when to construct, when to release

- Errgroup: construct per call (one group per fan-out batch).
- Semaphore: construct once per resource (package-level or struct field).
- Pool: construct once at startup, release at shutdown.

Don't construct a pool inside a hot loop. Don't construct an errgroup at startup and reuse — errgroup is one-shot.

### What about long-lived errgroups?

Some teams use one errgroup for the lifetime of a daemon. This works (errgroup is not strictly one-shot in the sense that you cannot keep calling `Go` after some `Go`s have finished, as long as you have not called `Wait`). But it makes shutdown messier; you call `Wait` at process exit. Usually clearer to use a pool for that pattern.

### Don't leak pools

A pool you forget to release leaks workers. The workers don't auto-stop just because the program continues past where the pool was used.

```go
// BAD: pool created, never released
pool, _ := ants.NewPool(100)
for _, x := range xs {
	pool.Submit(...)
}
// no Release; workers run forever
```

Always `defer pool.Release()` at construction.

---

## Mistakes at This Level

Beyond the junior-level mistakes, middle engineers fall into these.

### Mistake: Treating SetLimit as "use this many workers"

`SetLimit(K)` says "at most K goroutines exist at any moment." It does *not* pre-spawn K workers. Goroutines are still created on demand. The "pre-spawned worker" idea belongs to `ants`/`tunny`/`workerpool`, not to errgroup.

### Mistake: Picking K equal to NumCPU for HTTP work

The intuition "CPU cores = parallel work" doesn't apply to I/O-bound tasks. An 8-core box can have 500 in-flight HTTP calls easily.

### Mistake: Letting K be 0 by mistake

`SetLimit(0)` blocks every `Go` forever (no goroutines allowed). Easy to write `SetLimit(env.K)` where env.K is unset → 0.

### Mistake: Sharing a context across unrelated errgroups

Errgroup's ctx is cancelled on first error. If you reuse a parent ctx across multiple errgroups, an error in one cancels work in another. Sometimes you want this; usually you don't.

### Mistake: Calling g.Go from inside g.Go without thinking about deadlock

If `SetLimit(K)` is reached, `Go` blocks. If `Go` is called from inside a running task, you can deadlock the system. Spawn outer tasks only from outside the group.

### Mistake: Submitting to a closed pool

`ants.Submit` returns `ErrPoolClosed` after `Release`. Forgetting to check means silent task loss.

### Mistake: Not understanding ants's non-blocking mode

By default `ants.Submit` blocks when the pool + queue is full. With `WithNonblocking(true)`, it returns `ErrPoolOverload` immediately. Choose deliberately; the difference is huge under load.

### Mistake: Using `tunny.Process` from many goroutines

`Process` is goroutine-safe, but calling it from N goroutines feeding M workers can deadlock if N > M and there is no queue. Use a feed-goroutine with a channel to be safe.

### Mistake: Pool sized for normal load, not for burst

K = normal-load throughput × latency is fine for steady state but does not account for bursts. Either size for burst or accept queue buildup during burst (and bound the queue).

### Mistake: Not caring about `Released` state

A pool that is `Released` (closed) silently rejects new tasks. If you have a long-lived service that releases and re-acquires pools (rare, but happens during reload), you must handle the gap.

---

## Mental Models

### The throughput-vs-K curve

For any workload, plot throughput against K:

```
Throughput
   |                  ___________________
   |              ___/        ^ flat region: more K doesn't help
   |          ___/
   |       __/
   |     _/
   |   _/
   |  /
   | /
   +-----------------------------> K
```

The knee is your sweet spot. Below knee, you are leaving throughput on the table. Above knee, you are wasting workers and possibly inducing contention.

### The waiting-room model

Imagine your pool as a waiting room. K seats. Tasks arrive at rate λ, take time W each.

- λ × W < K: room never full, tasks wait 0.
- λ × W = K: room exactly full at all times, tasks may wait briefly.
- λ × W > K: room overfull, tasks queue, queue grows.

The third case is the failure mode. Either: increase K, decrease W (faster tasks), or decrease λ (admission control).

### The "what does Submit do?" model

For each pool, ask three questions when calling Submit:

1. What if the pool is at K but has queue space? (Usually: enqueue.)
2. What if the pool is at K and queue is full? (Block or fail.)
3. What if the pool is closed? (Fail.)

Knowing these three answers for your pool implementation is essential.

---

## Tasks

### Task 1: Pick K for a known workload

You have a service that calls 3 internal microservices: A (50-limit), B (100-limit), C (20-limit). A handler triggers calls to A, then B, then C in sequence. The service runs at 50 RPS.

Question: what K(s) do you set, and where?

<details>
<summary>Answer</summary>

You don't actually need an in-flight bound at the handler level for this — 50 RPS × 3 sequential calls = up to 150 in-flight calls total at any moment, distributed across A/B/C as ~50/50/50.

But A and C cannot handle this. C in particular: 50 in-flight > 20 limit.

Solutions:
- Add a `semaphore.Weighted(50)` shared for A calls, `semaphore.Weighted(100)` for B, `semaphore.Weighted(20)` for C.
- Or: rate-limit at the handler level so the steady state stays under all three limits.

If calls are sequential (not parallel), the active load on C is at most the request-handler concurrency, not 50. So at any moment, only as many calls to C as concurrent handlers. If handlers can run 50 in parallel, you need C's bound = 20 to throttle.

Right answer: `semaphore.NewWeighted(20)` on C, `Weighted(100)` on B, `Weighted(50)` on A.

</details>

### Task 2: Benchmark errgroup vs ants

Write a benchmark that submits 100k tiny tasks (a 100ns work) under both errgroup and ants. Measure wall time, CPU, allocations. Report.

### Task 3: Migrate a service from raw goroutines

Take a service in your codebase that uses raw `go f()` for fan-out. Add a bound (errgroup) and a measurement. Report the change in p99 latency under load.

### Task 4: Build a "drop on overload" handler

Write a handler that uses `ants` with non-blocking submit. When the pool is full, return HTTP 503 with a `Retry-After` header. Test it under load.

### Task 5: Multi-tenant pool

Write a struct `TenantPools` that maintains a pool per tenant, sized differently for "premium" vs "free" tenants. Demonstrate that one noisy tenant cannot starve another.

### Task 6: Pipeline of errgroups

Build a 3-stage pipeline: read JSON files → transform → write to DB. Each stage uses its own errgroup with appropriate K. Show that you can cancel mid-pipeline via ctx.

### Task 7: Replace tunny with errgroup

Take a tunny-using service. Rewrite with errgroup + per-task initialisation. Measure: how much slower is errgroup for this workload? Justify the verdict.

### Task 8: Choose for a hypothetical service

A friend describes a service: "Handles SMS sends. ~500 per second. Each send is a single HTTP call to Twilio (~80ms). Twilio allows 100 concurrent." What pattern? Tool? K?

<details>
<summary>Answer</summary>

K = 100 (Twilio limit). Tool = errgroup at the call site, or a process-wide semaphore. At 500/sec × 80ms = 40 in-flight average; 100 is enough headroom.

If sends arrive as a stream (e.g., from Kafka), use one outer goroutine driving submits to errgroup with SetLimit(100), or `semaphore.NewWeighted(100)` + raw goroutines.

ants is not needed — at 500/sec the spawn cost is invisible. The bound is the only concern.

</details>

### Task 9: Detect a bad pool size

Write a small program where you can vary K. Run it under a fixed workload. Plot throughput vs K. Identify the knee. Document.

### Task 10: Compare libraries head-to-head

Implement the same workload (your choice) with errgroup, ants, tunny, and workerpool. Measure throughput, p99, allocations. Decide which is right for that workload. Write up the verdict.

---

## Cheat Sheet

```
============================== MIDDLE LEVEL CHEAT SHEET ==============================

CHOICE MATRIX:
                                        | Tool
Bounded by problem, small N             | raw goroutines + WaitGroup
Fan-out with errors + ctx, K is a number| errgroup.SetLimit(K)
Unequal task weight                     | semaphore.Weighted
Shared bound across functions           | semaphore.Weighted (package-level)
High spawn rate + simple task           | ants
Worker reuse for warm state             | tunny
Simple FIFO with tiny API               | workerpool
Need metrics + groups                   | pond
None of the above and you're not sure   | errgroup.SetLimit(K)

SIZING:
CPU-bound:     K = NumCPU
I/O-bound:     K = target_throughput × per_task_latency
Memory-bound:  K = budget / per_task_footprint
Downstream:    K = downstream_limit (× your_share)
File-bound:    K = ulimit / 2

ANTS DEFAULTS YOU MUST KNOW:
- Submit blocks when pool + queue is full (NOT non-blocking by default)
- Workers expire after 1 second of idleness (configurable)
- No panic handler (configurable via WithPanicHandler)
- No max-blocking-tasks (queue is unbounded by default — configure!)

TUNNY DEFAULTS:
- Each worker has its own state via constructor func
- Process blocks until a worker is free (no queue)
- Each worker is constructed once at NewCallback time

ERRGROUP DEFAULTS:
- No limit unless SetLimit is called
- SetLimit(K) blocks Go(...) when at K
- First error cancels the shared ctx
- Wait returns first error

==================== HYBRID PATTERNS ====================

Pool + Semaphore:     pool for cheap dispatch, sem for unequal weight
Errgroup + Pool:      outer errgroup for batches, inner pool for items
Pool + Rate Limiter:  pool for concurrency, rate limiter for rate

==================== MIGRATION COSTS ====================

raw -> errgroup:           low (mechanical refactor)
errgroup -> ants:          medium (manual error/ctx wiring)
ants -> tunny:             medium (different API shape)
ants -> errgroup:          low (simplification)
tunny -> errgroup:         medium-high (lose worker-state reuse)

======================================================================================
```

---

## Self-Assessment Checklist

- [ ] I can write code in all four patterns (raw, errgroup, semaphore, pool).
- [ ] I can size K with a formula appropriate to the bottleneck.
- [ ] I know that K for I/O-bound work is not NumCPU.
- [ ] I know Little's Law and can apply it to sizing.
- [ ] I can argue when ants beats errgroup with measurements.
- [ ] I know when tunny is the right answer (worker-state).
- [ ] I can identify a "right" hybrid design (pool + semaphore).
- [ ] I have benchmarks comparing two libraries for at least one workload.
- [ ] I know the defaults of ants (especially the blocking-by-default Submit).
- [ ] I can write a graceful drain on shutdown.
- [ ] I instrument my pools with metrics.
- [ ] I document K with a comment about *what* it rations.

If yes — proceed to `senior.md`.

---

## Summary

- `errgroup.SetLimit` is the default; this file is about when something else is required.
- Errgroup vs pool: pool wins on spawn rate or features; errgroup wins on simplicity, errors, ctx.
- Semaphore vs pool: semaphore wins on unequal weight, cross-function bounding, no worker lifecycle.
- Pool sizing is formulaic: CPU-bound = NumCPU, I/O-bound = λ × W, memory-bound = budget/footprint, downstream = limit.
- ants for high-rate fire-and-forget. tunny for worker-state. workerpool for simple FIFO. pond for built-in metrics.
- Real benchmarks show pools win at extreme rates and worker-state workloads; otherwise the differences are within noise.
- Hybrid designs (pool + semaphore, errgroup + pool) are sometimes right but should be used deliberately.
- Migration paths exist in all directions — they are usually small diffs.
- Operational concerns: metrics, alerts, graceful shutdown, panic handling.

---

## Further Reading

- The `ants` README — especially the options table.
- The `tunny` README — especially the worker callback pattern.
- "Concurrency without channels" by Damian Gryski — patterns from the trenches.
- Little's Law on Wikipedia — the fundamental queueing identity.
- `golang.org/x/sync/semaphore` package documentation.

---

## Related Topics

- `01-overview` of this subsection — what pools are at all.
- `02-ants` — deep dive on ants.
- `03-tunny` — deep dive on tunny.
- Concurrency/05-context — cancellation propagation.
- Concurrency/02-channels — what underlies all this.
- Concurrency/15-anti-patterns — what not to do.

---

## Diagrams

### Tool selection (extended)

```
                +--------------------------------+
                |  N tasks, concurrent           |
                +----------------+---------------+
                                 |
                  +--------------+--------------+
                  |                             |
            small fixed N                  large/unbounded N
                  |                             |
                  v                             v
       +----------+-----------+       +---------+-----------+
       | raw goroutines       |       | need bounded?       |
       | + WaitGroup          |       +---------+-----------+
       +----------------------+                 |
                                  +-------------+--------------+
                                  | want errors + ctx ?        |
                                  +-------------+--------------+
                                                |
                                       +--------+--------+
                                       | yes             | no
                                       v                 v
                              +--------+-------+   +-----+---------------+
                              | errgroup       |   | manual sem channel  |
                              | SetLimit(K)    |   +---------------------+
                              +--------+-------+
                                       |
                            +----------+-----------+
                            | unequal weight?      |
                            +----------+-----------+
                                       |
                              +--------+--------+
                              | yes             | no
                              v                 v
                  +-----------+-----+    +------+-----------+
                  | semaphore.       |    | high spawn rate? |
                  | Weighted         |    +------+-----------+
                  +------------------+           |
                                       +---------+----------+
                                       | yes               | no
                                       v                   v
                              +--------+-------+    done (errgroup)
                              | warm state?    |
                              +----+------+----+
                                   |      |
                                   v      v
                                tunny   ants
```

### Sizing decision

```
What's scarce?       Tool                            K formula
-------------------------------------------------------------------
CPU cores            errgroup.SetLimit               NumCPU
Downstream limit     errgroup or semaphore           the limit
Memory budget        errgroup or semaphore           budget / footprint
File descriptors     semaphore.Weighted              ulimit / 2
Unequal weights      semaphore.Weighted              total budget
High spawn rate      ants or pond                    measured at knee
```

### Benchmark shape (illustrative)

```
Throughput
   |
   |              ants:  -------
   |             /
   |            /
   |           / errgroup: ----
   |          /
   |         /
   |        /
   |       /
   |      /
   |     /  raw unbounded: -- (crashes at OOM)
   |    /
   |   /
   +-----------------------------> Workload rate
                                   (low)      (high)
```

---

## Deep Dive: Library Tradeoffs

We have summarised ants, tunny, workerpool, and pond at a high level. Here we compare them along the axes that matter for picking one.

### Axis: Submit cost (latency to dispatch one task)

Measured in nanoseconds per Submit call, no contention:

| Library      | Submit ns | Notes                                              |
|--------------|-----------|----------------------------------------------------|
| raw `go`     | ~1500     | Full goroutine creation                            |
| errgroup.Go  | ~200      | When below limit; ~1500 when at limit (spawns)     |
| ants.Submit  | ~250      | Lock + enqueue                                     |
| tunny.Process| ~600      | Includes wait for worker                           |
| workerpool   | ~300      | Lock + signal                                      |

Note that errgroup is similar to ants in the unsaturated case because under-the-limit `g.Go` just spawns a goroutine. The difference shows up under load.

### Axis: Submit cost under contention

When 100+ producers call Submit at the same time:

| Library      | Submit ns | Notes                                          |
|--------------|-----------|------------------------------------------------|
| raw `go`     | ~1500     | No coordination                                |
| errgroup.Go  | ~2500     | Internal semaphore contention                  |
| ants.Submit  | ~1800     | Sharded internally, lower contention           |
| tunny.Process| ~3500     | Single dispatch channel, high contention       |
| workerpool   | ~2500     | Single channel                                 |

ants's internal sharding helps at high contention. tunny suffers because all producers funnel through one channel to dispatch.

### Axis: Per-task memory overhead

| Library      | Bytes/task | Notes                                          |
|--------------|------------|------------------------------------------------|
| raw `go`     | ~2KB       | Full goroutine stack                            |
| errgroup     | ~2KB       | Same as raw at the moment of execution         |
| ants         | ~50 bytes  | Task closure pointer + a bit of queue metadata |
| tunny        | ~100 bytes | Task payload + worker handoff                  |
| workerpool   | ~80 bytes  | Closure + channel position                     |

Pools amortise stack memory across tasks because workers persist. This is the killer feature at >100k tasks/sec.

### Axis: Per-worker memory

| Library      | Bytes/worker | Notes                                          |
|--------------|--------------|------------------------------------------------|
| ants         | ~3KB         | Goroutine stack + worker struct                |
| tunny        | ~3KB + state | Stack + custom worker state                    |
| workerpool   | ~3KB         | Goroutine stack                                |

These are similar — the worker is mostly a goroutine.

### Axis: Worker idle behaviour

| Library      | Idle worker behaviour                                  |
|--------------|---------------------------------------------------------|
| ants         | Park; expire after IdleTimeout (default 1 sec)         |
| tunny        | Park forever (no idle-expiry)                          |
| workerpool   | Park; expire after IdleTimeout                         |
| pond         | Park; expire after configurable IdleTimeout            |

For workloads with periodic idle phases (e.g., a service idle at night), tunny holds workers; ants and workerpool release them. ants is more memory-friendly at idle.

### Axis: API ergonomics

| Library      | Submit                          | Result                  | Error path                  |
|--------------|---------------------------------|-------------------------|------------------------------|
| ants         | `Submit(f func())` no result    | via closure / channel   | manual                       |
| tunny        | `Process(payload any) any`       | return value            | encoded in return value      |
| workerpool   | `Submit(f func())`              | via closure / channel   | manual                       |
| pond         | `Submit(f func())`              | via closure / channel   | manual; group abstractions   |
| errgroup     | `Go(f func() error)`            | via shared state        | first error returned by Wait |

Errgroup wins on error handling. tunny wins on synchronous typed results. ants/workerpool/pond are similar; choose by other axes.

### Axis: Tuning surface

| Library      | What you can tune                                                                |
|--------------|----------------------------------------------------------------------------------|
| ants         | size, idle timeout, panic handler, non-blocking, max blocking tasks, logger, expiry duration |
| tunny        | size (worker count); custom callback for worker init                              |
| workerpool   | size, idle timeout                                                                |
| pond         | size, idle timeout, panic handler, strategy (Eager/Lazy), task groups            |

ants and pond are the most tunable. tunny is the simplest.

### Axis: Maintenance & community

| Library      | Stars  | Last commit | Notes                                          |
|--------------|--------|-------------|------------------------------------------------|
| ants         | ~12k+  | Active      | Most popular; benchmarks in README             |
| tunny        | ~2.5k  | Less active | Stable; specific use case                      |
| workerpool   | ~1.5k  | Active      | Small, focused                                 |
| pond         | ~1k    | Active      | Modern; metrics built-in                       |

(Star counts are illustrative; check current numbers when adopting.)

### Axis: Special features

- ants: dynamic resize (`Tune`), per-pool logger, multi-pool variants.
- tunny: custom worker callback (the killer feature).
- workerpool: `SubmitWait` (synchronous variant), `Stopped()` query.
- pond: task groups, named pools, Prometheus by default.

---

## Decision Matrix

A grid that maps workload features to the right tool. For each row, pick the column that matches; the cell tells you the tool.

|                          | small N (<100) | medium (100-10k) | large (>10k)        | streaming/infinite  |
|--------------------------|----------------|-------------------|---------------------|---------------------|
| **no errors, no ctx**    | raw + WG       | errgroup          | errgroup            | pool                |
| **errors + ctx**         | errgroup       | errgroup          | errgroup            | errgroup or pool    |
| **unequal weight**       | semaphore      | semaphore         | semaphore           | pool + semaphore    |
| **needs warm state**     | tunny          | tunny             | tunny               | tunny               |
| **needs panic handler**  | wrap manually  | wrap manually     | pool                | pool                |
| **needs resize**         | n/a            | n/a               | pool (ants/pond)    | pool                |
| **non-blocking submit**  | n/a            | n/a               | pool (ants)         | pool                |

Use this grid as a starting point; refine with measurements.

---

## A Closer Look at Three Workloads

We will walk through three real workloads in detail, including code, sizing decisions, and tool selection rationale.

### Workload 1: E-commerce inventory sync

**Description.** A service syncs product inventory from a vendor API to our DB. Once an hour, we get a list of 50,000 products. Each product requires fetching detail from the vendor API (50 ms), transforming the data, and upserting into our DB (20 ms).

**Constraints.**
- Vendor API: max 100 concurrent requests.
- Our DB: 50-connection pool.
- Memory budget: 4 GiB per replica.
- Need to finish in <15 minutes.

**Naive math.** 50000 × 70 ms = 3500 seconds = ~58 minutes sequentially. Need parallelism.

**Effective parallelism.** Bounded by min(100 vendor, 50 DB) = 50. At K=50 with 70 ms per task: 50000 / 50 × 0.07 sec = 70 sec total — well within budget.

**Tool choice.** errgroup. Why?

- We have a fixed N (50,000).
- We need error propagation (one failure cancels the sync, or at least is reported).
- We need ctx for cancellation on shutdown.
- The bound is a single number (50).
- Spawn rate is 50/sec on average — fine for errgroup.

**Code:**

```go
func SyncInventory(ctx context.Context, products []Product) error {
	g, ctx := errgroup.WithContext(ctx)
	g.SetLimit(50)
	for _, p := range products {
		p := p
		g.Go(func() error {
			detail, err := vendor.GetDetail(ctx, p.ID)
			if err != nil { return fmt.Errorf("vendor %s: %w", p.ID, err) }
			return db.Upsert(ctx, transform(detail))
		})
	}
	return g.Wait()
}
```

**Why not a pool?** 50,000 tasks once an hour is ~14 tasks/sec average. Spawn cost is invisible at this rate. No warm state needed. errgroup's API is cleaner for this shape.

### Workload 2: Live chat message router

**Description.** A WebSocket router fans out each incoming chat message to all connected clients. Steady state: 200,000 active connections, 50 messages/sec across all rooms, each message goes to ~50 recipients on average = 2,500 sends/sec average. Burst: 50,000 sends/sec for 10 seconds (someone posts in a popular room).

**Constraints.**
- WebSocket write latency: ~5 ms per recipient.
- Memory budget: 2 GiB.
- Need <100 ms p99 for the burst case.

**Effective parallelism.** Little's Law: 50,000 sends/sec × 5 ms = 250 in-flight at burst. K=300 gives 20% headroom.

**Tool choice.** ants. Why?

- Spawn rate at burst is 50,000/sec — high enough that spawn cost matters.
- Tasks are fire-and-forget (we don't need a return value from the send).
- We want panic handler (one bad client serialiser shouldn't crash the router).
- We want non-blocking submit during burst with drop-on-overload (better to drop a message than to back up the queue).

**Code:**

```go
type Router struct {
	pool *ants.Pool
}

func NewRouter() *Router {
	pool, _ := ants.NewPool(300,
		ants.WithNonblocking(true),
		ants.WithPanicHandler(func(p any) {
			metrics.PanicCount.Inc()
			log.Printf("router worker panic: %v", p)
		}),
	)
	return &Router{pool: pool}
}

func (r *Router) Send(msg Message, recipients []*Conn) {
	for _, c := range recipients {
		c := c
		if err := r.pool.Submit(func() {
			c.WriteJSON(msg)
		}); err != nil {
			metrics.DroppedCount.Inc()
		}
	}
}
```

**Why not errgroup?** errgroup's spawn rate per call would create 50/sec × 50 recipients × 50,000-burst = N goroutines per message. Even bounded, the create-and-park cost dominates the 5ms write. ants amortises this.

**Why non-blocking?** During a 10-second burst, if we block at K=300, the queue grows. With 300 active and incoming rate >> drain rate, latency for queued tasks grows unbounded. Dropping (with metrics) is the lesser evil for chat — a missed message is recoverable; an unbounded queue is not.

### Workload 3: PDF report generator

**Description.** A service generates PDF reports on demand. Each report requires loading a font cache (200 ms cold), then rendering 5-50 pages (~50 ms per page). Volume: 100 reports/sec average. Each report is 5-50 pages, so 500-5000 page-renders/sec.

**Constraints.**
- 4 CPU cores.
- Font cache is non-thread-safe (must be per-goroutine).
- Memory budget: 2 GiB.
- p99 latency budget: 1 second per report.

**Naive errgroup.** Each request creates an errgroup, sets a limit of NumCPU, fans out pages. Each page-render constructs its own font cache. At 500/sec, that's 500 × 200ms = 100 CPU-seconds/sec of cache loading. With 4 cores, the service is at 2500% CPU on cache loading alone — completely overloaded.

**Tool choice.** tunny. Why?

- Font cache is per-goroutine state.
- Workers reuse the cache across many page-renders.
- After warm-up, each render is just the ~50ms work (no cache load).

**Code:**

```go
type pageWorker struct {
	cache *fontCache
}

func newPageWorker() *pageWorker {
	return &pageWorker{cache: newFontCache()}  // 200ms construction
}

func (w *pageWorker) Process(payload any) any {
	page := payload.(Page)
	return renderPage(page, w.cache)  // uses warm cache
}

func main() {
	pool := tunny.NewCallback(4, func() any {
		return newPageWorker()
	})
	defer pool.Close()

	// each report request:
	for _, page := range report.Pages {
		go func(p Page) {
			result := pool.Process(p)
			_ = result
		}(page)
	}
}
```

Wait — tunny's worker callback is just `func() any`, but the Process function needs a worker method. Let me show this correctly:

```go
type pageWorker struct {
	cache *fontCache
}

func newPageWorker() tunny.Worker {
	return &pageWorker{cache: newFontCache()}
}

func (w *pageWorker) Process(payload any) any {
	page := payload.(Page)
	return renderPage(page, w.cache)
}

func (w *pageWorker) BlockUntilReady() {}
func (w *pageWorker) Interrupt()       {}
func (w *pageWorker) Terminate()       {}

// Usage:
pool := tunny.NewCallback(4, newPageWorker)
defer pool.Close()
```

**Why not ants?** ants has no concept of per-worker state. We would need to construct the cache inside the closure, defeating the reuse. Or pin one goroutine per cache by-hand, which is exactly what tunny does for us.

**Why not errgroup?** Same issue. errgroup spawns fresh goroutines, no state reuse.

---

## How to Conduct a Pool Choice Review

A repeatable process for reviewing pool choices in your codebase.

### Step 1: Inventory existing pools

List every `NewPool`, `errgroup.Group`, and `semaphore.NewWeighted` in the codebase. For each, document:

- File and line.
- Tool used.
- K (and how K was chosen).
- Workload shape (CPU/IO/memory bound).
- Comments justifying the choice.

### Step 2: Identify mismatches

For each entry, evaluate:

- Is the workload size bounded by the problem? If yes, raw goroutines may be enough.
- Is K justified by a downstream resource? If no, suspect cargo cult.
- Is there a measurable difference from the simpler alternative? If no, simplify.
- Is the dependency justified? If no, replace with errgroup.

### Step 3: Plan migrations

For each mismatch, propose a migration. Include:

- Diff (lines removed, lines added).
- Benchmark before/after.
- Risk assessment.

### Step 4: Execute incrementally

Migrate one pool at a time. Measure each. Roll back if metrics degrade.

### Step 5: Add tests for the new pattern

Each migration should come with a test that exercises the bound (e.g., a stress test that submits more than K and confirms back-pressure).

### Step 6: Document the pattern

Add to your team's internal docs: "for this kind of workload, use this tool." Reduce reinvention.

---

## When Your Team Disagrees

Pool choice often surfaces team disagreements: senior wants `ants`, junior wants `errgroup`, mid-level wants `workerpool`. Some scripts for these conversations:

### Script: "We've always used ants here"

Acknowledge the precedent. Ask for the measurement that motivated it originally. If there is no measurement, propose a benchmark in this PR. If the benchmark says ants wins, keep it; if not, simplify.

### Script: "errgroup feels too simple"

Validate the instinct (the team is more comfortable with a "real" pool). But push back on aesthetics. "Simple" is a feature, not a flaw. Show the side-by-side: errgroup is shorter, less risky, easier to onboard.

### Script: "tunny is unmaintained"

Check the actual commit history. Lots of "low-activity" repos are simply *finished* — small libraries with no ongoing work because there is no ongoing problem. Open issues count, not commit count, is the metric. If tunny has fewer than 5 open issues and a clean API, it's fine.

### Script: "Let's build our own pool"

Don't unless you have a *specific* requirement that no library covers. Building your own pool well takes weeks; reviewing it takes weeks; maintaining it takes years. The build-it-yourself argument is almost always wrong.

### Script: "We need fine-grained metrics"

errgroup doesn't have built-in metrics, but five lines of `prometheus.Inc()` give you the equivalent. Not a reason to swap libraries.

---

## Cross-Cutting Concerns

A few topics that apply across all pool choices.

### Context propagation

Always pass `ctx` to task functions. With errgroup, the group's ctx is automatic. With pools:

```go
pool.Submit(func() {
	if ctx.Err() != nil { return }
	work(ctx)
})
```

Check `ctx.Err()` at the start of each task. If the caller cancelled before the task started, abort immediately.

### Panic safety

Wrapping every task with `recover` is verbose. Either use a pool with a panic handler, or write a helper:

```go
func recovered(f func()) func() {
	return func() {
		defer func() {
			if r := recover(); r != nil {
				log.Printf("task panic: %v\n%s", r, debug.Stack())
			}
		}()
		f()
	}
}

// usage
pool.Submit(recovered(work))
```

### Drain on shutdown

Always drain. For errgroup: `g.Wait()`. For pools:

```go
pool.ReleaseTimeout(30 * time.Second)
```

If your pool doesn't have ReleaseTimeout, write a loop:

```go
deadline := time.After(30 * time.Second)
for pool.Running() > 0 {
	select {
	case <-deadline:
		log.Printf("warning: pool drain timeout, %d still running", pool.Running())
		pool.Release()
		return
	case <-time.After(100 * time.Millisecond):
	}
}
pool.Release()
```

### Backpressure

When the system is overloaded:

- errgroup.SetLimit blocks submissions — backpressure to the caller.
- ants with blocking submit (default) blocks similarly.
- ants with non-blocking + WithMaxBlockingTasks queues up to N, then drops.
- ants with non-blocking and no max queue: queues unboundedly. Avoid.

Pick the backpressure shape that fits your service. For most APIs: block (the caller deals with retry). For chat/streaming: drop with metric.

### Observability hooks

Whatever pool you choose, instrument:

- Submit count.
- In-flight count.
- Queue depth.
- Panic count.
- Task duration histogram.

These five metrics catch 95% of pool issues. Add them at construction time.

---

## When Pool Size Should Change at Runtime

Static K is the default. But sometimes dynamic K is better.

### Use case 1: Load-aware scaling

When CPU utilisation is low, raise K (more workers can use the spare CPU). When high, lower K (avoid thrash). Implement with a control loop:

```go
go func() {
	for range time.Tick(10 * time.Second) {
		cpu := readCPUUsage()
		if cpu < 50 {
			pool.Tune(pool.Cap() * 5 / 4)
		} else if cpu > 80 {
			pool.Tune(pool.Cap() * 4 / 5)
		}
	}
}()
```

Use cautiously — auto-scaling pools can create oscillation.

### Use case 2: Memory-aware scaling

When RSS approaches budget, lower K. When RSS is low, raise.

### Use case 3: Multi-tenant fairness

When tenant A's pool is starved (queue full, drops occurring) and tenant B's is idle, redistribute capacity. Rare and complex.

### Use case 4: Time-of-day

Lower K during expected idle hours; raise during expected peak. Coarse but reliable.

For most services, static K is fine. Reach for dynamic only when you have a specific operational reason.

---

## A Concrete Example: The Wrong Tool

Real anti-pattern from a real codebase (anonymised).

```go
// auth_service.go
package auth

import (
	"context"
	"github.com/Jeffail/tunny"
)

type Service struct {
	pool *tunny.Pool
}

func New() *Service {
	pool := tunny.NewFunc(50, func(payload any) any {
		req := payload.(authRequest)
		return checkToken(req.Token)
	})
	return &Service{pool: pool}
}

func (s *Service) Authenticate(ctx context.Context, token string) (User, error) {
	result := s.pool.ProcessCtx(ctx, authRequest{Token: token})
	if err, ok := result.(error); ok {
		return User{}, err
	}
	return result.(User), nil
}
```

Why is this wrong?

1. `checkToken` has *no per-worker state*. There is no font cache, no DB connection (the DB connection is in a pool elsewhere), no warm state. tunny's worker-state feature is unused.

2. The pool serialises auth requests at K=50. At higher RPS, requests queue inside tunny. errgroup or a semaphore would do the same with less code.

3. `Process(payload)` requires type assertions and `any`, losing type safety.

4. tunny's `Process` blocks until a worker is free. If all 50 are busy with slow checks, new requests block — which is what we want, but a semaphore expresses it more directly.

5. The dependency is paid for zero benefit.

**Better:**

```go
package auth

import (
	"context"
	"golang.org/x/sync/semaphore"
)

type Service struct {
	sem *semaphore.Weighted
}

func New() *Service {
	return &Service{sem: semaphore.NewWeighted(50)}
}

func (s *Service) Authenticate(ctx context.Context, token string) (User, error) {
	if err := s.sem.Acquire(ctx, 1); err != nil { return User{}, err }
	defer s.sem.Release(1)
	return checkToken(token)
}
```

Same semantics, fewer lines, no dependency, type-safe, propagates ctx.

---

## Re-visiting Sizing With Real Math

We have given formulas; let's apply them.

### Case A: Image processing on 8 cores

Each task: ~80% CPU, ~20% I/O (fetching the image from S3).

CPU bound? Mostly. K = NumCPU is a starting point. But the 20% I/O means a goroutine waiting on I/O leaves its core idle.

Refinement: K = NumCPU × (1 / cpu_fraction) = 8 / 0.8 = 10.

Verify with load test. If CPU is 100% at K=10, that's right. If under 100%, raise. If saturated below K=10, lower.

### Case B: HTTP fan-out, downstream limit 100

K = 100 (downstream).

But our service has 4 replicas, each fanning out. The downstream sees 4 × 100 = 400 concurrent calls, exceeding its limit.

Refinement: K = 100 / num_replicas = 25 per replica.

This requires coordination across replicas. Either:
- Coordinate via service discovery and have each replica claim a share.
- Use a centralised rate limiter (Redis, dedicated service).
- Accept some over-limit during deploys/scaling.

Most teams accept transient over-limit. Document the choice.

### Case C: DB writes, connection pool 50

K = 50 (DB connection budget).

But there are 3 endpoints, all writing to DB concurrently. Each has its own errgroup with SetLimit(50). At peak, all 3 are at full bound: 150 concurrent DB writes against a 50-slot pool.

Refinement: shared `semaphore.NewWeighted(50)` across all endpoints.

The semaphore is the right tool for cross-function shared bounds. Pool-per-endpoint is the wrong shape here.

### Case D: GPU-bound work, 2 GPUs

K = 2 (one task per GPU).

If GPU tasks block briefly for memory copies, you can overlap with K=3. Measure.

For workloads with weirder hardware (TPUs, FPGAs), K depends on hardware contention and is best measured.

### Case E: Memory-budget for image rendering

Each render uses 200 MB. Budget: 4 GiB. Baseline RSS: 500 MB.

K = (4096 - 500) / 200 = 18 (rounded).

Add 20% headroom for GC and unexpected allocations: K_safe = 14.

Verify under load. If OOM occurs, lower further. If memory is comfortably below budget, raise.

### Case F: When K should be 1

A pool of one worker serialises tasks. Use case: a write to a shared resource that doesn't tolerate concurrency (a non-thread-safe library, an old DB driver, etc.). K=1 with a queue gives you ordered, single-threaded execution. Sometimes better expressed as `chan + 1 goroutine` than as a pool.

### Case G: When K is "infinity"

When concurrency is naturally bounded by the workload (e.g., fan-out to 3 services from one request), you don't need a numeric K. Use raw goroutines or unbounded errgroup.

---

## What If You Need a Combination

A common situation: a request handler that needs:

- Bounded concurrency for fan-out.
- Error propagation.
- ctx cancellation.
- Persistent workers (the fan-out happens many times per second).
- Panic recovery.
- Metrics.

That's a lot. What's the shape?

```go
type Service struct {
	pool *ants.Pool
}

func NewService() (*Service, error) {
	pool, err := ants.NewPool(100, ants.WithPanicHandler(panicLogger))
	if err != nil { return nil, err }
	go reportMetrics(pool) // tickers
	return &Service{pool: pool}, nil
}

func (s *Service) Handle(ctx context.Context, in []Item) ([]Result, error) {
	results := make([]Result, len(in))
	errs := make([]error, len(in))
	var wg sync.WaitGroup
	for i, x := range in {
		i, x := i, x
		wg.Add(1)
		if err := s.pool.Submit(func() {
			defer wg.Done()
			if ctx.Err() != nil {
				errs[i] = ctx.Err()
				return
			}
			r, err := work(ctx, x)
			results[i] = r
			errs[i] = err
		}); err != nil {
			wg.Done()
			errs[i] = err
		}
	}
	wg.Wait()
	for _, e := range errs {
		if e != nil { return results, e }
	}
	return results, nil
}
```

This combines:
- Persistent pool (workers reused across handler calls).
- Panic handler (one panic doesn't kill the service).
- Per-handler-call WaitGroup (drain this handler's tasks).
- ctx.Err() check (early abort on cancellation).
- Per-task error collection.

It's about 20 lines of glue, but it gives you the full set of features. The cost is paying for ants's worker reuse with the complexity of manual error propagation.

For comparison, the errgroup version is simpler (no manual error/ctx):

```go
func (s *Service) HandleEG(ctx context.Context, in []Item) ([]Result, error) {
	results := make([]Result, len(in))
	g, ctx := errgroup.WithContext(ctx)
	g.SetLimit(100)
	for i, x := range in {
		i, x := i, x
		g.Go(func() error {
			r, err := work(ctx, x)
			if err != nil { return err }
			results[i] = r
			return nil
		})
	}
	return results, g.Wait()
}
```

The errgroup version is half the code, has ctx propagation built-in, and propagates the first error automatically. The pool version is faster *only if* the spawn rate justifies it. Measure to decide.

---

## A Final Word On "When To Use a Pool"

Looking back across this whole file, the underlying principle is: **the bound is the design; the tool is the implementation**.

When you design concurrent code, you are asking "what is the bound, and what does it protect?" Whatever answers those questions clearly is the right tool. errgroup is the best answer most often. Semaphore is the right answer when the bound is unequal or shared. Pools are the right answer when the bound coexists with worker-state, high spawn rate, or specific features.

Pick the implementation to match the design. Don't let the implementation drive the design — that's how cargo-cult emerges.

---

## Appendix: Common Pool Scenarios From Production

A catalog of pool scenarios encountered in real Go services. For each: workload, sizing rationale, tool choice.

### Scenario A1: WebSocket broadcast

A chat service broadcasts each room update to all clients in the room. Room sizes: 5-50,000. Update rate: 100 per second per room.

- Per-update fan-out: up to 50,000 sends.
- Per-send latency: 1-5 ms.
- Concurrency: 50,000 × 5 ms / 1 sec = 250 in-flight per peak room.

Tool: ants pool sized for cross-room peak (e.g., 1000) with non-blocking submit. Drop policy: log + metric on drop.

### Scenario A2: Log aggregation

A daemon collects logs from many sources, batches them, ships to a downstream aggregator with rate limit 1000 lines/sec.

Tool: rate limiter (not a pool). Or a single-worker pool with a buffer channel, batching every 100 ms.

### Scenario A3: Search index build

Once daily, the service indexes ~1M documents. Each document: read from DB, tokenise, write to index file.

- Sequential: 1M × 50 ms = 14 hours. Unacceptable.
- Parallel: bounded by DB connection pool (50) and index file write throughput.

Tool: errgroup with SetLimit(50). One-shot, batch, errors matter. No pool needed.

### Scenario A4: Email sender

A service sends transactional emails. Volume: 50 emails/sec. SMTP server limit: 20 concurrent connections.

Tool: errgroup or semaphore (20). At 50/sec × 1 sec per email = 50 in-flight, the bound (20) means queue grows. Backpressure to producer. If producer is async (Kafka), queueing is fine.

### Scenario A5: Payment processing

A service charges credit cards. Volume: 10 per second. Per-charge latency: 1-3 seconds. Critical operation; no drops allowed.

Tool: errgroup with SetLimit large enough for headroom (e.g., 30). Backpressure to the request layer. Never drop. p99 latency monitored.

### Scenario A6: Audio transcoding

A service transcodes podcast audio. Volume: 10 per minute. Per-file: 30-180 seconds. CPU-bound.

Tool: errgroup with SetLimit(NumCPU) or tunny if the codec library benefits from per-worker state.

### Scenario A7: Notification fan-out (mobile push)

Volume: 100k notifications/sec. Per-notification: a single push to APNS or FCM.

Tool: ants pool. APNS allows many parallel connections; the bound is your goroutine and memory budget. K = ~5000.

### Scenario A8: Database backup compression

Once a day, a service compresses a 100 GB DB dump.

Tool: a single goroutine. Compression on a single stream parallelises poorly. Or a pipeline with one read goroutine, N gzip-shard goroutines, one write goroutine.

### Scenario A9: AI inference

Volume: 50 per second. Each inference: 100 ms on GPU.

Tool: errgroup with SetLimit equal to number of inference slots per GPU × number of GPUs. Carefully measured.

### Scenario A10: Image resize CLI

A user runs `resize *.jpg --width 800`. 200 files.

Tool: raw goroutines with WaitGroup. Or errgroup with SetLimit(NumCPU). 200 tasks, one-shot, CLI exits.

---

## Appendix: When to Build Your Own Pool

Rarely. But here are the situations.

### Reason 1: Priority queue

You have "urgent" and "normal" tasks. Urgent should bypass normal in queue order. No standard library or third-party pool handles this well. Build:

```go
type PriorityPool struct {
	urgent chan Task
	normal chan Task
	workers int
}

func (p *PriorityPool) worker() {
	for {
		select {
		case t := <-p.urgent:
			t()
		default:
			select {
			case t := <-p.urgent:
				t()
			case t := <-p.normal:
				t()
			}
		}
	}
}
```

About 30 lines. Tailored. Maintainable.

### Reason 2: Custom backpressure semantics

You want "drop oldest" not "drop newest" when at capacity. Pools usually drop the incoming submission. To drop oldest:

```go
type DropOldestPool struct {
	tasks chan Task
}

func (p *DropOldestPool) Submit(t Task) {
	select {
	case p.tasks <- t:
	default:
		<-p.tasks      // drop oldest
		p.tasks <- t   // insert new
	}
}
```

Subtle (there's a race here), but the shape is custom enough that off-the-shelf pools don't match.

### Reason 3: Multi-queue dispatch

You want to dispatch to one of several worker pools based on task type. Build a router.

### Reason 4: Native instrumentation

If you need very specific metrics (per-task-class throughput, queue-time histograms with custom buckets), it's sometimes easier to write the pool than to retrofit an existing one.

### Reason 5: Educational

Building a pool once teaches you why pools are the way they are. Not a reason to ship custom code, but a reason to write one in a scratch file.

In all other cases, prefer the library. Custom pools are technical debt unless the use case is *specifically* uncommon.

---

## Appendix: Versioning and Stability

A note on stability of the libraries we mention.

### ants

- v1 → v2 was a breaking change (different module path). Most users are on v2.
- The v2 API is stable as of writing.
- Releases are infrequent (every few months) but consistent.
- The maintainer is responsive on issues.

### tunny

- v1 has been stable for years.
- No v2 in sight.
- The API is small enough that bugs are rare.

### workerpool

- Stable. Tiny surface.

### pond

- Younger (v1 is current). API has been stable for some months.

### errgroup

- Part of `golang.org/x/sync`. The Go team maintains it. Backwards-compatible for years.

### semaphore

- Same module as errgroup. Stable.

Recommendation: pin all dependencies. Test on Go upgrade. Read the CHANGELOG when upgrading library versions.

---

## Appendix: Go Module Hygiene

When you add a pool library:

1. `go get github.com/panjf2000/ants/v2@latest`
2. `go mod tidy`
3. Pin in go.mod with the exact version that you tested.
4. Add a vendor copy if your team uses vendoring.
5. Document the version in your service README ("requires ants v2.9+").

When you remove a pool library:

1. Remove imports.
2. `go mod tidy` to clean up.
3. Verify nothing else depends on the lib (transitive).
4. Commit. The diff should show removed `require` lines in `go.mod`.

---

## Appendix: One More Worked Migration

We end with a complete migration example. Real-shaped, anonymised.

### Before

```go
// service.go
package service

import (
	"context"
	"sync"

	"github.com/Jeffail/tunny"
)

type API struct {
	pool *tunny.Pool
}

func NewAPI() *API {
	pool := tunny.NewFunc(50, func(payload any) any {
		req := payload.(callReq)
		resp, err := downstream.Call(req.Ctx, req.Body)
		if err != nil {
			return err
		}
		return resp
	})
	return &API{pool: pool}
}

func (a *API) Process(ctx context.Context, items []Item) ([]Resp, error) {
	resps := make([]Resp, len(items))
	var firstErr error
	var mu sync.Mutex
	var wg sync.WaitGroup

	for i, item := range items {
		i, item := i, item
		wg.Add(1)
		go func() {
			defer wg.Done()
			result := a.pool.ProcessCtx(ctx, callReq{Ctx: ctx, Body: item.Body})
			if err, ok := result.(error); ok {
				mu.Lock()
				if firstErr == nil { firstErr = err }
				mu.Unlock()
				return
			}
			resps[i] = result.(Resp)
		}()
	}
	wg.Wait()

	return resps, firstErr
}
```

About 35 lines, with manual error wiring, type assertions, two synchronisation primitives.

### After

```go
// service.go
package service

import (
	"context"

	"golang.org/x/sync/errgroup"
	"golang.org/x/sync/semaphore"
)

type API struct {
	sem *semaphore.Weighted
}

func NewAPI() *API {
	return &API{sem: semaphore.NewWeighted(50)}
}

func (a *API) Process(ctx context.Context, items []Item) ([]Resp, error) {
	resps := make([]Resp, len(items))
	g, ctx := errgroup.WithContext(ctx)
	for i, item := range items {
		i, item := i, item
		g.Go(func() error {
			if err := a.sem.Acquire(ctx, 1); err != nil { return err }
			defer a.sem.Release(1)
			resp, err := downstream.Call(ctx, item.Body)
			if err != nil { return err }
			resps[i] = resp
			return nil
		})
	}
	return resps, g.Wait()
}
```

About 20 lines. No type assertions. errgroup handles errors and ctx. Semaphore handles the cross-call bound. Dependency removed: tunny gone.

### What did the migration give us?

- 40% less code.
- One less dependency.
- Type-safe (no `any`).
- Proper ctx cancellation (was clumsy before).
- First error returned automatically.
- Same throughput (we measured: ±2%).

This is the kind of migration a quarterly tech-debt audit should find and execute.

---

## Appendix: Quick Numbers for Sizing

A reference card of typical K values for typical workloads. Use as a starting point; tune with measurements.

| Workload                                | Typical K          | Rationale                                |
|------------------------------------------|--------------------|------------------------------------------|
| CPU-bound (hash, compress)               | NumCPU             | All cores, no oversubscription            |
| CPU + brief I/O (image resize)           | NumCPU × 1.25      | Overlap I/O with CPU                      |
| Pure I/O (HTTP, DB)                      | 50-500             | Sized by downstream limit                 |
| WebSocket fan-out                        | 100-5000           | Per-conn write is fast, K can be large   |
| File reads (many small files)            | NumCPU × 2         | OS read-ahead helps                       |
| File reads (large files)                 | NumCPU             | Sequential bandwidth dominates            |
| Database writes (transactional)          | 10-50              | Connection pool, lock contention         |
| Database reads (analytics)               | 50-200             | Per-tenant read replica budget            |
| Cache lookups (local)                    | NumCPU × 4         | Cheap operations, oversubscribe          |
| Cache lookups (remote, e.g. Redis)       | 50-200             | Network bound                             |
| API call to rate-limited downstream      | downstream's limit | Stay under                                 |
| GPU inference                            | GPU count × 2-4    | Per-GPU parallelism                       |

These numbers come from experience; your service may differ by 2-3x. Always measure.

---

## Appendix: Side-By-Side Library API Examples

For reference. Same workload (process 100 items, K=10), each library.

### Raw goroutines + WaitGroup

```go
var wg sync.WaitGroup
sem := make(chan struct{}, 10)
for _, x := range items {
	x := x
	wg.Add(1)
	sem <- struct{}{}
	go func() {
		defer wg.Done()
		defer func() { <-sem }()
		process(x)
	}()
}
wg.Wait()
```

### errgroup

```go
g, ctx := errgroup.WithContext(ctx)
g.SetLimit(10)
for _, x := range items {
	x := x
	g.Go(func() error { return process(ctx, x) })
}
return g.Wait()
```

### semaphore

```go
sem := semaphore.NewWeighted(10)
var wg sync.WaitGroup
for _, x := range items {
	x := x
	wg.Add(1)
	go func() {
		defer wg.Done()
		sem.Acquire(ctx, 1)
		defer sem.Release(1)
		process(x)
	}()
}
wg.Wait()
```

### ants

```go
pool, _ := ants.NewPool(10)
defer pool.Release()
var wg sync.WaitGroup
for _, x := range items {
	x := x
	wg.Add(1)
	pool.Submit(func() {
		defer wg.Done()
		process(x)
	})
}
wg.Wait()
```

### tunny

```go
pool := tunny.NewFunc(10, func(payload any) any {
	process(payload.(Item))
	return nil
})
defer pool.Close()
var wg sync.WaitGroup
for _, x := range items {
	x := x
	wg.Add(1)
	go func() {
		defer wg.Done()
		pool.Process(x)
	}()
}
wg.Wait()
```

### workerpool

```go
wp := workerpool.New(10)
for _, x := range items {
	x := x
	wp.Submit(func() { process(x) })
}
wp.StopWait()
```

### pond

```go
pool := pond.New(10, 100)
defer pool.StopAndWait()
for _, x := range items {
	x := x
	pool.Submit(func() { process(x) })
}
```

Compare the line counts and shapes. errgroup is the densest (most semantics per line). workerpool is the smallest API. tunny has the most boilerplate for fire-and-forget. ants is middle.

---

## Closing Thoughts For Middle Level

At this point, you should have a strong opinion on which tool fits which workload. The decision is not "what's the best pool?" but "what is the workload's bound, and what's the smallest tool that enforces it?"

Most services need errgroup. Some need a pool. Very few need a custom pool. The judgement of which is which is the middle-level skill.

Next, in `senior.md`, we dig into the *internals* of these tools — what they cost in allocations, in scheduling fairness, in cache behaviour. That level of detail is needed when you are operating at scale, when you need to know not just *which* tool but *why exactly* it wins.

---

## Appendix: Edge-Case Tables

A few quick tables that summarise edge-case behaviour, useful as a code-review reference.

### What happens when Submit is called and the pool is full?

| Library / Mode                              | Behaviour                                        |
|---------------------------------------------|--------------------------------------------------|
| errgroup.Go (with SetLimit)                 | Blocks until a slot opens                        |
| semaphore.Acquire                           | Blocks until budget is available                 |
| ants (blocking, default)                    | Blocks until a slot opens                        |
| ants (Nonblocking=true)                     | Returns ErrPoolOverload immediately              |
| ants (Nonblocking=true, MaxBlockingTasks>0) | Enqueues up to N; beyond N returns ErrPoolOverload|
| tunny.Process                               | Blocks until a worker is free                    |
| workerpool.Submit                           | Enqueues; never blocks                           |
| workerpool.SubmitWait                       | Blocks until the task starts                     |
| pond.Submit                                 | Enqueues; configurable strategy                  |

Knowing this row by row is essential for choosing the right library for backpressure semantics.

### What happens when a task panics?

| Library / Mode                              | Behaviour                                        |
|---------------------------------------------|--------------------------------------------------|
| raw goroutine                               | Whole program crashes                            |
| errgroup.Go                                 | Whole program crashes                            |
| ants (no PanicHandler)                      | Whole program crashes                            |
| ants (with PanicHandler)                    | Handler called; worker recycled                  |
| tunny                                       | Whole program crashes (no recovery)              |
| workerpool                                  | Whole program crashes                            |
| pond (with PanicHandler)                    | Handler called; pool continues                   |

If panic recovery without crashing is required, your options narrow to ants or pond, or you wrap each task body manually.

### What happens when the pool is closed?

| Library                                     | Behaviour for new Submits                        |
|---------------------------------------------|--------------------------------------------------|
| ants.Submit on Released pool                | Returns ErrPoolClosed                            |
| tunny.Process on Closed pool                | Panics                                            |
| workerpool.Submit on Stopped pool           | Panics                                            |
| pond.Submit on Stopped pool                 | Returns ErrPoolStopped                            |

Defensive: always check the pool state in your wrappers, or guarantee no Submits after the close call.

### What happens when ctx is cancelled?

| Tool                                         | Behaviour                                        |
|----------------------------------------------|--------------------------------------------------|
| errgroup (with WithContext)                  | ctx cancels on first error; remaining tasks see it|
| semaphore.Acquire(ctx, n)                    | Returns ctx.Err()                                 |
| ants                                         | No ctx awareness; you check inside task          |
| tunny.ProcessCtx                             | Returns; in-flight task continues to completion  |
| workerpool                                   | No ctx awareness; check inside task              |
| pond                                         | No ctx awareness in Submit; check inside task    |

Errgroup is the gold standard for ctx propagation. Pools require manual ctx checking inside tasks.

---

## Appendix: Recipes For Common Problems

### Recipe: "I want to limit my fan-out to 10 concurrent."

```go
g, ctx := errgroup.WithContext(ctx)
g.SetLimit(10)
for _, x := range xs {
	x := x
	g.Go(func() error { return work(ctx, x) })
}
return g.Wait()
```

### Recipe: "I want to limit a global resource across my whole service."

```go
var dbSem = semaphore.NewWeighted(50)

func anyHandler(ctx context.Context) error {
	if err := dbSem.Acquire(ctx, 1); err != nil { return err }
	defer dbSem.Release(1)
	// ... use DB
}
```

### Recipe: "I want a pool that drops on overload."

```go
pool, _ := ants.NewPool(100, ants.WithNonblocking(true))

func submit(t func()) {
	if err := pool.Submit(t); err != nil {
		metrics.Dropped.Inc()
	}
}
```

### Recipe: "I want a pool that recovers from panics."

```go
pool, _ := ants.NewPool(100, ants.WithPanicHandler(func(p any) {
	log.Printf("panic: %v\n%s", p, debug.Stack())
	metrics.Panic.Inc()
}))
```

### Recipe: "I want workers with per-worker state."

```go
type myWorker struct {
	conn *DBConn
}
func newWorker() tunny.Worker { return &myWorker{conn: openConn()} }
func (w *myWorker) Process(payload any) any { /* use w.conn */ return nil }
func (w *myWorker) BlockUntilReady() {}
func (w *myWorker) Interrupt()       {}
func (w *myWorker) Terminate()       { w.conn.Close() }

pool := tunny.NewCallback(10, newWorker)
defer pool.Close()
```

### Recipe: "I want different bounds for different task types."

```go
type Pools struct {
	smallSem *semaphore.Weighted // for fast tasks
	largeSem *semaphore.Weighted // for slow tasks
}

func (p *Pools) doSmall(ctx context.Context, x X) error {
	p.smallSem.Acquire(ctx, 1); defer p.smallSem.Release(1)
	return small(x)
}

func (p *Pools) doLarge(ctx context.Context, y Y) error {
	p.largeSem.Acquire(ctx, 1); defer p.largeSem.Release(1)
	return large(y)
}
```

### Recipe: "I want to bound but also rate-limit."

```go
var (
	sem     = semaphore.NewWeighted(100)
	limiter = rate.NewLimiter(1000, 100) // 1000/sec, burst 100
)

func do(ctx context.Context, t Task) error {
	if err := sem.Acquire(ctx, 1); err != nil { return err }
	defer sem.Release(1)
	if err := limiter.Wait(ctx); err != nil { return err }
	return work(ctx, t)
}
```

Both constraints (in-flight bound and rate limit) are enforced together.

### Recipe: "I want a pool that scales workers up under load."

ants does not auto-scale, but you can wrap a control loop:

```go
go func() {
	for range time.Tick(5 * time.Second) {
		running := pool.Running()
		cap := pool.Cap()
		if float64(running) > 0.85 * float64(cap) && cap < maxCap {
			pool.Tune(cap + step)
		} else if float64(running) < 0.30 * float64(cap) && cap > minCap {
			pool.Tune(cap - step)
		}
	}
}()
```

### Recipe: "I want my errgroup to also propagate panics as errors."

```go
g, ctx := errgroup.WithContext(ctx)
g.SetLimit(10)
for _, x := range xs {
	x := x
	g.Go(func() (err error) {
		defer func() {
			if r := recover(); r != nil {
				err = fmt.Errorf("panic: %v", r)
			}
		}()
		return work(ctx, x)
	})
}
return g.Wait()
```

### Recipe: "I want a pool that times out tasks individually."

```go
func bounded(parent context.Context, t func(context.Context) error, timeout time.Duration) error {
	ctx, cancel := context.WithTimeout(parent, timeout)
	defer cancel()
	done := make(chan error, 1)
	pool.Submit(func() {
		done <- t(ctx)
	})
	select {
	case err := <-done: return err
	case <-ctx.Done(): return ctx.Err()
	}
}
```

Per-task timeout layered onto a pool's bound.

---

## Appendix: Cross-Referenced Resources

Final links to internal and external resources.

- `01-overview/index.md` — overview of pools at all.
- `02-ants/*.md` — full deep dive on ants.
- `03-tunny/*.md` — full deep dive on tunny.
- `06-context/*.md` — ctx propagation patterns.
- `02-channels/*.md` — channel primitives used inside pools.
- `15-concurrency-anti-patterns/*.md` — broader anti-patterns.

Go to the file that matches your gap. This middle.md is a hub; the deep dives live elsewhere.

---

## Appendix M2: One more side-by-side

For absolute clarity on errgroup vs ants for the same workload, side-by-side:

### Errgroup version

```go
g, ctx := errgroup.WithContext(ctx)
g.SetLimit(K)
for _, x := range xs {
	x := x
	g.Go(func() error { return work(ctx, x) })
}
return g.Wait()
```

### Ants version (with full equivalence — ctx, errors)

```go
pool, _ := ants.NewPool(K)
defer pool.Release()
ctx, cancel := context.WithCancel(ctx)
defer cancel()

var firstErr error
var errMu sync.Mutex
var wg sync.WaitGroup
for _, x := range xs {
	x := x
	wg.Add(1)
	if err := pool.Submit(func() {
		defer wg.Done()
		if ctx.Err() != nil { return }
		if err := work(ctx, x); err != nil {
			errMu.Lock()
			if firstErr == nil { firstErr = err; cancel() }
			errMu.Unlock()
		}
	}); err != nil {
		wg.Done()
	}
}
wg.Wait()
return firstErr
```

The errgroup version is 7 lines. The ants version is 23. Both accomplish the same thing.

The ants version is worth it only when:
- You measure a perf benefit.
- You specifically need ants's features (panic handler, dynamic resize).
- The workload's shape favors persistent workers.

In most other cases: use errgroup.

## Appendix M3: One more sizing example

A team is sizing a pool for a service that:
- Receives 1000 requests/sec.
- Each request fans out to 5 downstream calls.
- Each downstream call: 50ms.
- 4 cores, 2 GiB memory, no other constraint.

Compute K.

- Tasks per second: 1000 × 5 = 5000.
- Concurrency by Little's Law: 5000 × 0.05 = 250.
- Headroom 20%: K = 300.

So K = 300. CPU is not the constraint (250 in-flight × 0.05 ms CPU each ≈ 12.5 ms CPU/s = ~1% of one core). Memory is not the constraint. The constraint is throughput.

Choose errgroup with K=300 if the fan-out is per-request (one errgroup per request). Or a shared pool with K=300 across all requests.

For per-request errgroup:
- Each request: K=300 (overkill, request only has 5 tasks).
- Use errgroup with no SetLimit (since N=5).

For shared bound across all requests:
- Use `semaphore.NewWeighted(300)` at the call site.

The right answer depends on whether the 300 is per-request or cross-request. Document.

End of `middle.md`.




