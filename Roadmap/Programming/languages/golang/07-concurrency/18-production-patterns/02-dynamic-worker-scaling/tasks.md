---
layout: default
title: Tasks
parent: Dynamic Worker Scaling
grand_parent: Production Patterns
ancestor: Go
nav_order: 8
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/18-production-patterns/02-dynamic-worker-scaling/tasks/
---

# Dynamic Worker Scaling — Hands-on Tasks

> Practical exercises from easy to hard. Each task says what to build, what success looks like, and gives a hint or expected outcome. Solutions or solution sketches at the end.

---

## Easy

### Task 1 — A minimal static pool

Build a worker pool with N=8 workers consuming from a buffered channel. Submit 100 tasks; each task prints its index and sleeps 10ms. Use `sync.WaitGroup` to wait for completion.

**Goal:** establish the baseline static pool you will make dynamic.

**Hint:** `for i := 0; i < 8; i++ { go worker(jobs) }`. Close `jobs` after submitting; workers exit via `for job := range jobs`.

---

### Task 2 — Add a Resize method

Extend Task 1's pool with a `Resize(n int)` method. Spawning n - currentN new workers when growing; shrinking is opportunistic (workers check `liveSize > targetSize` and exit).

**Goal:** implement the core mechanic of dynamic resize.

**Hint:** track `target` and `live` as `int32` atomic. In `Resize`, hold a mutex; spawn workers if growing; do nothing for shrink. Workers check at the top of their loop.

---

### Task 3 — A queue-depth autoscaler

Add a goroutine that ticks every 500 ms. If `len(jobs)/cap(jobs) > 0.75` and pool < 32, call `Resize(current + 2)`. If utilization < 0.10 and pool > 2, call `Resize(current - 1)`. Implement cooldowns: at least 2 s between grows, 30 s between shrinks.

**Goal:** wire up the simplest autoscaler.

**Hint:** track `lastUp time.Time` and `lastDown time.Time`. Check before resizing.

---

### Task 4 — Submit with backpressure

Modify `Submit` to return `(error, bool)`. When channel is full, return `ErrPoolFull` instead of blocking.

**Goal:** add the basic backpressure mechanism.

**Hint:** use `select` with `default` clause:
```go
select { case p.jobs <- task: return nil; default: return ErrPoolFull }
```

---

### Task 5 — Wait-time tracking

Add a `WaitTracker` that records each task's queue wait time. Implement a ring buffer of 1000 samples and a `P99()` method (sort-based).

**Goal:** collect the signal needed for wait-time autoscaling.

**Hint:** wrap submitted tasks with a struct containing submitted timestamp. Workers record `time.Since(submitted)` in the tracker.

---

## Medium

### Task 6 — Wait-time autoscaler

Replace Task 3's queue-depth autoscaler with a wait-time autoscaler:
- Grow if p99 wait > 500ms
- Shrink if mean wait < 20ms
- Same cooldowns

**Goal:** experience the signal-based decision.

**Hint:** mean and p99 from the tracker; decide based on each.

---

### Task 7 — ants pool with Tune autoscaler

Replace your hand-rolled pool with `panjf2000/ants`. Use `Tune(n)` for resize. Autoscaler logic stays the same.

**Goal:** see how library-backed pools work.

**Hint:** `ants.NewPool(8, ants.WithExpiryDuration(60*time.Second))`. Track running with `p.Running()`.

---

### Task 8 — Implement AIMD

Replace step-based grow/shrink with AIMD:
- Grow: `cur + 1`
- Shrink: `cur - cur/4`

**Goal:** see AIMD's smoother convergence.

**Hint:** the change is in the decision function. Compare graphs before/after.

---

### Task 9 — EWMA smoothing

Implement an EWMA struct: `Add(v float64)` and `Value()`. Use alpha=0.3. Smooth the wait-time signal through EWMA before passing to the autoscaler.

**Goal:** reduce noise in autoscaling decisions.

**Hint:**
```go
type EWMA struct { value, alpha float64; primed bool }
func (e *EWMA) Add(v float64) {
    if !e.primed { e.value = v; e.primed = true; return }
    e.value = e.alpha*v + (1-e.alpha)*e.value
}
```

---

### Task 10 — Add Prometheus metrics

Export:
- `pool_size` gauge
- `pool_busy` gauge
- `pool_wait_seconds` histogram
- `pool_resizes_total` counter (label: direction)
- `pool_submitted_total` counter

Expose `/metrics` on a separate HTTP port. Verify with `curl`.

**Goal:** real observability.

