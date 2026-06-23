---
layout: default
title: Find Bug
parent: Ticker
grand_parent: Time-Based Concurrency
ancestor: Go
nav_order: 9
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/16-time-based-concurrency/01-ticker/find-bug/
---

# time.Ticker — Find the Bug

> Each snippet below compiles and looks plausible. Each one has a real production-grade bug rooted in how `time.Ticker` behaves: a forgotten `Stop`, a `Reset` race, a slow consumer silently dropping ticks, a leaked ticker hidden in an early return, a `Stop` called in the wrong order. Read the code, predict what goes wrong, then check the explanation. The fixes are the boring part — the *pattern recognition* is what you are training.

---

## Bug 1 — Forgotten `Stop` on every request

```go
package server

import (
    "net/http"
    "time"
)

func (s *Server) handleStream(w http.ResponseWriter, r *http.Request) {
    ticker := time.NewTicker(1 * time.Second)
    flusher := w.(http.Flusher)

    for {
        select {
        case <-ticker.C:
            w.Write([]byte("ping\n"))
            flusher.Flush()
        case <-r.Context().Done():
            return
        }
    }
}
```

**Find the bug.** Where does the leak live?

**Root cause.** When the client disconnects, `r.Context().Done()` fires, the handler returns, and the ticker is *abandoned but never stopped*. On Go versions before 1.23 the runtime held a strong reference to the ticker through its internal timer heap; the ticker continued to fire forever, the goroutine that owned it was already gone, and the runtime kept sending values into a channel nobody read. Over a million requests that is a million orphaned timers, each consuming a timer-heap slot and a buffered channel.

Go 1.23 made unreferenced tickers reclaimable by the GC, which mitigates the symptom on modern runtimes. The fix is still correct on every version, and there is no reason to rely on the GC to clean up a resource you explicitly own.

**Fix.**

```go
ticker := time.NewTicker(1 * time.Second)
defer ticker.Stop()
```

`defer ticker.Stop()` immediately after construction is the canonical pattern. Make it muscle memory: every `NewTicker` line should be followed by a `defer Stop` line, in the same way every `Open` is followed by a `defer Close`.

**Verification.** Run the handler in a loop with `go test -race` and `runtime.NumGoroutine()` snapshots. Before the fix, goroutine count grows linearly with requests on pre-1.23 Go. After the fix, it stays flat.

---

## Bug 2 — `Reset` race with an unread tick

```go
type Sampler struct {
    t       *time.Ticker
    current time.Duration
}

func NewSampler(d time.Duration) *Sampler {
    return &Sampler{t: time.NewTicker(d), current: d}
}

func (s *Sampler) SetInterval(d time.Duration) {
    s.t.Reset(d)
    s.current = d
}

func (s *Sampler) Loop() {
    for tick := range s.t.C {
        process(tick)
    }
}
```

**Find the bug.** What can the consumer observe after `SetInterval(1 * time.Hour)` is called?

**Root cause.** `Reset` changes the interval but does *not* drain the channel. If a tick from the *old* interval was already buffered in `s.t.C` when `Reset` ran, the consumer reads that stale tick *after* the reset, at a time much closer to the old cadence than to the new one. In a metric system that switches from 100 ms sampling to 1 hour sampling, the first post-reset tick may arrive ~100 ms later, not ~1 hour later. The system then waits the full hour for the second tick. Plotted, you get one tightly bunched pair of samples followed by silence — and you spend an afternoon wondering why your dashboard looks like that.

There is also a benign-looking concurrency issue: `s.current` is written by the caller of `SetInterval` and read by the consumer (in this snippet it is not read, but in real code it usually is). Without a mutex this is a data race that `go run -race` catches.

**Fix.** Either drain the channel non-blockingly before `Reset`, or accept the stale tick and document it.

```go
func (s *Sampler) SetInterval(d time.Duration) {
    s.t.Reset(d)
    select {
    case <-s.t.C: // drop any stale tick still in the buffer
    default:
    }
    s.current = d
}
```

The drain is best-effort: if a tick arrives *between* the `Reset` and the `select`, it slips through. For most use cases that is acceptable. If exact semantics matter, stop and reconstruct:

