---
layout: default
title: Interview
parent: AfterFunc
grand_parent: Time-Based Concurrency
ancestor: Go
nav_order: 7
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/16-time-based-concurrency/02-afterfunc/interview/
---

# time.AfterFunc — Interview Questions

A graded set of 35 questions, from junior to staff level.

## Junior

### Q1. What is the signature of `time.AfterFunc`?

**A.** `func AfterFunc(d time.Duration, f func()) *time.Timer`. It schedules `f` to run in a new goroutine after at least `d` has elapsed.

### Q2. On which goroutine does the callback run?

**A.** A new goroutine spawned by the runtime, not the caller's.

### Q3. What does `t.Stop()` return?

**A.** `true` if this call prevented the callback from running; `false` if the timer had already fired or been stopped.

### Q4. What is `t.C` for an AfterFunc timer?

**A.** Nil. Reading from it blocks forever.

### Q5. What happens if the callback panics?

**A.** The panic propagates within the callback's goroutine. If not recovered, the program crashes.

### Q6. What's the difference between `time.After` and `time.AfterFunc`?

**A.** `time.After` returns a `<-chan Time` that receives a value after the duration. `time.AfterFunc` runs a callback in a new goroutine after the duration.

### Q7. Does `time.AfterFunc(d, f)` block?

**A.** No. It returns immediately after scheduling.

### Q8. What happens if I pass a negative duration?

**A.** The callback fires as soon as possible (treated as "already expired").

### Q9. How do I cancel a scheduled callback?

**A.** Call `Stop()` on the returned `*Timer`. Check the return value to know if you prevented the fire.

### Q10. Can I pass `nil` as the callback?

**A.** It compiles but panics at fire time when the runtime tries to call nil.

---

## Middle

### Q11. What does `Stop` returning `false` tell you?

**A.** That this call did not remove the timer from the heap. It could mean: the timer already fired (callback is running or has finished), or the timer was already stopped. It does NOT mean the callback has completed.

### Q12. Can the callback be running while you call `Stop`?

**A.** Yes. `Stop` is non-blocking; it doesn't wait for the callback. If `Stop` returns false because the timer already fired, the callback may be in flight on another goroutine.

### Q13. How do you guarantee a callback runs at most once?

**A.** Use `sync.Once`, an atomic compare-and-swap flag, or a generation counter. The timer itself does not guarantee single-run semantics if you mix `Reset` with cancellation.

### Q14. What does `Reset(d)` do on an expired (already-fired) timer?

**A.** Re-arms it. The callback will fire again at the new `now + d`. Returns `false` because the timer was not active.

### Q15. What's the danger of `time.After(d)` in a tight `select` loop?

**A.** Each call allocates a new timer + channel. In hot loops this is allocation pressure. Use a reusable `*time.Timer` with `Reset`.

### Q16. When would you use `context.AfterFunc` over `time.AfterFunc`?

**A.** When the trigger is context cancellation, not a duration. `context.AfterFunc(ctx, f)` runs `f` when `ctx` is done — no parked goroutine.

### Q17. What's the memory implication of capturing a struct in a callback closure?

**A.** The struct is held alive by the closure until the callback finishes. For long durations or large structs, this pins significant memory.

### Q18. Can two callback goroutines for the same timer run concurrently?

**A.** Yes, if you call `Reset` while a previous callback is still running. The new fire spawns a new goroutine; the old one continues.

### Q19. How do you implement a debouncer with `time.AfterFunc`?

**A.** Each Trigger stops the previous timer (if any) and starts a new one. Optionally, use a generation counter inside the callback to skip stale fires.

### Q20. What is the "Stop-then-Reset" anti-pattern, and what's the fix?

**A.** Calling `Stop()` followed by creating a new `AfterFunc` is wasteful when you can call `Reset(d)` on the existing timer. `Reset` reuses the same timer struct and closure.

---

## Senior

### Q21. Where does a timer live in memory after `AfterFunc` returns?

