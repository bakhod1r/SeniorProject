---
layout: default
title: Interview
parent: Debounce and Throttle
grand_parent: Time-Based Concurrency
ancestor: Go
nav_order: 7
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/16-time-based-concurrency/05-debounce-throttle/interview/
---

# Debounce and Throttle — Interview Questions

> Practice questions ranging from junior to staff-level. Each has a model answer, common wrong answers, and follow-up probes. Every code sample compiles against Go 1.22+.

---

## Junior

### Q1. What is the difference between debounce and throttle?

**Model answer.** Both reduce the rate of events flowing through a system, but they answer different questions.

- A **debouncer** waits for silence. After the last event in a burst, it counts down a quiet period of duration `w` and fires once at the end. If a new event arrives during the wait, the timer restarts. Output rate is at most one event per burst.
- A **throttler** enforces a maximum frequency. It permits events at rate `r` per second (with optional burst `b`) and drops, queues, or blocks the rest. Output rate is at most `r * L + b` over any window of length `L`.

Use *debounce* when only the latest value matters and the input is bursty (a search box, a window resize). Use *throttle* when downstream has a hard budget (an API with a quota, a log writer with a target throughput).

**Common wrong answers.**

- "Debounce drops, throttle queues." (Both come in drop, queue, and block flavours.)
- "Throttle is just a slow debounce." (No — throttle fires *while* the burst is happening; debounce waits for it to end.)

**Follow-up.** *Which fires more often, given a constant input?* — A throttle fires at rate `r`. A debouncer never fires under truly constant input (unless `max-wait` is added).

---

### Q2. Write the simplest trailing-edge debouncer.

**Model answer.**

```go
package main

import (
    "sync"
    "time"
)

type Debouncer struct {
    mu    sync.Mutex
    wait  time.Duration
    timer *time.Timer
    f     func()
}

func New(wait time.Duration, f func()) *Debouncer {
    return &Debouncer{wait: wait, f: f}
}

func (d *Debouncer) Trigger() {
    d.mu.Lock()
    defer d.mu.Unlock()
    if d.timer != nil {
        d.timer.Stop()
    }
    d.timer = time.AfterFunc(d.wait, d.f)
}
```

The trick: `Stop` the previous timer (it may have already fired, which is fine — `AfterFunc` callbacks that have already started will still run), then create a new one. Under the mutex, this is race-free.

**Follow-up.** *What if `f` itself takes longer than `wait`?* — A second `Trigger` during the run will queue another fire after `wait`, but `f` is still running. You may end up with two concurrent `f` invocations. If that is unsafe, the caller must serialise `f` itself (mutex inside `f`, or run on a single worker goroutine).

---

### Q3. What is wrong with this throttle?

```go
ticker := time.NewTicker(time.Second)
for range events {
    <-ticker.C
    process()
}
```

**Model answer.** Three problems:

1. **No `ticker.Stop()`.** The ticker leaks runtime memory until program exit.
2. **No context.** If the caller wants to cancel, there is no path.
3. **Throughput coupling.** `process()` runs synchronously; if it takes longer than one second, the loop emits events more slowly than the ticker fires, defeating the throttle's intent. Worse, the ticker channel drops ticks (capacity 1), so when `process` finally finishes, only one tick is waiting, not the queued ones.

**Fix.**

```go
ticker := time.NewTicker(time.Second)
defer ticker.Stop()
for {
    select {
    case <-ctx.Done():
        return ctx.Err()
    case e, ok := <-events:
        if !ok {
            return nil
        }
        select {
        case <-ctx.Done():
            return ctx.Err()
        case <-ticker.C:
        }
        process(e)
    }
}
```

**Follow-up.** *What is `time.After` doing differently?* — `time.After(d)` allocates a fresh `Timer` and channel each call. Inside a hot loop it leaks until expiry. Prefer `NewTicker` (or `rate.Limiter`) for repeated waits.

---

### Q4. What is the simplest rate limit using `golang.org/x/time/rate`?

**Model answer.**

```go
import "golang.org/x/time/rate"

lim := rate.NewLimiter(rate.Every(100*time.Millisecond), 5)
for _, event := range events {
    if !lim.Allow() {
        continue // drop
    }
    process(event)
}
```

Ten events per second, burst of five. The first five events fire immediately; the rest are rate-limited.

**Common wrong answer.** "Just `time.Sleep` between events." That works for a single producer but does not generalise (no fairness across producers, no burst capacity, no context integration).

**Follow-up.** *What does `burst = 5` mean?* — At process start the bucket holds five tokens, so the first five `Allow` calls succeed without any wait. After that, tokens refill at rate `r`.

---

### Q5. What does this print?

```go
lim := rate.NewLimiter(rate.Every(time.Second), 1)
for i := 0; i < 3; i++ {
    fmt.Println(lim.Allow())
}
```

**Model answer.** `true`, `false`, `false`. The bucket starts with one token. The first `Allow` consumes it. The next two run inside the same nanosecond — no time has elapsed for the bucket to refill — so both fail.

**Follow-up.** *What if `burst` were 3?* — All three would print `true`. The burst capacity dominates short bursts.

---

### Q6. Why is `time.After` dangerous in a `select` loop?

**Model answer.** Each call to `time.After(d)` allocates a fresh `*Timer` and channel. If the surrounding `select` triggers on another case before the timer fires, the timer is *not* garbage-collected — the runtime keeps it alive until `d` elapses. Under high event rate, this is a slow leak.

```go
for {
    select {
    case e := <-events:
        process(e)
    case <-time.After(time.Second): // LEAK
        log.Println("idle")
    }
}
```

Each non-timeout iteration leaks a timer. The fix is to declare the timer outside the loop and reset it:

```go
t := time.NewTimer(time.Second)
defer t.Stop()
for {
    select {
    case e := <-events:
        process(e)
        if !t.Stop() {
            <-t.C
        }
        t.Reset(time.Second)
    case <-t.C:
        log.Println("idle")
        t.Reset(time.Second)
    }
}
```

Go 1.23+ simplifies `Reset` (the drain step is no longer needed).

