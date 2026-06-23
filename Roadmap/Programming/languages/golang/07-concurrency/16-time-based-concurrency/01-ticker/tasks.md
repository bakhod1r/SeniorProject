---
layout: default
title: Tasks
parent: Ticker
grand_parent: Time-Based Concurrency
ancestor: Go
nav_order: 8
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/16-time-based-concurrency/01-ticker/tasks/
---

# time.Ticker — Hands-on Tasks

> Practical exercises from "build the canonical loop" to "coalesced multi-interval scheduler." Each task gives problem, hints, skeleton, expected output, and rubric. Skeletons target Go 1.21+; 1.23 behaviour changes are called out. Read the problem, try first, peek at hints if stuck, compare against the skeleton (yours need not match), run, then grade with the rubric.

---

## Easy

### Task 1 — First ticker

**Problem.** Create a ticker firing every 200ms; print three ticks with elapsed time since program start; exit.

**Goal.** `NewTicker` + `defer Stop` + receive idiom.

**Hints.** First tick fires *after* 200ms, not at start. Always `defer t.Stop()`.

**Skeleton.**

```go
start := time.Now()
t := time.NewTicker(200 * time.Millisecond)
defer t.Stop()
for i := 0; i < 3; i++ {
    now := <-t.C
    fmt.Printf("tick %d at %dms\n", i, now.Sub(start).Milliseconds())
}
```

**Expected output.** `tick 0 at 200ms`, `tick 1 at 400ms`, `tick 2 at 600ms`.

**Rubric.** `defer t.Stop()` present; three ticks; ~200ms apart; clean exit.

---

### Task 2 — Ticker with context cancellation

**Problem.** Write `heartbeat(ctx, interval)` that prints "alive" each interval until cancelled. From `main`, cancel after 1.5s.

**Goal.** Canonical `select { ctx.Done(); t.C }` pattern.

**Hints.** `select` must include `ctx.Done()`. Use `context.WithTimeout`. `defer t.Stop()`.

**Skeleton.**

```go
func heartbeat(ctx context.Context, interval time.Duration) {
    t := time.NewTicker(interval)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case <-t.C:
            fmt.Println("alive")
        }
    }
}

```

From `main`, build `ctx, cancel := context.WithTimeout(context.Background(), 1500*time.Millisecond)`, defer `cancel()`, call `heartbeat(ctx, 400*time.Millisecond)`, then print `"done"`.

**Expected output.** Three "alive" lines, then "done".

**Rubric.** `defer t.Stop()` present; `ctx.Done()` is a `case`; function returns on cancel; no goroutine leaks (verify with `goleak`).

---

### Task 3 — Leaking ticker

**Problem.** Write `leak()` that spawns a goroutine running a ticker loop with no `Stop` and no cancellation. Call ten times. Print `runtime.NumGoroutine()`. Then fix it with context + `defer Stop` and confirm the count returns to 1.

**Goal.** See goroutine leaks in real time.

**Hints.** A ticker loop with no exit condition never returns. `runtime.NumGoroutine()` confirms it.

**Skeleton (leaking).**

```go
func leak() {
    go func() {
        t := time.NewTicker(time.Second)
        for range t.C {
        }
    }()
}
```

From `main`, call `leak()` ten times, `time.Sleep(100ms)`, then print `runtime.NumGoroutine()`.

**Fix.**

```go
func noLeak(ctx context.Context) {
    go func() {
        t := time.NewTicker(time.Second)
        defer t.Stop()
        for {
            select {
            case <-ctx.Done():
                return
            case <-t.C:
            }
        }
    }()
}
```

**Expected output.** Leaking: `goroutines: 11`. After fix + cancel: `goroutines: 1`.

**Rubric.** Leaking shows 11; fixed returns to 1; can explain why.

---

### Task 4 — Use `time.Tick` and see the limitation

**Problem.** Rewrite heartbeat using `time.Tick`. Try to add cancellation. Notice you cannot stop the underlying ticker.

**Goal.** Understand why `time.Tick` is discouraged.

