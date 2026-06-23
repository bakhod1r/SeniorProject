---
layout: default
title: Optimize
parent: Dynamic Worker Scaling
grand_parent: Production Patterns
ancestor: Go
nav_order: 10
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/18-production-patterns/02-dynamic-worker-scaling/optimize/
---

# Dynamic Worker Scaling — Optimization

> Each entry shows a real performance or behavior problem, the before snippet, the after snippet, and the realistic gain. Measure in your own code.

---

## Optimization 1 — Replace per-tick `time.After` with `time.NewTicker`

**Problem.** `time.After(d)` in a loop allocates a new timer on every iteration. For an autoscaler ticking every 500 ms over months, this creates GC pressure.

**Before:**
```go
for {
    select {
    case <-ctx.Done(): return
    case <-time.After(500 * time.Millisecond):
        // autoscale logic
    }
}
```

Every iteration allocates a Timer struct (~120 bytes). Over years, millions of allocations.

**After:**
```go
t := time.NewTicker(500 * time.Millisecond)
defer t.Stop()
for {
    select {
    case <-ctx.Done(): return
    case <-t.C:
        // autoscale logic
    }
}
```

**Gain.** Allocation per tick: ~120 bytes → 0. For a long-running service, removes a steady source of GC work.

---

## Optimization 2 — Cache `runtime.NumCPU()`

**Problem.** `runtime.NumCPU()` is not free; it does a syscall (or reads from cache, depending on OS). Calling it in a hot loop is wasteful.

**Before:**
```go
func (p *Pool) workerLoop() {
    for task := range p.jobs {
        // ...
        // somewhere in the code:
        if runtime.NumCPU() > someBound { ... }
    }
}
```

**After:**
```go
var numCPU = runtime.NumCPU()

func (p *Pool) workerLoop() {
    for task := range p.jobs {
        // ...
        if numCPU > someBound { ... }
    }
}
```

**Gain.** Save microseconds per call; eliminate the syscall. For autoscaler ticks reading CPU count, this matters.

---

## Optimization 3 — Replace sort-based p99 with histogram

**Problem.** Sort-based p99 from a 1000-sample ring buffer is O(n log n). At every autoscaler tick (500 ms), this is wasted CPU.

**Before:**
```go
func (w *WaitTracker) P99() time.Duration {
    w.mu.Lock()
    cp := make([]time.Duration, len(w.samples))
    copy(cp, w.samples)
    w.mu.Unlock()
    sort.Slice(cp, func(i, j int) bool { return cp[i] < cp[j] })
    return cp[int(float64(len(cp)-1)*0.99)]
}
```

1000 samples sorted: ~50 microseconds. Per tick = 100 microseconds per second of CPU.

**After:**
```go
type Histogram struct {
    buckets []int64    // atomic counts per bucket
    bounds  []float64   // upper bound of each bucket
}

func (h *Histogram) Observe(v float64) {
    idx := sort.SearchFloat64s(h.bounds, v)
    atomic.AddInt64(&h.buckets[idx], 1)
}

func (h *Histogram) Quantile(q float64) float64 {
    var total int64
    for _, c := range h.buckets { total += c }
    target := int64(float64(total) * q)
    var sum int64
    for i, c := range h.buckets {
        sum += c
        if sum >= target {
            return h.bounds[i]
        }
    }
    return h.bounds[len(h.bounds)-1]
}
```

20 buckets covering 0.1ms to 60s. Observe is O(log 20) = O(1). Quantile is O(20).

**Gain.** Per-tick percentile: 50us → 1us. For high-throughput pools, the histogram also handles observe more cheaply (atomic add vs lock+slice modification).

---

## Optimization 4 — Sample wait time instead of recording every task

**Problem.** Recording every task's wait time costs memory (sample storage) and CPU (atomic increment, possibly lock). At 100k req/s, this adds up.

