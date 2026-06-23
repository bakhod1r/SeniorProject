---
layout: default
title: time Package Concurrency — Optimize
parent: time Package Concurrency
grand_parent: Concurrency in Stdlib
ancestor: Go
nav_order: 10
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/23-concurrency-in-stdlib/05-time-package-concurrency/optimize/
---

# time Package Concurrency — Optimize

[← Back](../)

> Concrete optimizations for `time`-heavy code: replacing `time.After` with reused Timers, batching ticker work, choosing the right timer resolution, avoiding monotonic-clock pitfalls. Each scenario has a before/after and expected gain.

---

## Scenario 1 — Replace `time.After` in a hot select loop

**Before:**
```go
for {
    select {
    case j := <-jobs:
        handle(j)
    case <-time.After(50 * time.Millisecond):
        flush()
    case <-ctx.Done():
        return
    }
}
```

Every iteration allocates a fresh `*Timer`. Under heavy load:
- `pprof -alloc_objects` shows `time.NewTimer` near the top.
- Timer heap grows until the unreceived Timers expire.
- `runtime.adjusttimers` time climbs.

**After:**
```go
t := time.NewTimer(50 * time.Millisecond)
defer t.Stop()
for {
    if !t.Stop() {
        select { case <-t.C: default: }
    }
    t.Reset(50 * time.Millisecond)
    select {
    case j := <-jobs:
        handle(j)
    case <-t.C:
        flush()
    case <-ctx.Done():
        return
    }
}
```

On Go 1.23+, the Stop/drain dance can be skipped entirely — `t.Reset(d)` is now race-free.

**Expected gain.** Zero per-iteration allocation. In high-frequency loops (>10K iter/sec) this can reduce GC pressure by 30-60%. Timer heap size stays at 1 instead of growing.

**Verification.** `pprof -alloc_space` before and after; expect `time.NewTimer` to vanish from the profile.

---

## Scenario 2 — Replace `<-time.After(d)` with `<-ctx.Done()` when context already has a deadline

**Before:**
```go
ctx, cancel := context.WithTimeout(parent, time.Second)
defer cancel()
select {
case v := <-ch:
    return v
case <-time.After(time.Second):
    return ErrTimeout
}
```

**After:**
```go
ctx, cancel := context.WithTimeout(parent, time.Second)
defer cancel()
select {
case v := <-ch:
    return v
case <-ctx.Done():
    return ctx.Err()
}
```

The context already schedules its own timer; the `time.After` is redundant.

**Expected gain.** Halve the timer count (1 instead of 2 per call). At high call rates this matters.

---

## Scenario 3 — Batch periodic work into one ticker

**Before:** Five separate goroutines each with their own `time.NewTicker(time.Second)`:
```go
go func() { for range time.NewTicker(time.Second).C { reportMetric1() } }()
go func() { for range time.NewTicker(time.Second).C { reportMetric2() } }()
// ... and so on
```

Five tickers in the heap; five separate wake events per second; five separate goroutines.

**After:** One ticker, one goroutine:
```go
go func() {
    t := time.NewTicker(time.Second)
    defer t.Stop()
    for range t.C {
        reportMetric1()
        reportMetric2()
        // ...
    }
}()
```

**Expected gain.** Fewer scheduler wakes; lower L1 cache pollution; simpler shutdown.

**Tradeoff.** All reports must finish within a tick interval, otherwise drift compounds.

---

## Scenario 4 — Use `time.AfterFunc` instead of a goroutine + Timer

**Before:**
```go
go func() {
    select {
    case <-time.After(time.Second):
        doWork()
    case <-ctx.Done():
    }
}()
```

Allocates: a goroutine (~8 KB stack), a Timer, a channel.

**After:**
```go
t := time.AfterFunc(time.Second, doWork)
go func() {
    <-ctx.Done()
    t.Stop()
}()
```

Still one goroutine, but the timer firing path is the runtime's own — no channel, no select.

**Better:** if you can also bind `Stop` to a parent context cleanly:
```go
t := time.AfterFunc(time.Second, doWork)
context.AfterFunc(ctx, func() { t.Stop() })  // Go 1.21+
```

**Expected gain.** Eliminates the supervisor goroutine in the simple case.

---

## Scenario 5 — Use monotonic time for measurement, not wall clock

**Before:**
```go
start := time.Now().UnixNano()
do()
elapsed := time.Now().UnixNano() - start
```

`.UnixNano()` returns the wall clock as int64. If the wall clock jumps backward during `do()`, `elapsed` can be negative or wildly wrong.

**After:**
```go
start := time.Now()
do()
elapsed := time.Since(start)  // uses monotonic
```

**Expected gain.** Correctness, not perf. Wall-clock jumps are rare but real (NTP slew/step, VM resume, leap-second). Production systems have had alerts fire from negative elapsed.

---

## Scenario 6 — Reduce ticker frequency under low load

**Before:** Always tick every 100 ms regardless of work:
```go
t := time.NewTicker(100 * time.Millisecond)
```

CPU never sleeps deeply; scheduler wakes 10x/sec.

