# Select Statement — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [Production Architectures Built on `select`](#production-architectures-built-on-select)
3. [Scheduler Interaction at Scale](#scheduler-interaction-at-scale)
4. [Observability for Select-Driven Services](#observability-for-select-driven-services)
5. [Backpressure, Load Shedding, and Drop Policies](#backpressure-load-shedding-and-drop-policies)
6. [Deadline Discipline](#deadline-discipline)
7. [Goroutine Leak Hunting in Large Codebases](#goroutine-leak-hunting-in-large-codebases)
8. [Designing the Shutdown Story](#designing-the-shutdown-story)
9. [Interaction with `runtime/pprof` and `runtime/trace`](#interaction-with-runtimepprof-and-runtimetrace)
10. [Migration Patterns: from `time.After` Disasters to Disciplined Timers](#migration-patterns-from-timeafter-disasters-to-disciplined-timers)
11. [Code Review Checklist](#code-review-checklist)
12. [Anti-patterns to Reject in Reviews](#anti-patterns-to-reject-in-reviews)
13. [Engineering Conventions for Teams](#engineering-conventions-for-teams)
14. [War Stories](#war-stories)
15. [Tricky Questions](#tricky-questions)
16. [Self-Assessment Checklist](#self-assessment-checklist)
17. [Summary](#summary)

---

## Introduction

At professional level we treat `select` as an organisational primitive, not just a language construct. Production services that survive Black Friday, region failovers, and unbounded load do so because their concurrency story is disciplined: every goroutine has a known lifecycle, every `select` has a well-thought-out exit path, every queue has a backpressure strategy, every timer is owned. This file is the operational guide. It assumes you have read junior, middle, and senior, and now want the conventions, observability tooling, and review checklists that turn `select`-heavy code into a service you can run for years.

---

## Production Architectures Built on `select`

### The supervised worker pool

```
                 jobs ─────────────────┐
                                       ▼
   ┌────────────────────────────────────────────┐
   │  Dispatcher (for-select)                   │
   │   - reads jobs                             │
   │   - emits to a worker via select-with-default
   │   - drops or retries on full               │
   │   - listens to ctx.Done()                  │
   └────────────────────────────────────────────┘
                       ▼
       ┌───────┬───────┬───────┐
       │ W1    │ W2    │ Wn    │  workers (each: for { select { jobs / ctx.Done } })
       └───────┴───────┴───────┘
                       ▼
                  results ◄── consumed by another for-select
```

Every box is a goroutine. Every goroutine has a for-select. Every for-select has a `<-ctx.Done()` case. Every channel has a known owner that closes it. This skeleton is the basis of message brokers, ingestion pipelines, RPC clients with multiplexed calls, batch jobs, and stream processors.

### The supervisor / restart loop

```go
for {
    err := func() error {
        ctx, cancel := context.WithCancel(parentCtx)
        defer cancel()
        return runService(ctx)
    }()
    if errors.Is(err, context.Canceled) {
        return // intentional shutdown
    }
    log.Errorf("service crashed: %v", err)
    select {
    case <-time.After(backoff()):
    case <-parentCtx.Done():
        return
    }
}
```

The `select` here is the back-off-with-cancellation idiom: wait the back-off interval but bail immediately if the parent context is cancelled. Without this `select` your supervisor would sleep through a shutdown.

### The fan-in aggregator with health gating

```go
func aggregate(ctx context.Context, sources <-chan <-chan Event) <-chan Event {
    out := make(chan Event, 64)
    go func() {
        defer close(out)
        var wg sync.WaitGroup
        for {
            select {
            case src, ok := <-sources:
                if !ok {
                    wg.Wait()
                    return
                }
                wg.Add(1)
                go func(c <-chan Event) {
                    defer wg.Done()
                    for {
                        select {
                        case ev, ok := <-c:
                            if !ok { return }
                            select {
                            case out <- ev:
                            case <-ctx.Done():
                                return
                            }
                        case <-ctx.Done():
                            return
                        }
                    }
                }(src)
            case <-ctx.Done():
                wg.Wait()
                return
            }
        }
    }()
    return out
}
```

This is the realistic shape of a fan-in: dynamic source set, bounded output buffer, both producer and consumer side honour `ctx.Done()`, the closer goroutine waits for the worker count.

---

## Scheduler Interaction at Scale

A service with thousands of goroutines, each parked on a `select`, behaves well in Go because the runtime stores parked goroutines as `sudog` objects on per-channel wait queues, not on the run queue. An idle service consumes essentially no CPU and minimal scheduler attention. When a channel becomes ready, the runtime walks the wait queue and picks the right `sudog`, putting that goroutine onto a P's run queue.

Scaling concerns:

- **Wide selects are expensive.** A `select` with N cases acquires N locks if no case is immediately ready. With N=20 across 1000 goroutines, lock acquisition can dominate.
- **Highly contended channels become hot spots.** Even though each channel uses a lightweight lock, a channel hammered by hundreds of goroutines is a serial point. Shard the channel (one per worker) when possible.
- **Random selection scales linearly.** O(N) shuffle and O(N log N) sort per evaluation. Empirically, per-goroutine select cost stays under 1 μs up to about 16 cases; above that it grows.
- **Park / unpark pairs cost on the order of a microsecond.** Combined with case lock acquisition, a fully-parked-then-woken `select` is several microseconds — not free, but rarely the bottleneck below 100k operations per second per core.

If profile shows `runtime.selectgo` as a hotspot, the cure is almost always architectural: fewer cases, fewer goroutines hitting the same channels, batch processing inside cases.

---

## Observability for Select-Driven Services

Three layers of visibility:

### 1. Goroutine inventory

`runtime.NumGoroutine()` exposed as a metric. A growing count over time is a leak. Crossed with a histogram of goroutine wait reasons (parsed from `runtime.Stack`), you can see "goroutines parked in `selectgo` at file foo.go:120" and identify which `select` is leaking.

### 2. Channel depths

Expose `len(ch)` and `cap(ch)` for each named channel. Spikes in `len(ch)/cap(ch)` warn of consumer slowness; consistent fullness warns of misconfigured capacity.

### 3. Case-resolution metrics

In hot for-select loops, count which case was chosen each iteration:

```go
var (
    casesJobs = metrics.Counter("loop_case", "case", "jobs")
    casesTick = metrics.Counter("loop_case", "case", "tick")
    casesDone = metrics.Counter("loop_case", "case", "done")
)

for {
    select {
    case j := <-jobs:
        casesJobs.Inc()
        process(j)
    case <-tick.C:
        casesTick.Inc()
        flush()
    case <-ctx.Done():
        casesDone.Inc()
        return
    }
}
```

A spike in tick-vs-jobs ratio means producers slowed; a sudden surge of done means a deploy started.

### 4. `runtime/trace`

In production-like load tests, capture a trace and visualise with `go tool trace`. Goroutines parked in `selectgo` show up in the goroutine view; the ChannelRecv / ChannelSend events show which channel woke them. Indispensable for diagnosing "everything is slow but no profile peak" symptoms.

---

## Backpressure, Load Shedding, and Drop Policies

Bounded queues are non-negotiable. The question is what you do when full.

| Policy | Pattern | When |
|--------|---------|------|
| **Block producers** | Plain unbuffered `ch <- v` | Producers can wait; consumer dictates rate |
| **Drop newest** | `select { case ch <- v: ; default: dropped++ }` | Latency more important than completeness; ok to lose newest |
| **Drop oldest** | Drain one with non-blocking receive, then send | Newer values supersede older (e.g. position updates) |
| **Replace key** | Map+queue with debounce | Per-key dedup |
| **Fail fast** | Return an error to the caller | Synchronous APIs that must surface backpressure |

Each is a one-line `select` change once you recognise the shape. Picking the wrong one is a design error; explicit choice with a metric is a hallmark of professional code.

### Drop newest with sampling

```go
func enqueue(ch chan Event, e Event) {
    select {
    case ch <- e:
    default:
        if rand.Intn(100) == 0 {
            log.Warn("dropped event")
        }
        droppedCounter.Inc()
    }
}
```

Sampled logging avoids drowning the log when drops happen at high rate.

---

## Deadline Discipline

Production rule: **no `select` on a network or RPC operation without a deadline**. Either:

- The context that drives the goroutine has a deadline (`context.WithTimeout`), and the `<-ctx.Done()` case fires when it expires; or
- The `select` itself has a `case <-time.After(d):` (with the timer caveats from middle.md).

A `select` with `<-ch` and `<-ctx.Done()` only is fine **if and only if** the `ctx` was created with a deadline. Otherwise you have an indefinite blocking call, and a slow peer can park your goroutine forever.

A common review comment: "is `ctx` here guaranteed to have a deadline?" If the answer is "depends on the caller," wrap with `context.WithTimeout` defensively at the boundary.

---

## Goroutine Leak Hunting in Large Codebases

Symptoms: memory grows without unbounded data structures; `runtime.NumGoroutine()` climbs; profiler shows growing count of goroutines in `runtime.selectgo`.

Process:

1. **Reproduce in test** with `goleak`. Even if you cannot fully reproduce, write a failing leak test for the suspect path; that becomes regression coverage.
2. **Capture a goroutine profile** with `pprof`. Group by stack; the largest groups in `selectgo` show the leaking selects.
3. **Inspect each leaking `select`.** Does every case fire eventually? Is there a `<-ctx.Done()` path? Are buffered result channels of capacity 1?
4. **Fix at the source**, not by patching downstream. The fix is usually:
   - Add a missing `<-ctx.Done()` case.
   - Buffer the result channel so the producer is not parked when the consumer chose another path.
   - Stop holding a `<-chan` reference past its useful life.

### Typical leak shapes

```go
// LEAK: producer parks on `out` after the consumer chose timeout.
out := make(chan int)
go func() { out <- compute() }() // never returns
select {
case v := <-out: ...
case <-time.After(d): ...
}

// FIX: buffer the result channel.
out := make(chan int, 1)
go func() { out <- compute() }()
```

```go
// LEAK: for-select without ctx.Done().
go func() {
    for {
        select {
        case j := <-jobs:
            process(j)
        }
    }
}()

// FIX:
go func() {
    for {
        select {
        case j := <-jobs:
            process(j)
        case <-ctx.Done():
            return
        }
    }
}()
```

---

## Designing the Shutdown Story

Every production service must answer:

1. **What triggers shutdown?** SIGTERM, deadline, parent context, peer error.
2. **What stops accepting new work?** A `case <-ctx.Done():` in the entry-point for-select; the listener stops accepting connections.
3. **What drains in-flight work?** A graceful period during which workers finish their current job; the for-select still selects from `jobs`, but new jobs are no longer enqueued.
4. **What forces termination?** A hard deadline after which we stop waiting and exit even if some workers have not finished.

A canonical shape:

```go
func Run(parent context.Context) error {
    ctx, cancel := context.WithCancel(parent)
    defer cancel()

    g, gctx := errgroup.WithContext(ctx)
    g.Go(func() error { return server.Serve(gctx) })
    g.Go(func() error { return workerPool(gctx) })
    g.Go(func() error {
        <-gctx.Done()
        // graceful drain window
        ctxDrain, cancelDrain := context.WithTimeout(context.Background(), 30*time.Second)
        defer cancelDrain()
        return server.Shutdown(ctxDrain)
    })
    return g.Wait()
}
```

The graceful path uses `context.Background()` for the drain because `gctx` is already cancelled. Without that, `Shutdown` would not have a chance to wait for in-flight requests.

---

## Interaction with `runtime/pprof` and `runtime/trace`

- **`go tool pprof goroutine`** prints stacks of every running and parked goroutine. Look for repeated stacks ending in `runtime.selectgo`.
- **`go tool pprof block`** records goroutines blocked on synchronisation primitives (including channels) with cumulative wait time. A select that parks for hours appears here.
- **`go tool trace`** is the most powerful tool for understanding `select` behaviour in motion — wakeups, scheduling delays, lock contention. Expensive to capture in production but essential for tuning.

A common workflow:
1. `pprof goroutine` to find growing groups.
2. `pprof block` to confirm blocking time is meaningful.
3. `runtime/trace` in a load test to see exactly which channel triggered each wakeup and how long the goroutine stayed parked.

---

## Migration Patterns: from `time.After` Disasters to Disciplined Timers

A textbook real-world incident: a service runs fine in staging, OOMs in production after eight hours. Profile shows a million `*time.Timer` objects on the heap. Cause: a hot for-select with `case <-time.After(time.Minute)` and a producer that delivers thousands of messages per second. Each `time.After` is a leaked timer until it fires a minute later.

The fix is mechanical:

1. Hoist a single `time.NewTimer` outside the loop.
2. `Stop` and drain inside the loop before `Reset` (or rely on Go 1.23 semantics).
3. Add a metric `idle_timer_resets_per_second` so you can see if the loop is hot.

Most teams add a lint rule (`grep -nE 'time\.After'` in CI) banning `time.After` outside of one-shot waits at API boundaries.

---

## Code Review Checklist

When reviewing code that contains `select`:

- [ ] Every for-select has a `<-ctx.Done()` (or equivalent) case.
- [ ] No `time.After` inside a for-select.
- [ ] No `time.Tick` anywhere.
- [ ] Every `time.NewTicker` has a matching `defer ticker.Stop()`.
- [ ] Result channels in timeout patterns are buffered with capacity 1.
- [ ] No closing of channels from the receive side.
- [ ] No assumption of case ordering anywhere in the body.
- [ ] Cases that send to a possibly-closed channel are protected (one-writer convention).
- [ ] `select`s with more than five cases are justified or refactored.
- [ ] Dynamic case sets use `reflect.Select` only where statically impossible.
- [ ] Hot loops have metrics for case selection distribution.
- [ ] Heavy work in case bodies is delegated to other goroutines.
- [ ] Each named channel has documented ownership (writer / closer).

---

## Anti-patterns to Reject in Reviews

- **Polling with `default + sleep`.** CPU-burning loop. Use a timer case.
- **`select` as a mutex.** A buffered-1 channel pretending to be a mutex is slower and harder to reason about.
- **Closing a channel to signal "result is ready."** The convention is to send the value; close means "no more values."
- **`go func() { for { select { ... } } }()` without context.** Goroutine cannot be stopped.
- **Adding a `default` to "make the select non-blocking" when blocking was correct.** Now you are spinning.
- **`time.After` in any loop.** Leaks. Always.
- **Two writers to one channel.** One must stop before the other closes; coordination is fragile.
- **Discriminating on case order ("the first case has priority").** Random selection makes this unreliable.
- **Sending a pointer to mutable state into a channel.** The receiver and sender now have a shared-state race; channels are for ownership transfer.
- **Twenty-case select.** Refactor.

---

## Engineering Conventions for Teams

A team with several years of Go production code typically converges on:

1. **Always pass `context.Context` as the first argument.** It carries the cancellation channel that every for-select needs.
2. **Never spawn a goroutine that does not take `ctx`.** No exceptions in production code.
3. **Use `errgroup.WithContext` for parallel work that should fail-fast.** It hides the `select` boilerplate.
4. **Use `chan struct{}` for done signals.** Zero-cost values; the close itself is the message.
5. **Prefer pull-style APIs (`Next(ctx)`) over push-style (channels exposed in interfaces).** Channels are an implementation detail; expose them only when you really need cross-goroutine multiplexing.
6. **Centralise timer creation and stopping behind helpers** like `func newTimer(d time.Duration) *time.Timer { return time.NewTimer(d) }` plus a `Stop` helper. Keeps the leak surface in one place.
7. **Lint for `time.After`, `time.Tick`, and unprotected `close`.** Custom analysers (e.g., `go vet` shadows or `staticcheck`) catch these in CI.
8. **Document channel ownership in the type declaration**: who writes, who reads, who closes.

---

## War Stories

### The 200-case select

A team built a router with `reflect.Select` over 200 client connections. CPU went to 70% serving 5k req/s. Profiling showed `runtime.selectgo` and `reflect.Select` dominant. The fix: shard. Run sixteen goroutines, each handling roughly twelve connections with a static six-case `select`. CPU dropped to 8%.

### The hidden ticker leak

A library exposed a `Subscribe()` returning a channel and a cancel function. Internally it used `time.Tick(1*time.Second)`. Cancelling the subscription closed the user-facing channel but did not stop the ticker. Over a week of subscribe/unsubscribe cycles the process leaked 200k goroutines, each parked on a tick. Fix: replace `time.Tick` with `time.NewTicker` and `defer ticker.Stop()`.

### The starvation-by-priority

A team implemented "urgent first" by polling urgent in a non-blocking `select` and falling through to normal. Under load the urgent channel was always slightly hot, so the normal channel never ran. Customers reported "slow path is dead." The fix: a small budget — process up to N urgents, then yield to normal — implemented with a counter incremented inside the urgent case and a non-blocking peek at normal once the budget was spent.

### The shutdown that did not shut down

A graceful shutdown closed the input channel and waited for workers. Workers were `for j := range jobs { ... }` — fine. But one of them was `for { select { case j := <-jobs: ...; case <-tick: ... } }` without a `<-done:` case. After `close(jobs)`, the select repeatedly hit the always-ready closed-receive case (zero values, ok=false), spinning. Fix: detect closure with `v, ok := <-jobs` and break, or add `<-done:`.

---

## Tricky Questions

1. How do you observe in production that a particular `select` is leaking goroutines?
2. What is the CPU cost model of a `select` and how does it scale with case count?
3. Why does `time.After` cause memory leaks even though it is "just a timer"?
4. How do you implement priority that is preferred but not starvation-causing?
5. What is the right place in a service to set a deadline on the context?
6. How do you express "drop oldest" without losing FIFO?
7. Why is `go tool trace` more useful than `pprof goroutine` for `select` debugging?
8. What is the lint rule every team converges on first?
9. How do you make `Shutdown` safe when it is called twice concurrently?
10. Where does `errgroup` use a `select` internally?

(Answers in interview.md.)

---

## Self-Assessment Checklist

- [ ] I can name three production architectures whose backbone is for-select.
- [ ] I can describe the cost model of `select` and predict where it becomes a hotspot.
- [ ] I can audit a service for goroutine leaks driven by `select` misuse.
- [ ] I can design a shutdown story that drains in-flight work with a hard deadline.
- [ ] I can reject anti-patterns in code review without consulting docs.
- [ ] I have used `runtime/trace` to investigate `select` behaviour.
- [ ] I have written a backpressure policy with metrics for each drop event.
- [ ] I can explain why `time.After` in a loop is a CI-blocking issue.
- [ ] I know how `errgroup` uses internal selects and contexts.
- [ ] I treat ` ctx context.Context` as mandatory for any goroutine.

---

## Summary

Professional `select` is about discipline. The construct itself is the same as junior; the difference is the surrounding system: every goroutine has an owner and a lifecycle, every for-select has a cancellation case, every queue has a backpressure policy, every timer has an owner that stops it. Observability — goroutine counts, channel depths, case-selection metrics, traces — turns invisible concurrency into a system you can debug. Code review enforces conventions before they become incidents. Once a team adopts this discipline, `select`-heavy code is no longer a source of late-night pages; it is a reliable engine.
