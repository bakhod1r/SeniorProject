---
layout: default
title: Optimize
parent: AfterFunc
grand_parent: Time-Based Concurrency
ancestor: Go
nav_order: 10
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/16-time-based-concurrency/02-afterfunc/optimize/
---

# time.AfterFunc — Optimization Scenarios

Nine real performance scenarios. Each describes a starting point, the issue, and the optimization. Apply these patterns when profile data tells you to.

---

## Scenario 1: Replace `time.After` in a tight loop with reused `*time.Timer`

### Before

```go
for {
    select {
    case <-ctx.Done():
        return
    case <-time.After(time.Second):
        doWork()
    }
}
```

### Issue

Each iteration allocates a new `*time.Timer` and channel. At high loop frequency, this is allocation pressure.

CPU profile shows `time.After` and `time.NewTimer` in the top allocators.

### After

```go
t := time.NewTimer(time.Second)
defer t.Stop()
for {
    select {
    case <-ctx.Done():
        return
    case <-t.C:
        doWork()
        t.Reset(time.Second)
    }
}
```

### Impact

Allocation rate drops to near zero. CPU time in `runtime.mallocgc` and `runtime.gcMark` reduces by 5-15% in heavy services.

### Caveat

For Go 1.23+, `time.After` was improved — abandoned timers can be GC'd promptly. The optimisation matters less but is still preferable for hot loops.

---

## Scenario 2: Replace `go func() { time.Sleep(d); f() }()` with `AfterFunc`

### Before

```go
go func() {
    time.Sleep(d)
    f()
}()
```

### Issue

A goroutine is parked for the full `d`, occupying ~2 KB of stack and the cost of being scheduled. At high frequency, this is many parked goroutines.

Goroutine profile shows many in `time.Sleep`.

### After

```go
time.AfterFunc(d, f)
```

### Impact

Goroutine count drops by N (the number of pending sleeps). Memory drops proportionally.

### Caveat

If you need to cancel the goroutine before fire, capture the `*Timer`. If you need to do *more* than `f` (e.g., wait on other channels), keep the goroutine.

---

## Scenario 3: Replace `<-ctx.Done()` goroutines with `context.AfterFunc`

### Before

```go
go func() {
    <-ctx.Done()
    cleanup()
}()
```

### Issue

A goroutine is parked waiting on the context channel. At scale (thousands of contexts), thousands of parked goroutines.

### After (Go 1.21+)

```go
stop := context.AfterFunc(ctx, cleanup)
defer stop()
```

### Impact

Goroutine count drops by N. Memory drops by N × goroutine overhead.

### Caveat

`stop()` is non-blocking. If you needed to wait for `cleanup` to finish, you'll need additional synchronisation.

---

## Scenario 4: Replace per-entry timers with a single sweeper

### Before

```go
type Cache struct {
    items  map[string]string
    timers map[string]*time.Timer
}

func (c *Cache) Set(k, v string, ttl time.Duration) {
    c.timers[k] = time.AfterFunc(ttl, func() {
        delete(c.items, k)
        delete(c.timers, k)
    })
}
```

### Issue

At N=1M entries, ~1.5 GB of timer overhead plus closure size × N. Goroutine spike when many timers fire near simultaneously.

### After

```go
type Cache struct {
    mu     sync.Mutex
    items  map[string]entry
    sweepT *time.Ticker
}

type entry struct {
    v       string
    expires time.Time
}

func (c *Cache) Set(k, v string, ttl time.Duration) {
    c.mu.Lock()
    c.items[k] = entry{v: v, expires: time.Now().Add(ttl)}
    c.mu.Unlock()
}

func (c *Cache) Run(ctx context.Context) {
    c.sweepT = time.NewTicker(30 * time.Second)
    go func() {
        defer c.sweepT.Stop()
        for {
            select {
            case <-ctx.Done():
                return
            case <-c.sweepT.C:
                c.sweep()
            }
        }
    }()
}

func (c *Cache) sweep() {
    c.mu.Lock()
    defer c.mu.Unlock()
    now := time.Now()
    for k, e := range c.items {
        if e.expires.Before(now) {
            delete(c.items, k)
        }
    }
}
```

### Impact

Memory: 1.5 GB → 100 MB.

CPU: O(log N) per Set → O(1). One O(N) sweep every 30s, amortised O(N/30000) per second.

### Caveat

Entries can live up to one sweep interval past their TTL (here 30 s). For TTL-sensitive use cases, shorten the interval — but more frequent sweeps cost more CPU.

---

## Scenario 5: Replace per-entry timers with earliest-deadline scheduler

### Before

Same as Scenario 4. Per-entry timers; doesn't scale.

### After

Maintain a user-space min-heap of pending entries. One `*time.Timer` for the earliest deadline.

