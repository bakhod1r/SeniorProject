---
layout: default
title: Find the Bug
parent: Dynamic Worker Scaling
grand_parent: Production Patterns
ancestor: Go
nav_order: 9
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/18-production-patterns/02-dynamic-worker-scaling/find-bug/
---

# Dynamic Worker Scaling — Find the Bug

> Each snippet contains a real bug: a race, an oscillation, a leak, a logic error, a missing cooldown, or a deadlock. Find it, explain it, fix it.

---

## Bug 1 — Non-atomic counter

```go
type Pool struct {
    target int32
    live   int32
    jobs   chan func()
}

func (p *Pool) Resize(target int) {
    p.target = int32(target)
    old := p.live
    if int32(target) > old {
        for i := old; i < int32(target); i++ {
            p.live++
            go p.worker()
        }
    }
}
```

**Bug.** `p.target = int32(target)`, `p.live++`, and `old := p.live` are all non-atomic operations on shared state. Concurrent calls to `Resize` race. Workers reading `live` see stale values. The race detector flags this.

**Fix.** Use `sync/atomic`:

```go
func (p *Pool) Resize(target int) {
    atomic.StoreInt32(&p.target, int32(target))
    old := atomic.LoadInt32(&p.live)
    if int32(target) > old {
        for i := old; i < int32(target); i++ {
            atomic.AddInt32(&p.live, 1)
            go p.worker()
        }
    }
}
```

Wrap with a mutex for serial Resize execution.

---

## Bug 2 — No floor, pool drops to zero

```go
func (p *Pool) Autoscale() {
    ticker := time.NewTicker(500 * time.Millisecond)
    for range ticker.C {
        depth := float64(len(p.jobs)) / float64(cap(p.jobs))
        cur := p.Size()
        if depth < 0.10 {
            p.Resize(cur - 1)
        }
    }
}
```

**Bug.** No floor check. During off-peak, the pool shrinks to 0. Next request blocks forever (no workers to drain the channel).

**Fix.** Add a floor:

```go
const floor = 4
if depth < 0.10 && cur > floor {
    p.Resize(cur - 1)
}
```

Also: no cooldown; will shrink every tick. Add cooldown.

---

## Bug 3 — wg.Add inside the goroutine

```go
func (p *Pool) Resize(target int) {
    p.mu.Lock()
    defer p.mu.Unlock()
    old := atomic.LoadInt32(&p.live)
    atomic.StoreInt32(&p.target, int32(target))
    if int32(target) > old {
        for i := old; i < int32(target); i++ {
            atomic.AddInt32(&p.live, 1)
            go func() {
                p.wg.Add(1)
                defer p.wg.Done()
                p.workerLoop()
            }()
        }
    }
}
```

**Bug.** `p.wg.Add(1)` is inside the goroutine. The Close method may call `wg.Wait()` before the goroutine has started. `Wait` returns immediately; Close completes; spawned goroutines run on a closed pool.

**Fix.** Always Add before `go`:

```go
atomic.AddInt32(&p.live, 1)
p.wg.Add(1)
go func() {
    defer p.wg.Done()
    p.workerLoop()
}()
```

---

## Bug 4 — Oscillation: same threshold for up and down

```go
const threshold = 0.5

if depth > threshold {
    p.Resize(p.Size() + 1)
} else if depth < threshold {
    p.Resize(p.Size() - 1)
}
```

**Bug.** Single threshold causes flapping. When depth is near 0.5, every tick triggers a resize. Pool size oscillates rapidly.

**Fix.** Hysteresis: different thresholds for up and down:

```go
if depth > 0.75 {
    p.Resize(p.Size() + 1)
} else if depth < 0.10 {
    p.Resize(p.Size() - 1)
}
```

A deadband between 0.10 and 0.75 prevents flapping.

---

## Bug 5 — No cooldown

```go
ticker := time.NewTicker(100 * time.Millisecond)
for range ticker.C {
    if shouldGrow() {
        p.Resize(p.Size() + 4)
    }
}
```

**Bug.** Without cooldown, the autoscaler may resize every tick. During a sustained high signal, the pool grows by 4 every 100 ms — within 1 second, it has grown by 40.

**Fix.** Add cooldown:

```go
var lastUp time.Time
for now := range ticker.C {
    if shouldGrow() && now.Sub(lastUp) > 2 * time.Second {
        p.Resize(p.Size() + 4)
        lastUp = now
    }
}
```