**Before:**
```go
func (p *Pool) Submit(task func()) error {
    submitted := time.Now()
    return p.raw.Invoke(Job{Task: task, Submitted: submitted})
}

func (p *Pool) run(arg interface{}) {
    job := arg.(Job)
    wait := time.Since(job.Submitted)
    p.tracker.Record(wait)
    // ...
}
```

`tracker.Record` takes a lock. At high throughput, the lock is contended.

**After:**
```go
var sampleCounter int64

func (p *Pool) Submit(task func()) error {
    var submitted time.Time
    if atomic.AddInt64(&sampleCounter, 1) % 100 == 0 {
        submitted = time.Now()
    }
    return p.raw.Invoke(Job{Task: task, Submitted: submitted})
}

func (p *Pool) run(arg interface{}) {
    job := arg.(Job)
    if !job.Submitted.IsZero() {
        wait := time.Since(job.Submitted)
        p.tracker.Record(wait)
    }
    // ...
}
```

Sample 1-in-100. Tracker still has enough samples for statistical accuracy.

**Gain.** Per-task overhead: drops by ~99%. Lock contention on tracker: drops by ~99%. For pools at 100k req/s, this is the difference between feasible and not.

---

## Optimization 5 — EWMA instead of moving average

**Problem.** Moving average requires a ring buffer (memory) and a sum (kept up-to-date). EWMA is one variable.

**Before:**
```go
type MovingAvg struct {
    samples []float64
    cap     int
    idx     int
    full    bool
    sum     float64
}

func (m *MovingAvg) Add(v float64) {
    m.sum -= m.samples[m.idx]
    m.samples[m.idx] = v
    m.sum += v
    m.idx = (m.idx + 1) % m.cap
}

func (m *MovingAvg) Value() float64 {
    n := m.idx
    if m.full { n = m.cap }
    return m.sum / float64(n)
}
```

Memory: O(cap). Updates O(1).

**After:**
```go
type EWMA struct {
    value, alpha float64
    primed       bool
}

func (e *EWMA) Add(v float64) {
    if !e.primed {
        e.value = v
        e.primed = true
        return
    }
    e.value = e.alpha*v + (1-e.alpha)*e.value
}
```

Memory: O(1). Updates O(1).

**Gain.** Memory: bytes vs kilobytes per tracker. For many pools with many trackers, this matters.

Trade-off: EWMA lags slightly more than SMA. Acceptable for autoscaling.

---

## Optimization 6 — Use `atomic.Int32` instead of `int32`+`atomic.LoadInt32`

**Problem.** `atomic.LoadInt32(&v)` is verbose; reads scattered through code. Errors easy to make.

**Before:**
```go
type Pool struct {
    live, target int32
}

if atomic.LoadInt32(&p.live) > atomic.LoadInt32(&p.target) { ... }
atomic.AddInt32(&p.live, 1)
```

**After (Go 1.19+):**
```go
type Pool struct {
    live, target atomic.Int32
}

if p.live.Load() > p.target.Load() { ... }
p.live.Add(1)
```

**Gain.** Code clarity. Less chance of accidentally non-atomic access. Same runtime performance.

---

## Optimization 7 — Avoid map iteration in autoscaler

**Problem.** Iterating a map (e.g., per-tenant counters) inside the autoscaler is slow and allocates.

**Before:**
```go
type Pool struct {
    counters map[string]int64
}

func (p *Pool) decide() {
    var total int64
    for _, v := range p.counters {  // map iteration
        total += v
    }
    // ...
}
```

**After:**
```go
type Pool struct {
    perKey []atomic.Int64    // dense slice, indexed by hash
    keyMap map[string]int    // only consulted occasionally
}

func (p *Pool) decide() {
    var total int64
    for i := range p.perKey {
        total += p.perKey[i].Load()
    }
}
```

Slice iteration is cache-friendlier. Map iteration has hashing overhead.

**Gain.** Microbenchmarks: 5-10x faster. Plus, no allocation per iteration.

---

## Optimization 8 — Reduce mutex hold time in Resize

**Problem.** Holding a mutex while spawning many goroutines is slow if many submitters are waiting.

