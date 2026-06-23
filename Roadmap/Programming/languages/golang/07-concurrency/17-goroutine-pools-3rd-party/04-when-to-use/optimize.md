---
layout: default
title: Optimize
parent: When to Use a Pool
grand_parent: Goroutine Pools (3rd-party)
ancestor: Go
nav_order: 10
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/17-goroutine-pools-3rd-party/04-when-to-use/optimize/
---

# When to Use a Pool — Optimize

8 scenarios where swapping libraries, removing a pool, or simplifying produces measurable improvement. Each has a "before," an "after," and notes on the gain.

---

## Optimization 1: Remove unnecessary ants → use errgroup

### Before

```go
func ProcessOrders(ctx context.Context, orders []Order) ([]Result, error) {
	pool, err := ants.NewPool(20)
	if err != nil { return nil, err }
	defer pool.Release()

	results := make([]Result, len(orders))
	errs := make([]error, len(orders))
	var wg sync.WaitGroup

	for i, o := range orders {
		i, o := i, o
		wg.Add(1)
		if err := pool.Submit(func() {
			defer wg.Done()
			r, err := processOrder(ctx, o)
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

37 lines, 1 dependency, manual error/ctx wiring.

### After

```go
func ProcessOrders(ctx context.Context, orders []Order) ([]Result, error) {
	results := make([]Result, len(orders))
	g, ctx := errgroup.WithContext(ctx)
	g.SetLimit(20)
	for i, o := range orders {
		i, o := i, o
		g.Go(func() error {
			r, err := processOrder(ctx, o)
			if err != nil { return err }
			results[i] = r
			return nil
		})
	}
	return results, g.Wait()
}
```

15 lines, 0 third-party dependencies, automatic error/ctx.

### Gain

- 60% fewer lines.
- Dependency removed.
- Type-safe.
- Equivalent throughput (benchmarked).

When to apply: any place where ants's special features (panic handler, non-blocking, etc.) are unused.

---

## Optimization 2: Switch ants → ants with loop-queue

### Before

```go
pool, _ := ants.NewPool(1024)
defer pool.Release()

// 100k tasks/sec from 50 producer goroutines
for ... {
	pool.Submit(work)
}
```

Profile shows high contention on pool's internal mutex (`sync.Mutex.Lock` at top of CPU profile).

### After

```go
pool, _ := ants.NewPool(1024, ants.WithLockFreeRingBuffer())
defer pool.Release()
```

(Note: option name varies by ants version; in older versions it's `WithSpinLock(true)` or `WithLockFreeWorkerQueue`; check the README.)

### Gain

- Submit p99 from 2-3 μs to 300-500 ns under contention.
- CPU reduction of ~5%.
- Lower latency tail.

When to apply: high contention on pool's lock (visible in mutex profile).

---

## Optimization 3: Switch ants → pond for sharded queues

### Before

```go
pool, _ := ants.NewPool(2000)
// 100+ concurrent producers, high contention
```

### After

```go
pool := pond.New(2000, 5000)
```

Pond's internal sharding reduces lock contention by N (where N is the shard count, typically 4-8).

### Gain

- Submit throughput up by 2-3× at high producer count.
- Lower CPU on dispatch.

When to apply: many producer goroutines submitting to a single pool.

---

## Optimization 4: Switch errgroup → tunny for warm state

### Before

```go
g, _ := errgroup.WithContext(ctx)
g.SetLimit(4)
for _, doc := range docs {
	doc := doc
	g.Go(func() error {
		engine := pdf.NewEngine()  // 200ms cold load every task!
		return engine.Render(doc)
	})
}
return g.Wait()
```

Each task pays 200ms. For 100 docs at K=4: total ≈ 100 × 200ms / 4 = 5 seconds of warmup.

### After

```go
type renderWorker struct {
	engine *pdf.Engine
}

func newRenderWorker() tunny.Worker {
	return &renderWorker{engine: pdf.NewEngine()}
}

func (w *renderWorker) Process(payload any) any {
	return w.engine.Render(payload.(Doc))
}

func (w *renderWorker) BlockUntilReady() {}
func (w *renderWorker) Interrupt()       {}
func (w *renderWorker) Terminate()       {}

pool := tunny.NewCallback(4, newRenderWorker)
defer pool.Close()

