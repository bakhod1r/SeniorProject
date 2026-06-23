# Deadlock in Go — Interview Questions

This file collects interview questions on deadlock in Go, from junior screen to architectural senior interview. Each question lists the expected answer at a level of depth appropriate for the role.

---

## Junior Level

### Q1. What is a deadlock?

**Expected answer.** A deadlock is a state in which two or more goroutines are blocked forever, each waiting for an event that only another goroutine in the cycle can produce. The program does not crash and does not consume CPU; it simply stops making progress.

A weaker answer ("the program freezes") gets partial credit. A strong answer explicitly mentions the wait cycle.

### Q2. What does this program print?

```go
package main

func main() {
    ch := make(chan int)
    ch <- 1
}
```

**Expected answer.** It does not print anything. The unbuffered channel send blocks because no receiver is ready. The runtime detects whole-program deadlock and aborts with `fatal error: all goroutines are asleep - deadlock!` followed by a stack dump.

### Q3. What are the four Coffman conditions?

**Expected answer.**
1. **Mutual exclusion** — a resource is held by at most one goroutine.
2. **Hold-and-wait** — a goroutine holds one resource and waits for another.
3. **No preemption** — a held resource cannot be forcibly taken.
4. **Circular wait** — a cycle exists in the wait graph.

All four must hold for deadlock to be possible. Breaking any one prevents deadlock.

### Q4. How is `sync.Mutex.Lock` different from Java's `synchronized`?

**Expected answer.** `sync.Mutex` is **not reentrant.** The same goroutine calling `Lock` twice on the same mutex deadlocks. Java's `synchronized` is reentrant — the same thread can re-enter without blocking.

### Q5. Will this deadlock?

```go
var wg sync.WaitGroup
wg.Add(1)
go func() {
    // forgot wg.Done()
}()
wg.Wait()
```

**Expected answer.** Yes. The goroutine exits without calling `Done`, so the counter never decrements to zero. The main goroutine waits forever. The runtime detects whole-program deadlock and aborts.

### Q6. How do you prevent the most common channel deadlock?

**Expected answer.** Always have the producer `close` the channel when done, and have consumers use `for range`. The convention "producer closes, consumer ranges" makes the "forever blocked on next receive" deadlock impossible.

```go
go func() {
    defer close(ch)
    for _, x := range data {
        ch <- x
    }
}()
for v := range ch {
    // ...
}
```

### Q7. What is the typical fix for `mu.Lock()`?

**Expected answer.** Immediately follow it with `defer mu.Unlock()`:

```go
mu.Lock()
defer mu.Unlock()
// work
```

This ensures the unlock runs regardless of how the function exits — normal return, panic, or early return.

---

## Middle Level

### Q8. Why does this program not deadlock?

```go
package main

import "time"

func main() {
    ch := make(chan int)
    <-ch
    time.Sleep(time.Hour)
}
```

Wait — does it deadlock?

**Expected answer.** Yes, it deadlocks. The receive on `ch` blocks immediately because there is no sender. The `time.Sleep` line is never reached. The runtime detector fires.

The trick question here is: would `time.Sleep` mask detection? It only would if there were a *live* sleep happening before the deadlock. Once `<-ch` parks the main goroutine and no other source of liveness exists, detection fires immediately.

### Q9. Why does this *not* trigger the runtime deadlock detector?

```go
package main

import "time"

func main() {
    go func() {
        for {
            time.Sleep(time.Hour)
        }
    }()
    ch := make(chan int)
    <-ch
}
```

**Expected answer.** The spawned goroutine has a pending timer (`time.Sleep`). The runtime's `checkdead` recognises pending timers as a source of liveness. So even though the main goroutine is deadlocked on `<-ch`, the program is not "all asleep" — the timer goroutine will wake in an hour.

This is a real production gotcha: any background timer (metrics ticker, log rotator) can mask whole-program deadlock detection.

