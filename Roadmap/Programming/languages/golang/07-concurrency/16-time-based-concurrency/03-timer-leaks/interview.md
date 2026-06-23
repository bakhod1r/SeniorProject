---
layout: default
title: Interview
parent: Timer Leaks
grand_parent: Time-Based Concurrency
ancestor: Go
nav_order: 7
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/16-time-based-concurrency/03-timer-leaks/interview/
---

# Timer Leaks — Interview Questions

> Practice questions ranging from junior to staff-level. Each has a model answer, common wrong answers, and follow-up probes. Topics: `time.After`, `time.Tick`, `time.NewTimer`, `Stop`/`Reset` semantics, ticker hygiene, code-trace problems, and design questions.

---

## Junior

### Q1. What does `time.After(d)` actually return?

**Model answer.** `time.After(d)` is a one-line helper. It is equivalent to `time.NewTimer(d).C`. The function creates a brand-new `*time.Timer` on the heap, returns its receive channel, and discards the timer value. The channel will receive the firing time once, after roughly `d` has elapsed. After that, the channel is never sent on again.

The critical implication: every call to `time.After` allocates a timer that the caller cannot stop, because the caller never holds the `*time.Timer`. The only way the timer's resources are released is for the timer to fire normally (or, since Go 1.23, for the channel to become unreachable so the GC can collect everything).

**Common wrong answers.**
- "It blocks for `d` and then returns." (No — it returns the channel immediately. The block happens at the receive site, not inside `time.After`.)
- "It returns a sentinel value of type `time.Time`." (No — it returns `<-chan time.Time`. A `time.Time` is the value *sent on* the channel.)
- "It is the same as `time.Sleep`." (No — `time.Sleep` blocks the caller; `time.After` returns a channel and lets you `select` on it.)

**Follow-up.** *Why is `time.After` problematic?* — Because the returned timer is unreferenced, you cannot call `Stop` on it. If you ever lose interest in the timeout (because some other `select` case won), the timer keeps running until `d` elapses. In a hot loop, you accumulate dormant timers in the runtime's timer heap.

---

### Q2. What does this snippet do, and why is it a leak?

```go
for {
    select {
    case msg := <-msgs:
        handle(msg)
    case <-time.After(5 * time.Second):
        return ErrTimeout
    }
}
```

**Model answer.** Each iteration of the loop allocates a new `*time.Timer` via `time.After(5*time.Second)`. When `msgs` wins the race, the `time.After` timer becomes garbage from the user's point of view, but the runtime's internal timer heap holds a reference until the timer fires five seconds later. If messages arrive every 100 ms, you accumulate about 50 dormant timers at any moment. The leak is bounded — five seconds' worth — but the allocation pressure and the timer-heap maintenance cost is real.

Pre-Go-1.23, the leak was worse: the timer also pinned channel buffers and any closure state through the runtime, so a tight loop on a fast-arriving channel could push timer-heap memory into hundreds of MB before the dormant timers finally fired and dropped off.

**Fix.** Hoist the timer out and reset it.

```go
t := time.NewTimer(5 * time.Second)
defer t.Stop()
for {
    if !t.Stop() {
        select { case <-t.C: default: }
    }
    t.Reset(5 * time.Second)
    select {
    case msg := <-msgs:
        handle(msg)
    case <-t.C:
        return ErrTimeout
    }
}
```

**Follow-up.** *Is this still a problem in Go 1.23+?* — Less so. Go 1.23 made unreferenced timer channels eligible for GC, so the heap pressure is gone. But the allocation cost remains — one timer per iteration is still wasteful — and the dormant timers still occupy the runtime timer heap until they fire. Hoisting is still the right pattern.

---

### Q3. What is wrong with `time.Tick`?

**Model answer.** `time.Tick(d)` returns a `<-chan time.Time` that ticks forever, but it gives you no handle on the underlying `*time.Ticker`. You cannot call `Stop` on it. If the function that created the tick channel returns, the ticker keeps running in the background and the channel buffers tick values until garbage collection eventually decides the channel is unreachable — but that can take a long time, and in Go versions before 1.23 the timer was pinned by the runtime, so GC could never reclaim it.

The official documentation says it bluntly: "The ticker cannot be recovered by the garbage collector; it leaks." Use `time.Tick` only for top-level program tickers that will live for the entire process. For any goroutine that may exit, use `time.NewTicker(d)` and call `defer ticker.Stop()`.

**Common wrong answer.** "`time.Tick` and `time.NewTicker(d).C` are the same." (Pre-1.23, no — `time.Tick` is leak-prone in a way `NewTicker` is not, because you cannot `Stop` it. Post-1.23, the GC can collect `time.Tick` once the channel is unreferenced, which closes the most painful version of the leak, but you still cannot proactively stop the ticker, so callers leak ticks for whatever fraction of `d` is left when the receiver disappears.)

**Follow-up.** *When is `time.Tick` actually OK?* — For tickers that should live as long as the program does. A daemon's metrics-emit loop in `main`, for example. Anywhere else, prefer `NewTicker`.

---

### Q4. Walk me through `Stop` and `Reset` on a `*time.Timer`.

**Model answer.** Both methods return a `bool`.

- `Stop()` returns `true` if the call prevented the timer from firing. It returns `false` if the timer had already fired (the value was already sent on the channel) or had already been stopped. After `Stop` returns `false`, there *may* still be a value sitting in the channel buffer that nobody received.
- `Reset(d)` should be called only on a stopped or expired timer. The canonical drain pattern is:

```go
if !t.Stop() {
    select { case <-t.C: default: }
}
t.Reset(d)
```

Why the `select`? Because if `Stop` returned `false`, the channel buffer might hold a stale value. If you `Reset` without draining, your next receive will pick up the stale time and you will think the timer fired immediately.

Go 1.23 simplified the rule. Since 1.23, `Reset` and `Stop` interact cleanly with the channel — they drain any pending value from the channel atomically — so the `if !t.Stop() { select ... }` dance is no longer required for timers created on or after 1.23. The dance still works (and is harmless), and you must keep it if you target older Go versions.

**Common wrong answer.** "`Stop` returns whether the timer is still running." (Wrong sense — `Stop` returns whether it stopped the firing, which is the opposite.)

**Follow-up.** *What does `Reset` return mean?* — The same as `Stop`: it returns whether the prior state had the timer running and unfired. Reset's main job is to set the new duration; the return value is rarely used in modern code.

---

### Q5. Pre-Go-1.23, why couldn't the garbage collector reclaim `time.After` timers?

**Model answer.** Because the runtime's timer implementation linked every active timer into a per-P timer heap. The heap held a reference to the timer object, which in turn held a reference to its channel. From the GC's perspective, the timer and channel were live — the runtime was holding a strong pointer to them. Even if the user's code had dropped every reference, the timer would not be collected until it fired and removed itself from the heap.

This was tolerable for short timeouts and ordinary uses. It became painful for code that called `time.After` in tight loops with infrequent firing — the heap of dormant timers grew without bound until each one's deadline arrived. Some services with 50K req/s saw 100 MB+ of timer-heap memory under load.

Go 1.23 fixed this by changing the runtime so unreferenced timer channels can be garbage-collected even before the timer fires. The timer is removed from the runtime heap when its channel becomes unreachable. This makes `time.After` mostly safe — at least from a memory standpoint — and removes the worst category of timer leak.

**Follow-up.** *Does this mean `time.After` is fine in loops now?* — Memory-wise, yes, on Go 1.23+. CPU-wise, no — every iteration still allocates a timer. For hot loops, `NewTimer` + `Reset` remains the better pattern.

---

## Middle

### Q6. What is the `default` myth about `time.After`?

**Model answer.** A common but mistaken belief is that adding a `default` clause to a `select` somehow makes `time.After` safe:

