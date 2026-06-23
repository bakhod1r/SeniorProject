---
layout: default
title: Senior
parent: When to Use a Pool
grand_parent: Goroutine Pools (3rd-party)
ancestor: Go
nav_order: 4
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/17-goroutine-pools-3rd-party/04-when-to-use/senior/
---

# When to Use a Pool — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Deep Comparison: API Ergonomics](#deep-comparison-api-ergonomics)
3. [Deep Comparison: Locking Strategies](#deep-comparison-locking-strategies)
4. [Deep Comparison: Allocations Per Task](#deep-comparison-allocations-per-task)
5. [Deep Comparison: Scheduling Fairness](#deep-comparison-scheduling-fairness)
6. [Deep Comparison: Memory Footprint](#deep-comparison-memory-footprint)
7. [Microbenchmarks With Real Numbers](#microbenchmarks-with-real-numbers)
8. [Profile-Driven Choices](#profile-driven-choices)
9. [Cache Behaviour and False Sharing](#cache-behaviour-and-false-sharing)
10. [GC Interactions](#gc-interactions)
11. [Scheduler Interactions](#scheduler-interactions)
12. [Tail Latency Analysis](#tail-latency-analysis)
13. [Failure Modes and Recovery](#failure-modes-and-recovery)
14. [Race-Detector Behaviour](#race-detector-behaviour)
15. [Senior Decision Process](#senior-decision-process)
16. [Real-World Architecture Case Studies](#real-world-architecture-case-studies)
17. [Anti-Patterns at Senior Level](#anti-patterns-at-senior-level)
18. [Designing for the Long Run](#designing-for-the-long-run)
19. [Self-Assessment](#self-assessment)
20. [Summary](#summary)

---

## Introduction
> Focus: "I have built and operated services that use pools. I now want to know *why* one pool wins over another, down to the cache line."

The senior level of this subsection is about *why*. You already know which tool to reach for in 90% of cases; this file is for the other 10% and for the moments when you need to explain a benchmark result, dig into a profile, or argue technical tradeoffs in a design review.

We will:

- Compare the internals of `errgroup`, `semaphore.Weighted`, `ants`, `tunny`, `workerpool`, and `pond` at the level of "what locks does each acquire on submit?"
- Show pprof snippets from real benchmarks.
- Discuss allocations per task — including the difference between a stack-allocated closure and a heap-allocated one.
- Examine scheduling fairness — what each tool guarantees about task ordering and worker selection.
- Analyse memory footprint at idle and at peak — what's the bytes-per-worker, bytes-per-pending-task.
- Examine cache behaviour and false sharing in pool implementations.
- Discuss GC interactions: how pool task closures affect heap pressure.
- Look at scheduler interactions: how pools play with GOMAXPROCS, work-stealing, and preemption.
- Walk through tail latency analysis: why p99 spikes, and how to debug them.

This file expects you to have shipped pool-using code, read pprof output, and at least skimmed the scheduler's design doc. If not, retreat to `middle.md`.

---

## Deep Comparison: API Ergonomics

API ergonomics is not a soft topic — it is the thing that determines how often your team gets concurrency right. A library with terse, well-named APIs reduces bugs; one with verbose, ambiguous APIs causes them.

We will compare the libraries along five concrete dimensions.

### Dimension 1: Type safety of the Submit signature

The Submit signature shapes how you reason about the task.

| Library     | Signature                                          | Implication                                |
|-------------|----------------------------------------------------|-------------------------------------------|
| errgroup    | `Go(f func() error)`                                | error in/out; clean                       |
| semaphore   | `Acquire(ctx, n int64) error`                       | not a task API; manual                    |
| ants        | `Submit(task func()) error`                         | no error/result; opaque                   |
| ants v2 Pool[T] | `Invoke(payload T) error`                       | typed input; v2 only; no result          |
| tunny       | `Process(payload any) any`                          | `any` in, `any` out; type-unsafe          |
| workerpool  | `Submit(task func())`                               | no error; opaque                          |
| pond        | `Submit(task func()) Task`                          | task handle; richer                       |

The clear winner on ergonomics: errgroup. The clear loser: tunny (because of `any`).

But ergonomics is not the only factor. tunny's `any` makes sense when the worker state and the task payload are fundamentally typed at runtime (e.g., a polymorphic worker). For most uses, this is a downside.

### Dimension 2: Submitting multiple tasks

How does the API support "submit N tasks and wait for all"?

| Library     | Multi-task pattern                                                              |
|-------------|---------------------------------------------------------------------------------|
| errgroup    | Native: `g.Go` × N then `g.Wait()`                                              |
| ants        | Manual: `pool.Submit` × N + `sync.WaitGroup`                                    |
| tunny       | Manual: `pool.Process` × N (synchronous, so just loop)                           |
| workerpool  | Manual: `wp.Submit` × N + `wp.StopWait()` or `sync.WaitGroup`                    |
| pond        | Built-in: `pool.SubmitAndWait` or `group := pool.Group(); group.Submit; group.Wait()` |

errgroup and pond have first-class "submit-and-wait" patterns; others require manual WaitGroup wiring.

### Dimension 3: Result collection

How do you get results back from N tasks?

| Library     | Result collection                                                              |
|-------------|--------------------------------------------------------------------------------|
| errgroup    | Manual: indexed slice, channel, or shared map; errgroup handles errors only    |
| ants        | Manual: closure-captured slice/channel; no native result                        |
| tunny       | Native: `Process` returns `any`; loop and collect                              |
| workerpool  | Manual: closure-captured                                                       |
| pond        | Manual or via tasks: `task.Result()`                                            |

tunny is unique in returning a typed value from each call. For workloads with results, tunny's API is the most natural.

### Dimension 4: Cancellation

How does the API integrate with `context.Context`?

| Library     | ctx support                                                                    |
|-------------|--------------------------------------------------------------------------------|
| errgroup    | First-class: WithContext, ctx cancelled on first error                         |
| semaphore   | First-class: Acquire(ctx, n) returns ctx.Err()                                 |
| ants        | None: tasks check ctx inside                                                   |
| tunny       | Partial: `ProcessCtx` cancels the wait, but in-flight worker continues         |
| workerpool  | None: tasks check ctx inside                                                   |
| pond        | None native: tasks check inside, or use Group with ctx                          |

errgroup and semaphore have first-class ctx. Pools do not. This is one of the biggest reasons errgroup is the default for fan-out.

### Dimension 5: Construction / teardown

How heavy is the lifecycle?

| Library     | Construction                                | Teardown                          |
|-------------|---------------------------------------------|------------------------------------|
| errgroup    | `errgroup.WithContext(ctx)` (no error)      | implicit at Wait()                |
| semaphore   | `NewWeighted(n)` (no error)                 | none                              |
| ants        | `NewPool(n, opts...)` returns (Pool, error) | `Release()` or `ReleaseTimeout`    |
| tunny       | `NewCallback(n, ctor)` (no error)           | `Close()`                          |
| workerpool  | `New(n)` (no error)                         | `StopWait()` or `Stop()`           |
| pond        | `New(n, queueCap)` (no error)               | `StopAndWait()`                    |

errgroup and semaphore have the lightest lifecycle (per-call construction). Pools require explicit construction and teardown — which is fine for long-lived pools, awkward for per-call usage.

### Verdict on ergonomics

Across these five dimensions:

- errgroup wins on type safety, multi-task, cancellation, lifecycle.
- tunny wins on result collection.
- ants is middle on most; loses on type safety, ctx.
- pond is competitive; richer than ants in some places.
- workerpool is the minimal API; few features but very small surface.

If ergonomics is the deciding factor, prefer errgroup. If you need ergonomics *and* a feature (result type, worker reuse), the choice depends on the feature.

---

## Deep Comparison: Locking Strategies

Inside each library, *how* does Submit work? What locks are acquired? What is contended?

### errgroup

`errgroup.Group` with `SetLimit(K)` uses an internal `chan struct{}` of capacity K as a semaphore. `g.Go` does:

1. Send into the channel (blocks if K already in flight).
2. Spawn the goroutine.
3. The goroutine, when done, receives from the channel.

The lock is the channel's internal mutex. Under heavy contention, the channel can serialise senders. Bench shows ~150 ns per Go call below the limit; ~2-3 μs when at the limit (including spawn).

### semaphore

`semaphore.Weighted` uses a `sync.Mutex` protecting an internal counter and a wait-list. `Acquire(ctx, n)`:

1. Lock the mutex.
2. If `n <= free`, decrement free, unlock, return.
3. Else add a waiter to the list, unlock, wait on a per-waiter channel.
4. `Release(n)` locks, increments free, wakes the head of the wait-list.

Under contention, the mutex is the bottleneck. ~100 ns Acquire when free; longer when blocked.

### ants

`ants` pool uses a custom worker queue and a `sync.Mutex` protecting the worker slice. Submit:

1. Try to fetch an idle worker (lock, pop from stack, unlock).
2. If no idle and pool not full: spawn a new worker.
3. If pool full and blocking: wait on a condition variable.
4. If non-blocking: return ErrPoolOverload.

ants uses a stack of idle workers (LIFO) — newer-idle workers serve next, which is good for cache locality. Submit is ~250 ns under low contention; the lock is a hotspot above ~10k submits/sec from multiple goroutines.

Recent ants versions added "loop queue" mode (`WithLoopQueue`) that reduces lock contention by using a circular buffer with atomic operations. Submit drops to ~150 ns under contention with this option.

### tunny

`tunny` has one Goroutine per Worker, each owning a dispatch channel. The pool has a "request channel" that fans out to whatever worker is free.

Submit (Process):

1. Send the payload to the pool's input channel (blocks if all workers are busy).
2. The dispatcher routes to an idle worker's channel.
3. The worker processes, sends back via a response channel.

There is no mutex — all coordination is via channels. The serialisation point is the dispatch loop. Process is ~600 ns at low contention; gets worse at high contention because dispatch is single-threaded.

### workerpool

`workerpool` uses a single `chan func()` task channel feeding K workers. Submit:

1. If a worker is idle and channel is empty, send directly.
2. Else queue in a slice (with a mutex).
3. Dispatcher feeds from queue to channel.

The mutex on the queue is a hotspot at high contention. Submit is ~300 ns nominally; up to 1-2 μs at high contention.

### pond

`pond` is similar to ants — a custom queue with sharding. Submit acquires a lock on one of N internal queues (sharded by some hash). Lower contention than a single-lock design.

### Summary table

| Library     | Submit core operation             | Contention point          | Submit ns (low)| Submit ns (high) |
|-------------|------------------------------------|----------------------------|----------------|------------------|
| errgroup    | channel send + spawn               | channel sema mutex         | 150-200        | 1500-3000        |
| semaphore   | mutex + counter                    | mutex                      | 80-150         | 500-2000         |
| ants        | mutex + stack pop                  | worker-stack mutex         | 200-300        | 1000-3000        |
| ants (loopq)| atomic CAS + ring buffer           | mostly contention-free     | 100-200        | 300-700          |
| tunny       | channel send                       | dispatch goroutine         | 500-700        | 3000-10000       |
| workerpool  | mutex + slice                      | queue mutex                | 250-400        | 1500-4000        |
| pond        | sharded mutex + queue              | shard mutex                | 150-300        | 500-1500         |

These numbers are illustrative; rerun on your hardware. The shape — which one is fastest under contention — is stable across hardware.

### What this means

At low throughput (<1k submits/sec from few producers), the difference is invisible. At very high throughput (>100k submits/sec from many producers), the difference is 5-10x. If your benchmark shows a tight loop dominated by submit overhead, the library choice matters.

---

## Deep Comparison: Allocations Per Task

A pool's "allocations per task" affects both CPU (allocations cost) and GC pressure (heap survivor work).

### Where do allocations come from?

1. **The task closure.** `pool.Submit(func() { ... })` allocates a closure on the heap (unless the compiler can prove it's stack-allocatable, which is rare for closures captured in a `for` loop).
2. **The task queue node.** Some libraries wrap the closure in a queue-element struct.
3. **Per-worker state at construction.** One-time, doesn't show up per-task.

### Allocations per task: real numbers

Measured via `go test -benchmem`:

| Pattern                                          | Allocs/op | Bytes/op |
|--------------------------------------------------|-----------|----------|
| `go func() { _ = i }()` (raw)                    | 2         | 64       |
| errgroup.Go with closure                         | 3         | 96       |
| ants.Submit with closure                         | 0         | 0        |
| ants.Submit + closure capturing i                | 1         | 16       |
| tunny.Process with int payload                   | 0         | 0        |
| tunny.Process with struct payload                | 1         | 24       |
| workerpool.Submit with closure                   | 1         | 16       |

ants has the surprising result of 0 allocs/op when the closure captures nothing — because the closure can be a function pointer rather than a heap-allocated function value. When the closure captures variables, you get one alloc per capture.

errgroup has higher per-call allocation because it builds an internal sync structure each time.

For workloads with billions of tasks (rare), the alloc/op number matters. For typical workloads, the difference is invisible.

### Reducing allocations

Several techniques:

1. **Avoid closures with captures.** Use `tunny`-style payload passing where the typed payload travels through the system. The task function itself has no captures.

2. **Reuse closures.** If you're submitting the same function for many items, define one closure with state in a struct:

```go
type Submitter struct {
	pool *ants.Pool
}

func (s *Submitter) Run(items []Item) {
	for _, it := range items {
		s.runOne(it)
	}
}

func (s *Submitter) runOne(it Item) {
	s.pool.Submit(func() { processItem(it) })
}
```

The closure captures only `it`, which is a simple value. The compiler may stack-allocate if `it` is a small value type — but for an interface or pointer, it allocates.

3. **Use typed pool variants.** `ants.MultiPool` and `ants.PoolWithFunc[T]` (with one stored function) avoid per-task closure allocation. The function is set once; payloads are passed:

```go
pool, _ := ants.NewPoolWithFunc(K, func(arg any) {
	// arg is the payload
	work(arg.(Item))
})

pool.Invoke(Item{...}) // no closure!
```

`Invoke` is faster than `Submit` because there's no closure to allocate. But the worker's function is fixed at pool construction.

4. **Batch.** Instead of submitting 1000 tiny tasks, submit 10 "batch" tasks each processing 100 items. The closure overhead is paid once per batch, not per item.

### When alloc/op matters

- Million-tasks-per-second workloads (game servers, ad-tech).
- Memory-constrained environments where GC pressure is the bottleneck.
- Real-time systems where allocation pauses are problematic.

For typical CRUD services at moderate RPS, alloc/op is noise.

### When alloc/op doesn't matter

Most of the time. If each task takes 1 ms of work, a 100 ns allocation is 0.01% of the work. Optimise elsewhere.

---

## Deep Comparison: Scheduling Fairness

When you submit N tasks to a pool, in what order do they execute? What does each library guarantee?

### Pool ordering semantics

| Library     | Queue order        | Worker selection         | Fairness                                         |
|-------------|--------------------|--------------------------|--------------------------------------------------|
| errgroup    | FIFO via spawn order | Go runtime decides       | No guarantee; scheduler-dependent                |
| semaphore   | FIFO wait-list     | Go runtime decides       | FIFO acquire order; runtime executes when scheduled |
| ants        | LIFO worker stack  | Newest-idle worker       | Newer workers warm; older may starve at low load |
| ants (loopq)| FIFO ring buffer   | Any worker               | FIFO                                             |
| tunny       | FIFO dispatch      | Any idle worker          | FIFO                                             |
| workerpool  | FIFO queue         | Round-robin via channel   | FIFO                                             |
| pond        | FIFO sharded       | Any worker in shard       | Mostly FIFO; shard-dependent                     |

**Why LIFO in ants?** When the workload has bursts of activity then idleness, the newest-idle worker has the warmest cache. LIFO maximises cache hits. The cost is older workers may sit idle and eventually expire (which may be desirable).

**FIFO benefit:** predictability. If task A arrives before task B, A starts before B (modulo brief reordering). Important for fairness across tenants or task classes.

### When fairness matters

- **Multi-tenant systems:** if tenant A submits 1000 tasks and tenant B submits 1 task, you want tenant B's single task to start before all 1000 of A's. LIFO breaks this; FIFO partially solves it (tenant B's task is at the back of the FIFO queue but doesn't wait for all 1000 of A's to complete — only until a worker is free). The right tool here is *per-tenant queues* — neither LIFO nor FIFO of a single queue.

- **Latency-sensitive interleaved workloads:** tail latency depends on worst-case wait. FIFO gives predictable wait; LIFO can starve.

- **Backpressure visibility:** FIFO with a bounded queue gives clear "queue depth = wait time" intuition. LIFO does not.

### How to enforce fairness

If you need strict fairness:

- Use FIFO pools (workerpool, tunny, ants-loopqueue).
- Avoid LIFO defaults of ants.
- Add per-tenant queues or token buckets.

If you need cache-friendly LIFO:

- Use ants default.
- Accept that under sustained load, the same workers serve repeatedly.

### A worked example: starvation under LIFO

Imagine a pool of 4 ants workers. A producer submits 1 task. Worker 1 takes it. Idle workers 2, 3, 4 are placed on the stack in some order. Worker 1 finishes; the next task arrives — Worker 1 is on top of the stack, takes it. Workers 2, 3, 4 remain idle. With low traffic, Workers 2, 3, 4 may sit idle indefinitely until they expire.

This is usually fine: under low load, you don't need 4 workers anyway. But if Workers 2, 3, 4 are expensive to construct, you wanted them warm. Switch to FIFO (`WithLoopQueue`) or to tunny which uses a different model.

---

## Deep Comparison: Memory Footprint

How much memory does each library consume?

### Per-pool baseline

The pool object itself (not workers, not tasks): typically 100-500 bytes. Negligible.

### Per worker

A worker is a goroutine. Initial stack: ~2 KB. With pool-specific state, perhaps another 200-1000 bytes.

| Library     | Per-worker memory      |
|-------------|-------------------------|
| errgroup    | n/a (no persistent workers) |
| ants        | ~3 KB                   |
| tunny       | ~3 KB + worker state    |
| workerpool  | ~3 KB                   |
| pond        | ~3 KB                   |

For a pool of 1000 workers: ~3 MB. Negligible on modern hardware.

### Per pending task

| Library     | Per-task memory       |
|-------------|------------------------|
| errgroup    | ~96 bytes (goroutine + closure + semaphore entry) |
| ants        | ~30-50 bytes (closure + queue entry) |
| tunny       | n/a (no queue; Process blocks)        |
| workerpool  | ~50 bytes              |
| pond        | ~50 bytes              |

For 1M pending tasks in a queue: 50 MB. Real, but only at extreme queue depths.

### Total at peak

For a typical service: K=500 pool, queue depth=2000 max.

Workers: 500 × 3 KB = 1.5 MB.
Pending tasks: 2000 × 50 bytes = 100 KB.

Total pool memory: ~1.6 MB. Trivial.

For a massive service: K=10000, queue depth=100000.

Workers: 10000 × 3 KB = 30 MB.
Pending tasks: 100000 × 50 bytes = 5 MB.

Total: 35 MB. Still trivial relative to typical service heaps (hundreds of MB to GB).

### When memory matters

- **Embedded / resource-constrained environments** (IoT, edge): a 30 MB pool may be 10% of available RAM.
- **Containers with tight limits:** the pool's overhead competes with your hot data.
- **Very large pools at idle:** if you size K to peak but the system runs at 10% peak most of the time, you're paying for 10× more workers than needed. Tune lower or use idle expiry.

### Idle-time memory

If workers expire after idle, the pool shrinks. ants default: 1 second idle = expire. The pool returns to a minimal size between bursts.

If you want workers to stay warm: disable expiry (set very high) or use tunny (no expiry).

### Stack growth

Go goroutines grow their stack on demand. A pool worker that runs the same shallow function will keep a small stack. A worker that occasionally runs a deeply recursive function will grow its stack and the stack will stay larger for the worker's life. This is mostly invisible but can surprise you at peak.

---

## Microbenchmarks With Real Numbers

Below are illustrative `go test -bench` results from a typical M1 Pro laptop. Numbers will differ on Linux x86 by 1.5-3x.

### Benchmark: 100k atomic-increment tasks

```go
func BenchmarkRaw(b *testing.B) {
	var counter atomic.Int64
	for i := 0; i < b.N; i++ {
		var wg sync.WaitGroup
		for j := 0; j < 100000; j++ {
			wg.Add(1)
			go func() { defer wg.Done(); counter.Add(1) }()
		}
		wg.Wait()
	}
}

func BenchmarkErrgroup(b *testing.B) {
	var counter atomic.Int64
	for i := 0; i < b.N; i++ {
		g, _ := errgroup.WithContext(context.Background())
		g.SetLimit(1024)
		for j := 0; j < 100000; j++ {
			g.Go(func() error { counter.Add(1); return nil })
		}
		_ = g.Wait()
	}
}

func BenchmarkAnts(b *testing.B) {
	var counter atomic.Int64
	pool, _ := ants.NewPool(1024)
	defer pool.Release()
	for i := 0; i < b.N; i++ {
		var wg sync.WaitGroup
		for j := 0; j < 100000; j++ {
			wg.Add(1)
			pool.Submit(func() { defer wg.Done(); counter.Add(1) })
		}
		wg.Wait()
	}
}
```

Results (approximate):

```
BenchmarkRaw-10           5    250ms/op    200000 allocs/op
BenchmarkErrgroup-10     10    180ms/op    300000 allocs/op
BenchmarkAnts-10         20     85ms/op         5 allocs/op
```

ants is ~3x faster on this workload, with 40,000x fewer allocations. The work is so cheap (atomic.Add) that overhead dominates.

### Benchmark: 100k 100-μs CPU tasks

Each task does a 100 μs CPU burst (some loop).

```
BenchmarkRaw-10          50      30ms/op    200000 allocs/op
BenchmarkErrgroup-10     50      32ms/op    300000 allocs/op
BenchmarkAnts-10         50      29ms/op         5 allocs/op
```

When the work itself is 100 μs, overhead is ~0.3% of the runtime. All three approaches are within noise.

### Benchmark: 1k HTTP-call tasks

Each task makes one HTTP GET to a local server (median ~5 ms).

```
BenchmarkRaw (unbounded)-10      1   1.1s/op   2000 allocs/op (peak 1 GB memory)
BenchmarkErrgroup K=100-10       1   2.0s/op   3000 allocs/op (peak 50 MB)
BenchmarkAnts K=100-10            1   2.0s/op   1000 allocs/op (peak 50 MB)
```

At I/O-heavy workloads with bounding, all bounded approaches are equivalent. The "raw unbounded" version is faster but uses 20× memory.

### Benchmark: tunny vs errgroup with warm-state init

Each task uses a 50ms warm state (regex compile). With tunny, the regex is compiled once per worker; with errgroup, compiled per task.

```
BenchmarkErrgroup K=4-10       1     12.6s/op    250 allocs/op
BenchmarkTunny K=4-10          1      3.5s/op     50 allocs/op
```

tunny wins by 4× on this workload because of warm-state amortisation.

### Reading benchmark results

Three takeaways:

1. **At low task cost**, pool overhead matters; ants wins.
2. **At high task cost (real I/O, real CPU)**, overhead is invisible; any bounded approach is fine.
3. **At warm-state workloads**, tunny wins by reusing the state.

Benchmark your actual workload. Generic benchmarks (atomic.Add, sleep, no-op) don't predict your service's behaviour.

---

## Profile-Driven Choices

When choosing or tuning a pool, profile *your* service. Here is how to extract the right data.

### CPU profile

```go
import _ "net/http/pprof"

go func() {
	http.ListenAndServe(":6060", nil)
}()
```

Then `go tool pprof -seconds=30 http://localhost:6060/debug/pprof/profile`.

In the profile, look for:

- **Time in `runtime.newproc` or `runtime.goexit0`:** goroutine creation. High percentage means you're paying for spawn — consider a pool.
- **Time in `sync.Mutex` or `chan send`:** pool internal lock or channel contention. Check your tool choice.
- **Time in pool-specific code (e.g., `ants.(*Pool).Submit`):** how much of CPU is pool dispatch.

If pool dispatch is >5% of CPU, the pool is *too small* for the workload (saturated) or the wrong shape (lock-heavy).

### Heap profile

```bash
go tool pprof http://localhost:6060/debug/pprof/heap
```

Look for:

- **Goroutine stacks:** if `runtime.gohacks` or similar shows many MB, you have too many goroutines.
- **Task closures:** look for `*func()` and `*funcInfo` types. Many of these = high task throughput. Consider Invoke-style or batching.
- **Worker state:** per-worker structs.

### Goroutine profile

```bash
go tool pprof http://localhost:6060/debug/pprof/goroutine
```

Look for:

- **Total goroutine count:** should be steady. Growing = leak.
- **Goroutines blocked on chan send:** producers blocked because pool is saturated.
- **Goroutines parked in pool worker loops:** idle workers. Their count should be ≤ pool cap.

### Block profile

```bash
go tool pprof http://localhost:6060/debug/pprof/block
```

Block profile shows where goroutines sit waiting. For a pool, you want to see:

- Workers blocking on the task channel (idle, fine).
- Producers blocking on Submit (saturated; expected under heavy load).

If you see workers blocking on a downstream lock or channel, that's the bottleneck — not the pool.

### Mutex profile

```bash
go tool pprof http://localhost:6060/debug/pprof/mutex
```

Mutex profile shows contended locks. If the pool's internal mutex is high here, consider switching to ants-loopqueue or pond (sharded). If it's *your* mutex inside a task, the pool isn't the problem.

### Tail latency

```bash
# expvar or prometheus-style histogram
```

Plot p50, p95, p99 over time. Spikes in p99 with stable p50 indicate queue buildup at peak. Investigate: is the pool saturated? Is the queue unbounded? Is a downstream slow?

---

## Cache Behaviour and False Sharing

A senior topic that comes up in extreme-perf pool work.

### What is false sharing?

When two CPU cores write to different variables that happen to live on the *same cache line* (typically 64 bytes), each write invalidates the other's cache, causing slow synchronisation. The variables are "falsely shared" — they don't actually share data, but they share a cache line.

In a pool, this can happen when:

- Multiple workers update adjacent counters in a slice (e.g., per-worker stats packed too tightly).
- The pool's internal queue head/tail pointers live on the same line.

### How libraries avoid it

- **ants:** uses cache-line padding in some internal structs (since v2.5 or so).
- **tunny:** less concern, because per-worker state is separately heap-allocated.
- **workerpool:** typically not optimised; for typical workloads, fine.
- **pond:** sharded queues, naturally less false sharing.

### When to care

False sharing matters at >10M ops/sec from multiple cores. For typical pool workloads, invisible. If a profile shows surprising CPU on memory traffic, investigate.

### How to fix it

Cache-line padding:

```go
type PaddedCounter struct {
	v int64
	_ [56]byte // pad to 64 bytes
}
```

For workloads where you measured a false-sharing problem.

---

## GC Interactions

Pools affect the garbage collector in subtle ways.

### Task closures and the GC

Each task closure (when allocated on the heap) is a small allocation that the GC must trace. Millions of closures per second = significant GC pressure.

Symptoms of pool-induced GC pressure:

- p99 latency spikes during GC.
- `runtime.gcBgMarkWorker` high in CPU profile.
- `go_memstats_gc_duration_seconds` (Prometheus) high.

Mitigations:

1. Reduce per-task allocations (batch, Invoke-style, no captures).
2. Tune GOGC higher (e.g., `GOGC=200`) to GC less often. Trades memory for less CPU on GC.
3. Use object pools (`sync.Pool`) for task payload types.

### Pool workers and GC

Pool workers are long-lived goroutines. Their stacks may grow over time. The GC traces all stacks, so a pool of 10,000 workers with 8 KB stacks each = 80 MB of stack to trace per GC cycle.

For most services, fine. For services where GC pause matters, monitor.

### Tunny and worker state

If each tunny worker holds a large cache (e.g., 100 MB regex), the total heap is K × 100 MB. The GC traces all of this. Tunny workers with big state can produce big GC.

### errgroup and GC

errgroup creates a goroutine per task. Goroutine creation allocates a goroutine struct and stack. GC sees these. Errgroup-heavy workloads can have higher GC than pool-based workloads, in absolute numbers — though GC is usually not the bottleneck.

---

## Scheduler Interactions

Pools interact with the Go scheduler in a few notable ways.

### GOMAXPROCS

A pool with K=1000 workers exists, but only GOMAXPROCS of them run at once. The rest are parked (idle) or runnable (waiting for a CPU). If K >> GOMAXPROCS for CPU-bound work, the extra workers are wasted (and add scheduling overhead). For I/O-bound work, K >> GOMAXPROCS is fine — most workers are parked on I/O.

### Work stealing

Go's scheduler does work stealing across P-queues. A pool worker that does work on P1 and then becomes idle will move to P1's local queue and be popped from there next time. Cache locality is OK in most cases.

### Async preemption (Go 1.14+)

Goroutines can be preempted at "safe points" without explicit yields. This means a CPU-hogging pool worker won't starve other goroutines for long. Pre-1.14 Go could have CPU-bound workers monopolise a P; modern Go does not.

### sysmon

The sysmon thread monitors for goroutines blocking in syscalls. When a pool worker enters a syscall (e.g., file read), sysmon may detach the worker's M (thread) so the P can run other goroutines. This is fine for pools doing I/O — the runtime handles thread expansion automatically.

### Park/unpark of workers

When a pool worker has no task, it parks. When a task arrives, it's unparked. Each park/unpark is ~200ns. For very high task rates, this overhead accumulates. Some pools (ants with spin mode, if available) briefly spin before parking to avoid the cost — at the cost of CPU during the spin.

---

## Tail Latency Analysis

Senior pool work often hinges on tail latency (p99, p999, p9999). What causes tail spikes in pool-using code?

### Cause 1: Saturation

When the pool is at K and producers keep submitting, new submissions wait. The submitter blocks. Wait time grows. p99 spikes.

Detection: queue depth metric, submit-wait histogram.

Mitigation: raise K, drop on overload, scale out.

### Cause 2: GC pause

Stop-the-world GC pauses all goroutines, including pool workers. A 100ms GC pause = 100ms added to whatever's in flight.

Detection: correlate p99 spikes with GC events (`go_gc_duration_seconds`).

Mitigation: reduce allocations, tune GOGC, use sync.Pool.

### Cause 3: One slow task

If one task takes 10× longer than typical (a slow downstream, a slow query), that task blocks one worker for 10×. New tasks that need that worker's spot wait.

Detection: per-task duration histogram with very wide buckets.

Mitigation: per-task timeout, circuit breaker on downstream, separate pools for slow vs fast work.

### Cause 4: Worker startup

If a worker just woke from idle and needs to warm up (cache fill, JIT, whatever), the first task on a freshly-started worker is slower. Idle expiry = repeated cold starts.

Detection: tail latency correlated with periods of low load.

Mitigation: disable idle expiry, longer expiry, or warm-state via tunny.

### Cause 5: Scheduler latency

A goroutine that's runnable but not running waits for a P. If GOMAXPROCS is low or many CPU-bound goroutines compete, this wait grows.

Detection: scheduler trace (`GODEBUG=schedtrace=1000`) shows runnable count.

Mitigation: GOMAXPROCS tuning, fewer CPU-bound concurrent goroutines.

### Cause 6: Lock contention

The pool's internal lock or your own task-internal lock causes serial execution. Effective concurrency drops; tail rises.

Detection: mutex profile.

Mitigation: sharded locks, lock-free structures, smaller critical sections.

### Cause 7: Network jitter

For I/O-bound pools, p99 of the network call drives p99 of the task. Pool didn't cause it; downstream did.

Detection: pre-pool latency measurements.

Mitigation: retry with backoff, hedging, faster downstream.

### Approach: bisect via metrics

When tail spikes appear:

1. Plot pool queue depth — saturation?
2. Plot per-task duration p99 — slow tasks?
3. Plot GC pauses — GC?
4. Plot scheduler latency — scheduler pressure?
5. Plot downstream latency — external?

The metric that correlates is the cause. Mitigation depends.

---

## Failure Modes and Recovery

How does each library behave when things go wrong?

### Pool worker panics

| Library                | Behaviour                                              |
|------------------------|--------------------------------------------------------|
| errgroup               | Whole program crashes                                  |
| ants without PanicHandler | Whole program crashes                              |
| ants with PanicHandler | Handler called; worker recycled; pool continues       |
| tunny                  | Whole program crashes                                   |
| workerpool             | Whole program crashes                                   |
| pond with PanicHandler | Handler called; worker recycled                        |

If panic recovery without crash is required: ants or pond, or wrap each task body manually.

### Pool deadlock

A pool can deadlock if:

- Task A submits Task B and waits for B to complete; B requires the same pool worker A holds.
- All workers are blocked on a common resource that itself depends on a worker.

Detection: goroutine profile, watch for many goroutines blocked on the same channel/lock.

Mitigation: don't submit-and-wait inside a pool task using the same pool. Use a separate pool, or just inline the work.

### Pool task leak

If a task hangs forever (no timeout), the worker is stuck. K-1 workers remain. Eventually all workers are stuck and the pool is dead.

Detection: pool running count not declining, queue growing.

Mitigation: per-task timeout, deadlock detection, restart the pool.

### Pool teardown timeout

`pool.ReleaseTimeout(30s)` returns after 30 seconds even if tasks are still running. The remaining tasks are abandoned. If they hold resources (files, sockets), those leak.

Mitigation: ensure tasks respect ctx cancellation and bail out on shutdown.

### Pool re-creation

If you Release a pool and then construct a new one, in-flight tasks of the old pool keep running on the old pool's workers until they finish. The new pool's workers are independent. There's no automatic migration.

### Errgroup re-use

You cannot reuse an errgroup after `Wait`. If you do, the behaviour is undefined. Always make a new group per fan-out batch.

---

## Race-Detector Behaviour

When running tests with `-race`, pools may emit race reports for shared state. Some notes:

### Real races

If your task modifies a shared variable without sync (e.g., writes to a map), the race detector flags it. The pool is a red herring — the race is in your code.

Fix: protect shared state with mutex, atomic, or sync.Map.

### Pool-internal races

Mature pool libraries (ants, tunny, workerpool) are race-free in their own code. If you see a race report inside the pool library, file a bug upstream.

### Race-detector overhead

Running with `-race` is ~2-10× slower. Use it for tests, not production. Pool-using code is often slower under `-race` because of the high concurrency.

---

## Senior Decision Process

A senior engineer doesn't just pick a tool — they document the *process* for picking. Here's a template.

### Step 1: Quantify the workload

Document:

- Task rate (avg, peak, p99 burst).
- Per-task duration (median, p99).
- Per-task memory footprint.
- Failure modes (panic, timeout, partial).
- Dependencies (DB, HTTP, etc).

### Step 2: Identify the bound

What is K rationing?

- CPU
- Downstream concurrency
- Memory
- File descriptors
- Or none — bounded by problem size

### Step 3: List candidate tools

Apply the decision tree:

- Bounded by problem: raw.
- Single number, errors, ctx: errgroup.
- Unequal weight or cross-function: semaphore.
- High rate, fire-and-forget: ants.
- Worker state: tunny.
- Simple FIFO: workerpool.
- Metrics built-in: pond.

### Step 4: Benchmark candidates

Write a microbenchmark with a synthetic workload that matches the real shape. Run all candidates. Measure:

- Throughput.
- p50/p99/p999 latency.
- CPU utilisation.
- Memory peak.
- GC overhead.

### Step 5: Production load test

Deploy the candidate (behind a feature flag) and run a load test against a staging environment. Compare:

- Real downstream behaviour.
- Real network jitter.
- Real bursts.

### Step 6: Pick, with rationale

Write up the decision in a design doc:

- Workload description.
- Candidates considered.
- Benchmark results.
- Production load test results.
- Final choice + K.
- What you'd change to invalidate the choice (e.g., "if rate exceeds 100k/sec, revisit").

### Step 7: Monitor in production

Instrument with the metrics from earlier. Set alerts. Revisit if any metric drifts.

This process is overkill for small services. For services that handle real load, it's the minimum.

---

## Real-World Architecture Case Studies

Three case studies of pool decisions in production-grade Go services.

### Case Study 1: Distributed file uploader

**Service.** Uploads files from a queue to cloud object storage. ~200 uploads/sec average. File sizes: 1 KB to 100 MB.

**Bounds.**
- S3 SDK has its own internal concurrency (~50 per client).
- Network bandwidth: 1 Gbps egress.
- Memory: 4 GiB pod; some buffering per upload.

**Decision.** errgroup with SetLimit(50), one upload per task. The S3 SDK already pools internally — adding a second pool would over-engineer.

**Sizing rationale.** S3's recommended concurrency is 50/client. Going higher provokes 503s. Going lower under-utilises bandwidth.

**Production result.** Stable at 200/sec average. Bursts to 500/sec saw errgroup back-pressure to the producer (Kafka). No drops, slightly higher queue lag during burst.

**Lesson.** errgroup is enough when the bound is a downstream limit. Don't add ants.

### Case Study 2: Real-time bidding engine

**Service.** Receives bid requests from ad exchanges. ~30k bids/sec. Each bid: lookup user features in Redis (~2 ms), run a model (~3 ms), respond.

**Bounds.**
- Bidder must respond in ≤80 ms (exchange timeout).
- 32 cores.
- Redis pool: 200 connections.

**Decision.** ants pool with K=4096, WithNonblocking=true, MaxBlockingTasks=2000.

**Rationale.**
- 30k req/sec × 5 ms = 150 in-flight average; bursts to 1500+. K=4096 has headroom.
- Spawn rate of 30k/sec from goroutines per request: measurable CPU on spawn. Pool amortises.
- Non-blocking with drop: a bid that arrives during burst is dropped, not queued (queued bids time out before being processed; better to drop fast).

**Production result.** p99 latency 25ms, p999 60ms — under SLA. Drop rate <0.1% at peak.

**Lesson.** High-rate fire-and-forget is exactly where ants earns its place.

### Case Study 3: Audio transcoding service

**Service.** Transcodes podcast episodes. ~10 episodes/sec. Each transcode: 30-180 seconds. CPU-bound.

**Bounds.**
- 16 cores per pod.
- ffmpeg uses 2-4 cores per transcode (depending on quality).

**Decision.** Tunny with K=4, each worker holding a pre-warmed ffmpeg context.

**Rationale.**
- 4 transcodes × 4 cores = 16 cores. Full utilisation.
- ffmpeg's setup cost (~5s per spawn) is amortised across many transcodes per worker.
- Tunny's `Process(payload) any` returns the transcode result naturally.

**Production result.** Throughput 4 transcodes/sec sustained; with 1 active pod and 4 workers, queue grows during peaks. Scaled to 3 pods, queue stays clear.

**Lesson.** Tunny is the right answer when warm state and worker model align.

---

## Anti-Patterns at Senior Level

Beyond the obvious anti-patterns from junior/middle levels.

### Anti-pattern: Pool with no observability

A pool in production without metrics is a black box. You cannot tell if it's saturated, slow, or starving. Always instrument.

### Anti-pattern: K hardcoded for one environment

`pool, _ := ants.NewPool(64)` works on the dev laptop. In production, 64 may be wrong for any of: 8-core pod (too high), 64-core pod (too low), Kubernetes-throttled pod (way too high).

Make K configurable. Tune per environment.

### Anti-pattern: Pool used as task-class router

```go
pool.Submit(func() {
	if isFast(t) { fastPath(t) } else { slowPath(t) }
})
```

Slow tasks block workers; fast tasks queue behind them. Effective concurrency for fast tasks drops.

Better: two pools, one for fast, one for slow. Routed by task class.

### Anti-pattern: Shared pool for unrelated subsystems

```go
var globalPool = ants.NewPool(1000)
// used by auth, billing, search, ...
```

One subsystem's noisy load starves others. Each subsystem should have its own pool, sized for its bounds.

### Anti-pattern: Pool inside a request handler

```go
func handler(w, r) {
	pool, _ := ants.NewPool(10)
	defer pool.Release()
	// ...
}
```

New pool per request = pool setup/teardown cost per request. Pools should be long-lived. Construct at service init, reuse.

### Anti-pattern: Pool sized for peak, not for normal

A pool sized for peak (e.g., K=10000 for occasional bursts) holds 10000 workers idle most of the time. Each worker is 3 KB; 30 MB at idle.

Better: smaller pool with idle expiry, allows pool to scale up under load. Or auto-tune.

### Anti-pattern: Submitting and waiting in the same goroutine

```go
pool.Submit(...) // task A
pool.Submit(...) // task B
pool.Submit(...) // task C
// no wait!
// returns
```

If the function returns before tasks finish, who waits? Without a WaitGroup or join, the tasks run after the caller goes away — fine for fire-and-forget but a bug if you needed the results.

### Anti-pattern: Errgroup leak

```go
g, _ := errgroup.WithContext(ctx)
g.Go(longRunning)
return // never called Wait!
```

The errgroup spawns goroutines that may run for a long time. Without Wait, the parent function returns, but the goroutines linger. If they capture variables that should be released, they hold them.

Always Wait. Always.

---

## Designing for the Long Run

Pools live in services that live for years. Decisions you make today haunt you tomorrow.

### Versioned guidelines

Pick a tool and stick with it for your team. Switching libraries every year is churn. Pick errgroup as default; pick one third-party pool (e.g., ants) as the "we use this when we need a pool" choice. Document it.

### Migration paths

When a pool no longer fits, plan the migration. Don't let a misfit pool live in production for years.

### Dependency hygiene

Audit your pool library annually. Read its CHANGELOG. Note breaking changes. Plan upgrades.

### Observability hygiene

Every pool should expose at least the five core metrics (running, queued, submitted, panic, drop). Standardise the names across services.

### Onboarding new engineers

A new hire sees `ants.NewPool(...)` and wonders why. Have a one-page document: "Why we use ants in service X." This is more valuable than any comment in the code.

### Capacity planning

Pool sizing should be part of capacity planning. Document the K, the rationale, and the scenarios where you'd raise/lower it.

---

## Self-Assessment

Senior-level pool literacy looks like this:

- [ ] I can read a pprof CPU profile and identify pool overhead.
- [ ] I can compute K from Little's Law given throughput and latency targets.
- [ ] I can name the trade-offs between blocking and non-blocking submit.
- [ ] I can explain LIFO vs FIFO worker selection and when each is right.
- [ ] I can identify a panic-handler-requiring workload.
- [ ] I can write a benchmark that distinguishes ants from errgroup.
- [ ] I have rejected a pool in code review with measurements.
- [ ] I have approved a pool in code review with measurements.
- [ ] I have migrated a service between pool libraries with no production incidents.
- [ ] I know what `GODEBUG=schedtrace=1000` does and have used it.
- [ ] I know the difference between `runtime.NumCPU()` and `runtime.GOMAXPROCS(0)` in containers.
- [ ] I have at least one pool in production with full metrics.
- [ ] I have removed at least one pool that wasn't earning its keep.
- [ ] I can argue both sides of the "should we use ants here" debate.

If yes — `professional.md` covers the operational side.

---

## Summary

- Pool internals matter at high contention: locking strategy, allocation per task, scheduling fairness, memory footprint.
- ants has the lowest Submit overhead via worker stack (LIFO) and optionally lock-free queues.
- tunny has the best worker-state model but loses on type safety and contention.
- workerpool is the smallest API but lags on high-contention throughput.
- pond combines features (groups, metrics) and sharded queues.
- Allocations per task is dominated by closure captures; Invoke-style avoids them.
- Scheduling fairness varies: LIFO (ants) for cache locality; FIFO (workerpool, tunny) for predictability.
- Memory footprint is small (few MB even for large pools) but visible in tight environments.
- Tail latency drivers: saturation, GC pause, slow tasks, worker startup, scheduler.
- Pool failure modes: panic, deadlock, task leak, teardown timeout. Choose libraries with mitigations.
- The senior decision process is: quantify → identify bound → list candidates → benchmark → load test → pick → monitor.

---

## Appendix S1: Internals of ants — A Walk-Through

A senior engineer should be able to read the source of their dependencies. Let's walk through ants's Submit path.

### ants's Pool struct (simplified)

```go
type Pool struct {
	capacity      int32
	running       int32
	lock          sync.Locker
	workers       workerQueue
	state         int32
	cond          *sync.Cond
	workerCache   sync.Pool
	waiting       int32
	purgeDone     int32
	stopPurge     context.CancelFunc
	ticktockDone  int32
	stopTicktock  context.CancelFunc
	options       *Options
}
```

Key fields:
- `capacity`: the K.
- `running`: count of active workers.
- `workers`: a queue of idle workers (stack or loop queue).
- `cond`: condition variable for blocking submitters.
- `workerCache`: a sync.Pool for recycling worker structs.

### Submit path

```go
func (p *Pool) Submit(task func()) error {
	if p.IsClosed() {
		return ErrPoolClosed
	}
	if w := p.retrieveWorker(); w != nil {
		w.inputFunc(task)
		return nil
	}
	return ErrPoolOverload
}
```

The work is in `retrieveWorker`. Let's read it:

```go
func (p *Pool) retrieveWorker() (w worker) {
	spawnWorker := func() {
		w = p.workerCache.Get().(*goWorker)
		w.run()
	}

	p.lock.Lock()

	w = p.workers.detach()
	if w != nil {
		p.lock.Unlock()
		return
	}

	if capacity := p.Cap(); capacity == -1 || capacity > p.Running() {
		p.lock.Unlock()
		spawnWorker()
		return
	}

	// Non-blocking case
	if p.options.Nonblocking {
		p.lock.Unlock()
		return
	}

retry:
	// Blocking with max blocking tasks
	if p.options.MaxBlockingTasks != 0 && p.Waiting() >= p.options.MaxBlockingTasks {
		p.lock.Unlock()
		return
	}
	p.addWaiting(1)
	p.cond.Wait()
	p.addWaiting(-1)
	if p.IsClosed() {
		p.lock.Unlock()
		return
	}

	if w = p.workers.detach(); w == nil {
		if p.Running() < p.Cap() {
			p.lock.Unlock()
			spawnWorker()
			return
		}
		goto retry
	}
	p.lock.Unlock()
	return
}
```

Walk through:

1. Lock the mutex.
2. Try to pop an idle worker from the queue.
3. If got one, unlock and return it.
4. Else, if pool not at capacity, spawn a new worker.
5. Else, if non-blocking, return nil (the caller gets ErrPoolOverload).
6. Else, block on the condition variable until a worker frees up.
7. If MaxBlockingTasks is set and we're at that limit, return nil immediately.
8. Loop.

This is straightforward; the design is solid. The single mutex is the contention point at high rate. The "loop queue" variant replaces the worker queue with a CAS-based ring buffer to reduce contention.

### Worker run loop

```go
func (w *goWorker) run() {
	w.pool.addRunning(1)
	go func() {
		defer func() {
			w.pool.addRunning(-1)
			w.pool.workerCache.Put(w)
			if p := recover(); p != nil {
				if ph := w.pool.options.PanicHandler; ph != nil {
					ph(p)
				}
			}
			w.pool.cond.Signal()
		}()

		for f := range w.task {
			if f == nil {
				return
			}
			f()
			if ok := w.pool.revertWorker(w); !ok {
				return
			}
		}
	}()
}
```

Walk through:

1. Increment running counter.
2. Spawn the worker goroutine.
3. On exit: decrement counter, return self to cache, recover panic (call handler), signal cond for waiters.
4. Loop: receive a task from the channel, execute it, return self to idle queue.
5. If `revertWorker` returns false (pool closed or worker expired), exit.

The worker is a long-lived goroutine that loops on `w.task` (a channel). New tasks are pushed via `w.inputFunc(task)`, which sends on `w.task`. The worker, between tasks, sits parked on the receive.

### The IdleTimeout

When a worker is returned to the idle queue, its `recycleTime` is updated. A separate `purge` goroutine periodically scans the queue:

```go
func (p *Pool) purgeStaleWorkers(ctx context.Context) {
	heartbeat := time.NewTicker(p.options.ExpiryDuration)
	defer heartbeat.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-heartbeat.C:
		}
		p.lock.Lock()
		staleWorkers := p.workers.refresh(p.options.ExpiryDuration)
		p.lock.Unlock()
		for i := range staleWorkers {
			staleWorkers[i].finish()
		}
	}
}
```

Workers idle longer than `ExpiryDuration` (default 1s) are finished (their channel closed, they exit the run loop).

### Why this matters for choice

- The single mutex is fine for moderate load.
- The condition variable for blocking submitters is contended at high producer count.
- Idle expiry can cause oscillation: workers expire, then must be re-spawned on the next burst.
- `MaxBlockingTasks` is essential for bounded queues — without it, the waiting list grows unbounded.

Knowing this lets you choose options deliberately, not by copy-paste.

---

## Appendix S2: Internals of errgroup

Compare with errgroup's much smaller surface area.

```go
type Group struct {
	cancel  func(error)
	wg      sync.WaitGroup
	sem     chan token
	errOnce sync.Once
	err     error
}

type token struct{}

func (g *Group) SetLimit(n int) {
	if n < 0 {
		g.sem = nil
		return
	}
	if len(g.sem) != 0 {
		panic(fmt.Errorf("errgroup: modify limit while %v goroutines in the group are still active", len(g.sem)))
	}
	g.sem = make(chan token, n)
}

func (g *Group) Go(f func() error) {
	if g.sem != nil {
		g.sem <- token{}
	}
	g.wg.Add(1)
	go func() {
		defer g.done()
		if err := f(); err != nil {
			g.errOnce.Do(func() {
				g.err = err
				if g.cancel != nil {
					g.cancel(g.err)
				}
			})
		}
	}()
}

func (g *Group) done() {
	if g.sem != nil {
		<-g.sem
	}
	g.wg.Done()
}

func (g *Group) Wait() error {
	g.wg.Wait()
	if g.cancel != nil {
		g.cancel(g.err)
	}
	return g.err
}
```

Walk through:

- `SetLimit(n)` creates a channel of capacity n. This is the semaphore.
- `Go(f)` first sends on the channel (blocks if full), then spawns a goroutine.
- The goroutine, when done, receives from the channel (freeing a slot).
- `errOnce` ensures only the first error is captured.
- `cancel` cancels the shared ctx.
- `Wait()` waits for all goroutines, returns the first error.

This is ~50 lines. It's minimal and elegant. Compare with ants's ~500 lines of pool implementation.

### Why errgroup spawns per call

Each `Go` spawns a goroutine. There is no worker reuse. The semaphore just bounds how many run at once. The goroutine pays the spawn cost; the semaphore pays the bound.

This is fine when spawn cost is negligible (rare to use 100k+ goroutines/sec on the same group). When it's not, ants's worker reuse wins.

---

## Appendix S3: Internals of tunny

Tunny's worker model is unique.

```go
type Pool struct {
	queuedJobs   int64
	ctor         func() Worker
	workers      []*workerWrapper
	reqChan      chan workRequest
	workerMut    sync.Mutex
}

type Worker interface {
	Process(any) any
	BlockUntilReady()
	Interrupt()
	Terminate()
}
```

The pool has:
- A `ctor` function that creates each worker.
- A slice of `workerWrapper` (each owns a goroutine and a Worker instance).
- A `reqChan` where Process sends requests.

```go
type workRequest struct {
	jobChan chan<- any
	retChan <-chan any
	interrupt chan<- struct{}
}
```

Each work request is a triple: the worker's input channel, the worker's output channel, and an interrupt channel.

### Process

```go
func (p *Pool) Process(payload any) any {
	atomic.AddInt64(&p.queuedJobs, 1)
	request, open := <-p.reqChan
	if !open {
		panic(ErrPoolNotRunning)
	}
	request.jobChan <- payload
	payload, open = <-request.retChan
	if !open {
		panic(ErrWorkerClosed)
	}
	atomic.AddInt64(&p.queuedJobs, -1)
	return payload
}
```

1. Receive a worker's "I'm idle" request from reqChan.
2. Send the payload to that worker's job channel.
3. Wait for the worker to return the result.
4. Return.

The flow is: workers broadcast their idleness; clients pick up an idle worker via reqChan; client and worker pair up.

### Worker loop

```go
func (w *workerWrapper) run() {
	w.worker.BlockUntilReady()
	w.reqChan <- workRequest{
		jobChan:   w.jobChan,
		retChan:   w.retChan,
		interrupt: w.interruptChan,
	}
	for {
		select {
		case payload := <-w.jobChan:
			result := w.worker.Process(payload)
			select {
			case w.retChan <- result:
			case <-w.interruptChan:
			}
			w.worker.BlockUntilReady()
			w.reqChan <- workRequest{...}
		case <-w.closeChan:
			w.worker.Terminate()
			return
		}
	}
}
```

The worker:
1. Calls `BlockUntilReady` on the worker (custom init).
2. Sends a workRequest to reqChan, advertising itself as idle.
3. Waits for a payload on jobChan.
4. Processes it.
5. Returns the result on retChan.
6. Loops.

`Worker.Process(payload)` is your code. It has access to the worker struct (so per-worker state lives there).

### Why this is unique

- Each worker has its own state via the constructor.
- The dispatch is via reqChan, not a shared queue. The dispatch is "first idle worker wins" — slightly different fairness than a queue.
- There is no queue of pending tasks. If all workers are busy, Process blocks on `<-p.reqChan`.

For workloads where worker state matters, tunny is the only library that models it directly. For workloads where state doesn't matter, the queue model (ants, workerpool) is fine.

### Cost

- One Process call: ~600 ns at low contention.
- Under high contention (many producers): contention on reqChan. The reqChan is single-channel; all producers contend on the receive operation.

For high-rate workloads with worker state, this can be a bottleneck. Mitigation: split into multiple smaller pools.

---

## Appendix S4: Internals of workerpool

The smallest of the libraries. Source is ~200 lines.

```go
type WorkerPool struct {
	maxWorkers   int
	taskQueue    chan func()
	workerQueue  chan func()
	stoppedChan  chan struct{}
	stopSignal   chan struct{}
	waitingQueue deque.Deque[func()]
	stopLock     sync.Mutex
	stopOnce     sync.Once
	stopped      bool
	waiting      int32
	wait         bool
}
```

```go
func (p *WorkerPool) Submit(task func()) {
	if task != nil {
		select {
		case p.taskQueue <- task:
		default:
			// Slow path: enqueue in deque
		}
	}
}

func (p *WorkerPool) dispatch() {
	defer close(p.stoppedChan)
	timeout := time.NewTimer(idleTimeout)
Loop:
	for {
		// If there are tasks in the waiting queue, push to workers
		if p.waitingQueue.Len() != 0 {
			...
		}
		select {
		case task, ok := <-p.taskQueue:
			if !ok { break Loop }
			select {
			case p.workerQueue <- task:
			default:
				if p.numWorkers < p.maxWorkers {
					go startWorker(task, p.workerQueue)
					p.numWorkers++
				} else {
					p.waitingQueue.PushBack(task)
					atomic.StoreInt32(&p.waiting, int32(p.waitingQueue.Len()))
				}
			}
		...
		}
	}
}
```

There's a single dispatcher goroutine that:
- Reads tasks from `taskQueue` (where Submit sends).
- Sends them to `workerQueue` (where workers receive).
- If no worker is ready and we're below max, spawn a new one.
- Otherwise queue in `waitingQueue` (a Deque).

This single-dispatcher design has a clear bottleneck: the dispatcher. At very high rates, it cannot keep up. For most workloads, it's fine.

### Worker

```go
func startWorker(task func(), workerQueue chan func()) {
	task()
	go worker(workerQueue)
}

func worker(workerQueue chan func()) {
	for task := range workerQueue {
		task()
	}
}
```

The worker is a simple `for task := range channel` loop. Workers exit when the channel is closed.

### Verdict

workerpool is a fine choice for moderate-throughput, simple workloads. Read its source in 15 minutes. Audit it. Use it.

---

## Appendix S5: Custom Pool — Build Your Own

Once you understand the libraries, you can build your own pool in 50 lines. Here's one for educational purposes.

```go
type Pool struct {
	tasks   chan func()
	wg      sync.WaitGroup
	stopped atomic.Bool
}

func New(workers, queue int) *Pool {
	p := &Pool{tasks: make(chan func(), queue)}
	for i := 0; i < workers; i++ {
		p.wg.Add(1)
		go p.work()
	}
	return p
}

func (p *Pool) work() {
	defer p.wg.Done()
	for t := range p.tasks {
		func() {
			defer func() {
				if r := recover(); r != nil {
					log.Printf("pool worker panic: %v", r)
				}
			}()
			t()
		}()
	}
}

func (p *Pool) Submit(t func()) error {
	if p.stopped.Load() {
		return errors.New("pool stopped")
	}
	select {
	case p.tasks <- t:
		return nil
	default:
		return errors.New("pool full")
	}
}

func (p *Pool) SubmitBlocking(ctx context.Context, t func()) error {
	if p.stopped.Load() {
		return errors.New("pool stopped")
	}
	select {
	case p.tasks <- t:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (p *Pool) Stop() {
	if !p.stopped.CompareAndSwap(false, true) {
		return
	}
	close(p.tasks)
	p.wg.Wait()
}
```

50 lines. Has:
- Fixed worker count.
- Bounded queue.
- Non-blocking and blocking submit.
- Panic recovery.
- Graceful stop with drain.

Missing:
- Idle worker expiry.
- Dynamic resize.
- Metrics.
- Worker state.

For 80% of use cases where you want a "custom" pool, this is enough. If you find yourself wanting these features, you'd reinvent ants — at which point, just use ants.

### When to use your own pool

- You need a specific feature (priority, multi-queue, custom backpressure).
- You want to fully audit the dependency surface.
- Educational.

In production: prefer the library if it covers your needs. Custom code is technical debt unless it's specifically uncommon.

---

## Appendix S6: Concurrency-Safe Result Collection

A senior topic: how to collect results from N concurrent tasks safely and efficiently.

### Option 1: Indexed slice (most common)

```go
results := make([]Result, len(items))
g, _ := errgroup.WithContext(ctx)
g.SetLimit(K)
for i, item := range items {
	i, item := i, item
	g.Go(func() error {
		r, err := work(item)
		if err != nil { return err }
		results[i] = r
		return nil
	})
}
return results, g.Wait()
```

Each goroutine writes to its own slice index. No locking required because indexes don't overlap. The runtime guarantees that the write is atomic if the value is word-sized; for struct values, the entire struct is copied, which is a single memory copy with no concurrent partial writes.

The race detector confirms this is safe. It's the canonical pattern.

### Option 2: Channel of results

```go
out := make(chan Result, len(items))
g, _ := errgroup.WithContext(ctx)
g.SetLimit(K)
for _, item := range items {
	item := item
	g.Go(func() error {
		r, err := work(item)
		if err != nil { return err }
		out <- r
		return nil
	})
}
go func() { g.Wait(); close(out) }()

var results []Result
for r := range out {
	results = append(results, r)
}
```

Tasks send results to a channel. A consumer collects them. Order is non-deterministic.

Use when:
- You want to stream results out as they complete.
- Order doesn't matter.
- You want to consumer-side terminate early (skip remaining results).

### Option 3: sync.Mutex + shared slice

```go
var mu sync.Mutex
var results []Result
g, _ := errgroup.WithContext(ctx)
g.SetLimit(K)
for _, item := range items {
	item := item
	g.Go(func() error {
		r, err := work(item)
		if err != nil { return err }
		mu.Lock()
		results = append(results, r)
		mu.Unlock()
		return nil
	})
}
return results, g.Wait()
```

Less efficient than Option 1 because of lock contention. Use only when input order doesn't correspond to output order (e.g., filtering: some inputs produce no output).

### Option 4: sync.Map

```go
var results sync.Map
g, _ := errgroup.WithContext(ctx)
g.SetLimit(K)
for _, item := range items {
	item := item
	g.Go(func() error {
		r, err := work(item)
		if err != nil { return err }
		results.Store(item.Key, r)
		return nil
	})
}
g.Wait()

// later: iterate or look up
results.Range(func(k, v any) bool { ... return true })
```

sync.Map is optimised for read-mostly access. For pure write-many, it's slower than Option 3. Use when you'll do many concurrent reads of the results map after.

### Option 5: Atomic counter + result slice

For counting:

```go
var count atomic.Int64
g, _ := errgroup.WithContext(ctx)
g.SetLimit(K)
for _, item := range items {
	item := item
	g.Go(func() error {
		if didWork(item) {
			count.Add(1)
		}
		return nil
	})
}
g.Wait()
fmt.Println("did work:", count.Load())
```

Use atomic for simple aggregates. For complex aggregates (sums, histograms), need lock or per-goroutine accumulators + final reduce.

### Recommendation

Use Option 1 (indexed slice) whenever the output order matches input order. Use Option 2 (channel) for streaming. Use Option 3 (mutex slice) sparingly. Avoid Option 4 unless reads dominate.

---

## Appendix S7: The "When Goroutines Are Too Cheap" Paradox

A subtle senior observation: goroutines are *too cheap*. Their cheapness encourages a class of bug.

### The bug

Because spawning a goroutine costs almost nothing, developers reach for `go f()` reflexively. They write code that spawns goroutines they never wait for, goroutines that pile up, goroutines whose lifecycle is unclear. Each one alone is cheap; collectively they accumulate.

The bug is not "goroutines are expensive" — it's "concurrency is cognitively expensive." Each spawn is a new path through the program; the more paths, the harder to reason.

### Why pools help

A pool makes goroutines an explicit, scarce resource. You cannot accidentally spawn 100,000 — the pool has K slots and rejects beyond that. This restraint is the pool's main *cognitive* benefit, beyond the performance angle.

Compare:

```go
// Casual code
go logEvent(e)
go updateMetrics(m)
go callExternal(api)
// ...
```

Versus:

```go
// Pool-disciplined code
backgroundPool.Submit(func() { logEvent(e) })
backgroundPool.Submit(func() { updateMetrics(m) })
externalPool.Submit(func() { callExternal(api) })
// ...
```

The second form has explicit scarce resources. You'll think twice before adding another `Submit` line.

### When this matters

In large codebases with many engineers, the discipline of "spawn through a pool" prevents accidental goroutine explosions. In small codebases with a few engineers who all know the code, it's overkill.

### The hidden cost

The cost is exactly the dependency and the boilerplate. Worthwhile if your team needs the discipline; over-engineering if it doesn't.

---

## Appendix S8: Pool-Specific Profiling Tricks

### Trick 1: Submit-rate histogram

Add a custom Prometheus histogram counting Submit calls per second per pool. Useful for detecting unexpected spikes.

### Trick 2: Per-task duration tagging

Wrap your task closure with a duration tag:

```go
pool.Submit(func() {
	start := time.Now()
	work(item)
	taskDurationHistogram.WithLabelValues("type", item.Type).Observe(time.Since(start).Seconds())
})
```

Split tail latency by task class. The slow class is your tail.

### Trick 3: Queue depth alert

Alert when `pool.Waiting() > threshold for X minutes`. Saturation early-warning.

### Trick 4: Trace-driven analysis

Use `runtime/trace`:

```go
trace.Start(f)
defer trace.Stop()
// ... do work ...
```

Open in `go tool trace`. You can see exactly which goroutine ran on which P, when it blocked, when it was unparked. Invaluable for understanding pool scheduling behaviour.

### Trick 5: Goroutine-by-state breakdown

`pprof goroutine ?debug=2` shows every goroutine's current state. For a pool of 1000 workers, you should see 1000 in "select (chan receive)" state. If many are in "chan send" (trying to submit results) or "chan receive" (waiting for input), there's a bottleneck downstream.

---

## Appendix S9: When to Vendor a Pool Library

Vendoring (copying the library into your repo's `vendor/` or `internal/`) is a tradeoff:

- Pro: Full control, version pinning, no upstream surprise.
- Con: You own the maintenance.

When to vendor:

- Critical service whose pool behaviour is load-bearing.
- Library has been abandoned but works.
- You need to patch a bug upstream won't accept.

When not to:

- Active, well-maintained library.
- Stable releases.
- No bugs that bite you.

For ants and pond, don't vendor. For tunny (less active), vendor if you depend deeply.

---

## Appendix S10: Pool Library Reading

When you adopt a third-party pool, read the source. Not all of it; the Submit path and the worker run loop.

Source size:

- ants: ~3000 lines (multiple files). Read `pool.go` (Submit) and `worker.go` (run loop).
- tunny: ~500 lines, one file. Read it all.
- workerpool: ~400 lines. Read it all.
- pond: ~1000 lines. Read the core.

The investment is one afternoon. Pays off when you debug a production issue.

---

## Appendix S11: Pool Bug Stories

A few cautionary tales.

### Story 1: The pool that didn't drain

A team configured `ants.NewPool(100)` but never called `Release()`. The pool kept its workers alive forever. Each test run leaked 100 goroutines. After 1000 test runs, the test process had 100,000 goroutines. CI started failing with OOM.

Fix: `defer pool.Release()`. Tests stable.

### Story 2: The submit error nobody checked

```go
pool.Submit(func() { ... }) // returns error; ignored
```

Under load, `Submit` returned `ErrPoolOverload`. The task was silently dropped. The team noticed a percentage of tasks "never happened" only after a customer complained.

Fix: check the error. Either retry, fall back, or alarm.

### Story 3: The pool of zero

```go
K := os.Getenv("POOL_K") // returns "" if unset
n, _ := strconv.Atoi(K)   // returns 0 if "" or unparseable
pool, _ := ants.NewPool(n)
```

When env var is unset, K=0. `ants.NewPool(0)` returns an error (or panics, depending on version). The team noticed at deploy time when the service refused to start.

Fix: validate K. Default to a sane value if env var is missing.

### Story 4: Pool reuse across tests

Tests shared a global pool. Test A submits 100 tasks; Test B starts before A's tasks finish; A's tasks pollute B's assertions.

Fix: per-test pool, or test pool drained between tests.

### Story 5: The panic that escaped

A pool with no panic handler. One task hit a divide-by-zero. The worker crashed. The pool's spawned goroutine died, no replacement spawned. Over hours, the pool's worker count drifted down. Eventually all workers gone; pool dead.

Fix: panic handler that logs and lets the pool re-spawn the worker.

### Story 6: The pool that scaled the wrong way

A team auto-scaled K based on CPU. CPU went high → K decreased (to reduce CPU). CPU went low → K increased (to do more work). The control loop was *backwards*: high CPU triggers a *smaller* pool, which means *less work*, which means *less CPU*. Pool drove itself to zero.

Fix: read the control loop carefully; auto-scaling is subtle.

### Story 7: Deadlock by self-submit

A pool task submits to the *same* pool and waits for the result. If the pool is full of such tasks, all are waiting for workers that don't exist. Deadlock.

Fix: never submit-and-wait to the same pool. Use a separate pool, or inline the work.

---

## Appendix S12: Senior Reading List

Beyond the libraries' READMEs:

- "Scalable Go Scheduler Design" — original design doc.
- Dmitry Vyukov's papers on lock-free programming.
- "Locking in WebKit" — general intuition about lock contention.
- "Mechanical Sympathy" blog (Martin Thompson) — cache and false sharing.
- The Go memory model document.
- "The Many Faces of Mutex" — talks on mutex internals.

---

## Appendix S13: Three Years of Pool Decisions

A meta-observation: looking at three years of pool-related PRs across various services, the pattern of decisions follows a pattern:

- Year 1: team adopts ants/tunny enthusiastically.
- Year 2: team realises many places don't need a pool, migrates to errgroup.
- Year 3: team settles into a stable pattern: errgroup for most, ants for specific hot paths, tunny for worker-state.

The lesson: the maturity curve is universal. New teams over-adopt; mature teams under-adopt then settle. If you're new, anticipate this. Don't fight the curve; just accelerate to the middle.

---

## Appendix S14: Pools and Distributed Systems

In distributed systems, the "pool" question is bigger than one process.

### Per-process pool vs per-cluster bound

If your cluster has 10 replicas, each with K=50, the cluster has 500 concurrent. The downstream sees 500. If downstream allows 100, you exceed by 5x.

Mitigations:

- Static per-process K = limit / replicas. Coordinate at deploy time.
- Distributed rate limiter (Redis, dedicated service).
- Service-mesh-level rate limiting (Envoy, Linkerd).

### Pool as bulkhead

In microservices architecture, each downstream has its own pool. The pool isolates failures: if downstream A is slow, only the pool for A saturates; pool B is unaffected. This is the bulkhead pattern.

```go
type DownstreamPools struct {
	userServicePool   *ants.Pool
	billingPool       *ants.Pool
	notifsPool        *ants.Pool
}
```

Each pool sized for its downstream. One slow service doesn't block calls to others.

### Pool sizing under partial failure

When a downstream is degraded, in-flight calls take longer. By Little's Law, more concurrency is needed to maintain throughput. Pool sized for "happy path" gets saturated under degradation. Some teams oversize K during operations; others retreat to circuit-breaker patterns.

---

## Appendix S15: The Senior's Checklist for Pool Code Review

When reviewing pool-using code, in addition to the junior/middle checklist:

- [ ] Is the pool long-lived (not per-request)?
- [ ] Does it have a panic handler?
- [ ] Does Submit's return error get checked?
- [ ] Is K configurable (env var or config)?
- [ ] Is there a metric for in-flight, queue, drops?
- [ ] Is there an alert for saturation?
- [ ] What happens on SIGTERM (drain)?
- [ ] Does the pool live in a separate file with its own tests?
- [ ] Is there a benchmark showing the pool's benefit over errgroup?
- [ ] What's the rollback plan if the pool causes issues?

Most pool code in real codebases fails 3+ of these. The code review pulls them out, one by one, with patient explanation.

---

## Appendix S16: Looking Ahead

After senior, the next level is *operational*. `professional.md` covers SLAs, observability for pools, third-party risk, and the build vs adopt question. The remaining files are reference: specification of APIs, interview Q&A, hands-on tasks, bugs, optimisations.

A senior engineer's relationship with pools is: trust but verify, default to errgroup, justify everything, measure everything, document everything. The next level is to operationalise that into team practice.

---

## Appendix S17: Comparative Workloads

We will now examine eight workloads in full depth, comparing all four tools (raw, errgroup, semaphore, pool) for each. This is the data behind the decision tree.

### Workload S17.1: Web crawler

Crawl 1M URLs. Each fetch: 200 ms median, p99 800 ms. Politeness: 10 concurrent per host. There are 10k hosts.

Constraints:
- HTTP client connection pool.
- Per-host rate limit (politeness).
- 16 GiB memory budget.

Analysis:
- 10 concurrent per host × 10k hosts = up to 100k concurrent in theory. Memory doesn't allow it.
- Bound by memory: each in-flight has ~1 KB response buffer + connection state ≈ 5 KB. Budget 16 GiB / 5 KB ≈ 3M. Memory isn't the binding constraint.
- Bound by file descriptors: ulimit -n typically 65536. So K ≤ 32k.
- Real-world choice: K = 1000 globally, with per-host semaphore of 10.

Tool: errgroup for fan-out + sync.Map of `semaphore.Weighted(10)` per host.

```go
hostSems := sync.Map{}

getSem := func(host string) *semaphore.Weighted {
	if v, ok := hostSems.Load(host); ok { return v.(*semaphore.Weighted) }
	s := semaphore.NewWeighted(10)
	v, _ := hostSems.LoadOrStore(host, s)
	return v.(*semaphore.Weighted)
}

g, ctx := errgroup.WithContext(ctx)
g.SetLimit(1000)
for _, u := range urls {
	u := u
	g.Go(func() error {
		host := extractHost(u)
		sem := getSem(host)
		if err := sem.Acquire(ctx, 1); err != nil { return err }
		defer sem.Release(1)
		return fetch(ctx, u)
	})
}
return g.Wait()
```

Two bounds layered: global (errgroup, 1000) and per-host (semaphore, 10).

### Workload S17.2: Real-time bidder (revisited in depth)

Recall: 30k bids/sec, 80ms p99 SLA, GPU-bound inference.

Question: ants vs errgroup vs custom?

- errgroup with SetLimit(K): each bid spawns a goroutine. At 30k/sec, spawn rate is high. Measure: ~5-8% CPU on goroutine creation.
- ants with K=4096: workers reused. Submit ~250ns. ~1-2% CPU on dispatch.
- Custom pool: same as ants but with priority queue (high-value bids first).

Choice: ants for general; custom if priority matters.

Sizing K:
- Inference latency 5ms, throughput 30k/sec → Little's Law: K = 30000 × 0.005 = 150 active.
- For burst (3× peak): K = 450 active.
- Pool size 4096 has 10× headroom — useful for tail tolerance.

K=4096 ants. Non-blocking with drop on overflow. Drop rate alert >1%.

### Workload S17.3: Database migration

A one-off migration: read 100M rows from old DB, transform, write to new DB. Run during maintenance window (2 hours).

Constraints:
- Source DB: 100 concurrent reads.
- Destination DB: 50 concurrent writes.
- 32 cores, 64 GiB memory.

Analysis:
- 100M rows in 7200s = 14k rows/sec target.
- Read latency ~5ms, write latency ~20ms → 14k × 0.020 = 280 in-flight writes; bound at 50. Write is bottleneck.
- Need to read at 14k/sec; 14k × 0.005 = 70 in-flight reads; bound at 100. Fine.

Tool: pipeline of two errgroups (read stage, write stage), connected by a bounded channel.

```go
const readK, writeK = 100, 50
ch := make(chan Row, 1000)

g, ctx := errgroup.WithContext(ctx)
g.Go(func() error {
	defer close(ch)
	subg, ctx := errgroup.WithContext(ctx)
	subg.SetLimit(readK)
	for id := range rowIDs {
		id := id
		subg.Go(func() error {
			row, err := source.Read(ctx, id)
			if err != nil { return err }
			select { case ch <- row: case <-ctx.Done(): return ctx.Err() }
			return nil
		})
	}
	return subg.Wait()
})

g.Go(func() error {
	subg, ctx := errgroup.WithContext(ctx)
	subg.SetLimit(writeK)
	for row := range ch {
		row := row
		subg.Go(func() error { return dest.Write(ctx, row) })
	}
	return subg.Wait()
})

return g.Wait()
```

No third-party pool needed. The whole thing in errgroup.

### Workload S17.4: Continuous health checker

A service health-checks 1000 endpoints every 30 seconds. Each check: ~100 ms HTTP call.

Constraints:
- Memory budget: 1 GiB (modest service).
- 1000 endpoints × 1 check/30s = 33 checks/sec average; can burst at start of each interval.

Tool: errgroup per interval, with SetLimit(50). At start of each 30s interval, fan out:

```go
ticker := time.NewTicker(30 * time.Second)
for range ticker.C {
	g, ctx := errgroup.WithContext(ctx)
	g.SetLimit(50)
	for _, ep := range endpoints {
		ep := ep
		g.Go(func() error { return check(ctx, ep) })
	}
	g.Wait()
}
```

1000 / 50 = 20 batches of 50; at 100ms each, the whole pass takes ~2 seconds. Plenty of slack before the next 30s tick.

ants here would be overkill. Spawn rate ~33/sec is trivial.

### Workload S17.5: Image processing pipeline

A user uploads a photo; service produces 5 thumbnail sizes. Volume: 100 uploads/sec.

Constraints:
- Per-image: 100ms CPU-bound resize.
- 32 cores.
- Memory: 2 GiB per pod.

Analysis:
- 100 uploads × 5 sizes = 500 resize tasks/sec.
- CPU bound: K = NumCPU = 32.
- 500/sec × 0.1s = 50 active; bound at 32; queue depth ~20 average.

Tool: errgroup per upload (5 tasks), with a per-process semaphore of 32.

```go
var resizeSem = semaphore.NewWeighted(32)

func process(ctx context.Context, img Image) ([]Image, error) {
	results := make([]Image, 5)
	g, ctx := errgroup.WithContext(ctx)
	for i, size := range sizes {
		i, size := i, size
		g.Go(func() error {
			if err := resizeSem.Acquire(ctx, 1); err != nil { return err }
			defer resizeSem.Release(1)
			r, err := resize(img, size)
			if err != nil { return err }
			results[i] = r
			return nil
		})
	}
	return results, g.Wait()
}
```

The cross-handler semaphore enforces the CPU bound globally. The per-handler errgroup propagates errors and ctx.

### Workload S17.6: Periodic batch summarizer

Every hour, summarise the last hour's events. ~500k events. Processing is mostly aggregation in memory.

Tool: errgroup with SetLimit(NumCPU). Aggregation-heavy is CPU-bound, NumCPU is right.

```go
func summarise(ctx context.Context, events []Event) (Summary, error) {
	type partialResult struct{ idx int; partial Summary }
	out := make(chan partialResult, runtime.NumCPU())
	g, ctx := errgroup.WithContext(ctx)
	g.SetLimit(runtime.NumCPU())
	chunks := chunkEvents(events, runtime.NumCPU())
	for i, chunk := range chunks {
		i, chunk := i, chunk
		g.Go(func() error {
			s, err := summariseChunk(chunk)
			if err != nil { return err }
			out <- partialResult{i, s}
			return nil
		})
	}
	go func() { g.Wait(); close(out) }()

	var combined Summary
	for r := range out {
		combined = merge(combined, r.partial)
	}
	return combined, g.Wait()
}
```

Map-reduce pattern. errgroup is enough. Pool unnecessary.

### Workload S17.7: Service mesh sidecar

A high-throughput sidecar handling 100k req/sec, each requiring a small bit of routing logic (~50 μs).

Constraints:
- 4 cores per pod.
- Latency budget: 1ms p99.

Analysis:
- 100k req/sec × 0.00005s = 5 active CPU-equivalent. 4 cores can handle it.
- Spawn rate 100k/sec — high enough that goroutine creation matters.

Tool: ants with K=1024. Lower per-Submit overhead than errgroup at this rate.

But wait — for 50μs of work, goroutine spawn (1-2μs) is 2-4% overhead. ants Submit is ~250ns, which is 0.5%. Difference ~3% CPU.

That's measurable. Use ants.

```go
pool, _ := ants.NewPool(1024)
for req := range incoming {
	req := req
	pool.Submit(func() { route(req) })
}
```

K=1024 is way above what's needed (5 active) but supports peaks and queue depth without re-spawning workers.

### Workload S17.8: Background email queue worker

A worker pulls jobs from a Redis-backed queue and sends emails. Volume: 5 emails/sec average, peaks of 100/sec.

Constraints:
- SMTP server: 20 concurrent.
- 1 CPU pod.

Tool: errgroup with SetLimit(20).

```go
g, ctx := errgroup.WithContext(ctx)
g.SetLimit(20)
for job := range jobs {
	job := job
	g.Go(func() error { return sendEmail(ctx, job) })
}
return g.Wait()
```

5/sec is trivial. ants overkill. errgroup is enough.

---

## Appendix S18: When You Disagree With This File

This file is opinionated. Some senior engineers will read sections and disagree. That is healthy.

Here are some claims you might push back on:

### "ants beats errgroup at high spawn rates"

True only when measured. Some teams have shown the opposite — when their CPU is the bottleneck (not spawning), the libraries are equivalent. The point isn't "always ants for high rates" but "consider ants when spawn rate is measurable in your profile."

### "tunny is for worker-state workloads only"

Mostly. There are edge cases where tunny's synchronous Process API is more ergonomic for typed pipelines. The general guidance stands.

### "Errgroup is the default"

In some teams, ants is the de facto default because of habits. That's fine as long as it's a *chosen* default, not a cargo-cult one.

### "Custom pools are technical debt"

True on average. There are specific cases (priority queues, multi-queue dispatch) where custom is better than off-the-shelf. The "average advice" doesn't override specific requirements.

When you disagree with a piece of this file, the right move is to write a counter-document with your measurements and your reasoning. Treat this file as a starting point, not law.

---

## Appendix S19: Hands-On Senior Exercises

Six exercises for senior-level practice. Solve each in code, with benchmarks.

### Exercise 1: Build a benchmark harness

Write a benchmark harness that takes a "workload" interface (Submit, Result) and tests it against five pool implementations: raw, errgroup, semaphore, ants, tunny. Output: throughput, latency p50/p99, allocations, peak memory.

### Exercise 2: Implement priority pool

Write a 50-line pool that supports two priority levels: urgent and normal. Urgent tasks always run before normal when both are queued. Show that the pool handles a workload with mixed priorities correctly.

### Exercise 3: Implement self-tuning pool

Write a wrapper around ants that adjusts K based on observed CPU utilisation. Demonstrate that under varying load, K converges to a reasonable value.

### Exercise 4: Compare LIFO vs FIFO under burst

Construct a workload where LIFO (ants default) shows starvation of older workers; show the same workload with FIFO (ants loopq) handles fairly.

### Exercise 5: Build a multi-tenant pool

Write a pool that maintains separate queues per tenant, with weighted fair queueing. Tenant A submits 1000 tasks; tenant B submits 1. Show B's task runs within a bounded delay.

### Exercise 6: Migrate a real service

Pick a real Go service from your work (or open source). Read its pool usage. Identify the *first* place where the pool is wrong. Write the migration. Benchmark before and after. Defend in code review.

---

## Appendix S20: Mathematics of Pool Sizing

Senior pool sizing deserves real math. Here it is.

### Little's Law

Given:
- L = average number of in-flight items
- λ = arrival rate (items per second)
- W = average time each item spends in the system

Then:
- L = λ × W

For a pool, L is the average number of active tasks. If λ > L_max / W (where L_max is the pool capacity), the queue grows unboundedly.

### Pool saturation

Pool is in *saturation* when:
- λ × W ≥ K (the bound)

In saturation, queue grows at rate (λ × W - K) per unit time. Submissions block.

### Tail latency under saturation

Under saturation, queue depth grows. Tasks at the back of the queue wait time = queue depth × W / K.

For p99 to stay bounded under bursts, you need:
- K is large enough to absorb the burst, or
- The system rejects above some queue depth (drop policy).

### Optimal K for steady-state

In steady state with arrival rate λ and per-task time W:
- K_min = ⌈λ × W⌉
- K_optimal ≈ 1.2 × K_min (20% headroom for variation)

For bursts of factor B (e.g., 3× normal):
- K_burst = ⌈B × λ × W⌉
- Either size pool to K_burst (high idle waste) or accept queueing during burst.

### Memory bound

Memory in flight = K × per_task_footprint. If budget is M and baseline is B:
- K_mem = (M - B) / per_task_footprint

### Multiple constraints

If you have CPU bound K_cpu, memory bound K_mem, downstream bound K_down:
- K = min(K_cpu, K_mem, K_down)

The binding constraint is whichever is smallest. Increasing K beyond that wastes resources without increasing throughput.

### Computing K with cost

If you have a cost function (e.g., dollar cost per request) and revenue function (e.g., dollar revenue per request fulfilled), you can compute an *optimal* K that maximises profit. This requires:
- Profit per request fulfilled: P_req
- Cost per request rejected: P_drop (e.g., customer churn cost)
- Cost per second of latency above target: P_lat
- Cost per K of pool capacity (memory, idle workers): C_K

Optimise K to maximise: (P_req × λ × success_rate(K)) - (P_drop × λ × (1 - success_rate(K))) - (P_lat × p99_above_target(K)) - C_K × K

In practice nobody computes this; people pick K from formulas and tune from load tests. But knowing the math exists helps you reason about extremes.

---

## Appendix S21: Pool Library Source Code Walk

We did this earlier for ants. Let's do quick reads of tunny and pond.

### tunny: Process and dispatch

```go
func (p *Pool) Process(payload any) any {
	atomic.AddInt64(&p.queuedJobs, 1)
	request, open := <-p.reqChan
	if !open { panic(ErrPoolNotRunning) }
	request.jobChan <- payload
	payload, open = <-request.retChan
	atomic.AddInt64(&p.queuedJobs, -1)
	if !open { panic(ErrWorkerClosed) }
	return payload
}
```

`p.reqChan` is shared by all workers. Each idle worker sends a workRequest on reqChan, and Process receives one of them. This is "broadcast idleness" — workers advertise availability; clients pair up.

The single reqChan is the contention point. At very high throughput, the channel's internal lock and the wake-up cost dominate.

### pond: SubmitToShard

Pond uses sharded queues to reduce contention. Pseudo-code:

```go
func (p *Pool) Submit(task func()) Task {
	shard := pickShard()
	shard.queue <- task
	return Task{...}
}
```

`pickShard()` chooses based on goroutine ID or a hash; each shard has its own queue and worker subset. Submit contention is divided by the shard count.

This is the canonical "scale out the queue" trick. Pond's shard count is configurable; for typical workloads, 4-8 shards is enough.

### Read your library

The point of these walks: read your library. Know what it does. Don't trust the README; trust the source.

---

## Appendix S22: Cross-Library Bench Results in Detail

Earlier we showed sample numbers. Here is a more detailed table for one specific benchmark: 1M tasks of 10μs each, 8-core machine.

| Library / Mode                    | Total time (s) | CPU (cores) | Allocs / 1M tasks | Peak heap (MB) |
|-----------------------------------|----------------|-------------|-------------------|----------------|
| Raw + WaitGroup (unbounded)       | 1.5             | 7.5         | 2,000,000          | 350             |
| Raw + token chan (K=1024)         | 1.6             | 7.4         | 2,000,000          | 90              |
| errgroup K=1024                   | 1.7             | 7.3         | 2,500,000          | 95              |
| ants K=1024 default               | 1.4             | 7.6         | 5,000              | 50              |
| ants K=1024 loopq                 | 1.3             | 7.6         | 5,000              | 50              |
| ants K=256                        | 1.4             | 7.5         | 5,000              | 30              |
| tunny K=1024                      | 1.8             | 7.0         | 1,000              | 60              |
| workerpool K=1024                 | 1.6             | 7.2         | 1,000,000          | 60              |
| pond K=1024                       | 1.5             | 7.4         | 50,000             | 55              |

Observations:
- ants leads on CPU and allocations.
- tunny is slower because of single dispatch chan contention.
- Raw is fast but high memory.
- errgroup pays an allocation per task (the closure for `func() error`).
- workerpool's per-task closure also allocates.
- pond's sharded queue cuts contention but has more bookkeeping.

For 10μs tasks, the differences are small absolute (~30%) but noticeable. For 1ms tasks, the differences shrink. For 1s tasks, they vanish.

---

## Appendix S23: Pool Lifecycle Patterns

Patterns for managing pool lifecycle in real services.

### Pattern 1: Pool at module init

```go
var pool *ants.Pool

func init() {
	var err error
	pool, err = ants.NewPool(K)
	if err != nil { log.Fatal(err) }
}
```

Simple. The pool lives for the entire program. Don't release.

Risk: `init` runs before `main`, so panics there crash before logging is set up. Prefer explicit construction in main.

### Pattern 2: Pool injected via constructor

```go
type Service struct {
	pool *ants.Pool
}

func NewService(pool *ants.Pool) *Service {
	return &Service{pool: pool}
}
```

Pool is constructed by caller, injected. Service doesn't own the pool. Good for testability (mock pool in tests).

### Pattern 3: Pool with options

```go
type Service struct {
	pool *ants.Pool
	cleanup func()
}

func NewService(opts Options) (*Service, func(), error) {
	pool, err := ants.NewPool(opts.PoolSize, opts.AntsOpts...)
	if err != nil { return nil, nil, err }
	cleanup := func() { pool.ReleaseTimeout(30 * time.Second) }
	return &Service{pool: pool}, cleanup, nil
}
```

Returns the cleanup explicitly. Caller's responsibility to call.

### Pattern 4: Pool with graceful shutdown

```go
func main() {
	pool, _ := ants.NewPool(K)
	srv := NewService(pool)

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, os.Interrupt, syscall.SIGTERM)
	<-sigCh

	log.Println("draining pool")
	pool.ReleaseTimeout(30 * time.Second)
	log.Println("shutdown complete")
}
```

On signal, drain. Important: don't release the pool while requests are still being accepted; close the listener first.

### Pattern 5: Pool with health check

```go
http.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
	if pool.Running() >= pool.Cap() {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	w.WriteHeader(http.StatusOK)
})
```

Pool saturation = unhealthy from the load balancer's perspective. The LB stops sending traffic until the pool drains.

---

## Appendix S24: A Deep Look at Cancellation

How cancellation propagates through pools.

### Errgroup cancellation

`errgroup.WithContext(parent)` returns (g, ctx). The ctx is derived from parent.
- If parent is cancelled, ctx is cancelled.
- If any g.Go returns an error, ctx is cancelled.
- Any goroutine in the group that respects ctx terminates.

This is clean and elegant. The cancellation is *transitive* through the ctx.

### Pool cancellation

ants and workerpool have no ctx integration. To cancel:
1. Pass ctx into your task closure.
2. Check ctx.Done() at the start of the task and at logical resumption points.
3. If you want to cancel in-flight tasks, your code must respect ctx.

The pool itself doesn't cancel anything. Closing the pool (Release) doesn't cancel running tasks; it just stops accepting new ones and lets in-flight finish.

### A pattern for clean cancellation

```go
type CtxPool struct {
	pool *ants.Pool
	ctx  context.Context
}

func (p *CtxPool) Submit(task func(context.Context)) error {
	return p.pool.Submit(func() {
		task(p.ctx)
	})
}
```

Wrap the pool with the ctx. Tasks always have the ctx.

For shutdown:

```go
func (p *CtxPool) Shutdown(timeout time.Duration) {
	p.cancel()  // signal all tasks to abort
	p.pool.ReleaseTimeout(timeout)
}
```

Cancel the ctx first; running tasks see it and abort. Then drain.

### Subtle: ctx not checked in tasks

If your task doesn't check ctx, cancellation is ignored. Make checking part of your team's task-writing template:

```go
pool.Submit(func() {
	if ctx.Err() != nil { return }
	// do work
})
```

Or longer tasks should periodically check.

---

## Appendix S25: Senior Closing Thoughts

We have covered a lot. Let's land it.

### The senior's job

A senior engineer's job, in the context of pools, is to:

1. Pick the right tool per workload.
2. Justify the choice in writing.
3. Measure to confirm.
4. Document for the next engineer.
5. Operationalise (metrics, alerts, drain).
6. Push back on cargo-cult adoption.
7. Defend the standard library where it suffices.
8. Embrace third-party where it earns its keep.

### The senior's instinct

A good senior instinct: when you see a pool in a PR, ask three questions:

1. Why a pool? (vs raw, vs errgroup)
2. Why this pool? (vs ants, vs tunny)
3. Why this K? (with a number-backed rationale)

If the author can answer all three with measurements and reasoning, approve. If they can't, ask politely for the answers — that's the review's value.

### The senior's humility

You will be wrong about pool choices sometimes. The fix is to revisit them when you have data: a profile that shows the bottleneck is elsewhere, a benchmark that shows your library is slower, an incident that shows the pool failed in a way you didn't anticipate. Treat pool decisions as hypotheses, validated by production.

### The senior's mentorship

Help your juniors learn the framework. The decision tree is short; the rationale takes practice. Code review is where the framework gets internalised. Don't just say "use errgroup here"; explain why, link to this file, and let them propose alternatives.

---

## Appendix S26: Pool Patterns in the Standard Library

The Go standard library uses pool patterns in surprising places. Understanding them is part of senior literacy.

### sync.Pool

`sync.Pool` is *not* a goroutine pool — it's an object pool. But the design lessons apply:

- Per-P (per-processor) local pools to avoid contention.
- LIFO within a P for cache locality.
- Cross-P stealing when local is empty.
- GC clears the pool every cycle.

The "per-P local + steal" pattern is what high-throughput goroutine pools (ants loopq, pond) also use.

### net/http's worker model

The `net/http.Server` doesn't use a pool. Each connection gets its own goroutine. This is the original "goroutines are cheap" pattern, and it scales to tens of thousands of connections per server.

Why no pool? Because the bound is the number of connections (file descriptors), not the number of goroutines. The OS limits connections; goroutines naturally track.

### database/sql connection pool

`database/sql.DB` is a connection pool — not a goroutine pool, but a pool of resources. The pattern: a fixed set of resources, callers acquire/release, queue when exhausted. Same shape as a goroutine pool, different resource type.

### runtime's scheduler

The Go scheduler itself is a pool of OS threads (M's) handling a workload of goroutines (G's). The scheduler does work-stealing, idle-thread expiry, and a host of optimisations. Reading the scheduler design doc is the best way to understand pool design.

---

## Appendix S27: Beyond Goroutines — System-Level Pools

For services that grow past one process, pool thinking extends to:

### Connection pools (database, HTTP client)

These pool *resources*, not goroutines. Sizing is similar: K = throughput × latency.

### Worker pools across processes

Tools like Sidekiq (Ruby), Celery (Python), or Temporal/RabbitMQ (general) distribute work across many processes. Sizing each process's worker count is a per-process question; sizing the cluster is a different question.

### Thread pools vs goroutine pools

In other languages (Java, Python), thread pools have higher per-thread cost (1-8 MB stack), so K is typically much smaller (10-100 typical). Go's lighter goroutines allow K=1000+. Translating thread-pool advice to Go often results in pools too small.

### Process pools

Some workloads need full process isolation per task (e.g., untrusted code execution). Process pools (Unix `fork`, container pools) are conceptually similar but with vastly higher per-worker overhead.

---

## Appendix S28: Long-Running Pool Pattern

A common shape: a service has a pool that lives for the service's life. We dissect the pattern.

### Construction

```go
type Server struct {
	pool *ants.Pool
	mu   sync.RWMutex
	stopped bool
}

func NewServer(cfg Config) (*Server, error) {
	pool, err := ants.NewPool(cfg.PoolSize,
		ants.WithPanicHandler(panicHandler),
		ants.WithMaxBlockingTasks(cfg.QueueDepth),
		ants.WithExpiryDuration(cfg.IdleExpiry),
	)
	if err != nil { return nil, err }
	return &Server{pool: pool}, nil
}
```

### Submit with check

```go
func (s *Server) Submit(task func()) error {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.stopped { return ErrStopped }
	return s.pool.Submit(task)
}
```

The mutex prevents Submit-after-Stop. The RLock is cheap; many concurrent submits don't contend.

### Stop

```go
func (s *Server) Stop(timeout time.Duration) error {
	s.mu.Lock()
	s.stopped = true
	s.mu.Unlock()
	return s.pool.ReleaseTimeout(timeout)
}
```

Set the flag, then drain. New submits see the flag and return error.

### Metrics

```go
func (s *Server) ExportMetrics(reg *prometheus.Registry) {
	reg.MustRegister(prometheus.NewGaugeFunc(prometheus.GaugeOpts{
		Name: "pool_running",
	}, func() float64 { return float64(s.pool.Running()) }))
	reg.MustRegister(prometheus.NewGaugeFunc(prometheus.GaugeOpts{
		Name: "pool_cap",
	}, func() float64 { return float64(s.pool.Cap()) }))
	reg.MustRegister(prometheus.NewGaugeFunc(prometheus.GaugeOpts{
		Name: "pool_waiting",
	}, func() float64 { return float64(s.pool.Waiting()) }))
}
```

The metrics drive dashboards and alerts.

### Adoption

This pattern is the senior baseline for long-running pools. Adopt it, extend it, but don't skip the parts.

---

## Appendix S29: Pool Adoption Decision Document

When proposing pool adoption in a real codebase, the senior practice is to write a short decision document. Template:

```markdown
# Pool Adoption Proposal

## Context
Service: my-service
Workload: <describe>
Volume: <rps, sustained and peak>

## Current Implementation
<errgroup / raw / etc.>
<measurements: CPU, latency, etc.>

## Proposed Change
Adopt <ants / tunny / pond>.
K: <number>, rationale: <which constraint>.
Options: <panic-handler / non-blocking / etc>.

## Expected Impact
<bench results: throughput change, CPU change, latency change>

## Risks
- Dependency: <library age, maintenance status>
- Operational: <new metrics, drain behaviour>
- Migration: <how to revert>

## Decision
Adopt / Reject / Defer with reason.

## Sign-offs
<tech lead, on-call rep>
```

This is overhead — but it's how senior engineers prevent the cargo-cult adoption pattern. The act of writing forces measurement and clarity.

---

## Appendix S30: Pool Removal Decision Document

The mirror image: removing a pool is also a decision that deserves a doc.

```markdown
# Pool Removal Proposal

## Context
Service: my-service
Existing pool: <ants K=...>

## Why Remove
<measurements showing pool is unnecessary>
<errgroup equivalent benchmarked>

## Migration Plan
<step-by-step PR list>
<feature flag or direct cut>

## Risks
- Performance regression possible at <specific load>
- Loss of <feature, e.g., panic handler> — mitigation: <wrap manually>

## Rollback
<how to put the pool back if removal regresses>

## Sign-offs
<tech lead, on-call>
```

Senior practice: removing complexity is as much work as adding it. Document both.

---

## Appendix S31: Pool Cost Accounting

A senior accounts for the *cost* of pool choices.

### Code cost

A pool adds:
- ~10-30 lines of construction/teardown.
- Possibly a panic handler.
- Possibly metrics integration.
- Documentation.

Estimate: a pool adds ~50 lines of "permanent" code that someone must maintain.

### Dependency cost

A pool adds:
- A go.mod entry.
- A vendor copy (if vendoring).
- A version to track.
- A security audit annually.
- A CHANGELOG to read on upgrade.

Estimate: ~1 engineer-hour per quarter to maintain.

### Operational cost

A pool adds:
- Metrics in dashboards.
- Alerts to tune.
- Runbook entries (what to do when pool saturated).
- Onboarding material.

Estimate: ~3 engineer-hours per quarter to maintain.

### Total cost

Per pool, per year: ~30-50 engineer-hours of overhead. Worth it for pools that earn it; not worth it for pools that don't.

### When the math fails

If a pool adds 30 hours/year of overhead and saves 0 hours of incident response, it's a loss. If it prevents a $100k incident, it's a gain. The math determines.

Most pool decisions don't have this clarity. The senior judgement is to err on the side of fewer pools, because the cost is concrete and the savings are speculative.

---

## Appendix S32: Industry Comparisons

A look at how the same problem is solved in other ecosystems.

### Java thread pools

`java.util.concurrent.ThreadPoolExecutor`. Configurable core/max pool sizes, queue type, rejection policy. Fundamentally similar to Go pools.

Differences:
- Threads cost 1-8 MB stack each, so K is typically 10-100.
- Built into the standard library.
- Rich rejection policies (Caller-runs, Discard-oldest, etc.).

Go's equivalent: ants with similar options.

### Python asyncio

`asyncio.Semaphore` and task queues. Single-threaded, so "pool" is conceptually different — just a bound on concurrent coroutines.

Go's equivalent: errgroup.SetLimit and semaphore.

### Node.js worker pool

`worker_threads`. Heavy: each worker is a full V8 isolate (~50 MB). Pools typical 4-16. Used for CPU-bound work in an otherwise event-loop-driven system.

Go's equivalent: tunny (per-worker state) for CPU-bound.

### Rust async

`tokio::sync::Semaphore`. Similar to Go's semaphore. `rayon` for data parallelism. Tokio's task spawn is similar to Go's `go`.

Go's equivalent: errgroup, semaphore.

### Goroutine pools in Erlang/Elixir

The actor model — every process is a worker. Pools are explicit (e.g., poolboy in Erlang). The whole language is built around this.

Go's equivalent: any goroutine pool, more or less.

---

## Appendix S33: Pool Anti-Reference

A short list of things people *think* pools do but actually don't.

### Pools don't speed up your tasks

Each task takes as long as it takes. The pool affects *concurrency*, not per-task latency. A 1-second task is 1 second whether you pool it or not.

### Pools don't fix slow downstreams

If the downstream is slow, the pool's tasks pile up. Pool size doesn't fix downstream; it just lets you back-pressure earlier.

### Pools don't prevent OOM by themselves

A pool with unbounded queue can OOM just as easily as raw goroutines. The bound on the queue is what prevents OOM, not the pool per se.

### Pools don't provide failover

If a downstream dies, all your pool's tasks fail. A pool plus a circuit breaker can degrade gracefully; a pool alone doesn't.

### Pools don't replace rate limiting

A pool bounds concurrency. Rate limiting bounds rate. They're different. You may need both.

### Pools don't replace timeouts

A pool can have a task that hangs forever. Per-task timeout is essential.

### Pools aren't free

Construction, teardown, idle workers, monitoring — all cost something. Worth it for the right workload; wasted for the wrong one.

---

## Appendix S34: Pool Sizing Spreadsheet

For real services, a spreadsheet helps. Columns:

- Service name
- Pool name (if multiple)
- Tool (errgroup / ants / tunny / etc.)
- K (current)
- K rationale (which constraint binds)
- Steady-state observed utilization (%)
- Peak observed utilization (%)
- p99 latency target
- p99 latency observed
- Last benchmarked (date)
- Notes

Update quarterly. The spreadsheet drives "do we still have the right K?" reviews.

Sample row:

```
Service: orders-api
Pool: order-processor
Tool: ants
K: 200
K rationale: DB connection budget (50/pod × 4 replicas = 200/cluster, but per-pod K=50)
Steady utilization: 35%
Peak utilization: 92%
p99 target: 500ms
p99 observed: 380ms
Last benchmarked: 2024-09-15
Notes: Saw saturation during last deploy; consider raising K=75 or scaling replicas.
```

This is the kind of data that turns hand-waving into engineering.

---

## Appendix S35: The Senior Wrap-Up

We have covered, in this senior file:

- Deep comparison across five axes for five pool libraries.
- Internals walks for ants, errgroup, tunny, workerpool.
- Microbenchmarks with concrete numbers.
- Profile-driven analysis.
- Cache, GC, and scheduler interactions.
- Tail latency analysis.
- Failure modes and recovery.
- Mathematics of pool sizing.
- Real-world architecture case studies.
- Anti-patterns and stories.
- Senior decision processes.
- Cross-language comparisons.

If you've read it all and worked through the exercises, you are equipped to:

- Pick the right pool in production with measured rationale.
- Debug pool issues from pprof and metrics.
- Mentor others on pool choice.
- Argue for / against adoption with technical depth.
- Build a custom pool when no library fits.

The next file, `professional.md`, takes you from "I know how to pick a pool" to "I know how to operate a pool over years, across teams, across services."

---

## Appendix S36: Concurrency Mental Models for Pool Decisions

A senior collects mental models. Here are five that come up repeatedly when reasoning about pools.

### Model 1: The toll booth

A toll plaza with K booths. Cars are tasks. Cars queue (bounded queue or unbounded road). Each booth takes time W per car. Throughput is K/W cars per unit time.

Use this model when reasoning about throughput limits. Adding lanes (K) helps until the road feeding the plaza is the bottleneck.

### Model 2: The barbershop

K barbers. Customers arrive. Each haircut takes W. Customer either gets a seat (in flight), waits in the lounge (queue), or leaves (drop).

Use this model when reasoning about backpressure. The lounge fills, then customers leave — that's drop policy. The shop is at saturation when lounge is full *and* all chairs are full.

### Model 3: The kitchen line

A pipeline with sequential stages (chop, saute, plate). Each stage has K workers. The slowest stage is the bottleneck. Bigger pools at non-bottleneck stages waste workers.

Use this model when reasoning about multi-stage pipelines. Profile to find the bottleneck; resize the bottleneck stage.

### Model 4: The roundabout

Cars from N directions enter a roundabout. Limited slots inside. Cars yield to those in the circle. Throughput is bounded by the circle size and dwell time.

Use this model when reasoning about cross-handler resources (DB connections, downstream limits). The roundabout is the shared resource. Bigger inputs from any direction starve the others.

### Model 5: The factory shift

Workers (K) come in shifts. Some shifts are busy, some quiet. The factory has racks of unfinished items between shifts. When idle, workers go home (idle expiry); when busy, you hire from temp pool (spawn-up).

Use this model when reasoning about pool dynamics over time. Daily traffic cycles, daily worker count cycles.

---

## Appendix S37: Translating Theory to Practice

A senior engineer translates the theory in this file to action. Here is a worked translation.

### Theory: Little's Law

L = λ × W

### Practice: Pool sizing for a new service

You are building a new image transformation service. Specs:

- Expected RPS at peak: 200
- Expected transformation time: 80ms (p50), 250ms (p99)

Apply Little's Law:

- L_p50 = 200 × 0.08 = 16 active at median
- L_p99 = 200 × 0.25 = 50 active at p99

So pool size K = 50 covers p99. Add 20% headroom: K = 60.

But you also need to handle a burst — say, 3× normal for a few seconds. Burst RPS: 600.

- L_burst = 600 × 0.25 = 150 active

If K = 60, the burst will saturate immediately. Three options:
- Size for burst: K = 180 (with idle expiry to reduce when load drops).
- Allow queue: K = 60 with queue depth 200, accept higher latency during burst.
- Drop during burst: K = 60 with non-blocking + max-blocking-tasks, drop excess.

Choose based on SLA. If latency budget is tight: K = 180. If drops are OK: K = 60 with drop. If queueing is OK: K = 60 with bounded queue.

### Theory: Spawn cost dominates at high task rate

### Practice: Should you use a pool?

You're handling 500 req/sec each with a 50ms task. Goroutine creation is ~1-2μs. Spawn cost / total work = 2μs / 50000μs = 0.004% — invisible.

Verdict: errgroup is fine. Pool earns nothing.

You're handling 100k req/sec each with a 50μs task. Spawn cost / total work = 2μs / 50μs = 4% — measurable.

Verdict: pool is worthwhile.

### Theory: Memory bound

### Practice: Per-task memory accounting

Each task allocates a 1MB buffer for processing. Pod has 4GB. Baseline RSS is 500MB.

- Available for in-flight tasks: 4 - 0.5 = 3.5 GB
- Max in-flight: 3.5 / 0.001 = 3500

K = 3500 fits memory budget exactly. Add 20% safety: K = 2800.

But also: GC has a working set. If tasks allocate transiently, peak heap is 2-3× steady. So:

- Steady heap: K × 1 MB = 2.8 GB
- Peak heap: 5-8 GB (depending on GC behaviour)

That exceeds budget. Lower K. Or reduce per-task footprint.

K = 1500 might be safer. Verify with load test.

---

## Appendix S38: Senior Code Review Examples

Real PR scenarios you would encounter as a senior reviewer.

### PR 1: Junior adds ants to a tiny script

```diff
+ import "github.com/panjf2000/ants/v2"
+
+ pool, _ := ants.NewPool(10)
+ defer pool.Release()
+ for _, x := range items { // 50 items
+   x := x
+   pool.Submit(func() { process(x) })
+ }
```

Review: "50 tasks, one-shot. Pool is overkill. Use errgroup.SetLimit(10), removes the dependency, propagates errors better. Want me to show the diff?"

### PR 2: Senior adds ants to a high-rate path

```diff
+ pool, _ := ants.NewPool(1024, ants.WithPanicHandler(panicHandler))
+ ...
+ pool.Submit(func() { processMessage(msg) })
```

Review: "Looks good. Can you add the bench result showing this beats errgroup at our traffic level? Also, what's the panic handler doing — log only, or alert? If it's alert, mention that in a comment."

### PR 3: Mid-level adds errgroup without SetLimit

```diff
+ g, ctx := errgroup.WithContext(ctx)
+ for _, x := range items {
+   x := x
+   g.Go(func() error { return process(ctx, x) })
+ }
+ return g.Wait()
```

Review: "This is unbounded — every item spawns a goroutine. If items can be large, we may have a problem. What's the max items length? If <100, fine. If unbounded, add SetLimit(...)."

### PR 4: PR removes a pool

```diff
- pool, _ := ants.NewPool(20)
- defer pool.Release()
- ...
- pool.Submit(...)
+ g, ctx := errgroup.WithContext(ctx)
+ g.SetLimit(20)
+ g.Go(...)
```

Review: "Nice simplification. Do we have benchmarks showing performance equivalent? Also, does this match the existing K we had — looks like 20 = 20, good. Approve."

### PR 5: PR changes K from 100 to 500

```diff
- pool, _ := ants.NewPool(100)
+ pool, _ := ants.NewPool(500)
```

Review: "Why 500? What changed in the workload that requires this? Add a comment with the rationale. Also, have we verified the downstream can handle 500 (recall it was 100 last time we checked)?"

### PR 6: PR adds a global pool

```diff
+ var globalPool = mustNewPool(1000)
+
+ func (s *ServiceA) Handle() { globalPool.Submit(...) }
+ func (s *ServiceB) Handle() { globalPool.Submit(...) }
```

Review: "I'd prefer per-service pools rather than global, so that A doesn't starve B under load. The bound feels different per service. Can we split?"

---

## Appendix S39: When Senior Disagrees With Senior

Senior engineers disagree on pool choices. Some recurring disagreements and how to handle them.

### Disagreement 1: "Use pool everywhere for consistency"

One senior likes consistent use of pools across the codebase. Another prefers tool-fit per-place. Both are defensible.

Resolution: pick a team-wide standard. Document it. Override per-case with measurements.

### Disagreement 2: "Errgroup is good enough, never use ants"

A purist position. Sometimes leads to slow code at extreme rates.

Resolution: agree on a measurement threshold. If errgroup is >2x slower than ants in benchmark, allow ants.

### Disagreement 3: "Always size for peak"

Conservative; wastes idle workers most of the time.

### Disagreement 3 (cont): "Always size for average"

Risky; bursts saturate.

Resolution: size for peak with idle expiry (workers go away when not needed). Or use auto-scaling.

### Disagreement 4: "Custom pool is bad"

True on average, but some workloads need it.

Resolution: have a written policy: "custom pools require sign-off from senior; document the feature that no library covers."

### Disagreement 5: "Pool size = NumCPU"

Wrong for I/O-bound work but right for CPU-bound.

Resolution: explicit per-workload sizing.

The way to resolve these disagreements is to be specific: about which workload, which constraint, which measurement. Vague principles don't resolve specific PRs.

---

## Appendix S40: Looking Across The Stack

Pool decisions don't happen in isolation. They interact with:

### The application code

A request handler. The handler decides what work to fan out. The handler's structure determines whether errgroup or pool fits.

### The infrastructure

Pod size, CPU count, memory budget. These set the upper bounds for K.

### The network

Downstream services' concurrency limits. The downstream constraints set K.

### The deployment

Number of replicas. Cluster-wide capacity is K_per_pod × replicas.

### The operations

Metrics, alerts, runbooks. Whatever pool you pick, the operations team must understand it.

### The team

Skill level, code review culture. Some teams handle complex pool patterns well; some don't.

A senior thinks across all these layers. The pool is one variable; the system is the constraint.

---

## Appendix S41: A Final Senior Heuristic

When all else fails, here is the heuristic:

**Default to errgroup. Adopt a pool only when you have a profile or benchmark showing a measurable benefit.**

Most pool decisions can be reduced to this. The exceptions exist but should be justified explicitly, in writing, with numbers.

If a junior engineer asks "should I use a pool?" — the right senior answer is "show me the profile." Not "yes" or "no."

---

## Appendix S42: Pool Edge Cases You Will Hit

A catalog of edge cases observed in production. Each comes with mitigation.

### Edge Case 1: Workers all wedged on a slow downstream

Symptom: pool utilisation 100%, throughput plummets. Tasks pile up in queue.

Root cause: downstream service is slow. Each task takes 10x longer than expected. Effective K_eff = K / 10.

Mitigation: per-task timeout. Tasks that exceed timeout get aborted, worker freed.

```go
pool.Submit(func() {
	ctx, cancel := context.WithTimeout(parentCtx, 5*time.Second)
	defer cancel()
	work(ctx, item)
})
```

### Edge Case 2: Goroutine leak from cancellation race

Symptom: goroutine count grows over time despite all clients cancelling.

Root cause: a goroutine doesn't check ctx.Done() and runs to completion even after cancellation. The pool worker is occupied but the result is discarded.

Mitigation: ensure all long-running operations respect ctx.

### Edge Case 3: Pool deadlock at startup

Symptom: pool constructed at init, but Submit hangs forever immediately on startup.

Root cause: the pool's worker spawn goroutine is blocked because the goroutine that's supposed to receive its registration hasn't started yet (init order issue).

Mitigation: construct pool in main, not init. Or ensure dependent goroutines start before pool.

### Edge Case 4: Memory blow-up from idle worker stacks

Symptom: pool with high peak load shows 1 GB+ in goroutine stacks even at idle.

Root cause: some workers grew their stacks to 64 KB during peak. Stacks don't shrink. With 1000 workers × 64 KB = 64 MB. Times 16 cores idle: not so bad. But with deeper stacks (256 KB+) and more workers, can grow.

Mitigation: enable idle expiry. Pool drains; stacks released.

### Edge Case 5: Pool used after Release

Symptom: panic or silent error after Release.

Root cause: some goroutine retained a pointer to the pool and submitted after Release.

Mitigation: use a wrapping struct with a mutex-protected stopped flag (see Pattern in S28).

### Edge Case 6: Race detector triggers in pool teardown

Symptom: `go test -race` reports a race during pool shutdown.

Root cause: a pool worker writes to shared state after the test's WaitGroup has been signaled.

Mitigation: ensure pool teardown waits for all workers before tests check state.

### Edge Case 7: Submit blocks during shutdown

Symptom: shutdown hangs because workers are blocked submitting their results.

Root cause: a downstream channel that workers send to is being drained, but the drain is slower than the workers' submit rate.

Mitigation: drain via ctx — sender checks `case <-ctx.Done(): return` in selects.

### Edge Case 8: Pool oscillation

Symptom: with auto-tuning enabled, K oscillates between values rapidly.

Root cause: positive feedback loop in the control logic. Raising K causes higher throughput, which the control loop misreads as "need more K," etc.

Mitigation: add hysteresis. Raise K only if utilisation > 90% for 30+ seconds; lower if <40% for 5+ minutes.

### Edge Case 9: Pool starves under high contention

Symptom: producers contend on Submit, throughput plateaus.

Root cause: pool's internal lock is the bottleneck. Adding workers doesn't help.

Mitigation: switch to a sharded pool (pond) or to ants's loop-queue mode.

### Edge Case 10: One slow task hangs the pool

Symptom: a task that does an infinite loop or a syscall that doesn't return holds a worker forever.

Root cause: task is uninterruptible.

Mitigation: per-task timeout via ctx if the operation respects ctx. Otherwise, you cannot recover — that worker is gone. Restart the pod is the only fix.

---

## Appendix S43: Observability Beyond Basic Metrics

Senior-level observability for pools includes:

### Latency distributions

Plot per-task duration as a heat map over time. Spikes show up immediately. Buckets: 1ms, 10ms, 100ms, 1s, 10s.

### Submit queue depth histogram

Most teams report a gauge (current queue depth). Better: a histogram of "how long Submit blocked." Tells you about tail latency on the producer side.

### Worker churn rate

How many workers were spawned and expired per minute? High churn = pool size oscillating. Tune idle expiry.

### Panic rate by type

If you have a panic handler, classify panics. "Bad input" panics vs "internal bug" panics get different alerts.

### Cross-pool comparisons

If you have multiple pools, compare their utilisations side by side. Highlights imbalance.

### Customer-visible impact

Tie pool metrics to business metrics. "Pool saturated for 30s → 100 requests dropped → 5 customers affected." This converts technical metrics to language for ops.

---

## Appendix S44: Documentation Standards

A pool in production deserves three documents:

1. **In-code comment** — explains the K, the rationale, the failure mode.
2. **README section** — explains the pool's role in the service.
3. **Runbook entry** — explains what to do when the pool alerts fire.

A senior insists on all three. A pool with no docs is a future incident.

---

## Appendix S45: One Last Senior Insight

After all the comparison, mathematics, and edge cases, the senior insight is *the workload reveals the tool*. You cannot pick a tool without first understanding the workload's:

- Volume (rate, peak, burst)
- Per-task duration distribution
- Dependencies (memory, downstream, CPU)
- Failure modes (panic, timeout, partial)
- SLA (latency, throughput, error budget)

Without these, every choice is a guess. With them, the tool is usually clear.

The bias of junior engineers is to pick a tool first and discover the workload later. The senior practice is the inverse: understand the workload, then pick the tool. Read the profile, then propose the change.

This is the heart of the senior level. Take it with you.

---

## Appendix S46: One More Topic — Pool and Type Generics

Go 1.18 introduced generics. ants v2 supports them.

```go
// Generic pool
type Pool[T any] struct { ... }

func NewPool[T any](size int) *Pool[T] { ... }
func (p *Pool[T]) Submit(arg T) error { ... }
```

Generic pools let you pass typed arguments to Invoke without `any`. Better type safety.

For now, most code uses the non-generic API. As generic ants matures, expect adoption.

## Appendix S47: A Few Final Hard Questions

A few tricky senior-level questions to leave you with.

### Q: Can you have a pool with K=∞?

Effectively, no — that's "raw goroutines." A pool's whole point is bounding K. K=∞ defeats the purpose.

### Q: Does the pool's K count goroutines or tasks?

K is concurrent in-flight workers (i.e., concurrent tasks). Pending tasks in the queue don't count against K.

### Q: Can a pool worker spawn its own goroutines?

Yes. The worker is just a goroutine; it can spawn helpers. The helpers are not bounded by the pool's K; they're new goroutines.

If you want bounding inside a task, use a nested pool or a semaphore.

### Q: What's the cost of resizing a pool?

ants's `Tune(newK)` is essentially free (atomic update). Adding workers happens lazily as new tasks arrive. Removing workers happens via idle expiry.

For pools without Tune, there is no "resize" — destroy and create.

### Q: What happens when N producers submit to a pool of K=1?

Producers serialise. Each waits for the previous to complete. Throughput is limited by 1/per_task_time. For a high producer count, this becomes a contention point.

If you wanted parallel work, K=1 is wrong. If you wanted serialised work, perhaps a single goroutine with a channel is clearer.

End of `senior.md`.






