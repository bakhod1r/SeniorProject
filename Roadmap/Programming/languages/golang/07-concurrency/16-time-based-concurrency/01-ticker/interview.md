---
layout: default
title: Interview
parent: Ticker
grand_parent: Time-Based Concurrency
ancestor: Go
nav_order: 7
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/16-time-based-concurrency/01-ticker/interview/
---

# time.Ticker — Interview Questions

> Practice questions ranging from junior to staff-level. Each has a model answer, common wrong answers, and follow-up probes. Most questions include code that the candidate is expected to read closely; the trace work is half the test.

---

## Junior

### Q1. What is a `time.Ticker` and how do you create one?

**Model answer.** A `time.Ticker` is a `struct` returned by `time.NewTicker(d time.Duration)` that delivers the current time on its public field `C` (a `<-chan time.Time`) at the given interval. The first tick arrives roughly `d` after construction, and subsequent ticks arrive every `d` thereafter. The runtime guarantees the interval is measured against the monotonic clock, so wall-clock jumps (NTP adjustments, daylight-saving transitions) do not move the ticks.

```go
t := time.NewTicker(500 * time.Millisecond)
defer t.Stop()
for range 3 {
    fmt.Println("tick at", <-t.C)
}
```

**Common wrong answers.**
- "It calls a callback every interval." (No — it sends on a channel. `time.AfterFunc` is the callback variant.)
- "The first tick fires immediately." (No — the first tick fires *after* the interval has elapsed.)
- "`NewTicker(0)` is fine." (No — `NewTicker` panics on a non-positive duration.)

**Follow-up.** *What if you pass `NewTicker(-1 * time.Second)`?* — Panic: `non-positive interval for NewTicker`.

---

### Q2. Why must you call `Stop()` on a ticker?

**Model answer.** Until Go 1.23, every running ticker held a reference inside the runtime timer heap. Even if the user's `*Ticker` value went out of scope, the runtime kept ticking and held the channel alive, so any goroutine reading from `t.C` could not be garbage collected. The leak was both timer-heap entries and any goroutines parked on `t.C`.

Go 1.23 changed the timer GC story: a ticker whose `C` channel has become unreachable can now be reclaimed. But `Stop()` is still mandatory in idiomatic code because (a) you may be running on older Go, (b) `Stop()` is what makes intent visible to readers, and (c) the underlying heap entry is still cheaper to remove explicitly than to wait for GC.

**Common wrong answer.** "`Stop` closes the channel." (No — `Stop` does *not* close `C`. A receive on `t.C` after `Stop` simply blocks forever. The runtime never closes ticker channels.)

**Follow-up.** *How would you guarantee `Stop` runs?* — `defer t.Stop()` immediately after `NewTicker`.

---

### Q3. What does this print?

```go
package main

import (
    "fmt"
    "time"
)

func main() {
    t := time.NewTicker(100 * time.Millisecond)
    defer t.Stop()
    for i := 0; i < 3; i++ {
        <-t.C
        fmt.Println("tick", i)
    }
}
```

**Model answer.** Prints:

```
tick 0
tick 1
tick 2
```

approximately at `t=100ms, t=200ms, t=300ms` from program start. The first receive blocks until the ticker has elapsed once; thereafter ticks arrive on a 100ms cadence.

**Follow-up.** *Will it ever print "tick 0" at `t=0`?* — No. The first send happens after the first interval, not at construction.

---

### Q4. What is wrong with this loop?

```go
t := time.NewTicker(time.Second)
for {
    <-t.C
    doWork()
}
```

**Model answer.** Two problems:

1. **No `Stop()`** — the ticker leaks for the lifetime of the goroutine. If the goroutine itself outlives the function (a global, a long-running worker), the leak is permanent.
2. **No cancellation** — there is no way to ask the loop to exit. It runs forever.

The idiomatic shape is:

```go
t := time.NewTicker(time.Second)
defer t.Stop()
for {
    select {
    case <-ctx.Done():
        return
    case <-t.C:
        doWork()
    }
}
```

**Follow-up.** *Why `select` even if you only have one case?* — Because you need at least the `ctx.Done()` case for cancellation. The two-case `select` is the canonical pattern.

---

### Q5. What is `time.Tick` and why is it considered harmful?

**Model answer.** `time.Tick(d)` is a convenience that returns just a `<-chan time.Time`, without giving you a `*Ticker` value. Without the pointer, you cannot call `Stop`. Before Go 1.23, this guaranteed a permanent goroutine leak if the channel ever became unreachable — the underlying ticker continued ticking forever.

```go
for now := range time.Tick(time.Second) { // tempting but leaky
    fmt.Println(now)
}
```

The standard library documentation explicitly warns: "The underlying Ticker cannot be recovered by the garbage collector; it leaks." Go 1.23 partially fixed this for the unreachable case, but the idiom is still considered a code smell because intent is hidden and `Stop` is impossible.

**Use case.** `time.Tick` is acceptable only for very short programs (CLI tools, demo code, `main()` with no exit) where you genuinely never want to stop. Use `NewTicker` everywhere else.