```go
select {
case msg := <-ch:
    handle(msg)
case <-time.After(d):
    return ErrTimeout
default:
    // assumed to short-circuit and avoid creating a timer
}
```

This is wrong on two counts. First, by the time `select` evaluates `default`, all case expressions have already been evaluated — including `time.After(d)`. The timer is created regardless of which branch wins. Second, with a `default`, the `time.After` case will never fire if the other cases are not ready; the `default` always wins immediately. So you have created a timer that will never be received from, and you have also defeated the timeout.

A `default` clause is the wrong tool for "I want to avoid making a timer." The right tool is to not call `time.After` — use a hoisted `*time.Timer`, or use a `context.WithTimeout` ctx + `<-ctx.Done()`.

**Follow-up.** *When is `default` in a `select` legitimate?* — When you genuinely want non-blocking semantics. "Try to receive; if nothing is ready right now, fall through." Not for timeout-avoidance.

---

### Q7. Why is `NewTicker` plus `defer ticker.Stop()` the right pattern?

**Model answer.** `time.NewTicker(d)` returns a `*time.Ticker` with a channel field `C` and a `Stop` method. The ticker fires once every `d`. If you do not call `Stop` when you are done, the ticker keeps queuing tick values into its 1-element buffered channel forever; the goroutine running the ticker remains scheduled; the runtime keeps the timer in its heap. Memory grows slowly but unboundedly.

Calling `defer ticker.Stop()` at the top of the goroutine ensures the ticker stops on every exit path — normal return, error path, panic. After `Stop`, no more ticks are queued. There may be one tick already in the buffer at the moment of `Stop`; the documentation explicitly notes that `Stop` does not close `ticker.C`, so a select must handle the case of a tick arriving after `Stop`.

**Common bug.**

```go
go func() {
    ticker := time.NewTicker(time.Second)
    for {
        select {
        case <-ticker.C:
            work()
        case <-quit:
            return // BUG: ticker is never Stop()'d
        }
    }
}()
```

Fix:

```go
go func() {
    ticker := time.NewTicker(time.Second)
    defer ticker.Stop()
    for {
        select {
        case <-ticker.C:
            work()
        case <-quit:
            return
        }
    }
}()
```

**Follow-up.** *Does `Stop` close the channel?* — No. The Go authors deliberately do not close the channel because closing would race with concurrent receives. Always design your loop to be safe with a stale tick after `Stop`.

---

### Q8. Trace this code. Find the bug.

```go
func subscribe(ctx context.Context, ch <-chan event) {
    timeout := time.After(30 * time.Second)
    for {
        select {
        case e := <-ch:
            handle(e)
        case <-timeout:
            log.Println("idle for 30s, exiting")
            return
        case <-ctx.Done():
            return
        }
    }
}
```

**Model answer.** The intent is "exit if no event arrives for 30 seconds." The bug: `timeout` is created once, outside the loop. The first event resets nothing; the second event sees the same already-pending timeout; and after 30 wall-clock seconds (not 30 seconds of idleness), the function exits regardless of activity.

Two correct rewrites:

```go
// Option A: NewTimer + Reset, idle timeout
t := time.NewTimer(30 * time.Second)
defer t.Stop()
for {
    if !t.Stop() {
        select { case <-t.C: default: }
    }
    t.Reset(30 * time.Second)
    select {
    case e := <-ch:
        handle(e)
    case <-t.C:
        log.Println("idle for 30s, exiting")
        return
    case <-ctx.Done():
        return
    }
}

// Option B: per-event context with timeout, cancel on each event
for {
    eventCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
    select {
    case e := <-ch:
        cancel()
        handle(e)
    case <-eventCtx.Done():
        cancel()
        log.Println("idle for 30s, exiting")
        return
    }
}
```

Option A is the canonical "idle timeout" rewrite. Option B is shorter but allocates a context each event.

**Follow-up.** *What changes on Go 1.23 with respect to the Reset dance?* — Since 1.23 the `if !t.Stop() { drain }` dance is no longer needed; `Reset` handles the drain atomically. But the original bug — placing `time.After` outside the loop — is unrelated and exists on every Go version.

---

### Q9. What is wrong with this `time.AfterFunc` usage?

```go
func cacheEntry(key string, value []byte) {
    cache.Store(key, value)
    time.AfterFunc(10*time.Minute, func() {
        cache.Delete(key)
    })
}
```

**Model answer.** Three problems.

1. **Closures pin memory.** The callback captures `key` (a string header) and, depending on the implementation, possibly `value`. The runtime holds the timer in its heap and through it the closure, so neither `key` nor `value` is collected until the timer fires. If you cache 1 GB of data and never explicitly clean up, that 1 GB sits in memory for 10 minutes after the last write.

2. **No cancellation.** If the entry is replaced or deleted manually, the old `AfterFunc` still fires and may incorrectly delete a new entry with the same key. The function returns a `*time.Timer` but the caller does not keep it, so `Stop` is impossible.

3. **No bound.** Each new write spawns a new timer. With 100K writes/sec and a 10-minute TTL, you have 60 million live timers. The runtime's timer heap operations are O(log n), so each insert/remove gets slower.

**Fix.** Use a single janitor goroutine that ticks once per second and sweeps expired entries from the cache, or use an existing TTL cache library (`groupcache`, `ristretto`) that batches expirations. For occasional one-shot deferred actions, `AfterFunc` is fine and convenient.

**Follow-up.** *When is `AfterFunc` the right tool?* — One-off, non-frequent, where you keep the returned `*time.Timer` and can call `Stop` if the operation is cancelled.

---

### Q10. Explain the leak in this retry loop.

```go
func retry(ctx context.Context, op func() error) error {
    backoff := time.Second
    for {
        err := op()
        if err == nil { return nil }
        select {
        case <-ctx.Done():
            return ctx.Err()
        case <-time.After(backoff):
        }
        backoff *= 2
    }
}
```

**Model answer.** The loop calls `time.After(backoff)` on every iteration. When the operation succeeds and `nil` is returned, the most recent `time.After` timer is dropped but continues running until its deadline. Worse, when `ctx.Done()` wins, the same applies — the just-allocated timer continues ticking until backoff elapses.

For short backoffs this is invisible. For long backoffs — 30 seconds, 1 minute — combined with frequent retries, the timer heap grows. On Go before 1.23, this was a meaningful production leak; on 1.23+ the memory is reclaimable but the runtime overhead remains.

Fix:

```go
func retry(ctx context.Context, op func() error) error {
    backoff := time.Second
    t := time.NewTimer(0)
    defer t.Stop()
    if !t.Stop() {
        <-t.C
    }
    for {
        err := op()
        if err == nil { return nil }
        t.Reset(backoff)
        select {
        case <-ctx.Done():
            t.Stop() // explicit cleanup
            return ctx.Err()
        case <-t.C:
        }
        backoff *= 2
    }
}
```

**Follow-up.** *Why call `t.Stop()` in the cancel branch?* — Because the timer might not have fired yet when `ctx.Done()` won. Stopping releases the runtime slot earlier. On Go 1.23 it also closes the channel-pinning loophole.

---

### Q11. Compare `time.Tick`, `time.NewTicker`, and "rolling your own with `time.AfterFunc`."

**Model answer.**

| Approach | Stoppable | Idiomatic for | Risk |
|---|---|---|---|
| `time.Tick(d)` | No | Program-lifetime tickers in `main` | Leaks if caller exits |
| `time.NewTicker(d)` + `defer Stop()` | Yes | Long-lived loops with cleanup | Forget `Stop()` → leak |
| `time.AfterFunc(d, fn)` chain | Yes via `Stop()` | One-shot deferred, low frequency | Closures pin state |
| `time.NewTimer(d)` + `Reset` in select | Yes | Per-iteration idle timeouts | Reset/Stop dance pre-1.23 |