**After:** Adaptive ticker — back off when idle:
```go
interval := 100 * time.Millisecond
t := time.NewTimer(interval)
for {
    select {
    case <-t.C:
        didWork := doMaybe()
        if !didWork {
            interval = min(2*interval, 10*time.Second)
        } else {
            interval = 100 * time.Millisecond
        }
        t.Reset(interval)
    case <-ctx.Done():
        return
    }
}
```

**Expected gain.** Up to 100x reduction in wake count on idle services; CPU can enter deeper sleep states, saving power on cloud instances.

---

## Scenario 7 — Strip monotonic for storage

**Before:**
```go
record.Timestamp = time.Now()
db.Save(record)
```

If you later compare `record.Timestamp == other.Timestamp` after a round-trip through serialization, the monotonic-stripped reload won't match the original.

**After:**
```go
record.Timestamp = time.Now().Round(0) // strip monotonic
db.Save(record)
```

Or always compare via `.Equal()`.

**Expected gain.** Correctness; avoids subtle test flakiness.

---

## Scenario 8 — Coalesce timers in a hot path

**Before:** Inside a request handler:
```go
go func() {
    time.AfterFunc(5*time.Minute, cleanup)
}()
```

10K requests/sec = 10K timers/sec inserted into the heap, all firing 5 minutes later.

**After:** A single janitor that wakes every minute and cleans up everything older than 5 minutes:
```go
// at startup:
go func() {
    t := time.NewTicker(time.Minute)
    defer t.Stop()
    for range t.C {
        cleanupExpired()
    }
}()
```

**Expected gain.** Timer heap stays small (1 entry vs millions); GC pressure drops; cleanup is more cache-friendly because it processes a batch.

---

## Scenario 9 — Use `select` without a default rather than time.Sleep(0)

**Before:**
```go
for !done {
    work()
    time.Sleep(time.Microsecond)  // "give other goroutines a chance"
}
```

Each `time.Sleep` round-trips through the runtime, inserts into the timer heap, and re-schedules. For "yield-only" intent, this is wasteful.

**After:**
```go
for !done {
    work()
    runtime.Gosched()
}
```

**Expected gain.** ~10x less overhead per iteration; no timer-heap pressure.

---

## Scenario 10 — Choose timer resolution to match OS capability

If your service uses `time.Sleep(time.Microsecond)`, on Windows it actually sleeps ~15 ms (default OS scheduler resolution). The microsecond is a lie.

**Solutions, by platform:**
- **Linux:** trust microsecond resolution; the kernel uses hrtimers.
- **Windows:** call `timeBeginPeriod(1)` (via syscall or CGo) to request 1 ms resolution. Don't ask for less; the OS won't deliver.
- **macOS:** trust microsecond resolution (Darwin uses Mach timers).

If your code needs sub-millisecond precision portably, use spin-wait for the last leg:
```go
deadline := time.Now().Add(d)
if d > 100*time.Microsecond {
    time.Sleep(d - 100*time.Microsecond)
}
for time.Now().Before(deadline) {
    runtime.Gosched()
}
```

**Expected gain.** Sub-millisecond precision at the cost of CPU.

---

## Scenario 11 — Avoid timer creation under a tight lock

**Before:**
```go
mu.Lock()
defer mu.Unlock()
t := time.AfterFunc(timeout, expire)
items[key] = item{timer: t}
```

`time.AfterFunc` does atomic operations on the per-P timer heap. Doing it under a contended mutex serializes everyone.

**After:**
```go
t := time.AfterFunc(timeout, expire)
mu.Lock()
items[key] = item{timer: t}
mu.Unlock()
```

**Expected gain.** Reduces critical section length; less lock contention.

---

## Scenario 12 — Pre-allocate Timers in a pool

**Before:** A hot path that creates and destroys Timers at high rate.

**After:** Use a `sync.Pool` of `*Timer`:
```go
var timerPool = sync.Pool{
    New: func() any {
        t := time.NewTimer(time.Hour) // stopped soon
        t.Stop()
        return t
    },
}

func use(d time.Duration) <-chan time.Time {
    t := timerPool.Get().(*time.Timer)
    t.Reset(d)
    // ... ensure return to pool after use
    return t.C
}
```

**Tradeoff.** Tricky to get right: returning to the pool requires the Timer to have been Stopped *and* drained. Not worth it unless profiling shows Timer allocation as a top cost.

**Expected gain.** Eliminates `*Timer` allocations on the hot path. ~50-100 ns per call saved.

---

## Optimisation maxim for timers

**Don't create timers, reuse them.** A new `*Timer` per iteration is the most common timer-related perf bug in Go. Hoisting the Timer outside the loop and calling Reset is almost always the right answer; with Go 1.23 the ergonomics finally make this easy.

**Don't sleep for very short durations.** Sub-100 µs sleeps are dominated by scheduler latency. Spin-wait or accept the OS resolution.

**Don't poll with a small Sleep.** Use a channel, a condition variable, or `runtime.Gosched`.

**Don't compare wall clocks across long durations.** Use monotonic.

These five rules cover 90% of all timer-related performance work.
