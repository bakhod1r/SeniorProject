---
layout: default
title: Structured Concurrency — Optimize
parent: Structured Concurrency
grand_parent: Modern Concurrency Features
ancestor: Go
nav_order: 10
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/25-modern-features/02-structured-concurrency/optimize/
---

# Structured Concurrency — Optimize

[← Back](../)

`errgroup` is the right tool for almost every fan-out/fan-in problem in Go. But
"almost every" is not "every". This page covers the cases where `errgroup`
overhead is measurable, where its semantics are wrong for the workload, and
where a different primitive is a better fit.

## 1. Where the overhead actually lives

`errgroup.Group` is built on top of `sync.WaitGroup`, `sync.Once`, and (when
`WithContext` is used) a cancellable context. The per-goroutine cost over a
bare `WaitGroup` is:

- One `chan` send/receive into the semaphore when `SetLimit` is active.
- One `sync.Once.Do` check on the error path.
- One `context.WithCancelCause` derivation up front (constant, not per-goroutine).

For a quick sanity check:

```go
func BenchmarkBareWG(b *testing.B) {
    for i := 0; i < b.N; i++ {
        var wg sync.WaitGroup
        wg.Add(4)
        for j := 0; j < 4; j++ {
            go func() { defer wg.Done(); doWork() }()
        }
        wg.Wait()
    }
}

func BenchmarkErrgroup(b *testing.B) {
    for i := 0; i < b.N; i++ {
        var g errgroup.Group
        for j := 0; j < 4; j++ {
            g.Go(func() error { doWork(); return nil })
        }
        _ = g.Wait()
    }
}
```

On Apple M-class silicon, the gap is on the order of tens of nanoseconds per
group when `doWork` is empty. Add any real I/O and the difference vanishes
into noise.

**Rule of thumb.** Pick `errgroup` for clarity by default. Reach for raw
`WaitGroup` only when benchmarks show a hot loop spending measurable time in
group overhead — almost never the case for I/O-bound or even CPU-bound
work that takes more than a microsecond.

## 2. `SetLimit` versus a worker pool

Two ways to bound concurrency to N:

```go
// Option A: errgroup.SetLimit
g, gctx := errgroup.WithContext(ctx)
g.SetLimit(8)
for _, item := range items {
    item := item
    g.Go(func() error { return process(gctx, item) })
}
_ = g.Wait()
```

```go
// Option B: classic worker pool
work := make(chan Item)
g, gctx := errgroup.WithContext(ctx)
for i := 0; i < 8; i++ {
    g.Go(func() error {
        for it := range work {
            if err := process(gctx, it); err != nil { return err }
        }
        return nil
    })
}
for _, it := range items { work <- it }
close(work)
_ = g.Wait()
```

Trade-offs:

| Aspect | `SetLimit` | Worker pool |
|---|---|---|
| Goroutines created | One per item | Exactly N |
| Code complexity | Lower | Higher |
| Allocation per item | Closure + goroutine | Channel send |
| Backpressure source | Semaphore in `Go` | Channel send |
| Best for | Hundreds-of-thousands range | Millions and up |

If `len(items)` is, say, 1000 and `process` does network I/O, both are fine
and `SetLimit` reads better. If `len(items)` is 10 million and `process` is
microsecond-scale, the worker pool wins because it amortises the
goroutine-startup cost across N workers.

## 3. `TryGo` for load shedding

`TryGo` is the right primitive when overflow should *drop work* rather than
block the producer. A canonical place is a metrics emitter:

```go
g, _ := errgroup.WithContext(ctx)
g.SetLimit(4)

func emit(sample Sample) {
    if !g.TryGo(func() error { return sink.Send(sample); }) {
        droppedCounter.Inc()
    }
}
```

The producer never blocks. Excess load increments a counter you can graph,
which is almost always better than introducing tail latency into the request
path.

## 4. When *not* to use `errgroup`

### Daemons

`errgroup.Wait` blocks until every goroutine returns. A daemon that runs for
the lifetime of the process will never return, so `Wait` hangs forever. Use
a `Start`/`Stop` pair with a private `WaitGroup` and a `context.CancelFunc`.

### Producer-consumer with no shared error

If you have a pipeline where each stage handles its own errors (e.g. logs
and continues), the first-error semantics of `errgroup` are pointless
overhead. Use channels for the data and a `WaitGroup` for the join.

### Fire-and-forget metrics

If you genuinely do not care about completion and the goroutine writes to a
non-blocking sink, a bare `go` *might* be defensible — but document why and
add a panic-safe wrapper. In most production code, even metrics goroutines
should be supervised.

## 5. Memoising the cancellation cause

`errgroup`'s captured error is also installed as the cancellation cause via
`context.WithCancelCause`. You can access it with `context.Cause(gctx)`
without paying for it twice. A common optimisation: log the cause once, not
per child.

```go
if err := g.Wait(); err != nil {
    log.Printf("group failed, cause=%v", context.Cause(gctx))
    return err
}
```

If `WithContext` is *not* used, `context.Cause(gctx)` is not available; you
must read `g.Wait()`'s return value instead.

## 6. Avoiding allocation in the hot loop

Each `g.Go(func() error { ... })` allocates a closure. If the loop is hot
and the work per item is tiny, you can preallocate:

```go
g, gctx := errgroup.WithContext(ctx)
g.SetLimit(runtime.GOMAXPROCS(0))

run := func(item Item) func() error {
    return func() error { return process(gctx, item) }
}

for _, it := range items {
    g.Go(run(it))
}
_ = g.Wait()
```