The choice is driven by who owns the schedule. For a periodic background task tied to a long-lived goroutine, `NewTicker` is the answer. For "wake me up once after this delay," `NewTimer` is the answer. `AfterFunc` is convenient when there is no goroutine to host the loop, but watch the captured-state cost.

**Follow-up.** *Why have all three at all?* — Each fills a different ergonomics niche. `Tick` for the one-line top-level case, `NewTicker` for the goroutine-with-loop case, `AfterFunc` for the "no goroutine to host this" case. The trade-off in each is some safety: `Tick` cannot be stopped, `NewTicker` requires discipline, `AfterFunc` runs the callback on the runtime's timer goroutine and pins closures.

---

### Q12. How do you write a unit test that catches a timer leak?

**Model answer.** Three complementary techniques.

1. **`runtime.NumGoroutine()` before/after the function.** A noisy signal but cheap. If the function should not spawn long-lived goroutines, assert that the count returns to baseline within a short polling window.

2. **`go.uber.org/goleak`.**

```go
func TestNoLeak(t *testing.T) {
    defer goleak.VerifyNone(t)
    runMyFunction()
}
```

`goleak` enumerates goroutines and fails the test if any unexpected goroutines remain. It does not directly detect *timer* heap entries, but most timer leaks manifest as parked goroutines visible to goleak.

3. **`runtime.MemStats` for timer-heap pressure.** Read `runtime.NumGoroutine` and force a GC, then check `runtime.MemStats.HeapAlloc`. For a true timer leak, the allocation graph reaches a steady state proportional to the leak rate × the average timer duration.

For a stronger guarantee, use the `runtime/debug.SetGCPercent(-1)` trick to disable GC during the test, run the function in a loop, and assert that allocation does not grow more than X bytes per iteration.

**Follow-up.** *Can `pprof` directly show timer-heap size?* — Indirectly. The pprof heap profile attributes allocations to `time.NewTimer` and `runtime.startTimer`; if those are growing, you have a timer leak. The `runtime/trace` tool shows timer events, but for offline analysis the heap profile is more practical.

---

## Senior

### Q13. Walk through what happens inside the runtime when you call `time.NewTimer(d)`.

**Model answer.**

1. The function allocates a `time.Timer` struct on the heap. The struct contains a 1-element buffered channel `C`, the deadline, a callback (sends the firing time on `C`), and a state byte.
2. The runtime allocates a `runtime.timer` internal struct that mirrors the `time.Timer`.
3. The runtime places the internal timer into the **timer heap** of the current `P` (logical processor). The heap is a 4-ary min-heap keyed by deadline. Insertion is O(log n).
4. If the new timer's deadline is earlier than the head of the heap, the runtime kicks the timer thread (or the sysmon thread) to ensure the wakeup happens at the new earliest deadline.
5. `time.NewTimer` returns the `*time.Timer` to the user.

When the deadline arrives:

6. The runtime pops the timer from the heap.
7. The timer's callback runs (in pre-1.23 versions, on the timer thread; in 1.23+ on the same P via the runtime's timer machinery).
8. The callback sends the firing time on `C` (non-blocking, because `C` is buffered with capacity 1).
9. The timer is marked as expired.

When `Stop()` is called:

10. The runtime locates the timer in its P-local heap and removes it.
11. `Stop` returns `true` if the timer was still in the heap (i.e., it had not yet fired); `false` if it had already been popped.

Pre-Go-1.23, step 3 also caused the runtime to keep a strong pointer to the timer (via the heap entry), preventing GC. Go 1.23 changed this so the runtime drops timers whose channels are unreferenced — the GC sweep tells the timer heap to evict them.

---

### Q14. Describe the Go 1.23 timer GC change in detail.

**Model answer.** Before Go 1.23, the runtime's timer heap entries kept the timer alive even if the user's code had dropped all references. This was because the heap entry was a strong pointer. The timer would only be removed when:

- The timer fired (via deadline).
- The user called `Stop()` (or `Reset` followed by Stop logic).

This meant a `time.After` call in a loop produced a slow-growing population of dormant timers in the heap that could never be reclaimed until they fired. For short timeouts this was tolerable; for long timeouts (5 minutes, 1 hour) it was a memory leak.

Go 1.23 reworked the timer machinery in two key ways:

1. **Timer channels can be garbage-collected.** The runtime keeps a weak reference to the timer's channel. When the GC determines the channel is unreachable from user roots, it removes the timer from the heap during the next sweep.
2. **`Stop` and `Reset` are now race-free with respect to receives.** The runtime atomically drains any pending value from the channel when `Stop` or `Reset` is called. This eliminates the `if !t.Stop() { select-default-drain }` dance.

The net effect: `time.After` and `NewTimer` are now safe to use without manual stops, *for memory*. The runtime heap may still see the timer until GC fires (which can take some time after the channel is unreferenced), but the leak is now bounded by GC frequency, not by the timer's deadline.

For CPU and allocation cost, hoisting timers out of hot loops is still the right pattern. The change only removes the memory-pinning issue.

**Follow-up.** *Will this make older code automatically faster after upgrading?* — Some memory-pressure issues will go away. CPU will not change much, because the timer-heap operations are still per-iteration. Code that was hot enough to OOM on `time.After` will run cleaner; code that was hot enough to dominate CPU on `time.After` will not get faster.

---

### Q15. A service shows `runtime.MemStats.HeapAlloc` slowly growing over hours. pprof shows `time.NewTimer` allocations at the top. How do you isolate the source?

**Model answer.** Step by step.

1. **Confirm the diagnosis.** Take two heap profiles 10 minutes apart. Diff them with `pprof -base old.pprof new.pprof`. The growth in `time.NewTimer` allocations should be visible.
2. **Get the call stacks.** `pprof -alloc_objects -focus=time.NewTimer` shows callers. Look for unexpected paths: a deeply nested function calling `time.After`, a library you did not write, a recently merged change.
3. **Goroutine profile.** `/debug/pprof/goroutine?debug=2` lists every goroutine. Search for `time.After` or `time.NewTimer` in stacks. If the same call site has 10 000 goroutines parked at the same `select`, that is your loop.
4. **Code search.** `grep -rn 'time.After' .` lists every usage. Audit each: is it inside a loop? Is it inside a hot path?
5. **Add metrics.** Wrap suspect functions with `runtime.NumGoroutine()` before and after; expose as a metric. Watch which function correlates with the growth.
6. **Confirm the fix.** Once you have a candidate, deploy and verify the heap stops growing.

In practice, the fix is almost always: replace `time.After` in a loop with a hoisted `*time.Timer` + `Reset`, or with `context.WithTimeout` and `<-ctx.Done()`.

**Follow-up.** *What is the difference between `alloc_objects` and `alloc_space` in pprof?* — `alloc_objects` counts allocations regardless of size; `alloc_space` counts allocated bytes. For timer leaks, `alloc_objects` is the better filter because timers are small but numerous.

---

### Q16. How do you design a long-running goroutine that has both an idle timeout and a heartbeat?

**Model answer.** Two timers, both hoisted, neither leaked.

```go
func work(ctx context.Context, in <-chan job) error {
    const idleTimeout = 30 * time.Second
    const heartbeatPeriod = 5 * time.Second

    idle := time.NewTimer(idleTimeout)
    defer idle.Stop()
    heartbeat := time.NewTicker(heartbeatPeriod)
    defer heartbeat.Stop()

    for {
        select {
        case <-ctx.Done():
            return ctx.Err()
        case <-idle.C:
            return ErrIdle
        case <-heartbeat.C:
            emitHeartbeat()
        case j, ok := <-in:
            if !ok {
                return nil
            }
            if err := process(j); err != nil {
                return err
            }
            // Reset idle on activity.
            if !idle.Stop() {
                select { case <-idle.C: default: }
            }
            idle.Reset(idleTimeout)
        }
    }
}
```

