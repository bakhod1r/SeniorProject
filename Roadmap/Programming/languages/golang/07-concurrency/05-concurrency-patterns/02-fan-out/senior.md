# Fan-Out — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Fan-Out vs Worker Pool: Where the Line Sits](#fan-out-vs-worker-pool-where-the-line-sits)
3. [Pool Sizing as a System Property](#pool-sizing-as-a-system-property)
4. [Backpressure and Saturation Topology](#backpressure-and-saturation-topology)
5. [Work Stealing and Affinity](#work-stealing-and-affinity)
6. [Error Propagation Strategies](#error-propagation-strategies)
7. [Cancellation Beyond Ctx](#cancellation-beyond-ctx)
8. [Dynamic Resizing](#dynamic-resizing)
9. [Telemetry](#telemetry)
10. [Production Failure Modes](#production-failure-modes)
11. [Single Slow Worker Stalls All](#single-slow-worker-stalls-all)
12. [Library Design](#library-design)
13. [Cheat Sheet](#cheat-sheet)
14. [Summary](#summary)

---

## Introduction

Senior-level fan-out is design work, not coding. You decide N, pool lifecycle, error semantics, telemetry, and how the fan-out interacts with the rest of the system. The code is small; the system is large.

This file assumes fluency with middle-level material: ctx, errgroup, the two-select sandwich.

---

## Fan-Out vs Worker Pool: Where the Line Sits

The terms blur. Useful distinctions:

- **Fan-out** is about *distribution semantics*: one channel of work, N concurrent readers. It is the *behaviour*.
- **Worker pool** is about *lifecycle and resource management*: a long-lived structure that submits jobs, manages the workers' health, scales up/down, and exposes Submit/Stop methods. It is the *object*.

A worker pool *uses* fan-out internally. A one-shot fan-out is not a worker pool. Use the right vocabulary in design discussions.

When to graduate to a pool object:

- The fan-out lives longer than a single function call.
- Workers need health checks, restarts, or graceful drain.
- Multiple call sites submit work to the same pool.
- The pool exposes metrics or admin endpoints.

Until then, the standalone fan-out helper is fine.

---

## Pool Sizing as a System Property

Pool size is a *system property*, not a code property. It depends on:

- The bottleneck downstream (DB, external API, file system).
- The latency profile of the work (median, p99, max).
- The resource budget (CPU, memory, file descriptors, connection pool).
- The consumer's ability to keep up.

A useful heuristic: **N = downstream concurrency budget − 1**. If your DB pool has 32 connections and other parts of the service use up to 4, fan-out should use ≤ 28.

For CPU-bound work the formula is simpler: N = `runtime.GOMAXPROCS(0)`. Above that, contention exceeds parallel speedup.

For mixed work, profile under representative load and adjust N until p99 latency starts increasing or downstream errors appear (timeouts, "too many connections", file descriptor exhaustion). Just below that point is your operating N.

---

## Backpressure and Saturation Topology

Fan-out has three pressure points:

```
producer ──▶ in ──▶ workers ──▶ out ──▶ consumer
            (1)              (2)
                                    (3)
```

1. **`in`'s buffer**: how much the producer can queue ahead of workers.
2. **Worker count**: throughput cap based on per-worker rate.
3. **`out`'s buffer + consumer rate**: cap on aggregate output.

If the consumer is the bottleneck, all workers eventually block on `out <- r`. New work piles up in `in`. Producer blocks on `in <- v`. Backpressure is automatic. *Do not* "fix" by ballooning buffers; that just postpones the OOM.

Saturation: every worker busy, throughput at the workers' aggregate rate. Adding workers above saturation does not help; the bottleneck moves elsewhere (downstream resource cap).

The right design pattern: instrument every pressure point with a metric (`pending_jobs`, `worker_busy_pct`, `output_pending`). Alert when any of them is consistently full or empty for too long.

---

## Work Stealing and Affinity

Default fan-out does *no* work-stealing — every worker reads the same channel; whoever is ready takes the next item. This is fair but not optimal when:

- Some jobs are 10x slower than others (long-tail distribution).
- Workers should have CPU/memory affinity (NUMA).

Work-stealing pattern:

```
                  per-worker queues
producer ──▶ ┌─[Q1]─▶ W1
             ├─[Q2]─▶ W2
             └─[Q3]─▶ W3
              │  steals
              └────────────┐
                           ▼
                       any other Q
```

Workers prefer their own queue but steal from others when idle. Implementation in pure Go is non-trivial; consider:

- `golang.org/x/sync/errgroup` for simple cases.
- `github.com/alitto/pond` or `github.com/panjf2000/ants` for production pools with stealing.

For most workloads, single-channel fan-out is good enough. Move to stealing only if profiling shows long-tail jobs and idle workers.

---

## Error Propagation Strategies

Senior code chooses an error strategy deliberately:

### Strategy A: Continue on error
Workers log and continue. Result struct carries `Err`. The pipeline runs to completion regardless. Good for batch jobs where partial failure is acceptable.

### Strategy B: First error cancels
Use `errgroup.WithContext`. The first error cancels ctx; every worker exits; `g.Wait` returns the error. Good for "all-or-nothing" workflows.

### Strategy C: Threshold of errors
Tolerate up to K errors; abort beyond. Implement with an atomic counter:

```go
var errCount atomic.Int32
// inside worker:
if err != nil {
    if errCount.Add(1) > maxErrors {
        cancel()
        return err
    }
    log.Println(err)
    continue
}
```

### Strategy D: Categorised errors
Some errors retryable, some terminal. Workers route retryable errors back into the input queue; terminal errors abort.

The right choice depends on business semantics. Document it in the API.

---

## Cancellation Beyond Ctx

Ctx cancels everything. Sometimes you need finer control:

- **Pause/resume**: gate workers behind a `<-pauseCh` that closes when paused. Workers select on it before reading the next job.
- **Selective abort**: cancel one specific job by job ID. Use a per-job context derived from the parent.
- **Graceful drain**: stop accepting new work but finish in-flight. Close `in` from the producer and wait for `out` to close.

Most production fan-outs need at least two of these. Build them deliberately.

---

## Dynamic Resizing

A long-lived pool may need to scale workers up or down based on queue depth.

Simple grow-only design:

```go
type Pool struct {
    in    chan Job
    out   chan Result
    cur   atomic.Int32
    cap   int32
}

func (p *Pool) maybeGrow() {
    if p.cur.Load() < p.cap && len(p.in) > int(p.cur.Load())*2 {
        p.cur.Add(1)
        go p.worker()
    }
}
```

Grow when queue depth exceeds 2x current worker count, up to a cap. The worker function checks ctx and exits when the pool is shutting down.

Shrinking is harder: workers cannot be killed; they must opt-in to exit. Implement with a per-worker quit channel or by sending a sentinel "exit" job that the next idle worker consumes.

For most systems, fix N and accept the under/over-provisioning trade-off. Dynamic resizing adds operational complexity rarely worth the complexity tax.

---

## Telemetry

A production fan-out exposes:

- `pool_size` (gauge).
- `pool_busy` (gauge): workers currently processing.
- `queue_depth` (gauge): items in `in`.
- `jobs_processed_total` (counter).
- `jobs_errored_total` (counter, by error class).
- `job_duration_seconds` (histogram).
- `output_buffer` (gauge): items in `out` if buffered.

Wrap your worker:

```go
func instrumentedWorker(ctx context.Context, in <-chan Job, out chan<- Result, m *Metrics) {
    for {
        select {
        case <-ctx.Done(): return
        case j, ok := <-in:
            if !ok { return }
            m.Busy.Inc()
            t := time.Now()
            r := process(ctx, j)
            m.Duration.Observe(time.Since(t).Seconds())
            m.Busy.Dec()
            if r.Err != nil { m.Errored.Inc() }
            else { m.Processed.Inc() }
            select {
            case <-ctx.Done(): return
            case out <- r:
            }
        }
    }
}
```

These metrics make pool sizing data-driven. Without them, you guess.

---

## Production Failure Modes

### Worker panic
A panic kills the goroutine. The WaitGroup never decrements (we used `defer wg.Done`, so it does decrement — but the worker is gone, capacity drops). For long-running pools, recover panics:

```go
defer func() {
    if r := recover(); r != nil {
        log.Errorw("worker panic", "panic", r, "stack", debug.Stack())
        // optionally restart the worker
    }
    wg.Done()
}()
```

### Worker hang
A job stuck in a network call without ctx never finishes. Pool capacity drops by one permanently. Always pass ctx into work and use `http.NewRequestWithContext` and similar.

### Producer outpaces workers
Backpressure works; producer blocks on `in <-`. If the producer cannot block (e.g. event handler), drop excess work or shed load with a circuit breaker.

### Consumer slower than aggregate worker rate
All workers block on `out <-`. Producer blocks. Throughput drops to consumer rate. This is correct backpressure. Do not "fix" it by buffering.

### File-descriptor or connection-pool exhaustion
Workers each open a file or DB connection. N too high exhausts the resource. Symptom: "too many open files" or "connection pool full" errors. Fix N to be ≤ resource cap minus headroom.

### Long tail
99% of jobs take 10ms; 1% take 10s. With static N, the 10s job pins one worker. Adjust by either using a separate "long-job" pool or by shedding/timing-out jobs that exceed a budget.

---

## Single Slow Worker Stalls All

Fan-out *does* have a subtle weakness: if the output channel is unbuffered and one worker is slow on its `out <- r` (because the consumer is slow), it does not stall the *other* workers — they each block on their own `out <- r`. But if one worker is slow on its *receive*, that does not happen with a shared input channel; the other workers simply read the next job.

So the weakness is on the output side, not the input side. A buffered output (`make(chan R, n)`) lets each worker stage one result without blocking. A small buffer sized to the worker count is a safe default for high-jitter consumers.

---

## Library Design

A senior-level pool API:

```go
// Pool is a long-lived fan-out worker pool.
type Pool[T, R any] struct { /* ... */ }

// NewPool constructs a pool with the given concurrency and processor.
// `n` workers are started immediately and run until Stop is called.
// `process` may be called concurrently from any worker.
func NewPool[T, R any](n int, process func(context.Context, T) R) *Pool[T, R]

// Submit enqueues a job. Blocks if the input buffer is full.
// Returns ctx.Err() if ctx is cancelled before submission.
func (p *Pool[T, R]) Submit(ctx context.Context, job T) error

// Results returns the receive-only results channel. Closed when Stop returns.
func (p *Pool[T, R]) Results() <-chan R

// Stop signals workers to drain and exit. After Stop, Submit returns an error.
// Returns when all workers have exited and the results channel is closed.
func (p *Pool[T, R]) Stop(ctx context.Context) error
```

The contract:
- `Submit` is blocking with ctx cancellation.
- `Stop` is graceful with a deadline via ctx.
- `Results` is readable until Stop completes.
- After Stop, no further Submit accepted.

Document each invariant; users will rely on every word.

---

## Cheat Sheet

| Decision | Senior choice |
|----------|---------------|
| One-shot fan-out | Standalone helper |
| Long-lived pool | `Pool` struct with lifecycle |
| First error abort | `errgroup` |
| Panic-tolerant | `defer recover` per worker |
| Dynamic N | grow-only with caps; shrink rare |
| Long-tail jobs | separate pool or per-job timeout |
| Production | metrics on every pressure point |

---

## Summary

Senior fan-out is system design. Pick N from data, instrument every pressure point, choose error semantics deliberately, and build a `Pool` only when lifetime and reuse demand it. The two-select sandwich and `errgroup` remain the building blocks; the rest is judgement applied to your workload.