**A.** On the heap. The `time.Timer` struct is heap-allocated; the runtime holds a reference via the P-local min-heap of pending timers.

### Q22. Describe the runtime's data structures for timers.

**A.** Each P (logical processor) has a local min-heap of pending timer entries, keyed on `when` (monotonic nanoseconds). The runtime checks the heaps during scheduler iterations and netpoller wakeups; expired entries are popped and the callback wrapper is invoked.

### Q23. Why does the runtime use P-local heaps instead of a global one?

**A.** To avoid global lock contention. Each P's heap has its own lock; insertions and removals are typically uncontested.

### Q24. What is the cost of `time.AfterFunc` at scale?

**A.** Memory: ~150 bytes per timer plus closure. CPU: O(log N) heap insert. Goroutine spawn at fire: ~300 ns. At >100K timers, these add up; consider batching.

### Q25. Describe the "earliest-deadline scheduler" pattern.

**A.** Maintain a user-space heap of pending events. At any time, only one runtime timer is set — for the earliest deadline. When it fires, process all events that are due, and re-arm for the next earliest. O(log N) inserts; one runtime timer regardless of N.

### Q26. Why is `t.C` nil for an AfterFunc timer?

**A.** The runtime distinguishes AfterFunc (callback-style) from NewTimer (channel-style). At fire time, the runtime spawns a goroutine to run the callback (for AfterFunc) instead of sending on the channel (for NewTimer). The `C` field is unused for AfterFunc.

### Q27. What changed in Go 1.21 and 1.23 regarding timers?

**A.** 1.21 introduced `context.AfterFunc`. 1.23 simplified the runtime's internal timer state machine and removed the `Reset` drain-dance requirement for channel timers.

### Q28. How does the runtime decide which P's heap to use when a timer fires?

**A.** Each timer lives on the P where it was created. If that P is destroyed (GOMAXPROCS reduction), the timer migrates to another P's heap.

### Q29. Describe a race scenario between `Stop` and fire.

**A.** Consider: the runtime has decided to pop the timer and spawn the callback goroutine. At that exact instant, `Stop` is called. The runtime has already started the firing; `Stop` returns false. The callback runs. The caller sees `false` but cannot tell if the callback has started, is running, or has finished.

### Q30. How would you scale to a million timers?

**A.** Switch from per-entry timers to a sweeper or earliest-deadline scheduler. For sub-millisecond accuracy, use a hashed timing wheel. Audit closure size to bound memory.

---

## Staff / Principal

### Q31. Design a production-grade `time.AfterFunc` wrapper.

**A.** Wrap with:
- Metrics: created, fired, stopped, panic, live, latency.
- Panic recovery via `defer recover()`.
- Optional context association via `context.AfterFunc(ctx, stop)`.
- Logging on unexpected events.
- Bounded duration (cap at sensible maximum).

The wrapper returns a `*Timer`-like type with `Stop` and `Reset` that update bookkeeping.

### Q32. Walk through a postmortem for "memory growth caused by AfterFunc."

**A.** Steps:
1. Detect via gauge metric (live timer count climbing).
2. Diagnose via heap profile (`runtimeTimer` allocations) and goroutine profile.
3. Identify the callsite via `pprof list`.
4. Audit the closure: what's captured? How long is the duration?
5. Fix: capture less, lower duration, or stop the timer in the cleanup path.
6. Add a regression test and dashboard panel.
7. Update lint rules to catch the pattern.

### Q33. Compare three timer architectures for a system with 10M scheduled events.

**A.**
1. Per-entry timer: O(log N) ops; ~1.5 GB memory just for timers. Goroutine spike on fire. Not viable.
2. Earliest-deadline scheduler: one runtime timer; O(log N) ops on user heap; ~500 MB for entry storage; predictable fires. Good.
3. Hashed timing wheel: O(1) ops; bounded precision (~tick width); ~50 MB. Best for extreme scale.

Choice depends on precision requirement and memory budget.