```go
func (s *Sampler) SetInterval(d time.Duration) {
    s.t.Stop()
    s.t = time.NewTicker(d)
    s.current = d
}
```

That trades a tiny allocation for unambiguous behavior. For a sampler that resets once per hour, the allocation is invisible.

**Verification.** Construct a sampler at 10 ms, sleep 50 ms (so several ticks queue), call `SetInterval(1 * time.Second)`, and read three ticks. Before the fix, the first tick arrives almost immediately. After the fix, it arrives ~1 s later.

---

## Bug 3 — Slow consumer silently drops ticks

```go
func collectMetrics(ctx context.Context, sink Sink) {
    t := time.NewTicker(100 * time.Millisecond)
    defer t.Stop()

    for {
        select {
        case <-ctx.Done():
            return
        case now := <-t.C:
            // expensive: ~250ms when downstream is degraded
            sink.Send(now, snapshot())
        }
    }
}
```

**Find the bug.** What does the metric backend actually see?

**Root cause.** `Ticker.C` is buffered with capacity 1. When the consumer is slower than the interval, the runtime *drops* every tick that arrives while the buffer is occupied — it does not queue them. With a 100 ms interval and a 250 ms handler, the consumer effectively sees ~4 ticks/sec instead of 10 ticks/sec, and the timestamps it reads are *delivery* times, not the *intended* tick times. Your dashboard shows fewer samples than expected, and your alerting on "metric absence" misfires.

This is the single most common ticker bug in real Go code, because the runtime makes the drop silent. Nothing in the standard library tells you a tick was lost. You only notice because the data is wrong.

**Fix.** Move the slow work off the ticker goroutine.

```go
func collectMetrics(ctx context.Context, sink Sink) {
    t := time.NewTicker(100 * time.Millisecond)
    defer t.Stop()

    work := make(chan time.Time, 16)
    go func() {
        for now := range work {
            sink.Send(now, snapshot())
        }
    }()
    defer close(work)

    for {
        select {
        case <-ctx.Done():
            return
        case now := <-t.C:
            select {
            case work <- now:
            default:
                // backlog full; log and skip rather than block the ticker
            }
        }
    }
}
```

Now the ticker loop never blocks: it forwards the tick to a buffered worker channel and immediately returns to the `select`. If the worker is genuinely slow, the *worker* falls behind (and you can see that via the `default` branch hit count), but the ticker itself keeps producing on schedule.

The deeper lesson: a `time.Ticker` measures wall time, not work-completed time. If your handler can take longer than the interval, you must either widen the interval, parallelize the work, or accept dropped ticks explicitly.

**Verification.** Wrap `sink.Send` with a `metrics.Inc("collector.tick")`. Before the fix, you see ~4 increments per second. After the fix, ~10.

---

## Bug 4 — Leaked ticker hidden in an early return

```go
func WaitForReady(ctx context.Context, probe func() bool) error {
    t := time.NewTicker(200 * time.Millisecond)

    for {
        if probe() {
            return nil // BUG: ticker still running
        }
        select {
        case <-ctx.Done():
            t.Stop()
            return ctx.Err()
        case <-t.C:
        }
    }
}
```

**Find the bug.** Which exit path leaks?

**Root cause.** The author remembered to `Stop` on the `ctx.Done()` path but forgot the `return nil` path. Every successful probe leaks a ticker. In a typical service startup this function is called dozens of times — once per dependency check, once per warm-up step — and the leaks accumulate quickly.

The structural mistake is mixing two cleanup paths in one function. With one `defer t.Stop()` at the top, both exits are handled.

**Fix.**

```go
func WaitForReady(ctx context.Context, probe func() bool) error {
    t := time.NewTicker(200 * time.Millisecond)
    defer t.Stop()

    for {
        if probe() {
            return nil
        }
        select {
        case <-ctx.Done():
            return ctx.Err()
        case <-t.C:
        }
    }
}
```

Always pair `NewTicker` with `defer Stop` on the *same* level. Never leave any return path uncovered. If you find yourself reaching for an explicit `t.Stop()` mid-function, you are about to write this bug.