**Before:**
```go
func (p *Pool) Resize(target int) {
    p.mu.Lock()
    defer p.mu.Unlock()
    // ... check closing, compute toAdd ...
    for i := 0; i < toAdd; i++ {
        atomic.AddInt32(&p.live, 1)
        p.wg.Add(1)
        go p.worker()
    }
}
```

Each `go p.worker()` is ~1us. For 1000 spawns: 1ms mutex hold. Submitters block.

**After:**
```go
func (p *Pool) Resize(target int) {
    p.mu.Lock()
    if p.closing {
        p.mu.Unlock()
        return
    }
    old := atomic.LoadInt32(&p.live)
    atomic.StoreInt32(&p.target, int32(target))
    var toAdd int32
    if int32(target) > old {
        toAdd = int32(target) - old
        atomic.AddInt32(&p.live, toAdd)
        p.wg.Add(int(toAdd))
    }
    p.mu.Unlock()

    // Spawn outside the lock:
    for i := int32(0); i < toAdd; i++ {
        go p.worker()
    }
}
```

Mutex held for microseconds. Spawns happen in parallel-ish.

**Gain.** Submission latency during a fast grow: drops from 1ms to microseconds. For latency-sensitive services, this matters.

---

## Optimization 9 — Eliminate redundant tickers

**Problem.** Multiple components in a pool may each have their own ticker (autoscaler, metrics exporter, idle purger). Each ticker has overhead.

**Before:**
```go
go autoscaleLoop(500 * time.Millisecond)
go metricsLoop(1 * time.Second)
go idlePurgeLoop(10 * time.Second)
```

Three goroutines, three tickers, three timer-driven wakes.

**After:**
```go
go func() {
    autoTick := time.NewTicker(500 * time.Millisecond)
    metricsTick := time.NewTicker(1 * time.Second)
    purgeTick := time.NewTicker(10 * time.Second)
    defer autoTick.Stop()
    defer metricsTick.Stop()
    defer purgeTick.Stop()
    for {
        select {
        case <-ctx.Done(): return
        case <-autoTick.C: autoscaleStep()
        case <-metricsTick.C: emitMetrics()
        case <-purgeTick.C: purgeIdleWorkers()
        }
    }
}()
```

One goroutine, three tickers. Less scheduler work.

**Gain.** Marginal but real. For embedded systems, every goroutine matters. For large services, scheduler load drops slightly.

Note: the consolidation makes the code harder to read. Trade-off. Use when scheduler pressure is real.

---

## Optimization 10 — Histogram instead of struct-per-sample

**Problem.** A wait tracker storing `[]time.Duration` is O(N) memory. For 1M samples = 8MB.

**Before:**
```go
type WaitTracker struct {
    samples []time.Duration  // 8MB for 1M
}
```

**After:**
```go
type WaitTracker struct {
    buckets [16]int64  // 128 bytes for full distribution
    bounds  []time.Duration
}
```

128 bytes regardless of throughput.

**Gain.** Memory: 99%+ reduction. Latency: same. Quantile accuracy: bounded by bucket granularity.

---

## Optimization 11 — Pre-allocate worker structs

**Problem.** Ants's default mode allocates worker structs on demand. Each `goWorker` is ~64 bytes. At high churn, GC pressure.

**Before:**
```go
p, _ := ants.NewPool(64)  // PreAlloc=false default
```

Each new worker: allocate struct, register with pool. Marginal but real.

**After:**
```go
p, _ := ants.NewPool(64, ants.WithPreAlloc(true))
```

All worker structs allocated upfront. No per-worker allocation later. Lower GC pressure.

**Gain.** GC pause time: slight reduction. Memory usage: slightly higher (pre-allocated even if unused).

Use when you can size accurately upfront.

---

## Optimization 12 — Submit returns error vs blocks

**Problem.** Default ants Submit blocks when pool is at capacity. Caller waits indefinitely; latency tail grows.

**Before:**
```go
p, _ := ants.NewPool(8)
// caller:
p.Submit(task)  // may block forever
```