---

## Bug 6 — Sending on a closed channel

```go
func (p *Pool) Submit(task func()) {
    p.jobs <- task
}

func (p *Pool) Close() {
    close(p.jobs)
}

// Caller:
go pool.Submit(task)
go pool.Close()
```

**Bug.** If `Close` runs first (closes the channel), then `Submit` panics: send on closed channel. There's no synchronization between Submit and Close.

**Fix.** Use a closing flag:

```go
type Pool struct {
    jobs    chan func()
    closing atomic.Bool
}

func (p *Pool) Submit(task func()) error {
    if p.closing.Load() { return ErrPoolClosed }
    select {
    case p.jobs <- task: return nil
    default: return ErrPoolFull
    }
}

func (p *Pool) Close() {
    p.closing.Store(true)
    // wait for in-flight Submits
    // then drain and close
}
```

Or use `recover` in Submit (acceptable for some patterns).

---

## Bug 7 — Forgotten recover

```go
func (p *Pool) worker() {
    for task := range p.jobs {
        task()
    }
}
```

**Bug.** If a task panics, the worker goroutine dies. The recovery does not happen because there is no `defer recover()`. The pool's live count is not decremented; eventually all workers die from accumulated panics; the pool stops processing.

**Fix.** Wrap each task in a recover:

```go
func (p *Pool) worker() {
    for task := range p.jobs {
        p.safeRun(task)
    }
}

func (p *Pool) safeRun(task func()) {
    defer func() {
        if r := recover(); r != nil {
            log.Printf("worker recovered: %v", r)
        }
    }()
    task()
}
```

---

## Bug 8 — Multiple autoscaler goroutines

```go
func StartService() {
    pool := NewPool()
    for i := 0; i < runtime.NumCPU(); i++ {
        go autoscaler(pool)
    }
}
```

**Bug.** Multiple autoscalers ticking on the same pool. They each read signals, make decisions, call Resize. They fight: one wants to grow, another wants to shrink. Pool oscillates wildly.

**Fix.** Single autoscaler:

```go
go autoscaler(pool)
```

If you need parallelism for signal collection, do it within one autoscaler goroutine. The decision and Resize call must be serialized.

---

## Bug 9 — Resize during Close

```go
func (p *Pool) Close() {
    close(p.quit)
    p.wg.Wait()
}

func (p *Pool) Resize(target int) {
    p.mu.Lock()
    defer p.mu.Unlock()
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
```

**Bug.** If `Close` runs concurrently with `Resize`, Resize may spawn workers after Close has closed `quit`. The new workers see `quit` closed immediately and exit, but they were spawned anyway — wasted work and possible WaitGroup issue if `wg.Add` is called after `wg.Wait()` started.

**Fix.** Track closing state:

```go
func (p *Pool) Resize(target int) {
    p.mu.Lock()
    defer p.mu.Unlock()
    if p.closing { return }
    // ... rest unchanged
}

func (p *Pool) Close() {
    p.mu.Lock()
    p.closing = true
    close(p.quit)
    p.mu.Unlock()
    p.wg.Wait()
}
```

---

## Bug 10 — Forgetting to update lastUp on success

```go
var lastUp time.Time

for now := range ticker.C {
    if shouldGrow() && now.Sub(lastUp) > cooldown {
        p.Resize(p.Size() + 1)
        // BUG: lastUp not updated
    }
}
```

**Bug.** `lastUp` is never updated. The cooldown never applies. The autoscaler grows every tick.

**Fix.** Update after Resize:

```go
if shouldGrow() && now.Sub(lastUp) > cooldown {
    p.Resize(p.Size() + 1)
    lastUp = now
}
```

---

## Bug 11 — Shrink without minimum step

```go
func decide(cur int) int {
    if signalLow() {
        return cur - cur/4  // multiplicative shrink: -25%
    }
    return cur
}
```

**Bug.** For small `cur` (e.g., 3), `cur/4 = 0`. The decision returns `cur` unchanged. The pool never shrinks below 3 even when it should.

For `cur = 1`, `cur/4 = 0`. Stays at 1.

**Fix.** Enforce minimum step:

```go
func decide(cur int) int {
    if signalLow() {
        step := cur / 4
        if step < 1 { step = 1 }
        return cur - step
    }
    return cur
}
```

---

## Bug 12 — PID integral windup

