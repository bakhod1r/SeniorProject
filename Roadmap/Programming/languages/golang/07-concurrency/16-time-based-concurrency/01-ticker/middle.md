---
layout: default
title: Middle
parent: Ticker
grand_parent: Time-Based Concurrency
ancestor: Go
nav_order: 3
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/16-time-based-concurrency/01-ticker/middle/
---

# time.Ticker — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [What the Middle Level Adds](#what-the-middle-level-adds)
3. [Reset Semantics from Go 1.15 Onwards](#reset-semantics-from-go-115-onwards)
4. [Monotonic Clock Guarantees](#monotonic-clock-guarantees)
5. [Drift versus Jitter](#drift-versus-jitter)
6. [The Canonical select Loop](#the-canonical-select-loop)
7. [Combining Ticker with a Done Channel](#combining-ticker-with-a-done-channel)
8. [Combining Ticker with context.Context](#combining-ticker-with-contextcontext)
9. [Dynamic Intervals at Runtime](#dynamic-intervals-at-runtime)
10. [Stop on Exit: The Discipline](#stop-on-exit-the-discipline)
11. [Slow Consumers and Dropped Ticks](#slow-consumers-and-dropped-ticks)
12. [Jittered Tickers](#jittered-tickers)
13. [Drift-Corrected Loops](#drift-corrected-loops)
14. [Ticker Versus time.After in a Loop](#ticker-versus-timeafter-in-a-loop)
15. [Ticker Versus time.AfterFunc](#ticker-versus-timeafterfunc)
16. [Testability: Mocking and Fake Clocks](#testability-mocking-and-fake-clocks)
17. [Patterns from Production Codebases](#patterns-from-production-codebases)
18. [Composition with errgroup](#composition-with-errgroup)
19. [Coalescing Ticks with Pending Work](#coalescing-ticks-with-pending-work)
20. [Memory Behaviour and Allocation Profile](#memory-behaviour-and-allocation-profile)
21. [Observability Hooks](#observability-hooks)
22. [Ticker Wrappers Worth Building Once](#ticker-wrappers-worth-building-once)
23. [Interaction with the Garbage Collector](#interaction-with-the-garbage-collector)
24. [Common Mistakes at the Middle Level](#common-mistakes-at-the-middle-level)
25. [Idiomatic Refactors](#idiomatic-refactors)
26. [Worked Example: A Cache Janitor](#worked-example-a-cache-janitor)
27. [Worked Example: An Adaptive Poller](#worked-example-an-adaptive-poller)
28. [Worked Example: A Health Reporter](#worked-example-a-health-reporter)
29. [Cross-Platform Considerations](#cross-platform-considerations)
30. [Reading the Standard Library](#reading-the-standard-library)
31. [Self-Assessment](#self-assessment)
32. [Summary](#summary)

---

## Introduction

You have already used `time.NewTicker`, the `t.C` channel, and `defer t.Stop()` in a `for { select { } }` loop. That is the junior level. The middle level is where you start treating the ticker as a real concurrency primitive whose semantics matter in production.

At the middle level you should be able to:

- Explain when `Reset` is safe to call and when it is racy.
- State what the monotonic clock guarantees and why a ticker survives system clock jumps.
- Distinguish *drift* (cumulative timing error) from *jitter* (per-tick variance) and explain why those are different bugs.
- Write a cancellable ticker loop that integrates with `context.Context` correctly.
- Change a ticker's interval at runtime without losing ticks or leaking goroutines.
- Recognise why `time.After` in a `for` loop is a leak shape and how `NewTicker` avoids it.
- Reason about what happens when the consumer is slower than the ticker rate, and decide between dropping ticks, queueing them, or applying backpressure.

The file is opinionated. Where the standard library leaves you choices, this document recommends one and explains why. The recommendations are based on the Go 1.20+ standard library and on patterns that show up across the largest open-source Go code bases. Go 1.15 introduced safe `Reset`, Go 1.23 changed the channel-buffer and GC behaviour of timers — both transitions matter and are called out where relevant.

A note on scope: every code snippet in this file compiles on Go 1.20 or newer. Where a fragment relies on Go 1.23 semantics, the prose says so explicitly. Examples are written for clarity over cleverness; they show the right shape, not the most condensed version.

---

## What the Middle Level Adds

Junior-level ticker code answers four questions:

1. How do I construct one?
2. How do I read from `C`?
3. How do I stop it?
4. How do I exit the loop?

Middle-level code answers eight more:

5. How do I change the interval after construction?
6. How do I make sure the ticker survives system clock changes?
7. How do I measure and bound timing error?
8. How do I make the loop cancellable from the outside?
9. How do I avoid silently dropping ticks under load?
10. How do I avoid the "thundering herd" problem when many tickers fire at once?
11. How do I write tests that do not wait real wall-clock time?
12. How do I prove the ticker stops when the surrounding component is disposed?

This document walks through each question with code, then revisits them in the [Self-Assessment](#self-assessment) at the end.

---

## Reset Semantics from Go 1.15 Onwards

`Reset(d time.Duration)` changes a ticker's interval to `d` and arranges for the next tick to fire after `d` from the moment of the call. It was added to `*time.Ticker` in Go 1.15. Before 1.15 the only safe way to change the period was to `Stop` the old ticker and `NewTicker` a fresh one — that idiom still compiles but is no longer required.

### Why Reset Exists

A ticker is backed by an entry in the runtime's timer heap. `Stop` removes it; `NewTicker` allocates a new one. Re-allocating churns through the heap on every interval change, which is wasteful in code that adapts rapidly — for example a poll that backs off when results are empty and speeds up when they are not.

`Reset` mutates the existing heap entry in place. No allocation, no new channel, same `t.C`.

```go
t := time.NewTicker(time.Second)
defer t.Stop()

// later: speed it up
t.Reset(100 * time.Millisecond)

// later: slow it down
t.Reset(5 * time.Second)
```

The same `t.C` is reused; downstream consumers do not need to be rewired.

### What Reset Does Not Guarantee

The documentation reads: *"Reset stops a ticker and resets its period to the specified duration. The next tick will arrive after the new period elapses."* That sounds unambiguous, but it leaves three subtle questions:

1. What happens to a tick that was already pending on `t.C` when `Reset` was called?
2. Is `Reset` safe to call concurrently with a receive from `t.C`?
3. Can you `Reset` a ticker that has been `Stop`-ped?

The answers, on current Go, are:

1. A pending tick may or may not still be on the channel after `Reset` returns. The standard library does not drain `t.C` for you. If you care, you must drain it yourself (see below).
2. `Reset` and receiving from `t.C` are independently safe — the runtime synchronises them internally. They are not, however, *atomic*: a receive may complete just before the `Reset` takes effect, observing the old period. If you require that the next received tick be a "post-Reset" tick, drain first.
3. Yes. Calling `Reset` on a stopped ticker re-arms it. This was clarified in Go 1.23. Before 1.23 the documentation was vague on this point and some code defensively allocated a new ticker; that defensive allocation is no longer necessary.

### The Drain-Before-Reset Pattern

If your code path depends on "the next tick must be at least `d` after Reset," drain a possibly-pending tick first:

```go
func resetTicker(t *time.Ticker, d time.Duration) {
    if !t.Stop() {
        select {
        case <-t.C:
        default:
        }
    }
    t.Reset(d)
}
```

This mirrors the well-known idiom for `*time.Timer`. For a `Ticker`, `Stop` returns false if the ticker has already been stopped, so the helper is most useful when you cannot tell whether `Stop` was already called. In practice, the simple form

```go
select {
case <-t.C:
default:
}
t.Reset(d)
```

is enough for most ticker use because tickers fire repeatedly — a stale tick in the channel is almost always benign. The drain is only critical when *consuming an old tick would do harm*, for example if you are using the tick to decide whether to start an expensive operation.

### Reset Does Not Reset the Phase Strictly

Important nuance: `Reset(d)` schedules the next tick `d` from now, not aligned with any previous phase. If you had a 1-second ticker that fired at t=0.0, t=1.0, t=2.0, and you `Reset(time.Second)` at t=2.4, the next tick fires at t=3.4, then t=4.4, t=5.4, and so on. The phase shifts by 0.4 seconds and stays shifted.

If you need phase-aligned reset behaviour — for example "always fire at the top of the second" — you must implement that yourself with a one-shot `time.NewTimer` to absorb the partial interval, then a new ticker.

```go
func alignedTicker(period time.Duration) *time.Ticker {
    now := time.Now()
    wait := period - now.Sub(now.Truncate(period))
    time.Sleep(wait)
    return time.NewTicker(period)
}
```

This is not a `Reset` use case — it is an alignment pattern that uses `Stop` and `NewTicker`. The point is that `Reset` is for changing the period, not for re-phasing.

### Reset on a Ticker That Has Never Fired

`Reset` may be called on a freshly-constructed ticker before any tick has been observed. It simply changes the pending wake-up time. This is convenient for builders that construct a ticker with a placeholder duration and adjust based on config loaded later:

```go
t := time.NewTicker(time.Hour) // placeholder, will be replaced
cfg := loadConfig()
t.Reset(cfg.Interval)
```

The placeholder allocation is cheap and the code reads more naturally than nil-checking and conditional construction.

### Calling Reset After Stop

Post Go 1.23 (and in practice on most earlier versions too) you may call `Reset` on a `Stop`-ed ticker to re-arm it. The internal timer entry is re-added to the heap. This is useful for pause/resume patterns:

```go
type PausableTicker struct {
    t      *time.Ticker
    period time.Duration
}

func NewPausableTicker(period time.Duration) *PausableTicker {
    pt := &PausableTicker{t: time.NewTicker(period), period: period}
    return pt
}

func (pt *PausableTicker) Pause()  { pt.t.Stop() }
func (pt *PausableTicker) Resume() { pt.t.Reset(pt.period) }
func (pt *PausableTicker) C() <-chan time.Time { return pt.t.C }
func (pt *PausableTicker) Close() { pt.t.Stop() }
```

Before 1.23, `Reset` after `Stop` was documented as "may or may not work, depending on whether any drained tick was on the channel." In modern Go this round-trip is reliable.

### Reset and Negative or Zero Durations

`Reset(0)` and `Reset(d)` for negative `d` *panic*. This mirrors `NewTicker(0)`. The runtime cannot schedule a non-positive interval — there is no "fire as fast as possible" mode. If you want unbounded throughput, do not use a ticker; use a tight loop or a buffered channel.

```go
t.Reset(0) // panic: non-positive interval for Ticker.Reset
```

Wrap user-supplied durations:

```go
func safeReset(t *time.Ticker, d time.Duration) {
    if d <= 0 {
        d = time.Millisecond // or whatever floor makes sense
    }
    t.Reset(d)
}
```

### When Reset Is the Wrong Tool

If the new period is dramatically different from the old, and you also want to discard any pending tick, recreating the ticker is just as readable and avoids one corner case (a pending tick observed after the reset). For a tight inner loop that adapts every iteration, `Reset` saves an allocation per change. For a one-time adjustment, `Stop` + `NewTicker` is a fine alternative.

The decision tree:

- High-frequency changes (every iteration of an adaptive loop): use `Reset`.
- One-time mode change (e.g. switch from "boot" interval to "steady-state" interval): either is fine, `Reset` is one line shorter.
- The new period is very different from the old, and stale ticks would mislead the consumer: `Stop` + drain + `NewTicker`, or `Stop` + drain + `Reset`.
- Tests that simulate clock jumps: prefer a fake clock library, do not abuse `Reset`.

---

## Monotonic Clock Guarantees

`time.NewTicker` uses the runtime's monotonic clock for scheduling. The monotonic clock has three properties that distinguish it from the wall clock:

1. **It never goes backward.** Wall-clock time can be set backward by NTP correction or by a sysadmin running `date -s`. Monotonic time cannot.
2. **It is unaffected by leap seconds.** Linux's `CLOCK_MONOTONIC` does not see leap second insertions.
3. **It is calibrated against a stable hardware source.** Modern OSes use TSC (on x86) or a similar invariant counter, scaled by the kernel.

For a ticker, this means the fire times are determined by elapsed monotonic time since the previous fire, not by the wall clock. If the system clock jumps forward by an hour, your 1-second ticker does *not* suddenly catch up by firing 3600 times — it keeps firing once per real second.

### Why This Matters

Consider a heartbeat that sends "alive" every 5 seconds. If you implemented it with a comparison to `time.Now()` against a wall-clock baseline, an NTP correction could either skip heartbeats (clock jumped forward) or send a burst (clock jumped backward). Tickers using monotonic time are immune.

### Verifying the Monotonic Guarantee

You can observe the monotonic clock in the result of `time.Now()` by formatting it: when a `time.Time` carries monotonic data the `String()` form includes an `m=...` suffix. The value sent on `t.C` carries monotonic data, so:

```go
t := time.NewTicker(time.Second)
defer t.Stop()
fmt.Println(<-t.C) // 2024-01-02 15:04:05.001 +0000 UTC m=+1.001
```

That `m=+1.001` part is the monotonic reading: 1.001 seconds after the program started. The receive returns the absolute time *with* the monotonic component attached.

### When the Monotonic Component Is Stripped

Operations that strip monotonic data:

- Marshalling/unmarshalling through JSON, gob, or text.
- `t.Round(0)` and `t.Truncate(d)` (for some `d`).
- Calling `time.Date(...)` directly.

If you subtract two times to compute elapsed duration and one of them has been stripped of monotonic data, you fall back to wall-clock comparison and your "elapsed time" can be wrong by minutes. **For elapsed-time computations always use values that carry monotonic data, ideally values from `time.Now()` or `<-t.C` in the same process.**

### Ticker Versus Wall-Clock Cron

Tickers are great for "every N seconds." They are *not* the tool for "every day at 02:00." For wall-clock-aligned schedules use a cron library (`github.com/robfig/cron`) or build a custom loop that sleeps until the next aligned wall-clock time.

If you naively use a 24-hour ticker, the drift accumulates across days (because intervals do not align to wall-clock midnight) and a leap second can offset the trigger.

---

## Drift versus Jitter

Two timing imperfections look similar at a glance but have different causes and different remedies.

### Drift

Drift is *cumulative* timing error. A 1-second ticker that fires at 1.001s, 2.002s, 3.003s, ..., is drifting by ~1ms per tick. After an hour it is 3.6 seconds behind. Each tick is roughly evenly spaced, but the absolute positions drift.

Causes:

- The runtime cannot guarantee a wake-up at exactly `t = N * period` because the scheduler has finite resolution.
- A heavily loaded system delays the goroutine waking on the tick.
- Code in the handler runs longer than the period, pushing each subsequent fire further out.

Drift is typically *not what `time.Ticker` produces*: the ticker schedules each tick relative to the previous *scheduled* time, not the previous *delivered* time. So if the consumer is slow, the runtime still maintains the *intended* schedule, dropping ticks rather than delaying them. (More on dropping below.)

### Jitter

Jitter is *random per-tick variance*. The mean fire time is right, but individual ticks are noisy: 1.000s, 1.020s, 0.990s, 1.005s, ... around an expected period of 1.0s.

Causes:

- Scheduler preemption.
- GC pauses.
- CPU contention.
- OS scheduler granularity (Linux's `CONFIG_HZ`).

Jitter is a fact of life on any non-real-time OS. For most ticker uses (heartbeats, polls, cache flushes) sub-millisecond jitter is irrelevant. For latency-sensitive use (audio rendering, market data) you need a dedicated real-time scheduler — `time.Ticker` is not it.

### Detecting Drift vs Jitter

Record the time of every tick over a long run. Compute differences:

```go
const period = 100 * time.Millisecond
t := time.NewTicker(period)
defer t.Stop()

var last time.Time
for range t.C {
    now := time.Now()
    if !last.IsZero() {
        d := now.Sub(last)
        fmt.Printf("delta=%v drift_per_tick=%v\n", d, d-period)
    }
    last = now
}
```

If the deltas are stochastic around the target period, you have jitter. If the deltas slope or cluster systematically away from the period, you have drift.

### The Subtle Difference Inside the Runtime

The runtime schedules ticks based on a `when` field stored in the timer entry. After firing, the `when` is incremented by the period for the next tick. This is *intended-time scheduling*, not "now + period." That eliminates drift by design — but only as long as the consumer drains the channel quickly enough that the runtime can keep up.

If the consumer is slower than the period, the runtime drops ticks rather than queueing them. The buffer of `t.C` is 1 (this is true both before and after Go 1.23, though the semantics around buffer 1 are subtly different — see the senior file). When the buffer is full, the runtime skips sending without blocking. The consumer's perceived rate falls; its perceived per-tick interval grows beyond the period.

So: a "drifting" ticker observed in user code almost always means the consumer cannot keep up. The cure is not to "fix the ticker"; it is to either speed up the consumer, increase the period, or add explicit backpressure.

### Tolerances by Application

| Application | Tolerance | Use Ticker? |
|---|---|---|
| Heartbeat for liveness check | ±50ms | yes |
| Polling a queue every 100ms | ±10ms | yes |
| Telemetry flush every 5s | ±100ms | yes |
| Animation frame at 60Hz | ±0.5ms | only with care; consider `time.AfterFunc` and frame budget |
| Audio sample at 44.1kHz | ±10us | no — use audio API |
| Real-time control loop | depends | no — use RT OS |

`time.Ticker` is right for monitoring, polling, batching, and slow human-facing tasks. It is wrong for hard real-time work.

---

## The Canonical select Loop

The shape every middle-level ticker loop takes:

```go
func Loop(ctx context.Context, period time.Duration) {
    t := time.NewTicker(period)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case now := <-t.C:
            doWork(now)
        }
    }
}
```

Five rules to memorise:

1. **Cancellation case is listed first.** It is convention, not requirement; `select` does not guarantee a priority order if both are ready, but listing `ctx.Done()` first signals intent and aids review.
2. **`defer t.Stop()` is on the line after `NewTicker`.** Always. Even on a goroutine that you "know" will exit on its own. If you ever refactor the exit path, the deferred `Stop` survives.
3. **No `time.After` inside the loop body.** A `time.After(d)` in a `select` allocates a new timer per iteration that is not cleaned up until it fires. Use the long-lived ticker.
4. **No `range t.C`.** Range on `t.C` works only if you have a way to break out of the range; with a ticker that has no exit path of its own, you would need to call `Stop` from outside and rely on the loop never noticing — which is brittle. Use `select`.
5. **The handler should be fast.** If `doWork(now)` can block, wrap it in a goroutine or apply a timeout. A tick that takes longer than the period silently starves later ticks.

### Why ctx.Done() First

The position does not change semantics — `select` chooses randomly among ready cases. The custom is to put the exit case first as documentation: anyone reading the loop sees the cancellation path before the work path, which is the order the loop reasons about responsiveness.

A reviewer scanning the loop wants to verify:

1. Will the loop exit when asked?
2. What does it do per tick?

In that order. Putting `ctx.Done()` first matches the order of those questions.

### Variants Worth Knowing

A loop that consumes from a queue *and* runs periodic work:

```go
func Loop(ctx context.Context, period time.Duration, in <-chan Item) {
    t := time.NewTicker(period)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case item := <-in:
            process(item)
        case <-t.C:
            flush()
        }
    }
}
```

The `select` picks whichever case is ready. If multiple are ready it picks one randomly. This is fine: occasional unfairness over many iterations averages out.

A loop with multiple periodic actions on different cadences:

```go
func Loop(ctx context.Context) {
    fast := time.NewTicker(100 * time.Millisecond)
    slow := time.NewTicker(time.Second)
    defer fast.Stop()
    defer slow.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case <-fast.C:
            doFastThing()
        case <-slow.C:
            doSlowThing()
        }
    }
}
```

Each ticker is independent and stops independently. The loop drains whichever fires first.

A loop that *waits forever for cancellation* between ticks (no work cadence — useful for "do something every N seconds OR when nudged"):

```go
func Loop(ctx context.Context, period time.Duration, nudge <-chan struct{}) {
    t := time.NewTicker(period)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case <-t.C:
        case <-nudge:
        }
        doWork()
    }
}
```

Here both `t.C` and `nudge` lead to the same action. The action is outside the `select`, so any path falls through to it. This is the cleanest expression of "every N seconds, or sooner if poked."

### What Not To Do

A loop with no exit path:

```go
for now := range t.C {
    process(now)
}
```

If the surrounding goroutine has no way to break, this is a leak. The `Stop` from outside makes `t.C` no longer receive — but range on a non-closed channel that simply stops sending blocks forever on the next iteration. `Stop` does **not** close `t.C`. The range will block on receive forever.

This is the single most common ticker-related leak in Go code review. Always use `select` with an explicit exit case.

A loop that ignores the value:

```go
for {
    <-t.C
    doWork()
}
```

Works but is unstyled — you cannot add a second case later without restructuring. Always prefer the `select` form so the loop is extensible.

A loop that nests goroutines per tick without bounding them:

```go
for range t.C {
    go heavyWork() // unbounded fan-out
}
```

If `heavyWork` takes longer than `period`, you accumulate goroutines forever. Either bound the in-flight count or run `heavyWork` synchronously.

---

## Combining Ticker with a Done Channel

`context.Context` is the modern way to cancel ticker loops, but a plain `done chan struct{}` is still seen in older code, in libraries that pre-date contexts, and in low-level packages that intentionally avoid the `context` dependency.

The shape:

```go
type Worker struct {
    done chan struct{}
}

func NewWorker() *Worker {
    w := &Worker{done: make(chan struct{})}
    go w.run()
    return w
}

func (w *Worker) run() {
    t := time.NewTicker(time.Second)
    defer t.Stop()
    for {
        select {
        case <-w.done:
            return
        case <-t.C:
            w.tick()
        }
    }
}

func (w *Worker) Close() {
    close(w.done)
}
```

Key invariants:

- `done` is closed exactly once. `close(w.done)` is the signal; receivers see a zero value with `ok=false`.
- The goroutine returns after observing the close. No further ticks are processed.
- `t.Stop()` runs on the way out.

### The "Confirm Exit" Variant

A plain done channel does not tell the caller *when* the goroutine has finished. If you need to wait (for example, before destroying state the goroutine reads), add a `wait` channel that the goroutine closes on exit:

```go
type Worker struct {
    done chan struct{}
    exit chan struct{}
}

func NewWorker() *Worker {
    w := &Worker{done: make(chan struct{}), exit: make(chan struct{})}
    go w.run()
    return w
}

func (w *Worker) run() {
    defer close(w.exit)
    t := time.NewTicker(time.Second)
    defer t.Stop()
    for {
        select {
        case <-w.done:
            return
        case <-t.C:
            w.tick()
        }
    }
}

func (w *Worker) Close() {
    close(w.done)
    <-w.exit // wait for run() to return
}
```

`Close` is now synchronous. When it returns, the goroutine is gone and `t.Stop()` has run.

### Idempotent Close

Closing an already-closed channel panics. If `Close` may be called more than once, guard it:

```go
type Worker struct {
    done   chan struct{}
    exit   chan struct{}
    once   sync.Once
}

func (w *Worker) Close() {
    w.once.Do(func() {
        close(w.done)
        <-w.exit
    })
}
```

`sync.Once` makes `Close` safe to call any number of times.

### Cancelling Through a Method Versus a Channel

A close-only channel is the lightest signal. A method that wraps the close is more Go-idiomatic and allows future additions (logging, metrics, drain). Prefer the method form for any exported API; reserve the bare channel for tightly-scoped internal use.

---

## Combining Ticker with context.Context

The modern, recommended pattern is `context.Context`. It composes with HTTP request handlers, gRPC, `errgroup`, and every other cancellation-aware part of the standard library.

### The Basic Shape

```go
func Loop(ctx context.Context) error {
    t := time.NewTicker(500 * time.Millisecond)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            return ctx.Err()
        case <-t.C:
            if err := doWork(ctx); err != nil {
                return err
            }
        }
    }
}
```

Notes:

- `ctx.Err()` returns either `context.Canceled` or `context.DeadlineExceeded`. Returning it lets the caller distinguish causes.
- `doWork(ctx)` takes the context so it too can exit early.
- The loop's responsibility is *cancellation responsiveness*, not deciding whether the error is fatal. The caller decides.

### Inheriting Cancellation Trees

```go
func Service(parentCtx context.Context) error {
    ctx, cancel := context.WithCancel(parentCtx)
    defer cancel()

    g, ctx := errgroup.WithContext(ctx)
    g.Go(func() error { return Loop(ctx) })
    g.Go(func() error { return Consumer(ctx) })
    return g.Wait()
}
```

When `parentCtx` is cancelled, both `Loop` and `Consumer` exit. If either returns an error, `errgroup` cancels `ctx` and the other follows. Structured concurrency, plus tickers, plus cancellation.

### Timeouts Inside the Handler

A handler that may itself be slow should respect a timeout:

```go
case <-t.C:
    cctx, cancel := context.WithTimeout(ctx, 200*time.Millisecond)
    err := doWork(cctx)
    cancel()
    if err != nil {
        log.Printf("work failed: %v", err)
    }
}
```

`context.WithTimeout` allocates and `cancel` is deferred-less here for tightness — the explicit `cancel()` runs immediately after `doWork` returns. The timeout protects against a slow downstream stalling the loop.

If you forget the `cancel`, the cleanup goroutine for the timeout context leaks until the deadline elapses. Always pair `WithTimeout` with `cancel`.

### Why context Beats a Plain Done Channel

- Universal — every Go function that accepts a `context.Context` integrates with no glue.
- Carries deadlines, not just cancellation. A timeout in `Loop` propagates naturally.
- Avoids the panic-on-double-close hazard.
- Pairs with `errgroup` and `select` naturally.
- Carries request-scoped values (logger, trace span) for free.

The downside is a small allocation per `WithCancel`/`WithTimeout`. For a long-lived service this is irrelevant; for a microsecond-budget hot path it can matter, but you would not be using a ticker there anyway.

### Anti-Pattern: Storing context in a Struct

```go
type Worker struct {
    ctx context.Context // do not do this
}
```

`context.Context` is meant to be passed as a parameter, not stored. Storing it makes the goroutine's lifetime opaque and ties the struct to one context instance. Prefer:

```go
type Worker struct {
    cancel context.CancelFunc
    done   chan struct{}
}
```

Take `parentCtx` as a parameter to `Start(parentCtx)`, derive a child context with `context.WithCancel`, store the `cancel`, and use it from `Stop`.

---

## Dynamic Intervals at Runtime

Many real systems want the ticker period to adapt: faster when there is work, slower when idle; faster after a failure, slower after success; faster during a maintenance window, slower otherwise.

### Adaptive Polling

A typical polling loop:

```go
func Poll(ctx context.Context) error {
    const (
        minPeriod = 100 * time.Millisecond
        maxPeriod = 10 * time.Second
    )
    period := minPeriod
    t := time.NewTicker(period)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            return ctx.Err()
        case <-t.C:
            n, err := pollOnce(ctx)
            if err != nil {
                return err
            }
            switch {
            case n > 0 && period > minPeriod:
                period /= 2
                if period < minPeriod {
                    period = minPeriod
                }
                t.Reset(period)
            case n == 0 && period < maxPeriod:
                period *= 2
                if period > maxPeriod {
                    period = maxPeriod
                }
                t.Reset(period)
            }
        }
    }
}
```

Behaviour:

- Starts fast (100ms).
- Doubles the period each time `pollOnce` returns zero items.
- Halves the period each time `pollOnce` returns at least one item.
- Caps at 10s on the slow end, floors at 100ms on the fast end.

This is *exponential backoff* in the slow direction and *additive speedup* (well, halving — geometric) in the fast direction. It is a reasonable default for queue consumers, change detectors, and similar "poll until something happens" loops.

### Reset Versus Recreate

The example above uses `Reset`. It would work just as well with `Stop` + `NewTicker`:

```go
t.Stop()
t = time.NewTicker(period)
```

Two differences:

1. `Reset` keeps `t.C` stable; references to it from outside the loop remain valid. Recreating swaps `t.C`.
2. `Reset` is allocation-free; recreating allocates a fresh runtime timer.

For a loop that may change interval many times, prefer `Reset`. For a one-shot reconfiguration on a config-reload event, either works.

### Hysteresis to Avoid Thrashing

Adaptive intervals can oscillate if the input is on the boundary of "items present." Add hysteresis so the period changes only after sustained signal:

```go
emptyStreak := 0
busyStreak := 0
// ...
if n > 0 {
    busyStreak++
    emptyStreak = 0
    if busyStreak >= 3 && period > minPeriod {
        period /= 2
        if period < minPeriod {
            period = minPeriod
        }
        t.Reset(period)
        busyStreak = 0
    }
} else {
    emptyStreak++
    busyStreak = 0
    if emptyStreak >= 5 && period < maxPeriod {
        period *= 2
        if period > maxPeriod {
            period = maxPeriod
        }
        t.Reset(period)
        emptyStreak = 0
    }
}
```

Three consecutive "busy" iterations to speed up, five consecutive "empty" iterations to slow down. The asymmetric thresholds give a small bias toward staying fast under bursty load.

### Bounded Exponential Backoff

A common pattern for retry loops:

```go
func RetryWithTicker(ctx context.Context, do func(ctx context.Context) error) error {
    const (
        initial = 100 * time.Millisecond
        max     = 30 * time.Second
    )
    period := initial
    t := time.NewTicker(period)
    defer t.Stop()
    for {
        err := do(ctx)
        if err == nil {
            return nil
        }
        select {
        case <-ctx.Done():
            return ctx.Err()
        case <-t.C:
        }
        period = period * 2
        if period > max {
            period = max
        }
        t.Reset(period)
    }
}
```

Note: this uses the ticker as a *delay generator*, not a steady tick. Each successful retry resets the ticker for the new period. The pattern is debatable — a one-shot `time.NewTimer` with `Reset` would be more correct semantically, since each iteration is a single delay, not a recurring interval. The ticker form is shown because it is what many code bases actually use; in a senior review you would likely refactor to a `Timer`.

### Coalescing Rapidly-Changing Intervals

If your control code changes the interval many times per second, the ticker can be falling all over itself. Coalesce changes with a debounced applier:

```go
type IntervalSetter struct {
    next   atomic.Int64 // time.Duration as int64
    apply  chan struct{}
}

func (s *IntervalSetter) Set(d time.Duration) {
    s.next.Store(int64(d))
    select {
    case s.apply <- struct{}{}:
    default:
    }
}

func (s *IntervalSetter) Run(ctx context.Context, t *time.Ticker) {
    for {
        select {
        case <-ctx.Done():
            return
        case <-s.apply:
            d := time.Duration(s.next.Load())
            if d > 0 {
                t.Reset(d)
            }
        }
    }
}
```

The control side calls `Set(d)` freely; the applier reads the latest stored value when it gets a chance. The ticker sees at most one `Reset` per applier iteration.

### Bounds Checking the User-Supplied Interval

Always sanity-check intervals before passing them to `Reset`:

```go
func sanitize(d time.Duration) time.Duration {
    const (
        floor = time.Millisecond
        ceil  = 24 * time.Hour
    )
    if d < floor {
        return floor
    }
    if d > ceil {
        return ceil
    }
    return d
}

t.Reset(sanitize(userSupplied))
```

A user-supplied "0" panics; a "negative" panics; a "year" likely indicates a bug. Define and enforce a tolerance window.

---

## Stop on Exit: The Discipline

`Stop` is mandatory, full stop. The middle-level rules:

1. Call `Stop` exactly once per `NewTicker`.
2. Call it before the surrounding goroutine returns, so the runtime can release the timer slot.
3. Use `defer` immediately after `NewTicker`. Refactoring the loop should not break the dispose.
4. If the ticker is stored in a struct, the struct's `Close`/`Shutdown` method must call `Stop`.
5. If the ticker is owned by a context-derived loop, `defer Stop()` at the top of the loop function.

### What Stop Does (And Does Not)

`Stop` removes the timer entry from the runtime heap. After `Stop`:

- No further values will be sent to `t.C`.
- `t.C` is *not* closed. Receivers waiting on it will block forever.
- One value may still be observable on `t.C` if the runtime had already sent before `Stop` won the race.

The non-closed channel surprises people. `Stop` mirrors "stop firing"; it does not mirror "close the channel and signal end of stream." The closure must come from the consumer side (the loop exiting on `ctx.Done()`).

### Forgetting Stop

```go
func Heartbeat() {
    t := time.NewTicker(time.Second) // never stopped
    for now := range t.C {
        send(now)
    }
}
```

`Heartbeat` never returns. The ticker entry stays in the runtime heap forever. Every minute that passes, the runtime wakes the goroutine to send into `t.C`. The goroutine runs `send` and loops. No leak yet — until the surrounding component is supposed to be disposed and the caller has no way to make `Heartbeat` exit.

This is the classic "fire and forget" leak. The fix is one of:

- Pass a context. Exit on cancel. `defer t.Stop()`.
- Have the function take a `done` channel and break out.
- Make the function a method of a struct that has a `Close` method.

### Verifying Stop Happens

In tests, wrap the function under test with `goleak.VerifyNone(t)`:

```go
func TestHeartbeat_NoLeak(t *testing.T) {
    defer goleak.VerifyNone(t)
    ctx, cancel := context.WithCancel(context.Background())
    cancel()
    Heartbeat(ctx)
}
```

`goleak` (from `go.uber.org/goleak`) snapshots the goroutine list before and after the test. A leak fails the test. Add it to ticker-related tests at minimum.

### Production Verification

In production, expose `runtime.NumGoroutine()` as a metric. A creeping goroutine count over hours or days is the canonical leak signature. Pair it with `/debug/pprof/goroutine?debug=2`: if you see hundreds of stacks blocked at `time.Sleep` or in a ticker loop, that is your leak.

### Idempotency

`Stop` may be called any number of times. Subsequent calls are no-ops. The first call returns true if it actually removed the timer (i.e. a tick was not yet in flight), false otherwise. The return value is informational — most code ignores it for `Ticker` (it matters more for `Timer`).

### Stop Inside the Loop

Calling `Stop` inside the loop, then continuing, leaves `t.C` empty forever. The loop will block on receive — unless you have other cases in the `select`. If you do have other cases, the loop functions as "ticker disabled," which is a defensible state.

```go
for {
    select {
    case <-ctx.Done():
        return
    case <-t.C:
        if shouldDisable() {
            t.Stop()
            // future iterations select on ctx.Done() and any other cases
        } else {
            doWork()
        }
    case msg := <-otherChan:
        handle(msg)
    }
}
```

To re-enable, `t.Reset(period)`.

### Stop in a Defer Cascade

If the surrounding goroutine has multiple deferred cleanups, the order matters:

```go
defer wg.Done()        // signal "I'm done" last
defer t.Stop()         // stop ticker first
defer close(out)       // close output channel
```

Defers run in reverse order: `close(out)` runs first, then `t.Stop()`, then `wg.Done()`. That is correct — the work is "close the output, then release the ticker, then signal the waiter." If you have a logger that should record exit, defer the log line very last (so it runs first).

---

## Slow Consumers and Dropped Ticks

`Ticker.C` is a buffered channel of capacity 1. (Internally, the runtime's send is non-blocking; if the buffer is full, the value is discarded.) The consequence: if the consumer takes longer than the period, ticks are dropped, not queued.

### A Demonstration

```go
t := time.NewTicker(100 * time.Millisecond)
defer t.Stop()

for i := 0; i < 5; i++ {
    now := <-t.C
    fmt.Println(i, now)
    time.Sleep(350 * time.Millisecond) // slower than period
}
```

Output (timestamps abbreviated):

```
0 t=0.1
1 t=0.45  // not t=0.2 — that tick was dropped
2 t=0.8
3 t=1.15
4 t=1.5
```

Between each iteration, the runtime tried to send ticks at the 200ms, 300ms, and 400ms marks — but the consumer was busy. The buffer absorbed at most one; the rest were dropped silently.

### Why Drop Rather Than Queue

If the runtime queued every missed tick, a slow consumer would see an avalanche of "stale" ticks when it caught up. That is rarely useful: the work attached to a tick is usually "do this thing now," and doing it twice in rapid succession is worse than doing it once.

Dropping also bounds memory: a stalled consumer cannot grow `t.C` without bound.

The trade-off: the consumer cannot observe how many ticks it missed without measuring elapsed time. If you need that signal, record the wall-clock time of each tick and compare against the expected sequence.

### Detecting Drops

A simple wrapper that surfaces drops:

```go
type CountingTicker struct {
    t       *time.Ticker
    period  time.Duration
    last    time.Time
    Dropped atomic.Int64
}

func NewCountingTicker(d time.Duration) *CountingTicker {
    return &CountingTicker{t: time.NewTicker(d), period: d}
}

func (c *CountingTicker) Recv() time.Time {
    now := <-c.t.C
    if !c.last.IsZero() {
        gap := now.Sub(c.last)
        missed := int64(gap/c.period) - 1
        if missed > 0 {
            c.Dropped.Add(missed)
        }
    }
    c.last = now
    return now
}

func (c *CountingTicker) Stop() { c.t.Stop() }
```

`Dropped.Load()` shows how many ticks the consumer missed since start. Useful as a metric to alert on slow consumers.

### Handling Drops

Three options when ticks are dropped:

1. **Ignore the drops.** Fine for idempotent periodic work — "flush the cache every 5s" tolerates running every 5s±N.
2. **Compensate per drop.** "Send N heartbeats" — if you missed 3, send 3. Achievable only if you record what was missed; harder than it sounds.
3. **Apply backpressure.** Slow the producer side. Easier said than done with a ticker: you cannot slow the runtime down. Practical alternative: switch to a self-clocked loop that ticks again after each completion (see below).

### The Self-Clocked Loop

If you cannot tolerate drops, drive the cadence from the work itself:

```go
func Loop(ctx context.Context, period time.Duration) {
    for {
        if err := ctx.Err(); err != nil {
            return
        }
        start := time.Now()
        doWork(ctx)
        elapsed := time.Since(start)
        if elapsed < period {
            select {
            case <-ctx.Done():
                return
            case <-time.After(period - elapsed):
            }
        }
    }
}
```

This guarantees no drops because the next tick is scheduled relative to the previous *completion*. The downside is that long work shifts the schedule (drift), unlike a ticker which holds the schedule. Choose based on whether drift or drops is the bigger sin.

Note: `time.After` is used here only because the loop body owns the wait — there is no goroutine that survives between iterations, so the per-iteration timer allocation is correct. The earlier rule "no `time.After` in a loop" applies when the timer is in a `select` alongside other long-lived cases.

---

## Jittered Tickers

When many processes start at the same time (a deploy, a cron-spawned batch), their tickers can synchronise. Every process ticks at the same wall-clock instants, hammering shared infrastructure (DBs, external APIs) in waves. This is the thundering herd.

### Adding Jitter

Two strategies.

**Random initial offset.** Each instance sleeps a random fraction of the period before constructing the ticker:

```go
func StartHeartbeat(ctx context.Context, period time.Duration) {
    offset := time.Duration(rand.Int63n(int64(period)))
    select {
    case <-ctx.Done():
        return
    case <-time.After(offset):
    }
    t := time.NewTicker(period)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case <-t.C:
            heartbeat()
        }
    }
}
```

After the initial offset, the periods are still synchronised (every instance ticks at the same relative cadence) — but the *phases* differ. Load to the downstream is now spread across the period.

**Per-tick jitter.** Each tick adds a small random delay before doing work:

```go
for {
    select {
    case <-ctx.Done():
        return
    case <-t.C:
        time.Sleep(time.Duration(rand.Int63n(int64(period / 10))))
        doWork()
    }
}
```

The `Sleep` smears the work over a window. Useful when the work itself is the load (e.g. polling an HTTP API) and the *runtime tick* is not.

### The Jittered Sleep, in Detail

The constant `period / 10` is a stylistic choice — 10% of the period. The right value depends on:

- How many instances are running. More instances need more jitter.
- How much of the period your work uses. If work takes 80% of the period, you only have 20% to jitter into.
- How synchronised the start times are. Many cron-launched instances need more.

A reasonable default: jitter the start by a uniform `[0, period)`, then run a steady ticker.

### Cryptographically Safe Random Is Not Needed

`math/rand` is fine for jitter. You do not need `crypto/rand`. The point is decorrelation across instances, not unpredictability against an adversary.

Seed once at program start:

```go
func init() {
    rand.Seed(time.Now().UnixNano())
}
```

On Go 1.20+ the global random source is auto-seeded; you can drop the explicit seed.

### Decorrelated Jitter

For backoff loops, "decorrelated jitter" (a Resilience4j / AWS architecture pattern) avoids synchronisation across retries:

```go
func decorrelated(prev, base, cap time.Duration) time.Duration {
    next := base + time.Duration(rand.Int63n(int64(3*prev)))
    if next > cap {
        next = cap
    }
    return next
}
```

Each retry's delay is sampled from `[base, 3 * prev]`. Convergence is similar to exponential backoff but with built-in dispersion.

### Jittering Many Tickers at Once

If a single service starts dozens of tickers (one per resource, say), and they all use the same period, jitter each independently:

```go
for _, r := range resources {
    go startTicker(r, period, time.Duration(rand.Int63n(int64(period))))
}
```

The per-ticker offsets are independent random samples, so the tickers fan out across the period.

---

## Drift-Corrected Loops

A `Ticker` already corrects drift internally — it schedules each fire relative to the previous *intended* time. So when you say "drift-corrected loop," you usually mean one of:

1. A loop that uses `time.Sleep` instead of a ticker and needs explicit drift correction.
2. A loop that does drifting work between ticks and wants to compensate.
3. A loop that synthesises its own schedule (e.g. "fire at t=0, t=π, t=2π, ...").

### The Sleep-Based Loop With Drift Correction

```go
func DriftCorrectedLoop(ctx context.Context, period time.Duration, fn func()) {
    next := time.Now().Add(period)
    for {
        wait := time.Until(next)
        if wait < 0 {
            wait = 0
        }
        select {
        case <-ctx.Done():
            return
        case <-time.After(wait):
        }
        fn()
        next = next.Add(period)
    }
}
```

`next` advances by exactly `period` each iteration regardless of how long `fn` took. If `fn` ran over budget, `wait` becomes negative; the loop fires immediately, "catching up." Over many iterations, the mean fire rate matches the period.

This is conceptually equivalent to what a `Ticker` does internally, but in user code. The tradeoff: more allocations (`time.After` per iteration), more complexity, but greater control over the schedule.

### Catch-Up Behaviour

If `fn` takes 3 periods, the next three iterations of the loop fire back-to-back to catch up. That can cause cascading load. To bound catch-up:

```go
next = next.Add(period)
if next.Before(time.Now()) {
    next = time.Now().Add(period) // re-baseline, drop the missed beats
}
```

Now the loop skips dropped beats rather than burst-firing. This is the same trade-off a `Ticker` makes by default.

### Phase-Locked Loops

For loops that must align with an external clock (e.g. "fire at the next round second"):

```go
func PhaseLocked(ctx context.Context, fn func()) {
    for {
        now := time.Now()
        next := now.Truncate(time.Second).Add(time.Second)
        wait := next.Sub(now)
        select {
        case <-ctx.Done():
            return
        case <-time.After(wait):
        }
        fn()
    }
}
```

Each iteration computes the next round-second boundary and waits for it. Drift is corrected because the schedule is re-derived every iteration from `time.Now()`. The downside is sensitivity to wall-clock jumps.

A safer hybrid uses a ticker for cadence and `time.Until` for alignment within a tolerance — but it gets complicated quickly.

---

## Ticker Versus time.After in a Loop

The reason a separate `Ticker` exists, despite `time.After` being a one-liner:

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

This looks innocuous. It is not. Three problems.

### Problem 1: Allocation Per Iteration

`time.After(d)` allocates a `time.Timer` every call. In a tight loop that fires often, the GC pressure adds up. Profilers regularly show `time.After` near the top of allocation-heavy services.

### Problem 2: Pre-Go-1.23 Timer Leakage

Before Go 1.23, a timer constructed by `time.After` is not garbage collected until it fires. If `ctx.Done()` triggers and the loop exits, any in-flight timers continue to occupy heap slots until their scheduled fire time. For a 1-second period, that's no big deal. For a 1-hour period in a fast-cancelling system, you can accumulate thousands of unfireable timers.

Go 1.23 changed this: timers without active references are eligible for GC even before firing. But your code may run on older Go versions. The defensive default is: do not use `time.After` inside a loop where the loop might exit before the timer fires.

### Problem 3: Race on First Iteration

`time.After(d)` is scheduled the moment the `select` evaluates its cases. If the context is already cancelled, the timer is still scheduled — and lives until it fires. On a cancel-then-call sequence, you can leak a timer per call.

### The Fix: One Long-Lived Ticker

```go
t := time.NewTicker(time.Second)
defer t.Stop()
for {
    select {
    case <-ctx.Done():
        return
    case <-t.C:
        doWork()
    }
}
```

- One allocation, at construction.
- `defer t.Stop()` releases the heap entry on exit, regardless of pending ticks.
- No per-iteration GC pressure.
- Same readability.

### When time.After Is Fine

In a non-loop context: a single delay, then continue. `time.After` is the right tool:

```go
select {
case <-ctx.Done():
case <-time.After(time.Second):
}
```

In a loop where the period is *truly variable* per iteration and changing it via `Reset` would be awkward: e.g. an exponential-backoff retry loop where each iteration is a one-shot delay, not a recurring tick. Even there, `time.NewTimer` with `Reset` is more efficient than `time.After`. The senior file discusses this in depth.

### Summary Table

| Use case | Right tool |
|---|---|
| Recurring fixed cadence | `time.NewTicker` |
| Recurring variable cadence | `time.NewTicker` + `Reset` |
| One-shot delay | `time.After` or `time.NewTimer` |
| Variable-delay retry loop | `time.NewTimer` + `Reset` |
| Timeout for a single operation | `context.WithTimeout` |

---

## Ticker Versus time.AfterFunc

`time.AfterFunc(d, fn)` runs `fn` in a fresh goroutine after `d`. It is not a ticker — it fires once — but it overlaps in design space.

### When AfterFunc Is Better Than Ticker

- The work is small and you have many independent schedules. `AfterFunc` does not require a goroutine to host a `select` loop; the runtime's timer thread runs `fn` directly.
- You only need a delay before some one-shot action.
- You want to schedule something for "after I'm done with this scope" without holding open a goroutine.

### When Ticker Is Better Than AfterFunc

- The work recurs at a steady cadence.
- You need to coordinate with other channels (cancellation, input). Ticker integrates with `select`; `AfterFunc` does not.
- You need to mutate the schedule (`Reset`). Both support it, but with different ergonomics.
- You want to observe missed fires. Ticker drops silently to `t.C`; `AfterFunc` does not have a buffered surface.

### A Recurring AfterFunc

You *can* build a recurring schedule from `AfterFunc` by having `fn` re-schedule itself:

```go
type Recurring struct {
    mu     sync.Mutex
    fn     func()
    period time.Duration
    timer  *time.Timer
    done   bool
}

func NewRecurring(period time.Duration, fn func()) *Recurring {
    r := &Recurring{fn: fn, period: period}
    r.timer = time.AfterFunc(period, r.tick)
    return r
}

func (r *Recurring) tick() {
    r.mu.Lock()
    done := r.done
    r.mu.Unlock()
    if done {
        return
    }
    r.fn()
    r.mu.Lock()
    if !r.done {
        r.timer.Reset(r.period)
    }
    r.mu.Unlock()
}

func (r *Recurring) Stop() {
    r.mu.Lock()
    r.done = true
    r.timer.Stop()
    r.mu.Unlock()
}
```

That's a poor cousin of `NewTicker`. Use `NewTicker` for recurring schedules unless you have a specific reason not to.

### Concurrency Note on AfterFunc

The callback in `AfterFunc` runs in *its own goroutine*. Multiple `AfterFunc` callbacks can run concurrently. If your `fn` is not safe to call concurrently with itself or with other code, you need explicit synchronisation. With `Ticker`, the consumer loop serialises calls; with `AfterFunc`, you do not get that for free.

---

## Testability: Mocking and Fake Clocks

Real-time ticker tests are slow and flaky. A test that waits for a 500ms tick takes at least 500ms, and on a CI machine under load may take seconds. Test pyramids hate this. The fix is a *fake clock*: a clock interface that test code can advance manually.

### The Clock Interface

Define a narrow interface for the time operations your code uses:

```go
type Clock interface {
    Now() time.Time
    NewTicker(d time.Duration) Ticker
}

type Ticker interface {
    Chan() <-chan time.Time
    Reset(d time.Duration)
    Stop()
}
```

The real implementation wraps `time.NewTicker`:

```go
type realClock struct{}

func (realClock) Now() time.Time { return time.Now() }

func (realClock) NewTicker(d time.Duration) Ticker {
    t := time.NewTicker(d)
    return &realTicker{t: t}
}

type realTicker struct {
    t *time.Ticker
}

func (r *realTicker) Chan() <-chan time.Time { return r.t.C }
func (r *realTicker) Reset(d time.Duration)  { r.t.Reset(d) }
func (r *realTicker) Stop()                   { r.t.Stop() }
```

### The Fake Clock

```go
type fakeClock struct {
    mu      sync.Mutex
    now     time.Time
    tickers []*fakeTicker
}

func newFakeClock(start time.Time) *fakeClock {
    return &fakeClock{now: start}
}

func (c *fakeClock) Now() time.Time {
    c.mu.Lock()
    defer c.mu.Unlock()
    return c.now
}

func (c *fakeClock) NewTicker(d time.Duration) Ticker {
    c.mu.Lock()
    defer c.mu.Unlock()
    t := &fakeTicker{
        c:      make(chan time.Time, 1),
        period: d,
        next:   c.now.Add(d),
    }
    c.tickers = append(c.tickers, t)
    return t
}

func (c *fakeClock) Advance(d time.Duration) {
    c.mu.Lock()
    target := c.now.Add(d)
    c.mu.Unlock()
    for {
        c.mu.Lock()
        next := target
        var fire *fakeTicker
        for _, t := range c.tickers {
            if !t.stopped && !t.next.After(target) && (fire == nil || t.next.Before(fire.next)) {
                next = t.next
                fire = t
            }
        }
        if fire == nil {
            c.now = target
            c.mu.Unlock()
            return
        }
        c.now = next
        fire.next = fire.next.Add(fire.period)
        ch := fire.c
        firingTime := c.now
        c.mu.Unlock()
        select {
        case ch <- firingTime:
        default:
        }
    }
}
```

```go
type fakeTicker struct {
    c       chan time.Time
    period  time.Duration
    next    time.Time
    stopped bool
}

func (t *fakeTicker) Chan() <-chan time.Time { return t.c }
func (t *fakeTicker) Reset(d time.Duration)  { t.period = d }
func (t *fakeTicker) Stop()                  { t.stopped = true }
```

The fake clock advances by manual call. Each `Advance` walks the registered tickers in order, firing each that is due, in monotonic order, with the per-tick "now" set correctly.

### Using It in a Test

```go
func TestLoop(t *testing.T) {
    clk := newFakeClock(time.Unix(0, 0))
    ctx, cancel := context.WithCancel(context.Background())
    defer cancel()

    counts := make(chan int, 10)
    go Loop(ctx, clk, 100*time.Millisecond, func() { counts <- 1 })

    clk.Advance(550 * time.Millisecond)
    cancel()

    total := 0
    for {
        select {
        case <-counts:
            total++
        default:
            // drain
            goto done
        }
    }
done:
    if total != 5 {
        t.Fatalf("expected 5 ticks, got %d", total)
    }
}
```

The test runs in microseconds and the result is deterministic.

### Existing Libraries

You do not have to write a fake clock yourself. Battle-tested options:

- [`github.com/benbjohnson/clock`](https://github.com/benbjohnson/clock) — the de facto standard, includes `Mock` with full `After`, `AfterFunc`, `Ticker`, `Timer` support.
- [`github.com/jonboulle/clockwork`](https://github.com/jonboulle/clockwork) — alternative with similar surface.
- The standard library `testing/synctest` (Go 1.24+, experimental in 1.23) lets you write tests against the real `time` package with fast simulated time. Worth watching but not yet default.

For new code, depend on `benbjohnson/clock`; it gives you nine-tenths of what you need without inventing your own abstraction.

### Avoiding the Clock Abstraction

Not every codebase needs a clock abstraction. If your ticker tests can tolerate real time and short periods (millisecond-scale), and the test count is small, plain `time.NewTicker` is fine. The threshold to introduce the abstraction is:

- More than a handful of time-dependent tests, OR
- Need to simulate hours or days of elapsed time, OR
- Flaky tests due to CI scheduling jitter.

Hit any of those, switch to a fake clock.

### Bridging Real Time and Fake Time in One Codebase

A common evolution: a project starts with `time.NewTicker` everywhere, gains too many slow tests, decides to refactor. The migration looks like a series of small steps:

1. Add a `Clock` interface and a default real implementation.
2. Inject the clock where the new tests need it.
3. Leave old code paths on real time until they need testing.
4. Eventually, run a `gopls` rename to push the interface everywhere.

Avoid the temptation to "do it once, properly" across a large code base. The smaller migration is faster, less risky, and lands the value where it pays off first.

### The Synctest Experiment

Go 1.24's `testing/synctest` package (currently a synctest_internal flag in 1.23) takes a different approach: simulate time within a goroutine bubble. Code inside `synctest.Run` sees a virtual time that advances when *all goroutines are blocked*. The standard `time.NewTicker` works inside the bubble, with the bubble's clock.

```go
func TestLoop_Synctest(t *testing.T) {
    synctest.Run(func() {
        ctx, cancel := context.WithCancel(context.Background())
        defer cancel()
        ch := make(chan time.Time, 10)
        go func() {
            t := time.NewTicker(time.Second)
            defer t.Stop()
            for {
                select {
                case <-ctx.Done():
                    return
                case now := <-t.C:
                    ch <- now
                }
            }
        }()
        time.Sleep(3500 * time.Millisecond)
        cancel()
        close(ch)
        var ticks []time.Time
        for v := range ch {
            ticks = append(ticks, v)
        }
        if len(ticks) != 3 {
            t.Fatalf("expected 3 ticks, got %d", len(ticks))
        }
    })
}
```

When this stabilises in Go 1.24+, the manual `Clock` abstraction becomes mostly unnecessary. For now, stay with `benbjohnson/clock` for production code.

---

## Patterns from Production Codebases

The following patterns appear in many large Go services. Treat them as building blocks; each composes with the others.

### Pattern 1: Heartbeat Goroutine

A service publishes liveness on a fixed cadence. The heartbeat goroutine is its own component:

```go
type Heartbeat struct {
    period time.Duration
    send   func(context.Context, time.Time) error
    cancel context.CancelFunc
    done   chan error
}

func NewHeartbeat(period time.Duration, send func(context.Context, time.Time) error) *Heartbeat {
    return &Heartbeat{period: period, send: send}
}

func (h *Heartbeat) Start(parent context.Context) {
    ctx, cancel := context.WithCancel(parent)
    h.cancel = cancel
    h.done = make(chan error, 1)
    go h.run(ctx)
}

func (h *Heartbeat) Stop() error {
    if h.cancel == nil {
        return nil
    }
    h.cancel()
    return <-h.done
}

func (h *Heartbeat) run(ctx context.Context) {
    var err error
    defer func() { h.done <- err }()
    t := time.NewTicker(h.period)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            err = ctx.Err()
            return
        case now := <-t.C:
            if e := h.send(ctx, now); e != nil {
                err = e
                return
            }
        }
    }
}
```

Properties: synchronous `Stop`, error propagation, idempotent if `Stop` is called twice (well, the second call would block on a drained channel — guard with `sync.Once` for full safety).

### Pattern 2: Periodic Flush

A buffer that accumulates writes and flushes either on size threshold or on a timer:

```go
type Flusher struct {
    mu       sync.Mutex
    buf      []Item
    maxSize  int
    period   time.Duration
    flush    func(ctx context.Context, items []Item) error
    cancel   context.CancelFunc
    done     chan struct{}
    notify   chan struct{}
}

func NewFlusher(maxSize int, period time.Duration, flush func(ctx context.Context, items []Item) error) *Flusher {
    return &Flusher{
        maxSize: maxSize,
        period:  period,
        flush:   flush,
        notify:  make(chan struct{}, 1),
    }
}

func (f *Flusher) Add(item Item) {
    f.mu.Lock()
    f.buf = append(f.buf, item)
    overFull := len(f.buf) >= f.maxSize
    f.mu.Unlock()
    if overFull {
        select {
        case f.notify <- struct{}{}:
        default:
        }
    }
}

func (f *Flusher) Start(parent context.Context) {
    ctx, cancel := context.WithCancel(parent)
    f.cancel = cancel
    f.done = make(chan struct{})
    go f.run(ctx)
}

func (f *Flusher) Stop(ctx context.Context) error {
    if f.cancel == nil {
        return nil
    }
    f.cancel()
    select {
    case <-f.done:
    case <-ctx.Done():
        return ctx.Err()
    }
    return f.flushOnce(context.Background())
}

func (f *Flusher) run(ctx context.Context) {
    defer close(f.done)
    t := time.NewTicker(f.period)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case <-t.C:
            _ = f.flushOnce(ctx)
        case <-f.notify:
            _ = f.flushOnce(ctx)
        }
    }
}

func (f *Flusher) flushOnce(ctx context.Context) error {
    f.mu.Lock()
    if len(f.buf) == 0 {
        f.mu.Unlock()
        return nil
    }
    items := f.buf
    f.buf = make([]Item, 0, f.maxSize)
    f.mu.Unlock()
    return f.flush(ctx, items)
}
```

Two triggers — the ticker and the size threshold — share one flush path. The mutex protects the buffer; the notify channel coalesces threshold signals (capacity 1, non-blocking send).

`Stop` cancels the goroutine, waits for it to finish, then runs one final flush to drain any remaining items. Production hardening would add metrics, error handling on flush, and bounded retries.

### Pattern 3: Cache Janitor

A background goroutine that periodically removes expired entries from an in-memory cache:

```go
type Cache struct {
    mu       sync.Mutex
    entries  map[string]entry
    period   time.Duration
    cancel   context.CancelFunc
    done     chan struct{}
}

type entry struct {
    value   any
    expires time.Time
}

func NewCache(period time.Duration) *Cache {
    return &Cache{entries: make(map[string]entry), period: period}
}

func (c *Cache) Start(parent context.Context) {
    ctx, cancel := context.WithCancel(parent)
    c.cancel = cancel
    c.done = make(chan struct{})
    go c.janitor(ctx)
}

func (c *Cache) Stop() {
    c.cancel()
    <-c.done
}

func (c *Cache) janitor(ctx context.Context) {
    defer close(c.done)
    t := time.NewTicker(c.period)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case now := <-t.C:
            c.sweep(now)
        }
    }
}

func (c *Cache) sweep(now time.Time) {
    c.mu.Lock()
    defer c.mu.Unlock()
    for k, e := range c.entries {
        if now.After(e.expires) {
            delete(c.entries, k)
        }
    }
}
```

The janitor holds the cache mutex for the entire sweep. For caches with many entries, this is a latency hazard — `Get` and `Set` block during the sweep. Two improvements:

1. Sweep in batches, releasing the lock between batches.
2. Use a more granular data structure (sharded map) so each sweep only touches one shard's worth.

Both are out of scope for the ticker discussion; what matters here is that the periodic structure is identical.

### Pattern 4: Retry With Inner Ticker

A pull-based reconciler that retries indefinitely on failure, with a steady cadence:

```go
func Reconcile(ctx context.Context, period time.Duration, reconcile func(ctx context.Context) error) {
    t := time.NewTicker(period)
    defer t.Stop()
    for {
        if err := reconcile(ctx); err != nil {
            log.Printf("reconcile: %v", err)
        }
        select {
        case <-ctx.Done():
            return
        case <-t.C:
        }
    }
}
```

Two notable details:

- The `reconcile` call runs *first*, before any tick. The first iteration does not wait for the period.
- After a failure, the next attempt is at the next tick — no exponential backoff. Errors do not slow the loop. This is correct for reconcilers where the same operation is idempotent and you want consistent latency to recovery.

If you want backoff on error, use the dynamic-interval pattern from earlier in this document.

### Pattern 5: Multiplexed Periodic Work

A service runs several periodic tasks at different cadences. Each is small and would be wasteful as a dedicated goroutine. Multiplex them in one loop:

```go
type Job struct {
    name   string
    period time.Duration
    next   time.Time
    do     func(ctx context.Context) error
}

func Multiplexer(ctx context.Context, jobs []*Job) {
    if len(jobs) == 0 {
        return
    }
    for _, j := range jobs {
        j.next = time.Now().Add(j.period)
    }
    for {
        // Find soonest job
        soonest := jobs[0]
        for _, j := range jobs[1:] {
            if j.next.Before(soonest.next) {
                soonest = j
            }
        }
        wait := time.Until(soonest.next)
        if wait < 0 {
            wait = 0
        }
        select {
        case <-ctx.Done():
            return
        case <-time.After(wait):
        }
        if err := soonest.do(ctx); err != nil {
            log.Printf("job %s: %v", soonest.name, err)
        }
        soonest.next = soonest.next.Add(soonest.period)
    }
}
```

Note: this is one of the few places `time.After` inside a loop is *correct* — the wait duration is variable per iteration, recreating the timer is unavoidable, and the loop's exit path is solid. For consistency with the rest of this document you could replace it with a `time.NewTimer` and `Reset`, saving the per-iteration allocation. For a small handful of jobs the difference is irrelevant.

When `len(jobs)` grows beyond ~50, switch to a heap (the runtime's own timer heap is, conceptually, doing exactly this).

### Pattern 6: Producer-Consumer With Periodic Flush

A producer feeds a consumer through a channel; a ticker triggers periodic actions on the consumer side:

```go
func Consumer(ctx context.Context, in <-chan Item, period time.Duration) {
    t := time.NewTicker(period)
    defer t.Stop()
    var batch []Item
    for {
        select {
        case <-ctx.Done():
            return
        case item, ok := <-in:
            if !ok {
                if len(batch) > 0 {
                    flush(batch)
                }
                return
            }
            batch = append(batch, item)
        case <-t.C:
            if len(batch) > 0 {
                flush(batch)
                batch = batch[:0]
            }
        }
    }
}
```

The consumer accumulates items until the next tick, then flushes. Channel close triggers a final flush. The producer is decoupled from the cadence.

This is the heart of many batch-write systems: log shippers, metrics emitters, queue backends.

---

## Composition with errgroup

`errgroup.Group` is the standard library's structured-concurrency primitive (in `golang.org/x/sync/errgroup`). It composes naturally with ticker loops.

### Multiple Tickers in One errgroup

```go
func Service(ctx context.Context) error {
    g, ctx := errgroup.WithContext(ctx)
    g.Go(func() error { return heartbeat(ctx, 5*time.Second) })
    g.Go(func() error { return reconcile(ctx, time.Minute) })
    g.Go(func() error { return metrics(ctx, 10*time.Second) })
    return g.Wait()
}
```

Each goroutine is a ticker loop. `errgroup.WithContext` cancels the shared context as soon as any goroutine errors. The first non-nil error is returned from `Wait`.

If a ticker loop only returns on context cancellation, returning `ctx.Err()` from it is fine — `errgroup` ignores it because the cancellation came from outside the group, not from the loop's own failure. (Actually `errgroup` records the first error; if `ctx.Err()` is `context.Canceled`, `Wait` returns it. This is usually acceptable.)

### Wrapping a Loop That Should Not Stop on Error

If `reconcile` should retry on error rather than abort the service, do not return the error:

```go
func reconcile(ctx context.Context, period time.Duration) error {
    t := time.NewTicker(period)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            return ctx.Err()
        case <-t.C:
            if err := doReconcile(ctx); err != nil {
                log.Printf("reconcile error: %v", err)
                // do not return; keep looping
            }
        }
    }
}
```

The function's return value now means "loop has exited because of cancellation," not "loop has exited because of error." That distinction is convention; document it on the function.

### Pairing With a Supervisor

For loops that may panic, wrap with a supervisor that restarts on failure:

```go
func supervise(ctx context.Context, name string, run func(ctx context.Context) error) error {
    backoff := 100 * time.Millisecond
    for {
        if err := ctx.Err(); err != nil {
            return err
        }
        err := safeRun(ctx, run)
        if ctx.Err() != nil {
            return ctx.Err()
        }
        log.Printf("supervised %q exited: %v; restarting in %v", name, err, backoff)
        select {
        case <-ctx.Done():
            return ctx.Err()
        case <-time.After(backoff):
        }
        if backoff < 30*time.Second {
            backoff *= 2
        }
    }
}

func safeRun(ctx context.Context, run func(ctx context.Context) error) (err error) {
    defer func() {
        if r := recover(); r != nil {
            err = fmt.Errorf("panic: %v", r)
        }
    }()
    return run(ctx)
}
```

`supervise` wraps a ticker loop so a panic does not kill the surrounding errgroup. Use it for long-running background work; do not use it for transient request handlers — those should fail loudly.

---

## Coalescing Ticks with Pending Work

A scenario: every tick triggers an outbound HTTP call. If the call takes longer than the period, ticks pile up — well, they don't, the buffer is 1, so they are dropped. But what *should* happen?

Two strategies.

### Strategy A: Drop Ticks (Current Default)

The default ticker behaviour. The slow consumer means the effective rate falls. Use this when each fire is independent ("flush whatever is in the buffer").

### Strategy B: Coalesce Pending Calls

Only one call is in flight at any time. Subsequent ticks during a call are remembered but not stacked:

```go
type Coalesced struct {
    period time.Duration
    do     func(ctx context.Context) error
    notify chan struct{}
}

func NewCoalesced(period time.Duration, do func(ctx context.Context) error) *Coalesced {
    return &Coalesced{period: period, do: do, notify: make(chan struct{}, 1)}
}

func (c *Coalesced) Run(ctx context.Context) error {
    t := time.NewTicker(c.period)
    defer t.Stop()
    go c.worker(ctx)
    for {
        select {
        case <-ctx.Done():
            return ctx.Err()
        case <-t.C:
            select {
            case c.notify <- struct{}{}:
            default:
            }
        }
    }
}

func (c *Coalesced) worker(ctx context.Context) {
    for {
        select {
        case <-ctx.Done():
            return
        case <-c.notify:
            _ = c.do(ctx)
        }
    }
}
```

Two goroutines: one ticks, one works. The ticker pushes into a buffer-1 channel non-blockingly; if the worker is busy, the new tick is "merged" into the existing pending signal.

Trade-off: at most one extra call is "owed" at any moment. If the work falls far behind, you do not catch up — but you also do not pile up either. This is the right behaviour for idempotent "refresh from upstream" patterns.

### Strategy C: Queue and Catch Up

Every tick is recorded and eventually processed. Use a larger buffer or a slice:

```go
type Queued struct {
    period time.Duration
    do     func(ctx context.Context) error
    q      chan time.Time
}

func NewQueued(period time.Duration, capacity int, do func(ctx context.Context) error) *Queued {
    return &Queued{period: period, do: do, q: make(chan time.Time, capacity)}
}

func (q *Queued) Run(ctx context.Context) error {
    t := time.NewTicker(q.period)
    defer t.Stop()
    go q.worker(ctx)
    for {
        select {
        case <-ctx.Done():
            return ctx.Err()
        case now := <-t.C:
            select {
            case q.q <- now:
            default:
                log.Printf("queued tick dropped at %v", now)
            }
        }
    }
}

func (q *Queued) worker(ctx context.Context) {
    for {
        select {
        case <-ctx.Done():
            return
        case fired := <-q.q:
            _ = q.do(ctx)
            _ = fired
        }
    }
}
```

Capacity-bounded queue. If the queue fills, new ticks are still dropped (you cannot escape buffering's bound), but the worker can catch up from a small backlog. Useful when the work has bursty cost variance.

---

## Memory Behaviour and Allocation Profile

A `time.Ticker` allocates:

- A `runtime.timer` struct (managed by the runtime, not visible to user code).
- A `time.Ticker` struct holding `C` and an internal handle.
- A buffered channel with capacity 1.

Total: a few hundred bytes on construction. The allocation count is 2 or 3 depending on Go version.

Per tick: zero allocations on the hot path. The runtime reuses the same `timer` entry, re-arming `when` after each fire. The send into `t.C` does not allocate.

### Counting Allocations

```go
func BenchmarkTickerFire(b *testing.B) {
    t := time.NewTicker(time.Microsecond)
    defer t.Stop()
    b.ResetTimer()
    b.ReportAllocs()
    for i := 0; i < b.N; i++ {
        <-t.C
    }
}
```

On Go 1.22, `BenchmarkTickerFire-8 100000  10324 ns/op  0 B/op  0 allocs/op`. Zero allocations per fire. The cost is the per-fire wake-up and the channel receive.

Compare:

```go
func BenchmarkTimeAfterFire(b *testing.B) {
    b.ReportAllocs()
    for i := 0; i < b.N; i++ {
        <-time.After(time.Microsecond)
    }
}
```

`BenchmarkTimeAfterFire-8 100000  10872 ns/op  192 B/op  3 allocs/op`. Three allocations per iteration. Over millions of fires this matters.

### Long-Lived Ticker Memory

A ticker with a 1-hour period occupies the same memory as one with a 1-microsecond period. The period is just a field. So if you have a hundred long-lived tickers waking once per hour, you pay ~100 * a few hundred bytes — negligible.

### When Many Tickers Add Up

If you spawn one ticker per resource and have many resources (10 000 connections each with a heartbeat), you have 10 000 timer entries in the runtime heap. Each `Stop` is O(log N) on the heap; each fire is also O(log N). At 10k tickers and 1-second periods, the runtime is doing ~10 000 log(10 000) ~ 140 000 heap operations per second. That is acceptable on a modern CPU but not free.

Two mitigations:

1. **Coalesce.** One ticker that fires every second, hitting all resources in a loop. Reduces 10 000 timer entries to 1.
2. **Sharded coalescing.** Eight tickers, each handling a subset of resources, offset so they fan-out load.

If you find yourself with thousands of tickers, audit whether you really need that many — the answer is almost always "no."

---

## Observability Hooks

A production ticker loop should be observable. Three sources of signal.

### Metrics

Expose counters for: ticks observed, work units completed, errors encountered, last tick time.

```go
type Metrics struct {
    Ticks   atomic.Int64
    Errors  atomic.Int64
    LastAt  atomic.Int64 // unix nano
}

func loop(ctx context.Context, m *Metrics) {
    t := time.NewTicker(time.Second)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case now := <-t.C:
            m.Ticks.Add(1)
            m.LastAt.Store(now.UnixNano())
            if err := work(); err != nil {
                m.Errors.Add(1)
            }
        }
    }
}
```

Expose them via Prometheus, OpenTelemetry, or your in-house metrics system.

### Logs

Log at the start and end of the loop, at every error, and occasionally at info level to confirm the loop is alive:

```go
func loop(ctx context.Context) {
    log.Println("loop: start")
    defer log.Println("loop: exit")

    t := time.NewTicker(time.Second)
    defer t.Stop()

    var (
        ticks   int
        report  = time.NewTicker(time.Minute)
    )
    defer report.Stop()

    for {
        select {
        case <-ctx.Done():
            return
        case <-t.C:
            ticks++
            if err := work(); err != nil {
                log.Printf("loop: error: %v", err)
            }
        case <-report.C:
            log.Printf("loop: %d ticks in last minute", ticks)
            ticks = 0
        }
    }
}
```

Two tickers here: the work cadence and the reporting cadence. They are independent. Logs at minute granularity tell you the loop is alive without flooding.

### Traces

For each tick, start a trace span:

```go
case <-t.C:
    ctx, span := tracer.Start(ctx, "tick")
    err := work(ctx)
    if err != nil {
        span.RecordError(err)
    }
    span.End()
```

Distributed traces give you per-tick latency, error attribution, and per-tick interaction with downstream services. Cost: a small allocation per tick.

### Health Endpoints

Wire the metrics into a `/healthz` endpoint:

```go
http.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
    last := time.Unix(0, m.LastAt.Load())
    age := time.Since(last)
    if age > 10*time.Second {
        http.Error(w, fmt.Sprintf("last tick: %v ago", age), http.StatusServiceUnavailable)
        return
    }
    w.Write([]byte("ok"))
})
```

A liveness probe sees "last tick was N seconds ago" and reports unhealthy when the gap grows.

---

## Ticker Wrappers Worth Building Once

Some ticker shapes appear in nearly every Go service. Build them once, reuse forever.

### Wrapper 1: Jittered Ticker

```go
type JitteredTicker struct {
    C       <-chan time.Time
    out     chan time.Time
    inner   *time.Ticker
    period  time.Duration
    jitter  float64 // 0..1
    cancel  context.CancelFunc
    done    chan struct{}
}

func NewJitteredTicker(period time.Duration, jitter float64) *JitteredTicker {
    if jitter < 0 {
        jitter = 0
    }
    if jitter > 1 {
        jitter = 1
    }
    out := make(chan time.Time, 1)
    ctx, cancel := context.WithCancel(context.Background())
    j := &JitteredTicker{
        C:      out,
        out:    out,
        period: period,
        jitter: jitter,
        cancel: cancel,
        done:   make(chan struct{}),
    }
    go j.run(ctx)
    return j
}

func (j *JitteredTicker) run(ctx context.Context) {
    defer close(j.done)
    timer := time.NewTimer(j.next())
    defer timer.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case now := <-timer.C:
            select {
            case j.out <- now:
            default:
            }
            timer.Reset(j.next())
        }
    }
}

func (j *JitteredTicker) next() time.Duration {
    base := float64(j.period)
    delta := j.jitter * base * (rand.Float64()*2 - 1) // ±jitter * period
    return time.Duration(base + delta)
}

func (j *JitteredTicker) Stop() {
    j.cancel()
    <-j.done
}
```

Behaviour: each fire is at `period ± jitter*period`. The consumer reads from `j.C` exactly as from `*time.Ticker.C`.

This wrapper uses a `Timer` internally, recreating the delay each fire — perfectly fine for a jittered cadence.

### Wrapper 2: Aligned Ticker

Fires at the next round-period boundary:

```go
type AlignedTicker struct {
    C      <-chan time.Time
    out    chan time.Time
    period time.Duration
    cancel context.CancelFunc
    done   chan struct{}
}

func NewAlignedTicker(period time.Duration) *AlignedTicker {
    out := make(chan time.Time, 1)
    ctx, cancel := context.WithCancel(context.Background())
    a := &AlignedTicker{
        C:      out,
        out:    out,
        period: period,
        cancel: cancel,
        done:   make(chan struct{}),
    }
    go a.run(ctx)
    return a
}

func (a *AlignedTicker) run(ctx context.Context) {
    defer close(a.done)
    for {
        next := time.Now().Truncate(a.period).Add(a.period)
        wait := time.Until(next)
        select {
        case <-ctx.Done():
            return
        case now := <-time.After(wait):
            select {
            case a.out <- now:
            default:
            }
        }
    }
}

func (a *AlignedTicker) Stop() {
    a.cancel()
    <-a.done
}
```

Fires at the next whole `period` boundary in wall-clock terms. For `period = time.Minute`, fires at every :00, :01, :02, ...

Caveat: uses wall-clock arithmetic, so it is sensitive to clock jumps. Acceptable for "log roll-over every hour"; not acceptable for high-precision scheduling.

### Wrapper 3: Manual-Trigger Ticker

A ticker whose period is "whenever someone calls Trigger" — useful for tests or for event-driven processing dressed up as periodic work:

```go
type ManualTicker struct {
    C   <-chan time.Time
    out chan time.Time
}

func NewManualTicker() *ManualTicker {
    out := make(chan time.Time, 1)
    return &ManualTicker{C: out, out: out}
}

func (m *ManualTicker) Trigger(t time.Time) {
    select {
    case m.out <- t:
    default:
    }
}

func (m *ManualTicker) Stop() {}
```

In tests:

```go
m := NewManualTicker()
go Loop(ctx, m)
m.Trigger(time.Now())
// verify side effects
```

Combine with an interface (`Ticker`) and the loop is testable without a clock abstraction.

### Wrapper 4: Backoff Ticker

A ticker that grows its period on each consecutive failure:

```go
type BackoffTicker struct {
    initial, max time.Duration
    current      time.Duration
    timer        *time.Timer
    out          chan time.Time
    cancel       context.CancelFunc
    done         chan struct{}
    success      chan struct{}
    failure      chan struct{}
}

func NewBackoffTicker(initial, max time.Duration) *BackoffTicker {
    out := make(chan time.Time, 1)
    ctx, cancel := context.WithCancel(context.Background())
    b := &BackoffTicker{
        initial: initial,
        max:     max,
        current: initial,
        out:     out,
        cancel:  cancel,
        done:    make(chan struct{}),
        success: make(chan struct{}, 1),
        failure: make(chan struct{}, 1),
    }
    b.timer = time.NewTimer(b.current)
    go b.run(ctx)
    return b
}

func (b *BackoffTicker) C() <-chan time.Time { return b.out }

func (b *BackoffTicker) Success() {
    select {
    case b.success <- struct{}{}:
    default:
    }
}

func (b *BackoffTicker) Failure() {
    select {
    case b.failure <- struct{}{}:
    default:
    }
}

func (b *BackoffTicker) Stop() {
    b.cancel()
    <-b.done
}

func (b *BackoffTicker) run(ctx context.Context) {
    defer close(b.done)
    defer b.timer.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case now := <-b.timer.C:
            select {
            case b.out <- now:
            default:
            }
            b.timer.Reset(b.current)
        case <-b.success:
            b.current = b.initial
            b.timer.Reset(b.current)
        case <-b.failure:
            b.current *= 2
            if b.current > b.max {
                b.current = b.max
            }
            b.timer.Reset(b.current)
        }
    }
}
```

The consumer calls `Success`/`Failure` to nudge the period. On failure the period doubles up to `max`; on success it resets to `initial`. The wrapping is intricate but isolated; the consumer just reads from `C`.

---

## Interaction with the Garbage Collector

Pre Go 1.23, a ticker held a reference to its internal `runtime.timer` and the timer's `arg` (the channel value to send). The runtime heap held a reference to the timer. The result: a ticker would not be garbage-collected even if all user references were gone, until `Stop` was called explicitly.

That is why "forgetting to call `Stop`" leaks not just the channel but the entire ticker scaffold.

Go 1.23 changed this: the runtime tracks tickers via weak references that the GC can finalise. A ticker with no live user references is eligible for collection even without `Stop`. The fire goroutine on the runtime's side notices the finalisation and detaches.

This sounds like permission to skip `Stop`. It is not:

- The GC is not guaranteed to run immediately when references vanish. A ticker may continue firing for some time before GC reaps it.
- The "fire continues until GC" period is longer than you want for any production loop.
- Code that compiles on 1.20 and earlier still leaks if you skip `Stop`.

So: keep calling `Stop`. The Go 1.23 change is a defensive guard, not a license.

### What This Means for Library Code

Libraries that historically said "you must call `Close` to release tickers" remain correct. Go 1.23 makes the bug less catastrophic — a forgotten `Close` is now eventual rather than permanent — but the API contract has not changed.

### Verifying With Tests

You can write a leak test that does not pre-suppose 1.23 semantics:

```go
func TestNoTickerLeak(t *testing.T) {
    defer goleak.VerifyNone(t)
    h := NewHeartbeat(10*time.Millisecond, func(context.Context, time.Time) error { return nil })
    h.Start(context.Background())
    time.Sleep(50 * time.Millisecond)
    h.Stop()
}
```

`goleak` finds the leaked goroutine regardless of GC. If your component requires `Stop`, the test will reliably catch the omission.

---

## Common Mistakes at the Middle Level

The middle-level traps are sharper than junior traps because they look like working code.

### Mistake 1: Reset Race

```go
go func() {
    time.Sleep(time.Second)
    t.Reset(500 * time.Millisecond)
}()
for now := range t.C {
    fmt.Println(now)
}
```

The reset is correct in isolation, but the consumer is using `range` — it has no exit path. When the surrounding goroutine wants to end, no clean shutdown is possible. The fix is the standard `select`-based loop with `ctx.Done()`.

### Mistake 2: Reset Without Drain When Drain Matters

```go
t := time.NewTicker(time.Second)
// ... 1.5 seconds elapse, a tick is buffered in t.C ...
t.Reset(time.Hour)
val := <-t.C // this fires immediately, observing the stale 1-second-old tick, not waiting an hour
```

In a polling loop this is usually harmless. In code where the tick *triggers an expensive operation*, the stale tick triggers it once "for free." Drain before reset:

```go
select {
case <-t.C:
default:
}
t.Reset(time.Hour)
```

### Mistake 3: Mistaking Stop for Close

```go
t := time.NewTicker(time.Second)
t.Stop()
for now := range t.C { // blocks forever
    fmt.Println(now)
}
```

`Stop` does not close `t.C`. The `range` never returns. Always use a `select` with a separate exit case.

### Mistake 4: Ticker Started Before the Consumer

```go
t := time.NewTicker(50 * time.Millisecond)
// ... 200ms of expensive setup ...
for now := range t.C {
    handle(now)
}
```

Three ticks were generated during setup; two were dropped (buffer of 1). The first `range` iteration sees the one-and-only buffered tick *immediately*. The "first interval" appears shorter than expected.

Construct the ticker as close to the loop entry as possible. If there is mandatory setup, prefer constructing after setup completes.

### Mistake 5: Period Smaller Than Handler Time

```go
t := time.NewTicker(10 * time.Millisecond)
for now := range t.C {
    expensiveWork(now) // takes 50ms
}
```

The runtime fires every 10ms; the consumer dequeues at 50ms intervals; 4 of every 5 ticks are dropped. The effective rate is 1/50ms, not 1/10ms.

This usually indicates a design error: either the period is too aggressive for the work, or the work should be split (e.g. submitted to a worker pool with its own pacing). Quick fix: increase the period to match what the handler can sustain.

### Mistake 6: Capturing the Ticker Variable in Multiple Goroutines

```go
t := time.NewTicker(time.Second)
go func() {
    for range t.C {
        a()
    }
}()
go func() {
    for range t.C {
        b()
    }
}()
```

Each tick lands on exactly one goroutine — whichever wins the receive race. So `a` and `b` alternate semi-randomly, neither running at 1Hz. If you want two periodic actions, use two tickers.

### Mistake 7: time.Tick Without Stop

```go
for range time.Tick(time.Second) { // no Stop possible
    handle()
}
```

`time.Tick` returns just the channel — no Ticker, no Stop. The underlying ticker is leaked when the surrounding scope dies. The standard library doc explicitly says: "the Ticker cannot be recovered by the garbage collector; it 'leaks'."

Use `time.NewTicker` instead. `time.Tick` is convenient for `main`-scoped tickers in tiny programs and otherwise to be avoided.

### Mistake 8: Reset on a Nil Ticker

```go
var t *time.Ticker
if shouldTick {
    t = time.NewTicker(time.Second)
}
// later:
t.Reset(2 * time.Second) // nil pointer dereference if shouldTick was false
```

Either initialise unconditionally or check for nil before each operation. The most robust shape is "always construct, sometimes `Stop`."

### Mistake 9: Concurrent Reset and Stop Without Synchronisation

```go
t := time.NewTicker(time.Second)
go func() {
    time.Sleep(time.Second)
    t.Stop()
}()
go func() {
    time.Sleep(500 * time.Millisecond)
    t.Reset(time.Hour)
}()
```

Both `Stop` and `Reset` are individually safe for concurrent calls. But their *order* is unsynchronised — sometimes `Stop` then `Reset` (which re-arms), sometimes `Reset` then `Stop`. The observable state depends on the OS scheduler.

For pause/resume style code, route the operations through a single goroutine or a mutex. Do not race `Stop` against `Reset`.

### Mistake 10: Using Tickers for Timeouts

```go
t := time.NewTicker(5 * time.Second)
defer t.Stop()
select {
case <-done:
case <-t.C:
    // "timeout"
}
```

A ticker fires repeatedly; you only wait for one fire. The other (now-orphaned) fires are silently discarded into `t.C`. It works, but it's wasteful. Use `time.NewTimer` or `context.WithTimeout` for one-shot timeouts.

### Mistake 11: Goroutine Per Tick Without Bounds

```go
t := time.NewTicker(time.Second)
defer t.Stop()
for range t.C {
    go heavyWork()
}
```

Every tick spawns a goroutine. If `heavyWork` takes longer than a second, goroutines accumulate forever. Bound with a semaphore, a worker pool, or run synchronously.

```go
const maxInFlight = 10
sem := make(chan struct{}, maxInFlight)
for {
    select {
    case <-ctx.Done():
        return
    case <-t.C:
        select {
        case sem <- struct{}{}:
            go func() {
                defer func() { <-sem }()
                heavyWork()
            }()
        default:
            log.Printf("dropping tick: too many in flight")
        }
    }
}
```

### Mistake 12: Confusing Ticker With Timer in Tests

```go
func TestX(t *testing.T) {
    tick := time.NewTicker(50 * time.Millisecond)
    defer tick.Stop()
    select {
    case <-tick.C:
        // expected
    case <-time.After(time.Second):
        t.Fatal("no tick within 1s")
    }
}
```

This test waits 50ms in the happy path. Multiply by hundreds of tests, plus retries on CI, and your test suite slows noticeably. Use a fake clock or `synctest`. If you must use real time, set the period very short and bound the wall-clock total.

### Mistake 13: Holding the Lock During Work

```go
type Component struct {
    mu sync.Mutex
}

func (c *Component) loop(ctx context.Context) {
    t := time.NewTicker(time.Second)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case <-t.C:
            c.mu.Lock()
            c.doExpensiveWork()
            c.mu.Unlock()
        }
    }
}
```

`doExpensiveWork` may run for hundreds of milliseconds, holding the mutex against every concurrent caller. Refactor so the lock protects only the data, not the work:

```go
case <-t.C:
    c.mu.Lock()
    snapshot := c.copy()
    c.mu.Unlock()
    result := computeFromSnapshot(snapshot)
    c.mu.Lock()
    c.applyResult(result)
    c.mu.Unlock()
```

The mutex is released during computation. Concurrent callers see consistent snapshots.

### Mistake 14: Reset to a Larger Value Without Draining

```go
t := time.NewTicker(time.Second)
// 0.9 seconds elapse, no tick yet
t.Reset(time.Hour)
// 0.1 seconds elapse, tick fires! into t.C
<-t.C // immediate, not after the hour
```

If the new period is larger than the old, and the old period had not yet expired, the runtime may still fire one tick at the old time. Subsequent ticks observe the new period. This is rare in practice but can confuse careful tests.

If you need "no tick until the new period elapses," `Stop` then drain then `Reset`:

```go
t.Stop()
select {
case <-t.C:
default:
}
t.Reset(time.Hour)
```

### Mistake 15: Comparing time.Time From Ticker With time.Now

```go
case now := <-t.C:
    if now.After(deadline) {
        // ...
    }
```

The `now` from `t.C` is the *scheduled* fire time, not the moment of receive. On a heavily-loaded scheduler, `time.Now()` may be later than `now` by some milliseconds. For most code this is irrelevant; for code computing real-time latency to the deadline, use `time.Now()`, not the ticker value.

---

## Idiomatic Refactors

Several patterns in older Go code can be modernised without behaviour change.

### Refactor 1: time.Tick to NewTicker

Before:

```go
func loop() {
    for range time.Tick(time.Second) {
        work()
    }
}
```

After:

```go
func loop(ctx context.Context) {
    t := time.NewTicker(time.Second)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case <-t.C:
            work()
        }
    }
}
```

Costs you four lines, buys you cancellation and no leak.

### Refactor 2: time.After in Loop to Ticker

Before:

```go
func loop() {
    for {
        <-time.After(time.Second)
        work()
    }
}
```

After: same as above. Replace the per-iteration `time.After` with a long-lived ticker.

### Refactor 3: Stop and NewTicker to Reset

Before:

```go
func adapt(t *time.Ticker, d time.Duration) *time.Ticker {
    t.Stop()
    return time.NewTicker(d)
}
```

After:

```go
func adapt(t *time.Ticker, d time.Duration) {
    t.Reset(d)
}
```

In-place mutation; same channel; one less allocation.

### Refactor 4: Multi-Goroutine Tickers to One Loop

Before:

```go
go func() { for range time.Tick(time.Second) { a() } }()
go func() { for range time.Tick(time.Second) { b() } }()
```

After:

```go
go func(ctx context.Context) {
    t := time.NewTicker(time.Second)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case <-t.C:
            a()
            b()
        }
    }
}(ctx)
```

One goroutine, one ticker. If `a` and `b` are independent and one being slow should not affect the other, keep them separate; if they are unrelated work that just shares a cadence, fold them together.

### Refactor 5: Done Channel to Context

Before:

```go
type Worker struct {
    done chan struct{}
}

func (w *Worker) run() {
    t := time.NewTicker(time.Second)
    defer t.Stop()
    for {
        select {
        case <-w.done:
            return
        case <-t.C:
            work()
        }
    }
}
```

After:

```go
type Worker struct {
    cancel context.CancelFunc
}

func (w *Worker) Start(parent context.Context) {
    ctx, cancel := context.WithCancel(parent)
    w.cancel = cancel
    go w.run(ctx)
}

func (w *Worker) run(ctx context.Context) {
    t := time.NewTicker(time.Second)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case <-t.C:
            work()
        }
    }
}
```

The component now composes naturally with HTTP handlers, gRPC, and any other context-aware code in the system. Cost is one more import and a parameter to `Start`.

### Refactor 6: Pulling Stop Into a Sync.Once

Before:

```go
func (w *Worker) Close() {
    close(w.done)
}
```

After:

```go
func (w *Worker) Close() {
    w.closeOnce.Do(func() {
        close(w.done)
        <-w.exit
    })
}
```

Idempotent, synchronous, double-call-safe. Worth the few extra lines if `Close` is exported.

### Refactor 7: Inline Ticker Logic to Component

Before:

```go
func main() {
    t := time.NewTicker(5 * time.Second)
    defer t.Stop()
    for {
        select {
        case <-quit:
            return
        case <-t.C:
            ping()
        }
    }
}
```

After:

```go
type Pinger struct {
    period time.Duration
    cancel context.CancelFunc
    done   chan struct{}
}

func (p *Pinger) Start(ctx context.Context) { /* ... */ }
func (p *Pinger) Stop()                     { /* ... */ }

func main() {
    p := &Pinger{period: 5 * time.Second}
    p.Start(context.Background())
    defer p.Stop()
    // ...
}
```

Extracting into a type makes the lifetime explicit, makes it testable, and makes it reusable. Do this once your ticker logic has any complexity beyond a one-line handler.

---

## Worked Example: A Cache Janitor

Build a TTL cache with a background janitor. Walk through each design decision.

### Requirements

- Key-value store with TTL per entry.
- Reads should not block on the janitor.
- Janitor sweeps every minute, removes expired entries.
- Cache has a `Close` that stops the janitor cleanly.
- Test that demonstrates eviction without waiting real time.

### Cache With Lazy Eviction (Baseline)

```go
type Cache struct {
    mu      sync.RWMutex
    entries map[string]entry
}

type entry struct {
    value   any
    expires time.Time
}

func NewCache() *Cache {
    return &Cache{entries: make(map[string]entry)}
}

func (c *Cache) Set(key string, value any, ttl time.Duration) {
    c.mu.Lock()
    c.entries[key] = entry{value: value, expires: time.Now().Add(ttl)}
    c.mu.Unlock()
}

func (c *Cache) Get(key string) (any, bool) {
    c.mu.RLock()
    e, ok := c.entries[key]
    c.mu.RUnlock()
    if !ok {
        return nil, false
    }
    if time.Now().After(e.expires) {
        return nil, false
    }
    return e.value, true
}
```

This works: expired entries return `(nil, false)` on `Get`. The downside is unbounded memory — expired entries linger until overwritten. For long-running services with churn, that is a slow-burning leak.

### Adding a Janitor

```go
type Cache struct {
    mu      sync.RWMutex
    entries map[string]entry

    period  time.Duration
    cancel  context.CancelFunc
    done    chan struct{}
}

func NewCache(janitorPeriod time.Duration) *Cache {
    c := &Cache{
        entries: make(map[string]entry),
        period:  janitorPeriod,
    }
    return c
}

func (c *Cache) Start(parent context.Context) {
    ctx, cancel := context.WithCancel(parent)
    c.cancel = cancel
    c.done = make(chan struct{})
    go c.janitor(ctx)
}

func (c *Cache) Stop() {
    if c.cancel == nil {
        return
    }
    c.cancel()
    <-c.done
}

func (c *Cache) janitor(ctx context.Context) {
    defer close(c.done)
    t := time.NewTicker(c.period)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case now := <-t.C:
            c.sweep(now)
        }
    }
}

func (c *Cache) sweep(now time.Time) {
    c.mu.Lock()
    defer c.mu.Unlock()
    for k, e := range c.entries {
        if now.After(e.expires) {
            delete(c.entries, k)
        }
    }
}
```

Choices made:

- `Start` is separate from `New` because tests may want to construct a cache without firing a goroutine.
- The cancel/done dance gives synchronous `Stop`.
- The sweep holds the write lock for the duration of the sweep — acceptable if the cache is small. For large caches, sweep in batches.

### Batched Sweep

For caches with millions of entries, holding the lock across a full sweep blocks readers too long. Sweep in chunks:

```go
func (c *Cache) sweepBatched(now time.Time, batchSize int) {
    c.mu.Lock()
    keys := make([]string, 0, len(c.entries))
    for k := range c.entries {
        keys = append(keys, k)
    }
    c.mu.Unlock()
    for i := 0; i < len(keys); i += batchSize {
        end := i + batchSize
        if end > len(keys) {
            end = len(keys)
        }
        c.mu.Lock()
        for _, k := range keys[i:end] {
            if e, ok := c.entries[k]; ok && now.After(e.expires) {
                delete(c.entries, k)
            }
        }
        c.mu.Unlock()
    }
}
```

The sweep takes one snapshot of keys under the lock, then processes batches with brief lock holds. Readers see at most one batch's delay.

### A Test With Fake Clock

```go
func TestCache_Janitor(t *testing.T) {
    clk := clock.NewMock()
    c := NewCacheWithClock(clk, time.Minute)
    c.Start(context.Background())
    defer c.Stop()

    c.Set("a", 1, 30*time.Second)
    c.Set("b", 1, 5*time.Minute)

    clk.Add(45 * time.Second)
    // janitor should have swept around the 1-minute mark, but here it has not yet
    // depends on mock implementation

    if v, ok := c.Get("a"); ok {
        t.Errorf("a should be expired by Get-time check, got %v", v)
    }
    if _, ok := c.Get("b"); !ok {
        t.Error("b should still be present")
    }
}
```

The test uses `github.com/benbjohnson/clock`. `NewCacheWithClock` is a parallel constructor that accepts a `clock.Clock` interface. The mock's `Add` advances time without waiting wall-clock.

---

## Worked Example: An Adaptive Poller

Build a poller that scales its rate to the work load.

### Requirements

- Poll an upstream source for work items.
- Empty polls slow the cadence (exponential backoff up to 30s).
- Non-empty polls speed the cadence (exponential speedup down to 100ms).
- Cancellable via context.
- Returns the last error from the upstream when cancelled.

### Implementation

```go
type Poller struct {
    fetch    func(ctx context.Context) (int, error)
    min, max time.Duration
}

func NewPoller(fetch func(ctx context.Context) (int, error), min, max time.Duration) *Poller {
    return &Poller{fetch: fetch, min: min, max: max}
}

func (p *Poller) Run(ctx context.Context) error {
    if p.min <= 0 {
        p.min = 100 * time.Millisecond
    }
    if p.max <= 0 {
        p.max = 30 * time.Second
    }
    period := p.min
    t := time.NewTicker(period)
    defer t.Stop()

    var lastErr error
    for {
        select {
        case <-ctx.Done():
            if lastErr != nil {
                return lastErr
            }
            return ctx.Err()
        case <-t.C:
        }

        n, err := p.fetch(ctx)
        if err != nil {
            lastErr = err
            // on error, slow down
            period = min(period*2, p.max)
            t.Reset(period)
            continue
        }
        lastErr = nil

        switch {
        case n > 0:
            // speed up
            period = max(period/2, p.min)
            t.Reset(period)
        case n == 0:
            // slow down
            period = min(period*2, p.max)
            t.Reset(period)
        }
    }
}

func min(a, b time.Duration) time.Duration {
    if a < b {
        return a
    }
    return b
}

func max(a, b time.Duration) time.Duration {
    if a > b {
        return a
    }
    return b
}
```

(In Go 1.21+ you can use the built-in `min` and `max`; the helpers here are explicit for clarity.)

### Discussion

- The first iteration waits for one tick. Some designs prefer "fetch immediately, then tick" — flip the order of `select` and `fetch` to achieve that.
- On error, the period grows; this is gentle backoff against a failing upstream. Pair with a circuit breaker for production hardening.
- The `Reset` rate of change is geometric. After a successful poll with results, the next poll happens at half the previous interval. After ten such polls, the period is at the floor.
- The poller does not explicitly drain a stale tick before `Reset` because each iteration's `<-t.C` happens immediately after `Reset` of the previous iteration; there is no opportunity for a stale tick. If `fetch` itself takes longer than the current period, the next iteration's `<-t.C` is a stale tick — but that just means "go again," which is what you want.

### Testing

```go
func TestPoller(t *testing.T) {
    var calls int
    fetch := func(ctx context.Context) (int, error) {
        calls++
        if calls < 3 {
            return 0, nil
        }
        if calls < 6 {
            return 5, nil
        }
        return 0, nil
    }
    p := NewPoller(fetch, 10*time.Millisecond, time.Second)
    ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
    defer cancel()
    _ = p.Run(ctx)
    if calls < 5 {
        t.Errorf("expected at least 5 calls, got %d", calls)
    }
}
```

Real-time test using a short period and a tight deadline. For deterministic timing, swap in a fake clock.

---

## Worked Example: A Health Reporter

A component that periodically gathers vitals and sends them to a sink (Prometheus, statsd, etc.).

### Requirements

- Gather CPU, memory, goroutine count every 10 seconds.
- Send each sample to a registered sink.
- Skip a sample if gather takes longer than 5 seconds.
- Continue forever; never abort on sink failure.

### Implementation

```go
type Sample struct {
    At         time.Time
    Goroutines int
    HeapBytes  uint64
    CPUMs      uint64
}

type HealthReporter struct {
    period  time.Duration
    timeout time.Duration
    sinks   []func(context.Context, Sample) error

    cancel  context.CancelFunc
    done    chan struct{}
}

func NewHealthReporter(period, timeout time.Duration) *HealthReporter {
    return &HealthReporter{period: period, timeout: timeout}
}

func (r *HealthReporter) AddSink(s func(context.Context, Sample) error) {
    r.sinks = append(r.sinks, s)
}

func (r *HealthReporter) Start(parent context.Context) {
    ctx, cancel := context.WithCancel(parent)
    r.cancel = cancel
    r.done = make(chan struct{})
    go r.run(ctx)
}

func (r *HealthReporter) Stop() {
    if r.cancel == nil {
        return
    }
    r.cancel()
    <-r.done
}

func (r *HealthReporter) run(ctx context.Context) {
    defer close(r.done)
    t := time.NewTicker(r.period)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case now := <-t.C:
            r.collectAndSend(ctx, now)
        }
    }
}

func (r *HealthReporter) collectAndSend(parent context.Context, now time.Time) {
    ctx, cancel := context.WithTimeout(parent, r.timeout)
    defer cancel()

    done := make(chan Sample, 1)
    go func() {
        var ms runtime.MemStats
        runtime.ReadMemStats(&ms)
        done <- Sample{
            At:         now,
            Goroutines: runtime.NumGoroutine(),
            HeapBytes:  ms.HeapInuse,
        }
    }()

    select {
    case <-ctx.Done():
        log.Printf("health: gather timed out")
        return
    case s := <-done:
        for _, sink := range r.sinks {
            if err := sink(ctx, s); err != nil {
                log.Printf("health sink: %v", err)
            }
        }
    }
}
```

Discussion:

- The gather happens in a goroutine with a buffered channel; the timeout protects against a hung sink without leaking the goroutine. If the gather is slow, the goroutine still completes and sends into the buffer, where the value is then discarded.
- Sinks are called sequentially. For many sinks, run them in goroutines and join with `errgroup` — beyond scope here.
- `runtime.ReadMemStats` is itself slow (microseconds to milliseconds depending on heap size). It briefly stops the world on older Go versions; on modern Go it is concurrent. A 10-second period absorbs this.

### Why Use a Ticker Here

Because the schedule is steady. Every tick is the same kind of work. Could you use `time.AfterFunc` instead? Yes, but you would have to re-schedule it from the callback, manage the cancellation, and re-derive every iteration's parent context. A ticker is the lower-friction tool.

---

## Cross-Platform Considerations

Tickers behave identically across Linux, macOS, Windows, and most other supported Go platforms, but a few details differ at the edges.

### Timer Granularity

Linux: nominal granularity is determined by `CONFIG_HZ` (typically 250Hz or 1000Hz). For 1ms tickers on a 250Hz kernel, individual fires may be delayed by up to 4ms. Modern kernels use high-resolution timers for `nanosleep`-class operations; the Go runtime uses these.

macOS: similar high-resolution timers.

Windows: timer resolution defaults to 15.6ms (the timer tick). Calling `timeBeginPeriod(1)` lowers it to 1ms but increases battery usage. The Go runtime does this when timers are present, so short tickers work but cost a little extra power on Windows.

### NTP Adjustments

All platforms: monotonic clocks are immune to NTP slewing in normal mode. NTP's *step* adjustments (rare) bypass monotonic clocks on Linux, leading to a one-time discontinuity. In practice this is rare enough to ignore.

### Suspend/Resume

Laptops, mobile devices, cloud VMs that may be paused: when the host resumes, monotonic time may have advanced less than wall-clock time (the monotonic clock paused during suspend on some OSes). Tickers may appear to "miss" the suspend period, then continue at the original cadence after resume.

This is rarely a problem for server workloads but worth knowing if your code runs on the desktop or in environments with frequent VM live-migration.

### Numa and CPU Pinning

Tickers wake whichever goroutine receives from `t.C`. If that goroutine is bound to a specific CPU (via OS-level affinity), the wake-up may incur cross-CPU communication. Default Go runtime distribution is socket-agnostic; CPU pinning is rare in Go.

---

## Reading the Standard Library

Once you are comfortable with `Ticker` in user code, read its implementation. The relevant files in the Go source tree:

- `src/time/tick.go` — the `Ticker` type, `NewTicker`, `Stop`, `Reset`. Short and approachable.
- `src/time/sleep.go` — `Timer`, `Sleep`, `After`, `AfterFunc`. Shares plumbing with `Ticker`.
- `src/runtime/time.go` — the runtime's timer heap, the `timer` struct, the scheduling and firing logic. Substantially harder.

Read `tick.go` first; it is a few dozen lines. Then read `sleep.go` to see how the surrounding facade is built. Then dip into `runtime/time.go` for the heap mechanics. The senior file walks through the highlights.

### A Pointer for the Brave

The `runtime/time.go` file changed significantly in Go 1.23. If you are reading an older Go source tree, the heap is a four-tier structure ("four-heap timer") with per-P timer queues. In Go 1.23, the design simplified — read the release notes and follow the linked commit hashes for context. The senior file covers the differences in detail.

### Where the Surface API Hides State

Constructing a ticker:

```go
// tick.go (paraphrased)
func NewTicker(d Duration) *Ticker {
    if d <= 0 {
        panic("non-positive interval for NewTicker")
    }
    c := make(chan Time, 1)
    t := &Ticker{
        C: c,
        r: runtimeTimer{
            when:   when(d),
            period: int64(d),
            f:      sendTime,
            arg:    c,
        },
    }
    startTimer(&t.r)
    return t
}
```

The `runtimeTimer` is the runtime's bookkeeping. `when` is the next fire time in monotonic-nanoseconds since runtime start. `period` is the recurrence. `f` is the callback the runtime calls when the timer fires; for tickers, `sendTime` does a non-blocking send into the channel.

`Stop` removes the entry from the runtime heap; `Reset` updates `when` and `period` and re-adds (or moves) the entry.

That's it for the user-facing layer. The runtime side is the topic of the senior file.

---

## Self-Assessment

Work through each item. You should be able to explain the answer out loud, with rationale.

1. What is the difference between `Reset` and `Stop` + `NewTicker`? When would you choose one over the other?
2. What does the monotonic clock guarantee, and why does that make `Ticker` resilient to NTP corrections?
3. Define drift and jitter in your own words. Give an example of code that produces each.
4. Sketch the canonical `select` loop with `context.Context` cancellation. List the five rules.
5. Why is `for range t.C` without an outer exit path a leak?
6. What happens to `t.C` after `Stop`? Is it closed?
7. Why is `Ticker.C` buffered with capacity 1? What is the consequence for slow consumers?
8. How would you detect dropped ticks in production?
9. What is the thundering-herd problem with synchronised tickers, and how does jitter help?
10. Why is `time.After` in a `for { select }` loop a bug for periods that may not fire before the loop exits?
11. What goes wrong if you `Reset` a ticker while a tick is buffered in `t.C`?
12. Why should you not store `context.Context` in a struct?
13. What does `time.AfterFunc` do differently from `NewTicker` in terms of goroutine management?
14. How would you write a unit test for a ticker-based loop without waiting real wall-clock time?
15. What was the Go 1.15 change to `Ticker`?
16. What is the right tool for "every day at 02:00"? (Hint: not a 24-hour ticker.)
17. If you want a recurring schedule that does not drop ticks even when the consumer is slow, what shape should the code take?
18. How does the runtime know when to fire a ticker? (One sentence is fine; the senior file goes deeper.)
19. What is decorrelated jitter, and when is it preferable to constant or proportional jitter?
20. Why is the `time.Tick` package-level function discouraged?

If you cannot answer six or more without checking notes, re-read the corresponding sections. If you breeze through all twenty, move to the senior file.

---

## Summary

The middle level of `time.Ticker` is about treating it as a real concurrency primitive with semantics, not a one-line idiom. The rules:

- Always pair `NewTicker` with `defer t.Stop()`.
- Always exit the loop via `select` with `ctx.Done()` or a `done` channel — never via `range t.C` alone.
- Use `Reset` to change the period in place. Drain a possibly-pending tick first if your code is sensitive to stale ticks.
- Trust the monotonic clock. Tickers survive wall-clock jumps.
- Distinguish drift from jitter; tickers correct drift internally but drop ticks under slow consumers.
- Jitter at startup (or per-tick) to avoid thundering herds across replicas.
- Reach for fake-clock libraries when ticker tests start slowing CI down.
- Avoid `time.After` inside a `for { select }` loop; the long-lived ticker is the right shape.
- Avoid `time.Tick`; it leaks.
- Treat `Ticker.C`'s buffer-1 semantics as a feature: missed ticks under load are *not* a runtime bug, they are a signal that the consumer is too slow.

The senior file picks up from here. It opens the runtime's `runtime/time.go` and walks through how the heap, the timer thread, and the channel send conspire to make all of the above work — and where, if you read carefully, the implementation has changed in Go 1.23 in ways your code may need to know about.

[← Back to Ticker index](./)
