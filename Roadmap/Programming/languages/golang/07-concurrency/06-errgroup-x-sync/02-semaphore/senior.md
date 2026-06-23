# x/sync semaphore — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [The Real Question: Why FIFO, Why Head-of-Line Blocking](#the-real-question-why-fifo-why-head-of-line-blocking)
3. [When the Semaphore is the Wrong Primitive](#when-the-semaphore-is-the-wrong-primitive)
4. [Integration with `errgroup`](#integration-with-errgroup)
5. [Designing for Bursty Workloads](#designing-for-bursty-workloads)
6. [Observability — What to Measure](#observability-what-to-measure)
7. [Custom Semaphores When the Stock One Falls Short](#custom-semaphores-when-the-stock-one-falls-short)
8. [Code Review Lens](#code-review-lens)
9. [Failure Modes in Production](#failure-modes-in-production)
10. [Comparison with OS Semaphores](#comparison-with-os-semaphores)
11. [Migration Stories](#migration-stories)
12. [Summary](#summary)

---

## Introduction

At the senior level, the question is no longer "how do I use `semaphore.Weighted`?" — it is "does this subsystem belong on a semaphore at all?" Reaching for `golang.org/x/sync/semaphore` in a code review must be justified against three plausible alternatives: a buffered channel, a custom worker pool, or no gating at all.

This file is the answer to the recurring review question: "I see a `semaphore.Weighted` in this PR. Is it the right tool, sized correctly, and integrated with the rest of the system?"

Three things separate senior-level use from middle-level:

1. The choice is made against a clear alternative, with the trade-offs written down.
2. Sizing is based on measurements (Little's Law, p99 latency, memory profiling) and revisited as load changes.
3. Observability is built in — wait time, queue length proxies, saturation events — because the package itself exposes none.

If you finish this file thinking "maybe I should not use a semaphore here", you have read it correctly. That conclusion is right roughly half the time.

---

## The Real Question: Why FIFO, Why Head-of-Line Blocking

The `x/sync/semaphore` implementation enforces strict FIFO. A heavy acquire at the head blocks lighter acquires behind it, even if the lighter ones would fit. This is a deliberate design choice with real consequences.

### Why FIFO is the default

FIFO is the only fairness policy that gives an upper bound on starvation: every waiter is processed in finite time as long as releases continue. With any priority or "fit-first" policy:

- "Always wake the smallest fit first" starves heavy jobs.
- "Always wake the largest fit first" starves small jobs under heavy contention.
- "Random" produces unpredictable tail latency.

FIFO is the conservative choice. It is the policy you can describe in a single sentence ("oldest waiter wins when it fits") and reason about under load.

### When head-of-line blocking is a problem

Consider:

- Capacity = 1024 (memory bytes).
- A 1000-byte acquire arrives, queues behind a 1024-byte acquire that is parked.
- 1000 bytes are free. The 1000-byte acquire still waits.

In a workload where heavy jobs are rare but slow, head-of-line blocking can hurt p99 latency badly. Two mitigations:

1. **Two semaphores, two tiers.** A "small" semaphore (capacity = 256, weight = 1) and a "large" semaphore (capacity = 16, weight = 1). Small jobs go to the small one; large to the large. They do not queue together.
2. **A custom semaphore with fit-first wakeup, accepting some starvation risk in exchange for better tail latency.** Such an implementation is straightforward to write (use a sorted list or a heap of waiters by weight) but lives outside `x/sync/semaphore`.

### When head-of-line blocking is *not* a problem

If all weights are 1, head-of-line blocking is impossible — every waiter fits the same. Most production usage is weight = 1 (bounded concurrency), and FIFO is exactly the right policy.

---

## When the Semaphore is the Wrong Primitive

`semaphore.Weighted` is the right tool when:

- You need bounded concurrency.
- Acquisitions have variable weights, OR you need context-aware acquisition.
- Strict FIFO fairness is acceptable or desired.

It is the wrong tool when:

### Wrong: you need a `select` arm

```go
select {
case sem.Acquire(ctx, 1): // does not compile — Acquire is not a channel op
case <-other:
}
```

If you need to wait on "either a slot OR some other event", a buffered channel is your tool:

```go
slots := make(chan struct{}, 8)
select {
case slots <- struct{}{}:
    defer func() { <-slots }()
    work()
case msg := <-other:
    handle(msg)
case <-ctx.Done():
    return ctx.Err()
}
```

### Wrong: you need dynamic capacity

`semaphore.Weighted` has fixed capacity. If your concurrency target changes at runtime (autoscaling, adaptive limiter), this package will not adapt. Options:

- Replace the semaphore at config-change boundaries (e.g., on SIGHUP).
- Build a custom adaptive limiter (Vegas, AIMD).

### Wrong: you need priorities

FIFO is the only policy. If you want "premium customers acquire first", you need a priority queue with its own waiter list. Build it.

### Wrong: per-acquire timeout cheaper than per-call context

`Acquire(ctx, n)` needs a `ctx`. For high-volume calls, allocating a `context.WithTimeout` per call has GC cost. If you really need fast per-acquire timeouts, a custom semaphore with a `time.Timer` is more efficient — but measure before assuming this matters.

### Wrong: payload-carrying

If you also need to *pass data* between producer and consumer, that is a channel. Semaphores carry only the count.

### Wrong: the gated resource is a `sync.Pool`

If you are gating access to objects in a pool, `sync.Pool` already has its own life-cycle. Putting a semaphore in front does not add what you think it does. Either use the pool directly or build a proper pool with capacity.

---

## Integration with `errgroup`

The most common production pattern: bounded concurrency with error propagation.

```go
import (
    "context"
    "golang.org/x/sync/errgroup"
    "golang.org/x/sync/semaphore"
)

func processAll(ctx context.Context, items []Item, parallel int64) error {
    sem := semaphore.NewWeighted(parallel)
    g, ctx := errgroup.WithContext(ctx)

    for _, it := range items {
        it := it
        if err := sem.Acquire(ctx, 1); err != nil {
            // errgroup ctx has been cancelled (another goroutine failed)
            // Wait for in-flight goroutines and return the first error.
            return g.Wait()
        }
        g.Go(func() error {
            defer sem.Release(1)
            return process(ctx, it)
        })
    }
    return g.Wait()
}
```

This pattern correctly handles four cases:

1. **All succeed.** The loop completes, `g.Wait()` returns `nil`.
2. **One fails.** `errgroup` cancels its derived ctx; subsequent `Acquire` returns the ctx error; the loop breaks; `g.Wait()` returns the first error.
3. **Parent ctx cancelled.** Same as case 2.
4. **Acquire fails while loop is running.** Pending goroutines complete; their releases unblock nobody since nobody is waiting; `g.Wait()` collects errors.

Note the symmetry: `errgroup` provides "wait for all, propagate first error"; `semaphore` provides "bound the parallelism". Together they replace the verbose `sync.WaitGroup` + manual error channel pattern.

### Watch out for: spawning before Acquire

```go
// BAD: every iteration spawns a goroutine that then blocks on Acquire
for _, it := range items {
    it := it
    g.Go(func() error {
        if err := sem.Acquire(ctx, 1); err != nil { return err }
        defer sem.Release(1)
        return process(ctx, it)
    })
}
```

Now you have N goroutines all parked in `Acquire`. With 1M items and `errgroup`'s `SetLimit`, this is no problem, but here you bypass `SetLimit`. Always `Acquire` *outside* `g.Go` if you want spawning rate-limited.

### `errgroup.SetLimit` vs `semaphore`

Since Go 1.20, `errgroup.Group.SetLimit(n)` adds bounded concurrency to errgroup directly. For weight = 1, you do not need the semaphore at all:

```go
g, ctx := errgroup.WithContext(ctx)
g.SetLimit(8)
for _, it := range items {
    it := it
    g.Go(func() error { return process(ctx, it) })
}
return g.Wait()
```

Cleaner, no `x/sync/semaphore` import. Reach back for the semaphore only when:

- Acquisitions are weighted.
- The semaphore is shared across multiple errgroups or call sites.

---

## Designing for Bursty Workloads

A semaphore with a fixed capacity handles steady-state load well. Bursty workloads expose two failure modes:

### Failure 1: Queue Length Explosion

A burst of 10,000 acquires hits a capacity-8 semaphore. 9,992 goroutines park. Each holds:

- ~2 KB of goroutine stack.
- The closure captured by the parked function (may be much larger).
- Possibly an open connection or buffer.

Memory cost: 20+ MiB for goroutine stacks alone. The producer's responsibility is to back-pressure *before* spawning that many goroutines.

Solution: cap the work queue ahead of the semaphore.

```go
work := make(chan Item, 1000) // bounded queue, blocks producer when full

go func() {
    for w := range work {
        sem.Acquire(ctx, 1)
        go func(w Item) { defer sem.Release(1); process(w) }(w)
    }
}()
```

Now the burst back-pressures at the channel send, not at goroutine spawn.

### Failure 2: Tail Latency Spike

When the semaphore is saturated, p99 latency is dominated by queue wait, not by `process()` runtime. If your SLO is "p99 < 100 ms" and a saturated semaphore is making the wait alone 500 ms, the semaphore is hurting your tail.

Mitigations:

- **Shed load.** Use `TryAcquire` or `Acquire(ctxWithShortTimeout, n)` and fail fast with HTTP 503 / domain-equivalent error.
- **Adaptive limit.** Track p99 latency. When it crosses a threshold, halve the work-queue intake (don't shrink the semaphore — it has fixed capacity).
- **Switch to a real concurrency limiter** like `netflix/concurrency-limits` for AIMD-style adaptation.

---

## Observability — What to Measure

`semaphore.Weighted` exposes no metrics. You must measure around it.

### Wait time (acquire latency)

```go
start := time.Now()
err := sem.Acquire(ctx, n)
waitDuration := time.Since(start)
// emit histogram
```

This is the primary signal. Steady-state wait should be near zero; rising wait time is the first warning of saturation.

### Saturation events

```go
if !sem.TryAcquire(0) {
    // semaphore is saturated right now
    saturationCounter.Inc()
}
```

`TryAcquire(0)` returns `true` if the queue is empty and 0 weight fits (always). Actually — `TryAcquire(0)` returns true unconditionally (queue empty check is the only blocker). So this technique only works if the queue is currently non-empty, which is a different signal.

A more honest method: wrap your `Acquire` and emit a metric when wait > threshold.

### Time-in-use

If you care about per-acquire holding time:

```go
start := time.Now()
if err := sem.Acquire(ctx, n); err != nil { return err }
acquireTime := time.Now()
defer func() {
    sem.Release(n)
    holdHistogram.Observe(time.Since(acquireTime).Seconds())
}()
```

High hold time + high wait time = saturated. Low hold time + high wait time = burst arrivals; the queue is the bottleneck.

### Wrapping for metrics

```go
type InstrumentedSem struct {
    s    *semaphore.Weighted
    name string
}

func (i *InstrumentedSem) Acquire(ctx context.Context, n int64) error {
    start := time.Now()
    err := i.s.Acquire(ctx, n)
    waitMetric.WithLabelValues(i.name).Observe(time.Since(start).Seconds())
    if err != nil {
        failMetric.WithLabelValues(i.name).Inc()
    }
    return err
}
```

Inject this everywhere you would have used `*semaphore.Weighted`. The wrapper is free at compile time and pays for itself the first time you debug a queueing issue.

---

## Custom Semaphores When the Stock One Falls Short

The stock semaphore is FIFO and unfair-by-weight. Two common custom variants:

### Variant 1: LIFO (stack-based)

Useful when newer requests are higher priority (live traffic over background backfills):

```go
type LIFOSem struct {
    mu  sync.Mutex
    cur int64
    cap int64
    stk []chan struct{}
}
// ... push on Acquire, pop on Release wakeup
```

LIFO trades fairness for tail-latency preference toward newest arrivals. Older waiters may starve. Acceptable in scenarios where giving up old work is correct.

### Variant 2: Best-fit

Wake the largest waiter that fits, not the oldest. Maximises capacity utilisation; starves small waiters in bursty load. Use only when total throughput trumps per-call latency.

### Variant 3: Deadline-aware

Wake the waiter whose `ctx` is closest to expiring (rather than first-arrived). Reduces useless waits. Implementable but adds complexity; rarely worth it.

For most workloads, the stock FIFO semaphore wins. If you find yourself reaching for a custom variant, double-check the diagnosis — often the real problem is capacity sizing, not the queueing policy.

---

## Code Review Lens

When reviewing a PR that introduces a semaphore, ask:

1. **What resource is being gated?** If the answer is "concurrency in general", consider whether `errgroup.SetLimit` is sufficient.
2. **What is the capacity?** Is it a constant? Is the constant chosen by measurement or by guess?
3. **What are the weights?** Are they constants or computed? If computed, what is the maximum possible weight, and is it validated against capacity?
4. **Where is the `Release`?** It must be `defer`red immediately after a successful `Acquire`.
5. **Where is `ctx` from?** It must be a real ctx, ideally one that cancels on caller disconnect.
6. **Can `Acquire` return an error?** If yes, is the error path tested?
7. **Could the semaphore deadlock?** Nested acquires of the same semaphore, or acquires of two semaphores in inconsistent order, are red flags.
8. **Is there observability?** Wait-time histogram, saturation counter — at least one.
9. **Is there a fallback?** What does the system do when the semaphore is saturated? 503 / queue overflow / shed load?
10. **Could the same outcome be achieved with a buffered channel?** If yes, prefer the channel.

A "yes" to all of the above is the standard for production-quality semaphore code.

---

## Failure Modes in Production

### Mode 1: Slow `Release` path

If `Release` is paired with cleanup that takes time (logging, metrics emission, defer that closes a body), the `Release` is delayed and queued waiters wait longer than necessary. Keep `Release` close to the freed resource; do post-processing after.

```go
// BAD
defer func() {
    expensiveCleanup() // delays sem.Release
    sem.Release(1)
}()

// GOOD
defer sem.Release(1)
defer expensiveCleanup() // runs after release in LIFO defer order — but reorder if expensiveCleanup must run first
```

Defer order matters. Choose deliberately.

### Mode 2: `Release` after `Acquire` returns an error

```go
err := sem.Acquire(ctx, 1)
defer sem.Release(1) // BUG: releases on error path
if err != nil { return err }
```

You must release **only** on success.

### Mode 3: Goroutine leak hiding under semaphore

A goroutine that holds a slot and never returns leaks both the goroutine and the slot. Eventually the semaphore is permanently saturated. Watch wait-time metrics; they will rise.

### Mode 4: Mismatched capacity and arrival rate

Arrival rate = 1000 req/s; mean hold time = 1s; capacity = 8. By Little's Law, queue length grows unboundedly. Wait time grows linearly with time. Cap capacity or shed load.

### Mode 5: Panic in held-slot work

```go
sem.Acquire(ctx, 1)
defer sem.Release(1)
mayPanic() // panic propagates; deferred Release runs
```

The `defer` saves you. But: if the panic is recovered in a parent function, the goroutine continues and the next iteration may double-release. Audit `recover` sites that span semaphore-holding code.

### Mode 6: Resize attempted

Engineer notices saturation, thinks "I'll just increase capacity":

```go
sem.cap = 16 // does not exist — capacity is unexported and unmodifiable
```

You cannot resize. You must replace the semaphore. Plan for this at design time.

---

## Comparison with OS Semaphores

`golang.org/x/sync/semaphore.Weighted` is *not* an OS semaphore. The difference matters when integrating with non-Go code.

| Aspect | `sem_t` (POSIX) | `semaphore.Weighted` |
|---|---|---|
| Layer | Kernel (futex on Linux) | User-space Go |
| Weight | Unweighted; capacity is integer | Weighted (int64) |
| Acquire / wait | `sem_wait` syscall | `Acquire(ctx, n)`, parks via Go runtime |
| Try | `sem_trywait` | `TryAcquire(n)` |
| Cancellation | `sem_timedwait` | `ctx.Done()` |
| Cross-process | Yes (named semaphores) | No (in-process only) |
| Fairness | Implementation-defined | Documented FIFO |
| Performance (uncontended) | ~50 ns (futex fast path) | ~30 ns (mutex + integer math) |
| Performance (contended) | Microseconds (syscall) | Microseconds (channel close + goroutine wake) |

The Go semaphore is purely user-space. There is no syscall under uncontended acquire. Under contention, the wake path involves a channel close, which the Go scheduler handles. It is faster than an OS semaphore for typical Go workloads because it integrates with the goroutine scheduler — no thread-blocking syscall.

If you need cross-process gating, the Go semaphore cannot help; use a named POSIX semaphore via cgo, or build coordination with a shared file lock / Redis.

---

## Migration Stories

### Story 1: Buffered channel → `semaphore.Weighted`

The team had:

```go
slots := make(chan struct{}, 8)
slots <- struct{}{}
defer func() { <-slots }()
```

Working fine for years. Then memory profiles showed that a small fraction of requests used 100x the memory of average. The team needed to budget memory, not goroutines. They migrated:

```go
mem := semaphore.NewWeighted(512 << 20)
mem.Acquire(ctx, cost)
defer mem.Release(cost)
```

The migration took an afternoon. The hard part was *measuring* `cost`. The semaphore itself was a 5-line change.

### Story 2: `sync.WaitGroup` + error channel → `errgroup` + `semaphore`

Legacy code had:

```go
var wg sync.WaitGroup
errCh := make(chan error, len(items))
sem := make(chan struct{}, 8)
for _, x := range items {
    sem <- struct{}{}
    wg.Add(1)
    go func(x Item) {
        defer wg.Done()
        defer func() { <-sem }()
        if err := process(x); err != nil {
            errCh <- err
        }
    }(x)
}
wg.Wait()
close(errCh)
for err := range errCh {
    if err != nil { return err }
}
```

Rewritten as:

```go
g, ctx := errgroup.WithContext(ctx)
g.SetLimit(8)
for _, x := range items {
    x := x
    g.Go(func() error { return process(ctx, x) })
}
return g.Wait()
```

Fewer lines, clearer semantics, faster shutdown on first error (the original kept running until all items finished). If the team needed weighted, they would use `semaphore.NewWeighted` alongside `errgroup` instead of `SetLimit`.

### Story 3: Semaphore → adaptive limiter

A team running a service against an unreliable downstream had `semaphore.NewWeighted(64)` everywhere. Downstream P99 fluctuated wildly; sometimes the right concurrency was 8, sometimes 128. Fixed capacity was always wrong.

They migrated to a TCP-Vegas-style adaptive concurrency limiter (`netflix/concurrency-limits`). Capacity now changes dynamically based on observed latency. The semaphore moved out of the codebase entirely. Lesson: fixed-capacity primitives have a ceiling. When you need dynamic adaptation, look beyond.

---

## Summary

At senior level, `semaphore.Weighted` is one tool among several:

- **`errgroup.SetLimit`** for unweighted bounded fan-out with error propagation.
- **Buffered channel** for unweighted, selectable, simple gating.
- **`semaphore.Weighted`** for weighted budgets and context-aware acquisition.
- **Custom limiters** for adaptive or priority-aware concurrency control.

The semaphore wins on weighted budgets and on integrating cleanly with `errgroup`. It loses on `select` composability, dynamic capacity, and observability (which you must add yourself).

The senior-level discipline is:

1. Justify the choice against alternatives in code review.
2. Size from measurements, not guesses.
3. Wrap with metrics so saturation is visible.
4. Plan for bursty load — back-pressure before the semaphore, not after.
5. Test the failure modes: cancellation, saturation, capacity-exceeded weight.

Professional level digs into the package internals — the waiter list, the channel-based wake-up, the mutex hot path — and connects them to OS-level primitives. Reading the source becomes essential.