**Verification.** `go vet` does not catch this. A custom lint rule against "any `time.NewTicker` not followed by `defer .Stop()` within five lines" would. Alternatively, run the function in a loop in a test that asserts `runtime.NumGoroutine()` is stable.

---

## Bug 5 — `Stop` does not close the channel

```go
func heartbeat(d time.Duration, done <-chan struct{}) {
    t := time.NewTicker(d)
    go func() {
        <-done
        t.Stop()
    }()
    for tick := range t.C {
        send(tick)
    }
    log.Println("heartbeat exited")
}
```

**Find the bug.** When does "heartbeat exited" print?

**Root cause.** `Ticker.Stop()` stops *future* sends to `t.C` — it does *not* close the channel. The `for tick := range t.C` loop therefore blocks forever after `Stop` is called, because `range` only exits when the channel is closed. The goroutine that called `heartbeat` is leaked. "heartbeat exited" never prints.

This is one of the most counter-intuitive corners of the ticker API. The naive mental model — "Stop ends iteration, like closing a channel" — is wrong, and the standard library does not push you toward the correct pattern. The correct pattern is `select` with a `done` branch, not `for range`.

**Fix.** Replace the `for range` with a `select`.

```go
func heartbeat(d time.Duration, done <-chan struct{}) {
    t := time.NewTicker(d)
    defer t.Stop()
    for {
        select {
        case tick := <-t.C:
            send(tick)
        case <-done:
            log.Println("heartbeat exited")
            return
        }
    }
}
```

Now the loop exits when `done` closes. `defer t.Stop()` cleans up the ticker on every exit path. The shape — `for { select { case <-t.C ...: case <-done: return } }` — is the canonical ticker loop. Memorize it.

**Verification.** Without the fix, `pprof goroutine` shows the leaked goroutine parked on `chanrecv1` from `time.Tick.go`. With the fix, the goroutine count returns to baseline after `done` closes.

---

## Bug 6 — `time.Tick` in a long-lived function

```go
func RunForever(ctx context.Context) {
    for {
        select {
        case <-time.Tick(1 * time.Second):
            doWork()
        case <-ctx.Done():
            return
        }
    }
}
```

**Find the bug.** What grows unboundedly?

**Root cause.** `time.Tick(d)` is a *package-level helper* that constructs a new `Ticker` every time it is called and returns only the receive channel — there is no way to call `Stop`. In a `select` inside a `for` loop, `time.Tick(1 * time.Second)` is evaluated *on every iteration of the loop*. Each iteration leaks a fresh ticker. Over an hour you have 3600 leaked tickers; over a day, 86 400.

The Go documentation specifically warns: "The underlying Ticker cannot be recovered by the garbage collector; it leaks." (On Go 1.23+ unreferenced tickers can be reclaimed, but the lifetime semantics are still surprising and you should not rely on them.)

There is a second, subtler issue: a fresh ticker on each iteration restarts the timer from zero. The interval-between-ticks is *measured from the moment of the `select`*, not from a fixed schedule. If `doWork()` takes 800 ms, your "1 Hz" loop runs at roughly 1 / 1.8 Hz.

**Fix.** Construct the ticker once, outside the loop, and use a `select` on its channel.

```go
func RunForever(ctx context.Context) {
    t := time.NewTicker(1 * time.Second)
    defer t.Stop()
    for {
        select {
        case <-t.C:
            doWork()
        case <-ctx.Done():
            return
        }
    }
}
```

The rule: `time.Tick` is acceptable in tiny scripts that run for the lifetime of the program. In a daemon, a server, a long-lived background task — never. Use `time.NewTicker` and `Stop` properly.

**Verification.** Run the buggy version for ten seconds and call `runtime.GC()`; on older Go versions the ticker count grows in `runtime/metrics`. The fix keeps the count constant at 1.

---

## Bug 7 — `Stop` from the wrong goroutine, after a panic