### Q34. How would you make timer behaviour deterministic in tests?

**A.** Inject a clock interface. Tests use a fake clock with manual `Advance(d)` that fires all timers whose `when` has passed. The fake clock is synchronous, no `time.Sleep`. Modern: `testing/synctest` (Go 1.24+).

### Q35. What's wrong with this code?

```go
func handle(r *Request) {
    time.AfterFunc(time.Hour, func() {
        log.Println("late:", r.ID)
    })
}
```

**A.** The closure captures `r` (the entire request) instead of `r.ID`. For an hour-long timer at high RPS, this pins enormous memory. Fix: `id := r.ID; time.AfterFunc(...)`. Also: the timer is never stopped, accumulating. Also: an hour-long duration in a per-request timer is suspicious; consider a periodic sweeper.

---

## Bonus questions

### Q36. Can a callback start a new `AfterFunc`?

**A.** Yes. The new timer is independent. Common pattern for self-rescheduling.

### Q37. What happens if you call `Reset` from inside the callback?

**A.** The timer is re-armed for `now + d`. The current callback continues running on its goroutine; a new fire is scheduled. Two callbacks can be alive concurrently if work outlasts `d`.

### Q38. Why does `context.AfterFunc` exist?

**A.** Before it, "do X when ctx cancels" required spawning a goroutine that waits on `<-ctx.Done()`. At scale this parks many goroutines. `context.AfterFunc` registers a callback without a parked goroutine.

### Q39. What's the relationship between `time.After` and the GC?

**A.** Before Go 1.23, `time.After` returned a timer that stayed on the heap until fire even if the channel was never read. In Go 1.23+, the runtime can detect that the channel is unreachable and clean up the timer promptly. Best practice: avoid `time.After` in hot loops anyway.

### Q40. How would you test that a `Stop`-vs-fire race doesn't cause double-execution?

**A.** A stress test:
```go
for i := 0; i < 10000; i++ {
    var count atomic.Int64
    t := time.AfterFunc(time.Microsecond, func() {
        count.Add(1)
    })
    time.Sleep(time.Microsecond)
    t.Stop()
    time.Sleep(time.Millisecond)
    if count.Load() > 1 {
        t.Fatal("double-execution")
    }
}
```

With `-race`. Catches any internal data race; the explicit `> 1` check catches the user-visible race.

---

## Bonus follow-ups

### Q41. (follow-up to Q35) What if the timer is supposed to fire only if cleanup hasn't happened yet?

**A.** Add a guard inside the callback:
```go
id := r.ID
var fired atomic.Bool
t := time.AfterFunc(time.Hour, func() {
    if !fired.CompareAndSwap(false, true) {
        return
    }
    log.Println("late:", id)
})
// on cleanup:
fired.Store(true)
t.Stop()
```

Now even if the timer's Stop loses the race, the guard prevents the action.

### Q42. (follow-up to Q34) What if the code under test doesn't take a Clock argument?

**A.** Refactor it to. The investment is small; the payoff is large. Alternatives:
- Use a global clock variable, settable in tests (less clean).
- Use build tags to inject test-only implementations.

### Q43. (follow-up to Q31) How do you handle Reset in the wrapper's bookkeeping?

**A.** Increment a `reset` counter. Update `scheduledFor` (the latency baseline). Note that Reset doesn't change the live count.

### Q44. What's the difference between `context.AfterFunc(ctx, f)` and `time.AfterFunc(d, f) + ctx.AfterFunc(ctx, t.Stop)`?

**A.** The first triggers on context cancel. The second triggers on duration (and is also cancelled on context cancel). Different triggers; both are useful in different situations.

### Q45. Why is the callback's `C` field nil specifically for AfterFunc?

**A.** Because at fire time, the runtime's wrapper for an AfterFunc does `go f()` (spawn a goroutine running the user's function) instead of sending on a channel. The channel isn't used; the struct field is set to nil to make the distinction explicit.

---

## Discussion prompts

