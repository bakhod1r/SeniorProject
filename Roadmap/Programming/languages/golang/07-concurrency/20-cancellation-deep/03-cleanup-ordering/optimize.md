---
layout: default
title: Cleanup Ordering — Optimize
parent: Cleanup Ordering
grand_parent: Cancellation Deep
ancestor: Go
nav_order: 10
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/20-cancellation-deep/03-cleanup-ordering/optimize/
---

# Cleanup Ordering — Optimization Exercises

Each exercise presents a piece of code with a cleanup-related performance issue. Identify the issue, propose a fix, and reason about the trade-offs.

---

## Exercise 1: Defer in a Hot Loop

```go
func process(items []int) {
    for _, item := range items {
        func() {
            defer cleanup(item)
            work(item)
        }()
    }
}
```

**The issue.** The anonymous function with `defer` allocates a `_defer` record per iteration (heap allocation). For 1 million items, 1M allocations.

**Optimization.** If `cleanup` is small and called only on the next iteration, inline it:

```go
func process(items []int) {
    for _, item := range items {
        work(item)
        cleanup(item)
    }
}
```

If cleanup must run on panic, keep the defer but lift the iteration body into a named helper:

```go
func process(items []int) {
    for _, item := range items {
        processOne(item)
    }
}

func processOne(item int) {
    defer cleanup(item)
    work(item)
}
```

The named helper is open-coded (one defer per function, no loop). Free.

**Measured difference.** ~30 ns/iteration improvement for the open-coded path vs the closure path.

---

## Exercise 2: Too Many Defers

```go
func bigFunc() {
    defer a()
    defer b()
    defer c()
    defer d()
    defer e()
    defer f()
    defer g()
    defer h()
    defer i()  // 9th defer; falls back to heap
}
```

**The issue.** The 9th defer pushes the function past the 8-defer open-coded budget. The compiler falls back to heap defers for *all* of them. Cost rises from ~5 ns to ~30 ns per defer.

**Optimization.** Reduce defer count by combining:

```go
defer func() {
    a(); b(); c(); d(); e(); f(); g(); h(); i()
}()
```

One defer; runs all cleanups in order. Open-coded; cheap.

**Trade-off.** The combined order is now FIFO (in the order written), not LIFO. Adjust if order matters.

---

## Exercise 3: AfterFunc Without Stop

```go
func handleRequest(ctx context.Context) {
    context.AfterFunc(ctx, func() { log.Print("cancelled") })
    // ... do work ...
}
```

**The issue.** No `stop` function captured. The callback registration persists until ctx is done or this function's frame is GC'd. For long-lived ctx, this leaks.

**Optimization.** Capture and defer stop:

```go
stop := context.AfterFunc(ctx, func() { log.Print("cancelled") })
defer stop()
```

Now the callback is deregistered on function exit. No leak.

---

## Exercise 4: Excessive Goroutine Creation

```go
func process(items []item) {
    for _, item := range items {
        ctx, cancel := context.WithTimeout(parent, time.Second)
        context.AfterFunc(ctx, func() { cleanup(item) })
        doWork(ctx, item)
        cancel()
    }
}
```

**The issue.** Each iteration creates a context, registers AfterFunc, calls cancel. The AfterFunc fires (or is stopped), spawning a goroutine per iteration. For 10K items: 10K goroutines created.

**Optimization.** If cleanup doesn't need to react to cancel, use defer:

```go
for _, item := range items {
    ctx, cancel := context.WithTimeout(parent, time.Second)
    doWork(ctx, item)
    cleanup(item)
    cancel()
}
```

No AfterFunc. Cleanup runs sequentially. No extra goroutines.

If cleanup must be cancel-responsive, profile the AfterFunc overhead. For most workloads, the cost is acceptable.

---

## Exercise 5: Slow Shutdown Due to Sequential Closes

```go
func (s *Service) Shutdown(ctx context.Context) error {
    // 5 components, each takes ~5 seconds
    s.logger.Close()
    s.metrics.Close()
    s.cache.Close()
    s.db.Close()
    s.search.Close()
    return nil
}
```