**Follow-up.** *Is this fixed in Go 1.23?* — Yes for memory: an unreferenced `*Timer` is now GC-able. But the allocations on each call remain, so the loop is still wasteful even if no longer a hard leak.

---

### Q7. When would you reach for debounce over throttle in a UI?

**Model answer.** Three rules:

- **Search-as-you-type.** Debounce. You want to send one request after the user stops typing, not one per keystroke.
- **Resize listener.** Debounce. You want one final layout pass, not one per pixel of drag.
- **Submit button against double-click.** Debounce or single-shot disable. A throttle would let the second click through after `1/r` seconds, which is rarely desired.
- **Telemetry events streamed to a backend.** Throttle. You want a steady output rate, not silence.

**Follow-up.** *What is the right `wait` for a search box?* — 200–400 ms is the typical window. Below 100 ms feels like no debounce; above 500 ms feels laggy.

---

## Middle

### Q8. Implement a leading-edge debouncer.

**Model answer.**

```go
type LeadingDebouncer struct {
    mu       sync.Mutex
    wait     time.Duration
    f        func()
    cooldown time.Time
}

func (d *LeadingDebouncer) Trigger() {
    d.mu.Lock()
    now := time.Now()
    if now.Before(d.cooldown) {
        d.mu.Unlock()
        return
    }
    d.cooldown = now.Add(d.wait)
    d.mu.Unlock()
    d.f()
}
```

The trick: fire *immediately* on the first event of a burst, then suppress subsequent events until `wait` elapses. No timer is needed; we just track when the cooldown ends.

**Follow-up.** *What is the trade-off vs trailing edge?* — Leading edge fires fast (good for click handlers); trailing edge fires with fresh state (good for "save the latest version"). For "both edges," fire on the leading edge and arm a timer to fire again on trailing.

---

### Q9. Why is this `Reset` pattern buggy on Go <1.23?

```go
if d.timer != nil {
    d.timer.Reset(d.wait)
} else {
    d.timer = time.AfterFunc(d.wait, d.f)
}
```

**Model answer.** `Reset` on an `AfterFunc` timer that has already fired (or is about to) does not cancel the in-flight callback. The previous `f` may run, *then* the new one fires `wait` later — two fires for what should have been one. Worse, `Reset` returns `false` when the timer was active, *true* when it was inactive, which the code ignores.

**Safe pre-1.23 pattern:**

```go
if d.timer != nil {
    d.timer.Stop()      // best-effort cancel
}
d.timer = time.AfterFunc(d.wait, d.f)
```

`Stop` prevents the callback from running *if it has not yet started*. If it has started, you must serialise inside `f` itself (mutex + epoch counter).

**Follow-up.** *And on Go 1.23+?* — `Reset` still does not cancel an in-flight callback. The Go 1.23 change relates to channel draining for `time.Timer.C`, not to `AfterFunc` semantics.

---

### Q10. Explain `rate.Limiter.Reserve`. When do you use it instead of `Allow` or `Wait`?

**Model answer.** `Reserve` returns a `*Reservation` describing how long to wait for a token. You can then choose to:

- Sleep that long (`time.Sleep(r.Delay())`) — equivalent to `Wait`.
- Use a `select` to combine with context cancellation or another channel — `Wait` cannot do this cleanly.
- Cancel the reservation (`r.Cancel()`) to refund the token.

Typical use:

```go
r := lim.Reserve()
if !r.OK() {
    return errors.New("burst exceeded")
}
select {
case <-time.After(r.Delay()):
    process()
case <-ctx.Done():
    r.Cancel()
    return ctx.Err()
}
```

This integrates rate limiting with cancellation without the limitations of `Wait`.

**Follow-up.** *What does `r.OK()` mean?* — `false` if `n > burst` — the reservation can never be honoured. Always check before sleeping.

---

### Q11. What does `Wait(ctx)` do if `ctx` has a deadline shorter than the wait?

**Model answer.** It returns an error *immediately* without sleeping. The source preflights `r.Delay() > ctx.Deadline() - time.Now()` and bails out. This is important: without that check, the token would be consumed, then the context would cancel, and the token would be wasted.

```go
ctx, cancel := context.WithTimeout(parent, 10*time.Millisecond)
defer cancel()
err := lim.Wait(ctx) // immediate error if next token is > 10ms away
```

**Follow-up.** *Is the token consumed in that case?* — No. The reservation is cancelled and tokens refunded.

---

### Q12. Implement a per-actor rate limiter (e.g., per user ID).

**Model answer.**

```go
type PerActor struct {
    mu       sync.Mutex
    limiters map[string]*rate.Limiter
    r        rate.Limit
    b        int
}

func (p *PerActor) Allow(id string) bool {
    p.mu.Lock()
    lim, ok := p.limiters[id]
    if !ok {
        lim = rate.NewLimiter(p.r, p.b)
        p.limiters[id] = lim
    }
    p.mu.Unlock()
    return lim.Allow()
}
```

The lookup-or-create is done under the map mutex. `Allow` itself is called outside the map mutex (limiters have their own internal lock).

**Follow-up.** *Memory grows forever as new IDs arrive. How do you bound it?* — LRU eviction (`hashicorp/golang-lru`) or a background sweep that drops limiters whose `Tokens()` equals `Burst()` (i.e., idle).

---

### Q13. A debouncer needs `Cancel` and `Flush`. Implement them.

**Model answer.**

```go
type Debouncer struct {
    mu    sync.Mutex
    wait  time.Duration
    timer *time.Timer
    f     func()
}

func (d *Debouncer) Trigger() {
    d.mu.Lock()
    defer d.mu.Unlock()
    if d.timer != nil {
        d.timer.Stop()
    }
    d.timer = time.AfterFunc(d.wait, d.fire)
}

func (d *Debouncer) Cancel() {
    d.mu.Lock()
    defer d.mu.Unlock()
    if d.timer != nil {
        d.timer.Stop()
        d.timer = nil
    }
}

func (d *Debouncer) Flush() {
    d.mu.Lock()
    if d.timer == nil {
        d.mu.Unlock()
        return
    }
    d.timer.Stop()
    d.timer = nil
    d.mu.Unlock()
    d.f()
}

func (d *Debouncer) fire() {
    d.mu.Lock()
    d.timer = nil
    d.mu.Unlock()
    d.f()
}
```

