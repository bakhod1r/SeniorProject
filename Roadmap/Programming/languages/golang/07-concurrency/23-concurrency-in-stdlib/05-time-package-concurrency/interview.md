---
layout: default
title: time Package Concurrency — Interview
parent: time Package Concurrency
grand_parent: Concurrency in Stdlib
ancestor: Go
nav_order: 7
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/23-concurrency-in-stdlib/05-time-package-concurrency/interview/
---

# time Package Concurrency — Interview Questions

[← Back](../)

> Thirty-plus interview questions spanning junior to staff. Each has a model answer, common wrong answers where the trap is sharp, and a follow-up probe.

---

## Junior

### Q1. What does `time.Sleep(1 * time.Second)` do under the hood?

**Model answer.** It calls into the runtime, which calls `runtime.gopark` after adding a timer to the current P's timer heap. The goroutine's `G` is taken off the run queue; the M is free to run other goroutines. After ~1s, the runtime's timer code (driven by the scheduler tick or by a dedicated wake) calls `goready` to put the G back on a run queue.

**Common wrong answers.**
- "It blocks the OS thread for one second." (No — it parks the goroutine; the M runs other goroutines.)
- "It busy-waits." (No — it parks completely.)

**Follow-up.** *Where does the timer live?* On the current P's timer heap (`runtime.p.timers` since Go 1.14; redesigned as `runtime.timers` in Go 1.23).

---

### Q2. What is `time.After`?

**Model answer.** A convenience function: `time.After(d)` creates a fresh `*time.Timer` and returns its receive-only channel `C`. After `d` elapses, the runtime sends the current time on `C`. The timer is one-shot.

**Follow-up.** *Why is using it in a tight select loop bad?* Every iteration allocates a new Timer; if the other case fires first, the Timer is not stopped and pins memory until it expires.

---

### Q3. What is the difference between `time.Tick` and `time.NewTicker`?

**Model answer.** `time.NewTicker` returns a `*Ticker` you must `Stop()` to release. `time.Tick` is `time.NewTicker(d).C` — convenience, no way to stop. **Never use `time.Tick` in a function that may return before program end** — the ticker is permanently leaked.

**Follow-up.** *What did Go 1.23 change about this leak?* Before 1.23, the leaked ticker also kept the channel and its receivers GC-pinned. Since 1.23, the timer is GC-able even if not stopped — the channel is no longer kept reachable from the runtime side. The leak of the *ticker* itself (the goroutine-visible side) still depends on user code.

---

### Q4. What is `time.AfterFunc`?

**Model answer.** Schedules a function to be called in its own goroutine after a duration. Returns a `*Timer` so you can Stop or Reset. Unlike `time.After`, no channel is involved; the runtime spawns a fresh goroutine to invoke the callback.

**Follow-up.** *What runs the callback?* The runtime, in a freshly created goroutine — not on the timer's own M. See `runtime/time.go` `runOneTimer`.

---

### Q5. Show a leak-free ticker idiom.

**Model answer.**
```go
t := time.NewTicker(time.Second)
defer t.Stop()
for {
    select {
    case <-t.C:
        // work
    case <-ctx.Done():
        return
    }
}
```
The `defer t.Stop()` releases the heap entry on return.

---

### Q6. Why is `<-time.After(d)` in a `select` inside a loop a bug?

**Model answer.** Every iteration allocates a fresh Timer and adds it to the timer heap. If another case in the select fires before `d` elapses, the Timer is *not* stopped — it continues to live and consume heap space until it expires naturally. Under high loop frequency, this floods the timer heap and can dominate scheduler cost.

**Fix.** Hoist the timer out of the loop and Reset it.

---

### Q7. What is the timer heap?

