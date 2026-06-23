---
layout: default
title: Interview
parent: Unlimited Goroutines
grand_parent: Concurrency Anti-Patterns
ancestor: Go
nav_order: 6
permalink: /roadmap/programming-languages/golang/07-concurrency/15-concurrency-anti-patterns/01-unlimited-goroutines/interview/
---

# Unlimited Goroutines — Interview Questions

> Graded questions covering junior to staff level. Each has a model answer, common wrong answers, code-trace where applicable, and follow-ups.

---

## Junior

### Q1. What is wrong with this code?

```go
func ProcessAll(items []Item) {
    for _, item := range items {
        go func(i Item) {
            process(i)
        }(item)
    }
}
```

**Model answer.** Two problems. First, the function spawns a goroutine for every item without bounding the count — at large `items`, this exhausts memory. Second, `ProcessAll` returns immediately while the spawned goroutines are still running; if the caller assumed the work was done when `ProcessAll` returned, the caller is wrong.

**Common wrong answers.**
- "The loop variable capture bug." (No — the function takes `i` as a parameter, so each goroutine has its own copy.)
- "It returns the wrong error." (No errors are returned at all; that's a separate issue but not the main bug.)
- "Should use channels." (Channels alone don't fix this; bounded spawning does.)

**Follow-up.** *Fix it.* — Use `errgroup.WithContext` with `SetLimit`:

```go
func ProcessAll(ctx context.Context, items []Item) error {
    g, gctx := errgroup.WithContext(ctx)
    g.SetLimit(64)
    for _, item := range items {
        item := item
        g.Go(func() error { return process(gctx, item) })
    }
    return g.Wait()
}
```

---

### Q2. What does this print?

```go
package main

import "fmt"

func main() {
    for i := 0; i < 5; i++ {
        go fmt.Println(i)
    }
}
```

**Model answer.** On most Go versions, this prints nothing or only a partial output, because `main` returns before the goroutines have a chance to run. When `main` returns, the program exits, killing all goroutines.

**Common wrong answer.**
- "Prints 0 1 2 3 4." (Order may not be sequential, and it likely prints nothing because of the race with `main` exiting.)

**Follow-up.** *How would you make it always print all five numbers?* — Use `sync.WaitGroup`:

```go
var wg sync.WaitGroup
for i := 0; i < 5; i++ {
    wg.Add(1)
    go func(i int) {
        defer wg.Done()
        fmt.Println(i)
    }(i)
}
wg.Wait()
```

---

### Q3. Why is "goroutines are cheap" misleading?

**Model answer.** Goroutines themselves cost ~2 KB initial stack and a few hundred bytes of bookkeeping. That is cheap. But each goroutine often holds a downstream resource — a database connection, a TCP socket, a file descriptor, an in-memory buffer — that is far more expensive. The real cost of "a million goroutines" is rarely the goroutines themselves; it is the million resources they hold.

**Common wrong answer.**
- "Because they cost a lot of CPU." (CPU cost is small; resource cost is large.)

**Follow-up.** *Give a specific example where this matters.* — A web crawler: each goroutine holds a TCP connection. With 100k goroutines, you hit FD limits (default 65k) before memory issues.

---

### Q4. What's the difference between `sync.WaitGroup` and `errgroup.Group`?

**Model answer.** `WaitGroup` is a counter that supports Add, Done, Wait. It does not aggregate errors or propagate cancellation. `errgroup.Group` wraps a WaitGroup, additionally:
- Aggregates the first error from any goroutine.
- Cancels a shared context when any goroutine errors.
- Supports `SetLimit` for bounded concurrency.

**Common wrong answer.**
- "errgroup is a WaitGroup with extra methods." (Approximately true but missing the cancellation and limit features.)

**Follow-up.** *When would you use WaitGroup directly?* — When you genuinely don't need error aggregation or cancellation — for instance, fire-and-forget work where you only need to know "are they all done."

---

### Q5. Is this safe?

```go
func handler(w http.ResponseWriter, r *http.Request) {
    go cleanup()
    w.WriteHeader(http.StatusOK)
}
```

**Model answer.** It is incorrect, not just unsafe. The handler returns before `cleanup` finishes. If `cleanup` references `r` or `w`, it may access already-freed resources. Even if it doesn't, every request spawns a goroutine; under load, these accumulate, and if `cleanup` ever blocks, you have a leak.

**Common wrong answer.**
- "It's fine because Go has a garbage collector." (GC doesn't help with leaked goroutines.)
- "It's a fire-and-forget pattern, that's idiomatic." (Fire-and-forget needs a bound.)

**Follow-up.** *How would you fix it?* — Push the cleanup work to a bounded background pool:

```go
var cleanupPool = pool.New(16, 1024)

func handler(w http.ResponseWriter, r *http.Request) {
    if !cleanupPool.TrySubmit(cleanupJob{...}) {
        cleanupSync()
    }
    w.WriteHeader(http.StatusOK)
}
```

---

### Q6. What is `runtime.NumGoroutine()` and how do you use it?

**Model answer.** It returns the current count of live goroutines in the process. It's useful for monitoring (export as a metric) and for testing (assert no leaks). In production, alert on it growing without bound; in tests, assert it returns to baseline after work completes.

**Common wrong answer.**
- "It's a debug tool only." (It's also a production metric.)

**Follow-up.** *Why is it not perfectly precise?* — It samples a counter that the runtime updates non-atomically with state transitions; goroutines in transition (just spawned, just exited) may or may not be counted.

---

## Middle

### Q7. What does `errgroup.SetLimit(0)` do?

**Model answer.** It panics — actually, it makes `Go` deadlock. The implementation uses a buffered channel of capacity `n`; with `n=0`, the channel is unbuffered, and the send in `Go` blocks forever because no goroutine is waiting to receive. Effectively, calling `SetLimit(0)` is a bug. The documentation does not specify zero as a valid value.

**Common wrong answer.**
- "It means unlimited." (No; that's `SetLimit(-1)` or not calling SetLimit at all.)
- "It runs sequentially." (No; it deadlocks.)

**Follow-up.** *How does SetLimit communicate the limit internally?* — Via a `chan token` with capacity n. `Go` does `g.sem <- token{}` (blocks if full). The goroutine does `<-g.sem` in defer.

---

### Q8. Trace this code and identify the bug.

```go
func ProcessBatch(ctx context.Context, items []Item) error {
    sem := semaphore.NewWeighted(64)
    var wg sync.WaitGroup
    for _, item := range items {
        wg.Add(1)
        if err := sem.Acquire(ctx, 1); err != nil {
            wg.Done()
            return err
        }
        item := item
        go func() {
            defer wg.Done()
            defer sem.Release(1)
            process(item)
        }()
    }
    wg.Wait()
    return nil
}
```

**Model answer.** Several issues:

1. **Errors from `process` are silently discarded.** No error aggregation.
2. **`wg.Done()` on the error path is correct but easy to forget.** A cleaner pattern uses errgroup which handles WaitGroup internally.
3. **The release in defer is correct.** But coupling Acquire to the loop and Release to the goroutine is fragile — if the goroutine doesn't start (e.g., the loop exits before `go` is reached), the semaphore is leaked.

A more robust version uses `errgroup.WithContext` with `SetLimit(64)`:

```go
g, gctx := errgroup.WithContext(ctx)
g.SetLimit(64)
for _, item := range items {
    item := item
    g.Go(func() error { return process(gctx, item) })
}
return g.Wait()
```

**Common wrong answers.**
- "The bug is missing context propagation." (Almost true — process is passed item but not ctx.)
- "The bug is the loop variable." (Not in Go 1.22+; and the explicit `item := item` shadow handles it anyway.)

**Follow-up.** *Why is errgroup preferable here?* — It composes the three concerns (limiting, error aggregation, context cancellation) into one primitive; less error-prone.

---

### Q9. Explain Little's Law and how it applies to bound sizing.

**Model answer.** Little's Law: L = λW, where L is the in-flight count, λ is the arrival rate (requests per second), and W is the mean time in the system (latency). For sizing, if you know the target λ and measure W, you derive the required L. Example: 1000 RPS × 100ms latency = 100 in-flight required.

**Common wrong answer.**
- "It's about queue length." (It applies to any system, not just queues.)

**Follow-up.** *Why use p99 latency instead of mean?* — Mean ignores the tail; p99 reflects the worst case you must handle. Sizing for the mean leaves you queueing during tail events.

---

### Q10. What happens to a goroutine that calls `time.Sleep(time.Hour)`?

**Model answer.** The goroutine is parked. Internally, it goes through `time.Sleep` → `runtime.timeSleep` → `gopark`, with a timer scheduled to wake it. The goroutine consumes its stack and the timer entry; it does not consume an OS thread (the timer wakeup is handled by the runtime). The goroutine remains live (counts in `NumGoroutine`) and is not GC-eligible.

**Common wrong answer.**
- "It blocks an OS thread." (Sleep does not consume an M; the runtime parks the goroutine.)
- "It's GC'd." (It's not; it's still referenced.)

**Follow-up.** *What if you sleep for an hour and the program exits before then?* — `main` returning kills all goroutines; the sleeper terminates immediately along with the rest of the program.

---

### Q11. Why is `for { go work() }` worse than `for _, x := range items { go work(x) }`?

**Model answer.** The first is infinitely fanning out — there's no upper bound on iterations. The second is bounded by `len(items)`. Both are anti-patterns if the bound is too large or unbounded by input. The first is a *bug* in almost all cases; the second is a *risk* depending on input size.

**Common wrong answer.**
- "They're the same problem." (They are kindred but the first is qualitatively worse — no input bound at all.)

**Follow-up.** *When could the first be correct?* — Almost never. One legitimate case: an event loop in a service whose only job is to spawn goroutines, with an explicit `break` or `return` on a stop signal.

---

### Q12. Explain the difference between blocking and dropping on a full channel.

**Model answer.** Blocking send: `ch <- v` waits until there's space; the producer is naturally stalled. Dropping: `select { case ch <- v: default: drop() }` skips the send; the producer continues but loses the value. Blocking creates end-to-end backpressure; dropping creates a hard cap on memory but loses work. Blocking is the right default; dropping is correct for stale-tolerant work (e.g. metric updates).

**Common wrong answer.**
- "Dropping is always bad." (It's correct in specific cases.)

**Follow-up.** *Give an example where dropping is correct.* — Real-time price ticks to a UI: a new tick supersedes the previous one. Dropping the old one is correct.

---

### Q13. What's wrong with this retry pattern?

```go
for _, item := range items {
    go func(item Item) {
        for attempt := 0; attempt < 3; attempt++ {
            if err := tryItem(item); err == nil { return }
            time.Sleep(time.Second)
        }
    }(item)
}
```

**Model answer.** Two problems. First, unbounded fan-out (one goroutine per item). Second, when downstream fails, every goroutine sleeps `1 + 1 + 1 = 3 seconds`, accumulating; during that time, all are alive. The retry sleep keeps the goroutines holding their resources without doing work.

**Common wrong answer.**
- "The retries should be exponential." (Yes, but that's a separate improvement; the bound is the primary issue.)

**Follow-up.** *How would you fix both?*

```go
sem := semaphore.NewWeighted(32)
for _, item := range items {
    item := item
    go func() {
        for attempt := 0; attempt < 3; attempt++ {
            if err := sem.Acquire(ctx, 1); err != nil { return }
            err := tryItem(ctx, item)
            sem.Release(1)
            if err == nil { return }
            backoff := time.Duration(1<<attempt) * time.Second
            jitter := time.Duration(rand.Intn(1000)) * time.Millisecond
            time.Sleep(backoff + jitter)
        }
    }()
}
```

The semaphore is released during sleep; only the retry attempts hold a slot.

---

### Q14. What is `golang.org/x/sync/singleflight` and when do you use it?

**Model answer.** `singleflight` deduplicates concurrent calls with the same key. When N callers request the same key simultaneously, only one underlying call is made; all callers receive the same result. Use case: cache stampede prevention — when a cache expires and 1000 concurrent requests all try to refresh the cache, singleflight ensures only one does the refresh.

**Common wrong answer.**
- "It's a rate limiter." (No; rate limiting is per-time-window; singleflight is per-key dedup.)

**Follow-up.** *How does it bound goroutines?* — It doesn't directly. It dedups *work*, not *goroutines*. But it can be combined with other primitives to reduce load.

---

### Q15. What's the issue with this Kafka consumer?

```go
for {
    msg, err := consumer.ReadMessage(ctx)
    if err != nil { return }
    go process(msg)
}
```

**Model answer.** Unbounded fan-out: when Kafka delivers messages faster than `process` can keep up (especially on consumer-group rebalance, when there is lag), goroutines accumulate without bound. Each goroutine holds the message in memory; aggregate memory grows; eventually OOM.

**Common wrong answer.**
- "It's fine because Kafka acks." (Kafka acking is async; the consumer doesn't ack until process completes.)

**Follow-up.** *Fix it.*

```go
pool := pool.New(pool.Config{Workers: 32, QueueDepth: 1024})
pool.Start(ctx)
for {
    msg, err := consumer.ReadMessage(ctx)
    if err != nil { return }
    if err := pool.Submit(ctx, processJob{msg: msg}); err != nil { return }
}
```

The `Submit` blocks when the pool is full, slowing the consumer loop. Kafka's offset commit lags, signalling backpressure to Kafka.

---

## Senior

### Q16. Design an HTTP handler that enriches a request by calling 5 backends in parallel. Each backend has its own connection-pool cap. The service handles 200 concurrent requests.

**Model answer.** Three bound tiers needed:

1. Admission: 200 concurrent requests max.
2. Per-request fan-out: 5 concurrent backend calls (one per backend).
3. Per-backend: each backend's connection-pool cap (let's say 50 for each).

Implementation:

```go
type Service struct {
    requests *semaphore.Weighted          // global admission
    backends []*Backend                   // 5 entries
}

type Backend struct {
    sem *semaphore.Weighted
    cli HTTPClient
}

func (s *Service) Handle(ctx context.Context, req Request) (Response, error) {
    if !s.requests.TryAcquire(1) {
        return Response{}, ErrOverloaded
    }
    defer s.requests.Release(1)

    g, gctx := errgroup.WithContext(ctx)
    g.SetLimit(5) // matches len(backends); avoids unnecessary spawn delay

    results := make([]BackendResult, len(s.backends))
    for i, b := range s.backends {
        i, b := i, b
        g.Go(func() error {
            if err := b.sem.Acquire(gctx, 1); err != nil { return err }
            defer b.sem.Release(1)
            r, err := b.cli.Do(gctx, req)
            if err != nil { return err }
            results[i] = r
            return nil
        })
    }
    if err := g.Wait(); err != nil { return Response{}, err }
    return aggregate(results), nil
}
```

**Common wrong answers.**
- Forgetting per-backend cap (only relying on transport-level).
- Forgetting admission (only relying on per-request fan-out).

**Follow-up.** *What's the max simultaneous outbound calls in the system?* — 200 requests × 5 backends = 1000 calls in flight; but each backend has cap 50, so effective limit is min(200, 50×5)=250. The backend caps are the real bound.

---

### Q17. Trace this code. What's the bug?

```go
func Walk(dir string) {
    entries, _ := os.ReadDir(dir)
    for _, e := range entries {
        if e.IsDir() {
            go Walk(filepath.Join(dir, e.Name()))
        }
    }
}
```

**Model answer.** Recursive unbounded fan-out. Each directory spawns a goroutine per subdirectory. The fan-out is exponential in tree depth. For a tree with 1000 directories at each of 5 levels, ~10^15 goroutines could be spawned. Even small trees can produce thousands of goroutines.

Other issues:
- No synchronisation: the caller cannot tell when Walk completes.
- Errors are discarded.

Fix: use a shared semaphore plus a wait group, or convert to iterative BFS:

```go
type Walker struct {
    sem *semaphore.Weighted
    wg  sync.WaitGroup
}

func (w *Walker) Walk(ctx context.Context, dir string) {
    w.wg.Add(1)
    go func() {
        defer w.wg.Done()
        if err := w.sem.Acquire(ctx, 1); err != nil { return }
        defer w.sem.Release(1)
        entries, _ := os.ReadDir(dir)
        for _, e := range entries {
            if e.IsDir() {
                w.Walk(ctx, filepath.Join(dir, e.Name()))
            }
        }
    }()
}
```

**Common wrong answer.**
- "The issue is `os.ReadDir` could fail." (True but a smaller concern.)

**Follow-up.** *Why is recursion particularly dangerous for fan-out?* — Each recursive call may spawn more goroutines; the total fan-out is the product across the recursion depth. Iterative work-queue patterns avoid this.

---

### Q18. Explain how `goleak` detects leaks. What's `IgnoreCurrent`?

**Model answer.** `goleak.VerifyTestMain(m)` runs after the test suite. It calls `pprof.Lookup("goroutine")` to get all live stacks, filters out known-benign stacks (e.g. `testing.(*M).Run` system goroutines), and fails the suite if any goroutines remain.

`IgnoreCurrent` is a snapshot taken at the time of the call (e.g. in `TestMain`); it records all goroutines alive at that moment as "expected." Any new goroutine after that point that is alive at suite end is a leak. Useful when your program has long-lived goroutines started before tests run (loggers, metric exporters).

**Common wrong answer.**
- "It runs a Goroutine count check." (It checks the count and the *stacks*.)

**Follow-up.** *What other configuration options exist?* — `IgnoreTopFunction(name)` filters by function at the top of the stack; `Cleanup(...)` for custom cleanup; configurable retry interval; configurable max retries.

---

### Q19. Your service has 50 pods; pod-27 has growing goroutine count while others are flat. Diagnose.

**Model answer.** Several diagnostic steps:

1. **Confirm the discrepancy.** Inspect Prometheus: `process_goroutines{pod="pod-27"}` vs the rest.
2. **Capture pprof.** `kubectl exec pod-27 -- curl localhost:6060/debug/pprof/goroutine?debug=1 > go.txt`. Look for stacks with high counts.
3. **Diff against a healthy pod.** `kubectl exec pod-30 -- curl localhost:6060/debug/pprof/goroutine?debug=1 > go30.txt`. Diff: what stacks are present on 27 but not 30?
4. **Check inbound load.** Is pod-27 receiving more traffic? Check load balancer logs.
5. **Check the goroutines' wait reasons.** Use `debug=2` for wait reasons. "chan receive" or "select" with long durations indicates leaks.
6. **Check downstream calls.** Are pod-27's downstream calls slower? Maybe one downstream pod is slow.
7. **Memory inspection.** Compare `process_resident_memory_bytes`. If memory is also growing, the goroutines hold heap data.
8. **Container restart.** If diagnosis is unclear and the pod is degrading, restart it. Save profiles first for postmortem.

**Common wrong answer.**
- "Just restart pod-27." (Acceptable as a mitigation but not diagnosis.)

**Follow-up.** *What if all pods are healthy after restart but the issue recurs daily at the same time?* — Likely a periodic batch trigger. Check cron jobs, timer-driven tasks. The "same time daily" is a strong hint.

---

### Q20. Design a bounded background task pool for a service that needs to drain cleanly on shutdown.

**Model answer.** Production worker pool with Start, Submit, and Shutdown:

```go
type Pool struct {
    workers int
    in      chan Job
    wg      sync.WaitGroup
    stop    chan struct{}
    stopOnce sync.Once
}

func New(workers, queue int) *Pool {
    return &Pool{
        workers: workers,
        in:      make(chan Job, queue),
        stop:    make(chan struct{}),
    }
}

func (p *Pool) Start() {
    for i := 0; i < p.workers; i++ {
        p.wg.Add(1)
        go func() {
            defer p.wg.Done()
            for {
                select {
                case <-p.stop:
                    return
                case j, ok := <-p.in:
                    if !ok { return }
                    j()
                }
            }
        }()
    }
}

func (p *Pool) Submit(j Job) bool {
    select {
    case <-p.stop:
        return false
    case p.in <- j:
        return true
    }
}

func (p *Pool) Shutdown(ctx context.Context) error {
    p.stopOnce.Do(func() {
        close(p.in)
    })
    done := make(chan struct{})
    go func() { p.wg.Wait(); close(done) }()
    select {
    case <-done:
        return nil
    case <-ctx.Done():
        close(p.stop)
        <-done
        return ctx.Err()
    }
}
```

Two-phase shutdown: close `in` (graceful), wait for workers; if context expires, close `stop` (hard).

**Common wrong answers.**
- Forgetting the `stop` channel for hard shutdown.
- Not making Shutdown idempotent.

**Follow-up.** *How do you handle panicking jobs?* — Wrap job execution in a deferred recover:

```go
func (p *Pool) run(j Job) {
    defer func() {
        if r := recover(); r != nil {
            log.Printf("panic in job: %v", r)
        }
    }()
    j()
}
```

---

### Q21. Compare `errgroup.SetLimit` vs `semaphore.Weighted` vs a `chan struct{}` semaphore.

**Model answer.**

- **`errgroup.SetLimit`**: counting only (unit weight); combines limit with error aggregation and context cancellation; the simplest for per-call fan-out.
- **`semaphore.Weighted`**: weighted tokens (1, 8, 100, etc.); FIFO fairness; separate from error handling; useful when items have different costs.
- **`chan struct{}`**: counting only; no FIFO guarantee beyond Go's channel runtime (which is FIFO); zero dependencies; most lightweight.

Use errgroup for per-call fan-out where you want unified error/limit/ctx. Use weighted semaphore when token costs differ. Use chan struct{} when you want a simple primitive without library overhead.

**Common wrong answer.**
- "They're all the same." (Functionally similar; semantically different.)

**Follow-up.** *Implementation of errgroup's limit?* — `chan token` with capacity n; `Go` does `g.sem <- token{}` (blocks); spawned goroutine receives in defer.

---

### Q22. A junior on your team wrote `go func() { time.Sleep(5*time.Minute); s3.PutObject(...) }()` to delay an upload. What do you do in code review?

**Model answer.** Reject the PR. Issues:

1. Fire-and-forget: no error handling.
2. No bound: each request spawns one of these, and the goroutines accumulate for 5 minutes.
3. `s3.PutObject` may fail; nothing catches it.
4. No way to cancel: if the request that triggered it is cancelled, the upload still happens.

Suggest:
- Use a scheduled task system (e.g., a job queue with a deferred execution feature).
- Or a bounded background pool with delayed-execution support.

Explain why the pattern is dangerous. Pair with the junior to refactor.

**Common wrong answer.**
- "Approve with a comment to monitor goroutine count." (Approval rewards bad patterns.)

**Follow-up.** *What if the junior protests "it's just a tiny goroutine"?* — Walk through the math: 100 RPS × 5 min = 30 000 in-flight goroutines holding S3 client connections. The "tiny" assumption breaks at scale.

---

### Q23. Design a per-tenant concurrency limit for a multi-tenant SaaS.

**Model answer.** Per-tenant semaphores with garbage collection for idle tenants:

```go
type TenantPool struct {
    mu       sync.RWMutex
    sems     map[string]*semaphore.Weighted
    limit    int64
    sweep    *time.Ticker
}

func New(limit int64) *TenantPool {
    tp := &TenantPool{
        sems:  make(map[string]*semaphore.Weighted),
        limit: limit,
        sweep: time.NewTicker(time.Hour),
    }
    go tp.sweeper()
    return tp
}

func (tp *TenantPool) Acquire(ctx context.Context, tenant string) error {
    return tp.sem(tenant).Acquire(ctx, 1)
}

func (tp *TenantPool) Release(tenant string) {
    tp.sem(tenant).Release(1)
}

func (tp *TenantPool) sem(tenant string) *semaphore.Weighted {
    tp.mu.RLock()
    s, ok := tp.sems[tenant]
    tp.mu.RUnlock()
    if ok { return s }
    tp.mu.Lock()
    defer tp.mu.Unlock()
    if s, ok := tp.sems[tenant]; ok { return s }
    s = semaphore.NewWeighted(tp.limit)
    tp.sems[tenant] = s
    return s
}

func (tp *TenantPool) sweeper() {
    for range tp.sweep.C {
        tp.mu.Lock()
        for k, s := range tp.sems {
            if s.TryAcquire(tp.limit) {
                s.Release(tp.limit)
                delete(tp.sems, k)
            }
        }
        tp.mu.Unlock()
    }
}
```

Each tenant gets `limit` in-flight; idle tenants are GC'd hourly.

**Common wrong answer.**
- "One semaphore for all tenants." (Doesn't isolate them.)
- "No GC of the map." (Leaks tenant entries forever.)

**Follow-up.** *Premium tenants get more capacity. How?* — Make `limit` per-tenant: `tp.sem(tenant)` looks up the limit (perhaps from a config) and constructs a semaphore of that size.

---

### Q24. What is end-to-end backpressure and how do you implement it?

**Model answer.** End-to-end backpressure means a slow consumer signals the producer all the way back to the source, rather than dropping or queueing unboundedly. Implementation: bounded channels between stages. When a downstream stage is slow, its input channel fills; the upstream stage's send blocks; that stage's input fills; backpressure propagates upstream until the source stops producing (or a TCP-level signal slows the network).

```go
// 3-stage pipeline with backpressure
stage1 := make(chan A, 10)  // bounded buffers create backpressure
stage2 := make(chan B, 10)

go produce(stage1)            // writes to stage1; blocks when full
go transform(stage1, stage2)  // reads stage1, writes stage2; both block
go consume(stage2)            // reads stage2; slow consumer causes propagation
```

**Common wrong answer.**
- "Backpressure means rate-limiting the producer." (Not exactly; backpressure is *reactive*, signalled by downstream slowness.)

**Follow-up.** *What if you can't slow the source (e.g. it's an HTTP request)?* — Apply admission control at the HTTP entry; reject excess requests. Or buffer with a hard cap; reject above cap.

---

### Q25. How do circuit breakers help with the unbounded-goroutines problem?

**Model answer.** Without a circuit breaker, when a downstream is slow or failing, every call goroutine times out (waits the full timeout before failing). Hundreds of goroutines accumulate, each holding resources. With a breaker, after a threshold of failures, the breaker opens; subsequent calls fail immediately, no goroutine spawn needed. The breaker effectively provides zero-concurrency for calls to a known-failing dependency.

But: the breaker doesn't help if the original fan-out is unbounded. You still spawn N goroutines; they each fail fast via the breaker; you still consumed N goroutine creations. Combine breaker with bounded fan-out.

**Common wrong answer.**
- "Circuit breakers replace the need for bounds." (No; they complement.)

**Follow-up.** *What's the half-open state?* — Periodically allow a few trial calls. If they succeed, the breaker closes (normal operation); if they fail, it reopens.

---

## Staff

### Q26. Design a system that handles 10x traffic spikes without OOM.

**Model answer.** Multi-tier defence:

1. **Admission control at the edge.** Token bucket + concurrency cap. Reject above cap with 503 + Retry-After.
2. **Bounded fan-out at every internal call.** errgroup.SetLimit derived from downstream capacity.
3. **Per-tenant cap.** Isolate tenants; one cannot consume the whole budget.
4. **Auto-scaling.** HPA on goroutine count or in-flight requests, not just CPU. New pods come up before existing ones are overwhelmed.
5. **Graceful degradation.** Cached fallbacks for read paths; partial responses for compound endpoints.
6. **Circuit breakers.** Don't waste goroutines on failing downstream.
7. **Memory limits and GOMEMLIMIT.** Container memory limits enforced; GOMEMLIMIT set to 90% so the runtime GCs aggressively before OOM.
8. **Pre-warmed pods.** Keep some idle capacity to absorb spikes while autoscaling.
9. **Load tests** at 10x baseline regularly to validate.
10. **Monitoring** that alerts before users notice.

**Common wrong answer.**
- "More pods." (Pods alone don't help if each pod also OOMs.)

**Follow-up.** *Where does the 10x come from?* — Could be a marketing event, a celebrity tweet, a customer's batch job. Without knowing, plan for arbitrary 10x.

---

### Q27. You inherit a 500k-line codebase with hundreds of `for { go ... }` sites. How do you migrate to bounded?

**Model answer.** Multi-phase plan:

1. **Phase 1 (1 month): Inventory.** Grep, classify, prioritise.
2. **Phase 2 (3 months): Hot sites.** Fix top 10% by risk. Add tests.
3. **Phase 3 (1 month): Lint.** Custom analyser blocks new violations.
4. **Phase 4 (6 months): Burn down.** Fix remaining sites.
5. **Phase 5 (ongoing): Verify and train.** Load tests, training, code review.

Track metrics: number of fixed sites, number of remaining sites, number of incidents per quarter.

The work is mostly mechanical (apply a known pattern) but requires care:
- Each fix needs a test.
- Each bound needs a justification (load test result).
- Some sites need design changes, not just bounding.

**Common wrong answer.**
- "Rewrite from scratch." (Almost never feasible.)

**Follow-up.** *How do you sequence priorities?* — Hot path traffic + user-supplied input first. Background jobs second. Library code last (but most impactful — a fix here applies everywhere).

---

### Q28. Your service's bound is 1000 in-flight. A load test shows latency p99 increases sharply at 800 in-flight. Why?

**Model answer.** Likely contention or downstream saturation. As in-flight grows:
- Lock contention on shared mutexes increases.
- DB connection pool fills.
- GC pauses grow with goroutine count.
- Scheduler overhead grows.

At some point (in this case ~800), the marginal cost of one more in-flight is high. Latency rises sharply.

Diagnosis:
1. pprof CPU profile at 800 in-flight: look for time in lock acquisition.
2. pprof mutex profile: identify contended locks.
3. pprof block profile: identify blocking points.
4. DB stats: `WaitCount`, `WaitDuration`.
5. Compare against load at 400 in-flight: what's different.

Fix: lower the bound to 700 (below the knee). Or fix the contention (shard the mutex, increase the pool, optimise the hot path).

**Common wrong answer.**
- "The bound is wrong; raise it." (Raising worsens it.)

**Follow-up.** *What if the curve has multiple knees?* — Multiple bottlenecks. Fix the first one; the next one becomes visible. Iterate.

---

### Q29. Walk me through a real-world postmortem for an unbounded-goroutine incident.

**Model answer.** Reference Case Study 1 from the senior or professional docs:

**Incident.** SaaS webhook dispatcher. A customer added 5000 endpoints. Event volume × endpoints = 1M goroutines/s. Memory spiked from 800 MB to 32 GB in 90 seconds. OOMKilled. Rebalance cascaded across the fleet.

**Root cause.** Unbounded fan-out: `for _, ep := range endpoints { go dispatch(ep) }`. The bound was implicit in typical usage (small number of endpoints per customer).

**Detection.** Goroutine count alert fired 4 minutes into the incident. On-call paged 8 minutes in.

**Mitigation.** WAF block on the customer; service recovered after 14 minutes total.

**Fix.** Bounded with per-customer semaphore (max 64 simultaneous dispatches per customer). Global cap of 4096 dispatches across all customers.

**Action items.**
- Audit other bulk endpoints for unbounded fan-out.
- Per-customer concurrency caps as a standard pattern.
- Faster detection: per-customer fan-out metric.
- Test coverage for large inputs.

**Lessons.**
- Implicit bounds break when usage patterns change.
- One customer can take down a service if not isolated.
- Cascade is worse than the original fault.

**Common wrong answer.**
- Generic answer without specifics.

**Follow-up.** *What organizational changes would prevent recurrence?* — Per-tenant caps as a standard; concurrency contract docs; capacity reviews per quarter; concurrency-aware lint.

---

### Q30. Design a custom Prometheus metric for "fan-out factor per request" and explain its value.

**Model answer.** A histogram of "how many sub-tasks were spawned by this request":

```go
fanoutHistogram := promauto.NewHistogramVec(prometheus.HistogramOpts{
    Name:    "request_fanout_factor",
    Buckets: []float64{1, 2, 5, 10, 50, 100, 500, 1000, 5000, 10000, 50000, 100000},
}, []string{"endpoint"})

func (s *Service) Handle(w http.ResponseWriter, r *http.Request) {
    ids := parseIDs(r)
    fanoutHistogram.WithLabelValues(r.URL.Path).Observe(float64(len(ids)))
    // ... process ids in bounded fan-out
}
```

Value: outliers in this histogram identify *which endpoint takes which input* and reveal anomalies. If `/v1/bulk` typically has fan-out 1-10 but suddenly has fan-out 50 000, you have either a new use case or an attack.

**Common wrong answer.**
- "A counter would suffice." (A counter doesn't show distribution; a histogram does.)

**Follow-up.** *What alert would you build?* — Alert if p99 fan-out > 1000 for sustained period. Indicates abnormal input.

---

### Q31. What's the difference between "bound" and "budget"?

**Model answer.** A bound is a hard ceiling enforced by a primitive: "at most N goroutines." A budget is an allocation of capacity: "of the 100-goroutine total, give 50 to read traffic, 30 to write, 20 to background." A bound is enforced by code; a budget is a policy.

In a multi-tenant service, you might have:
- Global bound: 1000 in-flight.
- Tenant A budget: 100 of the 1000.
- Tenant B budget: 50.
- Etc.

Each tenant has a semaphore of their budget size. Together they cannot exceed the global bound.

**Common wrong answer.**
- "Same thing." (Conceptually related; operationally different.)

**Follow-up.** *How do you handle over-subscribed budgets?* — Don't over-subscribe: sum of budgets ≤ global bound. Or oversubscribe deliberately if you trust tenants don't all peak together.

---

### Q32. Trace this code. Is it safe? Will it leak?

```go
func WatchAll(ctx context.Context, keys []string) <-chan Event {
    out := make(chan Event)
    var wg sync.WaitGroup
    for _, k := range keys {
        k := k
        wg.Add(1)
        go func() {
            defer wg.Done()
            for ev := range watch(k) {
                select {
                case <-ctx.Done():
                    return
                case out <- ev:
                }
            }
        }()
    }
    go func() {
        wg.Wait()
        close(out)
    }()
    return out
}
```

**Model answer.** Mostly correct but has subtle issues:

1. **`watch(k)` likely returns an infinite channel.** If `ctx` is cancelled, the goroutine exits its select but does *not* close the `watch` channel. The watch goroutine (inside `watch(k)`) may continue running.

2. **Backpressure missing.** If `out` is unbuffered and the consumer is slow, `out <- ev` blocks. If consumer stops reading, the goroutines block. If `ctx` is then cancelled, they exit via the select — OK. But during the blocking period, events accumulate inside `watch`.

3. **No bound on keys.** If `len(keys)` is 1 million, you spawn 1 million goroutines.

**Common wrong answer.**
- "It's fine because of context." (Context only helps if you cancel; resources held meanwhile are unbounded.)

**Follow-up.** *Fix it.*

- Bound the keys: process in chunks of, say, 64 with a bounded errgroup.
- Ensure `watch` is cancellable: pass `ctx` to it.
- Consider buffered `out` or back-pressure aware design.

---

### Q33. What does the Go scheduler do when 100 000 goroutines are runnable simultaneously?

**Model answer.** Roughly:

- Each P has a local queue (256 cap). 100k / GOMAXPROCS goroutines per P, but the queue overflow spills to the global queue.
- The scheduler picks goroutines: local first, global periodically, then steals from other Ps.
- The global queue is a contention point; many Ps contending on it has lock overhead.
- Each goroutine eventually runs; preemption rotates them.
- Wall-clock progress is slow because of scheduling overhead.

In practice: latency variance increases, throughput plateaus or declines. The runtime works but is *suboptimal*.

The fix is fewer goroutines: bounded fan-out. With 100 workers handling sequentially, throughput often exceeds 100k goroutines all contending.

**Common wrong answer.**
- "The scheduler thrashes." (True but imprecise; the runtime has heuristics to limit thrash.)

**Follow-up.** *What's the breaking point?* — Depends on workload, but typically 10 000-100 000 active goroutines before degradation is severe. Far less if each goroutine allocates heavily (GC pauses dominate).

---

### Q34. Explain when you would use weighted vs unweighted semaphores.

**Model answer.** Weighted (`semaphore.Weighted`) when tasks have different costs:
- A small image decode costs 1 MB; a large one costs 256 MB. Weight = MB.
- A small RPC costs 1 connection; a streaming RPC costs 1 connection but holds it long. Weight differs.

Unweighted (errgroup.SetLimit, `chan struct{}` semaphore) when tasks are uniform:
- All HTTP requests cost roughly the same.
- All database queries hold one connection.

If you're not sure: start with unweighted. Switch to weighted if profile shows that uniform treatment causes problems (e.g., memory spikes for large items).

**Common wrong answer.**
- "Always use weighted." (Adds complexity for no benefit when tasks are uniform.)

**Follow-up.** *What if weights vary by 100x?* — Weighted is essential. Without it, you either set the bound to N × max_weight (wasting capacity when tasks are small) or to N × avg_weight (overflowing when tasks are large).

---

### Q35. Your monitoring shows `process_goroutines` plateaus at 5000 during normal load. Last week it spiked to 50000 during an incident. Should you set an alert at 10000?

**Model answer.** Yes, but with care. Considerations:

- Alert too low: false alarms during normal variance.
- Alert too high: misses precursors.
- 10000 is 2x baseline; reasonable.

Better: alert on shape, not just absolute:
- Alert if `process_goroutines > 10000` for 5 minutes (gives time for transients).
- Alert if `rate of growth > 100/s` for 5 minutes (catches leaks before they hit the cap).

The combination catches both saturation and growth. Each has its threshold.

**Common wrong answers.**
- "Just alert at 5x baseline." (Maybe; depends on variance.)
- "Don't alert; rely on user reports." (Always wait until users notice means slow detection.)

**Follow-up.** *What's the alert response runbook?* — Capture pprof, identify stack, check correlations (deploy, traffic spike, downstream issue), decide: roll back, scale, or wait.

---

### Q36. Critique this code:

```go
type Cache struct {
    data sync.Map
}

func (c *Cache) GetOrCompute(key string, fn func() (V, error)) (V, error) {
    if v, ok := c.data.Load(key); ok {
        return v.(V), nil
    }
    v, err := fn()
    if err != nil { return v, err }
    c.data.Store(key, v)
    return v, nil
}
```

**Model answer.** Race: between `Load` (miss) and `Store`, another goroutine may also call `fn`. If 1000 goroutines call `GetOrCompute("a")` simultaneously, `fn` runs 1000 times. This is a "cache stampede."

Fix: use `golang.org/x/sync/singleflight`:

```go
func (c *Cache) GetOrCompute(key string, fn func() (V, error)) (V, error) {
    if v, ok := c.data.Load(key); ok {
        return v.(V), nil
    }
    v, err, _ := c.sf.Do(key, func() (interface{}, error) {
        // re-check after acquiring singleflight slot
        if v, ok := c.data.Load(key); ok { return v, nil }
        v, err := fn()
        if err != nil { return nil, err }
        c.data.Store(key, v)
        return v, nil
    })
    if err != nil { var zero V; return zero, err }
    return v.(V), nil
}
```

Now only one `fn` runs per key; others wait for the result.

**Common wrong answer.**
- "Use mutex." (A mutex serialises all keys, not just the same key.)

**Follow-up.** *What about negative cache (caching errors)?* — Depends on policy. Often you want to cache for a short time to avoid re-attempting against a failing source.

---

### Q37. Design a load test that validates a bounded fan-out endpoint.

**Model answer.** Three phases:

1. **Steady-state.** Send 0.7 × bound RPS for 5 minutes. Assert:
   - Success rate > 99.9%.
   - Latency p99 within target.
   - In-flight count stable.

2. **Above-bound.** Send 2 × bound RPS for 1 minute. Assert:
   - Some 503s observed (admission control engaged).
   - Latency for *admitted* requests stays bounded.
   - No OOMs.

3. **Recovery.** Drop back to 0.5 × bound. Assert:
   - Latency returns to baseline within 30 seconds.
   - No goroutine count residual.

Each assertion has a metric. Run in CI before each release.

**Common wrong answer.**
- "Send 100 concurrent requests and see if it crashes." (Not a load test; that's a smoke test.)

**Follow-up.** *What tool would you use?* — `k6` for scripted scenarios. `vegeta` for HTTP-specific with detailed metrics. Whichever, integrate with Prometheus for time-series comparison.

---

### Q38. A team proposes using `goroutine pools as a service`: a separate microservice that holds a goroutine pool, accessed via RPC. Critique.

**Model answer.** Highly suspect. Reasons:

1. **Latency.** Each pool call adds RPC overhead. The pool exists to be fast; you're making it slow.
2. **Statefulness.** The pool service holds state (in-flight count); failover is hard.
3. **Coordination.** Multiple callers compete for the same pool; the coordination must happen somewhere.
4. **Anti-pattern.** Local concurrency is, well, local. Externalising it adds complexity for no clear gain.

When would you ever want this?
- If goroutine bounds are policy-driven and need central control. But: that's what a config service is for. Push policy, not execution.

**Common wrong answer.**
- "It's a great idea." (Rarely is.)

**Follow-up.** *What would you suggest instead?* — Each service has its own local pool. Central control of *config*. Central monitoring of *metrics*. The execution stays local.

---

### Q39. Tell me about a time you had to balance throughput vs latency in a concurrency context.

**Model answer.** (This is an experience question. A model answer based on common scenarios.)

"In a recent service, increasing the pool size from 32 to 128 improved throughput by 3x but latency p99 increased from 50ms to 200ms. Investigation: at 128 workers, the database connection pool (cap 50) was saturated; workers queued for connections, adding 150ms wait.

Resolution: increased DB pool to 100, kept workers at 128. Throughput maintained; latency returned to 50ms. Required DBA approval for the pool change.

Lesson: throughput and latency interact via downstream. Optimizing one requires understanding the others."

**Common wrong answer.**
- A purely theoretical answer without specifics.

**Follow-up.** *What did you measure to make the call?* — Throughput (RPS), latency (p50, p99), DB connection-pool wait time, DB CPU. The third was the smoking gun.

---

### Q40. What's the next 5 years of Go concurrency? Where will it evolve?

**Model answer.** Speculative but informed:

1. **Structured concurrency primitives.** Likely a library-level pattern (perhaps in `golang.org/x/sync`) that enforces "all spawned goroutines must complete before the function returns." Already approximated by errgroup; may become idiomatic syntax.

2. **Better tools.** Improved goroutine profile diff. Maybe runtime-supported leak detection. Continuous profiling integration in the standard pprof tooling.

3. **GC improvements.** Smaller pauses; perhaps generational GC. Reduces the GC pause amplification of large goroutine counts.

4. **Library standards.** A standard "bounded pool" in the standard library. Right now everyone rolls their own.

5. **Education.** "Unbounded goroutines" becomes universally taught as anti-pattern. The need for documents like this diminishes.

6. **Convergence.** Go's concurrency story converges with Rust's (async/await) and Java's (virtual threads). The exact syntax differs; the patterns are universal.

**Common wrong answer.**
- A pure technology hype answer ("AI-powered scheduling!"). The evolution is mostly about discipline tooling, not radical changes.

**Follow-up.** *What can you do to influence it?* — Contribute to proposals; write about patterns; teach. The community's collective experience shapes the language and ecosystem.

---

## Final notes

These 40 questions cover most of the conceptual surface for "unlimited goroutines." A candidate who can answer the junior section is ready for entry-level Go work. Middle-level for routine engineering. Senior-level for design responsibility. Staff-level for system architecture.

Practice answering them aloud. Time yourself. Iterate. Each answer should be 60-180 seconds verbal, with concrete examples and trade-offs.

End of Interview file.
