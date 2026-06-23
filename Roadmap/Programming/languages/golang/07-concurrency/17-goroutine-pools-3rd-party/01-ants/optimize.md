---
layout: default
title: Optimize
parent: ants
grand_parent: Goroutine Pools (3rd-party)
ancestor: Go
nav_order: 10
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/17-goroutine-pools-3rd-party/01-ants/optimize/
---

# ants — Optimisation Exercises

[← Back](../)

Ten optimisation scenarios. Each has a baseline (slow or wrong), a target (what to achieve), and one or more proposed optimisations. Apply them, measure, compare.

Each scenario assumes you have benchmarks. If not, write them first.

---

## Scenario 1 — Sizing the Pool

**Baseline:**

```go
pool, _ := ants.NewPool(10)
defer pool.Release()
var wg sync.WaitGroup
for i := 0; i < 1000; i++ {
	wg.Add(1)
	_ = pool.Submit(func() { defer wg.Done(); time.Sleep(100 * time.Millisecond) })
}
wg.Wait()
```

**Problem:** Each task takes 100 ms. With cap 10, total time = 1000/10 × 0.1 = 10 sec. Throughput = 100 ops/sec.

**Target:** Reduce total time to 2 sec. Throughput = 500 ops/sec.

**Optimisation:** Increase cap. To get 500 ops/sec with 100 ms tasks, need cap = 500 × 0.1 = 50.

```go
pool, _ := ants.NewPool(50)
```

**Measure:**

Before: ~10 sec.
After: ~2 sec.

**Reflection:** Capacity is the primary lever. Sized to match `throughput * duration`.

---

## Scenario 2 — Batching Submits

**Baseline:**

```go
pool, _ := ants.NewPool(50)
defer pool.Release()
var wg sync.WaitGroup
for i := 0; i < 1_000_000; i++ {
	wg.Add(1)
	i := i
	_ = pool.Submit(func() {
		defer wg.Done()
		_ = i * 2
	})
}
wg.Wait()
```

**Problem:** 1M submits. Each submit has ~100 ns overhead. Total submit overhead = 100 ms. Tasks are trivial; submit overhead dominates.

**Target:** Cut submit overhead by 10x or more.

**Optimisation:** Batch. Each task processes a chunk of items.

```go
pool, _ := ants.NewPool(50)
defer pool.Release()
const chunk = 1000
var wg sync.WaitGroup
for start := 0; start < 1_000_000; start += chunk {
	wg.Add(1)
	end := start + chunk
	if end > 1_000_000 { end = 1_000_000 }
	_ = pool.Submit(func() {
		defer wg.Done()
		for i := start; i < end; i++ { _ = i * 2 }
	})
}
wg.Wait()
```

Now: 1000 submits instead of 1M. Submit overhead negligible.

**Measure:** orders of magnitude faster.

**Reflection:** Batching trades tail latency (slow chunks block one worker) for throughput.

---

## Scenario 3 — Reducing Lock Contention

**Baseline:**

```go
pool, _ := ants.NewPool(1000)
defer pool.Release()
var wg sync.WaitGroup
for p := 0; p < 16; p++ {
	go func() {
		for i := 0; i < 10000; i++ {
			wg.Add(1)
			_ = pool.Submit(func() { defer wg.Done() })
		}
	}()
}
wg.Wait()
```

**Problem:** 16 producers all hitting the same pool lock. Pprof shows `runtime.lock_slow` hot.

**Target:** Reduce lock contention.

**Optimisation:** `MultiPool` with 4 shards.

```go
mp, _ := ants.NewMultiPool(4, 250, ants.RoundRobin)
defer mp.ReleaseTimeout(10 * time.Second)
```

Lock split across 4 sub-pools. Contention drops by ~75%.

**Measure:** Throughput should jump significantly under contention.

**Reflection:** For high-contention workloads, sharding the lock is the main lever.

---

## Scenario 4 — Closure Allocation

**Baseline:**

```go
pool, _ := ants.NewPool(100)
defer pool.Release()
for i := 0; i < 1_000_000; i++ {
	i := i
	_ = pool.Submit(func() { process(i) })
}
```

**Problem:** Each `Submit` allocates a closure (captures `i`). 1M allocations → GC pressure.