**Model answer.** A min-heap of pending timers ordered by their fire time. Pre-1.14 it was global, protected by a single mutex. Go 1.14 split it into per-P heaps to reduce contention. Go 1.23 redesigned the data structure again (`runtime/time.go`'s `timers` type), making Reset/Stop race-free in more cases and removing the channel-pinning bug.

---

### Q8. What is the return value of `Timer.Stop()`?

**Model answer.** `bool` — `true` if the call prevented the timer from firing (the timer was still pending), `false` if it had already fired or already been stopped. The boolean is essential when the channel may need draining: if `Stop` returns `false`, a value may already be in the channel.

---

### Q9. Why is `time.Time` carrying *both* a wall clock and a monotonic reading?

**Model answer.** Wall clock can jump backwards (NTP correction, manual setting, leap seconds, VM suspend). Monotonic readings are guaranteed non-decreasing. `time.Now()` records both. Arithmetic (`Sub`, `Since`) uses the monotonic part when both operands have one; comparisons fall back to wall time when needed. This means measuring elapsed time across a system clock change still returns the right answer.

---

### Q10. What does `context.WithTimeout` use internally?

**Model answer.** Since Go 1.21, `context.WithTimeout` is implemented on top of `time.AfterFunc`. The returned context schedules an AfterFunc that calls `cancel()` when the deadline expires. Before 1.21, it had its own timer-management code; the consolidation cut allocations and simplified the implementation.

---

## Middle

### Q11. Walk me through `time.Sleep` in the source.

**Model answer.** `time/sleep.go` defines `func Sleep(d Duration)` which is implemented in the runtime as `runtime.timeSleep`. That function (in `runtime/time.go`) creates a `timer`, calls `resettimer` to insert it into the current P's heap, then `goparkunlock` to suspend. When the timer fires, the callback is `goroutineReady`, which puts the G back on a run queue.

---

### Q12. What are the timer status states pre-1.23?

**Model answer.** A finite state machine with values like `timerNoStatus`, `timerWaiting`, `timerRunning`, `timerDeleted`, `timerRemoving`, `timerRemoved`, `timerModifying`, `timerModifiedEarlier`, `timerModifiedLater`, `timerMoving`. They orchestrated lock-free-ish transitions across Reset/Stop/fire interactions. Go 1.23 collapsed many of these into simpler fields after the timer-channel split.

---

### Q13. Why was the timer heap moved per-P in Go 1.14?

**Model answer.** The pre-1.14 design had a global timer heap protected by a single mutex. Under load (thousands of timers per second) this mutex became a measurable bottleneck. Issue 6239 documented the problem; the redesign (CL 171883 and follow-ups) split the heap per-P, so most timer operations are uncontended.

---

### Q14. What is `runtime.modtimer`?

**Model answer.** The runtime function that changes an existing timer's fire time. Called by `(*Timer).Reset`. It transitions the timer through `timerModifying`/`timerModifiedEarlier`/`timerModifiedLater` and either reorders it on the current heap or marks it for migration.

---

### Q15. Why was `(*Timer).Reset` historically racy?

**Model answer.** The classical race: if a timer has already fired but you haven't drained `t.C` yet, `Reset` would put a *new* value on the channel later, and the old (stale) value might still be there. Pre-1.23 docs required: "always Stop first, drain the channel, then Reset." Easy to get wrong; missed in many codebases.

---

### Q16. What did Go 1.23 change about Reset and Stop?

**Model answer.** Two big things:
1. Timers no longer keep their channel reachable from GC roots, so an unreferenced ticker becomes garbage even if not stopped.
2. The channel is unbuffered semantically — the runtime no longer leaves stale values in `t.C` after Reset. Drain-then-Reset is no longer required for correctness.

See the Go 1.23 release notes: "Timer/Ticker behaviour changes".

---

### Q17. What does `(*Timer).Stop` return tell you?

**Model answer.** It returns `false` if the timer either already fired or was already stopped. The classic idiom: if `!t.Stop()`, you may need to drain `t.C` to avoid a stale receive on a subsequent iteration — but this idiom is largely obsolete in Go 1.23.

---

### Q18. What happens if a timer fires while we hold no goroutine to receive?

**Model answer.** For a one-shot Timer with a channel, the runtime executes the timer's `f` (sendTime) which does a non-blocking send to `t.C`. If nobody is receiving and the channel is full (size 1), the send is dropped silently. This is why old Reset semantics required draining: the channel could hold a stale "old fire" value.

---

### Q19. Compare `time.AfterFunc` to `time.After` in terms of cost.

**Model answer.** `AfterFunc` does not allocate a channel; it stores a function pointer. When the timer fires, the runtime calls the function in a new goroutine. `time.After` allocates a `*Timer` plus a 1-buffered channel and runs the runtime's built-in `sendTime`. AfterFunc is cheaper per timer; `After`'s channel is what gives you composition with `select`.

---

### Q20. What's the per-P timer heap layout?

**Model answer.** Pre-1.23: a slice on each P (`p.timers`) heapified by `when` field. Stored as `[]*timer`. Operations: `addtimer`, `deltimer`, `modtimer`, `adjusttimers` (re-heapify), `runtimer`. Go 1.23 introduced a new `timers` type living off the P (still per-P) with cleaner state and explicit min-heap helpers.

---

## Senior

### Q21. Why is `time.After` problematic in long-running services?

**Model answer.** In a select loop that runs millions of times per second, `<-time.After(d)` allocates a Timer on every iteration. Until each Timer's deadline expires, it sits in the timer heap, increasing heap size and per-tick adjusttimers cost. The fix is to hoist a single `*Timer` outside the loop and Reset it.

---

### Q22. How does `context.WithTimeout` propagate cancellation across a goroutine?

**Model answer.** `WithTimeout` calls `time.AfterFunc(d, cancel)` where `cancel` closes the context's `done` channel. Any goroutine selecting on `ctx.Done()` unblocks. The cancellation is synchronous within `cancel`'s execution but visible to readers as soon as the channel close is observable (which is established by the channel send-close memory ordering).

---

### Q23. What is the precision of `time.Sleep`?

**Model answer.** Bounded by the OS timer resolution and the Go scheduler latency. On Linux with hrtimers, sub-microsecond precision is achievable. On Windows, the default resolution is ~15.6 ms (improvable via `timeBeginPeriod`). The Go runtime adds scheduler overhead — typically tens of microseconds. For periodic work, `Ticker` averages out the jitter; for one-shot precision under a millisecond, expect ~50-200 µs jitter even on Linux.

---

### Q24. What underlying syscall does Go use for sleeping?

**Model answer.** Platform-specific:
- Linux: `futex` with timeout (for non-CGo) or `nanosleep`/`clock_nanosleep` via libc when needed.
- Darwin: `__semwait_signal` or `kevent` with timeout.
- Windows: `WaitForSingleObjectEx` with timeout, or `WaitForMultipleObjects`.

The runtime's `notetsleep` family (`runtime/lock_futex.go`, `runtime/lock_sema.go`) abstracts this.

---

### Q25. Why does `time.Time` use *monotonic + wall* dual representation?

**Model answer.** The wall clock is what the user perceives but can jump (NTP, manual set). The monotonic clock is guaranteed non-decreasing but has no meaning across reboots. `time.Now()` records both. `t2.Sub(t1)` prefers the monotonic delta when both have one (precise, wall-clock-jump-resistant). Time arithmetic that crosses a Marshall/Unmarshal boundary loses the monotonic part — explicitly documented in `time.Time.Round`/`Truncate`.

---

### Q26. What is "drift" in `time.NewTicker`?

**Model answer.** The ticker tries to fire on a regular cadence (every `d`). If a tick is delayed (slow consumer, GC pause, scheduler congestion), the ticker can either (a) skip ticks to catch up, or (b) try to deliver all missed ticks rapidly. Go's `time.NewTicker` does (a) — the channel is buffered to 1 and the runtime drops sends that would block, so ticks are silently coalesced under load. This is the right choice for most use cases but breaks code that assumes "exactly N ticks in T seconds".

---

### Q27. Walk me through Go 1.23's timer redesign.

**Model answer.** Pre-1.23, the timer's `*hchan` (the channel) was reachable from the per-P heap via the timer struct. Any pending timer pinned its channel and the channel's receivers' goroutines. The redesign decouples the timer from the channel via a weak link: the runtime keeps the timer alive only while the channel is reachable from elsewhere. If the only references are from the runtime heap, GC reclaims everything. Plus, `Reset` and `Stop` were rewritten to avoid the "drain old value" foot-gun. CL 568086 is the main one.

---

### Q28. How would you implement a virtual clock for testing?

**Model answer.** Define an interface:
```go
type Clock interface {
    Now() time.Time
    Sleep(d time.Duration)
    After(d time.Duration) <-chan time.Time
    NewTicker(d time.Duration) Ticker
}
```
Production: a `realClock` wrapping `time.Now()`, `time.Sleep`, etc. Tests: a `fakeClock` with `Advance(d Duration)` that fires pending timers in order. Inject via constructor. Avoids `time.Sleep` in tests.

---

### Q29. Why doesn't `time.Sleep` accept a context?

**Model answer.** Backwards compatibility. The function predates context.Context. The canonical replacement is `select { case <-time.After(d): case <-ctx.Done(): return }` — though that has the time.After leak gotcha if used in a loop.

---

### Q30. Why is `time.Tick` documented as "leaks the Ticker" and yet still in the package?

**Model answer.** For one-shot top-level programs where the ticker should outlive every other goroutine, `time.Tick` is harmless. The docs explicitly warn: "Since `time.Tick` returns no way to shut down the ticker, callers should use `NewTicker` instead in any function that may return." Removing `Tick` would break too many programs; the docs are the warning.

---

## Staff

### Q31. Design a high-precision timer wheel for a network server with millions of timeouts.

**Model answer.** Go's per-P heap is O(log n) per insert/remove. For very large N, a hierarchical timing wheel (Varghese & Lauck 1987) is O(1) amortised. Implementation: an array of buckets indexed by `(when / tickResolution) % wheelSize`; each bucket is a list. A background "tick" goroutine advances the wheel once per `tickResolution`. Trade-off: coarse precision (e.g. 10 ms). Used by Caddy, Netty (Java), nginx; some Go libraries roll their own.

---

### Q32. How does the runtime decide *when* to fire a timer?

**Model answer.** The scheduler's `findRunnable` (in `runtime/proc.go`) calls `checkTimers` which runs any expired timers on the current P. There is also a "timerproc" hook on Ps with timers due soon — `runtime.runqgrab` and friends pick up timers as part of work-stealing. On totally idle Ps, an OS timer (futex sleep with deadline) is used to wake the M. The full algorithm is in `runtime/proc.go:findRunnable` and `runtime/time.go:checkTimers`.

---

### Q33. Why is `time.After` measurable in production CPU profiles?

**Model answer.** Each call allocates a Timer (~80 bytes), runs `resettimer` (heap operations, lock acquisition on the per-P heap), and registers the channel. In hot select loops, this allocation churn appears as `time.NewTimer`, `runtime.resettimer`, and the GC scan of timer-heap entries. Replacing with a hoisted Timer+Reset is the standard fix; the `time.After` cost is gone from the profile.

---

### Q34. What is the "wake the netpoller" coordination with timers?

**Model answer.** The Go runtime's netpoller (`runtime/netpoll.go`) blocks in `epoll_wait`/`kevent`/`GetQueuedCompletionStatus` with a timeout. The timeout is set to the time until the next timer fires. When a timer is added that's earlier than the netpoller's current deadline, the runtime wakes the netpoller (via `wakeNetPoller` -> `netpollBreak`) so it can recompute the deadline. This is how non-busy Ps still fire timers on time.

---

### Q35. How does Go 1.23 prevent the "set timer in goroutine A, observe Reset in goroutine B" race?

**Model answer.** The redesigned timer code uses internal seqlocks and explicit state transitions through atomic CAS. The fields needed by the channel's send path (`sendTime`) are stable for the duration of a single send; Reset on another goroutine increments a sequence counter so the send can detect "I was reset while I was about to fire" and abort. The detailed scheme is documented in CL 568086 and the new `runtime/time.go` doc comments.

---

### Q36. What happens when a goroutine blocked in `time.Sleep` receives a signal?

**Model answer.** Signals in Go are queued and delivered to a goroutine when it's running, not when it's parked. A goroutine in `time.Sleep` is parked via `gopark`; if a signal arrives, the runtime's signal-handling goroutine processes it, but the sleeping goroutine is not woken early — it sleeps until its timer fires. To "interrupt" a sleep, you must use `context` with a `select`.

---

### Q37. Why might `time.Sleep(0)` not be a no-op?

**Model answer.** Pre Go 1.14 it was effectively a no-op (the timer code special-cased zero). Modern Go still hits the runtime path and calls `Gosched`-equivalent — it yields the M to other goroutines. So `time.Sleep(0)` is a way to yield without spelling it `runtime.Gosched()`. The Go runtime documents `time.Sleep(0)` as "yield".

---

### Q38. How would you debug a "timer-heap is huge" production issue?

**Model answer.** Symptoms: high `runtime.adjusttimers` in CPU profile, high heap memory, GC stalls. Diagnosis steps:
1. `pprof` heap: look for `time.NewTimer`, `time.AfterFunc` allocation sites.
2. Examine `runtime.NumGoroutine()` — leaked goroutines often pair with leaked timers.
3. Look for `<-time.After` inside select-in-loop patterns.
4. Look for missing `defer t.Stop()` after `time.NewTicker`.
5. Use `runtime/trace` to see timer events.
Fixes: hoist `time.After` out of loops; ensure every `NewTicker`/`NewTimer` has a `Stop`; use `time.AfterFunc` when no channel is needed.

---

### Q39. Compare Go's timer cost to Java's `ScheduledExecutorService`.

**Model answer.** Java's STPE uses a `DelayQueue` (a binary heap, similar O(log n)) protected by a `ReentrantLock`. Single shared queue is the bottleneck under load. Go's per-P heaps eliminate that contention by design. Per-timer cost: Go's `time.AfterFunc` is ~150 ns to schedule, Java's STPE is ~500 ns. For very small numbers of timers Java's design is simpler; for high-frequency timer workloads Go is significantly faster.

---

### Q40. What invariants must hold across a `time.Now()` call from multiple goroutines?

**Model answer.** Two goroutines calling `time.Now()` "simultaneously" can observe out-of-order monotonic readings only if they're on different CPUs and the monotonic clock is implemented as a per-CPU counter (rare; Linux `CLOCK_MONOTONIC` is globally consistent on modern kernels). In practice, Go's `time.Now` uses `vDSO` `clock_gettime(CLOCK_MONOTONIC)` which is monotonically non-decreasing across CPUs. The wall-clock part can disagree slightly due to NTP smoothing. The `time` package documents that monotonic ordering is preserved within a single time.Time computation; cross-goroutine ordering is "as observed by happens-before edges established by other synchronization."

---

That is forty questions across all levels, covering the time package's concurrency semantics, the runtime's timer implementation, the Go 1.23 redesign, and production-grade reasoning. Use them as flashcards, discussion prompts, or interview prep.