**Hints.** `time.Tick` returns only the channel; no `Stop`.

**Skeleton.**

```go
func heartbeatTick(ctx context.Context, interval time.Duration) {
    tick := time.Tick(interval)
    for {
        select {
        case <-ctx.Done():
            return // underlying ticker keeps firing forever on pre-1.23
        case <-tick:
            fmt.Println("alive")
        }
    }
}
```

**Expected output.** Same as Task 2 visually; the leak is invisible at user level but real on pre-1.23.

**Rubric.** Can explain why `time.Tick` is dangerous; name acceptable use cases (short scripts, demos); rewrote it as `NewTicker`.

---

## Medium

### Task 5 — Heartbeat with Reset

**Problem.** Build a `Heartbeat` type with `New(initial)`, `Start(ctx, fn)`, `SetInterval(d)`, where the next call is `d` from now, not from the last fire.

**Goal.** `Reset` with proper drain semantics.

**Hints.** Mutex protects concurrent `SetInterval`. Drain after `Reset` for portability.

**Skeleton.**

```go
type Heartbeat struct {
    mu       sync.Mutex
    t        *time.Ticker
    interval time.Duration
}

func New(initial time.Duration) *Heartbeat {
    return &Heartbeat{interval: initial}
}

func (h *Heartbeat) Start(ctx context.Context, fn func()) {
    h.mu.Lock()
    h.t = time.NewTicker(h.interval)
    h.mu.Unlock()
    go func() {
        defer func() {
            h.mu.Lock()
            h.t.Stop()
            h.mu.Unlock()
        }()
        for {
            select {
            case <-ctx.Done():
                return
            case <-h.t.C:
                fn()
            }
        }
    }()
}

func (h *Heartbeat) SetInterval(d time.Duration) {
    h.mu.Lock()
    defer h.mu.Unlock()
    h.interval = d
    if h.t != nil {
        h.t.Reset(d)
        select {
        case <-h.t.C:
        default:
        }
    }
}
```

**Expected output.** Two ticks at 500ms cadence, then 200ms cadence for ~900ms.

**Rubric.** Reset under lock; drain after Reset; `defer t.Stop()`; cancellation works; `-race` clean.

---

### Task 6 — Slow consumer drops ticks

**Problem.** Ticker at 50ms; consumer takes 200ms per iteration. Count ticks over 2 seconds. Compare with theoretical max (40).

**Goal.** Observe tick-dropping semantics.

**Hints.** Runtime never queues more than one tick.

**Skeleton.**

```go
t := time.NewTicker(50 * time.Millisecond)
defer t.Stop()
start := time.Now()
count := 0
for time.Since(start) < 2*time.Second {
    <-t.C
    time.Sleep(200 * time.Millisecond)
    count++
}
fmt.Printf("received %d ticks in 2s\n", count)
```

**Expected output.** `received 10 ticks in 2s` (approximately; 30 dropped).

**Rubric.** Explain why count is 10 not 40 (channel buffer cap + runtime skip-sends).

---

### Task 7 — Drift-free polling

**Problem.** Poll a `func()` every 500ms where the work takes 10–400ms. Show ticker is drift-free; show `time.Sleep` drifts.

**Goal.** Internalise why `Ticker` is drift-free.

**Hints.** Log start time of each poll; compare ticker vs sleep approaches over 5 iterations.

**Skeleton.**

```go
func pollTicker(work func()) {
    start := time.Now()
    t := time.NewTicker(500 * time.Millisecond)
    defer t.Stop()
    for i := 0; i < 5; i++ {
        <-t.C
        fmt.Printf("ticker poll %d at %dms\n", i, time.Since(start).Milliseconds())
        work()
    }
}

func pollDrift(work func()) {
    start := time.Now()
    for i := 0; i < 5; i++ {
        fmt.Printf("drift poll %d at %dms\n", i, time.Since(start).Milliseconds())
        work()
        time.Sleep(500 * time.Millisecond)
    }
}
```

Use `time.Sleep(time.Duration(rand.Intn(400)+10) * time.Millisecond)` as the variable work.