`Flush` releases the mutex *before* calling `f` to avoid holding the lock across user code. `fire` (the AfterFunc callback) does the same.

**Follow-up.** *What if `Cancel` races with the timer firing?* — `Stop()` returns `false` if the timer already fired. The callback may still be in flight. Inside `fire`, the mutex serialises against `Cancel`, but `f` itself runs outside the mutex — a `Cancel` arriving while `f` is running cannot un-fire it. If that matters, use a generation counter.

---

### Q14. Walk through the token-bucket math for `Allow`.

**Model answer.** Given the limiter state `(tokens, last_update, limit, burst)`:

```
on Allow at time now:
    elapsed := now - last_update
    new_tokens := min(burst, tokens + elapsed * limit)
    if new_tokens >= 1:
        tokens     := new_tokens - 1
        last_update := now
        return true
    return false
```

Two clamps matter: `min(burst, ...)` prevents the bucket from accumulating beyond capacity, and `now < last_update` is treated as `now == last_update` to defend against clock anomalies.

**Follow-up.** *How is `Reserve` different?* — Reserve permits tokens to go *negative*. Instead of returning false, it computes how long until the deficit is paid down and returns that as `Delay`. The bucket will reject new reservations until the deficit clears.

---

### Q15. Why does `rate.Limiter` start full?

**Model answer.** A freshly constructed `rate.NewLimiter(r, b)` has `b` tokens already in the bucket. The first `b` `Allow` calls succeed without any wait. This is intentional — burst capacity is meant to be available immediately so that initial activity is not penalised by a cold start.

If you want a *cold* limiter (no initial burst), drain it manually:

```go
lim := rate.NewLimiter(r, b)
for i := 0; i < b; i++ {
    lim.AllowN(time.Now(), 1)
}
```

Or pass a time in the past for the first call. In practice, almost no one needs a cold start.

**Follow-up.** *Is this documented?* — Not explicitly in the godoc, but it falls out of the lazy-update math: `tokens` initialises to `burst`.

---

### Q16. How do you test a debouncer without using `time.Sleep`?

**Model answer.** Inject a clock. The standard pattern:

```go
type Clock interface {
    Now() time.Time
    AfterFunc(d time.Duration, f func()) Timer
}

type Timer interface {
    Stop() bool
}
```

In production, a `realClock` implementation wraps `time` directly. In tests, a `fakeClock` advances on demand and runs callbacks synchronously.

```go
fc := &fakeClock{now: time.Unix(0, 0)}
d := NewDebouncerWithClock(fc, 100*time.Millisecond, func() { counter++ })
d.Trigger()
fc.Advance(50 * time.Millisecond)
d.Trigger()
fc.Advance(99 * time.Millisecond)
if counter != 0 { t.Fatal("fired too early") }
fc.Advance(2 * time.Millisecond)
if counter != 1 { t.Fatal("did not fire") }
```

Libraries: `github.com/jonboulle/clockwork`, `github.com/benbjohnson/clock`. Go 1.24's experimental `testing/synctest` deprecates the need.

**Follow-up.** *Why not just `time.Sleep(110*ms)`?* — Tests become slow, flaky, and timing-dependent. A fake clock makes them instant and deterministic.

---

### Q17. What happens to `time.NewTicker` ticks if the consumer is slow?

**Model answer.** Tick channels have capacity 1. If the consumer is slow:

- The first missed tick arrives in the channel buffer.
- The second missed tick is *dropped* — there is no room.
- The next read from the channel receives the buffered tick (which is now stale).

This means `time.Ticker` provides *upper-bound* pacing, not *exact* pacing. If you need every tick, use a buffered channel and a worker goroutine, or `rate.Limiter` with `Wait`.

**Follow-up.** *What is the time value on a dropped tick?* — The dropped tick is gone. Each delivered tick carries the time at which it would have fired, which may already be in the past from the consumer's perspective.

---

### Q18. Code trace — what does this print?

```go
lim := rate.NewLimiter(rate.Every(100*time.Millisecond), 2)
fmt.Println(lim.Allow())
fmt.Println(lim.Allow())
fmt.Println(lim.Allow())
time.Sleep(150 * time.Millisecond)
fmt.Println(lim.Allow())
fmt.Println(lim.Allow())
```

**Model answer.**

- `true` (2 -> 1 token)
- `true` (1 -> 0 tokens)
- `false` (no tokens, no time passed)
- After 150 ms: 1.5 tokens accrued, capped at 2 → 1.5 available.
- `true` (1.5 -> 0.5 tokens)
- `false` (0.5 < 1)

So: `true true false true false`.

**Follow-up.** *Why does the bucket cap at 2?* — `burst = 2`. Even 10 seconds of idle time would yield only 2 tokens.

---

## Senior

### Q19. Design a system to rate-limit an HTTP API at 100 RPS globally and 10 RPS per API key.

**Model answer.** Two-tier limiter:

```go
type API struct {
    global  *rate.Limiter
    perKey  map[string]*rate.Limiter
    keyMu   sync.RWMutex
}

func (a *API) Allow(key string) bool {
    if !a.global.Allow() {
        return false
    }
    a.keyMu.RLock()
    lim, ok := a.perKey[key]
    a.keyMu.RUnlock()
    if !ok {
        a.keyMu.Lock()
        if lim, ok = a.perKey[key]; !ok {
            lim = rate.NewLimiter(10, 20)
            a.perKey[key] = lim
        }
        a.keyMu.Unlock()
    }
    if !lim.Allow() {
        return false
    }
    return true
}
```

Check global *first* — it is the cheap, shared limiter. If the global accepts, check per-key. If per-key rejects but global accepted, you have consumed a global token unnecessarily; in practice this is fine because the global cap protects backend resources, not the caller.

For *distributed* enforcement across multiple servers, the in-process limiter is insufficient. Use Redis (`INCR` + `EXPIRE`, sliding window, or a Lua script implementing token bucket) or a sidecar like Envoy.

