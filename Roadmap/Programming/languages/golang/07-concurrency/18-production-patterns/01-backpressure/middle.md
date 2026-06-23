---
layout: default
title: Middle
parent: Backpressure
grand_parent: Production Patterns
ancestor: Go
nav_order: 3
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/18-production-patterns/01-backpressure/middle/
---

# Backpressure — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [From Channels to Semaphores](#from-channels-to-semaphores)
5. [Weighted Semaphores](#weighted-semaphores)
6. [Worker Pools That Mean It](#worker-pools-that-mean-it)
7. [Pipeline Backpressure](#pipeline-backpressure)
8. [Propagating Context](#propagating-context)
9. [Load Shedding Strategies](#load-shedding-strategies)
10. [Watermarks and Hysteresis](#watermarks-and-hysteresis)
11. [Per-Tenant and Per-Class Queues](#per-tenant-and-per-class-queues)
12. [Observability Hooks](#observability-hooks)
13. [Code Examples](#code-examples)
14. [Coding Patterns](#coding-patterns)
15. [Clean Code](#clean-code)
16. [Product Use / Feature](#product-use-feature)
17. [Error Handling](#error-handling)
18. [Security Considerations](#security-considerations)
19. [Performance Tips](#performance-tips)
20. [Best Practices](#best-practices)
21. [Edge Cases & Pitfalls](#edge-cases-pitfalls)
22. [Common Mistakes](#common-mistakes)
23. [Common Misconceptions](#common-misconceptions)
24. [Tricky Points](#tricky-points)
25. [Test](#test)
26. [Tricky Questions](#tricky-questions)
27. [Cheat Sheet](#cheat-sheet)
28. [Self-Assessment Checklist](#self-assessment-checklist)
29. [Summary](#summary)
30. [What You Can Build](#what-you-can-build)
31. [Further Reading](#further-reading)
32. [Related Topics](#related-topics)
33. [Diagrams & Visual Aids](#diagrams-visual-aids)

---

## Introduction
> Focus: "Semaphores, pipeline backpressure, per-class queues, watermarks, and observability."

At the junior level, backpressure was a property of *one* channel. At the middle level, backpressure becomes a property of the *whole pipeline*: producer, queue, workers, downstream service, and shutdown — every link must participate. A single missing link defeats the rest.

This page covers:

- **Semaphores** as a generalisation of bounded channels — sometimes more natural than a queue.
- **Weighted semaphores** (`golang.org/x/sync/semaphore`) when items have different "cost."
- **Worker pools** with `Submit`, `TrySubmit`, `SubmitCtx`, drop counters, and graceful shutdown.
- **Pipeline backpressure** — slowing fan-in/fan-out stages without unbounded buffering.
- **Context propagation** so deadlines flow end-to-end.
- **Load shedding strategies** — drop newest, drop oldest, priority drop, sample drop.
- **Watermarks and hysteresis** — start and stop shedding at different thresholds.
- **Per-tenant queues** — preventing one noisy neighbour from starving the rest.
- **Observability** — metrics, traces, and logs that make backpressure visible.

You should already be comfortable with everything in `junior.md` — bounded channels, `select` with default, `context` with deadline, the bounded worker pool API. If those are still rough, go back.

---

## Prerequisites

- Comfortable with Go channels, `select`, and `context.Context`.
- Have written or read a worker pool in production.
- Familiar with `sync.WaitGroup`, `sync.Mutex`, and `atomic` counters.
- Aware of `runtime.NumCPU`, `runtime.NumGoroutine`, and have read a goroutine dump.
- Have used a metrics library (Prometheus, expvar, OpenTelemetry) in a real service.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Semaphore** | A counter that limits the number of concurrent holders. In Go, often modelled as `chan struct{}` with capacity N, or via `golang.org/x/sync/semaphore`. |
| **Weighted semaphore** | A semaphore where each "acquire" takes a configurable weight. Allows mixed cheap and expensive work to share a budget. |
| **Pipeline** | A series of goroutines connected by channels, each performing one stage of work. |
| **Fan-out** | One producer feeding many consumers. |
| **Fan-in** | Many producers feeding one consumer. |
| **Watermark** | A configured threshold on queue depth (or another metric) that triggers an action. "High watermark" and "low watermark" used together create hysteresis. |
| **Hysteresis** | Using different thresholds for entering and leaving a state to prevent thrashing. |
| **Load shedding** | Deliberately dropping work to keep the system responsive under overload. |
| **Drop newest / drop oldest** | The two main drop policies. "Newest" preserves work already accepted; "oldest" preserves freshness. |
| **Per-tenant queue** | A separate queue per customer (or other key), used so one tenant cannot starve the rest. |
| **Sampling drop** | Probabilistic drop based on a percentage, useful for telemetry workloads. |
| **In-flight gauge** | A metric showing the current number of items being processed (not queued). |
| **Queue-depth gauge** | A metric showing the current number of items waiting in queue. |
| **`golang.org/x/sync/errgroup`** | A small library for coordinating a group of goroutines with shared cancellation and error propagation. |
| **`golang.org/x/sync/semaphore`** | A weighted counting semaphore. |
| **Bulkhead** | The pattern of isolating resource pools so one failure does not propagate to the rest. |
| **Concurrency limit** | The maximum number of items the system processes concurrently. Distinct from rate limit. |

---

## From Channels to Semaphores

A bounded channel is a semaphore in disguise. Both limit concurrent work; the channel happens to carry data, the semaphore does not.

```go
// Channel-as-queue: data flows through it.
jobs := make(chan Job, 100)
// Channel-as-semaphore: only the count matters.
sem := make(chan struct{}, 100)
```

When you use a `chan struct{}` purely for counting, you have a semaphore. Acquire by sending; release by receiving:

```go
sem <- struct{}{} // acquire (blocks if full)
defer func() { <-sem }() // release
```

When to prefer a semaphore over a queue:

- The work is already in your goroutine — you do not need to hand it off, just to gate execution.
- Many goroutines need to share a single budget without serialising through one consumer.
- The work order is not strict FIFO; you want any free worker to start any item immediately.

When to prefer a queue:

- You want strict FIFO order.
- You want a fixed number of worker goroutines (rather than one goroutine per item).
- You need backpressure on the *enqueue* side, not on the work itself.

In practice, larger Go services use both: a queue for queued work, a semaphore for resource limits.

```go
// Pattern: queue + semaphore for resource limit.
jobs := make(chan Job, 1000)         // shock absorber
sem  := make(chan struct{}, 8)        // CPU budget

for j := range jobs {
    sem <- struct{}{}
    go func(j Job) {
        defer func() { <-sem }()
        j.Run()
    }(j)
}
```

The queue provides bounded buffering between producer and dispatcher; the semaphore caps concurrent CPU work. Both are bounded; the system has both temporal smoothing and instantaneous limits.

---

## Weighted Semaphores

When all work items are the same size, an unweighted semaphore suffices. When items vary — a 10 KB request and a 10 MB request both compete for memory — an unweighted semaphore is wrong: it would allow 8 large requests when you meant 1 large or 8 small.

The standard library does not have a weighted semaphore, but `golang.org/x/sync/semaphore` does:

```go
import "golang.org/x/sync/semaphore"

s := semaphore.NewWeighted(64) // 64 units of "weight"

func (h *Handler) HandleSmall(ctx context.Context) error {
    if err := s.Acquire(ctx, 1); err != nil { return err }
    defer s.Release(1)
    // ...
}

func (h *Handler) HandleLarge(ctx context.Context) error {
    if err := s.Acquire(ctx, 16); err != nil { return err }
    defer s.Release(16)
    // ...
}
```

64 small jobs can run concurrently. 4 large jobs can run concurrently. 1 large + 48 small can run concurrently. The single budget mixes work of different sizes naturally.

Weights model real resources: memory, CPU cores, expected duration, downstream API quota. Pick a unit and stick with it across the codebase.

`semaphore.Acquire` blocks until weight is available or the context expires. There is no `TryAcquire(ctx)`; for non-blocking, call `s.TryAcquire(n)` which returns immediately with `true`/`false`.

---

## Worker Pools That Mean It

A production worker pool needs more than three methods. Here is a fuller API.

```go
type Pool struct {
    jobs    chan Job
    sem     *semaphore.Weighted
    wg      sync.WaitGroup
    closed  atomic.Bool

    Stats Stats
}

type Stats struct {
    Submitted atomic.Uint64
    Completed atomic.Uint64
    Dropped   atomic.Uint64
    Rejected  atomic.Uint64
    Errored   atomic.Uint64
    InFlight  atomic.Int64
}

func NewPool(workers, buffer int, totalWeight int64) *Pool {
    p := &Pool{
        jobs: make(chan Job, buffer),
        sem:  semaphore.NewWeighted(totalWeight),
    }
    for i := 0; i < workers; i++ {
        p.wg.Add(1)
        go p.worker()
    }
    return p
}

func (p *Pool) worker() {
    defer p.wg.Done()
    for j := range p.jobs {
        p.Stats.InFlight.Add(1)
        if err := j.Run(); err != nil {
            p.Stats.Errored.Add(1)
        }
        p.Stats.Completed.Add(1)
        p.Stats.InFlight.Add(-1)
    }
}

func (p *Pool) Submit(j Job) {
    if p.closed.Load() {
        p.Stats.Rejected.Add(1)
        return
    }
    p.Stats.Submitted.Add(1)
    p.jobs <- j
}

func (p *Pool) TrySubmit(j Job) bool {
    if p.closed.Load() {
        return false
    }
    select {
    case p.jobs <- j:
        p.Stats.Submitted.Add(1)
        return true
    default:
        p.Stats.Dropped.Add(1)
        return false
    }
}

func (p *Pool) SubmitCtx(ctx context.Context, j Job) error {
    if p.closed.Load() {
        return errors.New("pool closed")
    }
    select {
    case p.jobs <- j:
        p.Stats.Submitted.Add(1)
        return nil
    case <-ctx.Done():
        p.Stats.Rejected.Add(1)
        return ctx.Err()
    }
}

func (p *Pool) Close(ctx context.Context) error {
    if !p.closed.CompareAndSwap(false, true) {
        return nil
    }
    close(p.jobs)
    done := make(chan struct{})
    go func() {
        p.wg.Wait()
        close(done)
    }()
    select {
    case <-done:
        return nil
    case <-ctx.Done():
        return ctx.Err()
    }
}
```

Notice the additions:

- `closed` flag prevents submits after `Close`.
- `Stats` exposes counters that map directly to Prometheus metrics.
- `Close(ctx)` has a deadline — operators can choose how long to wait for drain.

A pool with this API is a building block you can drop into any service.

---

## Pipeline Backpressure

A pipeline is a chain of goroutines joined by channels. Backpressure must flow from the last stage to the first.

```go
stage1Out := stage1(input)
stage2Out := stage2(stage1Out)
stage3Out := stage3(stage2Out)
// consumer reads stage3Out
```

If every stage uses a bounded channel for its output and a blocking write, backpressure is automatic: when stage 3 is slow, stage 2's output fills, stage 2 blocks, stage 1's output fills, stage 1 blocks, the source slows.

The trap is that *all* stages must be bounded. One unbounded slice or one `make(chan T, 1<<20)` in the middle defeats the chain.

```go
func stage1(in <-chan A) <-chan B {
    out := make(chan B, 4) // small buffer to absorb jitter
    go func() {
        defer close(out)
        for a := range in {
            out <- transform(a) // blocks when stage2's input is full
        }
    }()
    return out
}
```

A common idiom is to thread a `context.Context` through every stage so the whole pipeline can be cancelled:

```go
func stage1(ctx context.Context, in <-chan A) <-chan B {
    out := make(chan B, 4)
    go func() {
        defer close(out)
        for a := range in {
            select {
            case out <- transform(a):
            case <-ctx.Done():
                return
            }
        }
    }()
    return out
}
```

Without the `ctx.Done()` case, a stuck downstream means a stuck pipeline means a leaked goroutine.

### Fan-out with bounded fan-in

A common pattern is fan-out (one input → N workers) then fan-in (N outputs → one consumer). The fan-in channel is the bottleneck if not bounded.

```go
func fanOutIn(ctx context.Context, in <-chan A, workers int) <-chan B {
    out := make(chan B, workers) // bounded by worker count
    var wg sync.WaitGroup
    for i := 0; i < workers; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for a := range in {
                b := transform(a)
                select {
                case out <- b:
                case <-ctx.Done():
                    return
                }
            }
        }()
    }
    go func() { wg.Wait(); close(out) }()
    return out
}
```

The output channel is bounded, the input channel is presumably bounded by the upstream, and every send respects context. This pipeline cannot leak goroutines and cannot grow memory.

---

## Propagating Context

Every queue operation that can wait should accept a context. Every worker that does meaningful work should check `ctx.Err()` on long operations. This is the discipline that makes shutdowns clean and deadlines real.

```go
func (w *Worker) Do(ctx context.Context, j Job) error {
    for _, step := range j.Steps {
        if err := ctx.Err(); err != nil {
            return err
        }
        if err := step.Run(ctx); err != nil {
            return err
        }
    }
    return nil
}
```

Inside the step:

```go
func (s *Step) Run(ctx context.Context) error {
    ctx, cancel := context.WithTimeout(ctx, s.Budget)
    defer cancel()
    return s.client.Do(ctx, s.Request)
}
```

A request's context is the leash on every operation it triggers. When the leash expires, work in flight cancels itself; no orphaned goroutines, no zombie queue entries.

For long-lived workers (those that loop forever), the context should be the *worker's* context, not any particular request's context. Each request's `ctx` is derived from the worker's `ctx` for the duration of that request.

```go
func (w *Worker) Run(workerCtx context.Context) {
    for {
        select {
        case j, ok := <-w.jobs:
            if !ok { return }
            reqCtx, cancel := context.WithTimeout(workerCtx, j.Budget)
            w.handle(reqCtx, j)
            cancel()
        case <-workerCtx.Done():
            return
        }
    }
}
```

---

## Load Shedding Strategies

When you must drop, you can drop:

- **Newest.** Reject the next item. Simplest. Default.
- **Oldest.** Drop the oldest queued item, accept the new one. Useful when freshness matters (live data, telemetry).
- **By priority.** Drop low-priority items first.
- **By tenant.** Drop the noisiest tenant's items first.
- **By size.** Drop items whose weight (CPU, memory) is largest.
- **Sampled.** Drop a configurable percentage uniformly at random.

Each policy has a code shape.

### Drop newest

```go
select {
case ch <- j:
default:
    drops.Inc()
}
```

### Drop oldest

```go
for {
    select {
    case ch <- j:
        return
    default:
        select {
        case <-ch:
        default:
        }
    }
}
```

This pops one old item and tries again. Be careful — under heavy contention, this can spin. A safer version uses a buffer of size 1 and overwrites:

```go
select {
case ch <- j:
default:
    <-ch
    ch <- j
}
```

### By priority

```go
type Item struct {
    Priority int
    Payload  any
}

// Use a heap, not a channel, when priority matters strictly.
```

Channels do not have priority. For priority queues, use `container/heap` behind a mutex; or two channels (high, low) read in a `select` that always tries high first via nested non-blocking selects.

### Sampled drop

```go
if rand.Float64() < 0.1 {
    drops.Inc()
    return // drop 10%
}
ch <- j
```

Useful for telemetry: keep approximately 90% of the data, never block, never grow.

---

## Watermarks and Hysteresis

A single threshold ("shed when len(ch) > 80") can cause thrashing if the queue oscillates near the threshold. Two thresholds — high (start shedding) and low (stop shedding) — produce stable behaviour.

```go
type Shedder struct {
    jobs       chan Job
    high, low  int
    shedding   atomic.Bool
}

func (s *Shedder) Submit(j Job) bool {
    n := len(s.jobs)
    if s.shedding.Load() {
        if n <= s.low {
            s.shedding.Store(false)
        }
    } else {
        if n >= s.high {
            s.shedding.Store(true)
        }
    }
    if s.shedding.Load() {
        return false
    }
    select {
    case s.jobs <- j:
        return true
    default:
        return false
    }
}
```

Pick `high` somewhere like 80% and `low` like 40% of capacity. The gap absorbs noise. Without hysteresis, every fluctuation around the threshold flips the state, producing alarm noise and uneven throughput.

---

## Per-Tenant and Per-Class Queues

A single queue is vulnerable to one noisy neighbour. If Tenant A submits 10× the load of others, they fill the queue and starve everyone. Per-tenant queues fix this.

```go
type Multiplexer struct {
    queues map[string]chan Job
    mu     sync.Mutex
}

func (m *Multiplexer) Submit(tenant string, j Job) bool {
    m.mu.Lock()
    q, ok := m.queues[tenant]
    if !ok {
        q = make(chan Job, 32)
        m.queues[tenant] = q
        go consumer(q)
    }
    m.mu.Unlock()
    select {
    case q <- j:
        return true
    default:
        return false // tenant-local shedding
    }
}
```

Now each tenant has their own bounded queue. A spike from one tenant fills only that tenant's queue. The drop is *local*; other tenants continue normally.

The cost: more goroutines and more state. For 10,000 tenants you would not give each one a goroutine — you would use a single worker pool that *picks* from per-tenant queues (a scheduler). Even then, per-tenant *queues* are the right model; the workers are shared.

### Round-robin fairness

When workers must serve many tenant queues, round-robin scheduling ensures no tenant is starved:

```go
func dispatcher(tenants []chan Job, work chan<- Job) {
    i := 0
    for {
        q := tenants[i%len(tenants)]
        i++
        select {
        case j := <-q:
            work <- j
        default:
            // skip this tenant; they have no work right now
        }
    }
}
```

A more sophisticated version uses *weighted* round-robin where each tenant has a priority or quota.

---

## Observability Hooks

A backpressure-aware service exposes (at minimum) these signals:

| Metric | Type | What it answers |
|---|---|---|
| `submit_total{result="accepted|rejected|dropped"}` | counter | How often does each outcome occur? |
| `queue_depth` | gauge | How full is the queue right now? |
| `queue_capacity` | gauge | What is the max? |
| `in_flight` | gauge | How many items are being processed? |
| `submit_wait_seconds` | histogram | How long do producers wait? |
| `job_duration_seconds` | histogram | How long does processing take? |
| `shedding_active` | gauge (0/1) | Is the system shedding right now? |

```go
func (p *Pool) instrumentSubmit(ctx context.Context, j Job) error {
    start := time.Now()
    err := p.SubmitCtx(ctx, j)
    submitWait.Observe(time.Since(start).Seconds())
    queueDepth.Set(float64(len(p.jobs)))
    inFlight.Set(float64(p.Stats.InFlight.Load()))
    switch {
    case err == nil:
        submitTotal.WithLabelValues("accepted").Inc()
    case errors.Is(err, context.DeadlineExceeded):
        submitTotal.WithLabelValues("rejected").Inc()
    default:
        submitTotal.WithLabelValues("errored").Inc()
    }
    return err
}
```

A dashboard combining these tells the whole backpressure story: queue depth climbs, wait time grows, rejections begin, in-flight stays flat (workers are saturated), shedding goes 0→1. At a glance, the operator knows the system is shedding load and can act.

### Tracing

For distributed tracing, every `SubmitCtx` call should produce a span. Tag the span with `accepted` / `rejected` outcome and the wait duration. When a request is rejected, the trace shows exactly where.

```go
ctx, span := tracer.Start(ctx, "pool.SubmitCtx")
defer span.End()
err := p.SubmitCtx(ctx, j)
if err != nil { span.SetStatus(codes.Error, err.Error()) }
```

---

## Code Examples

### Example 1 — A semaphore-based admission controller

```go
package admit

import (
    "context"
    "sync/atomic"

    "golang.org/x/sync/semaphore"
)

type Controller struct {
    sem      *semaphore.Weighted
    accepted atomic.Uint64
    rejected atomic.Uint64
    inFlight atomic.Int64
}

func New(total int64) *Controller {
    return &Controller{sem: semaphore.NewWeighted(total)}
}

func (c *Controller) Acquire(ctx context.Context, n int64) (release func(), err error) {
    if err := c.sem.Acquire(ctx, n); err != nil {
        c.rejected.Add(1)
        return func() {}, err
    }
    c.accepted.Add(1)
    c.inFlight.Add(n)
    return func() {
        c.sem.Release(n)
        c.inFlight.Add(-n)
    }, nil
}

func (c *Controller) Stats() (accepted, rejected uint64, inFlight int64) {
    return c.accepted.Load(), c.rejected.Load(), c.inFlight.Load()
}
```

Drop this into an HTTP handler:

```go
func handler(w http.ResponseWriter, r *http.Request) {
    ctx, cancel := context.WithTimeout(r.Context(), 100*time.Millisecond)
    defer cancel()
    release, err := admit.Acquire(ctx, 1)
    if err != nil {
        http.Error(w, "busy", 503)
        return
    }
    defer release()
    // ...
}
```

### Example 2 — Drop-oldest channel

```go
type LatestN struct {
    ch chan Event
}

func NewLatestN(n int) *LatestN { return &LatestN{ch: make(chan Event, n)} }

func (l *LatestN) Push(e Event) {
    for {
        select {
        case l.ch <- e:
            return
        default:
            select {
            case <-l.ch: // drop oldest
            default:
            }
        }
    }
}

func (l *LatestN) Drain() <-chan Event { return l.ch }
```

Useful for "most recent N" telemetry buffers.

### Example 3 — Pipeline with end-to-end backpressure

```go
func source(ctx context.Context) <-chan int {
    out := make(chan int, 4)
    go func() {
        defer close(out)
        for i := 0; ; i++ {
            select {
            case out <- i:
            case <-ctx.Done():
                return
            }
        }
    }()
    return out
}

func square(ctx context.Context, in <-chan int) <-chan int {
    out := make(chan int, 4)
    go func() {
        defer close(out)
        for x := range in {
            select {
            case out <- x * x:
            case <-ctx.Done():
                return
            }
        }
    }()
    return out
}

func sink(ctx context.Context, in <-chan int) {
    for x := range in {
        time.Sleep(10 * time.Millisecond) // slow consumer
        _ = x
    }
}

func main() {
    ctx, cancel := context.WithTimeout(context.Background(), time.Second)
    defer cancel()
    sink(ctx, square(ctx, source(ctx)))
}
```

The sink is slow. The square stage's output fills. Square blocks on its output channel. Source's output fills. Source blocks. Memory stays bounded; producers slow to match consumer; everything cancels cleanly when context fires.

### Example 4 — Per-tenant queues with shared workers

```go
type TenantPool struct {
    mu      sync.Mutex
    queues  map[string]chan Job
    workCh  chan tenantJob
    workers int
}

type tenantJob struct {
    tenant string
    j      Job
}

func NewTenantPool(workers int) *TenantPool {
    p := &TenantPool{
        queues:  make(map[string]chan Job),
        workCh:  make(chan tenantJob, workers*2),
        workers: workers,
    }
    for i := 0; i < workers; i++ {
        go func() {
            for tj := range p.workCh {
                tj.j.Run()
            }
        }()
    }
    return p
}

func (p *TenantPool) Submit(tenant string, j Job) bool {
    p.mu.Lock()
    q, ok := p.queues[tenant]
    if !ok {
        q = make(chan Job, 16)
        p.queues[tenant] = q
        go p.drain(tenant, q)
    }
    p.mu.Unlock()
    select {
    case q <- j:
        return true
    default:
        return false
    }
}

func (p *TenantPool) drain(tenant string, q chan Job) {
    for j := range q {
        p.workCh <- tenantJob{tenant, j}
    }
}
```

Each tenant has a private queue (sized 16); a small per-tenant goroutine drains into a shared work channel. Shedding happens at the per-tenant queue, not at the shared pool. Noisy tenants cannot starve quiet ones.

---

## Coding Patterns

### Pattern 1 — The dual-budget pool

Separate budgets for I/O wait and CPU work:

```go
type DualPool struct {
    io  *semaphore.Weighted
    cpu *semaphore.Weighted
}

func (p *DualPool) Handle(ctx context.Context, r *http.Request) error {
    if err := p.io.Acquire(ctx, 1); err != nil { return err }
    defer p.io.Release(1)
    data, err := io.ReadAll(r.Body)
    if err != nil { return err }

    if err := p.cpu.Acquire(ctx, 1); err != nil { return err }
    defer p.cpu.Release(1)
    return process(data)
}
```

### Pattern 2 — Concurrency limit via a "permit token" type

```go
type Permit struct{ release func() }

func (p Permit) Release() { p.release() }

func (a *Admit) Acquire(ctx context.Context) (Permit, error) {
    if err := a.sem.Acquire(ctx, 1); err != nil { return Permit{}, err }
    return Permit{release: func() { a.sem.Release(1) }}, nil
}
```

A typed permit prevents the common bug of forgetting to release. The compiler at least reminds you that `Permit` is a value to be held.

### Pattern 3 — Submit with retry

```go
func SubmitWithRetry(ctx context.Context, p *Pool, j Job, retries int) error {
    for i := 0; i < retries; i++ {
        if err := p.SubmitCtx(ctx, j); err == nil {
            return nil
        }
        select {
        case <-time.After(backoff(i)):
        case <-ctx.Done():
            return ctx.Err()
        }
    }
    return errors.New("submit retries exhausted")
}
```

When the caller can wait, retrying with backoff smooths over brief overloads. When the caller cannot wait, do not retry — return immediately.

### Pattern 4 — Submit with a fallback

```go
func SubmitOrFallback(p *Pool, primary, fallback Job) {
    if !p.TrySubmit(primary) {
        // skip the expensive primary; run the cheap fallback inline
        fallback.Run()
    }
}
```

When primary work is too expensive to queue, fall back to cheap work. Common for caches: "if the heavy refresh queue is full, just serve the stale cache."

---

## Clean Code

- A function that submits work should be named to reflect the policy: `Submit`, `TrySubmit`, `SubmitCtx`, `SubmitOrDrop`, `SubmitOrFallback`. Not just one `Submit` that hides the behaviour.
- Each backpressure-related constant (`workers`, `bufferSize`, `submitTimeout`) should be configurable. Hard-coded constants make tuning a code change.
- The pool struct should not hold a `context.Context` field. Contexts are passed in, not stored.
- The pool's `Close` method should accept a context for shutdown timeout, not block forever.
- Document the policy at the type doc, not just inline: "`Pool drops jobs when the buffer is full; use SubmitCtx for caller-driven timeouts.`"

---

## Product Use / Feature

A backpressure-aware service is a *better product*. Some examples:

- A search endpoint that returns "partial results in 200 ms" instead of "full results in 5 seconds" wins customer satisfaction.
- A bulk-import API that returns `202 Accepted` with a job ID, then processes the work async with a bounded queue, scales gracefully.
- A real-time chat that drops the slowest 1% of recipients keeps the median experience excellent. One slow client cannot pause everyone.
- An admin batch job that pauses when the production DB is busy is a *better* batch job — it does not need scheduling tricks; it self-throttles.

Customers cannot articulate "your service has backpressure," but they notice when it does not: timeouts, errors, slowness, lost data. Backpressure design is therefore a UX investment.

---

## Error Handling

- Distinguish error types: `ErrBusy` (overload), `ErrTimeout` (deadline), `ErrClosed` (shutdown). Callers may handle each differently.
- For HTTP, map errors to status codes deliberately: `ErrBusy → 503`, `ErrTimeout → 504`, `ErrClosed → 503` with a friendly message.
- Include a `Retry-After` header on 503 when the system has a known recovery time. Otherwise, omit it and let clients use their own backoff.
- Log overload events at *info* level, not error. They are not bugs; they are the system doing its job. Errors should be reserved for unexpected failures.
- A drop-counter increment is *not* an error to be returned. It is telemetry.

```go
const (
    StatusErrBusy = "busy"
    StatusErrShutdown = "shutdown"
)

type SubmitError struct {
    Status string
    Wait   time.Duration
}

func (e *SubmitError) Error() string { return e.Status }
```

---

## Security Considerations

- Per-IP or per-API-key rate limits should be applied *before* the worker pool's admission control. Otherwise, a single attacker can occupy all slots.
- Be aware that admission control with a long submit timeout (`SubmitCtx` with 5-second context) is itself a DoS vector — attackers can pin slots by being slow.
- For sensitive workloads (audit logging, fraud detection), prefer "block then alert" over "drop." Dropped audit records are an incident.
- Use `context.WithDeadline` rather than `context.WithTimeout` at outer layers, so the absolute time budget is preserved across hops.

---

## Performance Tips

- A `chan struct{}` semaphore is the fastest in pure throughput. `golang.org/x/sync/semaphore` is slightly slower but supports weights.
- Avoid `select` with more than 4–5 cases in hot paths; the runtime cost grows.
- For very high-frequency submit paths (millions per second), consider sharding: N independent pools, hashed by some key.
- Profile producer wait time with a histogram. The shape of the distribution tells you whether the system is saturated (heavy tail) or just jittery (narrow distribution).
- `len(ch)` and `cap(ch)` are O(1); read them freely in metrics paths.

---

## Best Practices

- Every public submit method returns a clear signal: bool, error, or both. Never silently swallow.
- Every backpressure mechanism is observable: counters, gauges, histograms.
- Test the overload path: a load test that drives the pool past capacity and verifies the right error/drop behaviour.
- Test the shutdown path: an integration test that submits work, calls `Close`, and verifies all work completes.
- Tune parameters one at a time: change buffer size, run a load test, change worker count, run a load test.
- Keep backpressure-related parameters in a config struct with sensible defaults, not as scattered constants.

---

## Edge Cases & Pitfalls

- **A closed pool that still has `TrySubmit` callers.** Decide explicitly: do they get `false` (drop) or an error?
- **A worker that holds a lock across `<-jobs`.** Deadlocks if other code wants the lock to push.
- **A `select` with both submit and `ctx.Done()` where both are ready.** Random choice; the submit may succeed even though the context is done. Always re-check.
- **A queue whose items have side-effects on submit.** If `j := newJob(...)` allocates resources, dropping `j` leaks those resources unless cleanup is explicit.

---

## Common Mistakes

1. Forgetting to release the semaphore on every code path. Use `defer s.Release(n)` immediately after `Acquire`.
2. Using one semaphore for both I/O and CPU concurrency. Either limit dominates; use two.
3. Reading `len(ch)` and acting on it without realising the value is stale immediately.
4. Sizing the queue too large because "small queues fill up too often." That is the *point* — they tell you about overload.
5. Returning the same error string for drop and reject. Operators cannot distinguish.

---

## Common Misconceptions

- "Backpressure is just rate limiting." False. Rate limiting caps arrivals; backpressure caps work in flight. Both can be in the same system.
- "Per-tenant queues are too expensive." For small tenant counts (< 1000), they are cheap. For larger counts, share workers across tenant queues.
- "We don't need a `Close` because we restart on deploy." Then your in-flight work is lost. Drain costs you nothing if there is no work, and saves you a lot if there is.

---

## Tricky Points

- `semaphore.Acquire(ctx, n)` blocks on the full weight; you cannot partial-acquire. If you need partial, build it yourself.
- An infinite goroutine in a pool worker means `wg.Wait()` will never return. Always have a way out.
- Pool stats counters can be read inconsistently across multiple counters (no atomic snapshot). For dashboards, that is fine. For correctness, lock or accept the inconsistency.

---

## Test

```go
func TestPoolDrainsOnClose(t *testing.T) {
    p := NewPool(2, 4, 8)
    var done int32
    for i := 0; i < 10; i++ {
        p.SubmitCtx(context.Background(), JobFunc(func() error {
            time.Sleep(20 * time.Millisecond)
            atomic.AddInt32(&done, 1)
            return nil
        }))
    }
    ctx, cancel := context.WithTimeout(context.Background(), time.Second)
    defer cancel()
    if err := p.Close(ctx); err != nil {
        t.Fatal(err)
    }
    if atomic.LoadInt32(&done) != 10 {
        t.Fatalf("expected 10 jobs, got %d", done)
    }
}
```

---

## Tricky Questions

1. What is the difference between a semaphore and a buffered channel? *Channels carry data; semaphores carry permission.*
2. When is a weighted semaphore preferable to an unweighted one? *When items differ in cost.*
3. How does drop-oldest avoid spinning? *Use overwrite-on-full; do not loop indefinitely.*
4. Why do you want hysteresis on a shedding threshold? *To prevent thrashing when the queue oscillates.*
5. Why should every worker check `ctx.Done()`? *Otherwise the pool cannot be shut down promptly.*
6. What is the relationship between `len(ch)` and `cap(ch)` in metrics? *The ratio reveals fill; the trend reveals drift.*
7. Why prefer per-tenant queues? *Bulkheading — one tenant cannot starve the rest.*
8. What happens if you call `sem.Release(n)` more times than `Acquire`? *Panic — release of unowned weight.*

---

## Cheat Sheet

| Need | Pattern |
|---|---|
| Bounded queue | `make(chan T, N)` |
| Concurrency limit | `chan struct{}` semaphore |
| Variable-cost concurrency | `semaphore.NewWeighted(total)` |
| Pipeline backpressure | bounded outputs at every stage |
| Drop newest | `select default` |
| Drop oldest | overwrite-on-full |
| Per-tenant fairness | per-tenant queue + shared workers |
| Hysteresis | high and low watermarks |
| Graceful shutdown | `Close(ctx)` that drains |

---

## Self-Assessment Checklist

- [ ] I can choose between a queue and a semaphore for a given problem.
- [ ] I use weighted semaphores when item costs vary.
- [ ] I size buffers per channel and document why.
- [ ] I propagate `context.Context` through every blocking operation.
- [ ] I have written a worker pool with full submit/close/stats API.
- [ ] I expose at least three backpressure metrics in any service I write.
- [ ] I test the overload path, not just the happy path.
- [ ] I implement hysteresis when I have a shedding threshold.

---

## Summary

At the middle level, backpressure is no longer "put a buffer on a channel." It is a system property: every stage bounded, every blocking operation context-aware, every drop counted, every threshold hysteretic, every queue per-class where neighbours can starve each other. The worker pool with `Submit`, `TrySubmit`, `SubmitCtx`, stats, and graceful close is the building block; semaphores (plain and weighted) are the generalisation; pipelines are the chain. Observability — metrics, traces, logs — is what makes the system honest under load.

## What You Can Build

- A production-grade worker pool library with full submit/close/stats API.
- An admission controller for HTTP handlers with weighted semaphores.
- A multi-tenant job system with per-tenant queues and shared workers.
- A pipeline of decoded → transformed → encoded data with bounded buffers and context-aware sends.
- A telemetry shipper with drop-oldest semantics and a drop-rate metric.

## Further Reading

- `golang.org/x/sync/semaphore` source code — short and instructive.
- `golang.org/x/sync/errgroup` documentation.
- Concurrency in Go (Cox) — book.
- Cloudflare engineering blog on bounded concurrency and admission control.
- Google SRE book — chapter on overload.

## Related Topics

- Dynamic worker scaling
- Batching
- Graceful shutdown / drain
- Rate limiting (token bucket, leaky bucket)
- Circuit breakers
- Bulkhead pattern

## Diagrams & Visual Aids

```
Per-tenant queues feeding a shared worker pool:

  Tenant A ──► [Q_A: ████░░] ──┐
  Tenant B ──► [Q_B: ██░░░░] ──┼──► [shared work channel] ──► workers
  Tenant C ──► [Q_C: ░░░░░░] ──┘

Noisy A fills Q_A; B and C unaffected.
```

```
Hysteresis: shedding state vs queue depth

  shedding ─────┐                  ┌─────
              ON│                  │ON
                │                  │
  shedding ─────┴──────────────────┴───── time
              OFF                  OFF

         queue:  0───low───high────cap
         depth:           ▲      ▲
                          │      │
                       stop      start
                       shed      shed
```

```
Pipeline backpressure:

   source ──► [4] ──► square ──► [4] ──► encode ──► [4] ──► sink (slow)

   slow sink → encode blocks → its buffer fills → square blocks → ...
   ... → source blocks. Memory bounded; rate limited by sink.
```

---

## Deep Dive: Implementing a Production Worker Pool

Below is the full reference implementation a middle-level engineer should be able to produce. It supports:

- Three submit modes.
- Weighted concurrency.
- Per-job timeout.
- Graceful shutdown.
- Stats with atomic counters.
- A "drain wait" semantic when closing.
- A `WithObserver` hook for metrics.

```go
package pool

import (
    "context"
    "errors"
    "sync"
    "sync/atomic"
    "time"

    "golang.org/x/sync/semaphore"
)

var (
    ErrPoolClosed = errors.New("pool: closed")
    ErrBusy       = errors.New("pool: busy")
)

type Job interface {
    Weight() int64
    Run(ctx context.Context) error
}

type Stats struct {
    Submitted atomic.Uint64
    Completed atomic.Uint64
    Failed    atomic.Uint64
    Dropped   atomic.Uint64
    Rejected  atomic.Uint64
    Latency   atomic.Uint64 // nanoseconds, last finished
    InFlight  atomic.Int64
}

type Observer interface {
    OnSubmit(j Job)
    OnDrop(j Job)
    OnReject(j Job)
    OnStart(j Job)
    OnFinish(j Job, err error, took time.Duration)
}

type noopObserver struct{}

func (noopObserver) OnSubmit(Job)                           {}
func (noopObserver) OnDrop(Job)                             {}
func (noopObserver) OnReject(Job)                           {}
func (noopObserver) OnStart(Job)                            {}
func (noopObserver) OnFinish(Job, error, time.Duration)     {}

type Pool struct {
    queue   chan Job
    sem     *semaphore.Weighted
    closed  atomic.Bool
    wg      sync.WaitGroup
    cancel  context.CancelFunc
    obs     Observer
    Stats   Stats
}

type Config struct {
    QueueSize   int
    Workers     int
    TotalWeight int64
    JobTimeout  time.Duration
    Observer    Observer
}

func New(cfg Config) *Pool {
    ctx, cancel := context.WithCancel(context.Background())
    obs := cfg.Observer
    if obs == nil {
        obs = noopObserver{}
    }
    p := &Pool{
        queue:  make(chan Job, cfg.QueueSize),
        sem:    semaphore.NewWeighted(cfg.TotalWeight),
        cancel: cancel,
        obs:    obs,
    }
    for i := 0; i < cfg.Workers; i++ {
        p.wg.Add(1)
        go p.worker(ctx, cfg.JobTimeout)
    }
    return p
}

func (p *Pool) worker(workerCtx context.Context, timeout time.Duration) {
    defer p.wg.Done()
    for {
        select {
        case j, ok := <-p.queue:
            if !ok {
                return
            }
            if err := p.sem.Acquire(workerCtx, j.Weight()); err != nil {
                continue
            }
            p.run(workerCtx, j, timeout)
            p.sem.Release(j.Weight())
        case <-workerCtx.Done():
            return
        }
    }
}

func (p *Pool) run(parent context.Context, j Job, timeout time.Duration) {
    ctx := parent
    var cancel context.CancelFunc
    if timeout > 0 {
        ctx, cancel = context.WithTimeout(parent, timeout)
        defer cancel()
    }
    p.obs.OnStart(j)
    p.Stats.InFlight.Add(j.Weight())
    start := time.Now()
    err := j.Run(ctx)
    took := time.Since(start)
    p.Stats.InFlight.Add(-j.Weight())
    p.Stats.Latency.Store(uint64(took))
    if err != nil {
        p.Stats.Failed.Add(1)
    } else {
        p.Stats.Completed.Add(1)
    }
    p.obs.OnFinish(j, err, took)
}

func (p *Pool) Submit(j Job) error {
    if p.closed.Load() {
        return ErrPoolClosed
    }
    p.queue <- j
    p.Stats.Submitted.Add(1)
    p.obs.OnSubmit(j)
    return nil
}

func (p *Pool) TrySubmit(j Job) error {
    if p.closed.Load() {
        return ErrPoolClosed
    }
    select {
    case p.queue <- j:
        p.Stats.Submitted.Add(1)
        p.obs.OnSubmit(j)
        return nil
    default:
        p.Stats.Dropped.Add(1)
        p.obs.OnDrop(j)
        return ErrBusy
    }
}

func (p *Pool) SubmitCtx(ctx context.Context, j Job) error {
    if p.closed.Load() {
        return ErrPoolClosed
    }
    select {
    case p.queue <- j:
        p.Stats.Submitted.Add(1)
        p.obs.OnSubmit(j)
        return nil
    case <-ctx.Done():
        p.Stats.Rejected.Add(1)
        p.obs.OnReject(j)
        return ctx.Err()
    }
}

func (p *Pool) Close(ctx context.Context) error {
    if !p.closed.CompareAndSwap(false, true) {
        return nil
    }
    close(p.queue)
    done := make(chan struct{})
    go func() {
        p.wg.Wait()
        close(done)
    }()
    select {
    case <-done:
        return nil
    case <-ctx.Done():
        p.cancel() // cancel workers to abort
        <-done
        return ctx.Err()
    }
}
```

Every detail of this implementation is deliberate:

- The `queue` is bounded by `QueueSize`, so producers feel backpressure.
- The `sem` is the *concurrency* budget — independent of queue size.
- `Close(ctx)` drains and then cancels if the context expires.
- The `Observer` interface lets callers wire in Prometheus, OpenTelemetry, or custom logging without modifying the pool.
- Stats are atomics, readable concurrently from a metrics endpoint.

A team can build many domain-specific pools on top of this single implementation.

---

## Deep Dive: Wiring the Pool into a Real HTTP Server

```go
package main

import (
    "context"
    "encoding/json"
    "errors"
    "log"
    "net/http"
    "os"
    "os/signal"
    "syscall"
    "time"

    "example.com/pool"
)

type EmailJob struct {
    To, Body string
}

func (j *EmailJob) Weight() int64 { return 1 }
func (j *EmailJob) Run(ctx context.Context) error {
    select {
    case <-time.After(50 * time.Millisecond):
        return nil
    case <-ctx.Done():
        return ctx.Err()
    }
}

func main() {
    p := pool.New(pool.Config{
        QueueSize:   100,
        Workers:     8,
        TotalWeight: 8,
        JobTimeout:  200 * time.Millisecond,
    })

    http.HandleFunc("/send", func(w http.ResponseWriter, r *http.Request) {
        var j EmailJob
        if err := json.NewDecoder(r.Body).Decode(&j); err != nil {
            http.Error(w, err.Error(), 400)
            return
        }
        ctx, cancel := context.WithTimeout(r.Context(), 100*time.Millisecond)
        defer cancel()
        switch err := p.SubmitCtx(ctx, &j); {
        case err == nil:
            w.WriteHeader(http.StatusAccepted)
        case errors.Is(err, context.DeadlineExceeded):
            http.Error(w, "busy", http.StatusServiceUnavailable)
        default:
            http.Error(w, err.Error(), 500)
        }
    })

    http.HandleFunc("/stats", func(w http.ResponseWriter, r *http.Request) {
        json.NewEncoder(w).Encode(map[string]uint64{
            "submitted": p.Stats.Submitted.Load(),
            "completed": p.Stats.Completed.Load(),
            "failed":    p.Stats.Failed.Load(),
            "dropped":   p.Stats.Dropped.Load(),
            "rejected":  p.Stats.Rejected.Load(),
        })
    })

    srv := &http.Server{Addr: ":8080"}
    go func() { _ = srv.ListenAndServe() }()

    sig := make(chan os.Signal, 1)
    signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)
    <-sig

    ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
    defer cancel()
    _ = srv.Shutdown(ctx)
    if err := p.Close(ctx); err != nil {
        log.Println("pool close:", err)
    }
}
```

This is a complete service. Hit it with a load test (`wrk -t8 -c200 -d30s -s post.lua http://localhost:8080/send`) and observe `/stats`. Under sustained load you will see `submitted` plateau, `dropped` and `rejected` climb, `completed` track `submitted` minus loss.

This is what a backpressure-aware service looks like in production.

---

## Deep Dive: Pipeline of Three Stages

A common shape is a three-stage pipeline: ingest, transform, write. Let us build one with end-to-end backpressure.

```go
package pipeline

import (
    "context"
    "sync"
)

type Pipeline struct {
    Source    func(context.Context) <-chan []byte
    Transform func(context.Context, []byte) ([]byte, error)
    Write     func(context.Context, []byte) error

    Workers int
    Buffer  int
}

func (p *Pipeline) Run(ctx context.Context) error {
    raw := p.Source(ctx)

    transformed := make(chan []byte, p.Buffer)
    var twg sync.WaitGroup
    for i := 0; i < p.Workers; i++ {
        twg.Add(1)
        go func() {
            defer twg.Done()
            for chunk := range raw {
                out, err := p.Transform(ctx, chunk)
                if err != nil {
                    continue
                }
                select {
                case transformed <- out:
                case <-ctx.Done():
                    return
                }
            }
        }()
    }
    go func() { twg.Wait(); close(transformed) }()

    // Single writer for ordering / serial DB.
    for chunk := range transformed {
        if err := p.Write(ctx, chunk); err != nil {
            return err
        }
    }
    return nil
}
```

Notes:

- `transformed` is bounded by `Buffer`. When the writer is slow, transformers block on `transformed <- out`. When transformers block, they stop reading from `raw`. When they stop reading from `raw`, the source's output channel fills. The source blocks on its own send. The whole chain throttles together.
- `ctx.Done()` is checked in every blocking case. Cancellation propagates instantly.
- The output channel `transformed` is closed by a goroutine that waits for all transformers to finish. Closing from the multi-producer side requires this synchronisation.

---

## Deep Dive: Observability in Practice

A bare metric is useful; a dashboard combining metrics is essential. Below is a sample Prometheus alerting rule and a Grafana panel description for a backpressure-aware service.

```yaml
groups:
- name: backpressure
  rules:
  - alert: PoolShedding
    expr: rate(pool_rejected_total[5m]) > 0.05 * rate(pool_submitted_total[5m])
    for: 5m
    annotations:
      summary: "Pool {{$labels.pool}} is shedding > 5% of traffic"
  - alert: QueueDeep
    expr: pool_queue_depth / pool_queue_capacity > 0.8
    for: 2m
    annotations:
      summary: "Pool {{$labels.pool}} queue > 80% full"
```

Dashboard panels:

1. **Submission rates by outcome** (line chart, stacked): `rate(pool_submitted_total[1m])` by `result` label.
2. **Queue fill** (line chart): `pool_queue_depth / pool_queue_capacity`.
3. **In-flight** (line chart): `pool_in_flight`.
4. **Submit wait** (heatmap): `pool_submit_wait_seconds_bucket`.
5. **Active sheds** (state): `pool_shedding`.

The combination tells the operator the story. When queue fill climbs and rejections rise, the system is saturated; the cause is a slow consumer (in-flight stays flat at the limit) or a producer spike (in-flight at the limit and arrival rate elevated).

---

## Deep Dive: When Channels Are Not Enough

Channels are the right answer for most in-process backpressure. They struggle when:

- **Many tiny items at extreme throughput.** Per-send overhead becomes noticeable above ~10M ops/s. Use sharded queues or lock-free data structures.
- **Strict priority ordering.** Channels do not have priority. Use a heap or two-level structure.
- **Cross-process or cross-machine.** Channels are in-process only. Use a real message queue (Kafka, NATS, RabbitMQ) and apply backpressure at the consumer side via prefetch limits.
- **Persistent queues.** Channels lose data on process exit. Use disk-backed queues.

For each of these, the *idea* of backpressure is unchanged; only the mechanism differs. A Kafka consumer with a prefetch of 100 messages is exactly a channel of capacity 100, modelled remotely.

---

## Deep Dive: AIMD as a Preview

At the senior level we will cover AIMD (Additive Increase, Multiplicative Decrease) — a technique for adaptively setting concurrency limits. The preview:

- Start with a small concurrency limit (say, 10).
- For every N successful operations, increase the limit by 1.
- For every failure or timeout, multiply the limit by 0.5.

This produces a sawtooth limit that probes the system's true capacity without overshooting for long. The Netflix `concurrency-limits` library implements this; in Go, you can implement a basic version in 50 lines.

```go
type AIMD struct {
    mu      sync.Mutex
    limit   int
    inFlight int
    success int
}

func (a *AIMD) Acquire() bool {
    a.mu.Lock()
    defer a.mu.Unlock()
    if a.inFlight >= a.limit {
        return false
    }
    a.inFlight++
    return true
}

func (a *AIMD) Release(ok bool) {
    a.mu.Lock()
    defer a.mu.Unlock()
    a.inFlight--
    if ok {
        a.success++
        if a.success%20 == 0 {
            a.limit++
        }
    } else {
        a.success = 0
        a.limit /= 2
        if a.limit < 1 { a.limit = 1 }
    }
}
```

This is a teaser; the senior page goes deeper.

---

## Deep Dive: Tuning Buffer Sizes

A common middle-level question is "how do I pick the buffer size?" Some heuristics that work in practice:

1. **Start with 2× the number of workers.** Absorbs short jitter without much memory cost.
2. **If you see frequent submit blocks**, increase. Brief blocks are fine; sustained blocks mean the buffer is too small for the jitter.
3. **If you see persistent fullness**, decrease (and add admission control). A buffer that is always full is a queue grown beyond its useful size.
4. **For latency-sensitive paths**, prefer smaller buffers. Queueing time is part of tail latency.
5. **For throughput paths**, prefer slightly larger buffers — but never so large that they hide overload.
6. **Use `len(ch)` percentiles.** Track `len(ch)` over time. If p99 is 50% of capacity, you have headroom. If p99 is 100%, you are at the limit.

A typical tuned buffer for an 8-worker pool ends up at 16–32. Numbers above 100 should make you suspicious; numbers above 1000 are almost certainly wrong.

---

## Deep Dive: Tail Latency Math

When queue depth = Q, worker count = W, and average processing time = T, the worst case wait for a new item is approximately `T × (Q / W)`.

Example: T = 50 ms, W = 8, Q = 100. Worst case wait ≈ 50 × (100/8) = 625 ms. Then add T for processing: tail ≈ 675 ms.

For a service whose p99 target is 300 ms, this queue is too deep. Cap Q at `(0.3 - 0.05) / 0.05 × 8 = 40` and the math fits. The buffer size is set by the latency budget, not the other way around.

This is Little's law in a different dressing: `L = λ × W` becomes the tail bound when L is the queue length and W is the wait time.

---

## Deep Dive: Bulkhead With Per-Class Pools

Sometimes per-tenant queues are too granular and a global queue is too coarse. The middle ground is per-class pools — separate worker pools for different work types.

```go
type Multi struct {
    Read    *Pool
    Write   *Pool
    Admin   *Pool
    Default *Pool
}

func (m *Multi) Submit(class string, j Job) error {
    switch class {
    case "read":  return m.Read.SubmitCtx(j.Ctx(), j)
    case "write": return m.Write.SubmitCtx(j.Ctx(), j)
    case "admin": return m.Admin.SubmitCtx(j.Ctx(), j)
    default:      return m.Default.SubmitCtx(j.Ctx(), j)
    }
}
```

Each pool has its own capacity. Reads cannot starve writes (and vice versa); admin work has its own reserved budget.

This is the bulkhead pattern applied to concurrency. Use it when:

- Work types have different priorities.
- Work types have different latency budgets.
- One type can be safely slowed when others are busy.

---

## Deep Dive: Coordinating Multiple Pools

If your service has several pools (e.g., one for API requests and one for background jobs), they may compete for shared resources (CPU, DB connections). Two strategies:

- **Static partition.** API gets 70% of resources, background gets 30%. Predictable; sometimes inefficient.
- **Weighted semaphore over shared resource.** A single weighted semaphore for, say, DB connections; both pools acquire from it. Naturally balances based on demand.

```go
var dbSem = semaphore.NewWeighted(50) // 50 concurrent DB connections

func apiHandler(...) {
    dbSem.Acquire(ctx, 1)
    defer dbSem.Release(1)
    // ...
}

func backgroundJob(...) {
    dbSem.Acquire(ctx, 1)
    defer dbSem.Release(1)
    // ...
}
```

Both code paths share the budget. When API traffic is heavy, background jobs wait; when API is quiet, background jobs use the slack.

The risk: background jobs might starve API requests during long bursts. Mitigations:

- Per-class admission with a reserved share for API.
- Priority semaphore (acquire with priority; releases unblock high priority first).
- Two semaphores, where API tries the larger one first and falls back.

---

## Deep Dive: Backpressure Across Service Boundaries

When your service calls another service, the other service's overload becomes your problem. Two practices:

- **Timeouts.** Always set a deadline on the outbound call. Use a *fraction* of your own deadline, not the whole thing.
- **Circuit breaker.** When the downstream fails repeatedly, stop calling for a window. Falls back to errors or stale cache.

```go
ctx, cancel := context.WithTimeout(parent, parentDeadline/2)
defer cancel()

if !breaker.Allow() {
    return ErrCircuitOpen
}
err := client.Do(ctx, req)
breaker.Record(err)
```

Circuit breakers are not backpressure per se; they are downstream-failure protection. Combined with backpressure on your own service, they prevent failure cascades.

---

## Deep Dive: Backpressure and Retries

A poorly designed retry policy turns backpressure into a thundering herd. Three guidelines:

1. **Retry only idempotent operations.** A POST is rarely retryable without external idempotency keys.
2. **Use exponential backoff with jitter.** Without jitter, all clients retry at the same time after the same outage.
3. **Cap total retry budget.** Even with backoff, infinite retries amplify any prolonged failure.

```go
func RetryWithBackoff(ctx context.Context, fn func(context.Context) error, max int) error {
    base := 100 * time.Millisecond
    for i := 0; i < max; i++ {
        err := fn(ctx)
        if err == nil { return nil }
        if !isRetryable(err) { return err }
        delay := base * time.Duration(1<<i)
        jitter := time.Duration(rand.Int63n(int64(delay) / 2))
        select {
        case <-time.After(delay + jitter):
        case <-ctx.Done():
            return ctx.Err()
        }
    }
    return fmt.Errorf("retries exhausted")
}
```

When your *upstream* clients use this pattern, your 503s become brief pressure pulses, not sustained overload.

---

## Deep Dive: Saturation Detection

How do you know the system is saturated? Three signals:

1. **Queue near full.** Direct measurement.
2. **In-flight at concurrency limit.** Semaphore-based saturation.
3. **Latency p99 climbing.** The slowest operations grow first.

Any one signal in isolation can mislead; together they are a strong indicator.

```go
type Saturation struct {
    QueueFraction float64 // 0..1
    InFlight      int64
    Limit         int64
    LatencyP99    time.Duration
}

func (s Saturation) Saturated() bool {
    return s.QueueFraction > 0.8 ||
        s.InFlight >= s.Limit ||
        s.LatencyP99 > slo
}
```

Wire `Saturated()` into a metric or a `/health` endpoint. Operators and load balancers can read it.

---

## Deep Dive: Backpressure During Cold Start

Cold-start (process just launched, caches empty) is the most fragile state for a service. Symptoms:

- First few requests take 10× normal latency.
- Goroutines spawn faster than they finish.
- Queue fills, rejections begin, restart loop possible (if Kubernetes is too aggressive with readiness).

Mitigations:

- Mark the service as "not ready" until warm-up completes.
- During warm-up, accept work but at a reduced concurrency limit.
- Pre-populate caches before serving real traffic.

```go
limit := semaphore.NewWeighted(2) // start small
go func() {
    time.Sleep(30 * time.Second)
    limit = semaphore.NewWeighted(20) // grow after warm-up
}()
```

A more elegant approach is AIMD (senior page) — start low, increase on success, decrease on failure — adapts to actual capacity in real time.

---

## Deep Dive: Resilience to Misconfiguration

A backpressure-aware service must also be defensible against misconfiguration. Common errors:

- Queue size set to 0 accidentally → every send rejects.
- Worker count set to 0 → queue fills, never drains.
- Timeout set to 0 → context immediately cancelled.
- Total weight set negative → semaphore panics.

Validate config at startup:

```go
func (c *Config) Validate() error {
    if c.Workers <= 0 { return errors.New("workers must be > 0") }
    if c.QueueSize < 0 { return errors.New("queue size cannot be negative") }
    if c.TotalWeight <= 0 { return errors.New("weight must be > 0") }
    if c.JobTimeout < 0 { return errors.New("timeout cannot be negative") }
    return nil
}
```

A typed config with validation prevents the worst misconfiguration bugs from reaching production.

---

## Deep Dive: Documenting Backpressure for Operators

Every service should have a runbook section on backpressure:

1. **What metrics to watch.** Queue depth, rejections, in-flight, latency p99.
2. **What thresholds matter.** Above 80% queue → page; above 5% reject rate → page.
3. **How to investigate.** Look at upstream traffic (spike?), check downstream health (slow?), inspect goroutine dump for blocked sends.
4. **What knobs to turn.** Increase replicas to add capacity, increase pool size if CPU/memory headroom exists, tighten admission to shed earlier.
5. **What not to do.** Do not increase queue size to "absorb" the spike — that delays the inevitable. Do not silence the 503 alerts; they are the system working.

A good runbook is the difference between an SRE responding in 5 minutes vs 30. Document what the dashboards mean and what to do when they go red.

---

## Closing: A Middle-Level Mantra

If junior-level backpressure is "bound your channels," middle-level is "bound the whole pipeline, observe everything, and make shutdown graceful." Each stage is bounded; each blocking operation is context-aware; each drop is counted; each threshold has hysteresis; each shutdown drains.

The reward is a service that *behaves predictably under any load*. That predictability is what makes 3 AM pages rare and recoveries fast. It is also what lets your team confidently roll out new features — you know the system will say "no" cleanly when it cannot keep up, instead of failing in surprising ways.

Senior level will go deeper: AIMD adaptive limits, queue theory, distributed flow control, and cross-service backpressure protocols. The mechanisms grow more sophisticated, but the discipline is the same: the consumer dictates, the producer responds, the system stays honest.

---

## Appendix: Backpressure Patterns Reference Table

| Pattern | Use case | Mechanism | Cost |
|---|---|---|---|
| Bounded channel | In-process queue | `make(chan T, N)` | Memory: N × sizeof(T) |
| Semaphore | Concurrent work limit | `chan struct{}` or `semaphore.NewWeighted` | Minimal |
| Token bucket | Rate limit | Refilling channel | Goroutine + timer |
| Leaky bucket | Smoothed rate | Timer + queue | Goroutine + timer |
| Drop newest | Telemetry | `select default` | None |
| Drop oldest | Live data | Overwrite-on-full | One extra channel op |
| Sampled drop | High-volume telemetry | Random check | Negligible |
| Priority queue | Mixed-importance work | `container/heap` + mutex | Lock contention |
| Per-tenant queue | Multi-tenant fairness | Map of channels | Bookkeeping |
| Watermark shedding | Self-regulating drop | atomic state + thresholds | Negligible |
| AIMD | Adaptive limit | Counter + multiplier | Negligible |
| Circuit breaker | Downstream protection | State machine | Locked state |
| Bulkhead | Resource isolation | Separate pools | More config |

You will use most of these in any nontrivial service. Memorise the table; reach for each when its situation arises.

---

## Appendix: Subtle Behaviours of `golang.org/x/sync/semaphore`

Some details that catch experienced engineers.

### `Acquire` fails if context is already done

If `ctx.Err() != nil` at call time, `Acquire` returns immediately with that error. No partial acquire, no wait. This is the expected behaviour, but means a caller cannot pre-emptively "wait" by setting `ctx` to background and acquiring later — once the context is set, it controls the call.

### `Release` panics on negative balance

```go
s := semaphore.NewWeighted(10)
s.Release(5) // panic: semaphore: released more than held
```

If your code can Release without Acquire (perhaps a buggy retry path), wrap Release in a sentinel:

```go
type permit struct{ once sync.Once; sem *semaphore.Weighted; n int64 }
func (p *permit) Release() { p.once.Do(func() { p.sem.Release(p.n) }) }
```

This ensures double-release is a no-op rather than a panic.

### `TryAcquire` is not context-aware

`TryAcquire(n)` returns immediately. It does not respect a context. If you need "try with brief wait," use `Acquire` with a `context.WithTimeout(short)`.

### Fairness

`semaphore.Weighted` is FIFO among waiters of the *same weight*. Different weights interact non-trivially: a small request behind a queued large one may have to wait until the large one completes.

For systems with mixed weights, watch out for head-of-line blocking. If a single 16-weight job is queued and the budget is 32, all 1-weight jobs behind it wait until 16 weight clears, even if 31 weight is free — because they were queued behind the 16-weight one.

Mitigation: use separate pools for large and small work, or implement priority semantics yourself.

---

## Appendix: A Pipeline Idioms Cheat Sheet

```go
// 1. Source goroutine with cancellation.
func source(ctx context.Context) <-chan T {
    out := make(chan T, B)
    go func() {
        defer close(out)
        for /* condition */ {
            select {
            case out <- nextValue():
            case <-ctx.Done(): return
            }
        }
    }()
    return out
}

// 2. Single-worker stage.
func stage(ctx context.Context, in <-chan A) <-chan B {
    out := make(chan B, B)
    go func() {
        defer close(out)
        for a := range in {
            b := transform(a)
            select {
            case out <- b:
            case <-ctx.Done(): return
            }
        }
    }()
    return out
}

// 3. Multi-worker fan-out stage.
func fanOut(ctx context.Context, in <-chan A, n int) <-chan B {
    out := make(chan B, B)
    var wg sync.WaitGroup
    for i := 0; i < n; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for a := range in {
                b := transform(a)
                select {
                case out <- b:
                case <-ctx.Done(): return
                }
            }
        }()
    }
    go func() { wg.Wait(); close(out) }()
    return out
}

// 4. Sink.
func sink(ctx context.Context, in <-chan T) {
    for t := range in {
        process(t)
    }
}
```

These four shapes cover 90% of pipeline code. Memorise them.

---

## Appendix: Real-World Sizing Examples

Some sizing decisions from real systems (paraphrased):

| Workload | Workers | Queue | Timeout | Reasoning |
|---|---|---|---|---|
| Web API (50ms requests) | NumCPU × 2 | NumCPU × 4 | 100ms | Latency-sensitive; small queue |
| Image transcoder (2-10s) | NumCPU | NumCPU | 30s | CPU-bound; queue absorbs jitter |
| Webhook fanout (network) | 100 | 1000 | 10s | I/O-bound; large pool, large queue |
| ETL pipeline (5-60s) | 8 | 16 | 5min | Throughput; cap memory not latency |
| Telemetry shipper | 4 | 10000 | drop | Drop is OK; minimise blocking |
| Cache warmer | 16 | 32 | 1s | Background; gentle on the cluster |

These are starting points. Measure, then tune.

---

## Appendix: Anti-Patterns to Watch For in Code Review

When reviewing PRs in a Go codebase, flag any of these:

1. `make(chan T)` followed by a single sender that never closes — possible deadlock on receiver.
2. `make(chan T, 1<<N)` for large N — probably an unbounded queue in disguise.
3. A `for range ch` loop with no exit condition and no context — goroutine leak.
4. A `select` with `default` and no logging or counter — silent drops.
5. A struct with both `mu sync.Mutex` and `ch chan T` — possible deadlock if `ch` blocks under lock.
6. `go func() { ... }()` in a hot path with no concurrency limit — spawn-per-request.
7. A worker pool struct with no `Close` method — operational nightmare.
8. A worker function with `for { select { ... } }` and no `<-ctx.Done()` case — uncancellable goroutine.
9. `time.Sleep` to "wait for queue to drain" — race condition; use explicit signalling.
10. Submitting work after `close(ch)` — panic.

Pattern matching these in review catches 80% of backpressure bugs before they ship.

---

## Appendix: Testing Backpressure

A few patterns for testing backpressure behaviour.

### Test 1: Buffer blocks at capacity

```go
func TestBufferBlocks(t *testing.T) {
    ch := make(chan int, 2)
    ch <- 1
    ch <- 2
    blocked := make(chan struct{})
    go func() {
        ch <- 3
        close(blocked)
    }()
    select {
    case <-blocked: t.Fatal("should be blocked")
    case <-time.After(20 * time.Millisecond):
    }
}
```

### Test 2: TrySubmit returns false when full

```go
func TestTrySubmitReturnsFalseWhenFull(t *testing.T) {
    p := NewPool(1, 1, 1)
    p.Submit(slowJob())          // takes a slot
    p.Submit(slowJob())          // fills the buffer
    if p.TrySubmit(slowJob()) == nil {
        t.Fatal("expected TrySubmit to fail")
    }
}
```

### Test 3: SubmitCtx respects deadline

```go
func TestSubmitCtxTimesOut(t *testing.T) {
    p := NewPool(1, 1, 1)
    p.Submit(longJob())
    p.Submit(longJob()) // fills buffer
    ctx, cancel := context.WithTimeout(context.Background(), 10*time.Millisecond)
    defer cancel()
    err := p.SubmitCtx(ctx, longJob())
    if !errors.Is(err, context.DeadlineExceeded) {
        t.Fatal("expected deadline error, got", err)
    }
}
```

### Test 4: Close drains in-flight work

```go
func TestCloseDrainsInFlight(t *testing.T) {
    p := NewPool(2, 4, 4)
    var done atomic.Int32
    for i := 0; i < 6; i++ {
        p.Submit(JobFunc(func(context.Context) error {
            time.Sleep(50 * time.Millisecond)
            done.Add(1)
            return nil
        }))
    }
    ctx, cancel := context.WithTimeout(context.Background(), time.Second)
    defer cancel()
    if err := p.Close(ctx); err != nil { t.Fatal(err) }
    if done.Load() != 6 {
        t.Fatalf("expected 6 finished jobs, got %d", done.Load())
    }
}
```

### Test 5: Drops are counted

```go
func TestDropsCounted(t *testing.T) {
    p := NewPool(1, 1, 1)
    p.Submit(slowJob())
    p.Submit(slowJob())
    p.TrySubmit(slowJob()) // dropped
    p.TrySubmit(slowJob()) // dropped
    if p.Stats.Dropped.Load() != 2 {
        t.Fatalf("expected 2 drops, got %d", p.Stats.Dropped.Load())
    }
}
```

Without tests like these, you have not verified backpressure behaviour — only the happy path.

---

## Appendix: Performance Considerations

A buffered channel send is roughly 50-100 ns. A semaphore acquire-release is similar. For the vast majority of services, these costs are negligible. Cases where they matter:

- **Per-request submits in a 10M RPS service.** Even 100 ns × 10M = 1 second of CPU per second per core.
- **Inner-loop fan-out.** A channel send per loop iteration in a tight CPU loop adds up.

Mitigations:

- **Batch.** Send N items at a time instead of one. Reduces overhead by a factor of N.
- **Shard.** Split into independent channels and have multiple goroutines balance load. Reduces contention.
- **Skip the channel.** For very fast paths where backpressure is enforced upstream, omit the intermediate channel.

For most services, none of this matters. Channels are fast enough.

---

## Appendix: When Backpressure Hurts

Backpressure is the default for production-grade Go code. There are a few cases where it does *not* help:

- **One-shot scripts.** A CLI tool that reads a file, transforms it, writes another file. There is no sustained load.
- **Strict consistency requirements.** Some systems must process every event in order with no loss. Backpressure with drop is wrong; backpressure with block is the only option.
- **Pull-based architectures.** When a consumer pulls work as it needs, backpressure is already implicit. Adding more does nothing.

Recognise the negative cases so you do not over-engineer.

---

## Appendix: Connecting to Other Concurrency Topics

Backpressure interacts with several other Go concurrency patterns:

- **Graceful shutdown / drain.** The drain pattern is "stop accepting; finish in-flight; close." Backpressure is "shed incoming when full." Same family.
- **Rate limiting.** Token bucket and leaky bucket implementations are upstream of backpressure. They control arrival rate; backpressure controls work in flight.
- **Circuit breaker.** A circuit breaker is backpressure for outbound calls — it protects you when your downstream is overloaded.
- **Timeout.** Every backpressure mechanism with a wait needs a timeout, or it can hang forever.
- **Worker pools.** The natural home for backpressure: bounded queue + bounded workers.
- **Pipelines.** Each stage has its own backpressure; the chain propagates the signal.
- **Fan-in / fan-out.** Bounded outputs at each side keep memory in check.

Backpressure is not a discrete topic; it is a discipline that touches almost every concurrent design.

---

## Appendix: Backpressure In gRPC and HTTP/2

If you build gRPC servers, you get backpressure partly for free: HTTP/2's flow-control windows act as credits. The window starts at 64 KB per stream; each ACK lets the sender push more. A slow consumer simply does not ACK, and the upstream stops sending.

The default is *not* bulletproof. You can still:

- Accept too many streams concurrently (use `MaxConcurrentStreams` setting).
- Accept individual messages that are too large.
- Have application-level queues that grow even when transport flow control is honored.

Tune:

```go
server := grpc.NewServer(
    grpc.MaxConcurrentStreams(100),
    grpc.MaxRecvMsgSize(10 << 20),
    grpc.InitialConnWindowSize(1 << 16),
)
```

And in your handler, still apply admission control:

```go
func (s *Server) Method(ctx context.Context, req *Req) (*Resp, error) {
    if err := s.admit.Acquire(ctx, 1); err != nil {
        return nil, status.Error(codes.ResourceExhausted, "busy")
    }
    defer s.admit.Release(1)
    // ...
}
```

Transport-level flow control + application-level admission = end-to-end backpressure.

---

## Appendix: Database Connection Pool as Backpressure

`database/sql` has a connection pool with `SetMaxOpenConns` and `SetMaxIdleConns`. When all connections are in use, `db.Query` blocks until a connection is free (or the context expires).

This is backpressure on database access. It is also why every database call should have a context with a deadline. Without one, a stuck DB hangs the calling goroutine forever.

```go
db.SetMaxOpenConns(50)
db.SetMaxIdleConns(20)
db.SetConnMaxLifetime(time.Hour)

ctx, cancel := context.WithTimeout(parent, 100*time.Millisecond)
defer cancel()
rows, err := db.QueryContext(ctx, q)
```

If the DB is slow, 100 ms per call protects you. If many callers all wait at once, the connection pool serialises them; eventually `QueryContext` returns a deadline error, and the request is rejected upstream.

This is backpressure all the way down.

---

## Appendix: Final Middle-Level Mantra

Make every queue bounded. Make every wait context-aware. Make every drop visible. Make every shutdown graceful. Make every threshold hysteretic. Make every tenant isolated. Make every metric observable. Make every code review check for misses.

These eight habits, applied consistently, turn a typical Go service into one that survives load tests, deployments, and Black Friday — not by being faster, but by being honest about its limits.

In `senior.md` we will look at the deeper machinery: AIMD adaptive concurrency, queue-theoretic sizing, distributed backpressure protocols (HTTP/2 flow control, gRPC, Kafka consumer lag), and how to design systems whose backpressure crosses process boundaries cleanly. Each is a way of pushing the same discipline further.

---

## Appendix: A Worked Example — Background Image Processing With Per-Tenant Quotas

This appendix walks through a complete middle-level design problem.

Requirement: build a background image-processing pipeline. Multiple tenants submit batches of images. Each tenant should be able to submit independently without blocking other tenants. The system should:

- Cap memory usage even with thousands of pending images.
- Apply per-tenant fairness — no single tenant monopolises capacity.
- Allow operators to inspect queue depths per tenant.
- Drain on shutdown.

```go
package imgproc

import (
    "context"
    "sync"
    "sync/atomic"
    "time"

    "golang.org/x/sync/semaphore"
)

type Job struct {
    Tenant string
    Image  []byte
}

type tenantQueue struct {
    ch       chan Job
    pending  atomic.Int64
    dropped  atomic.Int64
    accepted atomic.Int64
}

type Service struct {
    mu       sync.Mutex
    tenants  map[string]*tenantQueue
    workerCh chan Job
    cpu      *semaphore.Weighted
    closed   atomic.Bool
    wg       sync.WaitGroup
}

func New(workers int, cpuBudget int64) *Service {
    s := &Service{
        tenants:  make(map[string]*tenantQueue),
        workerCh: make(chan Job, workers*2),
        cpu:      semaphore.NewWeighted(cpuBudget),
    }
    for i := 0; i < workers; i++ {
        s.wg.Add(1)
        go s.worker()
    }
    return s
}

func (s *Service) ensureTenant(t string) *tenantQueue {
    s.mu.Lock()
    defer s.mu.Unlock()
    q, ok := s.tenants[t]
    if ok { return q }
    q = &tenantQueue{ch: make(chan Job, 100)}
    s.tenants[t] = q
    go s.drain(t, q)
    return q
}

func (s *Service) drain(t string, q *tenantQueue) {
    for j := range q.ch {
        q.pending.Add(-1)
        s.workerCh <- j
    }
}

func (s *Service) Submit(ctx context.Context, j Job) error {
    if s.closed.Load() {
        return ErrClosed
    }
    q := s.ensureTenant(j.Tenant)
    select {
    case q.ch <- j:
        q.pending.Add(1)
        q.accepted.Add(1)
        return nil
    default:
        q.dropped.Add(1)
        return ErrBusy
    }
}

func (s *Service) worker() {
    defer s.wg.Done()
    for j := range s.workerCh {
        if err := s.cpu.Acquire(context.Background(), 1); err != nil {
            continue
        }
        process(j.Image)
        s.cpu.Release(1)
    }
}

func (s *Service) Close(ctx context.Context) error {
    if !s.closed.CompareAndSwap(false, true) {
        return nil
    }
    s.mu.Lock()
    for _, q := range s.tenants { close(q.ch) }
    s.mu.Unlock()
    close(s.workerCh)
    done := make(chan struct{})
    go func() { s.wg.Wait(); close(done) }()
    select {
    case <-done: return nil
    case <-ctx.Done(): return ctx.Err()
    }
}

func (s *Service) TenantStats(t string) (pending, accepted, dropped int64) {
    s.mu.Lock()
    defer s.mu.Unlock()
    q, ok := s.tenants[t]
    if !ok { return 0, 0, 0 }
    return q.pending.Load(), q.accepted.Load(), q.dropped.Load()
}
```

Notes on the design:

- Per-tenant queue (100 slots each) for fairness.
- Shared worker channel for efficient worker reuse.
- Weighted semaphore (`cpu`) for CPU concurrency.
- Three counters per tenant give operators per-tenant insight.
- Close drains the per-tenant queues, then the shared channel, then workers.

In production you would expose `TenantStats` via a metrics endpoint and alert on dropped > 1% per tenant. You would also probably add per-tenant rate limits *upstream* of the queue — to discourage one tenant from filling their queue and getting drops.

This is the kind of design a middle-level engineer should be able to produce in an afternoon.

---

## Appendix: A Final Cheat Sheet for Middle-Level Patterns

```go
// Bounded pool
pool := pool.New(pool.Config{QueueSize: 16, Workers: 8, TotalWeight: 8})

// Submit modes
pool.Submit(j)                    // blocks
pool.TrySubmit(j)                 // drops on full
pool.SubmitCtx(ctx, j)            // rejects on deadline

// Semaphore-only admission
sem := semaphore.NewWeighted(64)
sem.Acquire(ctx, 1); defer sem.Release(1)

// Bounded pipeline
out := stage(ctx, in) // each stage has bounded out and ctx-aware send

// Drop oldest (overwrite)
select { case ch <- x: default: <-ch; ch <- x }

// Watermark with hysteresis
if shedding && depth <= low  { shedding = false }
if !shedding && depth >= high { shedding = true }

// Per-tenant queue
q := s.ensureTenant(t)
select { case q.ch <- j: ... default: dropped++ }

// Graceful close
close(jobs); wg.Wait()
```

Each of these patterns has appeared above; keep them at hand as you read code in a Go codebase.



