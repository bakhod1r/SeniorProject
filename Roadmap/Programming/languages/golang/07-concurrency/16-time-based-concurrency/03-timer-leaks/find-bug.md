---
layout: default
title: Find Bug
parent: Timer Leaks
grand_parent: Time-Based Concurrency
ancestor: Go
nav_order: 9
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/16-time-based-concurrency/03-timer-leaks/find-bug/
---

# Timer Leaks — Find the Bug

> Every snippet below compiles and looks reasonable at a glance. Each one leaks a `*time.Timer`, a `*time.Ticker`, a callback closure, or a goroutine attached to one of them. Read the code, identify the leak, explain *why* it leaks (not just *that* it leaks), then write the fix. Each entry ends with a verification recipe — a small piece of harness code or pprof query you can run to confirm the fix landed.

The bugs come from real production traffic on Go services running ~Go 1.21–1.23. Where the answer changes between versions, this is called out explicitly.

---

## Bug 1 — `time.After` inside a hot for-select loop

```go
func Consume(ctx context.Context, ch <-chan Event) {
    for {
        select {
        case ev := <-ch:
            handle(ev)
        case <-time.After(5 * time.Second):
            log.Println("idle 5s")
        case <-ctx.Done():
            return
        }
    }
}
```

**Find the bug.** The function looks like a textbook timeout-on-idle loop, but a single `Consume` call running on a busy channel can hold tens of thousands of live timers at once. Where is the leak?

**Root cause.** Every iteration of the loop evaluates `time.After(5 * time.Second)`, which constructs a fresh `*time.Timer` and registers it on the runtime's timer heap. When `ev := <-ch` wins the `select`, the *other* branches are discarded — but `time.After` does not return the timer, so there is no handle to call `Stop` on. The timer remains live on the heap for its full 5-second duration. With one event per millisecond, the loop accumulates ~5 000 idle timers steady-state. On Go versions before 1.23 this is a strict heap leak (the runtime keeps the timer alive even though nothing else references it). From 1.23 onward unreferenced timers can be GC'd, but you still pay for every timer that has not yet fired — RSS swells, the timer heap grows, and `runtime.SemTryAcquire`-style operations on the timer lock get slower.

**Fix.** Construct the timer once and `Reset` it each iteration. Stop the timer before resetting, draining its channel only if `Stop` reports it had already fired:

```go
func Consume(ctx context.Context, ch <-chan Event) {
    t := time.NewTimer(5 * time.Second)
    defer t.Stop()
    for {
        if !t.Stop() {
            select { case <-t.C: default: }
        }
        t.Reset(5 * time.Second)
        select {
        case ev := <-ch:
            handle(ev)
        case <-t.C:
            log.Println("idle 5s")
        case <-ctx.Done():
            return
        }
    }
}
```

On Go 1.23+ the `Stop`/drain dance is no longer required for correctness — `t.Reset(d)` handles the stale-value case itself — but the explicit form is still the safest cross-version pattern.

**Verification.** Run the loop with a synthetic generator that pushes one event per ms for 30 s, then sample `runtime.NumGoroutine()` and `runtime.MemStats.HeapAlloc` before and after. The bug version's `HeapAlloc` climbs monotonically; the fix's stays flat. Or use `go test -run X -trace trace.out` and grep the trace for `GoCreate` events tagged `time.NewTimer` — the bug emits thousands per second; the fix emits exactly one.

---

## Bug 2 — `time.Tick` in a function that can return early

```go
func PollWhileHealthy(ctx context.Context, check func() bool) {
    for range time.Tick(1 * time.Second) {
        if !check() {
            return
        }
    }
}
```

**Find the bug.** The function exits cleanly when `check()` returns false. But every call to `PollWhileHealthy` permanently grows the program's resident memory by the size of one timer wheel entry. Why?

**Root cause.** `time.Tick` returns a `<-chan Time` but no handle to the underlying `*time.Ticker`. The package doc states explicitly: *"The ticker will never be recovered by the garbage collector; it 'leaks'."* When the function returns, the goroutine driving the ticker is still scheduled in the runtime, still firing once per second, still pushing values into a channel nobody reads. On Go 1.23+ unreferenced *timers* can be collected, but `Ticker` is still pinned by its internal sender goroutine — the leak is unchanged across versions.

**Fix.** Use `time.NewTicker` and stop it on return:

```go
func PollWhileHealthy(ctx context.Context, check func() bool) {
    tk := time.NewTicker(1 * time.Second)
    defer tk.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case <-tk.C:
            if !check() {
                return
            }
        }
    }
}
```

`time.Tick` is only ever safe at package scope for a process-lifetime ticker — any function-local use is a leak.

**Verification.** Call `PollWhileHealthy` 1 000 times in a loop with `check` returning false after one tick. Compare `runtime.NumGoroutine()` before and after. The bug version grows by ~1 000; the fix stays flat. `go test -run X -gcflags=-m` will also show the ticker escaping to the heap with no cleanup path.

---

## Bug 3 — `AfterFunc` callback keeps the receiver alive

```go
type Session struct {
    id      string
    buf     []byte // 1 MiB per session
    expired bool
}

func (s *Session) ScheduleExpiry(d time.Duration) {
    time.AfterFunc(d, func() {
        s.expired = true
    })
}
```

**Find the bug.** A server creates 10 000 sessions/sec and calls `ScheduleExpiry(24 * time.Hour)`. The `Session` objects are otherwise unreferenced after the request handler returns. Heap memory grows at 10 GB/sec. Why doesn't the GC reclaim them?

**Root cause.** `time.AfterFunc` returns a `*time.Timer` whose internal `r.arg` field holds the closure. The closure captures `s` (the receiver). The runtime's timer heap holds a strong reference to the timer until it fires. Therefore the timer pins the closure, the closure pins `s`, and `s.buf` (1 MiB) is kept alive for the full 24 hours — even though no application code holds a reference to the session. Multiply by 10 000/sec × 86 400 sec/day = 864 million live sessions, each holding 1 MiB.

**Fix.** Detach the closure from the heavy state. Store only the key needed to look the session up, and rely on a separate session table that the timer callback indexes into:

```go
var sessions sync.Map // map[string]*Session

func (s *Session) ScheduleExpiry(d time.Duration) {
    id := s.id
    time.AfterFunc(d, func() {
        if v, ok := sessions.Load(id); ok {
            v.(*Session).expired = true
        }
    })
}
```

Now the closure captures only `id` (a string header, ~16 bytes). The `Session` itself can be GC'd as soon as `sessions.Delete(id)` is called elsewhere. If you also want the timer to be cancellable on early session close, store the returned `*time.Timer` on the session and call `Stop` in `Close`.

**Verification.** Run pprof:

```
go test -bench=. -benchtime=10s -memprofile=mem.prof
go tool pprof -alloc_space mem.prof
(pprof) top -cum
```

The bug version shows `time.AfterFunc` and `(*Session).ScheduleExpiry` dominating `inuse_space`. The fix drops them out of the top 20.

---

## Bug 4 — `Reset` without `Stop` on a fired timer

```go
type Heartbeat struct {
    t *time.Timer
}

func (h *Heartbeat) Bump() {
    h.t.Reset(30 * time.Second)
}
```

**Find the bug.** The timer is shared across many `Bump` callers. Occasionally the heartbeat fires *immediately* after a `Bump`, even though `Bump` resets it to 30 seconds in the future. Why?

**Root cause.** Before Go 1.23, `(*Timer).Reset` documented an explicit precondition: *"Reset should always be invoked on stopped or expired timers with drained channels."* If the timer has already fired but the value sitting in `t.C` has not yet been received, calling `Reset` does *not* discard the stale value. The very next reader of `t.C` sees the *old* expiration, mistakes it for a new one, and triggers heartbeat logic prematurely. On Go 1.23+ `Reset` does drain the stale value itself, but only for timers created with `NewTimer` — `AfterFunc` timers and `time.After` results still need the older idiom for cross-version code.

**Fix.** Stop, drain, then reset:

```go
func (h *Heartbeat) Bump() {
    if !h.t.Stop() {
        select {
        case <-h.t.C:
        default:
        }
    }
    h.t.Reset(30 * time.Second)
}
```

`Stop` returns false when the timer had already fired or been stopped. In that case `t.C` may or may not hold a buffered value (it holds one if the firing happened but nobody read it; it does not if a reader already drained it). The non-blocking `select` covers both possibilities.

On Go 1.23+ a plain `h.t.Reset(30 * time.Second)` is sufficient; document the minimum Go version explicitly if you rely on the new semantics.

