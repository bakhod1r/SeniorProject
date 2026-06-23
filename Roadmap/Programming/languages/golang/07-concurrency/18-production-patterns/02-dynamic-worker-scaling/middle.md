---
layout: default
title: Middle
parent: Dynamic Worker Scaling
grand_parent: Production Patterns
ancestor: Go
nav_order: 3
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/18-production-patterns/02-dynamic-worker-scaling/middle/
---

# Dynamic Worker Scaling — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Signals: Choosing the Right One](#signals-choosing-the-right-one)
5. [Queue-Depth Autoscaler in Detail](#queue-depth-autoscaler-in-detail)
6. [Wait-Time Autoscaler](#wait-time-autoscaler)
7. [Utilization-Based Autoscaler](#utilization-based-autoscaler)
8. [Cooldowns and Deadbands](#cooldowns-and-deadbands)
9. [Idle-Timeout Shrink](#idle-timeout-shrink)
10. [Resizing Without Disruption](#resizing-without-disruption)
11. [The Multi-Signal Decision](#the-multi-signal-decision)
12. [Moving Averages and EWMA](#moving-averages-and-ewma)
13. [Working with ants in Depth](#working-with-ants-in-depth)
14. [Coding Patterns](#coding-patterns)
15. [Clean Code](#clean-code)
16. [Error Handling and Recovery](#error-handling-and-recovery)
17. [Performance Tips](#performance-tips)
18. [Best Practices](#best-practices)
19. [Edge Cases and Pitfalls](#edge-cases-and-pitfalls)
20. [Common Mistakes](#common-mistakes)
21. [Common Misconceptions](#common-misconceptions)
22. [Tricky Points](#tricky-points)
23. [Test](#test)
24. [Tricky Questions](#tricky-questions)
25. [Cheat Sheet](#cheat-sheet)
26. [Self-Assessment Checklist](#self-assessment-checklist)
27. [Summary](#summary)
28. [What You Can Build](#what-you-can-build)
29. [Further Reading](#further-reading)
30. [Related Topics](#related-topics)
31. [Diagrams](#diagrams)

---

## Introduction
> Focus: "How do I choose a signal? How do I avoid oscillation? When does idle expiry beat external scaling?"

At junior level you wrote a pool that resizes on queue depth with a fixed deadband. That gets you to working software. Middle level is the engineering: choosing the right signal for the workload, smoothing samples so the system does not chase noise, integrating idle-timeout-based shrink with autoscaler-based grow, and reasoning about what happens during the resize itself.

After this chapter you should be able to:

- Choose between queue depth, wait time, utilization, and combinations
- Design hysteresis and cooldowns that match your workload's burst pattern
- Combine external autoscaler grow with per-worker idle shrink
- Use EWMA and rolling windows to smooth noisy signals
- Use ants's full API: `Tune`, idle expiry, panic handler, options
- Build a multi-signal decision function that respects upstream and downstream constraints
- Diagnose oscillation, slow shrink, fast oversize, and signal lag

This is the level where you have shipped one dynamic pool and need to build a second one for a different workload. The patterns rhyme; the details differ.

---

## Prerequisites

- You have read junior.md and understood the basic Resize/worker/autoscaler loop
- You have built one working dynamic pool, either by hand or with ants
- You are comfortable reading concurrent Go: channels, mutexes, atomics, sync.WaitGroup
- You have seen Prometheus metrics in some form (or another observability stack)
- You can describe Little's Law and apply it to estimate pool size

If you have not done the junior tasks file, do it now. Reading without building does not transfer.

---

## Glossary

| Term | Definition |
|------|------------|
| **Signal** | A measurable property the autoscaler reads to decide whether to resize. |
| **EWMA** | Exponentially-weighted moving average. A smoothed signal that weights recent samples more. |
| **Hysteresis** | Different thresholds for up and down. Prevents oscillation around a single set-point. |
| **Cooldown** | Minimum time interval between two resize events in the same direction. |
| **Deadband** | Range of signal values that triggers no action. Combined with hysteresis. |
| **Tuning** | Process of choosing thresholds, cooldowns, and step sizes for a workload. |
| **Idle expiry** | Per-worker mechanism that exits a worker after some idle time. |
| **Saturation** | State where adding more workers no longer increases throughput. |
| **Lag** | Delay between a signal change and the autoscaler's reaction. |
| **Flapping** | Pathological pattern where the pool changes size every tick. |
| **Set-point** | The target value of a signal that the autoscaler tries to maintain. |
| **Step size** | Number of workers added or removed per resize decision. |
| **Burst** | Brief, sharp increase in load. |
| **Plateau** | Sustained period of high or low load. |
| **Control loop** | The autoscaler goroutine, a feedback control system. |

---

## Signals: Choosing the Right One

A signal must answer: "Is the pool the right size right now?" Different workloads have different right signals.

### Queue depth: `len(jobs) / cap(jobs)`

Cheapest to compute. One atomic read. Always available. Lossy when the channel buffer is small relative to throughput.

**Use when:** queue is not the bottleneck (workers are usually idle), submissions are fast, tasks are short.

**Misuse:** if a slow downstream causes tasks to pile up in workers (not the queue), depth stays low while wait time skyrockets. Queue depth misses this.

```go
func DepthSignal(jobs chan Job) func() float64 {
    return func() float64 {
        return float64(len(jobs)) / float64(cap(jobs))
    }
}
```

### Wait time: time from submit to start-processing

Measures latency directly. The number that maps to your SLO.

**Use when:** SLO is expressed in terms of latency. Almost always.

**Cost:** track timestamps per task, compute moving average.

```go
type Job struct {
    Task      func()
    Submitted time.Time
}

func (p *Pool) worker() {
    for job := range p.jobs {
        wait := time.Since(job.Submitted)
        p.waitTimes.Add(wait)
        job.Task()
    }
}

func WaitSignal(p *Pool) func() float64 {
    return func() float64 {
        return p.waitTimes.P99().Seconds()
    }
}
```

### Utilization: fraction of workers currently busy

`busy / live`. A signal that does not depend on queue or wait — purely about whether you have spare workers.

**Use when:** you cannot easily measure wait time and queue is bypassed. Also good when you suspect over-provisioning.

```go
func UtilSignal(p *Pool) func() float64 {
    return func() float64 {
        busy := atomic.LoadInt32(&p.busyCount)
        live := atomic.LoadInt32(&p.liveSize)
        if live == 0 {
            return 0
        }
        return float64(busy) / float64(live)
    }
}
```

Track `busy` by incrementing on entry to a task and decrementing on exit:

```go
func (p *Pool) worker() {
    for job := range p.jobs {
        atomic.AddInt32(&p.busyCount, 1)
        job()
        atomic.AddInt32(&p.busyCount, -1)
    }
}
```

### CPU usage

`runtime.NumCPU()` available threads, measure with `gopsutil` or `/proc/stat`. Useful for CPU-bound work.

**Use when:** the bottleneck is CPU and you want to avoid going over a threshold.

### Error rate

If downstream is erroring, growing the pool makes it worse. A circuit-breaker-like signal that suppresses growth.

```go
func ErrorSignal(p *Pool) func() float64 {
    return func() float64 {
        total := atomic.LoadInt64(&p.totalTasks)
        errs := atomic.LoadInt64(&p.errorTasks)
        if total == 0 {
            return 0
        }
        return float64(errs) / float64(total)
    }
}
```

### Picking by workload

| Workload | Primary signal | Secondary |
|----------|----------------|-----------|
| HTTP request fan-out | Wait time | Queue depth |
| Bulk email | Queue depth | Error rate |
| Image processing | Utilization | CPU |
| Webhook delivery | Wait time | Error rate |
| Background sync | Queue depth | None |
| Real-time inference | Wait time | CPU |

The pattern: latency-sensitive use wait time; throughput-sensitive use queue depth; CPU-bound use CPU.

---

## Queue-Depth Autoscaler in Detail

The simplest autoscaler. Refresh from junior:

```go
func DepthAutoscaler(ctx context.Context, p Pool, jobs chan Job, opts Opts) {
    ticker := time.NewTicker(opts.Interval)
    defer ticker.Stop()
    var lastUp, lastDown time.Time
    for {
        select {
        case <-ctx.Done():
            return
        case now := <-ticker.C:
            depth := float64(len(jobs)) / float64(cap(jobs))
            cur := p.Size()
            switch {
            case depth > opts.HighWater && now.Sub(lastUp) > opts.UpCooldown:
                p.Resize(cur + opts.UpStep)
                lastUp = now
            case depth < opts.LowWater && now.Sub(lastDown) > opts.DownCooldown:
                p.Resize(cur - opts.DownStep)
                lastDown = now
            }
        }
    }
}
```

### Tuning the depth thresholds

The high-water (scale-up) threshold should be just above the depth at steady state. If steady-state depth is 30%, high-water at 60% leaves headroom for transient bursts. If high-water at 35%, you over-trigger.

The low-water (scale-down) threshold should be just below the depth at light load. If light load has 5% depth, low-water at 10% is safe. Lower (1%) is fine but slower to shrink.

The gap between low-water and high-water should be at least 4× — say 60% and 10%, or 80% and 15%. A narrow gap causes flapping.

### Why depth alone can mislead

Consider this scenario:

- Throughput target: 100 tasks/s
- Task processing: 100 ms each
- Workers: 10
- Steady-state: 10 workers always busy, queue mostly empty (depth ~ 5%)

The pool is at saturation. Adding workers would help. But depth is 5% — way below high-water. Autoscaler does nothing. Wait time grows. Customers complain.

The fix: combine depth with utilization. If depth < 10% but utilization > 90%, grow anyway.

```go
case (depth > opts.HighWater || util > 0.9) && now.Sub(lastUp) > opts.UpCooldown:
    p.Resize(cur + opts.UpStep)
```

This is the simplest multi-signal autoscaler. It catches both "queue is full" and "all workers are busy" cases.

---

## Wait-Time Autoscaler

Wait time is the gold standard. The challenge is collecting it efficiently and aggregating it correctly.

### Collection

```go
type WaitTracker struct {
    mu      sync.Mutex
    samples []time.Duration  // bounded ring buffer
    cap     int
    idx     int
}

func NewWaitTracker(cap int) *WaitTracker {
    return &WaitTracker{samples: make([]time.Duration, 0, cap), cap: cap}
}

func (w *WaitTracker) Add(d time.Duration) {
    w.mu.Lock()
    if len(w.samples) < w.cap {
        w.samples = append(w.samples, d)
    } else {
        w.samples[w.idx] = d
        w.idx = (w.idx + 1) % w.cap
    }
    w.mu.Unlock()
}

func (w *WaitTracker) Avg() time.Duration {
    w.mu.Lock()
    defer w.mu.Unlock()
    if len(w.samples) == 0 {
        return 0
    }
    var sum time.Duration
    for _, s := range w.samples {
        sum += s
    }
    return sum / time.Duration(len(w.samples))
}

func (w *WaitTracker) P99() time.Duration {
    w.mu.Lock()
    defer w.mu.Unlock()
    if len(w.samples) == 0 {
        return 0
    }
    sorted := make([]time.Duration, len(w.samples))
    copy(sorted, w.samples)
    sort.Slice(sorted, func(i, j int) bool { return sorted[i] < sorted[j] })
    idx := int(float64(len(sorted)) * 0.99)
    if idx >= len(sorted) {
        idx = len(sorted) - 1
    }
    return sorted[idx]
}
```

A simple ring buffer of recent samples. Average is one pass. P99 needs a sort (O(n log n)) but with n=1000 samples that is microseconds.

For very high throughput, use a histogram (HDR Histogram or Prometheus's native) — bucketed counts avoid the sort entirely.

### Decision

```go
type WaitOpts struct {
    HighP99      time.Duration  // grow above this
    LowAvg       time.Duration  // shrink below this
    UpStep       int
    DownStep     int
    UpCooldown   time.Duration
    DownCooldown time.Duration
}

func WaitAutoscaler(ctx context.Context, p Pool, tracker *WaitTracker, opts WaitOpts) {
    ticker := time.NewTicker(500 * time.Millisecond)
    defer ticker.Stop()
    var lastUp, lastDown time.Time
    for {
        select {
        case <-ctx.Done():
            return
        case now := <-ticker.C:
            p99 := tracker.P99()
            avg := tracker.Avg()
            cur := p.Size()
            switch {
            case p99 > opts.HighP99 && now.Sub(lastUp) > opts.UpCooldown:
                p.Resize(cur + opts.UpStep)
                lastUp = now
            case avg < opts.LowAvg && now.Sub(lastDown) > opts.DownCooldown:
                p.Resize(cur - opts.DownStep)
                lastDown = now
            }
        }
    }
}
```

Note: we grow based on p99 (the slow tail) and shrink based on avg (the typical case). This asymmetry is intentional. If p99 is bad, customers notice. If avg is fast, customers are happy — and you can shrink.

### Sample size matters

If you collect only 10 samples, p99 is essentially "the worst of 10" — noisy. With 1000 samples, p99 is meaningful. Match the window to your throughput:

- 100 tasks/sec → 1000 samples is 10 s of history → fine
- 10 tasks/sec → 1000 samples is 100 s of history → too slow
- 10000 tasks/sec → 1000 samples is 100 ms of history → use 10000 samples instead

The library `tdigest` is the production-grade tool for streaming quantiles. Use it for high-throughput workloads.

---

## Utilization-Based Autoscaler

Utilization is the cleanest signal because it has a natural set-point: 70-80%. Below means over-provisioned; above means under-provisioned.

### Collection

Already shown above: increment `busy` on task start, decrement on end.

```go
func (p *Pool) Utilization() float64 {
    busy := atomic.LoadInt32(&p.busyCount)
    live := atomic.LoadInt32(&p.liveSize)
    if live == 0 {
        return 0
    }
    return float64(busy) / float64(live)
}
```

### Decision

```go
func UtilAutoscaler(ctx context.Context, p *Pool, opts UtilOpts) {
    ticker := time.NewTicker(opts.Interval)
    defer ticker.Stop()
    var lastUp, lastDown time.Time
    for {
        select {
        case <-ctx.Done():
            return
        case now := <-ticker.C:
            u := p.Utilization()
            cur := p.Size()
            switch {
            case u > 0.85 && now.Sub(lastUp) > opts.UpCooldown:
                p.Resize(cur + max(1, cur/10))
                lastUp = now
            case u < 0.30 && now.Sub(lastDown) > opts.DownCooldown:
                p.Resize(cur - max(1, cur/10))
                lastDown = now
            }
        }
    }
}
```

The step size is `cur/10` — 10% growth or 10% shrink. This makes the autoscaler's effect proportional to current size: a small pool grows by 1, a large pool grows by tens.

### Why 70-80% target?

Below 70%, you have idle workers most of the time — waste. Above 80%, a single slow task creates queue buildup — risk.

70% is conservative; 80% is aggressive. CPU-bound work tolerates closer to 80%; latency-sensitive work prefers 60%. Tune to your tolerance.

### Combined utilization + depth

A robust autoscaler:

```go
should := func(u, d float64, cur int) (int, string) {
    switch {
    case u > 0.85:
        return cur + 2, "high-util"
    case d > 0.75:
        return cur + 2, "deep-queue"
    case u < 0.30 && d < 0.10:
        return cur - 1, "low-everything"
    default:
        return cur, "no-change"
    }
}
```

Grow on *either* high signal (catches both saturation and queue buildup). Shrink only on *both* low signals (be conservative).

---

## Cooldowns and Deadbands

The two main defenses against oscillation. Let us look at both in detail.

### Deadband

A range of signal values where no action is taken. Wider deadband = more stable, slower to react.

```
signal: 0 ----low---- 0.1 ---- 0.75 ---high----- 1.0
                       |   no action  |
            shrink                       grow
```

Choosing the gap:

- Narrow (low=20%, high=30%): reacts fast, flaps
- Medium (low=10%, high=50%): typical production
- Wide (low=5%, high=75%): very stable, slower

For most workloads, medium. For ones where flap is catastrophic (resize is expensive somehow), wide.

### Cooldown

The minimum interval between consecutive resize events. Different up and down:

- Up cooldown: 2-5 s. Pool should grow fast under load.
- Down cooldown: 30-120 s. Pool should shrink reluctantly.

Why asymmetric? Cost of over-shrinking (cold start under load) > cost of over-growing (a few extra worker stacks).

```go
type Cooldown struct {
    UpAfter, DownAfter time.Duration
    lastUp, lastDown   time.Time
}

func (c *Cooldown) AllowUp(now time.Time) bool {
    return now.Sub(c.lastUp) >= c.UpAfter
}
func (c *Cooldown) AllowDown(now time.Time) bool {
    return now.Sub(c.lastDown) >= c.DownAfter
}
func (c *Cooldown) RecordUp(now time.Time)   { c.lastUp = now }
func (c *Cooldown) RecordDown(now time.Time) { c.lastDown = now }
```

### Why both?

Deadband alone is not enough: signal just outside the deadband causes constant resize. Cooldown alone is not enough: tick rate determines frequency, and reactive but slow can still oscillate.

Together: deadband filters noise within a value range, cooldown filters noise across time. Both axes covered.

---

## Idle-Timeout Shrink

A different approach to scale-down: each worker decides on its own when to exit.

### The pattern

```go
func (p *Pool) worker() {
    timer := time.NewTimer(p.idleTimeout)
    defer timer.Stop()
    for {
        select {
        case job, ok := <-p.jobs:
            if !ok {
                return
            }
            if !timer.Stop() {
                <-timer.C
            }
            job()
            timer.Reset(p.idleTimeout)
        case <-timer.C:
            if atomic.LoadInt32(&p.liveSize) > p.floor {
                atomic.AddInt32(&p.liveSize, -1)
                return
            }
            timer.Reset(p.idleTimeout)
        case <-p.quit:
            return
        }
    }
}
```

Each worker has its own timer. If the timer fires before a job arrives, the worker exits (provided pool is above floor).

### Why this works

- Truly decentralised. No autoscaler goroutine needed for shrink.
- Naturally rate-limits shrinkage: only one worker exits per timer expiry.
- Workers self-test the floor. No race with central decision.

### Why combine with external autoscaler

Idle-timeout handles long-tail shrink (slow drain after a burst). External autoscaler handles burst-grow (need to add workers fast). Together:

- External: rapidly add workers when signal says load is up
- Internal: each worker exits after N seconds idle, never below floor

ants uses exactly this combination by default.

### Choosing the idle timeout

Too short (1 s): workers thrash; pool size oscillates with workload variance.
Too long (5 min): pool stays oversized for minutes after a burst ends.

Typical: 30 s to 2 minutes. For CPU-bound work, shorter (less to save). For I/O-bound with long idle periods, longer.

### Interaction with floor

The floor is sacrosanct. Idle-timeout never shrinks below floor:

```go
if atomic.LoadInt32(&p.liveSize) > p.floor {
    // ok to exit
}
```

Workers atomically check the floor; if multiple workers race to exit simultaneously, only those that see live > floor proceed. There is a small race window but it bottoms out at floor.

### Implementing in ants

```go
p, _ := ants.NewPool(64, ants.WithExpiryDuration(30 * time.Second))
```

ants's `WithExpiryDuration` is exactly this idle-timeout. The library handles the timer per worker and the floor check internally.

---

## Resizing Without Disruption

What happens during a resize? Subtle things. Let us walk through.

### Grow without disruption

Spawning new workers does not affect existing ones. They are simply additional consumers on the same channel. Existing workers continue processing their current tasks; new workers start picking up new jobs in microseconds.

There is no downtime, no queue freeze, no caller blockage. Grow is operationally free.

### Shrink without disruption

The opportunistic shrink we covered earlier:

```go
func (p *Pool) worker() {
    for {
        if atomic.LoadInt32(&p.liveSize) > atomic.LoadInt32(&p.targetSize) {
            atomic.AddInt32(&p.liveSize, -1)
            return
        }
        select { /* ... */ }
    }
}
```

A worker mid-task does not see the shrink signal until it finishes its current job. So:

- Worker A is processing a 10-second task. Pool is told to shrink.
- Worker A continues processing. After 10 s, finishes.
- Worker A loops back. Sees live > target. Exits.

If you need *immediate* shrink (worker should drop its current task and exit), you need cooperative cancellation. We cover that next.

### Cooperative cancellation

Add per-task contexts and have workers monitor them:

```go
type Job struct {
    Ctx  context.Context
    Task func(ctx context.Context)
}

func (p *Pool) Submit(ctx context.Context, task func(ctx context.Context)) error {
    return p.submit(Job{Ctx: ctx, Task: task})
}

func (p *Pool) worker(workerCtx context.Context) {
    for {
        select {
        case <-workerCtx.Done():
            return
        case job := <-p.jobs:
            jobCtx, cancel := context.WithCancel(job.Ctx)
            done := make(chan struct{})
            go func() {
                job.Task(jobCtx)
                close(done)
            }()
            select {
            case <-done:
            case <-workerCtx.Done():
                cancel()
                <-done  // wait for task to actually exit
                return
            }
        }
    }
}
```

This is heavier. A goroutine per task to enable cancellation. Acceptable for long tasks; overkill for short ones.

Workers built this way can respect a per-resize signal: when `liveSize > targetSize`, cancel the current task's context and exit.

### Trade-off

| Approach | Shrink speed | Complexity | Task disruption |
|----------|--------------|------------|-----------------|
| Opportunistic | Slow (~task duration) | Low | None |
| Cooperative | Fast (~milliseconds) | Medium | Cancels in-flight tasks |
| Forceful (impossible in Go) | Instant | N/A | Loses work |

Most production pools use opportunistic. Cooperative is for long-running tasks where slow shrink would tie up resources for hours.

---

## The Multi-Signal Decision

Real production autoscalers combine signals. Three patterns:

### Pattern: priority signals

```go
func Decide(signals Signals, cur int) int {
    if signals.ErrorRate > 0.10 {
        // downstream is in trouble; don't grow
        return cur
    }
    if signals.CPU > 0.85 {
        // CPU saturated; don't grow
        return cur
    }
    if signals.WaitP99 > time.Second {
        return cur + 2  // grow on bad tail
    }
    if signals.QueueDepth > 0.75 {
        return cur + 1  // grow on full queue
    }
    if signals.Util < 0.30 && signals.QueueDepth < 0.10 {
        return cur - 1
    }
    return cur
}
```

Read top-to-bottom. First condition that matches wins. Error rate and CPU are veto signals: they suppress growth.

### Pattern: weighted score

```go
func Decide(signals Signals, cur int) int {
    score := 0.0
    score += signals.QueueDepth * 2.0
    score += signals.Util * 3.0
    score -= signals.ErrorRate * 5.0
    score -= signals.CPUHeadroom() * 1.0
    switch {
    case score > 2.0:
        return cur + int(score/2)
    case score < 0.5:
        return cur - 1
    default:
        return cur
    }
}
```

Each signal contributes with a coefficient. Positive scores grow; negative shrink. The coefficients encode policy. Tuning becomes "pick the right coefficients."

### Pattern: state machine

Idle, Growing, Shrinking, Saturated. Transitions between states based on signals. Within a state, fixed behaviour.

```go
type State int
const (
    StateIdle State = iota
    StateNormal
    StateGrowing
    StateShrinking
    StateSaturated
)

func (a *Autoscaler) step(signals Signals) {
    switch a.state {
    case StateIdle:
        if signals.QueueDepth > 0.1 {
            a.state = StateNormal
        }
    case StateNormal:
        if signals.WaitP99 > a.SLO {
            a.state = StateGrowing
        } else if signals.Util < 0.3 {
            a.state = StateShrinking
        }
    case StateGrowing:
        a.pool.Resize(a.pool.Size() + 4)
        if signals.WaitP99 < a.SLO/2 {
            a.state = StateNormal
        }
        if a.pool.Size() >= a.ceiling {
            a.state = StateSaturated
        }
    // ...
    }
}
```

Useful for very complex policies. Overkill for most. Lean toward priority or weighted patterns for first implementations.

---

## Moving Averages and EWMA

Raw signals are noisy. The autoscaler should react to *trends*, not single samples.

### Simple moving average (SMA)

Last N samples, sum / N. Easy. Memory: N values.

```go
type SMA struct {
    samples []float64
    cap     int
    idx     int
}

func (s *SMA) Add(v float64) {
    if len(s.samples) < s.cap {
        s.samples = append(s.samples, v)
        return
    }
    s.samples[s.idx] = v
    s.idx = (s.idx + 1) % s.cap
}

func (s *SMA) Avg() float64 {
    if len(s.samples) == 0 { return 0 }
    var sum float64
    for _, v := range s.samples { sum += v }
    return sum / float64(len(s.samples))
}
```

### Exponentially-weighted moving average (EWMA)

Each sample contributes less as it ages. Single state variable; very cheap.

```go
type EWMA struct {
    value float64
    alpha float64  // smoothing factor, 0 < alpha < 1
    primed bool
}

func NewEWMA(alpha float64) *EWMA {
    return &EWMA{alpha: alpha}
}

func (e *EWMA) Add(v float64) {
    if !e.primed {
        e.value = v
        e.primed = true
        return
    }
    e.value = e.alpha*v + (1-e.alpha)*e.value
}

func (e *EWMA) Value() float64 { return e.value }
```

Alpha = 0.1: roughly the last 10 samples have meaningful weight.
Alpha = 0.3: roughly the last 3 samples.

Higher alpha = faster reaction, more noise. Lower = smoother, slower to react.

### Which to use?

- For autoscaling decisions: EWMA with alpha=0.1 to 0.3.
- For percentiles (p99): SMA-style ring buffer, sorted.
- For metric export: histogram (Prometheus native).

Combining: use EWMA for the autoscaler's signal, expose SMA p99 to metrics for ops to see.

---

## Working with ants in Depth

ants is the de facto Go pool library. Let us look at its features beyond `NewPool` and `Tune`.

### Options

```go
p, err := ants.NewPool(64,
    ants.WithPreAlloc(true),
    ants.WithExpiryDuration(60 * time.Second),
    ants.WithNonblocking(true),
    ants.WithMaxBlockingTasks(0),
    ants.WithPanicHandler(func(r interface{}) {
        log.Printf("worker panic: %v", r)
    }),
    ants.WithLogger(myLogger),
)
```

| Option | Purpose |
|--------|---------|
| `WithPreAlloc(true)` | Allocate all worker slots upfront. Predictable memory, slower first submits. |
| `WithExpiryDuration(d)` | Idle workers exit after `d`. Default 1 s. |
| `WithNonblocking(true)` | `Submit` returns `ErrPoolOverload` if full. |
| `WithMaxBlockingTasks(n)` | Limit number of goroutines blocked in Submit. After `n`, more get error. |
| `WithPanicHandler(f)` | Function called when a task panics. Default: log and continue. |
| `WithLogger(l)` | Custom logger for internal events. |
| `WithDisablePurge(true)` | Disable idle expiry entirely. Workers never exit on their own. |

### PoolWithFunc

If every submit calls the same function, use `PoolWithFunc`. Faster because the function is bound once.

```go
p, err := ants.NewPoolWithFunc(64, func(arg interface{}) {
    payload := arg.(MyPayload)
    process(payload)
})
defer p.Release()

p.Invoke(MyPayload{ID: 1})
p.Invoke(MyPayload{ID: 2})
```

A few percent faster than `NewPool` because the per-task closure capture is avoided. Worth using if you have hot loops.

### Tuning gotchas

`Tune(n)` immediately changes the *cap*. Workers above cap exit on next idle. But: `Tune(0)` is allowed and immediately stalls all new submits (Submit blocks forever waiting for a slot).

```go
p.Tune(0)  // disables the pool
p.Submit(task) // blocks forever, until p.Tune(>0) is called
```

This is sometimes intentional (pause processing) but mostly a footgun.

### Multiple pools

You can have multiple ants pools per process. Each has its own cap, autoscaler, and metrics. Common pattern: one pool per downstream:

```go
type Service struct {
    dbPool       *ants.Pool
    emailPool    *ants.Pool
    webhookPool  *ants.Pool
}
```

Each tuned to its downstream's capacity. The DB pool stays small (DB connections limit you); email pool can be large (SMTP is generous); webhook pool tunes by wait time.

### ants vs PoolWithFunc vs MultiPool

- `Pool`: each submit takes a closure. Flexible. Default.
- `PoolWithFunc`: faster for homogeneous work.
- `MultiPool`: a wrapper that distributes work across N internal pools, sharded by key. Reduces contention on the free list at very high throughput.

For most projects, plain `Pool`. Switch to `PoolWithFunc` if profiling shows closure overhead. Switch to `MultiPool` at >100k req/s if free-list lock contention becomes visible.

---

## Coding Patterns

### Pattern: Build the autoscaler as a state struct

```go
type Autoscaler struct {
    Pool         Resizer
    Signal       func() float64
    Decide       func(cur int, sig float64) int
    Interval     time.Duration
    UpCooldown   time.Duration
    DownCooldown time.Duration
    Floor, Ceiling int
    Logger       *slog.Logger
}

func (a *Autoscaler) Run(ctx context.Context) {
    ticker := time.NewTicker(a.Interval)
    defer ticker.Stop()
    var lastUp, lastDown time.Time
    for {
        select {
        case <-ctx.Done():
            return
        case now := <-ticker.C:
            sig := a.Signal()
            cur := a.Pool.Size()
            next := a.Decide(cur, sig)
            if next < a.Floor { next = a.Floor }
            if next > a.Ceiling { next = a.Ceiling }
            if next == cur { continue }
            if next > cur && now.Sub(lastUp) < a.UpCooldown { continue }
            if next < cur && now.Sub(lastDown) < a.DownCooldown { continue }
            a.Pool.Resize(next)
            if next > cur { lastUp = now } else { lastDown = now }
            a.Logger.Info("resize", "from", cur, "to", next, "signal", sig)
        }
    }
}
```

This struct is reusable across pools. Inject signal, decide, pool. Test by injecting fakes.

### Pattern: Decision functions as pure values

```go
var DepthBased = func(cur int, sig float64) int {
    switch {
    case sig > 0.75: return cur + 1
    case sig < 0.10: return cur - 1
    default: return cur
    }
}

var WaitBased = func(cur int, sig float64) int {
    switch {
    case sig > 1.0: return cur + 2   // 1.0 s p99 too high
    case sig < 0.05: return cur - 1
    default: return cur
    }
}
```

Pure functions. Trivially testable. Composable into multi-signal versions.

### Pattern: Periodic metrics export

```go
func (a *Autoscaler) exportMetrics(p Pool, sig func() float64) {
    poolSize.Set(float64(p.Size()))
    signalValue.Set(sig())
    // call this from inside the autoscaler loop
}
```

Centralize metrics export. Easier to keep gauges consistent.

### Pattern: Bounded retry on Resize failure

```go
func (a *Autoscaler) resize(target int) {
    const maxAttempts = 3
    for i := 0; i < maxAttempts; i++ {
        if err := a.Pool.Resize(target); err == nil {
            return
        }
        time.Sleep(50 * time.Millisecond)
    }
    a.Logger.Warn("resize failed", "target", target)
}
```

Some resize implementations may fail (e.g., memory allocation). Retry briefly; if it still fails, log and stay at current size.

---

## Clean Code

- **Name signals.** `WaitP99`, `QueueDepthPct`, `WorkerUtilization`. Not `s`, `sig`, `v`.
- **Group config in a struct.** `Opts{HighWater, LowWater, UpCooldown, ...}`.
- **Separate observation from action.** Sampling and deciding are different concerns.
- **Document policy in comments.** Why this threshold? Why this cooldown? Future maintainers will appreciate it.
- **Use atomic types from `sync/atomic`.** Avoid mixing atomic and non-atomic access to the same variable.
- **Single autoscaler goroutine.** Multiple fighting each other is a recurring bug.
- **Constants for magic numbers.** `const ScaleUpThreshold = 0.75`. Not inline.

---

## Error Handling and Recovery

### Panic in workers

```go
func (p *Pool) safeRun(task func()) {
    defer func() {
        if r := recover(); r != nil {
            p.panicHandler(r, debug.Stack())
        }
    }()
    task()
}
```

Always wrap. One unrecovered panic in any worker takes down your process.

### Panic in autoscaler

```go
func (a *Autoscaler) Run(ctx context.Context) {
    defer func() {
        if r := recover(); r != nil {
            a.Logger.Error("autoscaler panicked", "panic", r)
        }
    }()
    a.run(ctx)
}
```

Recover at the top. Log. Optionally restart the autoscaler.

### Resize failure

If `Resize` returns an error (memory exhausted, e.g.), log and continue. The autoscaler's job is best-effort.

### Signal collection failure

If your signal source becomes unavailable (e.g., Prometheus exporter is down), return a safe default and log. Do not crash.

```go
func (a *Autoscaler) safeSignal() float64 {
    defer func() {
        if r := recover(); r != nil {
            a.Logger.Warn("signal collection panicked", "panic", r)
        }
    }()
    return a.Signal()
}
```

### Closed pool

If `Resize` is called on a closed pool, it should be a no-op (or return an error). The autoscaler should detect closure and exit cleanly.

---

## Performance Tips

- **Cache `len(jobs)`/`cap(jobs)`.** They are atomic but recomputing them in a hot loop is wasteful.
- **Use `atomic.Int32` (Go 1.19+) for cleaner code.** Avoids `atomic.LoadInt32(&v)` pattern.
- **EWMA over SMA for cheap state.** Single float, one multiply, one add.
- **Histograms for percentiles, not sort.** Prometheus's native histogram is logarithmic in storage.
- **Tick rate matters.** 100 ms tick on a busy pool is overkill; 5 s tick on a bursty pool is too slow.
- **Avoid printf in autoscaler.** String formatting in a tight loop adds GC pressure.
- **Sample, don't trace.** Don't record every task's wait time. Sample 1 in 100 if throughput is high.
- **Reduce lock scope.** Resize holds a mutex; the part outside the lock (the actual `go worker()`) can be moved out for less contention.

---

## Best Practices

1. Start with a single signal (queue depth or wait time). Add more only when measurement shows the single signal is insufficient.
2. Tune empirically. No theoretical thresholds. Run for a week with logging; adjust.
3. Always have a ceiling. Even if cost is no object, a ceiling protects you from a runaway autoscaler.
4. Couple grow with backpressure at the ceiling. When pool is at max, `Submit` should error or queue with timeout.
5. Watch resize-events/min. > 30 means you are flapping. < 1 means you are barely autoscaling.
6. Set alert thresholds tighter than your SLO. If SLO is p99 < 1 s, alert at p99 > 800 ms — autoscaler should react first.
7. Combine external grow with internal idle-shrink. Best of both worlds.
8. Test with synthetic bursts before deploy.
9. Roll out gradually. Shadow mode, canary, gradual percentages.
10. Document the policy. Future you will not remember why the threshold is 0.65 vs 0.75.

---

## Edge Cases and Pitfalls

### Pitfall: Resize during shutdown

If `Close` and `Resize` race, you may spawn a worker into a closing pool. Always guard `Resize` with a closing flag.

### Pitfall: Multiple autoscaler goroutines

Common when refactoring. Two goroutines reading the same signal and calling `Resize` independently. Pool oscillates. Always have one.

### Pitfall: Step size too large

`Resize(cur * 2)` doubles. Under a brief burst, you end up with 256 workers when 16 would have sufficed. Use additive growth (`cur + 4`) unless you have evidence multiplicative is needed.

### Pitfall: Wait-time measurement at very high throughput

Tracking timestamps per task costs memory and CPU. Sample (record 1 in N) at very high throughput. Or use histograms.

### Pitfall: Pool grows during error storm

Downstream is failing. Tasks pile up. Queue grows. Autoscaler grows the pool. More requests hit the failing downstream. Stampede.

Defense: combine with error-rate signal that vetoes growth.

### Pitfall: Idle timeout interacts with floor

If idle timeout is 30 s and floor is 4, the first 4 idle workers never exit even if they have been idle 10 minutes. That is correct — floor is sacrosanct. But beware: in some implementations, the timer fires and the worker is woken just to find `live <= floor` and reset. Cheap (microseconds), but worth understanding.

### Pitfall: `Tune(big)` during a memory crunch

ants does not refuse `Tune(1000)` just because the system is OOM. It will try to spawn. If it cannot, future tasks block. Defense: combine tune with a memory-availability check.

### Pitfall: Resize storm at startup

Pool starts at 0 (or floor). Burst hits immediately. Autoscaler grows aggressively. Pool overshoots, takes minutes to settle.

Defense: start at a sensible initial size (Little's Law estimate). Or warm up: grow to estimated size before accepting traffic.

### Pitfall: Cooldown counted from action, not from start

If cooldown is 30 s from the *start* of the last action, and the action takes 5 s to actually complete (Resize spawning many workers), you might be at 25 s into the cooldown when the previous resize finished. Confusing. Just track from when `lastUp` was assigned.

---

## Common Mistakes

1. Using `len(ch)` without averaging. Single-sample reactions are noisy.
2. Same cooldown for up and down. Should be asymmetric.
3. No floor. Pool drops to 0; cold start hurts.
4. No ceiling. Memory blows up under runaway autoscaler.
5. Multiple autoscalers fighting. Always use one.
6. Resize without lock. Race on counters.
7. Atomic decrement at wrong time. Defer order matters.
8. Idle expiry too aggressive. Pool thrashes.
9. Idle expiry too lazy. Pool stays oversized for hours.
10. Tracking pool size with `runtime.NumGoroutine()`. Counts everything.
11. Forgetting `recover` in workers. One bug kills the pool.
12. Resize from inside a worker. Causes lock-order issues.
13. Tuning to 100% utilization. No headroom for variance.
14. Ignoring downstream signals. Pool grows during downstream failure.

---

## Common Misconceptions

- *"Tune(n) is synchronous."* Not always. ants Tune sets a cap; shrink happens lazily.
- *"More workers = more throughput."* Only up to the bottleneck. After that, more workers just queue at the bottleneck.
- *"Wait time and queue depth are the same."* No. Wait time depends on processing time too.
- *"PID controller is overkill."* For most workloads, yes. For sustained tight control, no.
- *"EWMA introduces lag."* It does, by design. The lag is the smoothing benefit.
- *"`runtime.NumCPU()` is the right ceiling."* Only for CPU-bound.
- *"Autoscaler must run in the same process."* Not necessarily. Could be controlled externally (Kubernetes operator, etc.).

---

## Tricky Points

- **Atomicity of "read live, write live."** `atomic.AddInt32(&liveSize, 1)` is one CPU instruction. `liveSize++` is read-modify-write — three operations, none atomic. Always use atomics.
- **Cooldown and tick rate.** A 5-second cooldown with a 100 ms tick means 50 ticks pass without action. Make sure the cooldown is larger than tick * some-margin.
- **Step size and ceiling.** If step is 4 and ceiling is 100, you can land at 100 exactly, but not at 102. Clamp.
- **Idle timer vs scale-down.** Idle timer is per-worker; scale-down is global. Different mechanisms; can coexist; document which dominates.
- **`Tune(0)` blocks Submit.** Allowed but a footgun.
- **Wait time is queue + processing.** If your worker code measures wait, it might accidentally include processing time. Measure at queue-exit explicitly.

---

## Test

Tests for the middle pool need to cover signal accuracy and decision correctness in addition to junior-level correctness.

```go
func TestEWMA(t *testing.T) {
    e := NewEWMA(0.3)
    samples := []float64{1, 1, 1, 1, 100, 1, 1, 1, 1}
    for _, s := range samples { e.Add(s) }
    if e.Value() > 50 || e.Value() < 5 {
        t.Errorf("EWMA spike not smoothed: %f", e.Value())
    }
}

func TestDeciderGrowsOnHighWait(t *testing.T) {
    decide := WaitBased
    next := decide(8, 2.0) // 2 s p99
    if next <= 8 {
        t.Errorf("expected grow, got %d", next)
    }
}

func TestCooldownPreventsRapidResize(t *testing.T) {
    cd := Cooldown{UpAfter: time.Second}
    now := time.Now()
    cd.RecordUp(now)
    if cd.AllowUp(now.Add(500 * time.Millisecond)) {
        t.Error("cooldown allowed up too early")
    }
    if !cd.AllowUp(now.Add(2 * time.Second)) {
        t.Error("cooldown blocked legitimate up")
    }
}
```

Property-based tests are useful here:

```go
func TestDecideRespectsBounds(t *testing.T) {
    for i := 0; i < 1000; i++ {
        cur := rand.Intn(100)
        sig := rand.Float64()
        next := Decide(cur, sig)
        if next < 1 || next > 1000 {
            t.Errorf("decide out of bounds: cur=%d sig=%f got=%d", cur, sig, next)
        }
    }
}
```

---

## Tricky Questions

1. **Why is wait time better than queue depth for latency SLOs?**
   Queue depth says "how many waiting" but not "how long they wait." Wait time directly maps to the customer-visible metric. SLO is in time; signal should be in time.

2. **Why are up and down cooldowns asymmetric?**
   Cost of missing capacity (during a burst) is higher than cost of extra capacity (during a calm). So: grow eagerly, shrink reluctantly.

3. **How does EWMA differ from SMA?**
   SMA: equal weight to last N samples, sharp cutoff. EWMA: gradually fading weight, no sharp cutoff, single-state. EWMA is cheaper and smoother but lags more for sustained changes.

4. **When does idle expiry alone suffice for scale-down?**
   When your load varies gradually. Idle expiry naturally shrinks the pool over time as workers idle out. For abrupt load drops, idle expiry takes a while; autoscaler-driven shrink is faster.

5. **What if Tune is called every 100 ms with a different value?**
   ants handles it. Each call atomically sets the cap. Only the last call matters; shrink is opportunistic. Cost: nanoseconds per call.

6. **How do you scale a pool that talks to a single downstream connection?**
   You cannot scale beyond the downstream's concurrency limit. Use a token bucket inside each worker to rate-limit downstream calls. Pool size and downstream throughput are independent.

7. **What signal would you use for a worker pool processing GPU jobs?**
   GPU utilization, not pool utilization. The GPU is the bottleneck, not the worker count. You probably want 1 worker per GPU.

8. **How do you handle a workload with extreme bimodality (90% fast, 10% slow)?**
   Two pools: one tuned for fast jobs, one for slow. Route on submit. A single pool's autoscaler cannot serve both well.

---

## Cheat Sheet

```go
// Signal types:
queueDepth := float64(len(jobs)) / float64(cap(jobs))
waitP99    := tracker.P99()
utilization := float64(busy) / float64(live)

// Decision rules:
//   wait p99 > SLO → grow
//   util > 0.85    → grow
//   depth > 0.75   → grow
//   error > 10%    → don't grow (veto)
//   all signals low → shrink

// Defenses against oscillation:
//   deadband: gap between up and down thresholds (4× wide)
//   cooldown: up=2-5s, down=30-60s, asymmetric

// Smoothing:
//   EWMA(0.1-0.3) for autoscale signal
//   Ring buffer + sort for p99 export
//   Sample 1-in-N for high throughput

// ants:
ants.NewPool(64,
    ants.WithExpiryDuration(60 * time.Second),
    ants.WithNonblocking(true),
    ants.WithPanicHandler(...),
)
p.Tune(n) // resize cap
p.Running() // busy count
p.Cap()  // current cap
p.Free() // cap - running
```

---

## Self-Assessment Checklist

- [ ] I can pick the right signal for a given workload
- [ ] I can implement EWMA from memory
- [ ] I can implement a rolling-window P99 tracker
- [ ] I can write a multi-signal autoscaler with priority signals
- [ ] I understand why up/down cooldowns differ
- [ ] I can use ants's full option set
- [ ] I can combine idle-timeout with external autoscaler
- [ ] I know when opportunistic shrink is too slow
- [ ] I can implement cooperative cancellation when needed
- [ ] I can test the autoscaler in isolation from real pool

If 9 of 10, ready for senior.

---

## Summary

Junior taught you the mechanism: spawn, exit, resize, autoscale. Middle teaches you the policy: which signal, which thresholds, which cooldowns, when to smooth.

The big patterns:
- Wait time is the SLO-aligned signal; queue depth and utilization are cheap secondaries
- Hysteresis (deadband) plus cooldown (interval) defends against oscillation
- EWMA smooths cheaply; sample for high throughput
- Idle expiry handles long-tail shrink; autoscaler handles burst-grow
- Multi-signal decisions: priority order or weighted score
- ants is production-grade; learn its options

Take the middle tasks file; build a wait-time autoscaler; observe; tune. Then senior introduces AIMD, PID, and integration with backpressure and breakers.

---

## What You Can Build

- A wait-time autoscaled webhook delivery pool
- A multi-pool worker farm with per-pool autoscaling (one per downstream)
- A telemetry-rich autoscaler with Prometheus metrics and Grafana dashboard
- A graceful-shutdown wrapper that pauses autoscaling during deploy
- A pool with shadow-mode autoscaler logging proposed but not actual resizes

---

## Further Reading

- `panjf2000/ants` source — `pool.go`, `worker.go`, `worker_loop_queue.go`
- "Practical Reliability Patterns" — Brendan Burns
- "Designing Data-Intensive Applications", chapter on dataflow and backpressure
- "Site Reliability Engineering" by Google, autoscaling chapters
- Cloudflare's blog on edge worker pool tuning

---

## Related Topics

- Backpressure: complementary to autoscaling
- Circuit breakers: signal source and growth veto
- Little's Law: sizing baseline
- Graceful shutdown: how to close a dynamic pool

---

## Deep Dive: Building a Production Wait-Time Autoscaler

Let us build a complete, idiomatic production autoscaler for a wait-time-driven workload. We will use ants for the pool and wrap it with metrics, EWMA smoothing, and proper cooldowns.

### Step 1: define the wait tracker

```go
package main

import (
    "sort"
    "sync"
    "time"
)

type WaitTracker struct {
    mu       sync.Mutex
    samples  []time.Duration
    cap      int
    idx      int
    full     bool
}

func NewWaitTracker(cap int) *WaitTracker {
    return &WaitTracker{
        samples: make([]time.Duration, cap),
        cap:     cap,
    }
}

func (w *WaitTracker) Record(d time.Duration) {
    w.mu.Lock()
    w.samples[w.idx] = d
    w.idx++
    if w.idx >= w.cap {
        w.idx = 0
        w.full = true
    }
    w.mu.Unlock()
}

func (w *WaitTracker) length() int {
    if w.full { return w.cap }
    return w.idx
}

func (w *WaitTracker) Quantile(q float64) time.Duration {
    w.mu.Lock()
    n := w.length()
    if n == 0 {
        w.mu.Unlock()
        return 0
    }
    sorted := make([]time.Duration, n)
    copy(sorted, w.samples[:n])
    w.mu.Unlock()
    sort.Slice(sorted, func(i, j int) bool { return sorted[i] < sorted[j] })
    idx := int(float64(n-1) * q)
    return sorted[idx]
}

func (w *WaitTracker) Mean() time.Duration {
    w.mu.Lock()
    defer w.mu.Unlock()
    n := w.length()
    if n == 0 { return 0 }
    var sum time.Duration
    for _, s := range w.samples[:n] {
        sum += s
    }
    return sum / time.Duration(n)
}
```

This is a circular buffer that supports quantile and mean queries. Memory is fixed (`cap` slots), so high throughput does not bloat memory. Quantile sorts on demand; for high-frequency queries, use t-digest.

### Step 2: define the pool wrapper

```go
package main

import (
    "log/slog"
    "sync"
    "sync/atomic"
    "time"

    "github.com/panjf2000/ants/v2"
)

type Job struct {
    Task      func()
    Submitted time.Time
}

type Pool struct {
    raw         *ants.PoolWithFunc
    tracker     *WaitTracker
    busyCount   int32
    submitted   int64
    completed   int64
    dropped     int64
}

func NewPool(initialCap int) (*Pool, error) {
    p := &Pool{
        tracker: NewWaitTracker(1000),
    }
    raw, err := ants.NewPoolWithFunc(initialCap, p.run,
        ants.WithExpiryDuration(60 * time.Second),
        ants.WithNonblocking(true),
        ants.WithPanicHandler(func(r interface{}) {
            slog.Error("worker panic", "panic", r)
        }),
    )
    if err != nil {
        return nil, err
    }
    p.raw = raw
    return p, nil
}

func (p *Pool) run(arg interface{}) {
    job := arg.(Job)
    wait := time.Since(job.Submitted)
    p.tracker.Record(wait)
    atomic.AddInt32(&p.busyCount, 1)
    defer atomic.AddInt32(&p.busyCount, -1)
    job.Task()
    atomic.AddInt64(&p.completed, 1)
}

func (p *Pool) Submit(task func()) bool {
    err := p.raw.Invoke(Job{Task: task, Submitted: time.Now()})
    if err != nil {
        atomic.AddInt64(&p.dropped, 1)
        return false
    }
    atomic.AddInt64(&p.submitted, 1)
    return true
}

func (p *Pool) Size() int  { return p.raw.Cap() }
func (p *Pool) Busy() int  { return int(atomic.LoadInt32(&p.busyCount)) }
func (p *Pool) Tune(n int) { p.raw.Tune(n) }
func (p *Pool) Release()   { p.raw.Release() }
```

The pool wraps `ants.PoolWithFunc`, adds the wait tracker, exposes size/busy/tune. Submit records the submit timestamp; the worker (in `run`) records the wait time.

### Step 3: define the autoscaler

```go
package main

import (
    "context"
    "log/slog"
    "time"
)

type Autoscaler struct {
    Pool         *Pool
    Floor        int
    Ceiling      int
    Interval     time.Duration
    UpCooldown   time.Duration
    DownCooldown time.Duration
    P99HighWater time.Duration
    MeanLowWater time.Duration
    Logger       *slog.Logger
}

func (a *Autoscaler) Run(ctx context.Context) {
    ticker := time.NewTicker(a.Interval)
    defer ticker.Stop()
    var lastUp, lastDown time.Time
    for {
        select {
        case <-ctx.Done():
            return
        case now := <-ticker.C:
            p99 := a.Pool.tracker.Quantile(0.99)
            mean := a.Pool.tracker.Mean()
            cur := a.Pool.Size()

            switch {
            case p99 > a.P99HighWater && cur < a.Ceiling && now.Sub(lastUp) >= a.UpCooldown:
                next := min(cur+2, a.Ceiling)
                a.Pool.Tune(next)
                lastUp = now
                a.Logger.Info("scaled up", "from", cur, "to", next, "p99", p99)

            case mean < a.MeanLowWater && cur > a.Floor && now.Sub(lastDown) >= a.DownCooldown:
                next := max(cur-1, a.Floor)
                a.Pool.Tune(next)
                lastDown = now
                a.Logger.Info("scaled down", "from", cur, "to", next, "mean", mean)
            }
        }
    }
}

func min(a, b int) int { if a < b { return a }; return b }
func max(a, b int) int { if a > b { return a }; return b }
```

Grow on p99 (the slow tail). Shrink on mean (the typical case). Different signals for different directions reduces flapping.

### Step 4: wire it together

```go
func main() {
    p, err := NewPool(8)
    if err != nil { panic(err) }
    defer p.Release()

    a := &Autoscaler{
        Pool:         p,
        Floor:        4,
        Ceiling:      128,
        Interval:     500 * time.Millisecond,
        UpCooldown:   3 * time.Second,
        DownCooldown: 60 * time.Second,
        P99HighWater: 500 * time.Millisecond,
        MeanLowWater: 20 * time.Millisecond,
        Logger:       slog.Default(),
    }

    ctx, cancel := context.WithCancel(context.Background())
    go a.Run(ctx)

    // simulated workload
    for i := 0; i < 10000; i++ {
        for !p.Submit(simulatedTask) {
            time.Sleep(time.Millisecond)
        }
    }

    cancel()
}

func simulatedTask() {
    time.Sleep(time.Duration(50 + rand.Intn(50)) * time.Millisecond)
}
```

This is a production-grade ~150-line skeleton. Add Prometheus metrics, a CLI for runtime tuning, and a health endpoint, and you have something deployable.

---

## Deep Dive: Sampling in High-Throughput Pools

A pool processing 100k tasks/s cannot afford a `time.Since` and `mu.Lock` per task. The overhead is small but at scale it shows.

### Sampled timestamping

Record only 1 in N samples:

```go
type Pool struct {
    sampleN   int64
    sampleCounter int64
    tracker   *WaitTracker
}

func (p *Pool) Submit(task func()) bool {
    if atomic.AddInt64(&p.sampleCounter, 1) % p.sampleN == 0 {
        return p.submitSampled(task)
    }
    return p.submitFast(task)
}

func (p *Pool) submitSampled(task func()) bool {
    return p.raw.Invoke(Job{Task: task, Submitted: time.Now()})
}

func (p *Pool) submitFast(task func()) bool {
    return p.raw.Invoke(Job{Task: task})  // no timestamp
}
```

At 100k req/s with sampleN=100, you collect 1k samples/s. Plenty for statistical accuracy. Overhead vanishes.

Caveat: sampling assumes wait time is uniformly distributed across submissions. If the workload has structure (e.g., bursts), sampled estimates may be biased. Mitigate by sampling more densely during bursts (adaptive sampling).

### Per-shard tracking

Even cheaper: shard the tracker across CPUs:

```go
type ShardedTracker struct {
    shards []*WaitTracker
}

func (s *ShardedTracker) Record(d time.Duration) {
    n := runtime_procPin()
    s.shards[n % len(s.shards)].Record(d)
    runtime_procUnpin()
}
```

Each shard has its own mutex. Contention drops near zero. Quantile queries aggregate across shards.

For an open-source production-grade version, look at `prometheus/client_golang`'s histogram — it uses a similar pattern internally.

### Histogram-based percentiles

Sort-based p99 is O(n log n). With histograms, it is O(buckets) — constant.

```go
type Histogram struct {
    boundaries []time.Duration  // bucket upper bounds, sorted
    counts     []int64           // count per bucket, atomic
}

func (h *Histogram) Record(d time.Duration) {
    idx := sort.Search(len(h.boundaries), func(i int) bool {
        return h.boundaries[i] >= d
    })
    atomic.AddInt64(&h.counts[idx], 1)
}

func (h *Histogram) Quantile(q float64) time.Duration {
    total := int64(0)
    for _, c := range h.counts { total += c }
    if total == 0 { return 0 }
    target := int64(float64(total) * q)
    sum := int64(0)
    for i, c := range h.counts {
        sum += c
        if sum >= target {
            return h.boundaries[i]
        }
    }
    return h.boundaries[len(h.boundaries)-1]
}
```

Pre-pick boundaries that are dense in the range you care about. For wait times: 0.1 ms, 1 ms, 10 ms, 100 ms, 1 s, 10 s, 60 s, +Inf. Eight buckets cover 7 orders of magnitude.

---

## Deep Dive: When to Choose Burst-Sized Pools Over Autoscaling

Not every workload benefits from autoscaling. Some are better served by an oversized static pool.

### Case: short-duration bursts with fast recovery

Suppose your workload is 95% idle, with brief bursts of 1000 tasks every 10 minutes. Each task takes 10 ms. The burst lasts 1 second.

Autoscaling response:
- Tick = 500 ms
- Burst starts, queue fills in milliseconds
- First scaler tick: depth high, grow from 4 to 8
- Second tick (1 s later): burst already over

The autoscaler grew the pool just in time for the burst to be over. The pool was undersized during the burst.

Static response (pool of 100):
- Burst hits, all 100 workers grab work immediately
- Burst drains in 100 ms (10 tasks per worker, 10 ms each)
- 99% of the time, 100 workers idle

The static pool wastes 100 KB of stacks 99% of the time. The autoscaler costs 1 second of bad p99 every 10 minutes.

For latency-critical workloads, static (oversized) wins.

### Case: long, gradual ramp

If your workload goes from 100 req/s to 1000 req/s over 10 minutes (a typical morning ramp), autoscaling shines. Static would be either oversized at start or undersized at peak; autoscaling tracks load smoothly.

### Decision

| Pattern | Recommendation |
|---------|---------------|
| Steady, predictable | Static |
| Brief, frequent bursts | Oversized static |
| Gradual ramps | Autoscaling |
| Bursty but long | Autoscaling |
| Very rare but huge bursts | Oversized static + alerts |

Autoscaling is not a universal answer. Match the tool to the pattern.

---

## Deep Dive: The Production Dashboard

When you deploy a dynamic pool, you build a dashboard. Here is the canonical layout.

### Row 1: pool state (gauges)

- Pool size (current cap, line)
- Pool size target (proposed cap from autoscaler, dashed line)
- Workers busy (gauge)
- Floor and ceiling (horizontal reference lines)

### Row 2: workload (rate counters)

- Submissions per second (rate of pool_submitted_total)
- Completions per second (rate of pool_completed_total)
- Drops per second (rate of pool_dropped_total)
- Errors per second (rate of pool_errors_total)

### Row 3: latencies (heatmap or percentile lines)

- Wait time p50, p90, p99 (lines)
- Process time p50, p90, p99 (lines)
- Heatmap of full distribution

### Row 4: autoscaler activity (counters)

- Resize up events per minute
- Resize down events per minute
- Signal value over time

### Row 5: health (alerts)

- Pool at ceiling (alert if > 1 minute)
- Drops > 0 (alert immediately)
- Resize/min > 30 (alert: flapping)
- p99 > SLO (alert: violation)

If you can read this dashboard at a glance during an incident and tell what is happening, your observability is good. If not, add more.

---

## Deep Dive: Migration from Static to Dynamic

A real migration plan, week by week.

### Week 1: instrument the static pool

Add metrics (size, queue depth, wait time, completions, drops) to the existing static pool. Deploy. Watch.

### Week 2: analyze

- What is the queue depth distribution? Histogram.
- What is wait time? p99 vs p50?
- Are there obvious bursts? Time-of-day patterns?
- Are there drops?

Sketch what an autoscaler would do given this data. "At 09:00 depth went from 5% to 80%; autoscaler would have grown pool from 16 to 32."

### Week 3: build the dynamic pool

Implement based on lessons. Keep static as fallback (a config flag).

### Week 4: shadow mode

Deploy with `--dynamic-shadow=true`. The autoscaler runs; it logs proposed resizes; it does not act. Compare proposals to actual queue/wait curves.

### Week 5: canary

`--dynamic=true` on 5% of traffic. Watch metrics. Compare to static slice.

### Week 6: scale up

50%, then 100%. Continue watching for a week.

### Week 7: tune

Now you have production data. Adjust thresholds, cooldowns, floor, ceiling. Document the policy.

This is the textbook migration. Skipping shadow or canary risks production incidents.

---

## Deep Dive: Adaptive Cooldowns

Static cooldowns are a starting point. Adaptive cooldowns adjust based on observed behavior.

### Multiplicative cooldown extension

If we just scaled up and the signal stays high, extend the cooldown to avoid over-growth:

```go
type AdaptiveCooldown struct {
    base    time.Duration
    current time.Duration
    lastUp  time.Time
}

func (c *AdaptiveCooldown) RecordUp(now time.Time, signalStillHigh bool) {
    c.lastUp = now
    if signalStillHigh {
        c.current = c.current * 3 / 2  // 1.5x extension
    } else {
        c.current = c.base
    }
}
```

This is a soft circuit breaker on the autoscaler itself: don't keep growing if growth isn't helping.

### Pattern-based shrink

Suppose you observe that, every morning, traffic ramps up over 30 minutes. The autoscaler can learn this pattern and grow earlier.

```go
type PatternedScaler struct {
    historicalLoad [24]float64  // hourly average over past N days
}

func (s *PatternedScaler) Predict(now time.Time) float64 {
    hour := now.Hour()
    return s.historicalLoad[hour]
}
```

Combine prediction with reactive scaling: predict the morning ramp; pre-warm the pool. We cover this fully at senior level.

### Time-of-day floor

Adjust the floor based on time of day:

```go
func (s *Service) currentFloor(now time.Time) int {
    hour := now.Hour()
    if hour >= 9 && hour < 18 {
        return 16  // business hours floor
    }
    return 4  // off-hours floor
}
```

Cheap and effective for services with strong time-of-day patterns.

---

## Deep Dive: Coupling with Backpressure

Autoscaling and backpressure are inseparable in production. Let us trace the interaction.

### The scenario

Pool: floor=4, ceiling=64. Currently at 32. Queue cap=1024, currently 800 used (78% full).

### Frame 1: submission

A caller calls `Submit`. Queue has 224 slots free. Submit succeeds in microseconds.

### Frame 2: autoscaler tick

Depth = 78%. Above high-water (75%). Grow to 36. Pool is now 36 workers.

### Frame 3: more submissions

Submitters continue. Queue depth oscillates around 70-80% for a few seconds.

### Frame 4: another tick

Cooldown 2 s elapsed. Depth still high. Grow to 40.

### Frame 5: pool at ceiling

After several ticks, pool is at 64 (ceiling). Cannot grow further.

### Frame 6: queue fills

Even with 64 workers, depth continues to climb. Queue reaches 1024.

### Frame 7: Submit returns ErrPoolFull

```go
func (p *Pool) Submit(task func()) error {
    select {
    case p.jobs <- task:
        return nil
    default:
        return ErrPoolFull
    }
}
```

Caller gets the error. Caller decides: retry with backoff, fail the request, queue elsewhere, return 503 to the user.

### Frame 8: caller backs off

The caller (an HTTP handler) returns `429 Too Many Requests`. The user retries after some delay. Load drops slightly.

### Frame 9: autoscaler grows further

Now pool is at ceiling. Autoscaler logs "at ceiling, signal still high" — an alert fires. Operator scales the *cluster* (more containers, larger machine).

### The lesson

Without backpressure, the pool's queue would grow unbounded. Submit would either block or memory would explode. With backpressure, you have a hard ceiling on misbehavior. The autoscaler grows up to the safety limit; beyond that, callers feel pressure.

Backpressure is the lower-bound mechanism. Autoscaling is the upper-bound mechanism. Production needs both.

---

## Deep Dive: Multi-Tenant Pools

When multiple tenants share a pool, autoscaling becomes a fairness problem.

### Simple shared pool

All tenants use one pool. Pros: efficient resource use. Cons: a noisy tenant starves others.

### Per-tenant pools

One pool per tenant. Pros: isolation. Cons: many idle pools, expensive.

### Hybrid: priority queues

One pool, with multiple priority queues. Tenants submit to their queue. Pool's workers drain queues in priority order.

```go
type MultiTenantPool struct {
    queues map[Tenant]chan func()
    pool   *ants.PoolWithFunc
}

func (p *MultiTenantPool) Submit(t Tenant, task func()) bool {
    select {
    case p.queues[t] <- task:
        p.pool.Invoke(QueueJob{Tenant: t})
        return true
    default:
        return false
    }
}

func (p *MultiTenantPool) drainOne(arg interface{}) {
    qj := arg.(QueueJob)
    select {
    case task := <-p.queues[qj.Tenant]:
        task()
    default:
        // queue empty; nothing to do
    }
}
```

Autoscaling: track per-tenant wait time. Grow when any tenant's wait time exceeds SLO. Be careful not to let one tenant dominate.

### Weighted fair queueing

Each tenant gets a share of the pool. A high-paying tenant has a larger share. Implement with a scheduler that picks the next task from the most under-served tenant.

```go
func (p *MultiTenantPool) nextTask() (Tenant, func()) {
    // pick tenant with highest (deserved - served) ratio
}
```

Multi-tenant fairness is a deep topic — we touch it here, cover it more fully in the professional chapter and in dedicated multi-tenancy resources.

---

## Worked Example: Production Pool with Full Instrumentation

Let us assemble everything into one complete, ready-to-deploy example. ~250 lines.

```go
package main

import (
    "context"
    "log/slog"
    "math/rand"
    "os"
    "os/signal"
    "sort"
    "sync"
    "sync/atomic"
    "syscall"
    "time"

    "github.com/panjf2000/ants/v2"
    "github.com/prometheus/client_golang/prometheus"
    "github.com/prometheus/client_golang/prometheus/promauto"
)

// Metrics

var (
    poolSize = promauto.NewGauge(prometheus.GaugeOpts{
        Name: "worker_pool_size", Help: "current pool capacity",
    })
    poolBusy = promauto.NewGauge(prometheus.GaugeOpts{
        Name: "worker_pool_busy", Help: "workers currently processing",
    })
    poolSubmitted = promauto.NewCounter(prometheus.CounterOpts{
        Name: "worker_pool_submitted_total",
    })
    poolCompleted = promauto.NewCounter(prometheus.CounterOpts{
        Name: "worker_pool_completed_total",
    })
    poolDropped = promauto.NewCounter(prometheus.CounterOpts{
        Name: "worker_pool_dropped_total",
    })
    poolWait = promauto.NewHistogram(prometheus.HistogramOpts{
        Name:    "worker_pool_wait_seconds",
        Buckets: prometheus.ExponentialBuckets(0.001, 2, 14),
    })
    poolProcess = promauto.NewHistogram(prometheus.HistogramOpts{
        Name:    "worker_pool_process_seconds",
        Buckets: prometheus.ExponentialBuckets(0.001, 2, 14),
    })
    resizeUp = promauto.NewCounter(prometheus.CounterOpts{
        Name: "worker_pool_resize_up_total",
    })
    resizeDown = promauto.NewCounter(prometheus.CounterOpts{
        Name: "worker_pool_resize_down_total",
    })
)

// Wait tracker

type WaitTracker struct {
    mu      sync.Mutex
    samples []time.Duration
    cap     int
    idx     int
    full    bool
}

func NewWaitTracker(cap int) *WaitTracker {
    return &WaitTracker{samples: make([]time.Duration, cap), cap: cap}
}

func (w *WaitTracker) Record(d time.Duration) {
    w.mu.Lock()
    w.samples[w.idx] = d
    w.idx++
    if w.idx >= w.cap {
        w.idx = 0
        w.full = true
    }
    w.mu.Unlock()
}

func (w *WaitTracker) len() int {
    if w.full { return w.cap }
    return w.idx
}

func (w *WaitTracker) Quantile(q float64) time.Duration {
    w.mu.Lock()
    n := w.len()
    if n == 0 {
        w.mu.Unlock()
        return 0
    }
    cp := make([]time.Duration, n)
    copy(cp, w.samples[:n])
    w.mu.Unlock()
    sort.Slice(cp, func(i, j int) bool { return cp[i] < cp[j] })
    return cp[int(float64(n-1)*q)]
}

func (w *WaitTracker) Mean() time.Duration {
    w.mu.Lock()
    defer w.mu.Unlock()
    n := w.len()
    if n == 0 { return 0 }
    var sum time.Duration
    for _, s := range w.samples[:n] { sum += s }
    return sum / time.Duration(n)
}

// Pool

type Pool struct {
    raw       *ants.PoolWithFunc
    tracker   *WaitTracker
    busyCount int32
}

type Job struct {
    Task      func()
    Submitted time.Time
}

func NewPool(initial int) (*Pool, error) {
    p := &Pool{tracker: NewWaitTracker(1000)}
    raw, err := ants.NewPoolWithFunc(initial, p.run,
        ants.WithExpiryDuration(60*time.Second),
        ants.WithNonblocking(true),
        ants.WithPanicHandler(func(r interface{}) {
            slog.Error("worker panic", "panic", r)
        }),
    )
    if err != nil { return nil, err }
    p.raw = raw
    return p, nil
}

func (p *Pool) run(arg interface{}) {
    j := arg.(Job)
    wait := time.Since(j.Submitted)
    p.tracker.Record(wait)
    poolWait.Observe(wait.Seconds())
    atomic.AddInt32(&p.busyCount, 1)
    poolBusy.Inc()
    start := time.Now()
    j.Task()
    poolProcess.Observe(time.Since(start).Seconds())
    poolBusy.Dec()
    atomic.AddInt32(&p.busyCount, -1)
    poolCompleted.Inc()
}

func (p *Pool) Submit(task func()) bool {
    err := p.raw.Invoke(Job{Task: task, Submitted: time.Now()})
    if err != nil {
        poolDropped.Inc()
        return false
    }
    poolSubmitted.Inc()
    return true
}

func (p *Pool) Tune(n int) { p.raw.Tune(n) }
func (p *Pool) Size() int  { return p.raw.Cap() }
func (p *Pool) Release()   { p.raw.Release() }

// Autoscaler

type Autoscaler struct {
    Pool         *Pool
    Floor        int
    Ceiling      int
    Interval     time.Duration
    UpCooldown   time.Duration
    DownCooldown time.Duration
    P99HighWater time.Duration
    MeanLowWater time.Duration
}

func (a *Autoscaler) Run(ctx context.Context) {
    ticker := time.NewTicker(a.Interval)
    defer ticker.Stop()
    var lastUp, lastDown time.Time
    for {
        select {
        case <-ctx.Done():
            return
        case now := <-ticker.C:
            poolSize.Set(float64(a.Pool.Size()))
            p99 := a.Pool.tracker.Quantile(0.99)
            mean := a.Pool.tracker.Mean()
            cur := a.Pool.Size()
            switch {
            case p99 > a.P99HighWater && cur < a.Ceiling && now.Sub(lastUp) >= a.UpCooldown:
                next := cur + 2
                if next > a.Ceiling { next = a.Ceiling }
                a.Pool.Tune(next)
                resizeUp.Inc()
                lastUp = now
                slog.Info("scale up", "from", cur, "to", next, "p99", p99)
            case mean < a.MeanLowWater && cur > a.Floor && now.Sub(lastDown) >= a.DownCooldown:
                next := cur - 1
                if next < a.Floor { next = a.Floor }
                a.Pool.Tune(next)
                resizeDown.Inc()
                lastDown = now
                slog.Info("scale down", "from", cur, "to", next, "mean", mean)
            }
        }
    }
}

// Main

func main() {
    slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, nil)))
    p, err := NewPool(8)
    if err != nil { panic(err) }
    defer p.Release()

    a := &Autoscaler{
        Pool:         p,
        Floor:        4,
        Ceiling:      128,
        Interval:     500 * time.Millisecond,
        UpCooldown:   3 * time.Second,
        DownCooldown: 60 * time.Second,
        P99HighWater: 500 * time.Millisecond,
        MeanLowWater: 20 * time.Millisecond,
    }

    ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
    defer cancel()
    go a.Run(ctx)

    // Synthetic load
    go func() {
        for {
            if !p.Submit(func() {
                time.Sleep(time.Duration(50+rand.Intn(50)) * time.Millisecond)
            }) {
                time.Sleep(time.Millisecond)
            }
            time.Sleep(2 * time.Millisecond)
        }
    }()

    <-ctx.Done()
    slog.Info("shutting down")
}
```

This program:

- Wraps ants with full instrumentation
- Tracks p99 wait time for autoscaling
- Exports Prometheus metrics
- Logs every resize with reasoning
- Has signal handling for graceful shutdown

Production-ready in spirit. Add HTTP routes for `/metrics` and `/healthz`, wire to your service router, you have a deployable component.

---

## Worked Example: Comparing Three Autoscaler Configs

Now let us compare three configurations of the same autoscaler against the same load. We assume a tool that drives 100-2000 tasks/s in a fluctuating pattern over 10 minutes.

### Config A: aggressive grow, slow shrink

```go
UpCooldown:   1 * time.Second
DownCooldown: 120 * time.Second
P99HighWater: 200 * time.Millisecond
```

Result:
- p99 wait stays under 250 ms throughout
- Pool size: 8 → grows to 80 quickly, stays there even after burst ends
- Cost: high (overhead + idle workers)

### Config B: balanced

```go
UpCooldown:   3 * time.Second
DownCooldown: 60 * time.Second
P99HighWater: 500 * time.Millisecond
```

Result:
- p99 wait peaks at 600 ms during bursts, settles to 50 ms
- Pool size: 8 → 60 → 8 over the test
- Cost: medium

### Config C: conservative

```go
UpCooldown:   10 * time.Second
DownCooldown: 30 * time.Second
P99HighWater: 1 * time.Second
```

Result:
- p99 wait peaks at 1.5 s during bursts (SLO breach if SLO is 1 s)
- Pool size: 8 → 30 → 8
- Cost: low

### Choosing

Each config trades latency for cost. If your SLO is tight, A. If your SLO is loose, C. Most production runs B.

The lesson: there is no universal best. Measure, decide, document.

---

## Real-World Anecdote: The Slow Downstream

A service had a worker pool with depth-based autoscaling. p99 latency was usually 100 ms. Then one Tuesday, a downstream service got slow — its p99 went from 50 ms to 500 ms.

What happened:

- Workers spent more time per task (waiting on slow downstream)
- Queue grew (tasks arriving at the same rate, draining slower)
- Autoscaler saw queue depth high
- Autoscaler grew the pool from 16 to 64
- 64 workers slamming the slow downstream
- Downstream got slower (overload)
- Queue grew more
- Pool grew to ceiling at 128
- Downstream timed out almost all requests
- Service started shedding 70% of load
- Pages.

The fix: add wait time as a signal, add error rate as a veto, add a circuit breaker on the downstream call. With all three:

- When downstream errors, circuit breaks
- Fast failure returns the worker
- Wait time stays bounded (errors are fast)
- Pool doesn't grow

The lesson: queue depth in isolation is a dangerous signal when downstream is the bottleneck. Always combine with downstream health metrics.

---

## Practice Problem: Tune a Real Pool

Imagine you inherit this pool:

```go
p, _ := ants.NewPool(100)
go func() {
    for {
        if p.Running() > 80 {
            p.Tune(p.Cap() * 2)
        }
        time.Sleep(time.Second)
    }
}()
```

Find five problems. Fix them.

Problems:
1. No down-scaling.
2. No cooldown — autoscaler can double pool every second.
3. No ceiling — pool can grow without bound.
4. Uses `Running()` which is busy count, not utilization. Threshold of 80 means "80 workers busy" — irrelevant once pool exceeds 80.
5. Cap doubling is multiplicative growth without any safety.

Fix:

```go
const (
    floor   = 4
    ceiling = 256
)

p, _ := ants.NewPool(100, ants.WithExpiryDuration(60*time.Second))
go func() {
    var lastUp, lastDown time.Time
    ticker := time.NewTicker(500 * time.Millisecond)
    defer ticker.Stop()
    for now := range ticker.C {
        cap := p.Cap()
        running := p.Running()
        util := float64(running) / float64(cap)
        switch {
        case util > 0.85 && cap < ceiling && now.Sub(lastUp) >= 3*time.Second:
            p.Tune(min(cap+2, ceiling))
            lastUp = now
        case util < 0.30 && cap > floor && now.Sub(lastDown) >= 60*time.Second:
            p.Tune(max(cap-1, floor))
            lastDown = now
        }
    }
}()
```

This kind of code-review exercise is the bulk of middle-level work.

---

## Practice Problem: Choose a Signal

You build a service that processes uploads. Three modes:

1. **Mode A: image thumbnails.** CPU-bound, 50-150 ms per image. 100 req/s baseline.
2. **Mode B: virus scan.** Calls a downstream antivirus service. 100 ms - 2 s. 50 req/s baseline.
3. **Mode C: metadata extraction.** Mixed CPU+disk. 10-50 ms. 1000 req/s baseline.

Which signal for each?

- A (CPU-bound): utilization. CPU is the bottleneck; util > 80% means we are saturated.
- B (variable latency): wait time. Variance is high; queue depth misleads.
- C (high throughput): queue depth or sampled wait time. Throughput is high enough that sampling is needed.

A, B, C might all live in the same service. Three pools, three autoscalers, three sets of metrics.

---

## A Look at tunny

We have leaned on ants. Let us briefly inspect tunny.

```go
import "github.com/Jeffail/tunny"

type DBWorker struct {
    db *sql.DB
}

func (w *DBWorker) Process(payload interface{}) interface{} {
    req := payload.(Request)
    return w.queryDB(req)
}

func (w *DBWorker) BlockUntilReady() {}
func (w *DBWorker) Interrupt() {}
func (w *DBWorker) Terminate() { w.db.Close() }

pool := tunny.New(8, func() tunny.Worker {
    return &DBWorker{db: openDB()}
})
defer pool.Close()

result := pool.Process(req).(Response)
```

tunny gives you the explicit Worker interface. Each worker holds its own state (a DB handle in this example). The pool can `SetSize(n)` at runtime.

When you need per-worker state that should not be shared, tunny is cleaner than ants. When you do not, ants is simpler.

```go
pool.SetSize(16) // grow
pool.SetSize(4)  // shrink
```

Tunny's autoscaler is identical in shape — pick signal, write loop, call SetSize. Tunny does not have built-in idle expiry; you would shrink only via SetSize.

---

## Extended Walkthrough: Three Months in the Life of a Dynamic Pool

To make the abstractions concrete, let us follow a realistic dynamic pool through three months of production. The service: a webhook delivery system.

### Month 1: ship the pool

- Start with floor=8, ceiling=64
- Wait-time autoscaler with P99HighWater=500ms, MeanLowWater=20ms
- UpCooldown=3s, DownCooldown=60s

First week:
- p99 wait stays under 600ms
- Pool oscillates between 12 and 28
- A few resize events per minute during peak

Observations:
- Tail latency is good
- Pool spends 80% of time between 12-20 workers
- Bursts grow to 28, settle in about 30 seconds

Verdict: working as intended.

### Month 2: a new customer

A new enterprise customer goes live. Their webhooks are different — heavier payloads, slower remote endpoints. Tasks now take 200ms-2s instead of 50-200ms.

What happens:

- Mean wait time stays low (workers are mostly busy)
- p99 wait time creeps up because slower tasks queue more
- Autoscaler grows the pool from 28 to 64 (ceiling)
- At ceiling, queue starts filling
- Backpressure kicks in: Submit returns ErrPoolFull, callers see 503

Operator response:
- Bump ceiling to 128
- Add an alert "at ceiling > 5 minutes"
- Investigate whether to split into two pools (per-customer)

Lessons:
- Ceilings are not forever. Revisit them as workload changes.
- Multi-tenant pools have noisy-neighbor risk.
- Alerts on ceiling-saturation are critical.

### Month 3: an outage

The downstream service that 70% of webhooks call has an incident. Their p99 jumps from 50ms to 5s.

What happens:

- Tasks now take 5+ seconds instead of 200ms
- Wait time goes through the roof — p99 hits 30s
- Autoscaler grows pool to 128 (ceiling)
- 128 workers all hitting the slow downstream
- Downstream gets slower
- Eventually downstream rate-limits us
- Tasks now also error

Operator response (during incident):
- Manually `Tune(16)` to back off
- Add circuit breaker to downstream calls
- Add error rate as a veto signal in the autoscaler

Postmortem:
- Autoscaling amplifies downstream failures. Without circuit breaker, we made things worse.
- Need a signal that detects downstream sickness: error rate, latency anomaly, etc.
- Future work: build a multi-signal autoscaler that vetoes growth when downstream is unhealthy.

### Lessons from Three Months

- Workloads change. Tuning is ongoing.
- Multi-tenancy creates noisy-neighbor problems. Plan for it.
- Autoscaling can hurt during downstream failures. Combine with circuit breakers.
- Alerts on "stuck at ceiling" are as important as alerts on "high latency."
- Operators need manual override (`Tune(n)` from CLI) for incidents.

---

## Extended Walkthrough: Anatomy of a Bad Resize

Consider this real bug from a production system. The autoscaler had:

```go
case util > 0.85:
    pool.Tune(cur * 2)
case util < 0.30:
    pool.Tune(cur / 2)
```

What went wrong?

Imagine pool at 8 workers, all busy. Util = 1.0. Autoscaler grows to 16. Next tick: still 8 busy (workers haven't finished yet). New util = 8/16 = 0.5. In deadband. No action. Next tick: workers finish, 12 busy, util = 0.75. In deadband. Next tick: 4 busy, util = 0.25. Below threshold. Shrink to 8. Now we are back where we started, but in the interim we provisioned 16 workers, ran a few short tasks on the extras, and shrunk.

This is a flap-on-recovery: the recovery from saturation causes a too-aggressive shrink. Symptoms in production:

- Pool size oscillates wildly
- Each oscillation correlates with a tail-latency spike

Fix:

```go
case util > 0.85 && cooldownUpOK:
    pool.Tune(cur + 2)  // additive
case util < 0.30 && cooldownDownOK && lowForAtLeastFiveSamples():
    pool.Tune(cur - 1)  // additive
```

Two changes:
1. Additive instead of multiplicative — gentler.
2. Require sustained low utilization (multiple samples) before shrinking — not a single dip.

The lesson: multiplicative changes are tempting but dangerous. Additive is almost always better for steady-state behavior. Save multiplicative for explicit "emergency grow" paths.

---

## Extended Walkthrough: The Right Way to Sample

You decide to sample 1-in-N tasks for wait-time measurement. The naive approach:

```go
if rand.Intn(N) == 0 {
    recordWait(...)
}
```

`rand` is global; this contends on a lock. For high-throughput pools, the rand lock becomes a bottleneck.

Better:

```go
var counter int64
if atomic.AddInt64(&counter, 1) % int64(N) == 0 {
    recordWait(...)
}
```

Atomic increment, then modulo. Deterministic. No randomness needed.

Even better, for ultra-high throughput:

```go
shard := runtime_procPin()
var counters [16]int64
if atomic.AddInt64(&counters[shard%16], 1) % int64(N) == 0 {
    recordWait(...)
}
runtime_procUnpin()
```

Per-CPU counters, no inter-CPU contention.

For most workloads, the simple atomic counter suffices. Only worry about per-CPU sharding when profiling shows contention.

### Sampling and bias

Beware that sampling can bias percentile estimates. If your workload has sudden spikes that are 0.1% of the volume, sampling at 1-in-1000 will miss many of them. For spikes you care about, *always* record (not sampled). Or use reservoir sampling that gives equal weight to all samples regardless of position.

---

## Diagrams

Let us build a multi-signal decision function step by step.

### Step 1: define the inputs

```go
type Signals struct {
    P99Wait       time.Duration
    MeanWait      time.Duration
    Utilization   float64
    QueueDepth    float64
    ErrorRate     float64
    CPUUsage      float64
    HostMemory    float64
}
```

### Step 2: define the policy

```go
type Policy struct {
    P99HighWater   time.Duration
    MeanLowWater   time.Duration
    UtilHighWater  float64
    UtilLowWater   float64
    DepthHighWater float64
    DepthLowWater  float64
    ErrorThreshold float64
    CPUThreshold   float64
    MemThreshold   float64
    UpStep         int
    DownStep       int
}
```

### Step 3: write the function

```go
func Decide(p Policy, s Signals, cur, floor, ceiling int) (next int, reason string) {
    // Veto conditions first
    if s.ErrorRate > p.ErrorThreshold {
        return cur, "veto: error rate high"
    }
    if s.HostMemory > p.MemThreshold {
        return cur, "veto: memory pressure"
    }
    if s.CPUUsage > p.CPUThreshold && cur >= floor {
        // CPU saturated; don't grow, may shrink
        if s.Utilization < p.UtilLowWater {
            return max(cur-p.DownStep, floor), "shrink: low util despite high cpu"
        }
        return cur, "veto: cpu saturated"
    }

    // Growth conditions
    if cur < ceiling {
        if s.P99Wait > p.P99HighWater {
            return min(cur+p.UpStep, ceiling), "grow: p99 wait high"
        }
        if s.Utilization > p.UtilHighWater {
            return min(cur+p.UpStep, ceiling), "grow: util high"
        }
        if s.QueueDepth > p.DepthHighWater {
            return min(cur+p.UpStep, ceiling), "grow: queue deep"
        }
    }

    // Shrink conditions: require all signals to be low
    if cur > floor &&
        s.MeanWait < p.MeanLowWater &&
        s.Utilization < p.UtilLowWater &&
        s.QueueDepth < p.DepthLowWater {
        return max(cur-p.DownStep, floor), "shrink: all signals low"
    }

    return cur, "no change"
}
```

The structure:
- Vetoes (error, memory, CPU) come first; they block growth
- Growth triggers: any high signal grows the pool
- Shrink trigger: all signals must be low (be conservative)

### Step 4: test it

```go
func TestDecideVetoOnErrors(t *testing.T) {
    p := Policy{ErrorThreshold: 0.05}
    s := Signals{ErrorRate: 0.10, P99Wait: 2 * time.Second}
    next, reason := Decide(p, s, 16, 4, 64)
    if next != 16 {
        t.Errorf("expected no growth despite high p99 (errors), got %d", next)
    }
    if !strings.Contains(reason, "error") {
        t.Errorf("expected error veto reason, got %s", reason)
    }
}

func TestDecideGrowsOnHighP99(t *testing.T) {
    p := Policy{P99HighWater: time.Second, UpStep: 4}
    s := Signals{P99Wait: 2 * time.Second}
    next, _ := Decide(p, s, 16, 4, 64)
    if next != 20 {
        t.Errorf("expected grow to 20, got %d", next)
    }
}

func TestDecideShrinksConservatively(t *testing.T) {
    p := Policy{MeanLowWater: 50 * time.Millisecond, UtilLowWater: 0.30, DepthLowWater: 0.10, DownStep: 1}
    s := Signals{MeanWait: 20 * time.Millisecond, Utilization: 0.20, QueueDepth: 0.05}
    next, _ := Decide(p, s, 16, 4, 64)
    if next != 15 {
        t.Errorf("expected shrink to 15, got %d", next)
    }
}
```

A handful of test cases cover the main paths. Property-based testing (fuzzing with random signals) can catch edge cases.

### Step 5: integrate

Wire the policy into the autoscaler:

```go
func (a *Autoscaler) Run(ctx context.Context) {
    ticker := time.NewTicker(a.Interval)
    defer ticker.Stop()
    var lastUp, lastDown time.Time
    for {
        select {
        case <-ctx.Done():
            return
        case now := <-ticker.C:
            sigs := a.collectSignals()
            cur := a.Pool.Size()
            next, reason := Decide(a.Policy, sigs, cur, a.Floor, a.Ceiling)
            if next == cur { continue }
            if next > cur && now.Sub(lastUp) < a.UpCooldown { continue }
            if next < cur && now.Sub(lastDown) < a.DownCooldown { continue }
            a.Pool.Tune(next)
            slog.Info("resize", "from", cur, "to", next, "reason", reason)
            if next > cur { lastUp = now } else { lastDown = now }
        }
    }
}
```

The `Decide` function is pure; the loop handles cooldowns and effects. This separation is what makes the autoscaler testable.

---

## Diagrams

```
signal flow
  jobs --→ workers --→ tasks done
            |   |
            ↓   ↓
      busy count  wait timestamps
            ↓        ↓
           util    wait tracker
            ↓        ↓
           +--------+
           |  signal |
           |  fusion |
           +---+----+
               ↓
        decision rule
               ↓
         Resize(target)
```

```
cooldown timeline
  t=0    resize up (8 → 12)
         lastUp = t
  t=1s   signal still high
         (cooldown active, no action)
  t=2s   cooldown elapses
         could resize again if signal high
  t=5s   signal low; would shrink
         (down cooldown not yet)
  t=32s  down cooldown elapses
         resize down (12 → 11)
```

```
multi-signal decision tree
                   error > 10%?
                  /             \
                yes              no
                 |                 \
             hold (veto)         CPU > 85%?
                                 /          \
                               yes           no
                                |             \
                            hold (veto)    wait > 1s?
                                            /        \
                                          yes         no
                                           |           \
                                       grow +2     util > 85%?
                                                   /          \
                                                 yes           no
                                                  |             \
                                              grow +2       depth > 75%?
                                                              /         \
                                                            yes          no
                                                             |            \
                                                         grow +1      util < 30%?
                                                                       /          \
                                                                     yes           no
                                                                      |             \
                                                                  shrink -1     no change
```

```
EWMA convergence
  alpha = 0.3
  input:  10, 10, 10, 10, 100, 10, 10, 10
  ewma:   10, 10, 10, 10, 37,  29, 23, 19

  alpha = 0.1
  input:  10, 10, 10, 10, 100, 10, 10, 10
  ewma:   10, 10, 10, 10, 19,  18, 17, 16

  lower alpha smooths more, lags more
```

```
opportunistic vs cooperative shrink
  opportunistic:
    Resize(small) ─┐
                   │
       worker──task A (10 s)
                   │
                   ↓ (10 s later)
       worker──checks live > target
       worker──exits

  cooperative:
    Resize(small) ─┐
                   │
       worker──task A (10 s)
       worker──monitor: ctx.Done()?
                          │
                          ↓ (immediately)
       cancel(ctx)
       task A returns (handles cancellation)
       worker exits
```

```
multi-tenant fan-out
                +─────────+
   tenant A ──→ |  queueA |───┐
                +─────────+   │
                              ▼
                +─────────+   ┌─────────────┐
   tenant B ──→ |  queueB |──→│ worker pool │
                +─────────+   │  (auto-tuned)│
                              └─────────────┘
                +─────────+   ▲
   tenant C ──→ |  queueC |───┘
                +─────────+
              priority/weight scheduler picks next
```

```
production checklist visual

  ┌────────────────────────────────────┐
  │  Floor and ceiling defined         │
  │  Up cooldown ≥ 2s, down ≥ 30s      │
  │  Hysteresis: thresholds 4× apart   │
  │  Workers wrap in recover           │
  │  Submit returns ErrPoolFull        │
  │  Resize is mutex-guarded           │
  │  Metrics: size/wait/depth/resizes  │
  │  Tested under -race                │
  │  Alert on ceiling > 5 min          │
  │  Alert on resizes/min > 30         │
  └────────────────────────────────────┘
```

```
sample windowing
  task arrivals: ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒
                  ↑ each ▒ is a task
  sampled (1-in-5): ▒    ▒    ▒    ▒
                      these contribute to wait-time tracker
  rolling window (last 1000 samples):
    [▒,▒,▒,...,▒]  ← circular buffer
  on quantile query: sort + index
```

```
hysteresis: prevent flapping
  signal value
   1.0 ─| ▓▓
   0.75─┼─▓▓▓ high-water (grow above)
        │░░░░░░ deadband (no action)
   0.10─┼─▓▓▓ low-water (shrink below)
   0.0 ─│ ▓▓
       └────── time
   signal oscillates above 0.10 → no action (stays in deadband)
   signal above 0.75 → grow, then signal drops to 0.5 (still in deadband, no shrink)
```

```
signal-to-decision pipeline
  raw samples
      │
      ▼
  per-task: wait time, util increment
      │
      ▼
  smoothing: EWMA, ring buffer, histogram
      │
      ▼
  aggregated signals
      │
      ▼
  Decide(policy, signals, current) → target
      │
      ▼
  cooldown check
      │
      ▼
  Resize(target)
      │
      ▼
  pool size changes (live ↗ or ↘)
```