**Follow-up.** *What about fairness — what if one key consumes the entire global budget?* — Add a third layer: a fair-queueing scheduler that gives each key a guaranteed minimum slice. Beyond `rate.Limiter`'s scope; reach for a library like `golang.org/x/sync/errgroup` for coordination plus a custom scheduler.

---

### Q20. Compare token bucket and leaky bucket.

**Model answer.**

| Property | Token bucket | Leaky bucket |
|---|---|---|
| Allowed burst | Up to `b` events at once | Smooth — never bursty |
| Output spacing | Variable (bursts then idle) | Exactly `1/r` between events |
| Internal state | `(tokens, last_update)` | `(queue, last_drain)` |
| Memory per limit | O(1) | O(b) — queue length |
| Best for | APIs where bursts are OK | Network shaping; smoothed output |

Both guarantee the same long-run envelope: at most `r * L + b` events over any window of length `L`. They differ on short-window behaviour.

Most software rate limiters are token buckets because callers prefer to fire `b` events back-to-back when capacity is available. Network hardware (especially carrier traffic shaping) is often a leaky bucket because the downstream link wants smooth packets.

**Follow-up.** *Can you build a leaky bucket on top of a token bucket?* — Approximately, yes: a token bucket with burst `b = 1` and rate `r` emits one event every `1/r` (within scheduling jitter). True leaky-bucket smoothing requires an output goroutine.

---

### Q21. Walk through what happens internally when `Wait(ctx)` is called.

**Model answer.**

1. Compute the reservation: how many tokens are needed (1), how many available, how long to wait for the shortfall.
2. If `n > burst`, return an error immediately.
3. Check `ctx.Deadline()`. If the wait exceeds it, return an error and refund the reservation.
4. Update the bucket: tokens go negative by the shortfall, last-update advances to now.
5. Compute `wait = (-tokens) / limit`. Start a `time.NewTimer(wait)`.
6. `select`:
   - On `<-timer.C`: return `nil`. Token "consumed".
   - On `<-ctx.Done()`: stop the timer, cancel the reservation (refund tokens proportional to remaining wait), return `ctx.Err()`.

The refund-on-cancel is subtle: the cancelled reservation doesn't refund the *full* token, only the share corresponding to the remaining wait. Tokens that would have been consumed during the elapsed sleep are forfeit. This keeps the bucket accounting tight even under cancellation churn.

**Follow-up.** *Could `Wait` use `runtime_notetsleepg` for sub-millisecond sleeps?* — In principle yes, but `time.NewTimer` already routes through the runtime's timer wheel which is highly optimised. Direct runtime calls are not part of the public API.

---

### Q22. A throttle is leaking goroutines. What is your investigation playbook?

**Model answer.**

1. Confirm with `runtime.NumGoroutine()` over time — graph rising.
2. Hit `/debug/pprof/goroutine?debug=2` to dump every stack.
3. Group stacks by similarity. Leaks usually present as thousands of identical traces.
4. Look for stacks blocked in:
   - `chan send` / `chan receive` — the throttle's output channel isn't being read, or sends to it don't have a cancellation path.
   - `time.Sleep` or `time.NewTimer` — likely a `time.After` leak in a `select` that always picks another case.
   - `sync.Mutex.Lock` — the throttle's internal mutex is held by a hung goroutine.
5. Look for the throttle's worker goroutine and verify it has an exit path on context cancellation.
6. Tag goroutines with `pprof.Labels` for the throttle's name; re-dump and confirm the count rises.
7. Add a `goleak.VerifyNone(t)` regression test.

Common culprit: a debouncer holding a `time.AfterFunc` that fires `f`, and `f` writes to a channel that nobody reads after context cancel. The goroutine inside `AfterFunc` blocks on the send forever.

**Follow-up.** *What if the stacks show `runtime.gopark` with no detail?* — `pprof goroutine?debug=2` includes the source line. If you see a generic `gopark`, you are looking at a parked goroutine on the runtime's timer wheel — it will resume when the timer fires.

---

### Q23. Why might you want `SetLimit` instead of recreating the limiter?

**Model answer.** Two reasons:

1. **Continuity.** `SetLimit` adjusts rate without resetting the bucket. Tokens earned at the old rate continue. Replacing the limiter (`lim = rate.NewLimiter(newR, newB)`) drops the old state — bucket goes back to full, callers see a sudden burst.
2. **Concurrency.** Other goroutines may already hold a reference to the old limiter. Replacing it would leave them holding a stale instance.

```go
// good
lim.SetLimit(newRate)

// bad — other goroutines still use the old lim
*lim = *rate.NewLimiter(newRate, b) // also illegal — unexported fields
lim = rate.NewLimiter(newRate, b)   // doesn't update other holders
```

**Follow-up.** *When would you replace the limiter anyway?* — When you genuinely want to reset state, e.g., after a feature flag flip that should give every user a fresh burst budget. Even then, replace the *pointer* under a mutex and have callers re-read.

---

### Q24. How would you implement a debouncer that also throttles?

**Model answer.** A debouncer with a *max-wait*. Standard debouncer fires `w` after the last event. The max-wait variant additionally guarantees a fire every `W >= w`:

```go
type DT struct {
    mu          sync.Mutex
    wait        time.Duration
    maxWait     time.Duration
    f           func()
    idleTimer   *time.Timer
    maxTimer    *time.Timer
    bursting    bool
}

func (d *DT) Trigger() {
    d.mu.Lock()
    defer d.mu.Unlock()

    if d.idleTimer != nil {
        d.idleTimer.Stop()
    }
    d.idleTimer = time.AfterFunc(d.wait, d.fire)

    if !d.bursting {
        d.bursting = true
        d.maxTimer = time.AfterFunc(d.maxWait, d.fire)
    }
}

func (d *DT) fire() {
    d.mu.Lock()
    if d.idleTimer != nil {
        d.idleTimer.Stop()
    }
    if d.maxTimer != nil {
        d.maxTimer.Stop()
    }
    d.idleTimer = nil
    d.maxTimer = nil
    d.bursting = false
    d.mu.Unlock()
    d.f()
}
```

This composes the two ideas: silence detection (`wait`) and ceiling on latency (`maxWait`).

**Follow-up.** *Doesn't this lose payloads?* — Yes; the implementation fires `f()` with no argument. Add a `payload` field guarded by the mutex if the last value matters.