The key choices:

- One `time.Timer` for idle (resettable), one `time.Ticker` for heartbeat (periodic).
- Both have `defer Stop()` at the top.
- Idle timer is reset only on activity, not on heartbeat firing — heartbeats don't count as activity.
- The reset-drain dance is required pre-1.23; harmless post-1.23.

**Follow-up.** *Why not use `context.WithTimeout` for the idle case?* — Because `WithTimeout` is not resettable. You would need `WithCancel` + a goroutine that watches activity and calls `cancel` — which is a more complex implementation of the same idea. Direct `*time.Timer` is simpler.

---

### Q17. Two engineers debate whether to use `time.After` in a one-shot timeout. One says "Go 1.23 made it safe." The other says "Always use `NewTimer`." Who is right?

**Model answer.** Both are partially right.

- For a **one-shot** timeout that fires at most once and is not in a tight loop, `time.After(d)` is fine on any Go version. The timer fires once and is then collected. No leak.
- For a **looped** timeout where the timer is re-created on every iteration, the answer depends on the Go version. On 1.23+, the memory leak is gone, but the per-iteration allocation cost remains. For a hot loop, `NewTimer` + `Reset` is still measurably faster.
- For a **one-shot timeout that races against an operation that might complete first**, `time.After` is still slightly wasteful — the timer continues running after the operation completes. On 1.23+, GC will eventually clean it up; on older versions, the timer lives until its deadline.

The honest answer for code review: in *new* code, prefer `time.NewTimer(d); defer t.Stop()` for any timeout that may need to be cancelled. The extra two lines pay for themselves in clarity and version-independence.

**Follow-up.** *What about `context.WithTimeout`?* — It is a better abstraction for "this operation should not exceed d." The context propagates cancellation through to inner calls. Use `context.WithTimeout` for operations; use `*time.Timer` for select cases that need a per-iteration timeout.

---

### Q18. Explain how `time.Ticker` interacts with system suspend/resume on a laptop.

**Model answer.** `time.Ticker` is implemented against the monotonic clock. When the host suspends (laptop sleep), the monotonic clock stops advancing. When the host resumes, the monotonic clock resumes from where it left off — it does not jump forward by the duration of the suspend.

The consequence: a ticker with `d = 1 second` and a 1-hour suspend will *not* fire 3600 catch-up ticks. It will fire one tick within `d` of resume, then continue normally. Tick events that "should have fired" during suspend are silently dropped. The channel buffer holds at most one value.

This is usually the right behaviour — you do not want a 1-hour stampede on resume — but it is a surprise to engineers expecting wall-clock semantics.

For wall-clock-anchored periodic work, compute the next deadline from `time.Now()` (which uses the wall clock) and `Reset` a `*time.Timer` to fire at that absolute time. This way, if the host suspends across a deadline, the timer fires immediately on resume.

**Follow-up.** *What about virtualised environments where clock skips forward?* — Some hypervisors fast-forward the monotonic clock on resume. Behaviour depends on the host and the kernel's clocksource. Tests should account for this — never assume `time.Sleep(d)` blocks for exactly `d` real-world seconds.

---

### Q19. How would you build a leak detector that finds `time.After`-in-a-loop bugs statically?

**Model answer.** A static analyser (e.g., a `go vet` pass or a `staticcheck` rule) can flag `time.After` inside loop bodies. The algorithm:

1. Walk the AST of the package. For each function, find every `time.After` call.
2. Check whether the call site is syntactically inside a `for` statement.
3. If yes, emit a warning: "`time.After` inside loop; consider hoisting `*time.Timer`."

False positives are common: `time.After` is sometimes legitimate inside a loop (e.g., a backoff that increases each iteration and is short enough that leaks do not matter). A good rule allows an explicit `//nolint:timer-loop` comment to suppress.

Refined heuristics:

- If the loop is bounded (`for i := 0; i < N; i++` with N a small constant), suppress.
- If the loop body returns on every path that does not use `time.After`'s channel, the timer is a per-iteration timeout — flag as definite issue.
- If `time.After` is inside a `defer`, suppress (the timer fires once at function exit).

A complementary runtime detector samples `runtime.MemStats` periodically and reports if `Mallocs` attributed to `time.NewTimer` grows faster than the function's call rate.

**Follow-up.** *Are there existing tools?* — Yes: `staticcheck` has `SA1015` ("`time.Tick` should not be used in a function that exits"). For `time.After`, there are several linters (`tickerleak`, custom `revive` rules). Building your own is feasible.

---

### Q20. A senior engineer claims "the Go scheduler is the right place to put timers; user code should never need to think about timer hygiene." How would you respond?

**Model answer.** The claim is half right. The scheduler does manage timer heaps efficiently, and the Go 1.23 change eliminated the worst memory-pinning issues. For a service with a few dozen long-lived timers, the user does not need to think about it.

But the claim ignores three real issues:

1. **Allocation cost.** Every `time.NewTimer` is a small heap allocation. In a hot loop, that allocation shows up in CPU profiles and GC pressure. The scheduler cannot make heap allocations free.
2. **Timer heap operations are O(log n).** A service with 100K active timers has slower insert/remove than a service with 100. Allocation rate matters at scale.
3. **Cancellation semantics.** A timer the user holds is cancellable; an anonymous `time.After` timer is not. For correctness of long-tail behaviour, the user must hold the timer.

The honest answer: for low-rate, long-lived timers, the scheduler is fine. For hot paths, user code must care. The Go 1.23 change reduces but does not eliminate the need for timer hygiene.

**Follow-up.** *What would a "perfect" timer API look like?* — Some teams have proposed `time.AfterCtx(ctx, d) <-chan time.Time` that cancels with the context. Others propose adding `Reset` to `time.Ticker` with intervals. Both are under discussion in the Go issue tracker. Until then, the existing API requires discipline.

---

## Staff

### Q21. Read this code carefully. Identify every concurrency or timing issue.

```go
type Cache struct {
    mu    sync.Mutex
    items map[string]*item
}

type item struct {
    value   []byte
    expires time.Time
}

func (c *Cache) Set(key string, value []byte, ttl time.Duration) {
    c.mu.Lock()
    c.items[key] = &item{value: value, expires: time.Now().Add(ttl)}
    c.mu.Unlock()
    time.AfterFunc(ttl, func() {
        c.mu.Lock()
        delete(c.items, key)
        c.mu.Unlock()
    })
}
```

**Model answer.** Several issues, in order of severity.

1. **Replacement race.** If `Set("foo", v1, ttl)` is called, then `Set("foo", v2, longerTTL)` is called before `ttl` elapses, the first timer still fires and deletes `"foo"` — destroying the second value early.
2. **Timer leak per write.** Every `Set` creates a timer. There is no `Stop` on overwrite. A workload of 100K writes/sec with a 1-hour TTL holds 360M live timers.
3. **No `Stop` path.** The `Cache` has no `Close` method. If the program exits via shutdown signal, the timers' callbacks may run as goroutines on a half-collected `Cache`.
4. **Closure pins the key.** The `AfterFunc` callback captures `key` as a string. The string's backing array stays alive in the timer heap for the full TTL.
5. **Mutex held during delete.** Minor: the closure takes the mutex inside the callback, which could contend with `Set`. Acceptable but worth noting.
6. **No size bound on `items`.** Orthogonal to timing, but a real production gap.

**Fix sketch.** Replace per-write timers with a single janitor goroutine:

```go
func (c *Cache) janitor(ctx context.Context) {
    ticker := time.NewTicker(time.Second)
    defer ticker.Stop()
    for {
        select {
        case <-ctx.Done(): return
        case now := <-ticker.C:
            c.mu.Lock()
            for k, v := range c.items {
                if now.After(v.expires) { delete(c.items, k) }
            }
            c.mu.Unlock()
        }
    }
}
```

Now there is one timer for the whole cache, expiration sweep is O(n) per second (acceptable for caches in the millions), and no closures pin keys.

---

### Q22. Two services connect via a long-lived RPC channel. The receiver expects a heartbeat every 30 seconds; missing one triggers reconnection. Design the heartbeat loop on both sides, and explain the failure modes.

**Model answer.**

**Sender side.**

```go
func sendHeartbeats(ctx context.Context, conn *Conn) {
    ticker := time.NewTicker(30 * time.Second)
    defer ticker.Stop()
    for {
        select {
        case <-ctx.Done(): return
        case <-ticker.C:
            if err := conn.WriteHeartbeat(); err != nil {
                log.Printf("heartbeat send failed: %v", err)
                return
            }
        }
    }
}
```

**Receiver side (idle timeout).**

```go
func receiveLoop(ctx context.Context, conn *Conn) error {
    const idleTimeout = 90 * time.Second // 3x the sender period
    idle := time.NewTimer(idleTimeout)
    defer idle.Stop()
    for {
        select {
        case <-ctx.Done():
            return ctx.Err()
        case <-idle.C:
            return ErrIdleTimeout
        default:
        }
        // Read with a deadline that mirrors idle.
        conn.SetReadDeadline(time.Now().Add(idleTimeout))
        msg, err := conn.Read()
        if err != nil { return err }
        if !idle.Stop() {
            select { case <-idle.C: default: }
        }
        idle.Reset(idleTimeout)
        handle(msg)
    }
}
```

Failure modes:

1. **Clock skew between hosts.** Use monotonic time on each host; timestamps in the protocol are advisory.
2. **Sender ticker drift.** `time.NewTicker(30s)` does not guarantee exactly 30s; under load it may drift to 30.5s. The receiver's 3x slack absorbs this.
3. **Read deadline + idle timer redundancy.** Both serve the same purpose; one without the other is fragile. Both together is defence-in-depth.
4. **Network partition vs. process death.** Both look the same to the receiver — no traffic. The reconnect logic must be idempotent.
5. **Reconnect storms.** When a switch reboots, thousands of clients reconnect simultaneously. Add jitter to the initial reconnect delay.

**Follow-up.** *Why 3x and not 2x?* — A 2x slack tolerates one missed heartbeat; 3x tolerates two. Two missed heartbeats is the bar most production systems set: one might be unlucky GC pause, two implies real failure.

---

### Q23. You run a service in a Kubernetes pod that occasionally gets throttled (the CFS quota stops the cgroup). Heartbeats from this pod are timed out by a peer. What is happening, and how do you fix it?

**Model answer.** When the pod hits its CPU limit, the Linux CFS quota mechanism stops scheduling the pod for up to 100 ms. During that stop, no Go code runs — including the timer-driven heartbeat goroutine. The peer sees no traffic for the duration of the stall and times out.

Diagnostic steps:

1. Check pod CPU throttling metrics. In Kubernetes, `container_cpu_cfs_throttled_seconds_total` per pod. If it's nonzero, you have throttling.
2. Correlate throttling with heartbeat timeout events. They should happen at the same wall-clock seconds.

Fixes, in order of preference:

1. **Raise the CPU limit** to leave headroom. Make sure your container has burst capacity.
2. **Set `GOMAXPROCS` to match the limit.** Use `go.uber.org/automaxprocs`. Otherwise Go thinks it has all node CPUs and over-schedules, paying many context switches when it runs.
3. **Lower the heartbeat frequency** if appropriate. 30s instead of 10s reduces sensitivity.
4. **Increase the peer's idle timeout** to absorb up to one throttling window.
5. **Move heartbeat work off the same goroutine pool as request handling.** A dedicated goroutine with high priority (`runtime.LockOSThread` + Linux thread priority via cgo) can keep ticking even during throttle, though this is fragile.

The deeper lesson: a service that depends on millisecond-accurate heartbeats from a throttled pod will always be fragile. Heartbeat budgets should be sized to tolerate the worst-case stall.

**Follow-up.** *How do you know your timer was the throttled goroutine?* — `runtime/trace` shows goroutine state over time. A long gap with no `proc` events for the timer goroutine, while other Ps were also stopped, points to host-level throttling.

---

### Q24. Design a connection pool that closes connections after `idleTimeout` of disuse, without leaking timers under churn.

**Model answer.** The naive design — one `*time.Timer` per idle connection — leaks timers under high churn (10K conns/sec, each held idle 30s = 300K live timers).

Better design: a single janitor goroutine and a sorted data structure of (deadline, conn) pairs.

```go
type Pool struct {
    mu       sync.Mutex
    idle     []idleConn // sorted by expireAt
    janitor  chan struct{}
}

type idleConn struct {
    conn     net.Conn
    expireAt time.Time
}

func (p *Pool) Return(c net.Conn) {
    p.mu.Lock()
    p.idle = append(p.idle, idleConn{c, time.Now().Add(idleTimeout)})
    // idle is now sorted because we always insert at the end with monotonic time.
    p.mu.Unlock()
    select { case p.janitor <- struct{}{}: default: }
}

func (p *Pool) runJanitor(ctx context.Context) {
    t := time.NewTimer(time.Hour)
    defer t.Stop()
    for {
        next := p.nextDeadline()
        if next.IsZero() {
            if !t.Stop() { select { case <-t.C: default: } }
            t.Reset(time.Hour) // sentinel "no work"
        } else {
            d := time.Until(next)
            if d < 0 { d = 0 }
            if !t.Stop() { select { case <-t.C: default: } }
            t.Reset(d)
        }
        select {
        case <-ctx.Done():
            return
        case <-t.C:
            p.evictExpired()
        case <-p.janitor:
            // wake up to recompute next deadline
        }
    }
}
```

Properties:

- One timer for the entire pool, regardless of size.
- O(1) insertion (with monotonic-time guarantee).
- O(k) eviction where k is the number of expired connections.
- `Return` is non-blocking (the `select default` skips if the wake channel is full).
- Janitor exits cleanly on `ctx.Done()`.

**Follow-up.** *What is the trade-off vs. one-timer-per-conn?* — One-timer-per-conn is O(log n) per operation (timer-heap insert) and stateless; the janitor is O(1) average but requires a separate goroutine and a synchronisation channel. At low churn, both are fine. At high churn, the janitor wins.

---

### Q25. What goes on a code-review checklist specifically for time-based concurrency?

**Model answer.** My personal list, refined over many incidents.

1. **No `time.After` inside a loop unless the loop is bounded to N=O(10).** Look for `for ... select ... case <-time.After`. Almost always a leak.
2. **`time.Tick` only at top level.** Anywhere else, replace with `NewTicker` + `defer Stop()`.
3. **Every `NewTicker` and `NewTimer` has a clear `Stop()` path** — usually `defer`. Verify by reading the function exit paths.
4. **`Reset` on a timer is preceded by `Stop` and a drain** on Go versions before 1.23. On 1.23+ this is no longer required but is harmless to keep for portability.
5. **`time.AfterFunc` callbacks are short and do not capture large state.** If they capture a key or a value, mark for review — the closure pins everything.
6. **No `time.Sleep` for synchronisation in production code.** Sleep is a code smell outside of tests; prefer a channel or `ctx.WithTimeout`.
7. **`context.WithTimeout` is used at RPC boundaries**, with `defer cancel()`.
8. **Tests assert no goroutine leak via `goleak`** for any function that spawns timers.
9. **No timer is created and immediately dropped.** `time.NewTimer(d).C` without saving the timer is the same trap as `time.After`.
10. **Resource closer functions (`*os.File.Close`, `net.Conn.Close`) are reachable from every error path.** Timer goroutines often hold these.
11. **GOMAXPROCS in production matches the cgroup CPU limit**, especially for services with high timer-heap pressure. Throttling amplifies timer-skew.
12. **No `time.NewTicker(0)` or `time.NewTimer(0)`.** Zero duration tickers panic; zero-duration timers fire immediately but allocate.
13. **Mocking time in tests** uses an injectable clock (e.g., `clockwork.Clock`), not `time.Sleep` based assertions.