But honestly: if your loop launches enough goroutines that closure
allocation matters, the work-pool pattern (Option B above) is the better
optimisation. `g.Go(...)`'s closure cost is dominated by the goroutine
startup, not the closure itself.

## 7. Microbenchmark caveats

`errgroup` operations are nanosecond-scale. Microbenchmarks comparing
`errgroup` to raw `WaitGroup` measure mostly the Go runtime's goroutine
allocator. Real services see no measurable difference. If your benchmark
shows a 30% gap, you are benchmarking goroutine creation, not group
overhead.

## 8. When to reach for `context.WithCancel` + manual coordination

Cases where rolling your own coordination beats `errgroup`:

- You need to wait for some children but *not* others (e.g. a daemon plus
  request work in the same scope).
- You need *all* errors, not just the first. Use a `chan error` with
  capacity = N, or an `errors.Join`-aggregating slice guarded by a mutex.
- You need to cancel children selectively, not all at once. Each child
  gets its own `context.WithCancel`; the parent picks which to stop.
- You need re-startable children (supervision-tree style). `errgroup`'s
  one-shot lifecycle does not fit; build a supervisor on top of `WaitGroup`.

## 9. Quick decision table

| Situation | First choice |
|---|---|
| Fan-out a handful of independent tasks, want first-error + cancellation | `errgroup.WithContext` |
| Bound concurrency to N, items small to medium | `errgroup.WithContext` + `SetLimit` |
| Process millions of items, fan-out is hot path | Worker pool over channel + `errgroup.Wait` |
| Long-lived daemon | Bespoke `Start`/`Stop` with `WaitGroup` + `CancelFunc` |
| Need all errors, not first | `WaitGroup` + `chan error` + `errors.Join` |
| Fire-and-forget metric write | Buffered channel to a single emitter goroutine; never bare `go` in libraries |

## 10. Bottom line

The interesting optimisation is almost never "remove `errgroup`". It is
"replace bare `go` with `errgroup`" or "replace a hand-rolled
`WaitGroup + chan error + select` with `errgroup`". The cost of `errgroup`
is negligible; the cost of *not* having structured ownership is
intermittent leaks, hidden errors, and post-mortems.

## 11. Profiling tips for concurrent code

When you do need to optimise concurrency-heavy code, the standard
Go profiling tools all work — but a few patterns are especially
useful.

### 11.1 Block profiling

`runtime.SetBlockProfileRate(1)` enables the block profile, which shows
where goroutines spend time blocked on channels, mutexes, and
selects. For `errgroup`-heavy code, the typical hot blocks are:

- `g.wg.Wait()` inside `g.Wait()` — expected; means children are
  legitimately taking time.
- `g.sem <- token{}` inside `g.Go` — backpressure from `SetLimit`.
  If this dominates, the limit is too low.
- Channel sends/receives in your own code — usually where the real
  optimisation lives.

### 11.2 Mutex profiling

`runtime.SetMutexProfileFraction(1)` enables the mutex profile,
showing lock contention. `errgroup` itself uses very few locks
(`sync.Once`, `sync.WaitGroup`); contention in `errgroup` operations
is almost always somewhere else in your code.

### 11.3 Goroutine profile

`go tool pprof http://your-service/debug/pprof/goroutine` gives you a
live snapshot of every goroutine's stack. Group by stack to find
duplicates or unexpected counts. This is the leak-detection workhorse.

### 11.4 Trace

`runtime/trace` shows the execution timeline of goroutines, including
when they're created, scheduled, and blocked. For visualising whether
your fan-out is actually parallel (or accidentally serialised), the
trace is uniquely useful. Open it with `go tool trace`.

## 12. Comparing against language alternatives

A fun thought experiment: how does Go's `errgroup`-based approach
compare to other languages on the dimension of *performance overhead
per concurrent task*?

| Language | Construct | Per-task overhead (approx) |
|---|---|---|
| Go | `errgroup.Go` | ~1µs (goroutine + closure + waitgroup) |
| Kotlin | `launch { ... }` | ~2-5µs (continuation allocation) |
| Swift | `async let` | similar to Kotlin |
| Trio (Python) | `nursery.start_soon` | ~10-50µs (Python interpreter overhead) |
| Rust (tokio) | `task::spawn` | ~500ns-1µs (no GC, no closure boxing) |

Go is competitive. Where Go *wins* is the simplicity of the model:
goroutines are cheap and the API is small. Where Go *loses* is the
lack of compile-time enforcement, which means humans pay the cost in
review effort.

For nearly all workloads, the per-task overhead is dwarfed by the
work the task does. The interesting comparison is *robustness*, not
nanoseconds. Picking the right primitive matters more than tuning it.

## 13. One last optimisation: don't optimise

Most teams that "optimise" their concurrency end up making things
worse. They replace `errgroup` with a hand-rolled construct and
introduce a subtle race. They tune `SetLimit` based on a benchmark
that doesn't match production. They preallocate channels and end up
with deadlocks.

The structured-concurrency primitives are not slow. The work inside
them is what's slow. Profile, find the real bottleneck, and optimise
*that* — usually it's I/O, a database query, or a serialisation
step. The concurrency framework itself is rarely the culprit.

When in doubt: write boring `errgroup.WithContext` code, run it,
measure, and only optimise what the profile shows. That principle —
"don't optimise what you haven't measured" — applies doubly to
concurrent code, where intuition is famously unreliable.
