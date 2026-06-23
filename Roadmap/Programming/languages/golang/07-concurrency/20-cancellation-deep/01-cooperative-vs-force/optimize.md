---
layout: default
title: Optimize
parent: Cooperative vs Forced
grand_parent: Cancellation Deep
ancestor: Go
nav_order: 10
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/20-cancellation-deep/01-cooperative-vs-force/optimize/
---

# Cooperative vs Forced Cancellation — Optimization

> Cancellation polling and context plumbing add cost. Usually trivial; sometimes measurable. Each entry below states the issue, shows a before/after, and notes the realistic gain.

---

## Optimization 1 — Replace per-iteration `<-ctx.Done()` with periodic `ctx.Err()`

**Problem.** A hot inner loop checks `<-ctx.Done()` every iteration. The channel-receive overhead (5–20 ns) dominates the loop body if the body itself is tiny.

**Before:**
```go
for i, x := range data {
    select {
    case <-ctx.Done():
        return ctx.Err()
    default:
    }
    sum += x
}
```

**After:**
```go
const checkEvery = 1024
for i, x := range data {
    if i&(checkEvery-1) == 0 {
        if err := ctx.Err(); err != nil {
            return err
        }
    }
    sum += x
}
```

**Gain.** Up to 2–3× faster for trivial loop bodies. `ctx.Err()` is a single atomic load (1–2 ns) and we only do it every 1024 iterations.

**Caveat.** Cancellation latency grows: worst case 1024 iterations between checks. If each iteration is 10 ns, that's 10 µs of latency — negligible. If iterations take milliseconds, polling every iteration is fine.

---

## Optimization 2 — Avoid `time.After` in hot loops

**Problem.** `time.After(d)` allocates a `*time.Timer` and a channel. In Go before 1.23, this timer was not garbage-collectable until it fired. In a loop running thousands of times per second, this accumulates.

**Before:**
```go
for {
    select {
    case <-time.After(100*time.Millisecond):
        // timeout this iteration
    case msg := <-ch:
        handle(msg)
    case <-ctx.Done():
        return
    }
}
```

**After:**
```go
t := time.NewTimer(100*time.Millisecond)
defer t.Stop()
for {
    if !t.Stop() {
        <-t.C // drain
    }
    t.Reset(100*time.Millisecond)
    select {
    case <-t.C:
        // timeout
    case msg := <-ch:
        handle(msg)
    case <-ctx.Done():
        return
    }
}
```

**Gain.** No timer allocations per iteration. For loops at 10k iterations/sec, savings of MB/sec of allocation. GC pressure drops.

**Note.** Go 1.23 changed `time.After` so the timer is GC-eligible immediately on receive. The pattern above is still slightly cheaper because it avoids the allocation entirely.

---

## Optimization 3 — Reuse the `<-ctx.Done()` channel

**Problem.** Calling `ctx.Done()` is not free on every call, especially in a deep context chain. The implementation does lazy creation: first call may allocate.

**Before:**
```go
for i := 0; i < N; i++ {
    select {
    case <-ctx.Done():
        return
    default:
    }
}
```

**After:**
```go
done := ctx.Done()
for i := 0; i < N; i++ {
    select {
    case <-done:
        return
    default:
    }
}
```

**Gain.** A method-call elision per iteration. Small but visible in tight loops; measure with `go test -bench`.

---

## Optimization 4 — Pool worker goroutines with cancellation

**Problem.** Spawning a fresh goroutine per task is cheap but not free; the goroutine costs ~2 KB plus context setup. For thousands of small tasks, this matters.

**Before:**
```go
for _, task := range tasks {
    go func(t Task) { t.Run(ctx) }(task)
}
```

**After:**
```go
const workers = runtime.GOMAXPROCS(0)
ch := make(chan Task, workers*4)
g, ctx := errgroup.WithContext(ctx)
for i := 0; i < workers; i++ {
    g.Go(func() error {
        for t := range ch {
            if ctx.Err() != nil {
                return ctx.Err()
            }
            if err := t.Run(ctx); err != nil {
                return err
            }
        }
        return nil
    })
}
for _, t := range tasks {
    select {
    case ch <- t:
    case <-ctx.Done():
    }
}
close(ch)
g.Wait()
```

**Gain.** Constant memory, predictable scheduling. Cancellation still propagates through `ctx`.

---

## Optimization 5 — Cache `errors.Is` checks

**Problem.** `errors.Is(err, context.Canceled)` walks the error chain. In a hot error path, this is wasteful.

**Before:**
```go
if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
    // ...
}
```

**After (when you know the error type):**
```go
switch err {
case context.Canceled, context.DeadlineExceeded:
    // ...
}
```

Or:
```go
if ctxErr := ctx.Err(); ctxErr != nil {
    // we know cancellation happened; don't ask errors.Is
}
```

**Gain.** A few nanoseconds per check. Marginal but adds up in tight error-handling loops.

---

## Optimization 6 — Lazy context derivation

**Problem.** You create `context.WithCancel` even on paths that never cancel. The allocation and parent-registration cost is wasted.

**Before:**
```go
func operation(parent context.Context) error {
    ctx, cancel := context.WithCancel(parent)
    defer cancel()
    return doWork(ctx)
}
```

**After (when no internal cancel is needed):**
```go
func operation(parent context.Context) error {
    return doWork(parent)
}
```

**Gain.** ~500 ns per call. Significant on a per-request hot path.