**After:**
```go
p, _ := ants.NewPool(8, ants.WithNonblocking(true))
// caller:
err := p.Submit(task)
if err == ants.ErrPoolOverload {
    // backpressure response
    return tooBusyError
}
```

**Gain.** Latency: bounded. Service has explicit backpressure response. Better than indefinite wait.

---

## Bonus Optimization — Reduce lock scope on the wait tracker

**Problem.** A WaitTracker with a single mutex serialises all Record calls. At very high task rates, this lock is contended.

**Before:**
```go
type WaitTracker struct {
    mu      sync.Mutex
    samples []time.Duration
}

func (w *WaitTracker) Record(d time.Duration) {
    w.mu.Lock()
    w.samples = append(w.samples, d)
    w.mu.Unlock()
}
```

**After: sharded tracker**
```go
type ShardedWaitTracker struct {
    shards [16]*WaitTracker
}

func (s *ShardedWaitTracker) Record(d time.Duration) {
    n := runtime_procPin()
    s.shards[n%16].Record(d)
    runtime_procUnpin()
}

func (s *ShardedWaitTracker) Quantile(q float64) time.Duration {
    // aggregate across shards
}
```

Each CPU gets its own shard. No cross-CPU contention.

`runtime_procPin` is a non-exported runtime call; use `golang.org/x/sys/cpu` or a similar library.

**Gain.** At 1M req/s, lock contention drops to near zero. Tracker overhead becomes negligible.

For pools handling moderate throughput (<100k req/s), single-shard is enough.

---

## Bonus Optimization — Avoid goroutine-per-task model for short tasks

**Problem.** ants's standard model spawns goroutines (under the hood, free list of goroutines, but each task still has worker overhead). For very short tasks (<1us), the overhead dominates.

**Before:**
```go
p.Submit(func() {
    counter.Add(1)  // 1ns of work
})
```

Per-submission overhead: ~110ns. Per-task overhead: ~1ns. Submission is 100x the work.

**After:**

Bypass the pool for trivial work:

```go
if isTrivial(task) {
    task()  // run inline
} else {
    p.Submit(task)
}
```

Or batch trivial tasks:

```go
batch := []func(){...}
p.Submit(func() {
    for _, t := range batch {
        t()
    }
})
```

Or use a different data structure (concurrent map, atomic counter directly).

**Gain.** For trivial tasks: 100x faster. Pool overhead avoided when not needed.

The lesson: pools have overhead. Don't use them for the wrong workload.

---

## Bonus Optimization — Use atomic.Pointer for swappable config

**Problem.** Reloading config (e.g., new threshold values) requires synchronization.

**Before:**
```go
type Autoscaler struct {
    mu       sync.RWMutex
    policy   Policy
}

func (a *Autoscaler) getPolicy() Policy {
    a.mu.RLock()
    defer a.mu.RUnlock()
    return a.policy
}

func (a *Autoscaler) setPolicy(p Policy) {
    a.mu.Lock()
    a.policy = p
    a.mu.Unlock()
}
```

RWMutex is fine but adds overhead on every tick.

**After (Go 1.19+):**
```go
type Autoscaler struct {
    policy atomic.Pointer[Policy]
}

func (a *Autoscaler) getPolicy() Policy { return *a.policy.Load() }
func (a *Autoscaler) setPolicy(p Policy) { a.policy.Store(&p) }
```

Lock-free reads. Swap on write.

**Gain.** Per-tick cost: ~10ns vs ~100ns. Hot-reload is essentially free.

---

## Summary

These 12 optimizations cover most realistic improvements:

- Allocations (time.After, sort-based percentiles, sample storage)
- Locking (mutex hold time, sample collection contention)
- Algorithms (EWMA vs SMA, histogram vs sort)
- Architecture (Nonblocking submit, PreAlloc)

Profile before optimizing. Most autoscalers don't need any of these. When you do need them, they cumulatively can make a 10x throughput difference.
