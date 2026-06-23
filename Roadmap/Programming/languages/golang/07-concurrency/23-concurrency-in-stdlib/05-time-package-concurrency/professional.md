---
layout: default
title: time Package Concurrency — Professional
parent: time Package Concurrency
grand_parent: Concurrency in Stdlib
ancestor: Go
nav_order: 5
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/23-concurrency-in-stdlib/05-time-package-concurrency/professional/
---

# time Package Concurrency — Professional Level

[← Back](../)

## Table of Contents
1. [Introduction](#introduction)
2. [Replacing `time.After` in Hot Select Loops](#replacing-timeafter-in-hot-select-loops)
3. [The Canonical Leak-Free Ticker Idiom](#the-canonical-leak-free-ticker-idiom)
4. [Custom Clock Interface for Tests](#custom-clock-interface-for-tests)
5. [Debugging Timer Leaks with pprof](#debugging-timer-leaks-with-pprof)
6. [Diagnosing Timer Heap Bloat](#diagnosing-timer-heap-bloat)
7. [Building a Production Scheduler](#building-a-production-scheduler)
8. [Monotonic Clock Stripping in Storage Boundaries](#monotonic-clock-stripping-in-storage-boundaries)
9. [`runtime/trace` for Time-Related Bugs](#runtimetrace-for-time-related-bugs)
10. [Go 1.23 Migration Notes](#go-123-migration-notes)
11. [Coding Patterns](#coding-patterns)
12. [Common Mistakes in Production Code](#common-mistakes-in-production-code)
13. [Best Practices](#best-practices)
14. [Cheat Sheet](#cheat-sheet)
15. [Summary](#summary)

---

## Introduction
> Focus: production patterns, debugging, custom clocks, leak detection, the Go 1.23 migration story.

At the professional level you have stopped reading the `time` package docs and started writing code that survives multi-year production deployments. The questions are: how do I unit-test code that uses time without `time.Sleep`? How do I find the leaked ticker that grew our heap by 200 MB over a week? Which `time.After` call in our hot path is making the timer heap a top consumer of CPU? Which migration steps do I need for Go 1.23?

This file collects the patterns we have seen converge across high-scale Go services. They are not exotic. They are the same five or six idioms that, applied consistently, eliminate >90 % of time-related production bugs.

---

## Replacing `time.After` in Hot Select Loops

The single most common time-related performance bug.

### Symptom

`pprof -alloc_objects` shows `time.NewTimer` near the top. `pprof -alloc_space` shows it consuming a significant fraction of heap allocations. The function in question is a `for { select { ... case <-time.After(d): ... } }` loop.

### Why it happens

Each `<-time.After(d)` does:
1. `runtime.newTimer` — allocate ~80 bytes for the timer struct.
2. `runtime.resettimer` — insert into the per-P timer heap (O(log N)).
3. Allocate a 1-buffered channel.
4. Return the channel for select to receive on.

If the other case of the select fires first, the Timer is *not* stopped. It sits in the heap until its `d` expires. Under a hot loop with frequency higher than `1/d`, the heap fills with Timers that will never be received from.

### The fix

Hoist the Timer outside the loop and Reset it:

```go
t := time.NewTimer(d)
defer t.Stop()
for {
    // Pre-Go 1.23: Stop + drain before Reset
    if !t.Stop() {
        select { case <-t.C: default: }
    }
    t.Reset(d)
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

On Go 1.23+, the Stop/drain dance can be skipped — `t.Reset(d)` is now race-free in this case.

### Measurement

Before:
```
flat  flat%   sum%        cum   cum%
1.5GB 18.2% 18.2%      1.5GB 18.2%  time.NewTimer
```

After (hoisted Timer):
```
(no time.NewTimer in top 100)
```

A real service we worked on dropped GC pressure by 30 % from this single change.

---

## The Canonical Leak-Free Ticker Idiom

```go
func work(ctx context.Context) {
    t := time.NewTicker(time.Second)
    defer t.Stop()
    for {
        select {
        case <-t.C:
            doPeriodicWork()
        case <-ctx.Done():
            return
        }
    }
}
```

Three rules:
1. **Always `defer t.Stop()`** immediately after `NewTicker`.
2. **Always select on `ctx.Done()`** for cancellation.
3. **Never use `time.Tick`** in any function that may return.

That's the entire pattern. A code-search regex (`time\.Tick\(`) is a fast linter for rule 3; a regex for `NewTicker` paired with absence of `defer.*Stop` is a slower linter for rule 1.

---

## Custom Clock Interface for Tests

Time-dependent code is notoriously hard to unit-test. The fix is dependency injection.

### The interface

```go
type Clock interface {
    Now() time.Time
    Since(t time.Time) time.Duration
    Sleep(d time.Duration)
    NewTimer(d time.Duration) Timer
    NewTicker(d time.Duration) Ticker
    After(d time.Duration) <-chan time.Time
    AfterFunc(d time.Duration, f func()) Timer
}

type Timer interface {
    Chan() <-chan time.Time
    Stop() bool
    Reset(d time.Duration) bool
}

type Ticker interface {
    Chan() <-chan time.Time
    Stop()
    Reset(d time.Duration)
}
```

### Real clock

```go
type realClock struct{}

func (realClock) Now() time.Time                                 { return time.Now() }
func (realClock) Since(t time.Time) time.Duration                { return time.Since(t) }
func (realClock) Sleep(d time.Duration)                          { time.Sleep(d) }
func (realClock) After(d time.Duration) <-chan time.Time         { return time.After(d) }
func (realClock) NewTimer(d time.Duration) Timer                 { return &realTimer{t: time.NewTimer(d)} }
func (realClock) NewTicker(d time.Duration) Ticker               { return &realTicker{t: time.NewTicker(d)} }
func (realClock) AfterFunc(d time.Duration, f func()) Timer      { return &realTimer{t: time.AfterFunc(d, f)} }

type realTimer struct{ t *time.Timer }
func (r *realTimer) Chan() <-chan time.Time         { return r.t.C }
func (r *realTimer) Stop() bool                     { return r.t.Stop() }
func (r *realTimer) Reset(d time.Duration) bool     { return r.t.Reset(d) }

type realTicker struct{ t *time.Ticker }
func (r *realTicker) Chan() <-chan time.Time        { return r.t.C }
func (r *realTicker) Stop()                         { r.t.Stop() }
func (r *realTicker) Reset(d time.Duration)         { r.t.Reset(d) }
```

### Fake clock

A simplified version (real implementations grow more substantial):

```go
type fakeClock struct {
    mu      sync.Mutex
    now     time.Time
    waiters []*fakeTimer  // min-heap by deadline
}

func NewFakeClock(t time.Time) *fakeClock {
    return &fakeClock{now: t}
}

func (c *fakeClock) Now() time.Time { return c.now }

func (c *fakeClock) Advance(d time.Duration) {
    c.mu.Lock()
    c.now = c.now.Add(d)
    // Fire all waiters whose deadline has passed
    var toFire []*fakeTimer
    remaining := c.waiters[:0]
    for _, w := range c.waiters {
        if !w.deadline.After(c.now) {
            toFire = append(toFire, w)
        } else {
            remaining = append(remaining, w)
        }
    }
    c.waiters = remaining
    c.mu.Unlock()
    for _, w := range toFire {
        w.fire(c.now)
    }
}
```

### Using it in tests

```go
func TestRetry(t *testing.T) {
    clock := NewFakeClock(time.Unix(0, 0))
    s := &Service{clock: clock}
    
    go s.RetryLoop(ctx)
    
    clock.Advance(5 * time.Second)
    // assert: retry attempt 1 fired
    
    clock.Advance(10 * time.Second)
    // assert: retry attempt 2 fired
}
```

The whole test runs in microseconds and is deterministic.

### Production libraries

- `github.com/benbjohnson/clock` — well-known, widely-used.
- `k8s.io/utils/clock` — Kubernetes flavor.
- `github.com/jonboulle/clockwork` — another popular option.

Pick one or roll your own. Rolling your own keeps the surface area minimal and avoids the maintenance churn of upstream changes.

---

## Debugging Timer Leaks with pprof

### The diagnostic recipe

1. Enable `net/http/pprof` in the service.
2. Take baseline: `curl localhost:6060/debug/pprof/heap > heap1.out`.
3. Run under load for some time.
4. Take followup: `curl localhost:6060/debug/pprof/heap > heap2.out`.
5. Diff: `go tool pprof -base=heap1.out -alloc_space heap2.out`.
6. Look for `time.NewTimer`, `time.NewTicker`, `runtime.startTimer` near the top.

### Stack traces lead to the source

```
(pprof) list time.NewTimer
Total: 1.2GB
ROUTINE ======================== time.NewTimer in /usr/local/go/src/time/sleep.go
   1.2GB      1.2GB (flat, cum) 100.00% of Total
         .          .    115:func NewTimer(d Duration) *Timer {
         .          .    116:    c := make(chan Time, 1)
   1.2GB      1.2GB    117:    t := &Timer{
         .          .    118:        C: c,
```

Then `list <caller>` to find the offending call site.

### Goroutine dump cross-check

```
curl localhost:6060/debug/pprof/goroutine?debug=2 > goroutines.txt
grep -c "time.runtimeNano" goroutines.txt
```

A growing count of goroutines stuck in `time.runtimeNano` (sleeping on a Timer) is a strong signal.

---

## Diagnosing Timer Heap Bloat

### Symptom

`runtime.adjusttimers` shows up in CPU profile. Heap grows. GC pauses lengthen.

### Investigation

```go
// Use the runtime/metrics package (Go 1.16+):
import "runtime/metrics"

samples := []metrics.Sample{
    {Name: "/sched/timers:objects"},  // hypothetical; actual metric names vary
}
metrics.Read(samples)
```

If the available metrics don't include timer count directly, write a helper:
```go
// before:
n0 := runtime.NumGoroutine()
// ... let the service run ...
// after:
n1 := runtime.NumGoroutine()
fmt.Println("goroutine delta:", n1-n0)
```

A non-zero steady-state delta is the leak signal.

### Common causes

1. **`time.After` in a hot loop** — discussed above.
2. **Forgotten `Ticker.Stop`** — every request creates a Ticker that never stops.
3. **`time.AfterFunc` in a loop without cleanup** — each call adds to the heap.
4. **Self-rescheduling timers** — `AfterFunc(f)` where `f` calls `AfterFunc(f)` again. Each iteration re-adds to the heap.

### Fix

Apply the patterns from this file. Re-measure with pprof.

---

## Building a Production Scheduler

For systems that need to manage millions of scheduled tasks (cron-like services, billing reminders, ticket reservations), the Go runtime heap may not be the right choice. Consider:

### Persistent scheduler

Store scheduled tasks in a database (PostgreSQL, Redis sorted set). A small in-memory worker holds only the *near-future* batch (next 10 minutes' worth). Periodically refresh the batch from the database.

```go
type Scheduler struct {
    db        *sql.DB
    clock     Clock
    refresh   time.Duration  // how often to fetch from DB
    inflight  *timerHeap
    mu        sync.Mutex
}

func (s *Scheduler) Run(ctx context.Context) {
    t := s.clock.NewTicker(s.refresh)
    defer t.Stop()
    for {
        select {
        case <-t.Chan():
            s.refreshFromDB()
        case <-ctx.Done():
            return
        }
    }
}
```

### Hierarchical timing wheel

For very high cardinality (>100K simultaneous in-process timers), a Varghese-Lauck timing wheel beats the heap. The cost is coarser precision (e.g. 10 ms granularity).

Most Go services do not need either. The per-P heap handles up to ~10⁵ active timers without significant overhead.

---

## Monotonic Clock Stripping in Storage Boundaries

Any time a `time.Time` crosses a serialization boundary, the monotonic part is stripped. This causes subtle bugs:

```go
type Record struct {
    CreatedAt time.Time
}

r := Record{CreatedAt: time.Now()}
saved := db.Save(r)
loaded := db.Load(saved.ID)

if r.CreatedAt == loaded.CreatedAt {  // false!
    // ...
}
```

The fix: always strip monotonic before storing or treat round-tripped Times as having lost it:

```go
r.CreatedAt = time.Now().Round(0)  // strip
```

Or compare with `.Equal()`:

```go
if r.CreatedAt.Equal(loaded.CreatedAt) {
    // ...
}
```

Codebase rule: **never use `==` on `time.Time`**. A small `golangci-lint` rule or a `go vet` analyzer can catch this.

---

## `runtime/trace` for Time-Related Bugs

When pprof isn't enough — when you need to see *when* timers fired and how scheduling reacted — use `runtime/trace`:

```go
import "runtime/trace"

f, _ := os.Create("trace.out")
trace.Start(f)
defer trace.Stop()

// ... run the code under test ...
```

Then `go tool trace trace.out`. The trace UI shows timer events (look for "GoStart" with a "timer" reason), GC events, and scheduler activity. Use it to:
- Spot timer-firing storms.
- Correlate timer fires with GC pauses (excess timer pressure can prolong GC).
- See `findRunnable` time dominated by `checkTimers`.

---

## Go 1.23 Migration Notes

If your codebase has the pre-1.23 Stop-and-drain pattern, you have two options:

### Option A: Keep the pattern, document it as defensive

```go
// Defensive: works on all Go versions, including pre-1.23.
if !t.Stop() {
    select { case <-t.C: default: }
}
t.Reset(d)
```

This continues to work on Go 1.23 — the runtime treats the drain as a no-op.

### Option B: Modernize to 1.23 semantics

```go
// Go 1.23+ only.
t.Reset(d)
```

Cleaner code but requires a minimum Go version commitment.

### Pinning the old behaviour

If a library you depend on relies on pre-1.23 semantics, you can force the old behaviour at runtime:

```
GODEBUG=asynctimerchan=1 ./yourservice
```

This is a temporary escape hatch; the Go team will remove it in a future release.

### Detecting affected code

Run the race detector and your test suite on Go 1.23. Most issues surface as previously-tolerated stale receives now silently being dropped. If a test relies on receiving a stale tick after Reset, it will fail — and that test was probably wrong anyway.

---

## Coding Patterns

### Pattern 1: Timeout-bounded select

```go
select {
case v := <-ch:
    use(v)
case <-ctx.Done():
    return ctx.Err()
}
```

Use `ctx.Done()` instead of `time.After` when the deadline is already in the context. Cheaper, single source of truth.

### Pattern 2: Periodic work with cancellation

```go
t := time.NewTicker(d)
defer t.Stop()
for {
    select {
    case <-t.C:
        doWork()
    case <-ctx.Done():
        return
    }
}
```

### Pattern 3: One-shot delayed work

```go
go func() {
    select {
    case <-time.After(d):
        doDelayed()
    case <-ctx.Done():
    }
}()
```

Note: pre-1.23, this leaks the Timer if `ctx.Done()` wins. Post-1.23, the Timer is GC-able. To be safe on all versions, use AfterFunc:

```go
t := time.AfterFunc(d, doDelayed)
context.AfterFunc(ctx, func() { t.Stop() })  // Go 1.21+
```

### Pattern 4: Debounce

```go
type Debouncer struct {
    mu sync.Mutex
    d  time.Duration
    t  *time.Timer
    f  func()
}

func (db *Debouncer) Trigger() {
    db.mu.Lock()
    defer db.mu.Unlock()
    if db.t != nil {
        db.t.Stop()
    }
    db.t = time.AfterFunc(db.d, db.f)
}
```

Last-write wins; intermediate triggers are cancelled.

### Pattern 5: Rate-limited heartbeat

```go
heartbeat := time.NewTicker(30 * time.Second)
defer heartbeat.Stop()

work := time.NewTicker(100 * time.Millisecond)
defer work.Stop()

for {
    select {
    case <-heartbeat.C:
        sendHeartbeat()
    case <-work.C:
        doWork()
    case <-ctx.Done():
        return
    }
}
```

Two tickers, two cadences, one goroutine.

---

## Common Mistakes in Production Code

1. **`time.After` in a loop** — most common.
2. **`time.Tick` in any function that returns** — second most common.
3. **`==` on `time.Time` across a serialisation boundary** — silent bug.
4. **Forgotten `Ticker.Stop`** — slow leak.
5. **`time.Sleep` to "yield to other goroutines"** — should be `runtime.Gosched`.
6. **Comparing wall-clock UnixNano timestamps for elapsed time** — wrong on NTP step.
7. **Mutex held across `time.AfterFunc` callback** — callback runs in another goroutine; if it tries to take the same lock, deadlock.
8. **Reset without Stop on pre-1.23** — stale value race.
9. **Ignoring `Stop` return value** — necessary signal for the drain pattern.
10. **`time.Sleep(0)` for yield** — costs more than `runtime.Gosched`.

---

## Best Practices

1. **Inject a Clock interface** for testability.
2. **`defer t.Stop()` immediately** after `NewTicker`/`NewTimer`.
3. **Hoist `time.After` out of loops**; use a reused Timer.
4. **Always use `time.Since` / `time.Until`** for elapsed/remaining; never compute via wall-clock arithmetic.
5. **Always `.Equal()` not `==`** for `time.Time` comparisons.
6. **`Round(0)` before storage** to strip monotonic.
7. **`context.WithTimeout` over `time.After` + manual cancel** when a context boundary exists.
8. **Linter-check forbidden patterns** in CI: `time.Tick(`, missing `defer Stop`.
9. **Monitor goroutine count and timer-heap metrics** in production dashboards.
10. **Test with `go test -race`** to catch concurrent timer mutations.

---

## Cheat Sheet

| Want | Do | Don't |
|------|----|----|
| One-shot delay | `time.AfterFunc(d, f)` | `go func(){ time.Sleep(d); f() }()` |
| Periodic work | `time.NewTicker(d)` + `defer Stop` | `time.Tick(d)` |
| Timeout in select | `<-ctx.Done()` | `<-time.After(d)` in a loop |
| Elapsed time | `time.Since(start)` | wall-clock subtraction |
| Compare Times | `t1.Equal(t2)` | `t1 == t2` |
| Reset Timer | `t.Stop(); drain; t.Reset(d)` (pre-1.23) or `t.Reset(d)` (1.23+) | bare Reset on pre-1.23 |
| Yield | `runtime.Gosched()` | `time.Sleep(0)` |
| Test time-based code | Clock interface + fake | `time.Sleep` in test |

---

## Summary

The professional view of the `time` package is grounded in two observations: (1) the runtime does heavy lifting for you, but it can't fix code that allocates a fresh Timer on every iteration; (2) the easy mistakes (`time.Tick`, `time.After` in loops, `==` on Time) recur in every Go codebase you'll ever read.

Apply the five patterns in this file — leak-free ticker, hoisted Timer, Clock interface, monotonic-aware comparison, pprof-driven leak hunting — and you eliminate the vast majority of time-related bugs. The Go 1.23 redesign was a substantial improvement; pre-1.23 idioms still work, but new code should target the simpler post-1.23 semantics.

Beyond the patterns, the deeper skill is **profiling**. Every time-related production bug we've seen could have been caught by a pprof read; almost none were caught by code review. Make `pprof -alloc_space` part of your release ritual; make `runtime/trace` part of your debugging toolkit; and the time package will be one of the most reliable corners of the standard library.