**Verification.** A regression test that calls `Bump` immediately after the timer fires and asserts the next fire is at least 29.9 seconds later. Run it under `-race` for good measure — `Reset` racing with the runtime's firing path is a well-known data race source.

---

## Bug 5 — `time.After` channel never drained after `select` lost

```go
func Fetch(ctx context.Context, url string) (Response, error) {
    resultCh := make(chan Response, 1)
    go func() { resultCh <- doFetch(url) }()
    select {
    case r := <-resultCh:
        return r, nil
    case <-time.After(2 * time.Second):
        return Response{}, errTimeout
    case <-ctx.Done():
        return Response{}, ctx.Err()
    }
}
```

**Find the bug.** Looks correct. But under load with mostly-fast responses, profiling shows hundreds of MiB of live `time.NewTimer` allocations. Why?

**Root cause.** The `time.After(2 * time.Second)` call allocates a `*time.Timer` every invocation. When `resultCh` wins the select, the timer is *not stopped* — `time.After` returns only the channel, not the timer handle. The timer continues to live in the runtime's heap until it fires 2 seconds later. With 10 000 RPS and ~100 % success rate, ~20 000 idle timers are live at any moment. On Go versions before 1.23 these are pinned by the runtime; from 1.23 onward they can be GC'd if nothing else references the channel — but the channel *is* on the goroutine's stack until the function returns, which it just did, so the channel is collectable. The timer body, however, is not pinned by the channel; the *runtime* pins it. Net result: leak in all current versions until the timer fires.

**Fix.** Promote the timer to a variable and `Stop` it on the happy path:

```go
func Fetch(ctx context.Context, url string) (Response, error) {
    resultCh := make(chan Response, 1)
    go func() { resultCh <- doFetch(url) }()
    t := time.NewTimer(2 * time.Second)
    defer t.Stop()
    select {
    case r := <-resultCh:
        return r, nil
    case <-t.C:
        return Response{}, errTimeout
    case <-ctx.Done():
        return Response{}, ctx.Err()
    }
}
```

`defer t.Stop()` is the one-liner that converts "leak until fire" into "released on function exit." Even if the timer already fired, `Stop` is safe to call; it just returns false.

**Verification.** Set up a load test at 10 000 RPS, run for 30 s, then read `runtime.MemStats.HeapInuse`. The bug version steady-states at ~20 000 × sizeof(Timer) ≈ 4 MiB of timer bodies plus the heap entries; the fix steady-states near zero. `go tool pprof -inuse_space` on a heap profile will show `time.NewTimer` near the top in the bug version and absent in the fix.

---

## Bug 6 — Ticker stopped only on the happy path

```go
func Stream(ctx context.Context, out chan<- Stat) error {
    tk := time.NewTicker(1 * time.Second)
    for {
        select {
        case <-ctx.Done():
            tk.Stop()
            return ctx.Err()
        case t := <-tk.C:
            s, err := readStat()
            if err != nil {
                return err // BUG: ticker not stopped
            }
            out <- Stat{T: t, V: s}
        }
    }
}
```

**Find the bug.** When `readStat` returns an error, the function returns and the caller logs the error. After 24 hours of intermittent `readStat` failures, the process holds ~50 000 goroutines and the timer heap has 50 000 entries. Why?

**Root cause.** Only the `ctx.Done()` branch calls `tk.Stop()`. The error-return path bypasses it. The `*time.Ticker` and its driving goroutine remain live, firing into `tk.C` forever (the channel has buffer 1, so writes succeed at first and then silently drop, but the goroutine keeps running). One ticker leak per failed `Stream` call.

**Fix.** Use `defer tk.Stop()` so every return path is covered:

```go
func Stream(ctx context.Context, out chan<- Stat) error {
    tk := time.NewTicker(1 * time.Second)
    defer tk.Stop()
    for {
        select {
        case <-ctx.Done():
            return ctx.Err()
        case t := <-tk.C:
            s, err := readStat()
            if err != nil {
                return err
            }
            out <- Stat{T: t, V: s}
        }
    }
}
```

This is the same rule as `defer file.Close()`: any resource with a cleanup method should be `defer`-cleaned on the line it is acquired, not opportunistically released on specific exit paths.

**Verification.** Inject 100 forced-error `Stream` calls and check `runtime.NumGoroutine()` and `len(runtime.MemStats.BySize)` for the timer-sized bucket. The bug version grows linearly with calls; the fix stays flat. `goleak.VerifyNone(t)` in the test catches the bug immediately.