**Hint:** `prometheus.NewGauge`, `prometheus.MustRegister`, `promhttp.Handler()`.

---

### Task 11 — Synthetic load generator

Build a load generator: starts at 100 req/s, ramps to 2000 req/s over 60 s, holds for 60 s, ramps back to 100 over 60 s. Each task simulates work with `time.Sleep` (random 30-120 ms).

**Goal:** drive your pool under realistic burst patterns. Watch the autoscaler respond.

**Hint:** use a `time.Ticker` whose interval changes based on elapsed time.

---

## Medium-Hard

### Task 12 — Multi-signal autoscaler

Combine wait time, utilization, and queue depth. Veto growth when error rate > 10%. Document the decision rules.

**Goal:** experience policy composition.

**Hint:**
```go
switch {
case errorRate > 0.10: hold
case util > 0.85: grow
case waitP99 > 1*time.Second: grow
case util < 0.30 && waitP99 < 100*time.Millisecond: shrink
}
```

---

### Task 13 — Cooldown adapter

Implement a `Cooldown` struct: `AllowUp(now)`, `AllowDown(now)`, `RecordUp(now)`, `RecordDown(now)`. Refactor the autoscaler to use it. Test in isolation.

**Goal:** decompose the autoscaler into testable parts.

**Hint:** the struct holds `lastUp, lastDown time.Time` and `UpAfter, DownAfter time.Duration`.

---

### Task 14 — Idle expiry

Implement per-worker idle timeout. If a worker is idle longer than 30 s and the pool is above floor, the worker exits on its own.

**Goal:** decentralized scale-down.

**Hint:**
```go
timer := time.NewTimer(30*time.Second)
select {
case task := <-jobs: ... timer.Reset(30*time.Second)
case <-timer.C:
    if atomic.LoadInt32(&live) > floor {
        atomic.AddInt32(&live, -1)
        return
    }
    timer.Reset(30*time.Second)
}
```

---

### Task 15 — Pluggable autoscaler

Refactor the autoscaler so signal, decider, cooldown are interfaces. Write a default `Autoscaler` struct that takes them as fields. Test with mock implementations.

**Goal:** composable, testable architecture.

**Hint:**
```go
type Signal interface { Value() float64 }
type Decider interface { Decide(cur int, sig float64) int }
type Cooldown interface { AllowUp(time.Time) bool; AllowDown(time.Time) bool }
```

---

## Hard

### Task 16 — Implement a PID controller

Build a `PID` struct with `Step(measured float64, now time.Time) float64`. Tune to maintain utilization at 0.7. Add anti-windup. Test with synthetic load.

**Goal:** experience control theory in practice.

**Hint:** see senior chapter for the formula. Start with `Kp=10, Ki=0.5, Kd=1.0`. Tune by observation.

---

### Task 17 — Multi-pool with shared budget

Build two pools sharing a `Budget` struct. Each autoscaler requests growth from the budget; if granted, grows. The budget enforces a global maximum.

**Goal:** coordinated scaling across pools.

**Hint:** budget has `Request(n) int` (granted) and `Release(n)`. Hold a mutex internally.

---

### Task 18 — Predictive scaling

Implement a time-of-day scheduler: at 09:00, pre-warm pool to 50; at 18:00, allow shrink to 5. Combine with reactive autoscaler. The pool target is `max(predicted, reactive)`.

**Goal:** layered autoscaling.

**Hint:** use `time.Now().Hour()` in a goroutine that calls Resize at scheduled times. The reactive autoscaler runs as before.

---

### Task 19 — Build a chaos test

Inject 5% panic rate in tasks. Inject 10% slow tasks (5x normal duration). Run for 5 minutes. Verify:
- No goroutine leak (`goleak`)
- Pool doesn't crash
- Latency remains bounded
- Autoscaler doesn't oscillate

**Goal:** test resilience.

**Hint:** `if rand.Float64() < 0.05 { panic("test") }` inside task. `if rand.Float64() < 0.10 { time.Sleep(5x) }`.

---

### Task 20 — Production-ready autoscaler

Combine everything: ants + wait-time signal + AIMD + cooldowns + Prometheus metrics + panic recovery + graceful shutdown + manual override CLI. Document policies. Write tests.

**Goal:** a deployable autoscaler.

**Hint:** review the production-grade example in middle.md. Adapt to your workload.

---

## Solutions / Sketches

### Task 1 sketch