---

### Q26. A team adopts a "no `time.After` ever" rule. Is this wise? Argue both sides.

**Model answer.**

**In favour.** The rule is mechanical and easy to enforce. Linters can flag every use. It removes an entire class of bugs from the codebase. New engineers don't have to memorise version-specific GC rules. The cost — three extra lines for `NewTimer` — is negligible. For a team without strong Go expertise, this is a defensible policy.

**Against.** The rule is over-broad. `time.After` is genuinely correct in many places: one-shot timeouts at top-level entry points, sleep-with-cancel idioms, simple test fixtures. Banning it leads to "ceremonial" code where every timeout is wrapped in `NewTimer`-`Stop` even when no leak is possible. The rule also implies that the engineers don't understand the underlying issue, which limits how well they can debug related problems.

**My take.** A "no `time.After` in loops" rule is better. It targets the actual failure mode. A "no `time.After` in long-running goroutines" rule is even better. A "no `time.After` ever" rule is a sledgehammer that solves the problem but loses information.

**Follow-up.** *How would you enforce "no `time.After` in loops" via tooling?* — A custom linter pass that walks the AST and flags `time.After` calls inside `for` bodies, with a `//nolint:timer-loop` escape hatch.

---

### Q27. Explain how `time.AfterFunc` interacts with the Go scheduler.

**Model answer.** `time.AfterFunc(d, fn)` schedules `fn` to run after `d`. The runtime stores the function in the timer heap. When the timer fires, the runtime *does not* run `fn` synchronously on the scheduling goroutine — it queues `fn` to run on a freshly minted goroutine.

Implications:

1. **`fn` runs concurrently with the rest of the program.** If `fn` touches shared state, you need locks.
2. **`fn` cannot block the timer thread.** Pre-Go 1.10, the timer thread itself ran timer callbacks; a slow callback could delay other timers. Modern Go fans out callbacks to fresh goroutines, so this is fixed.
3. **The new goroutine costs ~2 KB stack** even if `fn` is trivial.
4. **`recover()` inside `fn`** is per-goroutine; an unrecovered panic in `fn` kills the entire process.
5. **`fn`'s captured state is held by the timer**, even before firing. This is the closure-pin issue from Q9.
6. **Returning `*time.Timer` allows cancellation.** `t.Stop()` removes the timer from the heap; if `Stop` returns `true`, `fn` will not run. If it returns `false`, `fn` either has already run or is currently running.

**Race window.** Between the moment the timer fires (enqueues `fn` for execution) and the moment `fn` actually starts running, `t.Stop()` returns `false` but `fn` has not yet run. There is no way to cancel `fn` once it has been enqueued. For idempotent or guard-checking callbacks, this is fine; for callbacks with externally visible effects, design accordingly.

**Follow-up.** *Why a fresh goroutine and not a pool?* — Simplicity and isolation. A pool would require pre-allocation, panic isolation, and re-entrancy guards. A fresh goroutine is straightforward and the Go scheduler is optimised for short-lived goroutines.

---

### Q28. Compare `time.After` to `<-ctx.Done()` with a `WithTimeout`. When is each appropriate?

**Model answer.**

| Concern | `time.After` | `WithTimeout` |
|---|---|---|
| Cancellable | No (anonymous timer) | Yes (`cancel()`) |
| Propagates to children | No | Yes |
| Carries deadline | No | Yes (queryable via `ctx.Deadline()`) |
| Allocation per use | One `*time.Timer` | One `context` + one `*time.Timer` internally |
| Composable | Limited | Yes (chains with parent ctx) |
| Idiomatic for | Local, in-function timeouts | Operations that span function boundaries |

Use `time.After` (or `NewTimer`) when:

- The timeout is local to one function and one `select`.
- No downstream calls need to know about the deadline.
- Code is trivial and short-lived.

Use `context.WithTimeout` when:

- The timeout applies to an operation that calls into other functions.
- Downstream calls should respect the same deadline.
- You want to convey deadline information to remote services via headers (gRPC's deadline propagation, HTTP `X-Deadline`).

In practice, idiomatic Go services pass `ctx` everywhere and use `ctx.Done()` for timeouts. `time.After` survives in lower-level utilities and tests.

---

### Q29. A monitoring dashboard shows `go_goroutines` rising slowly over weeks, eventually causing the pod to OOM. Heap dumps show a forest of stacks parked in `time.Sleep` and `time.After`. What is your action plan?

**Model answer.** Production triage in order.

1. **Stabilise.** Scale horizontally, increase memory, restart on a schedule (rolling restart every 24h) — anything to buy time. Document the workaround.
2. **Quantify.** Plot `runtime.NumGoroutine` over time, alongside RPS, deploys, and any other changes. Pinpoint when growth started.
3. **Snapshot.** Grab `/debug/pprof/goroutine?debug=2` from a worst-offender pod. Group stacks by location. One or two stacks should dominate.
4. **Read the code.** The stack tells you the function. Read it. Look for `time.After` in loops, `time.Sleep` instead of `select`, `time.Tick` instead of `NewTicker`.
5. **Make a hypothesis.** Form a story for why goroutines accumulate. "Every `Subscribe` spawns a goroutine that waits on `time.After(1*time.Hour)` and never exits early."
6. **Test the fix locally.** Reproduce with a unit test that exercises the same path. Watch goroutine count via `goleak`.
7. **Deploy a fix to one pod.** Compare goroutine growth between fixed and unfixed pods.
8. **Roll out gradually.** Watch for regressions.
9. **Add a regression test.** Goleak or similar, enforced in CI.
10. **Postmortem.** Document the root cause, the fix, and (most importantly) the linter rule or review checklist item that would have caught it earlier.

The pattern "lots of goroutines parked in `time.Sleep` or `time.After`" is one of the most common leak shapes. The fix is almost always to replace the sleep with a `select { case <-ctx.Done(): ; case <-time.After(d): }`, or to hoist the timer.

---

### Q30. A new engineer asks "why does Go even have `time.Tick` if it leaks?" What do you say?

**Model answer.** History. `time.Tick` predates the modern goroutine-and-cancellation idiom. In early Go, code was often single-process, single-binary, lived for the whole program lifetime. A `for range time.Tick(d)` loop was a clean way to write "run every d seconds forever." There was no leak because the program ran forever anyway.

As Go matured into a server language, code became more modular: handlers spawn goroutines, libraries are reused, services hot-reload. In that world, `time.Tick` became a footgun because the function that called it usually didn't run forever.

The Go team kept `time.Tick` for backward compatibility and for legitimate top-level uses. The documentation explicitly warns: "The ticker cannot be recovered by the garbage collector; it leaks." That warning is the team's way of saying "we know this is sharp; use it intentionally."

Modern best practice: use `time.NewTicker` everywhere except in `main` or a top-level long-lived setup. Even there, prefer `NewTicker` for the muscle memory.

**Follow-up.** *Has the Go 1.23 timer GC change saved `time.Tick`?* — Partially. The channel can now be reclaimed once unreferenced, which removes the memory leak in many cases. But you still cannot proactively `Stop` it, so ticks continue queuing into the channel until GC, and the ticker thread still drives that channel. The semantic gap remains.

---

### Q31. You inherit a codebase with 200 occurrences of `time.After`. How do you triage?

**Model answer.** Mechanical first, then judgmental.

**Mechanical pass.**

1. Run a script: `grep -rn 'time.After(' .` → list of all call sites with line numbers.
2. Classify each by context using simple heuristics:
   - Inside a `for` body → high risk.
   - At top level of a function (not in a loop) → low risk.
   - Inside a `defer` → very low risk.
3. Triage the high-risk ones first: maybe 20-40 of 200.

**Judgmental pass.**

4. For each high-risk site, read the surrounding function:
   - Is the loop bounded? If yes, suppress.
   - Is the timeout duration short (e.g., 100 ms) and the loop slow? Suppress.
   - Is the timeout long (>5 s) and the loop hot? Fix.
5. For each "fix" site, replace with `NewTimer` + `Reset`. The diff is mechanical:

```go
// Before
for {
    select { case <-ch: ; case <-time.After(d): return }
}

// After
t := time.NewTimer(d)
defer t.Stop()
for {
    if !t.Stop() { select { case <-t.C: default: } }
    t.Reset(d)
    select { case <-ch: ; case <-t.C: return }
}
```

6. Add `goleak` tests for the modified functions.
7. Add a `staticcheck` configuration that flags new `time.After` in loops.

The result: maybe 20-30 hot-loop fixes, the other 170+ left alone. Don't churn safe code.

**Follow-up.** *How long would this take?* — A focused engineer can do 30-50 sites per day. Two days of focused effort fixes the entire problem space in a typical codebase.

---

### Q32. Walk through how you would build an in-memory test clock for time-dependent code.

**Model answer.** The interface looks like this:

```go
type Clock interface {
    Now() time.Time
    After(d time.Duration) <-chan time.Time
    NewTimer(d time.Duration) Timer
    NewTicker(d time.Duration) Ticker
}

type Timer interface {
    C() <-chan time.Time
    Stop() bool
    Reset(d time.Duration) bool
}
```

Production code takes a `Clock` parameter. Production uses a `realClock` that delegates to `time` directly. Tests use a `fakeClock`:

```go
type fakeClock struct {
    mu     sync.Mutex
    now    time.Time
    timers []*fakeTimer // sorted by deadline
}

func (c *fakeClock) Now() time.Time {
    c.mu.Lock(); defer c.mu.Unlock()
    return c.now
}

func (c *fakeClock) Advance(d time.Duration) {
    c.mu.Lock()
    c.now = c.now.Add(d)
    var ready []*fakeTimer
    for _, t := range c.timers {
        if !t.deadline.After(c.now) { ready = append(ready, t) }
    }
    c.mu.Unlock()
    for _, t := range ready {
        select { case t.ch <- c.now: default: }
    }
}
```

`Advance(d)` simulates the passage of `d` virtual seconds and fires all timers whose deadlines fall in that window.

Tests look like:

```go
clk := newFakeClock(time.Unix(0, 0))
go service(clk)
clk.Advance(30 * time.Second)
require.Equal(t, ..., service.LastResult())
```

Properties:

- Deterministic — no real `time.Sleep`, no flaky tests.
- Fast — no waiting for wall clock.
- Composable — tests can simulate hours of activity in microseconds.

The popular library `github.com/benbjohnson/clock` and `github.com/jonboulle/clockwork` implement this interface.

**Follow-up.** *What about code that mixes channels and timers in complex `select`s?* — That is where fake clocks get tricky. You need to drive both the clock and the channels; otherwise the goroutine may race the test. The libraries provide `BlockUntil(n)` helpers that wait until exactly `n` goroutines are sleeping, so the test can advance the clock at a known moment.

---

### Q33. Two flame graphs of the same service show the same throughput, but one has `time.NewTimer` dominating CPU and the other has clean profiles. What changed?

**Model answer.** Most likely: someone added a hot loop with `time.After` inside, or refactored a function such that its caller now runs in a tight loop. Specific scenarios:

1. **An RPC handler now retries inline.** Each retry calls `time.After` to back off. Under load, retries dominate.
2. **A worker pool was resized.** Each worker has a `select` with `time.After`; if the pool grew from 10 to 1000, you have 100x the `time.After` calls.
3. **A timeout was lowered.** Shorter timeouts mean more firing per unit time. If a `time.After(1*time.Minute)` was changed to `time.After(1*time.Second)`, the timer creation rate is unchanged but the firing rate is 60x.
4. **A library was upgraded.** The new version has a polling loop with `time.After` where the old one used a channel-driven design.
5. **A leak surfaced.** Goroutines parked on `time.After` from previous requests accumulate; each adds one timer-heap entry. The cost is per-tick, not per-goroutine, but enough timers add up.

How to diagnose:

1. Diff the two pprof CPU profiles. Look for new callers of `time.NewTimer`.
2. `git log` between the deploys. Look for commits touching `time.After`, `time.NewTimer`, or any retry/backoff code.
3. Check `runtime.NumGoroutine` between the two versions; a leak shows up as a higher steady-state.
4. Confirm by reverting the suspect commit and re-profiling.

**Follow-up.** *What's the cost of a single `time.NewTimer` call?* — On modern x86, roughly 100-300 ns for the allocation, heap insert, and runtime bookkeeping. At 1M calls/sec, that is 30% of one CPU core spent on timer creation.

---

### Q34. What is `runtime.timer` (internal) and how does it relate to `time.Timer` (user-visible)?

**Model answer.** Two distinct structs.

- **`time.Timer`** (in `src/time/sleep.go`) is the user-facing type. It has fields `C chan Time`, a runtime function pointer, and a value to pass through. Methods: `Stop`, `Reset`. Documented in `pkg.go.dev/time#Timer`.
- **`runtime.timer`** (in `src/runtime/time.go`) is the runtime's internal representation. It has fields like `when` (deadline in monotonic ns), `period` (for tickers), `f` (the function to run on fire), `arg` (the argument to `f`), and links into the per-P timer heap.

The relationship: `time.NewTimer` creates a `time.Timer` and calls `runtime.startTimer`, passing it a `runtime.timer` configured to call back into `time.sendTime`, which sends on the channel.

This separation lets the runtime evolve its internal representation independently of the user-facing API. Go 1.10's "per-P timer heap" change was internal-only. Go 1.23's GC change is mostly internal-only, with a small visible change in `Stop`/`Reset` semantics.

When debugging, both perspectives matter. `pprof` shows allocations of `time.Timer` (user side). `runtime/trace` shows timer firing events (runtime side). For deep dives, the runtime source is the source of truth.

---

### Q35. Why is `<-time.After(0)` not the same as a zero-cost no-op?

**Model answer.** `time.After(0)` allocates a `*time.Timer` and a channel. The timer is configured with a zero duration, so it fires immediately (typically within microseconds, but not synchronously). The receive `<-time.After(0)` then blocks just long enough for the timer to fire and queue its value on the channel.

The cost:

- One heap allocation (the `time.Timer`).
- One channel allocation.
- One insert into the runtime's timer heap.
- A scheduling round-trip — the goroutine yields and is rescheduled when the timer fires.

For a zero-duration sleep, `runtime.Gosched()` is cheaper (no allocation, no timer heap, just a yield).

For "spin until a condition is true," neither is correct — use a channel or `sync.Cond`.

Some code uses `time.After(0)` deliberately to introduce a yield point in `select`. There is usually a cleaner pattern.

**Follow-up.** *Is `time.After(-1)` defined?* — Yes; the timer fires immediately. Negative durations are accepted and treated as zero. Don't rely on this without a comment.

---

### Q36. Summarise the changes the Go 1.23 timer overhaul made and the migration considerations.

**Model answer.** Go 1.23 made three observable changes.

1. **Timer channels can be garbage-collected when unreferenced.** This is the big one. `time.After` is no longer a memory leak in loops.
2. **`Stop` and `Reset` drain the channel automatically.** The `if !t.Stop() { select-default-drain }` dance is unnecessary on Go 1.23+. Existing code with the dance is still correct; new code can omit it.
3. **Timer-firing is more responsive under load.** Internal refactoring reduced lock contention on the timer heap, so timers fire closer to their deadlines under high load.

**Migration considerations.**

- Code that targets multiple Go versions (e.g., libraries published with `go.mod` `go 1.20`) must keep the drain dance. Removing it would silently break on older versions.
- Code that targets Go 1.23+ exclusively can simplify `Reset` calls to `t.Reset(d)` without a preceding `Stop`/drain. This is a small simplification.
- Performance-sensitive code with hot timer loops should still hoist timers — the GC change does not eliminate per-iteration allocation cost.
- `goleak` tests may need adjustment: pre-1.23 they sometimes flagged dormant timer-channel goroutines that 1.23 now lets GC clean up. The fix is usually to let GC run before the test asserts.

**Follow-up.** *How do you decide when to drop the dance?* — Check `go.mod` `go 1.23` or later, and check that no consumer requires earlier. If you publish a library, be conservative; if you ship a binary, drop the dance.

---

### Q37. Imagine you're interviewing me for a staff engineer role. What timer-leak war story would impress you most?

**Model answer.** A story with these elements:

- **Concrete symptom.** "Our payments service was OOM-killing every 36 hours."
- **Diagnosis path.** "We ruled out the obvious — request body sizes, cache growth — by reading `runtime.MemStats` per-pod and correlating with traffic. The HeapAlloc-vs-time graph was linear, not request-correlated."
- **Tooling.** "I attached `pprof` to one healthy and one near-OOM pod, diffed the heap profiles. `time.NewTimer` allocations dominated the diff."
- **Root cause.** "A retry helper deep in the payment-status polling path was calling `time.After(30*time.Minute)` inside a `for` loop. Most calls succeeded fast, but every call left a 30-minute dormant timer in the heap."
- **Fix.** "Replaced the `time.After` with a hoisted `*time.Timer`, and added a `context.WithTimeout` wrapper at the polling-helper boundary so the retry could cancel cleanly."
- **Prevention.** "Wrote a `staticcheck` rule to flag `time.After` in loops, added a `goleak` test for the payment service's main path, and added a runbook entry pairing 'memory growth' with the heap-diff procedure."
- **Lesson.** "The fix was one line; the diagnosis took two engineers four hours. The detection rule pays for itself the next time."

The shape of the story — symptom, diagnosis, root cause, fix, prevention — is more valuable than the specific bug. Show that you have a methodology, not just one example.

---

### Q38. A peer claims "the Go 1.23 fix makes all timer-leak rules obsolete." Counter-argue.

**Model answer.** Three reasons the claim is wrong.

1. **`time.Tick` is still a leak vector.** The fix lets GC reclaim the channel once unreferenced, but the underlying ticker keeps queuing ticks until then. Ticks accumulate in the buffer (capacity 1) and run on the runtime's timer infrastructure. Calling `time.Tick` in a function that exits still wastes resources until GC notices.
2. **Allocation cost remains.** `time.After` in a hot loop still allocates one timer per iteration. The pprof CPU profile will still show `time.NewTimer` at the top under load. The fix is about memory, not CPU.
3. **Cancellation semantics are unchanged.** A `time.After` timer cannot be `Stop`ped because the caller does not hold the `*time.Timer`. If the operation completes early and the timer keeps running, side effects continue — for example, if `AfterFunc` is involved, the callback will still fire. The fix narrows the memory window for these effects; it does not eliminate them.

Additionally: rules in a codebase capture more than just memory. They capture "this code is reviewed and intentional." A "no `time.After` in loops" rule is a clarity guarantee, not just a leak guard.

The fix is great. It does not retire your rules.

**Follow-up.** *Is there any rule that the fix did make obsolete?* — Yes: "always drain the timer channel before `Reset`." On Go 1.23+ this is not required. The dance is still valid (it's a no-op when the channel is already drained), so keeping it for portability is fine.

---

### Q39. Describe the worst timer-related production incident you've seen (or seen described). What was the actual cost in time and dollars?

**Model answer.** A canonical story circulating in the Go community: a real-time bidding (RTB) ad-tech service. The service had a per-request goroutine that listened for upstream responses with a 50 ms timeout via `time.After`. Under normal load (~50K req/s), 90% of requests completed in <10 ms; the timer never fired and was dropped after the request returned.

The bug: the `time.After` timer remained in the runtime heap for the full 50 ms. At 50K req/s × 50 ms = 2500 active dormant timers. Memory-stable. CPU-stable.

Then a customer's traffic 10x'ed overnight. At 500K req/s × 50 ms = 25000 timers, then 50 ms × incoming rate climbed past the timer heap's lock-free path threshold. The timer-heap operations started taking microseconds each. With 500K timer creates/sec × X microseconds each, the timer subsystem started consuming entire CPU cores. The service's tail latency went from p99=12 ms to p99=300 ms. Bid response timeout cascaded into downstream services. SLA violations triggered customer credits.

Total cost: ~$200K in customer credits, two days of incident response (probably $40K of engineer time), one week of on-call paranoia after. The fix was 12 lines: hoist the timer, reuse it across requests in a per-goroutine cache, defer-stop at goroutine exit.

The lesson: timer-leak issues do not manifest at the load they were introduced at. They are latent. They erupt when traffic patterns change, when GC tuning shifts, or when a co-tenant on the same machine starts consuming CPU. The cheap fix is also the right fix; do not wait.

---

### Q40. Synthesise: rate the four leak vectors (`time.After`, `time.Tick`, `time.NewTicker without Stop`, `time.AfterFunc with closure`) by danger.

**Model answer.** From most to least dangerous in real production:

1. **`time.NewTicker without Stop`** — most insidious. The leak is unbounded in time (the ticker runs forever until the program exits) and unbounded in resources (it queues ticks). Most code review catches this if `defer Stop()` is conventional. Most code that misses `defer Stop()` has multiple ticker call sites.
2. **`time.Tick`** — same effect as `NewTicker` without `Stop`, but impossible to fix in place. Once you see `time.Tick(d)` you must rewrite, not patch.
3. **`time.AfterFunc with large captured state`** — moderate. The leak is per-callback, bounded by the duration, but the per-callback memory can be huge if the closure captures buffers, maps, or large structs. Production impact scales with the per-callback size, not the call frequency.
4. **`time.After` in a loop** — historically severe (pre-1.23), now mostly a CPU concern (post-1.23). The memory leak is bounded by the loop's iteration rate × the duration, and on 1.23+ is reclaimable. Still worth fixing for clarity and CPU.

A staff engineer should be able to recognise each at a glance and explain the cost in the codebase's specific context.

**Follow-up.** *What would you ban first if you could only ban one?* — `time.Tick`. It is irreparable and has no legitimate use that `NewTicker` does not also serve.

---

## Summary of follow-ups by level

| Level | Follow-up themes |
|---|---|
| Junior | "Why does `time.After` leak?", "What is `Stop`'s return value?", "Why is `time.Tick` flagged?" |
| Middle | "How do you fix the loop?", "What changed in 1.23?", "How do you test for the leak?" |
| Senior | "Walk through the runtime", "Diagnose from pprof", "Compare to `WithTimeout`" |
| Staff | "Audit a codebase", "Design a leak-free pool/cache", "Make rules for the team", "War-story shape" |