---

### Q25. Compare `time.AfterFunc` and `time.NewTimer` for a debouncer.

**Model answer.**

| Property | `AfterFunc` | `NewTimer` |
|---|---|---|
| Fire mechanism | Calls `f` in a new goroutine | Sends `time.Now()` on `C` |
| Caller burden | None; pass `f` | Must read from `C` (probably in a select) |
| Best for | Fire-and-forget callbacks | Integration with a `select` |
| Cancellation | `Stop()` may race with in-flight `f` | `Stop()` + drain pre-1.23, just `Stop()` post-1.23 |
| Memory | Slightly larger (holds `f`) | Slightly smaller |

For a debouncer that wraps a user-supplied callback, `AfterFunc` is the natural fit. For a debouncer integrated into an existing `select` loop, `NewTimer` is cleaner because you can include `<-timer.C` as a case alongside other channels.

**Follow-up.** *Is there a fairness difference?* — `AfterFunc` callbacks run in their own goroutine, immediately schedulable. `NewTimer` is consumed by whatever goroutine is in `select` — fairness depends on that goroutine's responsiveness.

---

### Q26. How does monotonic time affect rate limiting?

**Model answer.** Go 1.9+ embeds a *monotonic* reading inside `time.Time` alongside the wall-clock. `time.Now()` returns both. Subtraction `t2.Sub(t1)` uses the monotonic component, immune to wall-clock adjustments (NTP step, manual change, daylight savings).

`rate.Limiter` reads `time.Now()` and subtracts. Because it subtracts, it uses the monotonic clock automatically. A user who manually steps the wall clock cannot trick the limiter into giving them extra tokens.

A subtle gotcha: if you persist `time.Now()` to disk (JSON, gob) and reconstruct it, the monotonic reading is stripped. Subsequent subtractions fall back to wall clock. For rate limiters this rarely matters because they never persist time.

**Follow-up.** *What about virtualised clocks in tests?* — A fake clock has its own monotonic reading. As long as you inject the clock into the limiter, monotonic semantics are preserved.

---

### Q27. Walk through `rate.Sometimes`.

**Model answer.** `rate.Sometimes` is the simplest conditional throttle in the package:

```go
type Sometimes struct {
    First    int           // call f the first N times
    Every    int           // call f every Nth time
    Interval time.Duration // call f if elapsed >= Interval
}

func (s *Sometimes) Do(f func()) // runs f if any of the conditions are met
```

Use cases:

- Log "first 10 errors, then every 100th": `Sometimes{First: 10, Every: 100}`.
- Sample 1% of traces: not a great fit; use a probability-based sampler.
- Periodic flush: `Sometimes{Interval: time.Second}`.

It is *not* a full rate limiter — there is no rate-per-second guarantee — but for log throttling and similar use cases it is much simpler than `Limiter`.

```go
var s rate.Sometimes
s = rate.Sometimes{First: 3, Interval: time.Second}
for i := 0; i < 100; i++ {
    s.Do(func() { log.Println("event", i) })
}
```

This logs the first three events instantly, then approximately one per second.

**Follow-up.** *Is `Sometimes` concurrent-safe?* — Yes; it has its own internal mutex.

---

### Q28. Code review — what's wrong here?

```go
func (s *Service) Handle(ctx context.Context, req Request) error {
    if err := s.lim.Wait(ctx); err != nil {
        return err
    }
    return s.process(ctx, req)
}
```

**Model answer.** Functionally correct, but the pattern has two production smells:

1. **No observability.** When the limiter throttles, callers see latency but the service has no metric to surface it. Add: `if wait > 0 { metrics.LimiterWait.Observe(wait.Seconds()) }`.
2. **No early reject.** A high-volume service should consider `Allow` + 429 instead of `Wait`. Holding HTTP handlers in `Wait` consumes goroutines and connections; a 429 with a `Retry-After` header lets the client back off in user space.

Better:

```go
func (s *Service) Handle(ctx context.Context, req Request) error {
    if !s.lim.Allow() {
        s.metrics.Rejected.Inc()
        return ErrRateLimited
    }
    return s.process(ctx, req)
}
```

Translate `ErrRateLimited` to 429 at the HTTP boundary.

**Follow-up.** *When is `Wait` better than `Allow`?* — When the caller has no graceful reject path (a background worker doing batch work, where reject means "drop forever") and the wait is short. For HTTP, prefer reject + retry.

---

### Q29. Implement a sliding-window rate limiter without `rate.Limiter`.

**Model answer.**

```go
type Sliding struct {
    mu     sync.Mutex
    window time.Duration
    limit  int
    events []time.Time
}

func (s *Sliding) Allow() bool {
    s.mu.Lock()
    defer s.mu.Unlock()
    now := time.Now()
    cutoff := now.Add(-s.window)
    // drop events older than the window
    i := 0
    for ; i < len(s.events); i++ {
        if !s.events[i].Before(cutoff) {
            break
        }
    }
    s.events = s.events[i:]
    if len(s.events) >= s.limit {
        return false
    }
    s.events = append(s.events, now)
    return true
}
```

Trade-offs vs token bucket:

- **Memory:** O(N) — one timestamp per event in the window. Worse for high rate.
- **Bursts:** Less bursty. A sliding window of "100 per second" rejects the 101st event regardless of whether tokens were saved up.
- **Fairness:** More even output.

For low-volume per-user limits (10/minute, 100/hour) sliding windows are often clearer. For high-volume global limits, token bucket wins on memory.

**Follow-up.** *What is a "sliding window counter" (Stripe-style)?* — Approximates with one bucket per fixed sub-window plus a weighted estimate for the current sub-window. O(1) memory, slightly less accurate. Cloudflare's implementation is canonical.

---

### Q30. How would you build a distributed rate limit on top of Redis?

**Model answer.** Three approaches:

1. **`INCR` with `EXPIRE`.** Each window-key gets incremented; if `INCR` returns more than the limit, reject. Set `EXPIRE` to the window size on first increment.

   ```
   key = "rl:user:" + id + ":" + (now / window).String()
   n = INCR key
   if n == 1: EXPIRE key window
   if n > limit: reject
   ```

   Simple. Fails near window boundaries — a user could send `limit` events at the end of one window and `limit` at the start of the next.