for _, doc := range docs {
	doc := doc
	go func() { pool.Process(doc) }()
}
```

Per-worker engine, constructed once.

### Gain

- Total warmup = 4 × 200ms = 0.8s, not 5s.
- For 100 docs: 4x faster.
- The warmer the state, the bigger the win.

When to apply: workloads with per-worker state where construction is expensive.

---

## Optimization 5: Remove pool, use raw goroutines

### Before

```go
pool, _ := ants.NewPool(10)
defer pool.Release()
var wg sync.WaitGroup
for _, x := range items {  // 4 items
	x := x
	wg.Add(1)
	pool.Submit(func() { defer wg.Done(); process(x) })
}
wg.Wait()
```

For 4 items, 10-worker pool is comical overkill.

### After

```go
var wg sync.WaitGroup
for _, x := range items {
	x := x
	wg.Add(1)
	go func() { defer wg.Done(); process(x) }()
}
wg.Wait()
```

### Gain

- Removed dependency.
- 30% fewer lines.
- Slightly faster (no pool setup overhead).
- Cleaner code.

When to apply: workloads with small fixed N where the bound is the problem itself.

---

## Optimization 6: Replace per-handler pool with shared semaphore

### Before

```go
func HandlerA(w, r) {
	pool, _ := ants.NewPool(50)
	defer pool.Release()
	for _, x := range items {
		x := x
		pool.Submit(func() { callDB(x) })
	}
	// ...
}

func HandlerB(w, r) {
	pool, _ := ants.NewPool(50)
	defer pool.Release()
	// ... similar
}
```

Each handler creates 50 workers. Total cluster could have 1000+ DB calls in flight (50 per handler × N handlers). DB allows only 50.

### After

```go
var dbSem = semaphore.NewWeighted(50)

func HandlerA(ctx context.Context, w, r) {
	for _, x := range items {
		x := x
		if err := dbSem.Acquire(ctx, 1); err != nil { /* handle */ }
		defer dbSem.Release(1)
		callDB(ctx, x)
	}
}
```

Single semaphore enforces cross-handler bound.

### Gain

- DB stays under its limit.
- No per-handler pool overhead.
- Removed dependency.

When to apply: when a resource is shared across multiple handlers.

---

## Optimization 7: Add panic handler

### Before

```go
pool, _ := ants.NewPool(100)
// no panic handler
```

A single panic kills the whole service.

### After

```go
pool, _ := ants.NewPool(100, ants.WithPanicHandler(func(p any) {
	log.Printf("worker panic: %v\n%s", p, debug.Stack())
	metrics.PanicCount.Inc()
}))
```

### Gain

- One panic doesn't crash the service.
- Stack logged for debugging.
- Metric for alerting.

When to apply: always, for production pools.

---

## Optimization 8: Bound the queue

### Before

```go
pool, _ := ants.NewPool(50)  // MaxBlockingTasks=0 by default
```

Under a burst of 100k tasks/sec, the internal queue grows unboundedly. Memory blows up.

### After

```go
pool, _ := ants.NewPool(50,
	ants.WithMaxBlockingTasks(5000),  // cap queue
)
```

Now under burst, submissions beyond 5000 queued wait or fail (depending on Nonblocking).

### Gain

- Bounded memory.
- Predictable behavior under overload.

When to apply: any pool that could see traffic bursts.

---

## Optimization 9: Use Invoke instead of Submit

### Before

```go
pool, _ := ants.NewPool(100)
defer pool.Release()
for _, x := range xs {
	x := x  // captured
	pool.Submit(func() { process(x) })  // closure allocation per task
}
```

### After

```go
pool, _ := ants.NewPoolWithFunc(100, func(arg any) {
	process(arg.(Item))
})
defer pool.Release()
for _, x := range xs {
	pool.Invoke(x)  // no closure!
}
```

### Gain

- Allocations per task: from ~3 to 0-1.
- At 1M tasks/sec: 3M fewer allocations per sec. GC pressure reduced.
- ~5-10% lower CPU at high rates.

When to apply: high-rate workloads where all tasks have the same logic.

---

## Optimization 10: Add ctx cancellation propagation

### Before

```go
pool.Submit(func() {
	resp, err := http.Get(url)  // no ctx!
	// ...
})
```

Tasks ignore cancellation. On shutdown or client disconnect, they run to completion regardless.

### After

```go
pool.Submit(func() {
	if ctx.Err() != nil { return }
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil { return }
	resp, err := http.DefaultClient.Do(req)
	// ...
})
```

### Gain

- Faster shutdown.
- No wasted work after cancellation.
- Resources released promptly.

When to apply: always. ctx is the cancellation contract.

---

## Optimization 11: Remove cargo cult tunny

### Before

```go
pool := tunny.NewFunc(50, func(payload any) any {
	req := payload.(authRequest)
	return checkToken(req.Token)
})
// 100 lines of glue around it
```

`checkToken` has no per-worker state. The pool is doing nothing tunny is uniquely good at.

### After

```go
var authSem = semaphore.NewWeighted(50)