**Note.** Only optimise if you genuinely don't need to cancel. Don't lose cancellation discipline for a microsecond.

---

## Optimization 7 — Bound goroutine creation under load

**Problem.** A goroutine per request can spike to hundreds of thousands under load. The scheduler thrashes. Cancellation paths slow down because every G has to be visited.

**Before:**
```go
http.HandleFunc("/work", func(w http.ResponseWriter, r *http.Request) {
    go process(r.Context(), r.Body)
    w.WriteHeader(202)
})
```

**After:**
```go
sem := make(chan struct{}, 100) // max 100 concurrent
http.HandleFunc("/work", func(w http.ResponseWriter, r *http.Request) {
    select {
    case sem <- struct{}{}:
        go func() {
            defer func() { <-sem }()
            process(r.Context(), r.Body)
        }()
        w.WriteHeader(202)
    case <-r.Context().Done():
        w.WriteHeader(499) // client cancelled
    case <-time.After(50*time.Millisecond):
        w.WriteHeader(503) // overloaded
    }
})
```

**Gain.** Bounded concurrency. Cancellation latency stays predictable. Server avoids meltdown under spike.

---

## Optimization 8 — Reduce context tree depth

**Problem.** Each `WithValue` adds a node; lookup is O(depth). In libraries that thread many values through, the depth grows.

**Before:**
```go
ctx = context.WithValue(parent, userKey, user)
ctx = context.WithValue(ctx, requestKey, req)
ctx = context.WithValue(ctx, traceKey, trace)
ctx = context.WithValue(ctx, tenantKey, tenant)
```

**After (when values are related):**
```go
type RequestInfo struct {
    User, Request, Trace, Tenant any
}
ctx = context.WithValue(parent, infoKey, &RequestInfo{...})
```

**Gain.** One node instead of four. Faster `Value` lookups for all subsequent reads.

**Caveat.** Less granular: changing one field means replacing the whole struct. Choose based on access patterns.

---

## Optimization 9 — Skip cancellation check when not cancellable

**Problem.** Functions that may be called with `context.Background()` still pay the check cost.

**Before:**
```go
for {
    select {
    case <-ctx.Done():
        return ctx.Err()
    default:
    }
    work()
}
```

**After:**
```go
done := ctx.Done()
if done == nil {
    // ctx never cancels (Background); skip check
    for {
        work()
    }
}
for {
    select {
    case <-done:
        return ctx.Err()
    default:
    }
    work()
}
```

**Gain.** Eliminates the `select` overhead for non-cancellable contexts. Useful for libraries with hot inner loops.

**Cost.** Code duplication. Often not worth it.

---

## Optimization 10 — Batch cancellation observation in pipelines

**Problem.** Each stage of a pipeline checks `ctx.Done()` per item. For high-throughput pipelines, this adds up.

**Before:**
```go
for in := range src {
    select {
    case <-ctx.Done():
        return
    case out <- transform(in):
    }
}
```

**After (batch by N):**
```go
batch := make([]Out, 0, 64)
for in := range src {
    batch = append(batch, transform(in))
    if len(batch) == 64 {
        select {
        case <-ctx.Done():
            return
        default:
        }
        for _, b := range batch {
            select {
            case out <- b:
            case <-ctx.Done():
                return
            }
        }
        batch = batch[:0]
    }
}
// flush remaining
```

**Gain.** Amortises the cancellation check over 64 items. Throughput improves by 1.2–1.5× in benchmarks for small-payload pipelines.

**Caveat.** Cancellation latency increases by up to one batch worth. Tune `64` to your latency budget.

---

## Optimization 11 — Force-cancel slow goroutines on shutdown

**Problem.** Graceful shutdown waits for cooperative exit. Some goroutines take longer than the grace budget. Average shutdown is slow.

**Before:**
```go
srv.Shutdown(graceCtx) // waits for all in-flight, no force
```

**After:**
```go
err := srv.Shutdown(graceCtx)
if errors.Is(err, context.DeadlineExceeded) {
    log.Warn("graceful shutdown exceeded; forcing close")
    srv.Close() // immediate close of all connections
}
```

**Gain.** Bounded shutdown time. The trade-off: in-flight requests are dropped. Document this in your runbook.

---

## Optimization 12 — Replace `WithCancel`+goroutine with `AfterFunc`

**Problem.** A common pattern: spawn a goroutine that waits on `<-ctx.Done()` to run cleanup. Each goroutine costs ~2 KB.

**Before:**
```go
go func() {
    <-ctx.Done()
    cleanup()
}()
```

**After (Go 1.21+):**
```go
stop := context.AfterFunc(ctx, cleanup)
defer stop()
```

**Gain.** No goroutine. Cleanup runs from the context's internal mechanism. For services with thousands of contexts, saves megabytes of goroutine stacks.

---

## Summary

The cost of cooperation is generally small (single-digit nanoseconds per check) and dominated by other factors. Optimize cancellation paths only when:

- Profiling shows they are hot.
- You can prove the optimization with a benchmark.
- Latency budget allows reduced polling frequency.

The bigger wins are *not* in micro-tuning the cancellation primitive. They are in:

- Bounding goroutine counts (so cancellation has fewer Gs to walk).
- Using `errgroup` instead of ad-hoc patterns.
- Pooling resources (workers, contexts) rather than per-task allocation.
- Setting realistic grace budgets and escalating to force when needed.

Cancellation is not a hot path you want to fight. Make it correct first; optimize the rare cases where profiles say it matters.