**Follow-up.** *Why does it exist at all then?* — A historical convenience for quick scripts. The cost of fixing it (introducing a global registry, `Stop`-by-channel-pointer, etc.) was deemed worse than the warning in the docs.

---

### Q6. Does this code leak?

```go
func ping(ctx context.Context) {
    t := time.NewTicker(time.Second)
    for {
        select {
        case <-ctx.Done():
            return
        case <-t.C:
            send()
        }
    }
}
```

**Model answer.** Yes — `t.Stop()` is missing. When the context is cancelled, the function returns, but the `*Ticker` value goes out of scope without `Stop`. On pre-1.23 Go, the timer-heap entry persists; on 1.23+, it eventually gets garbage collected once the channel reference dies, but you should never rely on that.

The fix is one line:

```go
t := time.NewTicker(time.Second)
defer t.Stop()
```

**Follow-up.** *If you swap `time.NewTicker` for `time.Tick`, can you fix the leak?* — No. `time.Tick` does not give you a handle to call `Stop` on. That is exactly why it is discouraged.

---

### Q7. What is the type of `t.C`?

**Model answer.** `<-chan time.Time` — a receive-only channel of `time.Time` values. Each receive returns the time at which the tick fired (specifically, the time the runtime sent on the channel).

```go
var t *time.Ticker = time.NewTicker(time.Second)
var c <-chan time.Time = t.C
var now time.Time = <-c
```

**Follow-up.** *Why a channel of times rather than a channel of empty struct?* — Symmetry with `time.After` and `time.Timer.C`; lets callers compute drift or log the exact tick time without an extra `time.Now()` call.

---

### Q8. Can you send on `t.C`?

**Model answer.** Not legally, no. `Ticker.C` is a `<-chan time.Time` (receive-only) from the outside, so a `send` statement is a compile error. The runtime owns the send side and is the only entity allowed to send on it. Trying to circumvent this by reflection or unsafe pointer arithmetic produces unspecified behaviour.

```go
t := time.NewTicker(time.Second)
t.C <- time.Now() // compile error: send to receive-only channel
```

**Follow-up.** *Why does Go expose the channel type this way?* — It encodes the contract in the type system. Receive-only on the consumer side prevents accidental writes that would race with the runtime.

---

## Middle

### Q9. What does `Reset` do, and what guarantees does it offer?

**Model answer.** `(*Ticker).Reset(d time.Duration)` was added in Go 1.15. It changes the ticker's interval to `d`, effective from the moment of the call. The next tick arrives roughly `d` after the `Reset` call — not `d` after the previous tick.

```go
t := time.NewTicker(time.Second)
defer t.Stop()
time.Sleep(100 * time.Millisecond)
t.Reset(200 * time.Millisecond) // next tick ~200ms from this point
```

What `Reset` does **not** guarantee: it does not drain stale values already buffered in `t.C`. If a tick was queued before the `Reset`, a subsequent receive may return that old time. Code that depends on tick timing should drain the channel before resetting, or accept the possibility of a stale value.

**Follow-up.** *What did people do before Go 1.15?* — They created a new ticker and discarded the old one. Verbose and leaky.

---

### Q10. Drain-then-reset — when do you need it?

**Model answer.** When you change the interval and the next tick *must* reflect the new cadence. Stale values can be in the channel because the runtime pre-fills `C` (buffer of 1) when the timer fires:

```go
// Safe drain-then-reset
t.Reset(newInterval)
select {
case <-t.C:
default:
}
```

A more pedantic version uses `Stop` first:

```go
if !t.Stop() {
    select {
    case <-t.C:
    default:
    }
}
t.Reset(newInterval)
```

The mirror to `Timer` documentation, applied to `Ticker`. In Go 1.23+ the channel was changed to be unbuffered (synchronous send), which substantially reduces the stale-value risk; pre-1.23 code following the older pattern still works and is recommended for portability.

**Follow-up.** *Is `Reset(d)` race-free with concurrent reads from `t.C`?* — Yes, but the *content* of those reads is unpredictable: a reader might observe one tick at the old cadence, then ticks at the new cadence. Document the semantics; do not rely on instant cutover.

---

### Q11. What is *drift* in the context of a ticker?

**Model answer.** Drift is the cumulative timing error of a ticker over many ticks relative to an ideal schedule. `time.Ticker` is designed against drift: it fires at fixed offsets from the start, not at fixed offsets from the previous tick. So if a tick is delayed by 50ms because the consumer was slow, the next tick still fires at the originally-scheduled time, not 50ms later than expected. Over a long run the average rate equals exactly the configured rate.

Compare with a naive home-grown loop:

```go
for {
    time.Sleep(time.Second)
    doWork()
}
```

This drifts: each sleep starts *after* `doWork` returns, so the total period is `sleep + work`. Over a million iterations, the loop is millions of "`work durations`" behind schedule.

**Follow-up.** *What is jitter then?* — Jitter is per-tick variance: any single tick may be a few microseconds early or late due to scheduler latency, GC, or kernel scheduling. Jitter does not accumulate; drift does (if you build a drifting loop).

---

### Q12. What happens if the consumer is slower than the ticker?