2. **Sliding window log.** Store every event timestamp in a sorted set; on each request, `ZREMRANGEBYSCORE` to drop old entries, `ZCARD` to count, and `ZADD` to record. Accurate, but O(events) Redis ops.

3. **Token bucket in Lua.** Store `(tokens, last_update)` per key. A Lua script atomically reads, refills, decrements, and writes. The script is the same math as `rate.Limiter` but server-side. Recommended for production: one round-trip per check, exact semantics.

```lua
-- Lua: refill bucket and try to consume 1 token
-- KEYS[1] = bucket key
-- ARGV[1] = now (ns), ARGV[2] = rate (tokens/s), ARGV[3] = burst, ARGV[4] = ttl (s)
local now = tonumber(ARGV[1])
local rate = tonumber(ARGV[2])
local burst = tonumber(ARGV[3])
local ttl = tonumber(ARGV[4])

local b = redis.call("HMGET", KEYS[1], "t", "u")
local tokens = tonumber(b[1]) or burst
local last = tonumber(b[2]) or now
local elapsed = math.max(0, now - last) / 1e9
tokens = math.min(burst, tokens + elapsed * rate)
local ok = 0
if tokens >= 1 then
    tokens = tokens - 1
    ok = 1
end
redis.call("HMSET", KEYS[1], "t", tokens, "u", now)
redis.call("EXPIRE", KEYS[1], ttl)
return ok
```

Failure mode: Redis outage. Fall back to a local `rate.Limiter` per pod with a conservative rate. Document that during partial Redis loss the effective limit can be `pod_count * fallback`.

**Follow-up.** *Why not Memcached?* — No `INCR` atomicity guarantees across cluster topology changes, and no scripting. Redis is the standard.

---

## Staff

### Q31. Walk through the memory model implications of a debouncer that fires in a different goroutine.

**Model answer.** `time.AfterFunc(d, f)` calls `f` in a new goroutine when the timer fires. The Go memory model gives us no happens-before relation between code on the calling side that triggered the timer and code in `f`, *unless* an explicit synchronisation primitive intervenes.

Concretely:

```go
var value string
d := time.AfterFunc(time.Second, func() {
    fmt.Println(value) // races with the assignment below
})
value = "hello"
```

The assignment may not be visible to the callback goroutine because there is no synchronisation between them. The fix is a mutex around `value`, or sending it via a channel.

Inside `rate.Limiter`, all state is guarded by `sync.Mutex`, so callers automatically get the right happens-before. For user-defined debouncers, the implementer must explicitly synchronise.

**Follow-up.** *Does `time.Timer.Reset` synchronise?* — Reset takes the runtime's internal lock for the timer wheel, which is enough for the timer's internal state. It is *not* a general-purpose synchronisation primitive between the caller and the user-supplied `f`. Always wrap user state in a mutex.

---

### Q32. Why does `rate.Limiter.Reserve` allow tokens to go negative?

**Model answer.** `Reserve` makes a *promise* about future capacity. The caller commits to honouring the reservation by waiting `r.Delay()`. The bucket records the deferred consumption by going negative.

If `Reserve` returned `false` (or blocked) when no token was available, callers could not implement custom delay policies — they would be forced into the `Wait` model or busy-poll. The negative-tokens design lets the caller choose:

- Sleep the delay (`time.Sleep(r.Delay())`) — behaves like `Wait`.
- Add a context cancellation guard (`select { case <-time.After(d): case <-ctx.Done(): r.Cancel() }`) — graceful cancel.
- Reject if delay exceeds a SLO (`if r.Delay() > maxWait { r.Cancel(); return error }`) — admission control.

The negative state pays down at rate `r`. Future reservations cannot succeed until the deficit clears.

**Follow-up.** *What is the maximum negative value of `tokens`?* — Bounded by the longest reservation. Without explicit cap, a caller could `Reserve` repeatedly without sleeping, dragging tokens arbitrarily negative. Production code that uses `Reserve` should bound outstanding reservations or use `Wait` instead.

---

### Q33. Design a debounce/throttle observability dashboard.

**Model answer.** Metrics to expose:

| Metric | Type | Purpose |
|---|---|---|
| `debounce_triggered_total` | Counter | How often does input arrive? |
| `debounce_fired_total` | Counter | How often does output happen? |
| `debounce_collapse_ratio` | Derived | `fired / triggered` — compression ratio |
| `debounce_wait_seconds` | Histogram | Time from last event to fire — measures `wait` accuracy |
| `throttle_allowed_total` | Counter | How many events pass the throttle? |
| `throttle_rejected_total` | Counter | How many are dropped? |
| `throttle_wait_seconds` | Histogram | `Wait` durations — high tail = under-provisioned |
| `throttle_reservation_outstanding` | Gauge | Reservations not yet consumed |

Alerts:

- `rejected / (allowed + rejected) > 0.1` for 5 minutes — under-provisioned.
- `p99(wait_seconds) > 1s` — head-of-line blocking.
- `collapse_ratio < 0.01` — input too quiet; debounce may be misconfigured.
- `outstanding` rising monotonically — cancellation churn or stuck callers.

Dashboard layout: rate (per second), latency (histogram), saturation (reject rate or queue length). The USE method works well.

**Follow-up.** *Where do you wire these in?* — Wrap the limiter in a small struct that exposes `Allow`/`Wait` and increments metrics. Don't try to read `Tokens()` for a metric — it's a diagnostic, not a signal.

---

### Q34. Two regions each run 10 pods with a per-pod `rate.Limiter` of 100 RPS, intending a global 2000 RPS budget. Discuss.

**Model answer.** This works *only* if traffic is evenly distributed across the 20 pods. In practice:

- **Load balancers are biased.** Round-robin works only if connections are uniform; least-connections amplifies hot pods.
- **Stickiness.** Sessions, sticky cookies, gRPC connection pooling can put 70% of traffic on one pod, where the limiter rejects everything past 100 RPS while other pods sit idle.
- **Restarts.** A pod restart resets the limiter to a full burst, briefly oversubscribing.
- **Capacity changes.** Scaling pods up or down silently changes the effective limit.