**Expected output.** Ticker version stays at 500ms cadence. Drift version shows times exceeding `500*(i+1)ms` by cumulative work duration.

**Rubric.** Ticker tight at 500ms; sleep drifts visibly; can articulate why (absolute vs relative scheduling).

---

### Task 8 — Jittered ticker

**Problem.** Implement `JitteredTick(ctx, base, jitter, fn)`. Each interval is `base + rand(-jitter, +jitter)`.

**Goal.** Avoid thundering-herd.

**Hints.** Use `Timer` + `Reset`, not `Ticker`. Seed with `time.Now().UnixNano()`.

**Skeleton.**

```go
func JitteredTick(ctx context.Context, base, jitter time.Duration, fn func()) {
    rng := rand.New(rand.NewSource(time.Now().UnixNano()))
    next := func() time.Duration {
        return base + time.Duration(rng.Int63n(int64(jitter*2))) - jitter
    }
    t := time.NewTimer(next())
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case <-t.C:
            fn()
            t.Reset(next())
        }
    }
}
```

**Expected output.** ~15 ticks, intervals in `[150ms, 250ms]`.

**Rubric.** Intervals vary per tick; cancellation works; timer reset (not allocated) per cycle.

---

### Task 9 — Coalesced ticker for many subscribers

**Problem.** Build a `Coalescer` with one underlying ticker and a registry of callbacks; all callbacks fire on each tick.

**Goal.** Save timer-heap entries when many goroutines share a cadence.

**Hints.** `RWMutex` for callback slice. Snapshot under lock, run outside lock.

**Skeleton.**

```go
type Coalescer struct {
    mu        sync.RWMutex
    callbacks []func(time.Time)
}

func NewCoalescer(ctx context.Context, interval time.Duration) *Coalescer {
    c := &Coalescer{}
    go func() {
        t := time.NewTicker(interval)
        defer t.Stop()
        for {
            select {
            case <-ctx.Done():
                return
            case now := <-t.C:
                c.fire(now)
            }
        }
    }()
    return c
}

func (c *Coalescer) Subscribe(fn func(time.Time)) {
    c.mu.Lock()
    c.callbacks = append(c.callbacks, fn)
    c.mu.Unlock()
}

func (c *Coalescer) fire(now time.Time) {
    c.mu.RLock()
    snap := append([]func(time.Time)(nil), c.callbacks...)
    c.mu.RUnlock()
    for _, fn := range snap {
        fn(now)
    }
}
```

**Expected output.** A, B, C printed at each tick (~3 cycles).

**Rubric.** Single ticker; snapshot under lock; cancellation works; `-race` clean; safe to subscribe at runtime.

---

### Task 10 — Reset edge cases

**Problem.** Exercise three Reset cases: longer-interval reset, drain check, slow consumer with short interval after reset. Log tick times and verify cadence.

**Goal.** Subtle Reset semantics.

**Hints.** Drain pattern: `select { case <-t.C: ; default: }`.

**Skeleton.**

```go
t := time.NewTicker(300 * time.Millisecond)
defer t.Stop()
start := time.Now()

<-t.C
fmt.Printf("case1 tick0 at %dms\n", time.Since(start).Milliseconds())
t.Reset(500 * time.Millisecond)
<-t.C
fmt.Printf("case1 tick1 at %dms (expect ~800ms)\n", time.Since(start).Milliseconds())

t.Reset(200 * time.Millisecond)
select {
case <-t.C:
    fmt.Println("case2: drained stale (pre-1.23)")
default:
    fmt.Println("case2: nothing to drain (1.23+)")
}

t.Reset(50 * time.Millisecond)
time.Sleep(400 * time.Millisecond)
received := 0
loop:
for {
    select {
    case <-t.C:
        received++
    default:
        break loop
    }
}
fmt.Printf("case3 received %d ticks (cap 1)\n", received)
```

**Expected output.**

```
case1 tick0 at 300ms
case1 tick1 at 800ms (expect ~800ms)
case2: nothing to drain (1.23+)
case3 received 1 ticks (cap 1)
```