**Model answer.** Ticks are dropped. The runtime tries to send on `t.C`; if the channel is already full (capacity 1 before Go 1.23, unbuffered after), the runtime gives up on that send and waits for the next tick. The consumer therefore sees ticks at a lower rate than configured, but never sees a tick from the past — each tick reflects when it was actually delivered.

```go
t := time.NewTicker(10 * time.Millisecond)
defer t.Stop()
for now := range t.C {
    fmt.Println(now)
    time.Sleep(500 * time.Millisecond) // consumer is 50x slower
}
```

The consumer sees one tick every ~500ms, not 50 ticks. This is by design — the alternative would be unbounded queue growth, which is far worse.

**Follow-up.** *What if you need to count missed ticks?* — Compute the elapsed time on each receive, divide by interval, and treat the quotient as the number of ticks that "should have" fired. Common in cron-like pollers that need to catch up.

---

### Q13. How do you integrate a ticker with `context.Context`?

**Model answer.** Put `ctx.Done()` and `t.C` in a `select`. Always list `ctx.Done()` first or as an equal partner; ordering does not matter semantically (the runtime picks pseudo-randomly when both are ready), but the convention helps readers see the cancel path:

```go
func loop(ctx context.Context, interval time.Duration) error {
    t := time.NewTicker(interval)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            return ctx.Err()
        case <-t.C:
            if err := doWork(ctx); err != nil {
                return err
            }
        }
    }
}
```

Three properties to verify in code review:

1. `defer t.Stop()` is present and runs on every exit path.
2. `ctx.Done()` is checked on every iteration (it is, by virtue of being in the `select`).
3. `doWork` itself respects `ctx` if it does any blocking I/O.

**Follow-up.** *What if `doWork` is long-running and you want to interrupt it mid-flight?* — Pass `ctx` down. Long-running work must cooperate with cancellation; the ticker does not save you from a blocking call.

---

### Q14. What does this print? (Reset edge case)

```go
t := time.NewTicker(100 * time.Millisecond)
defer t.Stop()
time.Sleep(150 * time.Millisecond) // one tick has been delivered, buffered in C
t.Reset(50 * time.Millisecond)
time.Sleep(10 * time.Millisecond)
select {
case v := <-t.C:
    fmt.Println("got", v.UnixMilli()%1000)
default:
    fmt.Println("empty")
}
```

**Model answer.** On Go pre-1.23: prints `got <something>` — the old tick from `t=100ms` was still buffered, and `Reset` does not drain it. On Go 1.23+: behaviour depends on the runtime's new unbuffered semantics; the old tick was discarded if not yet received synchronously. Most likely the receive blocks past the 10ms window, and we print `empty`.

The point of the question is to expose how `Reset` and channel buffering interact, and why drain-then-reset is the conservative pattern.

**Follow-up.** *Rewrite this snippet to behave the same on both 1.22 and 1.23.* — Add a drain after `Reset`:

```go
t.Reset(50 * time.Millisecond)
select { case <-t.C: default: }
```

---

### Q15. Why is `time.After` inside a `select` loop a leak?

**Model answer.** `time.After(d)` allocates a brand-new `*Timer` every call. The returned channel is a fresh `<-chan time.Time` from a fresh runtime timer entry. In a tight `select` loop, you allocate one timer per iteration. If the timer is not the case that fires, it stays in the heap until `d` elapses, holding memory and a runtime timer-heap slot.

```go
for {
    select {
    case msg := <-msgs:
        handle(msg)
    case <-time.After(time.Second): // BUG: allocates each iteration
        flush()
    }
}
```

If `msgs` fires every 10ms, you allocate 100 timers per second; each lives for a second. You leak up to 100 outstanding timers at any moment. Under load this is a measurable cost, and `Stop` is never called.

**Fix.** Hoist the timer out and reset it on each iteration:

```go
t := time.NewTicker(time.Second)
defer t.Stop()
for {
    select {
    case msg := <-msgs:
        handle(msg)
    case <-t.C:
        flush()
    }
}
```

Or use a `*Timer` with explicit `Reset`/`Stop` if you need one-shot semantics.

**Follow-up.** *Was this fixed in some Go version?* — Pre-1.23, `time.After` timers stay around for the full `d`. Go 1.23 improved garbage collectability, so unreachable timers can be reclaimed sooner. The pattern is still slower and obscures intent — avoid in production code.

---

### Q16. Walk through `t.Stop()` semantics.

**Model answer.** `(*Ticker).Stop()` does these things:

1. Removes the ticker's entry from the runtime timer heap, so the runtime stops scheduling future sends on `t.C`.
2. Does **not** close `t.C`. Any goroutine currently blocked on `<-t.C` stays blocked forever unless something else wakes it.
3. Returns no value (unlike `Timer.Stop`, which returns `bool`). The return value would be meaningless for a ticker — there is always a "next" tick that may or may not be in flight.
4. Is idempotent — calling `Stop` twice is safe.
5. Is safe to call from any goroutine.

After `Stop`, the channel may still contain one buffered tick (pre-1.23) that fired between the last receive and the `Stop` call. Drain it if your code reads from `t.C` after `Stop`.

**Follow-up.** *Why doesn't `Stop` close `C`?* — Because closing it would race with the runtime sender, which the runtime cannot easily synchronise without extra locking. The chosen design avoids the close-race by never closing.