**Target:** Eliminate per-submit allocation.

**Optimisation:** `PoolWithFunc`.

```go
pool, _ := ants.NewPoolWithFunc(100, func(arg interface{}) {
	process(arg.(int))
})
defer pool.Release()
for i := 0; i < 1_000_000; i++ {
	_ = pool.Invoke(i)
}
```

The `int` is passed as `interface{}` — boxed but cheaper than a closure. For really hot loops, use an arg struct from a `sync.Pool`.

**Measure:** allocations per op down by ~5x; throughput up by 20-30% for trivial tasks.

**Reflection:** `PoolWithFunc` shines when the same function runs millions of times.

---

## Scenario 5 — Switching to MultiPool

**Baseline:**

```go
// Service uses one Pool of cap 2000. CPU profile shows ants.Submit at 20% under load.
pool, _ := ants.NewPool(2000)
```

**Problem:** Single lock is the bottleneck.

**Target:** Reduce `runtime.lock_slow` from profile.

**Optimisation:** Switch to `MultiPool`.

```go
mp, _ := ants.NewMultiPool(8, 250, ants.RoundRobin)
```

8 shards × 250 = 2000 same total cap. Per-shard contention is 1/8.

**Measure:** Throughput up significantly under load. CPU profile shows less time in lock.

**Reflection:** Same total cap, different distribution. Use when measurement shows contention.

---

## Scenario 6 — Adjust Expiry for Bursty Workload

**Baseline:**

```go
pool, _ := ants.NewPool(500)
defer pool.Release()
// Bursts of 500 tasks every 30 seconds, idle in between.
```

**Problem:** Default expiry is 1 sec. Workers die in the idle window. Each burst re-spawns 500 workers. Wasted work.

**Target:** Keep workers warm between bursts.

**Optimisation:**

```go
pool, _ := ants.NewPool(500, ants.WithExpiryDuration(60 * time.Second))
```

Workers stay alive 60 sec — covers idle window.

**Measure:** Per-burst latency lower; first task in burst starts faster.

**Reflection:** Match expiry to workload's quiet periods.

---

## Scenario 7 — Pre-Warming

**Baseline:**

Service starts; first 500 incoming requests pay worker-spawn cost.

```go
pool, _ := ants.NewPool(500)
defer pool.Release()
// Receive 500 incoming requests at t=1
```

**Problem:** First 500 requests are slower than later ones because workers are spawned on demand.

**Target:** Eliminate the first-burst slowness.

**Optimisation:** Pre-warm at startup.

```go
pool, _ := ants.NewPool(500)
defer pool.Release()

// Pre-warm
var wg sync.WaitGroup
for i := 0; i < 500; i++ {
	wg.Add(1)
	_ = pool.Submit(func() { defer wg.Done() })
}
wg.Wait()

// Now ready
```

After pre-warm, workers are spawned and recycled in `sync.Pool` cache. Next real burst hits warm workers.

**Measure:** First-burst p99 lower.

**Reflection:** Trade startup time for steady-state latency.

---

## Scenario 8 — Reducing Submit Overhead via Wrapper Removal

**Baseline:**

```go
type Pool struct { p *ants.Pool }
func (p *Pool) Submit(t func()) error {
	metrics.SubmitTotal.Inc()
	start := time.Now()
	defer func() {
		metrics.SubmitLatency.Observe(time.Since(start).Seconds())
	}()
	return p.p.Submit(t)
}
```

**Problem:** Wrapper adds ~100 ns per submit (deferred function, metric updates). For trivial tasks, this is significant.

**Target:** Reduce wrapper overhead.

**Optimisation:** Inline the metric, skip defer, sample:

```go
var sampler = atomic.Int64{}
func (p *Pool) Submit(t func()) error {
	err := p.p.Submit(t)
	if err == nil {
		metrics.SubmitTotal.Inc()
	}
	if sampler.Add(1) % 1000 == 0 {
		// sample latency every 1000th submit
	}
	return err
}
```

Or just don't instrument the hot path.

**Measure:** Per-submit overhead drops.

**Reflection:** Observability has cost. Sample to reduce it.

---

## Scenario 9 — Adjusting GOMAXPROCS for CPU-Bound Pool

**Baseline:**