---

## Bug 7 — `time.AfterFunc` returned timer ignored, no `Stop` on cancel

```go
type Job struct {
    cancelled atomic.Bool
}

func (j *Job) ScheduleRetry(after time.Duration) {
    time.AfterFunc(after, func() {
        if j.cancelled.Load() {
            return
        }
        j.run()
    })
}

func (j *Job) Cancel() {
    j.cancelled.Store(true)
}
```

**Find the bug.** Calling `Cancel` makes the retry a no-op, which is correct. But on a queue of 1 M short-lived jobs scheduled 1 hour out and almost all cancelled within seconds, the heap holds 1 M live closures and 1 M live `*time.Timer` entries for the next hour. Why does cancellation not free them?

**Root cause.** Setting `j.cancelled = true` only changes a flag; it does not stop the timer. The runtime still holds the timer alive until its scheduled firing time. The closure still captures `j`. So `j` (and any state it points to) is pinned for the full hour, even though logically the work is done.

**Fix.** Store the timer handle and call `Stop` from `Cancel`:

```go
type Job struct {
    mu     sync.Mutex
    timer  *time.Timer
    cancel atomic.Bool
}

func (j *Job) ScheduleRetry(after time.Duration) {
    j.mu.Lock()
    defer j.mu.Unlock()
    j.timer = time.AfterFunc(after, func() {
        if j.cancel.Load() {
            return
        }
        j.run()
    })
}

func (j *Job) Cancel() {
    j.cancel.Store(true)
    j.mu.Lock()
    if j.timer != nil {
        j.timer.Stop()
    }
    j.mu.Unlock()
}
```

The flag is still useful as a race-safe guard against firings that have already been dispatched but not yet executed; the `Stop` call prevents future firings and releases the timer immediately.

**Verification.** Schedule 100 000 retries 1 hour out, cancel them all, then read `runtime.NumGoroutine()` and `runtime.MemStats.HeapInuse`. The bug version retains the closures and timer bodies for an hour; the fix drops them to near zero within one GC cycle (`runtime.GC()` makes this immediate).

---

## Bug 8 — `time.After` in a select that may panic before firing

```go
func WithDeadline(d time.Duration, f func() error) error {
    done := make(chan error, 1)
    go func() {
        defer func() {
            if r := recover(); r != nil {
                done <- fmt.Errorf("panic: %v", r)
            }
        }()
        done <- f()
    }()
    select {
    case err := <-done:
        return err
    case <-time.After(d):
        return errors.New("timeout")
    }
}
```

**Find the bug.** Looks correct. But profiling under bursty traffic shows steady growth in the timer heap. Why does this pattern leak even though `done` almost always wins?

**Root cause.** Same shape as Bug 5 but harder to spot — the timer is constructed by `time.After(d)` and is never stopped. When `done` wins, the timer continues to sit on the runtime heap until `d` elapses. If `d` is large (say 30 seconds) and the caller is fast (1 ms typical), every call leaves a timer behind for ~30 seconds. At 1 000 calls/second × 30 s, the heap holds ~30 000 unreferenced timer bodies.

**Fix.** Same as Bug 5 — promote to `NewTimer` and `defer t.Stop()`:

```go
func WithDeadline(d time.Duration, f func() error) error {
    done := make(chan error, 1)
    go func() {
        defer func() {
            if r := recover(); r != nil {
                done <- fmt.Errorf("panic: %v", r)
            }
        }()
        done <- f()
    }()
    t := time.NewTimer(d)
    defer t.Stop()
    select {
    case err := <-done:
        return err
    case <-t.C:
        return errors.New("timeout")
    }
}
```

A general rule: any `time.After(d)` inside a function called more than once per second with a `d` greater than ~10× the typical call duration is a latent leak. Promote unconditionally.

**Verification.** Run `WithDeadline(30*time.Second, fast)` in a loop at 1 000 RPS for 60 seconds, then diff `runtime.MemStats.HeapInuse` against a baseline. The bug grows; the fix is flat.

---

## Bug 9 — Stopping a ticker but leaving its driver goroutine

```go
func StartReporter(ctx context.Context) {
    tk := time.NewTicker(1 * time.Second)
    go func() {
        for t := range tk.C {
            report(t)
        }
    }()
    go func() {
        <-ctx.Done()
        tk.Stop()
    }()
}
```