**Rubric.** All three cases match expected; explain version-dependent behaviour; explain channel buffer cap.

---

## Hard

### Task 11 — Drift measurement tool

**Problem.** Run a 100ms ticker for 10s. Compute drift per tick (`actual - expected`). Print min, median, p99, max.

**Goal.** Build intuition for scheduler jitter on your machine.

**Hints.** Expected time of tick `i` is `start + (i+1)*interval`. Sort to compute percentiles.

**Skeleton.**

```go
interval := 100 * time.Millisecond
duration := 10 * time.Second
t := time.NewTicker(interval)
defer t.Stop()
start := time.Now()
var drifts []time.Duration
for i := 0; ; i++ {
    expected := start.Add(time.Duration(i+1) * interval)
    if expected.Sub(start) > duration {
        break
    }
    now := <-t.C
    drifts = append(drifts, now.Sub(expected))
}
sort.Slice(drifts, func(i, j int) bool { return drifts[i] < drifts[j] })
fmt.Printf("n=%d min=%v p50=%v p99=%v max=%v\n",
    len(drifts), drifts[0], drifts[len(drifts)/2],
    drifts[len(drifts)*99/100], drifts[len(drifts)-1])
```

**Expected output (illustrative).** `n=100 min=12µs p50=120µs p99=2.5ms max=8ms`.

**Rubric.** Drifts against absolute schedule; percentiles correct; identify outlier sources (GC, scheduler, kernel).

---

### Task 12 — Replace `time.After` in a hot select loop

**Problem.** Below is a leaky pattern. Refactor with a single ticker (or timer) and explain savings.

```go
for {
    select {
    case <-ctx.Done():
        return
    case m := <-msgs:
        handle(m)
    case <-time.After(time.Second):
        flush()
    }
}
```

**Goal.** Eliminate per-iteration timer allocation.

**Hints.** `time.After` allocates fresh each call; in tight loops they accumulate before GC.

**Fix.**

```go
func consume(ctx context.Context, msgs <-chan string) {
    t := time.NewTicker(time.Second)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case m := <-msgs:
            handle(m)
        case <-t.C:
            flush()
        }
    }
}
```

If you need "1 second since last flush" semantics, use `Timer` + `Reset` after `flush`.

**Expected output.** Same behaviour, zero per-iteration allocation. Verify with `go test -bench` showing `0 B/op` on hot path.

**Rubric.** Uses one ticker/timer; explains Ticker (drift-free) vs Timer.Reset (last-event-relative); ran benchmark.

---

### Task 13 — Production-shape poller

**Problem.** Build `Poller` with: configurable interval + jitter; context cancellation; panic recovery; per-poll duration logging; `Snapshot()` for last successful body.

**Goal.** Combine ticker, jitter, context, recovery, shared-state access.

**Hints.** `RWMutex` for snapshot. `defer recover()` around poll body. Use `Timer + Reset` for jitter.

**Skeleton.**

```go
type Poller struct {
    url      string
    base     time.Duration
    jitter   time.Duration
    mu       sync.RWMutex
    snapshot []byte
}

func (p *Poller) Snapshot() []byte {
    p.mu.RLock()
    defer p.mu.RUnlock()
    out := make([]byte, len(p.snapshot))
    copy(out, p.snapshot)
    return out
}

func (p *Poller) Run(ctx context.Context) {
    rng := rand.New(rand.NewSource(time.Now().UnixNano()))
    next := func() time.Duration {
        return p.base + time.Duration(rng.Int63n(int64(p.jitter*2))) - p.jitter
    }
    t := time.NewTimer(next())
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case <-t.C:
            p.safePoll(ctx)
            t.Reset(next())
        }
    }
}

func (p *Poller) safePoll(ctx context.Context) {
    defer func() {
        if r := recover(); r != nil {
            fmt.Printf("poll panic: %v\n", r)
        }
    }()
    req, _ := http.NewRequestWithContext(ctx, http.MethodGet, p.url, nil)
    res, err := http.DefaultClient.Do(req)
    if err != nil {
        return
    }
    defer res.Body.Close()
    body, err := io.ReadAll(res.Body)
    if err != nil {
        return
    }
    p.mu.Lock()
    p.snapshot = body
    p.mu.Unlock()
}
```