```go
type Scheduler struct {
    mu       sync.Mutex
    pending  *entryHeap  // min-heap of *Entry
    timer    *time.Timer
}

func (s *Scheduler) Schedule(e *Entry) {
    s.mu.Lock()
    defer s.mu.Unlock()
    heap.Push(s.pending, e)
    s.armLocked()
}

func (s *Scheduler) armLocked() {
    if s.pending.Len() == 0 { return }
    d := time.Until(s.pending.Peek().Deadline)
    if d < 0 { d = 0 }
    if s.timer == nil {
        s.timer = time.AfterFunc(d, s.fire)
    } else {
        s.timer.Reset(d)
    }
}

func (s *Scheduler) fire() {
    s.mu.Lock()
    now := time.Now()
    var due []*Entry
    for s.pending.Len() > 0 && !s.pending.Peek().Deadline.After(now) {
        due = append(due, heap.Pop(s.pending).(*Entry))
    }
    s.armLocked()
    s.mu.Unlock()
    for _, e := range due {
        e.Handler()
    }
}
```

### Impact

Memory: similar to sweeper but smaller per-entry footprint.

CPU: O(log N) per Schedule (user heap) + O(1) timer Reset. O(k log N) per fire (k = entries due).

Accuracy: sub-millisecond (no sweep interval staleness).

### Caveat

Cancellation requires entry-to-heap-index tracking (use `heap.Remove(s.pending, e.index)`).

---

## Scenario 6: Add jitter to spread fire bursts

### Before

```go
func (c *Cache) Set(k, v string) {
    c.timers[k] = time.AfterFunc(5*time.Minute, func() {
        c.expire(k)
    })
}
```

### Issue

If many entries are inserted at startup, they all expire ~5 minutes later. Mass fire creates a goroutine spike and GC pressure.

### After

```go
func (c *Cache) Set(k, v string) {
    jitter := time.Duration(rand.Intn(int(30*time.Second)))
    c.timers[k] = time.AfterFunc(5*time.Minute+jitter, func() {
        c.expire(k)
    })
}
```

### Impact

Fires spread over 30 s instead of clustering. Goroutine spike eliminated.

### Caveat

Cache entries live slightly longer than the nominal TTL. For most use cases, fine.

---

## Scenario 7: Batch many small operations into one fire

### Before

```go
func log(msg string) {
    time.AfterFunc(100*time.Millisecond, func() {
        backendLog(msg)
    })
}
```

Each log call creates a timer. At 10K logs/s, that's 10K timers per second.

### Issue

Timer churn; goroutine spawn per log call; many small writes to the backend.

### After

```go
type Logger struct {
    mu    sync.Mutex
    buf   []string
    timer *time.Timer
}

func (l *Logger) Log(msg string) {
    l.mu.Lock()
    defer l.mu.Unlock()
    l.buf = append(l.buf, msg)
    if l.timer == nil {
        l.timer = time.AfterFunc(100*time.Millisecond, l.flush)
    }
}

func (l *Logger) flush() {
    l.mu.Lock()
    msgs := l.buf
    l.buf = nil
    l.timer = nil
    l.mu.Unlock()
    backendLogBatch(msgs)
}
```

### Impact

One timer per 100 ms instead of one per log. Batched backend writes.

Throughput improves significantly when backend has per-call overhead.

### Caveat

Logs are delayed up to 100 ms. For most logging, acceptable.

---

## Scenario 8: Pre-compute a duration outside a hot path

### Before

```go
for _, item := range items {
    time.AfterFunc(time.Duration(item.DelaySeconds)*time.Second, item.Process)
}
```

### Issue

The duration arithmetic is per item. For very many items, the multiplication adds up. Plus: if `DelaySeconds` is somehow expensive (e.g., a method call), it's worse.

### After

If items have similar delays:

```go
delays := computeDelaysOnce(items)
for i, item := range items {
    time.AfterFunc(delays[i], item.Process)
}
```

Or, if all items have the same delay:

```go
d := time.Duration(items[0].DelaySeconds) * time.Second
for _, item := range items {
    time.AfterFunc(d, item.Process)
}
```

### Impact

Minor — but in a tight loop scheduling millions of timers, the duration computation overhead matters.

### Caveat

This is a micro-optimisation. Apply only when profile shows duration arithmetic in the top of CPU.

---

## Scenario 9: Reduce closure size

### Before

```go
type Request struct {
    ID       string
    Body     []byte  // 100 KB average
    Headers  http.Header
}

func handle(r *Request) {
    time.AfterFunc(time.Hour, func() {
        log.Printf("late: %s", r.ID)
    })
}
```

### Issue

The closure captures `r`, pinning 100+ KB for an hour per request.

### After

