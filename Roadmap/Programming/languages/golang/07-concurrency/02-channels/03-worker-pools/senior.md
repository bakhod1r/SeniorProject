# Worker Pools — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Backpressure as a System Property](#backpressure-as-a-system-property)
3. [Little's Law and Pool Sizing](#littles-law-and-pool-sizing)
4. [Dynamic Resizing](#dynamic-resizing)
5. [Work Stealing and Adaptive Scheduling](#work-stealing-and-adaptive-scheduling)
6. [Error Propagation Strategies](#error-propagation-strategies)
7. [Pool Composition: Multi-Stage Pipelines](#pool-composition-multi-stage-pipelines)
8. [sync.Pool Inside Workers](#syncpool-inside-workers)
9. [Long-Running vs Short-Lived Workers](#long-running-vs-short-lived-workers)
10. [Memory and Goroutine Leak Forensics](#memory-and-goroutine-leak-forensics)
11. [Observability and SLOs](#observability-and-slos)
12. [Comparison Deep Dive: WaitGroup, errgroup, semaphore](#comparison-deep-dive-waitgroup-errgroup-semaphore)
13. [Real-World Architecture Examples](#real-world-architecture-examples)
14. [Decision Matrix](#decision-matrix)
15. [Summary](#summary)

---

## Introduction
> Focus: "I'm choosing between three worker-pool variants for a system with 10k req/s, P99 SLO of 200 ms, and a 30-instance fleet."

At senior level, you stop writing pools and start *choosing* them. The question isn't "how do I make a pool?" — that's a 30-line skeleton. The question is: which pool, sized how, sharing what state, instrumented how, and recovering how, given the *system* I'm in.

This file covers the system-level concerns that separate "knows the pattern" from "owns the pattern." Backpressure as a queueing-theory phenomenon. Little's Law for sizing. Dynamic resizing. Work stealing. Error semantics under partial failure. Memory profiling under load.

---

## Backpressure as a System Property

### The textbook definition

Backpressure is a producer-side slowdown caused by consumer-side saturation. In Go pools: producers block on `jobs <- j` when the channel is full and all workers are busy. The producer's blocking *is* the backpressure signal.

### Where backpressure breaks down

The mechanism only works if every link in the chain respects it:

```text
client → load balancer → web server → pool → DB
   ^           ^              ^         ^      ^
  must       must           must      must    must
 propagate  propagate     propagate propagate slow down
   slow       slow            slow     slow      or
   down       down            down     down     fail fast
```

If the DB has a 100-deep queue and the web server times out at 1 second, producers see "fast acceptance" of jobs that will eventually time out. The pool absorbs them but can't make them succeed.

### Three backpressure strategies

| Strategy | Mechanism | When |
|---------|-----------|------|
| Block | Producer waits on full channel | Internal pipelines, batch jobs |
| Reject | Submit returns "full" error; caller retries | HTTP servers, public APIs |
| Drop | Submit silently discards | Metrics, logs, telemetry |

The choice is a product decision masquerading as a technical one. Reject is correct for HTTP. Drop is correct for non-critical telemetry. Block is correct for in-process pipelines.

### Coding the three strategies

```go
// Block (default)
pool.jobs <- j

// Reject
select {
case pool.jobs <- j:
default:
    return errPoolFull
}

// Drop with metric
select {
case pool.jobs <- j:
case <-ctx.Done():
    return ctx.Err()
default:
    droppedCounter.Inc()
}
```

---

## Little's Law and Pool Sizing

Little's Law: in a stable system, `L = λW`, where:
- `L` = average number of items in the system (queue + in-process)
- `λ` = arrival rate (items/sec)
- `W` = average time per item (sec)

Applied to a worker pool:

```
inflight = throughput × latency
```

If you want 1000 req/s and each request takes 200 ms, you need 200 inflight requests at any moment. With workers that can each handle 1 request at a time, that's `N = 200` workers.

### Three derived rules

1. **Cut latency in half → halve N at the same throughput.** Or double throughput at the same N.
2. **N is independent of arrival pattern.** Bursty or smooth, the steady-state count is the same.
3. **Buffer = burst tolerance.** Buffer doesn't change steady-state N; it absorbs bursts so producers don't block during transients.

### Worked example

Service handles 5,000 req/s. P99 latency is 80 ms (so use that as the planning latency, not P50). Number of workers needed:

```
N = 5000 × 0.08 = 400 workers per instance
```

Across 4 instances, 100 each. Add 20% headroom: `N = 120` per instance.

If each worker costs 8 KiB of stack (large), 120 workers = ~1 MiB. Negligible. The real cost is the 120 downstream connections.

### When Little's Law is wrong

- Under utilisation > 80%, queue grows non-linearly. Plan for ~70% target utilisation.
- Heavy-tailed latency distributions (rare 10s outliers). P50 sizing collapses; size by P99.
- Coordinated arrivals (cron jobs, retries). Bursts can multiply expected N by 10x.

---

## Dynamic Resizing

A static pool is correct most of the time but wasteful or unsafe at the edges. Dynamic resizing scales N with load.

### Approach 1: Spawn-on-demand with a max

```go
type Pool struct {
    jobs chan Job
    sem  chan struct{} // bounds concurrency
}

func (p *Pool) Submit(j Job) {
    select {
    case p.sem <- struct{}{}:
        go func() {
            defer func() { <-p.sem }()
            process(j)
        }()
    case p.jobs <- j: // queue if all workers busy and queue has room
    }
}
```

Goroutines are short-lived. The semaphore caps concurrency. No long-running workers.

### Approach 2: Watermark-based scaling

```go
const (
    minWorkers = 4
    maxWorkers = 64
    growAt     = 0.8 // queue 80% full → add workers
    shrinkAt   = 0.2
)

func (p *Pool) supervise() {
    tick := time.NewTicker(time.Second)
    defer tick.Stop()
    for range tick.C {
        load := float64(len(p.jobs)) / float64(cap(p.jobs))
        if load > growAt && p.size() < maxWorkers {
            p.addWorker()
        } else if load < shrinkAt && p.size() > minWorkers {
            p.removeWorker()
        }
    }
}
```

The supervisor goroutine watches queue depth and adjusts. `addWorker` spawns; `removeWorker` posts a sentinel (or closes a per-worker stop channel).

### Approach 3: Per-worker idle timeout

Each worker exits after T seconds of idle:

```go
func (p *Pool) work(ctx context.Context) {
    defer p.wg.Done()
    idle := time.NewTimer(30 * time.Second)
    defer idle.Stop()
    for {
        idle.Reset(30 * time.Second)
        select {
        case <-ctx.Done():
            return
        case j, ok := <-p.jobs:
            if !ok {
                return
            }
            process(j)
        case <-idle.C:
            return // no work for 30s, exit
        }
    }
}
```

Combined with spawn-on-demand, this gives an auto-scaling pool with bounded max.

### Pitfalls of dynamic resizing

- **Thrashing.** Pool grows on a burst, shrinks on idle, grows on next burst. Use hysteresis (different grow/shrink thresholds).
- **Per-worker state.** If workers hold caches or open connections, churning them costs more than the savings.
- **Goroutine leaks.** Resizing logic must guarantee `wg.Done()` on every exit path.
- **Metrics drift.** Static pools have predictable counter behaviour; dynamic ones have spikes.

The senior judgment call: most pools should *not* resize dynamically. A correctly sized static pool is simpler and almost always sufficient. Resize only when load varies by 100x within minutes.

---

## Work Stealing and Adaptive Scheduling

Vanilla pool: each worker pulls from one shared channel. This is FIFO across workers and fair *on average* but bad when:

- One job is 100x slower than others (head-of-line blocking on that worker).
- Jobs have locality preferences (e.g., partitioned by user ID for cache reuse).

### Work stealing

Each worker has its own queue. When a worker's queue is empty, it tries to steal from a busy peer's queue. Go's runtime scheduler does this for goroutines; you rarely need to reimplement it for application-level work.

Library: `github.com/panjf2000/ants` is a popular goroutine pool with locality features. For most problems, the standard channel pool is fine — re-evaluating only if profiling shows imbalanced worker utilisation.

### Sharded pools

Sharding by key gives locality without stealing complexity:

```go
type ShardedPool struct {
    shards [16]*Pool
}

func (sp *ShardedPool) Submit(key string, j Job) {
    h := fnv32(key) % uint32(len(sp.shards))
    sp.shards[h].Submit(j)
}
```

Each shard is an independent pool. Same-key jobs go to the same shard. Useful for stateful workers (e.g., per-user caches).

---

## Error Propagation Strategies

### Strategy A — Embed in result

```go
type Result struct {
    Out int
    Err error
}
```

Pros: no special infrastructure. Consumer decides. Continues on error.
Cons: caller must handle every error. Aggregating "did anything fail?" is manual.

### Strategy B — errgroup (fail-fast)

```go
g, ctx := errgroup.WithContext(ctx)
g.SetLimit(N)
for _, j := range jobs {
    j := j
    g.Go(func() error { return process(ctx, j) })
}
return g.Wait()
```

Pros: idiomatic. First error cancels the rest.
Cons: you only see one error. Multi-error aggregation needs extra work.

### Strategy C — Multi-error aggregation

```go
import "errors"
import "go.uber.org/multierr"

var errs error
var mu sync.Mutex
for _, j := range jobs {
    j := j
    g.Go(func() error {
        if err := process(ctx, j); err != nil {
            mu.Lock()
            errs = multierr.Append(errs, err)
            mu.Unlock()
        }
        return nil // don't fail the group
    })
}
g.Wait()
return errs
```

Or `errors.Join` (Go 1.20+):

```go
errs := errors.Join(errs, err)
```

Pros: collect all failures.
Cons: doesn't fail-fast. Use when partial completion is OK.

### Strategy D — Circuit breaker

Workers track failure rate; if it exceeds a threshold, the pool refuses new jobs:

```go
if breaker.State() == Open {
    return errBreakerOpen
}
err := process(j)
breaker.Record(err)
```

Pros: protects downstream from continuing failure.
Cons: complexity. Use only when retry storms are a real risk.

### When to choose what

| Scenario | Strategy |
|---------|----------|
| Batch jobs, partial success OK | A or C |
| Atomic-ish operation, all-or-nothing | B |
| Public API with downstream failures | B + circuit breaker |
| Telemetry, fire-and-forget | A (drop or log) |

---

## Pool Composition: Multi-Stage Pipelines

A pipeline is N pools chained by channels. Each stage is sized for *its own* bottleneck.

```text
[fetch: 32 I/O-bound] → [parse: 8 CPU-bound] → [write: 4 DB-bound]
```

Three pools, three sizes, three closure responsibilities.

### Closure cascade

Each stage closes its own *output* when its input closes:

```go
func parseStage(ctx context.Context, in <-chan Raw) <-chan Parsed {
    out := make(chan Parsed)
    var wg sync.WaitGroup
    for i := 0; i < 8; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for r := range in {
                select {
                case out <- parse(r):
                case <-ctx.Done():
                    return
                }
            }
        }()
    }
    go func() { wg.Wait(); close(out) }()
    return out
}
```

The chain shuts down by cascading `close()` events down the stages.

### Pipeline pitfalls

- **Mismatched sizes.** A 100-worker fetch stage feeding an 8-worker parse stage means parse is the bottleneck and fetch sits idle. Size the *whole* pipeline to the slowest stage.
- **Lost cancellation.** If stage 2 doesn't propagate ctx, stage 3's cancellation is invisible.
- **Buffer cascading.** Large buffers between stages hide bottlenecks. Keep buffers small or zero so backpressure is visible in metrics.

---

## sync.Pool Inside Workers

`sync.Pool` reuses allocations across goroutines. Inside a worker that does many short-lived allocations, this can cut GC pressure dramatically.

```go
var bufPool = sync.Pool{
    New: func() any { return make([]byte, 0, 64*1024) },
}

func worker(jobs <-chan Job, results chan<- Result) {
    for j := range jobs {
        buf := bufPool.Get().([]byte)
        buf = process(j, buf)
        results <- Result{Data: append([]byte(nil), buf...)} // copy out
        bufPool.Put(buf[:0])
    }
}
```

### Rules

1. **Always copy out before `Put`.** The pool may give your buffer to another worker.
2. **Reset before `Put`.** `buf[:0]` keeps capacity, drops length.
3. **Don't `Put` huge buffers.** They consume memory until the next GC cycle drains the pool.
4. **`sync.Pool` is per-P (processor).** Cross-P transfers are expensive; keep work local to a P.

### When NOT to use

- The allocation is cheap (< 100 bytes). Pool overhead dominates.
- The lifetime exceeds the worker. Pool entries can be GC'd at any time.
- The number of items in flight is small. Pool wins on volume.

---

## Long-Running vs Short-Lived Workers

| Aspect | Long-running | Short-lived |
|--------|-------------|-------------|
| Spawn cost | Once | Per task |
| Job dispatch | Channel | `go func()` |
| Per-worker state | Easy | Awkward |
| Lifecycle | Explicit (Close/Wait) | Implicit (return) |
| Sizing | Static N | Implicit via semaphore |
| Use case | Many small jobs | Few medium jobs with setup |

Long-running wins when you have:
- Per-worker setup (open DB conn, build cache).
- Hot-loop processing where goroutine creation is a measurable cost.
- Need for explicit lifecycle (graceful shutdown, draining).

Short-lived wins when:
- Tasks are heterogeneous and rare.
- Per-task setup is cheap.
- You want simpler code (semaphore + `g.Go`).

---

## Memory and Goroutine Leak Forensics

### Common leak: forgot to close jobs

Producer panics; jobs is never closed; workers stay in `range` forever. Heap won't grow noticeably (workers are idle), but `runtime.NumGoroutine()` plateaus at N+1 forever.

Detect:

```go
// In tests:
before := runtime.NumGoroutine()
runMyPool()
after := runtime.NumGoroutine()
if after > before {
    t.Errorf("leaked %d goroutines", after-before)
}
```

In production: expose `runtime.NumGoroutine()` as a metric.

### Common leak: blocked on send

Consumer exits early; workers block on `results <- r`. Detect via `pprof goroutine` profile — N workers all blocked on channel send.

Fix: every send guarded by `select { case results <- r: case <-ctx.Done(): return }`.

### Common leak: orphaned context

Inner goroutine derives a child context but doesn't `cancel()` it. The child context's resources leak (timers, listeners). Always `defer cancel()`.

### pprof workflow for pool issues

```bash
go test -bench=. -cpuprofile=cpu.prof -memprofile=mem.prof
go tool pprof cpu.prof
# (pprof) top
# (pprof) list workerName
```

Look for: time spent in channel ops, allocations per job, GC pressure.

---

## Observability and SLOs

A pool emitting nothing is invisible until it's broken. Senior pools instrument:

| Metric | Type | Use |
|--------|------|-----|
| `pool.inflight` | Gauge | Current concurrent jobs |
| `pool.queue_depth` | Gauge | `len(jobs)` |
| `pool.workers_active` | Gauge | Workers not idle |
| `pool.jobs_total` | Counter | Total jobs processed |
| `pool.jobs_failed_total` | Counter | Total errors |
| `pool.duration_seconds` | Histogram | Per-job latency |
| `pool.queue_wait_seconds` | Histogram | Time job spent in queue |

### Implementation sketch

```go
import "github.com/prometheus/client_golang/prometheus"

var (
    inflight = prometheus.NewGauge(prometheus.GaugeOpts{Name: "pool_inflight"})
    duration = prometheus.NewHistogram(prometheus.HistogramOpts{
        Name:    "pool_duration_seconds",
        Buckets: prometheus.ExponentialBuckets(0.001, 2, 12),
    })
)

func work(jobs <-chan Job) {
    for j := range jobs {
        inflight.Inc()
        start := time.Now()
        process(j)
        duration.Observe(time.Since(start).Seconds())
        inflight.Dec()
    }
}
```

### SLO mapping

If your SLO is "P99 latency < 200 ms," your alerting rule is on the histogram's `0.99` quantile. Pool sizing (Little's Law) directly determines whether the SLO is achievable. Tie metrics to SLOs and you can tell, at a glance, whether the pool is the cause of an alert.

---

## Comparison Deep Dive: WaitGroup, errgroup, semaphore

| Feature | `sync.WaitGroup` | `errgroup.Group` | `x/sync/semaphore` |
|---------|-----------------|------------------|--------------------|
| Wait for goroutines | Yes | Yes | No (you wait yourself) |
| Cancellation on first error | No | Yes (with Context) | No |
| Concurrency limit | No | `SetLimit` | Weighted, native |
| Per-task weight | No | No | Yes |
| Error aggregation | Manual | First only | Manual |
| Best fit | Simple "wait for all" | Fail-fast batch | Variable-cost throttling |

**Rule of thumb:**

- "I just need to wait for them" → `sync.WaitGroup`.
- "I want fail-fast on first error" → `errgroup`.
- "I have variable-cost jobs and need ctx-aware acquire" → `x/sync/semaphore`.
- "I have many small jobs and need backpressure" → channel-based pool.

You can combine: `errgroup` plus a channel semaphore plus per-task `context.WithTimeout` is a very common production stack.

---

## Real-World Architecture Examples

### Image processor

```text
HTTP POST /upload
  → enqueue ImageJob{ID, S3Key}
  → pool of 16 workers (CPU-bound; NumCPU=16)
    each worker:
      1. Download from S3 (concurrent within worker via separate I/O pool)
      2. Resize using libvips (CPU-bound)
      3. Upload thumbnail to S3
      4. Update DB row
  → return jobID synchronously; client polls /status/{jobID}
```

Key choices:
- Submit returns 202 Accepted; processing is async.
- Pool size = NumCPU because resize is CPU-bound.
- Per-job timeout = 30 s; if libvips hangs, the worker isn't lost.
- Bounded queue depth = 1000; over that, return 429.

### Web scraper

```text
URL list (1M URLs)
  → producer reads line-by-line, sends to jobs chan
  → pool of 64 workers (I/O-bound; remote service tolerates 64 parallel)
    each worker:
      1. HTTP GET with 10s timeout
      2. Parse HTML
      3. Extract structured data
      4. Send to results chan
  → consumer batches results, writes 100 at a time to DB
```

Key choices:
- Pool size = 64 because target site rate-limits beyond that.
- Per-request timeout = 10 s.
- Token bucket limiter at 50 req/s (below the 64 cap, leaves headroom).
- Failure mode: log error, continue. Use multierr to surface at the end.

### Batch DB writer

```text
Stream of insert events
  → buffer up to 1000 rows or 100 ms (whichever first)
  → submit batch to pool of 8 writers
    each writer:
      1. Acquire DB connection from pool of 16 conns
      2. Begin tx
      3. Bulk insert
      4. Commit
  → emit metrics
```

Key choices:
- Pool size = 8 because DB pool has 16 connections; 8 writers × 1 conn = 8 in-flight.
- Batching reduces round trips by 1000x.
- Reject (429) if queue depth > 10 batches.
- Per-tx timeout = 5 s.

---

## Decision Matrix

| Need | Use |
|------|-----|
| Bound concurrency, no errors | Worker pool with WaitGroup |
| Fail-fast on first error | errgroup with SetLimit |
| Aggregate all errors | errgroup + multierr / errors.Join |
| Variable per-task cost | x/sync/semaphore |
| Streaming pipeline | Pipeline of pools, ctx-propagated |
| Per-key locality | Sharded pools |
| Auto-scaling load | Spawn-on-demand + semaphore + idle timeout |
| Public API entry | Pool + reject (429) on full queue |
| Background batch | Pool + block on full queue |
| Telemetry | Pool + drop on full queue + counter |

---

## Summary

Senior worker-pool work is system design. You apply Little's Law to size the pool. You choose the backpressure strategy (block, reject, drop) based on what kind of system you're in. You pick error semantics (embed, fail-fast, aggregate, circuit break) based on the failure model. You use sync.Pool only when allocation profiling justifies it. You expose metrics that map directly to SLOs. You compose pools into pipelines, sized per stage. You resort to dynamic resizing only when load varies by orders of magnitude.

The small skeleton from junior level is the trunk. Everything in this file is the branches that grow off it for production realities.