**Find the bug.** When `ctx` is cancelled, `tk.Stop()` is called — yet `runtime.NumGoroutine()` shows the reporter goroutine still alive after the parent exits. Why?

**Root cause.** `(*time.Ticker).Stop` does *not* close `tk.C`. The reporter's `for t := range tk.C` loop continues to block on the channel waiting for the next tick that will never come. The ticker stops firing, but the goroutine reading from it is permanently parked. It is not technically the *timer* that leaks (the runtime can release the ticker body), but the reading goroutine and any state it captures.

**Fix.** Pair the ticker with the context inside the reader, not in a separate goroutine:

```go
func StartReporter(ctx context.Context) {
    tk := time.NewTicker(1 * time.Second)
    go func() {
        defer tk.Stop()
        for {
            select {
            case <-ctx.Done():
                return
            case t := <-tk.C:
                report(t)
            }
        }
    }()
}
```

Now `ctx.Done()` exits the loop, `defer tk.Stop()` releases the ticker, and the goroutine returns cleanly.

**Verification.** Cancel the parent context, wait 100 ms, and assert `runtime.NumGoroutine()` returned to baseline. `goleak.VerifyNone(t)` flags the bug version immediately.

---

## Bug 10 — `time.Sleep` inside a goroutine you cannot cancel

```go
func Retry(ctx context.Context, f func() error, max int) error {
    var err error
    for i := 0; i < max; i++ {
        if err = f(); err == nil {
            return nil
        }
        time.Sleep(time.Duration(i) * time.Second) // exponential-ish backoff
    }
    return err
}
```

**Find the bug.** Not a *timer-heap* leak in the strict sense, but a related class — a leaked goroutine. The function takes `ctx` but never reads from it. After `ctx` is cancelled with `max = 10` and a 9-second `i=9` sleep, the goroutine sits in `time.Sleep` for 9 seconds doing nothing. Multiplied across cancelled requests, this is a goroutine leak — and the parked goroutine pins all its captured state (the closure `f`, any large arguments it captures, etc.).

**Root cause.** `time.Sleep` is uninterruptible. Once the goroutine is parked in it, only the clock can wake it. A polite cancellation path requires a `select` against `ctx.Done()`:

```go
func Retry(ctx context.Context, f func() error, max int) error {
    var err error
    for i := 0; i < max; i++ {
        if err = f(); err == nil {
            return nil
        }
        wait := time.Duration(i) * time.Second
        t := time.NewTimer(wait)
        select {
        case <-ctx.Done():
            t.Stop()
            return ctx.Err()
        case <-t.C:
        }
    }
    return err
}
```

`time.NewTimer` plus a stop on the cancel path is the canonical interruptible-sleep pattern. `time.After` would work here too, but `NewTimer` lets us explicitly `Stop` on the early-return path and avoids the leak from Bug 1.

**Verification.** Cancel the context immediately after calling `Retry(ctx, alwaysErr, 10)`. The bug version takes ~45 seconds (1+2+…+9) to return; the fix returns within one scheduler tick.

---

## Bug 11 — `time.AfterFunc` with a self-referencing reset

```go
type Watchdog struct {
    timeout time.Duration
    timer   *time.Timer
}

func (w *Watchdog) Start() {
    w.timer = time.AfterFunc(w.timeout, func() {
        log.Println("watchdog tripped")
        w.timer.Reset(w.timeout) // BUG
    })
}

func (w *Watchdog) Stop() {
    w.timer.Stop()
}
```

**Find the bug.** The watchdog seems to fire periodically — but every now and then, especially under heavy load, it fires twice in rapid succession. Where is the race?

**Root cause.** Inside an `AfterFunc` callback, `w.timer` may not yet be the value the constructor returned: `time.AfterFunc` returns a `*time.Timer`, and the assignment `w.timer = time.AfterFunc(...)` happens *after* the function call returns. If the timer fires extremely quickly (with a small enough `timeout` or with the goroutine descheduled at the wrong instant), the callback reads `w.timer` while `Start` has not yet finished assigning it. Worse, even after the assignment, the callback calling `Reset` from within a callback context is documented to be a race against any concurrent `Stop` — and the runtime can dispatch the callback on a fresh goroutine, so `Reset` may overlap with itself.

**Fix.** Don't reset from inside the callback; use a ticker for periodic firing, or use a goroutine that loops on a single timer:

```go
func (w *Watchdog) Start(ctx context.Context) {
    go func() {
        t := time.NewTimer(w.timeout)
        defer t.Stop()
        for {
            select {
            case <-ctx.Done():
                return
            case <-t.C:
                log.Println("watchdog tripped")
                t.Reset(w.timeout)
            }
        }
    }()
}
```

For periodic firing, a `*time.Ticker` is almost always preferable to a self-resetting `AfterFunc`. Reserve `AfterFunc` for one-shot deferred work where you do not want to hold a goroutine in `Sleep`.

**Verification.** Run the bug version with `timeout = 1 * time.Millisecond` for 10 seconds; you will see double-firings in the log. The fix never double-fires. Under `-race`, the bug version raises a data race report on the `w.timer` field.

---

## Bug 12 — Per-connection timer field never released on close

```go
type Conn struct {
    idleTimer *time.Timer
    closed    bool
}

func (c *Conn) ResetIdle() {
    if c.closed {
        return
    }
    if c.idleTimer == nil {
        c.idleTimer = time.AfterFunc(60*time.Second, c.onIdle)
    } else {
        c.idleTimer.Reset(60 * time.Second)
    }
}

func (c *Conn) Close() {
    c.closed = true
    // BUG: idleTimer not stopped
}
```

**Find the bug.** Long-lived servers close millions of connections per day. Heap profiles show `time.AfterFunc` and the `Conn.onIdle` method value retaining gigabytes long after the connections in question are gone. Why?

**Root cause.** `Close` sets `closed = true` but never stops `idleTimer`. The timer continues to live on the runtime timer heap, holds the closure (which captures `c` via the method value `c.onIdle`), and pins the `Conn` and all its buffers. When the timer eventually fires, `c.onIdle` sees `c.closed == true` and returns immediately — but only after pinning the connection for up to 60 seconds. At a million closes/day with 60-second timeouts, this is ~60 GB of zombie memory steady-state.

**Fix.** Stop the timer in `Close`:

```go
func (c *Conn) Close() {
    c.closed = true
    if c.idleTimer != nil {
        c.idleTimer.Stop()
        c.idleTimer = nil
    }
}
```

The `idleTimer = nil` after `Stop` is belt-and-braces: it ensures the closure (and any field it captures via the method value) becomes unreachable as soon as `Close` returns, even if the timer fires anyway and runs the closure to completion. The `c.closed` guard inside `onIdle` should remain — it covers the small window between `Stop` returning false (already fired) and the closure actually executing.

**Verification.** Build a stress test that opens and closes 100 000 connections, then runs `runtime.GC()` and reads `runtime.MemStats.HeapInuse`. The bug version stays elevated for ~60 seconds before draining; the fix returns to baseline immediately after GC.

---

## Putting it together

Across all twelve bugs, three patterns dominate:

1. **`time.After` in a loop or hot path.** It returns only a channel; the underlying timer has no `Stop`-handle. Promote to `NewTimer`, `defer Stop`, and `Reset` on each iteration. (Bugs 1, 5, 8.)
2. **`Ticker` not stopped on every return path.** `defer tk.Stop()` immediately after `NewTicker`. (Bugs 2, 6, 9.)
3. **Long-running `AfterFunc` callbacks that capture heavy state.** The timer pins the closure, the closure pins the state, the runtime pins the timer. Detach the capture (Bug 3), store the timer handle and `Stop` on cancel (Bugs 7, 12), and never `Reset` from inside the callback (Bug 11). Pair with a `Stop`-on-reset dance on pre-1.23 Go (Bug 4) or rely on the new `Reset` semantics if your minimum version is 1.23+.

For a leak-detection pipeline:

- `goleak.VerifyNone(t)` at the end of every concurrent test catches Bugs 2, 6, 9, 10 immediately.
- `go test -memprofile=mem.prof` plus `go tool pprof -inuse_space` catches Bugs 1, 3, 5, 7, 8, 12 — look for `time.NewTimer`, `time.AfterFunc`, or `time.startTimer` in the top 10.
- The `-race` detector catches Bug 4 and Bug 11.
- For Bug 11 and any other "callback resets itself" pattern, prefer a `Ticker` or a single goroutine looping on `t.C` and calling `Reset` from outside the firing context.

Memorise the four-line `Stop`/drain/`Reset` idiom; every Go developer will write it many times over the course of a career.