func auth(ctx context.Context, token string) (User, error) {
	if err := authSem.Acquire(ctx, 1); err != nil { return User{}, err }
	defer authSem.Release(1)
	return checkToken(token)
}
```

### Gain

- 80% less code.
- No dependency.
- Type-safe (no `any`).

When to apply: tunny used without warm state.

---

## Optimization Comparison Table

| # | Before                            | After                           | Gain                          |
|---|-----------------------------------|----------------------------------|-------------------------------|
| 1 | ants for medium workload          | errgroup                         | Less code, no dep             |
| 2 | ants default                       | ants loop-queue                  | Lower contention              |
| 3 | ants single queue                 | pond sharded                     | Higher throughput at scale    |
| 4 | errgroup with cold state          | tunny with warm state            | 4× faster                     |
| 5 | pool for small N                   | raw goroutines                   | Cleaner                       |
| 6 | per-handler pools                  | shared semaphore                 | Correct bound                 |
| 7 | no panic handler                   | panic handler                    | Survives bad input            |
| 8 | unbounded queue                    | MaxBlockingTasks                 | Bounded memory                |
| 9 | Submit with closure                | Invoke                           | Lower allocs                  |
| 10 | no ctx                            | ctx propagation                  | Clean cancellation            |
| 11 | tunny without warm state          | semaphore                        | Less code, no dep             |

---

## When NOT to Optimize

Sometimes the obvious optimization isn't worth it.

- If the workload runs once a day for 5 seconds, micro-optimizing pool internals saves nothing meaningful.
- If your team is unfamiliar with the new library, the learning cost exceeds the perf gain.
- If the pool is in a stable, low-traffic path, leave it.
- If you have higher-leverage problems elsewhere.

Optimization is a triage decision. Spend time where it pays.

---

## Diagnosis Workflow

Before optimizing, diagnose:

1. **Profile**: where does the time/memory go? pprof CPU, heap, mutex.
2. **Measure**: p50, p99, throughput, CPU, memory.
3. **Identify bottleneck**: is it the pool, the task code, the downstream, the GC?
4. **Compute upper bound**: how much could optimization help? If <10%, may not be worth.
5. **Prototype**: implement the optimization in a branch.
6. **Benchmark**: compare. Statistical significance?
7. **Ship or shelve**: based on data.

---

## A Few Worked Numbers

For each optimization, illustrative numbers (will vary):

| # | Before throughput | After throughput | Before CPU% | After CPU% | Gain     |
|---|-------------------|-------------------|-------------|-------------|----------|
| 1 | 50k/sec           | 50k/sec           | 35%          | 35%          | code     |
| 2 | 100k/sec          | 150k/sec          | 60%          | 55%          | 50% rps  |
| 3 | 80k/sec           | 200k/sec          | 70%          | 55%          | 2.5×     |
| 4 | 20 docs/sec       | 80 docs/sec        | 35%          | 80%          | 4×       |
| 5 | 1000/sec          | 1000/sec           | 5%           | 4%           | code     |
| 6 | 800/sec (with 429s) | 800/sec (clean)   | 30%          | 25%          | reliable |
| 7 | crashes 1×/day     | stable             | n/a          | n/a          | uptime   |
| 8 | OOM on burst       | stable             | n/a          | n/a          | uptime   |
| 9 | 200k/sec           | 250k/sec           | 60%          | 55%          | 25% rps  |
| 10 | bad shutdown      | clean              | n/a          | n/a          | ops      |
| 11 | 500 RPS           | 500 RPS            | 25%          | 22%          | code     |

The biggest wins are in worker-state warmup (#4) and sharded queues (#3) — when you have the right shape. The code/operational wins (#1, #5, #11, #10, #7, #8) don't show in throughput but matter for maintainability.

---

End of `optimize.md`.
