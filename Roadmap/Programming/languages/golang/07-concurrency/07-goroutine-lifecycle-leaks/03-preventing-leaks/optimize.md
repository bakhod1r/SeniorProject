# Preventing Goroutine Leaks — Optimize

## Table of Contents
1. [Introduction](#introduction)
2. [Optimising Shutdown Latency](#optimising-shutdown-latency)
3. [Reducing Cancellation Overhead](#reducing-cancellation-overhead)
4. [Fast Leak Triage](#fast-leak-triage)
5. [Minimising the Cost of Prevention](#minimising-the-cost-of-prevention)
6. [Avoiding Spawn Churn](#avoiding-spawn-churn)
7. [Hot-Path Cancellation Checks](#hot-path-cancellation-checks)
8. [Optimising the Owning Struct Pattern](#optimising-the-owning-struct-pattern)
9. [When Not to Optimise](#when-not-to-optimise)
10. [Summary](#summary)

---

## Introduction

Prevention is not free. Every `<-ctx.Done()` case, every `defer cancel()`, every `sync.WaitGroup` adds nanoseconds and a few bytes. For most code, the cost is invisible. For hot paths — request routers, message-loop dispatchers, tight scheduling code — it matters.

This file covers two kinds of optimisation:

1. **Latency**: make shutdown fast, make cancellation propagate quickly.
2. **Throughput**: reduce the per-goroutine overhead of prevention.

The optimisations here come after the patterns from earlier files are in place. Optimising a leak-prone codebase is a waste; optimising a clean one pays off.

---

## Optimising Shutdown Latency

### The shutdown wall

A typical shutdown sequence:

```
cancel()
  -> goroutines notice ctx.Done()
  -> goroutines wind down (in-flight work)
  -> goroutines return
  -> Wait returns
  -> Close returns
  -> next component closes
  -> ...
```

The wall-clock time of shutdown is dominated by the slowest "wind down" step. Typical contributors:

- An HTTP server waiting for a long-poll request to finish.
- A database query that doesn't respect context cancellation.
- A retry loop with exponential backoff sleeping past the cancellation.
- A worker pool with one slow job in flight.

### Measure first

Add a shutdown profiler:

```go
func (s *Service) Close() error {
    start := time.Now()
    defer func() {
        log.Printf("Close took %v", time.Since(start))
    }()
    // ...
}
```

In CI, fail if shutdown exceeds the budget. In production, alert if shutdown latency exceeds the 95th percentile of historic shutdowns.

### Quick wins

- **Replace `time.Sleep` with `select { case <-ctx.Done(): return; case <-time.After(d): }`**: the goroutine wakes immediately on cancellation instead of waiting out the sleep.
- **Bound retry sleeps**: cap exponential backoff. A 30-minute retry sleep ignores 30 minutes of cancellation.
- **Make every blocking call context-aware**: `db.QueryContext`, `http.NewRequestWithContext`, `*net.Conn` with `SetDeadline`.
- **Tighten loop iteration**: a CPU-bound loop checking `ctx.Err()` every 10^9 iterations is slow to cancel. Drop to 10^6 or even 10^5 for sub-100ms latency.

### Parallel shutdown

If you have 10 independent components, shut them down in parallel:

```go
func (m *Manager) Close() error {
    g, _ := errgroup.WithContext(context.Background())
    for _, c := range m.components {
        c := c
        g.Go(c.Close)
    }
    return g.Wait()
}
```

Caveat: if components have dependencies (the API depends on the DB; close the API first), parallel close breaks the order. Use parallel only for truly independent components.

### Two-phase shutdown is faster

The drain-then-cancel pattern:

```
Phase 1: stop accepting new work (instant)
Phase 2: wait for in-flight work (most of the time)
Phase 3: force-cancel residual (deadline-bound)
```

Phase 1 is instant: `close(acceptCh)` or `listener.Close()`. Phase 2 has a budget. Phase 3 is the safety net. The total is bounded by the budget.

```go
func (s *Service) Shutdown(ctx context.Context) error {
    s.stopAccepting()
    done := make(chan struct{})
    go func() {
        s.wg.Wait()
        close(done)
    }()
    select {
    case <-done:
        return nil
    case <-ctx.Done():
        s.cancel() // force-cancel
        s.wg.Wait()
        return ctx.Err()
    }
}
```

---

## Reducing Cancellation Overhead

### The cost of `<-ctx.Done()` in a select

A single `<-ctx.Done()` case in a hot select adds:

- A few nanoseconds for the select's case evaluation (one extra channel read attempt).
- A few hundred bytes per goroutine (the context internal state).

For most workloads, the cost is invisible. For loops doing tens of millions of iterations per second per goroutine, it can show up in benchmarks.

### Batch the check

Instead of checking on every iteration, check every N iterations:

```go
for i := 0; i < len(items); i++ {
    if i&0xFFF == 0 {
        if ctx.Err() != nil {
            return ctx.Err()
        }
    }
    crunch(items[i])
}
```

Trade-off: cancellation latency increases by up to N iterations' worth of work. Pick N to match your latency budget.

### Avoid context construction on the hot path

`context.WithValue` and `context.WithCancel` allocate. If a hot path constructs a derived context per call, you pay for those allocations:

```go
// Slow if called millions of times per second
func handle(ctx context.Context, item Item) {
    sub, cancel := context.WithTimeout(ctx, 50*time.Millisecond)
    defer cancel()
    process(sub, item)
}
```

If the per-call timeout is critical, accept the cost. Otherwise, propagate the parent context.

### Don't `select` on `ctx.Done()` when not needed

```go
// Unnecessary
select {
case <-ctx.Done():
    return ctx.Err()
case result := <-doWork():
    return result
}
```

If `doWork` already respects `ctx`, you don't need both. The select is a layer of defence; if your internal call propagates context correctly, drop the select and rely on the call to return.

---

## Fast Leak Triage

When a leak is detected (NumGoroutine spike or pprof showing N goroutines parked in the same place), triage:

### Step 1 — Take a goroutine profile

```bash
go tool pprof http://service/debug/pprof/goroutine
(pprof) top 20
(pprof) list functionName
```

Or in production-safer form, the snapshot text:

```bash
curl -s http://service/debug/pprof/goroutine?debug=2 > stacks.txt
```

The text format is more readable than the pprof binary for one-off investigations.

### Step 2 — Group by stack

```bash
grep -A 30 'goroutine ' stacks.txt | awk '/goroutine/{p=1; print; next} p{print; if(/^$/) p=0}' | sort | uniq -c | sort -rn | head
```

Most leaks have many goroutines parked on the same line. The top of the histogram is your culprit.

### Step 3 — Match to a pattern

The stack will show a select, a channel receive, a syscall. Match against the five patterns:

- Parked on `runtime.gopark` -> select or channel op.
- Parked on `chan receive` or `chan send` -> channels not closed / sender not buffered.
- Parked on `time.Sleep` -> sleep without cancel.
- Parked on `sync.runtime_SemacquireMutex` -> mutex deadlock.
- Parked in `internal/poll.runtime_pollWait` -> blocked syscall (use SetDeadline).

### Step 4 — Find the spawn site

The leaked goroutine's stack shows where it was created (after `created by` in the dump). That line tells you which function to fix.

### Step 5 — Add a goleak test

Once you've identified the leak, add a goleak test that reproduces it. The fix lands with the regression test.

---

## Minimising the Cost of Prevention

### The structural overhead

A typical owning-struct pattern adds:

- One `context.WithCancel` (allocation: ~200 bytes).
- One `chan struct{}` for `done` (allocation: ~96 bytes).
- One `sync.WaitGroup` if multiple goroutines (no allocation; fits in struct).

For a service with 100 long-lived components, the structural overhead is ~30 KB. Negligible.

### Per-call overhead

Per-call context propagation:

- Passing `ctx` as an argument: nothing (pointer).
- `ctx.Done()` channel receive in a select: ~10ns.
- `ctx.Err()` non-receiver check: ~5ns.

For a request rate of 10K req/s with five context-checked layers, the cost is ~250 microseconds/s. Less than 0.03%.

### When to skip the wrapper

The `concurrency.Go` wrapper from professional.md adds tracking. Per-spawn cost: maybe 1 microsecond. For 1000 spawns/s, that's 1 ms/s, negligible. For 1 million spawns/s, it's 1 second/s of overhead — and at that rate, you should not be spawning per call anyway.

Use the wrapper for long-lived goroutines, not per-message workers.

---

## Avoiding Spawn Churn

### Spawn per item is usually wrong

```go
for _, item := range items {
    go process(item) // BAD if items is large
}
```

Spawning a goroutine costs ~2 KB stack and a few hundred bytes of bookkeeping. For a million items, that's 2 GB and significant scheduler pressure.

### Use a fixed pool

```go
g, ctx := errgroup.WithContext(ctx)
g.SetLimit(16)
for _, item := range items {
    item := item
    g.Go(func() error { return process(ctx, item) })
}
return g.Wait()
```

`SetLimit(16)` reuses goroutines: at any time, at most 16 are running. The goroutine churn is bounded by the limit. Memory is ~32 KB instead of ~2 GB.

### Reuse goroutines across requests

A common request-per-goroutine pattern wastes goroutines:

```go
for {
    req := <-incoming
    go handle(req) // a new goroutine for every request
}
```

Better:

```go
for i := 0; i < workers; i++ {
    go func() {
        for {
            select {
            case <-ctx.Done():
                return
            case req := <-incoming:
                handle(req)
            }
        }
    }()
}
```

The workers are reused. No churn.

### Goroutine pooling

For extreme cases (very short-lived goroutines, high spawn rate), use a goroutine pool library:

- `github.com/panjf2000/ants` — popular pool library.
- `github.com/sourcegraph/conc` — modern conc pool.

Caveat: these libraries reintroduce a leak risk if not closed. They are an optimisation, not a substitute for the patterns.

---

## Hot-Path Cancellation Checks

### `ctx.Err()` vs `<-ctx.Done()`

`<-ctx.Done()` in a select is the standard way. `ctx.Err()` is faster for a one-off check:

```go
if ctx.Err() != nil {
    return ctx.Err()
}
```

`Err()` is a single atomic load. `<-Done()` involves a channel operation. In a tight loop without other communication, `Err()` is preferable.

### Caching the Done channel

`ctx.Done()` returns the same channel each time, but the method call has overhead. For tight loops:

```go
done := ctx.Done()
for i := 0; i < n; i++ {
    select {
    case <-done:
        return
    default:
    }
    work(i)
}
```

The cached `done` avoids repeated method calls. Marginal.

### Branch prediction

A `<-ctx.Done()` case in a loop is rarely taken. The CPU's branch predictor learns this and the cost is essentially zero in the steady state. The actual cost is paid only on cancellation, when the prediction misses.

---

## Optimising the Owning Struct Pattern

### Skip `sync.Once` when single-call

```go
type Lite struct {
    cancel context.CancelFunc
    done   chan struct{}
}

func (l *Lite) Close() {
    l.cancel()
    <-l.done
}
```

If `Close` is always called once, you don't need `sync.Once`. Cancelling twice is harmless; receiving on a closed channel is harmless. The pattern is naturally idempotent.

Use `sync.Once` only when concurrent `Close` calls are realistic (multi-goroutine cleanup paths).

### Channel vs WaitGroup

For a single goroutine, `chan struct{}` closed in `defer` is slightly cheaper than `sync.WaitGroup`. For multiple goroutines, `WaitGroup` is cleaner. Don't agonise over this — both are fine.

### Lazy spawn

Some types only need their goroutine if a method is called:

```go
type Maybe struct {
    once sync.Once
    cancel context.CancelFunc
    done   chan struct{}
}

func (m *Maybe) Submit(j Job) {
    m.once.Do(func() {
        ctx, cancel := context.WithCancel(context.Background())
        m.cancel = cancel
        m.done = make(chan struct{})
        go m.run(ctx)
    })
    // ... actual submit ...
}

func (m *Maybe) Close() error {
    if m.cancel == nil {
        return nil
    }
    m.cancel()
    <-m.done
    return nil
}
```

Trade-off: `Close` must handle the "never started" case. Useful for components that are constructed but rarely used.

---

## When Not to Optimise

- Don't add complexity to save 100ns in a path that runs 100 times a day.
- Don't merge cancellation checks if it makes the code harder to read; the readability cost outlasts the performance gain.
- Don't pool goroutines if your spawn rate is under 10K/s; the runtime handles that fine.
- Don't shorten cancellation-check intervals below your latency budget; it just adds noise.

The right order: correctness (no leaks), readability (the patterns are clear), then performance (only if measured to be a bottleneck).

### Profile-driven optimisation

For every prevention-overhead optimisation, run before/after benchmarks:

```bash
go test -bench=. -benchmem -count=10 ./...
```

Compare with `benchstat`. If the difference is under 5%, leave the code as-is and prefer the readable version.

---

## Summary

Optimisation of leak-prevention code falls into two camps:

1. **Shutdown latency**: replace sleeps with select+after; make every blocking call context-aware; bound retries; parallel close where independent; two-phase drain.
2. **Per-call overhead**: cache `ctx.Done()` for tight loops; check `ctx.Err()` every N iterations for CPU-bound work; avoid per-call context construction; use goroutine pools to avoid spawn churn.

For triage, a goroutine profile grouped by stack frame identifies the leak's parking point. Match to one of the five patterns; the fix is the canonical one from junior.md.

The discipline is: correctness first, optimisation second, and only after profiling. The prevention patterns are cheap in absolute terms — measure before assuming otherwise.

See also: [04-pprof-tools](../04-pprof-tools/) for in-depth pprof workflows; [02-detecting-leaks](../02-detecting-leaks/) for routine leak detection without an active incident.