```go
func handle(r *Request) {
    id := r.ID
    time.AfterFunc(time.Hour, func() {
        log.Printf("late: %s", id)
    })
}
```

### Impact

Closure size: ~24 bytes (for the string header) vs. ~100 KB.

At 1000 RPS with hour-long timers, this saves ~360 GB of pinned memory at steady state.

### Caveat

Always audit closures for what they capture. Use `go vet` or custom lint rules if available.

---

## Bonus scenario: Switch from self-rescheduling AfterFunc to NewTicker

### Before

```go
var tick func()
tick = func() {
    process()
    time.AfterFunc(time.Second, tick)
}
time.AfterFunc(time.Second, tick)
```

### Issue

Each call to `AfterFunc` allocates a new timer (since the previous one was one-shot and is gone). Plus, the period drifts (1 s after the previous finish, not 1 s after the start).

### After

```go
ticker := time.NewTicker(time.Second)
go func() {
    for range ticker.C {
        process()
    }
}()
```

### Impact

One timer reused. Strict period (no drift). Cleaner code.

### Caveat

`Ticker` has no built-in "skip if previous still running" semantics. If `process` is slow, ticks pile up in the channel (up to 1 slot buffer; rest are dropped). For "no overlap," add a reentry guard.

---

## How to know when to optimize

Premature optimization is the root of much evil. Apply these scenarios when:

- Profile data shows the relevant hotspot.
- Memory or goroutine count is climbing under load.
- p99 latency is impacted.
- You hit a hard scale wall.

Don't apply preemptively to simple, low-traffic code.

---

## How to verify an optimization worked

1. Take baseline profiles before the change.
2. Apply the change.
3. Take the same profiles after.
4. Compare.

If memory dropped, the change worked. If memory stayed the same, the change didn't help — find another bottleneck.

Always measure. Never assume.

---

## Common pitfalls when optimizing

### Pitfall 1: optimising the wrong thing

You spend a week reducing closure size. Memory drops 5%. Profile shows the actual issue is goroutine spawn cost. You optimised the wrong thing.

Mitigation: always profile first.

### Pitfall 2: introducing bugs

You switch from per-entry timer to sweeper. The sweeper misses entries due to a race. Customers see stale data.

Mitigation: test the optimised path thoroughly. Compare behaviour to the original.

### Pitfall 3: regression after release

The optimised code works at dev scale. At production scale, it fails differently.

Mitigation: canary deploys. Soak tests.

### Pitfall 4: over-optimization

You build a hashed timing wheel. Two months later, the requirement changes; you revert to a simple heap. The hashed wheel was wasted work.

Mitigation: start with the simplest design. Optimise only when forced.

---

## A scoring rubric for an optimization PR

When reviewing an optimization PR, score on:

- Did the author profile first?
- Does the change actually improve the metric?
- Is the new code as clear as the old?
- Are tests updated?
- Are there regression tests for the original behaviour?

If any are "no," send back.

---

## When to revert

An optimization can introduce bugs. Revert if:

- Production metrics show regression in correctness.
- The added complexity outweighs the gain.
- A simpler future change makes the optimization moot.

Don't be attached to optimizations. They serve the system, not your ego.

---

## Tooling tips

- `go test -bench=. -cpuprofile=cpu.out` for micro-benchmarks.
- `pprof` for CPU and heap analysis.
- `runtime/trace` for execution traces.
- `runtime.NumGoroutine()` for goroutine counts.
- `runtime.MemStats` for memory.

Use these aggressively.

---

## Summary

Nine optimization scenarios:

1. Reuse `*time.Timer` instead of `time.After` in hot loops.
2. Use `AfterFunc` instead of `go func() { time.Sleep(d); f() }()`.
3. Use `context.AfterFunc` instead of `go func() { <-ctx.Done(); f() }()`.
4. Use a single sweeper instead of per-entry timers.
5. Use an earliest-deadline scheduler instead of per-entry timers.
6. Add jitter to spread fire bursts.
7. Batch operations to reduce timer churn.
8. Pre-compute durations to avoid per-call arithmetic.
9. Reduce closure size by capturing only what's needed.

Plus a bonus: switch from self-rescheduling AfterFunc to NewTicker.

Apply when profile data demands it. Verify with measurement.

---

## Beyond AfterFunc

These patterns apply to many time-based primitives:

- Reduce allocations (reuse, capture less).
- Batch operations.
- Spread bursts with jitter.
- Switch to coarser-grained scheduling when appropriate.

Once you internalise these meta-patterns, you'll apply them throughout Go (and other languages).

---

## A final exercise

Pick a Go service you maintain. Profile it. Identify the top 3 timer-related hotspots. For each, apply one of the scenarios above.

Did it help? If yes, document and share the learning. If no, profile again — the bottleneck is elsewhere.

---

End of optimize.