For verbal interviews, these are good extended discussion topics.

### D1. Walk me through what happens, end to end, when I call `time.AfterFunc(time.Second, fn)`.

**Expected discussion:** allocation of Timer struct, runtimeTimer setup, heap insertion on the local P, return to caller. Then: scheduler loop checks heap, pops expired entry, spawns goroutine via wrapper, callback runs.

### D2. We have a service that uses many timers and is OOMing. Where do you start?

**Expected discussion:** Heap profile to identify allocation source. Audit closures. Check if timers are stopped or accumulating. Consider batching.

### D3. Explain `context.AfterFunc` and when you'd use it.

**Expected discussion:** Triggered on ctx cancel. Replaces `go func() { <-ctx.Done(); f() }()`. Avoids parked goroutines. Use for context-driven cleanup.

### D4. We're considering replacing all our `time.After`s with `time.NewTimer`. What's the trade-off?

**Expected discussion:** `time.After` allocates per call; `time.NewTimer` can be reused via Reset. In hot loops, the allocation matters. The trade-off is code complexity (must remember to call Stop / handle drain). Sometimes worth it; often premature optimisation.

### D5. Design a watchdog for a long-running service.

**Expected discussion:** `time.AfterFunc(timeout, onFire)`. Touch on every "I'm alive" event. CAS guard inside fire to prevent double-action. Recover panics. Metric for fires. Alert on fire > 0.

### D6. We replaced per-entry timers with a sweeper and now p99 latency went up. Why?

**Expected discussion:** Sweeper introduces ticks-of-staleness; entries are processed up to one tick late. If your latency p99 is bounded by tick width, that's the cost. Trade memory and CPU savings for latency. May need a hybrid (small wheel for soon, sweeper for later).

### D7. How would you implement a delayed message queue?

**Expected discussion:** Persistent storage (DB or message broker). In-memory scheduler with `time.AfterFunc` for the next due message. Reload pending on restart. Idempotency for "fire" actions. Metrics on delay distribution.

### D8. Walk me through testing a system that uses `time.AfterFunc`.

**Expected discussion:** Inject a clock. Tests advance the clock; timers fire deterministically. No real `time.Sleep`. Race detector.

### D9. Why does Go not provide an "AfterFunc that waits for the callback" API?

**Expected discussion:** Would require a Cond or channel on every timer. Adds memory. Users can build it with a channel. The design favors orthogonality: each primitive does one thing.

### D10. What's the relationship between `time.AfterFunc` and `time.Ticker`?

**Expected discussion:** Both use runtimeTimer. Ticker has non-zero `period`; AfterFunc has period 0. Ticker re-inserts after fire (with advanced when); AfterFunc is one-shot. For self-rescheduling AfterFunc, you handle the rescheduling explicitly.

---

## Common mistakes in interview answers

- Saying "Stop is synchronous." It is not.
- Confusing `time.After` with `time.AfterFunc`.
- Missing panic recovery in a "production" code response.
- Not mentioning closure capture.
- Saying "callbacks run on the calling goroutine" — they don't.
- Forgetting `t.C` is nil for AfterFunc.

If a candidate makes one of these in a senior+ interview, dig in. It signals shallow knowledge.

---

## Senior-level red flags to probe

If a candidate says:

- "Just use `time.AfterFunc` for periodic work." — probe: when not? (answer: when you want strict period, use Ticker.)
- "Stop will tell me if the callback ran." — wrong. Probe what `false` really means.
- "I always use `time.After`." — probe about hot loops and allocations.
- "I never use mutexes in callbacks." — probe their understanding of memory ordering.
- "Closures don't allocate if they don't capture." — partially right but misses the subtle cases.

---

## Code review interview question

Show this snippet and ask: "What's wrong?"

```go
type Worker struct {
    timer *time.Timer
}

func (w *Worker) Run(r *Request) {
    w.timer = time.AfterFunc(time.Hour, func() {
        w.process(r)
    })
}

func (w *Worker) Stop() {
    w.timer.Stop()
}
```

