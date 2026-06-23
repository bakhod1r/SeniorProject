# Goroutine Lifecycle — Optimize

Optimization exercises focused on reducing the cost of goroutine lifecycles: birth churn, waiting overhead, stack bloat, and the indirect GC pressure that long-lived goroutines impose.

## Table of Contents
1. [Optimization Mindset](#optimization-mindset)
2. [Opt 1: Avoid Spawn-Per-Job Churn](#opt-1-avoid-spawn-per-job-churn)
3. [Opt 2: Reuse Closures, Not Goroutines](#opt-2-reuse-closures-not-goroutines)
4. [Opt 3: Shrink Stack Size for Long-Lived Workers](#opt-3-shrink-stack-size-for-long-lived-workers)
5. [Opt 4: Reduce `_Gwaiting` Time](#opt-4-reduce-_gwaiting-time)
6. [Opt 5: Replace `time.Tick` with a Long-Lived Ticker](#opt-5-replace-timetick-with-a-long-lived-ticker)
7. [Opt 6: Batch Spawns](#opt-6-batch-spawns)
8. [Opt 7: Nil Out References Before Long Waits](#opt-7-nil-out-references-before-long-waits)
9. [Opt 8: Bound Goroutine Count](#opt-8-bound-goroutine-count)
10. [Opt 9: Pool Reusable Goroutines](#opt-9-pool-reusable-goroutines)
11. [Opt 10: Move Cleanup Off the Critical Path](#opt-10-move-cleanup-off-the-critical-path)
12. [Measuring Lifecycle Costs](#measuring-lifecycle-costs)
13. [Summary](#summary)

---

## Optimization Mindset

Goroutines are cheap, but cheap times millions matter. A goroutine costs:

- 2 KB initial stack (more after growth).
- ~400 bytes of `g` struct overhead.
- A run-queue slot.
- A closure on the heap (if `go func() { ... }()`).
- The duration of any GC scan over its stack.
- For long-waiting goroutines: pinned heap references.

If your service spawns 100k goroutines per second and they live 1 ms each, that is 100 birth+death operations per millisecond per second of wall clock — total `g` activity ~100 million/second. Each is fast, but the aggregate competes with real work for CPU and allocator bandwidth.

Optimizing lifecycle means:

1. **Spawn less.** Reuse goroutines via pools.
2. **Wait less.** Bound wait times, drain promptly.
3. **Hold less.** Don't pin large closures during long waits.
4. **Die promptly.** A goroutine ready to die should die — clean up, return.

---

## Opt 1: Avoid Spawn-Per-Job Churn

### Baseline

```go
func handle(req Request) {
    go func() {
        process(req)
    }()
}
```

For 100k req/s, you spawn 100k goroutines/s. Each lives briefly. Birth+death overhead is non-trivial.

### Optimized

```go
type Worker struct {
    jobs chan Request
}

func New(workers int) *Worker {
    w := &Worker{jobs: make(chan Request, 1024)}
    for i := 0; i < workers; i++ {
        go w.run()
    }
    return w
}

func (w *Worker) run() {
    for req := range w.jobs {
        process(req)
    }
}

func (w *Worker) Handle(req Request) {
    w.jobs <- req
}
```

### Measure

```go
func BenchmarkSpawnPerJob(b *testing.B) {
    var wg sync.WaitGroup
    for i := 0; i < b.N; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            // tiny work
        }()
    }
    wg.Wait()
}

func BenchmarkPool(b *testing.B) {
    jobs := make(chan struct{}, 1024)
    var wg sync.WaitGroup
    for i := 0; i < 16; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for range jobs {
                // tiny work
            }
        }()
    }
    for i := 0; i < b.N; i++ {
        jobs <- struct{}{}
    }
    close(jobs)
    wg.Wait()
}
```

For micro-work, the pool is typically 3-10x faster because spawn cost dominates.

### When NOT to optimize

If each job does meaningful work (>10us), spawn overhead is amortized. Don't pool prematurely.

---

## Opt 2: Reuse Closures, Not Goroutines

Each `go func() { ... }()` allocates the closure on the heap. For high spawn rates, allocation is a measurable cost.

### Baseline

```go
for _, item := range items {
    go func() {
        process(item)
    }()
}
```

Each iteration allocates a fresh closure. Plus the captured loop variable bug (pre-1.22).

### Optimized

```go
go func(items []Item) {
    for _, item := range items {
        process(item)
    }
}(items)
```

One goroutine, one closure. Sequential iteration is often fine if items don't need true concurrency.

If you do need concurrency:

```go
items := splitChunks(items, 8)
for _, chunk := range items {
    chunk := chunk
    go func() {
        for _, item := range chunk {
            process(item)
        }
    }()
}
```

One goroutine per chunk, not per item.

---

## Opt 3: Shrink Stack Size for Long-Lived Workers

Long-lived worker goroutines may have grown stacks (e.g., to 4 KB or 8 KB) due to deep recursion or large local variables. Even after the call stack shrinks, the runtime keeps the larger stack until certain triggers (next stack growth, GC).

### Baseline

A worker that occasionally calls a deep function:

```go
func (w *Worker) run() {
    for j := range w.jobs {
        if j.IsRare {
            deepRecursion(j) // grows the stack to 16 KB
        } else {
            quickProcess(j)
        }
    }
}
```

After one rare job, the stack is 16 KB for the lifetime of the worker.

### Optimized

Run the rare path in a dedicated goroutine:

```go
func (w *Worker) run() {
    for j := range w.jobs {
        if j.IsRare {
            go deepRecursion(j) // its own short-lived goroutine
        } else {
            quickProcess(j)
        }
    }
}
```

Or accept the cost: each worker has a 16 KB stack, but you have 16 workers, not a million. Trade off based on absolute numbers.

`runtime.Stack` can show you the stack size in `pprof`'s extended views.

---

## Opt 4: Reduce `_Gwaiting` Time

A goroutine in `_Gwaiting` holds memory and pins references. Reduce wait time:

### Baseline

```go
func worker(ctx context.Context, ch <-chan Job) {
    for {
        select {
        case <-ctx.Done():
            return
        case j := <-ch:
            process(j)
        }
    }
}
```

If `ch` is rarely fed, the worker waits most of the time. Its stack and closure are pinned.

### Optimized

If feed rate is low and bursty, scale the pool dynamically:

```go
func dispatcher(ctx context.Context, jobs <-chan Job) {
    sem := make(chan struct{}, 8) // max 8 concurrent workers
    for {
        select {
        case <-ctx.Done():
            return
        case j := <-jobs:
            sem <- struct{}{}
            go func() {
                defer func() { <-sem }()
                process(j)
            }()
        }
    }
}
```

Workers are spawned on demand. When idle, no goroutines wait. Semaphore caps concurrency.

This trades spawn cost (some per-job) for memory savings (none idle). Best for low-rate, bursty workloads.

---

## Opt 5: Replace `time.Tick` with a Long-Lived Ticker

`time.Tick` is convenient but creates an unstoppable runtime timer. Repeated `Tick` calls add up.

### Baseline

```go
func heartbeat(ctx context.Context) {
    for {
        for t := range time.Tick(time.Second) {
            sendHeartbeat(t)
            if ctx.Err() != nil {
                return
            }
        }
    }
}
```

Every entry to the inner loop creates a new timer that never stops. Even though the outer loop tries to exit, the timer leaks.

### Optimized

```go
func heartbeat(ctx context.Context) {
    ticker := time.NewTicker(time.Second)
    defer ticker.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case t := <-ticker.C:
            sendHeartbeat(t)
        }
    }
}
```

One ticker for the whole lifecycle. `Stop()` releases the runtime timer goroutine.

---

## Opt 6: Batch Spawns

If you spawn many short-lived goroutines, spawn rate matters. Each `go` involves runtime work — locking the per-P run queue, possibly waking an M.

### Baseline

```go
for _, item := range items {
    go process(item)
}
```

For 1M items, that's 1M `go` calls.

### Optimized

Fan out by `GOMAXPROCS`, each goroutine processing many items:

```go
n := runtime.GOMAXPROCS(0)
chunks := splitN(items, n)
var wg sync.WaitGroup
for _, chunk := range chunks {
    chunk := chunk
    wg.Add(1)
    go func() {
        defer wg.Done()
        for _, item := range chunk {
            process(item)
        }
    }()
}
wg.Wait()
```

Only `n` goroutines, each long enough to amortize startup. CPU utilization is the same; lifecycle overhead is `O(GOMAXPROCS)` instead of `O(N)`.

---

## Opt 7: Nil Out References Before Long Waits

A goroutine's stack and closure are GC roots. Anything reachable from them is pinned.

### Baseline

```go
func processAfterDelay(bigData []byte, delay time.Duration) {
    time.Sleep(delay)
    save(bigData)
}

go processAfterDelay(blob, time.Hour) // blob pinned for an hour
```

During the hour-long sleep, `blob` is alive.

### Optimized

If you can do the work *before* the wait:

```go
func processWithDelayedReport(blob []byte, delay time.Duration) {
    intermediate := transform(blob)
    blob = nil // GC can now reclaim
    time.Sleep(delay)
    save(intermediate)
}
```

Or restructure: persist `blob` to disk, sleep, reload smaller form.

### When it matters

This is a real production pattern for jobs that "do work later." If `blob` is 10 MB and you have 1000 deferred jobs, that is 10 GB of pinned memory.

---

## Opt 8: Bound Goroutine Count

An unbounded goroutine count is a DoS vector and a memory blow-up. Always cap.

### Baseline

```go
http.HandleFunc("/work", func(w http.ResponseWriter, r *http.Request) {
    go doWork(r.Body) // unbounded
    w.Write([]byte("queued"))
})
```

100k concurrent requests spawn 100k goroutines.

### Optimized

```go
var sem = make(chan struct{}, 256) // max 256 concurrent

http.HandleFunc("/work", func(w http.ResponseWriter, r *http.Request) {
    select {
    case sem <- struct{}{}:
        go func() {
            defer func() { <-sem }()
            doWork(r.Body)
        }()
        w.Write([]byte("queued"))
    default:
        http.Error(w, "busy", http.StatusServiceUnavailable)
    }
})
```

Or use a proper queue with a worker pool — the right tool for sustained load.

---

## Opt 9: Pool Reusable Goroutines

The `g` free list reuses dead goroutines' `g` structs but not their stacks beyond a certain size or their closures. For maximum reuse, use *worker pools*.

```go
type Pool struct {
    jobs chan func()
    wg   sync.WaitGroup
}

func NewPool(n int) *Pool {
    p := &Pool{jobs: make(chan func(), 1024)}
    for i := 0; i < n; i++ {
        p.wg.Add(1)
        go func() {
            defer p.wg.Done()
            for fn := range p.jobs {
                fn()
            }
        }()
    }
    return p
}

func (p *Pool) Submit(fn func()) {
    p.jobs <- fn
}

func (p *Pool) Close() {
    close(p.jobs)
    p.wg.Wait()
}
```

Hot path: zero spawn. The workers live forever (until `Close`), so their `g` structs and stacks are reused infinitely.

Benchmark:

```go
func BenchmarkPool_HotPath(b *testing.B) {
    p := NewPool(runtime.GOMAXPROCS(0))
    var done sync.WaitGroup
    for i := 0; i < b.N; i++ {
        done.Add(1)
        p.Submit(func() {
            defer done.Done()
            // ... tiny work ...
        })
    }
    done.Wait()
    p.Close()
}
```

Typical: 2-5x faster than spawn-per-job for sub-microsecond work, equivalent for >10us work.

---

## Opt 10: Move Cleanup Off the Critical Path

A goroutine that does expensive cleanup before death extends its lifecycle. If cleanup is non-essential, defer it.

### Baseline

```go
func worker(ctx context.Context, w *Worker) {
    defer w.flushMetrics()      // 50ms
    defer w.closeConnections()  // 100ms
    defer w.persistState()      // 200ms
    for {
        select {
        case <-ctx.Done():
            return
        case j := <-w.jobs:
            process(j)
        }
    }
}
```

When `ctx` is canceled, the goroutine spends ~350 ms in cleanup. Other goroutines waiting on this one (via `wg.Wait`) wait too.

### Optimized

Decouple cleanup from worker lifecycle:

```go
func worker(ctx context.Context, w *Worker) {
    defer close(w.exited)
    for {
        select {
        case <-ctx.Done():
            return
        case j := <-w.jobs:
            process(j)
        }
    }
}

// Separate cleanup goroutine
go func() {
    <-w.exited
    w.flushMetrics()
    w.closeConnections()
    w.persistState()
    close(w.cleanupDone)
}()
```

`w.exited` signals "the work is done"; the cleanup runs independently. The parent can wait on `cleanupDone` only if it actually needs the cleanup synchronously.

---

## Measuring Lifecycle Costs

### Counting spawns

```go
import "runtime"

func main() {
    var stats runtime.MemStats
    runtime.ReadMemStats(&stats)
    fmt.Println("alloc:", stats.Alloc)

    // ... do work ...

    runtime.ReadMemStats(&stats)
    fmt.Println("alloc:", stats.Alloc)
}
```

`Alloc` reflects allocation pressure, which includes closures. If `Alloc` rises after a workload, your goroutines may be allocating closures unnecessarily.

### Tracking `g` allocations

The runtime exposes (via `GODEBUG=gctrace=1`) information about GC and (via `GODEBUG=schedtrace=1000`) about scheduler activity. Use to spot anomalies:

```
sched: gomaxprocs=8 idleprocs=0 threads=12 spinningthreads=0 idlethreads=4 runqueue=0 [0 0 1 0 5 0 0 0]
```

Big runqueue numbers indicate spawn-bursts.

### `runtime/trace`

Run a workload with `trace.Start/Stop`. Open `go tool trace`. The "Goroutines" view shows:

- Number of goroutines over time.
- Spawn rate.
- Wait reasons distribution.

The dominant wait reason tells you where lifecycle is dominated. If "chan receive" dominates, your goroutines wait too much; if "GoStart" dominates, your spawn rate is too high.

### Benchmark template

```go
func BenchmarkLifecycle(b *testing.B) {
    b.ReportAllocs()
    for i := 0; i < b.N; i++ {
        done := make(chan struct{})
        go func() {
            close(done)
        }()
        <-done
    }
}
```

Typical output:

```
BenchmarkLifecycle-8  3000000  450 ns/op  16 B/op  1 allocs/op
```

The 16 B / 1 alloc is the closure. Eliminating it (e.g., by passing a function value) can cut allocation pressure.

---

## Summary

Goroutine lifecycle optimization is rarely the first bottleneck — but at scale (100k+ goroutines/s, millions of long-lived workers), it dominates. The patterns:

1. **Pool instead of spawn** for hot paths.
2. **One goroutine per chunk**, not per item.
3. **Tickers, not `time.Tick`** for periodic work.
4. **Bound concurrency** with semaphores or pools.
5. **Nil out big references** before long waits.
6. **Decouple cleanup** from worker lifecycle when possible.
7. **Measure with `runtime/trace`** before optimizing — intuition deceives.

Verify each optimization preserves correctness with leak tests (`goleak`) and race detection (`-race`). Premature optimization of lifecycle is no different from any other premature optimization — measure, target the hot path, and beware of complexity creep.

See [02-detecting-leaks](../02-detecting-leaks/) for the diagnostic toolbox and [03-preventing-leaks](../03-preventing-leaks/) for patterns that combine correctness with efficiency.