```go
type PID struct {
    Kp, Ki, Kd, Setpoint float64
    integral, lastError float64
    lastTime time.Time
}

func (p *PID) Step(measured float64, now time.Time) float64 {
    err := measured - p.Setpoint
    dt := now.Sub(p.lastTime).Seconds()
    p.integral += err * dt
    deriv := (err - p.lastError) / dt
    p.lastError = err
    p.lastTime = now
    return p.Kp*err + p.Ki*p.integral + p.Kd*deriv
}
```

**Bug.** No anti-windup. If the pool is at ceiling and error stays positive (more growth needed but can't), integral grows without bound. When ceiling-pressure releases, integral term causes massive overshoot.

**Fix.** Clamp integral:

```go
const integralMax = 100
const integralMin = -100

p.integral += err * dt
if p.integral > integralMax { p.integral = integralMax }
if p.integral < integralMin { p.integral = integralMin }
```

Or pause integration during saturation:

```go
if !atSaturation {
    p.integral += err * dt
}
```

---

## Bug 13 — Time.After in a loop

```go
func (p *Pool) Autoscale(ctx context.Context) {
    for {
        select {
        case <-ctx.Done(): return
        case <-time.After(500 * time.Millisecond):
            // ... decision logic
        }
    }
}
```

**Bug.** `time.After` allocates a new timer on every iteration. Over millions of ticks, this is GC pressure. The timer also is not stopped when the select picks another case.

**Fix.** Use `time.NewTicker`:

```go
t := time.NewTicker(500 * time.Millisecond)
defer t.Stop()
for {
    select {
    case <-ctx.Done(): return
    case <-t.C:
        // ... decision
    }
}
```

---

## Bug 14 — Forgetting to seed lastUp

```go
type Autoscaler struct {
    lastUp time.Time  // zero value: 0001-01-01 00:00:00 UTC
}

func (a *Autoscaler) tick(now time.Time) {
    if now.Sub(a.lastUp) > a.upCooldown && shouldGrow() {
        // immediately grows because lastUp is zero
        a.pool.Resize(...)
        a.lastUp = now
    }
}
```

**Bug.** On first tick, `lastUp` is the zero time. `now.Sub(zero)` is huge (>year). The cooldown is "exceeded." Pool grows immediately.

This may be desired, but is often surprising. Engineers expecting "first grow allowed only after first cooldown" are caught off guard.

**Fix.** Either accept the behavior (document it) or seed lastUp at autoscaler start:

```go
func (a *Autoscaler) Run(ctx context.Context) {
    a.lastUp = time.Now()  // seed
    // ... rest
}
```

---

## Bug 15 — Closing channel from multiple goroutines

```go
func (p *Pool) Close() {
    close(p.quit)
}

// Called by user code:
go pool.Close()
go pool.Close()
```

**Bug.** Closing an already-closed channel panics. If `Close` is called twice (perhaps by mistake from different goroutines), the second call panics.

**Fix.** Use `sync.Once`:

```go
type Pool struct {
    quit     chan struct{}
    closeOnce sync.Once
}

func (p *Pool) Close() {
    p.closeOnce.Do(func() {
        close(p.quit)
    })
}
```

---

## Bug 16 — Resize uses int but the pool is int32

```go
func (p *Pool) Resize(target int) {
    atomic.StoreInt32(&p.target, int32(target))
}

// later, in worker:
if p.live > p.target { return }  // compares int with int32?
```

**Bug.** Mixing `int` and `int32` may compile but lead to surprising overflow on 32-bit platforms. On 64-bit, `int` is 8 bytes; on 32-bit, 4 bytes. A pool resize with `int = 2^31` overflows on 32-bit.

Less common today but still a real issue for embedded Go.

**Fix.** Use a consistent type. Either `int` everywhere (with non-atomic-int) or `int32` for atomic.

```go
type Pool struct {
    target int32
    live   int32
}

func (p *Pool) Resize(target int32) {  // use int32 in signature
    atomic.StoreInt32(&p.target, target)
}
```

---

## Solutions (review)

If you found 10+ bugs, you understand the topic. Common themes:

- Atomic operations: race conditions on shared state
- Synchronization: mutex placement and cooldown tracking
- Lifecycle: Close vs Resize races, panic recovery
- Logic: hysteresis, cooldown, minimum step sizes
- Control: PID windup

Each bug is a real production pattern. Recognizing them in your own code saves incidents.