```go
func RunPeriodic(d time.Duration, fn func()) {
    t := time.NewTicker(d)
    go func() {
        for tick := range t.C {
            fn(tick) // BUG type-mismatch placeholder; assume fn takes time.Time
        }
    }()
    defer t.Stop()
}
```

**Find the bug.** When does `t.Stop()` actually run, and what is `fn` then doing?

**Root cause.** `defer t.Stop()` runs when `RunPeriodic` returns, which is essentially immediately — the function launches a goroutine and returns. So `t.Stop()` fires *while the goroutine is still running*. After `Stop`, `t.C` is no longer fed with new ticks, but the *currently buffered* tick (if any) is still readable. The `for range` reads it, runs `fn`, then blocks forever waiting for a tick that never arrives. Goroutine leaked.

Worse, the function offers no way for the caller to stop the periodic work. `Stop` is fired prematurely, but the goroutine *is* leaked because `range` does not exit on `Stop`.

Two bugs in five lines: premature `Stop` *and* `for range` over `t.C`. Both are common; combining them is unfortunately also common.

**Fix.** Return a stop function to the caller, and use `select` with a `done` channel.

```go
func RunPeriodic(d time.Duration, fn func(time.Time)) (stop func()) {
    t := time.NewTicker(d)
    done := make(chan struct{})
    go func() {
        defer t.Stop()
        for {
            select {
            case tick := <-t.C:
                fn(tick)
            case <-done:
                return
            }
        }
    }()
    return func() { close(done) }
}
```

Now `Stop` is owned by the goroutine itself (`defer t.Stop()` inside the goroutine), and the caller decides when to terminate by calling the returned `stop()`. Lifetimes are explicit.

**Verification.** Call `stop := RunPeriodic(...)`, sleep, call `stop()`. Goroutine count drops back to baseline. Without the fix it never does.

---

## Bug 8 — Per-connection ticker scaled to many connections

```go
type Conn struct {
    keepalive time.Duration
    out       chan []byte
}

func (c *Conn) writePump(ctx context.Context) {
    t := time.NewTicker(c.keepalive)
    defer t.Stop()
    for {
        select {
        case msg := <-c.out:
            write(msg)
        case <-t.C:
            write(pingFrame())
        case <-ctx.Done():
            return
        }
    }
}
```

**Find the bug.** Why does the runtime timer code show up in CPU profiles at 100k connections?

**Root cause.** This is not strictly a *correctness* bug — the code is correct. The bug is in the *scale*. One ticker per connection means that with 100 000 connections, the runtime maintains 100 000 timer-heap entries, each rearmed on every fire. Every tick rearm walks the heap; every operation is `O(log n)` where `n` is the timer count. At 100k tickers, that is 17 operations per fire; with all 100k firing roughly every keepalive interval, the timer subsystem spends a significant share of CPU on heap maintenance.

The fix is not "make `Ticker` faster" — the runtime cannot help you here. The fix is **share a single ticker across connections**.

**Fix.** One central ticker fans out to all connections.

```go
type KeepaliveBus struct {
    mu    sync.Mutex
    subs  map[*Conn]struct{}
}

func (b *KeepaliveBus) Run(ctx context.Context, d time.Duration) {
    t := time.NewTicker(d)
    defer t.Stop()
    for {
        select {
        case <-t.C:
            b.mu.Lock()
            for c := range b.subs {
                select {
                case c.pings <- struct{}{}:
                default: // slow connection; skip rather than block
                }
            }
            b.mu.Unlock()
        case <-ctx.Done():
            return
        }
    }
}
```

Each connection now has a small buffered channel `pings` and a single line in its main `select` that calls `write(pingFrame())` when a ping is delivered. The timer subsystem holds *one* entry instead of `N`.

Production note: this pattern works when all connections share the same keepalive interval. If intervals vary per connection, group connections by interval into a small number of buckets and run one ticker per bucket.

**Verification.** `go tool pprof` on the running server: before, `runtime.siftupTimer` is in the top ten. After, it is not in the profile at all.

---

## Bug 9 — `Reset` called on a ticker that was already `Stop`-ed