CPU-bound service in a container with 4 CPU cores. Pool cap 100. `GOMAXPROCS` is default (host CPU count, say 32).

**Problem:** Too much scheduling overhead. Pool of 100 has 100 goroutines competing for 4 cores, but Go thinks it has 32 to play with.

**Target:** Right-size `GOMAXPROCS` for the container.

**Optimisation:** Use `automaxprocs`.

```go
import _ "go.uber.org/automaxprocs"
```

Auto-sets `GOMAXPROCS` to container CPU limit (4 in this case).

**Measure:** CPU usage smoother, throughput potentially higher.

**Reflection:** Container-aware `GOMAXPROCS` is a small change with big impact.

---

## Scenario 10 — Releasing Memory After Peak

**Baseline:**

```go
pool, _ := ants.NewPool(2000, ants.WithDisablePurge(true))
defer pool.Release()
```

**Problem:** `WithDisablePurge(true)` keeps workers alive forever. After a peak, 2000 workers' stacks (each ~10 KB) = 20 MB held even when idle.

**Target:** Reclaim memory after peak.

**Optimisation:** Re-enable purge with a moderate expiry.

```go
pool, _ := ants.NewPool(2000, ants.WithExpiryDuration(120 * time.Second))
defer pool.Release()
```

After 2 min idle, workers expire and stacks are released.

**Measure:** Heap drops between peaks. Trade-off: each new peak pays spawn cost.

**Reflection:** Expiry is a memory-vs-latency dial.

---

## Scenario 11 — Avoiding Goroutine Leak via Blocked Submitters

**Baseline:**

```go
pool, _ := ants.NewPool(100)
defer pool.Release()
for evt := range events {
	evt := evt
	_ = pool.Submit(func() { handle(evt) })
}
```

**Problem:** If `handle` is slow and `events` is fast, the pool fills, then blocked submitters accumulate. Goroutine count grows.

**Target:** Cap blocked submitters.

**Optimisation:** `WithMaxBlockingTasks`.

```go
pool, _ := ants.NewPool(100, ants.WithMaxBlockingTasks(1000))
```

After 1000 blocked submitters, the rest get `ErrPoolOverload`. Producer should slow down (read fewer events) or shed.

**Measure:** Goroutine count plateaus instead of growing.

**Reflection:** Backpressure requires bounding all the way up the stack.

---

## Scenario 12 — Switching to PoolWithFunc for Hot Loop

**Baseline:**

```go
pool, _ := ants.NewPool(500)
defer pool.Release()
for _, item := range items {
	item := item
	_ = pool.Submit(func() {
		processItem(&item)
	})
}
```

**Problem:** 100k items/sec. Each `Submit` allocates a closure.

**Target:** Reduce allocations.

**Optimisation:** Use `PoolWithFunc` with pointer arg:

```go
pool, _ := ants.NewPoolWithFunc(500, func(arg interface{}) {
	processItem(arg.(*Item))
})
defer pool.Release()
for i := range items {
	_ = pool.Invoke(&items[i])
}
```

Each `Invoke` passes a pointer; no closure allocation.

**Measure:** GC pressure down significantly.

**Reflection:** For very hot loops, `PoolWithFunc` is the optimisation lever.

---

## Scenario 13 — Cache Tuning via sync.Pool

**Baseline:**

```go
pool, _ := ants.NewPoolWithFunc(100, func(arg interface{}) {
	req := arg.(*Request)
	res := process(req)
	send(res)
})

for i := 0; i < 1_000_000; i++ {
	r := &Request{ID: i}
	_ = pool.Invoke(r)
}
```

**Problem:** 1M `*Request` allocations.

**Target:** Reduce allocations to near zero.

**Optimisation:** Recycle `*Request` via `sync.Pool`.

```go
var reqPool = sync.Pool{New: func() any { return new(Request) }}

pool, _ := ants.NewPoolWithFunc(100, func(arg interface{}) {
	req := arg.(*Request)
	defer reqPool.Put(req)
	res := process(req)
	send(res)
})

for i := 0; i < 1_000_000; i++ {
	r := reqPool.Get().(*Request)
	r.ID = i
	_ = pool.Invoke(r)
}
```

Reusable structs. Allocations drop to almost zero.

