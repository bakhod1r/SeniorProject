---
layout: default
title: Professional
parent: Fan-Out Within Pipeline
grand_parent: Pipeline Production Patterns
ancestor: Go
nav_order: 5
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/19-pipeline-production-patterns/03-fan-out-within-pipeline/professional/
---

# Fan-Out Within a Pipeline Stage — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [Scheduler Internals That Shape Fan-Out](#scheduler-internals-that-shape-fan-out)
3. [Channel Implementation and Contention](#channel-implementation-and-contention)
4. [CPU Cache Effects](#cpu-cache-effects)
5. [Memory Footprint and Allocation Patterns](#memory-footprint-and-allocation-patterns)
6. [Adaptive Concurrency Control](#adaptive-concurrency-control)
7. [Tail-Latency Engineering at Scale](#tail-latency-engineering-at-scale)
8. [Pipeline Compositions in Production](#pipeline-compositions-in-production)
9. [Observability Beyond Dashboards](#observability-beyond-dashboards)
10. [Failure Mode Analysis](#failure-mode-analysis)
11. [Capacity Planning](#capacity-planning)
12. [Cross-Process and Cross-Host Fan-Out](#cross-process-and-cross-host-fan-out)
13. [Code Examples](#code-examples)
14. [Coding Patterns](#coding-patterns)
15. [Operational Playbook](#operational-playbook)
16. [Performance Tips](#performance-tips)
17. [Best Practices](#best-practices)
18. [Tricky Points](#tricky-points)
19. [Test Strategy](#test-strategy)
20. [Tricky Questions](#tricky-questions)
21. [Cheat Sheet](#cheat-sheet)
22. [Self-Assessment Checklist](#self-assessment-checklist)
23. [Summary](#summary)
24. [Further Reading](#further-reading)
25. [Related Topics](#related-topics)
26. [Diagrams & Visual Aids](#diagrams-visual-aids)

---

## Introduction
> Focus: "How does Go's runtime actually execute fan-out at scale, and how do I tune the system so it survives realistic workloads with predictable behaviour?"

At junior level you learned the template. At middle, you added ordering, cancellation, and error policy. At senior, you treated fan-out as architecture: budgets, bulkheads, cancellation domains. This level goes underneath: the scheduler that runs the goroutines, the channel implementation that dispatches the work, the cache lines that determine whether scaling is real or apparent, the allocation patterns that decide whether the system survives under heavy load.

The professional reader has built or run systems at scale where:

- The pipeline processes 100k+ items per second sustained.
- A 5 ms p99 regression triggers an incident.
- Goroutine counts cross tens of thousands.
- The bill for incorrect tuning shows up in cloud spend.
- Failures must be diagnosed from metrics and traces, not from rerunning locally.

This file covers what changes at that scale: how the Go runtime schedules work, where contention emerges, how to measure it, and which architectural choices avoid the problem. The patterns build on senior-level material; nothing here invalidates the simpler advice — but adds the layer of "what is actually happening under the hood, and what to do when default assumptions break".

After reading this file you will:

- Reason about fan-out behaviour in terms of GMP scheduler decisions.
- Diagnose channel contention from CPU profiles.
- Predict and mitigate CPU cache effects in worker layouts.
- Implement adaptive concurrency control that adjusts N based on observed latency.
- Engineer tail-latency targets via hedging, request-level timeouts, and load shedding.
- Design and operate pipelines that span processes and hosts.
- Read traces from `runtime/trace` and connect them to design decisions.

---

## Scheduler Internals That Shape Fan-Out

### GMP recap

Go's runtime has three core abstractions:

- **G**: goroutine. A user-space thread of execution. Cheap (~2 KB initial stack).
- **M**: OS thread. Created by the runtime to execute Gs.
- **P**: a logical processor. Each P has its own run queue. GOMAXPROCS controls the number of Ps.

A goroutine is queued on a P's local run queue. An M attached to a P picks Gs and runs them. When a G blocks on syscall, the M is detached; the P attaches to another M to keep running other Gs. When a G blocks on channel or mutex, the runtime parks the G (off-P) and the M takes the next runnable G.

### How channel sends interact with the scheduler

A channel send to a blocked receiver: the runtime hands the value to the receiver and marks the receiver runnable. The receiver is put back on its P's run queue (or another P's queue, depending on work-stealing rules). The send returns immediately.

A channel send with no receiver and no buffer space: the sender is parked on the channel's send queue. Its M moves on.

This means that in a fan-out:

- Workers are mostly parked on `range in` waiting for receives.
- Producer's send wakes one worker.
- Worker wakes, processes, sends to `out`, waits again.

The scheduler's behaviour shapes throughput, scheduling latency, and fairness. Three things matter:

1. **GOMAXPROCS** caps the number of Ms running Gs in parallel.
2. **Work stealing** moves Gs across Ps' run queues when one P is idle.
3. **Goroutine wake-up latency** is typically microseconds — fast enough for most workloads, but not zero.

### GOMAXPROCS and CPU-bound fan-out

For CPU-bound work, fan-out beyond GOMAXPROCS gives no parallelism benefit. The runtime serialises the extra Gs on the same Ps. Setting fan-out width to GOMAXPROCS is the natural ceiling for pure CPU work.

In containerised environments (Kubernetes, Docker), GOMAXPROCS defaults to the host's CPU count, not the container's CPU limit. This is a common production bug. Use `automaxprocs` or set `GOMAXPROCS` explicitly to match the container's CPU quota.

### GOMAXPROCS and I/O-bound fan-out

For I/O-bound work, goroutines parked on network I/O do not consume a P. The runtime's net poller integrates with the scheduler so an OS thread is not held while a goroutine waits on a socket. Thousands of network-bound workers can coexist on a small GOMAXPROCS without contention.

This is why fan-out widths for network calls can be much larger than CPU core count — the runtime efficiently multiplexes blocked goroutines.

### Work-stealing in Go

When a P's local run queue is empty, its M tries to steal from another P. The runtime steals half the target P's queue. Stealing has overhead and is best avoided. Two patterns help:

- **Hot Gs stay on one P.** A goroutine that quickly produces another runnable G (via channel send) keeps that G on the same P (via the `runqput` "next" slot). This favours producer-consumer locality.
- **Avoid bursting.** Spawning 10000 Gs at once and immediately blocking the parent triggers work-stealing all over the place. Steady-state submission is friendlier.

In fan-out, producer-to-worker hand-off via channel is friendly to the scheduler: the consumer is typically resumed on the producer's P, keeping cache locality.

### sysmon, preemption, and async preemption

The `sysmon` goroutine runs in the background and looks for:

- Goroutines that have run for > 10 ms without yielding (asynchronously preempted since Go 1.14).
- Blocked Ps that need stealing.
- Forgotten goroutines on dead Ms (rare).

This means a CPU-bound worker cannot hog a P forever. The runtime preempts it eventually, allowing other goroutines (including the closer or producer) to make progress.

In Go versions before 1.14, a tight CPU loop in a worker could starve other goroutines. Modern Go is much more forgiving, but extreme cases (CGO calls, runtime-mode code) can still cause starvation.

---

## Channel Implementation and Contention

### A channel is a struct with a mutex

In `runtime/chan.go`, a channel has:

- A mutex (`hchan.lock`).
- A circular buffer (if buffered).
- Send and receive wait queues.
- A "closed" flag.

Every send and receive acquires the mutex. At high throughput (millions of operations/s) the mutex becomes a contention point. You see it in profiles as time spent in `runtime.chansend` and `runtime.chanrecv`.

### Mitigations for channel contention

1. **Batch.** Send slices of 100 items per channel operation. 100x fewer mutex acquisitions.
2. **Shard.** Use multiple channels with a fixed dispatch function (round-robin or hash). Each channel has its own mutex; contention drops linearly with shards.
3. **Buffered channels.** A buffer reduces the chance of contended hand-off. Sends and receives only contend when the buffer is empty or full.
4. **Work-stealing.** Per-worker queues with stealing (as in the Go runtime itself) avoid centralised contention.

In practice, batching is the easiest and most effective. If batching is impossible (latency-sensitive items), shard the input channel into 2-4 sub-channels and dispatch round-robin.

### When channel contention is not your problem

For most pipelines (thousands of items/s, milliseconds per item), channels are nowhere near a bottleneck. You can verify with `pprof` (`go tool pprof -http=:6060`). If `chansend` and `chanrecv` together account for < 1% of CPU time, channels are not your bottleneck.

### The atomic-channel optimisation

Buffered channels with single sender or single receiver have a fast path that avoids mutex contention. The runtime uses atomic operations when possible. Fan-out's many-to-many model defeats this optimisation. Per-worker queues (single sender per channel) recover some of the benefit.

---

## CPU Cache Effects

### False sharing

Two workers writing to nearby addresses in memory force cache-line ping-pong between cores. A typical pattern:

```go
type Counter struct {
    workerID int
    count    int64
}
var counters [N]Counter
```

`counters[i].count` and `counters[i+1].count` may share a cache line (typically 64 bytes). Worker i's atomic add invalidates worker i+1's cache line. Both workers stall.

The fix: pad to cache line size.

```go
type PaddedCounter struct {
    count int64
    _     [56]byte // pad to 64 bytes
}
var counters [N]PaddedCounter
```

Now each counter occupies its own cache line. No false sharing.

In a fan-out where each worker increments a per-worker counter, this padding can yield surprising speedups on many-core machines.

### True sharing

A shared resource (a map, a slice, an atomic counter accessed by all workers) is true sharing. Each access forces the cache line to migrate. Even with atomics, the cache effects are real.

Mitigation: aggregate per-worker, merge periodically.

```go
type WorkerStats struct {
    Count int64
    // ...
    _     [40]byte // pad
}
stats := make([]WorkerStats, N)

// in worker:
stats[id].Count++

// in aggregator (separate goroutine, runs periodically):
var total int64
for _, s := range stats {
    total += atomic.LoadInt64(&s.Count)
}
```

Each worker writes its own cache line; the aggregator reads all of them. Far less contention than a single shared counter.

### NUMA effects

On multi-socket machines, memory access latency depends on which socket "owns" the memory. Go does not currently expose NUMA-aware scheduling. For most pipelines this is invisible. For very large multi-socket systems, splitting the pipeline into per-socket processes (one Go process per socket, IPC between) is the practical workaround.

### Working-set fit

A worker's hot data should fit in L1/L2 cache. If each item carries a large working set (a 10 MB buffer per item) and N workers each have one in flight, total working set is N × 10 MB. This dwarfs cache; performance degrades.

Mitigation: stream the large data; process in pieces. Or reduce N for memory-heavy workers.

---

## Memory Footprint and Allocation Patterns

### Per-goroutine stack growth

A goroutine starts at 2 KB stack. The runtime grows the stack (and copies it) as needed, up to 1 GB by default. Each grow event is a copy and a small pause for the affected goroutine.

For fan-out with thousands of workers, total stack memory is a real cost. If each worker has a 64 KB stack (post-growth), 10k workers consume 640 MB just in stacks. Worth measuring.

### Per-item allocations

An item flowing through the pipeline may allocate at each stage. With high throughput (100k items/s), GC pressure becomes significant. Tools:

- `pprof -alloc_objects` to see allocation hotspots.
- `runtime.MemStats.PauseNs` to measure GC pause times.
- Reuse via `sync.Pool` for short-lived heap objects.
- Convert allocations to stack-allocated structures via escape analysis (`go build -gcflags=-m`).

### Channel buffer memory

A buffered channel allocates its buffer at creation. `make(chan T, 10000)` of a 1 KB type allocates 10 MB up front. In a pipeline with many buffered channels, this adds up.

A reasonable practice: small buffers (N to 2N) per stage. Avoid huge buffers as a substitute for fixing real bottlenecks.

### GC and fan-out

Each worker contributes to GC pressure proportional to its allocation rate. More workers does not always mean more GC pressure if items are small or if work is the same — but it usually does. Profile under realistic load. Common findings:

- Allocations dominated by item structs (interning or reuse can help).
- Allocations dominated by intermediate buffers (sync.Pool).
- Allocations dominated by JSON marshalling (use `encoding/json/v2` when available; or `easyjson`/`ffjson`).

### Worker-local arenas

For very allocation-heavy workers, consider per-worker arenas (Go 1.20+ experimental). An arena is a region of memory freed all at once. Each item's working set lives in the worker's arena and is freed after the item is done. No GC pressure per item.

Note: arenas are experimental and may change. Verify support in your Go version.

---

## Adaptive Concurrency Control

### Why static N is suboptimal

A statically chosen N is correct only at one operating point. Under load spikes, with a different downstream, or as the system warms up, the right N changes. Static N either under-utilises or over-provisions.

Adaptive concurrency control adjusts N based on observed latency. The pipeline measures its own behaviour and self-tunes.

### AIMD: additive increase, multiplicative decrease

The simplest adaptive algorithm. Inspired by TCP congestion control.

- On success (latency below target), increase N by 1.
- On failure (latency exceeds target, error rate high), divide N by 2.

```go
type AIMD struct {
    n      int32
    minN   int32
    maxN   int32
    target time.Duration
}

func (a *AIMD) OnSuccess(latency time.Duration) {
    if latency < a.target {
        if atomic.LoadInt32(&a.n) < a.maxN {
            atomic.AddInt32(&a.n, 1)
        }
    }
}

func (a *AIMD) OnFailure() {
    for {
        n := atomic.LoadInt32(&a.n)
        newN := n / 2
        if newN < a.minN {
            newN = a.minN
        }
        if atomic.CompareAndSwapInt32(&a.n, n, newN) {
            return
        }
    }
}
```

The dispatcher reads `a.n` to determine how many workers to keep active.

### Gradient: Netflix-style concurrency control

A more sophisticated approach. Track the minimum observed latency (rttNoLoad) and the current latency. Compute a gradient: when current latency rises relative to rttNoLoad, reduce concurrency.

```
limit = current_limit * gradient + queueSize
gradient = (rttNoLoad / current_rtt)^2
```

This is the basis of Netflix's `concurrency-limits` library and similar tools. Implementations exist for Go.

### Token bucket and rate-limited fan-out

A separate concern: limit the *rate* of operations, not just concurrent count. Use `golang.org/x/time/rate` token bucket:

```go
limiter := rate.NewLimiter(rate.Limit(100), 10)
for v := range in {
    if err := limiter.Wait(ctx); err != nil {
        return
    }
    out <- process(v)
}
```

Combine with concurrency control: workers acquire concurrency tokens *and* rate tokens before doing work.

### When adaptive is the wrong choice

Adaptive concurrency adds complexity, especially in tests and predictability. If your pipeline runs at a known, steady rate against a known capacity, static N is fine. Adaptive is useful when:

- Downstream capacity varies (autoscaling, shared service).
- Load fluctuates by 10x or more.
- Tail latency must stay under a strict SLO.

For most internal batch pipelines, a well-tuned static N is enough.

---

## Tail-Latency Engineering at Scale

### Tail latency dominates user perception

If your service has 10 backend calls per user request and each is at p99 = 100 ms, the user request's median latency is around 1 second, and its p99 latency is way higher (due to amplification). Reducing per-call p99 is far more important than reducing mean.

In a fan-out, tail latency means: the time for the slowest item out of N to complete. For uniform workloads, this is roughly the p(1 - 1/N) percentile of single-item latency. For N = 100 items, that's p99 — meaning the slowest of 100 items is at the p99 of single-item latency. As N grows, the fan-out's effective tail moves further out into the distribution.

### Hedged requests at the fan-out level

A *hedged fan-out*: for each item, dispatch to two workers; take the first response. This sounds like 2x cost; in practice the cancellation of the loser limits actual overhead. Tail latency drops dramatically.

Implementation outline:

```go
func hedgedWorker(ctx context.Context, in <-chan Item, out chan<- Result) {
    for j := range in {
        ctx, cancel := context.WithCancel(ctx)
        results := make(chan Result, 2)
        go func() { results <- doWork(ctx, j) }()
        select {
        case <-time.After(50 * time.Millisecond):
            go func() { results <- doWork(ctx, j) }()
            r := <-results
            cancel()
            out <- r
            <-results // drain the other
        case r := <-results:
            cancel()
            out <- r
        }
    }
}
```

This worker hedges after a 50 ms delay. The delay should be set near the p95 of single-item latency: cheap items finish before hedging; slow items are hedged.

### Per-item timeouts

A worker that runs forever on a stuck item destroys throughput. Per-item timeout:

```go
ctx, cancel := context.WithTimeout(parent, perItemTimeout)
defer cancel()
result, err := doWork(ctx, j)
```

The work function must respect ctx. If it does not (e.g., a CGO call), the timeout is ineffective and you need a different mitigation (a separate process, or a circuit breaker).

### Load shedding

When the pipeline is overloaded, dropping items can be better than processing them slowly. Two heuristics:

- Drop oldest items in the queue (they are stale; new items are fresher).
- Drop random items proportional to overload.

In Go, a buffered channel does not drop; it blocks. Implementing drop requires `select` with a default case:

```go
select {
case in <- item:
case <-time.After(deadline):
    // drop
    metrics.Dropped.Inc()
}
```

Or use a priority queue with size cap; evict when full.

### Tail-latency monitoring

Track per-stage p50, p95, p99, p99.9 separately. The p99.9 is the user-facing SLO for many systems. Histogram-based metrics (Prometheus `histogram` not `summary`) are standard.

Alert on p99 regressions per-stage, not just on the whole pipeline. A regression in stage 3 is invisible if stages 1 and 2 are fast enough to mask it in the end-to-end metric.

---

## Pipeline Compositions in Production

### Common topologies

**Linear with widening:**
```
source -> [A x 1] -> [B x 8] -> [C x 2] -> sink
```
The bottleneck is B; B is widened.

**Diamond:**
```
source -> [A] --> [B1] --+
                         +--> [merge] -> sink
              \-> [B2] --+
```
Some items go to B1, others to B2 (different processing). Merged at the end.

**Branching with side effects:**
```
source -> [A] -> [B] -> [C] -> sink
                  |
                  +-> [audit] -> log
```
B emits each item to both main path and audit path. Two output channels.

**Cyclic (retry loop):**
```
source -> [A] -> [B] -> [C] -> sink
                  ^------------+
                          retry queue
```
Failed items in C go back to B. Requires careful loop termination.

### Stateful stages

A stage that maintains state across items is a different beast. Examples: deduplication, sessionisation, sliding windows. Fan-out a stateful stage by partitioning (per-key fan-out): each worker owns the state for its keys.

Stateful pipelines often look more like Kafka Streams or Flink topologies than the simple chain-of-stages we have built so far. The Go ecosystem has thinner libraries here; many teams build their own.

### Multiple inputs

A stage that consumes from two channels (e.g., main work + control commands) uses `select`:

```go
for {
    select {
    case <-ctx.Done():
        return
    case j, ok := <-in:
        if !ok {
            return
        }
        process(j)
    case cmd := <-controlCh:
        handleControl(cmd)
    }
}
```

Useful for pause/resume, runtime configuration changes, statistics queries.

### Multiple outputs

A stage that emits to two channels (one per consumer class) uses two output channels. Each consumer ranges over its own. Backpressure from one consumer does not affect the other if the channels have separate buffering.

---

## Observability Beyond Dashboards

### Distributed tracing in pipelines

A per-item trace ID lets you follow one item through every stage. OpenTelemetry has Go support; instrument each worker to start a span per item, with attributes for stage, worker ID, latency.

A common challenge: the item enters one stage, gets queued, dispatched to a worker, processed, queued for the next stage. The span hierarchy should reflect: "queued in stage A", "processed by worker 3", "queued in stage B", etc.

### `runtime/trace`

The Go runtime tracer (`runtime/trace.Start`) emits low-level events: goroutine creation, channel operations, syscalls, GC events. Visualise with `go tool trace`.

This is the ultimate tool for "why is my pipeline behaving like this". A trace shows you the actual scheduler decisions: which P ran which G when, where the time went. For diagnosing channel contention, scheduler starvation, or GC interactions, nothing else compares.

### Metrics taxonomy

Per stage:

- `items_in_total`: counter, items entering the stage.
- `items_out_total`: counter, items leaving.
- `errors_total`: counter, errors per item.
- `inflight`: gauge, items currently being processed.
- `queue_depth`: gauge, items in the input channel buffer.
- `process_seconds`: histogram, per-item processing time.
- `queue_seconds`: histogram, per-item time spent in queue.

Aggregate by stage label. Add tenant label for multi-tenant systems.

### Log correlation

Each item carries a correlation ID. Every log line in any stage includes it. When debugging a stuck pipeline, grep for the correlation ID and reconstruct the item's journey.

### Goroutine count tracking

`runtime.NumGoroutine()` exposed as a metric. Alerts on unbounded growth catch goroutine leaks within minutes instead of after OOM hours later.

---

## Failure Mode Analysis

### Modes of fan-out failure

1. **Worker leak.** A worker that does not exit on ctx.Done() or on input close. Slowly accumulates over time.
2. **Channel contention.** High throughput stalls on the channel mutex.
3. **Reorder buffer growth.** Slow item pinned, buffer grows, OOM.
4. **Backpressure deadlock.** Two stages mutually block each other.
5. **Hot key starvation.** Per-key fan-out, one key dominates.
6. **GC pressure spiral.** Allocations grow, GC pauses grow, throughput drops, queue grows, more allocations.
7. **Cascading cancellation.** Wrong context inheritance; cancellation propagates further than intended.
8. **Heisenbug under load.** A race that manifests only at high N.

### Post-mortem checklist

When a pipeline incident happens, walk through:

1. What was the trigger event? (Spike, deploy, downstream slowdown, hot key, etc.)
2. Which stage was the bottleneck during the incident?
3. Did backpressure propagate to the source? Did the source shed load?
4. Was cancellation honored within the SLA?
5. Did per-tenant isolation hold? Was a single tenant the cause?
6. Were goroutine counts stable, or did they grow unboundedly?
7. What metric, if monitored more closely, would have caught this earlier?

The answers feed into preventive changes: adjust widths, add bulkheads, expand observability.

### Chaos testing

Inject failures in non-production to validate fan-out behaviour:

- Random per-item latency spikes.
- Random per-item errors.
- Downstream returning 503s.
- Process killed mid-pipeline (test recovery).
- Network partition between worker pool and downstream.

A pipeline that has never been chaos-tested will fail in production in a mode you have not seen.

---

## Capacity Planning

### Little's law applied at scale

Steady-state capacity:

```
N_workers = arrival_rate * mean_latency_per_item / (target_utilization)
```

Target utilization 0.7 — leave 30% headroom for variance. Plug in your numbers.

### Headroom for variance

p99 latency is often 3-10x mean. If you size for mean, p99 spikes burst queue depth. Either size for p95 (more headroom) or have queues absorb the burst.

### Cost vs capacity

Each additional worker costs CPU and memory. For network-bound workers, the cost is low and over-provisioning is cheap. For DB-bound workers, you also pay for connection pool growth. For compute-heavy workers, you pay 1 CPU core per worker at full load.

Cost-aware capacity planning: pick the smallest N that meets the SLO. Re-evaluate quarterly as load patterns change.

### Scaling out vs scaling up

A single Go process scales to ~100k concurrent goroutines on a single machine. Beyond that, scale to multiple processes or hosts. The patterns then move from in-process fan-out to cross-process fan-out (next section).

---

## Cross-Process and Cross-Host Fan-Out

### When one machine is not enough

If your pipeline throughput exceeds what one machine can sustain, fan out across machines. The patterns:

- A producer publishes items to a queue (Kafka, NATS, RabbitMQ, Redis Streams).
- N consumer processes drain the queue.
- Each consumer process internally fans out to its workers.

This is fan-out at two levels: queue partitions across hosts, in-process workers within each host.

### Queue-based dispatch

Each item carries enough context to be processed independently. Consumers compete on the queue. Throughput scales with consumer count.

Operational differences from in-process fan-out:

- Backpressure becomes queue depth, observable in the queue's metrics.
- Errors require explicit retry policies in the queue.
- Ordering is per-partition, not global.
- Cancellation is per-message, not coordinated.

### Sharding strategies

- **Round-robin.** Easy; no ordering.
- **Hash by key.** Per-key ordering preserved (if queue supports it, like Kafka).
- **Affinity-based.** A consumer is assigned a specific shard; sticky processing.

Cross-host fan-out is fundamentally a Kafka topic with N partitions and M consumer instances. The Go process is one consumer instance; inside, it fans out to its workers. Two levels of width: cluster-wide M, in-process N. Tune both.

### Coordinator vs leaderless

Some patterns need a coordinator (e.g., distributed locking, leader election). Others are leaderless (each consumer makes independent decisions). Leaderless is simpler and more resilient; coordinator is required for some semantics (exactly-once, leader-only writes).

---

## Code Examples

### 1. Adaptive AIMD fan-out controller

```go
package main

import (
    "context"
    "fmt"
    "math/rand"
    "sync/atomic"
    "time"
)

type AIMD struct {
    n      int64
    minN   int64
    maxN   int64
    target time.Duration
}

func NewAIMD(min, start, max int, target time.Duration) *AIMD {
    return &AIMD{
        n:      int64(start),
        minN:   int64(min),
        maxN:   int64(max),
        target: target,
    }
}

func (a *AIMD) Limit() int { return int(atomic.LoadInt64(&a.n)) }

func (a *AIMD) Report(latency time.Duration) {
    if latency > a.target {
        for {
            n := atomic.LoadInt64(&a.n)
            newN := n / 2
            if newN < a.minN {
                newN = a.minN
            }
            if atomic.CompareAndSwapInt64(&a.n, n, newN) {
                return
            }
        }
    }
    for {
        n := atomic.LoadInt64(&a.n)
        if n >= a.maxN {
            return
        }
        if atomic.CompareAndSwapInt64(&a.n, n, n+1) {
            return
        }
    }
}

func worker(ctx context.Context, id int, in <-chan int, out chan<- int, ctrl *AIMD) {
    for {
        select {
        case <-ctx.Done():
            return
        case v, ok := <-in:
            if !ok {
                return
            }
            start := time.Now()
            time.Sleep(time.Duration(50+rand.Intn(100)) * time.Millisecond)
            ctrl.Report(time.Since(start))
            select {
            case <-ctx.Done():
                return
            case out <- v * v:
            }
        }
    }
}

func main() {
    ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
    defer cancel()
    ctrl := NewAIMD(1, 4, 32, 80*time.Millisecond)
    in := make(chan int)
    out := make(chan int)
    go func() {
        defer close(in)
        for i := 0; i < 1000; i++ {
            select {
            case <-ctx.Done():
                return
            case in <- i:
            }
        }
    }()
    for i := 0; i < 32; i++ {
        go worker(ctx, i, in, out, ctrl)
    }
    go func() {
        ticker := time.NewTicker(200 * time.Millisecond)
        defer ticker.Stop()
        for {
            select {
            case <-ctx.Done():
                return
            case <-ticker.C:
                fmt.Println("current limit:", ctrl.Limit())
            }
        }
    }()
    consumed := 0
loop:
    for {
        select {
        case <-ctx.Done():
            break loop
        case _, ok := <-out:
            if !ok {
                break loop
            }
            consumed++
        }
    }
    fmt.Println("consumed:", consumed)
}
```

Note: this example spawns more workers than the limit allows; the AIMD value just informs prioritisation. A production implementation gates worker activity on the AIMD via a semaphore.

### 2. Hedged fan-out worker

```go
func hedgedWorker(ctx context.Context, in <-chan Item, out chan<- Result, hedgeAfter time.Duration) {
    for j := range in {
        select {
        case <-ctx.Done():
            return
        default:
        }
        result := hedgedCall(ctx, j, hedgeAfter)
        out <- result
    }
}

func hedgedCall(ctx context.Context, j Item, hedgeAfter time.Duration) Result {
    ctx, cancel := context.WithCancel(ctx)
    defer cancel()
    results := make(chan Result, 2)
    go func() { results <- doWork(ctx, j, "primary") }()
    timer := time.NewTimer(hedgeAfter)
    defer timer.Stop()
    select {
    case r := <-results:
        return r
    case <-timer.C:
    }
    go func() { results <- doWork(ctx, j, "hedge") }()
    return <-results
}
```

The first call to complete returns. The cancel signals the loser; cooperative cancellation lets it exit.

### 3. Cache-line padded counters

```go
type PaddedInt64 struct {
    v   int64
    pad [56]byte
}

type WorkerStats struct {
    Items    PaddedInt64
    Errors   PaddedInt64
    Latency  PaddedInt64
}

var stats [64]WorkerStats

func record(id int, ok bool, latency int64) {
    atomic.AddInt64(&stats[id].Items.v, 1)
    if !ok {
        atomic.AddInt64(&stats[id].Errors.v, 1)
    }
    atomic.AddInt64(&stats[id].Latency.v, latency)
}
```

Each worker's counters occupy distinct cache lines. No false sharing. The cost: a bit more memory.

### 4. Cross-host fan-out via Kafka

```go
import "github.com/segmentio/kafka-go"

func consumer(ctx context.Context, brokers []string, topic, group string, n int) error {
    r := kafka.NewReader(kafka.ReaderConfig{
        Brokers:  brokers,
        GroupID:  group,
        Topic:    topic,
        MinBytes: 10e3,
        MaxBytes: 10e6,
    })
    defer r.Close()
    in := make(chan kafka.Message)
    g, gctx := errgroup.WithContext(ctx)
    g.SetLimit(n)
    g.Go(func() error {
        defer close(in)
        for {
            msg, err := r.FetchMessage(gctx)
            if err != nil {
                return err
            }
            select {
            case <-gctx.Done():
                return gctx.Err()
            case in <- msg:
            }
        }
    })
    for i := 0; i < n; i++ {
        g.Go(func() error {
            for msg := range in {
                if err := process(gctx, msg); err != nil {
                    return err
                }
                if err := r.CommitMessages(gctx, msg); err != nil {
                    return err
                }
            }
            return nil
        })
    }
    return g.Wait()
}
```

One consumer process; inside, fan-out to N workers; across the cluster, M instances of this process. Two levels of width.

### 5. Load shedding at the source

```go
func source(ctx context.Context, in <-chan Item, maxQueue int) <-chan Item {
    out := make(chan Item, maxQueue)
    go func() {
        defer close(out)
        for j := range in {
            select {
            case <-ctx.Done():
                return
            case out <- j:
            default:
                // queue full; shed
                metrics.Shed.Inc()
            }
        }
    }()
    return out
}
```

When the downstream cannot keep up, drop items rather than block. Suitable for real-time inputs where staleness is worse than loss.

---

## Coding Patterns

### Pattern: profile-driven width tuning

1. Run the pipeline with N = 1, measure throughput T1 and p99 L1.
2. Double N, measure T2 and L2.
3. Continue until T plateaus or L exceeds SLO.
4. Pick the N where T is close to plateau and L is well under SLO.

This is mechanical and avoids hand-waving. Codify it as a benchmarking suite that runs nightly against representative data.

### Pattern: stage-by-stage profiling

Profile each stage independently. Disable other stages or replace them with no-ops. The stage that profiles poorly is the bottleneck. Tune it; re-profile the whole pipeline.

### Pattern: shared types, distinct configs

```go
type Stage struct {
    Name    string
    Workers int
    Buffer  int
    Run     func(ctx context.Context, in <-chan Item) <-chan Item
}
```

Stages are uniformly shaped. A pipeline is `[]Stage`. The runner composes them. Configs are per-stage.

### Pattern: instrumented stage wrapper

```go
func instrument(name string, s Stage) Stage {
    return Stage{
        Name:    name,
        Workers: s.Workers,
        Buffer:  s.Buffer,
        Run: func(ctx context.Context, in <-chan Item) <-chan Item {
            out := s.Run(ctx, instrumentedIn(name, in))
            return instrumentedOut(name, out)
        },
    }
}
```

A decorator that wraps any stage with metrics, tracing, and logging. No need to instrument each stage's internals.

### Pattern: stage replay

For complex pipelines, an item should be replayable: rerunning the pipeline on the same item must produce the same output. This requires:

- Deterministic processing within each stage.
- Stable item identifiers.
- Stored or reproducible inputs.

Replay simplifies debugging and incident response. Design for it from day one.

---

## Operational Playbook

### Pipeline slow: how to diagnose

1. Check end-to-end throughput (items per second from source to sink).
2. Identify the bottleneck stage via per-stage `inflight` or `queue_depth`.
3. Profile that stage: CPU, memory, blocking, GC.
4. Check downstream dependencies (DB, API, queue).
5. Increase the bottleneck stage's width; remeasure.
6. If width is at budget cap, the cap is the bottleneck — raise the cap or change the architecture.

### Pipeline stuck (no progress)

1. `runtime.NumGoroutine()` — is the count growing or stuck?
2. SIGQUIT and read the goroutine dump. Find groups of similar goroutines stuck on the same operation.
3. Common causes:
   - Worker waiting on send to a consumer that abandoned (consumer leak).
   - Producer waiting on a queue with no consumer.
   - Mutual context cancellation race.
4. If goroutine count is stable but no progress: deadlock. Look for `chan send` in stack traces with no matching receive.

### Memory grows over time

1. `pprof -alloc_objects` to find allocation hotspots.
2. `pprof -inuse_objects` to find what is being held.
3. Common culprits:
   - Reorder buffer holding many items.
   - Goroutine leak (each leaked goroutine pins captures).
   - Channel buffer too large.
   - Unbounded queue in worker.

### Latency p99 regression

1. Compare p99 against last known good baseline.
2. Identify the stage with the regression.
3. Check resource contention (locks, pools, GC).
4. Profile under load.
5. If it is a downstream regression, the fix is downstream; the pipeline only mirrors it.

### Cost spike

1. Per-stage CPU and memory metrics.
2. Identify which stage's resource grew.
3. Check whether width was raised; check whether workload grew.
4. Tune.

---

## Performance Tips

- Batch where possible; channel ops are not free.
- Pad shared counters to cache-line size.
- Use `automaxprocs` in containers.
- Pre-allocate per-worker buffers.
- Use `sync.Pool` for short-lived heavy allocations.
- Prefer `slog` with structured fields and pools over `fmt.Sprintf`.
- Profile, don't guess.
- Monitor goroutine count as a first-class signal.
- Test with `-race` and goroutine-leak detectors (`go.uber.org/goleak`).
- Use weighted semaphores when item costs vary.
- Avoid recreating expensive objects per item (compiled regex, HTTP clients).

---

## Best Practices

- Define SLOs per stage and per pipeline; alert on regressions.
- Document the pipeline graph and update it as it evolves.
- Maintain a load-test suite that exercises realistic distributions.
- Run chaos tests (latency spikes, errors, downstream slowdowns).
- Plan capacity using Little's law; reserve 30% headroom.
- Use bulkheads in multi-tenant pipelines.
- Design for replay from day one.
- Use adaptive concurrency where workload is variable.
- Instrument everything; tracing is non-optional at scale.
- Test failure modes explicitly: input close, cancellation, errors, downstream timeout.

---

## Tricky Points

- `select` between `<-ctx.Done()` and `case <-in` is fair: with both ready, either may be chosen. The worker may process one extra item after cancellation; this is acceptable.
- `time.NewTimer` allocated per item adds GC pressure; reuse via `Reset` and `Stop` when possible.
- The runtime's GC is generational and concurrent in Go 1.5+. Short-lived allocations are cheap. Long-lived heap growth is what hurts.
- `atomic.LoadInt64` on misaligned addresses panics on some architectures (32-bit ARM). Pad to 8 bytes.
- Closing a channel from a goroutine that no longer owns it is a data race even if no panic occurs.
- A `select` with only `default` is non-blocking; useful for tryRead patterns.
- `context.AfterFunc` (Go 1.21+) runs a function when a context is cancelled, useful for cleanup outside the main goroutine.

---

## Test Strategy

```go
func TestNoGoroutineLeak(t *testing.T) {
    defer goleak.VerifyNone(t)
    ctx, cancel := context.WithCancel(context.Background())
    in := make(chan int)
    out := fanOut(ctx, in, 8, func(v int) int { return v })
    cancel()
    close(in)
    for range out {
    }
}

func TestUnderLoad(t *testing.T) {
    if testing.Short() {
        t.Skip()
    }
    ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
    defer cancel()
    const items = 1_000_000
    in := make(chan int, 1000)
    go func() {
        defer close(in)
        for i := 0; i < items; i++ {
            select {
            case <-ctx.Done():
                return
            case in <- i:
            }
        }
    }()
    out := fanOut(ctx, in, runtime.NumCPU()*2, work)
    var count int
    for range out {
        count++
    }
    if count != items {
        t.Fatalf("expected %d, got %d", items, count)
    }
}

func BenchmarkFanOutWidths(b *testing.B) {
    for _, n := range []int{1, 2, 4, 8, 16, 32, 64} {
        b.Run(fmt.Sprintf("N=%d", n), func(b *testing.B) {
            for i := 0; i < b.N; i++ {
                ctx := context.Background()
                in := make(chan int, 1000)
                go func() {
                    defer close(in)
                    for j := 0; j < 10000; j++ {
                        in <- j
                    }
                }()
                out := fanOut(ctx, in, n, work)
                for range out {
                }
            }
        })
    }
}
```

`goleak` detects goroutines that did not exit. Under-load tests validate behaviour at realistic scale. Benchmarks across widths inform tuning.

---

## Tricky Questions

1. *How does work-stealing interact with channel sends?*
   When a sender wakes a parked receiver, the receiver is placed back on a P's run queue. The runtime tries to keep the receiver on the sender's P (locality), but may steal across Ps if needed.

2. *Why does my fan-out throughput plateau at N = 16 despite 32 cores?*
   Common causes: channel contention (mutex), shared resource bottleneck (DB pool, mutex inside the work function), GC pressure that scales with N, or NUMA effects on multi-socket machines.

3. *Is `sync.Map` good for shared state in a fan-out?*
   Sometimes. For read-mostly maps it shines. For balanced read/write, sharded maps are usually faster. Profile.

4. *How do I migrate a fan-out from in-process to cross-host?*
   Replace the in-process channel with a queue (Kafka topic). Workers become queue consumers. The producer publishes to the queue. Backpressure becomes consumer lag. Cancellation is per-message via offset commits.

5. *When is adaptive concurrency control worth the complexity?*
   When workload variability is > 10x or downstream capacity varies (shared service, autoscaling). For stable internal pipelines, static N is enough.

6. *What does `runtime/trace` show that pprof doesn't?*
   Timeline of scheduler decisions, goroutine state transitions, GC events, blocking operations. Pprof aggregates over time; trace shows the sequence.

7. *How do I prevent OOM from a stuck reorder buffer?*
   Bound the in-flight items so the buffer cannot exceed N. Use windowed reorder so old gaps are skipped instead of indefinitely held.

8. *Why does my pipeline's p99 worsen during deploy?*
   Process startup: warming caches, JIT-like initial paths, GC pacer adjusting. Smooth deploys with canary stages, ramp-up traffic, and pre-warmed instances.

9. *Can I share an HTTP client across workers safely?*
   Yes. `http.Client` is safe for concurrent use. Pay attention to `MaxConnsPerHost`; with N workers and low limit, you bottleneck.

10. *How do I diagnose a fan-out that "sometimes hangs"?*
    Capture goroutine dump (SIGQUIT) during the hang. Look for clusters of goroutines stuck on the same operation. Usually points at a missing close or a send to an abandoned channel.

11. *What is the relationship between fan-out width and goroutine count?*
    Width N = active workers. Goroutine count includes workers, closer, producer, consumer, and any inner goroutines. For a deep pipeline, total goroutine count is several times the sum of widths.

12. *Why does the Go runtime sometimes preempt a worker mid-item?*
    Async preemption (Go 1.14+) kicks in after 10 ms of CPU time without a yield. The worker is preempted to allow other goroutines to run. The preempted worker resumes shortly. This is invisible to correctness but affects per-item latency for very long items.

13. *How does GOGC affect fan-out throughput?*
    GOGC=100 (default) triggers GC when heap doubles. Higher GOGC means less frequent but larger GC; lower means more frequent shorter. Tuning GOGC for fan-out trades latency for throughput.

14. *Why does increasing buffer size sometimes hurt performance?*
    Larger buffers mean items wait longer in queue (latency rises). They also defer backpressure, so a downstream problem manifests as queue growth rather than upstream slowdown. The hidden problem grows until it explodes.

15. *Is there a "correct" N or is it always empirical?*
    Little's law gives the order of magnitude. Empirical measurement gives the precise value. For most pipelines, run with N = NumCPU initially and tune within ±50% from there.

---

## Cheat Sheet

```
Scaling decision:        bottleneck (CPU, network, DB, disk) -> N choice
Width formula:           arrival_rate * mean_latency / target_utilization
Cache:                   pad shared counters, batch channel ops
Memory:                  pre-allocate per-worker, sync.Pool, arenas (1.20+)
Adaptive:                AIMD on latency; gradient for finer control
Tail latency:            hedge requests, per-item timeouts, load shedding
Cross-host:              Kafka/NATS/RabbitMQ + in-process fan-out
Observability:           per-stage histograms, traces, goroutine count, GC
Failure:                 chaos test before production; have runbooks
```

---

## Self-Assessment Checklist

- [ ] I can explain how the GMP scheduler runs my fan-out and why GOMAXPROCS matters.
- [ ] I can identify channel contention in a pprof profile and propose a fix.
- [ ] I can detect and eliminate false sharing in worker counters.
- [ ] I can implement AIMD or gradient adaptive concurrency control.
- [ ] I can engineer p99 tail latency through hedging, timeouts, and load shedding.
- [ ] I can design and operate cross-host fan-out via Kafka or NATS.
- [ ] I can read `runtime/trace` output and connect it to design decisions.
- [ ] I can write a chaos test for a fan-out and validate the failure modes.
- [ ] I can perform capacity planning using Little's law.
- [ ] I can diagnose a stuck pipeline from a goroutine dump within minutes.

---

## Summary

Professional-level fan-out is about how the Go runtime, the operating system, and the underlying hardware actually execute the patterns you wrote at junior, middle, and senior. The scheduler dispatches goroutines onto Ps and Ms; channels acquire mutexes on every send and receive; cache lines ping-pong between cores; GC pauses propagate. Each of these influences pipeline behaviour at scale.

The professional's job is to know which of these influences matter for the current workload, measure them, and adjust the design. Static widths give way to adaptive concurrency. In-process fan-out grows into cross-host fan-out. Observability is end-to-end, including traces and goroutine counts. Failure modes are mapped and tested before they occur in production.

What unites the levels is a single design vocabulary: producer, workers, closer, channels, backpressure, cancellation, ordering, failure mode, budget. The professional differs from the senior in two ways: deeper understanding of the runtime that executes those patterns, and broader experience operating systems built from them in adverse conditions. With both, fan-out becomes a reliable architectural primitive — boring, predictable, and dependable in production.

---

## Further Reading

- "The Go Memory Model" — the formal contract that makes channels safe
- Russ Cox, "Go's work-stealing scheduler" (2012 paper, still relevant)
- Jaana Dogan, "The scheduler design doc" (Go internals series)
- "The Tail at Scale" (Dean & Barroso, CACM 2013) — the seminal paper on tail latency
- "Concurrent Programming with Bounded Channels" (research literature on backpressure)
- Netflix's `concurrency-limits` library (Java, but the algorithm transfers)
- Kafka documentation on consumer groups and partitions
- `runtime/trace` documentation and example traces
- "BPF Performance Tools" (Brendan Gregg) for system-level profiling

---

## Related Topics

- All chapters of pipeline production patterns (this section)
- Backpressure (chapter 8) — deep dive into the mechanism
- Rate limiting (chapter 9)
- Circuit breakers (chapter 11)
- Adaptive load shedding (in distributed systems track)
- Kafka and message queues (data infrastructure track)
- Observability (operations track)

---

## Diagrams & Visual Aids

GMP scheduler interaction with fan-out:

```
G(producer) sends to chan in --+
                               v
                           [chan in]
                               |
                   wake up parked workers
                               |
                  +------------+------------+
                  v            v            v
              G(w0)         G(w1)        G(w2)
              on P0         on P1        on P2
                  |            |            |
             do work        do work     do work
                  |            |            |
              send out      send out    send out
                               |
                          [chan out]
                               v
                          G(consumer)
```

Channel contention map (high QPS):

```
N workers   --send-->   [chan: mutex]   <--receive-- 1 consumer
                            ^
                       contention point
                            |
                       Mitigate: batch, shard, work-steal
```

Cache-line false sharing:

```
Memory:    [worker0.count | worker1.count | worker2.count | ...]
                |---------64 byte cache line---------|
                
core 0 writes counter 0 -> invalidates line for cores 1,2,3
```

Adaptive AIMD over time:

```
N
  |          /\        /\
  |         /  \      /  \
  |       /     \    /    \    /\
  |      /       \  /      \  /  \
  |     /         \/        \/    \
  |    /                           \
  |   /
  +-------------------------------------> time
  Increase by 1 per success; halve on overload.
```

Cross-host fan-out:

```
Producer ---> Kafka topic (N partitions)
                  |
        +---------+---------+
        v         v         v
     consumer  consumer  consumer  (M instances)
     [N=8]     [N=8]     [N=8]     (each fans out internally)
        |         |         |
        v         v         v
                sink
```

Hedged fan-out timing:

```
item 0:  primary [-- 30ms --] DONE
item 1:  primary [-- 95ms (slow) --]
         hedge       [-- 35ms --] DONE -> cancel primary
item 2:  primary [-- 25ms --] DONE
```

The professional reads these diagrams as descriptions of the runtime's behaviour, not as abstract diagrams. Every arrow is a goroutine context-switch or a channel operation; every box is a real heap-allocated struct. With that grounding, design choices feel mechanical, and operating systems built on these patterns becomes routine.