Issues a strong candidate finds:

1. Captures `r` (potentially large).
2. Captures `w` via method value; that's OK.
3. No panic recovery in `process`.
4. `Stop` returning false isn't checked or handled.
5. `timer` field can be written from multiple goroutines (race) — but here it isn't, so this is more theoretical.
6. If `Run` is called twice on the same Worker, the first timer is lost (leaked).
7. The 1-hour duration is suspicious for "process a request."

Weak candidates miss most of these. Strong candidates find 4+.

---

## Final wisdom

Interviews probe both *knowledge* and *operational judgement*. The questions here lean toward both.

A strong candidate at staff+ level will:

- Know the API cold.
- Understand the runtime model (heap, P, fire path).
- Know the postmortem-worthy gotchas (capture, stop, panic).
- Have opinions backed by experience: "we had an incident from X, so we always Y."
- Distinguish what's worth obsessing about (panic recovery) from what's not (Stop's boolean for idempotent callbacks).

If your candidate hits all of these, hire them.

## More probing scenarios

### S1. The candidate built a debouncer

Show:

```go
type DB struct {
    mu sync.Mutex
    t  *time.Timer
}

func (d *DB) Trigger(fn func()) {
    d.mu.Lock()
    defer d.mu.Unlock()
    if d.t != nil {
        d.t.Stop()
    }
    d.t = time.AfterFunc(50*time.Millisecond, fn)
}
```

Question: "Is this correct? What can go wrong?"

Expected answer: `Stop` can return false (callback in flight). The in-flight callback runs even though we scheduled a new one. Two `fn` calls can happen for one logical "settled" event. Fix: generation counter or guard flag.

### S2. The candidate inherits a slow service

Question: "The service is slow. Profile shows 40% time in `runtime.checkTimers`. What's likely happening?"

Expected: many timers in the heap. Probably per-entry timers at high N. Possibly `time.After` in a hot loop. Recommend: switch to batching or reusable timers.

### S3. The candidate is on-call

Question: "PagerDuty wakes you. The alert says `live_timers` doubled in an hour. Your service handles 1000 RPS. What's your first action?"

Expected: pull heap profile via `/debug/pprof/heap`. Look for `time.AfterFunc` allocations. Compare to baseline. Check recent deploys. Roll back if it's a recent change.

### S4. The candidate designs a session store

Question: "Design an in-memory session store with 30-minute idle timeout. 1M concurrent sessions."

Expected:
- Per-session timer (1M timers, ~300 MB) is borderline.
- Better: earliest-deadline scheduler. One runtime timer; user-space heap of session expirations. Reset on activity.
- Even better at extreme scale: bucket sessions into 1-minute buckets; one timer per bucket.

Probing follow-up: "How would you scale this to 100M?" Expected: hashed timing wheel.

### S5. The candidate explains the captured loop variable bug

Question (pre Go 1.22): "What does this print?"

```go
for i := 0; i < 3; i++ {
    time.AfterFunc(time.Duration(i+1)*10*time.Millisecond, func() {
        fmt.Println(i)
    })
}
time.Sleep(time.Second)
```

Expected: `3 3 3` — all closures capture the same `i`. Fix: `i := i` shadow. (In Go 1.22+, the loop already does this.)

### S6. The candidate handles a panic question

Question: "What happens if the callback panics?"

Expected: Process crashes. Need `defer recover()`. The runtime does not implicitly recover. Demonstrate the right pattern.

Probing: "Is `defer recover()` enough?" Expected: also log, also metric, also alert.

---

## Advanced topics

### Sched trace and timers

```bash
GODEBUG=schedtrace=1000 ./your-program
```

Outputs scheduler stats every second. Look for goroutine count spikes; correlate with timer fire bursts.

### Async preemption

Since Go 1.14, the runtime can preempt long-running goroutines. This means a timer callback that runs for a long time doesn't block the P. Without async preemption, a callback that doesn't reach a safe point holds the P.

### testing/synctest (Go 1.24+)

Provides synthetic time for deterministic concurrency tests. Eliminates flaky tests caused by `time.Sleep` reliance.

```go
synctest.Run(func() {
    t := time.AfterFunc(time.Hour, fn)
    synctest.Advance(2 * time.Hour)
    // t has fired
})
```

If a candidate is on Go 1.24+, ask if they're using it. If yes, dig into how they integrated it.

---

## Common follow-up "explain to a junior"

A staff-level interviewer may ask the candidate to "explain to a junior developer." This tests communication.

Question: "Explain to a junior why this captures too much memory:"

```go
func handle(r *Request) {
    time.AfterFunc(time.Hour, func() {
        log.Println(r.ID)
    })
}
```

Expected explanation: the inner function captures `r` (a pointer to a possibly-large Request). The runtime holds the inner function alive until the timer fires. So `r` and everything it points to is alive for an hour, even if no other code uses it. At high request rate, this pins lots of memory. Fix: capture just `r.ID` (a short string).

A junior may not know "capture" or "closure" — adjust vocabulary.

---

## Trick questions

### TQ1. Can a timer fire while another goroutine holds the lock its callback wants?

**A.** The timer fires (a goroutine is spawned). That goroutine then tries to acquire the lock and is parked. The "fire" succeeded; the work is delayed. So technically yes — fire and lock-acquire are independent events.

### TQ2. If I `Reset(d)` a timer twice quickly, does the callback run twice?

**A.** Usually no. Each Reset reschedules to a new `when`. The previous schedule is replaced. Unless the timer had already fired before the first Reset; then the first fire runs, and the Reset schedules a future fire.

### TQ3. What if I create a timer in a finalizer?

**A.** Works, but: finalizers run on a special goroutine. The timer is created normally. Don't do anything elaborate in finalizers.

### TQ4. Can the callback `Stop` its own timer?

**A.** Yes. Returns false (already firing).

### TQ5. Can the callback `Reset` its own timer to fire again?

**A.** Yes. This is a self-rescheduling timer.

### TQ6. What if the duration is computed as `time.Hour - time.Until(deadline)`?

**A.** If `deadline` is far away, the duration could be negative (since elapsed time > `time.Hour`). Negative duration fires immediately. Always check bounds.

### TQ7. Why does the `*time.Timer` struct exist if `C` is nil for AfterFunc?

**A.** Historical / shared. Both `NewTimer` and `AfterFunc` return `*Timer`. The same struct serves both; `C` is meaningful only for `NewTimer`.

### TQ8. Can two `AfterFunc` calls return the same `*Timer` pointer?

**A.** No. Each call allocates a new `Timer`.

### TQ9. What does a `time.Timer` zero value do?

**A.** Undefined. Use `time.NewTimer(0)` or `time.AfterFunc(0, ...)`. Don't construct `Timer{}` directly.

### TQ10. How do I observe the callback completing?

**A.** The callback must signal. Standard idiom: `close(done)` at the end; caller does `<-done`.

---

## A scoring rubric

When grading candidate answers, score on:

- **Correctness:** is the technical content accurate?
- **Depth:** do they understand the underlying mechanics?
- **Operational sense:** would they catch the issues that matter in production?
- **Communication:** can they explain it clearly?

A score of 4/4 on all dimensions is staff-level.

Use the rubric consistently across candidates.

---

## Mock interview transcript (excerpt)

> **Interviewer:** "Tell me about `time.AfterFunc`."
>
> **Candidate:** "It schedules a function to run after a duration."
>
> **Interviewer:** "Where does the function run?"
>
> **Candidate:** "Uh, I think it runs on the same goroutine?"
>
> **Interviewer:** "It runs on a new goroutine spawned by the runtime."
>
> **Candidate:** "Oh right, yes."
>
> **Interviewer:** "What's `t.Stop()` return value mean?"
>
> **Candidate:** "True if it cancelled, false otherwise."
>
> **Interviewer:** "Define 'cancelled.' Does false mean the callback ran?"
>
> **Candidate:** "Yes... or maybe no, the callback could still be running?"
>
> **Interviewer:** "Right. False means 'this Stop did not remove the timer from the heap.' It does NOT mean 'the callback finished.' This is a common source of bugs."

The candidate would score "junior" on the correctness dimension. They're learning but not yet senior.

---

## Mock interview transcript 2

> **Interviewer:** "We have a service with `time.AfterFunc(time.Hour, ...)` calls in the request path. Memory is growing. Diagnose."
>
> **Candidate:** "Each call creates a timer that lives an hour. At 1000 RPS, that's 3.6M timers in the heap at steady state. Plus the closure captures. Let me check what the closure captures."
>
> **Interviewer:** "Suppose it captures the request object."
>
> **Candidate:** "Then we're pinning the request body for an hour. At 1000 RPS with 10 KB requests, that's 36 GB of pinned memory. OOM."
>
> **Interviewer:** "Fix?"
>
> **Candidate:** "Capture only the request ID. Lower the duration if possible — an hour is suspicious. And stop the timer in the happy-path cleanup if there is one."
>
> **Interviewer:** "Great. Any process improvements?"
>
> **Candidate:** "Lint rule warning on captures of `*Request` in `AfterFunc` closures. Metric for live timers per purpose. Alert on doubling."

This candidate is staff-level on diagnostics and operational sense.

---

## Yet more questions

### Y1. What is the difference between `Sleep` and `AfterFunc`?

**A.** `Sleep` blocks the calling goroutine. `AfterFunc` schedules a function to run on a new goroutine without blocking the caller.

### Y2. Can I do this safely?

```go
go func() {
    for {
        <-time.After(time.Second)
        work()
    }
}()
```

**A.** Yes (won't crash), but inefficient — each iteration allocates a timer. Use `time.NewTicker` or a reused `time.NewTimer`.

### Y3. Why does the wrapper goroutine exist?

**A.** The runtime calls a wrapper that does `go arg.(func())()`. This:
- Isolates the user's `f` from the scheduler.
- Allows long-running `f` without blocking timer firing.
- Provides a fresh goroutine with a fresh stack.

### Y4. What's the worst-case latency for a timer fire?

**A.** Unbounded in theory; bounded by ~10 ms in practice on a healthy system. Under GC pressure, CPU saturation, or kernel scheduler issues, can spike to 100s of ms.

### Y5. Is `time.AfterFunc` safe in multi-arch deployments?

**A.** Yes. The runtime handles 32-bit and 64-bit platforms.

### Y6. How does daylight savings affect timers?

**A.** It doesn't. Timers use monotonic time.

### Y7. Can I get the timer's scheduled time?

**A.** Not from the public API. You'd have to compute it from `time.Now() + d` at scheduling time.

### Y8. What is the smallest meaningful duration?

**A.** Nanoseconds is the resolution. Practical precision is sub-millisecond on idle systems, milliseconds under load.

### Y9. What's the largest meaningful duration?

**A.** `math.MaxInt64` nanoseconds, ~292 years.

### Y10. What happens to my timer if I `os.Exit(1)`?

**A.** Process exits immediately. Timer is gone. No fire, no cleanup.

---

## A short final exam

If you can answer these without looking, you're senior-ready.

1. On which goroutine does an AfterFunc callback run?
2. What does Stop return when the callback is already running?
3. What is `t.C` for an AfterFunc timer?
4. How do you wait for a callback to finish?
5. What replaces `go func() { <-ctx.Done(); cleanup() }()` in modern Go?
6. What scales an AfterFunc beyond ~100K live timers?
7. What does Reset return for an AfterFunc timer's fired state?
8. Can the callback Reset its own timer?
9. What does Go 1.23 simplify about timers?
10. What's the most common production bug pattern?

Answers in the file's body. If you missed any, re-read the relevant section.

---

End of interview questions.