**Measure:** Heap allocations near zero. GC pressure tiny.

**Reflection:** `sync.Pool` for transient objects is the standard Go optimisation.

---

## Scenario 14 — Tune Down During Off-Hours

**Baseline:**

```go
pool, _ := ants.NewPool(2000)
defer pool.Release()
// Service runs 24/7 with 90% lower load at night.
```

**Problem:** 2000 workers always alive (with `WithDisablePurge`). Memory waste at night.

**Target:** Free memory at night, full capacity at day.

**Optimisation:** Time-based `Tune`.

```go
go func() {
	t := time.NewTicker(10 * time.Minute)
	for range t.C {
		if isNight() {
			pool.Tune(200)
		} else {
			pool.Tune(2000)
		}
	}
}()
```

Or use traffic-based tuning.

**Measure:** Memory drops at night.

**Reflection:** Dynamic tuning saves resources without operator intervention.

---

## Scenario 15 — Parallel Pipeline Stages

**Baseline:**

```go
pool, _ := ants.NewPool(100)
defer pool.Release()
for _, item := range items {
	item := item
	_ = pool.Submit(func() {
		stage1(item)
		stage2(item)
		stage3(item)
	})
}
```

**Problem:** stage1 is CPU-bound, stage2 is I/O, stage3 is DB. They have different concurrency profiles. Single pool not optimal.

**Target:** Each stage runs in its own pool, sized appropriately.

**Optimisation:** Pipeline of pools.

```go
pool1, _ := ants.NewPool(runtime.GOMAXPROCS(0)) // CPU
pool2, _ := ants.NewPool(200) // I/O
pool3, _ := ants.NewPool(20) // DB connections

for _, item := range items {
	item := item
	_ = pool1.Submit(func() {
		stage1(item)
		_ = pool2.Submit(func() {
			stage2(item)
			_ = pool3.Submit(func() {
				stage3(item)
			})
		})
	})
}
```

Each stage sized to its bottleneck. Better resource use.

(Nested submits — watch for deadlock if any pool is small.)

**Measure:** Better resource utilisation; lower latency for the limiting stage.

**Reflection:** Pipeline pools require sizing per stage. Beware nested submit deadlocks.

---

## Reflection Exercise

For each scenario, ask:

1. What was the cost (CPU, memory, code complexity)?
2. What was the benefit (throughput, latency, resource)?
3. Is the trade-off worth it for your workload?
4. Are there secondary effects (other workloads, ops)?

Optimisations are local; their effects are global. Always re-measure end-to-end.

---

## Benchmark Template

For each optimisation, use:

```go
func BenchmarkBaseline(b *testing.B) {
	// setup baseline
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		// run baseline
	}
}

func BenchmarkOptimised(b *testing.B) {
	// setup optimised
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		// run optimised
	}
}
```

Run with `go test -bench=. -benchmem -count=3`. Compare ns/op and allocs/op.

For non-deterministic work (concurrency), use:

```go
b.RunParallel(func(pb *testing.PB) {
	for pb.Next() {
		// task
	}
})
```

---

## Profiling Commands

Useful pprof commands:

```bash
# CPU profile
go tool pprof -seconds 30 http://localhost:6060/debug/pprof/profile

# Heap
go tool pprof http://localhost:6060/debug/pprof/heap

# Goroutines
go tool pprof http://localhost:6060/debug/pprof/goroutine

# Mutex
go tool pprof http://localhost:6060/debug/pprof/mutex

# Block (waiting on channels)
go tool pprof http://localhost:6060/debug/pprof/block
```

For mutex and block, enable in code:

```go
runtime.SetMutexProfileFraction(1)
runtime.SetBlockProfileRate(1)
```

---

## A Note on Premature Optimisation

The default `ants.NewPool(N)` is fast enough for almost all use cases. Don't optimise unless:

- You have a measured problem.
- You have a benchmark proving the optimisation helps.
- The trade-off is worth it (less readable code, more complexity).

Premature optimisation often makes code worse and provides no measurable benefit.

---

## End of Optimisation

If you've worked through all 15 scenarios, you have a strong grasp of how to make `ants` perform well in real workloads. Combined with the other files in this subsection, you have everything to ship `ants` in production with confidence.

---