```go
type Throttle struct {
    t      *time.Ticker
    paused bool
}

func (th *Throttle) Pause() {
    th.t.Stop()
    th.paused = true
}

func (th *Throttle) Resume(d time.Duration) {
    th.t.Reset(d)
    th.paused = false
}
```

**Find the bug.** Why does `Resume` sometimes deliver an immediate, undesired tick?

**Root cause.** Calling `Reset` on a `Stop`-ed ticker re-arms it, but the channel state is ambiguous. If a tick was buffered in `t.C` *before* `Stop` was called and never read, that stale tick is still sitting in the channel after `Reset`. The first read post-`Resume` returns that stale tick *immediately*, not after a wait of `d`. From the throttle's perspective, the rate limit is briefly broken.

Worse, between `Stop` and `Reset` there is a window where another goroutine could call methods on `t` and see undefined behavior. Pre-Go 1.23 the documentation was explicit that `Reset` should not be called after `Stop`; from 1.23 the behavior is defined but the leftover-tick problem remains.

**Fix.** Drain the channel between `Stop` and `Reset`, or just construct a new ticker.

```go
func (th *Throttle) Pause() {
    th.t.Stop()
    select {
    case <-th.t.C:
    default:
    }
    th.paused = true
}

func (th *Throttle) Resume(d time.Duration) {
    th.t.Reset(d)
    th.paused = false
}
```

Or, more conservatively:

```go
func (th *Throttle) Resume(d time.Duration) {
    if th.t != nil {
        th.t.Stop()
    }
    th.t = time.NewTicker(d)
    th.paused = false
}
```

The reconstruct-on-resume version is one tiny allocation per pause/resume cycle, which for a throttle is invisible. It removes a whole class of "stale tick" surprises.

**Verification.** A test that pauses for longer than the interval, then resumes and measures the time to the first tick. Without the fix, the first post-resume tick arrives in ~0 ms; with the fix, in ~`d` ms.

---

## Bug 10 — Ticker created before its `done` channel is wired

```go
func StartCollector(d time.Duration) *Collector {
    c := &Collector{
        ticker: time.NewTicker(d),
    }
    go c.run()
    c.done = make(chan struct{}) // BUG: assigned after goroutine launch
    return c
}

func (c *Collector) run() {
    defer c.ticker.Stop()
    for {
        select {
        case <-c.ticker.C:
            c.sample()
        case <-c.done:
            return
        }
    }
}

func (c *Collector) Close() {
    close(c.done)
}
```

**Find the bug.** What does the race detector say?

**Root cause.** Two related bugs. First, `c.done` is *written* by the constructor after `go c.run()` has already started — the goroutine reads `c.done` (via the `select` case) before the write is guaranteed to have happened. This is a textbook data race, and `go test -race` catches it.

Second, even if the write somehow happens first, the goroutine may have entered the `select` while `c.done` is still nil. A receive on a nil channel blocks forever, which is actually *what you want* for an unselectable case, but it means the `select` has effectively only one case (`<-c.ticker.C`), and `Close` cannot wake it. After `Close`, `close(nil)` panics.

The structural cure is "construct the struct fully *before* spawning the goroutine." Goroutines never observe a partially built struct.

**Fix.**

```go
func StartCollector(d time.Duration) *Collector {
    c := &Collector{
        ticker: time.NewTicker(d),
        done:   make(chan struct{}),
    }
    go c.run()
    return c
}
```

Now `c.done` is fully initialized before the goroutine reads it. The race vanishes. `Close` works correctly. This is the same anti-pattern as "spawn worker before setting required fields" from the goroutines find-bug document — the ticker version is just a specific case of it.

**Verification.** `go test -race -run StartCollector` — without the fix, the race detector flags the read/write of `c.done`. With the fix, clean.

---

## Bug 11 — Computing the next tick by `time.Now()` inside the handler

```go
func every(d time.Duration, fn func()) {
    last := time.Now()
    t := time.NewTicker(d)
    defer t.Stop()
    for {
        <-t.C
        if time.Since(last) < d {
            continue // BUG: throttle on top of a ticker
        }
        fn()
        last = time.Now()
    }
}
```

**Find the bug.** Why does this skip ~half the calls?

