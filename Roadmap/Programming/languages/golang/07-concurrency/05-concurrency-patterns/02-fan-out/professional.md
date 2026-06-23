# Fan-Out — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [Production Case Study: Parallel HTTP Crawler](#production-case-study-parallel-http-crawler)
3. [Production Case Study: Image Batch Processing](#production-case-study-image-batch-processing)
4. [Production Case Study: DB Row Migration](#production-case-study-db-row-migration)
5. [Adaptive Pool Sizing](#adaptive-pool-sizing)
6. [Work Stealing in Practice](#work-stealing-in-practice)
7. [Batch Dispatch](#batch-dispatch)
8. [Operability and SLOs](#operability-and-slos)
9. [Multi-Tenant Pools](#multi-tenant-pools)
10. [Migration Stories](#migration-stories)
11. [Cost Modelling](#cost-modelling)
12. [Cheat Sheet](#cheat-sheet)
13. [Summary](#summary)

---

## Introduction

Professional-level fan-out is a service. The pool runs for hours or days, scales with load, exposes metrics, and shuts down cleanly. This file is case-study-driven: real architectures, measured trade-offs, and the operational discipline around them.

---

## Production Case Study: Parallel HTTP Crawler

A crawler fetches 1 million URLs per day. Architecture:

```
URL queue (Redis) ──▶ in (chan URL, buf=1024)
   │
   ├─▶ worker 1 (HTTP client, connection pool)
   ├─▶ worker 2
   ├─▶ ...
   └─▶ worker 64
                ──▶ out (chan Result, buf=128) ──▶ writer (Postgres bulk)
```

Engineering decisions:

- **N=64 workers**: profiled across 16, 32, 64, 128. At 64 the downstream Postgres write was near saturation; 128 gave no extra throughput and increased timeout rates.
- **Per-worker HTTP transport**: shared transport with `MaxConnsPerHost=64`. Transport reuses connections across workers.
- **Robots-respecting throttle**: per-host token bucket *upstream* of the fan-out; the in queue contains only allowed URLs.
- **Errors via Result struct**: 4xx and 5xx flow through; only ctx-cancelled aborts.
- **Restart policy**: on panic, the worker logs, the supervisor restarts a new worker. WaitGroup is reset.

Failure modes seen in production:

- A burst of 503s from one host. The HTTP client's retry logic (with backoff) caused workers to back up. Symptom: `pending` in `in` rose to 1024 within seconds. Mitigation: per-host concurrency limit (semaphore inside each worker) plus a circuit breaker.
- A misconfigured URL pattern caused one worker to hit a 10-minute timeout. Other workers ate the queue. Eventually all 64 workers were stuck on the same 10-minute call. Total throughput collapsed. Fix: per-call timeout = 30s, enforced via ctx.

---

## Production Case Study: Image Batch Processing

An image-processing service receives a daily batch of 500K images, each ~3 MB JPEG. The pipeline: download → decode → resize (3 sizes) → encode → upload.

```
[file list] ──▶ download (n=8 workers)
              ──▶ decode (n=4 workers, CPU-bound)
              ──▶ resize-and-encode (n=8 workers, CPU-bound)
              ──▶ upload (n=16 workers, IO-bound)
```

Each stage is a fan-out, fan-in. Different N per stage:

| Stage | N | Reason |
|-------|---|--------|
| Download | 8 | S3 GET QPS budget |
| Decode | 4 | NumCPU = 4; CPU-bound |
| Resize+Encode | 8 | NumCPU × 2; small parallelism boost from hyperthreading |
| Upload | 16 | S3 PUT throughput, network-bound |

Memory pressure: a decoded 24-megapixel image is ~96 MB in memory. With 4 workers each holding one decode buffer, plus a buffer of 8 between stages, peak memory is ~3 GB. Tuned by:

- `sync.Pool` for image buffers.
- Buffer between decode and resize: 1 (not 8). Strict backpressure to keep memory low.
- Streaming JPEG encoding: write to `io.Writer` instead of materialising the whole encoded image.

---

## Production Case Study: DB Row Migration

A team needs to backfill 100 million rows from one Postgres table to another, applying a transformation. Naive `INSERT ... SELECT` would lock the source table for hours.

Solution: paginated read fans out to N workers, each transforms and writes a chunk.

```
[paginator] ──▶ chunks (1000 rows each) ──▶ in (chan Chunk, buf=4)
                                              │
                                              ├─▶ worker 1
                                              ├─▶ worker 2
                                              ├─▶ ...
                                              └─▶ worker 8
                                                ──▶ done counters
```

Engineering:

- **N=8 workers**: matches the destination DB connection pool.
- **Bounded `in` buffer**: 4 chunks. The paginator pre-fetches the next chunks; workers process in parallel.
- **Idempotency**: each chunk has a sequence ID stored in a checkpoint table. Workers `INSERT ... ON CONFLICT DO NOTHING`.
- **Resumable**: on restart, the paginator reads the last checkpoint and resumes.
- **Throttling**: a token bucket limits to 1000 rows/sec to avoid impacting production load.

Failure modes:

- A worker hits a constraint violation. The `ON CONFLICT DO NOTHING` swallows it; the chunk is marked done. Operators see a "skipped" counter.
- A long transaction blocks one worker. The pool size is 8 but effective workers drop to 7. Throughput dips ~12%. Acceptable.
- The migration runs for 40 hours. Goroutine count is stable; memory plateau ~150 MB. Pool is healthy.

---

## Adaptive Pool Sizing

For services with bursty load, static N is suboptimal: too few during peak, too many at idle.

Two patterns:

### Token-based scaling
A semaphore controls concurrent work. Workers acquire a token from a token-bucket goroutine that adds tokens at a rate matching the desired throughput.

### Dynamic worker spawning
A controller periodically (every 5s) checks queue depth. If `len(in) > 0.8 * cap`, spawn one more worker (up to a cap). If `len(in) < 0.1 * cap` for 60s, terminate one (after it finishes its current job).

Implementation is non-trivial:

```go
type Pool struct {
    in     chan Job
    out    chan Result
    add    chan struct{}
    quit   chan struct{}
    workers atomic.Int32
}

func (p *Pool) controller(ctx context.Context) {
    t := time.NewTicker(5 * time.Second)
    defer t.Stop()
    var idleSince time.Time
    for {
        select {
        case <-ctx.Done(): return
        case <-t.C:
            depth := len(p.in)
            n := int(p.workers.Load())
            switch {
            case depth*5 > cap(p.in)*4 && n < maxN:
                p.add <- struct{}{}
                p.workers.Add(1)
                idleSince = time.Time{}
            case depth*10 < cap(p.in) && n > minN:
                if idleSince.IsZero() {
                    idleSince = time.Now()
                } else if time.Since(idleSince) > 60*time.Second {
                    p.quit <- struct{}{}
                    p.workers.Add(-1)
                    idleSince = time.Time{}
                }
            default:
                idleSince = time.Time{}
            }
        }
    }
}
```

This kind of code earns its complexity only when workload variance is large. Many services do fine with static N and 2x headroom.

---

## Work Stealing in Practice

For workloads with high latency variance (some jobs take 10ms, others 10s), a single shared input channel causes long tails. Work-stealing alleviates this:

- Each worker has its own input queue.
- Producer dispatches round-robin to per-worker queues.
- Idle workers steal from the longest queue.

In Go, true work stealing is rare in user code; the runtime already does it for goroutines. A pragmatic approach:

- Per-worker input channel with a small buffer.
- Workers, when their queue is empty, attempt a non-blocking receive on neighbour queues.

```go
for {
    select {
    case <-ctx.Done(): return
    case j, ok := <-myQueue:
        if !ok { return }
        process(j)
    default:
        if stolen, ok := stealFromAny(); ok {
            process(stolen)
        } else {
            time.Sleep(time.Millisecond)
        }
    }
}
```

Production-grade work-stealing pools are available in third-party libraries (`pond`, `ants`). Most workloads do not need this.

---

## Batch Dispatch

For very high job rates (1M+ jobs/sec), per-channel-send overhead dominates. Batch the dispatch:

- Producer accumulates 32 jobs, sends a `[]Job` on the channel.
- Each worker iterates the batch.

This reduces channel sends by 32x. Latency is slightly worse (jobs wait for the batch to fill or a timeout). Trade-off rarely worth it below 1M jobs/sec.

---

## Operability and SLOs

A production pool exposes:

- `pool_size` (gauge): current worker count.
- `pool_busy` (gauge): workers actively processing.
- `pool_in_pending` (gauge): items in input queue.
- `pool_out_pending` (gauge): items in output queue.
- `jobs_processed_total` (counter, by status).
- `job_duration_seconds` (histogram).

SLOs:
- p99 job duration < 1s.
- queue depth < 50% of capacity 99% of the time.
- error rate < 0.1%.

Alerts:
- Queue depth > 80% for 5 minutes → "load shedding triggered".
- Worker count = 0 → critical.
- Error rate > 1% → page on-call.

---

## Multi-Tenant Pools

In a SaaS context, you may run a fan-out pool per tenant. Issues:

- **Goroutine count explosion**: 10K tenants × 8 workers = 80K goroutines. Watch heap.
- **Resource fairness**: one tenant's pool can exhaust shared resources (DB connections, S3 throughput). Use per-tenant quotas.
- **Cold tenants**: pools with no work should scale to 0 workers to free goroutines.
- **Hot tenants**: priority queues or larger pools.

Alternative: a single shared pool with per-tenant rate limits at the producer side. Often simpler.

---

## Migration Stories

Synchronous to fan-out:

1. Find the slowest loop. Often: a `for _, x := range items { do(x) }` with 100ms per iteration.
2. Split `do` into `Job` and `process(Job)`.
3. Wrap the loop with a fan-out. Start small: N=4.
4. Add ctx and propagate it into `process`.
5. Add metrics; deploy to canary.
6. Tune N based on profiling.

Often a 100x throughput improvement on the first try. Watch for hidden shared state (logger, cache) that becomes a contention point.

---

## Cost Modelling

A fan-out's cost in Go:

- Goroutine memory: 8 KB initial stack × N. 100 workers ≈ 800 KB.
- Channel allocations: 2 channels per fan-out (`in`, `out`).
- Per-job cost: 2 channel sends/receives ≈ 100-300 ns.
- Worker scheduling overhead: depends on goroutine churn. If workers are long-lived, ~zero.

For 100 workers handling 100K jobs/sec:
- CPU on plumbing: 100 ns × 100K = 10 ms/sec, i.e. 1% of one core.
- Memory: 800 KB stacks + 1 MB channel buffers = 1.8 MB.

Plumbing is rarely the bottleneck. The work itself dominates.

---

## Cheat Sheet

| Production decision | Default |
|---------------------|---------|
| Worker count | profile under load; static N to start |
| Input buffer | 2-4x N |
| Output buffer | 1-2x N |
| Errors | errgroup or Result struct |
| Panic recovery | per-worker `defer recover` |
| Cancellation | ctx everywhere |
| Metrics | size, busy, pending, errors, duration |
| Multi-tenant | per-tenant quotas |

---

## Summary

Production fan-out is operational engineering. The skeleton is the same as middle-level code; what changes is the discipline: chosen N, observable metrics, panic recovery, dynamic scaling when needed, work-stealing for long-tail workloads, batch dispatch for very high rates. Real cases (crawler, image batch, DB migration) show the same pattern with different parameters. Tune by data; instrument by default.