Better designs:

1. **Centralised limiter** (Redis-backed). Every request hits Redis; the budget is enforced globally regardless of pod distribution.
2. **Token allocation service.** Each pod requests a budget of tokens from a central service every N seconds. The pod's local `rate.Limiter` enforces the allocation. Failure mode: graceful — if the service is down, the pod's last-known allocation applies.
3. **Quota in the LB.** Envoy and similar can rate-limit at the ingress, removing pod variance.

The "per-pod limit divided by pod count" pattern is a starter approximation; it should not be the production solution at scale.

**Follow-up.** *What is the smallest backend service that should care?* — Once SLOs are tight (p99 latency, 99.9% availability) the variance from per-pod limiting starts to matter. Below ~10 RPS or in best-effort services, per-pod is fine.

---

### Q35. A debouncer is fed by a typing user. The callback writes to a database. Discuss safety.

**Model answer.** Concerns:

1. **Re-entrancy.** If the callback writes to the database and the user keeps typing, can two writes overlap? `time.AfterFunc` callbacks run in their own goroutine; back-to-back fires are independent. If the write is slow, two can be in flight.
2. **Ordering.** Two concurrent writes might commit out of order — the "later" payload could land before the "earlier" one due to scheduling.
3. **Cancellation.** When the page unloads, the in-flight callback should be cancelled. `time.AfterFunc.Stop()` only stops a pending fire — it does not abort a callback already running.
4. **Idempotency.** A retry should not double-write. Add an idempotency key per debounce session.
5. **Connection cost.** A burst of 50 keystrokes that collapses to 5 fires is great, but if each fire opens a new DB connection, you've turned a CPU-bound problem into a connection-bound one. Pool connections.

Mitigations:

- Serialise the callback through a single worker goroutine with a buffered channel of size 1 (latest-wins).
- Pass `context.Context` into the callback; cancel it from `Debouncer.Stop()`.
- Attach an idempotency token (`request_id = hash(user_id, content)`) so repeated writes are no-ops at the DB.
- Use connection pooling (`database/sql` does this by default).

**Follow-up.** *What about exactly-once?* — Use the DB as the source of truth. Each write upserts on `(user_id, request_id)`. Repeated writes are idempotent.

---

### Q36. Compare `rate.Limiter.Wait` and a manual `time.Sleep(r.Delay())` from `Reserve`.

**Model answer.** Functionally they are equivalent — both sleep until a token is available. The differences are around cancellation and integration:

| Property | `Wait(ctx)` | `Reserve()` + `time.Sleep` |
|---|---|---|
| Context-aware | Yes — returns early on cancel | No — sleep is uninterruptible |
| Refund on cancel | Yes — automatic | No — token consumed even if you `return` later |
| Can compose with other channels | No — opaque | Yes — `select` on `time.After` and others |
| Code length | One line | Several lines |

For most code, `Wait(ctx)` is the right answer: it's cancellation-aware out of the box. Reach for `Reserve` when you need a custom select (e.g., a hot fallback if the rate limit holds you up too long).

**Follow-up.** *Can you cancel `Wait` mid-sleep?* — Yes; that is its point. `Wait` arranges a `select { case <-timer.C: case <-ctx.Done(): }` internally and refunds the reservation on cancel.

---

### Q37. Postmortem — a service started returning 429s under steady load with no traffic increase. The rate limiter was unchanged. What happened?

**Model answer.** Hypotheses to investigate, in rough priority:

1. **Container CPU throttling.** The pod was being CPU-throttled by the kernel. `time.Now()` reads stalled, so the limiter believed more time was passing than really had — but in fact, calls were being delayed *before* reaching the limiter, then arriving in bursts that exceeded burst capacity. Check `container_cpu_cfs_throttled_seconds`.
2. **Clock skew or NTP step.** Less likely on monotonic time (since Go 1.9 limiter uses monotonic), but a wall-clock step could happen if you serialised time values somewhere.
3. **Memory pressure causing GC pauses.** Long stop-the-world pauses make limiter calls bunch up, so the *arrival* pattern at the limiter became bursty even though *origin* traffic was steady. Burst capacity gets exhausted.
4. **Code change deployed.** Did someone shrink `burst`? Check the deployment history.
5. **Caller batching change.** Did the caller switch from one-by-one to batch RPC? A batch of 10 looks like 10 events back-to-back to the limiter; with `burst=5` half are rejected.
6. **Background work spike.** Was there a new background job hitting the same limiter? Per-actor stats would show.

Action items:

- Add `rate.Limiter` saturation metric and an alert at `rejected/total > 5%`.
- Add CPU throttle alerts at the container level.
- Add a hypothesis-driven runbook so the next on-call doesn't start from scratch.

**Follow-up.** *Would moving to `Wait` instead of `Allow` have helped?* — It would have changed 429s into latency spikes, masking the symptom but not fixing the root cause. Often the right move is short term — but track down the cause first.

---

### Q38. A team wants to debounce file-write events from `fsnotify`. Build it correctly.

**Model answer.** Files often emit multiple events per save (write, rename, chmod). A debouncer per file collapses these.

```go
type FileDebouncer struct {
    mu       sync.Mutex
    wait     time.Duration
    timers   map[string]*time.Timer
    onChange func(path string)
}

func NewFileDebouncer(wait time.Duration, onChange func(string)) *FileDebouncer {
    return &FileDebouncer{
        wait:     wait,
        timers:   make(map[string]*time.Timer),
        onChange: onChange,
    }
}

func (d *FileDebouncer) Trigger(path string) {
    d.mu.Lock()
    defer d.mu.Unlock()
    if t, ok := d.timers[path]; ok {
        t.Stop()
    }
    d.timers[path] = time.AfterFunc(d.wait, func() {
        d.mu.Lock()
        delete(d.timers, path)
        d.mu.Unlock()
        d.onChange(path)
    })
}
```

Notes:

- Per-path debouncing: a save of A does not delay reporting on B.
- The callback re-acquires the mutex to delete its own entry, avoiding a leak.
- `Stop` on an already-fired timer is a no-op; safe.

