# Worker Pools — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [Pool Sizing in Depth](#pool-sizing-in-depth)
3. [Context-Aware Pools](#context-aware-pools)
4. [Per-Job Timeouts](#per-job-timeouts)
5. [Errgroup: Error Propagation Made Easy](#errgroup-error-propagation-made-easy)
6. [Semaphore Pattern](#semaphore-pattern)
7. [Buffered Channels and Throughput](#buffered-channels-and-throughput)
8. [Result Ordering Strategies](#result-ordering-strategies)
9. [Pipeline Composition](#pipeline-composition)
10. [Panic Safety](#panic-safety)
11. [Graceful Shutdown Patterns](#graceful-shutdown-patterns)
12. [Production Patterns](#production-patterns)
13. [Comparison Table](#comparison-table)
14. [Anti-Patterns](#anti-patterns)
15. [Test](#test)
16. [Cheat Sheet](#cheat-sheet)
17. [Summary](#summary)

---

## Introduction
> Focus: "I have a pool that works in the happy path. Now make it survive cancellation, errors, slow jobs, and partial failures."

The junior pattern (jobs / workers / results / WaitGroup) is correct but minimal. Production code adds five concerns:

1. **Cancellation** — stop everything when the user disconnects or the deadline expires.
2. **Errors** — one job fails; should everyone abort, retry, or log and continue?
3. **Per-job timeouts** — bound how long any single job can hang.
4. **Pool sizing** — pick N based on the *resource* being throttled.
5. **Backpressure tuning** — buffered channels, semaphores, and rate limiters.

This file expands the junior cheat sheet with `context.Context`, `golang.org/x/sync/errgroup`, semaphores, and the pipeline pattern. By the end you should be able to read or write any of the standard production worker-pool variants.

---

## Pool Sizing in Depth

The junior rule was "NumCPU for CPU-bound, larger for I/O-bound." Middle level: be specific.

### CPU-bound work

The bottleneck is computation. Adding workers past `NumCPU` only adds context-switch overhead.

```go
import "runtime"

n := runtime.NumCPU()       // physical + hyperthread count
// or
n := runtime.GOMAXPROCS(0)  // current GOMAXPROCS
```

Use `GOMAXPROCS` if you respect a container CPU quota that overrides the kernel count (set via `GOMAXPROCS=N` or `automaxprocs`).

### I/O-bound work

The bottleneck is waiting for a remote service. CPU is mostly idle. Workers can grow much larger than NumCPU. Two approaches:

1. **Service-driven cap.** "The downstream API allows 50 concurrent requests" → N=50.
2. **Latency × throughput rule.** If average request latency is 200 ms and target throughput is 500 req/s, then:
   `N = throughput × latency = 500 × 0.2 = 100 workers`. (Little's Law.)

### Mixed workloads

If each job is half computation, half waiting, neither rule fits. Measure with `go test -bench` and `pprof`. A starting point: `2 × NumCPU` and tune.

### Pool sizing decision tree

```text
Is the bottleneck CPU?
  ├── yes → N = GOMAXPROCS(0)
  └── no, it's I/O
       ├── known concurrency limit? → N = that limit
       ├── known latency × throughput? → N = throughput × latency
       └── otherwise → start at 2×NumCPU; benchmark; tune
```

### Why too many workers hurts

- More goroutines = more scheduler work. For 100k workers, overhead dominates.
- Each worker has ~2 KiB minimum stack. 100k × 2 KiB = 200 MiB of just stacks.
- More in-flight requests = more downstream load = downstream becomes the bottleneck.
- Lock contention scales with `N²` in some patterns.

---

## Context-Aware Pools

Cancellation is the most common production concern after correctness. The pattern: pass a `context.Context` to every worker; the worker checks it on each iteration.

```go
func worker(ctx context.Context, jobs <-chan Job, results chan<- Result, wg *sync.WaitGroup) {
    defer wg.Done()
    for {
        select {
        case <-ctx.Done():
            return
        case j, ok := <-jobs:
            if !ok {
                return
            }
            select {
            case results <- process(j):
            case <-ctx.Done():
                return
            }
        }
    }
}
```

Two `select` statements:
- The outer waits for a job *or* cancellation.
- The inner waits for the consumer *or* cancellation when sending the result.

Without the inner select, a slow consumer keeps the worker stuck on `results <- r` even after `ctx.Done()` fires.

### Cancelling the producer

```go
go func() {
    defer close(jobs)
    for _, in := range inputs {
        select {
        case jobs <- toJob(in):
        case <-ctx.Done():
            return
        }
    }
}()
```

The producer respects cancellation too — otherwise it sends to a channel no worker is listening on.

### Summary table — where to check `ctx.Done()`

| Goroutine | Check at |
|-----------|---------|
| Worker | Before reading job; before sending result; inside long-running `process` |
| Producer | Before each send |
| Consumer | Optional — usually drains until `results` closes |

---

## Per-Job Timeouts

A job that hangs forever blocks one worker forever. Always cap with a per-job context.

```go
func processWithTimeout(ctx context.Context, j Job) Result {
    jobCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
    defer cancel()
    return process(jobCtx, j)
}
```

`process` must respect `jobCtx` (passing it to HTTP calls, DB queries, etc.). A computation that ignores the context will not be interrupted — Go does not preempt arbitrary code.

### Per-job timeout vs whole-pool deadline

Layer them:

```go
// Whole-pool deadline: the user gave us 30 seconds.
poolCtx, cancel := context.WithTimeout(parentCtx, 30*time.Second)
defer cancel()

// Per-job deadline: each individual job gets 5 seconds.
for j := range jobs {
    jobCtx, jc := context.WithTimeout(poolCtx, 5*time.Second)
    results <- process(jobCtx, j)
    jc()
}
```

If the pool deadline fires, all per-job contexts inherit the cancellation.

---

## Errgroup: Error Propagation Made Easy

`golang.org/x/sync/errgroup` is the standard Go idiom for "spawn N goroutines; if any fails, cancel the rest, return the first error."

```go
import "golang.org/x/sync/errgroup"

func RunWithErrgroup(ctx context.Context, jobs []Job) ([]Result, error) {
    g, ctx := errgroup.WithContext(ctx)
    results := make([]Result, len(jobs))
    sem := make(chan struct{}, 8) // limit concurrency to 8

    for i, j := range jobs {
        i, j := i, j
        sem <- struct{}{}
        g.Go(func() error {
            defer func() { <-sem }()
            r, err := process(ctx, j)
            if err != nil {
                return err
            }
            results[i] = r
            return nil
        })
    }

    if err := g.Wait(); err != nil {
        return nil, err
    }
    return results, nil
}
```

Three things to notice:

1. **`errgroup.WithContext`** returns a context that is cancelled the moment any goroutine returns a non-nil error. All other workers see `ctx.Done()` and bail.
2. **`g.Go(fn)`** spawns a goroutine and tracks it. `g.Wait()` blocks until all return.
3. **The semaphore** (`sem`) bounds concurrency to 8. Without it, errgroup would spawn as many goroutines as jobs.

### When errgroup is the right choice

- You want fail-fast: first error cancels the rest.
- You don't need streaming results — you collect into a slice or map.
- You want simple ergonomics over a hand-rolled pool.

### When errgroup is the wrong choice

- You want to log every error, not just the first.
- Workers are long-lived (an errgroup is one-shot).
- You need fine-grained backpressure or batching.

### `errgroup.SetLimit` (Go 1.20+)

Modern errgroup has a built-in concurrency limiter:

```go
g, ctx := errgroup.WithContext(ctx)
g.SetLimit(8)
for _, j := range jobs {
    j := j
    g.Go(func() error { return process(ctx, j) })
}
return g.Wait()
```

`g.Go` blocks if the limit is reached. This replaces the manual semaphore.

---

## Semaphore Pattern

A semaphore is a counting channel that bounds concurrency without long-lived workers.

```go
sem := make(chan struct{}, N)  // buffered: capacity N
for _, in := range inputs {
    sem <- struct{}{}            // acquire
    go func(in Input) {
        defer func() { <-sem }() // release
        process(in)
    }(in)
}
// Wait for in-flight to drain
for i := 0; i < N; i++ {
    sem <- struct{}{}
}
```

This launches one goroutine per task but only N run concurrently. Trade-offs vs a pool:

| | Worker pool | Semaphore |
|--|------------|-----------|
| Goroutines | N (long-lived) | one per task (short-lived) |
| Job dispatch | Channel send/receive | Acquire/release |
| Per-job state setup | Once per worker | Once per task |
| Best fit | Many small jobs | Few medium jobs with per-task setup |

For 1M small tasks, a pool wins — fewer goroutines created. For 100 medium tasks where each one has its own setup, a semaphore is simpler.

### `golang.org/x/sync/semaphore`

A weighted semaphore — useful when jobs cost different amounts (e.g., one job uses 4 GiB, another 1 GiB):

```go
import "golang.org/x/sync/semaphore"

sem := semaphore.NewWeighted(8)
ctx := context.Background()
for _, j := range jobs {
    if err := sem.Acquire(ctx, j.Cost); err != nil {
        return err
    }
    go func(j Job) {
        defer sem.Release(j.Cost)
        process(j)
    }(j)
}
```

The package supports cancellation via context, which a raw channel-based semaphore does not.

---

## Buffered Channels and Throughput

Junior level used buffer = N. Middle level: tune the buffer for your workload.

### When to increase the jobs buffer

- Producer is bursty (1000 jobs in 100 ms, then quiet for 5 s). A larger buffer absorbs the burst.
- Producer is much faster than workers and you accept higher memory.

### When to decrease it (or use unbuffered)

- You want strict backpressure to slow producers immediately.
- Memory is constrained and jobs are large.
- You want simple shutdown semantics (closed channel drains in 0–N items, not 0–B).

### Results channel buffer

The results channel buffer absorbs *consumer* slowness, not worker slowness. If the consumer is slow:

- Buffer = 0: workers block on send → backpressure on workers → backpressure on producer.
- Buffer = N: workers may produce N results without consumer reading.
- Buffer = ∞: memory leak.

A common production setting: jobs buffer = `N`, results buffer = `N`.

### Throughput intuition

For uniform job latency `L` and `N` workers, steady-state throughput is `N/L`. Buffering changes burst behaviour, not steady-state throughput.

---

## Result Ordering Strategies

Workers process jobs in arrival order *of the channel*, but finish in arbitrary order. If output order matters:

### Strategy 1 — Index in job, slot in slice

```go
type Job struct {
    Index int
    Data  []byte
}
type Result struct {
    Index int
    Out   []byte
}

results := make([]Result, len(jobs))
// ... pool fills results[r.Index] = r
```

Each worker writes its own slot — no synchronisation needed because indices don't overlap.

### Strategy 2 — Reorder buffer

A consumer that emits items in order, buffering out-of-order results:

```go
buf := map[int]Result{}
next := 0
for r := range results {
    buf[r.Index] = r
    for {
        if v, ok := buf[next]; ok {
            emit(v)
            delete(buf, next)
            next++
        } else {
            break
        }
    }
}
```

Useful for streaming pipelines where you don't have all results in memory.

### Strategy 3 — Fan-in/fan-out with sequence merge

A more complex pattern, covered in senior level.

---

## Pipeline Composition

Chain pools to form pipelines:

```text
[stage1 pool] → [stage2 pool] → [stage3 pool]
  parse           transform        write
```

Each stage's output channel is the next stage's input channel.

```go
func pipeline(ctx context.Context, urls []string) error {
    raw := stage1Fetch(ctx, urls)        // chan Raw
    parsed := stage2Parse(ctx, raw)      // chan Parsed
    return stage3Save(ctx, parsed)
}
```

Closure rule: each stage closes its own *output* channel when its input is exhausted. The downstream stage detects the close via `range` and shuts down.

```go
func stage2Parse(ctx context.Context, in <-chan Raw) <-chan Parsed {
    out := make(chan Parsed)
    var wg sync.WaitGroup
    for i := 0; i < 4; i++ {
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

This is the "Pipelines and cancellation" pattern from the Go blog (a must-read for any pool author).

---

## Panic Safety

A panicking worker terminates the goroutine. Without `recover`, the panic propagates and crashes the program.

```go
func worker(jobs <-chan Job, results chan<- Result, wg *sync.WaitGroup) {
    defer wg.Done()
    defer func() {
        if r := recover(); r != nil {
            log.Printf("worker panic: %v\n%s", r, debug.Stack())
        }
    }()
    for j := range jobs {
        results <- process(j)
    }
}
```

But: a panicking worker that recovers and exits leaves N-1 workers running. If you want to keep processing, restart the worker:

```go
for {
    func() {
        defer func() { recover() }()
        for j := range jobs {
            results <- process(j)
        }
    }()
    // exited normally? channel closed → return.
    // panicked? loop and start a new worker.
    if jobsClosed.Load() {
        return
    }
}
```

Most production code prefers fail-fast: log the panic, signal the supervisor, exit.

---

## Graceful Shutdown Patterns

Shutdown has three flavours:

### 1. Drain shutdown — finish all queued work, then exit

```go
close(jobs)        // no more new work
wg.Wait()          // wait for all workers to drain
close(results)     // signal consumer
```

This is the default shutdown for batch jobs.

### 2. Cancel shutdown — abandon queued work, exit ASAP

```go
cancel()           // ctx.Done() fires; workers see it on next iteration
// jobs may still have unprocessed items; they will be discarded
wg.Wait()
```

Used when the user disconnected or the deadline expired.

### 3. Stop-accept-then-drain — stop new submissions, drain in-flight

Common in HTTP servers:

```go
stopAccepting() // producer no longer enqueues
// in-flight jobs continue
shutdownTimer := time.AfterFunc(30*time.Second, cancel)
defer shutdownTimer.Stop()
close(jobs)
wg.Wait()
```

Three phases: stop intake, drain queue, hard-cancel after deadline.

---

## Production Patterns

### Pattern: Worker pool struct

```go
type Pool struct {
    jobs    chan Job
    results chan Result
    wg      sync.WaitGroup
    cancel  context.CancelFunc
}

func New(ctx context.Context, n int) *Pool {
    ctx, cancel := context.WithCancel(ctx)
    p := &Pool{
        jobs:    make(chan Job, n),
        results: make(chan Result, n),
        cancel:  cancel,
    }
    for i := 0; i < n; i++ {
        p.wg.Add(1)
        go p.work(ctx)
    }
    go func() { p.wg.Wait(); close(p.results) }()
    return p
}

func (p *Pool) Submit(j Job) { p.jobs <- j }
func (p *Pool) Close()       { close(p.jobs) }
func (p *Pool) Stop()        { p.cancel() }
func (p *Pool) Results() <-chan Result { return p.results }

func (p *Pool) work(ctx context.Context) {
    defer p.wg.Done()
    for {
        select {
        case <-ctx.Done():
            return
        case j, ok := <-p.jobs:
            if !ok {
                return
            }
            select {
            case p.results <- process(j):
            case <-ctx.Done():
                return
            }
        }
    }
}
```

Encapsulates the pattern. Caller never touches goroutines directly.

### Pattern: Pool with retry per job

```go
func processWithRetry(ctx context.Context, j Job) (Result, error) {
    var last error
    for attempt := 0; attempt < 3; attempt++ {
        if err := ctx.Err(); err != nil {
            return Result{}, err
        }
        r, err := process(ctx, j)
        if err == nil {
            return r, nil
        }
        last = err
        time.Sleep(backoff(attempt))
    }
    return Result{}, last
}
```

Retries inside the worker, transparent to the caller.

### Pattern: Rate-limited pool

```go
import "golang.org/x/time/rate"

limiter := rate.NewLimiter(rate.Limit(10), 1) // 10 ops/sec

for j := range jobs {
    if err := limiter.Wait(ctx); err != nil {
        return err
    }
    results <- process(j)
}
```

Combines bounded concurrency with rate limiting.

### Pattern: Metrics

```go
var (
    inflight = expvar.NewInt("pool.inflight")
    total    = expvar.NewInt("pool.total")
)

func work(ctx context.Context) {
    for j := range jobs {
        inflight.Add(1)
        results <- process(j)
        inflight.Add(-1)
        total.Add(1)
    }
}
```

Exposes counters without external dependencies. `prometheus/client_golang` is the production choice.

---

## Comparison Table

| Pattern | Concurrency cap | Error handling | Cancellation | Best fit |
|---------|----------------|----------------|--------------|----------|
| Bare WaitGroup | None | Manual | Manual | Quick scripts |
| Worker pool (junior) | Yes (N) | Embed in result | Manual | Long-running batch |
| Worker pool + context | Yes (N) | Embed in result | ctx.Done | Production batch |
| `errgroup` | Yes (`SetLimit`) | First error | Auto via WithContext | Fail-fast batch |
| Channel semaphore | Yes (cap) | Manual | Manual | Per-task setup |
| `x/sync/semaphore` | Yes (weighted) | Manual | ctx.Done | Variable-cost jobs |
| Pipeline (stages) | Per stage | Per stage | ctx-propagated | Streaming |

---

## Anti-Patterns

1. **`go process(j)` inside a worker.** Defeats the bound — now the worker spawns unbounded sub-goroutines.
2. **Sharing one `*http.Client` mutex per worker.** Each worker can share a single `*http.Client` (it's safe); don't lock around it.
3. **Using `chan struct{}` as a "done" signal *and* a barrier in different goroutines.** Pick one role per channel.
4. **Closing the results channel from a worker.** Many workers, one channel — only one closer (the closer goroutine).
5. **Naked `time.Sleep` for backoff.** Use `time.NewTimer` so you can `select` on `ctx.Done()`.
6. **Letting errors bubble silently into a results channel and never reading them.** Always handle every result.
7. **Mixing `context.Background()` and a request context inside the same pool.** Use one context, derive children.

---

## Test

```go
func TestPoolCancelsOnContext(t *testing.T) {
    ctx, cancel := context.WithCancel(context.Background())
    p := New(ctx, 4)
    go func() {
        time.Sleep(50 * time.Millisecond)
        cancel()
    }()
    for i := 0; i < 1000; i++ {
        select {
        case p.jobs <- Job{N: i}:
        case <-ctx.Done():
            goto drain
        }
    }
drain:
    p.Close()
    p.wg.Wait()
    // ensure no goroutines leak
    if n := runtime.NumGoroutine(); n > 5 {
        t.Errorf("goroutine leak: %d remaining", n)
    }
}

func TestErrgroupFailFast(t *testing.T) {
    g, ctx := errgroup.WithContext(context.Background())
    g.SetLimit(4)
    for i := 0; i < 100; i++ {
        i := i
        g.Go(func() error {
            if i == 7 {
                return fmt.Errorf("boom")
            }
            select {
            case <-time.After(10 * time.Millisecond):
            case <-ctx.Done():
            }
            return nil
        })
    }
    if err := g.Wait(); err == nil {
        t.Fatal("expected error")
    }
}
```

Both with `go test -race`.

---

## Cheat Sheet

```go
// 1. Pool size
n := runtime.GOMAXPROCS(0)         // CPU-bound
n := 50                             // I/O-bound (downstream cap)

// 2. With cancellation
ctx, cancel := context.WithCancel(parent)
defer cancel()

// 3. Worker checks ctx
for {
    select {
    case <-ctx.Done(): return
    case j, ok := <-jobs:
        if !ok { return }
        select {
        case results <- process(ctx, j):
        case <-ctx.Done(): return
        }
    }
}

// 4. Errgroup variant
g, ctx := errgroup.WithContext(ctx)
g.SetLimit(8)
for _, j := range jobs {
    j := j
    g.Go(func() error { return process(ctx, j) })
}
err := g.Wait()
```

---

## Summary

Middle-level worker pools answer the questions production code asks: how do I cancel? How do I bound concurrency precisely? How do I propagate the first error? How do I time out a runaway job? The answers cluster around `context.Context`, `errgroup`, semaphores, and pipelines.

You learned: pool sizing (CPU vs I/O), context propagation through workers and producers, per-job and pool-level timeouts, errgroup for fail-fast, the semaphore alternative, buffered-channel tuning, ordered output strategies, pipeline composition, and the production pattern of wrapping a pool in a struct with `Submit`/`Stop`/`Results`. Senior level adds backpressure modelling, dynamic resizing, and work stealing.