### Q10. Two goroutines hold mutex A and B respectively, each waiting for the other. Walk me through the runtime stack dump.

**Expected answer.** Each goroutine appears with state `[sync.Mutex.Lock]` (or `[semacquire]` on older Go). The deepest user-code frame shows where `Lock` was called; the line above (in source) shows which mutex it holds.

The mutex address in the runtime frame (`sync.runtime_SemacquireMutex(0x...)`) is the address of the mutex's internal semaphore counter. By comparing addresses between the two goroutines, you can confirm the cycle: G1 waits on A's address, G2 waits on B's address, G1's stack shows it had already taken B, G2's stack shows it had already taken A.

### Q11. What is the lock-order rank pattern?

**Expected answer.** Assign every mutex in the system a numeric rank. Document the ranks. Enforce that any goroutine holding a lock of rank R can only acquire locks of rank > R. This makes circular wait impossible, because the wait graph forms a DAG (every edge points from lower rank to higher rank).

The technique can be enforced at runtime with a wrapper that tracks held ranks per-goroutine (via context) and panics on violation, similar to the Linux kernel's `lockdep`.

### Q12. Why is calling external code (DB, HTTP, RPC) while holding a `sync.Mutex` dangerous?

**Expected answer.** Two reasons.

First, **latency.** The lock is held for the duration of the external call. Other goroutines wanting the same lock are blocked for the same duration. Throughput collapses.

Second, **deadlock.** The external code may call back into your service, or another goroutine using the same external resource may try to take the lock. A common production deadlock is "cache mutex held while waiting for DB connection, DB connection held while waiting for cache mutex."

The discipline: release the lock before calling out. If you need consistency, use a singleflight pattern or accept eventual consistency.

### Q13. Describe `goleak` and what it catches.

**Expected answer.** `goleak` (`go.uber.org/goleak`) is a test helper that asserts no goroutines outlive the test. It is *not* a deadlock detector specifically — it catches all goroutine leaks. But every deadlock that survives a test is a leak, so `goleak` catches all of them.

Use it via `goleak.VerifyTestMain(m)` in `TestMain` for whole-test-binary coverage, or `defer goleak.VerifyNone(t)` per test for finer granularity.

It supports filters like `IgnoreCurrent` (ignore goroutines that existed before the test) and `IgnoreTopFunction` (ignore goroutines parked in a specific function).

### Q14. Why does `for range` on a non-closed channel deadlock?

**Expected answer.** `for range ch` calls `<-ch` in a loop until the channel is closed. If the producer exits without closing, the receive blocks forever. If no other goroutine remains alive, the runtime detects deadlock.

The fix is `defer close(ch)` inside the producer.

---

## Senior Level

### Q15. You inherit a service with frequent partial deadlocks under load. The runtime never aborts, but goroutine count rises and certain endpoints hang. Walk me through the diagnostic and remediation plan.

**Expected answer.**

**Diagnostic phase.**

1. Confirm with metrics: `go_goroutines` rising monotonically, P99 latency on the hung endpoints climbing, error rate flat (the requests do not fail — they hang).
2. Expose `net/http/pprof`. Take a `/debug/pprof/goroutine?debug=2` snapshot from a leaking instance.
3. Take a baseline snapshot from a fresh instance. Diff to find stacks appearing only on the leaking side.
4. Filter for stacks parked on `sync.runtime_SemacquireMutex`, `chan receive`, `chan send`. These are the candidates.
5. For each suspicious stack, identify the resource being awaited and walk the codebase to find the holder.
6. Confirm a cycle in the wait graph.

**Remediation phase.**

1. Patch the immediate cycle — usually by releasing a lock before an external call, or by adding a `select` with `ctx.Done`.
2. Add a regression test: spawn N concurrent calls in the same shape, assert completion within a timeout.
3. Audit other code paths that touch the same mutex(es). Apply the lock-order rank pattern if more than one mutex is involved.
4. Add `goleak.VerifyNone` to relevant tests.
5. Add a heartbeat metric so the next deadlock is detected by monitoring, not by customer complaint.
6. Postmortem: document the cycle, root cause, prevention, in a team-shared format.