```go
jobs := make(chan int, 100)
var wg sync.WaitGroup
for i := 0; i < 8; i++ {
    wg.Add(1)
    go func() {
        defer wg.Done()
        for j := range jobs {
            fmt.Println(j)
            time.Sleep(10*time.Millisecond)
        }
    }()
}
for i := 0; i < 100; i++ { jobs <- i }
close(jobs)
wg.Wait()
```

### Task 2 sketch

```go
type Pool struct {
    jobs chan func()
    target, live int32
    mu sync.Mutex
    wg sync.WaitGroup
}

func (p *Pool) Resize(target int) {
    p.mu.Lock(); defer p.mu.Unlock()
    old := atomic.LoadInt32(&p.live)
    atomic.StoreInt32(&p.target, int32(target))
    if int32(target) > old {
        for i := old; i < int32(target); i++ {
            atomic.AddInt32(&p.live, 1)
            p.wg.Add(1)
            go p.worker()
        }
    }
}

func (p *Pool) worker() {
    defer p.wg.Done()
    for {
        if atomic.LoadInt32(&p.live) > atomic.LoadInt32(&p.target) {
            atomic.AddInt32(&p.live, -1)
            return
        }
        select {
        case task, ok := <-p.jobs:
            if !ok { atomic.AddInt32(&p.live, -1); return }
            task()
        }
    }
}
```

### Task 3 sketch

```go
func (p *Pool) Autoscale(ctx context.Context) {
    t := time.NewTicker(500*time.Millisecond)
    defer t.Stop()
    var lastUp, lastDown time.Time
    for {
        select {
        case <-ctx.Done(): return
        case now := <-t.C:
            depth := float64(len(p.jobs)) / float64(cap(p.jobs))
            cur := int(atomic.LoadInt32(&p.live))
            switch {
            case depth > 0.75 && cur < 32 && now.Sub(lastUp) > 2*time.Second:
                p.Resize(cur + 2); lastUp = now
            case depth < 0.10 && cur > 2 && now.Sub(lastDown) > 30*time.Second:
                p.Resize(cur - 1); lastDown = now
            }
        }
    }
}
```

### Task 4 sketch

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

### Task 5 sketch

```go
type WaitTracker struct {
    mu sync.Mutex
    samples []time.Duration
    cap int
    idx int
    full bool
}

func (w *WaitTracker) Record(d time.Duration) {
    w.mu.Lock(); defer w.mu.Unlock()
    w.samples[w.idx] = d
    w.idx = (w.idx + 1) % w.cap
    if w.idx == 0 { w.full = true }
}

func (w *WaitTracker) P99() time.Duration {
    w.mu.Lock()
    n := w.idx
    if w.full { n = w.cap }
    cp := make([]time.Duration, n)
    copy(cp, w.samples[:n])
    w.mu.Unlock()
    sort.Slice(cp, func(i, j int) bool { return cp[i] < cp[j] })
    if n == 0 { return 0 }
    return cp[int(float64(n-1)*0.99)]
}
```

### Task 6 sketch

In the autoscaler, replace queue-depth check with:
```go
p99 := tracker.P99()
mean := tracker.Mean()
switch {
case p99 > 500*time.Millisecond && /* cooldown */: grow
case mean < 20*time.Millisecond && /* cooldown */: shrink
}
```

### Task 7 sketch

```go
p, _ := ants.NewPool(8, ants.WithExpiryDuration(60*time.Second))
defer p.Release()

func autoscale(p *ants.Pool) {
    // similar logic, using p.Tune(n)
}
```

### Task 8 sketch

Replace `Resize(cur+2)` with `Resize(cur+1)`. Replace `Resize(cur-1)` with `Resize(cur - cur/4)` (ensure at least 1 minimum step).

### Task 9 sketch

```go
type EWMA struct { value, alpha float64; primed bool }
func (e *EWMA) Add(v float64) {
    if !e.primed { e.value = v; e.primed = true; return }
    e.value = e.alpha*v + (1-e.alpha)*e.value
}
func (e *EWMA) Value() float64 { return e.value }
```

In the autoscaler, feed wait time through EWMA before threshold check.

### Task 10 sketch

```go
var poolSize = promauto.NewGauge(prometheus.GaugeOpts{Name: "pool_size"})
// ... etc

http.Handle("/metrics", promhttp.Handler())
go http.ListenAndServe(":8080", nil)

// in autoscaler:
poolSize.Set(float64(p.Size()))
```

### Task 11 sketch