**Expected output.** A few "poll ok" lines at jittered intervals, then final byte count from `Snapshot()`.

**Rubric.** Jitter per tick; panic recovery; `-race` clean; cancellation works; HTTP uses same `ctx`.

---

### Task 14 — Detect ticker leaks in tests

**Problem.** Write a `goleak` test that verifies `Heartbeat` from Task 5 does not leak after cancel. Then remove `defer t.Stop()` and confirm the test fails.

**Goal.** Permanent leak detection in test suite.

**Skeleton.**

```go
package heartbeat_test

import (
    "context"
    "testing"
    "time"

    "go.uber.org/goleak"
)

func TestHeartbeatNoLeak(t *testing.T) {
    defer goleak.VerifyNone(t)
    ctx, cancel := context.WithCancel(context.Background())
    h := New(50 * time.Millisecond)
    h.Start(ctx, func() {})
    time.Sleep(150 * time.Millisecond)
    cancel()
    time.Sleep(100 * time.Millisecond)
}
```

**Expected output.** Clean: `PASS`. Leaky: failure pointing to ticker receive.

**Rubric.** Test passes on correct impl; fails on deliberate leak; stack trace points to ticker receive.

---

### Task 15 — Multi-interval coalesced scheduler

**Problem.** `Scheduler` accepts jobs with different intervals; all run from one goroutine driven by one resettable timer (heap-ordered by next due time).

**Goal.** Timing-wheel-lite from scratch.

**Hints.** Min-heap (`container/heap`) by `nextDue`. After firing, push back with `nextDue += interval` and reset timer to new head.

**Skeleton.**

```go
type job struct {
    interval time.Duration
    nextDue  time.Time
    fn       func()
}

type jobHeap []*job

func (h jobHeap) Len() int            { return len(h) }
func (h jobHeap) Less(i, j int) bool  { return h[i].nextDue.Before(h[j].nextDue) }
func (h jobHeap) Swap(i, j int)       { h[i], h[j] = h[j], h[i] }
func (h *jobHeap) Push(x interface{}) { *h = append(*h, x.(*job)) }
func (h *jobHeap) Pop() interface{}   { old := *h; n := len(old); x := old[n-1]; *h = old[:n-1]; return x }

type Scheduler struct{ jobs jobHeap }

func (s *Scheduler) Add(interval time.Duration, fn func()) {
    heap.Push(&s.jobs, &job{interval: interval, nextDue: time.Now().Add(interval), fn: fn})
}

func (s *Scheduler) Run(ctx context.Context) {
    if len(s.jobs) == 0 {
        return
    }
    timer := time.NewTimer(time.Until(s.jobs[0].nextDue))
    defer timer.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case <-timer.C:
            now := time.Now()
            for len(s.jobs) > 0 && !s.jobs[0].nextDue.After(now) {
                j := heap.Pop(&s.jobs).(*job)
                j.fn()
                j.nextDue = j.nextDue.Add(j.interval)
                heap.Push(&s.jobs, j)
            }
            if len(s.jobs) > 0 {
                timer.Reset(time.Until(s.jobs[0].nextDue))
            }
        }
    }
}
```

Call `Add` with `100ms`, `500ms`, `1s` jobs, then `Run` for 2.5s.

**Expected output.** A runs ~25 times, B ~5, C ~2; interleaved by due-time.

**Rubric.** Single goroutine + single timer; heap orders correctly; cancellation works; note: slow job delays others until it returns.

---

### Task 16 — Adaptive interval

**Problem.** Double the interval each cycle when the polled value is unchanged; reset to base on change. Cap at 8x base.

**Goal.** Back-off ticker that reduces load when nothing changes.

**Hints.** `Timer + Reset`. Track last-observed value.

**Skeleton.**