### Q16. When would you choose an actor model (single-writer goroutine) over a `sync.Mutex`?

**Expected answer.** When the protected state has complex invariants spanning multiple fields, the operations on it are diverse (many entry points), and the read/write rate is moderate (not extreme hot path). The actor pattern serializes operations naturally and eliminates the mutex deadlock surface — replacing it with a channel surface that is usually shallower.

Tradeoffs: channel send/receive is ~5-10x slower than uncontested mutex acquire. For hot, simple operations like counters, atomic operations are faster. Use actors for "this state is a tiny in-process database" workloads; use atomics for counters; use mutexes for short, well-ordered critical sections.

### Q17. Compare Go's deadlock posture to Java's.

**Expected answer.**

- **Detection.** Go has a built-in runtime detector for whole-program deadlock. Java has none built-in but offers `jstack -l` and `ThreadMXBean.findDeadlockedThreads()` for programmatic detection of partial deadlocks. Java's detection is more powerful in practice because it works on running systems.
- **Reentrancy.** Java's `synchronized` is reentrant; Go's `sync.Mutex` is not. Go's design forces you to avoid recursive locking, which often surfaces design problems early.
- **Timeout-based acquisition.** Java's `ReentrantLock.tryLock(timeout)` is standard; Go's `sync.Mutex` has `TryLock` (since 1.18) but no built-in `LockWithTimeout`.
- **Channels.** Go has them first-class. Java relies on `BlockingQueue`, which is similar but library-level.

Go's posture is "narrow detection, strong conventions." Java's is "more detection, more flexible primitives." Different tradeoffs for different ecosystems.

### Q18. How would you design a lock-order analyzer for a Go codebase?

**Expected answer.**

1. Use `golang.org/x/tools/go/analysis`. Define an analyzer that walks the AST and call graph.
2. For each function, compute a "locks-held set" at each call site, propagating across function boundaries via interprocedural analysis (the `pointer` or `ssa` packages help).
3. Identify every `Mutex.Lock()` call. Record an edge "this set of held locks → newly acquired lock."
4. Build the global lock-acquisition graph across all packages.
5. Run a cycle detection (Tarjan SCC). Any non-trivial SCC is a potential inversion.

Limitations: mutexes accessed via interfaces or stored in `any` are invisible; lock acquisitions inside callbacks require accurate function-pointer analysis; false positives from `sync.RWMutex.Lock` vs `RLock` distinction.

For a strict-deadlock-freedom domain, the effort to write such an analyzer pays off over years. For most codebases, run-time tools like `go-deadlock` in CI are a cheaper substitute.

### Q19. A distributed system has three services calling each other and occasionally enters a deadlock where requests across all three time out. How do you approach it?

**Expected answer.**

A distributed deadlock is the Coffman conditions across services. Mitigations:

1. **Timeouts everywhere.** Every RPC has a context deadline. Without one, a downstream hang becomes an upstream hang.
2. **Break circular call patterns.** A → B → C → A is a structural cycle. Refactor to A → B → C, with C asynchronously notifying A via an event.
3. **Idempotent retries with backoff.** Timeouts turn deadlocks into errors; idempotent retries recover from errors.
4. **Saga pattern.** Long workflows are decomposed into local transactions with compensations on failure. No held cross-service resource.
5. **Single ownership.** Each piece of state has one service that owns it. Other services request, do not lock.

Detection at the distributed level: aggregate traces (Jaeger, Zipkin), look for traces that did not complete within their deadline. Alert on the rate of such timeouts.

---

## Tricky / Misconception-Probing Questions

### Q20. "Go has built-in deadlock detection, so I never need to worry about deadlocks in Go." Comment.