```go
func loadGen(p *Pool, duration time.Duration) {
    phases := []struct{ rate int; duration time.Duration }{
        {100, 60*time.Second}, {2000, 60*time.Second}, {100, 60*time.Second},
    }
    for _, ph := range phases {
        interval := time.Second / time.Duration(ph.rate)
        ticker := time.NewTicker(interval)
        timer := time.NewTimer(ph.duration)
        for {
            select {
            case <-ticker.C:
                p.Submit(func() {
                    time.Sleep(time.Duration(30+rand.Intn(90))*time.Millisecond)
                })
            case <-timer.C:
                ticker.Stop()
                goto next
            }
        }
    next:
    }
}
```

### Task 12 sketch

Multi-signal logic in middle.md and senior.md. Apply priority rules.

### Task 13 sketch

```go
type Cooldown struct {
    UpAfter, DownAfter time.Duration
    lastUp, lastDown time.Time
}

func (c *Cooldown) AllowUp(now time.Time) bool { return now.Sub(c.lastUp) >= c.UpAfter }
func (c *Cooldown) AllowDown(now time.Time) bool { return now.Sub(c.lastDown) >= c.DownAfter }
func (c *Cooldown) RecordUp(now time.Time) { c.lastUp = now }
func (c *Cooldown) RecordDown(now time.Time) { c.lastDown = now }
```

Test:
```go
c := Cooldown{UpAfter: time.Second}
now := time.Now()
assert(!c.AllowUp(now))  // initially false because lastUp is zero — actually true if zero time is far past
c.RecordUp(now)
assert(!c.AllowUp(now.Add(500*time.Millisecond)))
assert(c.AllowUp(now.Add(2*time.Second)))
```

### Task 14 sketch

```go
func (p *Pool) workerWithIdle() {
    timer := time.NewTimer(p.idleTimeout)
    defer timer.Stop()
    for {
        select {
        case task, ok := <-p.jobs:
            if !ok { return }
            timer.Stop()
            task()
            timer.Reset(p.idleTimeout)
        case <-timer.C:
            if atomic.LoadInt32(&p.live) > p.floor {
                atomic.AddInt32(&p.live, -1)
                return
            }
            timer.Reset(p.idleTimeout)
        }
    }
}
```

### Task 15 sketch

```go
type Autoscaler struct {
    Pool   Resizer
    Signal Signal
    Decider Decider
    Cooldown Cooldown
    Interval time.Duration
}

func (a *Autoscaler) Run(ctx context.Context) {
    t := time.NewTicker(a.Interval)
    for {
        select {
        case <-ctx.Done(): return
        case now := <-t.C:
            cur := a.Pool.Size()
            target := a.Decider.Decide(cur, a.Signal.Value())
            // check cooldown, Resize, record
        }
    }
}
```

### Task 16 sketch

See senior.md for full implementation. Test by driving with a known set-point and observing convergence.

### Task 17 sketch

```go
type Budget struct {
    mu sync.Mutex
    capacity, used int
}
func (b *Budget) Request(n int) int {
    b.mu.Lock(); defer b.mu.Unlock()
    avail := b.capacity - b.used
    granted := min(n, avail)
    b.used += granted
    return granted
}
func (b *Budget) Release(n int) {
    b.mu.Lock(); defer b.mu.Unlock()
    b.used -= n
    if b.used < 0 { b.used = 0 }
}
```

In autoscaler:
```go
grant := budget.Request(2)
if grant > 0 {
    p.Resize(cur + grant)
}
```

### Task 18 sketch

```go
func patternedSizing(p *Pool, now time.Time) int {
    h := now.Hour()
    if h >= 9 && h < 18 { return 50 }
    return 5
}

// in autoscaler:
predictedTarget := patternedSizing(p, now)
reactiveTarget := computeReactive(...)
target := max(predictedTarget, reactiveTarget)
p.Resize(target)
```

### Task 19 sketch

```go
task := func() {
    if rand.Float64() < 0.05 { panic("chaos") }
    sleep := 10 * time.Millisecond
    if rand.Float64() < 0.10 { sleep *= 5 }
    time.Sleep(sleep)
}

// run for 5 min
// verify with goleak at end:
goleak.VerifyNone(t)
```

### Task 20 sketch

This is the capstone. Combine everything from the previous tasks:
- ants pool
- WaitTracker + EWMA
- AIMD decider
- Cooldown
- Prometheus metrics
- panic recovery in tasks (ants does this)
- graceful shutdown via context
- HTTP endpoint for manual override (`POST /pool/manual?size=N`)

Document policies in a README. Test under chaos.

The final code is roughly 400-600 lines. Worth the investment; this is what production looks like.

---

If you complete all 20 tasks, you have built a production-grade dynamic worker pool autoscaler. Use it as a reference for real systems.