```go
func AdaptiveTick(ctx context.Context, base time.Duration, poll func() int) {
    interval := base
    max := base * 8
    last := -1
    t := time.NewTimer(interval)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case <-t.C:
            v := poll()
            if v != last {
                interval = base
                last = v
            } else if interval < max {
                interval *= 2
                if interval > max {
                    interval = max
                }
            }
            fmt.Printf("polled %d, next %v\n", v, interval)
            t.Reset(interval)
        }
    }
}
```

**Expected output.** Intervals 100, 200, 400, 800ms, reset to 100ms on value change.

**Rubric.** Doubles when unchanged; caps at 8x; resets on change; `defer t.Stop()`; cancellation works.

---

### Task 17 — Drift-corrected catch-up

**Problem.** After a long GC pause, ticks drop. Detect on next receive how many *should have* fired and call `fn` once per missed tick.

**Goal.** Handle lossy ticker semantics gracefully.

**Hints.** Track `expected = start + N*interval`. `missed = max(0, (now - expected) / interval)`.

**Skeleton.**

```go
func CatchUpTick(ctx context.Context, interval time.Duration, fn func()) {
    expected := time.Now().Add(interval)
    t := time.NewTicker(interval)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case now := <-t.C:
            missed := 0
            for now.Sub(expected) >= interval {
                missed++
                expected = expected.Add(interval)
            }
            expected = expected.Add(interval)
            for i := 0; i <= missed; i++ {
                fn()
            }
        }
    }
}
```

**Expected output.** Logged "caught up: N extra" after a synthetic pause (e.g. force a sleep of 1s in `fn` at iteration 3).

**Rubric.** Schedule against start (not previous tick); `missed` correct; calls `fn` per missed tick.

---

### Task 18 — Real-time observability

**Problem.** `TickStats` wraps a ticker and exports: ticks delivered, ticks dropped, max drift, rolling average drift (last 60 ticks).

**Goal.** Production observability for periodic loops.

**Hints.** Atomic counters for hot path; ring buffer of 60 drifts; drift = `actualReceive - expectedReceive`.

**Skeleton.**

```go
type TickStats struct {
    delivered atomic.Int64
    expected  atomic.Int64
    mu        sync.Mutex
    maxDrift  time.Duration
    drifts    [60]time.Duration
    idx       int
}

func (s *TickStats) Record(drift time.Duration) {
    s.delivered.Add(1)
    s.mu.Lock()
    defer s.mu.Unlock()
    if drift > s.maxDrift {
        s.maxDrift = drift
    }
    s.drifts[s.idx%60] = drift
    s.idx++
}

func (s *TickStats) Dropped() int64 { return s.expected.Load() - s.delivered.Load() }

func (s *TickStats) AvgDrift() time.Duration {
    s.mu.Lock()
    defer s.mu.Unlock()
    n := s.idx
    if n > 60 {
        n = 60
    }
    if n == 0 {
        return 0
    }
    var sum time.Duration
    for i := 0; i < n; i++ {
        sum += s.drifts[i]
    }
    return sum / time.Duration(n)
}

func (s *TickStats) Run(ctx context.Context, interval time.Duration, fn func()) {
    start := time.Now()
    t := time.NewTicker(interval)
    defer t.Stop()
    for i := int64(1); ; i++ {
        select {
        case <-ctx.Done():
            return
        case now := <-t.C:
            expectedAt := start.Add(time.Duration(i) * interval)
            s.expected.Store(int64(now.Sub(start) / interval))
            s.Record(now.Sub(expectedAt))
            fn()
        }
    }
}
```

**Expected output.** `delivered=30 dropped=0 max=2ms avg=200µs` (illustrative).

**Rubric.** Atomic counters; drift against absolute schedule; ring buffer indexed mod 60; `-race` clean.

---

### Task 19 — Compare `Ticker` vs `AfterFunc`

**Problem.** Implement the same periodic job two ways and compare goroutine counts. Run 1 000 instances at 1ms cadence.

**Goal.** Empirical comparison.

**Hints.** `runtime.NumGoroutine()` differs by ~1 000.

**Skeleton (Ticker).** One goroutine per instance, each with its own `time.NewTicker` and `defer t.Stop()`, parked on `<-t.C` in a `select`.