**The issue.** Total shutdown: 25 seconds. Exceeds typical graceful period.

**Optimization.** Parallelize independent closes:

```go
func (s *Service) Shutdown(ctx context.Context) error {
    g, ctx := errgroup.WithContext(ctx)
    g.Go(func() error { return s.logger.Close() })
    g.Go(func() error { return s.metrics.Close() })
    g.Go(func() error { return s.cache.Close() })
    g.Go(func() error { return s.db.Close() })
    g.Go(func() error { return s.search.Close() })
    return g.Wait()
}
```

Total shutdown: ~5 seconds (the slowest one).

**Trade-off.** Only safe for independent components. If `db` must close before `cache`, keep that pair sequential.

---

## Exercise 6: Channel-Based Cleanup with FIFO

```go
cleanups := make(chan func(), 100)
go func() {
    for fn := range cleanups {
        fn()
    }
}()

// later
cleanups <- func() { resourceA.Close() }
cleanups <- func() { resourceB.Close() }
```

**The issue.** Cleanups run in FIFO order. Probably wrong (resources should release in reverse acquisition order).

**Optimization.** Either use defer (LIFO) or buffer in a slice and run in reverse:

```go
var cleanups []func()
cleanups = append(cleanups, func() { resourceA.Close() })
cleanups = append(cleanups, func() { resourceB.Close() })

// on shutdown:
for i := len(cleanups) - 1; i >= 0; i-- {
    cleanups[i]()
}
```

LIFO order, no channel overhead.

---

## Exercise 7: Allocating Closures for Defer

```go
func work() {
    for _, x := range largeSlice {
        defer func(x int) { process(x) }(x)
    }
}
```

**The issue.** Each defer captures `x` by value (as an arg), so the closure itself is shared, but the defer record stores `x`. Heap allocation per iteration.

**Optimization.** Same as Exercise 1: extract a helper:

```go
for _, x := range largeSlice {
    processWithDefer(x)
}

func processWithDefer(x int) {
    defer process(x)
}
```

Helper is open-coded. No heap allocation.

---

## Exercise 8: Lock Held During Slow Cleanup

```go
func (c *Cache) Clear() {
    c.mu.Lock()
    defer c.mu.Unlock()
    for _, item := range c.items {
        item.Close()  // I/O
    }
    c.items = nil
}
```

**The issue.** Lock held during item.Close. If Close does network I/O, all other Cache operations block for the duration.

**Optimization.**

```go
func (c *Cache) Clear() {
    c.mu.Lock()
    items := c.items
    c.items = nil
    c.mu.Unlock()
    for _, item := range items {
        item.Close()
    }
}
```

Lock released before slow work.

---

## Exercise 9: GC Pressure from Many Defer Records

```go
for i := 0; i < 1_000_000; i++ {
    func() {
        defer cleanup()
        work()
    }()
}
```

**The issue.** 1M heap-allocated `_defer` records. The per-P pool absorbs most, but allocation rate is still significant. GC scans them all.

**Optimization.** Hoist cleanup out of the inner function:

```go
for i := 0; i < 1_000_000; i++ {
    work()
    cleanup()
}
```

No defer; explicit cleanup. Free of GC pressure.

**Trade-off.** No panic safety. If work panics, cleanup is skipped. If panic is unlikely or acceptable to skip, fine. Otherwise use defer (a per-call helper is open-coded).

---

## Exercise 10: AfterFunc Storm

```go
func handler(ctx context.Context) {
    for i := 0; i < 1000; i++ {
        item := items[i]
        context.AfterFunc(ctx, func() { item.Cleanup() })
    }
}
```

**The issue.** 1000 AfterFunc registrations. On cancel, 1000 goroutines spawn. CPU spike.

**Optimization.** One AfterFunc that fans out:

```go
func handler(ctx context.Context) {
    items := items[:1000]
    stop := context.AfterFunc(ctx, func() {
        for _, item := range items {
            item.Cleanup()
        }
    })
    defer stop()
}
```

