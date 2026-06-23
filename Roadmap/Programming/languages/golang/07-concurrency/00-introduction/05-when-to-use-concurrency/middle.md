# When to Use Concurrency — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [Applying Amdahl's Law](#applying-amdahls-law)
3. [Sizing Worker Pools](#sizing-worker-pools)
4. [Choosing the Right Pattern](#choosing-the-right-pattern)
5. [Recognising Overengineering](#recognising-overengineering)
6. [The Bottleneck Migration Problem](#the-bottleneck-migration-problem)
7. [Concurrency in Long-Running Services](#concurrency-in-long-running-services)
8. [Bound Everything](#bound-everything)
9. [Hybrid Patterns](#hybrid-patterns)
10. [Diagnosing "Concurrency Did Not Help"](#diagnosing-concurrency-did-not-help)
11. [Self-Assessment](#self-assessment)
12. [Summary](#summary)

---

## Introduction

At junior level you learned a decision framework: I/O-bound → concurrent, CPU-bound → parallel up to NumCPU, trivial → sequential. At middle level we refine that into engineering judgement: how many workers exactly, when to abandon the concurrent design, how to recognise that you have added complexity for no gain.

The skill at this level is not memorising rules but developing intuition for the cost-benefit. After this you will:

- Apply Amdahl's law to predict speedup and decide whether to bother.
- Size worker pools based on workload characteristics, not guesses.
- Recognise the patterns that look concurrent but are actually serial.
- Refactor concurrent code to remove unnecessary parallelism.
- Predict where adding concurrency will move the bottleneck.

---

## Applying Amdahl's Law

Amdahl's law:

```
Speedup(n) = 1 / ((1 - p) + p/n)
```

Where `p` is the parallel fraction and `n` is the number of cores.

### In Go terms

Imagine a request handler that:

- Parses input: 5 ms (sequential).
- Validates: 2 ms (sequential).
- Calls 3 backends: 50 ms each, can be parallelised.
- Aggregates: 3 ms (sequential).

Sequential total: 5 + 2 + 50 + 50 + 50 + 3 = 160 ms.

With 3-way parallel calls: 5 + 2 + 50 + 3 = 60 ms.

Speedup: 160 / 60 ≈ 2.67x.

Amdahl: serial = 10 ms, parallel = 150 ms. `p = 150/160 = 0.9375`. With n=3: `Speedup = 1 / (0.0625 + 0.9375/3) = 1 / 0.375 ≈ 2.67`. Matches.

With n=100 cores (each backend on its own): `Speedup = 1 / (0.0625 + 0.9375/100) ≈ 13.9`. Even infinite cores cap at `1 / 0.0625 = 16`.

The lesson: even small serial fractions cap the gain. Find and shrink the serial portion before adding more parallelism.

### When Amdahl predicts no gain

- Serial fraction > 50% → speedup capped below 2x. Maybe not worth the complexity.
- Serial fraction > 80% → speedup capped below 1.25x. Almost certainly not worth it.

If your code is 80% sequential, focus on speeding up the sequential portion, not parallelising the rest.

### Hidden serial fractions

Common sources:

- **Aggregation.** Collecting results from N goroutines into one place is sequential.
- **Single connection / pool.** All goroutines share one resource → effectively serial.
- **Locking.** A hot mutex serialises whatever it protects.
- **Coordination.** `select` over many channels has overhead linear in arity.
- **GC.** Stop-the-world pauses serialise everything briefly.

Find and shrink these.

---

## Sizing Worker Pools

How many workers should a pool have? Depends on the workload.

### CPU-bound: NumCPU

For CPU-bound parallel work, the answer is roughly `runtime.NumCPU()` (or `runtime.GOMAXPROCS(0)`). More just thrashes the scheduler.

```go
workers := runtime.NumCPU()
```

For workloads with some I/O mixed in, you may want a bit more — `NumCPU * 2` to absorb the I/O wait. Profile to confirm.

### I/O-bound: bounded by downstream

For I/O-bound work, the answer is bounded by the downstream's capacity:

- Database connection pool size.
- API rate limit.
- Disk I/O bandwidth.
- Network bandwidth.

```go
workers := dbConnPoolSize
```

If your DB pool is 10 connections, having 100 workers does not give you 10x throughput; the workers queue behind the pool.

### Memory-bandwidth-bound: 2–4

For memory-bandwidth-bound code (large array scans), 2–4 workers usually saturate memory bandwidth. More workers just compete for the same RAM channel.

### Practical formula

A common heuristic for mixed workloads:

```
workers ≈ NumCPU * (1 + average_wait_time / average_compute_time)
```

If each task is 50% compute, 50% wait: 2x NumCPU. If 10% compute, 90% wait: 10x NumCPU. Profile to confirm.

### Adaptive sizing

For long-running services, consider dynamic sizing:

- Monitor queue depth.
- If queue is growing: add workers (up to a cap).
- If queue is empty: scale down.

The complexity is rarely worth it; fixed sizing tuned for peak load is simpler.

### Examples

| Workload | Pool size |
|---|---|
| CPU-bound parallel sort | `NumCPU` |
| HTTP fan-out to many services | `min(NumCPU * 4, max_connections)` |
| Database write workers | DB connection pool size |
| Memory scan | 2–4 |
| Webhook delivery | API rate limit / per-second |
| File processing | depends on disk type: SSD 32, HDD 4–8 |

---

## Choosing the Right Pattern

Once you decide to use concurrency, which pattern?

### Per-request goroutine

The framework handles this. You write synchronous code; the framework spawns goroutines.

Use when: HTTP server, gRPC server, message queue consumer.

### Fan-out / fan-in within one request

Each request issues several parallel sub-operations.

Use when: a single request must call multiple services or do multiple parallel computations.

```go
g, ctx := errgroup.WithContext(ctx)
g.Go(func() error { return op1(ctx) })
g.Go(func() error { return op2(ctx) })
g.Go(func() error { return op3(ctx) })
return g.Wait()
```

### Pipeline

Multiple stages, each its own goroutine. Use when:

- Stages have different rates and benefit from decoupling.
- Each stage is a clear logical step (parse → validate → enrich → write).

### Worker pool

A long-lived pool of N workers reading from a queue.

Use when:

- Input is unbounded but you want bounded concurrency.
- Tasks are independent.
- A shared resource (DB pool) has finite capacity.

### Scatter-gather

Send the same query to N backends; take the first acceptable answer.

Use when: redundancy across DCs / replicas, or hedged requests for latency.

### Decision table

| Question | Pattern |
|---|---|
| "I have N independent tasks, each takes a similar time." | Spawn-and-wait via `errgroup` or `WaitGroup`. |
| "I have N independent tasks; results aggregate." | Fan-out / fan-in with one output channel. |
| "I have a stream of input; I want bounded parallelism." | Worker pool. |
| "I have multiple processing stages with different rates." | Pipeline. |
| "I have one request that must fan out to multiple services." | `errgroup.WithContext`. |
| "I have multiple sources of the same data; I want fastest." | Scatter-gather with cancellation. |

---

## Recognising Overengineering

Signs that you have over-engineered concurrency:

### Sign 1: more code than the sequential version

If the concurrent version is 3x the lines of the sequential version, the complexity is real.

### Sign 2: tests are flaky or hard to write

Concurrent code is harder to test deterministically. If your tests are timing-sensitive or pass-then-fail, you may have added more complexity than the speedup warrants.

### Sign 3: profile shows synchronisation dominates

If `pprof` shows time spent in `runtime.lock`, `runtime.chansend`, `runtime.chanrecv`, you have added synchronisation overhead that may exceed the work.

### Sign 4: no measured speedup

Run sequential and concurrent versions side by side. If concurrent is not at least 1.5x faster, you have added complexity for no gain.

### Sign 5: bound concurrency = 1

If you ended up bounding the worker pool to 1 to avoid races or contention, you have sequential code with extra steps.

### Sign 6: shutdown is painful

If shutting down requires careful sequencing of goroutine joins, channel closes, and context cancellations, the design may be too concurrent.

### Sign 7: the bug found in code review is concurrency-related

Race conditions, missing close, blocked channels — frequent concurrency bugs in PR review indicate the design needs simplification.

---

## The Bottleneck Migration Problem

Adding concurrency rarely *removes* bottlenecks; it moves them. Plan for it.

### Example: a pipeline

```
Reader -> Processor -> Writer
10 MB/s  100 MB/s    20 MB/s
```

Sequential total throughput: 10 MB/s (limited by Reader).

Add concurrency: each stage runs in its own goroutine, connected by channels. Throughput?

Bottleneck moves to... still the Reader (10 MB/s). The processor and writer wait for the reader to feed them. Concurrency does not help unless you parallelise the bottleneck.

Parallelise the Reader (e.g., read multiple files concurrently):

```
Reader (4x) -> Processor -> Writer
40 MB/s     100 MB/s    20 MB/s
```

Now Writer is the bottleneck. Parallelise the Writer:

```
Reader (4x) -> Processor -> Writer (3x)
40 MB/s     100 MB/s    60 MB/s
```

Now Reader is again the bottleneck (40 < 60 < 100). Add more Readers, or accept the 40 MB/s ceiling.

### The lesson

Each round of parallelisation moves the bottleneck somewhere else. Plan multiple rounds, or stop when the next bottleneck is something you cannot scale (downstream API, disk bandwidth, etc.).

### Premature parallelisation

Adding concurrency *before* identifying the bottleneck is wasted effort. You spend complexity on a stage that was not the slow part. Profile first.

---

## Concurrency in Long-Running Services

In a service, concurrency lives at three levels:

### 1. Framework level (per-request goroutine)

The HTTP / gRPC server spawns a goroutine per request. You write synchronous handlers; the framework handles the concurrency. Default and almost always correct.

### 2. Request level (parallel sub-operations)

Inside one request, fan out to multiple services in parallel. Use `errgroup.WithContext`. Standard pattern.

### 3. Background level (long-running goroutines)

A handful of long-lived goroutines: metrics flusher, cache refresher, queue consumer. Each is a separate process within the service.

These are the only places concurrency lives. If you find yourself adding goroutines at other levels (inside handlers in unusual ways, deep within data structures), suspect overengineering.

---

## Bound Everything

Unbounded concurrency is a recurring bug class. Always bound:

### Bound goroutines per task

```go
sem := make(chan struct{}, maxConcurrent)
for _, item := range items {
    sem <- struct{}{}
    go func(item Item) {
        defer func() { <-sem }()
        process(item)
    }(item)
}
```

### Bound concurrency in `errgroup`

```go
g, ctx := errgroup.WithContext(ctx)
g.SetLimit(maxConcurrent)
for _, item := range items {
    item := item
    g.Go(func() error { return process(ctx, item) })
}
```

`SetLimit` (Go 1.20+) caps in-flight goroutines.

### Bound channel buffers

```go
ch := make(chan Item, expectedBurst)
```

Not `make(chan Item, 1_000_000)` "just to be safe."

### Bound queue depth

```go
const maxPending = 100
queue := make(chan Job, maxPending)
```

When full, decide: block, drop, or shed load.

### Why bounding matters

Unbounded queues OOM. Unbounded goroutine creation exhausts memory. Unbounded retries cascade failures. Bounding gives you predictable behaviour under stress.

---

## Hybrid Patterns

Real systems are hybrid. Examples:

### Fan-out within a worker pool

A pool of N workers, each of which fans out internally to M services:

```go
for w := 0; w < N; w++ {
    go func() {
        for job := range jobs {
            g, ctx := errgroup.WithContext(ctx)
            g.Go(func() error { return op1(ctx, job) })
            g.Go(func() error { return op2(ctx, job) })
            if err := g.Wait(); err != nil { ... }
        }
    }()
}
```

Total concurrency: N × M. Bound both.

### Pipeline + parallel stages

```
Reader -> [P1, P2, P3] -> Writer
            (parallel processors)
```

Reader and Writer are single goroutines; the Processor stage has multiple workers.

### Background refresh + foreground requests

A background goroutine refreshes a cache periodically. Request handlers read the cache. The cache is shared via atomic.Value.

```go
var cache atomic.Pointer[CacheData]

func init() {
    go func() {
        for {
            time.Sleep(time.Minute)
            cache.Store(refresh())
        }
    }()
}

func handler() {
    data := cache.Load()
    // use data
}
```

Mixing the patterns is fine. Document each layer.

---

## Diagnosing "Concurrency Did Not Help"

You added concurrency. The wall-clock time is the same (or worse). Why?

### Suspect 1: shared bottleneck

Profile mutex contention. If a single mutex / channel / connection dominates, all goroutines serialise on it.

### Suspect 2: GOMAXPROCS too low

If running in a container with `GOMAXPROCS=1` (older Go in containers), no parallelism. Set or detect properly.

### Suspect 3: workload too small

If each task is < 1 µs, goroutine overhead dominates.

### Suspect 4: memory bandwidth

Large array scans saturate memory bus. More cores do not help.

### Suspect 5: false sharing

Adjacent variables on the same cache line force inter-core invalidation. Pad to cache line.

### Suspect 6: too many goroutines

If goroutine count >> NumCPU, scheduler overhead dominates. Use a pool.

### Suspect 7: downstream rate limit

DB / API caps concurrency externally. Goroutines wait for the downstream.

### Suspect 8: GC pressure

Concurrent code may allocate more. GC pauses serialise everything. Profile heap.

### Suspect 9: scheduler latency

If your service has many runnable goroutines, scheduler queueing adds latency. Reduce goroutine count.

### Suspect 10: misdiagnosis

Maybe the workload was not the kind concurrency helps with. Reread the workload classification.

---

## Self-Assessment

- [ ] I can apply Amdahl's law to estimate speedup from given parallel/serial fractions.
- [ ] I have sized a worker pool with reasoning, not guessing.
- [ ] I can identify the bottleneck of a service before adding concurrency.
- [ ] I have written a concurrent version that I later removed because measurements showed no benefit.
- [ ] I always bound goroutine creation and channel buffers.
- [ ] I have used hybrid patterns (e.g., pool + fan-out).
- [ ] I have diagnosed "concurrency did not help" using profile data.
- [ ] I can recognise overengineering in code review.
- [ ] I use `errgroup.SetLimit` in places where it applies.
- [ ] I document concurrency choices in the code.

---

## Summary

The middle-level skill is making the cost-benefit explicit. Amdahl tells you the upper bound on gain. Workload type tells you the lower bound on cost (the overhead of synchronisation). Together they tell you whether to bother.

Sizing worker pools is workload-dependent: NumCPU for CPU-bound, downstream-capacity for I/O-bound, 2–4 for memory-bandwidth-bound. Always bound; never allow unbounded creation.

Recognise overengineering by signs: too much code, flaky tests, no measured speedup, painful shutdown. When you see them, simplify.

Plan for bottleneck migration. Each parallelisation moves the bottleneck; predict where it will move and decide whether to chase it.

The senior file looks at concurrency decisions at the architecture level. The professional file dives into quantitative trade-offs.