**Root cause.** The author has layered a manual "no more often than every `d`" throttle *on top of* a ticker that already fires every `d`. Because timer firing has some scheduling jitter, the second tick often arrives a few microseconds *before* the full `d` has elapsed (the runtime guarantees ticks "at least" every `d`, not "exactly"). The `time.Since(last) < d` check rejects every other tick. Effective firing rate is ~`d / 2`, not `d`.

Worse, `time.Now()` returns a wall clock that can move backwards under NTP adjustments. The `time.Since` check is therefore not even reliable in the direction the author wanted.

**Fix.** Trust the ticker. Do not double-throttle.

```go
func every(d time.Duration, fn func()) {
    t := time.NewTicker(d)
    defer t.Stop()
    for tick := range t.C {
        fn()
        _ = tick
    }
}
```

If you genuinely want jitter-tolerant scheduling — say, "exactly five samples per minute, no matter what" — use a `time.Timer` with `Reset` to the next scheduled wall-clock instant, computed once per tick. That is a different pattern (`schedule-clock`) and belongs in a scheduler library, not glued onto a ticker.

**Verification.** Count calls to `fn` over 10 s with `d = 100 * time.Millisecond`. Before the fix: ~50 calls. After: ~100 calls.

---

## Bug 12 — Two tickers wired into one `select` with copy-paste skew

```go
func Run(ctx context.Context) {
    flush := time.NewTicker(5 * time.Second)
    defer flush.Stop()
    snapshot := time.NewTicker(5 * time.Second) // typo: meant 5 * time.Minute
    defer snapshot.Stop()

    for {
        select {
        case <-flush.C:
            doFlush()
        case <-snapshot.C:
            doSnapshot()
        case <-ctx.Done():
            return
        }
    }
}
```

**Find the bug.** What is wrong with the *behavior*, even though the code compiles cleanly?

**Root cause.** The bug is not a runtime fault but a copy-paste typo: `snapshot` is constructed with `5 * time.Second` instead of `5 * time.Minute`. The compiler is happy, `go vet` is silent, and the program runs without errors. The bug shows up only as "snapshots are 60× more frequent than the spec says," which may manifest as a database hot spot, a billing surprise, or simply a noisy log.

This is a *literal-constant* bug, not a `Ticker` API bug, and it is included here because it accounts for a large share of real-world "ticker bugs" in code review. The structural fix is to extract durations into named constants where the unit is visible at the call site.

**Fix.** Named constants force you to look at the unit when you change it.

```go
const (
    flushInterval    = 5 * time.Second
    snapshotInterval = 5 * time.Minute
)

func Run(ctx context.Context) {
    flush := time.NewTicker(flushInterval)
    defer flush.Stop()
    snapshot := time.NewTicker(snapshotInterval)
    defer snapshot.Stop()

    for {
        select {
        case <-flush.C:
            doFlush()
        case <-snapshot.C:
            doSnapshot()
        case <-ctx.Done():
            return
        }
    }
}
```

Now a future PR that changes `snapshotInterval` does so by editing one line, and reviewers see the unit. The typo class is harder to hit.

**Verification.** Add a unit test that asserts `snapshotInterval >= flushInterval * 10` — a cheap sanity check that catches the typo at compile time of the test.

---

## Final note

Of these twelve bugs, three appear in essentially every Go codebase that uses tickers: the forgotten `Stop` (Bug 1), the slow-consumer dropped tick (Bug 3), and the `for range t.C` leak (Bug 5). Internalize the canonical pattern —

```go
t := time.NewTicker(d)
defer t.Stop()
for {
    select {
    case <-t.C:
        // work
    case <-done:
        return
    }
}
```

— and most of these bugs become unwriteable. The remaining ones — `Reset` races, shared tickers, copy-paste durations — are caught by code review and tests, not by syntax. Train your eye for the patterns: any ticker without a `defer Stop`, any `for range` over `t.C`, any `time.Tick` inside a function that runs longer than a script, any `Reset` not preceded by a drain. Those four red flags catch the bulk of production ticker bugs.

[← Back](../)