**Expected answer.** Wrong. Go's detector is narrow: it fires only when *every* goroutine in the program is parked. In production, programs always have some live goroutine (HTTP listeners, metric tickers, GC), so the detector almost never fires. Partial deadlocks — the common production case — slip through silently and manifest as rising goroutine counts and hung requests.

### Q21. "I added a `time.Sleep` to fix the flaky test, and now it passes." What's wrong?

**Expected answer.** The sleep is masking a real deadlock detection. With a sleeping goroutine, the runtime considers the program "alive" and stays silent. Once the sleep ends, the program may deadlock again. Worse, the sleep hides a race condition by adding artificial ordering. Remove the sleep; replace with explicit synchronization (channel, `WaitGroup`).

### Q22. Does this program deadlock?

```go
package main

func main() {
    select {}
}
```

**Expected answer.** Yes. `select` with no cases blocks the goroutine forever with no wakeup source. The main goroutine is parked, no other goroutine exists, the runtime detects deadlock and aborts.

### Q23. Does this program deadlock?

```go
package main

import "time"

func main() {
    select {
    case <-time.After(time.Hour):
    }
}
```

**Expected answer.** No. The `time.After` creates a timer, which the runtime treats as a wakeup source. The program is not deadlocked — it is just waiting an hour. The runtime detector does not fire.

If you ran this, the program would sleep for an hour and then exit normally.

### Q24. Is this a deadlock?

```go
package main

import "fmt"

func main() {
    ch := make(chan int)
    go func() {
        ch <- 1
    }()
    fmt.Println(<-ch)
}
```

**Expected answer.** No. The spawned goroutine sends on the channel; the main goroutine receives. The send and receive rendezvous on the unbuffered channel and both proceed. The program prints `1` and exits.

### Q25. What is wrong here?

```go
var mu sync.Mutex
mu.Lock()
go func() {
    mu.Unlock()
}()
mu.Lock()
```

**Expected answer.** Two issues.

First, `sync.Mutex` is not designed for unlock-by-another-goroutine. The Go spec says: "A `Mutex` must not be copied after first use," and the documentation around `Unlock` implies a single-owner model. In practice unlock from another goroutine works, but it is a code smell.

Second, there is a race: the main goroutine calls `Lock` twice with a goroutine attempting `Unlock` in between. If the spawned goroutine has not yet been scheduled when the second `Lock` is called, the main goroutine blocks. Eventually the spawned goroutine runs, unlocks, the main goroutine acquires, and proceeds. This works but is fragile. If you intended a counted handoff, use a channel or `sync.WaitGroup`.

---

## Open-Ended / Architectural

### Q26. Describe a deadlock you have personally diagnosed in production. What was the cycle, how did you find it, and what did you change to prevent recurrence?

**Expected answer.** This is a real-experience question with no canonical answer. A strong response covers:

- The specific resources involved (which mutexes, which channels, which services).
- How the symptom manifested (latency, leak count, error rate).
- The diagnostic steps (pprof, traces, code reading) in order.
- The immediate patch.
- The systemic change: a lock order, a refactor, a new test pattern.
- What you learned and applied later.

Weak answer: "I had a deadlock once and added a `time.Sleep`." Strong answer demonstrates rigor in both diagnosis and prevention.

### Q27. How would you teach a junior developer to avoid deadlocks?

**Expected answer.** A few principles in order of impact:

1. Always `defer mu.Unlock()` on the line after `mu.Lock()`.
2. Always `defer wg.Done()` first inside a goroutine body.
3. Never call external code (DB, HTTP, callbacks) while holding a lock.
4. For producer-consumer, always have the producer `close` the channel.
5. For context-aware code, always `select` on `ctx.Done` alongside the work case.
6. When more than one mutex appears in your design, write down the lock order before writing the code.
7. Write tests with timeouts so hangs surface as failures.

These seven rules eliminate the majority of deadlocks that beginners write. The remaining are subtle and require diagnostic skill, which comes with experience reading stack dumps and pprof profiles.