One goroutine on cancel, runs all cleanups sequentially.

**Trade-off.** Cleanups run serially. If parallel cleanup is needed, use a worker pool inside the callback.

---

## Exercise 11: Recover Hides Cost

```go
for i := 0; i < n; i++ {
    func() {
        defer func() {
            if r := recover(); r != nil {
                log.Print(r)
            }
        }()
        work(i)
    }()
}
```

**The issue.** The recover defer is registered per iteration. Even if no panic occurs, the defer registration costs (heap-allocated due to the closure).

**Optimization.** If panics are rare, accept the cost — recovery is important. If panics are impossible (you control work() and it doesn't panic), remove the recover.

Alternatively, lift the recover to a higher scope:

```go
defer func() {
    if r := recover(); r != nil { log.Print(r) }
}()
for i := 0; i < n; i++ {
    work(i)
}
```

But this stops the loop on first panic. Different semantics.

---

## Exercise 12: Excessive Argument Storage

```go
defer log.Printf("processed %d items with config %v in %v", count, bigConfig, elapsed)
```

**The issue.** The defer captures `count`, `bigConfig`, and `elapsed` as arguments. The `_defer` record stores them all (potentially many bytes).

**Optimization.** Use a closure:

```go
defer func() {
    log.Printf("processed %d items with config %v in %v", count, bigConfig, elapsed)
}()
```

The closure stores only a pointer to the function value (and a pointer to the captured variables). Smaller record.

---

## Exercise 13: Cleanup with No Deadline

```go
func (s *Service) Stop() error {
    s.cancel()
    s.wg.Wait()  // could block forever
    return s.db.Close()
}
```

**The issue.** No context. If wg.Wait hangs, Stop hangs.

**Optimization.** Take a context:

```go
func (s *Service) Stop(ctx context.Context) error {
    s.cancel()
    done := make(chan struct{})
    go func() { s.wg.Wait(); close(done) }()
    select {
    case <-done:
    case <-ctx.Done():
        return ctx.Err()
    }
    return s.db.Close()
}
```

Bounded wait. Predictable shutdown time.

---

## Exercise 14: Slow Drain Channel

```go
for {
    select {
    case v := <-in:
        process(v)
    case <-ctx.Done():
        // drain
        for v := range in {
            process(v)
        }
        return
    }
}
```

**The issue.** The drain loop processes every remaining value. If processing is slow and the channel has thousands of items, drain takes a long time.

**Optimization.** Limit drain duration:

```go
case <-ctx.Done():
    drainCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
    defer cancel()
    for {
        select {
        case v := <-in:
            process(v)
        case <-drainCtx.Done():
            return
        }
    }
```

Drain stops after 5 seconds; in-flight items may be lost. Trade-off between drain completeness and bounded shutdown time.

---

## Exercise 15: Profiling Defer Cost

Suppose pprof shows:

```
35%  runtime.deferproc
25%  runtime.deferreturn
10%  runtime.gopanic
```

**The issue.** Defer machinery dominates. Indicates heap defers in a hot path.

**Optimization.** Identify the hot function via `go tool pprof -list runtime.deferproc`. Then:
1. Check if the function has more than 8 defers (combine them).
2. Check if defers are in loops (extract helper).
3. Compile with `-gcflags='-d=defer=2'` to see open-coded decisions.
4. Refactor to bring defers into the open-coded path.

After optimization, defer cost should drop to <5%.

---

## Exercise 16: Cleanup During GC

```go
runtime.SetFinalizer(obj, func(o *Object) {
    o.Close()
})
```

**The issue.** Finalizer fires during GC, on a dedicated finalizer goroutine. If Close is slow, it blocks other finalizers. Also, finalizer timing is unpredictable.

**Optimization.** Replace with explicit Close + sync.Once:

```go
type Object struct {
    once sync.Once
}

func (o *Object) Close() {
    o.once.Do(func() { o.realClose() })
}
```

Callers must call Close. Use go vet's `lostcancel`-style linter or static analysis to verify all paths close.

---

## Exercise 17: Heavy Cleanup in errgroup Workers

```go
g.Go(func() error {
    defer expensiveCleanup()
    return doWork()
})
```

**The issue.** If errgroup cancels due to a sibling's error, this worker's `doWork` returns immediately, then `expensiveCleanup` runs — wasting time on a doomed shutdown.

**Optimization.** Make cleanup respect cancellation:

```go
g.Go(func() error {
    defer func() {
        ctx2, cancel := context.WithTimeout(context.Background(), 1*time.Second)
        defer cancel()
        expensiveCleanup(ctx2)
    }()
    return doWork(ctx)
})
```

Cleanup is bounded. Even if the parent ctx is cancelled, cleanup has a fresh budget.

---

## Exercise 18: AfterFunc Registered in Tight Loop

```go
for _, msg := range messages {
    context.AfterFunc(ctx, func() { msg.Cancel() })
}
```

**The issue.** Each registration allocates and adds to ctx's child list. For 100K messages, the child list becomes large; iteration on cancel is O(N).

**Optimization.** If cleanup can run in batch:

```go
stop := context.AfterFunc(ctx, func() {
    for _, msg := range messages {
        msg.Cancel()
    }
})
defer stop()
```

One registration, batch cleanup on cancel.

---

## Exercise 19: Combining defer with closure

```go
defer log.Printf("done %d", expensiveCount())
```

**The issue.** `expensiveCount()` is called at the defer line (when registered), even though the log message only matters at function exit.

**Optimization.** If you want the value at exit, use a closure:

```go
defer func() { log.Printf("done %d", expensiveCount()) }()
```

If you want the value at defer registration (current behaviour), keep it. Just make sure that matches your intent.

---

## Exercise 20: Optimizing Real Shutdown

Suppose your service's shutdown takes 30 seconds:
- HTTP shutdown: 20s (waiting for slow handlers)
- Workers: 5s
- DB: 3s
- Other: 2s

**Optimization options.**
1. Reduce HTTP timeout for slow handlers (kill stuck requests).
2. Parallelize Workers, DB, Other (they're independent after HTTP).
3. Mark service as not-ready earlier (5s before SIGTERM, so LB stops routing).
4. Add metrics to identify the slowest handler; fix it.

After: shutdown in 10-15 seconds. Within the 30s graceful period with margin.

---

## Discussion: When to Optimize Cleanup

Cleanup optimization is usually unnecessary. Most code spends <1% of CPU on cleanup. Profile first; optimize only if there's evidence.

Exception: shutdown latency. Even small inefficiencies compound under load. A service that takes 5 minutes to shut down is operationally broken regardless of CPU usage.

Exception: hot paths. Functions called millions of times per second can see defer cost. Open-coded defer (≤ 8 defers, no loops) is essentially free; heap defers cost ~30 ns each.

Exception: AfterFunc storms. Cancellation events that fire thousands of callbacks at once can cause CPU spikes. Coalesce.

---

## Tools for Cleanup Optimization

- `go tool pprof` for CPU profiles.
- `go test -bench` with `-benchmem` for allocation tracking.
- `go vet` for lostcancel detection.
- `staticcheck` for various lints.
- `go build -gcflags='-d=defer=2'` for defer analysis.
- `goleak` for goroutine leak detection.
- `runtime/trace` for execution traces.

Use them. Cleanup correctness and performance are both verifiable.

---

## Summary

Cleanup optimization is mostly about:
1. Keeping defers in the open-coded path.
2. Avoiding defers in tight loops.
3. Limiting AfterFunc registrations and goroutine spawns.
4. Releasing locks before slow work.
5. Parallelizing independent cleanups.
6. Bounding cleanup with deadlines.
7. Profiling to find the actual bottleneck.

Apply the optimizations above only when profiling indicates a problem. Premature optimization of cleanup, like any optimization, is a trap.

---

End of optimize exercises.