**Skeleton (AfterFunc).** Store `[]*time.Timer`. Each `time.AfterFunc(1ms, fn)` re-arms via `t.Reset(1ms)` inside `fn`. On `ctx.Done()`, call `t.Stop()` for all.

```go
timers := make([]*time.Timer, n)
for i := 0; i < n; i++ {
    i := i
    var fn func()
    fn = func() {
        if ctx.Err() != nil {
            return
        }
        timers[i].Reset(time.Millisecond)
    }
    timers[i] = time.AfterFunc(time.Millisecond, fn)
}
```

**Expected output.** `Ticker` version: 1 000 long-lived parked goroutines. `AfterFunc` version: no long-lived goroutines (runtime spawns short-lived ones per callback).

**Rubric.** Both handle cancellation; compared `NumGoroutine()`; noted `AfterFunc` is harder to test; can pick when to use each.

---

### Task 20 — Real incident reproduction

**Problem.** Reproduce: 50 tickers at 100ms cadence, a 200ms GC pause around `t=5s`. Measure dropped ticks during the pause. Propose two mitigations.

**Goal.** Connect concepts to a real systems debugging exercise.

**Hints.** Use `runtime.GC()` after a heavy allocation to force a pause. Count expected vs received ticks per ticker.

**Skeleton.**

```go
ctx, cancel := context.WithTimeout(context.Background(), 11*time.Second)
defer cancel()
var wg sync.WaitGroup
var dropped atomic.Int64

for i := 0; i < 50; i++ {
    wg.Add(1)
    go func() {
        defer wg.Done()
        t := time.NewTicker(100 * time.Millisecond)
        defer t.Stop()
        start := time.Now()
        ticks := int64(0)
        for {
            select {
            case <-ctx.Done():
                expected := int64(time.Since(start) / (100 * time.Millisecond))
                dropped.Add(expected - ticks)
                return
            case <-t.C:
                ticks++
            }
        }
    }()
}

go func() { // synthetic GC pause around t=5s
    time.Sleep(5 * time.Second)
    for i := 0; i < 100; i++ {
        _ = make([]byte, 10*1024*1024)
    }
    runtime.GC()
}()

wg.Wait()
fmt.Printf("total dropped: %d\n", dropped.Load())
```

**Expected output.** `total dropped: ~50–150` depending on actual pause length.

Mitigations: (1) Coalesce all 50 tickers behind one (Task 9). (2) Reduce GC pause via `GOGC` tuning, batched allocations, or `sync.Pool`.

**Rubric.** Can quantify drops; can describe pause effect on channel sends; proposed mitigation and tested it; can explain why coalescing beats `GOGC` tuning.

---

## Cross-cutting tips

**Drain-then-Reset** — safe across all Go versions:

```go
t.Reset(newInterval)
select { case <-t.C: default: }
```

**Cancellation-safe loop template:**

```go
func loop(ctx context.Context, interval time.Duration, work func() error) error {
    t := time.NewTicker(interval)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            return ctx.Err()
        case <-t.C:
            if err := work(); err != nil {
                return err
            }
        }
    }
}
```

**Jitter** — apply at construction (initial offset) and at each `Reset`:

```go
return base + time.Duration(rng.Int63n(int64(jitter*2))) - jitter
```

**Picking the right primitive:**

| Need | Use |
|---|---|
| Constant cadence; consumer reads in `select` | `time.NewTicker` |
| Variable interval per cycle | `time.NewTimer` + `Reset` |
| One-shot callback after delay | `time.AfterFunc` |
| One-shot value on channel after delay | `time.NewTimer` |
| In a `select` once (with cancellation) | `time.NewTimer`; `time.After` allocates per call |

---

## Final note

These tasks build progressively from "spawn a ticker" to "coalesced multi-interval scheduler with observability." By the end you should be able to use `time.Ticker` confidently in production, recognise the common bugs, choose the right primitive, and debug timing problems with `pprof` and `runtime/trace`. Keep the skeletons; they form a starter library.