Edge cases:

- **Editor saves with temp-file pattern.** vim does `write -> rename -> delete`. Watch for both the temp name and the final name; debounce on the final.
- **Mass deletions.** A `rm -rf` triggers thousands of events. Bound the timer map to prevent growth; evict entries for paths that vanish.
- **Symbolic links and renames.** `fsnotify` semantics are platform-dependent; test on every target OS.

**Follow-up.** *Why per-path instead of one global timer?* — Per-path debouncing scales to many independent files. A single global timer would mean editing file A delays the notification for an unrelated edit on B.

---

### Q39. How do you reason about backpressure when a throttle and a debouncer are stacked?

**Model answer.** Composition order matters.

- **Debounce -> Throttle.** Input bursts get collapsed by the debouncer (rate already reduced). The throttle then enforces a steady ceiling. This is the typical UI -> server pattern.
- **Throttle -> Debounce.** The throttle reduces input rate; the debouncer collapses what remains. Less common but useful when the throttle is at an upstream API and the debouncer batches.

Backpressure considerations:

1. **Where is the queue?** If the debouncer holds a payload and the throttle blocks, the debouncer's payload may be stale by the time the throttle releases. Use *latest-wins* semantics in the debouncer's payload field.
2. **Drop vs block.** A debouncer naturally drops intermediate events. A throttle can drop or block; pairing a debouncer with a `Wait`-style throttle is usually fine because the debouncer already discarded most events. Pairing two `Wait`s can amplify latency unboundedly.
3. **Cancellation.** Both stages must respect `ctx`. Cancellation in the debouncer should cancel any pending throttle wait.
4. **Observability.** Track at both stages: how many events the debouncer collapsed, how many the throttle rejected.

**Follow-up.** *When is it wrong to debounce before throttle?* — When the *first* event matters more than the latest (a key press that should fire immediately, then ignore the next 100 ms). Use a leading-edge debouncer or a throttle alone.

---

### Q40. Final design — sketch a production-quality typing assist endpoint.

**Model answer.** The client autocompletes as the user types. The system must:

1. Debounce keystrokes (200 ms) so we don't query on every key.
2. Cancel in-flight requests when a new keystroke arrives.
3. Throttle per user (10 RPS, burst 20) on the server.
4. Throttle the global service (1000 RPS, burst 2000) to protect downstream.
5. Observability, fairness, and graceful degradation.

Client side:

```go
type TypingClient struct {
    debouncer *Debouncer
    cancel    context.CancelFunc
}

func (c *TypingClient) OnKeystroke(text string) {
    if c.cancel != nil {
        c.cancel()
    }
    c.debouncer.Trigger(func() {
        ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
        c.cancel = cancel
        results, err := c.query(ctx, text)
        if err != nil {
            return // including context.Canceled
        }
        c.render(results)
    })
}
```

Server side:

```go
func (s *Server) Suggest(w http.ResponseWriter, r *http.Request) {
    user := authenticate(r)
    if !s.global.Allow() {
        w.WriteHeader(http.StatusTooManyRequests)
        return
    }
    if !s.perUser.Allow(user.ID) {
        w.WriteHeader(http.StatusTooManyRequests)
        return
    }
    ctx := r.Context()
    suggestions, err := s.engine.Suggest(ctx, r.URL.Query().Get("q"))
    if err != nil {
        if errors.Is(err, context.Canceled) {
            return
        }
        w.WriteHeader(http.StatusInternalServerError)
        return
    }
    json.NewEncoder(w).Encode(suggestions)
}
```

Discussion points:

- **Drop, not block.** Per-user and global both use `Allow`. Blocking holds HTTP goroutines.
- **Two-tier throttling.** Global protects backend; per-user prevents one user from monopolising the global budget.
- **429 with Retry-After.** Add a `Retry-After: 1` header so clients back off.
- **Idempotency / dedup.** Two debounced calls for the same query collapse server-side via a cache.
- **Observability.** Counters for `allowed`, `rejected_global`, `rejected_user`, histogram for query latency.
- **Failure modes.** If `engine.Suggest` is slow, the 2-second client timeout fires and the user sees nothing. Better: return *partial* results immediately and stream improvements (Server-Sent Events).

**Follow-up.** *What if the engine is rate-limited externally?* — Add a third tier: a server-side `rate.Limiter` matching the engine's quota. Wait briefly (10–50 ms); reject if the wait exceeds that.

---

## Summary of follow-ups by level

| Level | Themes |
|---|---|
| Junior | Definitions, simplest implementations, basic `rate.Limiter` usage, common pitfalls with `time.After` |
| Middle | Leading vs trailing variants, `Reserve` vs `Wait` vs `Allow`, per-actor limiting, testing with fake clocks |
| Senior | Token-bucket vs leaky-bucket internals, distributed limiting (Redis), sliding windows, composing debounce + throttle |
| Staff | Memory model under timer callbacks, observability and SLO design, postmortems, multi-tier architectures, fairness across pods |

---

## Quick-reference traps

| Trap | Symptom | Fix |
|---|---|---|
| `time.After` in a `select` | Slow leak under high event rate | Use `NewTimer` outside the loop and `Reset` |
| `rate.NewLimiter(r, 0)` | Always returns `false` | Use `burst >= 1` |
| Reservation never cancelled | Tokens permanently consumed | Always pair `Reserve` with `Cancel` on the failure path |
| Concurrent fires from `AfterFunc` | Two callbacks run at once | Serialise inside `f` with a mutex |
| Per-pod limiter assumed to compose | 429s under uneven load | Centralise in Redis or move to ingress |
| `Wait` under tight `ctx` deadline | Tokens consumed but caller cancels | The package preflights deadlines — this case is handled, but it's worth knowing |
| Debouncer fires while previous fire still running | Reentry into shared state | Serialise the callback through a single worker goroutine |
| `time.Ticker` consumed too slowly | Ticks dropped silently | Either accept "no faster than" semantics or use `rate.Limiter` |
| `SetLimit` on a paused limiter | Old tokens persist | If you really want a reset, replace the pointer under a mutex |
| Tests timing-dependent | Flake on slow CI | Inject a fake clock |