---

## Senior

### Q17. Trace through what happens inside the runtime when you call `time.NewTicker`.

**Model answer.**

1. `time.NewTicker(d)` allocates a `*Ticker` with an unbuffered channel `C` (Go 1.23+) or a 1-buffered channel (pre-1.23).
2. It allocates a `runtimeTimer` struct with `when = now + d`, `period = d`, and `f` set to a function that performs the channel send (`sendTime`).
3. It calls `runtime.startTimer`, which inserts the timer into the local P's timer heap (one of the four heaps maintained per P since the Go 1.14 timer rewrite).
4. The scheduler's `checkTimers` pass — called from `findRunnable`, `runqsteal`, and `sysmon` — pops timers whose `when` has elapsed and runs their `f`.
5. When `f` runs, it tries a non-blocking send of `time.Now()` on `t.C`. If the channel is full, it skips this tick (lossy semantics by design).
6. After the send, the runtime requeues the timer with `when += period`, preserving drift-free scheduling.

The cost of `NewTicker` is one allocation for the `*Ticker`, one for the `runtimeTimer`, and one heap insertion (`O(log N)` where N is the size of the P's timer heap).

**Follow-up.** *Why per-P timer heaps?* — Lock-free heap operations on the hot path. Pre-1.14, there was one global timer heap protected by a mutex, which scaled poorly. Per-P heaps with work-stealing across Ps removed the bottleneck.

---

### Q18. The Go 1.23 timer changes — what changed, and why does it matter?

**Model answer.** Two big changes in Go 1.23 (and partly 1.22):

1. **GC of unreachable timers.** Before 1.23, a `*Timer` or `*Ticker` whose `C` channel was unreachable still held the underlying `runtimeTimer` in the timer heap, leaking memory and continuing to schedule sends that fell into the void. Go 1.23 made these timers garbage-collectable: when the channel is provably unreachable, the runtime can drop the timer.
2. **Synchronous send on `C`.** Pre-1.23, `Ticker.C` was a buffered channel of capacity 1 — the runtime could enqueue a tick that nobody was waiting for, and if the consumer never received it, the value just sat there until the next overwrite (or until consumer raced with `Reset`). In 1.23, the send is synchronous; if the consumer is not waiting, the tick is simply not delivered, eliminating the stale-tick-after-`Reset` class of bugs.

**Why it matters.** Code written for pre-1.23 with stale-value handling (drain-then-reset) is still correct on 1.23. Code written assuming 1.23-only semantics may misbehave when back-ported. Production code should be portable across both — drain stale values explicitly.

**Follow-up.** *Are there observable behaviour changes besides Reset?* — Some tests that relied on a tick being buffered after `Stop` may fail on 1.23. The `golang/go` issue tracker has the migration notes (issues #37196 family). Always pin the Go version your tests target.

---

### Q19. Design a jittered ticker for thundering-herd avoidance.

**Model answer.** When N processes all start at the same time with the same interval, they will all fire ticks in lockstep. If those ticks trigger a downstream call (cache refresh, leader election heartbeat, metric flush), the downstream gets N synchronous requests, then nothing, then N more. This is the thundering herd.

A jittered ticker spreads the load by adding a small random offset to each interval. Strategies:

1. **Per-tick jitter.** Compute `interval + rand(-jitterRange, +jitterRange)` for each tick. Cleanest implementation uses `time.NewTimer` rather than `Ticker` because the interval changes.
2. **Initial-offset jitter.** Sleep `rand(0, interval)` before starting the ticker. Cheap; the ticker still has constant cadence, but the *phase* differs across processes.
3. **Full jitter.** Combine both — random initial offset plus per-tick perturbation.

```go
func jitteredTick(ctx context.Context, base, jitter time.Duration, fn func()) {
    rng := rand.New(rand.NewSource(time.Now().UnixNano()))
    next := base + time.Duration(rng.Int63n(int64(jitter)))
    t := time.NewTimer(next)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case <-t.C:
            fn()
            next = base + time.Duration(rng.Int63n(int64(jitter)))
            t.Reset(next)
        }
    }
}
```

**Follow-up.** *Wouldn't initial-offset alone suffice?* — In long-lived services, no: a one-off jitter at startup gets re-synchronised if all processes restart after an outage. Per-tick jitter keeps them desynchronised.

---

### Q20. The four-heap timer scheduler — explain.

**Model answer.** Each `P` (logical processor) maintains a small set of data structures for timer management:

- `timers` — a min-heap keyed by `when`. The runtime's primary ordered data structure.
- `timerHeapPos` — index into the heap for each timer (for `O(log N)` deletion).
- A separate counter of "deleted but not yet swept" entries for lazy cleanup.
- `adjustTimers`, `timerModifiedEarliest` — bookkeeping for timers whose deadline was changed.

The scheduler calls `checkTimers(p)` at three points:

1. Before each goroutine is scheduled (in `findRunnable`).
2. When a P is stealing work from another P (in `runqsteal`).
3. From `sysmon`, which wakes periodically to handle long-stuck Ps.

`checkTimers` pops timers whose `when` has elapsed, runs their `f`, and re-inserts periodic timers with new `when`. The work is done on whichever P is executing — there is no dedicated timer thread.

**Why four heaps?** The naming is historical; older versions of Go split the heaps by state (active, deleted, etc.). The current implementation reduced it to effectively one heap plus auxiliary indexes, but the term "four-heap" persists in commit messages. The point is: each P has its own state, locks are P-local, and stealing balances load.

**Follow-up.** *How does the runtime decide when sysmon should intervene?* — When a P has been parked for more than 10ms with no timer fires, despite having timers that should have fired. This handles the edge case where all Ms are busy in syscalls.

---

### Q21. Memory model: what is the happens-before guarantee between a tick fire and the receiving goroutine?

**Model answer.** From the Go memory model, the send on `t.C` (executed by the runtime's timer callback) happens-before the corresponding receive completes. Any memory write made by the runtime before the send is therefore visible to the receiver. In practice, the runtime only writes a `time.Time` value — there is no shared state the user could observe across the send.

From the user code's perspective:
- Code that executes *before* receiving from `t.C` cannot observe ticks from later iterations.
- Code that executes *after* receiving from `t.C` sees all memory written by any goroutine that happened-before the send (typically vacuous, since the runtime is the sender).

The practical implication: do not use `t.C` as a generic synchronisation primitive between user goroutines. Use it only for "time has passed" signals; for inter-goroutine ordering, use a separate channel or mutex.

**Follow-up.** *If goroutine A receives from `t.C` and then writes to a shared variable, and goroutine B reads the variable, is there a happens-before guarantee?* — No. The ticker channel synchronises A with the runtime, not A with B. You need an explicit sync primitive between A and B.

---

### Q22. Code trace: what does this print?

```go
package main

import (
    "fmt"
    "time"
)

func main() {
    t := time.NewTicker(100 * time.Millisecond)
    defer t.Stop()
    deadline := time.After(350 * time.Millisecond)
    count := 0
    for {
        select {
        case <-deadline:
            fmt.Println("done after", count, "ticks")
            return
        case <-t.C:
            count++
        }
    }
}
```

**Model answer.** Prints `done after 3 ticks` (approximately).

Trace:
- `t=0ms`: ticker starts, deadline starts.
- `t=~100ms`: first tick. `count=1`.
- `t=~200ms`: second tick. `count=2`.
- `t=~300ms`: third tick. `count=3`.
- `t=~350ms`: deadline fires. Print and return.

The count is 3 because three ticks fit in the 350ms window, and they fire at 100ms, 200ms, 300ms. The fourth would fire at 400ms but the deadline gets there first.

Caveats: scheduler jitter can occasionally produce 2 or 4 ticks; on a heavily loaded machine a tick could be late enough that the deadline preempts it. Code that depends on exact tick counts is fragile.

**Follow-up.** *Is `time.After(350ms)` a leak here?* — One-time use; the timer fires and is GC'd. No leak, but `time.NewTimer` + `defer` would be more explicit.

---

### Q23. How do you stop a ticker without racing with a concurrent receive?

**Model answer.** `Stop` is safe to call from any goroutine and does not race with receives — the runtime guarantees that. The subtle thing is what the consumer sees after `Stop`:

- If a tick is mid-flight (the runtime called `sendTime` but the consumer has not yet received), the consumer will eventually receive it.
- After `Stop`, the consumer will not see any *new* ticks but may see one stale tick from before `Stop` was called.

To make sure the consumer exits cleanly, use a `quit` channel or context, not the absence of ticks:

```go
type Periodic struct {
    t    *time.Ticker
    quit chan struct{}
}

func (p *Periodic) Stop() {
    close(p.quit)
    p.t.Stop()
}

func (p *Periodic) loop() {
    defer p.t.Stop() // double-stop is fine
    for {
        select {
        case <-p.quit:
            return
        case <-p.t.C:
            p.work()
        }
    }
}
```

The consumer exits on `<-p.quit`, not on ticker silence.

**Follow-up.** *What if `p.work()` is slow, and `Stop` is called mid-work?* — `Stop` returns immediately. The work goroutine continues until `work()` returns, then sees the `quit` close and exits. If the caller wants to wait for the goroutine, add a `sync.WaitGroup`.

---

### Q24. Trace this `Reset` scenario carefully.

```go
package main

import (
    "fmt"
    "time"
)

func main() {
    t := time.NewTicker(200 * time.Millisecond)
    defer t.Stop()
    start := time.Now()
    for i := 0; i < 5; i++ {
        now := <-t.C
        fmt.Printf("tick %d at %vms\n", i, now.Sub(start).Milliseconds())
        if i == 1 {
            t.Reset(100 * time.Millisecond)
        }
    }
}
```

**Model answer.** Approximate output (assuming clean scheduling):

```
tick 0 at 200ms
tick 1 at 400ms
tick 2 at ~500ms   (100ms after Reset)
tick 3 at ~600ms
tick 4 at ~700ms
```

After `Reset(100ms)`, the next tick is 100ms from the `Reset` call, not 100ms from tick 1. On Go pre-1.23 there is a small chance a buffered tick from the 200ms ticker is delivered first, distorting the timing; drain-then-reset would eliminate that.

**Follow-up.** *What if you put the `Reset` before the receive, instead of after?* — Functionally equivalent for this case; the next tick still fires `100ms` after `Reset`. The timing differs by negligible amounts.

---

### Q25. Build a "tick at most every N seconds, but no more often than once per call" rate limiter.

**Model answer.** This is a classic "leaky bucket" pattern. `Ticker` is not the natural fit — you want a token-bucket implementation with refill timer:

```go
type RateLimiter struct {
    tokens chan struct{}
    quit   chan struct{}
}

func New(rate time.Duration, burst int) *RateLimiter {
    rl := &RateLimiter{
        tokens: make(chan struct{}, burst),
        quit:   make(chan struct{}),
    }
    for i := 0; i < burst; i++ {
        rl.tokens <- struct{}{}
    }
    go func() {
        t := time.NewTicker(rate)
        defer t.Stop()
        for {
            select {
            case <-rl.quit:
                return
            case <-t.C:
                select {
                case rl.tokens <- struct{}{}:
                default: // bucket full
                }
            }
        }
    }()
    return rl
}

func (rl *RateLimiter) Wait(ctx context.Context) error {
    select {
    case <-rl.tokens:
        return nil
    case <-ctx.Done():
        return ctx.Err()
    }
}

func (rl *RateLimiter) Stop() { close(rl.quit) }
```

The ticker refills the bucket at a steady rate; `Wait` blocks until a token is available or the context cancels. This is essentially `golang.org/x/time/rate` simplified.

**Follow-up.** *Why not just `time.Tick` inside `Wait`?* — Allocates a fresh timer per call, leaks if `Wait` returns early, and provides no burst capacity. Token-bucket is the right shape.

---

## Staff

### Q26. A service has 200 goroutines, each with its own `time.Ticker`. What is the cost? How would you redesign?

**Model answer.** Cost: 200 entries in (across) the runtime's per-P timer heaps. Each entry adds `O(log N)` to insertion/deletion and a small constant to `checkTimers`. The 200 goroutines also have 200 goroutine stacks (~2 KB each = 400 KB). Each tick wakes a goroutine, runs scheduler work, then parks it again — non-trivial overhead at scale.

Redesign options:

1. **One ticker, many subscribers.** A single goroutine ticks at the smallest required interval and fans out work via a slice of registered callbacks. Cuts timer-heap entries to 1.
2. **Coalesced wheel.** A "timing wheel" data structure: each slot is one tick of the smallest cadence, each periodic job lands on a slot computed from its period. The runtime checks one slot per smallest-tick. O(1) per job.
3. **Pull-based on demand.** Replace polling with event-driven triggers: each ticker becomes a `select` over external events plus a watchdog timer for liveness.

When 200 tickers actually matter depends on benchmarks. Below a thousand, the overhead is usually negligible. Above ten thousand, it dominates. Profile with `runtime.NumGoroutine` and `pprof` heap before optimising.

**Follow-up.** *Where is the timing-wheel pattern used in production Go code?* — Notably `github.com/RussellLuo/timingwheel`, and inside `etcd`'s lease implementation. Kafka and Netty use the same data structure in JVM-land.

---

### Q27. The "ticker started before goroutine" pitfall — what is it?

**Model answer.** Suppose:

```go
t := time.NewTicker(time.Second)
time.Sleep(2 * time.Second) // accidental, or before goroutine creation
go func() {
    defer t.Stop()
    for now := range t.C {
        fmt.Println(now)
    }
}()
```

The ticker starts ticking immediately on `NewTicker`. Between `NewTicker` and the goroutine consuming `t.C`, two seconds pass, during which the runtime fires two ticks. With the channel buffered (pre-1.23) only one survives; the other is dropped. When the goroutine finally starts, it receives the buffered one immediately, then the next will arrive only ~1s later.

The user often expected "tick fires every second starting now" but observed "first tick immediately, then once a second" which is a different schedule.

**Fixes.**
- Create the ticker as close to the consumer as possible — typically *inside* the goroutine.
- Or use `time.NewTimer` for the first delay and switch to `Ticker` after.

**Follow-up.** *On Go 1.23 with synchronous channel, what changes?* — The fire-and-discard semantics kick in: if no consumer is waiting at the moment of send, the tick is lost. So you may see only one (or zero) ticks during the 2-second gap, and the first user-visible tick arrives at `t=3s`.

---

### Q28. Design a heartbeat system for 10 000 connections. Each connection needs a heartbeat every 30 seconds.

**Model answer.** Naive: one ticker per connection. 10 000 timers in the heap. Acceptable but wasteful — each tick wakes a goroutine for almost no work.

Better designs:

1. **Sharded tickers.** Group connections into 100 buckets by hash. Each bucket has one ticker; one goroutine per bucket walks the 100 connections in its bucket on each tick. Tickers: 100. Tick-wakeups: 100 per 30s.
2. **Timing wheel.** Single goroutine, single ticker at 1-second resolution. Slot `i` (mod 30) contains the connections due for heartbeat this round. On each tick, process slot `now / second % 30`. Tickers: 1.
3. **Coordinator with worker pool.** One goroutine schedules heartbeats and submits them to a pool. The pool's workers are reused across all 10 000 connections.

Each approach has trade-offs: sharding scales horizontally but adds per-bucket lock contention; timing wheels are cache-friendly but require careful resizing logic.

**Production pick.** For 10 000 connections, sharded tickers are usually enough and trivially simple. Timing wheels start to pay off above 100 000 timers.

**Follow-up.** *Where does jitter fit in?* — Add per-connection offset on registration so that all 10 000 heartbeats are not synchronised in the same second.

---

### Q29. You see scheduler latency spikes correlated with a `time.Ticker` firing every millisecond across 1 000 goroutines. Walk me through diagnosis.

**Model answer.** Hypothesis: per-tick wakeups are causing scheduler thrashing.

Diagnosis:

1. Run with `GODEBUG=schedtrace=1000,scheddetail=1`. Inspect runqueue sizes and global runqueue spillage at each second.
2. Run with `runtime/trace` for 5 seconds. Open in `go tool trace`. Look for goroutine state-change density around the millisecond boundary.
3. Check `pprof.Profile("goroutine")` to see how many goroutines are parked on `t.C`. 1 000 parked-then-runnable transitions every ms is 1 000 000 wakeups/sec — well above what the scheduler can handle without latency.
4. Look at the `mutex` profile: contention on the per-P timer heap during `checkTimers`?

Fix:

1. Coalesce the ticks. Replace 1 000 individual tickers with one ticker that dispatches to 1 000 lightweight tasks.
2. Or lengthen the cadence — if the user truly needs millisecond precision in only some of the goroutines, separate them from the slower jobs.

**Follow-up.** *Are 1 000 tickers always wrong?* — Not at all. At 1-second cadence it would be fine. At 1ms it is pathological. The wrongness is the *rate* of wakeups, not the count of tickers.

---

### Q30. Compare `time.NewTicker(d)` versus `time.AfterFunc(d, fn).Reset(d)`-in-fn pattern.

**Model answer.**

`time.NewTicker`:
- Owned by the consumer; produces values on a channel.
- Drift-free schedule.
- Consumer integrates naturally with `select` and `ctx`.
- Slow consumer drops ticks silently.

`time.AfterFunc` with self-reset:
- Callback-driven; runs `fn` in a runtime-owned goroutine.
- Drift depends on placement of `Reset`: before `fn` work means drift-free, after means accumulating drift.
- Naturally serialises work — next tick cannot start until current finishes.
- No channel coordination needed.

```go
var t *time.Timer
t = time.AfterFunc(d, func() {
    doWork()
    t.Reset(d) // after-work reset: drifts by work duration
})
```

vs

```go
var t *time.Timer
t = time.AfterFunc(d, func() {
    t.Reset(d) // before-work reset: drift-free, but work overlap possible
    doWork()
})
```

vs `Ticker`: cleaner cancellation, explicit ownership, but allows tick dropping. Use case differences:

- **Periodic background work with potentially-slow body.** Use `AfterFunc` reset-before-work, or use a `Ticker` and accept dropped ticks.
- **Polling at a precise cadence.** `Ticker` is the right tool.
- **One-shot delayed work.** `AfterFunc` or `NewTimer`.

**Follow-up.** *Which pattern is hardest to test?* — `AfterFunc` callbacks, because they run asynchronously in runtime goroutines without a channel handle. Wrap them in your own goroutine if testability matters.

---

### Q31. A 100ms ticker shows tick-to-tick deltas averaging 100ms but with occasional 250ms gaps. Diagnose.

**Model answer.** A long gap between ticks means either:

1. **GC pause.** Run with `GODEBUG=gctrace=1`. Stop-the-world events in older Go versions could pause for >100ms. Modern Go (1.21+) typically has STW under 1ms, but mark-assist can still stall goroutines.
2. **Scheduler latency.** The tick fired on schedule, but the consumer goroutine was not picked up promptly. Inspect with `runtime/trace`. Common when `GOMAXPROCS` is undersized in a busy container.
3. **Consumer was busy.** The previous receive's handler took 250ms — the ticker fires at 100ms, drops a tick (channel full), then sends at 200ms which the consumer reads at 250ms. The "gap" is artifact of the slow consumer plus the ticker's drop semantics.
4. **Kernel scheduling.** On a heavily loaded host the kernel may not run the Go M's thread promptly. Check `/proc/PID/sched` or use `perf sched`.
5. **OS suspends.** Laptop sleeping, VM paused, container paused for resize.

Order of investigation: check consumer work duration first (cheapest to verify), then GC trace, then scheduler trace.

**Follow-up.** *How do you separate "tick was late" from "consumer was slow"?* — Log both the tick time (`now` from `<-t.C`) and the receive time (`time.Now()` right after). If `now` lines up on the cadence but `time.Now()` lags, the consumer was slow.

---

### Q32. What does this benchmark measure?

```go
func BenchmarkTicker(b *testing.B) {
    t := time.NewTicker(time.Nanosecond)
    defer t.Stop()
    for i := 0; i < b.N; i++ {
        <-t.C
    }
}
```

**Model answer.** It measures the overhead of receiving from a ticker that is firing as fast as the runtime can schedule it. With a 1ns interval, the runtime cannot actually deliver one tick per nanosecond — the minimum effective interval is bounded by scheduler latency (typically hundreds of nanoseconds) and the cost of running `sendTime` plus re-inserting the timer.

The benchmark is therefore not a useful microbenchmark; it primarily measures how often the runtime can churn through the timer heap. Real ticker workloads have far longer intervals where the wakeup cost is negligible.

A more meaningful benchmark would compare different intervals (1ms, 100ms, 1s) and measure the consumer's perceived rate to expose the cadence floor of the runtime.

**Follow-up.** *Is `time.NewTicker(0)` legal?* — No, it panics. The smallest practical interval is bounded by what the scheduler can deliver — empirically, around 1µs on Linux, but you should design for tens of microseconds at minimum.

---

### Q33. Sketch a `MultiTicker` that fires for N different intervals from one goroutine.

**Model answer.** Use a single goroutine, a heap of scheduled deadlines, and one resettable timer:

```go
type job struct {
    interval time.Duration
    next     time.Time
    fn       func()
}

type MultiTicker struct {
    mu    sync.Mutex
    jobs  []*job  // min-heap on next
    timer *time.Timer
    quit  chan struct{}
}

func (m *MultiTicker) Add(interval time.Duration, fn func()) {
    m.mu.Lock()
    defer m.mu.Unlock()
    j := &job{interval: interval, next: time.Now().Add(interval), fn: fn}
    heap.Push((*jobHeap)(&m.jobs), j)
    m.reschedule()
}

func (m *MultiTicker) Run() {
    m.timer = time.NewTimer(time.Hour) // placeholder
    defer m.timer.Stop()
    for {
        select {
        case <-m.quit:
            return
        case now := <-m.timer.C:
            m.fire(now)
        }
    }
}
```

`fire` pops the heap's top job, runs `fn`, updates `next += interval`, pushes back, and `Reset`s the timer to the new top. One goroutine, one runtime timer, N user-level scheduled jobs.

**Trade-offs.**
- One slow job blocks all others; either offload work to a pool or use one goroutine per job (negates the optimisation).
- Mutex contention on `Add`/`Run` boundary; in practice low because both are infrequent.

**Follow-up.** *When is this worth it?* — When N is large (thousands) and intervals vary. For small N, just spawn N tickers.

---

### Q34. The `time.After` channel never gets closed. Is that a problem?

**Model answer.** `time.After(d)` returns a `<-chan time.Time` that the runtime sends exactly one value on, then drops. The channel is never closed. Receiving once returns the value; receiving again blocks forever. This is rarely a problem because the canonical pattern is to use the channel inside a `select` and receive at most once:

```go
select {
case <-time.After(d):
    // timeout
case result := <-work:
    // work completed
}
```

The runtime hands the channel to the GC once both sides go out of scope. Pre-Go 1.23 there was a leak in tight loops; 1.23 improved this.

**Why the channel is not closed.** The runtime cannot close it without a synchronisation point with the consumer. Closing would race with the consumer's receive in pathological cases.

**Follow-up.** *Could I close it manually?* — No — the channel is unidirectional from your perspective (`<-chan time.Time`), so `close(ch)` is a compile error. Even if you could, you would race with the runtime.

---

### Q35. Why does Go ban `time.NewTicker(0)`?

**Model answer.** Several reasons:

1. **Semantics are undefined.** A zero interval means "fire immediately, forever" — there is no schedule.
2. **The runtime would busy-loop.** The scheduler would constantly find the timer ready, run `sendTime`, requeue, find it ready again. CPU pegged at 100%.
3. **The consumer cannot keep up.** Even at one receive per nanosecond, no goroutine can drain at that rate.
4. **It is almost always a bug.** A zero interval usually means the developer made a unit-conversion error or forgot to multiply.

Negative durations are banned for the same reasons (no meaningful semantic). The implementation panics with `non-positive interval for NewTicker`.

**Follow-up.** *Could the runtime have chosen to "saturate at 1ns" instead of panic?* — It could, but panics are loud, and silent saturation would mask a class of unit-conversion bugs. The panic is correct.

---

## Summary of follow-ups by level

| Level | Follow-up themes |
|---|---|
| Junior | "What does this print?", "Where does `Stop` matter?", "What is `time.Tick`?" |
| Middle | "Reset semantics," "Drift vs jitter," "How to integrate with context," "Why `time.After` in a loop is wrong" |
| Senior | "Walk through the runtime," "Memory model," "Trace these `Reset` cases," "Design rate limiters" |
| Staff | "Scale to thousands of timers," "Diagnose scheduler latency," "Multi-interval ticker design," "Why zero interval panics" |

## Cheat sheet of correct ticker idioms

- `defer t.Stop()` immediately after `NewTicker`.
- Always use `select` so cancellation has a path.
- Drain `t.C` after `Reset` if stale values would matter.
- Never use `time.Tick` in long-lived code.
- Never use `time.After` inside a long-running `select` loop.
- Add jitter when many processes share a cadence.
- Document the "who stops the ticker" contract in struct comments.
- Treat tick drops as expected behaviour, not a bug.
