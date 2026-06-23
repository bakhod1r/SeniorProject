---
layout: default
title: Junior
parent: Dynamic Worker Scaling
grand_parent: Production Patterns
ancestor: Go
nav_order: 2
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/18-production-patterns/02-dynamic-worker-scaling/junior/
---

# Dynamic Worker Scaling — Junior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Why a Static Pool Hurts](#why-a-static-pool-hurts)
8. [The First Dynamic Pool](#the-first-dynamic-pool)
9. [Scale-Up Triggers](#scale-up-triggers)
10. [Scale-Down Triggers](#scale-down-triggers)
11. [Using ants.Tune](#using-antstune)
12. [Code Examples](#code-examples)
13. [Coding Patterns](#coding-patterns)
14. [Clean Code](#clean-code)
15. [Product Use / Feature](#product-use-feature)
16. [Error Handling](#error-handling)
17. [Performance Tips](#performance-tips)
18. [Best Practices](#best-practices)
19. [Edge Cases & Pitfalls](#edge-cases-pitfalls)
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
31. [Diagrams & Visual Aids](#diagrams-visual-aids)

---

## Introduction
> Focus: "Why is a fixed number of workers wrong? How do I add and remove workers at runtime?"

A **worker pool** is a fixed-size set of goroutines, each pulling tasks from a shared channel. The classic shape is:

```go
jobs := make(chan Job, 64)
for i := 0; i < 8; i++ {
    go worker(jobs)
}
```

That `8` is a guess. Sometimes it is right. Most of the time, in production, it is wrong:

- At 03:00 your service is idle; eight workers sleep on the channel, costing memory and a permanent place in the scheduler's run queues.
- At 09:00 traffic doubles; the queue fills; eight workers cannot keep up; jobs sit in the channel for minutes; downstream timeouts cascade.
- At noon a downstream API gets slow; each worker is parked on a network call; you have *plenty* of CPU but no workers free to take new jobs.

**Dynamic worker scaling** is the practice of changing the size of the pool while it is running. You start small. You watch one or more *signals* — typically queue depth or processing latency. When a signal crosses a threshold, you add workers. When the signal returns to normal, you remove them.

After reading this file you will:

- Understand why a fixed pool size is a guess, not a design
- Be able to write a pool that starts new workers when the queue is full
- Be able to write a pool that lets idle workers exit
- Know the basic `ants.Tune(n int)` API from the most common Go pool library
- Have a feel for **scale-up triggers** (queue depth, processing latency, utilization)
- Have a feel for **scale-down triggers** (idle time, low utilization, cooldown)
- Understand the simplest pitfalls: leaks when shrinking, oscillation, races on resize

You do not need to know AIMD, PID, Little's Law, or distributed coordination yet. Those come at the middle and senior levels. This file gets you to the first working dynamic pool.

---

## Prerequisites

- **Required:** Comfortable with goroutines and channels. You can write a worker pool from scratch.
- **Required:** Familiarity with `sync.WaitGroup`, `context.Context`, and `time.Ticker`.
- **Required:** You know that `close(ch)` ends a `for x := range ch` loop and that sending on a closed channel panics.
- **Helpful:** Some exposure to backpressure — what happens when a channel buffer fills.
- **Helpful:** Awareness of `runtime.NumCPU()` and `runtime.GOMAXPROCS`.

If you can write a 50-line worker pool with a `WaitGroup` and clean shutdown, you are ready.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Worker** | A goroutine that loops, pulling tasks from a channel and processing them. |
| **Worker pool** | A set of N workers sharing one task channel. The classic Go concurrency pattern. |
| **Static pool** | A pool whose size is fixed at startup. Simple, predictable, often wrong-sized. |
| **Dynamic pool** | A pool that adds or removes workers at runtime based on observed signals. |
| **Resize** | The act of changing the number of workers in a running pool. |
| **Scale up** | Increase the worker count. Triggered by load. |
| **Scale down** | Decrease the worker count. Triggered by idleness. |
| **Queue depth** | The number of tasks currently waiting in the channel buffer. `len(jobs)`. |
| **Utilization** | Fraction of time a worker is busy vs idle. 0% = always idle; 100% = never sleeps. |
| **Trigger** | A condition (signal crossing a threshold) that causes a resize. |
| **Cooldown** | A minimum time between two resizes, to prevent rapid oscillation. |
| **Oscillation** | The bug where a pool repeatedly scales up then down with each tick. |
| **ants** | The most popular Go goroutine-pool library. `panjf2000/ants`. Provides `Tune(n)` for runtime resize. |
| **`ants.Tune(n)`** | Method on `*ants.Pool` that changes the maximum number of in-flight goroutines to `n`. |
| **Cap** / **Capacity** | The maximum number of workers the pool will ever spawn. `cap` is the upper bound; the *current* size may be lower. |
| **Idle worker** | A worker waiting on `<-jobs` with nothing to do. |
| **Goroutine leak** | A worker that should have exited but is still alive. The classic dynamic-pool bug. |

---

## Core Concepts

### A pool is two numbers: target size and live size

A dynamic pool has a **target size** (what you want) and a **live size** (what currently exists). Resizing means making the live size approach the target size.

```
target = 16   ← what the autoscaler wants
live   = 12   ← what the pool currently has
                → spawn 4 more workers
```

If `target < live`, you must tell some workers to exit. This is the harder direction.

### Scaling up is easy

To grow the pool, spawn new workers. They start running and pulling from the same channel as the existing ones.

```go
for i := 0; i < toAdd; i++ {
    wg.Add(1)
    go func() {
        defer wg.Done()
        for job := range jobs {
            process(job)
        }
    }()
}
```

That is it. The new workers compete with the old ones for jobs. No coordination needed because channels are MPMC (multi-producer multi-consumer) safe by construction.

### Scaling down is hard

To shrink, you must convince a worker to *exit its loop*. You cannot kill a goroutine from outside. You must send it a signal.

Three common signals:

1. **A "die" sentinel on the task channel.** Workers that receive it return instead of processing.
2. **A separate "shutdown" channel** the worker selects on alongside the job channel.
3. **An exit count** the worker decrements with `atomic.AddInt32`; the first N workers to read a non-zero count return.

We will see (2) and (3) in the code examples below.

### Triggers come from signals

A *signal* is a measurable property of the running pool. Common ones:

- **Queue depth.** `len(jobs)`. If the buffer is near full, you are falling behind. Scale up.
- **Average wait time.** Time from `submit` to `start processing`. Rising wait time means the pool cannot keep up.
- **Worker utilization.** Fraction of workers currently processing vs idle. Near 100% means add workers; near 0% means remove them.
- **Tail latency.** p99 of processing time. If p99 spikes without code change, something downstream is slow — adding workers may help (more parallelism through slow downstream) or hurt (you create thundering herd on the slow downstream).

The simplest dynamic pool uses *one* signal — usually queue depth.

---

## Real-World Analogies

**Supermarket checkout lanes.** When the queue at each lane grows beyond two carts, the manager opens a new lane. When the queue drops to zero and stays empty for ten minutes, the manager closes a lane. The manager is the autoscaler; the lanes are the workers; the carts in line are the queue depth.

**A restaurant kitchen.** During lunch rush, the head chef calls in two more line cooks. During mid-afternoon, he sends one home. The decision is based on how many tickets are on the rail (queue depth) and how long the oldest ticket has been sitting (wait time).

**Cloud auto-scaling groups.** Exactly the same problem at a different scale. An AWS Auto Scaling Group watches CPU; when CPU exceeds 70% for five minutes, it launches a new EC2 instance; when CPU drops below 30% for ten minutes, it terminates one. The 70/30 split is *hysteresis* — different thresholds for up and down. The five/ten-minute waits are *cooldowns*.

The math at each scale is the same. The vocabulary is the same. Once you understand a dynamic worker pool in Go, you understand the inside of a Kubernetes HPA.

---

## Mental Models

### Model 1: The pool is a tank with two valves

The inlet is task submissions. The outlet is workers processing tasks. If the inlet rate exceeds the outlet rate, the tank fills. If the tank gets near full, you must either:

- Open the outlet more (add workers)
- Close the inlet (apply backpressure to the submitters)

The two strategies are complementary. Dynamic scaling opens the outlet. Backpressure closes the inlet. Production systems usually need both.

### Model 2: A pool is a control system

Think of the autoscaler as a thermostat. The temperature is the queue depth. The target temperature is, say, "queue 25% full." The heater is "add a worker." The AC is "let a worker exit."

A real thermostat does not flip on and off the instant temperature crosses 21°C. It has a deadband: turn heat on at 20.5°C, off at 21.5°C. Without the deadband, you'd hear the click-click-click of the relay every few seconds. The same is true for worker pools: without a deadband (hysteresis), you'll see spawn-exit-spawn-exit on every tick.

### Model 3: Little's Law

For a stable queue:

```
L = λ × W
```

- `L` = average number of items in the system (workers busy + queue depth)
- `λ` = arrival rate (jobs per second)
- `W` = average time in the system (queue wait + processing)

If your jobs each take 100 ms and 200 arrive per second, you need at least `200 × 0.1 = 20` workers busy on average just to keep up. You should provision a bit more headroom: 25 to 30.

This is the formula behind most "how many workers should I have?" answers. We come back to it at senior level.

---

## Why a Static Pool Hurts

### Symptom 1: Idle cost

You set `workers = 200` because peak hour needs them. At 03:00 you have 200 goroutines sleeping on a channel. The stacks alone are ~400 KB; the runtime keeps them in its scheduling tables. It is not catastrophic, but it is waste.

### Symptom 2: Burst overload

You set `workers = 8` because that's `runtime.NumCPU()`. Then a batch of 10000 jobs lands. The channel buffer of 64 fills in 6 ms. After that, every `submit` blocks (or, if you used a buffered channel without backpressure, the buffer grew unbounded and you OOM'd). Either way, the system is in trouble for the next several seconds.

### Symptom 3: Latency cliff

For each job, downstream latency is 50 ms. With 8 workers, you can handle `8 / 0.05 = 160 req/s`. At 161 req/s, the queue grows without bound. Latency goes from 50 ms to several seconds in under a minute.

A static pool sized for the average load cannot absorb a 2× burst. A static pool sized for peak load is mostly idle.

### Symptom 4: Heterogeneous downstreams

Imagine half your jobs hit a fast cache (1 ms) and half hit a slow database (200 ms). The same eight workers handle both. The cache jobs are starved waiting for DB-bound workers to free up. You need either separate pools or a pool that can grow when DB workers are saturated.

---

## The First Dynamic Pool

Here is the smallest pool that adjusts its size at runtime.

```go
package main

import (
    "context"
    "fmt"
    "sync"
    "sync/atomic"
    "time"
)

type Pool struct {
    jobs        chan func()
    quit        chan struct{}
    targetSize  int32 // atomic
    liveSize    int32 // atomic
    wg          sync.WaitGroup
    mu          sync.Mutex
    closing     bool
}

func NewPool(initial int) *Pool {
    p := &Pool{
        jobs: make(chan func(), 1024),
        quit: make(chan struct{}),
    }
    p.Resize(initial)
    return p
}

func (p *Pool) Submit(task func()) {
    p.jobs <- task
}

func (p *Pool) Resize(target int) {
    p.mu.Lock()
    defer p.mu.Unlock()
    if p.closing {
        return
    }
    old := atomic.LoadInt32(&p.liveSize)
    atomic.StoreInt32(&p.targetSize, int32(target))
    if int32(target) > old {
        // Scale up: spawn (target - old) new workers.
        for i := old; i < int32(target); i++ {
            atomic.AddInt32(&p.liveSize, 1)
            p.wg.Add(1)
            go p.worker()
        }
    }
    // Scale down: workers notice that liveSize > targetSize and exit
    // on their own. We do not interrupt them mid-task.
}

func (p *Pool) worker() {
    defer p.wg.Done()
    defer atomic.AddInt32(&p.liveSize, -1)
    for {
        // Should I exit because the pool has shrunk?
        if atomic.LoadInt32(&p.liveSize) > atomic.LoadInt32(&p.targetSize) {
            return
        }
        select {
        case <-p.quit:
            return
        case task, ok := <-p.jobs:
            if !ok {
                return
            }
            task()
        }
    }
}

func (p *Pool) Close() {
    p.mu.Lock()
    p.closing = true
    close(p.quit)
    p.mu.Unlock()
    p.wg.Wait()
}

func main() {
    p := NewPool(2)
    var done int64
    for i := 0; i < 100; i++ {
        p.Submit(func() {
            time.Sleep(20 * time.Millisecond)
            atomic.AddInt64(&done, 1)
        })
    }
    // After a moment, scale up:
    time.Sleep(50 * time.Millisecond)
    p.Resize(16)
    // Then scale down once the burst passes:
    time.Sleep(300 * time.Millisecond)
    p.Resize(2)
    // Wait for everything to drain:
    for atomic.LoadInt64(&done) < 100 {
        time.Sleep(10 * time.Millisecond)
    }
    p.Close()
    fmt.Println("done:", done, "remaining workers:", atomic.LoadInt32(&p.liveSize))
}
```

The trick is in `worker()`: every loop iteration, before pulling a job, the worker checks whether the pool has shrunk. If `liveSize > targetSize`, it exits. The first worker to notice the shrink is the one that exits — there is no need to choose which worker dies; the race is harmless because all workers are interchangeable.

This is the **opportunistic shrink**: workers exit on their own when they next become idle. We do not interrupt in-flight tasks. This is the right default. Killing a task mid-processing is almost never acceptable in production.

---

## Scale-Up Triggers

The simplest scale-up trigger is **queue depth**:

```go
func (p *Pool) autoscaleByQueueDepth(ctx context.Context) {
    ticker := time.NewTicker(500 * time.Millisecond)
    defer ticker.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case <-ticker.C:
            depth := len(p.jobs)
            cap := cap(p.jobs)
            usage := float64(depth) / float64(cap)
            current := int(atomic.LoadInt32(&p.targetSize))
            switch {
            case usage > 0.75 && current < 64:
                p.Resize(current + 2)
            case usage < 0.10 && current > 2:
                p.Resize(current - 1)
            }
        }
    }
}
```

Every 500 ms we look at the queue. If it is more than 75% full and we have fewer than 64 workers, add two. If it is less than 10% full and we have more than two workers, drop one.

The 75/10 thresholds form a deadband. We never resize when depth is between 10% and 75%. This is hysteresis: it prevents flapping.

Other scale-up signals:

- **Wait time.** Measure how long each task sat in the channel before a worker picked it up. Scale up when the moving average crosses, say, 50 ms.
- **CPU.** If CPU is < 60% and the queue is non-empty, you have headroom; add workers.
- **External signal.** A Kubernetes operator pushes a "scale to N" command in response to cluster-level metrics.

We will see a wait-time autoscaler at middle level.

---

## Scale-Down Triggers

Scale-down is the dangerous direction. If you over-shrink, the next burst hits a small pool and you take a latency hit while you re-grow.

Conservative rules:

1. **Wait longer to scale down than to scale up.** A 5-second cooldown after a scale-up; a 30-second cooldown after a scale-down. Equivalently: be eager to add, slow to remove.
2. **Use a higher upper bound and a lower lower bound.** Add workers at queue 75% full; remove at queue 10% full. The gap in the middle is where you sit at steady state.
3. **Never go below a floor.** Always keep at least `runtime.NumCPU()` or some safe minimum. Going to zero means the first job pays a cold-start penalty.
4. **Remove one at a time.** Even if the signal says "you can drop ten," remove them gradually. A spike between ticks would catch you flat.

```go
case usage < 0.10:
    last := p.lastShrink.Load()
    if time.Since(last.(time.Time)) > 30*time.Second && current > p.floor {
        p.Resize(current - 1)
        p.lastShrink.Store(time.Now())
    }
```

The `p.lastShrink` is an `atomic.Value` holding the time of the last shrink. We only shrink if at least 30 seconds have passed since the last one.

---

## Using ants.Tune

The most popular Go pool library is `panjf2000/ants`. It supports runtime resize:

```go
import "github.com/panjf2000/ants/v2"

p, err := ants.NewPool(8)
if err != nil { panic(err) }
defer p.Release()

for i := 0; i < 1000; i++ {
    _ = p.Submit(func() {
        time.Sleep(20 * time.Millisecond)
    })
}

// Later, in your autoscaler:
p.Tune(32) // grow to 32
// later still:
p.Tune(4)  // shrink to 4
```

`Tune` changes the maximum number of in-flight goroutines. If you tune up, future submissions can spawn more workers. If you tune down, ants does not kill in-flight goroutines; they finish their current task, return to ants's free list, and from there they exit on the next idle pass.

The library handles the bookkeeping for you. The job of *your* code is just to decide *when* to call `Tune`. That decision — the autoscaler — is the topic of this whole subsection.

ants is heavily benchmarked and used in production at large scale (TiDB, several CDN edges, Bilibili). For most projects, you will not roll your own pool; you will use ants or tunny or pond. But you should understand how they work — that is exactly what we are building above.

---

## Code Examples

### Example 1: Hand-rolled pool with `Tune` API

We saw this above. Re-read the structure: target size atomic, live size atomic, opportunistic shrink in `worker()`.

### Example 2: ants pool with queue-depth autoscaler

```go
package main

import (
    "context"
    "log"
    "sync/atomic"
    "time"

    "github.com/panjf2000/ants/v2"
)

func main() {
    p, err := ants.NewPool(4, ants.WithNonblocking(false))
    if err != nil {
        log.Fatal(err)
    }
    defer p.Release()

    var submitted int64
    var done int64

    // Producer.
    go func() {
        for {
            err := p.Submit(func() {
                time.Sleep(30 * time.Millisecond)
                atomic.AddInt64(&done, 1)
            })
            if err == nil {
                atomic.AddInt64(&submitted, 1)
            }
            time.Sleep(2 * time.Millisecond)
        }
    }()

    // Autoscaler.
    ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
    defer cancel()
    autoscale(ctx, p)
}

func autoscale(ctx context.Context, p *ants.Pool) {
    ticker := time.NewTicker(500 * time.Millisecond)
    defer ticker.Stop()
    const minCap, maxCap = 2, 128
    for {
        select {
        case <-ctx.Done():
            return
        case <-ticker.C:
            running := p.Running()
            free := p.Free()
            cap := p.Cap()
            utilization := float64(running) / float64(cap)
            switch {
            case utilization > 0.80 && cap < maxCap:
                p.Tune(min(cap*2, maxCap))
            case utilization < 0.20 && cap > minCap && free > cap/2:
                p.Tune(max(cap/2, minCap))
            }
        }
    }
}

func min(a, b int) int { if a < b { return a }; return b }
func max(a, b int) int { if a > b { return a }; return b }
```

The autoscaler runs once every 500 ms. It looks at running, free, and capacity, computes utilization, and doubles or halves the pool. Doubling and halving is *multiplicative* — fast to react but coarse. We will see additive-increase later (AIMD).

### Example 3: Pool with wait-time as the signal

```go
type Pool struct {
    jobs        chan Job
    waitMu      sync.Mutex
    waitSamples []time.Duration
    // ...
}

type Job struct {
    Task       func()
    submitted  time.Time
}

func (p *Pool) Submit(task func()) {
    p.jobs <- Job{Task: task, submitted: time.Now()}
}

func (p *Pool) worker() {
    for job := range p.jobs {
        wait := time.Since(job.submitted)
        p.recordWait(wait)
        job.Task()
    }
}

func (p *Pool) recordWait(d time.Duration) {
    p.waitMu.Lock()
    p.waitSamples = append(p.waitSamples, d)
    if len(p.waitSamples) > 100 {
        p.waitSamples = p.waitSamples[1:]
    }
    p.waitMu.Unlock()
}

func (p *Pool) avgWait() time.Duration {
    p.waitMu.Lock()
    defer p.waitMu.Unlock()
    if len(p.waitSamples) == 0 {
        return 0
    }
    var sum time.Duration
    for _, s := range p.waitSamples {
        sum += s
    }
    return sum / time.Duration(len(p.waitSamples))
}
```

The autoscaler can now look at `avgWait()` instead of `len(jobs)`. Wait time is a better signal because it is in the same units as your SLO ("p99 wait < 100 ms"). Queue length is easier to read but harder to translate into SLO commitments.

### Example 4: Shrink-on-idle workers

A different model: each worker decides to exit if it has been idle for some duration.

```go
func (p *Pool) worker() {
    idleTimer := time.NewTimer(p.idleTimeout)
    defer idleTimer.Stop()
    for {
        select {
        case task, ok := <-p.jobs:
            if !ok {
                return
            }
            if !idleTimer.Stop() {
                <-idleTimer.C
            }
            task()
            idleTimer.Reset(p.idleTimeout)
        case <-idleTimer.C:
            if atomic.LoadInt32(&p.liveSize) > p.floor {
                atomic.AddInt32(&p.liveSize, -1)
                return
            }
            idleTimer.Reset(p.idleTimeout)
        case <-p.quit:
            return
        }
    }
}
```

If a worker is idle for `p.idleTimeout` and the pool is above its floor, the worker exits. This is `MaxIdleTime` in `database/sql`, the worker-`KeepAlive` in `net/http.Server`, and the `MaxIdleWorkers` in many job queue libraries. It is a beautifully decentralized form of autoscaling — each worker decides on its own, no external loop needed.

Combine it with an external scale-up loop (which only adds workers; never removes) and you get the most common production shape: external scale-up, decentralized scale-down.

---

## Coding Patterns

### Pattern 1: Separate signal collection from decision

The function that *measures* the signal should not also be the function that *decides* to resize. Mixing them makes both untestable and creates threading messes.

```go
type Signal interface {
    Sample() float64
}

type Decision func(current int, signal float64) (newSize int, changed bool)

func RunAutoscaler(ctx context.Context, p Resizer, s Signal, d Decision, every time.Duration) {
    t := time.NewTicker(every)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done(): return
        case <-t.C:
            v := s.Sample()
            new, changed := d(p.Size(), v)
            if changed { p.Resize(new) }
        }
    }
}
```

Now `Signal` and `Decision` are both pure values you can unit-test trivially. You can swap one decision rule for another (depth-based, wait-based, hybrid) without rewriting the loop.

### Pattern 2: Floor and ceiling

Always have a hard min and max:

```go
type Bounds struct{ Min, Max int }

func (b Bounds) Clamp(n int) int {
    if n < b.Min { return b.Min }
    if n > b.Max { return b.Max }
    return n
}
```

A buggy autoscaler that wants to resize to 0 or 100000 will be silently corrected.

### Pattern 3: Cooldown between resizes

Pair every resize with a timestamp:

```go
type Cooldown struct {
    UpAfter   time.Duration
    DownAfter time.Duration
    lastUp    time.Time
    lastDown  time.Time
}

func (c *Cooldown) AllowUp(now time.Time) bool   { return now.Sub(c.lastUp) >= c.UpAfter }
func (c *Cooldown) AllowDown(now time.Time) bool { return now.Sub(c.lastDown) >= c.DownAfter }
```

Typical settings: `UpAfter = 5s`, `DownAfter = 30s`. Scale up fast, scale down slow.

### Pattern 4: Expose metrics

A pool that does not export metrics is a pool you cannot tune. At minimum:

- Current size (target and live)
- Queue depth and queue capacity
- Tasks submitted, completed, dropped
- p50, p99 wait time
- p50, p99 processing time

Use Prometheus client library and gauge/counter/histogram. Without these you are flying blind.

---

## Clean Code

- **Name your knobs.** `MaxWorkers`, `MinWorkers`, `ScaleUpThreshold`, `ScaleDownThreshold`, `ScaleUpCooldown`, `ScaleDownCooldown`, `IdleTimeout`. Don't sprinkle magic numbers.
- **Make resize idempotent.** Calling `Resize(20)` twice in a row should be a no-op the second time. Use atomic comparisons.
- **Atomic operations for size counters.** `int32` with `sync/atomic`. Avoid mixing atomic and non-atomic access.
- **Keep workers stateless.** The pool may shrink under their feet; a worker should not own any state that survives its goroutine's exit.
- **Don't share `*time.Timer` between goroutines.** Each worker has its own idle timer. Sharing timers across workers causes deeply confusing bugs.

---

## Product Use / Feature

Where you'd actually want a dynamic pool:

- **Email/SMS sending.** Off-peak: 4 workers. During a marketing blast: 80 workers. Then back to 4.
- **Image thumbnail generation.** A user upload burst doubles the queue for a few minutes. Add CPU-bound workers; remove them after.
- **Outbound webhook deliveries.** Each is an HTTP call with variable latency. Autoscale by wait time, not depth — depth is unreliable when each task is slow.
- **PDF/report generation.** Some reports take 2 seconds; some take 30. Without scaling, the 30-second jobs block the 2-second jobs. Scale by queue wait time.
- **Background data sync.** A worker per partition; you may want to add workers when one partition gets behind.

In each case, the same template works: collect signal, decide, resize, repeat.

---

## Error Handling

Three failure modes to anticipate:

### 1. Scale-up blocked by upstream

You decide to add 10 workers. The runtime cannot allocate stacks (out of memory). Should the autoscaler crash? No — log a warning, stay at the current size, try again next tick. Autoscalers should be best-effort: they cannot make hardware appear.

### 2. Shrink during in-flight task

A worker that is mid-task does not respond to "exit." The right pattern is: workers check the shrink signal only at the top of their loop, between tasks. Never interrupt a task in flight. If you must interrupt (the task is hung), use `context.WithTimeout` per task — the task code itself is responsible for cancellation.

### 3. Panic in a worker

If a worker panics, the whole pool can die. Wrap each task in a recover:

```go
func (p *Pool) safeRun(task func()) {
    defer func() {
        if r := recover(); r != nil {
            log.Printf("pool worker recovered from panic: %v", r)
        }
    }()
    task()
}
```

Without this, one buggy submitted function takes down the program. ants does this for you by default.

---

## Performance Tips

- **Don't poll faster than you can react.** A 100 ms autoscaler tick is overkill if your workers take 200 ms per task. Use 500 ms or 1 s.
- **Use atomic counters, not channels for signals.** A channel send per task to "count" is overhead; an `atomic.AddInt64` is essentially free.
- **Prefer adding to halving (or doubling).** Multiplicative growth lets you handle bursts; additive shrink prevents over-correction. This is AIMD; we cover it at senior level.
- **Cache `runtime.NumCPU()`.** It does a syscall. Compute it once at startup.
- **Avoid lock contention in hot paths.** A pool that takes a mutex on every submit will not outscale a static pool. Use channels and atomics.

---

## Best Practices

1. Start with a static pool. Add dynamic resize only when you have evidence it would help — measure queue depth and processing latency for a week first.
2. Define a min, a max, and a cooldown before writing any code. Without these three, you will write a bug.
3. Make the autoscaler observable. Export a gauge for pool size, a counter for resize events, and a histogram for wait time.
4. Test with synthetic bursts. Hit your pool with 10× normal load for 5 seconds and watch the size graph.
5. Be eager to add, slow to remove. Cost of an extra worker is bytes; cost of a missing worker during a burst is missed SLO.
6. Always have a floor. A pool of size 0 cannot start immediately.
7. Don't react to single samples. Use a moving average over the last N ticks.

---

## Edge Cases & Pitfalls

### Pitfall 1: Sending on a channel after the last worker exits

If your pool shrinks to zero workers, any pending `Submit` blocks forever. Defense: keep a floor `>= 1`, or have `Submit` time out.

### Pitfall 2: `Tune(n)` does not kill in-flight goroutines

In ants, calling `Tune(2)` when 50 are running does not terminate any of them. They finish their current task and return to the pool's idle pool; only then is the cap enforced. If you need *immediate* shrink for cost reasons, the only safe path is to cancel in-flight tasks via their `context.Context`.

### Pitfall 3: Counting the wrong number

`p.Running()` in ants is the number of *busy* workers. `p.Cap()` is the maximum allowed. `p.Free()` is `Cap - Running`. Mixing these up gives you a backwards autoscaler — one that scales up when it should scale down.

### Pitfall 4: Resize while closing

If you call `Resize(N)` after `Close()`, you may try to spawn workers on a closed pool. Guard with a `closing` flag, or use `sync.Once` on `Close`.

### Pitfall 5: Stale signals after a resize

Just after you double the pool, queue depth drops fast — but it took some ticks to drain. If you re-evaluate too soon, you'll see "queue still high" and double again. Use a cooldown to avoid this stutter.

### Pitfall 6: Per-tick cost vs steady-state cost

A 100 ms tick that spends 5 ms collecting samples costs you 5% of one CPU. On a 32-core machine that may be fine. On a 1-core function-as-a-service container it is not.

---

## Common Mistakes

1. **No cooldown.** Pool oscillates between 8 and 32 every tick. Tail latency spikes match each cycle.
2. **No floor.** Pool drops to 0 during off-peak. First request after off-peak waits seconds for a cold start.
3. **Using `len(ch)` racily.** `len(ch)` is well-defined but the value is stale by the time you use it. Average over time.
4. **Killing workers mid-task.** Goroutines cannot be killed in Go. Trying to (with goroutine-IDs, third-party libs, etc.) is a code smell.
5. **Ignoring the producer side.** A growing queue might mean the consumer is slow *or* the producer is too fast. Adding workers doesn't help if the producer is misbehaving.
6. **Scaling on instant signals.** Single-sample resizes (one tick of high depth → 2× the pool) overshoot. Average over 3-5 samples.
7. **Multiple autoscalers fighting.** If you run two autoscaler goroutines, they will fight. Use a single goroutine with a mutex on `Resize`.
8. **Forgetting `recover` in workers.** One panic and the worker count drops; soon the pool is dead.
9. **Submitting from inside a worker.** Causes deadlock if the queue is full and all workers are blocked on submit.
10. **Treating `runtime.NumGoroutine()` as the worker count.** It includes every goroutine in the program, not just pool workers. Track your own counter.

---

## Common Misconceptions

- *"Dynamic = better."* Not for low-volume, predictable workloads. A static pool is simpler, cheaper, and easier to reason about. Dynamic is a tool, not a virtue.
- *"More workers = more throughput."* Only up to the bottleneck. After that, more workers just queue at the bottleneck.
- *"The pool size should equal NumCPU."* Only for CPU-bound work. For I/O-bound it can be 10× or 100× NumCPU.
- *"Tune(n) shrinks instantly."* ants and most libraries shrink opportunistically. Workers finish their task first.
- *"You can interrupt a goroutine."* Not in Go. You must cooperate via context or channel signals.
- *"Channel buffer is the queue."* It is the most-buffered queue, but real wait time depends on how fast workers drain it. Two pools with buffer 1024 can have very different wait times.

---

## Tricky Points

- **`len(ch)` is a snapshot, not a transaction.** Between reading it and deciding, the value changes. That's fine for autoscaling, where signals are inherently fuzzy. Just be aware.
- **`time.Ticker` drifts.** Over hours, a 500 ms ticker may produce ticks slightly off; the drift is bounded but nonzero. Don't rely on exact timing.
- **Atomic loads can be reordered with other loads.** `liveSize` and `targetSize` may be observed inconsistently by a worker. The result is at worst one extra or missing exit; the system corrects itself on the next iteration.
- **`Tune(0)` in ants is allowed and immediately stalls submissions.** Surprising. Test it.
- **Idle timeout interacts with the floor.** If `idleTimeout = 30s` and `floor = 4`, the first four idle workers will never exit, but the fifth and beyond will.
- **A pool that has shrunk leaves "ghost" goroutine count for a few ticks.** This is the gap between "decided to exit" and "actually exited." Don't panic when you see it.

---

## Test

How do you test a dynamic pool?

1. **Unit test the decision function.** It is pure: given current size and signal value, returns new size. Trivially testable.
2. **Test resize with a slow task generator.** Submit at a known rate; verify pool size converges within N seconds.
3. **Test under burst.** Submit 1000 tasks at once; verify pool grows, then check it shrinks afterwards.
4. **Test the shutdown path.** Make sure all workers exit, no leak. Use `goleak`.
5. **Race detector.** `go test -race` reveals concurrent map writes, missing atomics, etc.

```go
func TestPoolGrowsUnderLoad(t *testing.T) {
    p := NewPool(2)
    defer p.Close()
    var done int64
    for i := 0; i < 500; i++ {
        p.Submit(func() {
            time.Sleep(10 * time.Millisecond)
            atomic.AddInt64(&done, 1)
        })
    }
    // Autoscaler should have grown the pool.
    time.Sleep(200 * time.Millisecond)
    if atomic.LoadInt32(&p.liveSize) < 8 {
        t.Errorf("expected pool to grow, got %d", p.liveSize)
    }
}
```

---

## Tricky Questions

1. **If `len(ch)` is racy, why is it OK for autoscaling?**
   Because we average and we resize gradually. A 5% wrong reading does not affect the long-term resize trend. We are not making a financial decision; we are nudging a control system.

2. **Can a pool ever shrink while a worker is blocked on a downstream HTTP call?**
   The worker continues; only when it returns to the top of its loop will it exit. The pool's "live" count drops only then. The autoscaler should account for this lag.

3. **Why scale up faster than scale down?**
   Asymmetric costs. A missing worker during a spike causes a missed SLO. An extra worker during steady state costs a few KB.

4. **Why is one autoscaler goroutine enough?**
   Resize is rare (milliseconds per minute). One goroutine ticking every 500 ms is plenty. Two would just fight.

5. **What happens if every worker panics?**
   The pool's live count drops to zero. New submissions block forever (if the channel is unbuffered) or fill the buffer and then block. The autoscaler may or may not respawn workers — depends on your design. Production: respawn with backoff; alert.

---

## Cheat Sheet

```text
target = 16     # desired
live   = 12     # actual
queue  = 80%    # signal

if queue > 75% and live < max:      live += 2     # scale up
if queue < 10% and live > min:      live -= 1     # scale down
respect cooldowns: up=5s, down=30s
```

```go
// Pool API to memorise:
p.Resize(n)         // change target
p.Submit(task)      // enqueue
p.Size()            // current
p.Close()           // drain and exit

// ants:
p, _ := ants.NewPool(8)
p.Tune(32)          // grow
p.Tune(4)           // shrink (opportunistic)
p.Running()         // busy workers
p.Free()            // idle slots
p.Cap()             // max
p.Release()         // close
```

---

## Self-Assessment Checklist

- [ ] I can explain why a static pool is a guess
- [ ] I can write a pool with `Resize(n)` from scratch
- [ ] I can write a queue-depth autoscaler with hysteresis
- [ ] I can use `ants.Tune` to grow and shrink a pool
- [ ] I can list five common mistakes (no cooldown, no floor, etc.)
- [ ] I can describe the asymmetry: fast up, slow down
- [ ] I can write a wait-time signal collector
- [ ] I can write a worker that shrinks itself on idle timeout
- [ ] I understand why scale-down is harder than scale-up
- [ ] I can think of one workload where dynamic scaling is the wrong choice

If you have nine checked, move on to the middle level.

---

## Summary

A worker pool is two numbers: target size and live size. Static pools fix both. Dynamic pools change the target at runtime and let workers converge.

Scale up by spawning. Scale down opportunistically — workers check between tasks. Use hysteresis (different up/down thresholds) and cooldown (minimum interval between resizes) to prevent oscillation. Choose a signal that maps to your SLO: queue depth is easy, wait time is more meaningful. Use ants `Tune(n)` for the heavy lifting; the autoscaler is the part you write.

Three rules: have a floor. Be eager to add, slow to remove. Measure before you tune.

---

## What You Can Build

- An email sender that auto-scales workers between 4 and 64 based on outbox depth
- A thumbnail service that uses ants and `Tune` based on queue wait time
- A job queue with per-tenant pools, each with its own autoscaler
- A webhook delivery worker pool with idle-timeout shrink and queue-depth grow

---

## Further Reading

- The `panjf2000/ants` source — `pool.go` and `worker_loop_queue.go` show exactly how `Tune` works
- "Little's Law for Software Engineers" — Brendan Gregg
- TCP congestion control basics — the AIMD pattern in `RFC 5681`
- Go memory model — for understanding atomic semantics

---

## Related Topics

- Backpressure — what happens when the queue is full and the pool cannot keep up
- Graceful shutdown — how to close a dynamic pool without losing in-flight tasks
- Worker pool patterns — the static baseline this whole topic improves on
- Context cancellation — the primitive for per-task interruption

---

## Deep Dive: How Resize Actually Happens

The whole skill of dynamic scaling is in the careful choreography of one tiny window of time: the moment a `Resize(n)` call is executing while workers are simultaneously taking work from the channel and finishing previous tasks. Most of the bugs you will ever write in this topic happen in this window. Let us slow it down and study it frame by frame.

### Frame 0: steady state

Live = 4, Target = 4. Queue has 60 of 1024 capacity used. Four goroutines are each parked on `<-jobs`, waking up roughly every 5 ms to take a task.

### Frame 1: autoscaler decides

A scaler goroutine ticks. It samples `len(jobs) = 950` (queue is almost full). It computes utilization ratio `950/1024 = 0.93`. The decision rule says: utilization > 0.75 and current < max, so resize from 4 to 8. The autoscaler calls `pool.Resize(8)`.

### Frame 2: Resize takes the mutex

`Resize` acquires `p.mu`. Inside the critical section it reads `liveSize = 4`, sets `targetSize = 8`, and loops `for i := 4; i < 8; i++`. On each iteration it calls `atomic.AddInt32(&p.liveSize, 1)` *first* (so the live count is consistent before the goroutine starts), then `wg.Add(1)`, then `go p.worker()`.

At this point, between the atomic add and the `go`, an existing worker could observe `liveSize = 5` even though only four goroutines exist. This is a benign race: the inconsistency is tiny and never used for correctness, only for scaling decisions. The next autoscaler tick will see the right number.

### Frame 3: new workers race to the channel

The four new goroutines are scheduled. The first one wakes up, calls `select` on `jobs` and `quit`, picks a task, runs it. The second does the same. Within a few microseconds, all four new workers have processed tasks. Queue depth is dropping fast because eight workers are draining instead of four.

### Frame 4: queue depth observed by next scaler tick

500 ms later, the scaler ticks again. `len(jobs)` is now 150. Utilization is 0.15. The decision rule: utilization < 0.10 is false (we are at 0.15), so do nothing. We have crossed the lower band but not by enough — the deadband prevents a panic-shrink.

### Frame 5: producer eases off

Another tick. Queue drops to 80 (utilization 0.08). Below the 0.10 threshold. The scaler proposes a resize. But — *cooldown check* — only 1 s has passed since the last scale up. Down-cooldown is 30 s. The scaler logs "would scale down but cooldown active" and waits.

### Frame 6: cooldown elapses

29 seconds later (so 30 s after the scale-up), the scaler ticks. Queue is steadily at 50 (utilization 0.05). The scaler calls `Resize(7)`. Now `targetSize = 7`, `liveSize = 8`. No goroutines are spawned. Workers continue running.

### Frame 7: one worker shrinks itself

The next time any worker finishes a task and loops back to the top, it reads `liveSize = 8, targetSize = 7`. It exits, decrementing `liveSize` to 7. Now `liveSize == targetSize`. Other workers loop, find the equality, and continue running.

This is the **opportunistic shrink** in detail. Notice three properties:

1. There is no central "kill this worker" decision. Workers cooperate.
2. Shrink is asynchronous. The autoscaler does not wait for the shrink to complete.
3. The shrink may take any amount of time — until the next task completes — depending on processing latency. If tasks take 10 minutes, shrink takes up to 10 minutes.

If your workers have very long tasks, opportunistic shrink is slow. For those, you may need cooperative cancellation: workers periodically check `ctx.Done()` and exit even mid-task. Most pools should not do this — they exist for *short* tasks where opportunistic is fine.

### Frame 8: pool reaches steady state again

Live = 7, Target = 7. The autoscaler keeps polling but does not change anything until the next signal change. The system is at rest.

This entire dance — frames 0 through 8 — happens hundreds of times per day in a busy service. Most of the work in writing a dynamic pool is making sure each frame is correct, in isolation, under all orderings of other goroutines.

---

## Anatomy of a Resize Call

Here is the minimum correct `Resize` method, annotated:

```go
func (p *Pool) Resize(target int) {
    // Clamp first. A buggy caller asking for 100000 should not crash us.
    if target < p.floor {
        target = p.floor
    }
    if target > p.ceiling {
        target = p.ceiling
    }

    // Take the mutex. Resize is rare and serialised; this is fine.
    p.mu.Lock()
    defer p.mu.Unlock()

    // Are we mid-shutdown? Refuse new spawns.
    if p.closing {
        return
    }

    old := atomic.LoadInt32(&p.liveSize)
    atomic.StoreInt32(&p.targetSize, int32(target))

    // Are we growing?
    if int32(target) > old {
        toAdd := int32(target) - old
        for i := int32(0); i < toAdd; i++ {
            // Increment liveSize BEFORE the go statement.
            // If we did it after, a fast tick could read the wrong value.
            atomic.AddInt32(&p.liveSize, 1)
            p.wg.Add(1)
            go p.worker()
        }
    }
    // If shrinking, do nothing here. Workers handle their own exit.
}
```

Three details are easy to get wrong:

- **Order of atomic increment vs `go`.** Increment first; otherwise the autoscaler may observe live < real for a brief window and compound the error.
- **`wg.Add(1)` before `go`.** The classic WaitGroup rule.
- **Lock held across `go`.** Acceptable here because `go` is fast (microseconds). For a pool with thousands of growing workers, you would want to release the lock and spawn outside of it.

---

## Two Common Worker Shapes

There are two natural shapes for a worker goroutine in a dynamic pool. Both are correct; they differ in cost and behaviour.

### Shape A: Check on every iteration

```go
func (p *Pool) workerA() {
    defer p.wg.Done()
    for {
        if atomic.LoadInt32(&p.liveSize) > atomic.LoadInt32(&p.targetSize) {
            atomic.AddInt32(&p.liveSize, -1)
            return
        }
        select {
        case <-p.quit:
            atomic.AddInt32(&p.liveSize, -1)
            return
        case task, ok := <-p.jobs:
            if !ok {
                atomic.AddInt32(&p.liveSize, -1)
                return
            }
            task()
        }
    }
}
```

- Pro: shrink reacts within one task's duration
- Pro: simple to reason about
- Con: two atomic loads on every loop iteration (cheap but not free)

### Shape B: Signal-driven shrink

```go
func (p *Pool) workerB() {
    defer p.wg.Done()
    for {
        select {
        case <-p.shrink:
            atomic.AddInt32(&p.liveSize, -1)
            return
        case <-p.quit:
            atomic.AddInt32(&p.liveSize, -1)
            return
        case task, ok := <-p.jobs:
            if !ok {
                atomic.AddInt32(&p.liveSize, -1)
                return
            }
            task()
        }
    }
}
```

Here `p.shrink` is a separate channel. `Resize(target)` when shrinking sends `(old - target)` empty values to `p.shrink`. Each send wakes one worker which exits.

- Pro: no per-iteration overhead
- Pro: tight control over exact count
- Con: a worker mid-task does not hear the shrink until the task finishes; you still get the same lag as Shape A
- Con: a bug in `Resize` can over-send or under-send to `p.shrink`

Shape A is more common because the bookkeeping is centralised in `Resize`. Shape B is what ants does internally.

---

## What ants Does Under the Hood

We have called `ants.Tune(n)` a few times. Let's look at what really happens, simplified from the v2 source.

When you create a pool:

```go
p, _ := ants.NewPool(8)
```

ants allocates:

- A circular slice of `*goWorker` references, the "free list"
- A `sync.Cond` for blocking submissions when the pool is full
- A `capacity int32` (atomic) — the pool's current cap

When you submit:

```go
p.Submit(task)
```

ants does roughly:

```go
w := p.retrieveWorker()
w.task <- task
```

`retrieveWorker()` either pops a worker from the free list, or — if the live count is below capacity — spawns a new one. Each worker is a goroutine that loops on a per-worker `task chan`. After running a task, the worker puts itself back on the free list and waits for the next one.

When you call `Tune(n)`:

```go
p.Tune(32)
```

ants atomically sets `capacity = 32`. It does *nothing* else. The growth happens lazily: the next submission that finds the free list empty and the live count below 32 spawns a new worker.

When you call `Tune(2)` after running with 50 workers:

```go
p.Tune(2)
```

`capacity = 2` is set. But there are 50 goroutines alive. ants does not touch them. As each finishes its current task and tries to put itself back on the free list, it checks: is live > capacity? If yes, the worker exits instead of going back to the free list.

So ants implements Shape B with a slight twist: shrink is checked at the moment a worker would re-enqueue itself, not at the top of its loop. The effect is the same: opportunistic shrink, bounded by current task duration.

The free list is bounded by `capacity`; when shrinking, the excess workers eventually exit and the bookkeeping consistency restores itself.

### Implications

1. `Tune(n)` is `O(1)` in time. It never blocks.
2. After `Tune(n)` returns, the pool is *eventually* at size n, not immediately.
3. Calling `Tune` rapidly is safe but mostly useless: only the last value matters because shrink is opportunistic.
4. ants is designed for high-throughput, low-latency workloads. Tuning is rarely the bottleneck.

---

## Designing the Autoscaler Loop

You will write some variation of this loop ten times in your career. Let us look at the canonical shape:

```go
func Autoscale(ctx context.Context, p Pool, opts AutoscaleOpts) {
    ticker := time.NewTicker(opts.Interval)
    defer ticker.Stop()

    var lastUp, lastDown time.Time

    for {
        select {
        case <-ctx.Done():
            return
        case now := <-ticker.C:
            signal := opts.Signal()
            current := p.Size()
            decision := opts.Decide(current, signal)

            switch {
            case decision > current:
                if now.Sub(lastUp) < opts.UpCooldown {
                    continue
                }
                p.Resize(decision)
                lastUp = now
            case decision < current:
                if now.Sub(lastDown) < opts.DownCooldown {
                    continue
                }
                p.Resize(decision)
                lastDown = now
            }
        }
    }
}
```

The `AutoscaleOpts` type:

```go
type AutoscaleOpts struct {
    Interval     time.Duration
    UpCooldown   time.Duration
    DownCooldown time.Duration
    Signal       func() float64
    Decide       func(current int, signal float64) int
}
```

Three pieces are pluggable:

1. **Signal**. How do you measure current load? Queue depth? Wait time? Utilization?
2. **Decide**. Given a signal and current size, what is the new size?
3. **Cooldowns**. How long must pass between resizes of each direction?

A unit test for the loop wires up mock signal and decide:

```go
func TestAutoscaler(t *testing.T) {
    var pool fakePool
    pool.size = 8
    signal := 0.9
    sig := func() float64 { return signal }
    dec := func(cur int, v float64) int {
        if v > 0.75 { return cur + 1 }
        return cur
    }
    ctx, cancel := context.WithCancel(context.Background())
    go Autoscale(ctx, &pool, AutoscaleOpts{
        Interval: 5 * time.Millisecond,
        Signal: sig,
        Decide: dec,
        UpCooldown: 0,
        DownCooldown: 0,
    })
    time.Sleep(50 * time.Millisecond)
    cancel()
    if pool.size <= 8 {
        t.Errorf("expected scaling up, got %d", pool.size)
    }
}
```

Notice how *signal* and *decide* are pure functions of their inputs. They have no globals. The loop has no business logic. This is the right shape because each piece is independently testable.

---

## Three Concrete Workloads, Three Different Decisions

The right autoscaler shape depends on what your service does. Let us walk through three real workloads.

### Workload A: Outbound email

- Each email send: SMTP handshake + body upload, ~150 ms median, 600 ms p99
- I/O-bound (network)
- Bursts during marketing campaigns (10× normal for 5–10 minutes)

**Signal:** queue depth. Bursts fill the queue in seconds.

**Decision:** if depth > 60% capacity, add 4 workers; if < 20%, remove 2.

**Cooldowns:** up=2s, down=60s.

**Floor:** 4. **Ceiling:** 200.

Reasoning: email is I/O-bound; we can afford 200 workers (400 KB stacks). Bursts need fast reaction. Shrink slowly because campaigns often come in waves.

### Workload B: Image resizing

- Each image: 50–200 ms, mostly CPU
- CPU-bound; one worker per available core gets full throughput
- Variable burst pattern (user uploads)

**Signal:** queue depth.

**Decision:** if depth > 50% and live < NumCPU * 1.5, add 1; if depth = 0 and idle for 30s, remove 1.

**Cooldowns:** up=5s, down=120s.

**Floor:** 2. **Ceiling:** `NumCPU * 1.5`.

Reasoning: CPU-bound work cannot benefit from more workers than cores + a small overlap. The ceiling reflects this. Shrink very slowly because spinning up new workers costs cache warm-up.

### Workload C: Webhook delivery

- Each delivery: outbound HTTP, 10 ms to 10 s, very high variance
- I/O-bound but with extreme variance
- Steady stream of webhooks, occasional spikes

**Signal:** wait time. Queue depth is misleading because slow webhooks make the queue grow even without a true overload.

**Decision:** if avg wait > 200 ms over last 10 samples, add 5; if avg wait < 20 ms, remove 1.

**Cooldowns:** up=3s, down=30s.

**Floor:** 8. **Ceiling:** 500.

Reasoning: variance is so high that depth-based scaling overreacts. Wait time integrates over many tasks and is more stable.

---

## The Resize Decision Function in Detail

The most important function in the whole topic is `Decide`. Let us look at three versions, increasingly sophisticated.

### Version 1: Step

```go
func DecideStep(cur int, sig float64) int {
    switch {
    case sig > 0.75:
        return cur + 1
    case sig < 0.10:
        return cur - 1
    default:
        return cur
    }
}
```

Add one, remove one. Simple. Slow to react during a 10× burst (would need many ticks). Tail-latency-friendly. The right default for many workloads.

### Version 2: Multiplicative

```go
func DecideMultiplicative(cur int, sig float64) int {
    switch {
    case sig > 0.75:
        return cur * 2
    case sig < 0.10:
        return cur / 2
    default:
        return cur
    }
}
```

Doubles and halves. Fast reaction to bursts. Coarse. Wastes capacity briefly during the overshoot. The right choice for very bursty workloads (background batch jobs).

### Version 3: AIMD

```go
func DecideAIMD(cur int, sig float64) int {
    switch {
    case sig > 0.75:
        return cur + 1            // additive increase
    case sig < 0.10:
        return cur - cur/4        // multiplicative decrease (-25%)
    default:
        return cur
    }
}
```

Additive increase, multiplicative decrease. Borrowed from TCP. Tail latency is good because growth is gradual. Idle capacity vanishes fast because shrink is aggressive. The right choice for cost-sensitive cloud deployments.

There are also AIAD (additive both), MIAD (multiplicative up, additive down) — they exist in the literature but are rarely used because their behavioural properties are worse.

We cover AIMD with care at senior level. For now, internalise: there is no universal best. The decision rule depends on cost asymmetry.

---

## Hands-on: Build a Pool from Scratch in 100 Lines

Let us assemble a complete, runnable dynamic pool. Save as `pool.go`:

```go
package main

import (
    "context"
    "fmt"
    "log"
    "sync"
    "sync/atomic"
    "time"
)

type Pool struct {
    jobs       chan func()
    quit       chan struct{}
    targetSize int32
    liveSize   int32
    wg         sync.WaitGroup
    mu         sync.Mutex
    closing    bool
    floor      int32
    ceiling    int32
}

func NewPool(initial, floor, ceiling int) *Pool {
    p := &Pool{
        jobs:    make(chan func(), 1024),
        quit:    make(chan struct{}),
        floor:   int32(floor),
        ceiling: int32(ceiling),
    }
    p.Resize(initial)
    return p
}

func (p *Pool) Submit(task func()) bool {
    select {
    case p.jobs <- task:
        return true
    default:
        return false
    }
}

func (p *Pool) Resize(target int) {
    if target < int(p.floor) {
        target = int(p.floor)
    }
    if target > int(p.ceiling) {
        target = int(p.ceiling)
    }
    p.mu.Lock()
    defer p.mu.Unlock()
    if p.closing {
        return
    }
    old := atomic.LoadInt32(&p.liveSize)
    atomic.StoreInt32(&p.targetSize, int32(target))
    if int32(target) > old {
        for i := old; i < int32(target); i++ {
            atomic.AddInt32(&p.liveSize, 1)
            p.wg.Add(1)
            go p.worker()
        }
    }
}

func (p *Pool) Size() int { return int(atomic.LoadInt32(&p.liveSize)) }

func (p *Pool) worker() {
    defer p.wg.Done()
    for {
        if atomic.LoadInt32(&p.liveSize) > atomic.LoadInt32(&p.targetSize) {
            atomic.AddInt32(&p.liveSize, -1)
            return
        }
        select {
        case <-p.quit:
            atomic.AddInt32(&p.liveSize, -1)
            return
        case task, ok := <-p.jobs:
            if !ok {
                atomic.AddInt32(&p.liveSize, -1)
                return
            }
            p.safeRun(task)
        }
    }
}

func (p *Pool) safeRun(task func()) {
    defer func() {
        if r := recover(); r != nil {
            log.Printf("pool: recovered: %v", r)
        }
    }()
    task()
}

func (p *Pool) Close() {
    p.mu.Lock()
    p.closing = true
    close(p.quit)
    p.mu.Unlock()
    p.wg.Wait()
    close(p.jobs)
}

func (p *Pool) Autoscale(ctx context.Context) {
    ticker := time.NewTicker(500 * time.Millisecond)
    defer ticker.Stop()
    var lastUp, lastDown time.Time
    for {
        select {
        case <-ctx.Done():
            return
        case now := <-ticker.C:
            depth := len(p.jobs)
            cap := cap(p.jobs)
            usage := float64(depth) / float64(cap)
            cur := p.Size()
            switch {
            case usage > 0.75 && now.Sub(lastUp) > 2*time.Second:
                p.Resize(cur + 2)
                lastUp = now
            case usage < 0.10 && now.Sub(lastDown) > 30*time.Second:
                p.Resize(cur - 1)
                lastDown = now
            }
        }
    }
}

func main() {
    p := NewPool(2, 2, 64)
    ctx, cancel := context.WithCancel(context.Background())
    go p.Autoscale(ctx)

    var done int64
    for i := 0; i < 1000; i++ {
        for !p.Submit(func() {
            time.Sleep(15 * time.Millisecond)
            atomic.AddInt64(&done, 1)
        }) {
            time.Sleep(time.Millisecond)
        }
    }
    for atomic.LoadInt64(&done) < 1000 {
        time.Sleep(50 * time.Millisecond)
        fmt.Println("pool size:", p.Size(), "done:", atomic.LoadInt64(&done))
    }
    cancel()
    p.Close()
}
```

Run it. You will see the pool start at 2, grow up to perhaps 20 as the queue fills, and process all 1000 tasks. The output gives you the size trajectory.

This is 130 lines of real code that you can deploy. Production versions add metrics, configurable signals, retries, panic-rollback, dead-letter queues, but the core is here.

---

## Reading Your Pool's Behaviour from Metrics

Once you deploy a dynamic pool, you must observe it. The five charts that matter:

1. **Pool size over time.** Should be reactive to load but not flapping. If it changes every tick, your cooldown is too short.
2. **Queue depth over time.** Should stay in the deadband most of the time. Spikes should resolve within seconds.
3. **Task wait time (p50, p99).** The customer-facing metric. p99 should match your SLO.
4. **Task processing time (p50, p99).** Should be roughly independent of pool size. If it grows with size, your downstream is overwhelmed.
5. **Resize events per minute.** Should be < 5/min in steady state. > 30/min means oscillation.

A Grafana dashboard with these five panels is what you build first when adopting a dynamic pool. Without them, every claim about its behaviour is a guess.

```go
// Metrics with prometheus client_golang:
var (
    poolSize = promauto.NewGauge(prometheus.GaugeOpts{
        Name: "pool_size", Help: "current worker count",
    })
    queueDepth = promauto.NewGauge(prometheus.GaugeOpts{
        Name: "pool_queue_depth", Help: "queued tasks",
    })
    waitDuration = promauto.NewHistogram(prometheus.HistogramOpts{
        Name: "pool_task_wait_seconds",
        Buckets: prometheus.ExponentialBuckets(0.001, 2, 12),
    })
    processDuration = promauto.NewHistogram(prometheus.HistogramOpts{
        Name: "pool_task_process_seconds",
        Buckets: prometheus.ExponentialBuckets(0.001, 2, 12),
    })
    resizes = promauto.NewCounterVec(prometheus.CounterOpts{
        Name: "pool_resizes_total",
    }, []string{"direction"})
)
```

Call `poolSize.Set(float64(p.Size()))` after every resize and every minute on a heartbeat. `queueDepth.Set(float64(len(p.jobs)))` on each autoscaler tick. `waitDuration.Observe(...)` in the worker. `resizes.WithLabelValues("up").Inc()` after each scale-up.

---

## What Goes Wrong in Production

Real-world failures from dynamic pools, sanitised from real incident reports:

### Incident A: Cold start at midnight

A reporting service had a dynamic pool with floor=0. Every midnight, traffic was zero, the pool shrank to zero. At 00:00:05, the daily report job submitted 2000 tasks. The first task waited 800 ms while the pool re-grew. The 2000th waited 4 seconds. SLO breach. Fix: floor=4.

### Incident B: Flapping on a slow downstream

A search service used queue-depth scaling. When the search backend got slow (200 ms → 800 ms), queue grew, pool scaled up, more requests hit the backend, backend got slower. Result: positive feedback loop, p99 latency 30s. Fix: scale on wait time, not depth; add circuit breaker to limit downstream concurrency.

### Incident C: Resize storm during a deploy

After a deploy, the new container had an autoscaler that started with a default of 0 workers and grew based on traffic. During the first 10 seconds, before any request hit it, the autoscaler ticked 20 times and did nothing. Then traffic hit hard, the autoscaler doubled-and-doubled, and the container OOM'd at 8 GB. Fix: floor at NumCPU, ceiling tuned to memory, no doubling above 100.

### Incident D: Forgotten `recover`

A library upgrade introduced a `nil` pointer dereference in 0.1% of tasks. Workers panicked. Live count dropped by 1 each panic. Within an hour, all workers were dead. New submissions blocked forever. Fix: wrap each task in `defer recover()`, also add an alert on "live size suddenly dropped."

### Incident E: Atomic bug

A pool had a bug where `Resize` did `liveSize := old + N` instead of `atomic.AddInt32(&liveSize, N)`. Under concurrent resizes (from two autoscaler goroutines — a separate bug), the count drifted. Eventually `liveSize` was negative. Workers behaved wrongly. Fix: use atomic throughout; single autoscaler goroutine.

Each of these was a few-hour outage in a real system. The lessons are now baked into this guide as best practices and pitfalls.

---

## Building Up Intuition with Small Experiments

You will not understand dynamic scaling deeply by reading. Build the following five micro-experiments and observe their behaviour.

### Experiment 1: No-cooldown oscillator

Build the simplest pool with no cooldown. Set thresholds at 50% (up) and 49% (down). Generate steady traffic that produces queue depth at exactly 49.5%. Watch the pool ping-pong every tick. Now widen the deadband to 75/10 and observe stability.

### Experiment 2: Cold start

Set floor=0. Stop submitting for 5 seconds. Then submit 100 tasks at once. Measure the wait time of the 1st task vs the 50th. The 1st waited for the pool to wake up; the 50th had a full pool by then.

### Experiment 3: Slow downstream

Make tasks call `time.Sleep(d)` where `d` varies. Plot queue depth and wait time as `d` increases from 10 ms to 1 s. Notice queue depth grows non-linearly with `d`. Now scale on wait time and observe how scaling behaviour differs.

### Experiment 4: Bursty load

Generate 500 tasks/s for 60 s, then 0 for 60 s, repeating. Compare three pool configs: static at 50; AIMD-style dynamic; multiplicative dynamic. Plot tail latency. AIMD usually wins.

### Experiment 5: Crash test

Inject a 5% panic rate in tasks. Without `recover` in the worker, watch the pool die. Add `recover` and observe stable behaviour. Add a panic-rate metric and observe.

Each experiment takes 10 minutes to code. The intuition you gain is irreplaceable.

---

## A Walkthrough: The Day You Add Dynamic Scaling to a Real Service

Let us simulate the workflow a junior engineer goes through when given the task "add dynamic scaling to the report-generation service."

### Day 1: read existing code

The service has:

```go
var (
    pool = make(chan struct{}, 16)   // semaphore
    wg   sync.WaitGroup
)

func GenerateReport(req Request) {
    pool <- struct{}{}
    wg.Add(1)
    go func() {
        defer wg.Done()
        defer func() { <-pool }()
        doReport(req)
    }()
}
```

This is a static pool of 16. A counting semaphore caps concurrency, but every request spawns its own goroutine; the "16" only limits *active* concurrency. Backpressure: callers of `GenerateReport` block when the semaphore is full. The function `doReport` takes 200 ms to 5 seconds depending on report size.

### Day 2: measurements

You instrument the service. After a day:

- p50 wait time (caller blocked on `pool <- ...`): 0 ms
- p99 wait time: 4.5 s
- Peak concurrent reports: 16 (saturating)
- Off-peak concurrent reports: 2-3

Conclusion: the system is saturating during peaks. Adding more concurrency would help p99. But: 16 is enough for off-peak; growing the static limit hurts off-peak resource usage.

A dynamic pool is the right fix.

### Day 3: design

You sketch:

- Pool with `Resize(n)`. Floor 4, ceiling 64.
- Signal: caller's wait time (the time spent in `pool <- ...`).
- Decision: if p99 wait > 1 s, +4; if avg wait < 50 ms for 60 s, -2.
- Cooldowns: up=10s, down=60s.

Why caller wait time? Because that is the SLO ("p99 wait < 1s"). Queue depth in this design is implicit (semaphore fill); wait time directly measures the SLO.

### Day 4: implementation

You replace the static semaphore with the dynamic pool from earlier. Add a separate goroutine for the autoscaler. Add Prometheus metrics. Wire to a Grafana dashboard.

```go
type Service struct {
    pool      *Pool
    waitObs   *prometheus.HistogramVec
    sizeGauge prometheus.Gauge
    resizes   *prometheus.CounterVec
}

func (s *Service) GenerateReport(req Request) error {
    start := time.Now()
    submitted := s.pool.Submit(func() {
        doReport(req)
    })
    s.waitObs.WithLabelValues("submit").Observe(time.Since(start).Seconds())
    if !submitted {
        return ErrPoolFull
    }
    return nil
}

func (s *Service) Autoscale(ctx context.Context) {
    ticker := time.NewTicker(2 * time.Second)
    defer ticker.Stop()
    var lastUp, lastDown time.Time
    for {
        select {
        case <-ctx.Done():
            return
        case now := <-ticker.C:
            p99 := s.measureP99Wait()
            avg := s.measureAvgWait()
            cur := s.pool.Size()
            switch {
            case p99 > time.Second && now.Sub(lastUp) > 10*time.Second:
                s.pool.Resize(cur + 4)
                lastUp = now
                s.resizes.WithLabelValues("up").Inc()
            case avg < 50*time.Millisecond && now.Sub(lastDown) > 60*time.Second:
                s.pool.Resize(cur - 2)
                lastDown = now
                s.resizes.WithLabelValues("down").Inc()
            }
            s.sizeGauge.Set(float64(s.pool.Size()))
        }
    }
}
```

### Day 5: load test

You build a load generator that simulates a busy day. You run it. You watch:

- Pool size starts at 4
- Within 10 seconds it grows to 24 (peak)
- After load tapers, drops back to 4 over 5 minutes

p99 wait time stays under 1 s throughout. Average wait time under 100 ms. Resize counter shows about 12 ups and 8 downs over the 30-minute test.

### Day 6: deploy

You deploy to canary. You watch real traffic. The graph looks similar but smaller scale. You let it run for 24 hours.

### Day 7: observations

- The autoscaler grew the pool 30 times in 24 hours; shrunk it 25 times. Net growth slightly positive; pool size oscillates between 6 and 20 throughout the day.
- p99 wait time: 800 ms (down from 4.5 s). SLO met.
- Memory: pool's stacks are ~40 KB average. Negligible.
- No incidents.

You promote to all canaries, then to production. The change is shipped.

---

## What You Did Not Do

Notice what you did *not* do in the above:

- You did not write your own pool. ants would have worked equally well; you just happened to use a hand-rolled pool. For a brand-new project, ants is what you would reach for.
- You did not try AIMD or PID. Step increases and step decreases were enough.
- You did not coordinate across servers. Each server's pool autoscales independently. The bigger system (Kubernetes HPA) handles cross-server scaling.
- You did not add a separate panic monitor. Wrapping in `defer recover()` was sufficient.

You also did not over-engineer. The deployment was simple enough to roll back if anything went wrong. This is the right scope for "junior add dynamic scaling."

---

## Two Anti-Patterns You Will See in Real Code

### Anti-pattern 1: Resize from inside a worker

Some code calls `pool.Resize(...)` from inside a task. Surprising? Yes. Deadlock-prone? Yes.

```go
func myTask(p *Pool) {
    if condition {
        p.Resize(p.Size() + 1)  // BAD
    }
    doWork()
}
```

If `Resize` holds a mutex that `Submit` also holds, and you `Resize` from inside a worker, you could deadlock. Even if not, the autoscaler is now two goroutines fighting for the decision.

Rule: only the autoscaler calls `Resize`. Tasks do their job and return.

### Anti-pattern 2: Per-task resize decisions

```go
func (p *Pool) Submit(t func()) {
    if len(p.jobs) > cap(p.jobs)*3/4 {
        p.Resize(p.Size() + 1)
    }
    p.jobs <- t
}
```

Looks clever — resize on every submit when queue gets full. Two bugs:

- High-volume submitters now do an expensive `Resize` call inline; throughput tanks.
- No cooldown. Pool grows uncontrollably during a burst.

Rule: resize decisions are slow-path, separate-goroutine, periodic.

---

## More Examples

### Example: Pool with size monitor goroutine

A common pattern: a separate goroutine that just emits metrics, separate from the autoscaler.

```go
func (p *Pool) Monitor(ctx context.Context, every time.Duration, log func(size, queue int)) {
    ticker := time.NewTicker(every)
    defer ticker.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case <-ticker.C:
            log(p.Size(), len(p.jobs))
        }
    }
}
```

Use case: a debug endpoint shows the pool's current size and queue depth so an operator can diagnose issues without a full Grafana dashboard.

### Example: Pool with manual override

Sometimes you want to force a size temporarily — say, for a known scheduled burst:

```go
type Pool struct {
    // ...
    override *int32  // pointer for "unset"
}

func (p *Pool) SetOverride(n int) {
    n32 := int32(n)
    atomic.StorePointer((*unsafe.Pointer)(&p.override), unsafe.Pointer(&n32))
    p.Resize(n)
}

func (p *Pool) ClearOverride() {
    atomic.StorePointer((*unsafe.Pointer)(&p.override), nil)
}

func (s *Service) autoscale(...) {
    // ...
    if atomic.LoadPointer(&p.override) != nil {
        // skip autoscaling decisions; manual override active
        continue
    }
    // normal decision
}
```

Use case: at 09:00 on Monday, you know batch jobs will start. You override the pool to size 100 from 08:55 to 09:30, then clear the override. Autoscaler resumes after.

### Example: Pool that emits resize events on a channel

```go
type ResizeEvent struct {
    OldSize, NewSize int
    Reason           string
    When             time.Time
}

type Pool struct {
    // ...
    events chan ResizeEvent
}

func (p *Pool) Resize(target int, reason string) {
    // ... normal resize ...
    select {
    case p.events <- ResizeEvent{Old, target, reason, time.Now()}:
    default:
        // channel full, drop event
    }
}
```

A side goroutine consumes events and logs them. Use case: forensic analysis after an incident. "When did the pool grow? Why?"

### Example: Pool with rate-limited resize

If you don't trust the autoscaler not to thrash, rate-limit the resize itself:

```go
import "golang.org/x/time/rate"

type Pool struct {
    // ...
    resizeLimiter *rate.Limiter
}

func NewPool(...) *Pool {
    return &Pool{
        resizeLimiter: rate.NewLimiter(rate.Every(time.Second), 5), // max 5 resizes per second
        // ...
    }
}

func (p *Pool) Resize(target int) {
    if !p.resizeLimiter.Allow() {
        return
    }
    // ... normal resize ...
}
```

Defense in depth — even if the autoscaler has a bug, the pool itself cannot resize more than 5x/s.

---

## A Note on Static-First Development

When you are new to dynamic pools, your instinct will be to make them dynamic. Resist.

**The first deploy of any pool should be static.** Pick a size by Little's Law. Run it for two weeks. Watch metrics. Only then decide whether dynamic adds value.

Reasons:

- Static is simpler. Fewer bugs.
- Static is more predictable. Easier to reason about during an incident.
- Static gives you baseline numbers. Without them, you cannot tell whether dynamic helped.
- Dynamic adds an autoscaler — another component that can fail.

If two weeks of metrics show that the queue depth (or wait time) varies by more than 5× between peak and trough, dynamic will likely help. If it varies by 1.5×, leave it static.

This is the same advice the SRE book gives about autoscaling at cluster level. Apply it to worker pools too.

---

## Walking through a Resize Bug, Step by Step

Imagine you wrote a Resize that looks like this:

```go
func (p *Pool) Resize(target int) {
    p.targetSize = target
    if target > p.liveSize {
        for i := p.liveSize; i < target; i++ {
            p.liveSize++
            go p.worker()
        }
    }
}
```

There are at least four bugs here. Walk through them slowly.

**Bug 1: data race on `targetSize` and `liveSize`.** Two goroutines could call `Resize` concurrently. Workers read `liveSize` without synchronisation. The race detector will flag this. Fix: use `sync/atomic` or hold a mutex.

**Bug 2: read-modify-write of `liveSize` is non-atomic.** Even if you use `atomic.LoadInt32`, the increment `p.liveSize++` is two atomics — read then write. Between them, a worker could exit and also write. Result: lost update. Fix: `atomic.AddInt32`.

**Bug 3: no `wg.Add(1)` before `go`.** The `Close()` method probably calls `wg.Wait()`. Without `wg.Add(1)`, workers spawned by `Resize` are not tracked. Fix: `p.wg.Add(1)` immediately before `go p.worker()`.

**Bug 4: no shrink logic.** If `target < liveSize`, the function does nothing. Live size never decreases. Fix: workers must check `liveSize > targetSize` and exit.

The fixed version:

```go
func (p *Pool) Resize(target int) {
    p.mu.Lock()
    defer p.mu.Unlock()
    if p.closing {
        return
    }
    old := atomic.LoadInt32(&p.liveSize)
    atomic.StoreInt32(&p.targetSize, int32(target))
    if int32(target) > old {
        for i := old; i < int32(target); i++ {
            atomic.AddInt32(&p.liveSize, 1)
            p.wg.Add(1)
            go p.worker()
        }
    }
    // shrink: workers exit on their own next iteration
}
```

Resize is the most subtle function in this whole topic. Practising the correct version helps build muscle memory.

---

## The Submit Method: Three Variants

How `Submit` behaves under a full queue tells your callers what to expect. Pick consciously.

### Variant 1: Blocking

```go
func (p *Pool) Submit(task func()) {
    p.jobs <- task
}
```

If the buffer is full, the caller blocks. Simple, but the caller can wait arbitrarily long. Dangerous if the caller is a request handler with a strict latency budget.

### Variant 2: Non-blocking (drop on overflow)

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

Caller knows immediately if the pool is overwhelmed. Caller can choose: retry with backoff, fail the request, queue elsewhere. This is the production default.

### Variant 3: Timeout

```go
func (p *Pool) Submit(ctx context.Context, task func()) error {
    select {
    case p.jobs <- task:
        return nil
    case <-ctx.Done():
        return ctx.Err()
    }
}
```

Caller's `context.Context` decides the budget. Best for HTTP request handlers — propagate the request context.

Most production pools support all three. ants chooses between variant 1 and variant 2 via the `Nonblocking` option.

---

## Walking Through ants's Source

Here is a condensed read of the relevant ants v2 file `pool.go`. Read it slowly; the patterns repeat in any production pool.

```go
// goWorker is one worker goroutine in the pool.
type goWorker struct {
    pool        *Pool
    task        chan func()      // per-worker mailbox
    recycleTime time.Time         // for idle expiry
}

// run starts the worker's main loop.
func (w *goWorker) run() {
    w.pool.addRunning(1)
    go func() {
        defer func() {
            if w.pool.addRunning(-1) == 0 && w.pool.IsClosed() {
                w.pool.once.Do(func() { close(w.pool.allDone) })
            }
            // panic recovery
            if p := recover(); p != nil {
                if ph := w.pool.options.PanicHandler; ph != nil {
                    ph(p)
                }
            }
            // signal a goroutine that may be waiting in Submit
            w.pool.cond.Signal()
        }()
        for f := range w.task {
            if f == nil {           // nil task is the "exit" sentinel
                return
            }
            f()
            // try to put self back on free list:
            if ok := w.pool.revertWorker(w); !ok {
                return
            }
        }
    }()
}

func (p *Pool) revertWorker(w *goWorker) bool {
    if atomic.LoadInt32(&p.capacity) > 0 && atomic.LoadInt32(&p.running) > atomic.LoadInt32(&p.capacity) {
        return false // pool has shrunk; this worker should exit
    }
    p.lock.Lock()
    w.recycleTime = time.Now()
    p.workers = append(p.workers, w)
    p.cond.Signal()
    p.lock.Unlock()
    return true
}
```

Look at `revertWorker`. After a task runs, the worker tries to put itself back on the free list. If the pool has shrunk (`running > capacity`), `revertWorker` returns false, the outer `for f := range w.task` loop falls through, and the goroutine exits. This is exactly opportunistic shrink. No explicit kill.

The `cond.Signal()` wakes up a goroutine blocked in `Submit` waiting for a free worker.

Reading this file end-to-end takes 30 minutes. It is the single best concurrency exercise you can do at this level. Find ants on GitHub; read it.

---

## A Small Decision Table for the New Engineer

| Question | Recommended answer |
|----------|--------------------|
| Use static or dynamic pool? | Static, unless you have measured oscillating load. |
| What initial size? | Little's Law estimate. |
| What floor? | `runtime.NumCPU()` or 4, whichever is larger. |
| What ceiling? | Memory-bound or downstream-bound limit. |
| What signal? | Queue depth for cheap; wait time for accurate. |
| Cooldown up? | 2-5 seconds. |
| Cooldown down? | 30-60 seconds. |
| Step size up? | +1 or +2 per tick (additive). |
| Step size down? | -1 per tick (additive). |
| Use ants or write own? | ants for production; write own once to learn. |
| Backpressure? | Yes, always. Drop or 429 on overflow. |
| Recover in workers? | Yes, always. |
| Metrics? | Pool size, queue depth, wait time, resizes/min. |

Print this table, tape it to your monitor. After you have shipped one dynamic pool, write your own version — the right answers depend on your context.

---

## A Library Tour: ants, tunny, pond

The Go ecosystem has three production-grade pool libraries you will meet. Each has a different philosophy on dynamic scaling.

### ants — `panjf2000/ants`

The most popular by a wide margin. ~12000 GitHub stars at the time of writing. Used in TiDB, FreeFlow, Bilibili, and many CDNs.

Features:

- `Pool` with `Tune(n)` for runtime resize
- `PoolWithFunc` if every task is the same function (faster path)
- `Submit(task)` blocks if the pool is full and `Nonblocking` is false, or returns error otherwise
- Per-worker idle expiry (default 1 second) — workers that have been idle longer than this exit
- Per-pool panic handler

Idiomatic use:

```go
p, _ := ants.NewPool(8,
    ants.WithExpiryDuration(10*time.Second),
    ants.WithPreAlloc(false),
    ants.WithPanicHandler(func(r interface{}) {
        log.Printf("worker panic: %v", r)
    }),
)
defer p.Release()

_ = p.Submit(myTask)
p.Tune(32)  // grow
p.Tune(8)   // shrink
```

ants does what most projects need out of the box. You wrap an autoscaler goroutine around it that calls `Tune(n)` based on metrics. The pool itself handles spawning, idle expiry, panic recovery, and the free list.

### tunny — `Jeffail/tunny`

Smaller, fewer features, but with a more uniform "worker" abstraction. Each worker is an explicit `Worker` interface; this lets you carry per-worker state (a database connection, a buffer, etc.).

```go
type DBWorker struct {
    db *sql.DB
}

func (w *DBWorker) Process(payload interface{}) interface{} {
    // use w.db without locking — this worker owns the connection
    return doDBWork(w.db, payload)
}

func (w *DBWorker) BlockUntilReady() {} // hook for stateful warmup
func (w *DBWorker) Interrupt()        {} // hook for cancellation
func (w *DBWorker) Terminate()        {} // hook for cleanup

pool := tunny.New(8, func() tunny.Worker {
    return &DBWorker{db: openDB()}
})
defer pool.Close()

result := pool.Process(input)
```

`SetSize(n)` is tunny's `Tune`. It supports growing and shrinking dynamically.

tunny shines when each worker has expensive state. ants forces you to share state, which is a worse fit for things like database transactions.

### pond — `alitto/pond`

Newer (~3000 stars), API-focused. Provides typed pools, task groups, panic handling, and metrics out of the box.

```go
pool := pond.New(100, 1000)  // 100 workers, queue of 1000
defer pool.StopAndWait()

pool.Submit(func() {
    // task
})

// pond supports task groups for batch operations:
group, ctx := pool.GroupContext(ctx)
for _, item := range items {
    item := item
    group.Submit(func() error {
        return process(ctx, item)
    })
}
err := group.Wait()
```

pond does not have a `Tune(n)` at the time of writing; it is a static-pool library with great ergonomics. For dynamic scaling you would need either ants or roll your own. We mention pond because it is the easiest to read source-wise.

### Choosing

- **Most jobs:** ants. Battle-tested. `Tune(n)` is the standard API.
- **Stateful workers:** tunny. The Worker interface is a clean abstraction.
- **No dynamic needed, clean ergonomics:** pond.
- **You want to learn deeply:** roll your own. It is 200 lines.

---

## Backpressure vs Autoscaling

A dynamic pool and a backpressure strategy are two answers to the same question: *what do you do when load exceeds capacity?*

- **Autoscaling** says: increase capacity.
- **Backpressure** says: reduce load.

You almost always want both. Why?

- **Autoscaling has a ceiling.** Memory, CPU, cost of downstream calls — all impose a hard limit. Without backpressure, when you hit the ceiling, the queue grows unbounded and you OOM or your callers time out arbitrarily.
- **Backpressure alone wastes hardware.** If you have spare capacity and could grow but don't, you reject load you could have served.

The standard production pattern: autoscale up to a ceiling, then apply backpressure (reject, queue with timeout, or 429) when at ceiling.

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

The `default` clause is the backpressure: if the buffer is full, return immediately. Callers can choose to retry, fail, or wait — but the pool itself never blocks indefinitely.

When the buffer fills, the autoscaler sees high depth and grows. If capacity allows, the pool grows fast enough that future submits succeed. If we hit the ceiling, `Submit` keeps returning `ErrPoolFull` and callers experience backpressure.

We cover backpressure in detail in the sibling subsection (`01-backpressure`). For now, internalise: **autoscaling and backpressure are partners, not alternatives.**

---

## A Quick Tour of Less Common Signals

We have covered queue depth, wait time, utilization. There are others worth knowing about.

### CPU usage

Pull from `/proc/loadavg` on Linux or `runtime.GoroutineProfile` and CPU profiling APIs. If your process CPU is above 80% sustained, adding workers will not help (CPU-bound).

### Memory usage

`runtime.ReadMemStats`. If heap is near a configurable ceiling, refuse to grow the pool — growing would just OOM faster.

### Error rate

If downstream is returning errors at a growing rate, *do not* scale up — that just amplifies the failure. This is the AWS "stampede" failure mode.

### Tail latency

p99 of processing time. A growing p99 with constant queue depth means downstream is degrading. Adding workers may or may not help depending on the downstream's behaviour.

### Combined signal

Many production autoscalers combine multiple signals:

```go
shouldGrow := queueDepth > 0.7 && cpuUsage < 0.7 && errorRate < 0.01
```

We grow only if the queue is loaded, we have CPU headroom, and we are not in a failure storm. This avoids feedback loops.

We will see PID and predictive controllers at senior level.

---

## Estimating the Right Pool Size

Before you build a dynamic pool, sanity-check with Little's Law. For a stable system:

```
L = λ × W

L = number of in-flight tasks (≈ live workers)
λ = arrival rate (tasks/sec)
W = total time in system (wait + processing)
```

If your workers should be busy 70% of the time (room for spikes), and W ≈ processing time alone (low queue wait):

```
live_workers = (λ × processing_time) / 0.7
```

Example: 200 tasks/sec, each 150 ms:

```
live = (200 × 0.15) / 0.7 = 42.8
```

So 43 workers is the steady-state minimum. Bursts push it up; idle periods push it down. You set:

- Floor: 10 (handles low traffic)
- Ceiling: 100 (handles 2× burst)
- Target at start: 43

If your actual measurements deviate from Little's Law predictions by more than 20%, something is wrong — maybe processing time is not what you think, or there is a hidden bottleneck.

This calculation is the most overlooked piece of pool design. We come back to it with worked examples at senior level.

---

## What the Production Engineer Cares About

If you bring a dynamic pool change to a senior engineer, they will ask:

1. **What is the signal?** "Queue depth." Specifically? "len(jobs)/cap(jobs)." How does that match your SLO?
2. **What is the decision rule?** Show me the function.
3. **What is the cooldown?** Show me the times.
4. **What is the floor and ceiling?** Why those numbers?
5. **What metrics are exposed?** Show me the dashboard.
6. **What is the failure mode?** What happens if the autoscaler goroutine dies?
7. **What happens at startup?** Does the pool start full or empty?
8. **What happens during deploy?** A rolling deploy creates many small pools. Are they cold-starting?
9. **How does this interact with backpressure?** Where do we reject load?
10. **How will we know when this is broken?** What is the alert?

If you can answer all ten, you have done your homework. Most production accidents come from skipping one or two.

---

## Frequently Asked Questions

### Q: Should the autoscaler be its own goroutine, or part of the pool?

Its own goroutine. Separating "the pool" from "the policy that resizes the pool" is good design. The policy is the variable thing; the pool is stable infrastructure.

### Q: What is the right tick rate for the autoscaler?

Slow enough not to react to noise; fast enough to keep up with traffic changes. Typical: 500 ms to 5 s. For very bursty workloads, 100 ms is fine. For batch jobs that run hourly, 30 s.

### Q: Does the autoscaler need a separate goroutine per pool, or can one autoscaler manage many?

Either works. If pools are independent, one autoscaler per pool is simpler. If they share resources (CPU, downstream connections), a central autoscaler can balance globally — at the cost of complexity.

### Q: What if my workload is steady? Do I still need dynamic scaling?

Probably not. Dynamic scaling earns its complexity when load varies. If your peak is within 1.5× of trough, stay static.

### Q: How does dynamic scaling interact with goroutine leaks?

Badly. A leaked goroutine looks like a busy worker. The autoscaler thinks the pool is saturated; it grows; the new workers leak too; the pool grows without bound. Always wrap workers with `recover` and use `goleak` in tests.

### Q: Should I monitor pool size as a gauge or counter?

Gauge. Pool size goes up and down; counters only go up. Resize *events* are a counter — count resize-ups and resize-downs as labels.

### Q: How do I deal with very short tasks (microseconds)?

Channels add ~100 ns per send/receive. If your task is 1 microsecond, channel overhead is 10%. Consider a sharded pool with one channel per shard, or pull-based work-stealing. Or: batch many small tasks into one larger work unit.

### Q: How do I deal with very long tasks (minutes)?

Opportunistic shrink lags by the task duration. For a 5-minute task, a shrink takes up to 5 minutes to take effect. Either accept the lag, or use cooperative cancellation (workers check `ctx.Done()` periodically and exit mid-task).

### Q: How do I dynamically scale across multiple instances?

That is a different problem — cluster-level autoscaling. Kubernetes HPA, AWS ASG. Your in-process pool autoscales locally; the cluster autoscaler adds or removes instances. Together they cover both axes.

### Q: Can I use `runtime.NumGoroutine()` as a signal?

Not directly. It counts every goroutine — your pool, the HTTP server, GC, finalizers. Track your pool's count yourself with an atomic. `NumGoroutine` is a debugging tool, not a signal.

### Q: Should I close the job channel?

Only at shutdown. Closing while writers might still send causes panic. The standard pattern: a `quit` channel for "stop accepting work," and the worker exits when `quit` is closed *and* the job channel is drained.

### Q: What does ants `WithPreAlloc` do?

If `true`, ants allocates all worker slots upfront. If `false` (default), workers are spawned on demand. Pre-alloc is faster for the first N submissions but uses memory upfront. Use pre-alloc for known steady workloads; lazy for spiky ones.

### Q: What is the cost of a Tune call?

Cheap. ants's `Tune(n)` is essentially `atomic.StoreInt32(&p.capacity, int32(n))`. Nanoseconds. You can call it on every tick without worrying about cost.

### Q: Should the floor be 0 or `NumCPU` or something else?

Almost never 0. If you scale to 0, the first task pays a cold-start penalty (goroutine spawn ~1 microsecond, plus possibly memory allocation). For SLOs in the millisecond range, that is fine. For SLOs in the microsecond range, you need a floor.

### Q: What is the relationship to `GOMAXPROCS`?

`GOMAXPROCS` is the maximum number of OS threads simultaneously executing Go code. If you have 1000 workers and `GOMAXPROCS = 8`, only 8 can run at any instant; the rest are parked. For I/O-bound work this is fine — workers wait on I/O, freeing the thread. For CPU-bound work, you cannot benefit from more workers than `GOMAXPROCS + a few`.

### Q: Does a dynamic pool help with downstream rate limits?

No, it makes them harder. More workers = more concurrent calls to downstream = faster rate-limit hits. If your downstream limits you, you need *fewer* workers or a token-bucket rate limiter alongside the pool.

### Q: Can I use a `sync.Pool` for workers?

No. `sync.Pool` is for *reusable objects*, not goroutines. ants's free list is similar in spirit but is bespoke for the goroutine reuse pattern.

### Q: How do I test the autoscaler in isolation?

Mock the pool (a fake with `Size()` and `Resize(n)`) and the signal function. Drive the loop with controlled signal values. Assert that `Resize` is called with expected values. No real goroutines needed.

### Q: How long should the metric window be?

Long enough to average out noise; short enough to react. Typical: 30 s rolling window for averages, 5 s for percentiles. Pick based on your tick rate (window should be 10× tick rate at least).

### Q: What if I have multiple pools (per tenant, per partition)?

Each has its own autoscaler. They might compete for shared resources (CPU, downstream connections). Coordinate by limiting total combined size, not per-pool size — a global pool of permits that each pool draws from.

### Q: When should I drop tasks?

When the pool is at ceiling and the queue is full. Dropping is preferable to unbounded queue growth. Communicate this to the caller via error returns; let the caller decide whether to retry, fail, or shed.

### Q: How do I migrate from static to dynamic?

Step 1: keep static, add metrics. Step 2: deploy the dynamic pool with floor = old static size, ceiling = 2× old static, and a slow autoscaler. Step 3: watch behaviour for a week. Step 4: tune thresholds based on real data.

### Q: What is the failure mode of an autoscaler goroutine that panics?

If you wrote it correctly with `defer recover()`, it logs and exits. The pool is stuck at its current size. A health check should alert. Restart the service.

If you wrote it incorrectly (no recover), the program crashes. Maybe acceptable for a single-process service, not for a critical path.

### Q: Does the Go scheduler help with dynamic pools?

Yes — the GMP scheduler multiplexes goroutines on threads efficiently. Your pool size can exceed core count by orders of magnitude without thread explosion. The scheduler also balances work across CPUs. You do not have to worry about thread-level scheduling.

### Q: Where does context cancellation fit?

The pool's `Close()` is one cancellation. Individual tasks can have their own `context.Context` for per-task timeouts. Workers can hold a parent context for global shutdown. These are orthogonal layers; design them explicitly.

---

## Detailed Walkthrough: Pool Lifecycle

A pool moves through several states. Diagram the transitions:

```
[New]  -- create -->  [Idle]
                       |
                       | Submit
                       v
                    [Running]
                       |
                       | Resize(more)
                       v
                    [Growing]
                       |
                       v
                    [Running, larger]
                       |
                       | Resize(less)
                       v
                    [Shrinking]
                       |
                       v
                    [Running, smaller]
                       |
                       | Close()
                       v
                    [Draining]
                       |
                       v
                    [Closed]
```

Operations to support in each state:

- **Idle**: `Submit` OK, `Resize` OK, `Close` OK
- **Running**: `Submit` OK, `Resize` OK, `Close` OK
- **Growing/Shrinking**: same as Running; resize is idempotent and concurrent-safe
- **Draining**: `Submit` returns error; `Resize` no-op; `Close` blocks until all workers exit
- **Closed**: all operations return error or panic

A robust pool implementation tracks state internally (often via a single atomic enum) and rejects operations in invalid states clearly. The simplest version uses a `closing bool` flag protected by the same mutex as `Resize`.

```go
func (p *Pool) Submit(task func()) error {
    p.mu.Lock()
    closing := p.closing
    p.mu.Unlock()
    if closing {
        return ErrPoolClosed
    }
    select {
    case p.jobs <- task:
        return nil
    default:
        return ErrPoolFull
    }
}
```

Note the brief mutex hold — just to read `closing`. We do not hold the mutex during the channel send because that would serialise all submissions.

---

## Cleanup at Process Exit

A dynamic pool used in a long-running service must shut down cleanly when the process exits. The standard pattern:

```go
func main() {
    ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
    defer cancel()

    pool := NewPool(8, 4, 64)
    go pool.Autoscale(ctx)

    // ... server setup, accept connections, etc. ...

    <-ctx.Done()
    log.Println("shutting down pool...")
    pool.Close()
    log.Println("pool drained")
}
```

`Close()` should:

1. Stop accepting new submissions (set `closing = true`)
2. Wait for the queue to drain
3. Wait for all workers to exit
4. Stop the autoscaler (the context cancel does this)

Order matters. If you stop accepting new submissions *after* draining the queue, a late submission may sit forever. If you stop the autoscaler before draining, in-flight workers continue but cannot resize.

```go
func (p *Pool) Close() {
    p.mu.Lock()
    if p.closing {
        p.mu.Unlock()
        return
    }
    p.closing = true
    close(p.quit)  // tells autoscaler to stop
    p.mu.Unlock()
    // workers see quit closed or jobs drained, exit
    p.wg.Wait()
}
```

Some pools provide a deadline: "wait up to 30 s for drain, then exit." The Kubernetes graceful termination model assumes this.

```go
func (p *Pool) CloseWithTimeout(d time.Duration) error {
    p.Close()  // initiates close
    done := make(chan struct{})
    go func() { p.wg.Wait(); close(done) }()
    select {
    case <-done:
        return nil
    case <-time.After(d):
        return ErrCloseTimeout
    }
}
```

Production services almost always need a timeout. A worker stuck on a slow downstream should not block process exit forever.

---

## Where to Go Next

After this junior chapter, you are ready for:

- The middle level, which adds wait-time autoscaling, utilization signals, and richer cooldown logic.
- The senior level, which introduces AIMD, hysteresis tuning, and how to integrate dynamic pools with backpressure and circuit breakers.
- The professional level, which dives into ants/tunny/pond internals, distributed pool coordination, and capacity planning math.

Do the tasks file before the middle chapter. The mental model from running the code is what makes middle make sense.

---

## Extra: A Phased Rollout Plan

You don't deploy a dynamic pool by flipping a feature flag. You roll out in phases.

**Phase 1: Shadow mode.** Deploy the dynamic pool code but keep using the static pool. Have the autoscaler observe and log "I would have resized to N" without acting. Run for a few days. Verify the decisions look sensible.

**Phase 2: Canary.** Switch one server (or one tenant) to use the dynamic pool. Compare its metrics to the rest. p99 latency, error rate, pool size. Run for a week. Compare costs.

**Phase 3: Gradual rollout.** Switch 10% of traffic, then 25%, then 50%, then 100% over two weeks. Watch for any subtle regressions — sometimes the dynamic pool exposes a latent downstream bottleneck because it adapts faster than the static one.

**Phase 4: Tune.** With production data in hand, revisit the thresholds, cooldowns, floor, and ceiling. Most tuning happens in this phase.

**Phase 5: Standardise.** Once the pattern is solid, codify it into a library or service template. Other teams adopt it.

This is the same playbook as any production change. Dynamic scaling is no different from a new database driver or a new caching layer: shadow, canary, gradual, tune, standardise.

---

## Extra: A Mental Checklist Before Shipping

You have your dynamic pool. Before merging the PR, walk through this:

- [ ] Floor and ceiling are set, sensible values.
- [ ] Autoscaler has up cooldown >= 2 s and down cooldown >= 30 s.
- [ ] Hysteresis: up threshold and down threshold differ by 4× or more.
- [ ] Submit never blocks forever — has either a timeout or a `default` clause.
- [ ] Workers are wrapped in `defer recover`.
- [ ] Resize is mutex-guarded; counters are atomic.
- [ ] Metrics: pool size, queue depth, wait time, resize counter.
- [ ] Alert: pool size at ceiling for > 5 minutes.
- [ ] Alert: resize events > 30/min (oscillation detection).
- [ ] Close() drains gracefully with a timeout.
- [ ] Test for shutdown leaks with `goleak`.
- [ ] Load test: 10× normal load for 5 minutes.
- [ ] Tested with `-race` flag.

If you can tick all 13, the PR is ready.

---

## Extra: Why Resize is `O(1)` in Practice

A common worry: "if my pool can be at 1000 workers, isn't `Resize(2000)` expensive?"

Yes — but not enough to matter.

```go
for i := old; i < int32(target); i++ {
    atomic.AddInt32(&p.liveSize, 1)
    p.wg.Add(1)
    go p.worker()
}
```

`go p.worker()` is about 1 microsecond. Spawning 1000 workers takes about 1 millisecond. The lock is held for that millisecond, but Submits to a pool with a 1024 buffer rarely block on the lock.

If you find this is too slow for your use case (extremely rare), you can release the lock before spawning:

```go
func (p *Pool) Resize(target int) {
    p.mu.Lock()
    old := atomic.LoadInt32(&p.liveSize)
    atomic.StoreInt32(&p.targetSize, int32(target))
    toAdd := int32(target) - old
    if toAdd > 0 {
        atomic.AddInt32(&p.liveSize, toAdd)  // count before unlock
        p.wg.Add(int(toAdd))
    }
    p.mu.Unlock()
    for i := int32(0); i < toAdd; i++ {
        go p.worker()
    }
}
```

Now `go` happens outside the lock. The mutex is held for microseconds even at massive growth.

Shrinks are always free — no goroutines are spawned. The atomic store is one CPU instruction.

### The point

Dynamic-pool internals are cheap. The cost of *making the decision* (signal collection, decision rule, cooldown checks) dwarfs the cost of the resize itself. Optimise the autoscaler, not the resize.

---

## Extra: Race Conditions to Test For

When you write your own dynamic pool, write tests that drive these races:

1. **Concurrent `Resize` and `Submit`.** N goroutines submit while another resizes. All submissions must succeed (or fail cleanly), no panics.

2. **Concurrent `Resize` from two autoscalers.** Should not corrupt counters. (Hint: this is what your `sync.Mutex` on `Resize` is for.)

3. **`Resize` during `Close`.** Should be a safe no-op.

4. **`Close` during a long-running task.** All workers must eventually exit.

5. **Submit after `Close`.** Should return error, not panic.

6. **Worker panic during `Resize`.** Pool live count should remain consistent.

7. **`Resize(0)` and below floor.** Should clamp to floor, not zero out.

8. **`Resize(huge)` and above ceiling.** Should clamp to ceiling.

Each of these is a `t.Parallel()` test using `t.Helper()` patterns. Run with `-race`.

```go
func TestConcurrentResizeAndSubmit(t *testing.T) {
    p := NewPool(4, 4, 64)
    defer p.Close()
    var wg sync.WaitGroup
    for i := 0; i < 20; i++ {
        wg.Add(2)
        go func() {
            defer wg.Done()
            p.Resize(8 + i%16)
        }()
        go func() {
            defer wg.Done()
            for j := 0; j < 100; j++ {
                p.Submit(func() { time.Sleep(time.Millisecond) })
            }
        }()
    }
    wg.Wait()
}
```

Run with `go test -race -count=10`. If it passes ten times consecutively, your pool is mostly correct.

---

## A Reading List of Real Code

If you read just three open-source dynamic pools, read these:

1. **`panjf2000/ants`**: `pool.go`, `worker.go`. Best in class. ~1500 lines total. The opportunistic shrink in `revertWorker` is exemplary.

2. **`Jeffail/tunny`**: `tunny.go`. Smaller scope, clean. Shows the Worker interface idea — useful when each worker has expensive state.

3. **`go-redis/redis_rate`**: how rate-limit thresholds drive resize-like behaviour at the API level. Different problem, same ideas.

A few hours reading source code beats days reading textbooks. Each of these is well-commented and idiomatic Go. Take the time.

---

## Glossary of Numbers You Will See

Working with dynamic pools, you will encounter these magic numbers in real codebases. Here is what each typically means:

| Number | Common meaning |
|--------|----------------|
| 0.75 | Scale-up threshold for queue utilization |
| 0.10 | Scale-down threshold for queue utilization |
| 0.80 | High-water mark for CPU usage; back off |
| 0.20 | Low-water mark for CPU usage; can grow |
| 500 ms | Autoscaler tick interval |
| 2 s | Scale-up cooldown |
| 30 s | Scale-down cooldown |
| 2 × NumCPU | Conservative ceiling for CPU-bound work |
| 100 × NumCPU | Reasonable ceiling for I/O-bound work |
| 4 | Common floor (small but not zero) |
| 1024 | Default queue buffer size |
| 5 | Common max resize step size |
| 10 ms | Common signal-collection interval |

None are universal — they are starting points. Tune to your workload.

---

## Extra: One Common Beginner Question Answered Slowly

> "If a goroutine is so cheap, why do I need a pool at all? Why not spawn one goroutine per task?"

This is the right thing to ask. The short answer: cheap is not free. The long answer:

### Per-task overhead

A `go f()` call costs ~1 microsecond. A million of them costs 1 second of pure goroutine-creation time. Plus GC pressure from heap-allocated closures. Plus 2 KB stack per goroutine — 2 GB for a million.

For most services, you do not have a million simultaneous tasks. A few hundred or thousand at peak. At that scale, per-task spawning works.

### The real reason: downstream protection

You can spawn a million goroutines. Your *database* cannot accept a million simultaneous connections. Your *HTTP downstream* will start dropping at 1000 connections. Your *file system* will thrash with 1000 simultaneous opens.

A pool limits *outgoing concurrency*. It is the simplest backpressure mechanism. Even if Go is happy to give you a million workers, the system around you cannot keep up.

### The real reason: bounded resource usage

Without a pool, a misbehaving caller can submit unbounded work and OOM your service. With a pool — especially a bounded one with `Submit` returning errors when full — you have a hard ceiling.

### So when do you skip the pool?

- Truly short-lived tasks (~1 ms each), low rate, no downstream constraints. The overhead of pool management is more than spawning.
- A small fixed number of tasks where you control the count. (e.g., spawn a goroutine per HTTP request and rely on the HTTP server's own concurrency limit.)
- One-off batch jobs that you can let GC clean up.

In all other cases — production services, sustained traffic, downstream dependencies — use a pool. And once you use a pool, the question of *how big* leads naturally to dynamic scaling.

This is the "why" behind the entire topic. Without downstream protection, autoscaling is academic. With it, autoscaling is the difference between a service that adapts and one that breaks under load.

---

## Extra: How Dynamic Pools Interact with `defer`

A subtle correctness issue: workers spawn with their own `defer` stack. If you do:

```go
func (p *Pool) worker() {
    defer p.wg.Done()
    defer atomic.AddInt32(&p.liveSize, -1)
    for { /* ... */ }
}
```

The order matters. `defer` is LIFO: last-deferred runs first. The atomic decrement runs first (correct — bookkeeping cleanup), then `wg.Done` (correct — release the wait group last).

But if you write the defers in the wrong order:

```go
defer atomic.AddInt32(&p.liveSize, -1)
defer p.wg.Done()
```

Now `wg.Done` runs first. A `Close()` that was waiting may observe `wg.Wait` returning, then panic on `liveSize` going to -1 because it tried to spawn during teardown. Subtle.

Always: defers that decrement counters should run *before* defers that signal completion.

---

## Extra: Worker Idle Expiry vs Autoscaler Shrink

There are two distinct mechanisms by which a pool shrinks. They can coexist.

**Autoscaler shrink:** an external goroutine decides "too many workers" and calls `Resize(smaller)`. Workers exit on next idle.

**Per-worker idle expiry:** each worker has its own idle timer. If idle for longer than the timer, it exits. No external decision needed.

Why have both?

- The autoscaler reacts to *load*. It can decide to shrink even if workers are technically still busy (low utilization means they could be busy less and the pool would handle it).
- Idle expiry reacts to *worker boredom*. It triggers only when a worker has nothing to do. Cannot detect "we have ten workers but five would do" — only "this worker has been idle 30 seconds."

ants uses idle expiry as the *primary* shrink mechanism. The user-supplied `Tune(n)` is the override. This is a sensible design:

- Idle expiry handles the long tail (slow steady-state decline)
- `Tune` handles the abrupt drops (after a known burst ends)

Your hand-rolled pool can use either, both, or neither. For a junior-level pool, just autoscaler shrink is enough. For production, both is better.

---

## Extra: A Real-World Number

To anchor your intuition: at Cloudflare, the edge servers run worker pools sized between 16 and 1024 depending on load, with autoscalers ticking every 250 ms and resize cooldowns around 5 s up / 60 s down. Across millions of pool instances daily, the median resize event happens about every 90 seconds; the 95th percentile pool stays at the same size for hours.

What this tells you: in production, dynamic pools are *mostly static*. They are not constantly resizing. The dynamic part is the safety net for the few seconds per hour when load shifts. Most of the time, they sit at their happy size.

If your pool is resizing every tick, something is wrong with your thresholds or cooldowns.

---

## Final Words

This chapter has covered the basics: why dynamic scaling exists, how to spawn and exit workers safely, the simplest signals and thresholds, ants and friends, and the common failure modes. You should now be able to:

1. Build a dynamic pool from scratch in 100 lines.
2. Use ants `Tune(n)` for production.
3. Write a basic queue-depth autoscaler with hysteresis and cooldown.
4. Observe and reason about pool behaviour from metrics.
5. Avoid the most common bugs (no floor, no cooldown, fighting autoscalers).

The middle chapter takes wait-time signals, utilization metrics, idle timeouts, and cooldown design deeper. The senior chapter introduces AIMD, PID, hysteresis tuning, and integration with backpressure. The professional chapter goes into ants internals, distributed coordination, and capacity planning math.

Take the hands-on tasks file before reading middle. Building one pool from scratch and one with ants will solidify everything.

---

## Diagrams & Visual Aids

```
        submit
          |
          v
      +-------+
      | queue |  ← depth signal
      +-------+
       |  |  |
       v  v  v
      [w][w][w]   ← workers, scaled to target
       |  |  |
       v  v  v
        results
```

```
queue depth %
  100 _|.   .  .
   75 _|::::....:::....            ← scale-up threshold
   50 _|::::....:::::...
   10 _|...      .........         ← scale-down threshold
    0 _|________________________
        ^ burst   ^ steady   ^ idle
        +workers  hold       -workers
```

```
target size over time
    32 _|        ____
    16 _|   ____|    |____
     8 _|__|              |__
     0 _|_______________________
        09:00       09:10
        burst at    autoscaler   shrink back
        09:00       grows pool   after cooldown
```

```
oscillation (bad) vs hysteresis (good)
       no deadband, no cooldown:
       size: 8,16,8,16,8,16,8,16,8,16,8,16
       p99 latency spikes on every cycle

       with deadband (75/10) and cooldowns (2s/30s):
       size: 8 ... 8 ... 16 (stays) ... 16 ... 8 (after long calm)
       p99 latency steady
```

```
the autoscaler loop
  +-----------------+
  |  tick (500 ms)  |
  +--------+--------+
           |
           v
  +-----------------+
  | sample signal   |   queue depth, wait time, util, etc.
  +--------+--------+
           |
           v
  +-----------------+
  | decide          |   add? remove? hold?
  +--------+--------+
           |
           v
  +-----------------+
  | check cooldowns |   too soon since last? skip.
  +--------+--------+
           |
           v
  +-----------------+
  | Resize(target)  |   atomic store + maybe spawn
  +--------+--------+
           |
           v
       (back to tick)
```
